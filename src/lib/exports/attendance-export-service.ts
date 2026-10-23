/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Presenças por atividade no arquivo da FASE 49 (FASE 77 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DADO JÁ EXISTIA; FALTAVA A PROJEÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `attendances` guarda, por sessão, `eventId`, `activityId`, `userId`,
 *  `checkedInAt`, `checkedOutAt` e `minutesAttended` — e tem índice
 *  `[tenantId, activityId, userId]`. O CSV do diretório nunca leu essa granularidade:
 *  ele soma por pessoa. A lista de presença por atividade, que é o que a coordenação
 *  leva para o relatório, não existia em lugar nenhum da plataforma.
 *
 *  Este serviço NÃO inventa um segundo caminho de exportação: ele devolve
 *  `header` + `rows`, exatamente como `collectParticipantExportRows`, e quem monta o
 *  arquivo com marca d'água e prazo continua sendo `buildDataExportFile`
 *  (`buildWatermarkedCsv`). O arquivo continua NÃO sendo guardado: o que o pedido
 *  grava é o recorte (`eventId` + `activityId`), e o download o regera.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ESCOPO É SEMPRE UM EVENTO — E ELE PRECISA EXISTIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem o evento, "presenças por atividade" seria a instituição inteira numa linha
 *  por sessão: o arquivo mais caro da plataforma e o menos pedido. Por isso o
 *  `eventId` é obrigatório, e um id que não existe na instituição é RECUSADO em vez
 *  de virar um arquivo de zero linhas — um CSV vazio parece "ninguém compareceu",
 *  quando o que houve foi um pedido errado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { EXPORT_FILTER_LABELS, exportFiltersLine } from '@/domain/exports/export-rules';
import {
  ATTENDANCE_CSV_HEADER,
  attendanceExportRow,
  resolveAttendanceExportSize,
} from '@/domain/exports/attendance-export-rules';
import { CSV_MAX_ROWS, type CsvValue } from '@/domain/participants/participant-rules';

export type AttendanceExportErrorCode = 'NOT_FOUND' | 'INVALID_INPUT' | 'INTERNAL';

export type AttendanceExportResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AttendanceExportErrorCode; message: string };

interface AttendanceScope {
  eventId: string;
  activityId: string | null;
  /** Fuso do EVENTO: é nele que a lista de presença é lida. */
  timezone: string;
}

/** O evento (e a atividade, quando escolhida) pertencem a esta instituição? */
async function resolveScope(
  tenantId: string,
  filters: { eventId?: string | null; activityId?: string | null },
): Promise<AttendanceExportResult<AttendanceScope>> {
  const eventId = filters.eventId ?? '';
  const activityId = filters.activityId ?? null;

  if (!eventId) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Escolha o evento das presenças a exportar.',
    };
  }

  try {
    return await withTenant(tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: eventId, tenantId },
        select: { id: true, timezone: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      if (activityId) {
        const activity = await tx.activity.findFirst({
          where: { id: activityId, tenantId, eventId },
          select: { id: true },
        });

        if (!activity) {
          return {
            ok: false as const,
            code: 'INVALID_INPUT' as const,
            message: 'Esta atividade não pertence ao evento.',
          };
        }
      }

      return { ok: true as const, eventId: event.id, activityId, timezone: event.timezone };
    });
  } catch (error) {
    console.error(`[exports] falha ao resolver o recorte das presenças: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível preparar a exportação.' };
  }
}

/**
 * Quantas linhas o arquivo teria (para o pedido gravar o número e o teto).
 *
 * Conta no BANCO, e não carregando as linhas: o pedido só precisa do número, e o
 * download é quem materializa o arquivo.
 */
export async function countAttendanceExportRows(input: {
  tenantId: string;
  filters: { eventId?: string | null; activityId?: string | null };
}): Promise<AttendanceExportResult<{ rowCount: number; truncated: boolean }>> {
  const scope = await resolveScope(input.tenantId, input.filters);

  if (!scope.ok) return scope;

  try {
    const total = await withTenant(input.tenantId, (tx) =>
      tx.attendance.count({
        where: {
          tenantId: input.tenantId,
          eventId: scope.eventId,
          ...(scope.activityId ? { activityId: scope.activityId } : {}),
        },
      }),
    );

    return { ok: true, ...resolveAttendanceExportSize(total) };
  } catch (error) {
    console.error(`[exports] falha ao contar presenças: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível contar as presenças.' };
  }
}

/**
 * As linhas do arquivo, em FORMATO LONGO: uma por presença.
 *
 * A leitura PARA no teto (`take: CSV_MAX_ROWS`): o arquivo é para conferência
 * humana, e quem precisa do conjunto inteiro pede outro recorte. O `truncated` do
 * PEDIDO foi decidido na contagem (`countAttendanceExportRows`) e o download ainda
 * reconfere se as linhas passaram do que o pedido prometeu (`buildDataExportFile`).
 *
 * A ordem (atividade → pessoa → entrada) é a da LISTA DE PRESENÇA impressa: quem
 * confere o arquivo na portaria percorre atividade por atividade. `activityId` nulo
 * (chegada ao evento, ADR-149) fica no fim porque o banco ordena NULL por último no
 * `ASC` — e a linha diz "(sem atividade)" em vez de sumir.
 */
export async function collectAttendanceExportRows(input: {
  tenantId: string;
  filters: { eventId?: string | null; activityId?: string | null };
}): Promise<AttendanceExportResult<{ header: readonly string[]; rows: CsvValue[][] }>> {
  const scope = await resolveScope(input.tenantId, input.filters);

  if (!scope.ok) return scope;

  try {
    const rows = await withTenant(input.tenantId, (tx) =>
      tx.attendance.findMany({
        where: {
          tenantId: input.tenantId,
          eventId: scope.eventId,
          ...(scope.activityId ? { activityId: scope.activityId } : {}),
        },
        orderBy: [
          { activity: { title: 'asc' } },
          { user: { name: 'asc' } },
          { checkedInAt: 'asc' },
        ],
        take: CSV_MAX_ROWS,
        select: {
          checkedInAt: true,
          checkedOutAt: true,
          minutesAttended: true,
          activity: { select: { title: true } },
          user: { select: { name: true } },
        },
      }),
    );

    return {
      ok: true,
      header: ATTENDANCE_CSV_HEADER,
      rows: rows.map((row) =>
        attendanceExportRow({
          activityTitle: row.activity?.title ?? null,
          personName: row.user.name,
          checkedInAt: row.checkedInAt,
          checkedOutAt: row.checkedOutAt,
          minutes: row.minutesAttended,
          timezone: scope.timezone,
        }),
      ),
    };
  } catch (error) {
    console.error(`[exports] falha ao montar as presenças: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível exportar as presenças.' };
  }
}

/**
 * Os filtros em texto, para a linha de procedência do arquivo.
 *
 * O TÍTULO do evento e o NOME da atividade, não os ids: quem abre o arquivo daqui a
 * um ano precisa reconhecer o recorte — "Evento: 3f2a…" não diz nada a ninguém.
 */
export async function attendanceFiltersLabel(
  tenantId: string,
  filters: Record<string, string | boolean | undefined>,
): Promise<string | null> {
  const eventId = typeof filters.eventId === 'string' ? filters.eventId : '';
  const activityId = typeof filters.activityId === 'string' ? filters.activityId : '';

  const names = await withTenant(tenantId, async (tx) => {
    const event = eventId
      ? await tx.event.findFirst({ where: { id: eventId, tenantId }, select: { title: true } })
      : null;

    const activity = activityId
      ? await tx.activity.findFirst({
          where: { id: activityId, tenantId },
          select: { title: true },
        })
      : null;

    return { event: event?.title ?? null, activity: activity?.title ?? null };
  });

  const entries: { label: string; value: string }[] = [];

  if (eventId) {
    entries.push({ label: EXPORT_FILTER_LABELS.eventId ?? 'Evento', value: names.event ?? eventId });
  }

  if (activityId) {
    entries.push({
      label: EXPORT_FILTER_LABELS.activityId ?? 'Atividade',
      value: names.activity ?? activityId,
    });
  }

  return exportFiltersLine(entries);
}

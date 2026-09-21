/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Fechamento automático das presenças abertas (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE ELE RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No balcão, a entrada é registrada por leitura e a saída quase nunca: a pessoa
 *  entra na oficina, assiste, e vai embora sem passar de novo pelo leitor. A presença
 *  fica ABERTA — e é dos minutos dela que saem a carga do certificado (FASE 6), o peso
 *  do sorteio (FASE 16) e a carta de presença total.
 *
 *  Quem fecha é este serviço, e o número que ele grava é o do FIM DA ATIVIDADE:
 *  a saída de quem esqueceu é o horário em que a atividade terminou, não o horário em
 *  que a varredura rodou. Assim o mesmo conjunto de dados produz sempre a mesma conta
 *  — o que importa para quem audita e para quem reemite um certificado meses depois.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VARREDURA É CROSS-TENANT, E ISSO É SEGURO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O worker não tem instituição; ele lista os tenants ativos pelo `systemClient` (o
 *  mesmo caminho da varredura de prazos de parecer, FASE 15) e abre uma transação POR
 *  INSTITUIÇÃO com `withTenant`. Nenhuma linha é lida fora do contexto de tenant: a
 *  RLS continua sendo a última linha, e o agendador não vira uma porta lateral.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { systemClient, withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { sessionCloseOf } from '@/domain/events/attendance-rules';

export interface AttendanceSweepResult {
  tenants: number;
  closed: number;
  minutes: number;
  /** Quantas presenças abertas ainda estão dentro do prazo (a atividade não acabou). */
  pending: number;
}

/** Teto de sessões fechadas por instituição em uma passada (a varredura é periódica). */
const SWEEP_BATCH = 500;

/**
 * Fecha as presenças abertas de atividades que JÁ TERMINARAM.
 *
 * Presença sem atividade (`activityId` nulo, a portaria) fica de fora: não há fim
 * declarado, e inventar um horário de saída para quem está no evento seria criar um
 * dado que ninguém registrou. Quem fecha a portaria é o botão do painel, com a hora
 * do clique.
 */
export async function runAttendanceSweep(input: { now?: Date } = {}): Promise<AttendanceSweepResult> {
  const now = input.now ?? new Date();
  const result: AttendanceSweepResult = { tenants: 0, closed: 0, minutes: 0, pending: 0 };

  try {
    const tenants = await systemClient().tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    for (const tenant of tenants) {
      result.tenants += 1;

      const partial = await withTenant(tenant.id, async (tx) => {
        const open = await tx.attendance.findMany({
          where: {
            tenantId: tenant.id,
            checkedOutAt: null,
            activityId: { not: null },
          },
          orderBy: { checkedInAt: 'asc' },
          take: SWEEP_BATCH,
          select: {
            id: true,
            checkedInAt: true,
            activity: { select: { endsAt: true } },
          },
        });

        let closed = 0;
        let minutes = 0;
        let pending = 0;

        for (const session of open) {
          const close = sessionCloseOf({
            checkedInAt: session.checkedInAt,
            activityEndsAt: session.activity?.endsAt ?? null,
            now,
          });

          if (!close) {
            pending += 1;
            continue;
          }

          await tx.attendance.update({
            where: { id: session.id },
            data: {
              checkedOutAt: close.closedAt,
              minutesAttended: close.minutes,
              notes: 'Saída registrada no fim da atividade (fechamento automático).',
            },
          });

          closed += 1;
          minutes += close.minutes;
        }

        return { closed, minutes, pending };
      });

      result.closed += partial.closed;
      result.minutes += partial.minutes;
      result.pending += partial.pending;
    }

    return result;
  } catch (error) {
    console.error(`[attendance] falha na varredura de presenças: ${errorMessage(error)}`);

    return result;
  }
}

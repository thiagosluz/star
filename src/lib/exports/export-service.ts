/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Exportação de dados pessoais com prazo (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ARQUIVO NÃO É GUARDADO — E É ISSO QUE DÁ SENTIDO AO PRAZO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que o banco guarda é o ATO: quem pediu, o tipo, os filtros, quantas linhas,
 *  até quando vale e quantas vezes foi baixado. O CSV é REGERADO no momento do
 *  download, a partir dos mesmos filtros.
 *
 *  Duas consequências, as duas deliberadas:
 *   • não existe cópia do dado pessoal parada no banco nem no bucket esperando
 *     alguém lembrar de apagar;
 *   • o que expira é o DIREITO de baixar de novo — e expirar só é possível porque
 *     regerar é possível. Passado o prazo, baixar exige uma NOVA exportação, com
 *     autor e hora novos na trilha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DOWNLOAD É POR SESSÃO, NÃO POR LINK ASSINADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa óbvia era uma URL assinada (como o material do palestrante). Aqui
 *  ela seria PIOR: uma URL assinada é uma credencial que circula sem dono, e o
 *  ponto desta fase é justamente saber quem baixou. O download exige sessão e a
 *  MESMA permissão da tela, reconferida na rota — cada download tem nome, e o
 *  contador da linha diz quantas vezes aquele arquivo saiu.
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM BAIXOU APARECE NA LISTA (dívida E73 · FASE 51)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O autor de cada download sempre esteve gravado (`AuditAction.EXPORT` com
 *  `entityId` = a exportação), mas só era visível na TRILHA: para descobrir quem
 *  pegou o arquivo era preciso sair da lista de exportações recentes e abrir a
 *  auditoria. Agora a lista mostra o nome e o instante dos últimos downloads, e a
 *  leitura da trilha é UMA consulta para a lista inteira (ver `attachDownloaders`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { recordAudit } from '@/lib/admin/audit';
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { CSV_MAX_ROWS } from '@/domain/participants/participant-rules';
import {
  EXPORT_KIND_LABELS,
  EXPORT_TTL_HOURS,
  EXPORT_WATERMARK_NOTICE,
  buildWatermarkedCsv,
  exportExpiresAt,
  exportFileName,
  isExportExpired,
  type ExportKind,
  type ExportWatermark,
} from '@/domain/exports/export-rules';
import {
  collectParticipantExportRows,
  listParticipants,
  participantFiltersLabel,
} from '@/lib/participants/participant-service';
import { collectSponsorContactRows } from '@/lib/sponsors/sponsor-portal-service';

export type ExportErrorCode = 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'INVALID_INPUT' | 'INTERNAL';

export type ExportResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: ExportErrorCode; message: string };

/** Quantas exportações recentes a tela mostra (as antigas continuam na trilha). */
export const RECENT_EXPORTS_LIMIT = 5;

/**
 * Quantos downloads a lista mostra por exportação (os mais recentes).
 *
 * Três é o que cabe numa linha da lista sem virar parágrafo — e o total já está
 * no contador (`downloadCount`), então o que a linha precisa responder é "quem",
 * não "quantos". O resto sai no texto "+N download(s)".
 */
export const EXPORT_DOWNLOADER_LIMIT = 3;

export interface ExportDownloader {
  /** Nome de quem baixou; "Conta removida" quando a conta já não existe. */
  name: string;
  at: Date;
}

export interface ExportRecordView {
  id: string;
  kind: ExportKind;
  rowCount: number;
  truncated: boolean;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  downloadCount: number;
  lastDownloadedAt: Date | null;
  authorName: string;
  /**
   * Quem baixou, do mais recente para o mais antigo (dívida E73 · FASE 51).
   *
   * Antes, o autor de cada download só existia na trilha: para saber quem pegou o
   * arquivo era preciso sair da lista de exportações recentes e abrir a trilha da
   * instituição. O dado já estava gravado — faltava MOSTRAR.
   *
   * Vazio quando ninguém baixou: a tela diz "ninguém baixou ainda" em vez de
   * deixar a linha sem nada (ausência de texto é lida como tela quebrada).
   */
  downloaders: ExportDownloader[];
  /**
   * Patrocinador do pedido, quando é exportação de contatos.
   *
   * A tela do patrocínio mostra VÁRIOS patrocinadores na mesma página, então a lista
   * de exportações recentes precisa saber de quem é cada linha — e a revogação
   * também, porque a autorização do patrocinador é por vínculo com ELE.
   */
  sponsorId: string | null;
  /** `ATIVA` · `EXPIRADA` · `REVOGADA` — o estado que a tela mostra. */
  status: 'ATIVA' | 'EXPIRADA' | 'REVOGADA';
  /** Quantas horas faltam (0 quando já venceu). */
  hoursLeft: number;
}

function statusOf(record: { expiresAt: Date; revokedAt: Date | null }, now: Date): ExportRecordView['status'] {
  if (record.revokedAt) return 'REVOGADA';
  return isExportExpired({ expiresAt: record.expiresAt, now }) ? 'EXPIRADA' : 'ATIVA';
}

function hoursLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 3_600_000));
}

/** O `sponsorId` vem dos filtros gravados (`{}` quando a exportação é do diretório). */
function sponsorIdOf(filters: unknown): string | null {
  const value = (filters ?? {}) as Record<string, unknown>;
  return typeof value.sponsorId === 'string' ? value.sponsorId : null;
}

function isKind(value: string): value is ExportKind {
  return value === 'PARTICIPANTS_CSV' || value === 'SPONSOR_CONTACTS_CSV';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criar o pedido de exportação
// ───────────────────────────────────────────────────────────────────────────────
export async function createDataExport(input: {
  tenantId: string;
  actorId: string;
  kind: ExportKind;
  filters: Record<string, string | boolean | undefined>;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ExportResult<{ exportId: string; expiresAt: Date; rowCount: number; truncated: boolean }>> {
  try {
    /** A contagem vem da MESMA consulta que a tela usa — nada de contar linha a linha. */
    const counted = await countExportRows({
      tenantId: input.tenantId,
      kind: input.kind,
      filters: input.filters,
    });

    if (!counted.ok) return counted;

    const now = new Date();
    const expiresAt = exportExpiresAt(now);

    const created = await withTenant(input.tenantId, (tx) =>
      tx.dataExport.create({
        data: {
          tenantId: input.tenantId,
          requestedById: input.actorId,
          kind: input.kind,
          filters: counted.filters as object,
          rowCount: counted.rowCount,
          truncated: counted.truncated,
          expiresAt,
        },
        select: { id: true },
      }),
    );

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'CREATE',
      entityType: 'data_export',
      entityId: created.id,
      changes: {
        tipo: { from: null, to: EXPORT_KIND_LABELS[input.kind] },
        linhas: { from: null, to: counted.rowCount },
        expiraEm: { from: null, to: expiresAt.toISOString() },
      },
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    return {
      ok: true,
      exportId: created.id,
      expiresAt,
      rowCount: counted.rowCount,
      truncated: counted.truncated,
    };
  } catch (error) {
    console.error(`[exports] falha ao criar exportação: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível preparar a exportação.' };
  }
}

async function countExportRows(input: {
  tenantId: string;
  kind: ExportKind;
  filters: Record<string, string | boolean | undefined>;
}): Promise<
  ExportResult<{ rowCount: number; truncated: boolean; filters: Record<string, string | boolean> }>
> {
  if (input.kind === 'PARTICIPANTS_CSV') {
    const total = await countParticipants(input.tenantId, input.filters);

    return {
      ok: true,
      rowCount: Math.min(total, CSV_MAX_ROWS),
      truncated: total > CSV_MAX_ROWS,
      filters: pruneFilters(input.filters),
    };
  }

  const sponsorId = typeof input.filters.sponsorId === 'string' ? input.filters.sponsorId : '';

  if (!sponsorId) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe o patrocinador da exportação.' };
  }

  const leads = await collectSponsorContactRows({ tenantId: input.tenantId, sponsorId });

  if (!leads.ok) return { ok: false, code: 'NOT_FOUND', message: leads.message };

  return {
    ok: true,
    rowCount: Math.min(leads.rows.length, CSV_MAX_ROWS),
    truncated: leads.rows.length > CSV_MAX_ROWS,
    filters: pruneFilters(input.filters),
  };
}

/** Só o filtro preenchido vai para o banco: `{ busca: '' }` descreveria um recorte falso. */
function pruneFilters(
  filters: Record<string, string | boolean | undefined>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === false) continue;
    out[key] = value;
  }

  return out;
}

async function countParticipants(
  tenantId: string,
  filters: Record<string, string | boolean | undefined>,
): Promise<number> {
  const listing = await listParticipants({
    tenantId,
    page: 1,
    pageSize: 1,
    query: typeof filters.query === 'string' ? filters.query : undefined,
    eventId: typeof filters.eventId === 'string' ? filters.eventId : undefined,
    onlyWithCertificate: filters.onlyWithCertificate === true,
    onlyAttended: filters.onlyAttended === true,
  });

  return listing.ok ? listing.page.total : 0;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Gerar o arquivo (no download)
// ───────────────────────────────────────────────────────────────────────────────
export async function buildDataExportFile(input: {
  tenantId: string;
  exportId: string;
  tenantSlug: string;
  actorId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<
  ExportResult<{ csv: string; fileName: string; rowCount: number; truncated: boolean; expiresAt: Date }>
> {
  const now = input.now ?? new Date();

  try {
    const record = await withTenant(input.tenantId, (tx) =>
      tx.dataExport.findFirst({
        where: { id: input.exportId, tenantId: input.tenantId },
        select: {
          id: true,
          kind: true,
          filters: true,
          rowCount: true,
          truncated: true,
          expiresAt: true,
          revokedAt: true,
          requestedById: true,
          requestedBy: { select: { name: true, email: true } },
          tenant: { select: { name: true, timezone: true } },
        },
      }),
    );

    if (!record) {
      return { ok: false, code: 'NOT_FOUND', message: 'Exportação não encontrada.' };
    }

    if (record.revokedAt) {
      return { ok: false, code: 'REVOKED', message: 'Esta exportação foi revogada. Exporte de novo.' };
    }

    if (isExportExpired({ expiresAt: record.expiresAt, now })) {
      return {
        ok: false,
        code: 'EXPIRED',
        message: `O prazo desta exportação venceu (${EXPORT_TTL_HOURS} horas). Exporte de novo para baixar.`,
      };
    }

    const filters = (record.filters ?? {}) as Record<string, string | boolean | undefined>;
    const watermark: ExportWatermark = {
      kind: record.kind as ExportKind,
      tenantName: record.tenant.name,
      authorName: record.requestedBy?.name ?? 'Conta removida',
      authorEmail: record.requestedBy?.email ?? '—',
      /** O arquivo diz quando FOI GERADO (agora) e até quando o PEDIDO vale. */
      generatedAt: now,
      expiresAt: record.expiresAt,
      timezone: record.tenant.timezone,
      filtersLabel: await labelFor(input.tenantId, record.kind as ExportKind, filters),
      exportId: record.id,
    };

    const collected =
      record.kind === 'PARTICIPANTS_CSV'
        ? await collectParticipantExportRows({ tenantId: input.tenantId, filters })
        : await collectSponsorContactRows({
            tenantId: input.tenantId,
            sponsorId: typeof filters.sponsorId === 'string' ? filters.sponsorId : '',
          });

    if (!collected.ok) {
      return { ok: false, code: 'NOT_FOUND', message: collected.message };
    }

    const csv = buildWatermarkedCsv({
      header: collected.header,
      rows: collected.rows,
      watermark,
    });

    await withTenant(input.tenantId, (tx) =>
      tx.dataExport.update({
        where: { id: record.id },
        data: { downloadCount: { increment: 1 }, lastDownloadedAt: now },
      }),
    );

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'EXPORT',
      entityType: 'data_export',
      entityId: record.id,
      changes: {
        tipo: { from: null, to: EXPORT_KIND_LABELS[record.kind as ExportKind] },
        linhas: { from: null, to: collected.rows.length },
      },
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    return {
      ok: true,
      csv,
      fileName: exportFileName({
        kind: record.kind as ExportKind,
        tenantSlug: input.tenantSlug,
        generatedAt: now,
      }),
      rowCount: collected.rows.length,
      truncated: record.truncated || collected.rows.length > record.rowCount,
      expiresAt: record.expiresAt,
    };
  } catch (error) {
    console.error(`[exports] falha ao gerar arquivo: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível gerar o arquivo.' };
  }
}

/** A linha de filtros do arquivo, com o título do evento quando ele foi escolhido. */
async function labelFor(
  tenantId: string,
  kind: ExportKind,
  filters: Record<string, string | boolean | undefined>,
): Promise<string | null> {
  if (kind === 'SPONSOR_CONTACTS_CSV') {
    const sponsorId = typeof filters.sponsorId === 'string' ? filters.sponsorId : '';

    const name = await withTenant(tenantId, async (tx) => {
      const sponsor = await tx.sponsor.findFirst({
        where: { id: sponsorId, tenantId },
        select: { name: true },
      });

      return sponsor?.name ?? null;
    });

    return name;
  }

  return participantFiltersLabel(tenantId, filters);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Quem baixou (dívida E73 · FASE 51)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Lê o autor de cada download na trilha — UMA consulta para a lista inteira.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A JANELA DE DATAS É OBRIGATÓRIA (E POR QUE NÃO SE FAZ UMA POR LINHA)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `audit_logs` é PARTICIONADA POR MÊS em `createdAt`. A consulta poda partições
 *  pelo intervalo de `createdAt` — e SÓ por ele: filtrar apenas por `entityId`
 *  obrigaria o PostgreSQL a varrer todas as partições já criadas, inclusive as de
 *  meses em que aquela exportação nem existia.
 *
 *  Daí a janela `[exportação mais antiga exibida → agora]`: ela cobre todo download
 *  possível (ninguém baixa um arquivo antes de pedi-lo) e deixa o planejador
 *  descartar o resto do histórico antes de ler.
 *
 *  Uma consulta por linha seria o caminho óbvio e é o errado por dois motivos: N
 *  idas ao banco (a lista tem 5 linhas hoje, mas é a mesma tela que vai mostrar 50)
 *  e N varreduras de partição em vez de uma. A junção acontece em memória, com o
 *  `entityId` que a própria consulta já trouxe.
 *
 *  Falha aqui NÃO derruba a lista: sem a trilha, a tela volta ao que era antes da
 *  dívida (contagem sem nome), e não a um erro de exportação.
 */
async function attachDownloaders(
  tenantId: string,
  records: readonly ExportRecordView[],
  now: Date,
): Promise<ExportRecordView[]> {
  if (records.length === 0) return [];

  try {
    const exportIds = records.map((record) => record.id);

    /** Piso da janela: o pedido mais antigo exibido. Download nunca é anterior a ele. */
    const since = new Date(Math.min(...records.map((record) => record.createdAt.getTime())));

    const rows = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId,
          action: 'EXPORT',
          entityType: 'data_export',
          entityId: { in: exportIds },
          createdAt: { gte: since, lte: now },
        },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, createdAt: true, user: { select: { name: true } } },
      }),
    );

    const byExport = new Map<string, ExportDownloader[]>();

    for (const row of rows) {
      if (!row.entityId) continue;

      const list = byExport.get(row.entityId) ?? [];
      /** A ordem é decrescente: as primeiras linhas de cada exportação são as últimas. */
      if (list.length >= EXPORT_DOWNLOADER_LIMIT) continue;

      list.push({ name: row.user?.name ?? 'Conta removida', at: row.createdAt });
      byExport.set(row.entityId, list);
    }

    return records.map((record) => ({ ...record, downloaders: byExport.get(record.id) ?? [] }));
  } catch (error) {
    console.error(`[exports] falha ao ler quem baixou: ${errorMessage(error)}`);
    return records.map((record) => ({ ...record, downloaders: [] }));
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Lista, leitura e revogação
// ───────────────────────────────────────────────────────────────────────────────
export async function listRecentDataExports(input: {
  tenantId: string;
  kind: ExportKind;
  limit?: number;
  now?: Date;
}): Promise<ExportRecordView[]> {
  const now = input.now ?? new Date();

  try {
    const rows = await withTenant(input.tenantId, (tx) =>
      tx.dataExport.findMany({
        where: { tenantId: input.tenantId, kind: input.kind },
        orderBy: { createdAt: 'desc' },
        take: input.limit ?? RECENT_EXPORTS_LIMIT,
        select: {
          id: true,
          kind: true,
          rowCount: true,
          truncated: true,
          createdAt: true,
          expiresAt: true,
          revokedAt: true,
          downloadCount: true,
          lastDownloadedAt: true,
          requestedBy: { select: { name: true } },
          filters: true,
        },
      }),
    );

    const records: ExportRecordView[] = rows.map((row) => ({
      id: row.id,
      kind: row.kind as ExportKind,
      rowCount: row.rowCount,
      truncated: row.truncated,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      downloadCount: row.downloadCount,
      lastDownloadedAt: row.lastDownloadedAt,
      authorName: row.requestedBy?.name ?? 'Conta removida',
      downloaders: [],
      sponsorId: sponsorIdOf(row.filters),
      status: statusOf(row, now),
      hoursLeft: hoursLeft(row.expiresAt, now),
    }));

    return attachDownloaders(input.tenantId, records, now);
  } catch (error) {
    console.error(`[exports] falha ao listar exportações: ${errorMessage(error)}`);
    return [];
  }
}

export async function getDataExport(input: {
  tenantId: string;
  exportId: string;
  now?: Date;
}): Promise<ExportRecordView | null> {
  const now = input.now ?? new Date();

  const row = await withTenant(input.tenantId, (tx) =>
    tx.dataExport.findFirst({
      where: { id: input.exportId, tenantId: input.tenantId },
      select: {
        id: true,
        kind: true,
        rowCount: true,
        truncated: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        downloadCount: true,
        lastDownloadedAt: true,
        requestedBy: { select: { name: true } },
        filters: true,
      },
    }),
  );

  if (!row) return null;

  const record: ExportRecordView = {
    id: row.id,
    kind: row.kind as ExportKind,
    rowCount: row.rowCount,
    truncated: row.truncated,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    downloadCount: row.downloadCount,
    lastDownloadedAt: row.lastDownloadedAt,
    authorName: row.requestedBy?.name ?? 'Conta removida',
    downloaders: [],
    sponsorId: sponsorIdOf(row.filters),
    status: statusOf(row, now),
    hoursLeft: hoursLeft(row.expiresAt, now),
  };

  /** Uma exportação só: a mesma leitura da lista, com uma linha de janela. */
  const [withDownloaders] = await attachDownloaders(input.tenantId, [record], now);

  return withDownloaders ?? record;
}

/**
 * Revogar é ato de quem já pode exportar na instituição: o dado é DA CASA, não do
 * autor. A trilha guarda quem revogou.
 */
export async function revokeDataExport(input: {
  tenantId: string;
  actorId: string;
  exportId: string;
}): Promise<ExportResult<{ revokedAt: Date }>> {
  try {
    const revokedAt = new Date();

    const updated = await withTenant(input.tenantId, (tx) =>
      tx.dataExport.updateMany({
        where: { id: input.exportId, tenantId: input.tenantId, revokedAt: null },
        data: { revokedAt },
      }),
    );

    if (updated.count === 0) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Esta exportação não existe ou já foi revogada.',
      };
    }

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'DELETE',
      entityType: 'data_export',
      entityId: input.exportId,
      changes: { revogadaEm: { from: null, to: revokedAt.toISOString() } },
    });

    return { ok: true, revokedAt };
  } catch (error) {
    console.error(`[exports] falha ao revogar exportação: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível revogar a exportação.' };
  }
}

/** O aviso que a tela mostra ANTES de exportar (e que o teste E2E prende). */
export const EXPORT_NOTICE = EXPORT_WATERMARK_NOTICE;

export function exportKindOf(value: string | null | undefined): ExportKind | null {
  return value && isKind(value) ? value : null;
}

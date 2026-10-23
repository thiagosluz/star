import { headers } from 'next/headers';

import { authorizeDataExport } from '@/lib/exports/export-access';
import { buildDataExportFile, getDataExport } from '@/lib/exports/export-service';
import { EXPORT_TTL_HOURS } from '@/domain/exports/export-rules';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { isUuid } from '@/domain/validation/id-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GET /api/t/<slug>/exportacoes/<exportId>/arquivo   (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DOWNLOAD É POR SESSÃO — E ISSO É O PONTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa seria uma URL assinada (como o material do palestrante). Aqui ela
 *  seria PIOR: URL assinada é credencial que circula sem dono, e o objetivo desta
 *  fase é saber QUEM baixou o quê. Então o download exige sessão e a MESMA
 *  autorização da tela — reconferida aqui, na rota, porque é a rota que um atacante
 *  chama, não o botão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A ROTA RECUSA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • sem sessão ou sem permissão → 401/403;
 *  • exportação de OUTRA instituição → 404 (a RLS não a encontra, e distinguir
 *    "não existe" de "existe na outra casa" contaria informação);
 *  • vencida (24 h) ou revogada → **410 Gone**, com a instrução de exportar de novo.
 *
 *  O arquivo sai com marca d'água (autor, instituição, filtros, instante e validade
 *  em cada linha) e o download entra na trilha da instituição com o número de linhas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantSlug: string; exportId: string }> },
): Promise<Response> {
  const { tenantSlug, exportId } = await context.params;

  /**
   * `exportId` é o caminho do recurso: formato inválido responde 404 antes de
   * qualquer leitura. Sem isto, `getDataExport` estourava no Prisma e a rota
   * devolvia 500 sem corpo (o pior contrato possível para quem baixa arquivo).
   */
  if (!isUuid(exportId)) {
    return tenantApiError(404, 'NOT_FOUND', 'Exportação não encontrada.');
  }

  /** Primeiro achamos o PEDIDO: é ele que diz o tipo, e o tipo decide a permissão. */
  const tenant = await resolveTenantId(tenantSlug);

  if (!tenant) {
    return tenantApiError(404, 'NOT_FOUND', 'Instituição não encontrada.');
  }

  const record = await getDataExport({ tenantId: tenant, exportId });

  if (!record) {
    return tenantApiError(404, 'NOT_FOUND', 'Exportação não encontrada.');
  }

  const sponsorId =
    record.kind === 'SPONSOR_CONTACTS_CSV'
      ? await readSponsorIdFromFilters(tenant, exportId)
      : undefined;

  const access = await authorizeDataExport({ tenantSlug, kind: record.kind, sponsorId });

  if (!access.ok) {
    /**
     * `access.status` é `number` no serviço, mas a rota só produz quatro respostas
     * possíveis — o estreitamento aqui impede um status inválido de virar "erro com
     * corpo de sucesso".
     */
    const status = access.status === 401 ? 401 : access.status === 403 ? 403 : access.status === 404 ? 404 : 400;

    return tenantApiError(status, access.code, access.message);
  }

  if (access.tenantId !== tenant) {
    return tenantApiError(404, 'NOT_FOUND', 'Exportação não encontrada.');
  }

  const requestHeaders = await headers();

  const file = await buildDataExportFile({
    tenantId: access.tenantId,
    exportId,
    tenantSlug,
    actorId: access.userId,
    ipAddress: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: requestHeaders.get('user-agent'),
  });

  if (!file.ok) {
    const status = file.code === 'NOT_FOUND' ? 404 : file.code === 'INTERNAL' ? 500 : 410;

    return tenantApiError(status, file.code, file.message);
  }

  return new Response(file.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'cache-control': 'no-store',
      /** O prazo também vai no cabeçalho: quem automatiza não precisa abrir o arquivo. */
      'x-exportacao-validade': file.expiresAt.toISOString(),
      'x-exportacao-horas': String(EXPORT_TTL_HOURS),
      'x-exportacao-linhas': String(file.rowCount),
    },
  });
}

async function resolveTenantId(tenantSlug: string): Promise<string | null> {
  const { adminPrisma } = await import('@/lib/db/admin-client');

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  return tenant?.id ?? null;
}

/** O `sponsorId` vive nos filtros gravados no PEDIDO — é de lá que a permissão sai. */
async function readSponsorIdFromFilters(tenantId: string, exportId: string): Promise<string | null> {
  const { withTenant } = await import('@/lib/db/tenant-client');

  const row = await withTenant(tenantId, (tx) =>
    tx.dataExport.findFirst({
      where: { id: exportId, tenantId },
      select: { filters: true },
    }),
  );

  const filters = (row?.filters ?? {}) as Record<string, unknown>;
  return typeof filters.sponsorId === 'string' ? filters.sponsorId : null;
}

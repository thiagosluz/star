import { PERMISSIONS } from '@/domain/rbac/permissions';
import { isUuid } from '@/domain/validation/id-rules';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { guardAction } from '@/lib/auth/guard-action';
import { exportEventFinanceCsv } from '@/lib/finance/event-finance-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EXPORTAÇÃO FINANCEIRA E PRESTAÇÃO DE CONTAS (FASE 122)
 *  `GET /api/t/<tenantSlug>/financeiro/exportar?eventId=<uuid>&formato=lancamentos|prestacao`
 *
 *  Fica no namespace `/financeiro/exportar` (e não sob `/eventos/[eventId]`) porque
 *  `/api/t/[tenantSlug]/eventos/[eventSlug]` já ocupa o segmento dinâmico no Next.js.
 *  Valida `eventId` via `isUuid` + `tenantApiError` (catraca F76) e registra `EXPORT`
 *  na trilha de auditoria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  const { tenantSlug } = await context.params;
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId') ?? '';

  if (eventId.length === 0) {
    return tenantApiError(400, 'INVALID_INPUT', 'Informe o evento para exportar o relatório financeiro.');
  }

  if (!isUuid(eventId)) {
    return tenantApiError(
      400,
      'INVALID_INPUT',
      'O evento informado para exportação financeira não é um identificador válido.',
    );
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });

  if (!auth.ok) {
    return tenantApiError(
      403,
      auth.state.code ?? 'FORBIDDEN',
      auth.state.message ?? 'Permissão negada para exportar dados financeiros.',
    );
  }

  const rawFormat = url.searchParams.get('formato');
  const format = rawFormat === 'prestacao' ? 'prestacao' : 'lancamentos';

  const exported = await exportEventFinanceCsv({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    format,
    filters: {
      type: url.searchParams.get('tipo'),
      status: url.searchParams.get('situacao'),
      sourceId: url.searchParams.get('fonte'),
      category: url.searchParams.get('categoria'),
      compliance: url.searchParams.get('conformidade'),
      search: url.searchParams.get('busca'),
    },
  });

  if (!exported.ok) {
    return tenantApiError(
      exported.code === 'NOT_FOUND' ? 404 : 400,
      exported.code,
      exported.message,
    );
  }

  return new Response(exported.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${exported.filename}"`,
      'cache-control': 'no-store',
    },
  });
}

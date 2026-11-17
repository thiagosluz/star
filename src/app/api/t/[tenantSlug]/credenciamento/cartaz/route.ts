import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { isUuid } from '@/domain/validation/id-rules';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { getTenantContext } from '@/lib/events/event-repository';
import {
  renderSelfCheckinPosterPdf,
  selfCheckinQrPng,
  selfCheckinQrSvg,
  selfCheckinUrl,
} from '@/lib/events/self-checkin-poster';
import { getSelfCheckinPointPresentation } from '@/lib/events/self-checkin-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CARTAZ DE AUTOCREDENCIAMENTO / AUTOCHECK-IN (FASE 113)
 *  `GET /api/t/<slug>/credenciamento/cartaz?pointId=<uuid>[&formato=pdf|svg|png][&incluirPin=1]`
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  const { tenantSlug } = await context.params;
  const url = new URL(request.url);
  const pointId = url.searchParams.get('pointId') ?? '';
  const formato = (url.searchParams.get('formato') ?? 'pdf').toLowerCase();
  const includePin = url.searchParams.get('incluirPin') === '1';

  if (pointId.length === 0) {
    return tenantApiError(400, 'INVALID_INPUT', 'Informe o ponto do cartaz (?pointId=).');
  }

  if (!isUuid(pointId)) {
    return tenantApiError(400, 'INVALID_INPUT', 'Identificador do ponto inválido.');
  }

  if (formato !== 'pdf' && formato !== 'svg' && formato !== 'png') {
    return tenantApiError(400, 'INVALID_INPUT', 'Formato inválido. Use "pdf", "svg" ou "png".');
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return tenantApiError(401, 'UNAUTHENTICATED', 'Não autenticado.');
  }

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return tenantApiError(404, 'NOT_FOUND', 'Instituição não encontrada.');
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.tenantId, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return tenantApiError(403, 'FORBIDDEN', 'Sem vínculo ativo com esta instituição.');
  }

  const presentation = await getSelfCheckinPointPresentation({
    tenantId: tenant.tenantId,
    pointId,
  });

  if (!presentation) {
    return tenantApiError(404, 'NOT_FOUND', 'Ponto de autocredenciamento não encontrado.');
  }

  const principal = await loadPrincipal(user.id, tenant.tenantId, membership.status);
  const allowed =
    can(principal, PERMISSIONS.REGISTRATION_CHECKIN, { scope: 'TENANT' }) ||
    can(principal, PERMISSIONS.REGISTRATION_CHECKIN, {
      scope: 'EVENT',
      eventId: presentation.eventId,
    });

  if (!allowed) {
    return tenantApiError(403, 'FORBIDDEN', 'Permissão negada para imprimir o cartaz.');
  }

  const targetUrl = selfCheckinUrl(tenantSlug, presentation.token);
  const baseFile = `cartaz-${presentation.token.toLowerCase()}`;

  if (formato === 'svg') {
    const svg = await selfCheckinQrSvg(targetUrl);
    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'content-disposition': `inline; filename="${baseFile}.svg"`,
        'cache-control': 'no-store',
      },
    });
  }

  if (formato === 'png') {
    const png = await selfCheckinQrPng(targetUrl);
    return new Response(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'content-disposition': `inline; filename="${baseFile}.png"`,
        'cache-control': 'no-store',
      },
    });
  }

  const pdf = renderSelfCheckinPosterPdf(presentation, { includePin });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${baseFile}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}

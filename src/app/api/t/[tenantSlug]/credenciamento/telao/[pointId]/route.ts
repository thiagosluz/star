import { NextResponse } from 'next/server';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { isUuid } from '@/domain/validation/id-rules';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { getTenantContext } from '@/lib/events/event-repository';
import { getSelfCheckinPointPresentation } from '@/lib/events/self-checkin-service';

export const dynamic = 'force-dynamic';

/**
 * Estado ao vivo do Modo Telão (FASE 113) — atualiza o TOTP de 60 segundos sem recarregar a página.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantSlug: string; pointId: string }> },
): Promise<Response> {
  const { tenantSlug, pointId } = await context.params;

  if (!isUuid(pointId)) {
    return tenantApiError(404, 'NOT_FOUND', 'Ponto não encontrado.');
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
    return tenantApiError(403, 'FORBIDDEN', 'Sem vínculo ativo com a instituição.');
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
    return tenantApiError(403, 'FORBIDDEN', 'Permissão negada.');
  }

  return NextResponse.json(
    {
      ok: true,
      pointId: presentation.pointId,
      token: presentation.token,
      isActive: presentation.isActive,
      revokedAt: presentation.revokedAt?.toISOString() ?? null,
      pinRequired: presentation.pinRequired,
      pinCode: presentation.pinCode,
      totpEnabled: presentation.totpEnabled,
      totpWindow: presentation.totpWindow,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

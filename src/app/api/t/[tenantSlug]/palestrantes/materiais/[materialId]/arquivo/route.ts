import { NextResponse } from 'next/server';

import { getTenantContext } from '@/lib/events/event-repository';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { resolveMaterialDownload, resolveMaterialViewer } from '@/lib/speakers/material-service';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { isUuid } from '@/domain/validation/id-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Download de material de palestrante (FASE 25, item E20)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AQUI "403 FORBIDDEN" É LITERAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O bucket de materiais é privado. Esta rota recebe o pedido, decide o acesso com o
 *  visitante REAL e só então assina uma URL de poucos minutos — ou recusa, com o
 *  status certo:
 *
 *    401  entre para acessar        (material de inscritos, visitante anônimo)
 *    403  não é para você           (autenticado que não é inscrito, nem ministrante)
 *    404  não existe               (id inexistente — e o rascunho de outro palestrante,
 *                                   que não é informação de quem não organiza)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A INSTITUIÇÃO VEM NO CAMINHO (`/api/t/<slug>/...`)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O id do material é único no banco, mas a decisão precisa rodar SOB RLS, com o
 *  contexto da instituição. Procurar o material "no escuro" com a conexão
 *  administrativa criaria um segundo caminho de leitura fora da policy — e é
 *  exatamente o que a FASE 9 isolou em `src/lib/platform/**`.
 *
 *  Com o slug no caminho, a resolução é a MESMA de toda página pública (uma consulta
 *  de slug → id, que é o caso documentado de conexão admin), e daí em diante tudo
 *  acontece dentro de `withTenant`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantSlug: string; materialId: string }> },
): Promise<NextResponse> {
  const { tenantSlug, materialId } = await context.params;

  /**
   * ─── O ID MALFORMADO NÃO É "PROIBIDO", É INEXISTENTE (FASE 76) ──────────────
   * Antes, com um visitante autenticado, a consulta por `materialId` estourava no
   * Prisma e a rota respondia 500 sem corpo; anônimo caía no `catch` do serviço e
   * recebia 403 com `code: "INTERNAL"` — dizer "proibido" sobre um id que nem tem
   * forma de id. O formato é conferido ANTES de qualquer decisão de acesso, e a
   * resposta é a mesma de um material inexistente: 404 com o envelope.
   */
  if (!isUuid(materialId)) {
    return tenantApiError(404, 'NOT_FOUND', 'Material não encontrado.');
  }

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return tenantApiError(404, 'NOT_FOUND', 'Instituição não encontrada.');
  }

  /**
   * O vínculo é checado com o dado do banco: sem vínculo ativo, o visitante é tratado
   * como ANÔNIMO (401 no material de inscritos) — e não como membro sem permissão.
   */
  const user = await getAuthenticatedUser();

  let isOrganizer = false;

  if (user) {
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId: tenant.tenantId, userId: user.id, deletedAt: null },
      select: { status: true },
    });

    if (membership?.status === 'ACTIVE') {
      const principal = await loadPrincipal(user.id, tenant.tenantId, 'ACTIVE');
      isOrganizer = can(principal, PERMISSIONS.SPEAKER_MANAGE, { scope: 'TENANT' });
    }
  }

  const viewer = await resolveMaterialViewer({
    tenantId: tenant.tenantId,
    materialId,
    userId: user?.id ?? null,
    isOrganizer,
  });

  const result = await resolveMaterialDownload({
    tenantId: tenant.tenantId,
    materialId,
    viewer,
  });

  if (!result.ok) {
    return tenantApiError(result.httpStatus, result.code, result.message, {
      'x-robots-tag': 'noindex, nofollow',
    });
  }

  /**
   * `redirect: 'manual'` mantém o redirecionamento no cliente: o arquivo sai direto
   * do storage, sem passar pelo processo Node.
   *
   * Link externo também é redirecionado — a decisão de acesso vale para ele do mesmo
   * jeito, e mandar o endereço em JSON deixaria o visitante sem o arquivo.
   */
  return NextResponse.redirect(result.url, 302);
}

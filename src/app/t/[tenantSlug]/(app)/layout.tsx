import { redirect } from 'next/navigation';

import { getRequestContext, loadPrincipal } from '@/lib/auth/session';
import { lookupTenant } from '@/lib/tenancy/tenant-resolver';
import { isValidSlug, tenantPath } from '@/domain/tenancy/resolution';
import { TenantHeader } from '@/components/tenancy/tenant-header';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Layout de instituição — `/t/[tenantSlug]/*`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE É O PONTO DE AUTORIZAÇÃO REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O Proxy apenas reescreve a URL e injeta headers; ele NÃO autoriza. Toda a
 *  decisão de acesso acontece aqui e nas Server Actions, perto do dado — que é
 *  exatamente o que a documentação do Next.js recomenda ("optimistic checks with
 *  Proxy", nunca autorização).
 *
 *  Verificações feitas, em ordem:
 *    1. A instituição existe e está ATIVA?
 *    2. Existe sessão autenticada?
 *    3. O usuário tem vínculo ATIVO com esta instituição?
 *    4. O contexto ativo corresponde ao slug da URL?
 *    5. O `Principal` é carregado sob RLS para uso nas páginas filhas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  if (!isValidSlug(tenantSlug)) {
    redirect('/404-tenant');
  }

  // ── 1. A instituição existe e está operacional? ────────────────────────────
  const lookup = await lookupTenant({
    kind: 'resolved',
    source: 'path',
    identifier: tenantSlug,
    isCustomDomain: false,
  });

  if (lookup.kind !== 'ok') {
    redirect('/404-tenant');
  }
  const tenant = lookup.tenant;

  // ── 2. Sessão autenticada ──────────────────────────────────────────────────
  const context = await getRequestContext();
  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(tenantPath(tenantSlug, '/dashboard'))}`,
    );
  }

  // ── 3. Vínculo ativo com ESTA instituição ──────────────────────────────────
  const membership = context.memberships.find(
    (m) => m.tenantSlug === tenantSlug && m.status === 'ACTIVE',
  );

  if (!membership) {
    redirect('/selecionar-instituicao');
  }

  // ── 4. Contexto ativo precisa bater com a URL ──────────────────────────────
  // Garante que a RLS use o tenant correto nas consultas das páginas filhas.
  if (context.activeTenant?.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  // ── 5. Principal RBAC sob RLS ──────────────────────────────────────────────
  const principal = await loadPrincipal(
    context.user.id,
    tenant.id,
    membership.status,
  );

  return (
    <div className="flex min-h-screen flex-col">
      <TenantHeader
        tenant={{
          slug: tenant.slug,
          name: tenant.name,
          logoUrl: tenant.logoUrl,
          plan: tenant.plan,
        }}
        user={{ name: context.user.name, email: context.user.email }}
        roles={membership.roles}
        memberships={context.memberships}
        principal={principal}
      />
      <div className="flex-1">{children}</div>
    </div>
  );
}

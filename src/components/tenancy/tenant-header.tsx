import Link from 'next/link';
import { Building2, LogOut } from 'lucide-react';

import { signOutAction } from '@/app/actions/auth-actions';
import { TenantMenu, type MembershipSummary } from '@/components/tenancy/tenant-menu';
import { can } from '@/domain/rbac/authorization';
import type { Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';

interface NavItem {
  href: string;
  label: string;
  /** Permissão exigida. Ausente = visível para qualquer membro ativo. */
  permission?: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Painel' },
  { href: '/eventos', label: 'Eventos', permission: PERMISSIONS.EVENT_READ },
  {
    href: '/minhas-inscricoes',
    label: 'Minhas inscrições',
    permission: PERMISSIONS.REGISTRATION_READ_OWN,
  },
  {
    href: '/submissoes',
    label: 'Submissões',
    permission: PERMISSIONS.SUBMISSION_READ_OWN,
  },
  {
    /**
     * Console do comitê científico (FASE 4).
     *
     * Gated por `submission:read:any` — a mesma permissão que a página exige.
     * Menu e página concordam de propósito: divergir aqui produziria ou um link
     * que leva a um redirecionamento, ou uma tela inalcançável.
     */
    href: '/comite',
    label: 'Comitê',
    permission: PERMISSIONS.SUBMISSION_READ_ANY,
  },
  {
    href: '/revisoes',
    label: 'Revisões',
    permission: PERMISSIONS.REVIEW_SUBMIT_OWN,
  },
  {
    href: '/certificados',
    label: 'Certificados',
    permission: PERMISSIONS.CERTIFICATE_READ_OWN,
  },
  {
    href: '/credenciamento',
    label: 'Credenciamento',
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
  },
  {
    href: '/administracao',
    label: 'Administração',
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  },
];

/**
 * Cabeçalho da instituição.
 *
 * A navegação é FILTRADA por permissão no servidor. Esse filtro é de UX, não de
 * segurança: esconder um link não impede o acesso à URL. A barreira real é a
 * checagem em cada página e Server Action (defesa em profundidade).
 */
export function TenantHeader({
  tenant,
  user,
  roles,
  memberships,
  principal,
}: {
  tenant: { slug: string; name: string; logoUrl: string | null; plan: string };
  user: { name: string; email: string };
  roles: readonly string[];
  memberships: readonly MembershipSummary[];
  principal: Principal;
}) {
  const visibleItems = NAV_ITEMS.filter((item) =>
    item.permission
      ? can(principal, item.permission, { scope: 'TENANT' })
      : true,
  );

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt="" className="size-full object-cover" />
            ) : (
              <Building2 className="size-4 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="min-w-0" data-testid="active-tenant">
            <p className="truncate text-sm font-semibold">{tenant.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {roles.length > 0 ? roles.join(' · ') : 'Sem papel'} · {tenant.plan}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <TenantMenu memberships={memberships} currentSlug={tenant.slug}>
            <span className="max-w-40 truncate text-xs text-muted-foreground">
              {user.name}
            </span>
          </TenantMenu>

          <form action={signOutAction}>
            <button
              type="submit"
              title="Sair da conta"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sair
            </button>
          </form>
        </div>
      </div>

      <nav className="mx-auto max-w-6xl px-6">
        <ul className="flex gap-1 overflow-x-auto">
          {visibleItems.map((item) => (
            <li key={item.href}>
              <Link
                href={tenantPath(tenant.slug, item.href)}
                className="inline-block whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground transition hover:border-primary hover:text-foreground"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

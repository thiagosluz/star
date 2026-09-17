import Link from 'next/link';
import { Building2, Search } from 'lucide-react';

import { ProvisionTenantForm } from '@/components/platform/platform-forms';
import { requirePlatformPermission } from '@/lib/platform/guard';
import { getTenantSummaries } from '@/lib/platform/tenant-service';
import { TENANT_STATUSES, TENANT_STATUS_LABELS, type TenantStatus } from '@/domain/platform/platform-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INSTITUIÇÕES — listagem e provisionamento
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O FILTRO VEM DA URL, E ISSO É DELIBERADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `?estado=SUSPENDED&q=ufba` é um endereço compartilhável: "olha as suspensas" é
 *  uma conversa que acontece no suporte, e o link precisa reproduzir exatamente a
 *  mesma tela para a outra pessoa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LISTA MOSTRA O QUE DECIDE A PRÓXIMA AÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Estado, plano, volume (eventos, membros, certificados) e último movimento. Não
 *  há e-mail de participante, não há nome de pessoa: o painel decide sobre a
 *  INSTITUIÇÃO, e a pessoa responsável por ela é o que se busca quando é preciso
 *  agir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const STATUS_CLASS: Record<TenantStatus, string> = {
  PENDING: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
  ACTIVE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  SUSPENDED: 'border-destructive/40 bg-destructive/10 text-destructive',
  ARCHIVED: 'border-border bg-muted text-muted-foreground',
};

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string }>;
}) {
  await requirePlatformPermission();

  const { estado, q } = await searchParams;
  const query = (q ?? '').trim();
  const statusFilter = (TENANT_STATUSES as readonly string[]).includes(estado ?? '')
    ? (estado as TenantStatus)
    : 'ALL';

  const { tenants, metrics } = await getTenantSummaries({ status: statusFilter, query });

  const filters: { value: TenantStatus | 'ALL'; label: string }[] = [
    { value: 'ALL', label: 'Todas' },
    ...TENANT_STATUSES.map((status) => ({ value: status, label: TENANT_STATUS_LABELS[status] })),
  ];

  return (
    <div className="space-y-8" data-testid="platform-tenants">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Instituições</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {metrics.tenants.total} no total · {metrics.tenants.active} ativas ·{' '}
            {metrics.tenants.suspended} suspensas
          </p>
        </div>
      </header>

      <ProvisionTenantForm />

      <section className="rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-center gap-3 border-b border-border p-5">
          <form method="get" action="/superadmin/tenants" className="flex flex-1 flex-wrap gap-2" role="search">
            <input type="hidden" name="estado" value={statusFilter === 'ALL' ? '' : statusFilter} />
            <div className="relative min-w-[14rem] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Buscar por nome ou slug"
                data-testid="tenant-search"
                className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <button
              type="submit"
              data-testid="tenant-search-submit"
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Buscar
            </button>
          </form>

          <nav className="flex flex-wrap gap-1" aria-label="Filtrar por estado">
            {filters.map((filter) => {
              const active = statusFilter === filter.value;
              const href =
                filter.value === 'ALL'
                  ? `/superadmin/tenants${query ? `?q=${encodeURIComponent(query)}` : ''}`
                  : `/superadmin/tenants?estado=${filter.value}${query ? `&q=${encodeURIComponent(query)}` : ''}`;

              return (
                <Link
                  key={filter.value}
                  href={href}
                  data-testid={`tenant-filter-${filter.value}`}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md border px-3 py-1.5 text-xs ${
                    active ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {filter.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {tenants.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground" data-testid="tenants-empty">
            Nenhuma instituição encontrada com estes critérios.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Instituição</th>
                  <th className="px-3 py-3 font-medium">Estado</th>
                  <th className="px-3 py-3 font-medium">Plano</th>
                  <th className="px-3 py-3 text-right font-medium">Eventos</th>
                  <th className="px-3 py-3 text-right font-medium">Membros</th>
                  <th className="px-3 py-3 text-right font-medium">Certificados</th>
                  <th className="px-5 py-3 font-medium">Último movimento</th>
                </tr>
              </thead>
              <tbody data-testid="tenants-table">
                {tenants.map((tenant) => (
                  <tr
                    key={tenant.id}
                    data-testid="tenant-row"
                    data-tenant-slug={tenant.slug}
                    data-tenant-status={tenant.status}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/superadmin/tenants/${tenant.id}`}
                        data-testid={`tenant-open-${tenant.slug}`}
                        className="flex items-center gap-3"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Building2 className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{tenant.name}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">
                            /{tenant.slug}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${STATUS_CLASS[tenant.status]}`}
                      >
                        {TENANT_STATUS_LABELS[tenant.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{tenant.plan}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{tenant.eventCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{tenant.memberCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{tenant.certificateCount}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {tenant.lastActivityAt
                        ? tenant.lastActivityAt.toISOString().slice(0, 10)
                        : 'sem presenças'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

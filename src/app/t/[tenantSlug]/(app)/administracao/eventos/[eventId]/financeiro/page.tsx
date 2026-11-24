import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Landmark, Plus } from 'lucide-react';

import { FinanceChartsPanel } from '@/components/finance/finance-charts-panel';
import { FinanceKpiCards } from '@/components/finance/finance-kpi-cards';
import { FinanceLedgerFilters } from '@/components/finance/finance-ledger-filters';
import { FinancialEntriesLedger } from '@/components/finance/financial-entries-ledger';
import { FundingSourcesPanel } from '@/components/finance/funding-sources-panel';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { PageHeader } from '@/components/ui';
import {
  buildEventFinanceHref,
  FINANCE_TAB_LABELS,
  FINANCE_TABS,
  parseFinancePage,
  resolveFinanceTab,
} from '@/domain/finance/event-finance-rules';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { requirePagePermission } from '@/lib/auth/guard-page';
import {
  loadEventFinanceDashboard,
  type FinanceLedgerFilters as FinanceFiltersInput,
} from '@/lib/finance/event-finance-service';
import { requireUuidParam } from '@/lib/validation/id';

export const metadata = { title: 'Finanças e fomento do evento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GESTÃO FINANCEIRA, FOMENTO E PRESTAÇÃO DE CONTAS DO EVENTO (FASE 122 · F124)
 *
 *  Separa os 3 modos mentais em abas reais por URL (`?aba=resumo|lancamentos|fontes`)
 *  e move os formulários densos para rotas dedicadas (`/lancamentos/novo`,
 *  `/lancamentos/[entryId]/editar`, `/fontes/nova`, `/fontes/[sourceId]/editar`),
 *  mantendo a faixa executiva fixa no topo com zero JS de formulário nas abas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventFinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{
    aba?: string;
    tipo?: string;
    situacao?: string;
    fonte?: string;
    categoria?: string;
    conformidade?: string;
    busca?: string;
    pagina?: string;
  }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;
  const { aba, tipo, situacao, fonte, categoria, conformidade, busca, pagina } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const filters: FinanceFiltersInput = {
    type: tipo ?? null,
    status: situacao ?? null,
    sourceId: fonte ?? null,
    category: categoria ?? null,
    compliance: conformidade ?? null,
    search: busca ?? null,
  };

  const hasLedgerFilter = Boolean(
    filters.type ||
      filters.status ||
      filters.sourceId ||
      filters.category ||
      filters.compliance ||
      filters.search ||
      pagina,
  );
  const activeTab = resolveFinanceTab(aba, hasLedgerFilter);
  const currentPage = parseFinancePage(pagina);

  const loaded = await loadEventFinanceDashboard({
    tenantId,
    eventId,
    filters,
  });

  if (!loaded.ok) notFound();

  const { dashboard } = loaded;
  const financePath = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);

  const tabCount = (tab: (typeof FINANCE_TABS)[number]) => {
    if (tab === 'lancamentos') return dashboard.allEntries.length;
    if (tab === 'fontes') return dashboard.sources.length;
    return null;
  };

  return (
    <main className="space-y-6">
      <PageHeader
        title="Finanças e fomento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Landmark className="size-5" aria-hidden />}
        description={`${dashboard.event.title} · fontes de recurso (editais, fundação, instituição e patrocínio), entradas, saídas e prestação de contas.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          {
            label: dashboard.event.title,
            href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`),
          },
          { label: 'Finanças e fomento' },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`${financePath}/fontes/nova`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              data-testid="finance-header-new-source"
            >
              <Plus className="size-3.5" aria-hidden />
              Nova fonte
            </Link>
            <Link
              href={`${financePath}/lancamentos/novo`}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-95"
              data-testid="finance-header-new-entry"
            >
              <Plus className="size-3.5" aria-hidden />
              Novo lançamento
            </Link>
          </div>
        }
      />

      <FinanceKpiCards
        tenantSlug={tenantSlug}
        eventId={eventId}
        sourcesCount={dashboard.sources.length}
        summary={dashboard.summary}
        filters={filters}
        compact={activeTab !== 'resumo'}
        baseHref={financePath}
      />

      <nav
        aria-label="Seções do módulo financeiro"
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        data-testid="finance-tabs"
      >
        {FINANCE_TABS.map((tab) => {
          const isCurrent = tab === activeTab;
          const count = tabCount(tab);
          return (
            <Link
              key={tab}
              href={buildEventFinanceHref(financePath, { aba: tab })}
              aria-current={isCurrent ? 'page' : undefined}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                isCurrent
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card text-foreground hover:bg-accent'
              }`}
              data-testid={`finance-tab-${tab}`}
            >
              {FINANCE_TAB_LABELS[tab]}
              {count !== null ? ` (${count})` : ''}
            </Link>
          );
        })}
      </nav>

      {activeTab === 'resumo' ? (
        <FinanceChartsPanel summary={dashboard.summary} baseHref={financePath} />
      ) : null}

      {activeTab === 'lancamentos' ? (
        <div className="space-y-4">
          <FinanceLedgerFilters
            tenantSlug={tenantSlug}
            eventId={eventId}
            financePath={financePath}
            sources={dashboard.sources}
            filters={filters}
          />
          <FinancialEntriesLedger
            tenantSlug={tenantSlug}
            eventId={eventId}
            entries={dashboard.filteredEntries}
            sources={dashboard.sources}
            page={currentPage}
            baseHref={financePath}
            filters={filters}
          />
        </div>
      ) : null}

      {activeTab === 'fontes' ? (
        <FundingSourcesPanel
          tenantSlug={tenantSlug}
          eventId={eventId}
          summary={dashboard.summary}
          baseHref={financePath}
        />
      ) : null}
    </main>
  );
}

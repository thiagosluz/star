import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Landmark, Search } from 'lucide-react';

import { FinanceChartsPanel } from '@/components/finance/finance-charts-panel';
import { FinanceKpiCards } from '@/components/finance/finance-kpi-cards';
import { FinancialEntriesLedger } from '@/components/finance/financial-entries-ledger';
import { FinancialEntryCreateForm } from '@/components/finance/financial-entry-create-form';
import { FundingSourcesPanel } from '@/components/finance/funding-sources-panel';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { GetSearchForm, PageHeader } from '@/components/ui';
import {
  FINANCIAL_CATEGORIES,
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_ENTRY_STATUS_LABELS,
  FINANCIAL_ENTRY_STATUSES,
  FINANCIAL_ENTRY_TYPE_LABELS,
  FINANCIAL_ENTRY_TYPES,
} from '@/domain/finance/event-finance-rules';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { requirePagePermission } from '@/lib/auth/guard-page';
import {
  loadEventFinanceDashboard,
  type FinanceLedgerFilters,
} from '@/lib/finance/event-finance-service';
import { requireUuidParam } from '@/lib/validation/id';

export const metadata = { title: 'Finanças e fomento do evento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GESTÃO FINANCEIRA, FOMENTO E PRESTAÇÃO DE CONTAS DO EVENTO (FASE 122)
 *
 *  Consolida fontes de recurso (editais FAPEG/CNPq/CAPES, FUNAPE, UF/IF e
 *  patrocínio privado), entradas e saídas por rubrica, gráficos vetoriais SSR e
 *  exportação auditada em CSV para prestação de contas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventFinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{
    tipo?: string;
    situacao?: string;
    fonte?: string;
    categoria?: string;
    busca?: string;
  }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;
  const { tipo, situacao, fonte, categoria, busca } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const filters: FinanceLedgerFilters = {
    type: tipo ?? null,
    status: situacao ?? null,
    sourceId: fonte ?? null,
    category: categoria ?? null,
    search: busca ?? null,
  };

  const loaded = await loadEventFinanceDashboard({
    tenantId,
    eventId,
    filters,
  });

  if (!loaded.ok) notFound();

  const { dashboard } = loaded;
  const financePath = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);
  const defaultDate = new Date().toISOString().slice(0, 10);

  return (
    <main className="space-y-8">
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
      />

      <FinanceKpiCards
        tenantSlug={tenantSlug}
        eventId={eventId}
        sourcesCount={dashboard.sources.length}
        summary={dashboard.summary}
        filters={filters}
      />

      <FinanceChartsPanel summary={dashboard.summary} />

      <FundingSourcesPanel
        tenantSlug={tenantSlug}
        eventId={eventId}
        summary={dashboard.summary}
      />

      <FinancialEntryCreateForm
        tenantSlug={tenantSlug}
        eventId={eventId}
        sources={dashboard.sources}
        defaultDate={defaultDate}
      />

      <GetSearchForm
        action={financePath}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="finance-filters"
      >
        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Buscar</span>
          <input
            type="search"
            name="busca"
            defaultValue={busca ?? ''}
            placeholder="descrição, favorecido, NF ou CNPJ"
            className="w-56 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            data-testid="finance-filter-search"
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Tipo</span>
          <select
            name="tipo"
            defaultValue={tipo ?? ''}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            data-testid="finance-filter-type"
          >
            <option value="">todos</option>
            {FINANCIAL_ENTRY_TYPES.map((item) => (
              <option key={item} value={item}>
                {FINANCIAL_ENTRY_TYPE_LABELS[item]}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Situação</span>
          <select
            name="situacao"
            defaultValue={situacao ?? ''}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            data-testid="finance-filter-status"
          >
            <option value="">todas</option>
            {FINANCIAL_ENTRY_STATUSES.map((item) => (
              <option key={item} value={item}>
                {FINANCIAL_ENTRY_STATUS_LABELS[item]}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Fonte</span>
          <select
            name="fonte"
            defaultValue={fonte ?? ''}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            data-testid="finance-filter-source"
          >
            <option value="">todas</option>
            <option value="__NONE__">sem fonte vinculada</option>
            {dashboard.sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Rubrica</span>
          <select
            name="categoria"
            defaultValue={categoria ?? ''}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            data-testid="finance-filter-category"
          >
            <option value="">todas</option>
            {FINANCIAL_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {FINANCIAL_CATEGORY_LABELS[item]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          data-testid="finance-filter-submit"
        >
          <Search className="mr-1 inline size-3.5" aria-hidden />
          Filtrar
        </button>

        <Link
          href={financePath}
          className="text-xs text-muted-foreground underline"
          data-testid="finance-filter-clear"
        >
          limpar
        </Link>
      </GetSearchForm>

      <FinancialEntriesLedger
        tenantSlug={tenantSlug}
        eventId={eventId}
        entries={dashboard.filteredEntries}
        sources={dashboard.sources}
      />

      <p className="text-xs text-muted-foreground">
        <Link
          href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
          className="underline"
        >
          Voltar ao painel do evento
        </Link>
      </p>
    </main>
  );
}

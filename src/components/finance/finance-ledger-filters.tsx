import Link from 'next/link';
import { Download, Search } from 'lucide-react';

import { buildFinanceExportHref } from '@/components/finance/finance-kpi-cards';
import { GetSearchForm } from '@/components/ui';
import {
  FINANCE_COMPLIANCE_FILTER_LABELS,
  FINANCE_COMPLIANCE_FILTERS,
  FINANCIAL_CATEGORIES,
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_ENTRY_STATUS_LABELS,
  FINANCIAL_ENTRY_STATUSES,
  FINANCIAL_ENTRY_TYPE_LABELS,
  FINANCIAL_ENTRY_TYPES,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';
import type { FinanceLedgerFilters } from '@/lib/finance/event-finance-service';

interface FinanceLedgerFiltersProps {
  tenantSlug: string;
  eventId: string;
  financePath: string;
  sources: readonly FundingSourceRuleInput[];
  filters: FinanceLedgerFilters;
}

const FIELD = 'rounded-md border border-border bg-background px-2.5 py-1.5 text-sm';

/**
 * A exportação mora COLADA ao filtro: o recorte que a pessoa acabou de montar é
 * exatamente o que o CSV leva (causa e efeito a um olhar de distância).
 */
export function FinanceLedgerFilters({
  tenantSlug,
  eventId,
  financePath,
  sources,
  filters,
}: FinanceLedgerFiltersProps) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <GetSearchForm
        action={financePath}
        className="flex flex-wrap items-end gap-2"
        data-testid="finance-filters"
      >
        <input type="hidden" name="aba" value="lancamentos" />

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Buscar</span>
          <input type="search" name="busca" defaultValue={filters.search ?? ''} placeholder="descrição, favorecido, NF ou CNPJ" className={`w-56 ${FIELD}`} data-testid="finance-filter-search" />
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Pendência</span>
          <select name="conformidade" defaultValue={filters.compliance ?? ''} className={FIELD} data-testid="finance-filter-compliance">
            <option value="">nenhuma</option>
            {FINANCE_COMPLIANCE_FILTERS.map((item) => (
              <option key={item} value={item}>{FINANCE_COMPLIANCE_FILTER_LABELS[item]}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Tipo</span>
          <select name="tipo" defaultValue={filters.type ?? ''} className={FIELD} data-testid="finance-filter-type">
            <option value="">todos</option>
            {FINANCIAL_ENTRY_TYPES.map((item) => (
              <option key={item} value={item}>{FINANCIAL_ENTRY_TYPE_LABELS[item]}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Situação</span>
          <select name="situacao" defaultValue={filters.status ?? ''} className={FIELD} data-testid="finance-filter-status">
            <option value="">todas</option>
            {FINANCIAL_ENTRY_STATUSES.map((item) => (
              <option key={item} value={item}>{FINANCIAL_ENTRY_STATUS_LABELS[item]}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Fonte</span>
          <select name="fonte" defaultValue={filters.sourceId ?? ''} className={FIELD} data-testid="finance-filter-source">
            <option value="">todas</option>
            <option value="__NONE__">sem fonte vinculada</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>{source.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Rubrica</span>
          <select name="categoria" defaultValue={filters.category ?? ''} className={FIELD} data-testid="finance-filter-category">
            <option value="">todas</option>
            {FINANCIAL_CATEGORIES.map((item) => (
              <option key={item} value={item}>{FINANCIAL_CATEGORY_LABELS[item]}</option>
            ))}
          </select>
        </label>

        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent" data-testid="finance-filter-submit">
          <Search className="mr-1 inline size-3.5" aria-hidden />
          Filtrar
        </button>

        <Link href={`${financePath}?aba=lancamentos`} className="text-xs text-muted-foreground underline" data-testid="finance-filter-clear">
          limpar
        </Link>
      </GetSearchForm>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground" data-testid="finance-ledger-export-scope">
          Exportar o recorte atual:
        </span>
        <a
          href={buildFinanceExportHref(tenantSlug, eventId, 'lancamentos', filters)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-medium text-foreground hover:bg-accent"
          data-testid="finance-export-entries"
        >
          <Download className="size-3.5" aria-hidden />
          Lançamentos (CSV)
        </a>
      </div>
    </div>
  );
}

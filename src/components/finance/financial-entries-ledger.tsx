import Link from 'next/link';

import { EntryRowActions } from '@/components/finance/financial-entry-row-actions';
import {
  buildEventFinanceHref,
  computeFilteredLedgerTotals,
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_ENTRY_STATUS_LABELS,
  FINANCIAL_ENTRY_TYPE_LABELS,
  formatBrlCents,
  formatIsoDatePtBr,
  isEntryCategoryViolation,
  paginateFinancialEntries,
  type FinancialEntryRuleInput,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import type { FinanceLedgerFilters } from '@/lib/finance/event-finance-service';

interface FinancialEntriesLedgerProps {
  tenantSlug: string;
  eventId: string;
  entries: readonly FinancialEntryRuleInput[];
  sources: readonly FundingSourceRuleInput[];
  page?: number;
  baseHref?: string;
  filters?: FinanceLedgerFilters;
}

export function FinancialEntriesLedger({
  tenantSlug,
  eventId,
  entries,
  sources,
  page = 1,
  baseHref,
  filters = {},
}: FinancialEntriesLedgerProps) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const subtotals = computeFilteredLedgerTotals(entries);
  const pagination = paginateFinancialEntries(entries, page);
  const financeBase =
    baseHref ?? tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);

  const pageHref = (target: number) =>
    buildEventFinanceHref(financeBase, {
      aba: 'lancamentos',
      tipo: filters.type,
      situacao: filters.status,
      fonte: filters.sourceId,
      categoria: filters.category,
      conformidade: filters.compliance,
      busca: filters.search,
      pagina: target,
    });

  if (entries.length === 0) {
    return (
      <section
        className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm"
        data-testid="finance-entries-empty"
      >
        Nenhum lançamento financeiro encontrado para o recorte atual.
      </section>
    );
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="finance-entries-ledger"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Livro-razão de entradas e saídas ({entries.length})
        </h2>

        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-low px-3 py-1.5 text-xs"
          data-testid="finance-ledger-subtotals"
        >
          <span className="text-muted-foreground">
            Entradas no recorte:{' '}
            <strong className="text-success-strong">{formatBrlCents(subtotals.activeIncomeCents)}</strong>
          </span>
          <span className="text-muted-foreground">
            Saídas no recorte:{' '}
            <strong className="text-foreground">{formatBrlCents(subtotals.activeExpenseCents)}</strong>
          </span>
          <span className="text-muted-foreground">
            Saldo do recorte:{' '}
            <strong className={subtotals.netActiveCents < 0 ? 'text-destructive' : 'text-foreground'}>
              {formatBrlCents(subtotals.netActiveCents)}
            </strong>
          </span>
        </div>
      </div>

      <div className="divide-y divide-border">
        {pagination.items.map((entry) => {
          const source = entry.sourceId ? sourceById.get(entry.sourceId) : undefined;
          const isIncome = entry.type === 'INCOME';
          const isCanceled = entry.status === 'CANCELED';

          return (
            <article
              key={entry.id}
              className={`flex flex-wrap items-start justify-between gap-3 py-3.5 text-xs ${
                isCanceled ? 'opacity-70' : ''
              }`}
              data-testid={`finance-entry-row-${entry.id}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-md px-2 py-0.5 font-medium ${
                      isIncome
                        ? 'bg-primary/10 text-primary'
                        : 'border border-border bg-muted text-foreground'
                    }`}
                  >
                    {FINANCIAL_ENTRY_TYPE_LABELS[entry.type]}
                  </span>
                  <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">
                    {FINANCIAL_ENTRY_STATUS_LABELS[entry.status]}
                  </span>
                  <span className="rounded-md border border-border bg-surface-low px-2 py-0.5 text-foreground">
                    {FINANCIAL_CATEGORY_LABELS[entry.category]}
                  </span>
                  {isEntryCategoryViolation(entry, source) ? (
                    <span
                      className="rounded-md border border-warning/40 bg-warning-soft px-2 py-0.5 font-medium text-foreground"
                      data-testid={`finance-entry-glosa-${entry.id}`}
                    >
                      Rubrica fora do edital
                    </span>
                  ) : null}
                  {source ? (
                    <span className="font-medium text-foreground">· Fonte: {source.name}</span>
                  ) : (
                    <span className="text-muted-foreground">· Sem fonte vinculada</span>
                  )}
                </div>

                <p className="text-sm font-medium text-foreground">{entry.title}</p>

                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                  <span>Competência: {formatIsoDatePtBr(entry.occurredOn)}</span>
                  {entry.settledOn ? <span>Liquidação: {formatIsoDatePtBr(entry.settledOn)}</span> : null}
                  {entry.counterpartyName ? <span>Favorecido: {entry.counterpartyName}</span> : null}
                  {entry.counterpartyTaxId ? <span>Doc. fiscal: {entry.counterpartyTaxId}</span> : null}
                  {entry.documentNumber ? <span>Comprovante/NF/NE: {entry.documentNumber}</span> : null}
                </p>

                {entry.notes ? <p className="text-muted-foreground">{entry.notes}</p> : null}
              </div>

              <div className="flex flex-col items-end gap-2">
                <p
                  className={`text-base font-semibold tracking-tight ${
                    isCanceled
                      ? 'line-through text-muted-foreground'
                      : isIncome
                        ? 'text-success-strong'
                        : 'text-foreground'
                  }`}
                  data-testid={`finance-entry-amount-${entry.id}`}
                >
                  {isIncome ? '+' : '-'} {formatBrlCents(entry.amountCents)}
                </p>

                <EntryRowActions
                  tenantSlug={tenantSlug}
                  eventId={eventId}
                  entry={entry}
                  editHref={`${financeBase}/lancamentos/${encodeURIComponent(entry.id)}/editar`}
                />
              </div>
            </article>
          );
        })}
      </div>

      {pagination.totalPages > 1 ? (
        <nav
          className="flex items-center justify-between border-t border-border pt-3 text-xs"
          aria-label="Paginação do livro-razão"
          data-testid="finance-ledger-pagination"
        >
          <span className="text-muted-foreground">
            Página {pagination.currentPage} de {pagination.totalPages} ({pagination.totalItems} lançamentos)
          </span>
          <div className="flex items-center gap-2">
            {pagination.hasPrev ? (
              <Link
                href={pageHref(pagination.currentPage - 1)}
                className="rounded-md border border-border bg-background px-2.5 py-1 hover:bg-accent"
                data-testid="finance-ledger-prev"
              >
                ← Anterior
              </Link>
            ) : null}
            {pagination.hasNext ? (
              <Link
                href={pageHref(pagination.currentPage + 1)}
                className="rounded-md border border-border bg-background px-2.5 py-1 hover:bg-accent"
                data-testid="finance-ledger-next"
              >
                Próxima →
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </section>
  );
}

import {
  deleteFinancialEntryAction,
  updateFinancialEntryStatusAction,
} from '@/app/actions/finance-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_ENTRY_STATUS_LABELS,
  FINANCIAL_ENTRY_TYPE_LABELS,
  formatBrlCents,
  type FinancialEntryRuleInput,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';

interface FinancialEntriesLedgerProps {
  tenantSlug: string;
  eventId: string;
  entries: readonly FinancialEntryRuleInput[];
  sources: readonly FundingSourceRuleInput[];
}

export function FinancialEntriesLedger({
  tenantSlug,
  eventId,
  entries,
  sources,
}: FinancialEntriesLedgerProps) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));

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
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">
          Livro-razão de entradas e saídas ({entries.length})
        </h2>
      </div>

      <div className="divide-y divide-border">
        {entries.map((entry) => {
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
                  {source ? (
                    <span className="font-medium text-foreground">· Fonte: {source.name}</span>
                  ) : (
                    <span className="text-muted-foreground">· Sem fonte vinculada</span>
                  )}
                </div>

                <p className="text-sm font-medium text-foreground">{entry.title}</p>

                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                  <span>Competência: {entry.occurredOn}</span>
                  {entry.settledOn ? <span>Liquidação: {entry.settledOn}</span> : null}
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

                <div className="flex flex-wrap items-center gap-1.5">
                  {entry.status !== 'SETTLED' && entry.status !== 'CANCELED' ? (
                    <InlineActionForm
                      action={updateFinancialEntryStatusAction}
                      submitLabel={isIncome ? 'Confirmar recebimento' : 'Marcar como pago'}
                      testId={`finance-entry-settle-${entry.id}`}
                      variant="primary"
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <input type="hidden" name="status" value="SETTLED" />
                    </InlineActionForm>
                  ) : null}

                  <InlineActionForm
                    action={deleteFinancialEntryAction}
                    submitLabel="Excluir"
                    testId={`finance-entry-delete-${entry.id}`}
                    variant="destructive"
                    confirm={{
                      title: `Excluir o lançamento "${entry.title}"?`,
                      description:
                        'O lançamento será removido permanentemente do livro-razão deste evento e a exclusão ficará registrada na trilha de auditoria.',
                      confirmLabel: 'Excluir lançamento',
                    }}
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="entryId" value={entry.id} />
                  </InlineActionForm>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

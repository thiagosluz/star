import Link from 'next/link';

import {
  deleteFinancialEntryAction,
  updateFinancialEntryStatusAction,
} from '@/app/actions/finance-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import type { FinancialEntryRuleInput } from '@/domain/finance/event-finance-rules';

interface EntryRowActionsProps {
  tenantSlug: string;
  eventId: string;
  entry: FinancialEntryRuleInput;
  editHref: string;
}

/**
 * Lei de Hick: a linha destaca só a PRÓXIMA ação natural do estágio (Empenhar →
 * Liquidar) e o `Editar`; o que é raro ou destrutivo (Cancelar, Excluir) fica
 * recolhido em "Mais", sem JavaScript (`<details>` nativo).
 */
export function EntryRowActions({ tenantSlug, eventId, entry, editHref }: EntryRowActionsProps) {
  const isIncome = entry.type === 'INCOME';

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {entry.status === 'PLANNED' ? (
        <InlineActionForm
          action={updateFinancialEntryStatusAction}
          submitLabel="Empenhar"
          testId={`finance-entry-commit-${entry.id}`}
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="entryId" value={entry.id} />
          <input type="hidden" name="status" value="COMMITTED" />
        </InlineActionForm>
      ) : null}

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
          {!entry.documentNumber ? (
            <input
              type="text"
              name="documentNumber"
              maxLength={80}
              placeholder={isIncome ? 'Nº OB / Recibo' : 'Nº NF-e / Recibo'}
              aria-label="Número do comprovante fiscal ou bancário"
              className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
              data-testid={`finance-entry-settle-doc-${entry.id}`}
            />
          ) : null}
        </InlineActionForm>
      ) : null}

      <Link
        href={editHref}
        className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
        data-testid={`finance-entry-edit-${entry.id}`}
      >
        Editar
      </Link>

      <details className="relative" data-testid={`finance-entry-more-${entry.id}`}>
        <summary className="cursor-pointer rounded-md border border-border bg-surface-low px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
          Mais
        </summary>
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5 rounded-lg border border-border bg-card p-2 shadow-sm">
          {entry.status !== 'CANCELED' ? (
            <InlineActionForm
              action={updateFinancialEntryStatusAction}
              submitLabel="Cancelar"
              testId={`finance-entry-cancel-${entry.id}`}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="entryId" value={entry.id} />
              <input type="hidden" name="status" value="CANCELED" />
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
      </details>
    </div>
  );
}

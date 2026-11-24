'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';

import { createFinancialEntryAction } from '@/app/actions/finance-actions';
import { ActionFeedback, SubmitButton } from '@/components/ui';
import {
  FINANCIAL_CATEGORIES,
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_ENTRY_STATUS_LABELS,
  FINANCIAL_ENTRY_STATUSES,
  FINANCIAL_ENTRY_TYPE_LABELS,
  FINANCIAL_ENTRY_TYPES,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';

interface FinancialEntryCreateFormProps {
  tenantSlug: string;
  eventId: string;
  sources: readonly FundingSourceRuleInput[];
  defaultDate: string;
}

export function FinancialEntryCreateForm({
  tenantSlug,
  eventId,
  sources,
  defaultDate,
}: FinancialEntryCreateFormProps) {
  const [state, formAction] = useActionState(createFinancialEntryAction, null);
  const [type, setType] = useState<string>('EXPENSE');
  const [status, setStatus] = useState<string>('SETTLED');
  const [sourceId, setSourceId] = useState<string>(sources[0]?.id ?? '');
  const [category, setCategory] = useState<string>('TRAVEL_AND_PER_DIEM');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(defaultDate);
  const [settledOn, setSettledOn] = useState(defaultDate);
  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyTaxId, setCounterpartyTaxId] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <details
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="finance-entry-create"
    >
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        <Plus className="mr-1 inline size-4" aria-hidden />
        Registrar entrada ou saída financeira
      </summary>

      <form action={formAction} className="mt-4 space-y-4" data-testid="finance-entry-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Tipo de lançamento</span>
            <select
              name="type"
              value={type}
              onChange={(e) => {
                const nextType = e.target.value;
                setType(nextType);
                if (nextType === 'INCOME') setCategory('GRANT_DISBURSEMENT');
              }}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-type"
            >
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
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-status"
            >
              {FINANCIAL_ENTRY_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {FINANCIAL_ENTRY_STATUS_LABELS[item]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Fonte pagadora / origem</span>
            <select
              name="sourceId"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-source"
            >
              <option value="">Sem fonte vinculada</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Rubrica / Categoria</span>
            <select
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-category"
            >
              {FINANCIAL_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {FINANCIAL_CATEGORY_LABELS[item]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block text-muted-foreground">Descrição do lançamento</span>
            <input
              name="title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Passagens aéreas palestrante abertura / 1ª parcela FAPEG"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-title"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Valor (R$)</span>
            <input
              name="amount"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ex.: 3.450,00"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-amount"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Data de competência</span>
            <input
              type="date"
              name="occurredOn"
              required
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-occurred"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Data de liquidação (pagamento/recebimento)</span>
            <input
              type="date"
              name="settledOn"
              value={settledOn}
              onChange={(e) => setSettledOn(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-settled"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Favorecido / Fornecedor / Órgão</span>
            <input
              name="counterpartyName"
              maxLength={180}
              value={counterpartyName}
              onChange={(e) => setCounterpartyName(e.target.value)}
              placeholder="Ex.: Agência Voar / FAPEG / Gráfica Universitária"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-counterparty"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">CPF ou CNPJ do favorecido</span>
            <input
              name="counterpartyTaxId"
              maxLength={32}
              value={counterpartyTaxId}
              onChange={(e) => setCounterpartyTaxId(e.target.value)}
              placeholder="Ex.: 12.345.678/0001-90"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-taxid"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Nº NF / Nota de Empenho / Recibo / SEI</span>
            <input
              name="documentNumber"
              maxLength={80}
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              placeholder="Ex.: NF-e 00412 / NE 2026NE0018"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-document"
            />
          </label>

          <label className="space-y-1 text-xs sm:col-span-2 lg:col-span-4">
            <span className="block text-muted-foreground">Observações / justificativa para prestação de contas</span>
            <input
              name="notes"
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: Hospedagem e deslocamento referentes à conferência de abertura"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
              data-testid="finance-entry-notes"
            />
          </label>
        </div>

        <ActionFeedback state={state} className="[&_.opacity-90]:opacity-100" />

        <SubmitButton label="Registrar lançamento" pendingLabel="Registrando…" data-testid="finance-entry-submit" />
      </form>
    </details>
  );
}

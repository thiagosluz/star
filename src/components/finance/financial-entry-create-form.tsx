'use client';

import { useActionState, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import {
  createFinancialEntryAction,
  updateFinancialEntryAction,
} from '@/app/actions/finance-actions';
import { ActionFeedback, AppLink, SubmitButton } from '@/components/ui';
import {
  categoriesForEntryType,
  evaluateEntryCompliance,
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_ENTRY_STATUS_LABELS,
  FINANCIAL_ENTRY_STATUSES,
  FINANCIAL_ENTRY_TYPE_LABELS,
  FINANCIAL_ENTRY_TYPES,
  formatBrlCents,
  formatCentsForCsv,
  isFinancialCategory,
  isFinancialEntryType,
  parseBrlToCents,
  type FinancialEntryRuleInput,
  type FundingSourceExecutionView,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';

interface FinancialEntryCreateFormProps {
  mode?: 'create' | 'edit';
  tenantSlug: string;
  eventId: string;
  sources: readonly FundingSourceRuleInput[];
  sourceViews?: readonly FundingSourceExecutionView[];
  defaultDate: string;
  initialSourceId?: string;
  initialEntry?: FinancialEntryRuleInput;
  backHref?: string;
}

const INPUT_CLS = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm';

export function FinancialEntryCreateForm({
  mode = 'create',
  tenantSlug,
  eventId,
  sources,
  sourceViews,
  defaultDate,
  initialSourceId,
  initialEntry,
  backHref,
}: FinancialEntryCreateFormProps) {
  const serverAction =
    mode === 'edit' ? updateFinancialEntryAction : createFinancialEntryAction;
  const [state, formAction] = useActionState(serverAction, null);
  const [lastHandledState, setLastHandledState] = useState<typeof state>(null);

  const [type, setType] = useState<string>(initialEntry?.type ?? 'EXPENSE');
  const [status, setStatus] = useState<string>(initialEntry?.status ?? 'SETTLED');
  const [sourceId, setSourceId] = useState<string>(
    initialEntry ? (initialEntry.sourceId ?? '') : (initialSourceId ?? sources[0]?.id ?? ''),
  );
  const [category, setCategory] = useState<string>(
    initialEntry?.category ?? 'TRAVEL_AND_PER_DIEM',
  );
  const [title, setTitle] = useState(initialEntry?.title ?? '');
  const [amount, setAmount] = useState(
    initialEntry ? formatCentsForCsv(initialEntry.amountCents) : '',
  );
  const [occurredOn, setOccurredOn] = useState(initialEntry?.occurredOn ?? defaultDate);
  const [settledOn, setSettledOn] = useState(initialEntry?.settledOn ?? defaultDate);
  const [counterpartyName, setCounterpartyName] = useState(initialEntry?.counterpartyName ?? '');
  const [counterpartyTaxId, setCounterpartyTaxId] = useState(
    initialEntry?.counterpartyTaxId ?? '',
  );
  const [documentNumber, setDocumentNumber] = useState(initialEntry?.documentNumber ?? '');
  const [notes, setNotes] = useState(initialEntry?.notes ?? '');

  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state?.ok && mode === 'create') {
      setTitle('');
      setAmount('');
      setCounterpartyName('');
      setCounterpartyTaxId('');
      setDocumentNumber('');
      setNotes('');
    }
  }

  const normalizedType = isFinancialEntryType(type) ? type : 'EXPENSE';
  const normalizedCategory = isFinancialCategory(category) ? category : 'OTHER';
  const orderedCategories = categoriesForEntryType(normalizedType);
  const rawSource =
    sourceViews?.find((s) => s.sourceId === sourceId) ??
    sources.find((s) => s.id === sourceId) ??
    null;

  // No modo edição, desconta o valor original desta mesma despesa caso já estivesse nesta fonte
  const adjustedSource =
    rawSource &&
    mode === 'edit' &&
    initialEntry &&
    initialEntry.sourceId === sourceId &&
    initialEntry.type === 'EXPENSE' &&
    initialEntry.status !== 'CANCELED' &&
    'remainingApprovedCents' in rawSource
      ? {
          ...rawSource,
          remainingApprovedCents: rawSource.remainingApprovedCents + initialEntry.amountCents,
        }
      : rawSource;

  const parsedAmountCents = parseBrlToCents(amount, { allowZero: false });
  const compliance = evaluateEntryCompliance({
    type: normalizedType,
    category: normalizedCategory,
    amountCents: parsedAmountCents,
    source: adjustedSource,
  });
  const isIncome = normalizedType === 'INCOME';

  return (
    <section
      className="rounded-xl border border-border bg-card p-6 shadow-sm"
      data-testid="finance-entry-create"
    >
      <form action={formAction} className="space-y-4" data-testid="finance-entry-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        {initialEntry ? <input type="hidden" name="entryId" value={initialEntry.id} /> : null}

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
                else if (category === 'GRANT_DISBURSEMENT' || category === 'SPONSORSHIP_REVENUE') {
                  setCategory('TRAVEL_AND_PER_DIEM');
                }
              }}
              className={INPUT_CLS}
              data-testid="finance-entry-type"
            >
              {FINANCIAL_ENTRY_TYPES.map((item) => (
                <option key={item} value={item}>{FINANCIAL_ENTRY_TYPE_LABELS[item]}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Situação</span>
            <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT_CLS} data-testid="finance-entry-status">
              {FINANCIAL_ENTRY_STATUSES.map((item) => (
                <option key={item} value={item}>{FINANCIAL_ENTRY_STATUS_LABELS[item]}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">
              {isIncome ? 'Fonte de origem / edital' : 'Fonte pagadora / edital'}
            </span>
            <select name="sourceId" value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={INPUT_CLS} data-testid="finance-entry-source">
              <option value="">Sem fonte vinculada</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Rubrica / Categoria</span>
            <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT_CLS} data-testid="finance-entry-category">
              {orderedCategories.map((item) => {
                const restricted = !isIncome && rawSource && rawSource.restrictedCategories.length > 0;
                const allowed = !restricted || rawSource.restrictedCategories.includes(item);
                const suffix = restricted ? (allowed ? ' (Permitida no edital)' : ' (Fora do edital)') : '';
                return <option key={item} value={item}>{`${FINANCIAL_CATEGORY_LABELS[item]}${suffix}`}</option>;
              })}
            </select>
          </label>

          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block text-muted-foreground">Descrição do lançamento</span>
            <input name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isIncome ? 'Ex.: Liberação 1ª parcela FAPEG / Cota patrocínio' : 'Ex.: Passagens aéreas palestrante abertura'} className={INPUT_CLS} data-testid="finance-entry-title" />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">
              Valor (R$){parsedAmountCents !== null ? ` · ${formatBrlCents(parsedAmountCents)}` : ''}
            </span>
            <input name="amount" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex.: 3.450,00" className={INPUT_CLS} data-testid="finance-entry-amount" />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Data de competência</span>
            <input type="date" name="occurredOn" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={INPUT_CLS} data-testid="finance-entry-occurred" />
          </label>

          {status === 'SETTLED' ? (
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">
                {isIncome ? 'Data do recebimento em conta' : 'Data do pagamento efetivo'}
              </span>
              <input type="date" name="settledOn" value={settledOn} onChange={(e) => setSettledOn(e.target.value)} className={INPUT_CLS} data-testid="finance-entry-settled" />
            </label>
          ) : null}

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">
              {isIncome ? 'Órgão repassador / Patrocinador' : 'Favorecido / Fornecedor'}
            </span>
            <input name="counterpartyName" maxLength={180} value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} placeholder={isIncome ? 'Ex.: FAPEG / CNPq / FUNAPE' : 'Ex.: Agência Voar / Gráfica Universitária'} className={INPUT_CLS} data-testid="finance-entry-counterparty" />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">
              {isIncome ? 'CNPJ / CPF da fonte pagadora' : 'CPF ou CNPJ do favorecido'}
            </span>
            <input name="counterpartyTaxId" maxLength={32} value={counterpartyTaxId} onChange={(e) => setCounterpartyTaxId(e.target.value)} placeholder="Ex.: 12.345.678/0001-90" className={INPUT_CLS} data-testid="finance-entry-taxid" />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">
              {isIncome ? 'Nº Ordem Bancária / Contrato / SEI' : 'Nº NF / Nota de Empenho / Recibo'}
            </span>
            <input name="documentNumber" maxLength={80} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder={isIncome ? 'Ex.: OB-2026-901' : 'Ex.: NF-e 00412 / NE 2026NE0018'} className={INPUT_CLS} data-testid="finance-entry-document" />
          </label>

          <label className="space-y-1 text-xs sm:col-span-2 lg:col-span-4">
            <span className="block text-muted-foreground">Observações / justificativa para prestação de contas</span>
            <input name="notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: Hospedagem e deslocamento referentes à conferência de abertura" className={INPUT_CLS} data-testid="finance-entry-notes" />
          </label>
        </div>

        {rawSource ? (
          <div className="rounded-lg border border-border bg-surface-low p-3 text-xs" data-testid="finance-entry-compliance-preview">
            <p className="text-muted-foreground">
              Fonte selecionada: <strong className="text-foreground">{rawSource.name}</strong> · Teto aprovado:{' '}
              {formatBrlCents(rawSource.approvedCents)}
              {compliance.projectedRemainingCents !== null
                ? ` · Saldo projetado do teto após lançamento: ${formatBrlCents(compliance.projectedRemainingCents)}`
                : ''}
            </p>
            {compliance.warnings.length > 0 ? (
              <p className="mt-1.5 flex items-center gap-1.5 font-medium text-foreground" data-testid="finance-entry-compliance-warning">
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                {compliance.warnings.join(' ')}
              </p>
            ) : null}
          </div>
        ) : null}

        <ActionFeedback state={state} className="[&_.opacity-90]:opacity-100" />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            label={mode === 'edit' ? 'Salvar alterações' : 'Registrar lançamento'}
            pendingLabel="Salvando…"
            data-testid="finance-entry-submit"
          />
          {backHref ? (
            <AppLink
              href={backHref}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              data-testid="finance-entry-back"
            >
              Voltar para o Livro-razão
            </AppLink>
          ) : null}
        </div>
      </form>
    </section>
  );
}

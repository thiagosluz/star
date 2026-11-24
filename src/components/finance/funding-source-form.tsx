'use client';

import { useActionState, useState } from 'react';

import {
  createFundingSourceAction,
  updateFundingSourceAction,
} from '@/app/actions/finance-actions';
import { ActionFeedback, AppLink, SubmitButton } from '@/components/ui';
import {
  FINANCIAL_CATEGORIES,
  FINANCIAL_CATEGORY_LABELS,
  formatBrlCents,
  formatCentsForCsv,
  FUNDING_SOURCE_KIND_LABELS,
  FUNDING_SOURCE_KINDS,
  parseBrlToCents,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';

interface FundingSourceFormProps {
  mode: 'create' | 'edit';
  tenantSlug: string;
  eventId: string;
  initialSource?: FundingSourceRuleInput;
  backHref: string;
}

const INPUT_CLS = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm';

export function FundingSourceForm({
  mode,
  tenantSlug,
  eventId,
  initialSource,
  backHref,
}: FundingSourceFormProps) {
  const serverAction = mode === 'edit' ? updateFundingSourceAction : createFundingSourceAction;
  const [state, formAction] = useActionState(serverAction, null);
  const [lastHandledState, setLastHandledState] = useState<typeof state>(null);

  const [name, setName] = useState(initialSource?.name ?? '');
  const [kind, setKind] = useState<string>(initialSource?.kind ?? 'PUBLIC_GRANT');
  const [codeOrProcess, setCodeOrProcess] = useState(initialSource?.codeOrProcess ?? '');
  const [approvedAmount, setApprovedAmount] = useState(
    initialSource ? formatCentsForCsv(initialSource.approvedCents) : '',
  );
  const [notes, setNotes] = useState(initialSource?.notes ?? '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initialSource ? [...initialSource.restrictedCategories] : [],
  );

  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state?.ok && mode === 'create') {
      setName('');
      setCodeOrProcess('');
      setApprovedAmount('');
      setNotes('');
      setSelectedCategories([]);
    }
  }

  const parsedApprovedCents = parseBrlToCents(approvedAmount, { allowZero: true });

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <form action={formAction} className="space-y-4" data-testid="finance-source-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        {initialSource ? <input type="hidden" name="sourceId" value={initialSource.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block text-muted-foreground">Nome da fonte / edital</span>
            <input name="name" required maxLength={180} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Edital FAPEG 04/2026 — Auxílio a Eventos Científicos" className={INPUT_CLS} data-testid="finance-source-name" />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Natureza da fonte</span>
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={INPUT_CLS} data-testid="finance-source-kind">
              {FUNDING_SOURCE_KINDS.map((item) => (
                <option key={item} value={item}>{FUNDING_SOURCE_KIND_LABELS[item]}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Nº do processo / edital / convênio</span>
            <input name="codeOrProcess" maxLength={120} value={codeOrProcess} onChange={(e) => setCodeOrProcess(e.target.value)} placeholder="Ex.: SEI 23070.012345/2026-99 · Convênio FUNAPE 412" className={INPUT_CLS} data-testid="finance-source-process" />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">
              Valor aprovado / contratado (R$){parsedApprovedCents !== null ? ` · ${formatBrlCents(parsedApprovedCents)}` : ''}
            </span>
            <input name="approvedAmount" required value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} placeholder="Ex.: 25.000,00" className={INPUT_CLS} data-testid="finance-source-amount" />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Observações / vigência</span>
            <input name="notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: Prestação de contas até 60 dias após o encerramento" className={INPUT_CLS} data-testid="finance-source-notes" />
          </label>
        </div>

        <fieldset className="space-y-2 rounded-lg border border-border bg-surface-low p-3.5">
          <legend className="px-1 text-xs font-medium text-foreground">
            Rubricas permitidas pelo edital (deixe todas desmarcadas para uso livre)
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FINANCIAL_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  name="restrictedCategories"
                  value={category}
                  checked={selectedCategories.includes(category)}
                  onChange={(e) =>
                    setSelectedCategories((prev) =>
                      e.target.checked ? [...prev, category] : prev.filter((item) => item !== category),
                    )
                  }
                  data-testid={`finance-source-cat-${category}`}
                />
                <span>{FINANCIAL_CATEGORY_LABELS[category]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <ActionFeedback state={state} className="[&_.opacity-90]:opacity-100" />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            label={mode === 'edit' ? 'Salvar alterações' : 'Cadastrar fonte'}
            pendingLabel="Salvando…"
            data-testid="finance-source-submit"
          />
          <AppLink
            href={backHref}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            data-testid="finance-source-back"
          >
            Voltar para Fontes e editais
          </AppLink>
        </div>
      </form>
    </section>
  );
}

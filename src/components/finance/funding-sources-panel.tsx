'use client';

import { useActionState, useState } from 'react';
import { Handshake, Plus } from 'lucide-react';

import {
  createFundingSourceAction,
  deleteFundingSourceAction,
  importSponsorsToFinanceAction,
} from '@/app/actions/finance-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { ActionFeedback, SubmitButton } from '@/components/ui';
import {
  FINANCIAL_CATEGORIES,
  FINANCIAL_CATEGORY_LABELS,
  formatBrlCents,
  FUNDING_SOURCE_KIND_LABELS,
  FUNDING_SOURCE_KINDS,
  type EventFinanceSummary,
} from '@/domain/finance/event-finance-rules';

interface FundingSourcesPanelProps {
  tenantSlug: string;
  eventId: string;
  summary: EventFinanceSummary;
}

export function FundingSourcesPanel({
  tenantSlug,
  eventId,
  summary,
}: FundingSourcesPanelProps) {
  const [state, formAction] = useActionState(createFundingSourceAction, null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('PUBLIC_GRANT');
  const [codeOrProcess, setCodeOrProcess] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [notes, setNotes] = useState('');

  const { unimportedSponsors } = summary.sponsorshipPipeline;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm" data-testid="finance-sources-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Fontes de financiamento, editais de fomento e patrocínio
          </h2>
          <p className="text-xs text-muted-foreground">
            Cadastre editais (FAPEG, CNPq, CAPES), convênios com fundação (FUNAPE), recursos da instituição (UF/IF) ou patrocínios.
          </p>
        </div>
      </div>

      {unimportedSponsors.length > 0 ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-low p-3 text-xs"
          data-testid="finance-sponsor-import-banner"
        >
          <div className="space-y-0.5">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <Handshake className="size-4 text-primary" aria-hidden />
              {unimportedSponsors.length}{' '}
              {unimportedSponsors.length === 1
                ? 'patrocinador ativo com valor de contrato ainda não vinculado ao financeiro'
                : 'patrocinadores ativos com valor de contrato ainda não vinculados ao financeiro'}
            </p>
            <p className="text-muted-foreground">
              {unimportedSponsors
                .map((s) => `${s.sponsorName} (${formatBrlCents(s.effectiveContractCents)})`)
                .join(' · ')}
            </p>
          </div>

          <InlineActionForm
            action={importSponsorsToFinanceAction}
            submitLabel="Importar contratos de patrocínio"
            testId="finance-import-sponsors-form"
            variant="primary"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
          </InlineActionForm>
        </div>
      ) : null}

      {summary.bySource.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="finance-sources-empty">
          Nenhuma fonte de financiamento cadastrada para este evento.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="finance-sources-list">
          {summary.bySource.map((source) => (
            <li
              key={source.sourceId}
              className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-background p-3.5 text-xs"
              data-testid={`finance-source-${source.sourceId}`}
            >
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{source.name}</p>
                    <p className="text-muted-foreground">
                      {source.kindLabel}
                      {source.codeOrProcess ? ` · ${source.codeOrProcess}` : ''}
                    </p>
                  </div>

                  <InlineActionForm
                    action={deleteFundingSourceAction}
                    submitLabel="Excluir"
                    testId={`finance-source-delete-${source.sourceId}`}
                    variant="destructive"
                    confirm={{
                      title: `Excluir a fonte "${source.name}"?`,
                      description:
                        'A fonte só pode ser excluída quando não houver lançamentos ativos vinculados a ela.',
                      confirmLabel: 'Excluir fonte',
                    }}
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="sourceId" value={source.sourceId} />
                  </InlineActionForm>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <span className="block text-muted-foreground">Teto aprovado</span>
                    <span className="font-medium text-foreground">
                      {formatBrlCents(source.approvedCents)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Recebido em conta</span>
                    <span className="font-medium text-success-strong">
                      {formatBrlCents(source.settledIncomeCents)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Saídas alocadas</span>
                    <span className="font-medium text-foreground">
                      {formatBrlCents(source.activeExpenseCents)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Saldo do teto</span>
                    <span
                      className={`font-medium ${
                        source.remainingApprovedCents < 0 ? 'text-destructive' : 'text-foreground'
                      }`}
                    >
                      {formatBrlCents(source.remainingApprovedCents)}
                    </span>
                  </div>
                </div>

                {source.restrictedCategories.length > 0 ? (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Rubricas permitidas:{' '}
                    {source.restrictedCategories
                      .map((cat) => FINANCIAL_CATEGORY_LABELS[cat])
                      .join(', ')}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-lg border border-border bg-surface-low p-3.5" data-testid="finance-source-create">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          <Plus className="mr-1 inline size-4" aria-hidden />
          Nova fonte de financiamento ou edital
        </summary>

        <form action={formAction} className="mt-4 space-y-3" data-testid="finance-source-form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="block text-muted-foreground">Nome da fonte / edital</span>
              <input
                name="name"
                required
                maxLength={180}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Edital FAPEG 04/2026 — Auxílio a Eventos Científicos"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                data-testid="finance-source-name"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Natureza da fonte</span>
              <select
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                data-testid="finance-source-kind"
              >
                {FUNDING_SOURCE_KINDS.map((item) => (
                  <option key={item} value={item}>
                    {FUNDING_SOURCE_KIND_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Nº do processo / edital / convênio</span>
              <input
                name="codeOrProcess"
                maxLength={120}
                value={codeOrProcess}
                onChange={(e) => setCodeOrProcess(e.target.value)}
                placeholder="Ex.: SEI 23070.012345/2026-99 · Convênio FUNAPE 412"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                data-testid="finance-source-process"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Valor aprovado / contratado (R$)</span>
              <input
                name="approvedAmount"
                required
                value={approvedAmount}
                onChange={(e) => setApprovedAmount(e.target.value)}
                placeholder="Ex.: 25.000,00"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                data-testid="finance-source-amount"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Observações / vigência</span>
              <input
                name="notes"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: Prestação de contas até 60 dias após o encerramento"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                data-testid="finance-source-notes"
              />
            </label>
          </div>

          <fieldset className="space-y-1.5 pt-1">
            <legend className="text-xs text-muted-foreground">
              Rubricas permitidas pelo edital (deixe em branco se o recurso for de uso livre)
            </legend>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {FINANCIAL_CATEGORIES.map((category) => (
                <label key={category} className="flex items-center gap-1.5 text-xs text-foreground">
                  <input
                    type="checkbox"
                    name="restrictedCategories"
                    value={category}
                    data-testid={`finance-source-cat-${category}`}
                  />
                  <span>{FINANCIAL_CATEGORY_LABELS[category]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <ActionFeedback state={state} className="[&_.opacity-90]:opacity-100" />

          <SubmitButton label="Cadastrar fonte" pendingLabel="Salvando fonte…" data-testid="finance-source-submit" />
        </form>
      </details>
    </section>
  );
}

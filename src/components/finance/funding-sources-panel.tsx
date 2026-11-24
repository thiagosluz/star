import Link from 'next/link';
import { Handshake, Plus } from 'lucide-react';

import {
  deleteFundingSourceAction,
  importSponsorsToFinanceAction,
} from '@/app/actions/finance-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  buildEventFinanceHref,
  FINANCIAL_CATEGORY_LABELS,
  formatBrlCents,
  type EventFinanceSummary,
  type FundingSourceExecutionView,
} from '@/domain/finance/event-finance-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

interface FundingSourcesPanelProps {
  tenantSlug: string;
  eventId: string;
  summary: EventFinanceSummary;
  baseHref?: string;
}

function FundingSourceCard({
  tenantSlug,
  eventId,
  financeBase,
  source,
}: {
  tenantSlug: string;
  eventId: string;
  financeBase: string;
  source: FundingSourceExecutionView;
}) {
  return (
    <li
      className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-background p-4 text-xs"
      data-testid={`finance-source-${source.sourceId}`}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{source.name}</p>
            <p className="text-muted-foreground">
              {source.kindLabel}
              {source.codeOrProcess ? ` · ${source.codeOrProcess}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              href={`${financeBase}/fontes/${encodeURIComponent(source.sourceId)}/editar`}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
              data-testid={`finance-source-edit-${source.sourceId}`}
            >
              Editar
            </Link>

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
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <span className="block text-muted-foreground">Teto aprovado</span>
            <span className="font-medium text-foreground">{formatBrlCents(source.approvedCents)}</span>
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
            {source.restrictedCategories.map((cat) => FINANCIAL_CATEGORY_LABELS[cat]).join(', ')}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
          <Link
            href={buildEventFinanceHref(financeBase, {
              aba: 'lancamentos',
              fonte: source.sourceId,
            })}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            data-testid={`finance-source-filter-${source.sourceId}`}
          >
            Ver lançamentos desta fonte
          </Link>
          <Link
            href={`${financeBase}/lancamentos/novo?fonte=${encodeURIComponent(source.sourceId)}`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            data-testid={`finance-source-new-entry-${source.sourceId}`}
          >
            + Lançar nesta fonte
          </Link>
        </div>
      </div>
    </li>
  );
}

export function FundingSourcesPanel({
  tenantSlug,
  eventId,
  summary,
  baseHref,
}: FundingSourcesPanelProps) {
  const { unimportedSponsors } = summary.sponsorshipPipeline;
  const financeBase =
    baseHref ?? tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);
  const newSourceHref = `${financeBase}/fontes/nova`;

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="finance-sources-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Fontes de financiamento, editais de fomento e patrocínio
          </h2>
          <p className="text-xs text-muted-foreground">
            Acompanhe o teto aprovado, os repasses recebidos e as rubricas vinculadas a cada edital ou contrato.
          </p>
        </div>

        <Link
          href={newSourceHref}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-95"
          data-testid="finance-btn-new-source"
        >
          <Plus className="size-3.5" aria-hidden />
          Nova fonte ou edital
        </Link>
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
        <div
          className="rounded-lg border border-dashed border-border bg-surface-low p-6 text-center text-xs text-muted-foreground"
          data-testid="finance-sources-empty"
        >
          <p>Nenhuma fonte de financiamento cadastrada para este evento.</p>
          <p className="mt-2">
            <Link href={newSourceHref} className="font-medium text-primary underline">
              Cadastrar o primeiro edital, convênio ou fonte própria
            </Link>
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="finance-sources-list">
          {summary.bySource.map((source) => (
            <FundingSourceCard
              key={source.sourceId}
              tenantSlug={tenantSlug}
              eventId={eventId}
              financeBase={financeBase}
              source={source}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

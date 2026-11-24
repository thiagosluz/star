import { AlertTriangle, ArrowDownRight, ArrowUpRight, Download, FileSpreadsheet, Landmark, Wallet } from 'lucide-react';

import {
  formatBrlCents,
  type EventFinanceSummary,
} from '@/domain/finance/event-finance-rules';
import type { FinanceLedgerFilters } from '@/lib/finance/event-finance-service';

interface FinanceKpiCardsProps {
  tenantSlug: string;
  eventId: string;
  sourcesCount: number;
  summary: EventFinanceSummary;
  filters: FinanceLedgerFilters;
}

function buildExportHref(
  tenantSlug: string,
  eventId: string,
  format: 'lancamentos' | 'prestacao',
  filters: FinanceLedgerFilters,
): string {
  const params = new URLSearchParams();
  params.set('eventId', eventId);
  params.set('formato', format);
  if (filters.type) params.set('tipo', filters.type);
  if (filters.status) params.set('situacao', filters.status);
  if (filters.sourceId) params.set('fonte', filters.sourceId);
  if (filters.category) params.set('categoria', filters.category);
  if (filters.search) params.set('busca', filters.search);
  return `/api/t/${encodeURIComponent(tenantSlug)}/financeiro/exportar?${params.toString()}`;
}

export function FinanceKpiCards({
  tenantSlug,
  eventId,
  sourcesCount,
  summary,
  filters,
}: FinanceKpiCardsProps) {
  const pendingIncomeCents = summary.committedIncomeCents + summary.plannedIncomeCents;
  const pendingExpenseCents = summary.committedExpenseCents + summary.plannedExpenseCents;

  return (
    <div className="space-y-4">
      <section
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="finance-kpi-grid"
        aria-label="Indicadores financeiros do evento"
      >
        <div
          className="rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="finance-kpi-approved"
        >
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Teto aprovado (Fontes)</span>
            <Landmark className="size-4 text-primary" aria-hidden />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {formatBrlCents(summary.totalApprovedSourcesCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sourcesCount} {sourcesCount === 1 ? 'fonte cadastrada' : 'fontes cadastradas'} ·{' '}
            {summary.sponsorshipPipeline.totalActiveSponsorsCents > 0
              ? `Patrocínios: ${formatBrlCents(summary.sponsorshipPipeline.totalActiveSponsorsCents)}`
              : 'editais, convênios e patrocínio'}
          </p>
        </div>

        <div
          className="rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="finance-kpi-income"
        >
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Entradas recebidas</span>
            <ArrowUpRight className="size-4 text-success-strong" aria-hidden />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-success-strong">
            {formatBrlCents(summary.settledIncomeCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            A receber (empenhado/previsto): {formatBrlCents(pendingIncomeCents)}
          </p>
        </div>

        <div
          className="rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="finance-kpi-expense"
        >
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Saídas pagas</span>
            <ArrowDownRight className="size-4 text-destructive" aria-hidden />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {formatBrlCents(summary.settledExpenseCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Empenhado/orçado a pagar: {formatBrlCents(pendingExpenseCents)}
          </p>
        </div>

        <div
          className="rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="finance-kpi-balance"
        >
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Saldo líquido em caixa</span>
            <Wallet className="size-4 text-primary" aria-hidden />
          </div>
          <p
            className={`mt-2 text-2xl font-semibold tracking-tight ${
              summary.cashBalanceCents < 0 ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {formatBrlCents(summary.cashBalanceCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Saldo projetado final: {formatBrlCents(summary.projectedBalanceCents)}
          </p>
        </div>
      </section>

      {summary.alerts.length > 0 ? (
        <section
          className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm"
          data-testid="finance-alerts"
          role="region"
          aria-label="Alertas de conformidade e orçamento"
        >
          <p className="flex items-center gap-2 font-medium text-foreground">
            <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
            Pontos de atenção na execução orçamentária ({summary.alerts.length})
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground">
            {summary.alerts.map((alert, idx) => (
              <li key={idx}>{alert}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="finance-export-bar"
      >
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium text-foreground">
            Exportação e prestação de contas (FAPEG / FUNAPE / UF / IF)
          </h2>
          <p className="text-xs text-muted-foreground">
            Arquivos CSV em UTF-8 com separador ponto e vírgula, prontos para Excel, SEI e fundações de apoio.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={buildExportHref(tenantSlug, eventId, 'lancamentos', filters)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            data-testid="finance-export-entries"
          >
            <Download className="size-3.5" aria-hidden />
            Exportar lançamentos (CSV)
          </a>

          <a
            href={buildExportHref(tenantSlug, eventId, 'prestacao', filters)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-95"
            data-testid="finance-export-accountability"
          >
            <FileSpreadsheet className="size-3.5" aria-hidden />
            Demonstrativo por fonte (CSV)
          </a>
        </div>
      </section>
    </div>
  );
}

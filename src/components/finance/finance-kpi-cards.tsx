import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Landmark,
  Wallet,
} from 'lucide-react';

import {
  buildEventFinanceHref,
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
  compact?: boolean;
  baseHref?: string;
}

export function buildFinanceExportHref(
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
  if (filters.compliance) params.set('conformidade', filters.compliance);
  if (filters.search) params.set('busca', filters.search);
  return `/api/t/${encodeURIComponent(tenantSlug)}/financeiro/exportar?${params.toString()}`;
}

function ComplianceChecklistSection({
  summary,
  baseHref,
}: {
  summary: EventFinanceSummary;
  baseHref: string;
}) {
  const { glosaEntriesCount, missingDocumentSettledCount, unassignedExpenseEntriesCount } =
    summary.complianceCounts;

  const items = [
    {
      key: 'GLOSA',
      count: glosaEntriesCount,
      okLabel: 'Rubricas 100% compatíveis com os editais',
      warnLabel: `${glosaEntriesCount} despesa(s) fora das rubricas do edital`,
    },
    {
      key: 'MISSING_DOCUMENT',
      count: missingDocumentSettledCount,
      okLabel: 'Todos os itens pagos/recebidos possuem Nº NF/OB',
      warnLabel: `${missingDocumentSettledCount} item(ns) pago(s)/recebido(s) sem Nº NF/OB`,
    },
    {
      key: 'UNASSIGNED_SOURCE',
      count: unassignedExpenseEntriesCount,
      okLabel: 'Todas as saídas têm fonte pagadora vinculada',
      warnLabel: `${unassignedExpenseEntriesCount} saída(s) sem fonte pagadora vinculada`,
    },
  ] as const;

  return (
    <section
      className="grid gap-2.5 sm:grid-cols-3"
      data-testid="finance-compliance-checklist"
      aria-label="Prontidão documental para prestação de contas"
    >
      {items.map((item) => (
        <div
          key={item.key}
          className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs shadow-sm"
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            {item.count === 0 ? (
              <CheckCircle2 className="size-4 shrink-0 text-success-strong" aria-hidden />
            ) : (
              <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
            )}
            {item.count === 0 ? item.okLabel : item.warnLabel}
          </span>
          {item.count > 0 ? (
            <Link
              href={buildEventFinanceHref(baseHref, { aba: 'lancamentos', conformidade: item.key })}
              className="shrink-0 font-medium text-primary underline-offset-2 hover:underline"
              data-testid={`finance-compliance-link-${item.key}`}
            >
              Revisar →
            </Link>
          ) : null}
        </div>
      ))}
    </section>
  );
}

const KPI_CARD_CLS = 'rounded-xl border border-border bg-card p-4 shadow-sm';
const KPI_HEADER_CLS = 'flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground';

export function FinanceKpiCards({
  tenantSlug,
  eventId,
  sourcesCount,
  summary,
  filters,
  compact = false,
  baseHref,
}: FinanceKpiCardsProps) {
  const pendingIncomeCents = summary.committedIncomeCents + summary.plannedIncomeCents;
  const pendingExpenseCents = summary.committedExpenseCents + summary.plannedExpenseCents;
  const hasActiveFilters = Boolean(
    filters.type || filters.status || filters.sourceId || filters.category || filters.compliance || filters.search,
  );
  const showOnboarding = !compact && sourcesCount === 0 && summary.activeEntriesCount === 0;

  return (
    <div className="space-y-4">
      {showOnboarding ? (
        <section className="rounded-xl border border-border bg-surface-low p-4 text-xs" data-testid="finance-onboarding-guide" aria-label="Primeiros passos da gestão financeira">
          <p className="font-semibold text-foreground">Como estruturar a prestação de contas deste evento em 3 passos</p>
          <ol className="mt-1.5 grid gap-2 text-muted-foreground sm:grid-cols-3">
            <li><strong className="text-foreground">1. Fontes e editais:</strong> cadastre editais (FAPEG, CNPq, CAPES), convênios FUNAPE/UF/IF ou importe contratos de patrocínio.</li>
            <li><strong className="text-foreground">2. Entradas e saídas:</strong> registre repasses, notas de empenho e notas fiscais vinculando a fonte e a rubrica.</li>
            <li><strong className="text-foreground">3. Prestação de contas:</strong> acompanhe o checklist documental e exporte os CSVs prontos para o SEI.</li>
          </ol>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="finance-kpi-grid" aria-label="Indicadores financeiros do evento">
        <div className={KPI_CARD_CLS} data-testid="finance-kpi-approved">
          <div className={KPI_HEADER_CLS}>
            <span>Teto aprovado (Fontes)</span>
            <Landmark className="size-4 text-primary" aria-hidden />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatBrlCents(summary.totalApprovedSourcesCents)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sourcesCount} {sourcesCount === 1 ? 'fonte cadastrada' : 'fontes cadastradas'} ·{' '}
            {summary.sponsorshipPipeline.totalActiveSponsorsCents > 0
              ? `Patrocínios: ${formatBrlCents(summary.sponsorshipPipeline.totalActiveSponsorsCents)}`
              : 'editais, convênios e patrocínio'}
          </p>
        </div>

        <div className={KPI_CARD_CLS} data-testid="finance-kpi-income">
          <div className={KPI_HEADER_CLS}>
            <span>Entradas recebidas</span>
            <ArrowUpRight className="size-4 text-success-strong" aria-hidden />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-success-strong">{formatBrlCents(summary.settledIncomeCents)}</p>
          <p className="mt-1 text-xs text-muted-foreground">A receber (empenhado/previsto): {formatBrlCents(pendingIncomeCents)}</p>
        </div>

        <div className={KPI_CARD_CLS} data-testid="finance-kpi-expense">
          <div className={KPI_HEADER_CLS}>
            <span>Saídas pagas</span>
            <ArrowDownRight className="size-4 text-destructive" aria-hidden />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatBrlCents(summary.settledExpenseCents)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Empenhado/orçado a pagar: {formatBrlCents(pendingExpenseCents)}</p>
        </div>

        <div className={KPI_CARD_CLS} data-testid="finance-kpi-balance">
          <div className={KPI_HEADER_CLS}>
            <span>Saldo líquido em caixa</span>
            <Wallet className="size-4 text-primary" aria-hidden />
          </div>
          <p className={`mt-2 text-2xl font-semibold tracking-tight ${summary.cashBalanceCents < 0 ? 'text-destructive' : 'text-foreground'}`}>
            {formatBrlCents(summary.cashBalanceCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Saldo projetado final: {formatBrlCents(summary.projectedBalanceCents)}</p>
        </div>
      </section>

      {!compact && baseHref && summary.activeEntriesCount > 0 ? (
        <ComplianceChecklistSection summary={summary} baseHref={baseHref} />
      ) : null}

      {!compact && summary.alerts.length > 0 ? (
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

      {!compact ? (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="finance-export-bar"
        >
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-foreground">
                Exportação e prestação de contas
              </h2>
              <span
                className="rounded-md border border-border bg-surface-low px-2 py-0.5 text-xs text-muted-foreground"
                data-testid="finance-export-scope"
              >
                {hasActiveFilters ? 'Exportando recorte filtrado' : 'Exportando todos os lançamentos'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Arquivos CSV em UTF-8 com separador ponto e vírgula, prontos para Excel, SEI e fundações de apoio.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={buildFinanceExportHref(tenantSlug, eventId, 'lancamentos', filters)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              data-testid="finance-export-entries"
            >
              <Download className="size-3.5" aria-hidden />
              Exportar lançamentos (CSV)
            </a>

            <a
              href={buildFinanceExportHref(tenantSlug, eventId, 'prestacao', filters)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-95"
              data-testid="finance-export-accountability"
            >
              <FileSpreadsheet className="size-3.5" aria-hidden />
              Demonstrativo por fonte (CSV)
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}

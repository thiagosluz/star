import {
  formatBrlCents,
  FUNDING_SOURCE_KIND_SHORT_LABELS,
  type EventFinanceSummary,
} from '@/domain/finance/event-finance-rules';

interface FinanceChartsPanelProps {
  summary: EventFinanceSummary;
}

export function FinanceChartsPanel({ summary }: FinanceChartsPanelProps) {
  const maxMonthCents = Math.max(
    1,
    ...summary.monthlyCashflow.flatMap((m) => [m.activeIncomeCents, m.activeExpenseCents]),
  );

  return (
    <section
      className="grid gap-4 lg:grid-cols-3"
      data-testid="finance-charts-panel"
      aria-label="Gráficos de execução financeira"
    >
      {/* ── Gráfico 1: Execução por Fonte / Edital ─────────────────────────── */}
      <div
        className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="finance-chart-sources"
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground">Execução por fonte pagadora</h2>
          <p className="text-xs text-muted-foreground">
            Teto aprovado no edital/contrato vs. despesas alocadas na fonte.
          </p>
        </div>

        {summary.bySource.length === 0 ? (
          <p className="py-6 text-xs text-muted-foreground">
            Cadastre uma fonte de fomento ou importe patrocínios para visualizar a execução por teto.
          </p>
        ) : (
          <div className="space-y-3">
            {summary.bySource.map((source) => {
              const pct = source.utilizationPercent ?? 0;
              const barWidth = Math.min(100, Math.max(0, pct));

              return (
                <div key={source.sourceId} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">
                      {source.name}{' '}
                      <span className="text-muted-foreground">
                        ({FUNDING_SOURCE_KIND_SHORT_LABELS[source.kind]})
                      </span>
                    </span>
                    <span
                      className={
                        source.isOverBudget
                          ? 'shrink-0 font-semibold text-destructive'
                          : 'shrink-0 text-muted-foreground'
                      }
                    >
                      {source.utilizationPercent !== null ? `${source.utilizationPercent}%` : '—'}
                    </span>
                  </div>

                  <svg
                    viewBox="0 0 200 10"
                    className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`Execução da fonte ${source.name}: ${formatBrlCents(source.activeExpenseCents)} de ${formatBrlCents(source.approvedCents)}`}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={barWidth * 2}
                      height={10}
                      rx={5}
                      fill="currentColor"
                      className={source.isOverBudget ? 'text-destructive' : 'text-primary'}
                    />
                  </svg>

                  <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
                    <span>Executado: {formatBrlCents(source.activeExpenseCents)}</span>
                    <span>Teto: {formatBrlCents(source.approvedCents)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Gráfico 2: Saídas por Rubrica / Categoria ──────────────────────── */}
      <div
        className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="finance-chart-categories"
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground">Saídas por rubrica</h2>
          <p className="text-xs text-muted-foreground">
            Distribuição das despesas (pagas, empenhadas e previstas) por categoria.
          </p>
        </div>

        {summary.expensesByCategory.length === 0 ? (
          <p className="py-6 text-xs text-muted-foreground">
            Nenhuma saída registrada até o momento.
          </p>
        ) : (
          <div className="space-y-2.5">
            {summary.expensesByCategory.map((item) => {
              const barWidth = Math.min(100, Math.max(2, item.sharePercent));

              return (
                <div key={item.category} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{item.label}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatBrlCents(item.totalActiveCents)} ({item.sharePercent}%)
                    </span>
                  </div>

                  <svg
                    viewBox="0 0 200 8"
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${item.label}: ${formatBrlCents(item.totalActiveCents)} (${item.sharePercent}%)`}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={barWidth * 2}
                      height={8}
                      rx={4}
                      fill="currentColor"
                      className="text-primary"
                    />
                  </svg>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Gráfico 3: Fluxo Mensal (Entradas × Saídas) ────────────────────── */}
      <div
        className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="finance-chart-monthly"
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground">Fluxo mensal (Entradas × Saídas)</h2>
          <p className="text-xs text-muted-foreground">
            Comparativo por mês de competência entre recursos e despesas.
          </p>
        </div>

        {summary.monthlyCashflow.length === 0 ? (
          <p className="py-6 text-xs text-muted-foreground">
            Nenhum lançamento com data de competência registrada.
          </p>
        ) : (
          <div className="space-y-3">
            {summary.monthlyCashflow.map((month) => {
              const incomeWidth = Math.round((month.activeIncomeCents / maxMonthCents) * 200);
              const expenseWidth = Math.round((month.activeExpenseCents / maxMonthCents) * 200);

              return (
                <div key={month.monthKey} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{month.monthKey}</span>
                    <span
                      className={
                        month.netProjectedCents < 0
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }
                    >
                      Saldo: {formatBrlCents(month.netProjectedCents)}
                    </span>
                  </div>

                  <svg
                    viewBox="0 0 200 18"
                    className="h-4 w-full"
                    role="img"
                    aria-label={`Mês ${month.monthKey}: entradas ${formatBrlCents(month.activeIncomeCents)}, saídas ${formatBrlCents(month.activeExpenseCents)}`}
                  >
                    <rect
                      x={0}
                      y={1}
                      width={Math.max(2, incomeWidth)}
                      height={6}
                      rx={3}
                      fill="currentColor"
                      className="text-success-strong"
                    />
                    <rect
                      x={0}
                      y={10}
                      width={Math.max(2, expenseWidth)}
                      height={6}
                      rx={3}
                      fill="currentColor"
                      className="text-destructive"
                    />
                  </svg>

                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Entradas: {formatBrlCents(month.activeIncomeCents)}</span>
                    <span>Saídas: {formatBrlCents(month.activeExpenseCents)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

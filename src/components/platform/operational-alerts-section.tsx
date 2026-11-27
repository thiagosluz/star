/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UI (Server Component) — Painel Operacional de Alertas (FASE 129)
 *
 *  Isola a consulta ao Redis/BullMQ (`readOperationalAlertReport`) para streaming
 *  sob `<Suspense>` em `/superadmin/metricas`, apresentando cada sensor em
 *  linguagem operacional humana com os detalhes Prometheus recolhidos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import {
  groupOperationalAlerts,
  presentOperationalAlerts,
} from '@/domain/observability/alert-rules';
import {
  readOperationalAlertReport,
  type OperationalAlertReport,
} from '@/lib/observability/alerts';
import { Badge, Skeleton } from '@/components/ui';
import { RefreshMetricsButton } from './refresh-metrics-button';

export function OperationalAlertsView({ report }: { report: OperationalAlertReport }) {
  const presented = presentOperationalAlerts(report.snapshot, report.alerts);
  const groups = groupOperationalAlerts(presented);

  return (
    <section
      className="space-y-5 rounded-xl border border-border bg-card p-5"
      data-testid="platform-operational-alerts"
      data-firing={String(report.firingCount)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-title text-foreground">Alertas operacionais</h2>
          <p className="text-xs text-muted-foreground">
            Monitoramento em tempo real de filas, workers e estabilidade deste processo web.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={report.firingCount > 0 ? 'danger' : 'success'} size="sm" withDot>
            {report.firingCount === 0
              ? 'Operação normal'
              : `${report.firingCount} alerta(s) ativo(s)`}
          </Badge>
          <RefreshMetricsButton />
        </div>
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <div
            key={group.category}
            className="space-y-2"
            data-testid={`operational-alert-group-${group.category}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <span className="text-xs text-muted-foreground">
                {group.firingCount === 0
                  ? `${group.items.length} operacional(is)`
                  : `${group.firingCount} ativo(s) de ${group.items.length}`}
              </span>
            </div>

            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background/50">
              {group.items.map((alert) => {
                const rowToneClass = alert.firing
                  ? alert.severity === 'critical'
                    ? 'bg-destructive-soft/40'
                    : 'bg-warning-soft/40'
                  : '';

                const statusTone = alert.firing
                  ? alert.severity === 'critical'
                    ? 'danger'
                    : 'warning'
                  : 'success';

                return (
                  <li
                    key={alert.name}
                    data-testid={`operational-alert-${alert.name}`}
                    data-firing={alert.firing ? 'true' : 'false'}
                    className={`p-3.5 text-sm ${rowToneClass}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={statusTone} size="sm" withDot>
                          {alert.statusLabel}
                        </Badge>
                        <span className="font-medium text-foreground">{alert.title}</span>
                        <Badge tone="neutral" size="sm">
                          {alert.severityLabel}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className="rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground"
                          data-testid={`operational-alert-value-${alert.name}`}
                        >
                          {alert.observedLabel}
                        </span>

                        {alert.actionHref && alert.actionLabel ? (
                          <Link
                            href={alert.actionHref}
                            data-testid={`operational-alert-action-${alert.name}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand underline-offset-4 hover:underline"
                          >
                            {alert.actionLabel}
                            <ArrowUpRight className="size-3.5" aria-hidden="true" />
                          </Link>
                        ) : null}
                      </div>
                    </div>

                    <p className="mt-1.5 text-xs text-muted-foreground">{alert.summary}</p>

                    <details
                      className="mt-2 text-xs text-muted-foreground"
                      data-testid={`operational-alert-details-${alert.name}`}
                    >
                      <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
                        Detalhes técnicos (Prometheus)
                      </summary>
                      <div className="mt-1.5 space-y-1 rounded-md border border-border bg-card p-2.5">
                        <p className="font-mono text-xs text-foreground">
                          {alert.name} · <code>eventflow_alert_firing</code>
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          Regra: {alert.thresholdDescription} (valor bruto: {alert.observedValue})
                        </p>
                        <p className="text-xs text-muted-foreground">{alert.guidance}</p>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export async function OperationalAlertsSection() {
  const report = await readOperationalAlertReport();
  return <OperationalAlertsView report={report} />;
}

export function OperationalAlertsSkeleton() {
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      aria-busy="true"
      aria-label="Carregando alertas operacionais"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <Skeleton className="h-7 w-32 rounded-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </section>
  );
}

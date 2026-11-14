/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OBSERVABILIDADE — Avaliação e publicação de alertas operacionais (FASE 110 · B9)
 *
 *  Acopla as regras puras de `src/domain/observability/alert-rules.ts` ao registro
 *  Prometheus (`/api/metrics`) e ao painel `/superadmin/metricas`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  evaluateOperationalAlerts,
  type OperationalAlert,
  type OperationalMetricsSnapshot,
} from '@/domain/observability/alert-rules';
import { certificateQueueStats } from '@/lib/certificates/queue';
import { setGauge, sumCounterValues } from '@/lib/observability/metrics';

export type QueueStatsSnapshot = Awaited<ReturnType<typeof certificateQueueStats>>;

export interface OperationalAlertReport {
  snapshot: OperationalMetricsSnapshot;
  alerts: readonly OperationalAlert[];
  firingCount: number;
}

export function buildOperationalSnapshot(
  queueStats: QueueStatsSnapshot | null,
): OperationalMetricsSnapshot {
  return {
    queueUp: queueStats !== null,
    queueWorkers: queueStats?.workers ?? 0,
    waitingJobs: queueStats?.waiting ?? 0,
    failedJobs: queueStats?.failed ?? 0,
    http5xxTotal: sumCounterValues('http_requests_total', (labels) =>
      String(labels.status ?? '').startsWith('5'),
    ),
    scrapeDeniedTotal: sumCounterValues('metrics_scrape_denied_total'),
  };
}

export function evaluateAndPublishOperationalAlerts(
  queueStats: QueueStatsSnapshot | null,
  options: { publishToRegistry?: boolean } = {},
): OperationalAlertReport {
  const snapshot = buildOperationalSnapshot(queueStats);
  const alerts = evaluateOperationalAlerts(snapshot);
  const firingCount = alerts.filter((alert) => alert.firing).length;

  if (options.publishToRegistry !== false) {
    for (const alert of alerts) {
      setGauge('eventflow_alert_firing', alert.firing ? 1 : 0, {
        alert: alert.name,
        severity: alert.severity,
      });
    }
    setGauge('eventflow_alerts_firing_total', firingCount);
  }

  return { snapshot, alerts, firingCount };
}

export async function readOperationalAlertReport(): Promise<OperationalAlertReport> {
  const stats = await certificateQueueStats().catch(() => null);
  return evaluateAndPublishOperationalAlerts(stats, { publishToRegistry: false });
}

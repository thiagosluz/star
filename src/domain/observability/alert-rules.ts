/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Regras de alerta acopladas a `/api/metrics` (FASE 110 · dívida B9)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE AVALIAR NO DOMÍNIO E EXPOR EM PROMETHEUS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Métricas sem limiar dependem de alguém olhar o gráfico. Ao acoplar regras
 *  puras ao endpoint `/api/metrics` e ao painel do SuperAdmin, toda coleta expõe
 *  `eventflow_alert_firing{alert="...",severity="..."} 0|1` e o operador enxerga
 *  alertas disparados na hora — sem depender de Stack externa obrigatória, mas
 *  pronto para Alertmanager/Grafana lerem imediatamente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type AlertSeverity = 'warning' | 'critical';

export interface OperationalMetricsSnapshot {
  readonly queueUp: boolean;
  readonly queueWorkers: number;
  readonly waitingJobs: number;
  readonly failedJobs: number;
  readonly http5xxTotal: number;
  readonly scrapeDeniedTotal: number;
}

export interface OperationalAlert {
  readonly name: string;
  readonly severity: AlertSeverity;
  readonly firing: boolean;
  readonly summary: string;
  readonly thresholdDescription: string;
  readonly observedValue: number;
}

export const ALERT_HTTP_5XX_THRESHOLD = 20;
export const ALERT_SCRAPE_DENIED_THRESHOLD = 10;

export function evaluateOperationalAlerts(
  snapshot: OperationalMetricsSnapshot,
): readonly OperationalAlert[] {
  return [
    {
      name: 'BullMQQueueDown',
      severity: 'critical',
      firing: !snapshot.queueUp,
      summary: snapshot.queueUp
        ? 'Fila de certificados conectada ao Redis.'
        : 'Fila de certificados inacessível no Redis (bullmq_queue_up = 0).',
      thresholdDescription: 'bullmq_queue_up == 0',
      observedValue: snapshot.queueUp ? 1 : 0,
    },
    {
      name: 'BullMQNoWorkers',
      severity: 'critical',
      firing: snapshot.queueUp && snapshot.queueWorkers === 0 && snapshot.waitingJobs > 0,
      summary:
        snapshot.queueUp && snapshot.queueWorkers === 0 && snapshot.waitingJobs > 0
          ? `${snapshot.waitingJobs} job(s) aguardando sem nenhum worker conectado.`
          : 'Workers ativos ou fila sem acúmulo pendente.',
      thresholdDescription: 'queue_up == 1 && workers == 0 && waiting > 0',
      observedValue: snapshot.queueWorkers,
    },
    {
      name: 'BullMQFailedJobsBacklog',
      severity: 'warning',
      firing: snapshot.failedJobs > 0,
      summary:
        snapshot.failedJobs > 0
          ? `${snapshot.failedJobs} job(s) com falha acumulada na fila de certificados.`
          : 'Nenhum job falhado na fila de certificados.',
      thresholdDescription: 'bullmq_queue_jobs{state="failed"} > 0',
      observedValue: snapshot.failedJobs,
    },
    {
      name: 'Http5xxSpike',
      severity: 'warning',
      firing: snapshot.http5xxTotal >= ALERT_HTTP_5XX_THRESHOLD,
      summary:
        snapshot.http5xxTotal >= ALERT_HTTP_5XX_THRESHOLD
          ? `${snapshot.http5xxTotal} respostas 5xx acumuladas neste processo.`
          : 'Taxa de respostas 5xx dentro do esperado neste processo.',
      thresholdDescription: `http_requests_total{status=~"5.."} >= ${ALERT_HTTP_5XX_THRESHOLD}`,
      observedValue: snapshot.http5xxTotal,
    },
    {
      name: 'MetricsScrapeDeniedSpike',
      severity: 'warning',
      firing: snapshot.scrapeDeniedTotal >= ALERT_SCRAPE_DENIED_THRESHOLD,
      summary:
        snapshot.scrapeDeniedTotal >= ALERT_SCRAPE_DENIED_THRESHOLD
          ? `${snapshot.scrapeDeniedTotal} tentativas negadas em /api/metrics.`
          : 'Acessos não autorizados ao /api/metrics dentro do limite.',
      thresholdDescription: `metrics_scrape_denied_total >= ${ALERT_SCRAPE_DENIED_THRESHOLD}`,
      observedValue: snapshot.scrapeDeniedTotal,
    },
  ];
}

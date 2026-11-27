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

// ───────────────────────────────────────────────────────────────────────────────
//  Apresentação operacional para o painel `/superadmin/metricas` (FASE 129)
// ───────────────────────────────────────────────────────────────────────────────
export type OperationalAlertCategory = 'queue' | 'web';

export const OPERATIONAL_ALERT_CATEGORY_LABELS: Record<OperationalAlertCategory, string> = {
  queue: 'Filas & Workers',
  web: 'Aplicação & Segurança',
};

export interface OperationalAlertPresentation {
  readonly name: string;
  readonly title: string;
  readonly category: OperationalAlertCategory;
  readonly severity: AlertSeverity;
  readonly severityLabel: string;
  readonly firing: boolean;
  readonly statusLabel: string;
  readonly summary: string;
  readonly observedLabel: string;
  readonly thresholdDescription: string;
  readonly observedValue: number;
  readonly actionHref?: string;
  readonly actionLabel?: string;
  readonly guidance: string;
}

export interface OperationalAlertGroup {
  readonly category: OperationalAlertCategory;
  readonly label: string;
  readonly firingCount: number;
  readonly items: readonly OperationalAlertPresentation[];
}

interface AlertMetadata {
  readonly title: string;
  readonly category: OperationalAlertCategory;
  readonly actionHref?: string;
  readonly actionLabel?: string;
  readonly guidance: string;
  readonly formatObserved: (snapshot: OperationalMetricsSnapshot, observedValue: number) => string;
}

const ALERT_METADATA: Record<string, AlertMetadata> = {
  BullMQQueueDown: {
    title: 'Conexão da fila com Redis',
    category: 'queue',
    actionHref: '/superadmin/rotinas',
    actionLabel: 'Ver fila',
    guidance: 'Verifique a saúde do container Redis e a variável REDIS_URL.',
    formatObserved: (s) => (s.queueUp ? 'Conectado' : 'Indisponível'),
  },
  BullMQNoWorkers: {
    title: 'Workers ativos na fila de certificados',
    category: 'queue',
    actionHref: '/superadmin/rotinas',
    actionLabel: 'Painel do worker',
    guidance: 'Confirme se o processo/container worker está em execução para drenar jobs pendentes.',
    formatObserved: (s) =>
      `${s.queueWorkers} worker(s) · ${s.waitingJobs} na fila`,
  },
  BullMQFailedJobsBacklog: {
    title: 'Jobs com falha na fila de certificados',
    category: 'queue',
    actionHref: '/superadmin/rotinas',
    actionLabel: 'Inspecionar jobs',
    guidance: 'Revise os logs do worker para identificar falhas de PDF, storage ou assinatura.',
    formatObserved: (s) => (s.failedJobs === 0 ? '0 falhas' : `${s.failedJobs} falha(s)`),
  },
  Http5xxSpike: {
    title: 'Erros HTTP 5xx (processo web)',
    category: 'web',
    guidance: 'Contador em memória do processo atual do Next.js; consulte os logs do servidor se subir.',
    formatObserved: (s) => `${s.http5xxTotal} / ${ALERT_HTTP_5XX_THRESHOLD}`,
  },
  MetricsScrapeDeniedSpike: {
    title: 'Acessos bloqueados em /api/metrics',
    category: 'web',
    guidance: 'Indica tentativas sem token válido ou com token divergente de METRICS_TOKEN.',
    formatObserved: (s) => `${s.scrapeDeniedTotal} / ${ALERT_SCRAPE_DENIED_THRESHOLD}`,
  },
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
};

export function presentOperationalAlerts(
  snapshot: OperationalMetricsSnapshot,
  alerts: readonly OperationalAlert[],
): readonly OperationalAlertPresentation[] {
  return alerts
    .map((alert, index) => {
      const meta = ALERT_METADATA[alert.name];
      return {
        index,
        item: {
          name: alert.name,
          title: meta?.title ?? alert.name,
          category: meta?.category ?? 'web',
          severity: alert.severity,
          severityLabel: alert.severity === 'critical' ? 'Crítico' : 'Aviso',
          firing: alert.firing,
          statusLabel: alert.firing ? 'Ativo' : 'Operacional',
          summary: alert.summary,
          observedLabel: meta
            ? meta.formatObserved(snapshot, alert.observedValue)
            : String(alert.observedValue),
          thresholdDescription: alert.thresholdDescription,
          observedValue: alert.observedValue,
          actionHref: meta?.actionHref,
          actionLabel: meta?.actionLabel,
          guidance: meta?.guidance ?? 'Consulte /api/metrics para o valor bruto do sensor.',
        } satisfies OperationalAlertPresentation,
      };
    })
    .sort((a, b) => {
      if (a.item.firing !== b.item.firing) return a.item.firing ? -1 : 1;
      if (a.item.severity !== b.item.severity) {
        return SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity];
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

const CATEGORY_ORDER: readonly OperationalAlertCategory[] = ['queue', 'web'];

export function groupOperationalAlerts(
  items: readonly OperationalAlertPresentation[],
): readonly OperationalAlertGroup[] {
  const groups = CATEGORY_ORDER.map((category) => {
    const groupItems = items.filter((item) => item.category === category);
    const firingCount = groupItems.filter((item) => item.firing).length;
    return {
      category,
      label: OPERATIONAL_ALERT_CATEGORY_LABELS[category],
      firingCount,
      items: groupItems,
    } satisfies OperationalAlertGroup;
  }).filter((group) => group.items.length > 0);

  return groups.sort((a, b) => {
    if (a.firingCount > 0 !== b.firingCount > 0) return a.firingCount > 0 ? -1 : 1;
    return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  });
}

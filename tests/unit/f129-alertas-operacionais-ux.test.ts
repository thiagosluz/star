import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  evaluateOperationalAlerts,
  groupOperationalAlerts,
  presentOperationalAlerts,
  type OperationalMetricsSnapshot,
} from '@/domain/observability/alert-rules';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { OperationalAlertsView } from '@/components/platform/operational-alerts-section';

function makeSnapshot(
  overrides: Partial<OperationalMetricsSnapshot> = {},
): OperationalMetricsSnapshot {
  return {
    queueUp: true,
    queueWorkers: 1,
    waitingJobs: 0,
    failedJobs: 0,
    http5xxTotal: 0,
    scrapeDeniedTotal: 0,
    ...overrides,
  };
}

describe('FASE 129 — apresentação operacional e UX de alertas em /superadmin/metricas', () => {
  it('traduz alertas para rótulos humanos sem ambiguidade no estado operacional', () => {
    const snapshot = makeSnapshot({ queueWorkers: 2, waitingJobs: 3 });
    const alerts = evaluateOperationalAlerts(snapshot);
    const presented = presentOperationalAlerts(snapshot, alerts);

    const byName = new Map(presented.map((item) => [item.name, item]));
    expect(byName.get('BullMQQueueDown')).toMatchObject({
      title: 'Conexão da fila com Redis',
      observedLabel: 'Conectado',
      statusLabel: 'Operacional',
      severityLabel: 'Crítico',
      actionHref: '/superadmin/rotinas',
    });
    expect(byName.get('BullMQNoWorkers')?.observedLabel).toBe('2 worker(s) · 3 na fila');
    expect(byName.get('BullMQFailedJobsBacklog')?.observedLabel).toBe('0 falhas');
    expect(byName.get('Http5xxSpike')?.observedLabel).toBe('0 / 20');
    expect(byName.get('MetricsScrapeDeniedSpike')?.observedLabel).toBe('0 / 10');
  });

  it('ordena alertas ativos primeiro (crítico antes de aviso) e promove grupo com incidente', () => {
    const snapshot = makeSnapshot({
      http5xxTotal: 25,
      failedJobs: 4,
    });
    const alerts = evaluateOperationalAlerts(snapshot);
    const presented = presentOperationalAlerts(snapshot, alerts);

    expect(presented[0]?.firing).toBe(true);
    expect(presented[1]?.firing).toBe(true);
    expect(presented[2]?.firing).toBe(false);

    const webOnlyIncident = makeSnapshot({ http5xxTotal: 25 });
    const webGroups = groupOperationalAlerts(
      presentOperationalAlerts(webOnlyIncident, evaluateOperationalAlerts(webOnlyIncident)),
    );
    expect(webGroups[0]?.category).toBe('web');
    expect(webGroups[0]?.firingCount).toBe(1);
    expect(webGroups[1]?.category).toBe('queue');
    expect(webGroups[1]?.firingCount).toBe(0);
  });

  it('renderiza SSR preservando contratos data-testid, grupos semânticos e detalhes recolhidos', () => {
    const snapshot = makeSnapshot();
    const alerts = evaluateOperationalAlerts(snapshot);
    const html = renderToStaticMarkup(
      createElement(OperationalAlertsView, {
        report: {
          snapshot,
          alerts,
          firingCount: 0,
        },
      }),
    );

    expect(html).toContain('data-testid="platform-operational-alerts"');
    expect(html).toContain('data-firing="0"');
    expect(html).toContain('data-testid="operational-alert-group-queue"');
    expect(html).toContain('data-testid="operational-alert-group-web"');
    expect(html).toContain('data-testid="operational-alert-Http5xxSpike"');
    expect(html).toContain('Conexão da fila com Redis');
    expect(html).toContain('Detalhes técnicos (Prometheus)');
    expect(html).toContain('data-testid="refresh-metrics-button"');
    expect(html).toContain('/superadmin/rotinas');
  });

  it('destaca visualmente alertas disparados no HTML renderizado', () => {
    const snapshot = makeSnapshot({ queueUp: false });
    const alerts = evaluateOperationalAlerts(snapshot);
    const html = renderToStaticMarkup(
      createElement(OperationalAlertsView, {
        report: {
          snapshot,
          alerts,
          firingCount: 1,
        },
      }),
    );

    expect(html).toContain('data-firing="1"');
    expect(html).toContain('1 alerta(s) ativo(s)');
    expect(html).toContain('Indisponível');
    expect(html).toContain('bg-destructive-soft/40');
  });
});

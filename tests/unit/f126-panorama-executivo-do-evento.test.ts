import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EMPTY_EVENT_AREA_COUNTS } from '../../src/domain/events/event-areas';
import {
  computeEventOverviewSummary,
  EMPTY_EVENT_OVERVIEW_DB_METRICS,
  formatOverviewCurrencyBrl,
  formatOverviewMinutes,
  resolveEffectiveActivityCapacity,
} from '../../src/domain/events/event-overview-rules';
import { EventOverviewPanel } from '../../src/components/admin/event-overview-panel';

describe('FASE 126 · domínio do panorama executivo do evento', () => {
  it('devolve null (não zero) para lotação sem teto e comparecimento sem confirmados', () => {
    const summary = computeEventOverviewSummary({
      eventCapacity: null,
      eventConfirmedCount: 0,
      activities: [],
      areaCounts: EMPTY_EVENT_AREA_COUNTS,
      overviewMetrics: EMPTY_EVENT_OVERVIEW_DB_METRICS,
      pendingConfirmationsTotal: 0,
      canViewFinance: false,
      readiness: { doneCount: 1, totalCount: 3, allReady: false },
    });

    expect(summary.registrationKpi.occupationPercent).toBeNull();
    expect(summary.attendanceKpi.attendanceRatePercent).toBeNull();
    expect(summary.participationFunnel.total).toBe(0);
    expect(summary.participationFunnel.capacityPercent).toBeNull();
    expect(summary.topActivitiesOccupation).toEqual([]);
  });

  it('calcula lotação, comparecimento, funil empilhado e balanço financeiro em centavos', () => {
    const summary = computeEventOverviewSummary({
      eventCapacity: 100,
      eventConfirmedCount: 40,
      activities: [
        {
          id: 'act-1',
          title: 'Oficina de Next.js',
          type: 'WORKSHOP',
          capacity: 30,
          roomCapacity: 20,
          confirmedCount: 18,
          pendingConfirmations: 1,
          requiresRegistration: true,
          roomName: 'Lab 01',
        },
        {
          id: 'act-2',
          title: 'Abertura Institucional',
          type: 'PLENARY',
          capacity: null,
          roomCapacity: 200,
          confirmedCount: 10,
          pendingConfirmations: 0,
          requiresRegistration: false,
          roomName: 'Auditório',
        },
      ],
      areaCounts: {
        ...EMPTY_EVENT_AREA_COUNTS,
        activities: 2,
        calls: 2,
        sponsors: 3,
        credentials: 32,
        certificates: 14,
        proceedingsEntries: 5,
        financialEntries: 8,
        speakers: 4,
        openDemands: 2,
        pagePublished: true,
      },
      overviewMetrics: {
        confirmedRegistrations: 40,
        pendingEventRegistrations: 3,
        waitlistedRegistrations: 5,
        attendedUsersCount: 24,
        attendanceVisitsCount: 30,
        attendanceMinutesTotal: 150,
        submissionsCount: 12,
        completedDemandsCount: 6,
        approvedFundingCents: 3_600_000,
        settledIncomeCents: 3_500_000,
        settledExpenseCents: 50_000,
      },
      pendingConfirmationsTotal: 2,
      canViewFinance: true,
      readiness: { doneCount: 3, totalCount: 3, allReady: true },
    });

    expect(summary.registrationKpi).toEqual({
      confirmedCount: 40,
      capacity: 100,
      occupationPercent: 40,
      pendingConfirmations: 5,
      waitlistedCount: 5,
      activitiesCount: 2,
    });

    expect(summary.attendanceKpi).toEqual({
      attendedCount: 24,
      attendanceRatePercent: 60,
      activeCredentialsCount: 32,
      totalMinutes: 150,
      totalVisits: 30,
    });

    expect(summary.financeKpi.netBalanceCents).toBe(3_450_000);
    expect(summary.participationFunnel.total).toBe(50);
    expect(summary.participationFunnel.attendedCount).toBe(24);
    expect(summary.participationFunnel.awaitingArrivalCount).toBe(16);

    expect(summary.topActivitiesOccupation[0]?.id).toBe('act-1');
    expect(summary.topActivitiesOccupation[0]?.effectiveCapacity).toBe(20);
    expect(summary.topActivitiesOccupation[0]?.occupationPercent).toBe(90);
    expect(summary.topActivitiesOccupation[1]?.effectiveCapacity).toBeNull();
    expect(summary.topActivitiesOccupation[1]?.occupationPercent).toBeNull();
  });

  it('resolve teto efetivo da atividade e formata moeda/duração em pt-BR', () => {
    expect(resolveEffectiveActivityCapacity(50, 30)).toBe(30);
    expect(resolveEffectiveActivityCapacity(null, 40)).toBe(40);
    expect(resolveEffectiveActivityCapacity(null, null)).toBeNull();
    expect(formatOverviewCurrencyBrl(3_450_000)).toContain('34.500,00');
    expect(formatOverviewMinutes(45)).toBe('45 min');
    expect(formatOverviewMinutes(150)).toBe('2h 30min');
    expect(formatOverviewMinutes(120)).toBe('2h');
  });
});

describe('FASE 126 · renderização SSR do painel executivo do evento', () => {
  it('renderiza 4 KPIs e 3 gráficos sem criar nenhum <section> nem <details>', () => {
    const summary = computeEventOverviewSummary({
      eventCapacity: 200,
      eventConfirmedCount: 50,
      activities: [
        {
          id: 'act-1',
          title: 'Minicurso de Arquitetura',
          type: 'WORKSHOP',
          capacity: 25,
          roomCapacity: 30,
          confirmedCount: 20,
          pendingConfirmations: 0,
          requiresRegistration: true,
          roomName: 'Sala B',
        },
      ],
      areaCounts: {
        ...EMPTY_EVENT_AREA_COUNTS,
        activities: 1,
        calls: 1,
        sponsors: 2,
        certificates: 10,
        credentials: 20,
        openDemands: 1,
        pagePublished: true,
      },
      overviewMetrics: {
        ...EMPTY_EVENT_OVERVIEW_DB_METRICS,
        confirmedRegistrations: 50,
        attendedUsersCount: 25,
        attendanceVisitsCount: 25,
        attendanceMinutesTotal: 90,
        submissionsCount: 8,
        completedDemandsCount: 4,
        approvedFundingCents: 2_000_000,
        settledIncomeCents: 1_500_000,
        settledExpenseCents: 300_000,
      },
      pendingConfirmationsTotal: 1,
      canViewFinance: true,
      readiness: { doneCount: 3, totalCount: 3, allReady: true },
    });

    const html = renderToStaticMarkup(
      createElement(EventOverviewPanel, {
        tenantSlug: 'ufba-demo',
        eventId: '11111111-1111-4111-8111-111111111111',
        summary,
      }),
    );

    expect((html.match(/<section/g) ?? []).length).toBe(0);
    expect((html.match(/<details/g) ?? []).length).toBe(0);
    expect(html).not.toContain('viewBox="0 0 200');
    expect(html).toContain('x="0%"');
    expect(html).toContain('data-testid="event-overview-panel"');
    expect(html).toContain('data-testid="event-kpi-registrations"');
    expect(html).toContain('data-testid="event-kpi-attendance"');
    expect(html).toContain('data-testid="event-kpi-academic"');
    expect(html).toContain('data-testid="event-kpi-finance"');
    expect(html).toContain('data-testid="event-overview-finance-link"');
    expect(html).toContain('data-testid="event-chart-funnel"');
    expect(html).toContain('data-testid="event-chart-activities"');
    expect(html).toContain('data-testid="event-chart-pulse"');
    expect(html).toContain('Minicurso de Arquitetura');
  });

  it('mostra o cartão de Operação & Equipes quando o usuário não tem acesso financeiro', () => {
    const summary = computeEventOverviewSummary({
      eventCapacity: null,
      eventConfirmedCount: 0,
      activities: [],
      areaCounts: {
        ...EMPTY_EVENT_AREA_COUNTS,
        teams: 3,
        rooms: 4,
        openDemands: 2,
      },
      overviewMetrics: {
        ...EMPTY_EVENT_OVERVIEW_DB_METRICS,
        completedDemandsCount: 5,
      },
      pendingConfirmationsTotal: 0,
      canViewFinance: false,
      readiness: { doneCount: 1, totalCount: 3, allReady: false },
    });

    const html = renderToStaticMarkup(
      createElement(EventOverviewPanel, {
        tenantSlug: 'ufba-demo',
        eventId: '11111111-1111-4111-8111-111111111111',
        summary,
      }),
    );

    expect(html).toContain('data-testid="event-kpi-operations"');
    expect(html).not.toContain('data-testid="event-kpi-finance"');
    expect(html).toContain('Pulso operacional do evento');
    expect(html).toContain('3 equipe(s) ativa(s)');
  });
});

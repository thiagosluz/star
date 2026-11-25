/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — PANORAMA EXECUTIVO E PAINEL GRÁFICO DO EVENTO (FASE 126)
 *
 *  Consolida as métricas operacionais, acadêmicas, de presença e financeiras do
 *  evento em uma única projeção pura — sem importar Prisma nem Next.js — para
 *  alimentar os 4 cartões executivos e os 3 gráficos SSR na raiz do evento.
 *
 *  Regras que protegem contra números enganosos:
 *    • `null !== 0` (ADR-157): sem capacidade definida ou sem inscritos
 *      confirmados, percentuais de lotação/comparecimento devolvem `null` e a UI
 *      renderiza `"—"`, nunca `0%`.
 *    • Teto efetivo da atividade: considera o menor teto positivo entre a
 *      capacidade declarada da atividade e a capacidade da sala vinculada.
 *    • Funil de participação soma estados mutuamente exclusivos no evento para
 *      que a barra empilhada nunca ultrapasse 100% nem duplique pessoas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { EventAreaCounts } from '@/domain/events/event-areas';

export interface EventOverviewDbMetrics {
  confirmedRegistrations: number;
  pendingEventRegistrations: number;
  waitlistedRegistrations: number;
  attendedUsersCount: number;
  attendanceVisitsCount: number;
  attendanceMinutesTotal: number;
  submissionsCount: number;
  completedDemandsCount: number;
  approvedFundingCents: number;
  settledIncomeCents: number;
  settledExpenseCents: number;
}

export const EMPTY_EVENT_OVERVIEW_DB_METRICS: EventOverviewDbMetrics = {
  confirmedRegistrations: 0,
  pendingEventRegistrations: 0,
  waitlistedRegistrations: 0,
  attendedUsersCount: 0,
  attendanceVisitsCount: 0,
  attendanceMinutesTotal: 0,
  submissionsCount: 0,
  completedDemandsCount: 0,
  approvedFundingCents: 0,
  settledIncomeCents: 0,
  settledExpenseCents: 0,
};

export interface EventOverviewActivityInput {
  id: string;
  title: string;
  type: string;
  capacity: number | null;
  roomCapacity: number | null;
  confirmedCount: number;
  pendingConfirmations: number;
  requiresRegistration: boolean;
  roomName: string | null;
}

export interface EventOverviewActivityOccupationItem {
  id: string;
  title: string;
  type: string;
  roomName: string | null;
  requiresRegistration: boolean;
  confirmedCount: number;
  pendingConfirmations: number;
  effectiveCapacity: number | null;
  occupationPercent: number | null;
  barWidthPercent: number;
}

export interface EventOverviewSummary {
  registrationKpi: {
    confirmedCount: number;
    capacity: number | null;
    occupationPercent: number | null;
    pendingConfirmations: number;
    waitlistedCount: number;
    activitiesCount: number;
  };
  attendanceKpi: {
    attendedCount: number;
    attendanceRatePercent: number | null;
    activeCredentialsCount: number;
    totalMinutes: number;
    totalVisits: number;
  };
  academicKpi: {
    submissionsCount: number;
    callsCount: number;
    proceedingsCount: number;
    certificatesCount: number;
    speakersCount: number;
  };
  canViewFinance: boolean;
  financeKpi: {
    approvedFundingCents: number;
    settledIncomeCents: number;
    settledExpenseCents: number;
    netBalanceCents: number;
    sponsorsCount: number;
    financialEntriesCount: number;
  };
  operationsKpi: {
    openDemandsCount: number;
    completedDemandsCount: number;
    teamsCount: number;
    roomsCount: number;
  };
  participationFunnel: {
    total: number;
    capacity: number | null;
    capacityPercent: number | null;
    attendedCount: number;
    attendedPercent: number;
    awaitingArrivalCount: number;
    awaitingArrivalPercent: number;
    pendingCount: number;
    pendingPercent: number;
    waitlistedCount: number;
    waitlistedPercent: number;
  };
  topActivitiesOccupation: readonly EventOverviewActivityOccupationItem[];
  financialAndOperationalPulse: {
    hasFinance: boolean;
    approvedFundingCents: number;
    settledIncomeCents: number;
    settledExpenseCents: number;
    approvedBarPercent: number;
    incomeBarPercent: number;
    expenseBarPercent: number;
    pagePublished: boolean | null;
    readinessDoneCount: number;
    readinessTotalCount: number;
    allReady: boolean;
    openDemandsCount: number;
    completedDemandsCount: number;
  };
}

export function resolveEffectiveActivityCapacity(
  activityCapacity: number | null,
  roomCapacity: number | null,
): number | null {
  const candidates = [activityCapacity, roomCapacity].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export function formatOverviewCurrencyBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

export function formatOverviewMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe} min`;
  const hours = Math.floor(safe / 60);
  const rem = safe % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}min`;
}

function sharePercent(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

export function computeEventOverviewSummary(input: {
  eventCapacity: number | null;
  eventConfirmedCount: number;
  activities: readonly EventOverviewActivityInput[];
  areaCounts: EventAreaCounts;
  overviewMetrics: EventOverviewDbMetrics;
  pendingConfirmationsTotal: number;
  canViewFinance: boolean;
  readiness: {
    doneCount: number;
    totalCount: number;
    allReady: boolean;
  };
}): EventOverviewSummary {
  const confirmedCount = Math.max(
    0,
    input.eventConfirmedCount,
    input.overviewMetrics.confirmedRegistrations,
  );
  const capacity =
    input.eventCapacity !== null && input.eventCapacity > 0 ? input.eventCapacity : null;
  const occupationPercent =
    capacity !== null ? Math.min(100, Math.round((confirmedCount / capacity) * 100)) : null;

  const pendingConfirmations = Math.max(
    0,
    input.pendingConfirmationsTotal + input.overviewMetrics.pendingEventRegistrations,
  );
  const waitlistedCount = Math.max(0, input.overviewMetrics.waitlistedRegistrations);
  const activitiesCount = input.areaCounts.activities ?? input.activities.length;

  const attendedCount = Math.max(0, input.overviewMetrics.attendedUsersCount);
  const attendanceRatePercent =
    confirmedCount > 0 ? Math.min(100, Math.round((attendedCount / confirmedCount) * 100)) : null;

  const awaitingArrivalCount = Math.max(0, confirmedCount - attendedCount);
  const funnelAttendedCount = Math.min(attendedCount, confirmedCount);
  const funnelTotal =
    funnelAttendedCount + awaitingArrivalCount + pendingConfirmations + waitlistedCount;

  const topActivitiesOccupation: EventOverviewActivityOccupationItem[] = input.activities
    .map((activity) => {
      const effectiveCapacity = activity.requiresRegistration
        ? resolveEffectiveActivityCapacity(activity.capacity, activity.roomCapacity)
        : null;
      const pct =
        effectiveCapacity !== null
          ? Math.min(100, Math.round((activity.confirmedCount / effectiveCapacity) * 100))
          : null;

      return {
        id: activity.id,
        title: activity.title,
        type: activity.type,
        roomName: activity.roomName,
        requiresRegistration: activity.requiresRegistration,
        confirmedCount: Math.max(0, activity.confirmedCount),
        pendingConfirmations: Math.max(0, activity.pendingConfirmations),
        effectiveCapacity,
        occupationPercent: pct,
        barWidthPercent: pct !== null ? pct : activity.confirmedCount > 0 ? 100 : 0,
      };
    })
    .sort((a, b) => {
      const pctDiff = (b.occupationPercent ?? -1) - (a.occupationPercent ?? -1);
      if (pctDiff !== 0) return pctDiff;
      const confDiff = b.confirmedCount - a.confirmedCount;
      if (confDiff !== 0) return confDiff;
      return b.pendingConfirmations - a.pendingConfirmations;
    })
    .slice(0, 5);

  const approvedFundingCents = Math.max(0, input.overviewMetrics.approvedFundingCents);
  const settledIncomeCents = Math.max(0, input.overviewMetrics.settledIncomeCents);
  const settledExpenseCents = Math.max(0, input.overviewMetrics.settledExpenseCents);
  const netBalanceCents = settledIncomeCents - settledExpenseCents;

  const maxFinanceValue = Math.max(
    1,
    approvedFundingCents,
    settledIncomeCents,
    settledExpenseCents,
  );

  const openDemandsCount = Math.max(0, input.areaCounts.openDemands ?? 0);
  const completedDemandsCount = Math.max(0, input.overviewMetrics.completedDemandsCount);

  return {
    registrationKpi: {
      confirmedCount,
      capacity,
      occupationPercent,
      pendingConfirmations,
      waitlistedCount,
      activitiesCount,
    },
    attendanceKpi: {
      attendedCount,
      attendanceRatePercent,
      activeCredentialsCount: Math.max(0, input.areaCounts.credentials ?? 0),
      totalMinutes: Math.max(0, input.overviewMetrics.attendanceMinutesTotal),
      totalVisits: Math.max(0, input.overviewMetrics.attendanceVisitsCount),
    },
    academicKpi: {
      submissionsCount: Math.max(0, input.overviewMetrics.submissionsCount),
      callsCount: Math.max(0, input.areaCounts.calls ?? 0),
      proceedingsCount: Math.max(0, input.areaCounts.proceedingsEntries ?? 0),
      certificatesCount: Math.max(0, input.areaCounts.certificates ?? 0),
      speakersCount: Math.max(0, input.areaCounts.speakers ?? 0),
    },
    canViewFinance: input.canViewFinance,
    financeKpi: {
      approvedFundingCents,
      settledIncomeCents,
      settledExpenseCents,
      netBalanceCents,
      sponsorsCount: Math.max(0, input.areaCounts.sponsors ?? 0),
      financialEntriesCount: Math.max(0, input.areaCounts.financialEntries ?? 0),
    },
    operationsKpi: {
      openDemandsCount,
      completedDemandsCount,
      teamsCount: Math.max(0, input.areaCounts.teams ?? 0),
      roomsCount: Math.max(0, input.areaCounts.rooms ?? 0),
    },
    participationFunnel: {
      total: funnelTotal,
      capacity,
      capacityPercent: occupationPercent,
      attendedCount: funnelAttendedCount,
      attendedPercent: sharePercent(funnelAttendedCount, funnelTotal),
      awaitingArrivalCount,
      awaitingArrivalPercent: sharePercent(awaitingArrivalCount, funnelTotal),
      pendingCount: pendingConfirmations,
      pendingPercent: sharePercent(pendingConfirmations, funnelTotal),
      waitlistedCount,
      waitlistedPercent: sharePercent(waitlistedCount, funnelTotal),
    },
    topActivitiesOccupation,
    financialAndOperationalPulse: {
      hasFinance: input.canViewFinance,
      approvedFundingCents,
      settledIncomeCents,
      settledExpenseCents,
      approvedBarPercent:
        approvedFundingCents > 0
          ? Math.max(4, Math.round((approvedFundingCents / maxFinanceValue) * 100))
          : 0,
      incomeBarPercent:
        settledIncomeCents > 0
          ? Math.max(4, Math.round((settledIncomeCents / maxFinanceValue) * 100))
          : 0,
      expenseBarPercent:
        settledExpenseCents > 0
          ? Math.max(4, Math.round((settledExpenseCents / maxFinanceValue) * 100))
          : 0,
      pagePublished: input.areaCounts.pagePublished,
      readinessDoneCount: Math.max(0, input.readiness.doneCount),
      readinessTotalCount: Math.max(0, input.readiness.totalCount),
      allReady: input.readiness.allReady,
      openDemandsCount,
      completedDemandsCount,
    },
  };
}

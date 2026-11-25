import Link from 'next/link';
import {
  Activity,
  Award,
  CheckCircle2,
  ClipboardCheck,
  Landmark,
  Users,
} from 'lucide-react';

import {
  formatOverviewCurrencyBrl,
  formatOverviewMinutes,
  type EventOverviewSummary,
} from '@/domain/events/event-overview-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

interface EventOverviewPanelProps {
  tenantSlug: string;
  eventId: string;
  summary: EventOverviewSummary;
}

const KPI_CARD_CLS = 'rounded-xl border border-border bg-card p-4 shadow-sm';
const KPI_HEADER_CLS =
  'flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAINEL EXECUTIVO E GRÁFICO DO EVENTO — SSR PURO (FASE 126)
 *
 *  Regra estrutural obrigatória: este painel NUNCA renderiza `<section>` nem
 *  `<details>` para preservar as invariantes da raiz do evento (F53 · 0 `<details>`,
 *  F77 · exatamente 5 `<section>` estruturais). Toda a leitura visual usa `<div>`,
 *  `role="region"` e `<svg>` puro em Server Component (zero Client JS).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function EventOverviewPanel({
  tenantSlug,
  eventId,
  summary,
}: EventOverviewPanelProps) {
  const {
    registrationKpi,
    attendanceKpi,
    academicKpi,
    canViewFinance,
    financeKpi,
    operationsKpi,
    participationFunnel,
    topActivitiesOccupation,
    financialAndOperationalPulse,
  } = summary;

  const baseEventHref = tenantPath(tenantSlug, `/administracao/eventos/${eventId}`);

  const funnelTotal = participationFunnel.total;
  const pctAttended = funnelTotal > 0 ? (participationFunnel.attendedCount / funnelTotal) * 100 : 0;
  const pctAwaiting =
    funnelTotal > 0 ? (participationFunnel.awaitingArrivalCount / funnelTotal) * 100 : 0;
  const pctPending = funnelTotal > 0 ? (participationFunnel.pendingCount / funnelTotal) * 100 : 0;
  const pctWaitlist =
    funnelTotal > 0 ? Math.max(0, 100 - pctAttended - pctAwaiting - pctPending) : 0;

  return (
    <div
      role="region"
      aria-label="Panorama executivo do evento"
      data-testid="event-overview-panel"
      className="space-y-4"
    >
      {/* ── Faixa 1: 4 Cartões Executivos (KPIs do Evento) ─────────────────── */}
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="event-overview-kpis"
      >
        <div className={KPI_CARD_CLS} data-testid="event-kpi-registrations">
          <div className={KPI_HEADER_CLS}>
            <span>Inscrições & Lotação</span>
            <Users className="size-4 text-primary" aria-hidden />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              {registrationKpi.confirmedCount}
              {registrationKpi.capacity !== null ? (
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}
                  / {registrationKpi.capacity}
                </span>
              ) : null}
            </p>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
              {registrationKpi.occupationPercent !== null
                ? `${registrationKpi.occupationPercent}% ocupado`
                : 'Sem teto'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {registrationKpi.pendingConfirmations} retida(s) · {registrationKpi.waitlistedCount} em
            fila · {registrationKpi.activitiesCount} atividade(s)
          </p>
        </div>

        <div className={KPI_CARD_CLS} data-testid="event-kpi-attendance">
          <div className={KPI_HEADER_CLS}>
            <span>Comparecimento</span>
            <CheckCircle2 className="size-4 text-success-strong" aria-hidden />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              {attendanceKpi.attendanceRatePercent !== null
                ? `${attendanceKpi.attendanceRatePercent}%`
                : '—'}
            </p>
            <span className="text-xs font-medium text-muted-foreground">
              {attendanceKpi.attendedCount} presente(s)
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {attendanceKpi.activeCredentialsCount} crachá(s) ·{' '}
            {formatOverviewMinutes(attendanceKpi.totalMinutes)} em {attendanceKpi.totalVisits}{' '}
            registro(s)
          </p>
        </div>

        <div className={KPI_CARD_CLS} data-testid="event-kpi-academic">
          <div className={KPI_HEADER_CLS}>
            <span>Produção & Certificados</span>
            <Award className="size-4 text-primary" aria-hidden />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              {academicKpi.submissionsCount}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                trabalho(s)
              </span>
            </p>
            <span className="text-xs font-medium text-success-strong">
              {academicKpi.certificatesCount} certificado(s)
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {academicKpi.callsCount} chamada(s) · {academicKpi.proceedingsCount} nos anais ·{' '}
            {academicKpi.speakersCount} palestrante(s)
          </p>
        </div>

        {canViewFinance ? (
          <div className={KPI_CARD_CLS} data-testid="event-kpi-finance">
            <div className={KPI_HEADER_CLS}>
              <span>Caixa & Fomento</span>
              <Landmark className="size-4 text-primary" aria-hidden />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <p
                className={`text-2xl font-semibold tracking-tight ${
                  financeKpi.netBalanceCents < 0 ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {formatOverviewCurrencyBrl(financeKpi.netBalanceCents)}
              </p>
              <Link
                href={`${baseEventHref}/financeiro`}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                data-testid="event-overview-finance-link"
              >
                Ver financeiro →
              </Link>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Entradas: {formatOverviewCurrencyBrl(financeKpi.settledIncomeCents)} · Saídas:{' '}
              {formatOverviewCurrencyBrl(financeKpi.settledExpenseCents)} ·{' '}
              {financeKpi.sponsorsCount} patrocínio(s)
            </p>
          </div>
        ) : (
          <div className={KPI_CARD_CLS} data-testid="event-kpi-operations">
            <div className={KPI_HEADER_CLS}>
              <span>Operação & Equipes</span>
              <ClipboardCheck className="size-4 text-primary" aria-hidden />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <p className="text-2xl font-semibold tracking-tight text-foreground">
                {operationsKpi.completedDemandsCount}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  / {operationsKpi.completedDemandsCount + operationsKpi.openDemandsCount} demanda(s)
                </span>
              </p>
              <span className="text-xs font-medium text-muted-foreground">
                {operationsKpi.openDemandsCount} aberta(s)
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {operationsKpi.teamsCount} equipe(s) ativa(s) · {operationsKpi.roomsCount} sala(s)
            </p>
          </div>
        )}
      </div>

      {/* ── Faixa 2: 3 Painéis Gráficos SSR ─────────────────────────────────── */}
      <div
        className="grid gap-4 lg:grid-cols-3"
        data-testid="event-overview-charts"
      >
        {/* Gráfico 1: Funil de Participação e Presença */}
        <div
          className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="event-chart-funnel"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Funil de participação
              </h2>
              <p className="text-xs text-muted-foreground">
                Distribuição dos inscritos entre presença, confirmação e fila.
              </p>
            </div>
            <Activity className="size-4 shrink-0 text-primary" aria-hidden />
          </div>

          {funnelTotal === 0 ? (
            <p className="py-5 text-xs text-muted-foreground">
              Nenhuma inscrição registrada no evento até o momento.
            </p>
          ) : (
            <div className="space-y-3">
              <svg
                className="block h-3 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`Funil de participação: ${participationFunnel.attendedCount} presentes, ${participationFunnel.awaitingArrivalCount} confirmados aguardando chegada, ${participationFunnel.pendingCount} pendentes e ${participationFunnel.waitlistedCount} em lista de espera`}
              >
                {pctAttended > 0 ? (
                  <rect
                    x="0%"
                    y="0"
                    width={`${pctAttended}%`}
                    height="100%"
                    fill="currentColor"
                    className="text-success"
                  />
                ) : null}
                {pctAwaiting > 0 ? (
                  <rect
                    x={`${pctAttended}%`}
                    y="0"
                    width={`${pctAwaiting}%`}
                    height="100%"
                    fill="currentColor"
                    className="text-primary"
                  />
                ) : null}
                {pctPending > 0 ? (
                  <rect
                    x={`${pctAttended + pctAwaiting}%`}
                    y="0"
                    width={`${pctPending}%`}
                    height="100%"
                    fill="currentColor"
                    className="text-warning"
                  />
                ) : null}
                {pctWaitlist > 0 ? (
                  <rect
                    x={`${pctAttended + pctAwaiting + pctPending}%`}
                    y="0"
                    width={`${pctWaitlist}%`}
                    height="100%"
                    fill="currentColor"
                    className="text-muted-foreground"
                  />
                ) : null}
              </svg>

              <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <li className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-full bg-success" aria-hidden />
                    Presentes
                  </span>
                  <span className="font-medium text-foreground">
                    {participationFunnel.attendedCount} ({participationFunnel.attendedPercent}%)
                  </span>
                </li>
                <li className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-full bg-primary" aria-hidden />
                    A chegar
                  </span>
                  <span className="font-medium text-foreground">
                    {participationFunnel.awaitingArrivalCount} (
                    {participationFunnel.awaitingArrivalPercent}%)
                  </span>
                </li>
                <li className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-full bg-warning" aria-hidden />
                    Retidas
                  </span>
                  <span className="font-medium text-foreground">
                    {participationFunnel.pendingCount} ({participationFunnel.pendingPercent}%)
                  </span>
                </li>
                <li className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-full bg-muted-foreground" aria-hidden />
                    Lista de espera
                  </span>
                  <span className="font-medium text-foreground">
                    {participationFunnel.waitlistedCount} ({participationFunnel.waitlistedPercent}%)
                  </span>
                </li>
              </ul>

              {participationFunnel.capacity !== null && participationFunnel.capacityPercent !== null ? (
                <div className="space-y-1 border-t border-border/60 pt-2 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Lotação do evento</span>
                    <span className="font-medium text-foreground">
                      {participationFunnel.capacityPercent}% de {participationFunnel.capacity} vagas
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Gráfico 2: Ocupação da Programação */}
        <div
          className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="event-chart-activities"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Ocupação da programação
              </h2>
              <p className="text-xs text-muted-foreground">
                Atividades com maior demanda em relação ao teto de sala/vaga.
              </p>
            </div>
            <Link
              href={`${baseEventHref}/programacao`}
              className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Programação →
            </Link>
          </div>

          {topActivitiesOccupation.length === 0 ? (
            <p className="py-5 text-xs text-muted-foreground">
              Nenhuma atividade cadastrada na programação deste evento.
            </p>
          ) : (
            <div className="space-y-2.5">
              {topActivitiesOccupation.map((activity) => {
                const isFull =
                  activity.occupationPercent !== null && activity.occupationPercent >= 90;

                return (
                  <div key={activity.id} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-foreground">
                        {activity.title}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {activity.effectiveCapacity !== null
                          ? `${activity.confirmedCount}/${activity.effectiveCapacity} (${activity.occupationPercent}%)`
                          : activity.requiresRegistration
                            ? `${activity.confirmedCount} inscrito(s)`
                            : 'Aberta ao evento'}
                      </span>
                    </div>
                    <svg
                      className="block h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`Ocupação de ${activity.title}: ${activity.confirmedCount}${
                        activity.effectiveCapacity !== null ? ` de ${activity.effectiveCapacity}` : ''
                      }`}
                    >
                      {activity.requiresRegistration ? (
                        <rect
                          x="0"
                          y="0"
                          width={`${Math.min(
                            100,
                            Math.max(activity.confirmedCount > 0 ? 3 : 0, activity.barWidthPercent),
                          )}%`}
                          height="100%"
                          rx={4}
                          fill="currentColor"
                          className={isFull ? 'text-warning' : 'text-primary'}
                        />
                      ) : (
                        <rect
                          x="0"
                          y="0"
                          width="100%"
                          height="100%"
                          rx={4}
                          fill="currentColor"
                          className="text-secondary-strong/25"
                        />
                      )}
                    </svg>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Gráfico 3: Execução Financeira & Pulso Operacional */}
        <div
          className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
          data-testid="event-chart-pulse"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {financialAndOperationalPulse.hasFinance
                  ? 'Termômetro financeiro & pulso'
                  : 'Pulso operacional do evento'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {financialAndOperationalPulse.hasFinance
                  ? 'Comparativo de fomento, entradas e saídas liquidadas.'
                  : 'Estado de publicação, partida e andamento das demandas.'}
              </p>
            </div>
            {financialAndOperationalPulse.hasFinance ? (
              <Link
                href={`${baseEventHref}/financeiro`}
                className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Detalhes →
              </Link>
            ) : null}
          </div>

          {financialAndOperationalPulse.hasFinance ? (
            <div className="space-y-2.5 text-xs">
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Teto aprovado</span>
                  <span className="font-medium text-foreground">
                    {formatOverviewCurrencyBrl(financialAndOperationalPulse.approvedFundingCents)}
                  </span>
                </div>
                <svg
                  className="block h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Teto aprovado: ${formatOverviewCurrencyBrl(financialAndOperationalPulse.approvedFundingCents)}`}
                >
                  <rect
                    x="0"
                    y="0"
                    width={`${financialAndOperationalPulse.approvedBarPercent}%`}
                    height="100%"
                    rx={4}
                    fill="currentColor"
                    className="text-primary"
                  />
                </svg>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Entradas recebidas</span>
                  <span className="font-medium text-success-strong">
                    {formatOverviewCurrencyBrl(financialAndOperationalPulse.settledIncomeCents)}
                  </span>
                </div>
                <svg
                  className="block h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Entradas recebidas: ${formatOverviewCurrencyBrl(financialAndOperationalPulse.settledIncomeCents)}`}
                >
                  <rect
                    x="0"
                    y="0"
                    width={`${financialAndOperationalPulse.incomeBarPercent}%`}
                    height="100%"
                    rx={4}
                    fill="currentColor"
                    className="text-success"
                  />
                </svg>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Saídas pagas</span>
                  <span className="font-medium text-foreground">
                    {formatOverviewCurrencyBrl(financialAndOperationalPulse.settledExpenseCents)}
                  </span>
                </div>
                <svg
                  className="block h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Saídas pagas: ${formatOverviewCurrencyBrl(financialAndOperationalPulse.settledExpenseCents)}`}
                >
                  <rect
                    x="0"
                    y="0"
                    width={`${financialAndOperationalPulse.expenseBarPercent}%`}
                    height="100%"
                    rx={4}
                    fill="currentColor"
                    className="text-destructive"
                  />
                </svg>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-2.5 text-xs">
            <span className="rounded-md bg-surface-low px-2.5 py-1 font-medium text-foreground">
              Vitrine:{' '}
              {financialAndOperationalPulse.pagePublished === null
                ? 'sem leitura'
                : financialAndOperationalPulse.pagePublished
                  ? 'publicada'
                  : 'em rascunho'}
            </span>
            <span className="rounded-md bg-surface-low px-2.5 py-1 font-medium text-foreground">
              Partida: {financialAndOperationalPulse.readinessDoneCount}/
              {financialAndOperationalPulse.readinessTotalCount}
            </span>
            <span className="rounded-md bg-surface-low px-2.5 py-1 font-medium text-foreground">
              Demandas: {financialAndOperationalPulse.completedDemandsCount} concl. ·{' '}
              {financialAndOperationalPulse.openDemandsCount} aberta(s)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

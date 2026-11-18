import { Suspense } from 'react';
import { ScanLine } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { withTenant } from '@/lib/db/tenant-client';
import { getCheckinDeskSummary } from '@/lib/events/attendance-service';
import {
  CheckinEventFilter,
  CheckinSearchFilter,
  CheckinTabBar,
} from '@/components/credentials/checkin-filter-bar';
import {
  CheckinQueueSection,
  CheckinQueueSkeleton,
} from '@/components/credentials/checkin-queue-section';
import { MonitorConsole, type MonitorActivity } from '@/components/credentials/monitor-console';
import { SelfCheckinManager } from '@/components/credentials/self-checkin-manager';
import { closeSessionsAction, recordPresenceAction } from '@/app/actions/credential-actions';
import {
  deleteSelfCheckinPointAction,
  regenerateSelfCheckinPointAction,
  saveSelfCheckinPolicyAction,
  upsertSelfCheckinPointAction,
} from '@/app/actions/self-checkin-actions';
import {
  buildCheckinHref,
  resolveCheckinQueueStatusFilter,
  resolveCheckinTab,
} from '@/domain/events/checkin-console-rules';
import {
  getSelfCheckinConsoleData,
  getSelfCheckinStatusSummary,
} from '@/lib/events/self-checkin-service';
import { resolveEventQuerySelection } from '@/domain/validation/query-filter-rules';
import { Alert, AppLink, Badge, PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Credenciamento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CREDENCIAMENTO (FASE 31 · REFINADO EM FASE 114)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEPARAÇÃO DE FLUXOS POR FREQUÊNCIA DE USO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • Aba `Balcão ao vivo` (padrão): grade desktop em 2 colunas com Leitor / Modo
 *      Monitor à esquerda e Busca Manual por Nome à direita, isolada em `<Suspense>`
 *      para que digitar na busca nunca bloqueie a leitura do crachá;
 *    • Aba `Autocredenciamento & Cartazes` (`?aba=autocredenciamento`): política
 *      antifraude recolhível, cartazes A4 e Modo Telão sem competir com a fila;
 *    • Todos os dados da casca vêm de uma única transação `withTenant` sem chamar
 *      `getRequestContext()` uma segunda vez nem duplicar a leitura de atividades.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function CheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    evento?: string;
    q?: string;
    aba?: string;
    situacao?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const { evento, q, aba, situacao } = await searchParams;

  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
    /**
     * FASE 12 (item I7): a equipe do dia recebe `STAFF` no escopo do EVENTO.
     * Escopo estreito continua restrito ao próprio evento no filtro abaixo.
     */
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const activeTab = resolveCheckinTab(aba);
  const statusFilter = resolveCheckinQueueStatusFilter(situacao);
  const isTenantWide = can(principal, PERMISSIONS.REGISTRATION_CHECKIN, { scope: 'TENANT' });

  const bootstrap = await withTenant(tenantId, async (tx) => {
    const allEvents = await tx.event.findMany({
      where: { tenantId, deletedAt: null, status: { not: 'DRAFT' } },
      orderBy: { startsAt: 'desc' },
      take: 30,
      select: {
        id: true,
        title: true,
        slug: true,
        startsAt: true,
        status: true,
        timezone: true,
      },
    });

    const events = isTenantWide
      ? allEvents
      : allEvents.filter((event) =>
          can(principal, PERMISSIONS.REGISTRATION_CHECKIN, {
            scope: 'EVENT',
            eventId: event.id,
          }),
        );

    const eventSelection = resolveEventQuerySelection({
      value: evento,
      events,
      fallback: 'first',
    });

    const { selectedEventId, selectedEvent } = eventSelection;

    if (!selectedEventId || !selectedEvent) {
      return {
        events,
        eventSelection,
        activities: [],
        nowMs: 0,
        deskSummary: { confirmedRegistrations: 0, insideNowCount: 0 },
        selfCheckinSummary: { enabled: false, activePointsCount: 0, hasCoordinates: false },
        selfCheckinData: null,
      };
    }

    const [activities, clock, deskSummary] = await Promise.all([
      tx.activity.findMany({
        where: { tenantId, eventId: selectedEventId, deletedAt: null, status: { not: 'CANCELED' } },
        orderBy: { startsAt: 'asc' },
        take: 200,
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          modality: true,
          checkInEnabled: true,
          requiresRegistration: true,
          room: { select: { name: true } },
        },
      }),
      tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`,
      getCheckinDeskSummary(tenantId, selectedEventId, tx),
    ]);

    const nowDate = clock[0]?.now ?? new Date(0);
    const nowMs = nowDate.getTime();

    if (activeTab === 'autocredenciamento') {
      const selfCheckinData = await getSelfCheckinConsoleData(tenantId, selectedEventId, nowDate, {
        tx,
        activities,
      });
      const activePointsCount =
        (selfCheckinData?.portariaPoint?.isActive ? 1 : 0) +
        (selfCheckinData?.activities.filter((act) => act.point?.isActive).length ?? 0);

      return {
        events,
        eventSelection,
        activities,
        nowMs,
        deskSummary,
        selfCheckinSummary: {
          enabled: selfCheckinData?.policy.enabled ?? false,
          activePointsCount,
          hasCoordinates:
            selfCheckinData?.latitude !== null && selfCheckinData?.longitude !== null,
        },
        selfCheckinData,
      };
    }

    const selfCheckinSummary = await getSelfCheckinStatusSummary(tenantId, selectedEventId, tx);

    return {
      events,
      eventSelection,
      activities,
      nowMs,
      deskSummary,
      selfCheckinSummary,
      selfCheckinData: null,
    };
  });

  const { events, eventSelection, activities, nowMs, deskSummary, selfCheckinSummary, selfCheckinData } =
    bootstrap;
  const { selectedEventId, selectedEvent } = eventSelection;
  const eventTimeZone = selectedEvent?.timezone ?? 'America/Sao_Paulo';

  const monitorActivities: MonitorActivity[] = activities.map((activity) => ({
    id: activity.id,
    title: activity.title,
    startsAtIso: activity.startsAt.toISOString(),
    endsAtIso: activity.endsAt.toISOString(),
    roomName: activity.room?.name ?? null,
    isNow: activity.startsAt.getTime() <= nowMs && activity.endsAt.getTime() >= nowMs,
    checkInEnabled: activity.checkInEnabled,
  }));

  const queueActivities = activities.map((activity) => ({
    id: activity.id,
    title: activity.title,
    requiresRegistration: activity.requiresRegistration,
    isNow: activity.startsAt.getTime() <= nowMs && activity.endsAt.getTime() >= nowMs,
  }));

  const canManageBadges = Boolean(
    can(principal, PERMISSIONS.ATTENDANCE_MANAGE, { scope: 'TENANT' }) ||
      (selectedEventId &&
        can(principal, PERMISSIONS.ATTENDANCE_MANAGE, {
          scope: 'EVENT',
          eventId: selectedEventId,
        })),
  );

  const queueFilterKey = `${selectedEventId ?? 'none'}:${q ?? ''}:${statusFilter}`;

  return (
    <main className="max-w-6xl space-y-6">
      <PageHeader
        title="Credenciamento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<ScanLine className="size-6 text-primary" aria-hidden />}
        description={
          <>
            Leia o crachá para registrar a <strong>chegada ao evento</strong> ou a{' '}
            <strong>frequência em uma atividade</strong> — a frequência é o que compõe a carga do
            certificado e o peso do sorteio.
          </>
        }
      />

      {eventSelection.discardedNotice ? (
        <Alert tone="warning" data-testid="checkin-event-notice">
          {eventSelection.discardedNotice}
        </Alert>
      ) : null}

      {events.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {isTenantWide
            ? 'Nenhum evento publicado nesta instituição.'
            : 'Você não é equipe de nenhum evento desta instituição. Peça à organização a concessão de STAFF no evento em que vai atuar.'}
        </p>
      ) : (
        <>
          <CheckinEventFilter
            tenantSlug={tenantSlug}
            events={events}
            selectedEventId={selectedEventId}
            canManageBadges={canManageBadges}
            activeTab={activeTab}
          />

          {selectedEventId ? (
            <>
              <CheckinTabBar
                tenantSlug={tenantSlug}
                eventId={selectedEventId}
                activeTab={activeTab}
                selfCheckinEnabled={selfCheckinSummary.enabled}
                activePointsCount={selfCheckinSummary.activePointsCount}
              />

              <section
                aria-label="Resumo operacional"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-low px-4 py-3 text-xs"
                data-testid="checkin-desk-summary"
              >
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <span className="text-muted-foreground">Inscrições elegíveis: </span>
                    <strong className="font-semibold text-foreground">
                      {deskSummary.confirmedRegistrations}
                    </strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sessões abertas agora: </span>
                    <strong className="font-semibold text-foreground">
                      {deskSummary.insideNowCount}
                    </strong>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">QR autoatendimento:</span>
                    <Badge tone={selfCheckinSummary.enabled ? 'success' : 'neutral'}>
                      {selfCheckinSummary.enabled
                        ? `${selfCheckinSummary.activePointsCount} ativo(s)`
                        : 'Desativado'}
                    </Badge>
                  </div>
                </div>

                {activeTab === 'balcao' ? (
                  <AppLink
                    href={buildCheckinHref({
                      tenantSlug,
                      eventId: selectedEventId,
                      tab: 'autocredenciamento',
                    })}
                    className="font-medium text-primary hover:underline"
                  >
                    Configurar QR Codes e cartazes →
                  </AppLink>
                ) : null}
              </section>

              {activeTab === 'autocredenciamento' && selfCheckinData ? (
                <SelfCheckinManager
                  key={selfCheckinData.eventId}
                  tenantSlug={tenantSlug}
                  data={selfCheckinData}
                  eventTimeZone={eventTimeZone}
                  canManageSecurity={canManageBadges}
                  savePolicyAction={saveSelfCheckinPolicyAction}
                  upsertPointAction={upsertSelfCheckinPointAction}
                  regeneratePointAction={regenerateSelfCheckinPointAction}
                  deletePointAction={deleteSelfCheckinPointAction}
                />
              ) : (
                <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
                  <div className="rounded-xl border border-border bg-card p-5 lg:col-span-7">
                    <MonitorConsole
                      tenantSlug={tenantSlug}
                      eventId={selectedEventId}
                      eventTitle={selectedEvent?.title ?? ''}
                      activities={monitorActivities}
                      action={recordPresenceAction}
                      closeAction={closeSessionsAction}
                    />
                  </div>

                  {/* ── Caminho de EXCEÇÃO: busca manual por nome ─────────────── */}
                  <section
                    className="space-y-4 rounded-xl border border-border bg-card p-5 lg:col-span-5"
                    aria-labelledby="busca"
                  >
                    <header className="space-y-1">
                      <h2 id="busca" className="text-base font-semibold tracking-tight">
                        Sem crachá à mão? Busque pelo nome
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Crachá perdido, leitor quebrado ou sem emissão prévia: localize a inscrição e
                        registre entrada/saída por aqui.
                      </p>
                    </header>

                    <CheckinSearchFilter
                      tenantSlug={tenantSlug}
                      selectedEventId={selectedEventId}
                      initialQuery={q ?? ''}
                      statusFilter={statusFilter}
                    />

                    <Suspense fallback={<CheckinQueueSkeleton />}>
                      <CheckinQueueSection
                        key={queueFilterKey}
                        tenantId={tenantId}
                        tenantSlug={tenantSlug}
                        eventId={selectedEventId}
                        eventTimeZone={eventTimeZone}
                        query={q}
                        statusFilter={statusFilter}
                        activities={queueActivities}
                      />
                    </Suspense>
                  </section>
                </div>
              )}
            </>
          ) : null}
        </>
      )}
    </main>
  );
}

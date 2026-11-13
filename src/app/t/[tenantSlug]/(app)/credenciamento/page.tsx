import { AlertTriangle, ScanLine } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { getRequestContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { withTenant } from '@/lib/db/tenant-client';
import { listCheckinQueue } from '@/lib/events/attendance-service';
import {
  CheckinEventFilter,
  CheckinSearchFilter,
} from '@/components/credentials/checkin-filter-bar';
import { CheckinQueue } from '@/components/gamification/checkin-queue';
import { MonitorConsole, type MonitorActivity } from '@/components/credentials/monitor-console';
import { checkInAction, checkOutAction } from '@/app/actions/attendance-actions';
import { closeSessionsAction, recordPresenceAction } from '@/app/actions/credential-actions';
import { resolveEventQuerySelection } from '@/domain/validation/query-filter-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { Alert, PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Credenciamento' };
export const dynamic = 'force-dynamic';


/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CREDENCIAMENTO (FASE 7, refeito na FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDOU, E POR QUE A TELA INTEIRA MUDOU DE EIXO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela era uma BUSCA por nome com entrada/saída por inscrição. Funcionava para o
 *  balcão com fila lenta, e não respondia o que o evento faz de verdade:
 *
 *    • o monitor lê o CRACHÁ (câmera, leitor USB ou à mão) — não digita nomes;
 *    • a leitura acontece em um CONTEXTO (a portaria ou a atividade que está
 *      acontecendo), e é o contexto que decide onde o fato é gravado;
 *    • "chegou ao evento" e "esteve nesta atividade" são fatos diferentes, com contas
 *      diferentes (carga do certificado, peso do sorteio, carta de presença total).
 *
 *  A busca por nome continua aqui embaixo, como CAMINHO DE EXCEÇÃO: crachá perdido,
 *  leitor quebrado, pessoa sem crachá emitido. No palco, o caminho comum precisa ser
 *  o mais curto — e o de exceção precisa existir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function CheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ evento?: string; q?: string }>;
}) {
  const { tenantSlug } = await params;
  const { evento, q } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
    /**
     * FASE 12 (item I7): a equipe do dia recebe `STAFF` no escopo do EVENTO — é o
     * padrão que o próprio seed usa. Exigir escopo de instituição aqui fazia o
     * papel recomendado pela plataforma ser recusado pela própria plataforma.
     */
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const allEvents = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: { tenantId, deletedAt: null, status: { not: 'DRAFT' } },
      orderBy: { startsAt: 'desc' },
      take: 30,
      select: { id: true, title: true, slug: true, startsAt: true, status: true },
    }),
  );

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O ESCOPO ESTREITO NÃO PODE VIRAR ACESSO LARGO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Quem tem o papel na INSTITUIÇÃO credencia todos os eventos dela. Quem tem o
   *  papel em EVENTOS credencia — e enxerga — apenas os seus. A guarda aceitou o
   *  escopo de evento; é aqui que ele é respeitado.
   */
  const context = await getRequestContext();
  const principal = context?.principal;

  const isTenantWide = can(principal, PERMISSIONS.REGISTRATION_CHECKIN, { scope: 'TENANT' });

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

  const [queue, activities, clock] = await Promise.all([
    selectedEventId
      ? listCheckinQueue(tenantId, selectedEventId, { query: q, limit: 60 })
      : Promise.resolve(null),
    selectedEventId
      ? withTenant(tenantId, (tx) =>
        tx.activity.findMany({
          where: { tenantId, eventId: selectedEventId, deletedAt: null, status: { not: 'CANCELED' } },
          orderBy: { startsAt: 'asc' },
          take: 200,
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            checkInEnabled: true,
            room: { select: { name: true } },
          },
        }),
      )
      : Promise.resolve([]),
    /**
     * O "agora" vem do BANCO, e não de `Date.now()`: o React Compiler recusa função
     * impura no corpo do componente, e o relógio do banco é o MESMO que carimba as
     * presenças — a sugestão de "atividade acontecendo agora" não pode discordar do
     * horário que ficou gravado na leitura.
     */
    withTenant(tenantId, (tx) => tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`),
  ]);

  /**
   * O "agora" que sugere a atividade em curso vem da PÁGINA, e não do render: o React
   * Compiler recusa função impura no corpo do componente (`Date.now`), e o horário
   * do servidor é o que a grade usa.
   */
  const now = clock[0]?.now?.getTime() ?? 0;

  const monitorActivities: MonitorActivity[] = activities.map((activity) => ({
    id: activity.id,
    title: activity.title,
    startsAtIso: activity.startsAt.toISOString(),
    endsAtIso: activity.endsAt.toISOString(),
    roomName: activity.room?.name ?? null,
    isNow: activity.startsAt.getTime() <= now && activity.endsAt.getTime() >= now,
    checkInEnabled: activity.checkInEnabled,
  }));

  const entries = queue?.ok
    ? queue.entries.map((entry) => ({
      registrationId: entry.registrationId,
      userName: entry.userName,
      userEmail: entry.userEmail,
      activityTitle: entry.activityTitle,
      isInside: entry.isInside,
      checkedInAtLabel: entry.checkedInAt
        ? entry.checkedInAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : null,
    }))
    : [];

  return (
    <main className="max-w-4xl space-y-8">
      <PageHeader
        title="Credenciamento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<ScanLine className="size-6 text-primary" aria-hidden />}
        description={
          <>
            Leia o crachá para registrar a <strong>chegada ao evento</strong> ou a{' '}
            <strong>frequência em uma atividade</strong> — são fatos diferentes: a frequência é o que
            compõe a carga do certificado e o peso do sorteio.
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
            canManageBadges={
              Boolean(can(principal, PERMISSIONS.ATTENDANCE_MANAGE, {
                scope: 'TENANT',
              }) || (selectedEventId && can(principal, PERMISSIONS.ATTENDANCE_MANAGE, { scope: 'EVENT', eventId: selectedEventId })))
            }
          />

          {selectedEventId ? (
            <MonitorConsole
              tenantSlug={tenantSlug}
              eventId={selectedEventId}
              eventTitle={selectedEvent?.title ?? ''}
              activities={monitorActivities}
              action={recordPresenceAction}
              closeAction={closeSessionsAction}
            />
          ) : null}

          {/* ── Caminho de EXCEÇÃO: busca por nome ───────────────────────────── */}
          <section className="space-y-3" aria-labelledby="busca">
            <h2 id="busca" className="text-base font-semibold tracking-tight">
              Sem crachá à mão? Busque pelo nome
            </h2>
            <p className="text-xs text-muted-foreground">
              Crachá perdido, leitor quebrado ou pessoa sem crachá emitido: encontre a inscrição e registre
              entrada/saída por aqui.
            </p>

            <CheckinSearchFilter
              tenantSlug={tenantSlug}
              selectedEventId={selectedEventId}
              initialQuery={q ?? ''}
            />

            {queue && !queue.ok ? (
              <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
                <AlertTriangle className="size-4" aria-hidden />
                {queue.message}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground" data-testid="queue-total">
                  {queue?.ok ? `${queue.total} inscrição(ões) confirmada(s)` : ''}
                  {q ? ` para "${q}"` : ''}
                </p>

                <CheckinQueue
                  entries={entries}
                  tenantSlug={tenantSlug}
                  checkInAction={checkInAction}
                  checkOutAction={checkOutAction}
                  clearSearchHref={
                    q
                      ? tenantPath(
                          tenantSlug,
                          `/credenciamento${selectedEventId ? `?evento=${selectedEventId}` : ''}`,
                        )
                      : undefined
                  }
                />
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}

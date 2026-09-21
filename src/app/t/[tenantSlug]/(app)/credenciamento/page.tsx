import Link from 'next/link';
import { AlertTriangle, IdCard, ScanLine } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { getRequestContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { withTenant } from '@/lib/db/tenant-client';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listCheckinQueue } from '@/lib/events/attendance-service';
import { CheckinQueue } from '@/components/gamification/checkin-queue';
import { MonitorConsole, type MonitorActivity } from '@/components/credentials/monitor-console';
import { checkInAction, checkOutAction } from '@/app/actions/attendance-actions';
import { closeSessionsAction, recordPresenceAction } from '@/app/actions/credential-actions';

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

  const { tenantId, tenantName } = await requirePagePermission({
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

  const selectedEventId = evento && events.some((event) => event.id === evento) ? evento : events[0]?.id ?? null;
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

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
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ScanLine className="size-6 text-primary" aria-hidden />
          Credenciamento
        </h1>
        <p className="text-sm text-muted-foreground">
          Leia o crachá para registrar a <strong>chegada ao evento</strong> ou a{' '}
          <strong>frequência em uma atividade</strong> — são fatos diferentes: a frequência é o que
          compõe a carga do certificado e o peso do sorteio.
        </p>
      </header>

      {events.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {isTenantWide
            ? 'Nenhum evento publicado nesta instituição.'
            : 'Você não é equipe de nenhum evento desta instituição. Peça à organização a concessão de STAFF no evento em que vai atuar.'}
        </p>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" data-testid="checkin-filters">
            <label className="space-y-1 text-xs font-medium">
              Evento
              <select
                name="evento"
                defaultValue={selectedEventId ?? ''}
                className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm"
                aria-label="Evento"
                data-testid="checkin-event"
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title} · {event.startsAt.toLocaleDateString('pt-BR')}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              Trocar de evento
            </button>

            {can(principal, PERMISSIONS.ATTENDANCE_MANAGE, {
              scope: 'TENANT',
            }) || (selectedEventId && can(principal, PERMISSIONS.ATTENDANCE_MANAGE, { scope: 'EVENT', eventId: selectedEventId })) ? (
              <Link
                href={tenantPath(tenantSlug, `/credenciamento/crachas?evento=${selectedEventId ?? ''}`)}
                data-testid="checkin-badges-link"
                className="inline-flex items-center gap-2 rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
              >
                <IdCard className="size-4" aria-hidden />
                Crachás: emitir e imprimir
              </Link>
            ) : null}
          </form>

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

            <form method="get" className="flex flex-wrap items-end gap-3" data-testid="checkin-search-form">
              <input type="hidden" name="evento" value={selectedEventId ?? ''} />
              <label className="space-y-1 text-xs font-medium">
                Buscar
                <input
                  type="search"
                  name="q"
                  defaultValue={q ?? ''}
                  placeholder="nome, e-mail ou crachá"
                  className="block min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  aria-label="Buscar participante"
                  data-testid="checkin-search"
                />
              </label>

              <button
                type="submit"
                className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
              >
                Buscar
              </button>
            </form>

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
                />
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}

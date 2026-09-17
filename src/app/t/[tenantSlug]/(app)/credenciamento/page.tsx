import { AlertTriangle, ScanLine } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { getRequestContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { withTenant } from '@/lib/db/tenant-client';
import { listCheckinQueue } from '@/lib/events/attendance-service';
import { CheckinQueue } from '@/components/gamification/checkin-queue';
import { BadgeCheckinForm } from '@/components/gamification/badge-checkin-form';
import { checkInAction, checkOutAction } from '@/app/actions/attendance-actions';
import { checkInByBadgeAction } from '@/app/actions/admin-actions';

export const metadata = { title: 'Credenciamento' };
export const dynamic = 'force-dynamic';

/**
 * Credenciamento do evento (operação de balcão).
 *
 * Versão mínima e funcional: escolher o evento, buscar a pessoa e registrar
 * entrada/saída. O painel completo de credenciamento — leitura de QR Code,
 * etiqueta de crachá, indicadores de comparecimento — entra na FASE 7; o que
 * existe aqui é a operação que NÃO pode faltar, porque é ela que gera a presença
 * que a gamificação (e a certificação da FASE 6) consomem.
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

  const queue = selectedEventId
    ? await listCheckinQueue(tenantId, selectedEventId, { query: q, limit: 60 })
    : null;

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
          Registre a entrada do participante. A presença vale XP e feeda as missões — e, a partir da
          FASE 6, é o que sustenta a emissão de certificado.
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
          {/*
            O credenciamento por crachá vem PRIMEIRO: no balcão, o fluxo comum é o
            QR Code. A busca por nome é o caminho de exceção (crachá perdido, leitor
            quebrado) — não o contrário.
          */}
          <BadgeCheckinForm tenantSlug={tenantSlug} action={checkInByBadgeAction} />

          <form method="get" className="flex flex-wrap items-end gap-3" data-testid="checkin-filters">
            <label className="space-y-1 text-xs font-medium">
              Evento
              <select
                name="evento"
                defaultValue={selectedEventId ?? ''}
                className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm"
                aria-label="Evento"
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title} · {event.startsAt.toLocaleDateString('pt-BR')}
                  </option>
                ))}
              </select>
            </label>

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
        </>
      )}
    </main>
  );
}

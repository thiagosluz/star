import Link from 'next/link';
import { ArrowLeft, Contact, Search } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getRequestContext } from '@/lib/auth/session';
import { withTenant } from '@/lib/db/tenant-client';
import { listParticipants } from '@/lib/participants/participant-service';
import { ENGAGEMENT_LABELS, PARTICIPANT_ORIGIN_LABELS } from '@/domain/participants/participant-rules';
import { ParticipantDirectory, type DirectoryEntry } from '@/components/participants/participant-directory';
import { sendParticipantMessageAction } from '@/app/actions/participant-actions';

export const metadata = { title: 'Participantes' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DIRETÓRIO DE PARTICIPANTES DA INSTITUIÇÃO (FASE 32)
 *  `/t/<slug>/participantes?busca=&evento=&certificado=1&presente=1&pagina=2`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA TELA EXISTE (E O QUE ELA NÃO É)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até aqui a instituição só conseguia ver pessoas por EVENTO (a lista de crachás, a
 *  lista de inscritos) — nunca a PESSOA. Quem participou de quatro eventos ao longo
 *  de dois anos não tinha um lugar onde aparecesse inteiro.
 *
 *  Ela NÃO é a tela de equipe (`/administracao/equipe`, que é sobre vínculo e papel)
 *  nem o credenciamento (que é sobre o dia do evento). É o cadastro vivo do público:
 *  quem é, o que viveu aqui e o que já recebemos de nós.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O E-MAIL COMPLETO NÃO APARECE NA LISTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `maskEmail` roda no servidor, e a lista recebe o endereço já mascarado: a tela é
 *  copiada, printada e projetada. O endereço completo é dado de contato e aparece na
 *  ficha — onde a abertura fica registrada na trilha.
 *
 *  A exportação (CSV) é ação de OUTRA permissão? Não: é a mesma (`participant:read`),
 *  mas deixa rastro próprio (`AuditAction.EXPORT`) com autor, filtros e número de
 *  linhas, porque um arquivo sai da plataforma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function ParticipantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    busca?: string;
    evento?: string;
    certificado?: string;
    presente?: string;
    pagina?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const { busca, evento, certificado, presente, pagina } = await searchParams;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PARTICIPANT_READ,
  });

  const context = await getRequestContext();

  /** A permissão de LER não implica a de FALAR: quem não pode enviar não vê o painel. */
  const canMessage =
    can(context?.principal ?? null, PERMISSIONS.PARTICIPANT_MESSAGE, { scope: 'TENANT' }) === true;

  const events = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: { tenantId, deletedAt: null, status: { not: 'DRAFT' } },
      orderBy: { startsAt: 'desc' },
      take: 50,
      select: { id: true, title: true, startsAt: true },
    }),
  );

  const selectedEventId = evento && events.some((event) => event.id === evento) ? evento : null;

  const listing = await listParticipants({
    tenantId,
    query: busca?.trim() || undefined,
    eventId: selectedEventId ?? undefined,
    onlyWithCertificate: certificado === '1',
    onlyAttended: presente === '1',
    page: Number.parseInt(pagina ?? '1', 10) || 1,
  });

  const entries: DirectoryEntry[] =
    listing.ok === true
      ? listing.entries.map((entry) => ({
          userId: entry.userId,
          name: entry.name,
          emailMasked: entry.emailMasked,
          originLabel: PARTICIPANT_ORIGIN_LABELS[entry.origin],
          events: entry.events,
          confirmed: entry.confirmed,
          attended: entry.attended,
          visits: entry.visits,
          minutes: entry.minutes,
          certificates: entry.certificates,
          cards: entry.cards,
          xp: entry.xp,
          rateLabel: entry.rate.hasData ? `${entry.rate.percent}%` : '—',
          ratePercent: entry.rate.percent,
          engagement: entry.engagement.map((tag) => ENGAGEMENT_LABELS[tag]),
          lastActivityLabel: entry.lastActivityAt
            ? entry.lastActivityAt.toLocaleDateString('pt-BR')
            : null,
        }))
      : [];

  const query = new URLSearchParams();
  if (busca) query.set('busca', busca);
  if (selectedEventId) query.set('evento', selectedEventId);
  if (certificado === '1') query.set('certificado', '1');
  if (presente === '1') query.set('presente', '1');

  const exportPath = `/api/t/${tenantSlug}/participantes/exportar${query.size > 0 ? `?${query}` : ''}`;
  const pageHref = (target: number): string => {
    const next = new URLSearchParams(query);
    next.set('pagina', String(target));

    return `${tenantPath(tenantSlug, '/participantes')}?${next}`;
  };

  return (
    <main className="max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/dashboard')}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3" aria-hidden />
            Painel
          </Link>
        </nav>

        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Contact className="size-6 text-primary" aria-hidden />
          Participantes
        </h1>
        <p className="text-sm text-muted-foreground">
          Todas as pessoas que já participaram de algum evento desta instituição — com presença,
          certificados, cartas e XP somados. O e-mail aparece mascarado; a ficha mostra o endereço
          completo e registra quem abriu.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="participant-filters">
        <label className="space-y-1 text-xs font-medium">
          Buscar
          <input
            type="search"
            name="busca"
            defaultValue={busca ?? ''}
            placeholder="nome ou e-mail"
            aria-label="Buscar participante"
            data-testid="participant-search"
            className="block min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
        </label>

        <label className="space-y-1 text-xs font-medium">
          Evento
          <select
            name="evento"
            defaultValue={selectedEventId ?? ''}
            aria-label="Evento"
            data-testid="participant-event"
            className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          >
            <option value="">Todos os eventos</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} · {event.startsAt.toLocaleDateString('pt-BR')}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            name="certificado"
            value="1"
            defaultChecked={certificado === '1'}
            data-testid="participant-only-certificate"
            className="size-3.5"
          />
          Só quem tem certificado
        </label>

        <label className="flex items-center gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            name="presente"
            value="1"
            defaultChecked={presente === '1'}
            data-testid="participant-only-attended"
            className="size-3.5"
          />
          Só quem já compareceu
        </label>

        <button
          type="submit"
          data-testid="participant-filter-apply"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
        >
          <Search className="size-3.5" aria-hidden />
          Filtrar
        </button>
      </form>

      {!listing.ok ? (
        <p className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {listing.message}
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground" data-testid="participant-summary">
              {listing.page.total} pessoa(s) na instituição · página {listing.page.page} de{' '}
              {listing.page.totalPages}
            </p>

            {listing.truncated ? (
              <p className="text-xs text-warning-strong" data-testid="participant-truncated">
                A lista mostra as primeiras pessoas do filtro — refine a busca ou exporte o CSV para o
                conjunto completo.
              </p>
            ) : null}
          </div>

          <ParticipantDirectory
            entries={entries}
            tenantSlug={tenantSlug}
            action={sendParticipantMessageAction}
            exportPath={exportPath}
            canMessage={canMessage}
            selectedEventId={selectedEventId}
          />

          {listing.page.totalPages > 1 ? (
            <nav className="flex items-center gap-3 text-sm" data-testid="participant-pagination">
              {listing.page.page > 1 ? (
                <Link href={pageHref(listing.page.page - 1)} className="underline underline-offset-4">
                  Anterior
                </Link>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {listing.page.page} / {listing.page.totalPages}
              </span>
              {listing.page.page < listing.page.totalPages ? (
                <Link href={pageHref(listing.page.page + 1)} className="underline underline-offset-4">
                  Próxima
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        A abertura da ficha de uma pessoa e toda exportação ficam registradas na trilha de auditoria,
        com autor e instante.
      </p>
    </main>
  );
}

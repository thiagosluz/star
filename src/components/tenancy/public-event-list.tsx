import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin, Users } from 'lucide-react';

import { formatEventPeriod, type EventStatus } from '@/domain/events/event-rules';
import { eventModalityLabel } from '@/domain/events/event-modality-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import type { PublicEventSummary, PublicEventsPage } from '@/lib/events/event-repository';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A LISTA PÚBLICA DE EVENTOS DA INSTITUIÇÃO — componente compartilhado
 *                                                    (FASE 64 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU COMPONENTE AGORA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A lista existia em UM lugar: a página `/t/<slug>/eventos`. A FASE 64 deu a ela um
 *  segundo consumidor, e o segundo consumidor é um requisito de ACEITE: quando a
 *  instituição **nunca publicou** a página personalizada, `/t/<slug>` tem de continuar
 *  servindo o que servia antes — a listagem de eventos dela. Sem redirect, sem 404 e
 *  sem tela vazia.
 *
 *  Copiar o markup para a página nova teria custado duas verdades para a mesma lista:
 *  o cartão, o rótulo de status, a paginação e os `data-testid` que o E2E já usa
 *  (`events-pagination`, `events-page-info`, `events-next`, `events-prev`). Aqui a
 *  lista é UMA, com dois pontos de montagem:
 *
 *      /t/<slug>            → a página personalizada, OU esta lista (o fallback)
 *      /t/<slug>/eventos    → esta lista, sempre (é o destino do "ver todos")
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM DESENHA O `<main>` É QUEM MONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este componente NÃO tem `<main>`: ele é o CONTEÚDO. Cada tela tem exatamente um
 *  landmark, e o portão WCAG AA conta os `<main>` nos dois sentidos (zero pega a tela
 *  sem o seu; dois pega a casca voltando a ser landmark — o defeito H5).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const STATUS_LABEL: Partial<Record<EventStatus, string>> = {
  PUBLISHED: 'Em breve',
  REGISTRATION_OPEN: 'Inscrições abertas',
  REGISTRATION_CLOSED: 'Inscrições encerradas',
  IN_PROGRESS: 'Acontecendo',
  FINISHED: 'Encerrado',
};

/**
 * O endereço canônico da lista: a PRIMEIRA página não carrega `?pagina=1`.
 *
 * `/eventos` e `/eventos?pagina=1` seriam dois endereços para a mesma tela — e o link
 * "Anteriores" da página 2 tem de voltar para o endereço limpo, que é o que a pessoa
 * compartilha. É a mesma régua do diretório de instituições (`directoryHref`).
 */
export function eventListHref(tenantSlug: string, target: number): string {
  return target <= 1
    ? tenantPath(tenantSlug, '/eventos')
    : `${tenantPath(tenantSlug, '/eventos')}?pagina=${target}`;
}

/** Um cartão de evento da lista. */
export function PublicEventCard({
  event,
  tenantSlug,
}: {
  event: PublicEventSummary;
  tenantSlug: string;
}) {
  return (
    <li>
      <Link
        href={tenantPath(tenantSlug, `/eventos/${event.slug}`)}
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:border-primary/50"
      >
        {event.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.coverImageUrl} alt="" className="h-40 w-full object-cover" />
        ) : (
          <div
            className="h-40 w-full"
            style={{
              backgroundImage: `linear-gradient(135deg, ${
                event.primaryColor ?? 'var(--primary)'
              }, color-mix(in oklab, ${
                event.primaryColor ?? 'var(--primary)'
              } 45%, white))`,
            }}
            aria-hidden
          />
        )}

        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <span className="ef-badge rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {STATUS_LABEL[event.status] ?? event.status}
            </span>
            <span className="text-xs text-muted-foreground">
              {/** A etiqueta de modalidade vem da fonte única do domínio (FASE 69). */}
              {eventModalityLabel(event.modality)}
            </span>
          </div>

          <h2 className="text-lg font-semibold tracking-tight group-hover:text-primary">
            {event.title}
          </h2>

          {event.summary ?? event.subtitle ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {event.summary ?? event.subtitle}
            </p>
          ) : null}

          <dl className="mt-auto space-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
              <dd>{formatEventPeriod(event, event.timezone)}</dd>
            </div>
            {event.city ? (
              <div className="flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <dd>
                  {event.venueName ? `${event.venueName}, ` : ''}
                  {event.city}
                  {event.state ? `/${event.state}` : ''}
                </dd>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <Users className="size-3.5 shrink-0" aria-hidden />
              <dd>
                {event.activityCount}{' '}
                {event.activityCount === 1 ? 'atividade' : 'atividades'}
                {event.remainingSeats !== null
                  ? ` · ${event.remainingSeats} vagas`
                  : ' · vagas ilimitadas'}
              </dd>
            </div>
          </dl>

          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            Ver evento
            <ArrowRight className="size-3.5" aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}

/**
 * A vitrine: cabeçalho, cartões e paginação.
 *
 * `events` já vem filtrado pela régua do domínio (`isPubliclyVisible`) e `page` é a
 * fatia que o banco devolveu — o componente não refaz nenhuma das duas contas.
 */
export function PublicEventList({
  tenantSlug,
  tenantName,
  page,
  events,
}: {
  tenantSlug: string;
  tenantName: string;
  page: PublicEventsPage;
  events: readonly PublicEventSummary[];
}) {
  return (
    <>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Eventos</h1>
        <p className="text-muted-foreground">
          {page.total === 0
            ? 'Nenhum evento publicado no momento.'
            : `${page.total} ${page.total === 1 ? 'evento disponível' : 'eventos disponíveis'} em ${tenantName}.`}
        </p>
      </header>

      {events.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Assim que a instituição publicar um evento, ele aparecerá aqui.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <PublicEventCard key={event.id} event={event} tenantSlug={tenantSlug} />
          ))}
        </ul>
      )}

      {/**
        * ── A PAGINAÇÃO É LINK, NÃO ESTADO (FASE 56 · dívida E2) ───────────────────
        *  A página vive na URL (`?pagina=2`): o endereço é compartilhável, o botão
        *  "voltar" do navegador funciona, e a lista não precisa de JavaScript para
        *  andar. Quando só há uma página, a barra inteira não aparece — não se anuncia
        *  "página 1 de 1".
        */}
      {page.totalPages > 1 ? (
        <nav
          className="flex items-center justify-between gap-4 border-t border-border pt-6 text-sm"
          aria-label="Paginação dos eventos"
          data-testid="events-pagination"
        >
          {page.hasPrev ? (
            <Link
              href={eventListHref(tenantSlug, page.page - 1)}
              className="underline underline-offset-4"
              data-testid="events-prev"
            >
              ← Anteriores
            </Link>
          ) : (
            <span className="text-muted-foreground" aria-hidden>
              ← Anteriores
            </span>
          )}

          <span className="text-muted-foreground" data-testid="events-page-info">
            página {page.page} de {page.totalPages}
          </span>

          {page.hasNext ? (
            <Link
              href={eventListHref(tenantSlug, page.page + 1)}
              className="underline underline-offset-4"
              data-testid="events-next"
            >
              Próximos →
            </Link>
          ) : (
            <span className="text-muted-foreground" aria-hidden>
              Próximos →
            </span>
          )}
        </nav>
      ) : null}
    </>
  );
}

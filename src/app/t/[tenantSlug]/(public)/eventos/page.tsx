import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CalendarDays, MapPin, Users } from 'lucide-react';

import { getTenantContext, listPublicEvents } from '@/lib/events/event-repository';
import {
  formatEventPeriod,
  isPubliclyVisible,
  type EventStatus,
} from '@/domain/events/event-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Partial<Record<EventStatus, string>> = {
  PUBLISHED: 'Em breve',
  REGISTRATION_OPEN: 'Inscrições abertas',
  REGISTRATION_CLOSED: 'Inscrições encerradas',
  IN_PROGRESS: 'Acontecendo',
  FINISHED: 'Encerrado',
};

/** Lista pública de eventos da instituição. */
export default async function PublicEventsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const events = (await listPublicEvents(tenant.tenantId)).filter((event) =>
    isPubliclyVisible(event.status),
  );

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Eventos</h1>
        <p className="text-muted-foreground">
          {events.length === 0
            ? 'Nenhum evento publicado no momento.'
            : `${events.length} ${events.length === 1 ? 'evento disponível' : 'eventos disponíveis'} em ${tenant.name}.`}
        </p>
      </header>

      {events.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Assim que a instituição publicar um evento, ele aparecerá aqui.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={tenantPath(tenantSlug, `/eventos/${event.slug}`)}
                className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:border-primary/50"
              >
                {event.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={event.coverImageUrl}
                    alt=""
                    className="h-40 w-full object-cover"
                  />
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
                      {event.modality === 'ONLINE'
                        ? 'Online'
                        : event.modality === 'HYBRID'
                          ? 'Híbrido'
                          : 'Presencial'}
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
          ))}
        </ul>
      )}
    </main>
  );
}

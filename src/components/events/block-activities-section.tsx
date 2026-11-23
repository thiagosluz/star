import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock, ExternalLink, MapPin, Mic, Star, Users } from 'lucide-react';

import { ActivityExportLinks } from '@/components/events/activity-export-links';
import { AgendaClashNotice } from '@/components/events/agenda-clash-notice';
import { AgendaMarks } from '@/components/events/agenda-marks';
import { FavoriteButton } from '@/components/events/favorite-button';
import { HappeningNowBanner } from '@/components/events/happening-now';
import { Section, SectionHeading } from '@/components/events/theme-scope';
import type { HappeningNowView } from '@/domain/agenda/now-rules';
import { activityTypeLabel } from '@/domain/events/activity-rules';
import { formatDuration } from '@/domain/events/event-rules';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { activityIcsUrl } from '@/lib/events/agenda-export';
import {
  clashesWithAgenda,
  EMPTY_AGENDA_VIEW,
  type AgendaViewerItem,
  type EventAgendaView,
} from '@/lib/events/agenda-view';
import type { PublicActivitySummary } from '@/lib/events/event-repository';

function ActivityCard({
  activity,
  tenantSlug,
  eventId = '',
  eventSlug,
  timezone = 'UTC',
  agenda = EMPTY_AGENDA_VIEW,
  justMarked = false,
}: {
  activity: PublicActivitySummary;
  tenantSlug: string;
  eventId?: string;
  eventSlug: string;
  timezone?: string;
  agenda?: EventAgendaView;
  justMarked?: boolean;
}) {
  const isFull = activity.remainingSeats === 0;
  const closed = activity.status === 'CANCELED' || activity.status === 'COMPLETED';
  const minha: AgendaViewerItem | undefined = agenda.items.find((item) => item.activityId === activity.id);

  const choques = clashesWithAgenda(
    {
      activityId: activity.id,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      status: activity.status,
    },
    agenda.items,
  );

  return (
    <li className="ef-card p-5" id={`atividade-${activity.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ef-badge">{activityTypeLabel(activity.type)}</span>
            {activity.isFeatured ? (
              <span className="ef-badge gap-1">
                <Star className="size-3" aria-hidden />
                Destaque
              </span>
            ) : null}
            {activity.status === 'CANCELED' ? (
              <span className="ef-badge text-destructive">Cancelada</span>
            ) : isFull && activity.waitlistEnabled ? (
              <span className="ef-badge">Lista de espera</span>
            ) : isFull ? (
              <span className="ef-badge">Lotada</span>
            ) : null}

            <AgendaMarks
              registered={minha?.registered ?? false}
              favorited={minha?.favorited ?? false}
              variant="tema"
              testId={`marcas-${activity.id}`}
            />
          </div>

          <h3 className="text-base font-semibold">{activity.title}</h3>

          {activity.description ? <p className="line-clamp-2 text-sm opacity-70">{activity.description}</p> : null}

          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs opacity-70">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
              <dd data-testid={`atividade-horario-${activity.id}`}>
                {formatZonedDateTime(activity.startsAt, timezone)}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden />
              <dd>{formatDuration(activity.workloadMinutes)}</dd>
            </div>
            {activity.roomName ? (
              <div className="flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <dd>{activity.roomName}</dd>
              </div>
            ) : null}
            {activity.onlineUrl ? (
              <div className="flex items-center gap-1.5">
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                <dd>
                  <a
                    href={activity.onlineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`atividade-sala-online-${activity.id}`}
                    className="underline underline-offset-4"
                  >
                    Entrar na sala online
                  </a>
                </dd>
              </div>
            ) : null}
            {activity.speakerNames.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <Mic className="size-3.5 shrink-0" aria-hidden />
                <dd>{activity.speakerNames.join(', ')}</dd>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <Users className="size-3.5 shrink-0" aria-hidden />
              <dd>
                {activity.capacity === null
                  ? 'Vagas ilimitadas'
                  : `${activity.confirmedCount}/${activity.capacity} inscritos`}
              </dd>
            </div>
          </dl>

          <ActivityExportLinks
            activityId={activity.id}
            title={activity.title}
            startsAt={activity.startsAt}
            endsAt={activity.endsAt}
            timezone={timezone}
            location={activity.roomName}
            description={activity.description}
            icsHref={activityIcsUrl({ tenantSlug, activityId: activity.id })}
            variant="tema"
          />

          {choques.length > 0 ? (
            <AgendaClashNotice
              targets={choques}
              variant="tema"
              testId={`choque-${activity.id}`}
              hint="Você escolhe qual assistir — marcar as duas é permitido."
            />
          ) : null}

          {justMarked ? (
            <p className="flex items-center gap-1.5 text-xs font-medium" data-testid={`agenda-confirmacao-${activity.id}`}>
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
              {minha?.favorited ? 'Adicionada à sua agenda.' : 'Removida da sua agenda.'}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {closed ? (
            <span className="ef-button-outline ef-muted-on-card pointer-events-none">Indisponível</span>
          ) : (
            <Link
              href={tenantPath(tenantSlug, `/eventos/${eventSlug}/atividades/${activity.slug}`)}
              className="ef-button"
            >
              {isFull && activity.waitlistEnabled ? 'Entrar na espera' : 'Inscrever-se'}
            </Link>
          )}

          {agenda.authenticated && activity.status !== 'CANCELED' ? (
            <FavoriteButton
              tenantSlug={tenantSlug}
              eventId={eventId}
              eventSlug={eventSlug}
              activityId={activity.id}
              activityTitle={activity.title}
              favorited={minha?.favorited ?? false}
              origem="PROGRAMACAO"
              variant="tema"
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Bloco público de programação com faixa "Acontecendo agora", avisos de choque e grade. */
export function ActivitiesBlock({
  activities,
  tenantSlug,
  eventId,
  eventSlug,
  timezone,
  agenda,
  justMarkedActivityId,
  now,
}: {
  activities: PublicActivitySummary[];
  tenantSlug: string;
  eventId: string;
  eventSlug: string;
  timezone: string;
  agenda: EventAgendaView;
  justMarkedActivityId: string | null;
  now: HappeningNowView;
}) {
  if (activities.length === 0) return null;

  return (
    <Section id="programacao">
      <SectionHeading
        eyebrow="Programação"
        title="Atividades"
        description="Inscreva-se nas atividades de seu interesse. As vagas são limitadas."
      />

      <HappeningNowBanner view={now} tenantSlug={tenantSlug} eventSlug={eventSlug} />

      {agenda.authenticated ? (
        <p className="mb-4 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-70">
          <Link
            href={`${tenantPath(tenantSlug, '/minha-agenda')}?evento=${eventId}`}
            className="underline underline-offset-4"
            data-testid="minha-agenda-link"
          >
            Ver a minha agenda deste evento
          </Link>
          <span aria-hidden>·</span>
          <span>Marcar não reserva vaga: quem garante lugar é a inscrição.</span>
        </p>
      ) : null}

      <ul className="space-y-3">
        {activities.map((activity) => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            tenantSlug={tenantSlug}
            eventId={eventId}
            eventSlug={eventSlug}
            timezone={timezone}
            agenda={agenda}
            justMarked={justMarkedActivityId === activity.id}
          />
        ))}
      </ul>
    </Section>
  );
}

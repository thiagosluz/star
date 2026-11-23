import Link from 'next/link';
import { CalendarDays, Clock, ExternalLink, MapPin, Mic, Users, Video } from 'lucide-react';

import { ActivityMaterials } from '@/components/events/activity-materials';
import { ActivitySpeakerList } from '@/components/events/speaker-gallery';
import { activityTypeLabel } from '@/domain/events/activity-rules';
import { formatDuration } from '@/domain/events/event-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import type { getPublicActivity } from '@/lib/events/event-repository';
import type { listActivityMaterials } from '@/lib/speakers/material-service';
import type { loadActivityNotes } from '@/lib/speakers/speaker-service';

type PublicActivityDetail = NonNullable<Awaited<ReturnType<typeof getPublicActivity>>>['activity'];
type ActivityMaterialView = Awaited<ReturnType<typeof listActivityMaterials>>['materials'][number];
type ActivityNotesView = NonNullable<Awaited<ReturnType<typeof loadActivityNotes>>>;

/** Ficha principal da atividade: metadados, descrição, tags, ementa detalhada, palestrantes e materiais. */
export function ActivityDetailSections({
  tenantSlug,
  eventSlug,
  timeZone,
  activity,
  isFull,
  roomLimits,
  onlineUrl,
  windowOpen,
  alreadyRegistered,
  membershipStatus,
  canRegister,
  isAuthenticated,
  notes,
  materials,
  lockedCount,
}: {
  tenantSlug: string;
  eventSlug: string;
  timeZone: string;
  activity: PublicActivityDetail;
  isFull: boolean;
  roomLimits: boolean;
  onlineUrl: string | null;
  windowOpen: boolean;
  alreadyRegistered: 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | null;
  membershipStatus: string | null;
  canRegister: boolean;
  isAuthenticated: boolean;
  notes: ActivityNotesView | null;
  materials: ActivityMaterialView[];
  lockedCount: number;
}) {
  return (
    <article className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ef-badge">{activityTypeLabel(activity.type)}</span>
        {activity.status === 'CANCELED' ? <span className="ef-badge text-destructive">Cancelada</span> : null}
        {isFull && activity.waitlistEnabled ? <span className="ef-badge">Lista de espera disponível</span> : null}
      </div>

      <h1 className="text-balance text-3xl font-semibold tracking-tight">{activity.title}</h1>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="ef-muted size-4 shrink-0" aria-hidden />
          <div>
            <span className="ef-muted block text-xs">Data e horário</span>
            <span className="block" data-testid="activity-schedule">
              {new Intl.DateTimeFormat('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                timeZone,
              }).format(activity.startsAt)}
              {', '}
              {new Intl.DateTimeFormat('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone,
              }).format(activity.startsAt)}{' '}
              –{' '}
              {new Intl.DateTimeFormat('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone,
              }).format(activity.endsAt)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="ef-muted size-4 shrink-0" aria-hidden />
          <div>
            <span className="ef-muted block text-xs">Carga horária</span>
            <span className="block">{formatDuration(activity.workloadMinutes)}</span>
          </div>
        </div>

        {activity.roomName ? (
          <div className="flex items-center gap-2">
            <MapPin className="ef-muted size-4 shrink-0" aria-hidden />
            <div>
              <span className="ef-muted block text-xs">Local</span>
              <span className="block">{activity.roomName}</span>
            </div>
          </div>
        ) : null}

        {onlineUrl ? (
          <div className="flex items-center gap-2">
            <Video className="ef-muted size-4 shrink-0" aria-hidden />
            <div>
              <span className="ef-muted block text-xs">Sala online</span>
              <span className="block">
                <a
                  href={onlineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="atividade-sala-online"
                  className="underline underline-offset-4"
                >
                  Entrar na sala online
                </a>
              </span>
            </div>
          </div>
        ) : null}

        {activity.speakers.length > 0 ? (
          <div className="flex items-center gap-2">
            <Mic className="ef-muted size-4 shrink-0" aria-hidden />
            <div>
              <span className="ef-muted block text-xs">
                {activity.speakers.length === 1 ? 'Palestrante' : 'Palestrantes'}
              </span>
              <span className="flex flex-wrap gap-x-2">
                {activity.speakers.map((speaker, index) => (
                  <span key={speaker.id}>
                    <Link
                      href={tenantPath(tenantSlug, `/eventos/${eventSlug}/palestrantes/${speaker.id}`)}
                      className="underline underline-offset-4"
                      data-testid={`activity-speaker-link-${speaker.id}`}
                    >
                      {speaker.name}
                    </Link>
                    {index < activity.speakers.length - 1 ? ',' : ''}
                  </span>
                ))}
              </span>
            </div>
          </div>
        ) : activity.speakerNames.length > 0 ? (
          <div className="flex items-center gap-2">
            <Mic className="ef-muted size-4 shrink-0" aria-hidden />
            <div>
              <span className="ef-muted block text-xs">
                {activity.speakerNames.length === 1 ? 'Palestrante' : 'Palestrantes'}
              </span>
              <span className="block">{activity.speakerNames.join(', ')}</span>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Users className="ef-muted size-4 shrink-0" aria-hidden />
          <div>
            <span className="ef-muted block text-xs">Vagas</span>
            <span className="block" data-testid="activity-seats">
              {activity.capacity === null
                ? 'Ilimitadas'
                : `${activity.confirmedCount} de ${activity.capacity} preenchidas`}
              {activity.remainingSeats !== null && activity.remainingSeats > 0
                ? ` · ${activity.remainingSeats} restantes`
                : ''}
              {roomLimits ? ` · a sala comporta ${activity.roomCapacity}` : ''}
            </span>
            <span
              data-testid="activity-flags"
              hidden
              data-capacity={String(activity.capacity)}
              data-room-capacity={String(activity.roomCapacity)}
              data-confirmed={String(activity.confirmedCount)}
              data-remaining={String(activity.remainingSeats)}
              data-full={String(isFull)}
              data-waitlist={String(activity.waitlistEnabled)}
              data-status={activity.status}
              data-window-open={String(windowOpen)}
              data-registered={String(alreadyRegistered)}
              data-membership={membershipStatus ?? 'null'}
              data-can-register={String(canRegister)}
              data-authenticated={isAuthenticated ? 'sim' : 'nao'}
            />
          </div>
        </div>
      </div>

      {activity.description ? (
        <div className="whitespace-pre-line text-pretty leading-relaxed opacity-80">{activity.description}</div>
      ) : null}

      {activity.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {activity.tags.map((tag) => (
            <li key={tag} className="ef-badge">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {notes ? (
        <section className="space-y-4" aria-labelledby="ementa-detalhada">
          <h2 id="ementa-detalhada" className="text-lg font-semibold tracking-tight">
            Ementa detalhada
          </h2>
          <p className="text-xs opacity-70" data-testid="notes-author">
            Por {notes.speakerName}
          </p>

          {notes.syllabus ? (
            <div className="space-y-1.5" data-testid="activity-syllabus">
              <h3 className="text-sm font-medium">Conteúdo programático</h3>
              <div className="whitespace-pre-line text-pretty text-sm leading-relaxed opacity-85">
                {notes.syllabus}
              </div>
            </div>
          ) : null}

          {notes.requirements ? (
            <div className="space-y-1.5" data-testid="activity-requirements">
              <h3 className="text-sm font-medium">Pré-requisitos e ferramentas</h3>
              <div className="whitespace-pre-line text-pretty text-sm leading-relaxed opacity-85">
                {notes.requirements}
              </div>
            </div>
          ) : null}

          {notes.bibliography ? (
            <div className="space-y-1.5" data-testid="activity-bibliography">
              <h3 className="text-sm font-medium">Bibliografia recomendada</h3>
              <div className="whitespace-pre-line text-pretty text-sm leading-relaxed opacity-85">
                {notes.bibliography}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <ActivitySpeakerList speakers={activity.speakers} tenantSlug={tenantSlug} eventSlug={eventSlug} />

      <ActivityMaterials
        materials={materials}
        activityTitle={activity.title}
        tenantSlug={tenantSlug}
        isAuthenticated={isAuthenticated}
        lockedCount={lockedCount}
      />

      {onlineUrl ? (
        <p className="sr-only">
          <ExternalLink className="size-3.5" aria-hidden />
        </p>
      ) : null}
    </article>
  );
}

import { Link2, Mail, Mic } from 'lucide-react';

import { readBlockString } from '@/components/events/block-content-renderers';
import { SpeakerGallery } from '@/components/events/speaker-gallery';
import { Section, SectionHeading } from '@/components/events/theme-scope';
import { tracksAnnouncement } from '@/domain/events/call-optional-rules';
import { teamInitials } from '@/domain/events/team-rules';
import { hasPublicContacts, PUBLIC_CONTACT_LABELS, PUBLIC_CONTACT_NETWORKS } from '@/domain/profile/public-contacts';
import type { PublicActivitySummary, PublicEventDetail } from '@/lib/events/event-repository';

export function SpeakersBlock({
  activities,
  speakers,
  content,
  tenantSlug,
  eventSlug,
}: {
  activities: PublicActivitySummary[];
  speakers: PublicEventDetail['speakers'];
  content: unknown;
  tenantSlug: string;
  eventSlug: string;
}) {
  const title = readBlockString(content, 'title');

  if (speakers.length > 0) {
    return (
      <Section id="palestrantes">
        <SectionHeading
          eyebrow="Quem conduz"
          title={title ?? 'Palestrantes'}
          description="Conheça quem ministra as atividades deste evento."
        />
        <SpeakerGallery speakers={speakers} tenantSlug={tenantSlug} eventSlug={eventSlug} />
      </Section>
    );
  }

  const seen = new Set<string>();
  const names: { name: string; titles: string[] }[] = [];

  for (const activity of activities) {
    for (const name of activity.speakerNames) {
      const key = name.toLowerCase();
      const existing = names.find((entry) => entry.name.toLowerCase() === key);
      if (existing) {
        if (!existing.titles.includes(activity.title)) existing.titles.push(activity.title);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      names.push({ name, titles: [activity.title] });
    }
  }

  if (names.length === 0) return null;

  return (
    <Section id="palestrantes">
      <SectionHeading eyebrow="Quem conduz" title={title ?? 'Palestrantes'} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {names.map((speaker) => (
          <li key={speaker.name} className="ef-card flex items-start gap-3 p-4">
            <Mic className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">{speaker.name}</p>
              <p className="text-xs opacity-70">{speaker.titles.join(' · ')}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function TracksBlock({
  tracks,
  content,
  usesCall,
  hasPublishedCall,
}: {
  tracks: PublicEventDetail['tracks'];
  content: unknown;
  usesCall: boolean;
  hasPublishedCall: boolean;
}) {
  const anuncio = tracksAnnouncement({
    receivesSubmissions: usesCall || hasPublishedCall,
    hasPublishedCall,
    trackCount: tracks.length,
  });

  if (anuncio === 'SILENT') return null;

  const title = readBlockString(content, 'title');

  return (
    <Section id="trilhas">
      <SectionHeading
        eyebrow={anuncio === 'ANNOUNCE' ? 'Chamada de trabalhos' : 'Trilhas temáticas'}
        title={title ?? 'Trilhas temáticas'}
        description={
          anuncio === 'ANNOUNCE'
            ? 'Submeta seu trabalho na trilha correspondente ao tema.'
            : 'Os eixos temáticos em que o evento se organiza.'
        }
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {tracks.map((track) => (
          <li key={track.id} className="ef-card space-y-1.5 p-4">
            <p className="flex items-center gap-2 font-medium">
              {track.color ? (
                <span
                  aria-hidden
                  className="inline-block size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: track.color }}
                />
              ) : null}
              {track.name}
            </p>
            {track.description ? <p className="text-sm opacity-70">{track.description}</p> : null}
            <p className="ef-muted-on-card text-xs">
              {track.submissionCount} {track.submissionCount === 1 ? 'trabalho' : 'trabalhos'} submetido(s)
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function TeamBlock({
  organizers,
  teams,
  content,
}: {
  organizers: PublicEventDetail['organizers'];
  teams: PublicEventDetail['teams'];
  content: unknown;
}) {
  const title = readBlockString(content, 'title');
  const description = readBlockString(content, 'description');
  const teamId = readBlockString(content, 'teamId');

  const chosen = teamId ? teams.find((team) => team.id === teamId) : null;
  const cards = teamId ? organizers.filter((card) => card.labels.includes(chosen?.name ?? '')) : organizers;

  if (cards.length === 0) return null;

  return (
    <Section id="equipe">
      <SectionHeading
        eyebrow="Quem organiza"
        title={title ?? (chosen ? chosen.name : 'Equipe do evento')}
        description={
          description ??
          (chosen ? `Quem está à frente de ${chosen.name}.` : 'As pessoas que fazem este evento acontecer.')
        }
      />
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="team-block">
        {cards.map((card) => (
          <li key={card.userId} className="space-y-2 text-center" data-testid="team-card">
            <div className="relative mx-auto w-full max-w-44 overflow-hidden rounded-lg border border-border bg-surface-low">
              {card.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.avatarUrl} alt={card.name} className="aspect-4/5 w-full object-cover" loading="lazy" />
              ) : (
                <div
                  className="flex aspect-4/5 w-full items-center justify-center text-3xl font-semibold text-muted-foreground"
                  aria-hidden
                >
                  {teamInitials(card.name)}
                </div>
              )}
              {card.labels.length > 0 ? (
                <span className="absolute inset-x-2 bottom-2 rounded-md bg-inverse-surface/90 px-2 py-1 text-xs font-medium text-inverse-on-surface">
                  {card.labels.join(' / ')}
                </span>
              ) : null}
            </div>

            <p className="font-medium leading-tight">{card.name}</p>

            {card.email || hasPublicContacts(card.links) ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground" data-testid="team-contacts">
                {card.email ? (
                  <a
                    href={`mailto:${card.email}`}
                    aria-label={`Enviar e-mail para ${card.name}`}
                    title={card.email}
                    className="rounded-md p-1 hover:text-foreground"
                  >
                    <Mail className="size-4" aria-hidden />
                  </a>
                ) : null}
                {PUBLIC_CONTACT_NETWORKS.map((network) => {
                  const url = card.links[network];
                  if (!url) return null;

                  return (
                    <a
                      key={network}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      aria-label={`${PUBLIC_CONTACT_LABELS[network]} de ${card.name}`}
                      className="rounded-md p-1 hover:text-foreground"
                    >
                      <Link2 className="size-4" aria-hidden />
                    </a>
                  );
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

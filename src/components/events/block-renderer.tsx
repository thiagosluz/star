import { ActivitiesBlock } from '@/components/events/block-activities-section';
import { CallsBlock } from '@/components/events/block-calls-section';
import { SpeakersBlock, TeamBlock, TracksBlock } from '@/components/events/block-community-sections';
import {
  CountdownBlock,
  CustomHtmlBlock,
  FaqBlock,
  GalleryBlock,
  RegistrationCtaBlock,
  RichTextBlock,
  VenueBlock,
} from '@/components/events/block-content-renderers';
import { SponsorsBlock } from '@/components/events/block-sponsors-section';
import { EMPTY_HAPPENING_NOW, type HappeningNowView } from '@/domain/agenda/now-rules';
import type { PageBlockType } from '@/domain/events/landing-page';
import { EMPTY_AGENDA_VIEW, type EventAgendaView } from '@/lib/events/agenda-view';
import type { PublicEventDetail } from '@/lib/events/event-repository';
import type { CallView } from '@/lib/proposals/call-service';

export interface BlockRendererProps {
  type: PageBlockType;
  content: unknown;
  event: PublicEventDetail;
  tenantSlug: string;
  now: number;
  publicCalls: readonly CallView[];
  agenda?: EventAgendaView;
  justMarkedActivityId?: string | null;
  happeningNow?: HappeningNowView;
}

/** Traduz um bloco publicado do banco no componente Server correspondente. */
export function BlockRenderer({
  type,
  content,
  event,
  tenantSlug,
  now,
  publicCalls,
  agenda = EMPTY_AGENDA_VIEW,
  justMarkedActivityId = null,
  happeningNow = EMPTY_HAPPENING_NOW,
}: BlockRendererProps) {
  switch (type) {
    case 'RICH_TEXT':
      return <RichTextBlock content={content} />;
    case 'SCHEDULE':
      return (
        <ActivitiesBlock
          activities={event.activities}
          tenantSlug={tenantSlug}
          eventId={event.id}
          eventSlug={event.slug}
          timezone={event.timezone}
          agenda={agenda}
          justMarkedActivityId={justMarkedActivityId}
          now={happeningNow}
        />
      );
    case 'SPONSORS':
      return <SponsorsBlock sponsors={event.sponsors} content={content} />;
    case 'FAQ':
      return <FaqBlock content={content} />;
    case 'GALLERY':
      return <GalleryBlock content={content} />;
    case 'COUNTDOWN':
      return <CountdownBlock content={content} startsAt={event.startsAt} now={now} />;
    case 'VENUE_MAP':
      return <VenueBlock event={event} />;
    case 'SPEAKERS':
      return (
        <SpeakersBlock
          activities={event.activities}
          speakers={event.speakers}
          content={content}
          tenantSlug={tenantSlug}
          eventSlug={event.slug}
        />
      );
    case 'TEAM':
      return <TeamBlock organizers={event.organizers} teams={event.teams} content={content} />;
    case 'TRACKS':
      return (
        <TracksBlock
          tracks={event.tracks}
          content={content}
          usesCall={event.usesCall}
          hasPublishedCall={publicCalls.length > 0}
        />
      );
    case 'CALL_FOR_PROPOSALS':
      return (
        <CallsBlock
          calls={publicCalls}
          content={content}
          tenantSlug={tenantSlug}
          eventSlug={event.slug}
        />
      );
    case 'REGISTRATION_CTA':
      return <RegistrationCtaBlock content={content} hasActivities={event.activities.length > 0} />;
    case 'CUSTOM_HTML':
      return <CustomHtmlBlock content={content} />;
    case 'HERO':
    default:
      return null;
  }
}

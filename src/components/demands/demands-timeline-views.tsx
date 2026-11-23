import Link from 'next/link';

import type { TimelineDemand, TimelineWindow } from '@/domain/events/demand-timeline-rules';
import { DemandCalendar } from '@/components/admin/demand-calendar';
import { DemandGantt } from '@/components/admin/demand-gantt';
import type { DemandViewFilters } from '@/components/admin/demand-view-switcher';

interface DemandsTimelineViewsProps {
  view: 'gantt' | 'calendario';
  tenantSlug: string;
  eventId: string;
  demands: TimelineDemand[];
  timeZone: string;
  now: Date;
  filters: DemandViewFilters;
  truncated: boolean;
  cardsPerColumn: number;
  moreCardsHref: string;
  ganttWindow: TimelineWindow | null;
  calendarKey: string | null;
}

export function DemandsTimelineViews({
  view,
  tenantSlug,
  eventId,
  demands,
  timeZone,
  now,
  filters,
  truncated,
  cardsPerColumn,
  moreCardsHref,
  ganttWindow,
  calendarKey,
}: DemandsTimelineViewsProps) {
  const showGantt = view === 'gantt' && ganttWindow !== null;
  const showCalendar = view === 'calendario' && calendarKey !== null;

  if (!showGantt && !showCalendar) return null;

  const scopeLabel = showGantt ? 'o eixo' : 'o mês';

  return (
    <div className="space-y-2">
      {truncated ? (
        <p className="text-xs text-muted-foreground" data-testid="demand-view-truncated">
          Algumas colunas têm mais demandas do que a janela trouxe — {scopeLabel} mostra as{' '}
          {cardsPerColumn} primeiras de cada uma.{' '}
          <Link href={moreCardsHref} className="underline">
            Ver mais
          </Link>
        </p>
      ) : null}

      {showGantt ? (
        <DemandGantt
          tenantSlug={tenantSlug}
          eventId={eventId}
          demands={demands}
          window={ganttWindow}
          timeZone={timeZone}
          filters={filters}
        />
      ) : (
        <DemandCalendar
          tenantSlug={tenantSlug}
          eventId={eventId}
          demands={demands}
          monthKey={calendarKey!}
          timeZone={timeZone}
          now={now}
          filters={filters}
        />
      )}
    </div>
  );
}

import { AlertTriangle } from 'lucide-react';

import { listCheckinQueue } from '@/lib/events/attendance-service';
import { checkInAction, checkOutAction } from '@/app/actions/attendance-actions';
import { CheckinQueue, type QueueActivityOption } from '@/components/gamification/checkin-queue';
import {
  buildCheckinHref,
  formatQueueTruncationNotice,
  type CheckinQueueStatusFilter,
} from '@/domain/events/checkin-console-rules';
import { resolveCheckinInitialQueueLimit } from '@/domain/cache/public-cache-rules';
import { Alert } from '@/components/ui';

function formatTimeInEventZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  }
}

export function CheckinQueueSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando fila de participantes">
      <div className="h-4 w-44 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div className="space-y-2">
        <div className="h-16 animate-pulse rounded-lg border border-border bg-muted/40 motion-reduce:animate-none" />
        <div className="h-16 animate-pulse rounded-lg border border-border bg-muted/40 motion-reduce:animate-none" />
        <div className="h-16 animate-pulse rounded-lg border border-border bg-muted/40 motion-reduce:animate-none" />
      </div>
    </div>
  );
}

/**
 * Busca assíncrona isolada em `<Suspense>` para que cada tecla na busca manual atualize apenas
 * a fila lateral sem bloquear o shell nem o Modo Monitor (padrão F103).
 */
export async function CheckinQueueSection({
  tenantId,
  tenantSlug,
  eventId,
  eventTimeZone,
  query,
  statusFilter,
  activities,
}: {
  tenantId: string;
  tenantSlug: string;
  eventId: string;
  eventTimeZone: string;
  query?: string;
  statusFilter: CheckinQueueStatusFilter;
  activities?: readonly QueueActivityOption[];
}) {
  const queue = await listCheckinQueue(tenantId, eventId, {
    query,
    statusFilter,
    limit: resolveCheckinInitialQueueLimit(query),
    deduplicateByUser: true,
  });

  if (!queue.ok) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
        <AlertTriangle className="size-4" aria-hidden />
        {queue.message}
      </p>
    );
  }

  const entries = queue.entries.map((entry) => {
    const formattedOpenSessions: Record<string, string> = {};
    if (entry.openSessionsByContext) {
      for (const [ctxKey, openedAt] of Object.entries(entry.openSessionsByContext)) {
        formattedOpenSessions[ctxKey] = formatTimeInEventZone(openedAt, eventTimeZone);
      }
    }

    return {
      registrationId: entry.registrationId,
      userName: entry.userName,
      userEmail: entry.userEmail,
      activityTitle: entry.activityTitle,
      isInside: entry.isInside,
      checkedInAtLabel: entry.checkedInAt
        ? formatTimeInEventZone(entry.checkedInAt, eventTimeZone)
        : null,
      hasEventRegistration: entry.hasEventRegistration,
      registeredActivityIds: entry.registeredActivityIds,
      activityTitles: entry.activityTitles,
      registrationIdByContext: entry.registrationIdByContext,
      openSessionsByContext: formattedOpenSessions,
    };
  });

  const truncationNotice = formatQueueTruncationNotice(entries.length, queue.total);
  const hasFilters = Boolean(query?.trim() || statusFilter !== 'all');

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground" data-testid="queue-total">
        {queue.total} inscrição(ões) confirmada(s)
        {query ? ` para "${query}"` : ''}
      </p>

      {truncationNotice ? (
        <Alert tone="info" data-testid="checkin-queue-truncation">
          {truncationNotice}
        </Alert>
      ) : null}

      <CheckinQueue
        entries={entries}
        tenantSlug={tenantSlug}
        checkInAction={checkInAction}
        checkOutAction={checkOutAction}
        activities={activities}
        clearSearchHref={
          hasFilters
            ? buildCheckinHref({
                tenantSlug,
                eventId,
                tab: 'balcao',
              })
            : undefined
        }
      />
    </div>
  );
}

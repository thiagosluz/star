import Link from 'next/link';
import { CalendarClock, Users } from 'lucide-react';

import { tenantPath } from '@/domain/tenancy/resolution';
import type { DemandCard, DemandColumnView } from '@/lib/events/demand-service';
import { moveDemandAction, moveDemandFormAction } from '@/app/actions/demand-actions';
import { DemandBoardDnd } from '@/components/admin/demand-board-dnd';
import { demandSituationTone } from '@/components/admin/demand-situation-tone';

interface DemandCardItemProps {
  card: DemandCard;
  columnId: string;
  index: number;
  columns: DemandColumnView[];
  tenantSlug: string;
  eventId: string;
  basePath: string;
  canManage: boolean;
  keyboardHintId: string;
}

function DemandCardItem({
  card,
  columnId,
  index,
  columns,
  tenantSlug,
  eventId,
  basePath,
  canManage,
  keyboardHintId,
}: DemandCardItemProps) {
  return (
    <article
      data-demand-id={card.id}
      data-demand-column={columnId}
      data-demand-index={index}
      data-demand-situation={card.situation}
      data-demand-title={card.title}
      tabIndex={canManage ? 0 : undefined}
      aria-describedby={canManage ? keyboardHintId : undefined}
      draggable={canManage}
      data-testid={`demand-card-${card.id}`}
      className={`space-y-2 rounded-md border p-2 text-sm ${demandSituationTone(card.situation)}`}
    >
      <Link
        href={tenantPath(tenantSlug, `${basePath}/${card.id}`)}
        className="block font-medium underline-offset-2 hover:underline"
        data-testid={`demand-card-title-${card.id}`}
      >
        {card.title}
      </Link>

      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span data-testid={`demand-card-priority-${card.id}`}>{card.priorityLabel}</span>
        {card.dueLabel ? (
          <span className="flex items-center gap-1" data-testid={`demand-card-due-${card.id}`}>
            <CalendarClock className="size-3" aria-hidden />
            {card.dueLabel}
          </span>
        ) : null}
        <span data-testid={`demand-card-situation-${card.id}`}>{card.situationLabel}</span>
        {card.commentCount > 0 ? <span>{card.commentCount} comentário(s)</span> : null}
      </p>

      <p className="flex flex-wrap items-center gap-1 text-xs" data-testid={`demand-card-people-${card.id}`}>
        <Users className="size-3 text-muted-foreground" aria-hidden />
        {card.teamName ? <span className="font-medium">{card.teamName}</span> : null}
        {card.assignees.length > 0 ? (
          <span className="text-muted-foreground">
            {card.assignees.map((assignee) => assignee.name).join(', ')}
          </span>
        ) : (
          <span className="text-muted-foreground">sem responsável</span>
        )}
      </p>

      {/* Caminho nativo sem JavaScript; arrastar/teclado atua como atalho progressivo. */}
      {canManage && columns.length > 1 ? (
        <form action={moveDemandFormAction} className="flex items-center gap-1">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="demandId" value={card.id} />
          <input type="hidden" name="fromColumnId" value={columnId} />
          <select
            name="toColumnId"
            defaultValue={columnId}
            aria-label={`Mover "${card.title}" para`}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-xs"
            data-testid={`demand-move-select-${card.id}`}
          >
            {columns.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
            data-testid={`demand-move-submit-${card.id}`}
          >
            Mover
          </button>
        </form>
      ) : null}
    </article>
  );
}

interface DemandsKanbanBoardProps {
  tenantSlug: string;
  eventId: string;
  basePath: string;
  columns: DemandColumnView[];
  moreCardsHrefByColumnId: Record<string, string>;
  canManage: boolean;
  keyboardHintId: string;
}

export function DemandsKanbanBoard({
  tenantSlug,
  eventId,
  basePath,
  columns,
  moreCardsHrefByColumnId,
  canManage,
  keyboardHintId,
}: DemandsKanbanBoardProps) {
  return (
    <div data-testid="demand-board-kanban">
      <DemandBoardDnd
        action={moveDemandAction}
        tenantSlug={tenantSlug}
        eventId={eventId}
        canMove={canManage}
        keyboardHintId={keyboardHintId}
      >
        {columns.map((column) => {
          const moreHref = moreCardsHrefByColumnId[column.id];

          return (
            <section
              key={column.id}
              data-column-drop={column.id}
              data-testid={`demand-column-${column.id}`}
              className="flex min-h-40 flex-col gap-2 rounded-lg border border-border bg-card/60 p-2"
            >
              <header className="flex items-center justify-between gap-2 px-1">
                <h2 className="text-sm font-medium">
                  {column.name}
                  {column.isDone ? (
                    <span className="ml-1 text-xs uppercase tracking-wide text-muted-foreground">
                      conclui
                    </span>
                  ) : null}
                </h2>
                <span className="text-xs text-muted-foreground" data-testid={`demand-column-count-${column.id}`}>
                  {column.cards.length}
                </span>
              </header>

              {column.cards.length === 0 ? (
                <p className="px-1 py-4 text-xs text-muted-foreground">Nenhuma demanda aqui.</p>
              ) : null}

              {column.totalCards > column.cards.length && moreHref ? (
                <p
                  className="rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground"
                  data-testid={`demand-column-truncated-${column.id}`}
                >
                  Mostrando {column.cards.length} de {column.totalCards} demandas.{' '}
                  <Link
                    href={moreHref}
                    className="underline underline-offset-4"
                    data-testid={`demand-column-more-${column.id}`}
                  >
                    Ver mais
                  </Link>
                </p>
              ) : null}

              {column.cards.map((card, index) => (
                <DemandCardItem
                  key={card.id}
                  card={card}
                  columnId={column.id}
                  index={index}
                  columns={columns}
                  tenantSlug={tenantSlug}
                  eventId={eventId}
                  basePath={basePath}
                  canManage={canManage}
                  keyboardHintId={keyboardHintId}
                />
              ))}
            </section>
          );
        })}
      </DemandBoardDnd>
    </div>
  );
}

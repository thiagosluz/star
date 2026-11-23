import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LayoutGrid, Search } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { DEMAND_COLUMN_PAGE_SIZE, loadDemandBoard } from '@/lib/events/demand-service';
import { DEMAND_SITUATION_LABELS } from '@/domain/events/demand-rules';
import {
  DemandViewSwitcher,
  isDemandView,
  type DemandViewFilters,
} from '@/components/admin/demand-view-switcher';
import {
  calendarMonthKey,
  ganttAnchorKey,
  toTimelineDemands,
} from '@/lib/events/demand-timeline';
import { timelineWindow } from '@/domain/events/demand-timeline-rules';
import { GetSearchForm, PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { DemandsColumnsConfig } from '@/components/demands/demands-columns-config';
import { DemandsCreateDetails } from '@/components/demands/demands-create-details';
import { DemandsKanbanBoard } from '@/components/demands/demands-kanban-board';
import { DemandsSummarySection } from '@/components/demands/demands-summary-section';
import { DemandsTimelineViews } from '@/components/demands/demands-timeline-views';

export const metadata = { title: 'Demandas do evento' };
export const dynamic = 'force-dynamic';

/**
 * Id do aviso que ensina o atalho de teclado (dívida E51).
 *
 * Vive aqui, no servidor, porque `DemandBoardDnd` (cliente) desenha o aviso e os
 * cartões (servidor) apontam para ele via `aria-describedby`.
 */
const KEYBOARD_HINT_ID = 'demand-board-keyboard-hint';

/**
 * Quadro de demandas internas do evento (FASE 38) com vistas Kanban, Gantt e
 * Calendário (FASE 57) compartilhando a mesma leitura filtrada do servidor.
 */
export default async function EventDemandsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{
    responsavel?: string;
    equipe?: string;
    situacao?: string;
    busca?: string;
    cartoes?: string;
    vista?: string;
    de?: string;
    mes?: string;
  }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;
  const { responsavel, equipe, situacao, busca, cartoes, vista, de, mes } = await searchParams;

  // Instante único garante consistência entre situação do cartão, Gantt e calendário.
  const now = new Date();
  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.DEMAND_READ,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const allowed = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]): boolean =>
    can(principal, permission, { scope: 'EVENT', eventId }) ||
    can(principal, permission, { scope: 'TENANT' });

  const canManage = allowed(PERMISSIONS.DEMAND_MANAGE);
  const canConfigure = allowed(PERMISSIONS.DEMAND_TEAM_MANAGE);

  const requestedCards = Number.parseInt(cartoes ?? '', 10);
  const cardsPerColumn = Math.min(
    Math.max(Number.isFinite(requestedCards) ? requestedCards : DEMAND_COLUMN_PAGE_SIZE, 1),
    500,
  );

  const result = await loadDemandBoard({
    tenantId,
    eventId,
    cardsPerColumn,
    now,
    filters: {
      assigneeId: responsavel ?? null,
      teamId: equipe ?? null,
      situation: situacao ?? null,
      search: busca ?? null,
    },
  });

  if (!result.ok) notFound();

  const { board } = result;
  const basePath = `/administracao/eventos/${eventId}/demandas`;
  const boardPath = tenantPath(tenantSlug, basePath);
  const view = isDemandView(vista) ? vista : 'kanban';
  const timeline = view === 'kanban' ? [] : toTimelineDemands(board.columns, now, board.timeZone);

  const ganttWindow =
    view === 'gantt'
      ? timelineWindow({
          anchorKey: ganttAnchorKey({
            requested: de ?? null,
            demands: timeline,
            timeZone: board.timeZone,
            now,
          }),
        })
      : null;

  const calendarKey =
    view === 'calendario'
      ? calendarMonthKey({ requested: mes ?? null, timeZone: board.timeZone, now })
      : null;

  const filters: DemandViewFilters = { responsavel, equipe, situacao, busca, cartoes };
  const truncated = board.columns.some((column) => column.totalCards > column.cards.length);

  const moreCardsQuery = (totalInColumn: number): string => {
    const next = new URLSearchParams();

    if (responsavel) next.set('responsavel', responsavel);
    if (equipe) next.set('equipe', equipe);
    if (situacao) next.set('situacao', situacao);
    if (busca) next.set('busca', busca);

    next.set(
      'cartoes',
      String(Math.min(500, Math.max(totalInColumn, cardsPerColumn + DEMAND_COLUMN_PAGE_SIZE))),
    );

    if (view === 'gantt' && ganttWindow) {
      next.set('vista', 'gantt');
      next.set('de', ganttWindow.fromKey);
    }

    if (view === 'calendario' && calendarKey) {
      next.set('vista', 'calendario');
      next.set('mes', calendarKey);
    }

    return next.toString();
  };

  const moreCardsHrefByColumnId = Object.fromEntries(
    board.columns
      .filter((column) => column.totalCards > column.cards.length)
      .map((column) => [column.id, `${basePath}?${moreCardsQuery(column.totalCards)}`]),
  );
  const timelineMoreCardsHref = `${boardPath}?${moreCardsQuery(cardsPerColumn + DEMAND_COLUMN_PAGE_SIZE)}`;

  return (
    <main className="space-y-8">
      <PageHeader
        title="Demandas do evento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<LayoutGrid className="size-5" aria-hidden />}
        description={`${event.title} · o que a equipe precisa fazer, quem está com cada frente e o que está atrasado.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Demandas do evento' },
        ]}
      />

      <p className="text-xs text-muted-foreground">
        <Link href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/equipes`)} className="underline">
          Equipes do evento
        </Link>{' '}
        · as pessoas atribuídas saem da equipe ativa da instituição.
      </p>

      <DemandViewSwitcher tenantSlug={tenantSlug} eventId={eventId} current={view} filters={filters} />

      <DemandsSummarySection summary={board.summary} teams={board.teams} />

      <GetSearchForm action={boardPath} className="flex flex-wrap items-end gap-2" data-testid="demand-filters">
        {view === 'kanban' ? null : <input type="hidden" name="vista" value={view} />}
        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Buscar</span>
          <input
            type="search"
            name="busca"
            defaultValue={busca ?? ''}
            placeholder="título, descrição ou pessoa"
            className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="demand-filter-search"
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Responsável</span>
          <select
            name="responsavel"
            defaultValue={responsavel ?? ''}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="demand-filter-assignee"
          >
            <option value="">todos</option>
            {board.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Equipe</span>
          <select
            name="equipe"
            defaultValue={equipe ?? ''}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="demand-filter-team"
          >
            <option value="">todas</option>
            {board.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Situação</span>
          <select
            name="situacao"
            defaultValue={situacao ?? ''}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="demand-filter-situation"
          >
            <option value="">todas</option>
            {Object.entries(DEMAND_SITUATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          data-testid="demand-filter-submit"
        >
          <Search className="mr-1 inline size-3.5" aria-hidden />
          Filtrar
        </button>

        <Link
          href={boardPath}
          className="text-xs text-muted-foreground underline"
          data-testid="demand-filter-clear"
        >
          limpar
        </Link>
      </GetSearchForm>

      {canManage ? (
        <DemandsCreateDetails
          tenantSlug={tenantSlug}
          eventId={eventId}
          columns={board.columns}
          teams={board.teams}
          people={board.people}
        />
      ) : null}

      {view === 'kanban' ? (
        <DemandsKanbanBoard
          tenantSlug={tenantSlug}
          eventId={eventId}
          basePath={basePath}
          columns={board.columns}
          moreCardsHrefByColumnId={moreCardsHrefByColumnId}
          canManage={canManage}
          keyboardHintId={KEYBOARD_HINT_ID}
        />
      ) : (
        <DemandsTimelineViews
          view={view}
          tenantSlug={tenantSlug}
          eventId={eventId}
          demands={timeline}
          timeZone={board.timeZone}
          now={now}
          filters={filters}
          truncated={truncated}
          cardsPerColumn={cardsPerColumn}
          moreCardsHref={timelineMoreCardsHref}
          ganttWindow={ganttWindow}
          calendarKey={calendarKey}
        />
      )}

      {board.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este quadro ainda não tem colunas. Abra a configuração abaixo para criar a primeira.
        </p>
      ) : null}

      {canConfigure ? (
        <DemandsColumnsConfig tenantSlug={tenantSlug} eventId={eventId} columns={board.columns} />
      ) : null}

      <p className="text-xs text-muted-foreground">
        <Link href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)} className="underline">
          Voltar ao painel do evento
        </Link>
      </p>
    </main>
  );
}

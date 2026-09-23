import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarClock, LayoutGrid, Plus, Search, Users } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { loadDemandBoard } from '@/lib/events/demand-service';
import {
  DEMAND_PRIORITIES,
  DEMAND_PRIORITY_LABELS,
  DEMAND_SITUATION_LABELS,
} from '@/domain/events/demand-rules';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { DemandBoardDnd } from '@/components/admin/demand-board-dnd';
import {
  createColumnAction,
  createDemandAction,
  deleteColumnAction,
  moveDemandAction,
  moveDemandFormAction,
  reorderColumnsAction,
  updateColumnAction,
} from '@/app/actions/demand-actions';

export const metadata = { title: 'Demandas do evento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  QUADRO DE DEMANDAS INTERNAS DO EVENTO (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA É
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O trabalho da EQUIPE da instituição no evento: uma diretoria por coluna (o estado
 *  do trabalho), cartões com responsáveis, prazo e conversa. Ela não é a programação:
 *  "atividade" neste sistema é a sessão com sala, vagas, presença e certificado — a
 *  demanda é o que a organização precisa fazer para que aquilo aconteça.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA MOSTRA A QUEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ver o quadro exige `demand:read`; mexer nos cartões, `demand:manage`; configurar
 *  colunas e equipes, `demand:team:manage`. A página ESCONDE o que a pessoa não pode
 *  fazer, e cada Server Action reconfere a permissão: o menu e o botão são
 *  conveniência, a barreira é a action.
 * ═══════════════════════════════════════════════════════════════════════════════
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
  }>;
}) {
  const { tenantSlug, eventId } = await params;
  const { responsavel, equipe, situacao, busca } = await searchParams;

  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.DEMAND_READ,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  /**
   * A mesma pergunta em dois escopos: o papel pode valer na INSTITUIÇÃO (a
   * coordenação) ou só no EVENTO (a equipe do dia) — e exigir o escopo largo
   * recusaria o caso normal, que é o da equipe.
   */
  const allowed = (
    permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
  ): boolean =>
    can(principal, permission, { scope: 'EVENT', eventId }) ||
    can(principal, permission, { scope: 'TENANT' });

  const canManage = allowed(PERMISSIONS.DEMAND_MANAGE);
  const canConfigure = allowed(PERMISSIONS.DEMAND_TEAM_MANAGE);

  const result = await loadDemandBoard({
    tenantId,
    eventId,
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

  const situationTone = (situation: string): string => {
    if (situation === 'OVERDUE') return 'border-destructive/50 bg-destructive/5';
    if (situation === 'DUE_TODAY') return 'border-secondary-strong/50 bg-secondary/5';
    if (situation === 'DONE') return 'border-border bg-muted/40';
    return 'border-border';
  };

  return (
    <main className="space-y-8">
      <header className="space-y-1.5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <LayoutGrid className="size-5" aria-hidden />
          Demandas do evento
        </h1>
        <p className="text-sm text-muted-foreground">
          {event.title} · o que a equipe precisa fazer, quem está com cada frente e o que
          está atrasado.
        </p>
        <p className="text-xs text-muted-foreground">
          <Link href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/equipes`)} className="underline">
            Equipes do evento
          </Link>{' '}
          · as pessoas atribuídas saem da equipe ativa da instituição.
        </p>
      </header>

      {/* ── Resumo: o que aperta primeiro ───────────────────────────────────── */}
      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="demand-summary">
        {[
          { key: 'open', label: 'Em aberto', value: board.summary.open },
          { key: 'overdue', label: 'Atrasadas', value: board.summary.overdue },
          { key: 'dueToday', label: 'Vencem hoje', value: board.summary.dueToday },
          { key: 'done', label: 'Concluídas', value: board.summary.done },
        ].map((item) => (
          <div
            key={item.key}
            className="rounded-lg border border-border bg-card p-3"
            data-testid={`demand-summary-${item.key}`}
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
          </div>
        ))}
      </section>

      {board.summary.byTeam.length > 0 ? (
        <section className="space-y-2" data-testid="demand-summary-teams">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Como as equipes estão
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {board.summary.byTeam.map((row) => {
              const team = board.teams.find((candidate) => candidate.id === row.teamId);

              return (
                <li key={row.teamId ?? 'sem-equipe'} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">
                    {team?.name ?? 'Sem equipe'}
                    {team?.leadName ? (
                      <span className="text-xs text-muted-foreground"> · líder: {team.leadName}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.open} em aberto · {row.overdue} atrasada(s) · {row.done} concluída(s)
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <form method="get" action={boardPath} className="flex flex-wrap items-end gap-2" data-testid="demand-filters">
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
      </form>

      {/* ── Nova demanda ────────────────────────────────────────────────────── */}
      {canManage ? (
        <details className="rounded-lg border border-border bg-card p-4" data-testid="demand-create">
          <summary className="cursor-pointer text-sm font-medium">
            <Plus className="mr-1 inline size-4" aria-hidden />
            Nova demanda
          </summary>

          <InlineActionForm
            action={createDemandAction}
            submitLabel="Criar demanda"
            testId="demand-create-form"
            variant="primary"
            className="mt-4 space-y-4"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="block text-muted-foreground">Título</span>
                <input
                  name="title"
                  required
                  maxLength={160}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-title"
                />
              </label>

              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="block text-muted-foreground">Descrição</span>
                <textarea
                  name="description"
                  rows={3}
                  maxLength={4000}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-description"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Coluna</span>
                <select
                  name="columnId"
                  defaultValue={board.columns[0]?.id ?? ''}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-column"
                >
                  {board.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Prioridade</span>
                <select
                  name="priority"
                  defaultValue="NORMAL"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-priority"
                >
                  {DEMAND_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {DEMAND_PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Equipe</span>
                <select
                  name="teamId"
                  defaultValue=""
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-team"
                >
                  <option value="">sem equipe</option>
                  {board.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Início</span>
                <input
                  type="date"
                  name="startAt"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-start"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Prazo (fim do dia, no fuso do evento)</span>
                <input
                  type="date"
                  name="dueAt"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-due"
                />
              </label>

              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="block text-muted-foreground">
                  Responsáveis (equipe ativa da instituição)
                </span>
                <select
                  name="assigneeIds"
                  multiple
                  size={Math.min(Math.max(board.people.length, 3), 8)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-assignees"
                >
                  {board.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </InlineActionForm>
        </details>
      ) : null}

      {/* ── O quadro ────────────────────────────────────────────────────────── */}
      <DemandBoardDnd
        action={moveDemandAction}
        tenantSlug={tenantSlug}
        eventId={eventId}
        canMove={canManage}
      >
        {board.columns.map((column) => (
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

            {column.cards.map((card, index) => (
              <article
                key={card.id}
                data-demand-id={card.id}
                data-demand-column={column.id}
                data-demand-index={index}
                data-demand-situation={card.situation}
                draggable={canManage}
                data-testid={`demand-card-${card.id}`}
                className={`space-y-2 rounded-md border p-2 text-sm ${situationTone(card.situation)}`}
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

                {/**
                 * O formulário do cartão é o caminho que NÃO depende de JavaScript:
                 * um `<form>` com a ação nativa `(formData) => void`, que o React
                 * envia mesmo antes da hidratação. O arrastar e soltar é o atalho.
                 */}
                {canManage && board.columns.length > 1 ? (
                  <form action={moveDemandFormAction} className="flex items-center gap-1">
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="demandId" value={card.id} />
                    <input type="hidden" name="fromColumnId" value={column.id} />
                    <select
                      name="toColumnId"
                      defaultValue={column.id}
                      aria-label={`Mover "${card.title}" para`}
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-xs"
                      data-testid={`demand-move-select-${card.id}`}
                    >
                      {board.columns.map((option) => (
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
            ))}
          </section>
        ))}
      </DemandBoardDnd>

      {board.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este quadro ainda não tem colunas. Abra a configuração abaixo para criar a primeira.
        </p>
      ) : null}

      {/* ── Configuração das colunas ────────────────────────────────────────── */}
      {canConfigure ? (
        <details className="rounded-lg border border-border bg-card p-4" data-testid="demand-columns-config">
          <summary className="cursor-pointer text-sm font-medium">Colunas do quadro</summary>

          <div className="mt-4 space-y-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex flex-wrap items-end gap-2 border-b border-border pb-3 last:border-0"
                data-testid={`demand-column-row-${column.id}`}
              >
                <InlineActionForm
                  action={updateColumnAction}
                  submitLabel="Renomear"
                  testId={`demand-column-rename-${column.id}`}
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="columnId" value={column.id} />
                  <input
                    name="name"
                    defaultValue={column.name}
                    maxLength={40}
                    className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    data-testid={`demand-column-name-${column.id}`}
                  />
                </InlineActionForm>

                <InlineActionForm
                  action={updateColumnAction}
                  submitLabel={column.isDone ? 'Deixar de concluir' : 'Marcar como conclusão'}
                  testId={`demand-column-done-${column.id}`}
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="columnId" value={column.id} />
                  <input type="hidden" name="isDone" value={column.isDone ? 'false' : 'true'} />
                </InlineActionForm>

                <InlineActionForm
                  action={reorderColumnsAction}
                  submitLabel="←"
                  testId={`demand-column-up-${column.id}`}
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="columnId" value={column.id} />
                  <input type="hidden" name="direction" value="up" />
                </InlineActionForm>

                <InlineActionForm
                  action={reorderColumnsAction}
                  submitLabel="→"
                  testId={`demand-column-down-${column.id}`}
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="columnId" value={column.id} />
                  <input type="hidden" name="direction" value="down" />
                </InlineActionForm>

                <InlineActionForm
                  action={deleteColumnAction}
                  submitLabel="Excluir"
                  testId={`demand-column-delete-${column.id}`}
                  variant="destructive"
                  confirm={{
                    title: `Excluir a coluna "${column.name}"?`,
                    description:
                      'A coluna só pode ser excluída se estiver vazia. As demandas que estão nela precisam ser movidas antes.',
                    confirmLabel: 'Excluir coluna',
                  }}
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="columnId" value={column.id} />
                </InlineActionForm>
              </div>
            ))}

            <InlineActionForm
              action={createColumnAction}
              submitLabel="Criar coluna"
              testId="demand-column-create"
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input
                name="name"
                placeholder="Nome da coluna"
                maxLength={40}
                className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                data-testid="demand-column-new-name"
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" name="isDone" data-testid="demand-column-new-done" />
                conclui a demanda
              </label>
            </InlineActionForm>
          </div>
        </details>
      ) : null}

      {/* O menu do evento usa a mesma permissão da página. */}
      <p className="text-xs text-muted-foreground">
        <Link href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)} className="underline">
          Voltar ao painel do evento
        </Link>
      </p>
    </main>
  );
}

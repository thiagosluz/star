import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock, MessageSquare, Users } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { loadDemandDetail } from '@/lib/events/demand-service';
import {
  DEMAND_PRIORITIES,
  DEMAND_PRIORITY_LABELS,
  dayFromDueAt,
} from '@/domain/events/demand-rules';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  assignDemandAction,
  commentDemandAction,
  deleteDemandAction,
  updateDemandAction,
} from '@/app/actions/demand-actions';

export const metadata = { title: 'Demanda' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FICHA DA DEMANDA (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A FICHA ACRESCENTA AO CARTÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Três coisas que não cabem num cartão de 100 px: a CONVERSA (comentários com
 *  menção), a NARRATIVA (linha do tempo: quem moveu, quem atribuiu, quando concluiu)
 *  e o CADASTRO (título, descrição, prazo, equipe, responsáveis).
 *
 *  A linha do tempo mostra as DUAS PONTAS de cada mudança ("Em andamento → Em
 *  revisão"), e não o estado atual: quem lê depois precisa saber o caminho, e o
 *  caminho não é reconstruível a partir do estado de hoje.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function DemandDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string; demandId: string }>;
}) {
  const { tenantSlug, eventId, demandId } = await params;

  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.DEMAND_READ,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const allowed = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]): boolean =>
    can(principal, permission, { scope: 'EVENT', eventId }) ||
    can(principal, permission, { scope: 'TENANT' });

  const canManage = allowed(PERMISSIONS.DEMAND_MANAGE);
  const canAssign = allowed(PERMISSIONS.DEMAND_ASSIGN);

  const result = await loadDemandDetail({ tenantId, demandId });
  if (!result.ok) notFound();

  const { detail } = result;
  const basePath = `/administracao/eventos/${eventId}/demandas`;
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: detail.timeZone,
  });

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <Link
          href={tenantPath(tenantSlug, basePath)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Voltar ao quadro
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight" data-testid="demand-detail-title">
          {detail.card.title}
        </h1>

        <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span data-testid="demand-detail-situation">{detail.card.situationLabel}</span>
          <span>{detail.card.priorityLabel}</span>
          {detail.card.dueLabel ? (
            <span className="flex items-center gap-1" data-testid="demand-detail-due">
              <Clock className="size-3" aria-hidden />
              {detail.card.dueLabel}
            </span>
          ) : null}
          <span>
            {detail.card.teamName ? `${detail.card.teamName} · ` : ''}
            {detail.card.assignees.length > 0
              ? detail.card.assignees.map((assignee) => assignee.name).join(', ')
              : 'sem responsável'}
          </span>
          <span>
            {detail.createdByName ? `criada por ${detail.createdByName} em ` : 'criada em '}
            {formatter.format(detail.createdAt)}
          </span>
        </p>

        {detail.card.description ? (
          <p className="max-w-3xl whitespace-pre-line text-sm" data-testid="demand-detail-description">
            {detail.card.description}
          </p>
        ) : null}
      </header>

      {/* ── Responsáveis e equipe ───────────────────────────────────────────── */}
      {canAssign ? (
        <section className="rounded-lg border border-border bg-card p-4" data-testid="demand-detail-assign">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" aria-hidden />
            Responsáveis
          </h2>

          <InlineActionForm
            action={assignDemandAction}
            submitLabel="Salvar responsáveis"
            testId="demand-assign-form"
            variant="primary"
            className="mt-3 space-y-3"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="demandId" value={demandId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Equipe</span>
                <select
                  name="teamId"
                  defaultValue={detail.card.teamId ?? ''}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-assign-team"
                >
                  <option value="">sem equipe</option>
                  {detail.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Pessoas</span>
                <select
                  name="assigneeIds"
                  multiple
                  size={Math.min(Math.max(detail.people.length, 3), 8)}
                  defaultValue={detail.card.assignees.map((assignee) => assignee.id)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-assign-people"
                >
                  {detail.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="text-xs text-muted-foreground">
              Sem permissão de coordenação, o líder distribui apenas dentro da equipe que lidera.
            </p>
          </InlineActionForm>
        </section>
      ) : null}

      {/* ── Cadastro ────────────────────────────────────────────────────────── */}
      {canManage ? (
        <details className="rounded-lg border border-border bg-card p-4" data-testid="demand-detail-edit">
          <summary className="cursor-pointer text-sm font-medium">Editar demanda</summary>

          <InlineActionForm
            action={updateDemandAction}
            submitLabel="Salvar demanda"
            testId="demand-edit-form"
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="demandId" value={demandId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="block text-muted-foreground">Título</span>
                <input
                  name="title"
                  defaultValue={detail.card.title}
                  required
                  maxLength={160}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-edit-title"
                />
              </label>

              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="block text-muted-foreground">Descrição</span>
                <textarea
                  name="description"
                  rows={4}
                  maxLength={4000}
                  defaultValue={detail.card.description ?? ''}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-edit-description"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Prioridade</span>
                <select
                  name="priority"
                  defaultValue={detail.card.priority}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-edit-priority"
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
                  defaultValue={detail.card.teamId ?? ''}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-edit-team"
                >
                  <option value="">sem equipe</option>
                  {detail.teams.map((team) => (
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
                  defaultValue={dayFromDueAt(detail.card.startAt, detail.timeZone)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-edit-start"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Prazo (fim do dia, no fuso do evento)</span>
                <input
                  type="date"
                  name="dueAt"
                  defaultValue={dayFromDueAt(detail.card.dueAt, detail.timeZone)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="demand-edit-due"
                />
              </label>
            </div>
          </InlineActionForm>

          <div className="mt-4 border-t border-border pt-3">
            <InlineActionForm
              action={deleteDemandAction}
              submitLabel="Excluir demanda"
              testId="demand-delete-form"
              variant="destructive"
              confirm={{
                title: `Excluir "${detail.card.title}"?`,
                description:
                  'A demanda sai do quadro e o histórico dela deixa de aparecer. O registro de quem excluiu fica na trilha de auditoria.',
                confirmLabel: 'Excluir demanda',
              }}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="demandId" value={demandId} />
            </InlineActionForm>
          </div>
        </details>
      ) : null}

      {/* ── Conversa ────────────────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="demand-comments">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="size-4" aria-hidden />
          Comentários ({detail.comments.length})
        </h2>

        {detail.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>
        ) : (
          <ul className="space-y-2">
            {detail.comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-lg border border-border bg-card p-3 text-sm"
                data-testid={`demand-comment-${comment.id}`}
              >
                <p className="text-xs text-muted-foreground">
                  {comment.authorName} · {formatter.format(comment.createdAt)}
                  {comment.mentions.length > 0
                    ? ` · mencionou ${comment.mentions.map((mention) => mention.name).join(', ')}`
                    : ''}
                </p>
                <p className="mt-1 whitespace-pre-line">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        <InlineActionForm
          action={commentDemandAction}
          submitLabel="Comentar"
          testId="demand-comment-form"
          quietSuccess
          className="space-y-3 rounded-lg border border-border bg-card p-4"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="demandId" value={demandId} />

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Comentário</span>
            <textarea
              name="body"
              rows={3}
              maxLength={2000}
              required
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-comment-body"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">
              Avisar quem (a pessoa recebe e-mail e mensagem na caixa de entrada)
            </span>
            <select
              name="mentionIds"
              multiple
              size={Math.min(Math.max(detail.people.length, 3), 6)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-comment-mentions"
            >
              {detail.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        </InlineActionForm>
      </section>

      {/* ── Linha do tempo ──────────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="demand-timeline">
        <h2 className="text-sm font-medium">Histórico</h2>

        <ol className="space-y-1 text-sm">
          {detail.timeline.map((entry) => (
            <li key={entry.id} className="text-muted-foreground" data-testid={`demand-timeline-${entry.id}`}>
              <span className="text-xs">{formatter.format(entry.createdAt)}</span>{' '}
              <span className="text-foreground">{entry.actorName ?? 'Sistema'}</span> {entry.label}
              {entry.fromValue && entry.toValue ? (
                <>
                  {' '}
                  <span className="text-xs">
                    {entry.fromValue} → {entry.toValue}
                  </span>
                </>
              ) : entry.toValue ? (
                <span className="text-xs"> {entry.toValue}</span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Crown, Users } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { loadDemandBoard } from '@/lib/events/demand-service';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  createTeamAction,
  deleteTeamAction,
  setTeamMembersAction,
} from '@/app/actions/demand-actions';

export const metadata = { title: 'Equipes do evento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EQUIPES DO EVENTO (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EQUIPE É ENTIDADE, E NÃO UM RÓTULO NO CARTÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Como as equipes estão trabalhando" só tem resposta se a equipe EXISTIR: com um
 *  rótulo livre, "logística" numa demanda e "Logística" na outra seriam duas equipes,
 *  e o resumo mentiria. Aqui a equipe tem nome próprio, um LÍDER e membros — e é o
 *  líder que ganha o direito de distribuir trabalho dentro dela
 *  (`demand:assign:own-team`, com a posse conferida no serviço).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM PODE ENTRAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Só vínculo `MEMBER` ATIVO da instituição. Participante de evento não é força de
 *  trabalho por acidente — e a lista de candidatos é a mesma da atribuição de
 *  demanda, porque duas definições de "quem trabalha aqui" divergiriam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventTeamsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.DEMAND_READ,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const canConfigure =
    can(principal, PERMISSIONS.DEMAND_TEAM_MANAGE, { scope: 'EVENT', eventId }) ||
    can(principal, PERMISSIONS.DEMAND_TEAM_MANAGE, { scope: 'TENANT' });

  const result = await loadDemandBoard({ tenantId, eventId });
  if (!result.ok) notFound();

  const { board } = result;

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <Link
          href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/demandas`)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Voltar ao quadro
        </Link>

        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Users className="size-5" aria-hidden />
          Equipes do evento
        </h1>
        <p className="text-sm text-muted-foreground">
          {event.title} · quem executa as demandas. O líder distribui trabalho dentro da própria
          equipe.
        </p>
      </header>

      {board.teams.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="teams-empty">
          Nenhuma equipe criada ainda. As demandas podem ser atribuídas a pessoas sem passar por
          equipe.
        </p>
      ) : (
        <ul className="space-y-4" data-testid="teams-list">
          {board.teams.map((team) => (
            <li key={team.id} className="rounded-lg border border-border bg-card p-4" data-testid={`team-${team.id}`}>
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium">{team.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {team.leadName ? (
                      <span className="inline-flex items-center gap-1">
                        <Crown className="size-3" aria-hidden />
                        líder: {team.leadName}
                      </span>
                    ) : (
                      'sem líder definido'
                    )}{' '}
                    · {team.openDemands} demanda(s) em aberto
                  </p>
                  {team.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{team.description}</p>
                  ) : null}
                </div>
              </header>

              {canConfigure ? (
                <div className="mt-3 space-y-2">
                  <InlineActionForm
                    action={setTeamMembersAction}
                    submitLabel="Salvar equipe"
                    testId={`team-members-${team.id}`}
                    className="space-y-2"
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="teamId" value={team.id} />

                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="space-y-1 text-xs">
                        <span className="block text-muted-foreground">Membros</span>
                        <select
                          name="memberIds"
                          multiple
                          size={Math.min(Math.max(board.people.length, 3), 8)}
                          defaultValue={team.members.map((member) => member.id)}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          data-testid={`team-members-select-${team.id}`}
                        >
                          {board.people.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1 text-xs">
                        <span className="block text-muted-foreground">Líder (um por equipe)</span>
                        <select
                          name="leadId"
                          defaultValue={team.leadId ?? ''}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          data-testid={`team-lead-${team.id}`}
                        >
                          <option value="">sem líder</option>
                          {team.members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </InlineActionForm>

                  <InlineActionForm
                    action={deleteTeamAction}
                    submitLabel="Excluir equipe"
                    testId={`team-delete-${team.id}`}
                    variant="destructive"
                    confirm={{
                      title: `Excluir a equipe "${team.name}"?`,
                      description:
                        'A equipe só pode ser excluída sem demandas em aberto. As demandas já concluídas ficam sem equipe.',
                      confirmLabel: 'Excluir equipe',
                    }}
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="teamId" value={team.id} />
                  </InlineActionForm>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {team.members.length > 0
                    ? team.members.map((member) => member.name).join(', ')
                    : 'sem membros'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canConfigure ? (
        <details className="rounded-lg border border-border bg-card p-4" data-testid="team-create">
          <summary className="cursor-pointer text-sm font-medium">Nova equipe</summary>

          <InlineActionForm
            action={createTeamAction}
            submitLabel="Criar equipe"
            testId="team-create-form"
            variant="primary"
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Nome</span>
                <input
                  name="name"
                  required
                  maxLength={40}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="team-name"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Descrição</span>
                <input
                  name="description"
                  maxLength={300}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="team-description"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">
                  Membros (equipe ativa da instituição)
                </span>
                <select
                  name="memberIds"
                  multiple
                  size={Math.min(Math.max(board.people.length, 3), 8)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="team-members"
                >
                  {board.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Líder</span>
                <select
                  name="leadId"
                  defaultValue=""
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  data-testid="team-lead"
                >
                  <option value="">definir depois</option>
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
    </main>
  );
}

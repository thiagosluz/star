import Link from 'next/link';
import { ArchiveRestore, ListChecks, Pencil, Plus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { TASK_KIND_LABELS, parseTaskTarget } from '@/domain/gamification/task-rules';
import { XP_SOURCE_LABELS } from '@/domain/gamification/xp-rules';
import {
  CATALOG_SCOPE_LABELS,
  catalogScopeFromQuery,
  catalogScopeToggleLabel,
} from '@/domain/gamification/catalog-rules';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { listMissions } from '@/lib/admin/gamification-admin-service';
import { withTenant } from '@/lib/db/tenant-client';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { deleteMissionAction } from '@/app/actions/admin-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { restoreMissionAction } from '@/app/actions/catalog-archive-actions';

export const metadata = { title: 'Missões' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  COCKPIT DE MISSÕES (FASE 43 · FASE 51 · FASE 97 · ADR-409)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A listagem mostra quantos participantes COMPLETARAM e quantos RESGATARAM cada
 *  missão. A diferença entre os dois números é operacional: muitas conclusões sem
 *  resgate indicam que a recompensa não está sendo percebida.
 *
 *  Na FASE 97, o formulário de criação foi movido para `/administracao/missoes/nova`
 *  e os N formulários de edição em `<details>` para `/administracao/missoes/[missionId]/editar`,
 *  unificando o cockpit em cards brancos elevados e reduzindo a renderização a
 *  UMA única transação (`withTenant`) sem carregar listas de eventos nem cartas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function AdminMissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ arquivados?: string }>;
}) {
  const { tenantSlug } = await params;
  const { arquivados } = await searchParams;

  const scope = catalogScopeFromQuery(arquivados);
  const arquivando = scope === 'ARQUIVADOS';

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TASK_MANAGE,
  });

  const { missions, timezone } = await withTenant(tenantId, async (tx) => {
    const loadedMissions = await listMissions(tenantId, scope, tx);
    const loadedTimezone = arquivando
      ? ((
          await tx.tenant.findUnique({
            where: { id: tenantId },
            select: { timezone: true },
          })
        )?.timezone ?? 'UTC')
      : 'UTC';

    return { missions: loadedMissions, timezone: loadedTimezone };
  });

  const novaMissaoUrl = tenantPath(tenantSlug, '/administracao/missoes/nova');

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Missões"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<ListChecks className="size-6 text-primary" aria-hidden />}
        description="A missão avança quando o fato do gatilho acontece; o XP é creditado no RESGATE, feito pelo participante."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Missões' },
        ]}
        actions={
          arquivando ? null : (
            <Link
              href={novaMissaoUrl}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              data-testid="btn-nova-missao"
            >
              <Plus className="size-4" aria-hidden />
              Nova missão
            </Link>
          )
        }
      />

      {/* O filtro é um LINK: endereço próprio, sem JavaScript e sem estado escondido. */}
      <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Escopo do catálogo de missões">
        <Link
          href={
            arquivando
              ? tenantPath(tenantSlug, '/administracao/missoes')
              : `${tenantPath(tenantSlug, '/administracao/missoes')}?arquivados=1`
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 font-medium shadow-xs transition-colors hover:bg-muted"
          data-testid="missions-archive-toggle"
          aria-current={arquivando ? 'page' : undefined}
        >
          <ArchiveRestore className="size-4" aria-hidden />
          {catalogScopeToggleLabel(scope)}
        </Link>
        <span className="text-xs text-muted-foreground" data-testid="missions-scope-label">
          {CATALOG_SCOPE_LABELS[scope]}
        </span>
      </nav>

      <section className="space-y-4" aria-labelledby="lista-missoes">
        <div className="flex items-center justify-between gap-2">
          <h2 id="lista-missoes" className="text-lg font-semibold tracking-tight">
            {arquivando ? `Arquivadas (${missions.length})` : `Missões definidas (${missions.length})`}
          </h2>
        </div>

        {missions.length === 0 ? (
          <div
            className="flex flex-col items-start justify-between gap-4 rounded-xl border border-dashed border-border bg-card p-6 sm:flex-row sm:items-center"
            data-testid="missions-empty"
          >
            <p className="text-sm text-muted-foreground">
              {arquivando
                ? 'Nenhuma missão arquivada. O que for excluído aparece aqui, com a data e o autor da exclusão.'
                : 'Nenhuma missão cadastrada.'}
            </p>
            {arquivando ? null : (
              <Link
                href={novaMissaoUrl}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                data-testid="btn-empty-nova-missao"
              >
                <Plus className="size-4" aria-hidden />
                Criar primeira missão
              </Link>
            )}
          </div>
        ) : (
          <ul className="space-y-4" data-testid="admin-mission-list">
            {missions.map((mission) => {
              const target = parseTaskTarget(mission.target).target;

              return (
                <li
                  key={mission.id}
                  className="space-y-4 rounded-xl border border-border bg-card p-5 text-sm shadow-sm transition-shadow hover:shadow-md"
                  data-testid={`admin-mission-${mission.id}`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold tracking-tight text-foreground">
                        {mission.name}
                      </p>
                      <span className="code-data text-xs text-muted-foreground">
                        ({mission.slug})
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {TASK_KIND_LABELS[mission.kind as keyof typeof TASK_KIND_LABELS] ?? mission.kind} ·{' '}
                      {XP_SOURCE_LABELS[mission.trigger as keyof typeof XP_SOURCE_LABELS] ?? mission.trigger} · meta{' '}
                      {target.count}
                      {target.activityType ? ` de ${target.activityType}` : ''}
                      {target.minutes ? ` com ${target.minutes} min` : ''} · +{mission.xpReward} XP
                      {mission.rewardCardSlug ? ` + carta ${mission.rewardCardSlug}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {mission.completions} conclusão(ões) · {mission.claims} resgate(s) ·{' '}
                      {mission.isActive ? 'ativa' : 'inativa'} · {mission.isVisible ? 'visível' : 'oculta'}
                    </p>
                    {arquivando && mission.archivedAt ? (
                      <p className="text-xs text-muted-foreground" data-testid={`mission-archived-${mission.id}`}>
                        Arquivada em {formatZonedDateTime(mission.archivedAt, timezone)} por{' '}
                        {mission.archivedByName ?? 'conta removida'}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    {arquivando ? (
                      <InlineActionForm
                        action={restoreMissionAction}
                        submitLabel="Restaurar"
                        testId={`mission-restore-${mission.id}`}
                        confirm={{
                          title: `Restaurar a missão “${mission.name}”?`,
                          description: `Ela volta para a lista de quem joga e o progresso de quem já avançou continua valendo.${
                            mission.archivedAt
                              ? ` Arquivada em ${formatZonedDateTime(mission.archivedAt, timezone)}${
                                  mission.archivedByName ? ` por ${mission.archivedByName}` : ''
                                }.`
                              : ''
                          }`,
                          confirmLabel: 'Restaurar missão',
                          tone: 'default',
                        }}
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="taskDefinitionId" value={mission.id} />
                      </InlineActionForm>
                    ) : (
                      <>
                        <Link
                          href={tenantPath(
                            tenantSlug,
                            `/administracao/missoes/${mission.id}/editar`,
                          )}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                          data-testid={`mission-edit-${mission.id}`}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" aria-hidden />
                          Editar missão
                        </Link>

                        <InlineActionForm
                          action={deleteMissionAction}
                          submitLabel="Excluir"
                          variant="destructive"
                          testId={`mission-delete-${mission.id}`}
                          confirm={{
                            title: `Excluir a missão “${mission.name}”?`,
                            description:
                              mission.completions > 0
                                ? `Ela sai da lista de quem joga. As ${mission.completions} pessoa(s) que progrediram mantêm o histórico e os ${mission.claims} resgate(s) já creditados — o XP não é estornado. Ela pode ser restaurada em "Mostrar arquivadas".`
                                : 'A missão sai da lista de quem joga. Ninguém tinha progredido nela. Ela pode ser restaurada em "Mostrar arquivadas".',
                            confirmLabel: 'Excluir missão',
                          }}
                        >
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="taskDefinitionId" value={mission.id} />
                        </InlineActionForm>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

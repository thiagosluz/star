import Link from 'next/link';
import { ArchiveRestore, ListChecks, Pencil } from 'lucide-react';

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
import {
  ACTIVITY_TYPES,
  MISSION_TRIGGER_KINDS,
  RETIRED_XP_SOURCE_KINDS,
  TASK_KINDS,
} from '@/domain/gamification/types';
import {
  listCardTemplates,
  listMissions,
  type AdminMissionRow,
} from '@/lib/admin/gamification-admin-service';
import { listAdminEvents, type AdminEventRow } from '@/lib/admin/catalog-service';
import { withTenant } from '@/lib/db/tenant-client';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { deleteMissionAction, saveMissionAction } from '@/app/actions/admin-actions';
import { restoreMissionAction } from '@/app/actions/catalog-archive-actions';

export const metadata = { title: 'Missões' };
export const dynamic = 'force-dynamic';

/**
 * Os campos da missão, em UM lugar só (FASE 43) — criar e editar compartilham.
 *
 * O gatilho vem de `MISSION_TRIGGER_KINDS` (lista curada) e NÃO de `XP_SOURCE_KINDS`:
 * "Indicação" e "Bônus" apareciam no formulário sem nenhum caminho do sistema que os
 * emitisse, então a missão nascia impossível de completar.
 */
function MissionFields({
  eventOptions,
  cardOptions,
  mission,
}: {
  eventOptions: { value: string; label: string }[];
  cardOptions: { value: string; label: string }[];
  mission?: AdminMissionRow;
}) {
  const target = mission ? parseTaskTarget(mission.target).target : null;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Identificador"
          name="slug"
          required
          placeholder="presenca-tripla"
          defaultValue={mission?.slug}
        />
        <Field label="Nome" name="name" required placeholder="Presença tripla" defaultValue={mission?.name} />
        <Field
          label="Descrição"
          name="description"
          placeholder="Participe de três atividades"
          defaultValue={mission?.description ?? undefined}
        />
        <SelectField
          label="Tipo"
          name="kind"
          options={TASK_KINDS.map((kind) => ({ value: kind, label: TASK_KIND_LABELS[kind] }))}
          defaultValue={mission?.kind ?? 'ONE_OFF'}
        />
        <SelectField
          label="Gatilho"
          name="trigger"
          options={MISSION_TRIGGER_KINDS.map((source) => ({ value: source, label: XP_SOURCE_LABELS[source] }))}
          defaultValue={mission?.trigger ?? 'CHECKIN'}
        />
        <SelectField
          label="Evento"
          name="eventId"
          options={eventOptions}
          defaultValue={mission?.id ? undefined : ''}
        />
        <Field
          label="Meta (quantidade)"
          name="targetCount"
          type="number"
          min={1}
          defaultValue={target?.count ?? 1}
        />
        <SelectField
          label="Filtrar por tipo de atividade"
          name="targetActivityType"
          options={[
            { value: '', label: 'Qualquer tipo' },
            ...ACTIVITY_TYPES.map((type) => ({ value: type, label: type })),
          ]}
          defaultValue={target?.activityType ?? ''}
        />
        <Field
          label="Minutos mínimos"
          name="targetMinutes"
          type="number"
          min={1}
          hint="Opcional"
          defaultValue={target?.minutes ?? undefined}
        />
        <Field
          label="Recompensa em XP"
          name="xpReward"
          type="number"
          min={0}
          defaultValue={mission?.xpReward ?? 50}
        />
        <SelectField
          label="Carta de recompensa"
          name="rewardCardTemplateId"
          options={cardOptions}
          defaultValue={mission?.rewardCardTemplateId ?? ''}
        />
        <Field
          label="Repetir a cada (horas, 0 = não repetível)"
          name="repeatEveryHours"
          type="number"
          min={0}
          defaultValue={mission?.repeatEveryHours ?? 0}
        />
        <Field
          label="Ordem de exibição"
          name="displayOrder"
          type="number"
          defaultValue={mission?.displayOrder ?? 0}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <CheckboxField label="Missão ativa" name="isActive" defaultChecked={mission?.isActive ?? true} />
        <CheckboxField
          label="Visível no painel do participante"
          name="isVisible"
          defaultChecked={mission?.isVisible ?? true}
        />
      </div>
    </>
  );
}

/**
 * Missões e metas.
 *
 * A tabela mostra quantos participantes COMPLETARAM e quantos RESGATARAM cada
 * missão. A diferença entre os dois números é operacional: muitas conclusões sem
 * resgate indicam que a recompensa não está sendo percebida — e a correção é de
 * comunicação, não de regra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  "MOSTRAR ARQUIVADAS" (FASE 51 · dívida E58)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A exclusão da missão é lógica desde a FASE 43 e a leitura filtrava `deletedAt:
 *  null`: a missão sumia da tela sem lugar para vê-la de novo. O filtro
 *  (`?arquivados=1`) abre o MESMO catálogo no escopo arquivado — sem JavaScript,
 *  com endereço próprio —, mostrando quando e por quem cada missão foi excluída, e
 *  com o botão que a traz de volta. Restaurar não mexe no progresso de ninguém: a
 *  exclusão nunca o tocou, e é isso que a tela diz.
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

  const [missions, cards, events] = await Promise.all([
    listMissions(tenantId, scope),
    listCardTemplates(tenantId),
    /** A visão de arquivo não cria missão: não carrega o que não usa. */
    arquivando ? Promise.resolve([] as AdminEventRow[]) : listAdminEvents(tenantId),
  ]);

  /**
   * O fuso só é lido quando há data de arquivamento para mostrar — no catálogo ativo
   * a página não tem o que datar, e uma consulta a mais por renderização seria paga
   * por todo mundo para servir a um caso.
   */
  const timezone = arquivando
    ? await withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
        return tenant?.timezone ?? 'UTC';
      })
    : 'UTC';

  const eventOptions = [
    { value: '', label: 'Missão do tenant (qualquer evento)' },
    ...events.map((event) => ({ value: event.id, label: event.title })),
  ];

  const cardOptions = [
    { value: '', label: 'Sem carta de recompensa' },
    ...cards.filter((card) => card.trigger === 'MANUAL_GRANT').map((card) => ({ value: card.id, label: card.name })),
  ];

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/administracao')}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Administração
          </Link>
        </nav>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ListChecks className="size-6 text-primary" aria-hidden />
          Missões
        </h1>
        <p className="text-sm text-muted-foreground">
          A missão avança quando o fato do gatilho acontece; o XP é creditado no RESGATE, feito pelo participante.
        </p>
      </header>

      {/* O filtro é um LINK: endereço próprio, sem JavaScript e sem estado escondido. */}
      <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Escopo do catálogo de missões">
        <Link
          href={
            arquivando
              ? tenantPath(tenantSlug, '/administracao/missoes')
              : `${tenantPath(tenantSlug, '/administracao/missoes')}?arquivados=1`
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted"
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
        <h2 id="lista-missoes" className="text-lg font-semibold tracking-tight">
          {arquivando ? `Arquivadas (${missions.length})` : `Missões definidas (${missions.length})`}
        </h2>

        {missions.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="missions-empty">
            {arquivando
              ? 'Nenhuma missão arquivada. O que for excluído aparece aqui, com a data e o autor da exclusão.'
              : 'Nenhuma missão cadastrada.'}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="admin-mission-list">
            {missions.map((mission) => {
              const target = parseTaskTarget(mission.target).target;

              return (
                <li key={mission.id} className="space-y-3 p-4 text-sm" data-testid={`admin-mission-${mission.id}`}>
                  <div className="space-y-0.5">
                    <p className="font-medium">{mission.name}</p>
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
                    {/*
                      QUANDO E POR QUEM (FASE 51 · E58): os dois dados vêm da TRILHA, numa
                      consulta só para a lista. Restaurar sem eles seria decidir no escuro.
                    */}
                    {arquivando && mission.archivedAt ? (
                      <p className="text-xs text-muted-foreground" data-testid={`mission-archived-${mission.id}`}>
                        Arquivada em {formatZonedDateTime(mission.archivedAt, timezone)} por{' '}
                        {mission.archivedByName ?? 'conta removida'}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    {arquivando ? (
                      /**
                       * Arquivada só volta. Editar e excluir ficam de fora: o serviço de
                       * gravação procura a linha com `deletedAt: null`, e oferecer os
                       * formulários seria oferecer um caminho que responde "não encontrada".
                       */
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
                        <details className="min-w-0 flex-1">
                          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                            <Pencil className="size-3.5" aria-hidden />
                            Editar missão
                          </summary>
                          <div className="pt-3">
                            <AdminForm
                              action={saveMissionAction}
                              submitLabel="Salvar missão"
                              testId={`mission-form-${mission.id}`}
                              compact
                            >
                              <input type="hidden" name="tenantSlug" value={tenantSlug} />
                              <input type="hidden" name="taskDefinitionId" value={mission.id} />
                              <MissionFields
                                eventOptions={eventOptions}
                                cardOptions={cardOptions}
                                mission={mission}
                              />
                            </AdminForm>
                          </div>
                        </details>

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

      {/* Missão arquivada não se cria: a seção só existe no catálogo ativo. */}
      {arquivando ? null : (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-labelledby="nova-missao">
          <h2 id="nova-missao" className="text-lg font-semibold tracking-tight">
            Nova missão
          </h2>

          <AdminForm action={saveMissionAction} submitLabel="Criar missão" testId="create-mission">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <MissionFields eventOptions={eventOptions} cardOptions={cardOptions} />
          </AdminForm>

          {/*
            A promessa que o formulário NÃO pode fazer (FASE 43): as origens aposentadas
            continuam existindo no enum (há histórico gravado com elas), mas não têm
            emissor — oferecê-las criaria uma missão que ninguém consegue completar.
          */}
          <p className="text-xs text-muted-foreground">
            As origens <strong>{RETIRED_XP_SOURCE_KINDS.map((kind) => XP_SOURCE_LABELS[kind]).join(' e ')}</strong>{' '}
            saíram da lista: nenhum caminho do sistema as emite hoje, então uma missão com
            elas nunca avançaria.
          </p>
        </section>
      )}
    </main>
  );
}

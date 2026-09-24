import Link from 'next/link';
import { ListChecks, Pencil } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { TASK_KIND_LABELS, parseTaskTarget } from '@/domain/gamification/task-rules';
import { XP_SOURCE_LABELS } from '@/domain/gamification/xp-rules';
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
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { deleteMissionAction, saveMissionAction } from '@/app/actions/admin-actions';

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
 */
export default async function AdminMissionsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TASK_MANAGE,
  });

  const [missions, cards, events] = await Promise.all([
    listMissions(tenantId),
    listCardTemplates(tenantId),
    listAdminEvents(tenantId),
  ]);

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

      <section className="space-y-4" aria-labelledby="lista-missoes">
        <h2 id="lista-missoes" className="text-lg font-semibold tracking-tight">
          Missões definidas ({missions.length})
        </h2>

        {missions.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="missions-empty">
            Nenhuma missão cadastrada.
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
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
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
                            ? `Ela sai da lista de quem joga. As ${mission.completions} pessoa(s) que progrediram mantêm o histórico e os ${mission.claims} resgate(s) já creditados — o XP não é estornado.`
                            : 'A missão sai da lista de quem joga. Ninguém tinha progredido nela.',
                        confirmLabel: 'Excluir missão',
                      }}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="taskDefinitionId" value={mission.id} />
                    </InlineActionForm>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
    </main>
  );
}

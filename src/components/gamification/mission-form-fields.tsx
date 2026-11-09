import { TASK_KIND_LABELS, parseTaskTarget } from '@/domain/gamification/task-rules';
import { XP_SOURCE_LABELS } from '@/domain/gamification/xp-rules';
import {
  ACTIVITY_TYPES,
  MISSION_TRIGGER_KINDS,
  TASK_KINDS,
} from '@/domain/gamification/types';
import { type AdminMissionRow } from '@/lib/admin/gamification-admin-service';
import { CheckboxField, Field, SelectField } from '@/components/admin/admin-form';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMPOS DO FORMULÁRIO DE MISSÃO (FASE 97 · ADR-409)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Compartilhado entre `/administracao/missoes/nova` e
 *  `/administracao/missoes/[missionId]/editar`.
 *
 *  O gatilho vem de `MISSION_TRIGGER_KINDS` (lista curada) e NÃO de `XP_SOURCE_KINDS`:
 *  "Indicação" e "Bônus" apareciam no formulário sem nenhum caminho do sistema que os
 *  emitisse, então a missão nascia impossível de completar.
 */
export function MissionFormFields({
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
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Identificador"
          name="slug"
          required
          placeholder="presenca-tripla"
          defaultValue={mission?.slug}
        />
        <Field
          label="Nome"
          name="name"
          required
          placeholder="Presença tripla"
          defaultValue={mission?.name}
        />
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
          options={MISSION_TRIGGER_KINDS.map((source) => ({
            value: source,
            label: XP_SOURCE_LABELS[source],
          }))}
          defaultValue={mission?.trigger ?? 'CHECKIN'}
        />
        <SelectField
          label="Evento"
          name="eventId"
          options={eventOptions}
          defaultValue={mission?.eventId ?? ''}
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
    </div>
  );
}


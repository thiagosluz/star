import Link from 'next/link';
import { ListChecks } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { TASK_KIND_LABELS, parseTaskTarget } from '@/domain/gamification/task-rules';
import { XP_SOURCE_LABELS } from '@/domain/gamification/xp-rules';
import { TASK_KINDS, XP_SOURCE_KINDS, ACTIVITY_TYPES } from '@/domain/gamification/types';
import { listCardTemplates, listMissions } from '@/lib/admin/gamification-admin-service';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { saveMissionAction } from '@/app/actions/admin-actions';

export const metadata = { title: 'Missões' };
export const dynamic = 'force-dynamic';

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
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
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
                <li key={mission.id} className="space-y-0.5 p-4 text-sm">
                  <p className="font-medium">{mission.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {TASK_KIND_LABELS[mission.kind as keyof typeof TASK_KIND_LABELS] ?? mission.kind} ·{' '}
                    {XP_SOURCE_LABELS[mission.trigger as keyof typeof XP_SOURCE_LABELS] ?? mission.trigger} · meta{' '}
                    {target.count}
                    {target.activityType ? ` de ${target.activityType}` : ''}
                    {target.minutes ? ` com ${target.minutes} min` : ''} · +{mission.xpReward} XP
                    {mission.rewardCardSlug ? ` + carta ${mission.rewardCardSlug}` : ''}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {mission.completions} conclusão(ões) · {mission.claims} resgate(s) ·{' '}
                    {mission.isActive ? 'ativa' : 'inativa'} · {mission.isVisible ? 'visível' : 'oculta'}
                  </p>
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Identificador" name="slug" required placeholder="presenca-tripla" />
            <Field label="Nome" name="name" required placeholder="Presença tripla" />
            <Field label="Descrição" name="description" placeholder="Participe de três atividades" />
            <SelectField
              label="Tipo"
              name="kind"
              options={TASK_KINDS.map((kind) => ({ value: kind, label: TASK_KIND_LABELS[kind] }))}
              defaultValue="ONE_OFF"
            />
            <SelectField
              label="Gatilho"
              name="trigger"
              options={XP_SOURCE_KINDS.map((source) => ({ value: source, label: XP_SOURCE_LABELS[source] }))}
              defaultValue="CHECKIN"
            />
            <SelectField label="Evento" name="eventId" options={eventOptions} />
            <Field label="Meta (quantidade)" name="targetCount" type="number" min={1} defaultValue={1} />
            <SelectField
              label="Filtrar por tipo de atividade"
              name="targetActivityType"
              options={[{ value: '', label: 'Qualquer tipo' }, ...ACTIVITY_TYPES.map((type) => ({ value: type, label: type }))]}
            />
            <Field label="Minutos mínimos" name="targetMinutes" type="number" min={1} hint="Opcional" />
            <Field label="Recompensa em XP" name="xpReward" type="number" min={0} defaultValue={50} />
            <SelectField label="Carta de recompensa" name="rewardCardTemplateId" options={cardOptions} />
            <Field label="Repetir a cada (horas, 0 = não repetível)" name="repeatEveryHours" type="number" min={0} defaultValue={0} />
            <Field label="Ordem de exibição" name="displayOrder" type="number" defaultValue={0} />
          </div>

          <div className="flex flex-wrap gap-4">
            <CheckboxField label="Missão ativa" name="isActive" defaultChecked />
            <CheckboxField label="Visível no painel do participante" name="isVisible" defaultChecked />
          </div>
        </AdminForm>
      </section>
    </main>
  );
}

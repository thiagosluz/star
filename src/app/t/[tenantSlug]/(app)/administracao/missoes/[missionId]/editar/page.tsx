import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ListChecks } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import {
  getMissionForEdit,
  listCardTemplates,
} from '@/lib/admin/gamification-admin-service';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm } from '@/components/admin/admin-form';
import { saveMissionAction } from '@/app/actions/admin-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { MissionFormFields } from '@/components/gamification/mission-form-fields';

export const metadata = { title: 'Editar missão' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EDIÇÃO DEDICADA DE MISSÃO (FASE 97 · ADR-409)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Retira os N formulários de 15 campos e as N cópias dos seletores de eventos e
 *  cartas de dentro de `<details>` na listagem `/administracao/missoes`,
 *  reduzindo o payload RSC da listagem e unificando o cockpit com Cartas.
 *
 *  Carrega a missão, o catálogo de cartas e a lista de eventos em UMA única
 *  transação (`withTenant`) e responde 404 uniforme quando a missão não pertence
 *  à instituição ou está arquivada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EditarMissaoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; missionId: string }>;
}) {
  const resolvedParams = await params;
  const missionId = requireUuidParam(resolvedParams, 'missionId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TASK_MANAGE,
  });

  const data = await withTenant(tenantId, async (tx) => {
    const mission = await getMissionForEdit(tenantId, missionId, tx);
    if (!mission) return null;

    const cards = await listCardTemplates(tenantId, 'ATIVOS', tx);
    const events = await listAdminEvents(tenantId, tx);
    return { mission, cards, events };
  });

  if (!data) notFound();

  const { mission, cards, events } = data;

  const eventOptions = [
    { value: '', label: 'Missão do tenant (qualquer evento)' },
    ...events.map((event) => ({ value: event.id, label: event.title })),
  ];

  const cardOptions = [
    { value: '', label: 'Sem carta de recompensa' },
    ...cards
      .filter((card) => card.trigger === 'MANUAL_GRANT')
      .map((card) => ({ value: card.id, label: card.name })),
  ];

  const missionsUrl = tenantPath(tenantSlug, '/administracao/missoes');

  return (
    <main className="max-w-4xl space-y-6" data-testid="edit-mission-page">
      <PageHeader
        title={`Editar missão: ${mission.name}`}
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<ListChecks className="size-6 text-primary" aria-hidden />}
        description={
          <>
            Atualize o gatilho, a meta de progresso e a recompensa em XP ou carta da missão{' '}
            <span className="code-data">{mission.slug}</span>.
          </>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Missões', href: missionsUrl },
          { label: mission.name },
        ]}
      />

      <div>
        <Link
          href={missionsUrl}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          data-testid="link-voltar-missoes"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para Missões
        </Link>
      </div>

      <section
        className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="edit-mission-section"
      >
        <div className="border-b border-border pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Definição da missão
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            O progresso de quem já completou ou resgatou a missão ({mission.completions}{' '}
            conclusão(ões) · {mission.claims} resgate(s)) é preservado.
          </p>
        </div>

        <AdminForm
          action={saveMissionAction}
          submitLabel="Salvar missão"
          testId={`mission-form-${mission.id}`}
          backHref={missionsUrl}
          backLabel="Voltar para Missões"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="taskDefinitionId" value={mission.id} />
          <MissionFormFields
            eventOptions={eventOptions}
            cardOptions={cardOptions}
            mission={mission}
          />
        </AdminForm>
      </section>
    </main>
  );
}


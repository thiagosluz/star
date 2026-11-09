import Link from 'next/link';
import { ArrowLeft, ListChecks } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { XP_SOURCE_LABELS } from '@/domain/gamification/xp-rules';
import { RETIRED_XP_SOURCE_KINDS } from '@/domain/gamification/types';
import { withTenant } from '@/lib/db/tenant-client';
import { listCardTemplates } from '@/lib/admin/gamification-admin-service';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm } from '@/components/admin/admin-form';
import { saveMissionAction } from '@/app/actions/admin-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { MissionFormFields } from '@/components/gamification/mission-form-fields';

export const metadata = { title: 'Nova missão' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CADASTRO DEDICADO DE MISSÃO (FASE 97 · ADR-409)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Isola o formulário de 15 campos de missão em página dedicada (`/missoes/nova`),
 *  transformando `/administracao/missoes` em um cockpit limpo e carregando cartas
 *  de recompensa e eventos em UMA única transação (`withTenant`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function NovaMissaoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TASK_MANAGE,
  });

  const { cards, events } = await withTenant(tenantId, async (tx) => {
    const loadedCards = await listCardTemplates(tenantId, 'ATIVOS', tx);
    const loadedEvents = await listAdminEvents(tenantId, tx);
    return { cards: loadedCards, events: loadedEvents };
  });

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
    <main className="max-w-4xl space-y-6" data-testid="new-mission-page">
      <PageHeader
        title="Nova missão"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<ListChecks className="size-6 text-primary" aria-hidden />}
        description="Configure o gatilho, a meta de progresso e a recompensa em XP ou carta colecionável."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Missões', href: missionsUrl },
          { label: 'Nova missão' },
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
        data-testid="create-mission-section"
      >
        <div className="border-b border-border pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Definição da missão
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            As origens{' '}
            <strong>
              {RETIRED_XP_SOURCE_KINDS.map((kind) => XP_SOURCE_LABELS[kind]).join(' e ')}
            </strong>{' '}
            saíram da lista: nenhum caminho do sistema as emite hoje, então uma missão com
            elas nunca avançaria.
          </p>
        </div>

        <AdminForm
          action={saveMissionAction}
          submitLabel="Criar missão"
          testId="create-mission"
          backHref={missionsUrl}
          backLabel="Ver missões"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <MissionFormFields eventOptions={eventOptions} cardOptions={cardOptions} />
        </AdminForm>
      </section>
    </main>
  );
}


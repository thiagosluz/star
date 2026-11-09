import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Layers } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { getCardTemplateForEdit } from '@/lib/admin/gamification-admin-service';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm } from '@/components/admin/admin-form';
import { saveCardTemplateAction } from '@/app/actions/admin-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { CardFormFields, TRIGGER_OPTIONS } from '@/components/gamification/card-form-fields';

export const metadata = { title: 'Editar carta colecionável' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EDIÇÃO DEDICADA DE CARTA COLECIONÁVEL (FASE 96 · ADR-404)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Retira os N formulários de 26 campos e as N cópias do seletor de eventos de
 *  dentro de `<details>` na listagem `/administracao/cartas`, reduzindo o payload
 *  RSC e o HTML do catálogo de O(cartas × eventos) para O(cartas).
 *
 *  Carrega a carta e a lista de eventos em UMA única transação (`withTenant`) e
 *  responde 404 uniforme quando a carta não pertence à instituição ou está arquivada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EditarCartaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; cardId: string }>;
}) {
  const resolvedParams = await params;
  const cardId = requireUuidParam(resolvedParams, 'cardId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CARD_TEMPLATE_MANAGE,
  });

  const data = await withTenant(tenantId, async (tx) => {
    const card = await getCardTemplateForEdit(tenantId, cardId, tx);
    if (!card) return null;

    const events = await listAdminEvents(tenantId, tx);
    return { card, events };
  });

  if (!data) notFound();

  const { card, events } = data;

  const eventOptions = [
    { value: '', label: 'Carta da instituição (qualquer evento)' },
    ...events.map((event) => ({ value: event.id, label: event.title })),
  ];

  return (
    <main className="max-w-4xl space-y-6">
      <PageHeader
        title={`Editar carta: ${card.name}`}
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Layers className="size-6 text-tier-epic" aria-hidden />}
        description={
          <>
            Atualize as regras de conquista, paleta de cores, arte personalizada e efeitos
            holográficos 3D da carta <span className="code-data">{card.slug}</span>.
          </>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Cartas colecionáveis', href: tenantPath(tenantSlug, '/administracao/cartas') },
          { label: card.name },
        ]}
      />

      <div>
        <Link
          href={tenantPath(tenantSlug, '/administracao/cartas')}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          data-testid="link-voltar-cartas"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para o catálogo de cartas
        </Link>
      </div>

      <section
        className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="edit-card-section"
      >
        <div className="border-b border-border pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Definição da carta
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cores fora do formato (hexadecimal ou <span className="code-data">oklch()</span>) e URLs
            inválidas são descartadas automaticamente na validação.
          </p>
        </div>

        <AdminForm
          action={saveCardTemplateAction}
          submitLabel="Salvar carta"
          testId={`card-form-${card.id}`}
          backHref={tenantPath(tenantSlug, '/administracao/cartas')}
          backLabel="Voltar para Cartas"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="cardTemplateId" value={card.id} />
          <CardFormFields
            triggerOptions={TRIGGER_OPTIONS}
            eventOptions={eventOptions}
            card={card}
            structured
          />
        </AdminForm>
      </section>
    </main>
  );
}


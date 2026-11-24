import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Tags } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { getSponsorTierForEdit } from '@/lib/admin/sponsor-service';
import {
  SPONSOR_TIER_KEYS,
  SPONSOR_TIER_LABELS,
  buildEventSponsorsHref,
} from '@/domain/events/sponsor-rules';
import { AdminForm, Field, SelectField } from '@/components/admin/admin-form';
import { SponsorTierStyleFields } from '@/components/admin/sponsor-tier-style';
import { saveTierAction } from '@/app/actions/sponsor-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Editar cota de patrocínio' };
export const dynamic = 'force-dynamic';

const TIER_OPTIONS = SPONSOR_TIER_KEYS.map((key) => ({
  value: key,
  label: SPONSOR_TIER_LABELS[key],
}));

/**
 * Rota dedicada para edição de cota de patrocínio (FASE 125).
 */
export default async function EditSponsorTierPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string; tierId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const tierId = requireUuidParam(resolvedParams, 'tierId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
  });

  const [event, tier] = await Promise.all([
    getAdminEvent(tenantId, eventId),
    getSponsorTierForEdit(tenantId, eventId, tierId),
  ]);

  if (!event || !tier) notFound();

  const sponsorsBaseUrl = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/patrocinadores`);
  const cotasUrl = buildEventSponsorsHref(sponsorsBaseUrl, { aba: 'cotas' });

  return (
    <main className="max-w-4xl space-y-8" data-testid="edit-sponsor-tier-page">
      <PageHeader
        title={`Editar cota: ${tier.name}`}
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description={`${tier.sponsorCount} patrocinador(es) vinculado(s) · ${tier.maxSponsors === 0 ? 'vagas ilimitadas' : `limite ${tier.maxSponsors}`}`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Patrocinadores', href: cotasUrl },
          { label: tier.name },
        ]}
      />

      <p className="text-xs">
        <Link href={cotasUrl} className="underline underline-offset-4">
          ← Voltar para Cotas e vitrine
        </Link>
      </p>

      <section
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="edit-tier-section"
      >
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Tags className="size-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-base font-semibold">Dados e estilo da cota</h2>
            <p className="text-xs text-muted-foreground">
              Reduzir o limite abaixo dos patrocinadores já vinculados é recusado para preservar a coerência da vitrine.
            </p>
          </div>
        </div>

        <AdminForm
          action={saveTierAction}
          submitLabel="Salvar cota"
          testId={`tier-form-${tier.id}`}
          backHref={cotasUrl}
          backLabel="Ver cotas"
          compact
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="tierId" value={tier.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome da cota" name="name" required defaultValue={tier.name} />
            <SelectField label="Categoria" name="key" options={TIER_OPTIONS} defaultValue={tier.key} />
            <Field label="Ordem de exibição" name="rank" type="number" min={0} defaultValue={tier.rank} />
            <Field
              label="Limite de patrocinadores"
              name="maxSponsors"
              type="number"
              min={0}
              defaultValue={tier.maxSponsors}
              hint="0 = ilimitado"
            />
            <Field
              label="Valor comercial (R$)"
              name="priceReais"
              defaultValue={(tier.priceCents / 100).toFixed(2).replace('.', ',')}
            />
            <Field label="Moeda" name="currency" defaultValue={tier.currency} />
            <Field label="Descrição" name="description" defaultValue={tier.description} />
          </div>

          <SponsorTierStyleFields
            color={tier.color}
            logoScale={tier.logoScale}
            testPrefix={`tier-style-${tier.id}`}
          />

          <Field
            label="Benefícios (um por linha)"
            name="benefits"
            defaultValue={tier.benefits.join('\n')}
            hint="Logo no site, estande, palestra de 10 minutos…"
          />
        </AdminForm>
      </section>
    </main>
  );
}

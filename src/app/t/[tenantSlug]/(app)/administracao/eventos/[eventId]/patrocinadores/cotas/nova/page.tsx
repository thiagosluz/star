import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Tags } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import {
  DEFAULT_SPONSOR_LOGO_SCALE,
  SPONSOR_TIER_KEYS,
  SPONSOR_TIER_LABELS,
  buildEventSponsorsHref,
} from '@/domain/events/sponsor-rules';
import { AdminForm, Field, SelectField } from '@/components/admin/admin-form';
import { SponsorTierStyleFields } from '@/components/admin/sponsor-tier-style';
import { saveTierAction } from '@/app/actions/sponsor-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Nova cota de patrocínio' };
export const dynamic = 'force-dynamic';

const TIER_OPTIONS = SPONSOR_TIER_KEYS.map((key) => ({
  value: key,
  label: SPONSOR_TIER_LABELS[key],
}));

/**
 * Rota dedicada para criação de cota de patrocínio (FASE 125).
 *
 * Isola o formulário visual (9 campos + amostras + prévia de cartão) fora do
 * cockpit principal de `/patrocinadores`.
 */
export default async function NewSponsorTierPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const sponsorsBaseUrl = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/patrocinadores`);
  const cotasUrl = buildEventSponsorsHref(sponsorsBaseUrl, { aba: 'cotas' });

  return (
    <main className="max-w-4xl space-y-8" data-testid="new-sponsor-tier-page">
      <PageHeader
        title="Nova cota de patrocínio"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description="Defina hierarquia na vitrine, limite de vagas, valor comercial, cor de destaque e tamanho da logo."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Patrocinadores', href: cotasUrl },
          { label: 'Nova cota' },
        ]}
      />

      <p className="text-xs">
        <Link href={cotasUrl} className="underline underline-offset-4">
          ← Voltar para Cotas e vitrine
        </Link>
      </p>

      <section
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="create-tier-section"
      >
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Tags className="size-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-base font-semibold">Configuração da cota</h2>
            <p className="text-xs text-muted-foreground">
              Menores valores em &ldquo;Ordem de exibição&rdquo; aparecem primeiro na página pública do evento.
            </p>
          </div>
        </div>

        <AdminForm
          action={saveTierAction}
          submitLabel="Criar cota"
          testId="create-tier"
          backHref={cotasUrl}
          backLabel="Ver cotas"
          compact
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome da cota" name="name" required placeholder="Diamante" />
            <SelectField label="Categoria" name="key" options={TIER_OPTIONS} defaultValue="CUSTOM" />
            <Field
              label="Ordem de exibição"
              name="rank"
              type="number"
              min={0}
              defaultValue={0}
              hint="Menor aparece primeiro"
            />
            <Field
              label="Limite de patrocinadores"
              name="maxSponsors"
              type="number"
              min={0}
              defaultValue={0}
              hint="0 = ilimitado"
            />
            <Field label="Valor comercial (R$)" name="priceReais" placeholder="15000,00" />
            <Field label="Moeda" name="currency" defaultValue="BRL" />
          </div>

          <Field
            label="Descrição"
            name="description"
            placeholder="Cota principal com destaque na abertura e no site"
          />

          <SponsorTierStyleFields
            color={null}
            logoScale={DEFAULT_SPONSOR_LOGO_SCALE}
            testPrefix="tier-style-new"
          />

          <Field
            label="Benefícios (um por linha)"
            name="benefits"
            placeholder={'Logo no site\nEstande de 9 m²'}
          />
        </AdminForm>
      </section>
    </main>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Handshake, ImageIcon } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getSponsorForEdit } from '@/lib/admin/sponsor-service';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { AssetUploader } from '@/components/admin/asset-uploader';
import {
  confirmAssetUploadAction,
  requestAssetUploadAction,
} from '@/app/actions/landing-actions';
import { saveSponsorAction } from '@/app/actions/sponsor-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Editar patrocinador' };
export const dynamic = 'force-dynamic';

function toDateInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * Rota dedicada para edição contratual, cadastral e de logotipo de um
 * patrocinador (FASE 125).
 */
export default async function EditSponsorPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string; sponsorId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const sponsorId = requireUuidParam(resolvedParams, 'sponsorId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
  });

  const data = await getSponsorForEdit(tenantId, eventId, sponsorId);
  if (!data) notFound();

  const { sponsor, tiers, eventTitle } = data;
  const sponsorsUrl = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/patrocinadores`);

  const tierChoices = [
    { value: '', label: 'Sem cota (aparece em "Patrocinadores")' },
    ...tiers.map((tier) => ({
      value: tier.id,
      label: `${tier.name}${tier.remaining === null ? '' : ` — ${tier.remaining} vaga(s)`}`,
    })),
  ];

  return (
    <main className="max-w-4xl space-y-8" data-testid="edit-sponsor-page">
      <PageHeader
        title={`Editar patrocinador: ${sponsor.name}`}
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description={`${sponsor.tierName ?? 'Sem cota'} · ${sponsor.contractStateLabel}`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: eventTitle, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Patrocinadores', href: sponsorsUrl },
          { label: sponsor.name },
        ]}
      />

      <p className="text-xs">
        <Link href={sponsorsUrl} className="underline underline-offset-4">
          ← Voltar para Patrocinadores
        </Link>
      </p>

      {/* Logotipo */}
      <section
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="edit-sponsor-logo-section"
      >
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <ImageIcon className="size-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-base font-semibold">Logotipo na vitrine</h2>
            <p className="text-xs text-muted-foreground">
              A imagem é convertida para WebP sem perda no servidor para manter bordas de marca nítidas.
            </p>
          </div>
        </div>

        <AssetUploader
          tenantSlug={tenantSlug}
          eventId={eventId}
          target="SPONSOR_LOGO"
          sponsorId={sponsor.id}
          currentUrl={sponsor.logoUrl}
          requestUploadAction={requestAssetUploadAction}
          confirmUploadAction={confirmAssetUploadAction}
        />
      </section>

      {/* Dados cadastrais e contrato */}
      <section
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="edit-sponsor-section"
      >
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Handshake className="size-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-base font-semibold">Dados institucionais e contrato</h2>
            <p className="text-xs text-muted-foreground">
              Atualize cota, vigência, valor contratado, contato comercial e visibilidade pública.
            </p>
          </div>
        </div>

        <AdminForm
          action={saveSponsorAction}
          submitLabel="Salvar patrocinador"
          testId={`sponsor-form-${sponsor.id}`}
          backHref={sponsorsUrl}
          backLabel="Ver patrocinadores"
          compact
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="sponsorId" value={sponsor.id} />
          <input type="hidden" name="logoUrl" value={sponsor.logoUrl ?? ''} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" name="name" required defaultValue={sponsor.name} />
            <SelectField
              label="Cota"
              name="tierId"
              options={tierChoices}
              defaultValue={sponsor.tierId ?? ''}
            />
            <Field
              label="Site"
              name="websiteUrl"
              defaultValue={sponsor.websiteUrl}
              placeholder="https://empresa.com.br"
            />
            <Field
              label="Ordem na página"
              name="displayOrder"
              type="number"
              min={0}
              defaultValue={sponsor.displayOrder}
            />
            <Field label="Contato" name="contactName" defaultValue={sponsor.contactName} />
            <Field label="E-mail do contato" name="contactEmail" type="email" defaultValue={sponsor.contactEmail} />
            <Field label="Telefone" name="contactPhone" defaultValue={sponsor.contactPhone} />
            <Field
              label="CNPJ/CPF"
              name="taxId"
              defaultValue={sponsor.taxIdMasked ? '' : undefined}
              placeholder={sponsor.taxIdMasked ?? 'Somente números'}
              hint="Gravado e exibido apenas mascarado. Em branco não substitui o valor atual."
            />
            <Field
              label="Valor do contrato (R$)"
              name="contractValueReais"
              defaultValue={
                sponsor.contractValueCents
                  ? (sponsor.contractValueCents / 100).toFixed(2).replace('.', ',')
                  : undefined
              }
            />
            <Field
              label="Início do contrato"
              name="contractStart"
              type="date"
              defaultValue={toDateInput(sponsor.contractStart)}
            />
            <Field
              label="Fim do contrato"
              name="contractEnd"
              type="date"
              defaultValue={toDateInput(sponsor.contractEnd)}
            />
          </div>

          <Field label="Descrição" name="description" defaultValue={sponsor.description} />

          <CheckboxField
            label="Visível na página pública"
            name="isActive"
            defaultChecked={sponsor.isActive}
          />
        </AdminForm>
      </section>
    </main>
  );
}

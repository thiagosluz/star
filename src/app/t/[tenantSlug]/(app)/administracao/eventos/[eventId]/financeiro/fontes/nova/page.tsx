import { notFound } from 'next/navigation';
import { Landmark } from 'lucide-react';

import { FundingSourceForm } from '@/components/finance/funding-source-form';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { PageHeader } from '@/components/ui';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';

export const metadata = { title: 'Nova fonte de financiamento' };
export const dynamic = 'force-dynamic';

export default async function NewFundingSourcePage({
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
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const financePath = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);
  const sourcesHref = `${financePath}?aba=fontes`;

  return (
    <main className="max-w-4xl space-y-6">
      <PageHeader
        title="Nova fonte de financiamento ou edital"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Landmark className="size-5" aria-hidden />}
        description={`${event.title} · cadastre editais (FAPEG, CNPq, CAPES), convênios FUNAPE/UF/IF ou recursos próprios.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          {
            label: event.title,
            href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`),
          },
          { label: 'Finanças e fomento', href: sourcesHref },
          { label: 'Nova fonte' },
        ]}
      />

      <FundingSourceForm
        mode="create"
        tenantSlug={tenantSlug}
        eventId={eventId}
        backHref={sourcesHref}
      />
    </main>
  );
}

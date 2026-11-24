import { notFound } from 'next/navigation';
import { Landmark } from 'lucide-react';

import { FundingSourceForm } from '@/components/finance/funding-source-form';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { PageHeader } from '@/components/ui';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { requirePagePermission } from '@/lib/auth/guard-page';
import { getFundingSourceForEdit } from '@/lib/finance/event-finance-service';
import { requireUuidParam } from '@/lib/validation/id';

export const metadata = { title: 'Editar fonte de financiamento' };
export const dynamic = 'force-dynamic';

export default async function EditFundingSourcePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string; sourceId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const sourceId = requireUuidParam(resolvedParams, 'sourceId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const loaded = await getFundingSourceForEdit({ tenantId, eventId, sourceId });
  if (!loaded.ok) notFound();

  const financePath = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);
  const sourcesHref = `${financePath}?aba=fontes`;

  return (
    <main className="max-w-4xl space-y-6">
      <PageHeader
        title="Editar fonte de financiamento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Landmark className="size-5" aria-hidden />}
        description={`${loaded.event.title} · atualize teto aprovado (aditivos), nº de processo ou rubricas permitidas.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          {
            label: loaded.event.title,
            href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`),
          },
          { label: 'Finanças e fomento', href: sourcesHref },
          { label: 'Editar fonte' },
        ]}
      />

      <FundingSourceForm
        mode="edit"
        tenantSlug={tenantSlug}
        eventId={eventId}
        initialSource={loaded.source}
        backHref={sourcesHref}
      />
    </main>
  );
}

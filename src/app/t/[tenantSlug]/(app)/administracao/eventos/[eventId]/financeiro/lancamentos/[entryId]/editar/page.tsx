import { notFound } from 'next/navigation';
import { ReceiptText } from 'lucide-react';

import { FinancialEntryCreateForm } from '@/components/finance/financial-entry-create-form';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { PageHeader } from '@/components/ui';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { requirePagePermission } from '@/lib/auth/guard-page';
import { getFinancialEntryForEdit } from '@/lib/finance/event-finance-service';
import { requireUuidParam } from '@/lib/validation/id';

export const metadata = { title: 'Editar lançamento financeiro' };
export const dynamic = 'force-dynamic';

export default async function EditFinancialEntryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string; entryId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const entryId = requireUuidParam(resolvedParams, 'entryId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const loaded = await getFinancialEntryForEdit({ tenantId, eventId, entryId });
  if (!loaded.ok) notFound();

  const financePath = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);
  const ledgerHref = `${financePath}?aba=lancamentos`;
  const defaultDate = new Date().toISOString().slice(0, 10);

  return (
    <main className="max-w-4xl space-y-6">
      <PageHeader
        title="Editar lançamento financeiro"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<ReceiptText className="size-5" aria-hidden />}
        description={`${loaded.event.title} · reatribua fonte pagadora, corrija rubrica ou anexe comprovante fiscal.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          {
            label: loaded.event.title,
            href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`),
          },
          { label: 'Finanças e fomento', href: ledgerHref },
          { label: 'Editar lançamento' },
        ]}
      />

      <FinancialEntryCreateForm
        mode="edit"
        tenantSlug={tenantSlug}
        eventId={eventId}
        sources={loaded.sources}
        sourceViews={loaded.summary.bySource}
        defaultDate={defaultDate}
        initialEntry={loaded.entry}
        backHref={ledgerHref}
      />
    </main>
  );
}

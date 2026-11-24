import { notFound } from 'next/navigation';
import { ReceiptText } from 'lucide-react';

import { FinancialEntryCreateForm } from '@/components/finance/financial-entry-create-form';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { PageHeader } from '@/components/ui';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { requirePagePermission } from '@/lib/auth/guard-page';
import { loadEventFinanceDashboard } from '@/lib/finance/event-finance-service';
import { requireUuidParam } from '@/lib/validation/id';

export const metadata = { title: 'Novo lançamento financeiro' };
export const dynamic = 'force-dynamic';

export default async function NewFinancialEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{ fonte?: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;
  const { fonte } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  const loaded = await loadEventFinanceDashboard({ tenantId, eventId });
  if (!loaded.ok) notFound();

  const financePath = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);
  const ledgerHref = `${financePath}?aba=lancamentos`;
  const defaultDate = new Date().toISOString().slice(0, 10);

  return (
    <main className="max-w-4xl space-y-6">
      <PageHeader
        title="Novo lançamento financeiro"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<ReceiptText className="size-5" aria-hidden />}
        description={`${loaded.dashboard.event.title} · registre entrada ou saída vinculada à fonte pagadora e rubrica.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          {
            label: loaded.dashboard.event.title,
            href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`),
          },
          { label: 'Finanças e fomento', href: ledgerHref },
          { label: 'Novo lançamento' },
        ]}
      />

      <FinancialEntryCreateForm
        mode="create"
        tenantSlug={tenantSlug}
        eventId={eventId}
        sources={loaded.dashboard.sources}
        sourceViews={loaded.dashboard.summary.bySource}
        defaultDate={defaultDate}
        initialSourceId={fonte}
        backHref={ledgerHref}
      />
    </main>
  );
}

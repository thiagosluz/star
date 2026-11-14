import { notFound } from 'next/navigation';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { requireUuidParam } from '@/lib/validation/id';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminProceedingsOverview } from '@/lib/proceedings/proceedings-service';
import {
  importAcceptedToProceedingsAction,
  publishProceedingsAction,
  saveProceedingsVolumeAction,
  unpublishProceedingsAction,
  updateProceedingsEntryAction,
} from '@/app/actions/proceedings-actions';
import { ProceedingsAdminPanel } from '@/components/proceedings/proceedings-admin-panel';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const dynamic = 'force-dynamic';

export default async function EventProceedingsAdminPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolved = await params;
  const tenantSlug = resolved.tenantSlug;
  const eventId = requireUuidParam(resolved, 'eventId');

  const { context } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  const tenantId = context.activeTenant!.tenantId;
  const overview = await getAdminProceedingsOverview(tenantId, eventId);

  if (!overview) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <PageHeader
        title={`Anais — ${overview.event.title}`}
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description="Monte a ficha do volume, organize os trabalhos aceitos e publique os anais com citações automáticas e indexação acadêmica gratuita."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: overview.event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Anais' },
        ]}
      />

      <ProceedingsAdminPanel
        tenantSlug={tenantSlug}
        overview={overview}
        saveVolumeAction={saveProceedingsVolumeAction}
        importAcceptedAction={importAcceptedToProceedingsAction}
        updateEntryAction={updateProceedingsEntryAction}
        publishAction={publishProceedingsAction}
        unpublishAction={unpublishProceedingsAction}
      />
    </main>
  );
}

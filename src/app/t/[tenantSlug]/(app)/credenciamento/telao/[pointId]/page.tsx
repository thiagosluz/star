import { notFound } from 'next/navigation';
import { MonitorPlay } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getSelfCheckinPointPresentation } from '@/lib/events/self-checkin-service';
import { selfCheckinQrDataUrl, selfCheckinUrl } from '@/lib/events/self-checkin-poster';
import { SelfCheckinTelaoView } from '@/components/credentials/self-checkin-telao-view';
import { Alert, PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Modo telão — Autocredenciamento' };
export const dynamic = 'force-dynamic';

export default async function SelfCheckinTelaoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; pointId: string }>;
}) {
  const resolvedParams = await params;
  const pointId = requireUuidParam(resolvedParams, 'pointId');
  const { tenantSlug } = resolvedParams;

  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
    allowedScopes: ['TENANT', 'EVENT'],
    fallbackPath: '/credenciamento',
  });

  const presentation = await getSelfCheckinPointPresentation({ tenantId, pointId });
  if (!presentation) notFound();

  const allowed =
    can(principal, PERMISSIONS.REGISTRATION_CHECKIN, { scope: 'TENANT' }) ||
    can(principal, PERMISSIONS.REGISTRATION_CHECKIN, {
      scope: 'EVENT',
      eventId: presentation.eventId,
    });

  if (!allowed) notFound();

  const url = selfCheckinUrl(tenantSlug, presentation.token);
  const qrDataUrl = await selfCheckinQrDataUrl(url, 360);

  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={presentation.activityTitle ?? `Portaria · ${presentation.eventTitle}`}
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<MonitorPlay className="size-6 text-primary" aria-hidden />}
        description={
          presentation.activityTitle
            ? `Autocheck-in em sala · ${presentation.eventTitle}${
                presentation.roomName ? ` · ${presentation.roomName}` : ''
              }`
            : `Autocredenciamento na portaria · ${presentation.eventTitle}`
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          {
            label: 'Credenciamento',
            href: tenantPath(tenantSlug, `/credenciamento?evento=${presentation.eventId}`),
          },
          { label: 'Modo telão' },
        ]}
      />

      {presentation.revokedAt ? (
        <Alert tone="danger">
          Este QR Code foi revogado e não aceita mais leituras. Volte para o credenciamento para
          abrir o novo ponto.
        </Alert>
      ) : null}

      <SelfCheckinTelaoView
        tenantSlug={tenantSlug}
        pointId={presentation.pointId}
        qrDataUrl={qrDataUrl}
        publicUrl={url}
        initialToken={presentation.token}
        initialIsActive={presentation.isActive}
        initialPinRequired={presentation.pinRequired}
        initialPinCode={presentation.pinCode}
        initialTotpEnabled={presentation.totpEnabled}
        initialTotpWindow={presentation.totpWindow}
        requireGeo={presentation.policy.requireGeo}
        geoRadiusMeters={presentation.policy.geoRadiusMeters}
      />
    </main>
  );
}

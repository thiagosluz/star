import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin, QrCode, ShieldCheck } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { getTenantContext } from '@/lib/events/event-repository';
import { tenantPath } from '@/domain/tenancy/resolution';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { getPublicSelfCheckinPoint } from '@/lib/events/self-checkin-service';
import { submitSelfCheckinAction } from '@/app/actions/self-checkin-actions';
import { SelfCheckinForm } from '@/components/credentials/self-checkin-form';
import { Alert, PageHeader } from '@/components/ui';

export const metadata = { title: 'Autocredenciamento por QR Code' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PÁGINA DE AUTOCREDENCIAMENTO / AUTOCHECK-IN DO PARTICIPANTE (FASE 113)
 *  `/t/<tenantSlug>/presenca/<token>`
 *
 *  Aberta pela câmera do celular ao ler o cartaz impresso ou projetado no telão.
 *  Se o usuário ainda não estiver autenticado na instituição, oferece retorno
 *  direto após o login (`?redirectTo=...`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PublicSelfCheckinPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; token: string }>;
}) {
  const { tenantSlug, token } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const context = await getRequestContext();
  const loggedUser =
    context && context.activeTenant?.tenantId === tenant.tenantId ? context.user : null;

  const point = await getPublicSelfCheckinPoint({
    tenantId: tenant.tenantId,
    token,
    userId: loggedUser?.id ?? null,
  });

  if (!point) notFound();

  const isActivity = point.activityId !== null;
  const pageTitle = isActivity
    ? (point.activityTitle ?? 'Autocheck-in de atividade')
    : 'Autocredenciamento no evento';
  const scheduleLabel = formatZonedDateTime(point.startsAt, point.timezone);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <PageHeader
        title={pageTitle}
        icon={<QrCode className="size-6 text-primary" aria-hidden />}
        description={
          <>
            {point.eventTitle} · {isActivity ? 'Frequência na atividade' : 'Portaria do evento'} ·{' '}
            {scheduleLabel}
            {point.roomName ?? point.venueName ? ` · ${point.roomName ?? point.venueName}` : ''}
          </>
        }
      />

      <section
        className="space-y-4 rounded-xl border border-border bg-card p-5"
        data-testid="self-checkin-card"
      >
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="code-data rounded border border-border bg-surface-low px-2 py-0.5 text-foreground">
            Ponto {point.token}
          </span>
          {point.policy.requireGeo ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5 text-primary" aria-hidden />
              Localização exigida ({point.policy.geoRadiusMeters} m)
            </span>
          ) : null}
          {point.pinRequired || point.totpEnabled ? (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden />
              {point.totpEnabled ? 'Código rotativo de sala ativo' : 'PIN de sala ativo'}
            </span>
          ) : null}
        </div>

        {point.revokedAt ? (
          <Alert tone="danger" data-testid="self-checkin-revoked-alert">
            Este QR Code foi revogado pela organização. Procure o novo cartaz na entrada ou fale
            com a equipe no balcão.
          </Alert>
        ) : !loggedUser ? (
          <div className="space-y-3" data-testid="self-checkin-login">
            <p className="text-sm text-foreground">
              Entre com sua conta para confirmar sua presença neste ponto.
            </p>
            <Link
              href={`/login?redirectTo=${encodeURIComponent(
                tenantPath(tenantSlug, `/presenca/${point.token}`),
              )}`}
              data-testid="self-checkin-login-link"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Entrar e registrar presença
            </Link>
          </div>
        ) : (
          <SelfCheckinForm
            tenantSlug={tenantSlug}
            token={point.token}
            requireGeo={point.policy.requireGeo}
            geoRadiusMeters={point.policy.geoRadiusMeters}
            pinRequired={point.pinRequired}
            totpEnabled={point.totpEnabled}
            hasOpenSession={Boolean(point.participantStatus?.openSession)}
            openSessionCheckedInIso={
              point.participantStatus?.openSession?.checkedInAt.toISOString() ?? null
            }
            closedMinutes={point.participantStatus?.closedMinutes ?? 0}
            concurrentOpenActivityTitle={
              point.participantStatus?.concurrentOpenActivityTitle ?? null
            }
            registered={point.participantStatus?.registered ?? false}
            allowUnregistered={point.policy.allowUnregistered}
            hasArrivedAtEvent={point.participantStatus?.hasArrivedAtEvent ?? false}
            requireEventArrivalBeforeActivity={point.policy.requireEventArrivalBeforeActivity}
            isActivity={isActivity}
            windowOk={point.windowStatus.ok}
            windowReason={point.windowStatus.reason}
            action={submitSelfCheckinAction}
          />
        )}
      </section>
    </main>
  );
}

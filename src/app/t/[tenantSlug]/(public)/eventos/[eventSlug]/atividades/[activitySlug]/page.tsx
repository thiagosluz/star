import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { ActivityDetailSections } from '@/components/events/activity-detail-sections';
import { ActivityRegistrationSidebar } from '@/components/events/activity-registration-sidebar';
import { Section, ThemeScope } from '@/components/events/theme-scope';
import { evaluateRegistrationWindow } from '@/domain/events/event-rules';
import { seesActivityOnlineRoom } from '@/domain/events/online-room-rules';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { getPublicActivity, getTenantContext } from '@/lib/events/event-repository';
import { resolveOnlineRoomViewer } from '@/lib/events/online-room-service';
import { findMyRegistrationFor } from '@/lib/events/registration-read-service';
import { listActivityMaterials, resolveActivityViewer } from '@/lib/speakers/material-service';
import { loadActivityNotes } from '@/lib/speakers/speaker-service';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; activitySlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug, activitySlug } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Atividade não encontrada' };

  const result = await getPublicActivity(tenant.tenantId, eventSlug, activitySlug);
  if (!result) return { title: 'Atividade não encontrada' };

  return {
    title: `${result.activity.title} · ${result.event.title}`,
    description: result.activity.description?.slice(0, 200) ?? undefined,
  };
}

/**
 * Página pública da atividade: resolve contexto do visitante/RBAC/sala online
 * e compõe ficha (`ActivityDetailSections`) + painel lateral (`ActivityRegistrationSidebar`).
 */
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; activitySlug: string }>;
}) {
  const { tenantSlug, eventSlug, activitySlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const result = await getPublicActivity(tenant.tenantId, eventSlug, activitySlug);
  if (!result) notFound();

  const { event, activity } = result;

  const window = evaluateRegistrationWindow({
    now: new Date(),
    eventStartsAt: event.startsAt,
    eventEndsAt: event.endsAt,
    eventStatus: event.status,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    activity: {
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      status: activity.status,
    },
  });

  const user = await getAuthenticatedUser();

  let membershipStatus: string | null = null;
  let alreadyRegistered: 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | null = null;
  let myRegistrationId: string | null = null;
  let canRegister = false;
  let isOrganizer = false;

  if (user) {
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId: tenant.tenantId, userId: user.id },
      select: { status: true, deletedAt: true },
    });
    membershipStatus = membership?.deletedAt ? 'REMOVED' : (membership?.status ?? null);

    if (membershipStatus === 'ACTIVE') {
      const principal = await loadPrincipal(user.id, tenant.tenantId, 'ACTIVE');
      canRegister = can(principal, PERMISSIONS.REGISTRATION_CREATE, { scope: 'TENANT' });
      isOrganizer = can(principal, PERMISSIONS.SPEAKER_MANAGE, { scope: 'TENANT' });
    } else {
      canRegister = membershipStatus !== 'SUSPENDED' && membershipStatus !== 'REMOVED';
    }

    if (membershipStatus === 'ACTIVE') {
      const mine = await findMyRegistrationFor(tenant.tenantId, user.id, activity.id);
      myRegistrationId = mine?.id ?? null;

      if (
        mine &&
        (mine.status === 'PENDING' || mine.status === 'CONFIRMED' || mine.status === 'WAITLISTED')
      ) {
        alreadyRegistered = mine.status;
      }
    }
  }

  const isFull = activity.remainingSeats === 0;
  const roomLimits =
    activity.roomCapacity !== null &&
    (activity.capacity === null || activity.capacity > activity.roomCapacity);
  const activityClosed =
    activity.status === 'CANCELED' || activity.status === 'COMPLETED' || activity.status === 'IN_PROGRESS';

  const [materialList, notes] = await Promise.all([
    listActivityMaterials({
      tenantId: tenant.tenantId,
      activityId: activity.id,
      viewer: await resolveActivityViewer({
        tenantId: tenant.tenantId,
        activityId: activity.id,
        userId: user?.id ?? null,
        isOrganizer,
      }),
    }),
    loadActivityNotes(tenant.tenantId, activity.id),
  ]);

  const { materials, lockedCount } = materialList;

  const onlineRoomViewer = await resolveOnlineRoomViewer({
    tenantId: tenant.tenantId,
    eventId: event.id,
    userId: user?.id ?? null,
  });

  const onlineUrl = seesActivityOnlineRoom(onlineRoomViewer, {
    id: activity.id,
    requiresRegistration: activity.requiresRegistration,
  })
    ? activity.onlineUrl
    : null;

  const loginHref = `/login?redirectTo=${encodeURIComponent(
    tenantPath(tenantSlug, `/eventos/${eventSlug}/atividades/${activitySlug}`),
  )}`;

  return (
    <ThemeScope theme={event.theme}>
      <main>
        <Section>
          <nav className="mb-6">
            <Link
              href={tenantPath(tenantSlug, `/eventos/${eventSlug}`)}
              className="ef-muted text-xs underline underline-offset-4"
            >
              ← {event.title}
            </Link>
          </nav>

          <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
            <ActivityDetailSections
              tenantSlug={tenantSlug}
              eventSlug={eventSlug}
              timeZone={event.timezone}
              activity={activity}
              isFull={isFull}
              roomLimits={roomLimits}
              onlineUrl={onlineUrl}
              windowOpen={window.open}
              alreadyRegistered={alreadyRegistered}
              membershipStatus={membershipStatus}
              canRegister={canRegister}
              isAuthenticated={Boolean(user)}
              notes={notes}
              materials={materials}
              lockedCount={lockedCount}
            />

            <ActivityRegistrationSidebar
              tenantSlug={tenantSlug}
              tenantName={tenant.name}
              eventSlug={eventSlug}
              activitySlug={activitySlug}
              requiresRegistration={activity.requiresRegistration}
              remainingSeats={activity.remainingSeats}
              waitlistEnabled={activity.waitlistEnabled}
              activityStatus={activity.status}
              activityClosed={activityClosed}
              windowOpen={window.open}
              windowMessage={window.open ? null : window.message}
              isFull={isFull}
              isAuthenticated={Boolean(user)}
              membershipStatus={membershipStatus}
              requiresMembership={event.registrationRequiresMembership}
              canRegister={canRegister}
              alreadyRegistered={alreadyRegistered}
              myRegistrationId={myRegistrationId}
              loginHref={loginHref}
            />
          </div>
        </Section>
      </main>
    </ThemeScope>
  );
}

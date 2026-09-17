/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Leitura de instituições (contexto público)
 *
 *  As páginas públicas (landing page do evento, listagem, detalhe de atividade)
 *  são acessadas por visitantes ANÔNIMOS. Ainda assim as consultas de domínio
 *  rodam sob RLS, com o tenant resolvido pelo Proxy — nada de abrir exceção.
 *
 *  A única consulta que usa a conexão admin é a resolução slug→id, porque é
 *  justamente ela que descobre em qual contexto estamos (`tenants` é global).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';
import { resolveTheme, type ResolvedEventTheme } from '@/domain/events/landing-page';
import {
  deriveEventStatus,
  type ActivityStatus,
  type EventStatus,
} from '@/domain/events/event-rules';
import { remainingSeats } from '@/domain/events/registration-rules';

export interface TenantContext {
  tenantId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  locale: string;
  timezone: string;
}

/** Resolve o contexto da instituição pelo slug. */
export async function getTenantContext(
  slug: string,
): Promise<TenantContext | null> {
  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
      locale: true,
      timezone: true,
      status: true,
    },
  });

  if (!tenant || tenant.status !== 'ACTIVE') return null;

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    locale: tenant.locale,
    timezone: tenant.timezone,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Eventos públicos
// ───────────────────────────────────────────────────────────────────────────────
/** Status visíveis publicamente. Rascunho e arquivado não aparecem. */
const PUBLIC_EVENT_STATUSES = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'FINISHED',
] as const;

export interface PublicEventSummary {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  status: EventStatus;
  modality: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  city: string | null;
  state: string | null;
  venueName: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  capacity: number | null;
  confirmedCount: number;
  /** Vagas restantes do evento. `null` = ilimitado. */
  remainingSeats: number | null;
  activityCount: number;
}

/** Lista os eventos publicamente visíveis da instituição. */
export async function listPublicEvents(
  tenantId: string,
): Promise<PublicEventSummary[]> {
  const events = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: {
        status: { in: [...PUBLIC_EVENT_STATUSES] },
        deletedAt: null,
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        summary: true,
        status: true,
        modality: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        city: true,
        state: true,
        venueName: true,
        coverImageUrl: true,
        primaryColor: true,
        registrationOpensAt: true,
        registrationClosesAt: true,
        capacity: true,
        confirmedCount: true,
        _count: { select: { activities: true } },
      },
    }),
  );

  return events.map((event) => ({
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    summary: event.summary,
    status: event.status as EventStatus,
    modality: event.modality,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    city: event.city,
    state: event.state,
    venueName: event.venueName,
    coverImageUrl: event.coverImageUrl,
    primaryColor: event.primaryColor,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: event.capacity,
    confirmedCount: event.confirmedCount,
    remainingSeats: remainingSeats(event.capacity, event.confirmedCount),
    activityCount: event._count.activities,
  }));
}

export interface PublicActivitySummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  type: string;
  status: ActivityStatus;
  modality: string;
  startsAt: Date;
  endsAt: Date;
  workloadMinutes: number;
  roomName: string | null;
  capacity: number | null;
  confirmedCount: number;
  waitlistEnabled: boolean;
  waitlistCount: number;
  remainingSeats: number | null;
  checkInEnabled: boolean;
  isFeatured: boolean;
  tags: string[];
  speakerNames: string[];
}

export interface PublicEventDetail extends PublicEventSummary {
  description: string | null;
  venueAddress: string | null;
  country: string | null;
  onlineUrl: string | null;
  logoUrl: string | null;
  theme: ResolvedEventTheme;
  themeIsValid: boolean;
  page: {
    id: string;
    title: string;
    metaTitle: string | null;
    metaDescription: string | null;
    blocks: {
      id: string;
      type: string;
      content: unknown;
      style: unknown;
      displayOrder: number;
      isVisible: boolean;
    }[];
  } | null;
  activities: PublicActivitySummary[];
  sponsors: {
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    tierName: string | null;
    tierKey: string | null;
    displayOrder: number;
  }[];
}

/**
 * Detalhe completo do evento para a landing page pública.
 *
 * Retorna `null` quando o evento não existe OU não é público — a UI responde
 * 404 nos dois casos, sem revelar a existência de rascunhos.
 */
export async function getPublicEvent(
  tenantId: string,
  eventSlug: string,
): Promise<PublicEventDetail | null> {
  const event = await withTenant(tenantId, (tx) =>
    tx.event.findFirst({
      where: {
        slug: eventSlug,
        status: { in: [...PUBLIC_EVENT_STATUSES] },
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        summary: true,
        description: true,
        status: true,
        modality: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        venueName: true,
        venueAddress: true,
        city: true,
        state: true,
        country: true,
        onlineUrl: true,
        coverImageUrl: true,
        logoUrl: true,
        primaryColor: true,
        registrationOpensAt: true,
        registrationClosesAt: true,
        capacity: true,
        confirmedCount: true,
        theme: true,
        activities: {
          where: { deletedAt: null, status: { not: 'DRAFT' } },
          orderBy: { startsAt: 'asc' },
          select: {
            id: true,
            slug: true,
            title: true,
            description: true,
            type: true,
            status: true,
            modality: true,
            startsAt: true,
            endsAt: true,
            workloadMinutes: true,
            capacity: true,
            confirmedCount: true,
            waitlistEnabled: true,
            waitlistCount: true,
            checkInEnabled: true,
            isFeatured: true,
            tags: true,
            room: { select: { name: true } },
            speakers: {
              orderBy: { displayOrder: 'asc' },
              select: {
                isKeynote: true,
                guestName: true,
                user: { select: { name: true } },
              },
            },
          },
        },
        pages: {
          where: { isPublished: true, deletedAt: null },
          orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
          take: 1,
          select: {
            id: true,
            title: true,
            metaTitle: true,
            metaDescription: true,
            blocks: {
              select: {
                id: true,
                type: true,
                content: true,
                style: true,
                displayOrder: true,
                isVisible: true,
              },
            },
          },
        },
        sponsors: {
          where: { isActive: true, deletedAt: null },
          orderBy: { displayOrder: 'asc' },
          select: {
            id: true,
            name: true,
            logoUrl: true,
            websiteUrl: true,
            displayOrder: true,
            tier: { select: { name: true, key: true, rank: true } },
          },
        },
      },
    }),
  );

  if (!event) return null;

  const { theme, isValid: themeIsValid } = resolveTheme(event.theme);
  const page = event.pages[0] ?? null;

  // Patrocinadores: ordenados por rank da cota (Diamante antes de Ouro).
  const sponsors = [...event.sponsors]
    .sort((a, b) => {
      const rankA = a.tier?.rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.tier?.rank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.displayOrder - b.displayOrder;
    })
    .map((sponsor) => ({
      id: sponsor.id,
      name: sponsor.name,
      logoUrl: sponsor.logoUrl,
      websiteUrl: sponsor.websiteUrl,
      tierName: sponsor.tier?.name ?? null,
      tierKey: sponsor.tier?.key ?? null,
      displayOrder: sponsor.displayOrder,
    }));

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    summary: event.summary,
    description: event.description,
    status: deriveEventStatus(event, new Date()),
    modality: event.modality,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    city: event.city,
    state: event.state,
    country: event.country,
    onlineUrl: event.onlineUrl,
    coverImageUrl: event.coverImageUrl,
    logoUrl: event.logoUrl,
    primaryColor: event.primaryColor,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: event.capacity,
    confirmedCount: event.confirmedCount,
    remainingSeats: remainingSeats(event.capacity, event.confirmedCount),
    activityCount: event.activities.length,
    theme,
    themeIsValid,
    page: page
      ? {
          id: page.id,
          title: page.title,
          metaTitle: page.metaTitle,
          metaDescription: page.metaDescription,
          blocks: page.blocks,
        }
      : null,
    activities: event.activities.map((activity) => ({
      id: activity.id,
      slug: activity.slug,
      title: activity.title,
      description: activity.description,
      type: activity.type,
      status: activity.status as ActivityStatus,
      modality: activity.modality,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      workloadMinutes: activity.workloadMinutes,
      roomName: activity.room?.name ?? null,
      capacity: activity.capacity,
      confirmedCount: activity.confirmedCount,
      waitlistEnabled: activity.waitlistEnabled,
      waitlistCount: activity.waitlistCount,
      remainingSeats: remainingSeats(activity.capacity, activity.confirmedCount),
      checkInEnabled: activity.checkInEnabled,
      isFeatured: activity.isFeatured,
      tags: activity.tags,
      speakerNames: activity.speakers.map(
        (s) => s.user?.name ?? s.guestName ?? 'Palestrante',
      ),
    })),
    sponsors,
  };
}

/**
 * Detalhe de UMA atividade, no contexto do seu evento.
 *
 * Usado pela página de inscrição. Retorna também o evento porque a página
 * precisa do contexto (título, tema, janela de inscrição).
 */
export async function getPublicActivity(
  tenantId: string,
  eventSlug: string,
  activitySlug: string,
): Promise<{
  event: Pick<
    PublicEventDetail,
    | 'id'
    | 'slug'
    | 'title'
    | 'status'
    | 'startsAt'
    | 'endsAt'
    | 'registrationOpensAt'
    | 'registrationClosesAt'
    | 'timezone'
    | 'theme'
  >;
  activity: PublicActivitySummary;
} | null> {
  const event = await getPublicEvent(tenantId, eventSlug);
  if (!event) return null;

  const activity = event.activities.find((a) => a.slug === activitySlug);
  if (!activity) return null;

  return {
    event: {
      id: event.id,
      slug: event.slug,
      title: event.title,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      timezone: event.timezone,
      theme: event.theme,
    },
    activity,
  };
}

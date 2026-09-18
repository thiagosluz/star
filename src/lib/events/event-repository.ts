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
import { readEventRegistrationPolicy } from '@/domain/events/public-registration-rules';
import {
  orderSpeakersForDisplay,
  readSocialLinks,
  type SocialLinks,
} from '@/domain/speakers/speaker-rules';

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
  /**
   * A atividade exige inscrição individual? (revisão da FASE 3)
   *
   * `false` = ABERTA: a página não oferece formulário, e a pessoa entra nela pela
   * inscrição no evento. A tela precisa do dado para não prometer uma inscrição que
   * o servidor recusa.
   */
  requiresRegistration: boolean;
  tags: string[];
  /** Nomes para exibição em texto (compatibilidade com a agenda). */
  speakerNames: string[];
  /**
   * Palestrantes com PERFIL (FASE 25) — foto, bio, papel e link para a ficha.
   *
   * Vazio em atividade sem perfil vinculado; nesse caso `speakerNames` continua
   * sendo a única fonte e a ficha mostra só os nomes, como antes.
   */
  speakers: PublicSpeakerRef[];
  /**
   * Materiais PÚBLICOS da atividade.
   *
   * Só os abertos: a lista da landing page não conhece o visitante. Materiais de
   * inscritos são resolvidos na página da atividade, que sabe QUEM está olhando
   * (`listActivityMaterials` com o `viewer` real).
   */
  materials: PublicMaterialRef[];
}

/** Palestrante como a página pública o mostra. */
export interface PublicSpeakerRef {
  id: string;
  name: string;
  roleTitle: string | null;
  avatarUrl: string | null;
  institution: string | null;
  isKeynote: boolean;
}

/** Material público de uma atividade. */
export interface PublicMaterialRef {
  id: string;
  title: string;
  kind: string;
  isFile: boolean;
  fileName: string | null;
  sizeBytes: number | null;
  externalUrl: string | null;
}

/**
 * Palestrante com perfil completo, como a vitrine e a ficha individual mostram.
 *
 * Só o que é PÚBLICO sai daqui: nome, papel, bio, foto, instituição e redes. E-mail e
 * telefone nunca entram — são dado de contato da instituição, não da página.
 */
export interface PublicSpeakerDetail extends PublicSpeakerRef {
  bio: string | null;
  company: string | null;
  socialLinks: SocialLinks;
  /** Ordem declarada pela instituição para a vitrine (menor primeiro). */
  displayOrder: number;
  /** Atividades em que ele aparece (títulos, na ordem da agenda). */
  activities: { activityId: string; activitySlug: string; title: string; roleTitle: string | null }[];
  /** Primeiro horário em que fala — usado como desempate na ordenação da vitrine. */
  firstActivityAt: Date | null;
}

export interface PublicEventDetail extends PublicEventSummary {
  description: string | null;
  venueAddress: string | null;
  country: string | null;
  onlineUrl: string | null;
  logoUrl: string | null;
  theme: ResolvedEventTheme;
  themeIsValid: boolean;
  /**
   * A instituição restringiu a inscrição à própria comunidade? (FASE 12, item I3)
   *
   * Derivado de settings.registrationRequiresMembership — a página pública e o
   * formulário de inscrição precisam saber para não oferecer o que será recusado.
   */
  registrationRequiresMembership: boolean;
  /**
   * Palestrantes do evento, para a vitrine (FASE 25).
   *
   * Derivados das ATIVIDADES visíveis — o mesmo princípio do bloco `SPEAKERS` desde a
   * FASE 17: não existe um segundo cadastro para a página pública. Quem fala em três
   * atividades aparece UMA vez, com as três.
   */
  speakers: PublicSpeakerDetail[];
  page: {
    id: string;
    title: string;
    /** Publicada por decisão explícita? (FASE 23 acrescentou o agendamento.) */
    isPublished: boolean;
    /** Data agendada para entrar no ar — `null` quando não há agendamento. */
    publishAt: Date | null;
    /** Data agendada para SAIR do ar (janela de exibição, FASE 24). */
    unpublishAt: Date | null;
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
  /**
   * Trilhas ATIVAS da chamada de trabalhos.
   *
   * Existem aqui desde a FASE 17 para o bloco `TRACKS` da landing page: a página
   * precisa mostrar o que será aceito, e a contagem de submissões é o sinal de que
   * a chamada está viva. Nada de dado sensível — nome, descrição e cor.
   */
  tracks: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    color: string | null;
    submissionCount: number;
  }[];
  sponsors: {
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    /**
     * Cota do patrocinador. O `tierId` é o que permite o bloco `SPONSORS` mostrar
     * apenas uma cota (ex.: só os Diamantes) quando o organizador escolhe isso.
     */
    tierId: string | null;
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
 *
 * A página entra na consulta quando está PUBLICADA **ou** quando a data agendada já
 * passou (FASE 23, item E13). A decisão é do banco, no relógio do banco: sem
 * agendador, sem job, sem janela em que a campanha deveria estar no ar e não está.
 */
export async function getPublicEvent(
  tenantId: string,
  eventSlug: string,
): Promise<PublicEventDetail | null> {
  return loadEventDetail(tenantId, {
    slug: eventSlug,
    status: { in: [...PUBLIC_EVENT_STATUSES] },
    deletedAt: null,
  });
}

/**
 * Evento para a PRÉ-VISUALIZAÇÃO do rascunho (FASE 23, item E9).
 *
 * Duas diferenças em relação à leitura pública, e as duas são o ponto:
 *   • o evento é resolvido por ID e SEM filtro de status — o organizador
 *     pré-visualiza justamente o que ainda é rascunho;
 *   • a página vem mesmo despublicada (a pública exige `isPublished`).
 *
 * É leitura de ADMINISTRAÇÃO: quem chama é a rota de prévia, que exige
 * `page:manage`. Nada aqui pode ser exposto sem essa guarda.
 */
export async function getEventForPreview(
  tenantId: string,
  eventId: string,
): Promise<PublicEventDetail | null> {
  return loadEventDetail(
    tenantId,
    { id: eventId, deletedAt: null },
    { includeUnpublishedPage: true },
  );
}

/**
 * Leitura do detalhe do evento, com a mesma projeção para os dois consumidores.
 *
 * O mapeamento vive em UM lugar de propósito: a prévia existe para mostrar o que o
 * visitante verá, e duas projeções paralelas divergiriam — a prévia "quase certa" é
 * pior do que não ter prévia.
 */
async function loadEventDetail(
  tenantId: string,
  where: Record<string, unknown>,
  options: { includeUnpublishedPage?: boolean } = {},
): Promise<PublicEventDetail | null> {
  const now = new Date();

  const event = await withTenant(tenantId, (tx) =>
    tx.event.findFirst({
      where,
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
        settings: true,
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
            /** `false` = aberta: quem se inscreveu no evento entra automaticamente. */
            requiresRegistration: true,
            tags: true,
            room: { select: { name: true } },
            speakers: {
              orderBy: { displayOrder: 'asc' },
              select: {
                isKeynote: true,
                roleTitle: true,
                guestName: true,
                user: { select: { name: true } },
                /**
                 * O PERFIL é a fonte do que aparece na página (FASE 25). O vínculo
                 * legado (`guestName`/`user.name`) segue no select como último
                 * recurso, para atividade cadastrada antes desta fase.
                 */
                speakerProfile: {
                  select: {
                    id: true,
                    name: true,
                    roleTitle: true,
                    bio: true,
                    avatarUrl: true,
                    institution: true,
                    company: true,
                    socialLinks: true,
                    displayOrder: true,
                    userId: true,
                    isPublic: true,
                    deletedAt: true,
                  },
                },
              },
            },
            /**
             * Materiais PÚBLICOS da atividade.
             *
             * A lista da landing page é montada para visitante ANÔNIMO (e para a
             * pré-visualização do organizador), então só o que é público entra aqui.
             * O material de inscritos é resolvido na página da atividade, com o
             * visitante real.
             */
            speakerMaterials: {
              where: { deletedAt: null, visibility: 'PUBLIC' },
              orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                title: true,
                kind: true,
                storageKey: true,
                fileName: true,
                sizeBytes: true,
                url: true,
              },
            },
          },
        },
        pages: {
          /**
           * Página do evento: DENTRO DA JANELA e já publicada.
           *
           * ─────────────────────────────────────────────────────────────────────
           *  A JANELA É DECIDIDA NA LEITURA (FASES 23 e 24)
           * ─────────────────────────────────────────────────────────────────────
           *  Entrar no ar (`publishAt <= now`) e sair do ar (`unpublishAt > now`)
           *  são comparados com o relógio do banco, sem agendador — a plataforma não
           *  tem scheduler, e um job que não roda falharia em silêncio justamente no
           *  dia que importa. Uma promoção vencida publicada é pior do que uma
           *  promoção atrasada.
           *
           *  As três condições, em português:
           *    (1) publicada por decisão explícita OU com data de entrada vencida;
           *    (2) sem data de entrada futura (agendada ainda não aparece);
           *    (3) sem data de término vencida.
           *
           *  A pré-visualização ignora tudo isso (`includeUnpublishedPage`), porque
           *  é justamente o estado atual que ela mostra.
           */
          where: options.includeUnpublishedPage
            ? { deletedAt: null }
            : {
                deletedAt: null,
                AND: [
                  { OR: [{ isPublished: true }, { publishAt: { lte: now } }] },
                  { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
                  { OR: [{ unpublishAt: null }, { unpublishAt: { gt: now } }] },
                ],
              },
          orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
          take: 1,
          select: {
            id: true,
            title: true,
            isPublished: true,
            publishAt: true,
            unpublishAt: true,
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
            tierId: true,
            displayOrder: true,
            tier: { select: { name: true, key: true, rank: true } },
          },
        },
        tracks: {
          where: { isActive: true, deletedAt: null },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            color: true,
            _count: { select: { submissions: true } },
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
      tierId: sponsor.tierId,
      tierName: sponsor.tier?.name ?? null,
      tierKey: sponsor.tier?.key ?? null,
      displayOrder: sponsor.displayOrder,
    }));

  const tracks = event.tracks.map((track) => ({
    id: track.id,
    slug: track.slug,
    name: track.name,
    description: track.description,
    color: track.color,
    submissionCount: track._count.submissions,
  }));

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  VITRINE: UM PALESTRANTE, UMA ENTRADA (FASE 25)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Quem fala em três atividades aparece UMA vez, com as três — o mesmo
   *  agrupamento que o bloco `SPEAKERS` faz desde a FASE 17, agora com foto e bio.
   *
   *  Só entram perfis VISÍVEIS: um palestrante que pediu para sair da página
   *  (`isPublic = false`) continua na agenda como nome, porque a atividade precisa de
   *  quem a ministra — mas não ganha ficha nem aparece na vitrine.
   */
  const activities = event.activities.map((activity) => {
    const speakerRefs: PublicSpeakerRef[] = [];
    const names: string[] = [];

    for (const link of activity.speakers) {
      const profile = link.speakerProfile;
      const visible = profile !== null && profile.isPublic && profile.deletedAt === null;

      names.push(profile?.name ?? link.user?.name ?? link.guestName ?? 'Palestrante');

      if (visible && profile) {
        speakerRefs.push({
          id: profile.id,
          name: profile.name,
          roleTitle: link.roleTitle ?? profile.roleTitle ?? null,
          avatarUrl: profile.avatarUrl,
          institution: profile.institution,
          isKeynote: link.isKeynote,
        });
      }
    }

    return {
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
      requiresRegistration: activity.requiresRegistration,
      tags: activity.tags,
      speakerNames: names,
      speakers: speakerRefs,
      materials: activity.speakerMaterials.map((material) => ({
        id: material.id,
        title: material.title,
        kind: material.kind,
        isFile: material.storageKey !== null,
        fileName: material.fileName,
        sizeBytes: material.sizeBytes,
        externalUrl: material.storageKey === null ? material.url : null,
      })),
    };
  });

  const speakerMap = new Map<string, PublicSpeakerDetail>();

  for (const activity of event.activities) {
    for (const link of activity.speakers) {
      const profile = link.speakerProfile;
      if (!profile || !profile.isPublic || profile.deletedAt !== null) continue;

      const existing = speakerMap.get(profile.id);

      if (existing) {
        existing.activities.push({
          activityId: activity.id,
          activitySlug: activity.slug,
          title: activity.title,
          roleTitle: link.roleTitle ?? null,
        });
        if (existing.firstActivityAt === null || activity.startsAt < existing.firstActivityAt) {
          existing.firstActivityAt = activity.startsAt;
        }
        continue;
      }

      speakerMap.set(profile.id, {
        id: profile.id,
        name: profile.name,
        roleTitle: profile.roleTitle,
        avatarUrl: profile.avatarUrl,
        institution: profile.institution,
        isKeynote: link.isKeynote,
        bio: profile.bio,
        company: profile.company,
        socialLinks: readSocialLinks(profile.socialLinks),
        displayOrder: profile.displayOrder,
        activities: [
          {
            activityId: activity.id,
            activitySlug: activity.slug,
            title: activity.title,
            roleTitle: link.roleTitle ?? null,
          },
        ],
        firstActivityAt: activity.startsAt,
      });
    }
  }

  const speakers = orderSpeakersForDisplay([...speakerMap.values()]);

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    summary: event.summary,
    description: event.description,
    status: deriveEventStatus(event, now),
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
    registrationRequiresMembership: readEventRegistrationPolicy(event.settings).requiresMembership,
    page: page
      ? {
          id: page.id,
          title: page.title,
          isPublished: page.isPublished,
          publishAt: page.publishAt,
          unpublishAt: page.unpublishAt,
          metaTitle: page.metaTitle,
          metaDescription: page.metaDescription,
          blocks: page.blocks,
        }
      : null,
    activities,
    speakers,
    sponsors,
    tracks,
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
    | 'registrationRequiresMembership'
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
      registrationRequiresMembership: event.registrationRequiresMembership,
    },
    activity,
  };
}

/**
 * Ficha pública de UM palestrante do evento (FASE 25).
 *
 * Deriva do mesmo `getPublicEvent`, e isso é deliberado: a ficha herda a janela de
 * publicação, o status do evento e a regra de quais atividades aparecem. Uma consulta
 * própria teria de repetir essas quatro condições — e a primeira que ficasse para trás
 * publicaria a ficha de um palestrante de evento em rascunho.
 */
export async function getPublicSpeaker(
  tenantId: string,
  eventSlug: string,
  speakerId: string,
): Promise<{ event: PublicEventDetail; speaker: PublicSpeakerDetail } | null> {
  const event = await getPublicEvent(tenantId, eventSlug);
  if (!event) return null;

  const speaker = event.speakers.find((entry) => entry.id === speakerId);
  if (!speaker) return null;

  return { event, speaker };
}


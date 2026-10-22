/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — As projeções por recurso da API pública do evento (FASE 72)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DE ONDE VEM O DADO (e por que não há consulta aqui)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As funções deste arquivo recebem o MESMO read model que a página pública já
 *  monta — `PublicEventDetail` (F17/F25/F41/F45/F64) e `CallView` (F33) — e
 *  apenas RECORTAM o que pode sair. Não há Prisma, `withTenant`, `fetch`, relógio
 *  nem `Date.now()`: o instante que a projeção precisa (`registrationOpen`) entra
 *  por parâmetro. Quem lê o banco é `loadEventApiProjections` (o serviço), pelo
 *  mesmo `getPublicEventView` que a página usa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE CADA CAMPO É ESCRITO À MÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `...activity` seria mais curto e mais errado: no dia em que o read model
 *  ganhasse `onlineUrl`, `confirmedCount` ou as respostas do formulário, elas
 *  atravessariam a fronteira sem ninguém decidir. A allowlist explícita é a
 *  primeira barreira; `assertApiProjectionSemCampoProibido`, no envelope, é a
 *  segunda. As duas são necessárias: a allowlist impede o campo de entrar, a
 *  catraca impede que ele passe despercebido se alguém voltar a espalhar o objeto.
 *
 *  O import de `PublicEventDetail`/`CallView` é `import type` de propósito: ele
 *  some no build e mantém este módulo sem nenhuma dependência de infraestrutura.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { EventStatus } from '@/domain/events/event-rules';
import { isRegistrationOpen } from '@/domain/events/event-rules';
import type { ResolvedEventTheme } from '@/domain/events/landing-page';
import { tenantPath } from '@/domain/tenancy/resolution';
import type {
  PublicActivitySummary,
  PublicEventDetail,
} from '@/lib/events/event-repository';
import type { CallView } from '@/lib/proposals/call-service';
import type { SocialLinks } from '@/domain/speakers/speaker-rules';
import type { CallState, ProposalKind } from '@/domain/proposals/call-rules';
import type { SponsorLogoScale } from '@/domain/events/sponsor-rules';

export interface ApiEventoTenant {
  slug: string;
  name: string;
}

export interface ApiEvento {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  description: string | null;
  status: EventStatus;
  modality: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  theme: ResolvedEventTheme;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  /** Derivado da MESMA janela que a página avalia, no `generatedAt` da resposta. */
  registrationOpen: boolean;
  capacity: number | null;
  remainingSeats: number | null;
  activityCount: number;
  usesCall: boolean;
  registrationRequiresMembership: boolean;
  tenant: ApiEventoTenant;
}

export interface ApiAtividade {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  type: string;
  status: PublicActivitySummary['status'];
  modality: string;
  startsAt: Date;
  endsAt: Date;
  workloadMinutes: number;
  roomName: string | null;
  /** Vagas EFETIVAS (o menor entre atividade e sala) — o número que a página anuncia. */
  capacity: number | null;
  remainingSeats: number | null;
  requiresRegistration: boolean;
  isFeatured: boolean;
  tags: string[];
  /** Ids dos perfis VISÍVEIS — o vínculo para o recurso `palestrantes`. */
  speakerIds: string[];
  speakerNames: string[];
}

export interface ApiPalestrante {
  id: string;
  name: string;
  roleTitle: string | null;
  avatarUrl: string | null;
  institution: string | null;
  isKeynote: boolean;
  bio: string | null;
  company: string | null;
  socialLinks: SocialLinks;
  activities: {
    activityId: string;
    activitySlug: string;
    title: string;
    roleTitle: string | null;
  }[];
}

export interface ApiPatrocinador {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  tierId: string | null;
  tierName: string | null;
  tierKey: string | null;
  tierColor: string | null;
  tierLogoScale: SponsorLogoScale;
  tierDescription: string | null;
}

export interface ApiChamada {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  instructions: string | null;
  kind: ProposalKind;
  kindLabel: string;
  state: CallState;
  opensAt: Date | null;
  closesAt: Date | null;
  windowLabel: string;
  countdown: string | null;
  trackName: string | null;
  /** Caminho interno do formulário; a fatia 2 resolve a origem quando montar a URL. */
  formPath: string;
}

/**
 * O recurso `evento`.
 *
 * `confirmedCount` NÃO entra: é contador interno de operação. A página expõe
 * `remainingSeats`, que é a informação que o visitante precisa ("ainda há vaga?")
 * e já vem calculada pela régua do domínio — recalculá-la aqui criaria a segunda
 * conta para o mesmo número.
 */
export function projectApiEvento(input: {
  event: PublicEventDetail;
  tenant: ApiEventoTenant;
  now: Date;
}): ApiEvento {
  const { event } = input;

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    summary: event.summary,
    description: event.description,
    status: event.status,
    modality: event.modality,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    city: event.city,
    state: event.state,
    country: event.country,
    coverImageUrl: event.coverImageUrl,
    logoUrl: event.logoUrl,
    primaryColor: event.primaryColor,
    theme: { ...event.theme },
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    registrationOpen: isRegistrationOpen({
      now: input.now,
      eventStartsAt: event.startsAt,
      eventEndsAt: event.endsAt,
      eventStatus: event.status,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
    }),
    capacity: event.capacity,
    remainingSeats: event.remainingSeats,
    activityCount: event.activityCount,
    usesCall: event.usesCall,
    registrationRequiresMembership: event.registrationRequiresMembership,
    tenant: { slug: input.tenant.slug, name: input.tenant.name },
  };
}

/**
 * O recurso `atividades`.
 *
 * Ficam de fora, por decisão:
 *   • `onlineUrl` — o endereço da sala só é entregue a quem tem lugar; a API não
 *     tem sessão e o serviço já aplica a visibilidade anônima antes de projetar;
 *   • `confirmedCount`/`waitlistCount`/`waitlistEnabled`/`checkInEnabled` — operação;
 *   • `roomCapacity` — teto operacional; o que o público precisa é `capacity`,
 *     que já é o limite EFETIVO;
 *   • `materials` — fora do contrato desta fatia (a página já os projeta; a API
 *     pode ganhá-los em uma adição compatível de `v1`, nunca por acidente).
 */
export function projectApiAtividades(event: PublicEventDetail): ApiAtividade[] {
  return event.activities.map((activity) => ({
    id: activity.id,
    slug: activity.slug,
    title: activity.title,
    description: activity.description,
    type: activity.type,
    status: activity.status,
    modality: activity.modality,
    startsAt: activity.startsAt,
    endsAt: activity.endsAt,
    workloadMinutes: activity.workloadMinutes,
    roomName: activity.roomName,
    capacity: activity.capacity,
    remainingSeats: activity.remainingSeats,
    requiresRegistration: activity.requiresRegistration,
    isFeatured: activity.isFeatured,
    tags: [...activity.tags],
    speakerIds: activity.speakers.map((speaker) => speaker.id),
    speakerNames: [...activity.speakerNames],
  }));
}

/**
 * O recurso `palestrantes` — os campos PÚBLICOS da vitrine.
 *
 * O read model já descarta perfil não público (`isPublic`/`deletedAt`) e ordena
 * pelo mesmo `orderSpeakersForDisplay` da página. Aqui não há e-mail, telefone,
 * `userId` nem `displayOrder`: o que é da pessoa e não da vitrine não entra.
 */
export function projectApiPalestrantes(event: PublicEventDetail): ApiPalestrante[] {
  return event.speakers.map((speaker) => ({
    id: speaker.id,
    name: speaker.name,
    roleTitle: speaker.roleTitle,
    avatarUrl: speaker.avatarUrl,
    institution: speaker.institution,
    isKeynote: speaker.isKeynote,
    bio: speaker.bio,
    company: speaker.company,
    socialLinks: { ...speaker.socialLinks },
    activities: speaker.activities.map((activity) => ({
      activityId: activity.activityId,
      activitySlug: activity.activitySlug,
      title: activity.title,
      roleTitle: activity.roleTitle,
    })),
  }));
}

/**
 * O recurso `patrocinadores` — cotas e marcas.
 *
 * A ordem é a da PÁGINA (`rank` da cota e, no empate, `displayOrder`), herdada de
 * `getPublicEvent`: reordenar aqui por `name` faria a API e a página discordarem
 * sobre qual patrocinador é o primeiro. `contactEmail`/`contactPhone` nunca
 * estiveram no read model público; a allowlist garante que não entrem por engano.
 */
export function projectApiPatrocinadores(event: PublicEventDetail): ApiPatrocinador[] {
  return event.sponsors.map((sponsor) => ({
    id: sponsor.id,
    name: sponsor.name,
    logoUrl: sponsor.logoUrl,
    websiteUrl: sponsor.websiteUrl,
    tierId: sponsor.tierId,
    tierName: sponsor.tierName,
    tierKey: sponsor.tierKey,
    tierColor: sponsor.tierColor,
    tierLogoScale: sponsor.tierLogoScale,
    tierDescription: sponsor.tierDescription,
  }));
}

/**
 * O recurso `chamadas` — as PUBLICADAS, com o estado decidido no `now` da resposta.
 *
 * `proposals`/`decided` são contadores internos de operação e NÃO saem, embora
 * viagem hoje no `CallView` que o painel consome. O `formPath` é montado com
 * `tenantPath` — a mesma função de link da página — para o site externo apontar
 * para o formulário certo sem adivinhar a rota.
 */
export function projectApiChamadas(input: {
  calls: readonly CallView[];
  tenantSlug: string;
  eventSlug: string;
}): ApiChamada[] {
  return input.calls.map((call) => ({
    id: call.id,
    slug: call.slug,
    title: call.title,
    summary: call.summary,
    instructions: call.instructions,
    kind: call.kind,
    kindLabel: call.kindLabel,
    state: call.state,
    opensAt: call.opensAt,
    closesAt: call.closesAt,
    windowLabel: call.windowLabel,
    countdown: call.countdown,
    trackName: call.trackName,
    formPath: tenantPath(
      input.tenantSlug,
      `/eventos/${input.eventSlug}/chamada/${call.slug}`,
    ),
  }));
}

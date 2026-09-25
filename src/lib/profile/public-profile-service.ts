/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Perfil público do participante (FASE 44)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM ESCREVE O QUÊ, E POR QUE ISSO ESTÁ SEPARADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a PESSOA escreve a própria identidade e a própria decisão de visibilidade —
 *    sempre na PRÓPRIA linha global (`users`), com o `userId` vindo da sessão;
 *  • a INSTITUIÇÃO não escreve nada aqui: o perfil é da pessoa, e a casa só aparece
 *    como o lugar onde os dados existem (e é ela que decide o diretório, por vínculo);
 *  • a LEITURA pública passa por `withTenant` como qualquer outra: o perfil é o
 *    recorte de UMA instituição, e a RLS continua sendo a última linha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A LEITURA PÚBLICA **NÃO** FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não traz o ranking com nome de terceiros (só a fatia da própria pessoa), não
 *  infere interesse do comportamento, não mostra data nem minuto de presença, e não
 *  atravessa instituições: o mesmo `@handle` tem uma página por casa, e cada uma
 *  mostra só o que existe naquela casa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { getTenantContext } from '@/lib/events/event-repository';
import { levelTitle } from '@/domain/gamification/xp-rules';
import { resolveArt } from '@/domain/gamification/card-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { publicBaseUrl } from '@/lib/public-url';
import {
  readPublicContacts,
  sanitizePublicContacts,
  type PublicContacts,
} from '@/domain/profile/public-contacts';
import {
  DEFAULT_PROFILE_AUDIENCES,
  MAX_INTERESTS,
  PUBLIC_BIO_MAX_LENGTH,
  PUBLIC_HEADLINE_MAX_LENGTH,
  PUBLIC_PROFILE_FIELDS,
  buildPublicProfile,
  evaluatePublicProfile,
  normalizeInterests,
  normalizeLattesId,
  normalizeOrcidId,
  normalizePublicSiteUrl,
  normalizePublicText,
  parseProfileAudiences,
  profileViewerOf,
  standingFromRank,
  usernameChangeState,
  validateUsername,
  type ProfileAudience,
  type ProfileViewer,
  type PublicProfileField,
  type PublicProfilePayload,
  type PublicProfileSource,
} from '@/domain/profile/public-profile-rules';

export type PublicProfileErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'USERNAME_TAKEN'
  | 'USERNAME_COOLDOWN'
  | 'INTERNAL';

export type PublicProfileResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: PublicProfileErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  A tela da pessoa
// ───────────────────────────────────────────────────────────────────────────────
export interface PublicProfileEventOption {
  id: string;
  title: string;
  startsAt: Date | null;
}

export interface PublicProfileSettings {
  username: string | null;
  displayNameSource: string;
  headline: string | null;
  bio: string | null;
  interests: string[];
  siteUrl: string | null;
  orcidId: string | null;
  lattesId: string | null;
  /** Redes de contato que a pessoa preencheu (FASE 45). O e-mail vem do cadastro. */
  contacts: PublicContacts;
  /** O e-mail do cadastro — exibido na tela só para a pessoa saber o que publica. */
  email: string;
  avatarUrl: string | null;
  audiences: Record<PublicProfileField, ProfileAudience>;
  indexable: boolean;
  listedInDirectory: boolean;
  publicEventIds: string[];
  /** Nome completo no resultado público do sorteio (padrão: mascarado). */
  publicNameInResults: boolean;
  /** Eventos desta instituição em que a pessoa esteve e que ela PODE listar. */
  eventOptions: PublicProfileEventOption[];
  /** Quando o handle poderá ser trocado de novo (`null` = pode agora). */
  nextUsernameChangeAt: Date | null;
}

export async function getPublicProfileSettings(input: {
  tenantId: string;
  userId: string;
  now?: Date;
}): Promise<PublicProfileResult<{ settings: PublicProfileSettings }>> {
  try {
    const now = input.now ?? new Date();

    const data = await withTenant(input.tenantId, async (tx) => {
      const [user, membership, registrations] = await Promise.all([
        tx.user.findUnique({
          where: { id: input.userId },
          select: {
            name: true,
            email: true,
            image: true,
            publicHandle: true,
            bio: true,
            headline: true,
            orcidId: true,
            lattesId: true,
            publicSiteUrl: true,
            publicInterests: true,
            publicSocialLinks: true,
            profileAudiences: true,
            profileIndexable: true,
            isPublicProfile: true,
            usernameChangedAt: true,
          },
        }),
        tx.userTenantProfile.findFirst({
          where: { tenantId: input.tenantId, userId: input.userId, deletedAt: null },
          select: { listedInDirectory: true, publicEventIds: true },
        }),
        tx.registration.findMany({
          where: {
            tenantId: input.tenantId,
            userId: input.userId,
            deletedAt: null,
            status: { in: ['CONFIRMED', 'ATTENDED'] },
            event: { deletedAt: null, status: { notIn: ['DRAFT', 'ARCHIVED'] } },
          },
          orderBy: { createdAt: 'desc' },
          take: 60,
          select: { event: { select: { id: true, title: true, startsAt: true } } },
        }),
      ]);

      return { user, membership, registrations };
    });

    if (!data.user) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Pessoa não encontrada.' };
    }

    const eventOptions: PublicProfileEventOption[] = [];
    const seen = new Set<string>();

    for (const row of data.registrations) {
      if (!row.event || seen.has(row.event.id)) continue;
      seen.add(row.event.id);
      eventOptions.push({ id: row.event.id, title: row.event.title, startsAt: row.event.startsAt });
    }

    const publicEventIds = (data.membership?.publicEventIds ?? []).filter((id) => seen.has(id));

    return {
      ok: true as const,
      settings: {
        username: data.user.publicHandle,
        displayNameSource: data.user.name,
        headline: data.user.headline,
        bio: data.user.bio,
        interests: data.user.publicInterests,
        siteUrl: data.user.publicSiteUrl,
        orcidId: data.user.orcidId,
        lattesId: data.user.lattesId,
        contacts: readPublicContacts(data.user.publicSocialLinks),
        email: data.user.email,
        avatarUrl: data.user.image,
        audiences: parseProfileAudiences(data.user.profileAudiences),
        indexable: data.user.profileIndexable,
        listedInDirectory: data.membership?.listedInDirectory ?? false,
        publicEventIds,
        publicNameInResults: data.user.isPublicProfile,
        eventOptions,
        nextUsernameChangeAt: usernameChangeState({
          lastChangedAt: data.user.usernameChangedAt,
          now,
        }).nextAllowedAt,
      },
    };
  } catch (error) {
    console.error(`[perfil] falha ao ler as configurações: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível carregar o seu perfil.' };
  }
}

export interface SavePublicProfileInput {
  tenantId: string;
  userId: string;
  /** Handle cru: o domínio normaliza e valida. */
  username: string;
  headline: string | null;
  bio: string | null;
  interests: readonly string[];
  siteUrl: string | null;
  /** Identificadores acadêmicos digitados pela pessoa (`null` limpa). */
  orcidId: string | null;
  lattesId: string | null;
  /**
   * Redes de contato cruas do formulário.
   *
   * AUSENTE **preserva** o que está gravado, e mapa vazio LIMPA — a mesma régua do
   * `taxId` do patrocinador (FASE 17): a tela manda as quatro redes sempre (vazias
   * quando a pessoa apagou), mas um chamador que não conhece o campo não pode apagar
   * o contato de ninguém por omissão.
   */
  contacts?: Record<string, unknown>;
  /** A matriz crua do formulário — validada campo a campo. */
  audiences: Record<string, unknown>;
  indexable: boolean;
  listedInDirectory: boolean;
  publicEventIds: readonly string[];
  /**
   * Mostrar o NOME COMPLETO no resultado público do sorteio (`User.isPublicProfile`).
   *
   * É a decisão que a FASE 22 abriu e deixou sem tela (dívida E35): o padrão é
   * mascarar, e aparecer com o nome inteiro é uma escolha explícita — por isso ela
   * mora aqui, junto das outras decisões de "quem me vê".
   */
  publicNameInResults: boolean;
  now?: Date;
}

/**
 * Grava o perfil.
 *
 * ─── A ORDEM DAS CHECAGENS IMPORTA ───────────────────────────────────────────
 *
 *  Primeiro a FORMA (o handle é válido?), depois a ESPERA (trocou há menos de 30
 *  dias?) e só então a unicidade — que é conferida no banco e reforçada pelo índice
 *  sobre `lower(publicHandle)`. A mensagem de cada recusa diz o que fazer, porque é
 *  a diferença entre "não pode" e "não pode AGORA, por N dias".
 *
 *  Handle igual ao atual NÃO conta como troca: salvar o formulário sem mexer no
 *  campo não pode consumir a espera de 30 dias.
 */
export async function savePublicProfile(
  input: SavePublicProfileInput,
): Promise<PublicProfileResult<{ username: string; handleChanged: boolean }>> {
  const now = input.now ?? new Date();

  const verdict = validateUsername(input.username);

  if (!verdict.ok) {
    return { ok: false as const, code: 'INVALID_INPUT' as const, message: verdict.message };
  }

  const username = verdict.username;

  const audienceMatrix = parseProfileAudiences(input.audiences);
  const interests = normalizeInterests(input.interests);
  const headline = normalizePublicText(input.headline, PUBLIC_HEADLINE_MAX_LENGTH);
  const bio = normalizePublicText(input.bio, PUBLIC_BIO_MAX_LENGTH);
  const siteUrl = normalizePublicSiteUrl(input.siteUrl);

  if (input.siteUrl && input.siteUrl.trim().length > 0 && !siteUrl) {
    return {
      ok: false as const,
      code: 'INVALID_INPUT' as const,
      message: 'O site precisa começar com http:// ou https://.',
    };
  }

  const orcid = normalizeOrcidId(input.orcidId);
  if (!orcid.ok) {
    return { ok: false as const, code: 'INVALID_INPUT' as const, message: orcid.message };
  }

  const lattes = normalizeLattesId(input.lattesId);
  if (!lattes.ok) {
    return { ok: false as const, code: 'INVALID_INPUT' as const, message: lattes.message };
  }

  const contacts = sanitizePublicContacts(input.contacts);

  if (!contacts.ok) {
    /**
     * Recusa com TODOS os motivos de uma vez: quem colou um endereço errado precisa
     * saber qual campo é, e não descobrir um por vez a cada salvamento.
     */
    return {
      ok: false as const,
      code: 'INVALID_INPUT' as const,
      message: 'Confira os contatos informados.',
      details: contacts.errors,
    };
  }

  const disclosed = PUBLIC_PROFILE_FIELDS.filter((field) => audienceMatrix[field] !== 'PRIVATE');

  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: input.userId },
        select: { publicHandle: true, usernameChangedAt: true },
      });

      if (!before) {
        return { kind: 'not-found' as const };
      }

      const handleChanged = before.publicHandle !== username;

      if (handleChanged) {
        const change = usernameChangeState({ lastChangedAt: before.usernameChangedAt, now });

        if (!change.canChange) {
          return {
            kind: 'cooldown' as const,
            nextAllowedAt: change.nextAllowedAt,
            daysLeft: change.daysLeft,
          };
        }

        /** Unicidade ANTES de tentar: a mensagem boa depende de saber quem chegou primeiro. */
        const taken = await tx.user.findFirst({
          where: { publicHandle: username, id: { not: input.userId } },
          select: { id: true },
        });

        if (taken) {
          return { kind: 'taken' as const };
        }
      }

      /**
       * Eventos escolhidos: só os que a pessoa REALMENTE participou nesta casa.
       * Aceitar id de evento alheio publicaria uma presença que não existe (e a FK
       * não impediria: o id é de outro tenant, invisível sob RLS — mas invisível é
       * diferente de inexistente).
       */
      const allowedEvents = await tx.registration.findMany({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          deletedAt: null,
          status: { in: ['CONFIRMED', 'ATTENDED'] },
        },
        select: { eventId: true },
      });

      const allowedEventIds = new Set(allowedEvents.map((row) => row.eventId));
      const chosenEvents = input.publicEventIds.filter((id) => allowedEventIds.has(id));

      await tx.user.update({
        where: { id: input.userId },
        data: {
          publicHandle: username,
          headline,
          bio,
          publicInterests: interests,
          publicSiteUrl: siteUrl,
          orcidId: orcid.value,
          lattesId: lattes.value,
          /** Ausente preserva (ver `SavePublicProfileInput.contacts`). */
          ...(input.contacts === undefined
            ? {}
            : { publicSocialLinks: contacts.contacts as unknown as object }),
          profileAudiences: audienceMatrix as unknown as object,
          profileIndexable: input.indexable,
          isPublicProfile: input.publicNameInResults,
          ...(handleChanged ? { usernameChangedAt: now } : {}),
        },
      });

      await tx.userTenantProfile.updateMany({
        where: { tenantId: input.tenantId, userId: input.userId, deletedAt: null },
        data: { listedInDirectory: input.listedInDirectory, publicEventIds: chosenEvents },
      });

      /**
       * A TRILHA guarda a DECISÃO, não o conteúdo.
       *
       *  O que interessa a quem audita é "quem tornou o quê visível, quando" — e não
       *  a bio ou os interesses da pessoa, que não têm por que ficar copiados na
       *  auditoria da instituição.
       */
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'user_public_profile',
          entityId: input.userId,
          changes: {
            handle: { from: before.publicHandle, to: username },
            camposDivulgados: { from: null, to: disclosed.join(', ') || 'nenhum' },
            camposPrivados: {
              from: null,
              to: PUBLIC_PROFILE_FIELDS.filter((field) => audienceMatrix[field] === 'PRIVATE').join(', ') || 'nenhum',
            },
            achavelEmBuscadores: { from: null, to: input.indexable ? 'sim' : 'não' },
            noDiretorioDaInstituicao: { from: null, to: input.listedInDirectory ? 'sim' : 'não' },
            nomeCompletoNoResultado: { from: null, to: input.publicNameInResults ? 'sim' : 'não' },
            eventosEscolhidos: { from: null, to: String(chosenEvents.length) },
          },
        },
        tx,
      );

      return { kind: 'saved' as const, handleChanged };
    });

    if (outcome.kind === 'not-found') {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Pessoa não encontrada.' };
    }

    if (outcome.kind === 'taken') {
      return {
        ok: false as const,
        code: 'USERNAME_TAKEN' as const,
        message: `O @${username} já está em uso. Escolha outro.`,
      };
    }

    if (outcome.kind === 'cooldown') {
      return {
        ok: false as const,
        code: 'USERNAME_COOLDOWN' as const,
        message: `O @handle só pode ser trocado a cada 30 dias. Faltam ${outcome.daysLeft} dia(s).`,
        details: outcome.nextAllowedAt
          ? [`Próxima troca a partir de ${outcome.nextAllowedAt.toLocaleDateString('pt-BR')}.`]
          : undefined,
      };
    }

    return { ok: true as const, username, handleChanged: outcome.handleChanged };
  } catch (error) {
    /** O índice único é a palavra final: duas pessoas confirmando no mesmo instante. */
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('publicHandle')) {
      return {
        ok: false as const,
        code: 'USERNAME_TAKEN' as const,
        message: `O @${username} acabou de ser usado por outra pessoa. Escolha outro.`,
      };
    }

    console.error(`[perfil] falha ao salvar: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível salvar o seu perfil.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  A página pública
// ───────────────────────────────────────────────────────────────────────────────
export interface PublicProfilePage {
  tenantName: string;
  tenantSlug: string;
  username: string;
  viewer: ProfileViewer;
  /** Só o que passou pela régua — nem uma chave a mais. */
  profile: PublicProfilePayload;
  /** Campos autorizados a este visitante (para a página montar as seções). */
  visibleFields: PublicProfileField[];
  /** Há mais coisa para quem entrar — o convite é honesto. */
  moreForAttendees: boolean;
  indexable: boolean;
  isOwner: boolean;
}

/**
 * Monta a página pública de um `@handle` NESTA instituição.
 *
 * ─── O 404 É A RESPOSTA DE UM PERFIL PRIVADO ─────────────────────────────────
 *
 *  Quando nenhum campo é visível para este visitante, a resposta é `NOT_FOUND` — e
 *  não "existe, mas você não pode ver". A segunda já revelaria a existência daquele
 *  handle, que é justamente o que a pessoa decidiu não revelar.
 */
export async function getPublicProfile(input: {
  tenantSlug: string;
  username: string;
  viewerUserId: string | null;
  now?: Date;
}): Promise<PublicProfileResult<{ page: PublicProfilePage }>> {
  try {
    const tenant = await getTenantContext(input.tenantSlug);

    if (!tenant) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Instituição não encontrada.' };
    }

    const normalized = input.username.trim().toLowerCase();
    if (normalized.length === 0) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Perfil não encontrado.' };
    }

    const data = await withTenant(tenant.tenantId, async (tx) => {
      const person = await tx.user.findFirst({
        where: { publicHandle: normalized, deletedAt: null },
        select: {
          id: true,
          name: true,
          /**
           * O e-mail entra no select porque o campo `contacts` o publica quando a
           * pessoa autoriza (FASE 45). Ele NÃO tem chave própria em `links`: mora no
           * mesmo nível de visibilidade das redes, e o padrão é fechado.
           */
          email: true,
          image: true,
          publicHandle: true,
          bio: true,
          headline: true,
          orcidId: true,
          lattesId: true,
          publicSiteUrl: true,
          publicInterests: true,
          publicSocialLinks: true,
          profileAudiences: true,
          profileIndexable: true,
        },
      });

      if (!person) return { person: null } as const;

      const isOwner = input.viewerUserId === person.id;

      /**
       * O visitante "da casa" é quem tem vínculo ativo OU alguma inscrição nesta
       * instituição — a mesma régua do material `ATTENDEES_ONLY` do palestrante.
       */
      const audience = input.viewerUserId
        ? await (async () => {
            if (isOwner) return true;

            const [membership, registration] = await Promise.all([
              tx.userTenantProfile.findFirst({
                where: {
                  tenantId: tenant.tenantId,
                  userId: input.viewerUserId!,
                  status: 'ACTIVE',
                  deletedAt: null,
                },
                select: { id: true },
              }),
              tx.registration.findFirst({
                where: { tenantId: tenant.tenantId, userId: input.viewerUserId!, deletedAt: null },
                select: { id: true },
              }),
            ]);

            return Boolean(membership || registration);
          })()
        : false;

      /**
       * A PESSOA do perfil participa DESTA instituição?
       *
       * É a guarda que impede o `@handle` global de virar uma janela para dentro de uma
       * instituição onde a pessoa nunca esteve: sem vínculo nem inscrição aqui, a página
       * não existe (404), por mais pública que a pessoa seja na casa dela.
       */
      const [ownerMembership, ownerRegistration] = await Promise.all([
        tx.userTenantProfile.findFirst({
          where: { tenantId: tenant.tenantId, userId: person.id, status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        }),
        tx.registration.findFirst({
          where: { tenantId: tenant.tenantId, userId: person.id, deletedAt: null },
          select: { id: true },
        }),
      ]);

      return {
        person,
        isOwner,
        audience,
        belongsToInstitution: Boolean(ownerMembership || ownerRegistration),
      } as const;
    });

    if (!data.person) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Perfil não encontrado.' };
    }

    const person = data.person;
    const handle = person.publicHandle;

    if (!handle) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Perfil não encontrado.' };
    }
    const audiences = parseProfileAudiences(person.profileAudiences);
    const viewer = profileViewerOf({
      isOwner: data.isOwner ?? false,
      isInstitutionAudience: data.audience ?? false,
    });

    const evaluation = evaluatePublicProfile({
      audiences,
      viewer,
      hasUsername: true,
      belongsToInstitution: data.belongsToInstitution ?? false,
    });

    if (!evaluation.pageVisible) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Perfil não encontrado.' };
    }

    const visible = new Set(evaluation.visibleFields);

    /** Só consulta o que vai aparecer: campo privado não é lido nem por acidente. */
    const slice = await withTenant(tenant.tenantId, async (tx) => {
      const needsXp = visible.has('level') || visible.has('xp') || visible.has('streak') || visible.has('standing');
      const needsCards = visible.has('pinnedCards') || visible.has('collection');
      const needsEvents = visible.has('eventCount') || visible.has('events');
      const needsCertificates = visible.has('certificates');

      const [xp, cards, registrations, membership, certificates] = await Promise.all([
        needsXp
          ? tx.userXpProfile.findUnique({
              where: { tenantId_userId: { tenantId: tenant.tenantId, userId: person.id } },
              select: {
                totalXp: true,
                level: true,
                prestigeLevel: true,
                currentStreak: true,
                cardsCollected: true,
              },
            })
          : null,
        needsCards
          ? tx.userCard.findMany({
              where: { tenantId: tenant.tenantId, userId: person.id },
              select: {
                isFoil: true,
                isPinned: true,
                cardTemplate: {
                  select: { name: true, rarity: true, art: true, isSecret: true, deletedAt: true },
                },
              },
            })
          : [],
        needsEvents
          ? tx.registration.findMany({
              where: {
                tenantId: tenant.tenantId,
                userId: person.id,
                deletedAt: null,
                status: { in: ['CONFIRMED', 'ATTENDED'] },
                event: { deletedAt: null, status: { notIn: ['DRAFT', 'ARCHIVED'] } },
              },
              orderBy: { createdAt: 'desc' },
              take: 100,
              select: { event: { select: { id: true, title: true, startsAt: true } } },
            })
          : [],
        tx.userTenantProfile.findFirst({
          where: { tenantId: tenant.tenantId, userId: person.id, deletedAt: null },
          select: { publicEventIds: true },
        }),
        needsCertificates
          ? tx.certificate.findMany({
              where: {
                tenantId: tenant.tenantId,
                userId: person.id,
                status: 'ISSUED',
                revokedAt: null,
              },
              orderBy: [{ issuedAt: 'desc' }],
              take: 20,
              select: { title: true, kind: true, validationCode: true, workloadMinutes: true },
            })
          : [],
      ]);

      /**
       * A POSIÇÃO é calculada contra a instituição, e devolve só a fatia.
       *
       * `betterThan` conta quem esta pessoa SUPERA (`lt`), não quem está à frente: é a
       * régua que `standingFromRank` espera, e invertê-la dava "top 100%" ao primeiro
       * colocado (defeito real, pego por teste unitário). Empate é tratado como
       * empate — quem divide a mesma pontuação divide a mesma fatia, e nenhum dos
       * dois vira "top 1%" sozinho. A lista de quem é nunca sai daqui.
       */
      let standing: { topPercent: number; sampleSize: number } | null = null;

      if (visible.has('standing') && xp && xp.totalXp > 0) {
        const [betterThan, total] = await Promise.all([
          tx.userXpProfile.count({
            where: { tenantId: tenant.tenantId, totalXp: { lt: xp.totalXp } },
          }),
          tx.userXpProfile.count({ where: { tenantId: tenant.tenantId, totalXp: { gt: 0 } } }),
        ]);

        standing = standingFromRank({ betterThan, total });
      }

      return { xp, cards, registrations, membership, certificates, standing };
    });

    const pinnedCards = slice.cards
      .filter((card) => card.isPinned && card.cardTemplate && !card.cardTemplate.deletedAt)
      .slice(0, 3)
      .map((card) => ({
        name: card.cardTemplate!.name,
        rarity: card.cardTemplate!.rarity,
        imageUrl: resolveArt(card.cardTemplate!.art).imageUrl,
        isFoil: card.isFoil,
      }));

    /** A coleção conta o que a pessoa tem (e cartas secretas não são reveladas). */
    const collectionEntries = slice.cards.filter((card) => card.cardTemplate && !card.cardTemplate.deletedAt);
    const byRarity: Record<string, number> = {};

    for (const entry of collectionEntries) {
      const rarity = entry.cardTemplate!.rarity;
      byRarity[rarity] = (byRarity[rarity] ?? 0) + 1;
    }

    const eventIds: string[] = [];
    const events: { title: string; year: number }[] = [];
    const chosenEvents = new Set(slice.membership?.publicEventIds ?? []);

    for (const row of slice.registrations) {
      if (!row.event || eventIds.includes(row.event.id)) continue;
      eventIds.push(row.event.id);

      if (chosenEvents.has(row.event.id)) {
        events.push({
          title: row.event.title,
          year: (row.event.startsAt ?? new Date()).getFullYear(),
        });
      }
    }

    const xp = slice.xp;
    const totalXp = xp?.totalXp ?? 0;
    const level = xp?.level ?? 1;

    const source: PublicProfileSource = {
      username: handle,
      displayName: person.name,
      avatarUrl: person.image,
      headline: person.headline,
      bio: person.bio,
      interests: person.publicInterests,
      siteUrl: person.publicSiteUrl,
      orcidId: person.orcidId,
      lattesId: person.lattesId,
      /**
       * Os contatos entram na FONTE já validados; quem decide se saem é a matriz —
       * `buildPublicProfile` só publica as chaves dos campos autorizados.
       */
      email: person.email,
      socialLinks: readPublicContacts(person.publicSocialLinks),
      level,
      levelTitle: levelTitle(level),
      prestige: xp?.prestigeLevel ?? 0,
      xp: totalXp,
      streak: xp?.currentStreak ?? 0,
      pinnedCards,
      collection: {
        owned: collectionEntries.length,
        total: collectionEntries.length,
        byRarity,
        foils: collectionEntries.filter((entry) => entry.isFoil).length,
      },
      eventCount: eventIds.length,
      events,
      certificates: slice.certificates.map((certificate) => ({
        title: certificate.title,
        kind: certificate.kind,
        workloadLabel: formatWorkload(certificate.workloadMinutes),
        validationUrl: `${publicBaseUrl()}/validar/${certificate.validationCode}`,
      })),
      standing: slice.standing,
    };

    const profile = buildPublicProfile({ source, visibleFields: evaluation.visibleFields });

    /**
     * A LEITURA entra na trilha (como a ficha 360 da FASE 32): olhar a página de
     * alguém é um ato, e a pessoa merece que ele fique registrado — o dono vendo a
     * própria prévia, não.
     */
    if (!data.isOwner && input.viewerUserId) {
      await withTenant(tenant.tenantId, (tx) =>
        recordAudit(
          {
            tenantId: tenant.tenantId,
            userId: input.viewerUserId!,
            action: 'READ',
            entityType: 'user_public_profile',
            entityId: person.id,
            changes: { perfil: { from: null, to: `@${handle}` } },
          },
          tx,
        ),
      ).catch(() => undefined);
    }

    return {
      ok: true as const,
      page: {
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        username: handle,
        viewer,
        profile,
        visibleFields: evaluation.visibleFields,
        moreForAttendees: evaluation.moreForAttendees,
        indexable: person.profileIndexable,
        isOwner: data.isOwner ?? false,
      },
    };
  } catch (error) {
    console.error(`[perfil] falha ao montar a página: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível abrir este perfil.' };
  }
}

/**
 * Quem aparece no diretório de participantes desta instituição.
 *
 * Depende de DUAS autorizações: existir a página (ao menos um campo visível para
 * visitante anônimo ou para a casa) e a pessoa ter ligado o diretório. Ordena por
 * nível, porque é um diretório de participação — e não um ranking de XP.
 */
export async function listDirectoryProfiles(input: {
  tenantId: string;
  limit?: number;
}): Promise<{ username: string; displayName: string; avatarUrl: string | null; headline: string | null; level: number }[]> {
  const rows = await withTenant(input.tenantId, async (tx) => {
    const memberships = await tx.userTenantProfile.findMany({
      where: { tenantId: input.tenantId, listedInDirectory: true, status: 'ACTIVE', deletedAt: null },
      orderBy: { joinedAt: 'asc' },
      take: input.limit ?? 60,
      select: {
        user: {
          select: {
            id: true,
            publicHandle: true,
            name: true,
            image: true,
            headline: true,
            deletedAt: true,
            profileAudiences: true,
          },
        },
      },
    });

    const levels = await tx.userXpProfile.findMany({
      where: { tenantId: input.tenantId },
      select: { userId: true, level: true },
    });

    return { memberships, levels };
  });

  const levelByUser = new Map(rows.levels.map((row) => [row.userId, row.level]));

  return rows.memberships
    .filter((row) => row.user?.publicHandle && !row.user.deletedAt)
    .map((row) => {
      const audiences = parseProfileAudiences(row.user!.profileAudiences);

      return {
        username: row.user!.publicHandle!,
        displayName: row.user!.name,
        avatarUrl: row.user!.image,
        headline: row.user!.headline,
        level: levelByUser.get(row.user!.id) ?? 1,
        /** A página existe para quem é da casa se QUALQUER campo não for privado. */
        visible: PUBLIC_PROFILE_FIELDS.some((field) => audiences[field] !== 'PRIVATE'),
      };
    })
    .filter((row) => row.visible)
    .map(({ visible: _visible, ...rest }) => rest);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
function formatWorkload(minutes: number): string {
  if (minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function publicProfilePath(tenantSlug: string, username: string): string {
  return tenantPath(tenantSlug, `/u/${username}`);
}

export function publicProfileUrl(tenantSlug: string, username: string): string {
  return `${publicBaseUrl()}${publicProfilePath(tenantSlug, username)}`;
}

export { DEFAULT_PROFILE_AUDIENCES, MAX_INTERESTS };

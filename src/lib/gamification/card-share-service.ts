/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — compartilhamento de UMA carta (FASE 48)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CAMADA DECIDE (E O QUE ELA NÃO DEIXA A TELA DECIDIR)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. O link é do DONO da carta: toda escrita confere `userCardId + userId` no
 *     banco. O `userCardId` chega da tela e é tratado como palpite.
 *  2. O NOME que aparece no link passa pela régua da FASE 44 (`visibleProfileFields`
 *     para visitante ANÔNIMO + `resolvePublicDisplayName`): quem não publica o nome
 *     aparece como `@handle`, exatamente como no perfil público — e quem não tem
 *     handle aparece com um rótulo neutro, sem inventar identidade.
 *  3. A página pública lê SÓ o que a carta precisa. Não há caminho, aqui, para XP,
 *     álbum, e-mail, outros certificados ou a lista de eventos da pessoa.
 *
 *  A leitura pública NÃO usa a conexão de plataforma: a instituição vem do slug da
 *  URL, então a consulta roda sob `withTenant` e a RLS é quem garante o isolamento
 *  (um token de outra instituição não é encontrado — fail-closed, sem consulta
 *  privilegiada).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { recordAudit } from '@/lib/admin/audit';
import { withTenant } from '@/lib/db/tenant-client';
import { publicBaseUrl } from '@/lib/public-url';
import type { CardArt, CardPalette } from '@/domain/gamification/card-rules';
import { resolveArt, resolvePalette } from '@/domain/gamification/card-rules';
import type { CardStage } from '@/domain/gamification/card-presentation';
import { cardBackContent, resolveCardStage } from '@/domain/gamification/card-presentation';
import type { CardRarity } from '@/domain/gamification/types';
import {
  cardShareUrl,
  isValidShareToken,
  normalizeShareToken,
  shareTextFor,
} from '@/domain/gamification/card-share-rules';
import {
  parseProfileAudiences,
  resolvePublicDisplayName,
  visibleProfileFields,
} from '@/domain/profile/public-profile-rules';
import { createShareToken, hashShareToken, openShareToken, sealShareToken } from './card-share-token';

export type CardShareErrorCode =
  | 'NOT_OWNED'
  | 'NOT_FOUND'
  | 'SEAL_UNAVAILABLE'
  | 'INVALID_TOKEN'
  | 'INTERNAL';

export type CardShareResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: CardShareErrorCode; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rótulo de quem NÃO publica o nome e não tem `@handle`.
 *
 * Só aparece nesse caso: o perfil público exige handle para existir (FASE 44), e
 * sem handle não há identidade pública nenhuma para mostrar. Inventar o nome de
 * cadastro aqui seria publicar justamente o que a pessoa esconderia.
 */
export const NEUTRAL_SHARE_NAME = 'Uma pessoa desta instituição';

/** O que a tela do álbum precisa saber sobre o link desta carta. */
export interface CardShareState {
  userCardId: string;
  linkId: string | null;
  /** Endereço pronto para copiar — `null` quando não há link ativo legível. */
  url: string | null;
  createdAt: Date | null;
  revokedAt: Date | null;
  /** Quantos links já foram criados para esta carta (histórico, inclui revogados). */
  historyCount: number;
  /** **O que o link vai mostrar** — a tela avisa antes de a pessoa enviar. */
  shareDisplayName: string;
  /** Texto que acompanha o link nos canais. */
  shareText: string;
  /** `false` quando a pessoa não publica o nome (a tela explica o rótulo neutro). */
  showsRealName: boolean;
}

export interface SharedCardView {
  cardName: string;
  rarity: CardRarity;
  palette: CardPalette;
  art: CardArt;
  stage: CardStage;
  isFoil: boolean;
  quantity: number;
  level: number;
  grantedAt: Date | null;
  /** Ficha do verso (a mesma que o dono vê). */
  back: ReturnType<typeof cardBackContent>;
  imageUrl: string | null;
  /** Nome público de quem conquistou — já resolvido pela régua da FASE 44. */
  displayName: string;
  /** Foto do perfil, apenas quando o campo "Foto" está público. */
  avatarUrl: string | null;
  sharedAt: Date;
}

/**
 * Nome público do dono, pela régua da FASE 44.
 *
 * A página da carta é lida por visitante ANÔNIMO (o link vai para um grupo), então
 * é essa a régua aplicada — a mesma que a página do perfil usa para quem não está
 * logado. Nome privado ⇒ `@handle`; sem handle ⇒ rótulo neutro.
 */
function resolveShareName(input: {
  name: string | null;
  publicHandle: string | null;
  profileAudiences: unknown;
}): { displayName: string; showsRealName: boolean } {
  const audiences = parseProfileAudiences(input.profileAudiences);
  const visible = new Set(visibleProfileFields({ audiences, viewer: 'ANONYMOUS' }));
  const showsRealName = visible.has('displayName');

  if (showsRealName) {
    return {
      displayName: resolvePublicDisplayName({
        displayName: input.name,
        username: input.publicHandle ?? '',
      }),
      showsRealName: true,
    };
  }

  if (input.publicHandle) {
    return { displayName: `@${input.publicHandle}`, showsRealName: false };
  }

  return { displayName: NEUTRAL_SHARE_NAME, showsRealName: false };
}

/** Campos de `user` que a régua do nome precisa — nada além disso é lido. */
const SHARE_NAME_SELECT = {
  name: true,
  publicHandle: true,
  profileAudiences: true,
} as const;

// ───────────────────────────────────────────────────────────────────────────────
//  Estado do link da carta (dono)
// ───────────────────────────────────────────────────────────────────────────────
export async function getCardShareState(input: {
  tenantId: string;
  userId: string;
  tenantSlug: string;
  tenantName: string;
  userCardId: string;
}): Promise<CardShareResult<{ state: CardShareState }>> {
  try {
    const data = await withTenant(input.tenantId, async (tx) => {
      const card = await tx.userCard.findFirst({
        where: { id: input.userCardId, tenantId: input.tenantId, userId: input.userId },
        select: {
          id: true,
          isFoil: true,
          cardTemplate: { select: { name: true, rarity: true } },
          user: { select: SHARE_NAME_SELECT },
        },
      });

      if (!card) return null;

      const links = await tx.cardShareLink.findMany({
        where: { tenantId: input.tenantId, userId: input.userId, userCardId: input.userCardId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, tokenSealed: true, createdAt: true, revokedAt: true },
      });

      return { card, links };
    });

    if (!data) {
      return { ok: false, code: 'NOT_OWNED', message: 'Esta carta não está no seu álbum.' };
    }

    const active = data.links.find((link) => link.revokedAt === null) ?? null;
    const opened = active ? openShareToken(active.tokenSealed) : null;
    const name = resolveShareName(data.card.user);

    return {
      ok: true,
      state: {
        userCardId: input.userCardId,
        linkId: active?.id ?? null,
        url: opened ? cardShareUrl({ baseUrl: publicBaseUrl(), tenantSlug: input.tenantSlug, token: opened }) : null,
        createdAt: active?.createdAt ?? null,
        revokedAt: active?.revokedAt ?? null,
        historyCount: data.links.length,
        shareDisplayName: name.displayName,
        showsRealName: name.showsRealName,
        shareText: shareTextFor({
          cardName: data.card.cardTemplate?.name ?? 'carta',
          rarity: data.card.cardTemplate?.rarity ?? 'COMMON',
          tenantName: input.tenantName,
          displayName: name.displayName,
        }),
      },
    };
  } catch (error) {
    console.error(`[gamification] falha ao ler o link da carta: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível ler o link desta carta.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criar (ou reaproveitar) o link
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Compartilhar é IDEMPOTENTE: clicar duas vezes devolve o MESMO link.
 *
 * Criar um link novo a cada clique invalidaria, em silêncio, o endereço que a
 * pessoa acabou de colar num grupo — e ninguém descobriria até alguém reclamar que
 * "o link não abre". Para trocar o endereço existe a revogação, que é um ato.
 */
export async function ensureCardShareLink(input: {
  tenantId: string;
  userId: string;
  tenantSlug: string;
  tenantName: string;
  userCardId: string;
}): Promise<CardShareResult<{ state: CardShareState }>> {
  const current = await getCardShareState(input);
  if (!current.ok) return current;

  /** Já existe link ativo e legível: nada a fazer. */
  if (current.state.linkId && current.state.url) return current;

  /**
   * Link ativo cujo selo não abre (segredo da aplicação girado): ele CONTINUA
   * funcionando para quem já tem o endereço — a leitura pública só precisa do
   * hash —, mas o dono não consegue mais exibi-lo. A saída honesta é revogar e
   * emitir outro, e a tela diz que o endereço antigo deixou de valer.
   */
  if (current.state.linkId && !current.state.url) {
    const revoked = await revokeCardShareLink({
      tenantId: input.tenantId,
      userId: input.userId,
      linkId: current.state.linkId,
      reason: 'segredo girado: o link não podia mais ser exibido ao dono',
    });

    if (!revoked.ok) return revoked;
  }

  try {
    const token = createShareToken();
    const sealed = sealShareToken(token);

    if (!sealed) {
      return {
        ok: false,
        code: 'SEAL_UNAVAILABLE',
        message:
          'O servidor não consegue guardar links agora (segredo da aplicação ausente ou curto). O link não foi criado.',
      };
    }

    const created = await withTenant(input.tenantId, async (tx) => {
      const card = await tx.userCard.findFirst({
        where: { id: input.userCardId, tenantId: input.tenantId, userId: input.userId },
        select: { id: true },
      });

      if (!card) return null;

      return tx.cardShareLink.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          userCardId: input.userCardId,
          tokenHash: hashShareToken(token),
          tokenSealed: sealed,
        },
        select: { id: true, createdAt: true },
      });
    });

    if (!created) {
      return { ok: false, code: 'NOT_OWNED', message: 'Esta carta não está no seu álbum.' };
    }

    /**
     * A trilha guarda o ATO, nunca o token. `sanitizeChanges` já bloqueia chaves
     * como `token`, mas nem passar por lá: o que interessa a quem audita é qual
     * carta foi exposta e quando.
     */
    await recordAudit({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'CREATE',
      entityType: 'card_share_link',
      entityId: created.id,
      changes: { userCardId: { from: null, to: input.userCardId } },
    });

    const fresh = await getCardShareState(input);
    if (!fresh.ok) return fresh;

    return fresh;
  } catch (error) {
    console.error(`[gamification] falha ao criar o link da carta: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível criar o link desta carta.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Revogar
// ───────────────────────────────────────────────────────────────────────────────
export async function revokeCardShareLink(input: {
  tenantId: string;
  userId: string;
  linkId: string;
  reason?: string;
}): Promise<CardShareResult<{ revokedAt: Date }>> {
  try {
    const revokedAt = new Date();

    const updated = await withTenant(input.tenantId, (tx) =>
      /**
       * `updateMany` CONDICIONAL: só revoga o que ainda está ativo e é do dono. Um
       * `update` por id devolveria "revogado" para um link de outra pessoa se o id
       * vazasse — aqui, zero linhas é resposta de negócio.
       */
      tx.cardShareLink.updateMany({
        where: {
          id: input.linkId,
          tenantId: input.tenantId,
          userId: input.userId,
          revokedAt: null,
        },
        data: { revokedAt },
      }),
    );

    if (updated.count === 0) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Este link não existe, não é seu ou já foi revogado.',
      };
    }

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'DELETE',
      entityType: 'card_share_link',
      entityId: input.linkId,
      changes: { revokedAt: { from: null, to: revokedAt.toISOString() } },
    });

    return { ok: true, revokedAt };
  } catch (error) {
    console.error(`[gamification] falha ao revogar o link da carta: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível revogar o link.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura PÚBLICA (sem sessão)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A carta de um link, para quem não está logado.
 *
 * Devolve `NOT_FOUND` para token inválido, revogado ou de outra instituição — a
 * mesma resposta nos três casos, de propósito: distinguir "não existe" de "existe
 * mas é de outra instituição" contaria a quem tenta adivinhar que o token acertou
 * alguma coisa.
 */
export async function readSharedCard(input: {
  tenantId: string;
  token: string;
  /** Fuso da instituição (vem do contexto público pelo slug): a data da conquista
   *  é lida no dia de quem a concedeu, e não no fuso do processo. */
  timezone: string;
}): Promise<CardShareResult<{ card: SharedCardView }>> {
  const token = normalizeShareToken(input.token);

  if (!isValidShareToken(token)) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Link não encontrado.' };
  }

  try {
    const row = await withTenant(input.tenantId, (tx) =>
      tx.cardShareLink.findFirst({
        where: { tenantId: input.tenantId, tokenHash: hashShareToken(token), revokedAt: null },
        select: {
          createdAt: true,
          userCard: {
            select: {
              isFoil: true,
              quantity: true,
              level: true,
              grantedAt: true,
              user: {
                select: { ...SHARE_NAME_SELECT, image: true, profileAudiences: true },
              },
              cardTemplate: {
                select: {
                  name: true,
                  rarity: true,
                  palette: true,
                  art: true,
                  description: true,
                  lore: true,
                  trigger: true,
                },
              },
            },
          },
        },
      }),
    );

    if (!row || !row.userCard.cardTemplate) {
      return { ok: false, code: 'NOT_FOUND', message: 'Link não encontrado.' };
    }

    const { userCard } = row;
    const template = userCard.cardTemplate;
    const art = resolveArt(template.art);
    const name = resolveShareName(userCard.user);

    const audiences = parseProfileAudiences(userCard.user.profileAudiences);
    const avatarVisible = visibleProfileFields({ audiences, viewer: 'ANONYMOUS' }).includes('avatar');

    return {
      ok: true,
      card: {
        cardName: template.name,
        rarity: template.rarity,
        palette: resolvePalette(template.palette, template.rarity),
        art,
        stage: resolveCardStage({ art, isFoil: userCard.isFoil, rarity: template.rarity }),
        isFoil: userCard.isFoil,
        quantity: userCard.quantity,
        level: userCard.level,
        grantedAt: userCard.grantedAt,
        back: cardBackContent({
          rarity: template.rarity,
          trigger: template.trigger,
          description: template.description,
          lore: template.lore,
          quantity: userCard.quantity,
          isFoil: userCard.isFoil,
          level: userCard.level,
          grantedAt: userCard.grantedAt,
          timezone: input.timezone,
        }),
        imageUrl: art.imageUrl,
        displayName: name.displayName,
        avatarUrl: avatarVisible ? userCard.user.image : null,
        sharedAt: row.createdAt,
      },
    };
  } catch (error) {
    console.error(`[gamification] falha ao ler a carta compartilhada: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível abrir este link.' };
  }
}

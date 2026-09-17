/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Álbum de cartas
 *
 *  O álbum é a leitura que dá sentido à coleção: mostra o que a pessoa TEM, o
 *  que FALTA (com raridade e silhueta) e quanto do conjunto já foi completado.
 *  Sem os buracos visíveis, colecionar vira só acumular.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  MAX_PINNED_CARDS,
  resolveArt,
  resolvePalette,
  summarizeAlbum,
  type AlbumEntry,
  type AlbumSummary,
  type CardAnimation,
  type CardArt,
  type CardPalette,
  type CardParticle,
} from '@/domain/gamification/card-rules';
import type { CardRarity, CardTrigger } from '@/domain/gamification/types';

export type CardErrorCode = 'NOT_FOUND' | 'NOT_OWNED' | 'PIN_LIMIT' | 'INTERNAL';

export type CardResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: CardErrorCode; message: string };

// ───────────────────────────────────────────────────────────────────────────────
//  Visão da carta
// ───────────────────────────────────────────────────────────────────────────────
export interface CardView {
  templateId: string;
  slug: string;
  name: string;
  description: string | null;
  lore: string | null;
  rarity: CardRarity;
  levelRequired: number;
  palette: CardPalette;
  art: CardArt;
  /** Quantas unidades ainda existem (null = ilimitado). */
  remainingSupply: number | null;
  mintedCount: number;
  isActive: boolean;
  isSecret: boolean;
  trigger: CardTrigger;

  /** Dados da carta no álbum DESTA pessoa. */
  userCardId: string | null;
  owned: boolean;
  quantity: number;
  isFoil: boolean;
  isPinned: boolean;
  animation: CardAnimation;
  particle: CardParticle;
}

export interface AlbumView {
  cards: CardView[];
  summary: AlbumSummary;
  pinned: CardView[];
  /** Cartas recentes, na ordem em que foram obtidas. */
  recent: CardView[];
  /** Cartas secretas ainda não obtidas (não aparecem no álbum, só no aviso). */
  hiddenSecrets: number;
}

/**
 * Álbum completo: catálogo + o que a pessoa possui.
 *
 * Uma única consulta ao catálogo e uma à coleção; a junção acontece em memória.
 * Fazer uma consulta por carta seria N+1 em uma tela que sempre mostra o
 * catálogo inteiro.
 */
export async function getAlbum(tenantId: string, userId: string): Promise<CardResult<AlbumView>> {
  try {
    const data = await withTenant(tenantId, async (tx) => {
      const [templates, owned] = await Promise.all([
        tx.cardTemplate.findMany({
          where: { tenantId, deletedAt: null },
          orderBy: [{ rarity: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            lore: true,
            rarity: true,
            levelRequired: true,
            palette: true,
            art: true,
            maxSupply: true,
            mintedCount: true,
            isActive: true,
            isSecret: true,
            trigger: true,
          },
        }),
        tx.userCard.findMany({
          where: { tenantId, userId },
          select: {
            id: true,
            cardTemplateId: true,
            quantity: true,
            isFoil: true,
            isPinned: true,
            grantedAt: true,
          },
        }),
      ]);

      return { templates, owned };
    });

    /** Agrupa por template, preservando a variante foil como item separado. */
    const ownedByTemplate = new Map<string, typeof data.owned>();
    for (const card of data.owned) {
      const bucket = ownedByTemplate.get(card.cardTemplateId) ?? [];
      bucket.push(card);
      ownedByTemplate.set(card.cardTemplateId, bucket);
    }

    const cards: CardView[] = [];

    for (const template of data.templates) {
      const palette = resolvePalette(template.palette, template.rarity);
      const art = resolveArt(template.art);

      const mine = ownedByTemplate.get(template.id) ?? [];
      const plain = mine.find((card) => !card.isFoil) ?? null;
      const foil = mine.find((card) => card.isFoil) ?? null;
      const main = plain ?? foil;

      /**
       * Carta secreta não obtida fica FORA da listagem: o segredo é o atrativo.
       * Mesmo assim ela é contada em `hiddenSecrets` para que a existência de
       * conteúdo oculto seja honesta.
       */
      if (template.isSecret && !main) continue;

      cards.push({
        templateId: template.id,
        slug: template.slug,
        name: template.name,
        description: template.description,
        lore: template.lore,
        rarity: template.rarity,
        levelRequired: template.levelRequired,
        palette,
        art,
        remainingSupply: template.maxSupply === 0 ? null : Math.max(0, template.maxSupply - template.mintedCount),
        mintedCount: template.mintedCount,
        isActive: template.isActive,
        isSecret: template.isSecret,
        trigger: template.trigger,
        userCardId: main?.id ?? null,
        owned: Boolean(main),
        quantity: (plain?.quantity ?? 0) + (foil?.quantity ?? 0),
        isFoil: Boolean(foil),
        isPinned: mine.some((card) => card.isPinned),
        animation: art.animation,
        particle: art.particle,
      });
    }

    const albumEntries: AlbumEntry[] = cards.map((card) => ({
      templateId: card.templateId,
      slug: card.slug,
      name: card.name,
      rarity: card.rarity,
      owned: card.owned,
      isFoil: card.isFoil,
      quantity: card.quantity,
      level: 1,
      isPinned: card.isPinned,
      secret: card.isSecret,
    }));

    const recent = [...cards]
      .filter((card) => card.owned)
      .sort((a, b) => a.rarity.localeCompare(b.rarity))
      .slice(0, MAX_PINNED_CARDS * 2);

    return {
      ok: true as const,
      cards,
      summary: summarizeAlbum(albumEntries),
      pinned: cards.filter((card) => card.isPinned),
      recent,
      hiddenSecrets: data.templates.filter(
        (template) => template.isSecret && !ownedByTemplate.has(template.id),
      ).length,
    };
  } catch (error) {
    console.error(`[gamification] falha ao carregar álbum: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar o álbum.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Fixar no perfil
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Fixa/desafixa uma carta no perfil público.
 *
 * Duas regras:
 *   • só se fixa carta QUE A PESSOA POSSUI — o contrário seria exibir uma
 *     conquista que não existe;
 *   • no máximo `MAX_PINNED_CARDS` cartas, senão o "destaque" deixa de destacar.
 */
export async function setCardPinned(input: {
  tenantId: string;
  userId: string;
  userCardId: string;
  isPinned: boolean;
}): Promise<CardResult<{ pinnedCount: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const card = await tx.userCard.findFirst({
        where: { id: input.userCardId, tenantId: input.tenantId, userId: input.userId },
        select: { id: true },
      });

      if (!card) {
        return {
          ok: false as const,
          code: 'NOT_OWNED' as const,
          message: 'Esta carta não está no seu álbum.',
        };
      }

      if (input.isPinned) {
        const pinnedCount = await tx.userCard.count({
          where: { tenantId: input.tenantId, userId: input.userId, isPinned: true },
        });

        if (pinnedCount >= MAX_PINNED_CARDS) {
          return {
            ok: false as const,
            code: 'PIN_LIMIT' as const,
            message: `Você já destacou ${MAX_PINNED_CARDS} cartas. Desafixe uma para destacar outra.`,
          };
        }
      }

      await tx.userCard.update({
        where: { id: card.id },
        data: { isPinned: input.isPinned },
      });

      const pinnedCount = await tx.userCard.count({
        where: { tenantId: input.tenantId, userId: input.userId, isPinned: true },
      });

      return { ok: true as const, pinnedCount };
    });
  } catch (error) {
    console.error(`[gamification] falha ao fixar carta: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível alterar o destaque.' };
  }
}

/** Cartas fixadas de um participante — usado no perfil público (FASE 7). */
export async function getPinnedCards(
  tenantId: string,
  userId: string,
): Promise<CardResult<{ cards: CardView[] }>> {
  const album = await getAlbum(tenantId, userId);
  if (!album.ok) return album;
  return { ok: true as const, cards: album.pinned };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Perfil de XP, extrato e ranking
 *
 *  Toda leitura passa por `withTenant`, portanto roda com a role de runtime sob
 *  RLS: um ranking nunca mistura instituições, mesmo que a consulta esqueça o
 *  filtro (a policy é a última linha de defesa, não a única).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  XP_SOURCE_LABELS,
  resolveXpProgress,
  type XpProgress,
} from '@/domain/gamification/xp-rules';
import type { TaskProgressStatus, XpSourceKind } from '@/domain/gamification/types';
import { awardForEvent, rewardKeys, type RewardOutcome } from '@/lib/gamification/reward-engine';

export type XpErrorCode = 'NOT_FOUND' | 'INTERNAL';

export type XpResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: XpErrorCode; message: string };

// ───────────────────────────────────────────────────────────────────────────────
//  Perfil
// ───────────────────────────────────────────────────────────────────────────────
export interface XpProfileView {
  userId: string;
  progress: XpProgress;
  seasonXp: number;
  seasonKey: string | null;
  currentStreak: number;
  longestStreak: number;
  lastActivityAt: Date | null;
  cardsCollected: number;
  tasksCompleted: number;
  equippedFrame: string | null;
  equippedTitle: string | null;
  equippedBadge: string | null;
  /** Posição no ranking da instituição (1 = primeiro). `null` sem XP. */
  rank: number | null;
  /** Total de participantes com XP na instituição. */
  rankedCount: number;
  /** Missões concluídas e ainda não resgatadas. */
  claimableTasks: number;
}

/** Perfil de gamificação, com tudo o que a tela precisa em uma ida ao banco. */
export async function getXpProfile(
  tenantId: string,
  userId: string,
): Promise<XpResult<{ profile: XpProfileView }>> {
  try {
    const data = await withTenant(tenantId, async (tx) => {
      const profile = await tx.userXpProfile.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: {
          totalXp: true,
          seasonXp: true,
          seasonKey: true,
          level: true,
          prestigeLevel: true,
          currentStreak: true,
          longestStreak: true,
          lastActivityAt: true,
          cardsCollected: true,
          tasksCompleted: true,
          equippedFrame: true,
          equippedTitle: true,
          equippedBadge: true,
        },
      });

      /**
       * Posição no ranking calculada por contagem, e não por `findMany` de todos
       * os perfis: com milhares de participantes, trazer a lista inteira para
       * descobrir um número seria desperdício.
       */
      const totalXp = profile?.totalXp ?? 0;
      const [ahead, rankedCount, claimableTasks] = await Promise.all([
        totalXp > 0
          ? tx.userXpProfile.count({ where: { tenantId, totalXp: { gt: totalXp } } })
          : Promise.resolve(0),
        tx.userXpProfile.count({ where: { tenantId, totalXp: { gt: 0 } } }),
        tx.userTaskProgress.count({ where: { tenantId, userId, status: 'COMPLETED' } }),
      ]);

      return { profile, totalXp, ahead, rankedCount, claimableTasks };
    });

    const progress = resolveXpProgress(data.totalXp);

    return {
      ok: true as const,
      profile: {
        userId,
        progress,
        seasonXp: data.profile?.seasonXp ?? 0,
        seasonKey: data.profile?.seasonKey ?? null,
        currentStreak: data.profile?.currentStreak ?? 0,
        longestStreak: data.profile?.longestStreak ?? 0,
        lastActivityAt: data.profile?.lastActivityAt ?? null,
        cardsCollected: data.profile?.cardsCollected ?? 0,
        tasksCompleted: data.profile?.tasksCompleted ?? 0,
        equippedFrame: data.profile?.equippedFrame ?? null,
        equippedTitle: data.profile?.equippedTitle ?? null,
        equippedBadge: data.profile?.equippedBadge ?? null,
        rank: data.totalXp > 0 ? data.ahead + 1 : null,
        rankedCount: data.rankedCount,
        claimableTasks: data.claimableTasks,
      },
    };
  } catch (error) {
    console.error(`[gamification] falha ao ler perfil de XP: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar seu perfil.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Extrato
// ───────────────────────────────────────────────────────────────────────────────
export interface XpEntry {
  id: string;
  amount: number;
  source: XpSourceKind;
  sourceLabel: string;
  reason: string | null;
  balanceAfter: number | null;
  createdAt: Date;
}

/**
 * Extrato de XP.
 *
 * O extrato existe porque gamificação sem transparência vira desconfiança: se o
 * participante não consegue ver DE ONDE veio cada ponto, ele presume erro.
 */
export async function listXpHistory(
  tenantId: string,
  userId: string,
  limit = 25,
): Promise<XpResult<{ entries: XpEntry[] }>> {
  try {
    const rows = await withTenant(tenantId, (tx) =>
      tx.xpTransaction.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(1, limit), 100),
        select: {
          id: true,
          amount: true,
          source: true,
          reason: true,
          balanceAfter: true,
          createdAt: true,
        },
      }),
    );

    return {
      ok: true as const,
      entries: rows.map((row) => ({
        id: row.id,
        amount: row.amount,
        source: row.source,
        sourceLabel: XP_SOURCE_LABELS[row.source] ?? row.source,
        reason: row.reason,
        balanceAfter: row.balanceAfter,
        createdAt: row.createdAt,
      })),
    };
  } catch (error) {
    console.error(`[gamification] falha ao ler extrato: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar o extrato.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ranking
// ───────────────────────────────────────────────────────────────────────────────
export interface LeaderboardEntry {
  position: number;
  userId: string;
  name: string;
  publicHandle: string | null;
  image: string | null;
  totalXp: number;
  level: number;
  prestigeLevel: number;
  title: string;
  cardsCollected: number;
  isCurrentUser: boolean;
}

/**
 * Ranking da instituição.
 *
 * Expõe nome, identificador público, nível e XP — nada de e-mail ou dado de
 * contato. O ranking é visível a membros da instituição justamente porque é
 * feito de informação que a pessoa já publica no próprio perfil; usar dado
 * privado aqui seria vazamento com aparência de funcionalidade.
 */
export async function getLeaderboard(
  tenantId: string,
  options: { limit?: number; currentUserId?: string } = {},
): Promise<XpResult<{ entries: LeaderboardEntry[] }>> {
  try {
    const limit = Math.min(Math.max(1, options.limit ?? 10), 100);

    const rows = await withTenant(tenantId, (tx) =>
      tx.userXpProfile.findMany({
        where: { tenantId, totalXp: { gt: 0 } },
        orderBy: [{ totalXp: 'desc' }, { userId: 'asc' }],
        take: limit,
        select: {
          userId: true,
          totalXp: true,
          level: true,
          prestigeLevel: true,
          cardsCollected: true,
          user: { select: { name: true, publicHandle: true, image: true } },
        },
      }),
    );

    return {
      ok: true as const,
      entries: rows.map((row, index) => ({
        position: index + 1,
        userId: row.userId,
        name: row.user?.name ?? 'Participante',
        publicHandle: row.user?.publicHandle ?? null,
        image: row.user?.image ?? null,
        totalXp: row.totalXp,
        level: row.level,
        prestigeLevel: row.prestigeLevel,
        title: resolveXpProgress(row.totalXp).title,
        cardsCollected: row.cardsCollected,
        isCurrentUser: row.userId === options.currentUserId,
      })),
    };
  } catch (error) {
    console.error(`[gamification] falha ao ler ranking: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar o ranking.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ajuste administrativo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Ajuste manual de XP (crédito ou estorno).
 *
 * `amount` pode ser negativo de propósito: fraude descoberta depois precisa ter
 * consequência, e o nível é derivado do saldo — o estorno derruba o nível
 * automaticamente. Cada chamada é um FATO NOVO e ganha chave própria; ajustes
 * nunca são idempotentes entre si (dois créditos iguais são dois créditos).
 */
export async function adjustXp(input: {
  tenantId: string;
  userId: string;
  amount: number;
  reason: string;
  actorId: string;
}): Promise<XpResult<{ outcome: RewardOutcome }>> {
  const result = await awardForEvent({
    tenantId: input.tenantId,
    userId: input.userId,
    source: 'ADMIN_ADJUSTMENT',
    amount: input.amount,
    reason: input.reason,
    createdById: input.actorId,
    idempotencyKey: rewardKeys.manual(input.tenantId, input.userId),
  });

  if (!result.ok) {
    return { ok: false as const, code: 'INTERNAL', message: result.message };
  }

  return { ok: true as const, outcome: result };
}

/** Contagem de missões por status — usada no resumo do painel. */
export async function countTasksByStatus(
  tenantId: string,
  userId: string,
): Promise<Record<TaskProgressStatus, number>> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.userTaskProgress.groupBy({
      by: ['status'],
      where: { tenantId, userId },
      _count: { _all: true },
    }),
  );

  const counts: Record<TaskProgressStatus, number> = {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    CLAIMED: 0,
    EXPIRED: 0,
  };

  for (const row of rows) {
    counts[row.status] = row._count._all;
  }

  return counts;
}

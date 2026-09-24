/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Motor de recompensas
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM EVENTO DO MUNDO REAL, UMA TRANSAÇÃO, TRÊS EFEITOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `awardForEvent` recebe um fato ("a pessoa fez check-in", "o parecer foi
 *  entregue") e aplica, NA MESMA TRANSAÇÃO:
 *
 *      1. XP      — lançamento no livro-razão + recálculo do perfil
 *      2. CARTAS  — no máximo UMA carta, se houver gatilho correspondente
 *      3. MISSÕES — avanço do progresso das metas afetadas
 *
 *  Separar isso em três operações produziria estados impossíveis: participante
 *  com a carta e sem o XP, ou com a missão completa e sem o lançamento que a
 *  completou. Um fato do mundo tem UM efeito contábil.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A IDEMPOTÊNCIA É A GARANTIA PRINCIPAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `XpTransaction.idempotencyKey` é UNIQUE. Todo chamador passa uma chave
 *  derivada do FATO (não do momento): `checkin:<tenant>:<registration>`,
 *  `review:<tenant>:<review>`. Reexecutar a ação — retry de rede, duplo clique,
 *  job repetido — não credita duas vezes.
 *
 *  A consulta prévia de duplicidade é só o caminho rápido. A garantia é o índice
 *  único: sob concorrência, quem perde a corrida recebe P2002, a transação
 *  inteira é desfeita (inclusive o incremento do perfil) e a resposta é
 *  "já creditado".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RECOMPENSA NUNCA DERRUBA O FLUXO PRINCIPAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nada aqui lança: tudo devolve `Result`. Quem chama a partir de um fluxo
 *  acadêmico (submeter trabalho, enviar parecer) trata a falha como não-fatal.
 *  Gamificação é acessória; a submissão não é.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation } from '@/lib/db/prisma-errors';
import { type CardRarity, type CardTrigger, type XpSourceKind, cardTriggerLabel } from '@/domain/gamification/types';
import { notifyCardGranted } from '@/lib/communication/notification-service';
import {
  XP_SOURCES,
  applyStreak,
  resolveXpProgress,
  seasonKey,
  streakBonusXp,
} from '@/domain/gamification/xp-rules';
import {
  cardTriggerForSource,
  pickCard,
  shouldBeFoil,
  type CardCandidate,
} from '@/domain/gamification/card-rules';
import {
  advanceProgress,
  isTaskWindowOpen,
  parseTaskTarget,
  taskPeriodKey,
  type ProgressState,
  type TaskTarget,
} from '@/domain/gamification/task-rules';
import { secureRandom } from '@/lib/gamification/random';

/** Teto de segurança para um único lançamento (pega erro de unidade). */
export const MAX_XP_PER_EVENT = 100_000;

export type RewardErrorCode = 'INVALID_AMOUNT' | 'INTERNAL';

export class RewardError extends Error {
  constructor(
    readonly code: RewardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RewardError';
  }
}

export type RewardResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: RewardErrorCode; message: string };

// ───────────────────────────────────────────────────────────────────────────────
//  Entrada
// ───────────────────────────────────────────────────────────────────────────────
export interface RewardEventInput {
  tenantId: string;
  userId: string;
  source: XpSourceKind;

  /**
   * Chave derivada do FATO. Repetir a mesma chave nunca credita duas vezes.
   * Deve incluir o tenant: o índice único é global.
   */
  idempotencyKey: string;

  /** Valor explícito. Obrigatório em `BONUS` e `ADMIN_ADJUSTMENT`. */
  amount?: number;
  reason?: string;

  eventId?: string | null;
  activityId?: string | null;
  submissionId?: string | null;
  reviewId?: string | null;
  registrationId?: string | null;

  /** Contexto usado pelos filtros de missão. */
  activityType?: string | null;
  trackId?: string | null;
  minutes?: number | null;

  createdById?: string | null;
  occurredAt?: Date;

  /**
   * Fonte de aleatoriedade do sorteio de cartas. Injetável para que os testes
   * sejam determinísticos — em produção usa `secureRandom`.
   */
  random?: () => number;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Saída
// ───────────────────────────────────────────────────────────────────────────────
export interface GrantedCard {
  templateId: string;
  slug: string;
  name: string;
  rarity: CardRarity;
  isFoil: boolean;
  /** `true` quando a carta é nova no álbum; `false` quando virou duplicata. */
  isNew: boolean;
  quantity: number;
  trigger: CardTrigger;
}

export interface MissionUpdate {
  taskDefinitionId: string;
  slug: string;
  name: string;
  progress: number;
  target: number;
  status: ProgressState['status'];
  completed: boolean;
  xpReward: number;
}

export interface RewardOutcome {
  /** O fato já havia sido creditado: nada mudou. */
  duplicate: boolean;
  xpAwarded: number;
  totalXp: number;
  levelBefore: number;
  levelAfter: number;
  prestigeBefore: number;
  prestigeAfter: number;
  leveledUp: boolean;
  prestiged: boolean;
  currentStreak: number;
  longestStreak: number;
  cards: GrantedCard[];
  missions: MissionUpdate[];
}

function emptyOutcome(overrides: Partial<RewardOutcome> = {}): RewardOutcome {
  return {
    duplicate: true,
    xpAwarded: 0,
    totalXp: 0,
    levelBefore: 1,
    levelAfter: 1,
    prestigeBefore: 0,
    prestigeAfter: 0,
    leveledUp: false,
    prestiged: false,
    currentStreak: 0,
    longestStreak: 0,
    cards: [],
    missions: [],
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Motor
// ───────────────────────────────────────────────────────────────────────────────
export async function awardForEvent(input: RewardEventInput): Promise<RewardResult<RewardOutcome>> {
  try {
    const amount = resolveAmount(input);
    const now = input.occurredAt ?? new Date();
    const random = input.random ?? secureRandom;

    return await withTenant(input.tenantId, async (tx) => {
      // ── Caminho rápido de idempotência ──────────────────────────────────────
      const existing = await tx.xpTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });

      if (existing) {
        const profile = await tx.userXpProfile.findUnique({
          where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
          select: {
            totalXp: true,
            level: true,
            prestigeLevel: true,
            currentStreak: true,
            longestStreak: true,
          },
        });

        return {
          ok: true as const,
          ...emptyOutcome({
            totalXp: profile?.totalXp ?? 0,
            levelBefore: profile?.level ?? 1,
            levelAfter: profile?.level ?? 1,
            prestigeBefore: profile?.prestigeLevel ?? 0,
            prestigeAfter: profile?.prestigeLevel ?? 0,
            currentStreak: profile?.currentStreak ?? 0,
            longestStreak: profile?.longestStreak ?? 0,
          }),
        };
      }

      const timezone = await loadTenantTimezone(tx, input.tenantId);

      const profile = await tx.userXpProfile.findUnique({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        select: {
          id: true,
          totalXp: true,
          seasonXp: true,
          seasonKey: true,
          currentStreak: true,
          longestStreak: true,
          lastActivityAt: true,
        },
      });

      // ── Ofensiva e bônus ────────────────────────────────────────────────────
      const streak = applyStreak({
        currentStreak: profile?.currentStreak ?? 0,
        longestStreak: profile?.longestStreak ?? 0,
        lastActivityAt: profile?.lastActivityAt ?? null,
        now,
        timeZone: timezone,
      });

      // O bônus só entra em dia NOVO: várias ações no mesmo dia não multiplicam XP.
      const bonus = streak.isNewDay ? streakBonusXp(streak.currentStreak) : 0;
      const credited = amount + bonus;

      const totalBefore = profile?.totalXp ?? 0;
      const progressBefore = resolveXpProgress(totalBefore);
      const totalAfter = totalBefore + credited;
      const progressAfter = resolveXpProgress(totalAfter);

      // ── 1. Livro-razão (append-only) ────────────────────────────────────────
      await tx.xpTransaction.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          userId: input.userId,
          eventId: input.eventId ?? null,
          amount: credited,
          source: input.source,
          reason: buildReason(input, amount, bonus, streak.currentStreak),
          activityId: input.activityId ?? null,
          submissionId: input.submissionId ?? null,
          reviewId: input.reviewId ?? null,
          registrationId: input.registrationId ?? null,
          balanceAfter: totalAfter,
          idempotencyKey: input.idempotencyKey,
          createdById: input.createdById ?? null,
          createdAt: now,
        },
      });

      // ── 2. Perfil: incremento atômico + campos derivados ────────────────────
      const season = seasonKey(now, timezone);
      const seasonRolled = profile?.seasonKey !== season;

      const derived = {
        seasonKey: season,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        lastActivityAt: now,
        level: progressAfter.level,
        prestigeLevel: progressAfter.prestigeLevel,
      };

      /**
       * `increment` é resolvido pelo BANCO: dois créditos simultâneos não se
       * perdem (um read-modify-write perderia um deles). Nível e prestígio são
       * gravados a partir do total JÁ SOMADO e reconferidos logo abaixo.
       */
      const savedProfile = profile
        ? await tx.userXpProfile.update({
            where: { id: profile.id },
            data: {
              totalXp: { increment: credited },
              // Virada de temporada zera o acumulado do trimestre.
              seasonXp: seasonRolled ? credited : { increment: credited },
              ...derived,
            },
            select: { id: true, totalXp: true, level: true, prestigeLevel: true },
          })
        : await tx.userXpProfile.create({
            data: {
              id: randomUUID(),
              tenantId: input.tenantId,
              userId: input.userId,
              totalXp: credited,
              seasonXp: credited,
              ...derived,
            },
            select: { id: true, totalXp: true, level: true, prestigeLevel: true },
          });

      /**
       * Segundo ajuste: se OUTRA transação creditou entre a leitura e a escrita,
       * o incremento somou os dois e o nível persistido precisa refletir o total
       * real. Aqui o perfil converge para a função pura do saldo.
       */
      const finalProgress = resolveXpProgress(savedProfile.totalXp);
      if (
        finalProgress.level !== savedProfile.level ||
        finalProgress.prestigeLevel !== savedProfile.prestigeLevel
      ) {
        await tx.userXpProfile.update({
          where: { id: savedProfile.id },
          data: { level: finalProgress.level, prestigeLevel: finalProgress.prestigeLevel },
        });
      }

      // ── 3. Cartas ───────────────────────────────────────────────────────────
      const cards = await grantCardsForEvent(tx, {
        input,
        random,
        now,
        eventId: input.eventId ?? null,
        totalBefore,
        totalAfter,
        levelAfter: finalProgress.level,
        prestigeAfter: finalProgress.prestigeLevel,
        streakBefore: profile?.currentStreak ?? 0,
        streakAfter: streak.currentStreak,
        leveledUp: finalProgress.level > progressBefore.level,
        prestiged: finalProgress.prestigeLevel > progressBefore.prestigeLevel,
      });

      // ── 4. Missões ──────────────────────────────────────────────────────────
      const missions = await advanceMissions(tx, {
        tenantId: input.tenantId,
        userId: input.userId,
        source: input.source,
        eventId: input.eventId ?? null,
        activityType: input.activityType ?? null,
        trackId: input.trackId ?? null,
        minutes: input.minutes ?? null,
        now,
        timezone,
      });

      return {
        ok: true as const,
        duplicate: false,
        xpAwarded: credited,
        totalXp: savedProfile.totalXp,
        levelBefore: progressBefore.level,
        levelAfter: finalProgress.level,
        prestigeBefore: progressBefore.prestigeLevel,
        prestigeAfter: finalProgress.prestigeLevel,
        leveledUp: finalProgress.level > progressBefore.level,
        prestiged: finalProgress.prestigeLevel > progressBefore.prestigeLevel,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        cards,
        missions,
      };
    });
  } catch (error) {
    /**
     * Corrida de idempotência: outra transação lançou a MESMA chave primeiro.
     * Nada foi aplicado (a transação inteira foi desfeita), então o resultado
     * correto é "já creditado" — não erro.
     */
    if (isUniqueViolation(error)) {
      return { ok: true as const, ...emptyOutcome() };
    }

    if (error instanceof RewardError) {
      return { ok: false as const, code: error.code, message: error.message };
    }

    console.error(`[gamification] falha ao creditar recompensa: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL' as const,
      message: 'Não foi possível registrar a recompensa.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Valor
// ───────────────────────────────────────────────────────────────────────────────
function resolveAmount(input: RewardEventInput): number {
  const explicit = input.amount;

  if (input.source === 'BONUS' || input.source === 'ADMIN_ADJUSTMENT') {
    if (explicit === undefined) {
      throw new RewardError('INVALID_AMOUNT', `A origem ${input.source} exige \`amount\` explícito.`);
    }
    if (explicit === 0) {
      // Ajuste de zero é engano de quem chamou, não fato do mundo.
      throw new RewardError('INVALID_AMOUNT', 'Ajuste de XP não pode ser zero.');
    }
  }

  const amount = explicit ?? XP_SOURCES[input.source] ?? 0;

  if (!Number.isInteger(amount)) {
    throw new RewardError('INVALID_AMOUNT', 'O XP deve ser um número inteiro.');
  }

  if (Math.abs(amount) > MAX_XP_PER_EVENT) {
    // Erro de unidade (segundos em vez de minutos) não pode passar silencioso.
    throw new RewardError(
      'INVALID_AMOUNT',
      `Valor de XP fora do limite de ${MAX_XP_PER_EVENT} por evento.`,
    );
  }

  return amount;
}

function buildReason(
  input: RewardEventInput,
  amount: number,
  bonus: number,
  streak: number,
): string {
  const parts: string[] = [input.reason?.trim() || `Crédito por ${input.source}`];

  if (amount !== 0) parts.push(`${amount} XP`);
  if (bonus > 0) parts.push(`+${bonus} XP de ofensiva (${streak} dia(s))`);

  return parts.join(' · ').slice(0, 300);
}

async function loadTenantTimezone(tx: TxClient, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true },
  });

  return tenant?.timezone ?? 'UTC';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cartas
// ───────────────────────────────────────────────────────────────────────────────
interface CardGrantContext {
  input: RewardEventInput;
  random: () => number;
  now: Date;
  eventId: string | null;
  totalBefore: number;
  totalAfter: number;
  levelAfter: number;
  prestigeAfter: number;
  streakBefore: number;
  streakAfter: number;
  leveledUp: boolean;
  prestiged: boolean;
}

/**
 * Distribui NO MÁXIMO UMA carta por evento.
 *
 * Mais de uma carta por fato transformaria conquista em avalanche e diluiria o
 * valor da rara. A ordem privilegia o gatilho ESPECÍFICO do fato; os gatilhos de
 * marco (nível, ofensiva, limiar de XP) só entram se o específico não produziu
 * nada.
 */
async function grantCardsForEvent(
  tx: TxClient,
  context: CardGrantContext,
): Promise<GrantedCard[]> {
  for (const trigger of collectTriggersForEvent(context)) {
    const granted = await tryGrantCard(tx, context, trigger);
    if (granted) return [granted];
  }

  return [];
}

function collectTriggersForEvent(context: CardGrantContext): CardTrigger[] {
  const triggers: CardTrigger[] = [];

  const specific = cardTriggerForSource(context.input.source);
  if (specific) triggers.push(specific);

  if (context.leveledUp || context.prestiged) triggers.push('LEVEL_UP');
  if (context.streakAfter > context.streakBefore) triggers.push('STREAK');

  // Limiar é o último recurso: é o gatilho menos específico dos três.
  triggers.push('XP_THRESHOLD');

  return [...new Set(triggers)];
}

async function tryGrantCard(
  tx: TxClient,
  context: CardGrantContext,
  trigger: CardTrigger,
): Promise<GrantedCard | null> {
  const candidates = await loadCandidates(tx, {
    tenantId: context.input.tenantId,
    trigger,
    eventId: context.eventId,
  });

  const eligible = candidates.filter((template) =>
    matchesTriggerCondition(template.triggerCondition, trigger, context),
  );

  if (eligible.length === 0) return null;

  return mintFromPool(tx, context, eligible, trigger);
}

/**
 * Concede cartas de um gatilho SEM creditar XP.
 *
 * Usado por caminhos que não são um fato de XP: brinde manual do organizador,
 * recompensa de missão já resgatada e "presença em todo o evento". Ficaria
 * estranho criar um lançamento de XP de valor zero só para reusar o motor — e o
 * livro-razão ficaria poluído com linhas que não movimentam saldo.
 *
 * `templateId` força uma carta específica (brinde escolhido a dedo); sem ele, o
 * sorteio normal acontece entre as candidatas do gatilho.
 */
export async function grantCardForTrigger(input: {
  tenantId: string;
  userId: string;
  trigger: CardTrigger;
  templateId?: string;
  eventId?: string | null;
  sourceRef?: string | null;
  actorId?: string | null;
  now?: Date;
  random?: () => number;
}): Promise<RewardResult<{ cards: GrantedCard[] }>> {
  try {
    const now = input.now ?? new Date();
    const random = input.random ?? secureRandom;

    const granted = await withTenant(input.tenantId, async (tx) => {
      const profile = await tx.userXpProfile.findUnique({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        select: { totalXp: true },
      });

      const context: CardGrantContext = {
        input: {
          tenantId: input.tenantId,
          userId: input.userId,
          source: 'BONUS',
          idempotencyKey: `card-only:${input.tenantId}:${input.userId}:${randomUUID()}`,
          eventId: input.eventId ?? null,
          createdById: input.actorId ?? null,
        },
        random,
        now,
        eventId: input.eventId ?? null,
        totalBefore: profile?.totalXp ?? 0,
        totalAfter: profile?.totalXp ?? 0,
        levelAfter: resolveXpProgress(profile?.totalXp ?? 0).level,
        prestigeAfter: resolveXpProgress(profile?.totalXp ?? 0).prestigeLevel,
        streakBefore: 0,
        streakAfter: 0,
        leveledUp: false,
        prestiged: false,
      };

      const candidates = await loadCandidates(tx, {
        tenantId: input.tenantId,
        trigger: input.trigger,
        eventId: input.eventId ?? null,
        templateId: input.templateId,
      });

      if (candidates.length === 0) {
        return { ok: true as const, cards: [] };
      }

      const minted = await mintFromPool(tx, context, candidates, input.trigger, input.sourceRef ?? null);
      return { ok: true as const, cards: minted ? [minted] : [] };
    });

    /**
     * Celebração por e-mail (D5), DEPOIS do commit e sem poder falhar — a carta já é
     * da pessoa. O aviso é por gatilho + evento, então reavaliar a mesma conquista não
     * manda uma segunda mensagem (a concessão já é idempotente; o aviso também é).
     *
     * `isNew` filtra a DUPLICATA: sortear de novo a carta que já está no álbum aumenta
     * a quantidade e não é conquista — anunciar "você conquistou" seria mentira.
     */
    if (granted.ok && granted.cards.length > 0 && granted.cards[0]?.isNew) {
      const card = granted.cards[0];

      await notifyCardGranted({
        tenantId: input.tenantId,
        userId: input.userId,
        cardName: card.name,
        rarity: card.rarity,
        triggerLabel: cardTriggerLabel(input.trigger),
        eventId: input.eventId ?? null,
        actorId: input.actorId ?? null,
      });
    }

    return granted;
  } catch (error) {
    console.error(`[gamification] falha ao conceder carta: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL' as const,
      message: 'Não foi possível conceder a carta.',
    };
  }
}

interface LoadCandidatesInput {
  tenantId: string;
  trigger: CardTrigger;
  eventId: string | null;
  templateId?: string;
}

async function loadCandidates(tx: TxClient, input: LoadCandidatesInput) {
  return tx.cardTemplate.findMany({
    where: {
      tenantId: input.tenantId,
      trigger: input.trigger,
      isActive: true,
      deletedAt: null,
      ...(input.templateId ? { id: input.templateId } : {}),
      /**
       * Carta de OUTRO evento não pode cair aqui; carta sem evento
       * (`eventId = null`) é do tenant inteiro e vale em qualquer evento.
       */
      ...(input.eventId ? { OR: [{ eventId: input.eventId }, { eventId: null }] } : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      rarity: true,
      levelRequired: true,
      dropWeight: true,
      maxSupply: true,
      mintedCount: true,
      availableUntil: true,
      isActive: true,
      triggerCondition: true,
    },
  });
}

/**
 * Sorteia e registra UMA carta do conjunto informado.
 *
 * Até três tentativas: a carta sorteada pode esgotar a tiragem entre a leitura e
 * a reserva (outra pessoa pegou a última unidade). Nesse caso tentamos outra
 * carta em vez de perder a recompensa inteira.
 */
async function mintFromPool(
  tx: TxClient,
  context: CardGrantContext,
  candidates: readonly CardCandidate[],
  trigger: CardTrigger,
  sourceRefOverride: string | null = null,
): Promise<GrantedCard | null> {
  const pool = [...candidates];

  for (let attempt = 0; attempt < 3 && pool.length > 0; attempt += 1) {
    const picked = pickCard(pool, {
      random: context.random,
      userLevel: context.levelAfter,
      now: context.now,
    });
    if (!picked) return null;

    const isFoil = shouldBeFoil(picked.rarity, context.random());
    const minted = await mintCard(tx, context, picked, isFoil, trigger, sourceRefOverride);

    if (minted) return minted;

    // Tiragem esgotada na corrida: sai do páreo e tenta outra.
    const index = pool.findIndex((entry) => entry.id === picked.id);
    if (index >= 0) pool.splice(index, 1);
  }

  return null;
}

/**
 * Condições extras do gatilho, lidas de `CardTemplate.triggerCondition`.
 *
 * Os gatilhos de LIMIAR só disparam quando o limite é CRUZADO por este evento
 * (`antes < limite ≤ depois`). Sem isso, toda ação posterior ao limite tentaria
 * sortear a carta de novo — e o participante farmaria cópias infinitas da mesma
 * carta apenas continuando a usar a plataforma.
 */
function matchesTriggerCondition(
  raw: unknown,
  trigger: CardTrigger,
  context: CardGrantContext,
): boolean {
  const condition = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  if (trigger === 'LEVEL_UP') {
    const level = toNumber(condition.level);
    if (!context.leveledUp && !context.prestiged) return false;
    if (level === null) return true;
    return context.levelAfter >= level;
  }

  if (trigger === 'XP_THRESHOLD') {
    const threshold = toNumber(condition.threshold);
    // Sem limiar, o gatilho não tem significado: não vale liberar uma carta rara
    // a cada ação.
    if (threshold === null) return false;
    return context.totalBefore < threshold && context.totalAfter >= threshold;
  }

  if (trigger === 'STREAK') {
    const streak = toNumber(condition.streak);
    if (streak === null) return false;
    return context.streakBefore < streak && context.streakAfter >= streak;
  }

  return true;
}

function toNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Reserva a tiragem e registra a carta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SQL CRU EM VEZ DE `upsert`
 * ─────────────────────────────────────────────────────────────────────────────
 *  A operação é "reservar escassez + registrar carta" e precisa ser à prova de
 *  corrida SEM NUNCA abortar a transação:
 *
 *   • `UPDATE ... WHERE (maxSupply = 0 OR mintedCount < maxSupply)` decide a
 *     escassez NO BANCO. Devolver 0 linhas É a resposta "tiragem esgotada".
 *
 *   • `INSERT ... ON CONFLICT (chave única) DO UPDATE SET quantity = quantity + 1`
 *     transforma duplicata em pilha de cópias de forma atômica. O `upsert` do
 *     Prisma pode cair em find-then-create; nesse caso uma corrida levantaria
 *     P2002 e derrubaria a transação INTEIRA — junto com o crédito de XP.
 */
async function mintCard(
  tx: TxClient,
  context: CardGrantContext,
  candidate: CardCandidate,
  isFoil: boolean,
  trigger: CardTrigger,
  sourceRefOverride: string | null = null,
): Promise<GrantedCard | null> {
  const reserved = await tx.$executeRaw`
    UPDATE "card_templates"
       SET "mintedCount" = "mintedCount" + 1
     WHERE "id" = ${candidate.id}::uuid
       AND "isActive" = true
       AND ("maxSupply" = 0 OR "mintedCount" < "maxSupply")
  `;

  if (reserved === 0) return null;

  const rows = await tx.$queryRaw<{ quantity: number; isNew: boolean }[]>`
    INSERT INTO "user_cards" (
      "id", "tenantId", "userId", "cardTemplateId", "eventId",
      "level", "quantity", "isPinned", "isFoil",
      "source", "sourceRef", "grantedById", "grantedAt", "createdAt", "updatedAt"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${context.input.tenantId}::uuid,
      ${context.input.userId}::uuid,
      ${candidate.id}::uuid,
      ${context.eventId}::uuid,
      1, 1, false, ${isFoil},
      ${trigger}::"CardTrigger",
      ${sourceRefOverride ?? buildSourceRef(context.input)},
      ${context.input.createdById ?? null}::uuid,
      ${context.now}, ${context.now}, ${context.now}
    )
    ON CONFLICT ("tenantId", "userId", "cardTemplateId", "isFoil")
    DO UPDATE SET
      "quantity" = "user_cards"."quantity" + 1,
      "updatedAt" = ${context.now}
    RETURNING "quantity", ("quantity" = 1) AS "isNew"
  `;

  const row = rows[0];
  if (!row) return null;

  // Contador denormalizado: nº de cartas DISTINTAS no álbum.
  if (row.isNew) {
    await tx.userXpProfile.updateMany({
      where: { tenantId: context.input.tenantId, userId: context.input.userId },
      data: { cardsCollected: { increment: 1 } },
    });
  }

  return {
    templateId: candidate.id,
    slug: candidate.slug,
    name: candidate.name,
    rarity: candidate.rarity,
    isFoil,
    isNew: row.isNew,
    quantity: Number(row.quantity),
    trigger,
  };
}

function buildSourceRef(input: RewardEventInput): string | null {
  const ref =
    input.activityId ?? input.submissionId ?? input.reviewId ?? input.registrationId ?? null;

  return ref ? ref.slice(0, 120) : null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Missões
// ───────────────────────────────────────────────────────────────────────────────
interface MissionContext {
  tenantId: string;
  userId: string;
  source: XpSourceKind;
  eventId: string | null;
  activityType: string | null;
  trackId: string | null;
  minutes: number | null;
  now: Date;
  timezone: string;
}

/**
 * Avança as missões afetadas pelo fato.
 *
 * O progresso usa a chave `(tenantId, userId, taskDefinitionId, periodKey)`.
 * Como a chave de período NUNCA é nula (missões de uso único usam o sentinela
 * `once`), o índice único funciona de verdade — ver o cabeçalho de
 * `task-rules.ts`.
 */
async function advanceMissions(tx: TxClient, context: MissionContext): Promise<MissionUpdate[]> {
  const definitions = await tx.taskDefinition.findMany({
    where: {
      tenantId: context.tenantId,
      trigger: context.source,
      isActive: true,
      deletedAt: null,
      ...(context.eventId ? { OR: [{ eventId: context.eventId }, { eventId: null }] } : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      kind: true,
      repeatEveryHours: true,
      startsAt: true,
      endsAt: true,
      target: true,
      xpReward: true,
    },
  });

  const updates: MissionUpdate[] = [];

  for (const definition of definitions) {
    const schedule = {
      kind: definition.kind,
      repeatEveryHours: definition.repeatEveryHours,
      startsAt: definition.startsAt,
      endsAt: definition.endsAt,
    };

    if (!isTaskWindowOpen(schedule, context.now)) continue;

    const { target } = parseTaskTarget(definition.target);
    if (!matchesTargetFilters(target, context)) continue;

    const periodKey = taskPeriodKey(schedule, context.now, context.timezone);

    const existing = await tx.userTaskProgress.findUnique({
      where: {
        tenantId_userId_taskDefinitionId_periodKey: {
          tenantId: context.tenantId,
          userId: context.userId,
          taskDefinitionId: definition.id,
          periodKey,
        },
      },
      select: { id: true, progress: true, target: true, status: true },
    });

    const before: ProgressState = existing
      ? { progress: existing.progress, target: existing.target, status: existing.status }
      : { progress: 0, target: target.count, status: 'NOT_STARTED' };

    const after = advanceProgress(before, 1);
    if (after.progress === before.progress && after.status === before.status) {
      continue; // nada mudou (já concluída, resgatada ou expirada)
    }

    if (existing) {
      await tx.userTaskProgress.update({
        where: { id: existing.id },
        data: {
          progress: after.progress,
          status: after.status,
          ...(after.status === 'COMPLETED' && before.status !== 'COMPLETED'
            ? { completedAt: context.now }
            : {}),
        },
      });
    } else {
      await tx.userTaskProgress.create({
        data: {
          id: randomUUID(),
          tenantId: context.tenantId,
          userId: context.userId,
          taskDefinitionId: definition.id,
          status: after.status,
          progress: after.progress,
          target: after.target,
          periodKey,
          startedAt: context.now,
          ...(after.status === 'COMPLETED' ? { completedAt: context.now } : {}),
        },
      });
    }

    updates.push({
      taskDefinitionId: definition.id,
      slug: definition.slug,
      name: definition.name,
      progress: after.progress,
      target: after.target,
      status: after.status,
      completed: after.status === 'COMPLETED',
      xpReward: definition.xpReward,
    });
  }

  return updates;
}

/** Os filtros do alvo batem com o fato ocorrido? */
function matchesTargetFilters(target: TaskTarget, context: MissionContext): boolean {
  if (target.activityType && target.activityType !== context.activityType) return false;
  if (target.trackId && target.trackId !== context.trackId) return false;
  if (target.minutes && (context.minutes ?? 0) < target.minutes) return false;
  return true;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Chaves de idempotência
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Chaves padronizadas, derivadas do FATO.
 *
 * Todas começam pelo id do tenant porque `idempotencyKey` é único GLOBALMENTE:
 * sem o tenant, o check-in da mesma pessoa em duas instituições colidiria e a
 * segunda receberia "já creditado" por engano.
 */
export const rewardKeys = {
  checkin: (tenantId: string, registrationId: string) => `checkin:${tenantId}:${registrationId}`,
  attendance: (tenantId: string, registrationId: string) =>
    `attendance:${tenantId}:${registrationId}`,
  miniCourse: (tenantId: string, registrationId: string) =>
    `minicourse:${tenantId}:${registrationId}`,
  submissionSubmitted: (tenantId: string, submissionId: string) =>
    `submission:${tenantId}:${submissionId}:submitted`,
  submissionAccepted: (tenantId: string, submissionId: string) =>
    `submission:${tenantId}:${submissionId}:accepted`,
  reviewCompleted: (tenantId: string, reviewId: string) => `review:${tenantId}:${reviewId}`,
  taskClaimed: (tenantId: string, progressId: string) => `task:${tenantId}:${progressId}`,
  /**
   * Inscrição confirmada: a chave é o ALVO (pessoa + evento/atividade), não a linha.
   *
   * Por que não a inscrição: cancelar e se inscrever de novo cria uma linha nova, e a
   * chave por linha pagaria 30 XP a cada volta — farm trivial, sem nenhum fato novo.
   * Com o alvo, cada destino paga UMA vez para sempre, e a promoção da lista de espera
   * e a confirmação do balcão continuam creditando pelo MESMO caminho (a pessoa pediu
   * a vaga uma vez, e a vaga se confirmou depois).
   */
  registrationConfirmed: (tenantId: string, userId: string, targetId: string) =>
    `registration:${tenantId}:${userId}:${targetId}`,
  /** Certificado emitido: um por documento (a pessoa pode ter vários). */
  certificateIssued: (tenantId: string, certificateId: string) =>
    `certificate:${tenantId}:${certificateId}`,
  /**
   * Sorteio: a chave é (rodada, posição) porque quem ganha é a POSIÇÃO.
   *
   * Desfazer a entrega do prêmio (FASE 22) não devolve a posição, e sortear de novo a
   * mesma rodada é recusado — então a posição é um fato estável.
   */
  raffleWon: (tenantId: string, roundId: string, position: number) =>
    `raffle:${tenantId}:${roundId}:${position}`,
  /** Ajuste manual: cada chamada é um fato novo e ganha chave própria. */
  manual: (tenantId: string, userId: string) => `manual:${tenantId}:${userId}:${randomUUID()}`,
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Conquistas por MARCO (FASE 16, item F1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DOIS GATILHOS QUE EXISTIAM NO CATÁLOGO E NUNCA DISPARAVAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `EVENT_ATTENDANCE_FULL` e `REVIEWER_TOP` são selecionáveis no catálogo de cartas
 *  desde a FASE 5 — e nenhum caminho do código os concedia. O organizador montava a
 *  carta, escolhia o gatilho, e ela nunca saía. Este módulo é o que faltava.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELES NÃO PASSAM PELO CRÉDITO DE XP
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os gatilhos automáticos nascem de um FATO que credita XP (`awardForEvent`), e o
 *  motor de recompensas lê o gatilho dali. Estes dois não são pontuação: são
 *  reconhecimento ("esteve em tudo", "foi o revisor que mais avaliou"). Criar um
 *  lançamento de XP de valor zero só para reusar o caminho poluiria o livro-razão —
 *  então eles usam `grantCardForTrigger`, que concede a carta sem mexer no saldo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  IDEMPOTÊNCIA EXPLÍCITA, PORQUE AQUI ELA NÃO VEM DE GRAÇA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `grantCardForTrigger` grava com `ON CONFLICT DO UPDATE quantity + 1`: repetir a
 *  chamada AUMENTA as cópias da carta. Para um gatilho de marco isso está errado —
 *  "esteve em todas as atividades" é um fato que acontece uma vez. Por isso cada
 *  concessão daqui checa antes se a pessoa JÁ tem carta com aquele `source` naquele
 *  evento e, se tiver, não faz nada.
 *
 *  Nenhuma função deste módulo lança para o chamador: conquista não pode derrubar
 *  credenciamento nem fechamento de comitê (invariante nº 8 do AGENTS.md).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { recordAudit } from '@/lib/admin/audit';
import { errorMessage } from '@/lib/db/prisma-errors';
import { grantCardForTrigger } from '@/lib/gamification/reward-engine';
import { evaluateFullAttendance } from '@/domain/events/attendance-rules';
import {
  MIN_REVIEWS_FOR_TOP,
  rankReviewers,
  type ReviewerRanking,
} from '@/domain/review/review-rules';

export type AchievementResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: 'NOT_FOUND' | 'INTERNAL'; message: string };

/** A pessoa já recebeu a conquista deste gatilho neste evento? */
async function alreadyGranted(input: {
  tenantId: string;
  userId: string;
  eventId: string;
  trigger: 'EVENT_ATTENDANCE_FULL' | 'REVIEWER_TOP';
}): Promise<boolean> {
  const count = await withTenant(input.tenantId, (tx) =>
    tx.userCard.count({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        eventId: input.eventId,
        source: input.trigger,
      },
    }),
  );

  return count > 0;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Presença em TODAS as atividades (EVENT_ATTENDANCE_FULL)
// ───────────────────────────────────────────────────────────────────────────────
export interface FullAttendanceOutcome {
  /** A conquista foi concedida agora? `false` também quando já existia. */
  granted: boolean;
  /** Já havia a conquista de uma apuração anterior. */
  alreadyHad: boolean;
  /** Diagnóstico do critério (para a tela e para o log). */
  reason: string | null;
  coveredCount: number;
  requiredCount: number;
  missingTitles: string[];
  cardName: string | null;
}

/**
 * Concede a carta de "presença em todo o evento", se o critério estiver cumprido.
 *
 * Chamada ao final do check-out. A decisão do critério é do domínio
 * (`evaluateFullAttendance`), que exige: a pessoa coberta em TODAS as atividades que
 * exigem presença E nenhuma atividade ainda por acontecer. Sem a segunda condição, a
 * carta sairia no meio do evento para quem ainda tinha atividade pela frente.
 */
export async function grantFullAttendanceCard(input: {
  tenantId: string;
  userId: string;
  eventId: string;
  actorId?: string | null;
  now?: Date;
}): Promise<AchievementResult<FullAttendanceOutcome>> {
  const now = input.now ?? new Date();

  try {
    const evaluation = await withTenant(input.tenantId, async (tx) => {
      const [activities, attendances] = await Promise.all([
        tx.activity.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
          select: { id: true, title: true, requiresAttendance: true, status: true, endsAt: true },
        }),
        tx.attendance.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId, userId: input.userId },
          select: { activityId: true, status: true, minutesAttended: true },
        }),
      ]);

      return evaluateFullAttendance({
        activities: activities.map((activity) => ({
          activityId: activity.id,
          title: activity.title,
          requiresAttendance: activity.requiresAttendance,
          status: activity.status,
          endsAt: activity.endsAt,
        })),
        attendances: attendances
          .filter((attendance) => attendance.activityId !== null)
          .map((attendance) => ({
            activityId: attendance.activityId!,
            status: attendance.status,
            minutesAttended: attendance.minutesAttended ?? 0,
          })),
        now,
      });
    });

    const base = {
      coveredCount: evaluation.coveredCount,
      requiredCount: evaluation.requiredCount,
      missingTitles: evaluation.missingTitles,
    };

    if (!evaluation.complete) {
      return { ok: true as const, granted: false, alreadyHad: false, reason: evaluation.reason, cardName: null, ...base };
    }

    if (
      await alreadyGranted({
        tenantId: input.tenantId,
        userId: input.userId,
        eventId: input.eventId,
        trigger: 'EVENT_ATTENDANCE_FULL',
      })
    ) {
      return {
        ok: true as const,
        granted: false,
        alreadyHad: true,
        reason: 'A conquista de presença total já havia sido concedida.',
        cardName: null,
        ...base,
      };
    }

    const granted = await grantCardForTrigger({
      tenantId: input.tenantId,
      userId: input.userId,
      trigger: 'EVENT_ATTENDANCE_FULL',
      eventId: input.eventId,
      sourceRef: `event:${input.eventId}`,
      actorId: input.actorId ?? null,
      now,
    });

    const cardName = granted.ok ? (granted.cards[0]?.name ?? null) : null;

    if (granted.ok && granted.cards.length > 0) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId ?? input.userId,
        action: 'CREATE',
        entityType: 'UserCard',
        entityId: input.userId,
        changes: {
          trigger: { from: null, to: 'EVENT_ATTENDANCE_FULL' },
          card: { from: null, to: cardName },
          activities: { from: null, to: evaluation.requiredCount },
        },
      });
    }

    return { ok: true as const, granted: granted.ok && granted.cards.length > 0, alreadyHad: false, reason: null, cardName, ...base };
  } catch (error) {
    console.error(`[achievements] falha na conquista de presença total: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL' as const,
      message: 'Não foi possível avaliar a conquista de presença total.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Revisor destaque (REVIEWER_TOP)
// ───────────────────────────────────────────────────────────────────────────────
export interface ReviewerRankingView extends ReviewerRanking {
  /** Fonte do piso aplicado: a carta pode exigir mais que o padrão. */
  minReviews: number;
  /** Cartas do gatilho disponíveis neste evento (o que o botão vai conceder). */
  cardNames: string[];
}

/**
 * Ranking de revisores do evento, com o piso que as cartas do gatilho exigem.
 *
 * O piso é o MAIOR entre `MIN_REVIEWS_FOR_TOP` e o `triggerCondition.threshold` de
 * cada carta de `REVIEWER_TOP` — a carta é a fonte da regra quando ela é mais
 * exigente, e o padrão cobre o caso de a carta não declarar nada.
 */
export async function getReviewerRanking(input: {
  tenantId: string;
  eventId: string;
  top?: number;
}): Promise<AchievementResult<ReviewerRankingView>> {
  try {
    const data = await withTenant(input.tenantId, async (tx) => {
      const [reviews, cards] = await Promise.all([
        tx.review.findMany({
          where: {
            tenantId: input.tenantId,
            status: 'SUBMITTED',
            submission: { eventId: input.eventId, deletedAt: null },
          },
          select: { reviewerId: true, reviewer: { select: { name: true } } },
        }),
        tx.cardTemplate.findMany({
          where: { tenantId: input.tenantId, trigger: 'REVIEWER_TOP', isActive: true, deletedAt: null },
          select: { name: true, triggerCondition: true, eventId: true },
        }),
      ]);

      return { reviews, cards };
    });

    const counts = new Map<string, { reviewerName: string; completedReviews: number }>();

    for (const review of data.reviews) {
      const current = counts.get(review.reviewerId) ?? {
        reviewerName: review.reviewer?.name ?? 'Revisor',
        completedReviews: 0,
      };
      current.completedReviews += 1;
      counts.set(review.reviewerId, current);
    }

    const scores = [...counts.entries()].map(([reviewerId, value]) => ({
      reviewerId,
      reviewerName: value.reviewerName,
      completedReviews: value.completedReviews,
    }));

    const cards = data.cards.filter(
      (card) => card.eventId === null || card.eventId === input.eventId,
    );

    const thresholds = cards
      .map((card) => {
        const raw = card.triggerCondition as Record<string, unknown> | null;
        const value = raw && typeof raw === 'object' ? Number(raw.threshold) : Number.NaN;

        return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
      })
      .filter((value): value is number => value !== null);

    const minReviews = thresholds.length > 0 ? Math.max(...thresholds) : MIN_REVIEWS_FOR_TOP;
    const ranking = rankReviewers(scores, { top: input.top ?? 1, minReviews });

    return {
      ok: true as const,
      ...ranking,
      minReviews,
      cardNames: cards.map((card) => card.name),
    };
  } catch (error) {
    console.error(`[achievements] falha ao montar o ranking de revisores: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL' as const,
      message: 'Não foi possível calcular o ranking de revisores.',
    };
  }
}

export interface ReviewerAwardOutcome {
  awarded: { reviewerId: string; reviewerName: string; completedReviews: number; cardName: string | null }[];
  ranking: ReviewerRankingView;
  /** Explicação quando ninguém foi premiado. */
  reason: string | null;
}

/**
 * Premia o(s) revisor(es) destaque do evento, com o piso aplicado pelo ranking.
 *
 * A concessão é idempotente por pessoa (a conquista do evento é uma só) e o
 * resultado diz o que aconteceu: sem isso, o botão "premiar" seria um clique que não
 * se sabe se fez algo.
 */
export async function awardTopReviewers(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  top?: number;
}): Promise<AchievementResult<ReviewerAwardOutcome>> {
  const ranking = await getReviewerRanking({
    tenantId: input.tenantId,
    eventId: input.eventId,
    top: input.top,
  });

  if (!ranking.ok) return ranking;

  if (ranking.awarded.length === 0) {
    return { ok: true as const, awarded: [], ranking, reason: ranking.reason };
  }

  const awarded: ReviewerAwardOutcome['awarded'] = [];

  for (const reviewer of ranking.awarded) {
    if (
      await alreadyGranted({
        tenantId: input.tenantId,
        userId: reviewer.reviewerId,
        eventId: input.eventId,
        trigger: 'REVIEWER_TOP',
      })
    ) {
      awarded.push({
        reviewerId: reviewer.reviewerId,
        reviewerName: reviewer.reviewerName,
        completedReviews: reviewer.completedReviews,
        cardName: null,
      });
      continue;
    }

    const granted = await grantCardForTrigger({
      tenantId: input.tenantId,
      userId: reviewer.reviewerId,
      trigger: 'REVIEWER_TOP',
      eventId: input.eventId,
      sourceRef: `event:${input.eventId}`,
      actorId: input.actorId,
    });

    const cardName = granted.ok ? (granted.cards[0]?.name ?? null) : null;

    if (granted.ok && granted.cards.length > 0) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'CREATE',
        entityType: 'UserCard',
        entityId: reviewer.reviewerId,
        changes: {
          trigger: { from: null, to: 'REVIEWER_TOP' },
          card: { from: null, to: cardName },
          completedReviews: { from: null, to: reviewer.completedReviews },
        },
      });
    }

    awarded.push({
      reviewerId: reviewer.reviewerId,
      reviewerName: reviewer.reviewerName,
      completedReviews: reviewer.completedReviews,
      cardName,
    });
  }

  return { ok: true as const, awarded, ranking, reason: null };
}

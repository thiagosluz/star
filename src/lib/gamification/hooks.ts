/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Ganchos de gamificação nos fluxos acadêmicos
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE GANCHOS EXPLÍCITOS, E NÃO EVENTOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O sistema não tem barramento de eventos, e criar um só para gamificação seria
 *  infraestrutura demais para o ganho. Os três fluxos que geram recompensa
 *  (submissão enviada, submissão aceita, parecer concluído) chamam funções
 *  nomeadas daqui — e o nome diz exatamente qual é o fato.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA DE OURO: A RECOMPENSA NUNCA DERRUBA O FLUXO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todas as funções deste módulo engolem o próprio erro e registram no log. Um
 *  timeout no sorteio de cartas NÃO PODE impedir alguém de submeter um trabalho
 *  científico. Se a gamificação falhar, o fato acadêmico permanece; a recompensa
 *  pode ser reconciliada depois (a chave de idempotência permite reprocessar).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { awardForEvent, rewardKeys, type RewardOutcome } from '@/lib/gamification/reward-engine';

/** Resultado do gancho: `null` quando a recompensa não pôde ser aplicada. */
export type HookOutcome = RewardOutcome | null;

function logHookFailure(hook: string, message: string): void {
  console.error(`[gamification] gancho "${hook}" falhou (não-fatal): ${message}`);
}

/**
 * Submissão enviada para avaliação.
 *
 * O crédito vai para quem SUBMETEU: é ele quem fez o trabalho de escrever e
 * formatar. Coautores não recebem automaticamente porque a lista de autoria pode
 * misturar pessoas sem conta na plataforma — e distribuir XP para contas por
 * coincidência de nome seria pior do que não distribuir.
 */
export async function rewardSubmissionSubmitted(input: {
  tenantId: string;
  userId: string;
  submissionId: string;
  eventId: string | null;
}): Promise<HookOutcome> {
  try {
    const result = await awardForEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      source: 'SUBMISSION_SUBMITTED',
      idempotencyKey: rewardKeys.submissionSubmitted(input.tenantId, input.submissionId),
      reason: 'Trabalho submetido para avaliação',
      eventId: input.eventId,
      submissionId: input.submissionId,
    });

    if (!result.ok) {
      logHookFailure('submission-submitted', result.message);
      return null;
    }

    return result;
  } catch (error) {
    logHookFailure('submission-submitted', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/** Trabalho ACEITO é o resultado que o evento existe para produzir. */
export async function rewardSubmissionAccepted(input: {
  tenantId: string;
  userId: string;
  submissionId: string;
  eventId: string | null;
}): Promise<HookOutcome> {
  try {
    const result = await awardForEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      source: 'SUBMISSION_ACCEPTED',
      idempotencyKey: rewardKeys.submissionAccepted(input.tenantId, input.submissionId),
      reason: 'Trabalho aceito pelo comitê científico',
      eventId: input.eventId,
      submissionId: input.submissionId,
    });

    if (!result.ok) {
      logHookFailure('submission-accepted', result.message);
      return null;
    }

    return result;
  } catch (error) {
    logHookFailure('submission-accepted', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Variantes que RESOLVEM O CONTEXTO sozinhas
 * ─────────────────────────────────────────────────────────────────────────────
 *  As Server Actions dos fluxos acadêmicos conhecem apenas o id do recurso.
 *  Empurrar para elas a tarefa de descobrir autor e evento espalharia regra de
 *  gamificação por módulos que não são de gamificação — e qualquer esquecimento
 *  viraria recompensa perdida em silêncio. Aqui a resolução mora junto da regra.
 */

/** Submissão enviada: resolve autor e evento a partir do id. */
export async function rewardSubmissionSubmittedById(input: {
  tenantId: string;
  submissionId: string;
}): Promise<HookOutcome> {
  try {
    const submission = await withTenant(input.tenantId, (tx) =>
      tx.submission.findFirst({
        where: { id: input.submissionId, deletedAt: null },
        select: { submittedById: true, eventId: true },
      }),
    );

    if (!submission?.submittedById) return null;

    return await rewardSubmissionSubmitted({
      tenantId: input.tenantId,
      userId: submission.submittedById,
      submissionId: input.submissionId,
      eventId: submission.eventId,
    });
  } catch (error) {
    logHookFailure('submission-submitted-by-id', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/** Decisão de ACEITE: resolve autor e evento a partir da submissão. */
export async function rewardSubmissionAcceptedById(input: {
  tenantId: string;
  submissionId: string;
}): Promise<HookOutcome> {
  try {
    const submission = await withTenant(input.tenantId, (tx) =>
      tx.submission.findFirst({
        where: { id: input.submissionId, deletedAt: null },
        select: { submittedById: true, eventId: true },
      }),
    );

    if (!submission?.submittedById) return null;

    return await rewardSubmissionAccepted({
      tenantId: input.tenantId,
      userId: submission.submittedById,
      submissionId: input.submissionId,
      eventId: submission.eventId,
    });
  } catch (error) {
    logHookFailure('submission-accepted-by-id', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/**
 * Parecer concluído.
 *
 * O XP é do REVISOR. O gatilho é o parecer submetido — não a atribuição — porque
 * avaliar é o trabalho, e é ele que deve ser recompensado.
 */
export async function rewardReviewCompleted(input: {
  tenantId: string;
  reviewerId: string;
  reviewId: string;
  submissionId: string;
  eventId: string | null;
}): Promise<HookOutcome> {
  try {
    const result = await awardForEvent({
      tenantId: input.tenantId,
      userId: input.reviewerId,
      source: 'REVIEW_COMPLETED',
      idempotencyKey: rewardKeys.reviewCompleted(input.tenantId, input.reviewId),
      reason: 'Parecer concluído',
      eventId: input.eventId,
      reviewId: input.reviewId,
      submissionId: input.submissionId,
    });

    if (!result.ok) {
      logHookFailure('review-completed', result.message);
      return null;
    }

    return result;
  } catch (error) {
    logHookFailure('review-completed', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/** Parecer concluído: resolve revisor, submissão e evento a partir do parecer. */
export async function rewardReviewCompletedById(input: {
  tenantId: string;
  reviewId: string;
}): Promise<HookOutcome> {
  try {
    const review = await withTenant(input.tenantId, (tx) =>
      tx.review.findFirst({
        where: { id: input.reviewId },
        select: {
          reviewerId: true,
          submissionId: true,
          submission: { select: { eventId: true } },
        },
      }),
    );

    if (!review) return null;

    return await rewardReviewCompleted({
      tenantId: input.tenantId,
      reviewerId: review.reviewerId,
      reviewId: input.reviewId,
      submissionId: review.submissionId,
      eventId: review.submission?.eventId ?? null,
    });
  } catch (error) {
    logHookFailure('review-completed-by-id', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

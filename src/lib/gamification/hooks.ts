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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  OS FATOS QUE FALTAVAM (FASE 43)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Inscrição confirmada, certificado emitido e sorteio ganho aconteciam no sistema
 *  desde as primeiras fases e não moviam nada: nem XP, nem carta, nem missão. As
 *  três funções abaixo fecham isso, com a mesma regra das outras — **nunca lançam**,
 *  e por isso são chamadas DEPOIS do commit do fato.
 *
 *  A inscrição tem TRÊS portas para o mesmo estado (inscrição direta, promoção da
 *  lista de espera e confirmação de vaga) e por isso a idempotência é pela INSCRIÇÃO:
 *  quem chegar primeiro credita, os outros dois não.
 */
export async function rewardRegistrationConfirmed(input: {
  tenantId: string;
  userId: string;
  registrationId: string;
  eventId: string | null;
  activityId: string | null;
}): Promise<HookOutcome> {
  try {
    /**
     * O alvo é a ATIVIDADE quando há uma, e o EVENTO quando é a inscrição do evento:
     * é ele que identifica "esta vaga", e é o que faz cancelar e voltar a se inscrever
     * não pagar de novo.
     */
    const targetId = input.activityId ?? input.eventId ?? input.registrationId;

    const result = await awardForEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      source: 'REGISTRATION_CONFIRMED',
      idempotencyKey: rewardKeys.registrationConfirmed(input.tenantId, input.userId, targetId),
      reason: input.activityId ? 'Inscrição confirmada em atividade' : 'Inscrição confirmada no evento',
      eventId: input.eventId,
      activityId: input.activityId,
      registrationId: input.registrationId,
    });

    if (!result.ok) {
      logHookFailure('registration-confirmed', result.message);
      return null;
    }

    return result;
  } catch (error) {
    logHookFailure('registration-confirmed', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/**
 * Inscrição confirmada: resolve pessoa, evento e atividade a partir da INSCRIÇÃO.
 *
 * A releitura do estado não é desconfiança: é o que permite chamar o gancho de
 * QUALQUER caminho que confirme uma vaga — a inscrição direta, a promoção da lista
 * de espera e a confirmação do balcão — sem que cada um precise carregar o contexto
 * até aqui. Se a linha não estiver `CONFIRMED`, não há fato: a resposta é `null`.
 */
export async function rewardRegistrationConfirmedById(input: {
  tenantId: string;
  registrationId: string;
}): Promise<HookOutcome> {
  try {
    const registration = await withTenant(input.tenantId, (tx) =>
      tx.registration.findFirst({
        where: { id: input.registrationId, deletedAt: null },
        select: { userId: true, eventId: true, activityId: true, status: true },
      }),
    );

    if (!registration || registration.status !== 'CONFIRMED') return null;

    return await rewardRegistrationConfirmed({
      tenantId: input.tenantId,
      userId: registration.userId,
      registrationId: input.registrationId,
      eventId: registration.eventId,
      activityId: registration.activityId,
    });  } catch (error) {
    logHookFailure('registration-confirmed-by-id', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/** Certificado emitido: resolve titular e evento a partir do documento. */
export async function rewardCertificateIssuedById(input: {
  tenantId: string;
  certificateId: string;
}): Promise<HookOutcome> {
  try {
    const certificate = await withTenant(input.tenantId, (tx) =>
      tx.certificate.findFirst({
        where: { id: input.certificateId },
        select: { userId: true, eventId: true },
      }),
    );

    if (!certificate) return null;

    return await rewardCertificateIssued({
      tenantId: input.tenantId,
      userId: certificate.userId,
      certificateId: input.certificateId,
      eventId: certificate.eventId,
    });
  } catch (error) {
    logHookFailure('certificate-issued-by-id', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/** Posição premiada: resolve o evento a partir da RODADA apurada. */
export async function rewardRaffleWonById(input: {
  tenantId: string;
  userId: string;
  roundId: string;
  position: number;
}): Promise<HookOutcome> {
  try {
    const round = await withTenant(input.tenantId, (tx) =>
      tx.raffleRound.findFirst({
        where: { id: input.roundId },
        select: { raffle: { select: { eventId: true } } },
      }),
    );

    return await rewardRaffleWon({
      tenantId: input.tenantId,
      userId: input.userId,
      roundId: input.roundId,
      position: input.position,
      eventId: round?.raffle.eventId ?? null,
    });
  } catch (error) {
    logHookFailure('raffle-won-by-id', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/**
 * Certificado emitido.
 *
 * O crédito é de quem PEDIU o documento (é ele o titular), e o fato é o documento
 * existir — não o arquivo ter sido gerado: o PDF pode ser reprocessado depois, e a
 * promessa "emitido" já vale com código e assinatura.
 */
export async function rewardCertificateIssued(input: {
  tenantId: string;
  userId: string;
  certificateId: string;
  eventId: string | null;
}): Promise<HookOutcome> {
  try {
    const result = await awardForEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      source: 'CERTIFICATE_ISSUED',
      idempotencyKey: rewardKeys.certificateIssued(input.tenantId, input.certificateId),
      reason: 'Certificado emitido',
      eventId: input.eventId,
    });

    if (!result.ok) {
      logHookFailure('certificate-issued', result.message);
      return null;
    }

    return result;
  } catch (error) {
    logHookFailure('certificate-issued', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

/**
 * Posição premiada numa rodada.
 *
 * Só o GANHADOR entra: suplente não ganhou nada ainda — ele é a reserva, e creditar
 * o suplente daria XP por um prêmio que talvez nunca exista. A entrega do prêmio
 * (FASE 16/22) é outro fato e não muda isto: a posição é a mesma.
 */
export async function rewardRaffleWon(input: {
  tenantId: string;
  userId: string;
  roundId: string;
  position: number;
  eventId: string | null;
}): Promise<HookOutcome> {
  try {
    const result = await awardForEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      source: 'RAFFLE_WON',
      idempotencyKey: rewardKeys.raffleWon(input.tenantId, input.roundId, input.position),
      reason: `Sorteado na ${input.position}ª posição`,
      eventId: input.eventId,
    });

    if (!result.ok) {
      logHookFailure('raffle-won', result.message);
      return null;
    }

    return result;
  } catch (error) {
    logHookFailure('raffle-won', error instanceof Error ? error.message : 'erro');
    return null;
  }
}

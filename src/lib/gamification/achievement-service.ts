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
import { leaderboardIdentity } from '@/domain/gamification/leaderboard-rules';
import {
  MIN_REVIEWS_FOR_TOP,
  rankReviewers,
  type ReviewerRanking,
  type ReviewerScore,
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
 * Como este ranking CITA uma pessoa que tem pareceres no evento (FASE 69 · dívida E82).
 *
 * ─── POR QUE A RÉGUA VEM DE FORA, E NÃO DE UM `if (publicProfileHiddenAt)` AQUI ──
 *
 *  A moderação da plataforma (FASE 56 · E62) grava `User.publicProfileHiddenAt`, e a
 *  FASE 60 fixou que a medida vale em TODA superfície que cita a pessoa. Este ranking
 *  nasceu lendo `reviewer.name` direto e ficou de fora — é a dívida **E82**. A resposta
 *  para "como citar alguém sem identificá-lo" já existe no domínio, no lugar em que o
 *  ranking de XP a usa desde a E80 (`leaderboardIdentity`, FASE 62): a régua é
 *  **MASCARAR** — a pessoa continua na lista, com a posição e a contagem dela —, e não
 *  removê-la. Escrever a condição aqui de novo repetiria o defeito que a E79 descreve:
 *  a régua copiada nasce sem a checagem na superfície seguinte.
 *
 *  `publicHandle` e `image` vão NULOS porque este ranking não publica nem `@handle` nem
 *  foto: não há identidade dessas duas a esconder — o que a régua tira daqui é o NOME.
 *  Sem pessoa (a FK é obrigatória; o `null` é defesa de runtime) não há identidade
 *  nenhuma a citar, e vale o rótulo neutro que a tela já usava.
 */
function citedReviewerName(
  person: { name: string; publicProfileHiddenAt: Date | null } | null,
): string {
  if (!person) return 'Revisor';

  return leaderboardIdentity({
    name: person.name,
    publicHandle: null,
    image: null,
    publicProfileHiddenAt: person.publicProfileHiddenAt,
  }).name;
}

/**
 * Ranking de revisores do evento, com o piso que as cartas do gatilho exigem.
 *
 * O piso é o **MAIOR `threshold` entre as cartas de `REVIEWER_TOP`** do evento; e
 * `MIN_REVIEWS_FOR_TOP` é só o **padrão de quem não declarou nada** — ele NÃO é um piso
 * somado ao da carta (`Math.max(...thresholds)`, e a constante apenas quando não há
 * threshold nenhum; a FASE 16 prende esse comportamento no E2E dos sorteios).
 *
 * A correção é da FASE 69: o texto anterior dizia "o MAIOR entre `MIN_REVIEWS_FOR_TOP` e
 * o threshold" e descrevia um código que nunca existiu — o comentário tinha envelhecido
 * e passou a mentir sobre a régua. O código NÃO foi tocado: o teste da FASE 16 é o
 * contrato.
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
          /**
           * `publicProfileHiddenAt` é pedido DE PROPÓSITO: é o campo que a fonte única
           * da ocultação lê. Um `select` que o esqueça entrega `undefined`, e a fonte
           * única trata isso como "não visível" (fail-closed) — gente abreviada numa
           * lista que mostrava o nome, que se investiga; o contrário publicaria a
           * identidade de quem a moderação tirou do ar, que não se investiga.
           */
          select: {
            reviewerId: true,
            reviewer: { select: { name: true, publicProfileHiddenAt: true } },
          },
        }),
        tx.cardTemplate.findMany({
          where: { tenantId: input.tenantId, trigger: 'REVIEWER_TOP', isActive: true, deletedAt: null },
          select: { name: true, triggerCondition: true, eventId: true },
        }),
      ]);

      return { reviews, cards };
    });

    /**
     * ─── DOIS NOMES, PORQUE SÃO DUAS PERGUNTAS DIFERENTES (E82) ──────────────────
     *
     *  O desempate do `rankReviewers` é ALFABÉTICO pelo `reviewerName`, e a premiação
     *  é auditada: precisa ser reproduzível. Se o nome MASCARADO fosse o que entra no
     *  ranking, dois revisores ocultos com o mesmo número de pareceres e o mesmo
     *  prenome (`Ana Souza` e `Ana Silva` — os dois viram `Ana S.`) empatariam também
     *  no nome e o `localeCompare` devolveria `0`: a ordem passaria a ser a que o banco
     *  devolveu, que não é determinística, e o corte do `top` premiaria por sorteio.
     *  Por isso o ranking ORDENA pelo nome do cadastro e PUBLICA o nome que a régua da
     *  ocultação manda citar — a posição e a contagem não mudam de lado nenhum.
     */
    const tallies = new Map<
      string,
      { realName: string; citedName: string; completedReviews: number }
    >();

    for (const review of data.reviews) {
      const person = review.reviewer ?? null;
      const current = tallies.get(review.reviewerId) ?? {
        realName: person?.name ?? 'Revisor',
        citedName: citedReviewerName(person),
        completedReviews: 0,
      };
      current.completedReviews += 1;
      tallies.set(review.reviewerId, current);
    }

    const scores: ReviewerScore[] = [...tallies.entries()].map(([reviewerId, value]) => ({
      reviewerId,
      reviewerName: value.realName,
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

    /**
     * O que SAI do serviço carrega o nome como a régua manda citá-lo. A troca acontece
     * sobre a lista JÁ ordenada, e só no nome: posição, contagem e elegibilidade são as
     * que o ranking decidiu (esconder o nome não é apagar a pessoa do ranking).
     */
    const cited = (rows: readonly ReviewerScore[]): ReviewerScore[] =>
      rows.map((row) => ({
        ...row,
        reviewerName: tallies.get(row.reviewerId)?.citedName ?? row.reviewerName,
      }));

    return {
      ok: true as const,
      ...ranking,
      ranked: cited(ranking.ranked),
      awarded: cited(ranking.awarded),
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

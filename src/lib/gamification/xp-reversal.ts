/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Estorno do XP de uma vaga cancelada (FASE 50 · dívida E59)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTAVA ERRADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição confirmada credita 30 XP (FASE 43), e a chave de idempotência é o
 *  ALVO — pessoa + atividade/evento —, de propósito: cancelar e se inscrever de novo
 *  não paga duas vezes pela mesma vaga. Só que o CANCELAMENTO não devolvia nada: quem
 *  se inscreveu, recebeu e desistiu ficava com os pontos de uma vaga que não usou, e o
 *  saldo passava a medir intenção em vez de participação.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ESTORNO É UM LANÇAMENTO NOVO, NÃO UM `DELETE`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O livro-razão é append-only (é o que permite auditar o saldo). Então o estorno é
 *  uma linha NEGATIVA, com origem própria (`REGISTRATION_REVERTED`) — e o motivo
 *  escrito, para a trilha dizer POR QUE o saldo caiu: "ajuste administrativo"
 *  esconderia a causa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CHAVE DO ESTORNO É DO CRÉDITO, E NÃO DO ALVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada crédito pode ser estornado UMA vez, e o par é (`<crédito>`) ×
 *  (`<crédito>:reversal`). Isso resolve os dois casos de uma vez: cancelar duas vezes
 *  não estorna duas vezes, e — como quem se inscreve de novo DEPOIS de cancelar recebe
 *  uma nova geração de crédito (`<base>:retry:<n>`) — o estorno seguinte encontra o
 *  crédito novo, e não o já estornado.
 *
 *  Como todo gancho de recompensa, esta função **nunca lança**: falhar em devolver XP
 *  não pode desfazer um cancelamento que já aconteceu (invariante nº 8).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { resolveXpProgress } from '@/domain/gamification/xp-rules';
import { rewardKeys, type RewardOutcome, type RewardResult } from '@/lib/gamification/reward-engine';

/** Marca o lançamento que devolve o crédito: `<chave do crédito>:reversal`. */
export function reversalKeyOf(creditKey: string): string {
  return `${creditKey}:reversal`;
}

/**
 * Qual chave usar para creditar a inscrição AGORA.
 *
 * Devolve a chave do crédito vigente quando ele existe e não foi estornado (repetir a
 * chamada não paga de novo) e uma chave de NOVA GERAÇÃO quando o último lançamento é um
 * estorno — porque aí a vaga voltou a ser usada e merece o crédito outra vez.
 */
export function registrationCreditKey(input: {
  base: string;
  /** Chaves já lançadas com o prefixo da base, em ordem de criação. */
  existingKeys: readonly string[];
}): string {
  const last = input.existingKeys.at(-1);

  if (!last) return input.base;

  /** O último lançamento é um estorno: a vaga voltou a valer, então é geração nova. */
  if (last.endsWith(':reversal')) return `${input.base}:retry:${input.existingKeys.length}`;

  /** Crédito vigente: repetir a MESMA chave é o que impede o crédito dobrado. */
  return last;
}

/**
 * A chave com que o crédito da inscrição deve ser lançado AGORA.
 *
 * Lê o que já existe para o alvo e decide entre repetir a chave do crédito vigente
 * (idempotência de verdade: a mesma vaga não paga duas vezes) e abrir uma geração nova
 * depois de um estorno (a vaga voltou a ser usada, e o crédito é legítimo outra vez).
 */
export async function resolveRegistrationCreditKey(input: {
  tenantId: string;
  userId: string;
  registrationId: string;
  eventId: string | null;
  activityId: string | null;
}): Promise<string> {
  const targetId = input.activityId ?? input.eventId ?? input.registrationId;
  const base = rewardKeys.registrationConfirmed(input.tenantId, input.userId, targetId);

  try {
    const keys = await withTenant(input.tenantId, async (tx) => {
      const rows = await tx.xpTransaction.findMany({
        where: { tenantId: input.tenantId, idempotencyKey: { startsWith: base } },
        orderBy: { createdAt: 'asc' },
        select: { idempotencyKey: true },
      });

      return rows.map((row) => row.idempotencyKey);
    });

    return registrationCreditKey({ base, existingKeys: keys });
  } catch (error) {
    /**
     * Sem conseguir ler, a resposta segura é a chave BASE: no pior caso o crédito é
     * recusado por idempotência (a pessoa deixa de ganhar XP que talvez merecesse) — e
     * nunca paga duas vezes pela mesma vaga.
     */
    console.error(`[xp] falha ao resolver a chave do crédito: ${errorMessage(error)}`);
    return base;
  }
}

export interface RevertOutcome {
  /** `true` quando não havia o que estornar (nunca creditado, ou já estornado). */
  nothingToRevert: boolean;
  xpReverted: number;
  totalXp: number;
}

/**
 * Devolve o XP da inscrição cancelada. Idempotente e silencioso na falha.
 */
export async function revertRegistrationReward(input: {
  tenantId: string;
  userId: string;
  registrationId: string;
  eventId: string | null;
  activityId: string | null;
}): Promise<RewardResult<RevertOutcome> | null> {
  try {
    /** Mesmo alvo do crédito: a ATIVIDADE quando há uma, o EVENTO quando não há. */
    const targetId = input.activityId ?? input.eventId ?? input.registrationId;
    const base = rewardKeys.registrationConfirmed(input.tenantId, input.userId, targetId);

    return await withTenant(input.tenantId, async (tx) => {
      const rows = await tx.xpTransaction.findMany({
        where: { tenantId: input.tenantId, idempotencyKey: { startsWith: base } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, amount: true, source: true, idempotencyKey: true, balanceAfter: true },
      });

      const keys = new Set(rows.map((row) => row.idempotencyKey));

      /** O crédito que ainda não foi estornado — o mais recente, se houver mais de um. */
      const credit = [...rows]
        .reverse()
        .find((row) => row.amount > 0 && !keys.has(reversalKeyOf(row.idempotencyKey)));

      if (!credit) {
        return { ok: true as const, nothingToRevert: true, xpReverted: 0, totalXp: 0 };
      }

      const profile = await tx.userXpProfile.findUnique({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        select: { id: true, totalXp: true },
      });

      const totalBefore = profile?.totalXp ?? 0;

      /**
       * O saldo NUNCA fica negativo: se o XP da vaga já foi gasto em outra coisa (o
       * saldo só cresce no modelo, mas um ajuste manual pode ter baixado), o estorno
       * devolve o que existe e registra o valor REAL devolvido.
       */
      const reverted = Math.min(credit.amount, Math.max(0, totalBefore));
      const totalAfter = totalBefore - reverted;
      const progressAfter = resolveXpProgress(totalAfter);

      await tx.xpTransaction.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          userId: input.userId,
          eventId: input.eventId ?? null,
          amount: -reverted,
          source: 'REGISTRATION_REVERTED',
          reason: `Inscrição cancelada — devolução de ${reverted} XP da vaga`,
          activityId: input.activityId ?? null,
          registrationId: input.registrationId,
          balanceAfter: totalAfter,
          idempotencyKey: reversalKeyOf(credit.idempotencyKey),
        },
      });

      if (profile) {
        await tx.userXpProfile.update({
          where: { id: profile.id },
          data: {
            totalXp: totalAfter,
            level: progressAfter.level,
            prestigeLevel: progressAfter.prestigeLevel,
          },
        });
      }

      return { ok: true as const, nothingToRevert: false, xpReverted: reverted, totalXp: totalAfter };
    });
  } catch (error) {
    console.error(`[xp] falha ao estornar a inscrição: ${errorMessage(error)}`);
    return null;
  }
}

/** Mantido fora do `RewardOutcome`: o estorno não concede carta, missão nem ofensiva. */
export type RevertRewardOutcome = RewardOutcome;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Missões
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O RESGATE É EXPLÍCITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A missão completa sozinha (`COMPLETED`) e o participante precisa RESGATAR a
 *  recompensa. Não é enfeite: é a diferença entre "o sistema me deu pontos" e
 *  "eu conquistei isso". E é o momento em que o extrato fica auditável — cada
 *  resgate é um lançamento com a chave do próprio progresso.
 *
 *  A operação é idempotente em duas camadas:
 *    1. o XP usa a chave `task:<progressId>` (se repetir, não credita de novo);
 *    2. a marcação `COMPLETED → CLAIMED` é um UPDATE condicional: dois cliques
 *       simultâneos resultam em UM resgate.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  canClaim,
  progressRatio,
  taskExpiry,
  taskPeriodKey,
  withExpiry,
  type ProgressState,
} from '@/domain/gamification/task-rules';
import type { TaskKind, TaskProgressStatus } from '@/domain/gamification/types';
import {
  awardForEvent,
  grantCardForTrigger,
  rewardKeys,
  type GrantedCard,
  type RewardOutcome,
} from '@/lib/gamification/reward-engine';

export type TaskErrorCode = 'NOT_FOUND' | 'NOT_CLAIMABLE' | 'INTERNAL';

export type TaskResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: TaskErrorCode; message: string };

// ───────────────────────────────────────────────────────────────────────────────
//  Visão da missão
// ───────────────────────────────────────────────────────────────────────────────
export interface MissionView {
  taskDefinitionId: string;
  slug: string;
  name: string;
  description: string | null;
  kind: TaskKind;
  triggerLabel: string;
  xpReward: number;
  rewardCardSlug: string | null;
  progress: number;
  target: number;
  ratio: number;
  status: TaskProgressStatus;
  claimable: boolean;
  claimedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  displayOrder: number;
}

const TRIGGER_LABELS: Record<string, string> = {
  CHECKIN: 'Faça o credenciamento no evento',
  ACTIVITY_ATTENDANCE: 'Participe de uma atividade',
  MINI_COURSE_COMPLETION: 'Conclua um minicurso',
  SUBMISSION_SUBMITTED: 'Submeta um trabalho',
  SUBMISSION_ACCEPTED: 'Tenha um trabalho aceito',
  REVIEW_COMPLETED: 'Conclua um parecer',
  TASK_COMPLETED: 'Resgate missões',
  BONUS: 'Bônus',
  ADMIN_ADJUSTMENT: 'Ajuste da organização',
  REFERRAL: 'Indique alguém',
};

/**
 * Missões do participante, com o progresso da JANELA CORRENTE.
 *
 * Missões diárias e semanais têm chave de período; o progresso de ontem não pode
 * aparecer como o de hoje. Missões de uso único usam o sentinela `once` (nunca
 * `null` — ver `task-rules.ts`).
 */
export async function listMissions(
  tenantId: string,
  userId: string,
  options: { now?: Date; includeHidden?: boolean } = {},
): Promise<TaskResult<{ missions: MissionView[] }>> {
  try {
    const now = options.now ?? new Date();

    const data = await withTenant(tenantId, async (tx) => {
      const [definitions, timezone] = await Promise.all([
        tx.taskDefinition.findMany({
          where: {
            tenantId,
            deletedAt: null,
            ...(options.includeHidden ? {} : { isVisible: true, isActive: true }),
          },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            kind: true,
            trigger: true,
            target: true,
            xpReward: true,
            repeatEveryHours: true,
            startsAt: true,
            endsAt: true,
            displayOrder: true,
            rewardCard: { select: { slug: true } },
          },
        }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
      ]);

      const periods = definitions.map((definition) => ({
        taskDefinitionId: definition.id,
        periodKey: taskPeriodKey(
          {
            kind: definition.kind,
            repeatEveryHours: definition.repeatEveryHours,
            startsAt: definition.startsAt,
            endsAt: definition.endsAt,
          },
          now,
          timezone?.timezone ?? 'UTC',
        ),
      }));

      const progressRows = periods.length
        ? await tx.userTaskProgress.findMany({
            where: {
              tenantId,
              userId,
              OR: periods.map((period) => ({
                taskDefinitionId: period.taskDefinitionId,
                periodKey: period.periodKey,
              })),
            },
            select: {
              taskDefinitionId: true,
              periodKey: true,
              progress: true,
              target: true,
              status: true,
              completedAt: true,
              claimedAt: true,
            },
          })
        : [];

      return { definitions, progressRows, timezone: timezone?.timezone ?? 'UTC' };
    });

    /** Mapa `taskDefinitionId:periodKey` → progresso, porque a chave é composta. */
    const progressByKey = new Map(
      data.progressRows.map((row) => [`${row.taskDefinitionId}:${row.periodKey}`, row]),
    );

    const missions: MissionView[] = data.definitions.map((definition) => {
      const periodKey = taskPeriodKey(
        {
          kind: definition.kind,
          repeatEveryHours: definition.repeatEveryHours,
          startsAt: definition.startsAt,
          endsAt: definition.endsAt,
        },
        now,
        data.timezone,
      );

      const row = progressByKey.get(`${definition.id}:${periodKey}`);

      const base: ProgressState = row
        ? { progress: row.progress, target: row.target, status: row.status }
        : { progress: 0, target: 1, status: 'NOT_STARTED' };

      const expiresAt = taskExpiry(
        {
          kind: definition.kind,
          repeatEveryHours: definition.repeatEveryHours,
          startsAt: definition.startsAt,
          endsAt: definition.endsAt,
        },
        now,
        data.timezone,
      );

      // Expiração é DERIVADA na leitura: não depende de um job ter rodado.
      const state = withExpiry(base, expiresAt, now);

      return {
        taskDefinitionId: definition.id,
        slug: definition.slug,
        name: definition.name,
        description: definition.description,
        kind: definition.kind,
        triggerLabel: TRIGGER_LABELS[definition.trigger] ?? definition.trigger,
        xpReward: definition.xpReward,
        rewardCardSlug: definition.rewardCard?.slug ?? null,
        progress: state.progress,
        target: state.target,
        ratio: progressRatio(state),
        status: state.status,
        claimable: canClaim(state.status),
        claimedAt: row?.claimedAt ?? null,
        completedAt: row?.completedAt ?? null,
        expiresAt,
        displayOrder: definition.displayOrder,
      };
    });

    return { ok: true as const, missions };
  } catch (error) {
    console.error(`[gamification] falha ao listar missões: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar as missões.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resgate
// ───────────────────────────────────────────────────────────────────────────────
export interface ClaimOutcome {
  taskDefinitionId: string;
  taskName: string;
  xpAwarded: number;
  reward: RewardOutcome;
  cards: GrantedCard[];
  /**
   * `true` quando a recompensa já havia sido creditada e outra requisição
   * marcou a missão como resgatada primeiro. O XP não foi creditado duas vezes.
   */
  alreadyClaimed: boolean;
}

export async function claimMission(input: {
  tenantId: string;
  userId: string;
  taskDefinitionId: string;
  now?: Date;
}): Promise<TaskResult<ClaimOutcome>> {
  try {
    const now = input.now ?? new Date();

    // ── 1. Localiza o progresso da janela corrente ──────────────────────────
    const located = await withTenant(input.tenantId, async (tx) => {
      const definition = await tx.taskDefinition.findFirst({
        where: { id: input.taskDefinitionId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          kind: true,
          trigger: true,
          xpReward: true,
          repeatEveryHours: true,
          startsAt: true,
          endsAt: true,
          rewardCardTemplateId: true,
        },
      });

      if (!definition) return { definition: null, progress: null };

      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { timezone: true },
      });

      const periodKey = taskPeriodKey(
        {
          kind: definition.kind,
          repeatEveryHours: definition.repeatEveryHours,
          startsAt: definition.startsAt,
          endsAt: definition.endsAt,
        },
        now,
        tenant?.timezone ?? 'UTC',
      );

      const progress = await tx.userTaskProgress.findUnique({
        where: {
          tenantId_userId_taskDefinitionId_periodKey: {
            tenantId: input.tenantId,
            userId: input.userId,
            taskDefinitionId: definition.id,
            periodKey,
          },
        },
        select: { id: true, status: true, progress: true, target: true },
      });

      return { definition, progress };
    });

    const { definition, progress } = located;

    if (!definition) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Missão não encontrada.' };
    }

    if (!progress || !canClaim(progress.status)) {
      return {
        ok: false as const,
        code: 'NOT_CLAIMABLE',
        message: 'Esta missão ainda não está concluída.',
      };
    }

    /**
     * ── 2. Recompensa ANTES da marcação ───────────────────────────────────
     * Nesta ordem, uma falha entre os passos deixa a missão resgatável de novo e
     * o crédito já é idempotente (chave = id do progresso). Na ordem inversa, uma
     * falha perderia o XP para sempre — o pior dos dois mundos.
     */
    const reward = await awardForEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      source: 'TASK_COMPLETED',
      amount: definition.xpReward,
      reason: `Missão concluída: ${definition.name}`,
      idempotencyKey: rewardKeys.taskClaimed(input.tenantId, progress.id),
      occurredAt: now,
    });

    if (!reward.ok) {
      return { ok: false as const, code: 'INTERNAL', message: reward.message };
    }

    // ── 3. Carta de recompensa da missão (se houver) ────────────────────────
    const cards: GrantedCard[] = [...reward.cards];

    if (definition.rewardCardTemplateId) {
      const granted = await grantCardForTrigger({
        tenantId: input.tenantId,
        userId: input.userId,
        trigger: 'MANUAL_GRANT',
        templateId: definition.rewardCardTemplateId,
        sourceRef: `task:${progress.id}`,
        now,
      });

      if (granted.ok) cards.push(...granted.cards);
    }

    // ── 4. Marca como resgatada (UPDATE condicional) ────────────────────────
    const claimed = await withTenant(input.tenantId, async (tx) => {
      const updated = await tx.userTaskProgress.updateMany({
        where: { id: progress.id, status: 'COMPLETED' },
        data: { status: 'CLAIMED', claimedAt: now },
      });

      if (updated.count > 0) {
        await tx.userXpProfile.updateMany({
          where: { tenantId: input.tenantId, userId: input.userId },
          data: { tasksCompleted: { increment: 1 } },
        });
      }

      return updated.count;
    });

    return {
      ok: true as const,
      taskDefinitionId: definition.id,
      taskName: definition.name,
      xpAwarded: reward.xpAwarded,
      reward,
      cards,
      alreadyClaimed: claimed === 0,
    };
  } catch (error) {
    console.error(`[gamification] falha ao resgatar missão: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível resgatar a missão.' };
  }
}

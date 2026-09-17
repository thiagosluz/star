/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Sorteios
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS BARREIRAS CONTRA UM RESULTADO INJUSTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. ELEGIBILIDADE LIDA DO BANCO. O universo do sorteio vem de `attendances`,
 *     com o recorte de escopo, o piso de minutos e a exclusão de ganhadores
 *     anteriores. Não existe caminho em que a lista de concorrentes venha do
 *     cliente.
 *
 *  2. BLOQUEIO PESSIMISTA NA APURAÇÃO. A linha do sorteio é travada com
 *     `SELECT ... FOR UPDATE` dentro da transação com contexto de tenant. Dois
 *     cliques simultâneos (ou duas pessoas no palco) resultam em UMA apuração: a
 *     segunda encontra o status `DRAWN` e é recusada ANTES de sortear.
 *
 *  3. ÍNDICES ÚNICOS COMO GARANTIA FINAL. `(raffleId, userId)` impede a mesma
 *     pessoa duas vezes no mesmo sorteio, e `(raffleId, position)` impede duas
 *     pessoas na mesma posição — mesmo que a aplicação falhe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O RESULTADO É CONGELADO E ASSINADO POR HASH
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Depois de apurado, o sorteio não muda: os vencedores são gravados, o hash do
 *  resultado canônico (regras + vencedores na ordem) é persistido e a ação entra
 *  na trilha de auditoria. Reapurar exige criar outro sorteio — e o anterior
 *  permanece para quem quiser conferir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomInt, randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  buildResultPayload,
  dayKey,
  evaluateEligibility,
  evaluateReadiness,
  hashResult,
  selectWinners,
  validateRaffleConfig,
  type AttendanceSample,
  type EligibleParticipant,
  type RaffleConfig,
  type RaffleReadiness,
  type RaffleScope,
} from '@/domain/raffles/raffle-rules';

export type RaffleErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'NO_ELIGIBLE'
  | 'ALREADY_DRAWN'
  | 'CANCELED'
  | 'INTERNAL';

export type RaffleResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: RaffleErrorCode; message: string; details?: readonly string[] };

/**
 * Número máximo de presenças inspecionadas em uma apuração.
 *
 * Um evento com mais presenças que isso seria sorteado em partes — e o teto existe
 * para que a requisição não vire uma consulta sem limite. Se for atingido, a
 * resposta AVISA (em vez de silenciosamente considerar um universo menor).
 */
export const MAX_INSPECTED_ATTENDANCES = 20_000;

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura do universo
// ───────────────────────────────────────────────────────────────────────────────
interface RaffleConfigRow {
  id: string;
  eventId: string;
  activityId: string | null;
  title: string;
  description: string | null;
  scope: RaffleScope;
  referenceDate: Date | null;
  minAttendanceMinutes: number;
  winnersCount: number;
  allowPriorEventWinners: boolean;
  status: string;
  eligibleCount: number;
  inspectedAttendances: number;
  drawnAt: Date | null;
  resultHash: string | null;
  drawVersion: number;
  createdById: string;
}

async function loadRaffle(tx: TxClient, tenantId: string, raffleId: string): Promise<RaffleConfigRow | null> {
  return tx.raffle.findFirst({
    where: { id: raffleId, tenantId, deletedAt: null },
    select: {
      id: true,
      eventId: true,
      activityId: true,
      title: true,
      description: true,
      scope: true,
      referenceDate: true,
      minAttendanceMinutes: true,
      winnersCount: true,
      allowPriorEventWinners: true,
      status: true,
      eligibleCount: true,
      inspectedAttendances: true,
      drawnAt: true,
      resultHash: true,
      drawVersion: true,
      createdById: true,
    },
  });
}

/**
 * Presenças do evento como o domínio as enxerga.
 *
 * Traz apenas o necessário para decidir elegibilidade: usuário, atividade, quando
 * aconteceu, quanto tempo e o status. `ABSENT` continua vindo para que o motivo do
 * descarte seja explicável na tela ("presença marcada como ausente").
 */
async function loadAttendances(
  tx: TxClient,
  input: { tenantId: string; eventId: string; activityId?: string | null },
): Promise<AttendanceSample[]> {
  const rows = await tx.attendance.findMany({
    where: {
      tenantId: input.tenantId,
      eventId: input.eventId,
      /**
       * No escopo por atividade, filtrar aqui reduz o volume lido — e a decisão
       * continua sendo do domínio (`matchesScope`), que é testado. O filtro é
       * otimização, não regra.
       */
      ...(input.activityId ? { activityId: input.activityId } : {}),
    },
    orderBy: { checkedInAt: 'asc' },
    take: MAX_INSPECTED_ATTENDANCES,
    select: {
      id: true,
      userId: true,
      activityId: true,
      checkedInAt: true,
      minutesAttended: true,
      status: true,
      user: { select: { name: true } },
      activity: { select: { title: true, startsAt: true } },
    },
  });

  return rows.map((row) => ({
    attendanceId: row.id,
    userId: row.userId,
    userName: row.user?.name ?? 'Participante',
    activityId: row.activityId,
    activityTitle: row.activity?.title ?? null,
    activityStartsAt: row.activity?.startsAt ?? null,
    checkedInAt: row.checkedInAt,
    minutesAttended: row.minutesAttended ?? 0,
    status: row.status,
  }));
}

/** Quem já ganhou algum sorteio deste evento (quando a regra exige excluir). */
async function loadPriorWinnerIds(
  tx: TxClient,
  input: { tenantId: string; eventId: string; exceptRaffleId?: string },
): Promise<string[]> {
  const rows = await tx.raffleWinner.findMany({
    where: {
      tenantId: input.tenantId,
      raffle: {
        eventId: input.eventId,
        status: 'DRAWN',
        ...(input.exceptRaffleId ? { id: { not: input.exceptRaffleId } } : {}),
      },
    },
    select: { userId: true },
  });

  return [...new Set(rows.map((row) => row.userId))];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Prévia de elegíveis
// ───────────────────────────────────────────────────────────────────────────────
export interface EligibilityPreview {
  eligible: EligibleParticipant[];
  rejected: { userId: string; userName: string; reason: string }[];
  inspectedAttendances: number;
  readiness: RaffleReadiness;
  truncated: boolean;
}

/**
 * Mostra quem pode ser sorteado — SEM sortear.
 *
 * Esta leitura é o que permite ao organizador conferir o universo ANTES de rodar o
 * sorteio no palco. Descobrir que a lista estava errada depois do resultado seria
 * irreversível.
 */
export async function previewEligibility(input: {
  tenantId: string;
  eventId: string;
  config: RaffleConfig;
}): Promise<RaffleResult<{ preview: EligibilityPreview }>> {
  try {
    const tenant = await withTenant(input.tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: input.tenantId }, select: { timezone: true } }),
    );

    const timeZone = tenant?.timezone ?? 'UTC';

    const data = await withTenant(input.tenantId, async (tx) => {
      const [attendances, priorWinnerIds] = await Promise.all([
        loadAttendances(tx, {
          tenantId: input.tenantId,
          eventId: input.eventId,
          activityId: input.config.scope === 'ACTIVITY' ? input.config.activityId : null,
        }),
        input.config.allowPriorEventWinners
          ? Promise.resolve<string[]>([])
          : loadPriorWinnerIds(tx, { tenantId: input.tenantId, eventId: input.eventId }),
      ]);

      return { attendances, priorWinnerIds };
    });

    const result = evaluateEligibility({
      attendances: data.attendances,
      config: input.config,
      timeZone,
      priorWinnerIds: data.priorWinnerIds,
    });

    return {
      ok: true as const,
      preview: {
        eligible: result.eligible,
        rejected: result.rejected,
        inspectedAttendances: result.inspectedAttendances,
        readiness: evaluateReadiness(result.eligible.length, input.config.winnersCount),
        truncated: data.attendances.length >= MAX_INSPECTED_ATTENDANCES,
      },
    };
  } catch (error) {
    console.error(`[raffles] falha na prévia de elegibilidade: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível calcular os elegíveis.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criação
// ───────────────────────────────────────────────────────────────────────────────
export interface CreateRaffleInput {
  tenantId: string;
  eventId: string;
  actorId: string;
  title: string;
  description?: string | null;
  scope: RaffleScope;
  referenceDate?: Date | null;
  activityId?: string | null;
  minAttendanceMinutes: number;
  winnersCount: number;
  allowPriorEventWinners: boolean;
}

export async function createRaffle(
  input: CreateRaffleInput,
): Promise<RaffleResult<{ raffleId: string }>> {
  const validation = validateRaffleConfig({
    scope: input.scope,
    referenceDate: input.referenceDate,
    activityId: input.activityId,
    minAttendanceMinutes: input.minAttendanceMinutes,
    winnersCount: input.winnersCount,
    title: input.title,
  });

  if (!validation.valid) {
    return {
      ok: false as const,
      code: 'INVALID_INPUT',
      message: 'Configuração do sorteio inválida.',
      details: validation.errors,
    };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      if (input.scope === 'ACTIVITY' && input.activityId) {
        const activity = await tx.activity.findFirst({
          where: { id: input.activityId, eventId: input.eventId, deletedAt: null },
          select: { id: true },
        });

        if (!activity) {
          return {
            ok: false as const,
            code: 'NOT_FOUND' as const,
            message: 'Atividade não encontrada neste evento.',
          };
        }
      }

      /**
       * A data de referência é gravada como DATA (sem hora) no fuso da instituição:
       * o recorte do sorteio é "o dia", e guardar um instante com hora abriria
       * espaço para interpretações diferentes na hora de conferir.
       */
      let referenceDate: Date | null = null;

      if (input.scope === 'DAY' && input.referenceDate) {
        const tenant = await tx.tenant.findUnique({
          where: { id: input.tenantId },
          select: { timezone: true },
        });

        referenceDate = new Date(
          `${dayKey(input.referenceDate, tenant?.timezone ?? 'UTC')}T00:00:00.000Z`,
        );
      }

      const id = randomUUID();

      await tx.raffle.create({
        data: {
          id,
          tenantId: input.tenantId,
          eventId: input.eventId,
          activityId: input.scope === 'ACTIVITY' ? (input.activityId ?? null) : null,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          scope: input.scope,
          referenceDate,
          minAttendanceMinutes: input.minAttendanceMinutes,
          winnersCount: input.winnersCount,
          allowPriorEventWinners: input.allowPriorEventWinners,
          status: 'DRAFT',
          createdById: input.actorId,
        },
        select: { id: true },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'raffle',
          entityId: id,
          changes: {
            title: { from: null, to: input.title },
            scope: { from: null, to: input.scope },
            winnersCount: { from: null, to: input.winnersCount },
            minAttendanceMinutes: { from: null, to: input.minAttendanceMinutes },
          },
        },
        tx,
      );

      return { ok: true as const, raffleId: id };
    });
  } catch (error) {
    console.error(`[raffles] falha ao criar sorteio: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível criar o sorteio.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Apuração
// ───────────────────────────────────────────────────────────────────────────────
export interface DrawOutcome {
  raffleId: string;
  eligibleCount: number;
  inspectedAttendances: number;
  winners: { position: number; userId: string; userName: string; minutes: number }[];
  resultHash: string;
  drawnAt: Date;
  drawVersion: number;
  /** Quantos vencedores foram sorteados a menos que o pedido. */
  shortfall: number;
}

/**
 * Executa a apuração.
 *
 * O `randomInt` é injetável para que os testes sejam determinísticos (mesma
 * decisão da FASE 5 no sorteio de cartas); em produção vem de `crypto.randomInt`.
 */
export async function drawRaffle(input: {
  tenantId: string;
  raffleId: string;
  actorId: string;
  now?: Date;
  randomInt?: (max: number) => number;
}): Promise<RaffleResult<DrawOutcome>> {
  const now = input.now ?? new Date();
  const random = input.randomInt ?? ((max: number) => randomInt(0, max));

  try {
    return await withTenant(input.tenantId, async (tx) => {
      /**
       * ───────────────────────────────────────────────────────────────────────────
       *  TRAVA PESSIMISTA — O PRIMEIRO CLIQUE VENCE
       * ───────────────────────────────────────────────────────────────────────────
       *  `FOR UPDATE` serializa apurações concorrentes do MESMO sorteio: a segunda
       *  transação espera a primeira terminar e, ao prosseguir, encontra o status
       *  `DRAWN` e é recusada SEM sortear. Sem a trava, as duas leriam o universo
       *  ao mesmo tempo e ambas gravariam vencedores — o segundo INSERT bateria no
       *  índice único, mas o resultado do primeiro já teria sido anunciado.
       */
      await tx.$executeRaw`
        SELECT id FROM "raffles"
         WHERE id = ${input.raffleId}::uuid
           AND "tenantId" = ${input.tenantId}::uuid
         FOR UPDATE
      `;

      const raffle = await loadRaffle(tx, input.tenantId, input.raffleId);

      if (!raffle) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sorteio não encontrado.' };
      }

      if (raffle.status === 'CANCELED') {
        return { ok: false as const, code: 'CANCELED' as const, message: 'Este sorteio foi cancelado.' };
      }

      if (raffle.status === 'DRAWN') {
        return {
          ok: false as const,
          code: 'ALREADY_DRAWN' as const,
          message: `Este sorteio já foi apurado em ${raffle.drawnAt?.toLocaleString('pt-BR') ?? 'data anterior'}. Crie um novo sorteio para uma nova apuração.`,
        };
      }

      const config: RaffleConfig = {
        scope: raffle.scope,
        referenceDate: raffle.referenceDate,
        activityId: raffle.activityId,
        minAttendanceMinutes: raffle.minAttendanceMinutes,
        winnersCount: raffle.winnersCount,
        allowPriorEventWinners: raffle.allowPriorEventWinners,
      };

      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { timezone: true },
      });

      const timeZone = tenant?.timezone ?? 'UTC';

      const [attendances, priorWinnerIds] = await Promise.all([
        loadAttendances(tx, {
          tenantId: input.tenantId,
          eventId: raffle.eventId,
          activityId: config.scope === 'ACTIVITY' ? config.activityId : null,
        }),
        config.allowPriorEventWinners
          ? Promise.resolve<string[]>([])
          : loadPriorWinnerIds(tx, {
              tenantId: input.tenantId,
              eventId: raffle.eventId,
              exceptRaffleId: raffle.id,
            }),
      ]);

      const eligibility = evaluateEligibility({
        attendances,
        config,
        timeZone,
        priorWinnerIds,
      });

      if (eligibility.eligible.length === 0) {
        return {
          ok: false as const,
          code: 'NO_ELIGIBLE' as const,
          message:
            'Nenhum participante elegível com presença comprovada para este recorte. Confira o credenciamento e o piso de minutos.',
        };
      }

      const selected = selectWinners(eligibility.eligible, config.winnersCount, random);

      const drawnAt = now;
      const winners = selected.map((winner, index) => ({
        position: index + 1,
        userId: winner.userId,
        userName: winner.userName,
        minutes: winner.minutes,
        attendanceId: winner.referenceAttendanceId,
      }));

      const resultHash = hashResult(
        buildResultPayload({
          validationVersion: 1,
          raffleId: raffle.id,
          tenantId: input.tenantId,
          eventId: raffle.eventId,
          scope: config.scope,
          activityId: config.activityId,
          referenceDate: raffle.referenceDate
            ? dayKey(raffle.referenceDate, timeZone)
            : null,
          minAttendanceMinutes: config.minAttendanceMinutes,
          winnersCount: config.winnersCount,
          allowPriorEventWinners: config.allowPriorEventWinners,
          eligibleCount: eligibility.eligible.length,
          drawnAt: drawnAt.toISOString(),
          winners: winners.map((winner) => ({
            position: winner.position,
            userId: winner.userId,
            minutes: winner.minutes,
          })),
        }),
      );

      /**
       * ───────────────────────────────────────────────────────────────────────────
       *  ORDEM: MARCA O SORTEIO E DEPOIS GRAVA OS VENCEDORES
       * ───────────────────────────────────────────────────────────────────────────
       *  O `UPDATE` condicional (`status = DRAFT`) é a segunda barreira: se outra
       *  transação tiver apurado entre a leitura e a escrita, ele afeta 0 linhas e
       *  a apuração é abortada antes de gravar vencedores órfãos.
       */
      const claimed = await tx.raffle.updateMany({
        where: { id: raffle.id, status: 'DRAFT' },
        data: {
          status: 'DRAWN',
          drawnAt,
          eligibleCount: eligibility.eligible.length,
          inspectedAttendances: eligibility.inspectedAttendances,
          resultHash,
          drawVersion: raffle.drawVersion + 1,
        },
      });

      if (claimed.count === 0) {
        return {
          ok: false as const,
          code: 'ALREADY_DRAWN' as const,
          message: 'Este sorteio foi apurado por outra pessoa enquanto você confirmava.',
        };
      }

      await tx.raffleWinner.createMany({
        data: winners.map((winner) => ({
          id: randomUUID(),
          tenantId: input.tenantId,
          raffleId: raffle.id,
          userId: winner.userId,
          position: winner.position,
          attendanceMinutes: winner.minutes,
          attendanceId: winner.attendanceId,
          createdAt: drawnAt,
        })),
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'raffle',
          entityId: raffle.id,
          changes: {
            status: { from: 'DRAFT', to: 'DRAWN' },
            eligibleCount: { from: raffle.eligibleCount, to: eligibility.eligible.length },
            winners: {
              from: null,
              to: winners.map((winner) => `${winner.position}º ${winner.userName}`).join(', '),
            },
            resultHash: { from: null, to: resultHash },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        raffleId: raffle.id,
        eligibleCount: eligibility.eligible.length,
        inspectedAttendances: eligibility.inspectedAttendances,
        winners,
        resultHash,
        drawnAt,
        drawVersion: raffle.drawVersion + 1,
        shortfall: Math.max(0, config.winnersCount - winners.length),
      };
    });
  } catch (error) {
    /**
     * Corrida perdida no índice único `(raffleId, userId)`: significa que uma
     * apuração simultânea gravou o mesmo vencedor. A transação inteira foi
     * desfeita — então o estado do banco continua sendo UMA apuração.
     */
    if (isUniqueViolation(error)) {
      const index = violatedIndexName(error);

      return {
        ok: false as const,
        code: 'ALREADY_DRAWN',
        message:
          index === 'raffle_winners_raffleId_position_key'
            ? 'Outra apuração gravou os mesmos vencedores no mesmo instante.'
            : 'Este sorteio foi apurado por outra pessoa no mesmo instante.',
      };
    }

    console.error(`[raffles] falha na apuração: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível executar o sorteio.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura
// ───────────────────────────────────────────────────────────────────────────────
export interface RaffleSummary {
  id: string;
  title: string;
  description: string | null;
  scope: RaffleScope;
  activityId: string | null;
  activityTitle: string | null;
  referenceDate: Date | null;
  referenceDay: string | null;
  minAttendanceMinutes: number;
  winnersCount: number;
  allowPriorEventWinners: boolean;
  status: string;
  eligibleCount: number;
  inspectedAttendances: number;
  drawnAt: Date | null;
  resultHash: string | null;
  drawVersion: number;
  createdByName: string | null;
  winners: {
    position: number;
    userId: string;
    userName: string;
    minutes: number;
  }[];
}

export async function listRaffles(
  tenantId: string,
  eventId: string,
): Promise<RaffleResult<{ raffles: RaffleSummary[] }>> {
  try {
    const rows = await withTenant(tenantId, (tx) =>
      tx.raffle.findMany({
        where: { tenantId, eventId, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
        select: {
          id: true,
          title: true,
          description: true,
          scope: true,
          activityId: true,
          referenceDate: true,
          minAttendanceMinutes: true,
          winnersCount: true,
          allowPriorEventWinners: true,
          status: true,
          eligibleCount: true,
          inspectedAttendances: true,
          drawnAt: true,
          resultHash: true,
          drawVersion: true,
          activity: { select: { title: true } },
          createdBy: { select: { name: true } },
          winners: {
            orderBy: { position: 'asc' },
            select: { position: true, userId: true, attendanceMinutes: true, user: { select: { name: true } } },
          },
        },
      }),
    );

    return {
      ok: true as const,
      raffles: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        scope: row.scope,
        activityId: row.activityId,
        activityTitle: row.activity?.title ?? null,
        referenceDate: row.referenceDate,
        referenceDay: row.referenceDate ? row.referenceDate.toISOString().slice(0, 10) : null,
        minAttendanceMinutes: row.minAttendanceMinutes,
        winnersCount: row.winnersCount,
        allowPriorEventWinners: row.allowPriorEventWinners,
        status: row.status,
        eligibleCount: row.eligibleCount,
        inspectedAttendances: row.inspectedAttendances,
        drawnAt: row.drawnAt,
        resultHash: row.resultHash,
        drawVersion: row.drawVersion,
        createdByName: row.createdBy?.name ?? null,
        winners: row.winners.map((winner) => ({
          position: winner.position,
          userId: winner.userId,
          userName: winner.user?.name ?? 'Participante',
          minutes: winner.attendanceMinutes,
        })),
      })),
    };
  } catch (error) {
    console.error(`[raffles] falha ao listar sorteios: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar os sorteios.' };
  }
}

/** Cancela um sorteio ainda não apurado (o histórico permanece). */
export async function cancelRaffle(input: {
  tenantId: string;
  raffleId: string;
  actorId: string;
  reason: string;
}): Promise<RaffleResult<{ status: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const raffle = await loadRaffle(tx, input.tenantId, input.raffleId);

      if (!raffle) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sorteio não encontrado.' };
      }

      if (raffle.status === 'DRAWN') {
        return {
          ok: false as const,
          code: 'ALREADY_DRAWN' as const,
          message:
            'Sorteio já apurado não pode ser cancelado: o resultado é público. Crie outro sorteio, se necessário.',
        };
      }

      await tx.raffle.update({
        where: { id: raffle.id },
        data: { status: 'CANCELED' },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'raffle',
          entityId: raffle.id,
          changes: {
            status: { from: raffle.status, to: 'CANCELED' },
            reason: { from: null, to: input.reason },
          },
        },
        tx,
      );

      return { ok: true as const, status: 'CANCELED' };
    });
  } catch (error) {
    console.error(`[raffles] falha ao cancelar sorteio: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível cancelar o sorteio.' };
  }
}

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
  RESULT_PAYLOAD_VERSION,
  buildResultPayload,
  createSeededRandomInt,
  dayKey,
  evaluateEligibility,
  evaluateReadiness,
  hashResult,
  publicWinnerName,
  resolveRafflePage,
  seedCommitment,
  selectWeightedWinners,
  selectWinners,
  validateRaffleConfig,
  type AttendanceSample,
  type EligibleParticipant,
  type RaffleConfig,
  type RaffleReadiness,
  type RaffleScope,
  type RaffleWinnerKind,
} from '@/domain/raffles/raffle-rules';
import { createRaffleSeed, sealSeed, unsealSeed } from '@/lib/raffles/seed-vault';

export type RaffleErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'NO_ELIGIBLE'
  | 'ALREADY_DRAWN'
  | 'CANCELED'
  | 'NOT_DRAWN'
  | 'ALREADY_DELIVERED'
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
  alternatesCount: number;
  weightByMinutes: boolean;
  isPublic: boolean;
  seedCommitment: string | null;
  seedSealed: string | null;
  seedRevealed: string | null;
  resultVersion: number;
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
      alternatesCount: true,
      weightByMinutes: true,
      isPublic: true,
      seedCommitment: true,
      seedSealed: true,
      seedRevealed: true,
      resultVersion: true,
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
      /**
       * Só TITULARES entram na exclusão (FASE 16). O suplente não ganhou nada: ele
       * é a reserva de quem não aparecer. Tirá-lo do páreo dos próximos sorteios
       * seria punir alguém por ter ficado em segundo na ordem — e o efeito prático
       * seria esvaziar o pool justamente nos eventos com muitos sorteios.
       */
      kind: 'WINNER',
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
        readiness: evaluateReadiness(
          result.eligible.length,
          input.config.winnersCount,
          input.config.alternatesCount ?? 0,
        ),
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
  /** Quantos suplentes sortear (FASE 16). `0` = nenhum. */
  alternatesCount?: number;
  /** Chance proporcional aos minutos assistidos (FASE 16). */
  weightByMinutes?: boolean;
  /** Publicar o resultado na página do evento (FASE 16). */
  isPublic?: boolean;
  allowPriorEventWinners: boolean;
}

export async function createRaffle(
  input: CreateRaffleInput,
): Promise<RaffleResult<{ raffleId: string; seedCommitment: string | null }>> {
  const validation = validateRaffleConfig({
    scope: input.scope,
    referenceDate: input.referenceDate,
    activityId: input.activityId,
    minAttendanceMinutes: input.minAttendanceMinutes,
    winnersCount: input.winnersCount,
    alternatesCount: input.alternatesCount ?? 0,
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

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  SEMENTE SELADA NA CRIAÇÃO (commit-reveal, item G4)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O compromisso (`sha256` da semente) nasce AQUI, antes de existir elegível, e é
   *  o que dá sentido à palavra "antes": publicar o compromisso depois da apuração
   *  não provaria nada. A semente em si vai selada para o banco.
   */
  const seed = createRaffleSeed();
  const commitment = seedCommitment(seed);
  const sealed = sealSeed(seed);

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
          alternatesCount: input.alternatesCount ?? 0,
          weightByMinutes: input.weightByMinutes ?? false,
          isPublic: input.isPublic ?? false,
          allowPriorEventWinners: input.allowPriorEventWinners,
          // O compromisso só existe quando o cofre está configurado; sem ele o
          // sorteio roda com o gerador do sistema e a tela diz que não há prova.
          seedCommitment: sealed ? commitment : null,
          seedSealed: sealed,
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
            alternatesCount: { from: null, to: input.alternatesCount ?? 0 },
            weightByMinutes: { from: null, to: input.weightByMinutes ?? false },
            minAttendanceMinutes: { from: null, to: input.minAttendanceMinutes },
            // O COMPROMISSO entra na trilha: é a prova de que ele existia antes da
            // apuração, com data e autor. A semente, não.
            seedCommitment: { from: null, to: sealed ? commitment : null },
          },
        },
        tx,
      );

      return { ok: true as const, raffleId: id, seedCommitment: sealed ? commitment : null };
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
  winners: {
    position: number;
    userId: string;
    userName: string;
    minutes: number;
    kind: RaffleWinnerKind;
  }[];
  resultHash: string;
  drawnAt: Date;
  drawVersion: number;
  /** Quantos vencedores foram sorteados a menos que o pedido (titulares + suplentes). */
  shortfall: number;
  /** Semente revelada nesta apuração (prova do commit-reveal). `null` sem cofre. */
  seedRevealed: string | null;
  /** Compromisso publicado na criação, para conferência imediata na tela. */
  seedCommitment: string | null;
  /** O sorteio usou a semente comprometida (e não o gerador do sistema)? */
  seeded: boolean;
  /** Titulares e suplentes efetivamente sorteados. */
  winnersDrawn: number;
  alternatesDrawn: number;
}

/**
 * Executa a apuração.
 *
 * O `randomInt` é injetável para que os testes sejam determinísticos (mesma
 * decisão da FASE 5 no sorteio de cartas); em produção vem de `crypto.randomInt`.
 *
 * Desde a FASE 16 ele é o FALLBACK: quando o sorteio tem semente comprometida e o
 * cofre está configurado, quem sorteia é `createSeededRandomInt(semente)` — é o que
 * torna o resultado reproduzível por terceiros. O gerador injetado continua valendo
 * para sorteios sem compromisso (dados antigos e ambientes sem segredo).
 */
export async function drawRaffle(input: {
  tenantId: string;
  raffleId: string;
  actorId: string;
  now?: Date;
  randomInt?: (max: number) => number;
}): Promise<RaffleResult<DrawOutcome>> {
  const now = input.now ?? new Date();

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
        alternatesCount: raffle.alternatesCount,
        weightByMinutes: raffle.weightByMinutes,
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

      /**
       * ───────────────────────────────────────────────────────────────────────────
       *  A SEMENTE MANDA NO SORTEIO QUANDO EXISTE (item G4)
       * ───────────────────────────────────────────────────────────────────────────
       *  Com o cofre configurado, o sorteio é DETERMINÍSTICO a partir da semente
       *  comprometida na criação: é isso que permite a qualquer pessoa reproduzir o
       *  resultado depois. Sem cofre (ambiente sem segredo), cai no gerador do
       *  sistema e o resultado continua auditável por hash, mas não reproduzível —
       *  e a resposta diz qual dos dois aconteceu.
       */
      const revealedSeed = unsealSeed(raffle.seedSealed);
      const random = revealedSeed
        ? createSeededRandomInt(revealedSeed)
        : (input.randomInt ?? ((max: number) => randomInt(0, max)));

      const wanted = config.winnersCount + (config.alternatesCount ?? 0);
      const drawnPool = config.weightByMinutes
        ? selectWeightedWinners(eligibility.eligible, wanted, random)
        : selectWinners(eligibility.eligible, wanted, random);

      const drawnAt = now;
      const winners = drawnPool.map((winner, index) => ({
        position: index + 1,
        userId: winner.userId,
        userName: winner.userName,
        minutes: winner.minutes,
        attendanceId: winner.referenceAttendanceId,
        kind: (index < config.winnersCount ? 'WINNER' : 'ALTERNATE') as RaffleWinnerKind,
      }));

      const winnersDrawn = winners.filter((winner) => winner.kind === 'WINNER').length;
      const alternatesDrawn = winners.length - winnersDrawn;

      const resultHash = hashResult(
        buildResultPayload({
          validationVersion: RESULT_PAYLOAD_VERSION,
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
          alternatesCount: config.alternatesCount ?? 0,
          weightByMinutes: config.weightByMinutes ?? false,
          eligibleCount: eligibility.eligible.length,
          drawnAt: drawnAt.toISOString(),
          winners: winners.map((winner) => ({
            position: winner.position,
            userId: winner.userId,
            minutes: winner.minutes,
            kind: winner.kind,
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
          resultVersion: RESULT_PAYLOAD_VERSION,
          seedRevealed: revealedSeed,
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
          kind: winner.kind,
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
              to: winners
                .map(
                  (winner) =>
                    `${winner.position}º ${winner.userName}${winner.kind === 'ALTERNATE' ? ' (suplente)' : ''}`,
                )
                .join(', '),
            },
            resultHash: { from: null, to: resultHash },
            resultVersion: { from: raffle.resultVersion, to: RESULT_PAYLOAD_VERSION },
            // A semente revelada entra na trilha: é o que fecha o commit-reveal.
            seedRevealed: { from: null, to: revealedSeed },
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
        shortfall: Math.max(0, wanted - winners.length),
        seedRevealed: revealedSeed,
        seedCommitment: raffle.seedCommitment,
        seeded: revealedSeed !== null,
        winnersDrawn,
        alternatesDrawn,
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
  alternatesCount: number;
  weightByMinutes: boolean;
  isPublic: boolean;
  allowPriorEventWinners: boolean;
  status: string;
  eligibleCount: number;
  inspectedAttendances: number;
  drawnAt: Date | null;
  resultHash: string | null;
  resultVersion: number;
  seedCommitment: string | null;
  seedRevealed: string | null;
  drawVersion: number;
  createdByName: string | null;
  winners: {
    /** Id da POSIÇÃO sorteada — é ele que o registro de entrega usa. */
    id: string;
    position: number;
    userId: string;
    userName: string;
    minutes: number;
    kind: RaffleWinnerKind;
    deliveredAt: Date | null;
    deliveredByName: string | null;
    deliveryNote: string | null;
  }[];
}

export interface RaffleList {
  raffles: RaffleSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Histórico paginado dos sorteios do evento (item G6).
 *
 * Antes havia um teto fixo de 100 e o começo da lista desaparecia sem aviso em
 * eventos com muitos sorteios. Agora a página é explícita e o total vem junto, para
 * que a tela possa mostrar "página 2 de 4" em vez de fingir que acabou.
 */
export async function listRaffles(
  tenantId: string,
  eventId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<RaffleResult<RaffleList>> {
  try {
    const data = await withTenant(tenantId, async (tx) => {
      const total = await tx.raffle.count({ where: { tenantId, eventId, deletedAt: null } });
      const pagination = resolveRafflePage({
        page: options.page,
        pageSize: options.pageSize,
        total,
      });

      const rows = await tx.raffle.findMany({
        where: { tenantId, eventId, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          scope: true,
          activityId: true,
          referenceDate: true,
          minAttendanceMinutes: true,
          winnersCount: true,
          alternatesCount: true,
          weightByMinutes: true,
          isPublic: true,
          allowPriorEventWinners: true,
          status: true,
          eligibleCount: true,
          inspectedAttendances: true,
          drawnAt: true,
          resultHash: true,
          resultVersion: true,
          seedCommitment: true,
          seedRevealed: true,
          drawVersion: true,
          activity: { select: { title: true } },
          createdBy: { select: { name: true } },
          winners: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              userId: true,
              kind: true,
              attendanceMinutes: true,
              deliveredAt: true,
              deliveryNote: true,
              user: { select: { name: true } },
              deliveredBy: { select: { name: true } },
            },
          },
        },
      });

      return { rows, pagination };
    });

    return {
      ok: true as const,
      raffles: data.rows.map((row) => ({
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
        alternatesCount: row.alternatesCount,
        weightByMinutes: row.weightByMinutes,
        isPublic: row.isPublic,
        allowPriorEventWinners: row.allowPriorEventWinners,
        status: row.status,
        eligibleCount: row.eligibleCount,
        inspectedAttendances: row.inspectedAttendances,
        drawnAt: row.drawnAt,
        resultHash: row.resultHash,
        resultVersion: row.resultVersion,
        seedCommitment: row.seedCommitment,
        seedRevealed: row.seedRevealed,
        drawVersion: row.drawVersion,
        createdByName: row.createdBy?.name ?? null,
        winners: row.winners.map((winner) => ({
          id: winner.id,
          position: winner.position,
          userId: winner.userId,
          userName: winner.user?.name ?? 'Participante',
          minutes: winner.attendanceMinutes,
          kind: winner.kind,
          deliveredAt: winner.deliveredAt,
          deliveredByName: winner.deliveredBy?.name ?? null,
          deliveryNote: winner.deliveryNote,
        })),
      })),
      page: data.pagination.page,
      pageSize: data.pagination.pageSize,
      total: data.pagination.total,
      totalPages: data.pagination.totalPages,
    };
  } catch (error) {
    console.error(`[raffles] falha ao listar sorteios: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar os sorteios.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Entrega do prêmio (item G2)
// ───────────────────────────────────────────────────────────────────────────────
export interface PrizeDelivery {
  raffleId: string;
  positionId: string;
  userId: string;
  userName: string;
  deliveredAt: Date;
  deliveredByName: string | null;
  note: string | null;
}

/**
 * Registra a retirada do prêmio por uma POSIÇÃO sorteada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PARÂMETRO É O ID DA POSIÇÃO, E NÃO O ID DA PESSOA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A mesma pessoa pode ocupar posições em sorteios diferentes, e quem entrega o
 *  prêmio está olhando para UMA posição daquele sorteio. A primeira versão recebia
 *  `winnerId` e casava com o id da LINHA enquanto a tela mandava o id da PESSOA —
 *  um `NOT_FOUND` silencioso que o teste de integração pegou. O nome do parâmetro
 *  agora diz o que ele é: `positionId`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É UM REGISTRO, E NÃO UM "CHECK"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem está no balcão entregando precisa saber quem JÁ retirou — e a pergunta
 *  "fulano já pegou?" não pode depender da memória de quem estava lá antes. O
 *  registro fica na posição sorteada, com autor e horário, e entra na trilha.
 *
 *  Marcar duas vezes NÃO sobrescreve: devolve `ALREADY_DELIVERED` com quem entregou
 *  e quando. Um recibo que pode ser reescrito em silêncio não serve como recibo.
 */
export async function markPrizeDelivered(input: {
  tenantId: string;
  raffleId: string;
  positionId: string;
  actorId: string;
  note?: string | null;
}): Promise<RaffleResult<PrizeDelivery>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const raffle = await loadRaffle(tx, input.tenantId, input.raffleId);

      if (!raffle) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sorteio não encontrado.' };
      }

      if (raffle.status !== 'DRAWN') {
        return {
          ok: false as const,
          code: 'NOT_DRAWN' as const,
          message: 'Só é possível registrar entrega de um sorteio já apurado.',
        };
      }

      const position = await tx.raffleWinner.findFirst({
        where: { id: input.positionId, raffleId: raffle.id, tenantId: input.tenantId },
        select: {
          id: true,
          userId: true,
          kind: true,
          deliveredAt: true,
          user: { select: { name: true } },
          deliveredBy: { select: { name: true } },
        },
      });

      if (!position) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Posição sorteada não encontrada neste sorteio.',
        };
      }

      if (position.deliveredAt) {
        return {
          ok: false as const,
          code: 'ALREADY_DELIVERED' as const,
          message: `A entrega já foi registrada para ${position.user?.name ?? 'esta pessoa'} em ${position.deliveredAt.toLocaleString('pt-BR')}${position.deliveredBy?.name ? ` por ${position.deliveredBy.name}` : ''}.`,
        };
      }

      const deliveredAt = new Date();

      await tx.raffleWinner.update({
        where: { id: position.id },
        data: {
          deliveredAt,
          deliveredById: input.actorId,
          deliveryNote: input.note?.trim() || null,
        },
      });

      const delivery: PrizeDelivery = {
        raffleId: raffle.id,
        positionId: position.id,
        userId: position.userId,
        userName: position.user?.name ?? 'Participante',
        deliveredAt,
        deliveredByName: null,
        note: input.note?.trim() || null,
      };

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'rafflePrize',
          entityId: position.id,
          changes: {
            kind: { from: null, to: position.kind },
            deliveredAt: { from: null, to: deliveredAt.toISOString() },
            note: { from: null, to: delivery.note },
          },
        },
        tx,
      );

      return { ok: true as const, ...delivery };
    });
  } catch (error) {
    console.error(`[raffles] falha ao registrar entrega: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível registrar a entrega.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Visibilidade do resultado (item G5)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Liga ou desliga a publicação do resultado na página do evento.
 *
 * Só depois de apurado: publicar um sorteio sem resultado não mostraria nada, e o
 * organizador que quisesse anunciar antes teria uma página vazia com o título do
 * prêmio — que é justamente a informação que não deve vazar antes da hora.
 */
export async function setRaffleVisibility(input: {
  tenantId: string;
  raffleId: string;
  actorId: string;
  isPublic: boolean;
}): Promise<RaffleResult<{ raffleId: string; isPublic: boolean }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const raffle = await loadRaffle(tx, input.tenantId, input.raffleId);

      if (!raffle) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sorteio não encontrado.' };
      }

      if (input.isPublic && raffle.status !== 'DRAWN') {
        return {
          ok: false as const,
          code: 'NOT_DRAWN' as const,
          message: 'Apure o sorteio antes de publicar o resultado.',
        };
      }

      await tx.raffle.update({
        where: { id: raffle.id },
        data: { isPublic: input.isPublic },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'raffle',
          entityId: raffle.id,
          changes: { isPublic: { from: raffle.isPublic, to: input.isPublic } },
        },
        tx,
      );

      return { ok: true as const, raffleId: raffle.id, isPublic: input.isPublic };
    });
  } catch (error) {
    console.error(`[raffles] falha ao alterar visibilidade: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível alterar a publicação do resultado.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura pública (item G5)
// ───────────────────────────────────────────────────────────────────────────────
export interface PublicRaffleResult {
  id: string;
  title: string;
  description: string | null;
  drawnAt: Date;
  resultHash: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  winners: { position: number; name: string; masked: boolean }[];
  alternates: { position: number; name: string; masked: boolean }[];
}

/**
 * Resultados publicados de um evento — para a página pública, sem login.
 *
 * O nome sai MASCARADO por padrão (`publicWinnerName`): quem se credenciou não
 * consentiu em ter o nome publicado na internet. Quem tem perfil público
 * (`User.isPublicProfile`) aparece com o nome completo — consentimento explícito.
 *
 * O hash e a semente revelada vão junto de propósito: publicar só o nome transforma
 * o sorteio em promessa. Publicando a prova, qualquer pessoa confere.
 */
export async function listPublicRaffleResults(
  tenantId: string,
  eventId: string,
): Promise<PublicRaffleResult[]> {
  try {
    const rows = await withTenant(tenantId, (tx) =>
      tx.raffle.findMany({
        where: { tenantId, eventId, deletedAt: null, isPublic: true, status: 'DRAWN' },
        orderBy: [{ drawnAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          title: true,
          description: true,
          drawnAt: true,
          createdAt: true,
          resultHash: true,
          seedCommitment: true,
          seedRevealed: true,
          winners: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              kind: true,
              user: { select: { name: true, isPublicProfile: true } },
            },
          },
        },
      }),
    );

    return rows.map((row) => {
      const mapped = row.winners.map((winner) => {
        const publicProfile = winner.user?.isPublicProfile ?? false;

        return {
          position: winner.position,
          kind: winner.kind,
          name: publicWinnerName({
            name: winner.user?.name ?? 'Participante',
            publicProfile,
          }),
          masked: !publicProfile,
        };
      });

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        // `status = DRAWN` garante `drawnAt`; a coluna é anulável no banco, então a
        // criação é o fallback (nunca a data zero, que apareceria como 1970).
        drawnAt: row.drawnAt ?? row.createdAt,
        resultHash: row.resultHash,
        seedCommitment: row.seedCommitment,
        seedRevealed: row.seedRevealed,
        winners: mapped
          .filter((winner) => winner.kind === 'WINNER')
          .map(({ position, name, masked }) => ({ position, name, masked })),
        alternates: mapped
          .filter((winner) => winner.kind === 'ALTERNATE')
          .map(({ position, name, masked }) => ({ position, name, masked })),
      };
    });
  } catch (error) {
    console.error(`[raffles] falha ao carregar resultados públicos: ${errorMessage(error)}`);
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Prévia ao vivo (item G7)
// ───────────────────────────────────────────────────────────────────────────────
export interface LiveEligibility {
  eligibleCount: number;
  inspectedAttendances: number;
  /** Último check-in registrado no recorte — o que faz o número subir no palco. */
  lastCheckInAt: Date | null;
  sampledAt: Date;
}

/**
 * Contagem de elegíveis AGORA, para a tela se atualizar sozinha (item G7).
 *
 * Reusa `previewEligibility` de propósito: duas implementações da mesma contagem
 * divergiriam, e a tela mostraria um número diferente do que a apuração usaria —
 * exatamente o tipo de discrepância que corrói a confiança no sorteio. O custo é
 * aceitável porque a consulta é limitada (`MAX_INSPECTED_ATTENDANCES`).
 */
export async function getLiveEligibility(input: {
  tenantId: string;
  eventId: string;
  config: RaffleConfig;
}): Promise<RaffleResult<LiveEligibility>> {
  const preview = await previewEligibility({
    tenantId: input.tenantId,
    eventId: input.eventId,
    config: input.config,
  });

  if (!preview.ok) return preview;

  const last = await withTenant(input.tenantId, (tx) =>
    tx.attendance.aggregate({
      where: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        ...(input.config.scope === 'ACTIVITY' && input.config.activityId
          ? { activityId: input.config.activityId }
          : {}),
      },
      _max: { checkedInAt: true },
    }),
  );

  return {
    ok: true as const,
    eligibleCount: preview.preview.eligible.length,
    inspectedAttendances: preview.preview.inspectedAttendances,
    lastCheckInAt: last._max.checkedInAt ?? null,
    sampledAt: new Date(),
  };
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

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
  MAX_ALTERNATES,
  MAX_WINNERS,
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
import { LEGACY_SEED_KEY_VERSION } from '@/domain/raffles/seed-key-rules';
import {
  canonicalPool,
  compareDraw,
  findDuplicateCodes,
  poolEntryCode,
  poolHash,
  reproduceDraw,
  type RafflePoolEntry,
} from '@/domain/raffles/pool-rules';
import {
  evaluateDeliveryReversal,
  rafflePublicationState,
  type RaffleHistoryFilter,
  type RaffleStatus,
} from '@/domain/raffles/stage-rules';
import {
  canDrawRound,
  canPrepareRound,
  lastDrawnRound,
  normalizePrizeDescription,
  normalizePrizeTitle,
  pendingRound,
  roundStateOf,
  type RoundState,
} from '@/domain/raffles/round-rules';

export type RaffleErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'NO_ELIGIBLE'
  | 'ALREADY_DRAWN'
  | 'CANCELED'
  | 'NOT_DRAWN'
  /**
   * FASE 30: não há rodada preparada para apurar. Não é "já foi apurado" — é "falta
   * preparar o próximo momento", e a tela precisa dizer isso com essas palavras.
   */
  | 'NO_PENDING_ROUND'
  /**
   * FASE 30: já existe uma rodada preparada e não apurada. Uma rodada por vez — dois
   * compromissos no ar deixariam o telão sem saber o que anunciar.
   */
  | 'PENDING_ROUND'
  | 'ALREADY_DELIVERED'
  /** FASE 22 (G8): desfazer entrega — a posição não tem entrega registrada. */
  | 'NOT_DELIVERED'
  /** FASE 22 (G8): desfazer entrega — o motivo é obrigatório. */
  | 'REASON_REQUIRED'
  | 'INTERNAL';

export type RaffleResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      code: RaffleErrorCode;
      message: string;
      details?: readonly string[];
    };

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
  /**
   * Campos de semente/resultado da RAFFLE — LEGADO CONGELADO (FASE 30).
   *
   * Continuam sendo lidos por um motivo só: sorteio apurado ANTES das rodadas tem o
   * compromisso aqui, e a rodada 1 do histórico foi copiada destas colunas. Quem
   * apura agora escreve na RODADA; nada novo entra aqui.
   */
  seedCommitment: string | null;
  seedSealed: string | null;
  seedRevealed: string | null;
  /** Versão da chave do cofre que selou a semente (FASE 22, item G12). */
  seedKeyVersion: number;
  resultVersion: number;
  allowPriorEventWinners: boolean;
  status: string;
  eligibleCount: number;
  inspectedAttendances: number;
  drawnAt: Date | null;
  resultHash: string | null;
  drawVersion: number;
  createdById: string;
  /** Rodadas do sorteio, da primeira para a última (FASE 30). */
  rounds: RaffleRoundRow[];
}

/** Uma rodada como o serviço precisa dela para decidir e para gravar. */
export interface RaffleRoundRow {
  id: string;
  roundNumber: number;
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorId: string | null;
  winnersCount: number;
  alternatesCount: number;
  seedCommitment: string | null;
  seedSealed: string | null;
  seedRevealed: string | null;
  seedKeyVersion: number;
  resultHash: string | null;
  resultVersion: number;
  eligibleCount: number;
  drawnAt: Date | null;
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
      seedKeyVersion: true,
      resultVersion: true,
      allowPriorEventWinners: true,
      status: true,
      eligibleCount: true,
      inspectedAttendances: true,
      drawnAt: true,
      resultHash: true,
      drawVersion: true,
      createdById: true,
      rounds: {
        orderBy: { roundNumber: 'asc' },
        select: {
          id: true,
          roundNumber: true,
          prizeTitle: true,
          prizeDescription: true,
          sponsorId: true,
          winnersCount: true,
          alternatesCount: true,
          seedCommitment: true,
          seedSealed: true,
          seedRevealed: true,
          seedKeyVersion: true,
          resultHash: true,
          resultVersion: true,
          eligibleCount: true,
          drawnAt: true,
        },
      },
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

/**
 * Quem já ganhou NESTE sorteio, em qualquer rodada (FASE 30).
 *
 * Diferente de `loadPriorWinnerIds` (que olha OUTROS sorteios do evento e só vale
 * quando a flag está desligada), esta lista vale sempre: num sorteio com vários
 * momentos, quem saiu na rodada 1 não concorre na 2 — e o telão precisa da mesma
 * regra para não rolar um nome que não podia ganhar.
 */
async function loadRaffleWinnerIds(tx: TxClient, raffleId: string): Promise<string[]> {
  const rows = await tx.raffleWinner.findMany({
    where: { raffleId },
    select: { userId: true },
  });

  return rows.map((row) => row.userId);
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
      tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { timezone: true },
      }),
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
          : loadPriorWinnerIds(tx, {
              tenantId: input.tenantId,
              eventId: input.eventId,
            }),
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
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível calcular os elegíveis.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criação
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Valida o patrocinador do prêmio (FASE 30).
 *
 * Aceita o patrocinador DESTE evento e o cadastro da instituição (`eventId` nulo,
 * que a FASE 17 permite). Devolve `undefined` quando o id não corresponde a um
 * patrocinador válido: o chamador transforma isso em RECUSA, porque "não encontrei"
 * e "não informei" são coisas diferentes — e gravar um id inexistente com `?? null`
 * apagaria a escolha sem dizer nada.
 */
async function resolvePrizeSponsor(
  tx: TxClient,
  input: { tenantId: string; eventId: string; sponsorId?: string | null },
): Promise<string | null | undefined> {
  if (!input.sponsorId) return null;

  const sponsor = await tx.sponsor.findFirst({
    where: {
      id: input.sponsorId,
      tenantId: input.tenantId,
      deletedAt: null,
      OR: [{ eventId: input.eventId }, { eventId: null }],
    },
    select: { id: true },
  });

  return sponsor?.id;
}

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
  /** Prêmio anunciado na primeira rodada (FASE 30). Opcional. */
  prizeTitle?: string | null;
  prizeDescription?: string | null;
  /** Patrocinador que deu o prêmio (FASE 30). Opcional. */
  sponsorId?: string | null;
}

export async function createRaffle(input: CreateRaffleInput): Promise<
  RaffleResult<{
    raffleId: string;
    roundId: string;
    seedCommitment: string | null;
  }>
> {
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
   *  SEMENTE SELADA NA CRIAÇÃO (commit-reveal, item G4 · rodada 1 na FASE 30)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O compromisso (`sha256` da semente) nasce AQUI, antes de existir elegível, e é
   *  o que dá sentido à palavra "antes": publicar o compromisso depois da apuração
   *  não provaria nada. A semente em si vai selada para o banco.
   *
   *  Desde a FASE 30 o compromisso pertence à RODADA 1, criada junto com o sorteio —
   *  é a mesma cerimônia, agora repetível a cada momento.
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
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Evento não encontrado.',
        };
      }

      if (input.scope === 'ACTIVITY' && input.activityId) {
        const activity = await tx.activity.findFirst({
          where: {
            id: input.activityId,
            eventId: input.eventId,
            deletedAt: null,
          },
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

      const sponsorId = await resolvePrizeSponsor(tx, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        sponsorId: input.sponsorId,
      });

      if (sponsorId === undefined) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Patrocinador não encontrado neste evento.',
        };
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

        referenceDate = new Date(`${dayKey(input.referenceDate, tenant?.timezone ?? 'UTC')}T00:00:00.000Z`);
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
          status: 'DRAFT',
          createdById: input.actorId,
        },
        select: { id: true },
      });

      /**
       * ── A RODADA 1 NASCE COM O SORTEIO (FASE 30) ─────────────────────────────
       * O compromisso fica publicado desde aqui, e é ele que o telão mostra enquanto
       * o público espera — mesmo que o sorteio só seja apurado horas depois.
       */
      const roundId = randomUUID();

      await tx.raffleRound.create({
        data: {
          id: roundId,
          tenantId: input.tenantId,
          raffleId: id,
          roundNumber: 1,
          prizeTitle: normalizePrizeTitle(input.prizeTitle),
          prizeDescription: normalizePrizeDescription(input.prizeDescription),
          sponsorId: sponsorId ?? null,
          winnersCount: input.winnersCount,
          alternatesCount: input.alternatesCount ?? 0,
          // O compromisso só existe quando o cofre está configurado; sem ele o
          // sorteio roda com o gerador do sistema e a tela diz que não há prova.
          seedCommitment: sealed ? commitment : null,
          seedSealed: sealed?.sealed ?? null,
          /**
           * A VERSÃO vai junto do selo, sempre (FASE 22). Gravar o selo sem a versão
           * faria a abertura usar a chave ATUAL — o defeito que girar a chave
           * provocava: o selo antigo deixaria de abrir.
           */
          seedKeyVersion: sealed?.keyVersion ?? LEGACY_SEED_KEY_VERSION,
          resultVersion: RESULT_PAYLOAD_VERSION,
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
            minAttendanceMinutes: {
              from: null,
              to: input.minAttendanceMinutes,
            },
            // O COMPROMISSO entra na trilha: é a prova de que ele existia antes da
            // apuração, com data e autor. A semente, não.
            seedCommitment: { from: null, to: sealed ? commitment : null },
            seedKeyVersion: { from: null, to: sealed?.keyVersion ?? null },
            prizeTitle: {
              from: null,
              to: normalizePrizeTitle(input.prizeTitle),
            },
          },
        },
        tx,
      );

      /**
       * ── A RODADA 1 TAMBÉM TEM O PRÓPRIO REGISTRO (FASE 30) ──────────────────────
       * A auditoria lê a data e o autor do compromisso no registro CREATE da RODADA
       * (`entityType: 'raffleRound'`), porque é ali que cada momento se prova. Sem
       * este registro, o compromisso da rodada 1 apareceria sem procedência — e a
       * página de auditoria mostraria "Trilha: —" justamente na rodada mais antiga.
       *
       * São dois registros de propósito: um descreve a CONFIGURAÇÃO do sorteio (o que
       * decide elegibilidade) e o outro, o MOMENTO (o que decide o resultado dele).
       */
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'raffleRound',
          entityId: roundId,
          changes: {
            raffleId: { from: null, to: id },
            roundNumber: { from: null, to: 1 },
            prizeTitle: { from: null, to: normalizePrizeTitle(input.prizeTitle) },
            winnersCount: { from: null, to: input.winnersCount },
            alternatesCount: { from: null, to: input.alternatesCount ?? 0 },
            seedCommitment: { from: null, to: sealed ? commitment : null },
            seedKeyVersion: { from: null, to: sealed?.keyVersion ?? null },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        raffleId: id,
        roundId,
        seedCommitment: sealed ? commitment : null,
      };
    });
  } catch (error) {
    console.error(`[raffles] falha ao criar sorteio: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível criar o sorteio.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Apuração — POR RODADA (FASE 30)
//
//  Cada apuração é um MOMENTO: gera as posições seguintes do sorteio, com a semente
//  daquela rodada, a lista daquela rodada e o prêmio anunciado nela. O sorteio deixa
//  de ter "a apuração" e passa a ter rodadas.
// ───────────────────────────────────────────────────────────────────────────────
export interface DrawOutcome {
  raffleId: string;
  roundId: string;
  roundNumber: number;
  /** Primeira posição DESTA rodada (as anteriores continuam no sorteio). */
  firstPosition: number;
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
  /** Compromisso publicado ANTES desta rodada, para conferência imediata na tela. */
  seedCommitment: string | null;
  /** O sorteio usou a semente comprometida (e não o gerador do sistema)? */
  seeded: boolean;
  /** Titulares e suplentes efetivamente sorteados. */
  winnersDrawn: number;
  alternatesDrawn: number;
}

export interface PrepareRoundOutcome {
  raffleId: string;
  roundId: string;
  roundNumber: number;
  seedCommitment: string | null;
}

/**
 * Prepara a próxima rodada: prêmio, patrocinador, quantos sortear — e o COMPROMISSO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O COMPROMISSO NASCE AQUI, E NÃO NA HORA DE APURAR
 * ─────────────────────────────────────────────────────────────────────────────
 *  Preparar é o ato que dá ao telão o que anunciar antes do momento: "próximo prêmio:
 *  fone, patrocinado por X — compromisso: abc…". Sem esta etapa, a segunda rodada
 *  nasceria junto com o próprio resultado, e o público não teria como registrar o
 *  compromisso antes — que é justamente o que a prova exige.
 */
export async function prepareRound(input: {
  tenantId: string;
  raffleId: string;
  actorId: string;
  prizeTitle?: string | null;
  prizeDescription?: string | null;
  sponsorId?: string | null;
  winnersCount?: number;
  alternatesCount?: number;
}): Promise<RaffleResult<PrepareRoundOutcome>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM "raffles"
         WHERE id = ${input.raffleId}::uuid
           AND "tenantId" = ${input.tenantId}::uuid
         FOR UPDATE
      `;

      const raffle = await loadRaffle(tx, input.tenantId, input.raffleId);

      if (!raffle) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Sorteio não encontrado.',
        };
      }

      const decision = canPrepareRound({
        raffleStatus: raffle.status,
        rounds: raffle.rounds,
      });

      if (!decision.ok) {
        return {
          ok: false as const,
          code: decision.code === 'PENDING_ROUND' ? 'PENDING_ROUND' : 'CANCELED',
          message: decision.message,
        };
      }

      const winnersCount = input.winnersCount ?? raffle.winnersCount;
      const alternatesCount = input.alternatesCount ?? raffle.alternatesCount;

      if (
        !Number.isInteger(winnersCount) ||
        winnersCount < 1 ||
        winnersCount > MAX_WINNERS ||
        !Number.isInteger(alternatesCount) ||
        alternatesCount < 0 ||
        alternatesCount > MAX_ALTERNATES
      ) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: `Informe de 1 a ${MAX_WINNERS} titulares e até ${MAX_ALTERNATES} suplentes.`,
        };
      }

      const sponsorId = await resolvePrizeSponsor(tx, {
        tenantId: input.tenantId,
        eventId: raffle.eventId,
        sponsorId: input.sponsorId,
      });

      if (sponsorId === undefined) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Patrocinador não encontrado neste evento.',
        };
      }

      /**
       * A semente é NOVA a cada rodada. Reaproveitar a anterior faria quem leu a
       * revelação da rodada passada prever os ganhadores desta — no palco.
       */
      const seed = createRaffleSeed();
      const commitment = seedCommitment(seed);
      const sealed = sealSeed(seed);
      const roundId = randomUUID();

      await tx.raffleRound.create({
        data: {
          id: roundId,
          tenantId: input.tenantId,
          raffleId: raffle.id,
          roundNumber: decision.roundNumber,
          prizeTitle: normalizePrizeTitle(input.prizeTitle),
          prizeDescription: normalizePrizeDescription(input.prizeDescription),
          sponsorId: sponsorId ?? null,
          winnersCount,
          alternatesCount,
          seedCommitment: sealed ? commitment : null,
          seedSealed: sealed?.sealed ?? null,
          seedKeyVersion: sealed?.keyVersion ?? LEGACY_SEED_KEY_VERSION,
          resultVersion: RESULT_PAYLOAD_VERSION,
          createdById: input.actorId,
        },
        select: { id: true },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'raffleRound',
          entityId: roundId,
          changes: {
            raffleId: { from: null, to: raffle.id },
            roundNumber: { from: null, to: decision.roundNumber },
            prizeTitle: {
              from: null,
              to: normalizePrizeTitle(input.prizeTitle),
            },
            prizeDescription: {
              from: null,
              to: normalizePrizeDescription(input.prizeDescription),
            },
            sponsorId: { from: null, to: sponsorId ?? null },
            winnersCount: { from: null, to: winnersCount },
            alternatesCount: { from: null, to: alternatesCount },
            // O compromisso entra na trilha com data e autor: é a prova de que ele
            // existia ANTES deste momento. A semente, não.
            seedCommitment: { from: null, to: sealed ? commitment : null },
            seedKeyVersion: { from: null, to: sealed?.keyVersion ?? null },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        raffleId: raffle.id,
        roundId,
        roundNumber: decision.roundNumber,
        seedCommitment: sealed ? commitment : null,
      };
    });
  } catch (error) {
    console.error(`[raffles] falha ao preparar a rodada: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível preparar a próxima rodada.',
    };
  }
}

export interface UpdateRoundOutcome {
  raffleId: string;
  roundId: string;
  roundNumber: number;
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorId: string | null;
  sponsorName: string | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ATUALIZAÇÃO DE ANÚNCIO DA RODADA (FASE 35 · DÍVIDA E38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PRÊMIO PODE SER CORRIGIDO DEPOIS DO ANÚNCIO (ADR-145 · ADR-181)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A rodada guarda o prêmio e o patrocinador como ANÚNCIO — fora do documento
 *  assinado criptograficamente. Corrigir um typo no telão, o nome do patrocinador
 *  ou a descrição do brinde não altera a semente, o compromisso, a lista publicada
 *  nem o hash do resultado.
 *
 *  Esta função atualiza o anúncio e grava na trilha de auditoria (`AuditLog`),
 *  mantendo a integridade auditável do sorteio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function updateRoundAnnouncement(input: {
  tenantId: string;
  raffleId: string;
  roundId: string;
  actorId: string;
  prizeTitle?: string | null;
  prizeDescription?: string | null;
  sponsorId?: string | null;
}): Promise<RaffleResult<UpdateRoundOutcome>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const raffle = await loadRaffle(tx, input.tenantId, input.raffleId);

      if (!raffle) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Sorteio não encontrado.',
        };
      }

      if (raffle.status === 'CANCELED') {
        return {
          ok: false as const,
          code: 'CANCELED' as const,
          message: 'Sorteio cancelado não pode ter anúncios alterados.',
        };
      }

      const round = raffle.rounds.find((r) => r.id === input.roundId);
      if (!round) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Rodada não encontrada neste sorteio.',
        };
      }

      const sponsorId = await resolvePrizeSponsor(tx, {
        tenantId: input.tenantId,
        eventId: raffle.eventId,
        sponsorId: input.sponsorId,
      });

      if (sponsorId === undefined) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Patrocinador não encontrado neste evento.',
        };
      }

      const newPrizeTitle = normalizePrizeTitle(input.prizeTitle);
      const newPrizeDescription = normalizePrizeDescription(input.prizeDescription);

      const oldPrizeTitle = round.prizeTitle;
      const oldPrizeDescription = round.prizeDescription;
      const oldSponsorId = round.sponsorId;

      await tx.raffleRound.update({
        where: { id: round.id },
        data: {
          prizeTitle: newPrizeTitle,
          prizeDescription: newPrizeDescription,
          sponsorId: sponsorId ?? null,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'raffleRoundAnnouncement',
          entityId: round.id,
          changes: {
            prizeTitle: { from: oldPrizeTitle, to: newPrizeTitle },
            prizeDescription: { from: oldPrizeDescription, to: newPrizeDescription },
            sponsorId: { from: oldSponsorId, to: sponsorId ?? null },
          },
        },
        tx,
      );

      let sponsorName: string | null = null;
      if (sponsorId) {
        const sp = await tx.sponsor.findUnique({
          where: { id: sponsorId },
          select: { name: true },
        });
        sponsorName = sp?.name ?? null;
      }

      return {
        ok: true as const,
        raffleId: raffle.id,
        roundId: round.id,
        roundNumber: round.roundNumber,
        prizeTitle: newPrizeTitle,
        prizeDescription: newPrizeDescription,
        sponsorId: sponsorId ?? null,
        sponsorName,
      };
    });
  } catch (error) {
    console.error(`[raffles] falha ao atualizar anúncio da rodada: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível atualizar o anúncio da rodada.',
    };
  }
}

/**
 * Apura UMA rodada: as posições seguintes do sorteio, com a semente dela.
 *
 * O `randomInt` é injetável para que os testes sejam determinísticos (mesma decisão
 * da FASE 5 no sorteio de cartas); em produção ele é só o FALLBACK — quando a rodada
 * tem semente comprometida e o cofre está configurado, quem sorteia é
 * `createSeededRandomInt(semente)`, e é isso que torna o resultado reproduzível.
 */
export async function drawRound(input: {
  tenantId: string;
  raffleId: string;
  /** Rodada alvo. Ausente = a rodada preparada (o caminho normal da tela). */
  roundId?: string;
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
       *  transação espera a primeira terminar e, ao prosseguir, encontra a rodada já
       *  apurada e é recusada SEM sortear. Sem a trava, as duas leriam o universo ao
       *  mesmo tempo e ambas gravariam vencedores — o segundo INSERT bateria no
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
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Sorteio não encontrado.',
        };
      }

      /**
       * A rodada alvo: a pedida, ou a PREPARADA (o caminho da tela). Sorteio sem
       * rodada preparada não tem o que apurar — e a mensagem diz qual é o próximo
       * passo em vez de "já foi apurado", que seria falso.
       */
      const round = input.roundId
        ? (raffle.rounds.find((entry) => entry.id === input.roundId) ?? null)
        : pendingRound(raffle.rounds);

      const decision = canDrawRound({ raffleStatus: raffle.status, round });

      if (!decision.ok) {
        return {
          ok: false as const,
          code:
            decision.code === 'RAFFLE_CANCELED'
              ? ('CANCELED' as const)
              : decision.code === 'ROUND_DRAWN'
                ? ('ALREADY_DRAWN' as const)
                : ('NO_PENDING_ROUND' as const),
          message: decision.message,
        };
      }

      // `decision.ok` garante a rodada; o narrowing do TypeScript não o sabe.
      const target = round!;

      /**
       * A configuração do RECORTE vem do sorteio; a QUANTIDADE vem da rodada: a
       * segunda rodada pode dar dois brindes enquanto a primeira deu um.
       */
      const config: RaffleConfig = {
        scope: raffle.scope,
        referenceDate: raffle.referenceDate,
        activityId: raffle.activityId,
        minAttendanceMinutes: raffle.minAttendanceMinutes,
        winnersCount: target.winnersCount,
        alternatesCount: target.alternatesCount,
        weightByMinutes: raffle.weightByMinutes,
        allowPriorEventWinners: raffle.allowPriorEventWinners,
      };

      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { timezone: true },
      });

      const timeZone = tenant?.timezone ?? 'UTC';

      const [attendances, priorWinnerIds, sameRaffleWinnerIds, positionAggregate] = await Promise.all([
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
        /**
         * Quem já ganhou NESTE sorteio, em qualquer rodada — inclusive as posições de
         * suplência. A lista do telão e a apuração usam a MESMA exclusão: um nome que
         * rola na tela e não podia concorrer é uma promessa falsa.
         */
        loadRaffleWinnerIds(tx, raffle.id),
        tx.raffleWinner.aggregate({
          where: { raffleId: raffle.id },
          _max: { position: true },
        }),
      ]);

      const eligibility = evaluateEligibility({
        attendances,
        config,
        timeZone,
        priorWinnerIds,
        sameRaffleWinnerIds,
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
       *  A SEMENTE DESTA RODADA MANDA NO SORTEIO QUANDO EXISTE (item G4 · FASE 30)
       * ───────────────────────────────────────────────────────────────────────────
       *  Com o cofre configurado, a apuração é DETERMINÍSTICA a partir da semente
       *  comprometida antes da rodada: é isso que permite a qualquer pessoa reproduzir
       *  o resultado depois. Sem cofre, cai no gerador do sistema e o resultado
       *  continua auditável por hash, mas não reproduzível — e a resposta diz qual
       *  dos dois aconteceu.
       */
      const revealedSeed = unsealSeed(target.seedSealed, target.seedKeyVersion);
      const random = revealedSeed
        ? createSeededRandomInt(revealedSeed)
        : (input.randomInt ?? ((max: number) => randomInt(0, max)));

      const wanted = config.winnersCount + (config.alternatesCount ?? 0);
      const drawnPool = config.weightByMinutes
        ? selectWeightedWinners(eligibility.eligible, wanted, random)
        : selectWinners(eligibility.eligible, wanted, random);

      /**
       * ───────────────────────────────────────────────────────────────────────────
       *  A LISTA PUBLICADA (FASE 29)
       * ───────────────────────────────────────────────────────────────────────────
       *  A lista de elegíveis DESTA rodada — na ordem em que a apuração a consumiu — é
       *  gravada junto do resultado. Sem ela, "o resultado se reproduz com a semente"
       *  é uma promessa que ninguém pode conferir.
       *
       *  O que vai para o documento canônico é o CÓDIGO público de cada participante
       *  (`poolEntryCode`), não o `userId`: a conferência não precisa de identidade, e
       *  o código é o mesmo que o resultado publica. O `userId` fica ao lado, fora do
       *  canônico, só para a tela resolver o NOME de exibição.
       */
      const poolEntries = eligibility.eligible.map((participant, index) => ({
        index: index + 1,
        code: poolEntryCode(raffle.id, participant.userId),
        minutes: participant.minutes,
        userId: participant.userId,
      }));

      const storedPool: RafflePoolEntry[] = poolEntries.map(({ index, code, minutes }) => ({
        index,
        code,
        minutes,
      }));

      const duplicatedCodes = findDuplicateCodes(storedPool);

      if (duplicatedCodes.length > 0) {
        /**
         * Avisa e segue: uma colisão de digest torna a lista ambígua na conferência,
         * mas travar a apuração no palco por causa disso trocaria um risco remoto por
         * um defeito certo. A página de auditoria mostra o aviso.
         */
        console.warn(
          `[raffles] códigos de participante repetidos na lista do sorteio ${raffle.id}: ${duplicatedCodes.join(', ')}`,
        );
      }

      const storedPoolHash = poolHash(storedPool);

      /**
       * ───────────────────────────────────────────────────────────────────────────
       *  A POSIÇÃO CONTINUA DE ONDE A RODADA ANTERIOR PAROU
       * ───────────────────────────────────────────────────────────────────────────
       *  Posição é do SORTEIO, não da rodada: é por ela que a entrega do prêmio é
       *  registrada e desfeita. Reiniciar a numeração em cada rodada faria duas
       *  pessoas ocuparem "1º" e quebraria o balcão.
       */
      const firstPosition = (positionAggregate._max.position ?? 0) + 1;

      const drawnAt = now;
      const winners = drawnPool.map((winner, index) => ({
        position: firstPosition + index,
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
          // A versão 4 assina QUAL momento este documento descreve: sem isso, o
          // resultado da rodada 2 no lugar da 1 conferiria perfeitamente.
          roundNumber: target.roundNumber,
          scope: config.scope,
          activityId: config.activityId,
          referenceDate: raffle.referenceDate ? dayKey(raffle.referenceDate, timeZone) : null,
          minAttendanceMinutes: config.minAttendanceMinutes,
          winnersCount: config.winnersCount,
          allowPriorEventWinners: config.allowPriorEventWinners,
          alternatesCount: config.alternatesCount ?? 0,
          weightByMinutes: config.weightByMinutes ?? false,
          // A versão 3 assina a ENTRADA: a lista publicada faz parte do hash.
          poolHash: storedPoolHash,
          poolCount: storedPool.length,
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
       *  ORDEM: MARCA A RODADA E DEPOIS GRAVA OS VENCEDORES
       * ───────────────────────────────────────────────────────────────────────────
       *  O `UPDATE` condicional (`drawnAt IS NULL`) é a segunda barreira: se outra
       *  transação tiver apurado entre a leitura e a escrita, ele afeta 0 linhas e a
       *  apuração é abortada antes de gravar vencedores órfãos.
       */
      const claimed = await tx.raffleRound.updateMany({
        where: { id: target.id, drawnAt: null },
        data: {
          drawnAt,
          eligibleCount: eligibility.eligible.length,
          resultHash,
          resultVersion: RESULT_PAYLOAD_VERSION,
          seedRevealed: revealedSeed,
          // A lista publicada e o seu digest: é o que permite a quem audita refazer a
          // conta sem depender do credenciamento, que continua mudando depois.
          poolSnapshot: poolEntries as unknown as object,
          poolHash: storedPoolHash,
        },
      });

      if (claimed.count === 0) {
        return {
          ok: false as const,
          code: 'ALREADY_DRAWN' as const,
          message: 'Esta rodada foi apurada por outra pessoa enquanto você confirmava.',
        };
      }

      await tx.raffleWinner.createMany({
        data: winners.map((winner) => ({
          id: randomUUID(),
          tenantId: input.tenantId,
          raffleId: raffle.id,
          userId: winner.userId,
          position: winner.position,
          roundNumber: target.roundNumber,
          kind: winner.kind,
          attendanceMinutes: winner.minutes,
          attendanceId: winner.attendanceId,
          createdAt: drawnAt,
        })),
      });

      /**
       * O SORTEIO passa a `DRAWN` na primeira rodada e continua assim — o que muda a
       * cada momento é a RODADA. `drawVersion` conta as apurações do sorteio.
       *
       * As colunas de semente/lista da raffle NÃO são escritas: elas são legado
       * congelado da FASE 22/29, e a fonte de verdade passou a ser a rodada.
       */
      await tx.raffle.update({
        where: { id: raffle.id },
        data: {
          status: 'DRAWN',
          drawnAt,
          eligibleCount: eligibility.eligible.length,
          inspectedAttendances: eligibility.inspectedAttendances,
          drawVersion: raffle.drawVersion + 1,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'raffleRound',
          entityId: target.id,
          changes: {
            raffleId: { from: null, to: raffle.id },
            roundNumber: { from: null, to: target.roundNumber },
            prizeTitle: { from: null, to: target.prizeTitle },
            eligibleCount: {
              from: target.eligibleCount,
              to: eligibility.eligible.length,
            },
            positions: {
              from: null,
              to: `${firstPosition}ª a ${winners[winners.length - 1]?.position ?? firstPosition}ª`,
            },
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
            resultVersion: {
              from: target.resultVersion,
              to: RESULT_PAYLOAD_VERSION,
            },
            // A lista publicada entra na trilha pelo DIGEST: quem for reconciliar
            // depois precisa saber que a entrada mudou, sem varrer o JSON inteiro.
            poolHash: { from: null, to: storedPoolHash },
            poolCount: { from: null, to: storedPool.length },
            // A semente revelada entra na trilha: é o que fecha o commit-reveal.
            seedRevealed: { from: null, to: revealedSeed },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        raffleId: raffle.id,
        roundId: target.id,
        roundNumber: target.roundNumber,
        firstPosition,
        eligibleCount: eligibility.eligible.length,
        inspectedAttendances: eligibility.inspectedAttendances,
        winners,
        resultHash,
        drawnAt,
        drawVersion: raffle.drawVersion + 1,
        shortfall: Math.max(0, wanted - winners.length),
        seedRevealed: revealedSeed,
        seedCommitment: target.seedCommitment,
        seeded: revealedSeed !== null,
        winnersDrawn,
        alternatesDrawn,
      };
    });
  } catch (error) {
    /**
     * Corrida perdida no índice único `(raffleId, userId)`: significa que uma
     * apuração gravou o mesmo vencedor — em outra rodada, no mesmo instante. A
     * transação inteira foi desfeita, então o estado do banco continua sendo UMA
     * apuração.
     */
    if (isUniqueViolation(error)) {
      const index = violatedIndexName(error);

      return {
        ok: false as const,
        code: 'ALREADY_DRAWN',
        message:
          index === 'raffle_winners_raffleId_position_key'
            ? 'Outra apuração gravou as mesmas posições no mesmo instante.'
            : 'Alguém desta rodada já havia ganhado em uma rodada anterior deste sorteio.',
      };
    }

    console.error(`[raffles] falha na apuração: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível executar o sorteio.',
    };
  }
}

/**
 * Apura a rodada PREPARADA do sorteio.
 *
 * Existe porque a esmagadora maioria das chamadas quer exatamente isso — a tela, as
 * ações e o worker não precisam saber o id da rodada. Quem quer escolher o momento
 * chama `drawRound` com `roundId`.
 */
export async function drawRaffle(input: {
  tenantId: string;
  raffleId: string;
  actorId: string;
  now?: Date;
  randomInt?: (max: number) => number;
}): Promise<RaffleResult<DrawOutcome>> {
  return drawRound(input);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Uma rodada como a tela de administração precisa dela (FASE 30).
 *
 * A rodada é a unidade de PROVA: ela carrega o próprio compromisso, a própria
 * revelação e o próprio resultado assinado. O cabeçalho do sorteio repete os números
 * da ÚLTIMA rodada apurada só por conveniência de leitura — quem audita olha rodada
 * a rodada, porque foi assim que a apuração aconteceu.
 */
export interface RaffleSummaryRound {
  id: string;
  roundNumber: number;
  state: RoundState;
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorId: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  winnersCount: number;
  alternatesCount: number;
  eligibleCount: number;
  seedCommitment: string | null;
  seedRevealed: string | null;
  /** Versão da chave do cofre que selou a semente DESTA rodada (item G12). */
  seedKeyVersion: number;
  poolHash: string | null;
  resultHash: string | null;
  resultVersion: number;
  drawnAt: Date | null;
}

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
  /**
   * SHA-256 da lista publicada (FASE 29). Fica no resumo porque a tela de
   * administração mostra a prova junto do resultado — e porque quem reconcilia
   * dados precisa saber que a ENTRADA do sorteio também está assinada.
   */
  poolHash: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  /** Versão da chave do cofre que selou a semente (FASE 22, item G12). */
  seedKeyVersion: number;
  drawVersion: number;
  createdByName: string | null;
  /** Rodadas, da primeira para a última (FASE 30). A rodada 1 nasce com o sorteio. */
  rounds: RaffleSummaryRound[];
  winners: {
    /** Id da POSIÇÃO sorteada — é ele que o registro de entrega usa. */
    id: string;
    position: number;
    /** Rodada que sorteou esta posição (FASE 30) — é o que liga a entrega ao prêmio. */
    roundNumber: number;
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
 * Histórico paginado dos sorteios do evento (item G6), com busca (item G9).
 *
 * Antes havia um teto fixo de 100 e o começo da lista desaparecia sem aviso em
 * eventos com muitos sorteios. Agora a página é explícita e o total vem junto, para
 * que a tela possa mostrar "página 2 de 4" em vez de fingir que acabou.
 *
 * O filtro (FASE 22) entra no `where` do banco, e não na lista já carregada: filtrar
 * em memória daria uma página com 3 itens e "página 1 de 7", porque a contagem e o
 * recorte teriam sido calculados sobre conjuntos diferentes.
 */
export async function listRaffles(
  tenantId: string,
  eventId: string,
  options: {
    page?: number;
    pageSize?: number;
    filter?: RaffleHistoryFilter;
  } = {},
): Promise<RaffleResult<RaffleList>> {
  try {
    const where = {
      tenantId,
      eventId,
      deletedAt: null,
      ...(options.filter?.status ? { status: options.filter.status } : {}),
      ...(options.filter?.from || options.filter?.to
        ? {
            createdAt: {
              ...(options.filter?.from ? { gte: options.filter.from } : {}),
              ...(options.filter?.to ? { lte: options.filter.to } : {}),
            },
          }
        : {}),
    };

    const data = await withTenant(tenantId, async (tx) => {
      const total = await tx.raffle.count({ where });
      const pagination = resolveRafflePage({
        page: options.page,
        pageSize: options.pageSize,
        total,
      });

      const rows = await tx.raffle.findMany({
        where,
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
          poolHash: true,
          seedCommitment: true,
          seedRevealed: true,
          seedKeyVersion: true,
          drawVersion: true,
          activity: { select: { title: true } },
          createdBy: { select: { name: true } },
          rounds: {
            orderBy: { roundNumber: 'asc' },
            select: {
              id: true,
              roundNumber: true,
              prizeTitle: true,
              prizeDescription: true,
              sponsorId: true,
              winnersCount: true,
              alternatesCount: true,
              eligibleCount: true,
              seedCommitment: true,
              seedRevealed: true,
              seedKeyVersion: true,
              poolHash: true,
              resultHash: true,
              resultVersion: true,
              drawnAt: true,
              sponsor: { select: { name: true, logoUrl: true } },
            },
          },
          winners: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              roundNumber: true,
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
      raffles: data.rows.map((row) => {
        const rounds: RaffleSummaryRound[] = row.rounds.map((round) => ({
          id: round.id,
          roundNumber: round.roundNumber,
          state: roundStateOf(round),
          prizeTitle: round.prizeTitle,
          prizeDescription: round.prizeDescription,
          sponsorId: round.sponsorId,
          sponsorName: round.sponsor?.name ?? null,
          sponsorLogoUrl: round.sponsor?.logoUrl ?? null,
          winnersCount: round.winnersCount,
          alternatesCount: round.alternatesCount,
          eligibleCount: round.eligibleCount,
          seedCommitment: round.seedCommitment,
          seedRevealed: round.seedRevealed,
          seedKeyVersion: round.seedKeyVersion,
          poolHash: round.poolHash,
          resultHash: round.resultHash,
          resultVersion: round.resultVersion,
          drawnAt: round.drawnAt,
        }));

        /**
         * Os números do CABEÇALHO são os da rodada em destaque: a última APURADA e,
         * enquanto nenhuma foi apurada, a que está PREPARADA (é o compromisso dela que
         * o telão anuncia). As colunas equivalentes em `raffles` são legado congelado
         * desde a FASE 30 e só servem de reserva para uma rodada que não exista — o que
         * não acontece, porque a rodada 1 nasce junto com o sorteio.
         */
        const headline = lastDrawnRound(rounds) ?? pendingRound(rounds);

        return {
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
          resultHash: headline?.resultHash ?? row.resultHash,
          resultVersion: headline?.resultVersion ?? row.resultVersion,
          poolHash: headline?.poolHash ?? row.poolHash,
          seedCommitment: headline?.seedCommitment ?? row.seedCommitment,
          seedRevealed: headline?.seedRevealed ?? row.seedRevealed,
          seedKeyVersion: headline?.seedKeyVersion ?? row.seedKeyVersion,
          drawVersion: row.drawVersion,
          createdByName: row.createdBy?.name ?? null,
          rounds,
          winners: row.winners.map((winner) => ({
            id: winner.id,
            position: winner.position,
            roundNumber: winner.roundNumber,
            userId: winner.userId,
            userName: winner.user?.name ?? 'Participante',
            minutes: winner.attendanceMinutes,
            kind: winner.kind,
            deliveredAt: winner.deliveredAt,
            deliveredByName: winner.deliveredBy?.name ?? null,
            deliveryNote: winner.deliveryNote,
          })),
        };
      }),
      page: data.pagination.page,
      pageSize: data.pagination.pageSize,
      total: data.pagination.total,
      totalPages: data.pagination.totalPages,
    };
  } catch (error) {
    console.error(`[raffles] falha ao listar sorteios: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível carregar os sorteios.',
    };
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
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Sorteio não encontrado.',
        };
      }

      if (raffle.status !== 'DRAWN') {
        return {
          ok: false as const,
          code: 'NOT_DRAWN' as const,
          message: 'Só é possível registrar entrega de um sorteio já apurado.',
        };
      }

      const position = await tx.raffleWinner.findFirst({
        where: {
          id: input.positionId,
          raffleId: raffle.id,
          tenantId: input.tenantId,
        },
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
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível registrar a entrega.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Desfazer a entrega do prêmio (FASE 22, item G8)
// ───────────────────────────────────────────────────────────────────────────────
export interface ReversedDelivery {
  raffleId: string;
  positionId: string;
  userName: string;
  /** Quando a entrega desfeita havia sido registrada. */
  previousDeliveredAt: Date;
  previousDeliveredByName: string | null;
  reason: string;
}

/**
 * Desfaz o registro de entrega de UMA posição sorteada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O RECIBO PRECISOU DEIXAR DE SER IMUTÁVEL
 * ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 16 gravou a entrega como registro imutável (ADR-086), e a intenção estava
 *  certa: um recibo que pode ser reescrito em silêncio não serve como recibo. O que
 *  faltou foi o outro lado do balcão — alguém marca "entregue" na posição errada (o
 *  nome parecido, a lista fora de ordem), e a única saída era SQL. No dia do evento
 *  isso é uma fila parada.
 *
 *  A correção mantém a intenção: **o que se desfaz é o REGISTRO DE ENTREGA, não o
 *  sorteio**. A pessoa continua sendo a ganhadora daquela posição; o prêmio volta a
 *  constar como não retirado; e os DOIS fatos ficam na trilha — a entrega original
 *  (com autor e horário) e a reversão (com autor, horário e MOTIVO). Nada é apagado,
 *  e a pergunta "por que esta entrega foi desfeita?" tem resposta no sistema.
 *
 *  O motivo é obrigatório (`evaluateDeliveryReversal`): é o único campo que impede a
 *  reversão de virar um clique reflexo capaz de apagar um fato consumado.
 */
export async function reversePrizeDelivery(input: {
  tenantId: string;
  raffleId: string;
  positionId: string;
  actorId: string;
  reason: string;
}): Promise<RaffleResult<ReversedDelivery>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const raffle = await loadRaffle(tx, input.tenantId, input.raffleId);

      if (!raffle) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Sorteio não encontrado.',
        };
      }

      const position = await tx.raffleWinner.findFirst({
        where: {
          id: input.positionId,
          raffleId: raffle.id,
          tenantId: input.tenantId,
        },
        select: {
          id: true,
          userId: true,
          deliveredAt: true,
          deliveryNote: true,
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

      const decision = evaluateDeliveryReversal({
        deliveredAt: position.deliveredAt,
        reason: input.reason,
      });

      if (!decision.allowed) {
        return {
          ok: false as const,
          code: decision.code,
          message: decision.message,
        };
      }

      const previousDeliveredAt = position.deliveredAt!;

      await tx.raffleWinner.update({
        where: { id: position.id },
        data: { deliveredAt: null, deliveredById: null, deliveryNote: null },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'rafflePrize',
          entityId: position.id,
          changes: {
            /**
             * Os campos nomeiam o que aconteceu, e não "de → para" genérico: quem lê
             * a trilha meses depois precisa distinguir uma ENTREGA de uma REVERSÃO
             * sem cruzar duas linhas. O motivo vai junto porque é ele que explica.
             */
            entregaDesfeitaEm: {
              from: previousDeliveredAt.toISOString(),
              to: null,
            },
            entreguePorAnteriormente: {
              from: position.deliveredBy?.name ?? null,
              to: null,
            },
            observacaoDaEntregaAnterior: {
              from: position.deliveryNote,
              to: null,
            },
            motivoDaReversao: { from: null, to: decision.reason },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        raffleId: raffle.id,
        positionId: position.id,
        userName: position.user?.name ?? 'Participante',
        previousDeliveredAt,
        previousDeliveredByName: position.deliveredBy?.name ?? null,
        reason: decision.reason,
      };
    });
  } catch (error) {
    console.error(`[raffles] falha ao desfazer entrega: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível desfazer a entrega.',
    };
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
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Sorteio não encontrado.',
        };
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

      return {
        ok: true as const,
        raffleId: raffle.id,
        isPublic: input.isPublic,
      };
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
  /**
   * As rodadas publicadas, da primeira para a última (FASE 30).
   *
   * É daqui que a página pública monta o resultado: cada momento tem o seu prêmio, o
   * seu patrocinador, os seus ganhadores e a sua prova. As listas planas abaixo são
   * a projeção de todas as rodadas, para quem só quer o total (a vitrine do evento).
   */
  rounds: PublicRaffleRound[];
  resultHash: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  winners: { position: number; name: string; masked: boolean }[];
  alternates: { position: number; name: string; masked: boolean }[];
}

export interface PublicRaffleWinnerRow {
  position: number;
  name: string;
  masked: boolean;
}

/** Uma rodada publicada: o prêmio, quem levou e a prova daquele momento. */
export interface PublicRaffleRound {
  roundNumber: number;
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  drawnAt: Date;
  resultHash: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  winners: PublicRaffleWinnerRow[];
  alternates: PublicRaffleWinnerRow[];
}

/** Projeta o resultado da rodada a partir das linhas já lidas do banco. */
function mapPublicRound(input: {
  round: {
    roundNumber: number;
    prizeTitle: string | null;
    prizeDescription: string | null;
    drawnAt: Date | null;
    resultHash: string | null;
    seedCommitment: string | null;
    seedRevealed: string | null;
    sponsor: { name: string; logoUrl: string | null } | null;
  };
  winners: readonly {
    position: number;
    kind: string;
    roundNumber: number;
    user: { name: string; isPublicProfile: boolean } | null;
  }[];
  createdAt: Date;
}): PublicRaffleRound {
  const mapped = input.winners
    .filter((winner) => winner.roundNumber === input.round.roundNumber)
    .map((winner) => {
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
    roundNumber: input.round.roundNumber,
    prizeTitle: input.round.prizeTitle,
    prizeDescription: input.round.prizeDescription,
    sponsorName: input.round.sponsor?.name ?? null,
    sponsorLogoUrl: input.round.sponsor?.logoUrl ?? null,
    // Sorteio apurado tem `drawnAt` na rodada; a criação é o fallback (nunca a data
    // zero, que apareceria como 1970).
    drawnAt: input.round.drawnAt ?? input.createdAt,
    resultHash: input.round.resultHash,
    seedCommitment: input.round.seedCommitment,
    seedRevealed: input.round.seedRevealed,
    winners: mapped
      .filter((winner) => winner.kind === 'WINNER')
      .map(({ position, name, masked }) => ({ position, name, masked })),
    alternates: mapped
      .filter((winner) => winner.kind === 'ALTERNATE')
      .map(({ position, name, masked }) => ({ position, name, masked })),
  };
}

/**
 * Resultados publicados de um evento — para a página pública, sem login.
 *
 * O nome sai MASCARADO por padrão (`publicWinnerName`): quem se credenciou não
 * consentiu em ter o nome publicado na internet. Quem tem perfil público
 * (`User.isPublicProfile`) aparece com o nome completo — consentimento explícito.
 *
 * O hash e a semente revelada vão junto de propósito: publicar só o nome transforma
 * o sorteio em promessa. Publicando a prova, qualquer pessoa confere — e desde a
 * FASE 30 a prova é POR RODADA, porque cada momento tem a sua semente.
 */
export async function listPublicRaffleResults(
  tenantId: string,
  eventId: string,
): Promise<PublicRaffleResult[]> {
  try {
    const rows = await withTenant(tenantId, (tx) =>
      tx.raffle.findMany({
        where: {
          tenantId,
          eventId,
          deletedAt: null,
          isPublic: true,
          status: 'DRAWN',
        },
        orderBy: [{ drawnAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          title: true,
          description: true,
          drawnAt: true,
          createdAt: true,
          rounds: {
            where: { drawnAt: { not: null } },
            orderBy: { roundNumber: 'asc' },
            select: {
              roundNumber: true,
              prizeTitle: true,
              prizeDescription: true,
              drawnAt: true,
              resultHash: true,
              seedCommitment: true,
              seedRevealed: true,
              sponsor: { select: { name: true, logoUrl: true } },
            },
          },
          winners: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              kind: true,
              roundNumber: true,
              user: { select: { name: true, isPublicProfile: true } },
            },
          },
        },
      }),
    );

    return rows.map((row) => {
      const rounds = row.rounds.map((round) =>
        mapPublicRound({
          round,
          winners: row.winners,
          createdAt: row.createdAt,
        }),
      );

      /**
       * As listas planas são a projeção de TODAS as rodadas: a vitrine do evento
       * mostra "quem ganhou", sem separar por momento — quem quer o detalhe abre a
       * página do sorteio.
       */
      const flatWinners = rounds.flatMap((round) => round.winners);
      const flatAlternates = rounds.flatMap((round) => round.alternates);
      const lastRound = rounds[rounds.length - 1];

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        drawnAt: row.drawnAt ?? row.createdAt,
        rounds,
        // A "prova do sorteio" na vitrine é a do ÚLTIMO momento: é o número que o
        // público acabou de ver. Cada rodada tem a sua, na página do sorteio.
        resultHash: lastRound?.resultHash ?? null,
        seedCommitment: lastRound?.seedCommitment ?? null,
        seedRevealed: lastRound?.seedRevealed ?? null,
        winners: flatWinners,
        alternates: flatAlternates,
      };
    });
  } catch (error) {
    console.error(`[raffles] falha ao carregar resultados públicos: ${errorMessage(error)}`);
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Página pública de UM sorteio (FASE 22, item G11)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O resultado publicado de UM sorteio, para a página própria dele.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA LEITURA PRÓPRIA, E NÃO UM `find` NA LISTA DO EVENTO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `listPublicRaffleResults` traz os 20 últimos do evento: serve à seção da página
 *  pública, não a um endereço que alguém projeta no telão e compartilha. Aqui o
 *  recorte é UM sorteio, e o que se ganha é poder dizer POR QUE ele não aparece:
 *  `null` significa "não existe ou não está publicado", e a página pública responde
 *  404 nos dois casos — porque um endereço que explica "este sorteio existe, mas não
 *  está publicado" já é informação demais para quem não organiza (a mesma decisão do
 *  material de palestrante na FASE 25: 404 nunca, lá porque o rascunho não é
 *  informação de quem não organiza; aqui, porque o resultado não é).
 *
 *  A leitura traz os TITULARES e os SUPLENTES separados, com o nome mascarado por
 *  padrão (`publicWinnerName`) — quem se credenciou não consentiu em ter o nome
 *  publicado, e quem tem perfil público aparece inteiro.
 */
export async function getPublicRaffleResult(
  tenantId: string,
  eventId: string,
  raffleId: string,
): Promise<PublicRaffleResult | null> {
  try {
    const row = await withTenant(tenantId, (tx) =>
      tx.raffle.findFirst({
        where: { id: raffleId, tenantId, eventId, deletedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          drawnAt: true,
          createdAt: true,
          status: true,
          isPublic: true,
          rounds: {
            where: { drawnAt: { not: null } },
            orderBy: { roundNumber: 'asc' },
            select: {
              roundNumber: true,
              prizeTitle: true,
              prizeDescription: true,
              drawnAt: true,
              resultHash: true,
              seedCommitment: true,
              seedRevealed: true,
              sponsor: { select: { name: true, logoUrl: true } },
            },
          },
          winners: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              kind: true,
              roundNumber: true,
              user: { select: { name: true, isPublicProfile: true } },
            },
          },
        },
      }),
    );

    if (!row) return null;

    /**
     * A publicação EXIGE as duas condições (apurado + publicado). O estado é
     * calculado no domínio, e não com um `if` local, porque a tela de administração
     * usa a MESMA função para explicar por que o endereço público ainda não responde.
     */
    const state = rafflePublicationState({
      isPublic: row.isPublic,
      status: row.status as RaffleStatus,
    });

    if (state !== 'PUBLISHED') return null;

    const rounds = row.rounds.map((round) =>
      mapPublicRound({ round, winners: row.winners, createdAt: row.createdAt }),
    );

    const lastRound = rounds[rounds.length - 1];

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      drawnAt: row.drawnAt ?? row.createdAt,
      rounds,
      resultHash: lastRound?.resultHash ?? null,
      seedCommitment: lastRound?.seedCommitment ?? null,
      seedRevealed: lastRound?.seedRevealed ?? null,
      winners: rounds.flatMap((round) => round.winners),
      alternates: rounds.flatMap((round) => round.alternates),
    };
  } catch (error) {
    console.error(`[raffles] falha ao carregar resultado público do sorteio: ${errorMessage(error)}`);
    return null;
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

// ───────────────────────────────────────────────────────────────────────────────
//  Estado ao vivo de UM sorteio (FASE 29)
// ───────────────────────────────────────────────────────────────────────────────
export interface RaffleLiveState {
  raffleId: string;
  /** O recorte do SORTEIO (não o da tela): o telão conta o que a apuração contaria. */
  config: RaffleConfig;
  status: RaffleStatus;
  drawnAt: Date | null;
  resultHash: string | null;
  poolHash: string | null;
  /** A rodada preparada e ainda não apurada — o que o telão anuncia como "a seguir". */
  pendingRound: {
    roundId: string;
    roundNumber: number;
    prizeTitle: string | null;
    seedCommitment: string | null;
  } | null;
  /** A última rodada apurada: é a mudança que faz o telão revelar (FASE 30). */
  lastDrawnRound: {
    roundId: string;
    roundNumber: number;
    resultHash: string | null;
  } | null;
}

/**
 * O estado do sorteio que o telão acompanha, com o recorte DELE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONFIG VEM DO SORTEIO, E NÃO DA QUERY
 * ─────────────────────────────────────────────────────────────────────────────
 *  A rota de prévia ao vivo nasceu (FASE 16) para a TELA DE OPERAÇÃO, que ainda
 *  está preenchendo o formulário — lá a config vem dos campos, porque o sorteio
 *  ainda não existe. O telão é o contrário: o sorteio já existe, e o número na
 *  parede tem de ser o do sorteio que está sendo exibido. Aceitar a config da URL
 *  permitiria um telão mostrando "42 elegíveis" de um recorte que não é o que será
 *  apurado — a discrepância exata que corrói a confiança no palco.
 *
 *  Desde a FASE 30 o que muda de estado é a RODADA: o telão precisa saber que a
 *  rodada 2 foi apurada para revelar, mesmo que o sorteio já estivesse `DRAWN`
 *  desde a primeira.
 */
export async function getRaffleLiveState(input: {
  tenantId: string;
  eventId: string;
  raffleId: string;
}): Promise<RaffleLiveState | null> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const row = await tx.raffle.findFirst({
        where: {
          id: input.raffleId,
          tenantId: input.tenantId,
          eventId: input.eventId,
          deletedAt: null,
        },
        select: {
          id: true,
          scope: true,
          referenceDate: true,
          activityId: true,
          minAttendanceMinutes: true,
          winnersCount: true,
          alternatesCount: true,
          weightByMinutes: true,
          allowPriorEventWinners: true,
          status: true,
          drawnAt: true,
          rounds: {
            orderBy: { roundNumber: 'asc' },
            select: {
              id: true,
              roundNumber: true,
              prizeTitle: true,
              seedCommitment: true,
              resultHash: true,
              drawnAt: true,
            },
          },
        },
      });

      if (!row) return null;

      const pending = pendingRound(row.rounds);
      const last = lastDrawnRound(row.rounds);

      return {
        raffleId: row.id,
        config: {
          scope: row.scope as RaffleScope,
          referenceDate: row.referenceDate,
          activityId: row.activityId,
          minAttendanceMinutes: row.minAttendanceMinutes,
          winnersCount: row.winnersCount,
          alternatesCount: row.alternatesCount,
          weightByMinutes: row.weightByMinutes,
          allowPriorEventWinners: row.allowPriorEventWinners,
        },
        status: row.status as RaffleStatus,
        drawnAt: row.drawnAt,
        resultHash: last?.resultHash ?? null,
        poolHash: null,
        pendingRound: pending
          ? {
              roundId: pending.id,
              roundNumber: pending.roundNumber,
              prizeTitle: pending.prizeTitle,
              seedCommitment: pending.seedCommitment,
            }
          : null,
        lastDrawnRound: last
          ? {
              roundId: last.id,
              roundNumber: last.roundNumber,
              resultHash: last.resultHash,
            }
          : null,
      };
    });
  } catch (error) {
    console.error(`[raffles] falha ao carregar o estado ao vivo do sorteio: ${errorMessage(error)}`);
    return null;
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
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Sorteio não encontrado.',
        };
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
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível cancelar o sorteio.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Palco público do sorteio (FASE 29)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Estado do PALCO — o que o telão mostra, em cada momento.
 *
 * Diferente da publicação do resultado (`rafflePublicationState`), o palco existe
 * ANTES da apuração: é ele que exibe o COMPROMISSO enquanto o público espera. Um
 * compromisso que ninguém viu antes da apuração não prova nada, e a tela de
 * administração só mostrava o compromisso DEPOIS de apurar — o telão fecha essa
 * lacuna, e é por isso que ele não depende de `isPublic`.
 */
export type RaffleStageState = 'AGUARDANDO' | 'REVELADO' | 'CANCELADO';

export interface RaffleStageWinner {
  position: number;
  name: string;
  masked: boolean;
}

/** Uma rodada como o telão a mostra: o prêmio, quem levou e a prova do momento. */
export interface RaffleStageRound {
  roundNumber: number;
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  drawnAt: Date | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  resultHash: string | null;
  winnersCount: number;
  /** Nomes que a ROLETA percorre antes de parar no ganhador (FASE 30). */
  rollNames: string[];
  winners: RaffleStageWinner[];
  alternates: RaffleStageWinner[];
}

export interface RaffleStageView {
  raffleId: string;
  title: string;
  description: string | null;
  state: RaffleStageState;
  /** Compromisso publicado antes da apuração — o que o telão mostra esperando. */
  seedCommitment: string | null;
  /** Sem cofre não há prova a exibir; o telão avisa em vez de fingir. */
  seeded: boolean;
  createdAt: Date;
  drawnAt: Date | null;
  winnersCount: number;
  alternatesCount: number;
  weightByMinutes: boolean;
  /** Minutos mínimos do recorte — o público entende por que alguns não concorrem. */
  minAttendanceMinutes: number;
  eligibleCount: number;
  winners: RaffleStageWinner[];
  alternates: RaffleStageWinner[];
  resultHash: string | null;
  seedRevealed: string | null;
  /** A rodada que o telão está anunciando agora (preparada, ainda não apurada). */
  pendingRound: RaffleStageRound | null;
  /** A rodada apurada mais recente — é ela que o telão revela. */
  currentRound: RaffleStageRound | null;
  /** O acumulado das rodadas anteriores, para a parede mostrar o que já saiu. */
  previousRounds: RaffleStageRound[];
}

/**
 * Quantos nomes a roleta recebe.
 *
 * O telão não precisa da lista inteira para dar a impressão de sorteio, e um evento
 * com milhares de presentes não pode inflar o HTML da página por causa de uma
 * animação. O corte é por isso, e não por privacidade (os nomes já vão mascarados).
 */
const STAGE_ROLL_LIMIT = 120;

/**
 * O que o telão mostra, para qualquer visitante (sem login).
 *
 * Lê por `raffleId` + evento, sob RLS — o recorte de instituição é do banco. O
 * endereço é um UUID não enumerável: quem tem o link projeta, quem não tem não
 * adivinha. O título do prêmio aparece antes da apuração porque é isso que o telão
 * existe para anunciar — e é a decisão registrada da fase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ROLETA USA OS NOMES REAIS, MASCARADOS (FASE 30)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Os nomes que passam na tela são os da LISTA PUBLICADA da rodada — a mesma que a
 *  auditoria confere —, e não nomes inventados: quem está na sala vê o próprio nome
 *  passar, e a roleta para em alguém que realmente concorria. Inventar nomes seria
 *  mais fácil e menos honesto: daria a impressão de sorteio sobre gente que não
 *  estava no páreo.
 */
export async function getRaffleStageView(input: {
  tenantId: string;
  eventId: string;
  raffleId: string;
}): Promise<RaffleStageView | null> {
  try {
    const data = await withTenant(input.tenantId, async (tx) => {
      const row = await tx.raffle.findFirst({
        where: {
          id: input.raffleId,
          tenantId: input.tenantId,
          eventId: input.eventId,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          createdAt: true,
          drawnAt: true,
          winnersCount: true,
          alternatesCount: true,
          weightByMinutes: true,
          minAttendanceMinutes: true,
          eligibleCount: true,
          rounds: {
            orderBy: { roundNumber: 'asc' },
            select: {
              id: true,
              roundNumber: true,
              prizeTitle: true,
              prizeDescription: true,
              winnersCount: true,
              seedCommitment: true,
              seedRevealed: true,
              resultHash: true,
              poolSnapshot: true,
              drawnAt: true,
              sponsor: { select: { name: true, logoUrl: true } },
            },
          },
          winners: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              kind: true,
              roundNumber: true,
              user: { select: { name: true, isPublicProfile: true } },
            },
          },
        },
      });

      if (!row) return null;

      /**
       * Os nomes da ROLETA saem da lista publicada, que guarda CÓDIGO — não
       * identidade. Resolver o nome exige o `userId` gravado ao lado do código, e é
       * aqui que a lista deixa de ser anônima para a TELA, sem entrar no hash.
       */
      const poolUserIds = [
        ...new Set(
          row.rounds.flatMap((round) =>
            ((round.poolSnapshot as unknown as { userId?: string }[] | null) ?? [])
              .map((entry) => entry.userId)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
      ];

      const people = await tx.user.findMany({
        where: { id: { in: poolUserIds } },
        select: { id: true, name: true, isPublicProfile: true },
      });

      return {
        row,
        byId: new Map(people.map((person) => [person.id, person])),
      };
    });

    if (!data) return null;

    const { row, byId } = data;

    /**
     * ── O ESTADO DO PALCO É O DA RODADA, NÃO O DO SORTEIO (FASE 30) ──────────────
     * Um sorteio com a rodada 2 preparada continua `DRAWN` no banco (a 1 já foi
     * apurada) — e a parede precisa estar anunciando o PRÓXIMO prêmio, não exibindo o
     * resultado anterior. Por isso a rodada preparada vence o status.
     */
    const pending = pendingRound(row.rounds);
    const drawnRounds = row.rounds.filter((round) => round.drawnAt !== null);
    const current = drawnRounds[drawnRounds.length - 1] ?? null;

    const state: RaffleStageState =
      row.status === 'CANCELED'
        ? 'CANCELADO'
        : pending !== null
          ? 'AGUARDANDO'
          : row.status === 'DRAWN'
            ? 'REVELADO'
            : 'AGUARDANDO';

    const displayName = (userId: string | undefined): { name: string; masked: boolean } => {
      const person = userId ? byId.get(userId) : undefined;
      const publicProfile = person?.isPublicProfile ?? false;

      return {
        name: publicWinnerName({
          name: person?.name ?? 'Participante',
          publicProfile,
        }),
        masked: !publicProfile,
      };
    };

    /**
     * ── O NOME DOS GANHADORES VEM DO BANCO, NÃO DA LISTA ────────────────────────
     * A lista publicada guarda CÓDIGO (não identidade), então os nomes dos ganhadores
     * são resolvidos pela relação `user` — a mesma regra de consentimento de sempre.
     */
    const mapped = row.winners.map((winner) => {
      const publicProfile = winner.user?.isPublicProfile ?? false;

      return {
        position: winner.position,
        roundNumber: winner.roundNumber,
        kind: winner.kind,
        name: publicWinnerName({
          name: winner.user?.name ?? 'Participante',
          publicProfile,
        }),
        masked: !publicProfile,
      };
    });

    const roundView = (round: (typeof row.rounds)[number]): RaffleStageRound => {
      const stored = (round.poolSnapshot as unknown as { code: string; userId?: string }[] | null) ?? [];

      return {
        roundNumber: round.roundNumber,
        prizeTitle: round.prizeTitle,
        prizeDescription: round.prizeDescription,
        sponsorName: round.sponsor?.name ?? null,
        sponsorLogoUrl: round.sponsor?.logoUrl ?? null,
        drawnAt: round.drawnAt,
        seedCommitment: round.seedCommitment,
        seedRevealed: round.seedRevealed,
        resultHash: round.resultHash,
        winnersCount: round.winnersCount,
        /**
         * Os nomes da roleta saem da LISTA PUBLICADA — a mesma que a auditoria usa.
         * A ordem embaralhada é do cliente: o que importa é que sejam pessoas que
         * concorreram de verdade naquela rodada.
         */
        rollNames: stored.slice(0, STAGE_ROLL_LIMIT).map((entry) => displayName(entry.userId).name),
        winners: mapped
          .filter((winner) => winner.roundNumber === round.roundNumber && winner.kind === 'WINNER')
          .map(({ position, name, masked }) => ({ position, name, masked })),
        alternates: mapped
          .filter((winner) => winner.roundNumber === round.roundNumber && winner.kind === 'ALTERNATE')
          .map(({ position, name, masked }) => ({ position, name, masked })),
      };
    };

    const pendingView = pending ? roundView(pending) : null;
    const currentView = current ? roundView(current) : null;

    /**
     * A "prova" no rodapé é a da rodada que o público acabou de ver — e o
     * compromisso é o da PRÓXIMA, quando existe: é ele que o telão publica
     * enquanto o momento seguinte não chega.
     */
    const headerRound = pending ?? current;

    /**
     * O que já foi sorteado na parede: com uma rodada PREPARADA, todas as apuradas
     * entram no histórico (a tela está anunciando a próxima); sem nenhuma pendente, a
     * última é a que está em cartaz e as anteriores ficam listadas acima.
     */
    const previous = pending ? drawnRounds : drawnRounds.slice(0, -1);

    return {
      raffleId: row.id,
      title: row.title,
      description: row.description,
      state,
      seedCommitment: headerRound?.seedCommitment ?? null,
      seeded: headerRound?.seedCommitment !== null && headerRound !== null,
      createdAt: row.createdAt,
      drawnAt: row.drawnAt,
      winnersCount: pending?.winnersCount ?? current?.winnersCount ?? row.winnersCount,
      alternatesCount: row.alternatesCount,
      weightByMinutes: row.weightByMinutes,
      minAttendanceMinutes: row.minAttendanceMinutes,
      eligibleCount: row.eligibleCount,
      winners: mapped
        .filter((winner) => winner.kind === 'WINNER')
        .map(({ position, name, masked }) => ({ position, name, masked })),
      alternates: mapped
        .filter((winner) => winner.kind === 'ALTERNATE')
        .map(({ position, name, masked }) => ({ position, name, masked })),
      resultHash: current?.resultHash ?? null,
      seedRevealed: current?.seedRevealed ?? null,
      pendingRound: pendingView,
      /**
       * A rodada EM CARTAZ: a preparada (é ela que o telão anuncia) ou, sem pendente,
       * a última apurada. É o que a parede exibe — e o que a roleta usa para parar.
       */
      currentRound: pendingView ?? currentView,
      previousRounds: previous.map(roundView),
    };
  } catch (error) {
    console.error(`[raffles] falha ao carregar o palco do sorteio: ${errorMessage(error)}`);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Auditoria pública do sorteio (FASE 29)
// ───────────────────────────────────────────────────────────────────────────────
/** Linha da lista publicada, do jeito que ela foi gravada na apuração. */
interface StoredPoolEntry extends RafflePoolEntry {
  /** Gravado apenas para a tela resolver o nome de exibição — NÃO entra no hash. */
  userId?: string;
}

export interface RaffleAuditPoolRow {
  index: number;
  code: string;
  minutes: number;
  name: string;
  masked: boolean;
}

export interface RaffleAuditWinnerRow {
  position: number;
  kind: RaffleWinnerKind;
  code: string | null;
  name: string;
  masked: boolean;
  minutes: number;
}

/** Uma RODADA do ponto de vista de quem audita (FASE 30). */
export interface RaffleAuditRound {
  roundNumber: number;
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  drawnAt: Date | null;
  winnersCount: number;
  alternatesCount: number;
  /**
   * Peso por minutos NA RODADA.
   *
   * Vem do SORTEIO, e não de um campo da rodada, por um motivo verificado: não existe
   * caminho que edite essa configuração depois da criação (as ações que mexem no
   * sorteio mudam visibilidade, cancelamento e entrega). Se um dia existir, este
   * valor passa a mentir sobre rodadas antigas — e a reprodução tem de ler o que foi
   * ASSINADO, não a configuração de hoje.
   */
  weightByMinutes: boolean;
  /** Os números da cadeia de prova DESTA rodada. */
  seedCommitment: string | null;
  seedRevealed: string | null;
  seedKeyVersion: number;
  resultHash: string | null;
  resultVersion: number;
  /** Quando (e por quem) o compromisso desta rodada foi publicado. */
  commitmentRecordedAt: Date | null;
  commitmentRecordedBy: string | null;
  /** Lista publicada. `null` = apuração anterior à FASE 29 (nada a reproduzir). */
  pool: RafflePoolEntry[] | null;
  poolRows: RaffleAuditPoolRow[];
  poolHash: string | null;
  poolCount: number;
  duplicatedCodes: string[];
  winners: RaffleAuditWinnerRow[];
  /** A conferência roda no SERVIDOR também: a página mostra o veredito sem JS. */
  reproduction: {
    /** Só é possível com lista publicada E semente revelada. */
    possible: boolean;
    reason: string | null;
    confirmed: boolean;
    matched: number;
    diverged: number;
    positions: {
      position: number;
      expectedCode: string | null;
      reproducedCode: string | null;
      reason: string;
    }[];
  };
}

export interface RaffleAudit {
  raffleId: string;
  eventId: string;
  title: string;
  status: RaffleStatus;
  isPublic: boolean;
  createdAt: Date;
  drawnAt: Date | null;
  scope: RaffleScope;
  activityId: string | null;
  referenceDate: Date | null;
  minAttendanceMinutes: number;
  winnersCount: number;
  alternatesCount: number;
  weightByMinutes: boolean;
  allowPriorEventWinners: boolean;
  /** Quando (e por quem) o compromisso da PRIMEIRA rodada foi publicado. */
  commitmentRecordedAt: Date | null;
  commitmentRecordedBy: string | null;
  /**
   * As rodadas, da primeira para a última. Cada uma se confere sozinha: compromisso,
   * semente, lista e reprodução. Desde a FASE 30 não existe "a auditoria do sorteio"
   * como um documento único — existe um documento por momento.
   */
  rounds: RaffleAuditRound[];
  /** Atalhos da última rodada apurada, para o cabeçalho da página. */
  resultHash: string | null;
  resultVersion: number;
  seedCommitment: string | null;
  seedRevealed: string | null;
  poolHash: string | null;
  poolCount: number;
}

/**
 * Tudo o que alguém precisa para auditar UM sorteio, em um só lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A REPRODUÇÃO TAMBÉM RODA AQUI, E NÃO SÓ NO NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────────
 *  A página precisa responder sem JavaScript (e um auditor precisa poder ler o
 *  veredito antes de confiar no próprio navegador). O servidor roda a MESMA função
 *  de domínio (`reproduceDraw`) e a tela mostra "confere / diverge"; quem quiser
 *  independência refaz a conta no cliente ou fora do site, com os números que a
 *  página publica. O veredito do servidor é conveniência, não a prova.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A AUDITORIA PASSOU A SER POR RODADA (FASE 30)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada apuração tem a própria semente e o próprio documento assinado. Uma conta só
 *  no fim do sorteio não diria QUAL momento foi conferido — e o resultado da rodada
 *  2 no lugar da 1 passaria como íntegro. Aqui cada rodada tem a sua seção, com o
 *  seu compromisso e a sua reprodução.
 *
 *  O nome vem pela mesma regra de consentimento dos ganhadores
 *  (`publicWinnerName`): a lista pública não pode expor mais do que o resultado já
 *  expõe.
 */
export async function getRaffleAudit(input: {
  tenantId: string;
  eventId: string;
  raffleId: string;
}): Promise<RaffleAudit | null> {
  try {
    const data = await withTenant(input.tenantId, async (tx) => {
      const raffle = await tx.raffle.findFirst({
        where: {
          id: input.raffleId,
          tenantId: input.tenantId,
          eventId: input.eventId,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          status: true,
          isPublic: true,
          scope: true,
          activityId: true,
          referenceDate: true,
          minAttendanceMinutes: true,
          winnersCount: true,
          alternatesCount: true,
          weightByMinutes: true,
          allowPriorEventWinners: true,
          createdAt: true,
          drawnAt: true,
          rounds: {
            orderBy: { roundNumber: 'asc' },
            select: {
              id: true,
              roundNumber: true,
              prizeTitle: true,
              prizeDescription: true,
              winnersCount: true,
              alternatesCount: true,
              seedCommitment: true,
              seedRevealed: true,
              seedKeyVersion: true,
              poolSnapshot: true,
              poolHash: true,
              resultHash: true,
              resultVersion: true,
              eligibleCount: true,
              drawnAt: true,
              sponsor: { select: { name: true, logoUrl: true } },
            },
          },
          winners: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              kind: true,
              roundNumber: true,
              attendanceMinutes: true,
              userId: true,
              user: { select: { name: true, isPublicProfile: true } },
            },
          },
        },
      });

      if (!raffle) return null;

      /**
       * A trilha da CRIAÇÃO de cada rodada é o que prova que o compromisso existia
       * ANTES: ela tem data e autor, e o valor gravado nela é o mesmo que a apuração
       * conferiu.
       */
      const creations = await tx.auditLog.findMany({
        where: {
          tenantId: input.tenantId,
          entityType: 'raffleRound',
          entityId: { in: raffle.rounds.map((round) => round.id) },
          action: 'CREATE',
        },
        orderBy: { createdAt: 'asc' },
        select: {
          entityId: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      });

      const pools = raffle.rounds.map(
        (round) => (round.poolSnapshot as unknown as StoredPoolEntry[] | null) ?? null,
      );

      const userIds = [
        ...new Set(
          pools
            .flatMap((pool) => (pool ?? []).map((entry) => entry.userId))
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      const winnerIds = [...new Set(raffle.winners.map((winner) => winner.userId))];

      const people = await tx.user.findMany({
        where: { id: { in: [...new Set([...userIds, ...winnerIds])] } },
        select: { id: true, name: true, isPublicProfile: true },
      });

      const byId = new Map(people.map((person) => [person.id, person]));

      const displayName = (userId: string | undefined | null): { name: string; masked: boolean } => {
        const person = userId ? byId.get(userId) : undefined;
        const publicProfile = person?.isPublicProfile ?? false;

        return {
          name: publicWinnerName({
            name: person?.name ?? 'Participante',
            publicProfile,
          }),
          masked: !publicProfile,
        };
      };

      return { raffle, creations, displayName };
    });

    if (!data) return null;

    const { raffle, creations, displayName } = data;

    const rounds: RaffleAuditRound[] = raffle.rounds.map((round) => {
      const stored = (round.poolSnapshot as unknown as StoredPoolEntry[] | null) ?? null;

      const pool: RafflePoolEntry[] | null = stored
        ? stored.map(({ index, code, minutes }) => ({ index, code, minutes }))
        : null;

      const poolRows: RaffleAuditPoolRow[] = (stored ?? []).map((entry) => ({
        index: entry.index,
        code: entry.code,
        minutes: entry.minutes,
        ...displayName(entry.userId),
      }));

      const winners: RaffleAuditWinnerRow[] = raffle.winners
        .filter((winner) => winner.roundNumber === round.roundNumber)
        .map((winner) => ({
          position: winner.position,
          kind: winner.kind as RaffleWinnerKind,
          /**
           * O código do ganhador é derivado do MESMO par (sorteio, participante) da
           * lista: é o que liga a linha da lista à posição do resultado. Rodada sem
           * lista publicada não tem código — e fica nulo em vez de inventado.
           */
          code: pool ? poolEntryCode(raffle.id, winner.userId) : null,
          minutes: winner.attendanceMinutes,
          ...displayName(winner.userId),
        }));

      const creation = creations.find((entry) => entry.entityId === round.id) ?? null;

      /**
       * A reprodução usa a lista PUBLICADA e a semente REVELADA DESTA rodada. Sem uma
       * das duas não há o que conferir — e a página diz qual das duas falta, em vez de
       * mostrar "não confere", que seria uma acusação errada.
       */
      let reproduction: RaffleAuditRound['reproduction'] = {
        possible: false,
        reason: null,
        confirmed: false,
        matched: 0,
        diverged: 0,
        positions: [],
      };

      if (round.drawnAt === null) {
        reproduction = {
          ...reproduction,
          reason: 'Esta rodada ainda não foi apurada.',
        };
      } else if (!pool) {
        reproduction = {
          ...reproduction,
          reason:
            'A lista publicada não existe nesta rodada: ela foi apurada antes de a lista passar a ser gravada.',
        };
      } else if (!round.seedRevealed) {
        reproduction = {
          ...reproduction,
          reason:
            'A semente não foi revelada nesta apuração (o cofre de sementes não estava configurado): o resultado é conferível por hash, mas não reproduzível.',
        };
      } else {
        const count = Math.min(pool.length, round.winnersCount + round.alternatesCount);
        const reproduced = reproduceDraw({
          pool,
          count,
          weightByMinutes: raffle.weightByMinutes,
          seed: round.seedRevealed,
        }).map((entry, index) => ({
          /**
           * As posições continuam as do SORTEIO (FASE 30): a rodada 2 não recomeça em
           * "1º", e é por isso que a reprodução liga com o que o balcão entrega.
           */
          position: (winners[0]?.position ?? 1) + index,
          code: entry.code,
        }));

        const comparison = compareDraw({
          stored: winners.map((winner) => ({
            position: winner.position,
            code: winner.code ?? '',
          })),
          reproduced,
        });

        reproduction = {
          possible: true,
          reason: null,
          confirmed: comparison.confirmed,
          matched: comparison.matched,
          diverged: comparison.diverged,
          positions: comparison.positions.map((entry) => ({
            position: entry.position,
            expectedCode: entry.expectedCode,
            reproducedCode: entry.reproducedCode,
            reason: entry.reason,
          })),
        };
      }

      return {
        roundNumber: round.roundNumber,
        prizeTitle: round.prizeTitle,
        prizeDescription: round.prizeDescription,
        sponsorName: round.sponsor?.name ?? null,
        sponsorLogoUrl: round.sponsor?.logoUrl ?? null,
        drawnAt: round.drawnAt,
        winnersCount: round.winnersCount,
        alternatesCount: round.alternatesCount,
        weightByMinutes: raffle.weightByMinutes,
        seedCommitment: round.seedCommitment,
        seedRevealed: round.seedRevealed,
        seedKeyVersion: round.seedKeyVersion,
        resultHash: round.resultHash,
        resultVersion: round.resultVersion,
        commitmentRecordedAt: creation?.createdAt ?? null,
        commitmentRecordedBy: creation?.user?.name ?? null,
        pool,
        poolRows,
        poolHash: round.poolHash,
        poolCount: pool?.length ?? 0,
        duplicatedCodes: pool ? findDuplicateCodes(pool) : [],
        winners,
        reproduction,
      };
    });

    const drawn = rounds.filter((round) => round.drawnAt !== null);
    const last = drawn[drawn.length - 1] ?? null;

    return {
      raffleId: raffle.id,
      eventId: input.eventId,
      title: raffle.title,
      status: raffle.status as RaffleStatus,
      isPublic: raffle.isPublic,
      createdAt: raffle.createdAt,
      drawnAt: raffle.drawnAt,
      scope: raffle.scope as RaffleScope,
      activityId: raffle.activityId,
      referenceDate: raffle.referenceDate,
      minAttendanceMinutes: raffle.minAttendanceMinutes,
      winnersCount: raffle.winnersCount,
      alternatesCount: raffle.alternatesCount,
      weightByMinutes: raffle.weightByMinutes,
      allowPriorEventWinners: raffle.allowPriorEventWinners,
      commitmentRecordedAt: rounds[0]?.commitmentRecordedAt ?? null,
      commitmentRecordedBy: rounds[0]?.commitmentRecordedBy ?? null,
      rounds,
      resultHash: last?.resultHash ?? null,
      resultVersion: last?.resultVersion ?? RESULT_PAYLOAD_VERSION,
      seedCommitment: last?.seedCommitment ?? null,
      seedRevealed: last?.seedRevealed ?? null,
      poolHash: last?.poolHash ?? null,
      poolCount: last?.poolCount ?? 0,
    };
  } catch (error) {
    console.error(`[raffles] falha ao montar a auditoria do sorteio: ${errorMessage(error)}`);
    return null;
  }
}

/**
 * O documento canônico da lista, para a página publicar como texto copiável.
 *
 * Publicar o canônico é o que permite a um auditor refazer o `poolHash` **fora** do
 * site, com `sha256sum` e nada mais.
 */
export function auditPoolDocument(pool: readonly RafflePoolEntry[] | null): string {
  return pool ? canonicalPool(pool) : '';
}

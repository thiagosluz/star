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
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE ARQUIVO É A ESCRITA (FASE 75 · fatia 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Criar, preparar a rodada, apurar, entregar o prêmio, publicar e cancelar
 *  dividem UMA transação com o bloqueio `FOR UPDATE` — separá-las quebraria a
 *  garantia que a fase existe para preservar (ADR-175/178). Por isso a LEITURA
 *  saiu para dois irmãos e a escrita ficou aqui, intocada:
 *
 *    • `raffle-read-service`      — prévia de elegíveis, histórico e contagem ao
 *                                   vivo (e os leitores do universo que a
 *                                   apuração consome DENTRO do `tx` do chamador);
 *    • `raffle-public-view-service` — resultado público, telão e auditoria.
 *
 *  A extração foi mecânica: `git diff` mostra linhas REMOVIDAS, não reescritas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomInt, randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { rewardRaffleWonById } from '@/lib/gamification/hooks';
import {
  MAX_ALTERNATES,
  MAX_WINNERS,
  RESULT_PAYLOAD_VERSION,
  buildResultPayload,
  createSeededRandomInt,
  dayKey,
  evaluateEligibility,
  hashResult,
  seedCommitment,
  selectWeightedWinners,
  selectWinners,
  validateRaffleConfig,
  type RaffleConfig,
  type RaffleScope,
  type RaffleWinnerKind,
} from '@/domain/raffles/raffle-rules';
import { createRaffleSeed, sealSeed, unsealSeed } from '@/lib/raffles/seed-vault';
import { LEGACY_SEED_KEY_VERSION } from '@/domain/raffles/seed-key-rules';
import {
  findDuplicateCodes,
  poolEntryCode,
  poolHash,
  type RafflePoolEntry,
} from '@/domain/raffles/pool-rules';
import {
  evaluateDeliveryReversal,
} from '@/domain/raffles/stage-rules';
import {
  canDrawRound,
  canPrepareRound,
  normalizePrizeDescription,
  normalizePrizeTitle,
  pendingRound,
} from '@/domain/raffles/round-rules';
import {
  loadAttendances,
  loadPriorWinnerIds,
  loadRaffleWinnerIds,
  type RaffleResult,
} from '@/lib/raffles/raffle-read-service';

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
  /** Interruptor do telão (E37). Nasce LIGADO; só `false` desliga. */
  bigscreenVisible: boolean;
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
      bigscreenVisible: true,
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
    const drawn = await withTenant(input.tenantId, async (tx) => {
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

    /**
     * ── SER SORTEADO MOVE A GAMIFICAÇÃO (FASE 43) ─────────────────────────────
     *
     *  A apuração está GRAVADA (rodada, posições e assinatura) — o crédito é
     *  consequência, e por isso sai depois do commit e sem poder falhar (invariante 8):
     *  um erro ao conceder a carta não pode desfazer um sorteio já anunciado.
     *
     *  Só o GANHADOR (`WINNER`): o suplente é a reserva, e creditá-lo premiaria um
     *  prêmio que talvez nunca exista. O XP é 0 de propósito — o prêmio é a
     *  recompensa —, e o que o fato concede é a carta e o progresso de missão.
     */
    if (drawn.ok) {
      for (const winner of drawn.winners) {
        if (winner.kind !== 'WINNER') continue;

        await rewardRaffleWonById({
          tenantId: input.tenantId,
          userId: winner.userId,
          roundId: drawn.roundId,
          position: winner.position,
        });
      }
    }

    return drawn;
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
//  Interruptor do telão (E37 · FASE 51)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Liga ou desliga o telão do sorteio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO É A MESMA COISA QUE `isPublic`
 * ─────────────────────────────────────────────────────────────────────────────
 *  São dois públicos e dois momentos. `isPublic` decide se o RESULTADO aparece na
 *  página do evento para quem procura depois; este interruptor decide se o PALCO — o
 *  endereço que fica projetado na parede — responde AGORA, e ele mostra o título do
 *  prêmio desde a criação do sorteio. Negar o acesso até a instituição decidir ligar
 *  o telão é o que a dívida E37 pede, e não passa por `isPublic`: o organizador tem
 *  de poder testar o endereço antes do evento com a parede fora do ar.
 *
 *  O estado nasce LIGADO (default da coluna) e a virada entra na trilha: quem
 *  desligou a parede no meio da abertura precisa estar registrado.
 */
export async function setBigscreenVisibility(input: {
  tenantId: string;
  raffleId: string;
  actorId: string;
  visible: boolean;
}): Promise<RaffleResult<{ raffleId: string; bigscreenVisible: boolean }>> {
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

      await tx.raffle.update({
        where: { id: raffle.id },
        data: { bigscreenVisible: input.visible },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'raffle',
          entityId: raffle.id,
          changes: {
            bigscreenVisible: { from: raffle.bigscreenVisible, to: input.visible },
          },
        },
        tx,
      );

      return { ok: true as const, raffleId: raffle.id, bigscreenVisible: input.visible };
    });
  } catch (error) {
    console.error(`[raffles] falha ao alterar o telão do sorteio: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível alterar o telão do sorteio.',
    };
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



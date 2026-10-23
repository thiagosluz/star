/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Sorteios: leitura
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (FASE 75 · fatia 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `raffle-service` passou a ser o arquivo da ESCRITA: as funções que abrem
 *  transação, travam a linha do sorteio e gravam continuam lá, intocadas, porque
 *  dividem UMA transação com a apuração (ADR-175/178). Aqui mora o que só LÊ: a
 *  prévia de elegíveis, o histórico paginado e a contagem ao vivo da tela de
 *  operação.
 *
 *  A extração foi MECÂNICA: o corpo das funções veio sem reescrita. O que mudou foi
 *  o lugar e o cabeçalho de imports.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DIREÇÃO DO GRAFO: ESTE ARQUIVO É A BASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O contrato de resultado (`RaffleResult`/`RaffleErrorCode`) e os leitores do
 *  UNIVERSO do sorteio (`loadAttendances`, `loadPriorWinnerIds`,
 *  `loadRaffleWinnerIds`) vivem aqui porque a APURAÇÃO também os usa. O
 *  `raffle-service` importa daqui; este arquivo não importa de lá — é isso que
 *  impede um ciclo de importação entre os dois irmãos.
 *
 *  Os três leitores recebem `tx` de propósito: quem os chama na escrita é
 *  `drawRound`, DENTRO da transação que já travou o sorteio. Eles não abrem
 *  transação própria; quem abre é o chamador. Movê-los para cá foi mover LEITURA
 *  (a consulta), não a fronteira de transação.
 */
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  evaluateEligibility,
  evaluateReadiness,
  resolveRafflePage,
  type AttendanceSample,
  type EligibleParticipant,
  type RaffleConfig,
  type RaffleReadiness,
  type RaffleScope,
  type RaffleWinnerKind,
} from '@/domain/raffles/raffle-rules';
import type { RaffleHistoryFilter } from '@/domain/raffles/stage-rules';
import {
  lastDrawnRound,
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

/**
 * Presenças do evento como o domínio as enxerga.
 *
 * Traz apenas o necessário para decidir elegibilidade: usuário, atividade, quando
 * aconteceu, quanto tempo e o status. `ABSENT` continua vindo para que o motivo do
 * descarte seja explicável na tela ("presença marcada como ausente").
 */
export async function loadAttendances(
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
export async function loadRaffleWinnerIds(tx: TxClient, raffleId: string): Promise<string[]> {
  const rows = await tx.raffleWinner.findMany({
    where: { raffleId },
    select: { userId: true },
  });

  return rows.map((row) => row.userId);
}

/** Quem já ganhou algum sorteio deste evento (quando a regra exige excluir). */
export async function loadPriorWinnerIds(
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

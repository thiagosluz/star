/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Sorteios: projeção pública, telão e auditoria
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (FASE 75 · fatia 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quatro leituras publicam nome de quem concorreu ou ganhou — a seção de resultados
 *  do evento, a página do sorteio, o telão e a auditoria. Elas compartilham a MESMA
 *  régua de nome (`PUBLIC_WINNER_NAME_SELECT` + `publicWinnerRow`), e é por isso
 *  que ficam juntas: separá-las espalharia a régua, e a F60 mostrou o custo de duas
 *  respostas para a mesma pergunta (nome e máscara).
 *
 *  `raffle-service` ficou com a ESCRITA (criar, preparar, apurar, entregar,
 *  publicar, cancelar). Nada aqui abre transação de escrita: cada função faz a
 *  própria leitura sob RLS e devolve o dado projetado.
 *
 *  A extração foi MECÂNICA: o corpo das funções veio sem reescrita — inclusive os
 *  comentários que explicam as decisões de mascaramento.
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  RESULT_PAYLOAD_VERSION,
  publicWinnerEntry,
  type RaffleConfig,
  type RaffleScope,
  type RaffleWinnerKind,
} from '@/domain/raffles/raffle-rules';
import {
  isBigscreenVisible,
  rafflePublicationState,
  type RaffleStatus,
} from '@/domain/raffles/stage-rules';
import { lastDrawnRound, pendingRound } from '@/domain/raffles/round-rules';
import {
  canonicalPool,
  compareDraw,
  findDuplicateCodes,
  poolEntryCode,
  reproduceDraw,
  type RafflePoolEntry,
} from '@/domain/raffles/pool-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura pública (item G5)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os campos de `user` que a régua do nome público precisa — e nada além deles.
 *
 * ─── POR QUE A OCULTAÇÃO DA MODERAÇÃO ENTROU AQUI (FASE 60 · dívida E79) ────────
 *
 *  Quatro leituras desta camada publicam nome de quem concorreu ou ganhou — e as
 *  duas primeiras servem mais de uma superfície: a seção de resultados do evento (e a
 *  prévia da página, que usa a MESMA leitura), a página do sorteio
 *  (`getPublicRaffleResult`), o telão (`getRaffleStageView`) e a auditoria
 *  (`getRaffleAudit`). Todas liam `name` e `isPublicProfile` AO VIVO e resolviam o
 *  nome pelo consentimento antigo — então quem a moderação da plataforma ocultou
 *  (F56 · E62) e tinha aquele consentimento ligado continuava com o nome COMPLETO
 *  numa página aberta a qualquer visitante. A coluna passou a ser lida por todas
 *  elas, e a decisão é a da fonte única (`publicWinnerEntry`, no domínio): a
 *  ocultação vence o consentimento.
 *
 *  A MÁSCARA é a decisão, e não a remoção da linha: o resultado é um artefato
 *  público já publicado (lista assinada, posição, prêmio e contagem), e a auditoria
 *  precisa continuar conferindo a apuração — o conteúdo assinado é
 *  `{ index, code, minutes }` e não carrega nome, então abreviar o texto não
 *  invalida hash nenhum. O rótulo é o NEUTRO do próprio sorteio (`Ana S.`, o mesmo
 *  de quem nunca autorizou o nome): anunciar "oculto pela moderação" contaria a
 *  decisão da plataforma a estranhos.
 */
const PUBLIC_WINNER_NAME_SELECT = {
  name: true,
  isPublicProfile: true,
  /** O efeito da moderação da plataforma (F56 · E62) — ver o bloco acima. */
  publicProfileHiddenAt: true,
} as const;

/** Quem pode ser citado: os três campos que a régua do nome consome. */
interface PublicWinnerPerson {
  name: string;
  isPublicProfile: boolean;
  publicProfileHiddenAt: Date | null;
}

/**
 * O nome público de UMA linha (ganhador, suplente ou concorrente da lista), já com
 * a marca de máscara que a tela publica em `data-masked`.
 *
 * Nome e máscara saem JUNTOS de propósito: são a mesma pergunta, e responder as duas
 * em lugares diferentes foi o que permitiu `masked: false` conviver com um nome
 * abreviado (ou o contrário). Pessoa ausente do banco cai no rótulo genérico já
 * usado antes — `Participante` —, nunca no nome de outra pessoa.
 */
function publicWinnerRow(
  person: PublicWinnerPerson | null | undefined,
): { name: string; masked: boolean } {
  if (!person) return { name: 'Participante', masked: true };

  return publicWinnerEntry({
    name: person.name,
    publicProfile: person.isPublicProfile,
    publicProfileHiddenAt: person.publicProfileHiddenAt,
  });
}

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
    user: PublicWinnerPerson | null;
  }[];
  createdAt: Date;
}): PublicRaffleRound {
  const mapped = input.winners
    .filter((winner) => winner.roundNumber === input.round.roundNumber)
    .map((winner) => ({
      position: winner.position,
      kind: winner.kind,
      ...publicWinnerRow(winner.user),
    }));

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
 * O nome sai MASCARADO por padrão: quem se credenciou não consentiu em ter o nome
 * publicado na internet. Quem tem perfil público (`User.isPublicProfile`) aparece com
 * o nome completo — consentimento explícito —, e quem a moderação da plataforma
 * ocultou (F56 · E62 → F60 · E79) recebe a MESMA máscara de quem não autoriza, sem
 * perder a posição nem o prêmio (`publicWinnerRow`).
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
              user: { select: PUBLIC_WINNER_NAME_SELECT },
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
 *  padrão — quem se credenciou não consentiu em ter o nome publicado, quem tem
 *  perfil público aparece inteiro e quem a moderação da plataforma ocultou
 *  (F56 · E62 → F60 · E79) fica com o nome abreviado, sem sair da lista.
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
              user: { select: PUBLIC_WINNER_NAME_SELECT },
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
//  Estado ao vivo de UM sorteio (FASE 29)
// ───────────────────────────────────────────────────────────────────────────────
export interface RaffleLiveState {
  raffleId: string;
  /**
   * O telão está no ar? (E37 · FASE 51)
   *
   * Quando `false`, TUDO o que se refere ao conteúdo vem vazio: nem prêmio da rodada
   * anunciada, nem resultado. A rota pública do ao vivo é outra porta para o mesmo
   * palco, e deixá-la respondendo o que a parede passou a esconder seria desfazer o
   * interruptor por baixo.
   */
  bigscreenVisible: boolean;
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
          bigscreenVisible: true,
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

      /**
       * O INTERRUPTOR ZERA O CONTEÚDO DO AO VIVO (E37 · FASE 51): com o telão
       * desligado, a rota entrega o aviso e mais nada — nem o prêmio da rodada
       * anunciada, nem o hash do resultado. O `status` fica porque é ele que diz à
       * página que o sorteio existe; a contagem de elegíveis quem decide é a rota,
       * que só a consulta quando há rodada pendente.
       */
      const visible = isBigscreenVisible(row.bigscreenVisible);

      return {
        raffleId: row.id,
        bigscreenVisible: visible,
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
        drawnAt: visible ? row.drawnAt : null,
        resultHash: visible ? (last?.resultHash ?? null) : null,
        poolHash: null,
        pendingRound:
          visible && pending
            ? {
                roundId: pending.id,
                roundNumber: pending.roundNumber,
                prizeTitle: pending.prizeTitle,
                seedCommitment: pending.seedCommitment,
              }
            : null,
        lastDrawnRound:
          visible && last
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

/**
 * O palco DESLIGADO pela organização (E37 · FASE 51).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TIPO NÃO CARREGA NADA DO SORTEIO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A promessa do interruptor é "quem tem o link passa a ver só o aviso". Se o
 *  desligado devolvesse os mesmos campos com valor nulo, um renderizador distraído
 *  (ou uma mudança futura) voltaria a exibir o prêmio — e o vazamento seria um bug de
 *  tela, não uma decisão. Separar os tipos faz o compilador cobrar a decisão: com
 *  `bigscreenVisible: false` não existe `prizeTitle` para esquecer de esconder.
 *
 *  O `raffleId` fica porque a página precisa dele para montar o caminho de volta da
 *  organização — e quem tem o link já conhece o identificador.
 */
export interface RaffleStageHidden {
  bigscreenVisible: false;
  raffleId: string;
}

/** O palco LIGADO: o que a parede mostra (FASE 29/30). */
export interface RaffleStageContent {
  bigscreenVisible: true;
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
 * O que o palco devolve: o conteúdo (ligado) ou apenas o aviso (desligado).
 *
 * A união é o contrato que impede o vazamento de virar descuido de tela.
 */
export type RaffleStageView = RaffleStageContent | RaffleStageHidden;

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
 * existe para anunciar — e é a decisão registrada da fase. Desde a E37 esse anúncio
 * é CONDICIONAL: a instituição pode negar o palco até decidir ligá-lo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ROLETA USA OS NOMES REAIS, MASCARADOS (FASE 30)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Os nomes que passam na tela são os da LISTA PUBLICADA da rodada — a mesma que a
 *  auditoria confere —, e não nomes inventados: quem está na sala vê o próprio nome
 *  passar, e a roleta para em alguém que realmente concorria. Inventar nomes seria
 *  mais fácil e menos honesto: daria a impressão de sorteio sobre gente que não
 *  estava no páreo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O INTERRUPTOR DO TELÃO VEM ANTES DE TUDO (E37 · FASE 51)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Com o telão desligado a resposta é `{ bigscreenVisible: false, raffleId }` — sem
 *  título, sem prêmio, sem um único nome. O `null` continua significando uma coisa
 *  só: o sorteio não existe (endereço errado), e é isso que a página traduz em 404.
 */
export async function getRaffleStageView(input: {
  tenantId: string;
  eventId: string;
  raffleId: string;
}): Promise<RaffleStageView | null> {
  try {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O INTERRUPTOR É LIDO ANTES DE QUALQUER CONTEÚDO (E37 · FASE 51)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Esta primeira leitura traz UM campo: o interruptor. Com o telão desligado a
     *  função volta AQUI — as rodadas, a lista publicada e os nomes dos elegíveis nem
     *  chegam a ser consultados. Não é só a tela que não mostra: não há o que vazar,
     *  porque a consulta pesada nunca acontece. É mais barato e é mais honesto.
     */
    const gate = await withTenant(input.tenantId, (tx) =>
      tx.raffle.findFirst({
        where: {
          id: input.raffleId,
          tenantId: input.tenantId,
          eventId: input.eventId,
          deletedAt: null,
        },
        select: { id: true, bigscreenVisible: true },
      }),
    );

    if (!gate) return null;

    if (!isBigscreenVisible(gate.bigscreenVisible)) {
      return { bigscreenVisible: false, raffleId: gate.id };
    }

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
              user: { select: PUBLIC_WINNER_NAME_SELECT },
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
        select: { id: true, ...PUBLIC_WINNER_NAME_SELECT },
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

    const displayName = (userId: string | undefined): { name: string; masked: boolean } =>
      publicWinnerRow(userId ? byId.get(userId) : undefined);

    /**
     * ── O NOME DOS GANHADORES VEM DO BANCO, NÃO DA LISTA ────────────────────────
     * A lista publicada guarda CÓDIGO (não identidade), então os nomes dos ganhadores
     * são resolvidos pela relação `user` — a mesma régua de sempre, com a ocultação da
     * moderação já aplicada por `publicWinnerRow`.
     */
    const mapped = row.winners.map((winner) => ({
      position: winner.position,
      roundNumber: winner.roundNumber,
      kind: winner.kind,
      ...publicWinnerRow(winner.user),
    }));

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
      bigscreenVisible: true,
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
 *  O nome vem pela mesma régua de consentimento dos ganhadores
 *  (`publicWinnerEntry`): a lista pública não pode expor mais do que o resultado já
 *  expõe. Quem a moderação da plataforma ocultou (F56 · E62 → F60 · E79) aparece
 *  abreviado TAMBÉM aqui — a conferência continua inteira, porque a conta é feita
 *  sobre `{ index, code, minutes }` e o nome nunca entrou em hash nenhum.
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
              user: { select: PUBLIC_WINNER_NAME_SELECT },
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
        select: { id: true, ...PUBLIC_WINNER_NAME_SELECT },
      });

      const byId = new Map(people.map((person) => [person.id, person]));

      const displayName = (userId: string | undefined | null): { name: string; masked: boolean } =>
        publicWinnerRow(userId ? byId.get(userId) : undefined);

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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RODADAS DE APURAÇÃO (FASE 30)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDOU, E POR QUE A PROVA PASSOU A SER POR MOMENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O sorteio tinha UMA apuração. A operação pediu o que o palco faz de verdade:
 *  sortear em MOMENTOS separados — o primeiro brinde agora, o segundo depois do
 *  intervalo —, cada um com o seu prêmio e o seu patrocinador.
 *
 *  A prova não podia continuar sendo uma só. A semente é REVELADA em cada apuração:
 *  se todas as rodadas usassem a mesma, quem lesse a revelação da primeira
 *  calcularia os ganhadores das seguintes — no palco, com a plateia olhando. Então
 *  cada rodada tem o seu compromisso, publicado ANTES dela, e o seu documento
 *  assinado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS REGRAS QUE ESTE MÓDULO GUARDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **Uma rodada preparada de cada vez.** Preparar a rodada 3 com a 2 ainda não
 *       apurada deixaria dois compromissos no ar e nenhuma ordem — o telão não saberia
 *       o que anunciar;
 *    2. **Rodada apurada não se apura de novo.** Refazer mudaria um resultado já
 *       publicado (e o público já viu o número);
 *    3. **O prêmio é ANÚNCIO, não entrada do sorteio.** Ele não entra no conteúdo
 *       assinado: corrigir uma vírgula no texto do prêmio não pode invalidar um
 *       resultado publicado (ADR-145). O que é assinado é o que decide o sorteio —
 *       semente, lista, minutos e posições.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Teto do título do prêmio — o mesmo da coluna (`varchar(200)`). */
export const MAX_PRIZE_TITLE = 200;
/** Teto da descrição do prêmio — generoso, mas finito (a tela não é um blog). */
export const MAX_PRIZE_DESCRIPTION = 600;

export type RoundState = 'PREPARED' | 'DRAWN';

export const ROUND_STATE_LABELS: Readonly<Record<RoundState, string>> = {
  PREPARED: 'Preparada — aguardando a apuração',
  DRAWN: 'Apurada',
};

/** O mínimo que uma rodada precisa expor para as guardas decidirem. */
export interface RoundRef {
  roundNumber: number;
  drawnAt: Date | null;
}

export function roundStateOf(round: RoundRef): RoundState {
  return round.drawnAt ? 'DRAWN' : 'PREPARED';
}

/** A próxima rodada é sempre a maior existente + 1 (a 1 nasce com o sorteio). */
export function nextRoundNumber(rounds: readonly RoundRef[]): number {
  return rounds.reduce((max, round) => Math.max(max, round.roundNumber), 0) + 1;
}

/** A rodada preparada e ainda não apurada — no máximo uma, por construção. */
export function pendingRound<T extends RoundRef>(rounds: readonly T[]): T | null {
  return rounds.find((round) => roundStateOf(round) === 'PREPARED') ?? null;
}

/** A última rodada apurada — é dela que a tela mostra o resultado mais recente. */
export function lastDrawnRound<T extends RoundRef>(rounds: readonly T[]): T | null {
  return (
    [...rounds]
      .filter((round) => roundStateOf(round) === 'DRAWN')
      .sort((a, b) => b.roundNumber - a.roundNumber)[0] ?? null
  );
}

export type PrepareRoundDecision =
  | { ok: true; roundNumber: number }
  | { ok: false; code: 'RAFFLE_CANCELED' | 'PENDING_ROUND'; message: string };

/**
 * Pode preparar uma rodada nova?
 *
 * `PENDING_ROUND` é a guarda que mantém a ordem: com uma rodada preparada e não
 * apurada, preparar outra deixaria dois compromissos publicados sem dizer qual está
 * valendo — e o telão tem UM anúncio por vez.
 */
export function canPrepareRound(input: {
  raffleStatus: string;
  rounds: readonly RoundRef[];
}): PrepareRoundDecision {
  if (input.raffleStatus === 'CANCELED') {
    return {
      ok: false,
      code: 'RAFFLE_CANCELED',
      message: 'Este sorteio foi cancelado: não há rodada a preparar.',
    };
  }

  const pending = pendingRound(input.rounds);

  if (pending) {
    return {
      ok: false,
      code: 'PENDING_ROUND',
      message: `A rodada ${pending.roundNumber} já está preparada e ainda não foi apurada. Apure-a antes de preparar a próxima.`,
    };
  }

  return { ok: true, roundNumber: nextRoundNumber(input.rounds) };
}

export type DrawRoundDecision =
  | { ok: true }
  | {
      ok: false;
      code: 'RAFFLE_CANCELED' | 'ROUND_DRAWN' | 'NO_ROUND';
      message: string;
    };

/** Pode apurar esta rodada? */
export function canDrawRound(input: { raffleStatus: string; round: RoundRef | null }): DrawRoundDecision {
  if (input.raffleStatus === 'CANCELED') {
    return {
      ok: false,
      code: 'RAFFLE_CANCELED',
      message: 'Este sorteio foi cancelado.',
    };
  }

  if (!input.round) {
    return {
      ok: false,
      code: 'NO_ROUND',
      message: 'Este sorteio não tem rodada preparada: prepare a próxima rodada antes de apurar.',
    };
  }

  if (roundStateOf(input.round) === 'DRAWN') {
    return {
      ok: false,
      code: 'ROUND_DRAWN',
      message: `A rodada ${input.round.roundNumber} já foi apurada. Prepare a próxima rodada para um novo momento.`,
    };
  }

  return { ok: true };
}

/** Como a rodada é chamada na tela — com o prêmio, quando houver. */
export function describeRound(input: { roundNumber: number; prizeTitle?: string | null }): string {
  const prize = input.prizeTitle?.trim();

  return prize ? `Rodada ${input.roundNumber} — ${prize}` : `Rodada ${input.roundNumber}`;
}

/** Rótulo curto do prêmio, para o telão e a lista. */
export function prizeLabel(prizeTitle?: string | null): string {
  const prize = prizeTitle?.trim();

  return prize && prize.length > 0 ? prize : 'Prêmio surpresa';
}

/**
 * Normaliza o título do prêmio: espaço em branco vira `null`, e o teto é aplicado.
 *
 * Truncar em vez de recusar é decisão: o prêmio é anúncio, e perder a apuração
 * porque o texto passou de 200 caracteres seria trocar um problema de vitrine por um
 * problema de palco.
 */
export function normalizePrizeTitle(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();

  return value.length === 0 ? null : value.slice(0, MAX_PRIZE_TITLE);
}

export function normalizePrizeDescription(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();

  return value.length === 0 ? null : value.slice(0, MAX_PRIZE_DESCRIPTION);
}

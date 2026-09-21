/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A LISTA PUBLICADA DO SORTEIO (FASE 29)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FALTAVA NA AUDITORIA DA FASE 16
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O commit-reveal da FASE 16 prova que a SEMENTE foi escolhida antes da apuração:
 *  `sha256(semente revelada)` é igual ao compromisso publicado na criação. O que ele
 *  NÃO provava é que os ganhadores saem daquela semente — a página pública prometia
 *  "o resultado se reproduz rodando o sorteio com ela" e não publicava a ENTRADA do
 *  sorteio: quem eram os elegíveis, em que ordem e com quantos minutos. Sem a
 *  entrada, "reproduzir" é uma afirmação que ninguém consegue conferir.
 *
 *  Este módulo é a entrada, em forma publicável e conferível:
 *
 *    1. `poolEntryCode` — identidade pública e ESTÁVEL de cada participante (um
 *       digest do par sorteio+participante). Ninguém precisa do `userId` para
 *       conferir a conta, e cada pessoa consegue se localizar na lista pelo próprio
 *       código (que também aparece no resultado, se ela ganhar).
 *    2. `canonicalPool` / `poolHash` — o documento canônico da lista. A ORDEM faz
 *       parte do contrato: o sorteio é sensível a ela (o desempate de pesos é a
 *       ordem), então trocar duas linhas de lugar muda o hash.
 *    3. `reproduceDraw` — roda a MESMA seleção da apuração (`selectWinners` /
 *       `selectWeightedWinners` com `createSeededRandomInt`) sobre a lista
 *       publicada. Duas implementações divergiriam, e a auditoria passaria a
 *       validar uma regra que não é a que rodou — o defeito exato que a FASE 22
 *       documentou para a contagem de elegíveis.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA LISTA *NÃO* PROVA (declarado, não escondido)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O compromisso amarra a SEMENTE, não a lista: o credenciamento continua até o
 *  momento da apuração, então não existe "antes" para comprometer a lista. Quem
 *  confere prova que (a) a semente foi fixada antes, (b) a lista publicada é a que
 *  gerou o resultado gravado e (c) nada disso mudou depois — a data de tudo isso
 *  fica na trilha de auditoria. O que a conferência NÃO prova é que a lista não foi
 *  editada por quem tinha acesso ao banco ANTES de ser gravada. Dizer isso em voz
 *  alta é o que separa auditoria de teatro: a alternativa (comprometer a lista
 *  antes) exigiria fechar o credenciamento antes do sorteio, e aí o sorteio deixaria
 *  de ser "por presença real" — que é o produto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';

import {
  createSeededRandomInt,
  reproduceFromPool,
  type RafflePoolEntry,
} from '@/domain/raffles/raffle-rules';

export type { RafflePoolEntry } from '@/domain/raffles/draw-selection';

/**
 * Quantos dígitos hexadecimais o código público carrega.
 *
 * 12 dígitos (48 bits) tornam a colisão entre participantes do mesmo sorteio
 * desprezível — e, ao contrário de um número sequencial, o código não revela a
 * posição de quem entrou no credenciamento nem o `userId`.
 */
export const POOL_CODE_LENGTH = 12;

/** Prefixo do código: distingue o identificador de auditoria de um id de verdade. */
export const POOL_CODE_PREFIX = 'P-';

/** Código público e estável de um participante em UM sorteio. */
export function poolEntryCode(raffleId: string, userId: string): string {
  const digest = createHash('sha256').update(`${raffleId}:${userId}`, 'utf8').digest('hex');

  return `${POOL_CODE_PREFIX}${digest.slice(0, POOL_CODE_LENGTH).toUpperCase()}`;
}

/**
 * Documento canônico da lista.
 *
 * A ordem de campos é FIXA e a lista vai na ordem do sorteio: `JSON.stringify`
 * preserva a ordem de inserção, e depender disso em qualquer outro lugar seria
 * frágil — aqui a ordem é contrato, e mudá-la mudaria o hash de todo o histórico.
 */
export function canonicalPool(entries: readonly RafflePoolEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => ({
      index: entry.index,
      code: entry.code,
      minutes: entry.minutes,
    })),
  );
}

/** SHA-256 da lista canônica — entra no payload do resultado a partir da versão 3. */
export function poolHash(entries: readonly RafflePoolEntry[]): string {
  return createHash('sha256').update(canonicalPool(entries), 'utf8').digest('hex');
}

/**
 * A lista tem códigos repetidos?
 *
 * Colisão de digest é improvável, não impossível — e uma lista com dois códigos
 * iguais seria ambígua na conferência sem que ninguém percebesse. O chamador usa
 * isto para AVISAR (log e tela), nunca para recusar a apuração: travar o sorteio no
 * palco por causa de um digest seria trocar um risco remoto por um defeito certo.
 */
export function findDuplicateCodes(entries: readonly RafflePoolEntry[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.code)) duplicates.add(entry.code);
    seen.add(entry.code);
  }

  return [...duplicates];
}

/**
 * Reproduz a apuração a partir da lista publicada e da semente revelada.
 *
 * A seleção em si vive em `draw-selection.ts`, compartilhada com o navegador de
 * quem confere: aqui só entra o gerador semeado do servidor (`node:crypto`). Se a
 * reprodução tivesse implementação própria, a auditoria poderia discordar do
 * resultado por um motivo que não é o sorteio.
 */
export function reproduceDraw(input: {
  pool: readonly RafflePoolEntry[];
  count: number;
  weightByMinutes: boolean;
  seed: string;
}): RafflePoolEntry[] {
  return reproduceFromPool({
    pool: input.pool,
    count: input.count,
    weightByMinutes: input.weightByMinutes,
    randomInt: createSeededRandomInt(input.seed),
  });
}

/** Uma posição conferida: o que está gravado e o que a reprodução devolveu. */
export interface PoolDivergence {
  position: number;
  expectedCode: string | null;
  reproducedCode: string | null;
  reason: 'MISSING_STORED' | 'MISSING_REPRODUCED' | 'DIFFERENT_CODE' | 'CONFIRMED';
}

export interface DrawComparison {
  confirmed: boolean;
  /** Todas as posições, inclusive as que conferem — a tabela da tela mostra o rastro. */
  positions: PoolDivergence[];
  /** Quantas posições conferem. */
  matched: number;
  /** Quantas divergem (qualquer motivo que não seja `CONFIRMED`). */
  diverged: number;
}

/**
 * Compara o resultado gravado com o reproduzido, posição a posição.
 *
 * Devolve TODAS as posições, e não só a primeira diferença: quem audita precisa ver
 * "confere até a 8ª, a 9ª não" — uma lista de divergências sem as confirmações
 * esconde qual parte do resultado está sustentada.
 */
export function compareDraw(input: {
  stored: readonly { position: number; code: string }[];
  reproduced: readonly { position: number; code: string }[];
}): DrawComparison {
  const size = Math.max(input.stored.length, input.reproduced.length);
  const positions: PoolDivergence[] = [];

  for (let index = 0; index < size; index += 1) {
    const position = index + 1;
    const stored = input.stored[index];
    const reproduced = input.reproduced[index];

    if (!stored) {
      positions.push({
        position,
        expectedCode: null,
        reproducedCode: reproduced?.code ?? null,
        reason: 'MISSING_STORED',
      });
      continue;
    }

    if (!reproduced) {
      positions.push({
        position,
        expectedCode: stored.code,
        reproducedCode: null,
        reason: 'MISSING_REPRODUCED',
      });
      continue;
    }

    positions.push({
      position,
      expectedCode: stored.code,
      reproducedCode: reproduced.code,
      reason: stored.code === reproduced.code ? 'CONFIRMED' : 'DIFFERENT_CODE',
    });
  }

  const matched = positions.filter((entry) => entry.reason === 'CONFIRMED').length;

  return {
    confirmed: positions.length > 0 && matched === positions.length,
    positions,
    matched,
    diverged: positions.length - matched,
  };
}

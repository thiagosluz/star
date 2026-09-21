/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GERADOR SEMEADO NO NAVEGADOR (FASE 29)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A reprodução do sorteio roda nos dois lados, com a MESMA seleção
 *  (`draw-selection.ts`) e geradores diferentes:
 *
 *    • servidor — `createSeededRandomInt`, em `node:crypto` (HMAC-SHA256);
 *    • navegador — este arquivo, sobre a WebCrypto (`crypto.subtle`).
 *
 *  A derivação é a mesma, byte a byte: `HMAC-SHA256(semente, 'draw:<n>')`, os
 *  primeiros 4 bytes como inteiro sem sinal, e o módulo do teto. Se as duas
 *  sequências divergissem, a conferência acusaria divergência num sorteio correto —
 *  o pior defeito possível numa página de auditoria. Há teste comparando as duas
 *  sequências para o mesmo par (semente, teto).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `randomInt` É SÍNCRONO, SE A WEBCRYPTO É ASSÍNCRONA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A seleção recebe `(max) => number`, e é isso que a mantém pura e testável. A
 *  WebCrypto só entrega HMAC por `Promise`, então o adaptador PRÉ-CALCULA os blocos
 *  necessários e serve de um buffer: `createWebSeededRandomInt(seed, blocks)` devolve
 *  o gerador pronto, e o chamador o constrói uma vez, antes de sortear.
 *
 *  É o mesmo desenho do servidor, com o `await` movido para fora do laço — não uma
 *  segunda regra.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Quantos blocos de 4 bytes pré-calcular. Um sorteio consome ~1 por retirada. */
export const DEFAULT_BLOCK_BUDGET = 4096;

async function hmacBlocks(seed: string, blocks: number): Promise<number[]> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(seed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const values: number[] = [];

  for (let counter = 0; counter < blocks; counter += 1) {
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`draw:${counter}`));
    const view = new DataView(signature);

    values.push(view.getUint32(0, false));
  }

  return values;
}

/**
 * Gerador determinístico no navegador, com a MESMA derivação do servidor.
 *
 * O buffer é finito: se um sorteio consumir mais blocos do que o orçamento, o
 * gerador recusa em vez de repetir valores — repetir mudaria o resultado da
 * reprodução em silêncio, que é exatamente o que a auditoria não pode fazer.
 */
export function createWebSeededRandomInt(
  blocks: readonly number[],
): (max: number) => number {
  let counter = 0;

  return (max: number): number => {
    if (max <= 1) return 0;

    const value = blocks[counter];
    counter += 1;

    if (value === undefined) {
      throw new Error('Blocos insuficientes para reproduzir o sorteio neste navegador.');
    }

    return value % max;
  };
}

/** Prepara o gerador do navegador para uma semente (uma vez, antes de sortear). */
export async function prepareWebRandomInt(
  seed: string,
  blocks: number = DEFAULT_BLOCK_BUDGET,
): Promise<(max: number) => number> {
  return createWebSeededRandomInt(await hmacBlocks(seed, blocks));
}

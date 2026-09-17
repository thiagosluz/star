/**
 * Gerador de aleatoriedade do servidor.
 *
 * Vive na camada de aplicação (e não no domínio) porque o domínio é isomórfico:
 * componentes de cliente importam as regras de carta para renderizar paleta e
 * raridade, e um `import 'node:crypto'` ali quebraria o bundle do navegador.
 */

import { randomInt } from 'node:crypto';

/**
 * Número em [0, 1) com entropia criptográfica.
 *
 * `Math.random` não serve para distribuir itens de valor percebido: além de
 * previsível a partir de algumas saídas observadas, permitiria a alguém antecipar
 * o próximo sorteio — e carta rara é justamente o que motiva trapaça.
 *
 * `randomInt(0, 2**32)` é uniforme e não enviesa o resultado da multiplicação.
 */
export function secureRandom(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}

/**
 * Fila determinística de números para TESTES.
 *
 * Existe para que os testes de distribuição não dependam de sorte: injeta-se a
 * sequência e verifica-se a decisão. Passar `Math.random` para um teste de
 * raridade seria testar a sorte, não a regra.
 */
export function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
}

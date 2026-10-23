/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FILTRO DE QUERY — NÃO É ENDEREÇO
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTA REGRA FECHA (FASE 76 · fatia 2)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um id no CAMINHO identifica o recurso que a pessoa pediu: formato inválido ali é
 *  404, decidido antes de consultar (ver `src/lib/validation/id.ts`). Um id na QUERY
 *  é outra coisa: é FILTRO — a lista existe com ou sem ele. Tratar os dois igual
 *  produzia o pior dos três mundos:
 *
 *    • `?evento=nao-e-uuid` em certificados e modelos chegava ao Prisma e a tela
 *      respondia 500 (`invalid input syntax for type uuid`, armadilha 25);
 *    • `?evento=nao-e-uuid` no acervo de mídia era descartado em SILÊNCIO: a lista
 *      aparecia inteira e ninguém dizia que o filtro pedido não foi aplicado.
 *
 *  A regra da casa resolve os dois: **filtro malformado é filtro ignorado, e o que a
 *  tela esconde, ela anuncia**. Nada de 404 (a lista não é um recurso ausente) e nada
 *  de 500 (o banco não tem culpa do texto da URL).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A DECISÃO E A FRASE MORAM NO DOMÍNIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A frase do aviso é conteúdo de produto: aparece em três telas e precisa dizer a
 *  MESMA coisa nas três. Espalhá-la como string solta em cada `page.tsx` faria a
 *  próxima tela repetir o texto com outra redação — e o teste de cada página passaria
 *  a prender a própria cópia. Aqui ela é uma função pura, testável sem banco e sem
 *  Next, e o chamador decide apenas ONDE renderizá-la.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { isUuid } from './id-rules';

/** O que a tela faz com o valor que veio na query. */
export type UuidQueryFilterDecision =
  /** O valor tem forma de uuid: o filtro é aplicado com o texto já limpo. */
  | { kind: 'applied'; value: string }
  /** O valor não tem forma de uuid: o filtro é DESCARTADO e a tela anuncia. */
  | { kind: 'discarded'; notice: string };

/**
 * A frase do aviso, com o rótulo do filtro que a tela mostra ("evento", "modelo",
 * "evento de origem").
 *
 * Ela diz as duas coisas que importam: que o filtro NÃO foi aplicado e por quê — sem
 * isso, a lista inteira pareceria o resultado de um filtro que na verdade não existe.
 */
export function discardedFilterNotice(label: string): string {
  return `O filtro por ${label} foi descartado: o identificador no endereço não é válido. A lista continua sem esse filtro.`;
}

/**
 * Decide o destino de um filtro de query que só vale quando tem forma de uuid.
 *
 * Devolve `null` quando o parâmetro está ausente ou vazio: ausência de filtro não é
 * erro nem motivo de aviso — é o estado natural de quem abriu a tela sem filtrar.
 *
 * ─── POR QUE AQUI O TEXTO É LIMPO, E NO CAMINHO NÃO ─────────────────────────
 * `isUuid` não faz `trim` de propósito (endereço não tem espaço em volta). Filtro,
 * porém, vem de URL copiada à mão, e `" <uuid> "` é a mesma intenção de `"<uuid>"`:
 * limpar aqui evita 500 por um espaço invisível. A política é DESTE chamador — a
 * regra de formato continua sendo uma só.
 *
 * `extraValues` existe para os sentinelas que NÃO são uuid e mesmo assim são filtros
 * legítimos (o acervo de mídia tem `sem-evento`). Sem ele, um filtro válido seria
 * anunciado como descartado — o aviso mentiria sobre a própria tela.
 */
export function resolveUuidQueryFilter(input: {
  value: string | readonly string[] | null | undefined;
  /** Rótulo que a frase do aviso usa. */
  label: string;
  /** Valores aceitos que não têm forma de uuid (sentinelas do domínio chamador). */
  extraValues?: readonly string[];
}): UuidQueryFilterDecision | null {
  /**
   * O Next expõe parâmetro REPETIDO (`?evento=a&evento=b`) como array. Não existe UM
   * filtro pedido, existem dois — escolher o primeiro em silêncio inventaria o
   * recorte. A decisão é a mesma do valor torto: descarta e anuncia. O array vazio é
   * ausência (não há o que anunciar).
   */
  if (input.value !== null && input.value !== undefined && typeof input.value !== 'string') {
    const temAlgum = input.value.some((item) => item.trim().length > 0);

    return temAlgum
      ? { kind: 'discarded', notice: discardedFilterNotice(input.label) }
      : null;
  }

  const value = (input.value ?? '').trim();

  if (value.length === 0) return null;
  if (input.extraValues?.includes(value)) return { kind: 'applied', value };
  if (isUuid(value)) return { kind: 'applied', value };

  return { kind: 'discarded', notice: discardedFilterNotice(input.label) };
}

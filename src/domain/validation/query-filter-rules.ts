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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SELEÇÃO DE `?evento=` CONTRA A LISTA DISPONÍVEL (FASE 89 · dívida E89 · ADR-395)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Cinco telas carregam primeiro a lista de eventos disponíveis (`events`) e só
 *  depois escolhem qual exibir a partir de `?evento=`:
 *    • `/credenciamento`, `/credenciamento/crachas`, `/meu-cracha` e `/minha-agenda`
 *      caem no primeiro evento da lista (`fallback: 'first'`);
 *    • `/participantes` cai em "Todos os eventos" (`fallback: 'all'`).
 *
 *  Antes da FASE 89, o ternário `evento && events.some(...) ? evento : fallback`
 *  tratava qualquer `?evento=` que não casasse com `events` — fosse texto
 *  malformado (`?evento=nao-e-uuid`), parâmetro repetido ou um uuid inexistente /
 *  fora do escopo da pessoa — exatamente como AUSÊNCIA de parâmetro, caindo em
 *  outro evento (ou na instituição inteira) em silêncio. No balcão, isso permitia
 *  operar em outro evento sem aviso.
 *
 *  A regra segue o princípio da FASE 76: query não é endereço (não responde 404),
 *  mas **o que a tela descarta, ela anuncia**.
 */
export interface EventQuerySelectionResult<T extends { id: string; title?: string }> {
  selectedEventId: string | null;
  selectedEvent: T | null;
  discardedNotice: string | null;
}

/**
 * Frase canônica quando `?evento=` foi informado na URL, mas não pôde ser
 * aplicado contra a lista de eventos da tela.
 */
export function discardedEventSelectionNotice(input: {
  fallback: 'first' | 'all';
  fallbackEventTitle?: string | null;
  reason: 'invalid_format' | 'not_found';
}): string {
  if (input.fallback === 'all') {
    if (input.reason === 'invalid_format') {
      return discardedFilterNotice('evento');
    }

    return 'O filtro por evento foi descartado: o evento informado no endereço não foi encontrado nesta instituição. A lista continua sem esse filtro.';
  }

  const destino = input.fallbackEventTitle
    ? `Exibindo "${input.fallbackEventTitle}".`
    : 'Exibindo o primeiro evento disponível.';

  if (input.reason === 'invalid_format') {
    return `O evento indicado no endereço foi descartado: o identificador não é válido. ${destino}`;
  }

  return `O evento indicado no endereço não foi encontrado ou não está disponível para o seu acesso. ${destino}`;
}

/**
 * Resolve `?evento=` contra a lista `events` já carregada pela tela.
 *
 *   • Sem parâmetro (ou vazio/espaços): aplica o `fallback` sem aviso (`discardedNotice: null`).
 *   • Com parâmetro válido que consta em `events`: seleciona o evento sem aviso.
 *   • Com parâmetro malformado, repetido ou ausente de `events`: aplica o `fallback`
 *     e devolve `discardedNotice` com o motivo e o destino aplicado.
 */
export function resolveEventQuerySelection<T extends { id: string; title?: string }>(input: {
  value: string | readonly string[] | null | undefined;
  events: readonly T[];
  fallback: 'first' | 'all';
}): EventQuerySelectionResult<T> {
  const defaultEvent = input.fallback === 'first' ? (input.events[0] ?? null) : null;
  const defaultEventId = defaultEvent?.id ?? null;

  const filterDecision = resolveUuidQueryFilter({ value: input.value, label: 'evento' });

  if (filterDecision === null) {
    return {
      selectedEventId: defaultEventId,
      selectedEvent: defaultEvent,
      discardedNotice: null,
    };
  }

  if (filterDecision.kind === 'discarded') {
    return {
      selectedEventId: defaultEventId,
      selectedEvent: defaultEvent,
      discardedNotice: discardedEventSelectionNotice({
        fallback: input.fallback,
        fallbackEventTitle: defaultEvent?.title ?? null,
        reason: 'invalid_format',
      }),
    };
  }

  const matched = input.events.find((event) => event.id === filterDecision.value) ?? null;
  if (matched) {
    return {
      selectedEventId: matched.id,
      selectedEvent: matched,
      discardedNotice: null,
    };
  }

  return {
    selectedEventId: defaultEventId,
    selectedEvent: defaultEvent,
    discardedNotice: discardedEventSelectionNotice({
      fallback: input.fallback,
      fallbackEventTitle: defaultEvent?.title ?? null,
      reason: 'not_found',
    }),
  };
}

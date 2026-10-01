/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAGINAÇÃO DE LISTAS (FASE 56 · dívida E2)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O diretório de instituições paginava desde a FASE 9 — e só ele. Eventos e
 *  submissões carregavam TUDO para desenhar uma tela que mostra uma dúzia: a lista de
 *  eventos públicos e a lista de submissões do autor eram as duas últimas coleções sem
 *  teto, e a conta é simples — a página fica mais lenta a cada evento cadastrado, sem
 *  que ninguém perceba a causa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA É UM NÚMERO, E O NÚMERO VEM DA URL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem digita `?pagina=-3` ou `?pagina=abc` não pode ver erro nem lista vazia: a
 *  página vira 1, e o tamanho fica no intervalo permitido. Isso é REGRA, e por isso
 *  mora aqui — antes vivia dentro do `buildDirectory`, e lista nova que precisasse
 *  paginar copiaria a conta (ou esqueceria o teto).
 *
 *  `paginationWindow` devolve a janela pronta para o banco (`skip`/`take`) E os números
 *  da tela (`totalPages`, `hasPrev`, `hasNext`, `from`, `to`). Quem exibe não recalcula:
 *  duas contas para a mesma coisa divergem no dia em que uma delas mudar.
 */

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 48;

/** A página pedida, como número utilizável: inválida ou menor que 1 vira 1. */
export function normalizePage(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed < 1) return 1;

  return Math.floor(parsed);
}

/**
 * O tamanho da página, no intervalo permitido — e com `fallback`/`max` próprios de quem
 * chama, porque o diretório da plataforma tem outra régua (o valor padrão dele é o
 * mesmo, mas a intenção é dele).
 */
export function normalizePageSize(
  value: unknown,
  options: { fallback?: number; max?: number } = {},
): number {
  const fallback = options.fallback ?? DEFAULT_PAGE_SIZE;
  const max = options.max ?? MAX_PAGE_SIZE;

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed < 1) return fallback;

  return Math.min(Math.floor(parsed), max);
}

export interface PaginationWindow {
  /** A página EFETIVA — depois de normalizada e de limitada pelo total. */
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Quantos registros pular (para o `skip` do banco). */
  skip: number;
  /** Quantos trazer (para o `take` do banco). */
  take: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** Posição do primeiro e do último item da página, em 1..total (0 quando vazia). */
  from: number;
  to: number;
}

/**
 * A janela da lista.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PÁGINA É LIMITADA PELO TOTAL
 * ─────────────────────────────────────────────────────────────────────────────
 *  Pedir `?pagina=99` numa lista de 3 páginas devolvia lista vazia com a paginação
 *  apontando para "99 de 3" — besteira visível. A página efetiva é a última quando o
 *  pedido passa do fim, e a tela mostra onde a pessoa realmente está. Lista vazia
 *  (total 0) tem uma página só, vazia: `totalPages` nunca é 0, porque "página 1 de 0"
 *  não existe na cabeça de ninguém.
 */
export function paginationWindow(input: {
  page: unknown;
  pageSize: unknown;
  total: number;
  fallbackSize?: number;
  maxSize?: number;
}): PaginationWindow {
  const pageSize = normalizePageSize(input.pageSize, {
    fallback: input.fallbackSize,
    max: input.maxSize,
  });

  const total = Math.max(0, Math.floor(input.total));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(normalizePage(input.page), totalPages);
  const skip = (page - 1) * pageSize;
  const to = Math.min(skip + pageSize, total);

  return {
    page,
    pageSize,
    total,
    totalPages,
    skip,
    take: pageSize,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    from: total === 0 ? 0 : skip + 1,
    to,
  };
}

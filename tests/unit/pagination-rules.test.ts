import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePage,
  normalizePageSize,
  paginationWindow,
} from '../../src/domain/platform/pagination-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PAGINAÇÃO É REGRA (FASE 56 · dívida E2)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A página chega da URL como TEXTO, escrita por quem quiser: `?pagina=abc`, `?pagina=-3`,
 *  `?pagina=999999`, `?pagina=2.7`. Nada disso pode virar erro, lista vazia ou consulta
 *  absurda ao banco — e é o que este arquivo prende, sem banco e sem navegador.
 *
 *  A janela também é a fonte dos números que a TELA mostra (`totalPages`, `from`, `to`):
 *  se a lista e a barra de paginação fizerem contas diferentes, uma das duas mente.
 */
describe('normalizePage()', () => {
  it('texto inválido, zero, negativo ou vazio viram a página 1', () => {
    expect(normalizePage(undefined)).toBe(1);
    expect(normalizePage(null)).toBe(1);
    expect(normalizePage('')).toBe(1);
    expect(normalizePage('abc')).toBe(1);
    expect(normalizePage('0')).toBe(1);
    expect(normalizePage('-3')).toBe(1);
    expect(normalizePage(0)).toBe(1);
  });

  it('número com fração desce para o inteiro (página é contagem, não medida)', () => {
    expect(normalizePage('2.7')).toBe(2);
    expect(normalizePage(3.9)).toBe(3);
  });

  it('a página válida passa como está', () => {
    expect(normalizePage('2')).toBe(2);
    expect(normalizePage(7)).toBe(7);
  });
});

describe('normalizePageSize()', () => {
  it('sem valor, usa o padrão', () => {
    expect(normalizePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize('abc')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('respeita o teto: a lista não pode ser usada para baixar o banco inteiro', () => {
    expect(normalizePageSize('9999')).toBe(MAX_PAGE_SIZE);
    expect(normalizePageSize('9999', { max: 5 })).toBe(5);
  });

  it('aceita um padrão próprio de quem chama (o diretório tem a régua dele)', () => {
    expect(normalizePageSize(undefined, { fallback: 24 })).toBe(24);
  });
});

describe('paginationWindow()', () => {
  it('a primeira página começa no item 1 e para no tamanho da página', () => {
    const window = paginationWindow({ page: 1, pageSize: 10, total: 25 });

    expect(window.skip).toBe(0);
    expect(window.take).toBe(10);
    expect(window.totalPages).toBe(3);
    expect(window.from).toBe(1);
    expect(window.to).toBe(10);
    expect(window.hasPrev).toBe(false);
    expect(window.hasNext).toBe(true);
  });

  it('a última página pode ser CURTA — e o `to` é o total, não o fim da janela', () => {
    const window = paginationWindow({ page: 3, pageSize: 10, total: 25 });

    expect(window.skip).toBe(20);
    expect(window.from).toBe(21);
    expect(window.to).toBe(25);
    expect(window.hasNext).toBe(false);
    expect(window.hasPrev).toBe(true);
  });

  it('página além do fim cai na ÚLTIMA: lista vazia com "página 99 de 3" é besteira visível', () => {
    const window = paginationWindow({ page: 99, pageSize: 10, total: 25 });

    expect(window.page).toBe(3);
    expect(window.skip).toBe(20);
    expect(window.to).toBe(25);
  });

  it('lista vazia tem UMA página vazia: "página 1 de 0" não existe', () => {
    const window = paginationWindow({ page: 1, pageSize: 10, total: 0 });

    expect(window.totalPages).toBe(1);
    expect(window.from).toBe(0);
    expect(window.to).toBe(0);
    expect(window.hasPrev).toBe(false);
    expect(window.hasNext).toBe(false);
  });

  it('o tamanho da página respeita o teto, e a janela se ajusta a ele', () => {
    const window = paginationWindow({ page: 2, pageSize: 9999, total: 100, maxSize: 12 });

    expect(window.pageSize).toBe(12);
    expect(window.totalPages).toBe(9);
    expect(window.skip).toBe(12);
  });
});

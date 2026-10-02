/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — ESTADO DA BARRA LATERAL (FASE 59)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra do cookie `ef_nav`, e só ela — a leitura acontece na requisição, mas a
 *  INTERPRETAÇÃO do valor é aritmética de duas palavras, e é aqui que ela é
 *  provada sem Next, sem navegador e sem banco.
 *
 *    • `'rail'` recolhe a barra;
 *    • `'full'` a mantém inteira;
 *    • **ausente, vazio ou desconhecido cai em `full`** — o padrão é a barra do
 *      jeito que ela sempre foi, e é o que impede um cookie apagado, um valor
 *      inventado à mão ou um formato futuro de deixar a navegação encolhida sem
 *      ninguém ter pedido;
 *    • a inversão é ida e volta: aplicar duas vezes volta ao começo — repetir a
 *      ação nunca "trava" a barra num estado só.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  NAV_MODE_COOKIE,
  NAV_MODE_FULL,
  NAV_MODE_RAIL,
  navModeFromValue,
  navModeToggle,
} from '../../src/lib/shell/nav-mode';

describe('navModeFromValue — o valor do cookie vira estado da barra', () => {
  it('recolhe a barra com o valor "rail"', () => {
    expect(navModeFromValue('rail')).toBe(NAV_MODE_RAIL);
  });

  it('mantém a barra inteira com o valor "full"', () => {
    expect(navModeFromValue('full')).toBe(NAV_MODE_FULL);
  });

  it('trata ausência, vazio e valor desconhecido como barra inteira', () => {
    /**
     * `undefined` é o cookie que nunca foi gravado — e é o caso da esmagadora
     * maioria das requisições. Os outros são o que um cliente hostil (ou uma
     * versão futura do formato) pode mandar: nenhum deles pode produzir um estado
     * que ninguém pediu, e todos caem na barra do jeito que ela sempre foi.
     */
    const desconhecidos: unknown[] = [
      undefined,
      null,
      '',
      ' ',
      'RAIL',
      'Rail',
      'recolhida',
      'outra coisa',
      0,
      1,
      true,
      false,
      {},
      ['rail'],
    ];

    for (const valor of desconhecidos) {
      expect(navModeFromValue(valor), `valor: ${JSON.stringify(valor)}`).toBe(NAV_MODE_FULL);
    }
  });

  it('não confunde o nome do cookie com o valor', () => {
    /** O nome do cookie (`ef_nav`) nunca é um estado válido — a distração é fácil. */
    expect(navModeFromValue(NAV_MODE_COOKIE)).toBe(NAV_MODE_FULL);
  });
});

describe('navModeToggle — a inversão é ida e volta', () => {
  it('inverte nos dois sentidos', () => {
    expect(navModeToggle(NAV_MODE_FULL)).toBe(NAV_MODE_RAIL);
    expect(navModeToggle(NAV_MODE_RAIL)).toBe(NAV_MODE_FULL);
  });

  it('aplicar duas vezes volta ao estado inicial', () => {
    expect(navModeToggle(navModeToggle(NAV_MODE_FULL))).toBe(NAV_MODE_FULL);
    expect(navModeToggle(navModeToggle(NAV_MODE_RAIL))).toBe(NAV_MODE_RAIL);
  });
});

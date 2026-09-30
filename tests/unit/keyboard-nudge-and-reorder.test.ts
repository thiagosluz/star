/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — movimento por TECLADO (FASE 50 · dívidas E51 e E55)
 *
 *  As duas dívidas são a mesma família ("teclado onde só havia ponteiro"), e as duas
 *  dependem de uma conta pura que é fácil de errar em silêncio:
 *
 *   • E51 — a POSIÇÃO de destino ao subir/descer um cartão na coluna. O índice do
 *     serviço é contado numa lista SEM o cartão movido, então descer anda uma casa a
 *     mais do que parece (o defeito clássico do `splice`);
 *   • E55 — o deslocamento da caixa no palco, preso à PÁGINA. A régua é a mesma do
 *     arrastar; se ela divergir, a caixa sai da folha e o erro só aparece ao salvar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  keyboardMoveAnnouncement,
  keyboardMoveEdgeAnnouncement,
  keyboardMoveTarget,
  ordinalFeminine,
} from '../../src/domain/events/demand-rules';
import {
  ELEMENT_NUDGE_FAST_MM,
  ELEMENT_NUDGE_MM,
  clampElementPosition,
  nudgeElementPosition,
} from '../../src/domain/certificates/certificate-layout-rules';

// ═══════════════════════════════════════════════════════════════════════════════
describe('E51 — destino do movimento por teclado na coluna', () => {
  it('subir uma casa devolve o índice anterior', () => {
    expect(keyboardMoveTarget({ index: 2, count: 5, direction: 'up' })).toEqual({
      toIndex: 1,
      moved: true,
    });
  });

  it('descer uma casa devolve o índice DEPOIS da próxima (a vizinha anda para cima)', () => {
    /**
     * Se este número fosse `index` em vez de `index + 1`, o cartão pularia duas casas —
     * é o erro que a tela não mostra: o servidor grava, e o cartão aparece longe de onde
     * a pessoa mandou.
     */
    expect(keyboardMoveTarget({ index: 1, count: 5, direction: 'down' })).toEqual({
      toIndex: 2,
      moved: true,
    });
  });

  it('o primeiro cartão não sobe, e o último não desce', () => {
    expect(keyboardMoveTarget({ index: 0, count: 3, direction: 'up' })).toEqual({
      toIndex: 0,
      moved: false,
    });
    expect(keyboardMoveTarget({ index: 2, count: 3, direction: 'down' })).toEqual({
      toIndex: 2,
      moved: false,
    });
  });

  it('coluna de UM cartão não move em nenhuma direção', () => {
    for (const direction of ['up', 'down'] as const) {
      expect(keyboardMoveTarget({ index: 0, count: 1, direction })).toEqual({
        toIndex: 0,
        moved: false,
      });
    }
  });

  it('índice fora da lista é grampeado, e não estoura', () => {
    expect(keyboardMoveTarget({ index: 99, count: 3, direction: 'down' }).moved).toBe(false);
    expect(keyboardMoveTarget({ index: -4, count: 3, direction: 'up' }).moved).toBe(false);
    /** Índice ilegível cai no FIM da lista (`clampIndex`): nenhum movimento inventado. */
    expect(keyboardMoveTarget({ index: Number.NaN, count: 3, direction: 'down' })).toEqual({
      toIndex: 2,
      moved: false,
    });
  });

  it('a posição anunciada é a de DESTINO + 1 (a lista que a pessoa vê)', () => {
    const subiu = keyboardMoveTarget({ index: 2, count: 5, direction: 'up' });
    const desceu = keyboardMoveTarget({ index: 2, count: 5, direction: 'down' });

    expect(subiu.toIndex + 1).toBe(2);
    expect(desceu.toIndex + 1).toBe(4);
  });
});

describe('E51 — o que a região viva anuncia', () => {
  it('diz o nome e a posição nova entre o total da coluna', () => {
    expect(
      keyboardMoveAnnouncement({ title: 'Montar os crachás', position: 2, count: 5 }),
    ).toBe('A demanda "Montar os crachás" agora é a 2ª de 5 na coluna.');
  });

  it('nas pontas avisa que já está lá, em vez de dizer que moveu', () => {
    expect(keyboardMoveEdgeAnnouncement({ title: 'Imprimir etiquetas', direction: 'up' })).toBe(
      'A demanda "Imprimir etiquetas" já é a primeira da coluna.',
    );
    expect(keyboardMoveEdgeAnnouncement({ title: 'Imprimir etiquetas', direction: 'down' })).toBe(
      'A demanda "Imprimir etiquetas" já é a última da coluna.',
    );
  });

  it('o ordinal é feminino porque quem se move é a demanda', () => {
    expect(ordinalFeminine(1)).toBe('1ª');
    expect(ordinalFeminine(12)).toBe('12ª');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('E55 — a caixa do palco presa à página', () => {
  const box = { xMm: 30, yMm: 40, widthMm: 60, heightMm: 20 };

  it('o passo é 1 mm, e 10 mm com Shift', () => {
    expect(ELEMENT_NUDGE_MM).toBe(1);
    expect(ELEMENT_NUDGE_FAST_MM).toBe(10);

    expect(nudgeElementPosition({ element: box, page: 'A4_LANDSCAPE', dxMm: ELEMENT_NUDGE_MM, dyMm: 0 })).toEqual({
      xMm: 31,
      yMm: 40,
    });
    expect(
      nudgeElementPosition({ element: box, page: 'A4_LANDSCAPE', dxMm: 0, dyMm: -ELEMENT_NUDGE_FAST_MM }),
    ).toEqual({ xMm: 30, yMm: 30 });
  });

  it('não passa da borda direita nem da inferior (a largura da caixa conta)', () => {
    /** Paisagem: 297 × 210 mm. A caixa de 60 × 20 mm para em 237 × 190. */
    const canto = nudgeElementPosition({
      element: { ...box, xMm: 290, yMm: 205 },
      page: 'A4_LANDSCAPE',
      dxMm: 20,
      dyMm: 20,
    });

    expect(canto).toEqual({ xMm: 237, yMm: 190 });
  });

  it('não passa da origem', () => {
    expect(
      nudgeElementPosition({ element: { ...box, xMm: 1, yMm: 1 }, page: 'A4_LANDSCAPE', dxMm: -10, dyMm: -10 }),
    ).toEqual({ xMm: 0, yMm: 0 });
  });

  it('a régua é a MESMA do arrastar: `clampElementPosition` é a fonte', () => {
    const foraDaPagina = { ...box, xMm: -50, yMm: 999 };

    expect(nudgeElementPosition({ element: foraDaPagina, page: 'A4_PORTRAIT', dxMm: 0, dyMm: 0 })).toEqual(
      clampElementPosition(foraDaPagina, 'A4_PORTRAIT'),
    );

    /** Retrato: 210 × 297 mm — a caixa de 60 mm para em 150 mm de X. */
    expect(clampElementPosition({ ...box, xMm: 999 }, 'A4_PORTRAIT').xMm).toBe(150);
  });

  it('caixa maior que a página fica em zero, e não em negativo', () => {
    expect(
      clampElementPosition({ xMm: 10, yMm: 10, widthMm: 400, heightMm: 400 }, 'A4_LANDSCAPE'),
    ).toEqual({ xMm: 0, yMm: 0 });
  });
});

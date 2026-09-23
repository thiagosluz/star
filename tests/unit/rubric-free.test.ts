import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUBRIC,
  MAX_RUBRIC_CRITERIA,
  buildRubricFromRows,
  computeWeightedScore,
  criterionKeyFromLabel,
  rubricShapeChanged,
  rubricShapeDiff,
  rubricShapeDiffLabel,
  validateRubric,
  type RubricCriterion,
} from '../../src/domain/review/review-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Rubrica com número livre de critérios (FASE 39) — regra pura
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a chave do critério nasce do RÓTULO: acento, espaço, símbolo, número no começo e
 *    rótulo vazio têm resposta determinística, e rótulo repetido ganha sufixo em vez
 *    de recusar o formulário;
 *  • o teto de critérios é do DOMÍNIO, não da tela;
 *  • a FORMA da rubrica (o que entra na conta da nota) distingue acrescentar, remover
 *    e trocar peso ou nota máxima — e NÃO se incomoda com rótulo, descrição ou ordem,
 *    que não mudam nota nenhuma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function criterion(overrides: Partial<RubricCriterion> = {}): RubricCriterion {
  return { key: 'originalidade', label: 'Originalidade', weight: 3, maxScore: 10, ...overrides };
}

describe('chave do critério derivada do rótulo', () => {
  it('tira acento, troca espaço por underscore e baixa a caixa', () => {
    expect(criterionKeyFromLabel('Originalidade e relevância')).toBe('originalidade_e_relevancia');
    expect(criterionKeyFromLabel('Metodologia')).toBe('metodologia');
    expect(criterionKeyFromLabel('Clareza  e   organização')).toBe('clareza_e_organizacao');
    expect(criterionKeyFromLabel('  Viabilidade da oficina  ')).toBe('viabilidade_da_oficina');
  });

  it('descarta símbolos e pontuação', () => {
    expect(criterionKeyFromLabel('Impacto social (a médio prazo)')).toBe('impacto_social_a_medio_prazo');
    expect(criterionKeyFromLabel('Originalidade — 30%')).toBe('originalidade_30');
  });

  it('rótulo que começa com número continua válido (o regex exige letra)', () => {
    expect(criterionKeyFromLabel('3 pilares do método')).toBe('c3_pilares_do_metodo');
  });

  it('rótulo vazio ou só de símbolos cai num nome utilizável', () => {
    expect(criterionKeyFromLabel('')).toBe('criterio');
    expect(criterionKeyFromLabel('   ')).toBe('criterio');
    expect(criterionKeyFromLabel('***')).toBe('criterio');
  });

  it('respeita o teto de 40 caracteres', () => {
    const long = criterionKeyFromLabel('a'.repeat(80));
    expect(long).toHaveLength(40);
    expect(long).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });

  it('rótulo repetido ganha sufixo em vez de virar erro', () => {
    expect(criterionKeyFromLabel('Clareza', ['clareza'])).toBe('clareza_2');
    expect(criterionKeyFromLabel('Clareza', ['clareza', 'clareza_2'])).toBe('clareza_3');
    expect(criterionKeyFromLabel('Clareza', [])).toBe('clareza');
  });

  it('o sufixo de colisão também cabe no teto de 40', () => {
    const key = criterionKeyFromLabel('a'.repeat(60), ['a'.repeat(40)]);
    expect(key).toHaveLength(40);
    expect(key.endsWith('_2')).toBe(true);
  });

  it('toda chave produzida passa na validação da rubrica', () => {
    const labels = ['Originalidade', '3 pilares', '', '***', 'Método & rigor', 'Clareza'];

    const rubric = labels.map((label, index) => {
      const taken = labels.slice(0, index).map((previous) => criterionKeyFromLabel(previous));
      return criterion({ key: criterionKeyFromLabel(label, taken), label, weight: 1, maxScore: 10 });
    });

    expect(validateRubric(rubric)).toEqual({ valid: true });
  });
});

describe('teto de critérios', () => {
  it('aceita de 1 até o teto', () => {
    expect(MAX_RUBRIC_CRITERIA).toBe(12);

    for (const count of [1, 2, 3, 5, MAX_RUBRIC_CRITERIA]) {
      const rubric = Array.from({ length: count }, (_, index) =>
        criterion({ key: `criterio_${index}`, label: `Critério ${index}` }),
      );

      expect(validateRubric(rubric), `${count} critérios`).toEqual({ valid: true });
    }
  });

  it('recusa acima do teto, dizendo quantos vieram', () => {
    const rubric = Array.from({ length: MAX_RUBRIC_CRITERIA + 1 }, (_, index) =>
      criterion({ key: `criterio_${index}`, label: `Critério ${index}` }),
    );

    const validation = validateRubric(rubric);

    expect(validation.valid).toBe(false);
    if (validation.valid) return;

    expect(validation.errors[0]).toMatchObject({ code: 'TOO_MANY', count: MAX_RUBRIC_CRITERIA + 1 });
    expect(validation.errors[0]!.message).toContain('12');
  });

  it('rubrica vazia continua sendo recusada (vazio não é "sem rubrica")', () => {
    const validation = validateRubric([]);

    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.errors[0]!.code).toBe('EMPTY');
  });
});

describe('a FORMA da rubrica — o que entra na conta da nota', () => {
  it('detecta critério acrescentado e removido', () => {
    const before = [criterion(), criterion({ key: 'metodologia', label: 'Metodologia' })];
    const added = [...before, criterion({ key: 'clareza', label: 'Clareza' })];

    expect(rubricShapeDiff(before, added)).toEqual({ added: ['clareza'], removed: [], changed: [] });
    expect(rubricShapeDiff(added, before)).toEqual({ added: [], removed: ['clareza'], changed: [] });
    expect(rubricShapeChanged(before, added)).toBe(true);
  });

  it('detecta peso e nota máxima diferentes', () => {
    const before = [criterion()];

    expect(rubricShapeDiff(before, [criterion({ weight: 1 })])).toEqual({
      added: [],
      removed: [],
      changed: ['originalidade'],
    });
    expect(rubricShapeDiff(before, [criterion({ maxScore: 5 })])).toEqual({
      added: [],
      removed: [],
      changed: ['originalidade'],
    });
  });

  it('NÃO se incomoda com rótulo, descrição ou ordem — nada disso muda a nota', () => {
    const before = [
      criterion({ key: 'a', label: 'Clareza' }),
      criterion({ key: 'b', label: 'Método' }),
    ];

    expect(
      rubricShapeChanged(before, [
        criterion({ key: 'a', label: 'Clareza e organização', description: 'Texto novo' }),
        criterion({ key: 'b', label: 'Metodologia empregada' }),
      ]),
    ).toBe(false);

    /** Ordem trocada: a soma ponderada é a mesma, então a forma não mudou. */
    expect(rubricShapeChanged(before, [before[1]!, before[0]!])).toBe(false);
  });

  it('a mesma rubrica não mudou — e a padrão comparada consigo mesma também não', () => {
    expect(rubricShapeChanged(DEFAULT_RUBRIC, DEFAULT_RUBRIC)).toBe(false);
    expect(rubricShapeChanged(DEFAULT_RUBRIC, [...DEFAULT_RUBRIC])).toBe(false);
  });

  it('a descrição da mudança nomeia o que foi recusado', () => {
    const before = [criterion({ key: 'clareza', label: 'Clareza', weight: 2 })];
    const after = [
      criterion({ key: 'clareza', label: 'Clareza', weight: 3 }),
      criterion({ key: 'impacto', label: 'Impacto' }),
    ];

    const label = rubricShapeDiffLabel(rubricShapeDiff(before, after));

    expect(label).toContain('critério(s) novo(s): impacto');
    expect(label).toContain('peso ou nota máxima alterados em: clareza');
  });
});

describe('as linhas do formulário viram rubrica', () => {
  it('linha nova deriva a chave do rótulo e completa peso e nota com o padrão', () => {
    const rubric = buildRubricFromRows({
      labels: ['Originalidade', 'Impacto social', ''],
      weights: ['3', ''],
      maxScores: ['10', '5'],
    });

    expect(rubric).toEqual([
      { key: 'originalidade', label: 'Originalidade', weight: 3, maxScore: 10 },
      { key: 'impacto_social', label: 'Impacto social', weight: 1, maxScore: 5 },
    ]);
  });

  it('linha que JÁ EXISTE preserva a chave, mesmo quando o rótulo muda', () => {
    /**
     * É o que mantém o rótulo editável depois de avaliado: se a chave fosse recalculada
     * do rótulo novo, corrigir "Clareza" para "Clareza e organização" mudaria a FORMA
     * e a edição seria recusada — o oposto do que a fase decidiu.
     */
    const rubric = buildRubricFromRows({
      keys: ['clareza', ''],
      labels: ['Clareza e organização', 'Impacto'],
      weights: ['2', '1'],
      maxScores: ['10', '10'],
    });

    expect(rubric.map((item) => item.key)).toEqual(['clareza', 'impacto']);
    expect(rubric[0]!.label).toBe('Clareza e organização');
  });

  it('rótulos repetidos na mesma rubrica não geram chave repetida', () => {
    const rubric = buildRubricFromRows({
      labels: ['Clareza', 'Clareza', 'Clareza'],
      weights: ['1', '1', '1'],
      maxScores: ['10', '10', '10'],
    });

    expect(rubric.map((item) => item.key)).toEqual(['clareza', 'clareza_2', 'clareza_3']);
    expect(validateRubric(rubric)).toEqual({ valid: true });
  });

  it('linha sem rótulo é descartada, mesmo com peso e nota preenchidos', () => {
    const rubric = buildRubricFromRows({
      labels: ['', '   '],
      weights: ['5', '5'],
      maxScores: ['5', '5'],
    });

    expect(rubric).toEqual([]);
  });

  it('peso presente e inválido NÃO vira padrão: chega na validação e é recusado', () => {
    const rubric = buildRubricFromRows({
      labels: ['Originalidade', 'Metodologia'],
      weights: ['0', 'abc'],
      maxScores: ['10', '10'],
    });

    expect(rubric.map((item) => item.weight)).toEqual([0, Number.NaN]);

    const validation = validateRubric(rubric);
    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.errors[0]!.code).toBe('INVALID_WEIGHT');
  });

  it('formulário só com linhas em branco produz rubrica vazia (usa a padrão)', () => {
    const rubric = buildRubricFromRows({
      labels: ['', '', ''],
      weights: ['3', '1', '1'],
      maxScores: ['10', '10', '10'],
    });

    expect(rubric).toHaveLength(0);
  });
});

describe('a nota ponderada acompanha a rubrica — e é por isso que ela congela', () => {
  const five: RubricCriterion[] = [
    { key: 'a', label: 'A', weight: 3, maxScore: 10 },
    { key: 'b', label: 'B', weight: 2, maxScore: 10 },
    { key: 'c', label: 'C', weight: 1, maxScore: 10 },
    { key: 'd', label: 'D', weight: 2, maxScore: 20 },
    { key: 'e', label: 'E', weight: 2, maxScore: 5 },
  ];

  it('soma as contribuições de TODOS os critérios (cinco, não três)', () => {
    const breakdown = computeWeightedScore(five, { a: 10, b: 5, c: 5, d: 10, e: 5 });

    expect(breakdown).not.toBeNull();
    expect(breakdown!.contributions).toHaveLength(5);
    expect(breakdown!.totalWeight).toBe(10);

    /**
     * (10/10×3 + 5/10×2 + 5/10×1 + 10/20×2 + 5/5×2) / 10 × 100
     *   = (3 + 1 + 0,5 + 1 + 2) / 10 × 100 = 75
     */
    expect(breakdown!.score).toBe(75);
  });

  it('UM critério sem nota derruba a nota inteira — é a razão do congelamento', () => {
    /**
     * É este comportamento que torna perigoso acrescentar critério depois de avaliado:
     * o parecer já enviado passa a ter um critério sem nota, e a nota dele deixa de ser
     * calculável. O teste existe para que a decisão da FASE 39 não vire folclore.
     */
    expect(computeWeightedScore(five, { a: 10, b: 5, c: 5, d: 10 })).toBeNull();

    /** E o mesmo vale para a nota do critério que passou a existir. */
    const six = [...five, { key: 'f', label: 'F', weight: 1, maxScore: 10 }];
    expect(computeWeightedScore(six, { a: 10, b: 5, c: 5, d: 10, e: 5 })).toBeNull();
  });

  it('remover um critério renormaliza o peso e MUDA a nota dos pareceres iguais', () => {
    const scores = { a: 10, b: 5, c: 5, d: 10, e: 5 };
    const full = computeWeightedScore(five, scores)!.score;
    const reduced = computeWeightedScore(
      five.filter((criterion) => criterion.key !== 'e'),
      scores,
    )!.score;

    expect(full).toBe(75);
    expect(reduced).not.toBe(full);
  });
});

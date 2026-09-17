/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — regras de avaliação por pares
 *
 *  Foco: rubrica, nota ponderada, sugestão de recomendação, consenso entre
 *  pareceres e — o mais importante — o sigilo da revisão cega.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUBRIC,
  DEFAULT_THRESHOLDS,
  DIVERGENCE_STD_DEV_THRESHOLD,
  canAccessSubmissionFile,
  computeWeightedScore,
  parseRubric,
  redactForBlindReview,
  suggestRecommendation,
  summarizeReviews,
  validateRubric,
  validateScores,
  visibleKindsForReviewer,
  type RubricCriterion,
} from '../../src/domain/review/review-rules';

const rubric: readonly RubricCriterion[] = [
  { key: 'originality', label: 'Originalidade', weight: 3, maxScore: 10 },
  { key: 'methodology', label: 'Metodologia', weight: 2, maxScore: 10 },
  { key: 'clarity', label: 'Clareza', weight: 1, maxScore: 5 },
];

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateRubric()', () => {
  it('aceita uma rubrica bem formada', () => {
    expect(validateRubric(rubric)).toEqual({ valid: true });
  });

  it('rejeita rubrica vazia', () => {
    const result = validateRubric([]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]?.code).toBe('EMPTY');
  });

  it('rejeita chaves duplicadas', () => {
    const result = validateRubric([
      { key: 'a', label: 'A', weight: 1, maxScore: 10 },
      { key: 'a', label: 'Outra', weight: 1, maxScore: 10 },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'DUPLICATE_KEY')).toBe(true);
  });

  it('rejeita peso ZERO ou NEGATIVO', () => {
    // Peso negativo inverteria a contribuição: nota alta pioraria a média.
    for (const weight of [0, -1]) {
      const result = validateRubric([{ key: 'a', label: 'A', weight, maxScore: 10 }]);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.some((e) => e.code === 'INVALID_WEIGHT')).toBe(true);
    }
  });

  it('rejeita nota máxima ZERO ou negativa', () => {
    const result = validateRubric([{ key: 'a', label: 'A', weight: 1, maxScore: 0 }]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'INVALID_MAX_SCORE')).toBe(true);
  });

  it('rejeita chave com formato inválido', () => {
    for (const key of ['Com Espaço', 'MAIUSCULA', 'com-hifen', '1comeca_com_numero']) {
      const result = validateRubric([{ key, label: 'A', weight: 1, maxScore: 10 }]);
      expect(result.valid, `deveria rejeitar a chave "${key}"`).toBe(false);
    }
  });

  it('rejeita peso não finito', () => {
    const result = validateRubric([
      { key: 'a', label: 'A', weight: Number.NaN, maxScore: 10 },
    ]);
    expect(result.valid).toBe(false);
  });

  it('acumula múltiplos erros de uma vez', () => {
    const result = validateRubric([
      { key: 'BAD KEY', label: 'A', weight: 0, maxScore: 0 },
      { key: 'ok', label: 'B', weight: 1, maxScore: 10 },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('parseRubric() — JSON do banco', () => {
  it('aceita um JSON válido', () => {
    const result = parseRubric(JSON.parse(JSON.stringify(rubric)));
    expect(result.usedDefault).toBe(false);
    expect(result.rubric).toHaveLength(3);
  });

  it('cai no padrão para valor vazio ou não-array', () => {
    for (const raw of [null, undefined, [], {}, 'texto', 42]) {
      const result = parseRubric(raw);
      expect(result.usedDefault).toBe(true);
      expect(result.rubric).toEqual(DEFAULT_RUBRIC);
    }
  });

  it('cai no padrão quando um item tem campo ausente', () => {
    const result = parseRubric([{ key: 'a', label: 'A' }]);
    expect(result.usedDefault).toBe(true);
    expect(result.rubric).toEqual(DEFAULT_RUBRIC);
  });

  it('cai no padrão quando o item tem tipo errado', () => {
    const result = parseRubric([
      { key: 'a', label: 'A', weight: 'muito', maxScore: 10 },
    ]);
    expect(result.usedDefault).toBe(true);
  });

  it('cai no padrão quando a rubrica é semanticamente inválida', () => {
    const result = parseRubric([{ key: 'a', label: 'A', weight: 0, maxScore: 10 }]);
    expect(result.usedDefault).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('preserva a descrição quando presente', () => {
    const result = parseRubric([
      { key: 'a', label: 'A', weight: 1, maxScore: 10, description: 'Detalhe' },
    ]);
    expect(result.rubric[0]?.description).toBe('Detalhe');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateScores()', () => {
  const good = { originality: 8, methodology: 7, clarity: 4 };

  it('aceita notas completas e no intervalo', () => {
    expect(validateScores(rubric, good)).toEqual({ valid: true });
  });

  it('rejeita critério sem nota', () => {
    // Nota faltando inflaria a média: o peso ausente sumiria do denominador.
    const result = validateScores(rubric, { originality: 8, methodology: 7 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.code === 'MISSING_CRITERION')).toBe(true);
    }
  });

  it('rejeita nota acima do máximo do critério', () => {
    const result = validateScores(rubric, { ...good, clarity: 6 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'OUT_OF_RANGE')).toBe(true);
  });

  it('rejeita nota negativa', () => {
    const result = validateScores(rubric, { ...good, clarity: -1 });
    expect(result.valid).toBe(false);
  });

  it('rejeita valor não numérico', () => {
    const result = validateScores(rubric, { ...good, clarity: 'quatro' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'NOT_A_NUMBER')).toBe(true);
  });

  it('rejeita critério não previsto na rubrica', () => {
    const result = validateScores(rubric, { ...good, inventado: 10 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'UNKNOWN_CRITERION')).toBe(true);
  });

  it('aceita string numérica (formulário HTML envia texto)', () => {
    expect(
      validateScores(rubric, { originality: '8', methodology: '7', clarity: '4' }),
    ).toEqual({ valid: true });
  });

  it('aceita nota zero (é uma avaliação legítima)', () => {
    expect(
      validateScores(rubric, { originality: 0, methodology: 0, clarity: 0 }),
    ).toEqual({ valid: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('computeWeightedScore()', () => {
  it('normaliza para 0–100 com nota máxima', () => {
    const result = computeWeightedScore(rubric, {
      originality: 10,
      methodology: 10,
      clarity: 5,
    });
    expect(result?.score).toBe(100);
  });

  it('normaliza para 0 com nota zero', () => {
    const result = computeWeightedScore(rubric, {
      originality: 0,
      methodology: 0,
      clarity: 0,
    });
    expect(result?.score).toBe(0);
  });

  it('respeita os pesos', () => {
    /**
     * Pesos: originalidade 3, metodologia 2, clareza 1 (total 6).
     * Nota 10 em originalidade e 0 no resto:
     *   (10/10 × 3 + 0 + 0) / 6 × 100 = 50
     */
    const result = computeWeightedScore(rubric, {
      originality: 10,
      methodology: 0,
      clarity: 0,
    });
    expect(result?.score).toBe(50);
  });

  it('a escala é comparável entre rubricas diferentes', () => {
    // Uma rubrica de 1 critério e outra de 3, ambas com nota máxima, dão 100.
    const single = computeWeightedScore(
      [{ key: 'a', label: 'A', weight: 1, maxScore: 10 }],
      { a: 10 },
    );
    expect(single?.score).toBe(100);
    expect(computeWeightedScore(rubric, { originality: 10, methodology: 10, clarity: 5 })?.score).toBe(100);
  });

  it('é reprodutível (mesma entrada, mesma saída)', () => {
    const scores = { originality: 7, methodology: 6, clarity: 3 };
    const first = computeWeightedScore(rubric, scores);
    const second = computeWeightedScore(rubric, scores);
    expect(first?.score).toBe(second?.score);
  });

  it('produz detalhamento auditável', () => {
    const result = computeWeightedScore(rubric, {
      originality: 8,
      methodology: 6,
      clarity: 3,
    });

    expect(result?.contributions).toHaveLength(3);

    // A soma dos pontos das contribuições reconstrói a nota.
    const sum = result!.contributions.reduce((total, item) => total + item.points, 0);
    expect(Math.round(sum * 100) / 100).toBeCloseTo(result!.score, 1);

    const originality = result?.contributions.find((c) => c.key === 'originality');
    expect(originality?.ratio).toBeCloseTo(0.8, 5);
    expect(originality?.weight).toBe(3);
  });

  it('devolve null para rubrica vazia', () => {
    expect(computeWeightedScore([], {})).toBeNull();
  });

  it('devolve null quando falta uma nota', () => {
    expect(computeWeightedScore(rubric, { originality: 8 })).toBeNull();
  });

  it('trunca nota acima do máximo em vez de passar de 100', () => {
    // Defesa em profundidade: o dado é validado antes, mas o cálculo não pode
    // produzir um número fora da escala se algo escapar.
    const result = computeWeightedScore(rubric, {
      originality: 999,
      methodology: 999,
      clarity: 999,
    });
    expect(result?.score).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('suggestRecommendation()', () => {
  it('sugere ACCEPT acima do limite', () => {
    expect(suggestRecommendation(85)).toBe('ACCEPT');
    expect(suggestRecommendation(DEFAULT_THRESHOLDS.acceptThreshold)).toBe('ACCEPT');
  });

  it('sugere REJECT abaixo do limite', () => {
    expect(suggestRecommendation(20)).toBe('REJECT');
    expect(suggestRecommendation(DEFAULT_THRESHOLDS.rejectThreshold - 1)).toBe('REJECT');
  });

  it('sugere MINOR_REVISION na metade superior da faixa intermediária', () => {
    // Faixa: 45 a 70; ponto médio 57.5
    expect(suggestRecommendation(65)).toBe('MINOR_REVISION');
    expect(suggestRecommendation(58)).toBe('MINOR_REVISION');
  });

  it('sugere MAJOR_REVISION na metade inferior da faixa intermediária', () => {
    expect(suggestRecommendation(50)).toBe('MAJOR_REVISION');
    expect(suggestRecommendation(46)).toBe('MAJOR_REVISION');
  });

  it('respeita limites customizados da trilha', () => {
    const thresholds = { acceptThreshold: 90, rejectThreshold: 80 };
    expect(suggestRecommendation(85, thresholds)).not.toBe('ACCEPT');
    expect(suggestRecommendation(95, thresholds)).toBe('ACCEPT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('summarizeReviews() — consenso', () => {
  it('conta a distribuição de recomendações', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 80 },
      { id: '2', recommendation: 'ACCEPT', weightedScore: 75 },
      { id: '3', recommendation: 'REJECT', weightedScore: 30 },
    ]);

    expect(consensus.distribution.ACCEPT).toBe(2);
    expect(consensus.distribution.REJECT).toBe(1);
    expect(consensus.reviewCount).toBe(3);
  });

  it('identifica a recomendação majoritária', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 80 },
      { id: '2', recommendation: 'ACCEPT', weightedScore: 78 },
      { id: '3', recommendation: 'REJECT', weightedScore: 30 },
    ]);
    expect(consensus.majorityRecommendation).toBe('ACCEPT');
  });

  it('devolve majoritária NULA em caso de empate', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 80 },
      { id: '2', recommendation: 'REJECT', weightedScore: 30 },
    ]);
    expect(consensus.majorityRecommendation).toBeNull();
    expect(consensus.requiresDiscussion).toBe(true);
  });

  it('sinaliza aceite e rejeição no mesmo conjunto', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 80 },
      { id: '2', recommendation: 'ACCEPT', weightedScore: 78 },
      { id: '3', recommendation: 'ACCEPT', weightedScore: 76 },
      { id: '4', recommendation: 'REJECT', weightedScore: 20 },
    ]);

    // Maioria clara, mas a divergência qualitativa ainda merece atenção.
    expect(consensus.majorityRecommendation).toBe('ACCEPT');
    expect(consensus.requiresDiscussion).toBe(true);
    expect(consensus.discussionReasons.join(' ')).toMatch(/aceite e um de rejeição/i);
  });

  it('calcula média das notas', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 80 },
      { id: '2', recommendation: 'ACCEPT', weightedScore: 70 },
    ]);
    expect(consensus.averageScore).toBe(75);
  });

  it('calcula desvio-padrão e sinaliza divergência alta', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 95 },
      { id: '2', recommendation: 'REJECT', weightedScore: 20 },
    ]);

    expect(consensus.scoreStdDev).toBeGreaterThan(DIVERGENCE_STD_DEV_THRESHOLD);
    expect(consensus.requiresDiscussion).toBe(true);
    expect(consensus.discussionReasons.join(' ')).toMatch(/divergem/i);
  });

  it('NÃO sinaliza divergência com notas próximas e mesma recomendação', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 80 },
      { id: '2', recommendation: 'ACCEPT', weightedScore: 82 },
      { id: '3', recommendation: 'ACCEPT', weightedScore: 79 },
    ]);

    expect(consensus.requiresDiscussion).toBe(false);
    expect(consensus.discussionReasons).toHaveLength(0);
  });

  it('lida com lista vazia', () => {
    const consensus = summarizeReviews([]);
    expect(consensus.reviewCount).toBe(0);
    expect(consensus.averageScore).toBeNull();
    expect(consensus.scoreStdDev).toBeNull();
    expect(consensus.majorityRecommendation).toBeNull();
  });

  it('ignora pareceres sem nota no cálculo da média', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 80 },
      { id: '2', recommendation: null, weightedScore: null },
    ]);
    expect(consensus.averageScore).toBe(80);
    expect(consensus.reviewCount).toBe(2);
  });

  it('não calcula desvio-padrão com um único parecer', () => {
    const consensus = summarizeReviews([
      { id: '1', recommendation: 'ACCEPT', weightedScore: 80 },
    ]);
    expect(consensus.scoreStdDev).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('revisão cega — controle de acesso a artefatos', () => {
  it('revisor em revisão cega acessa APENAS o PDF cego', () => {
    expect(
      canAccessSubmissionFile({ kind: 'BLIND_PDF', viewerRole: 'REVIEWER', isBlind: true }),
    ).toBe(true);

    for (const kind of ['IDENTIFIED_PDF', 'PRESENTATION', 'CAMERA_READY', 'SUPPLEMENTARY'] as const) {
      expect(
        canAccessSubmissionFile({ kind, viewerRole: 'REVIEWER', isBlind: true }),
        `revisor cego NÃO deveria acessar ${kind}`,
      ).toBe(false);
    }
  });

  it('revisor sem revisão cega acessa tudo', () => {
    for (const kind of ['BLIND_PDF', 'IDENTIFIED_PDF', 'PRESENTATION'] as const) {
      expect(
        canAccessSubmissionFile({ kind, viewerRole: 'REVIEWER', isBlind: false }),
      ).toBe(true);
    }
  });

  it('autor, comitê e organização acessam tudo mesmo em revisão cega', () => {
    for (const viewerRole of ['AUTHOR', 'CHAIR', 'ORGANIZER', 'STAFF'] as const) {
      for (const kind of ['BLIND_PDF', 'IDENTIFIED_PDF'] as const) {
        expect(
          canAccessSubmissionFile({ kind, viewerRole, isBlind: true }),
          `${viewerRole} deveria acessar ${kind}`,
        ).toBe(true);
      }
    }
  });

  it('a lista de tipos visíveis bate com a checagem individual', () => {
    const visible = visibleKindsForReviewer(true);
    expect(visible).toEqual(['BLIND_PDF']);

    for (const kind of ['BLIND_PDF', 'IDENTIFIED_PDF', 'PRESENTATION'] as const) {
      expect(visible.includes(kind)).toBe(
        canAccessSubmissionFile({ kind, viewerRole: 'REVIEWER', isBlind: true }),
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('redactForBlindReview()', () => {
  const submission = {
    id: 'sub-1',
    title: 'Um estudo',
    authors: [{ name: 'Ana' }, { name: 'Bruno' }],
    submittedById: 'user-1',
  };

  it('remove autoria E o campo submittedById quando cego', () => {
    // A remoção precisa ser ESTRUTURAL: deixar o campo presente e apenas não
    // exibir na UI é o erro que vaza por serialização.
    const redacted = redactForBlindReview(submission, true);

    expect(redacted).not.toHaveProperty('authors');
    expect(redacted).not.toHaveProperty('submittedById');
    expect(redacted.id).toBe('sub-1');
    expect(redacted.title).toBe('Um estudo');
  });

  it('preserva tudo quando não é cego', () => {
    const result = redactForBlindReview(submission, false);
    expect(result).toHaveProperty('authors');
    expect(result).toHaveProperty('submittedById');
  });
});

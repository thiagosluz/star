/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Regras de avaliação por pares (peer review)
 *
 *  Domínio puro: nenhuma dependência de framework, banco ou S3.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS GARANTIAS QUE ESTE MÓDULO PRECISA SUSTENTAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. REVISÃO CEGA É CEGA. Dado o conjunto de artefatos de uma submissão e o
 *     papel de quem consulta, decidimos o que pode ser acessado. Um revisor
 *     jamais vê o PDF identificado nem os nomes dos autores enquanto a revisão
 *     cega estiver ativa.
 *
 *  2. NOTA PONDERADA É REPRODUTÍVEL. O mesmo conjunto de notas produz sempre o
 *     mesmo resultado, e o cálculo é auditável — cada critério contribui de
 *     forma rastreável para a nota final.
 *
 *  3. CONSENSO É EXPLÍCITO. Quando os pareceres divergem, o sistema NÃO escolhe
 *     silenciosamente: sinaliza a divergência para o comitê, porque uma decisão
 *     tomada sobre pareceres contraditórios merece revisão humana.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Rubrica
// ───────────────────────────────────────────────────────────────────────────────
export interface RubricCriterion {
  /** Identificador estável usado como chave em `Review.scores`. */
  key: string;
  label: string;
  /** Peso relativo. Deve ser > 0. */
  weight: number;
  /** Nota máxima do critério. Deve ser > 0. */
  maxScore: number;
  description?: string;
}

export type RubricValidationError =
  | { code: 'EMPTY'; message: string }
  | { code: 'DUPLICATE_KEY'; message: string; keys: string[] }
  | { code: 'INVALID_WEIGHT'; message: string; keys: string[] }
  | { code: 'INVALID_MAX_SCORE'; message: string; keys: string[] }
  | { code: 'INVALID_KEY'; message: string; keys: string[] };

export type RubricValidation =
  | { valid: true }
  | { valid: false; errors: RubricValidationError[] };

/** Chave de critério aceita: minúsculas, dígitos e underscore (usada em JSON). */
const CRITERION_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Valida uma rubrica.
 *
 * Uma rubrica inválida é perigosa porque o cálculo de nota a consome: peso
 * negativo poderia inverter a contribuição de um critério (nota alta piorando a
 * média). Por isso validamos ANTES de aceitar a configuração da trilha.
 */
export function validateRubric(rubric: readonly RubricCriterion[]): RubricValidation {
  const errors: RubricValidationError[] = [];

  if (rubric.length === 0) {
    errors.push({
      code: 'EMPTY',
      message: 'A rubrica precisa de pelo menos um critério.',
    });
    return { valid: false, errors };
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const badKeys: string[] = [];
  const badWeights: string[] = [];
  const badMaxScores: string[] = [];

  for (const criterion of rubric) {
    if (!CRITERION_KEY.test(criterion.key)) {
      badKeys.push(criterion.key);
    }
    if (seen.has(criterion.key)) {
      duplicates.push(criterion.key);
    }
    seen.add(criterion.key);

    if (!Number.isFinite(criterion.weight) || criterion.weight <= 0) {
      badWeights.push(criterion.key);
    }
    if (!Number.isFinite(criterion.maxScore) || criterion.maxScore <= 0) {
      badMaxScores.push(criterion.key);
    }
  }

  if (duplicates.length > 0) {
    errors.push({
      code: 'DUPLICATE_KEY',
      message: `Chaves de critério repetidas: ${duplicates.join(', ')}.`,
      keys: duplicates,
    });
  }
  if (badKeys.length > 0) {
    errors.push({
      code: 'INVALID_KEY',
      message: `Chaves inválidas: ${badKeys.join(', ')}. Use minúsculas, dígitos e underscore.`,
      keys: badKeys,
    });
  }
  if (badWeights.length > 0) {
    errors.push({
      code: 'INVALID_WEIGHT',
      message: `Peso deve ser maior que zero nos critérios: ${badWeights.join(', ')}.`,
      keys: badWeights,
    });
  }
  if (badMaxScores.length > 0) {
    errors.push({
      code: 'INVALID_MAX_SCORE',
      message: `Nota máxima deve ser maior que zero nos critérios: ${badMaxScores.join(', ')}.`,
      keys: badMaxScores,
    });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/** Rubrica padrão, usada quando a trilha não define uma própria. */
export const DEFAULT_RUBRIC: readonly RubricCriterion[] = [  {
    key: 'originality',
    label: 'Originalidade e relevância',
    weight: 3,
    maxScore: 10,
    description: 'Contribuição original e relevância para a área.',
  },
  {
    key: 'methodology',
    label: 'Metodologia',
    weight: 3,
    maxScore: 10,
    description: 'Adequação e rigor do método empregado.',
  },
  {
    key: 'clarity',
    label: 'Clareza e organização',
    weight: 2,
    maxScore: 10,
    description: 'Qualidade da escrita e estrutura do texto.',
  },
  {
    key: 'references',
    label: 'Fundamentação teórica',
    weight: 2,
    maxScore: 10,
    description: 'Diálogo com a literatura e correção das referências.',
  },
];

/**
 * Interpreta uma rubrica vinda do banco (coluna JSON).
 *
 * O banco devolve `JsonValue`, que é uma árvore arbitrária. Converter com `as`
 * seria mentir para o compilador: um JSON malformado passaria e explodiria em
 * tempo de execução, no meio do cálculo de nota de um revisor.
 *
 * Aqui a conversão é VERIFICADA item a item. Rubrica inválida cai no padrão —
 * uma trilha com configuração quebrada não deve impedir a avaliação de acontecer.
 */
export function parseRubric(raw: unknown): {
  rubric: readonly RubricCriterion[];
  usedDefault: boolean;
  errors: readonly RubricValidationError[];
} {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { rubric: DEFAULT_RUBRIC, usedDefault: true, errors: [] };
  }

  const candidate: RubricCriterion[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return {
        rubric: DEFAULT_RUBRIC,
        usedDefault: true,
        errors: [
          {
            code: 'EMPTY',
            message: 'A rubrica contém um item que não é um objeto de critério.',
          },
        ],
      };
    }

    const record = item as Record<string, unknown>;
    if (
      typeof record.key !== 'string' ||
      typeof record.label !== 'string' ||
      typeof record.weight !== 'number' ||
      typeof record.maxScore !== 'number'
    ) {
      return {
        rubric: DEFAULT_RUBRIC,
        usedDefault: true,
        errors: [
          {
            code: 'INVALID_KEY',
            message: 'Critério da rubrica com campos ausentes ou de tipo incorreto.',
            keys: [String(record.key ?? '?')],
          },
        ],
      };
    }

    candidate.push({
      key: record.key,
      label: record.label,
      weight: record.weight,
      maxScore: record.maxScore,
      ...(typeof record.description === 'string'
        ? { description: record.description }
        : {}),
    });
  }

  const validation = validateRubric(candidate);
  if (!validation.valid) {
    return { rubric: DEFAULT_RUBRIC, usedDefault: true, errors: validation.errors };
  }

  return { rubric: candidate, usedDefault: false, errors: [] };
}
// ───────────────────────────────────────────────────────────────────────────────
//  Nota ponderada
// ───────────────────────────────────────────────────────────────────────────────
export type ScoreValidationError =
  | { code: 'MISSING_CRITERION'; message: string; keys: string[] }
  | { code: 'UNKNOWN_CRITERION'; message: string; keys: string[] }
  | { code: 'OUT_OF_RANGE'; message: string; keys: string[] }
  | { code: 'NOT_A_NUMBER'; message: string; keys: string[] };

export type ScoreValidation =
  | { valid: true }
  | { valid: false; errors: ScoreValidationError[] };

/**
 * Valida as notas de um parecer contra a rubrica da trilha.
 *
 * Exigimos TODOS os critérios: um parecer com critério faltando produziria uma
 * nota ponderada enganosa (o peso ausente simplesmente desapareceria do
 * denominador, inflando a nota).
 */
export function validateScores(
  rubric: readonly RubricCriterion[],
  scores: Readonly<Record<string, unknown>>,
): ScoreValidation {
  const errors: ScoreValidationError[] = [];

  const missing: string[] = [];
  const notNumber: string[] = [];
  const outOfRange: string[] = [];

  for (const criterion of rubric) {
    const value = scores[criterion.key];

    if (value === undefined || value === null || value === '') {
      missing.push(criterion.key);
      continue;
    }

    const numeric = typeof value === 'number' ? value : Number(value);

    if (!Number.isFinite(numeric)) {
      notNumber.push(criterion.key);
      continue;
    }

    if (numeric < 0 || numeric > criterion.maxScore) {
      outOfRange.push(criterion.key);
    }
  }

  const knownKeys = new Set(rubric.map((c) => c.key));
  const unknown = Object.keys(scores).filter((key) => !knownKeys.has(key));

  if (missing.length > 0) {
    errors.push({
      code: 'MISSING_CRITERION',
      message: `Critérios sem nota: ${missing.join(', ')}.`,
      keys: missing,
    });
  }
  if (notNumber.length > 0) {
    errors.push({
      code: 'NOT_A_NUMBER',
      message: `Nota inválida nos critérios: ${notNumber.join(', ')}.`,
      keys: notNumber,
    });
  }
  if (outOfRange.length > 0) {
    errors.push({
      code: 'OUT_OF_RANGE',
      message: `Nota fora do intervalo permitido: ${outOfRange.join(', ')}.`,
      keys: outOfRange,
    });
  }
  if (unknown.length > 0) {
    errors.push({
      code: 'UNKNOWN_CRITERION',
      message: `Critérios não previstos na rubrica: ${unknown.join(', ')}.`,
      keys: unknown,
    });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export interface WeightedScoreBreakdown {
  /** Nota final normalizada em 0–100. */
  score: number;
  /** Contribuição de cada critério, para auditoria. */
  contributions: readonly {
    key: string;
    raw: number;
    maxScore: number;
    weight: number;
    /** Percentual do critério (0–1). */
    ratio: number;
    /** Pontos que o critério somou na média ponderada (0–100). */
    points: number;
  }[];
  totalWeight: number;
}

/**
 * Calcula a nota ponderada, normalizada para 0–100.
 *
 * Fórmula:
 *
 *     nota = Σ(nota_critério / máximo_critério × peso) / Σ(peso) × 100
 *
 * A normalização é o que permite comparar trilhas com rubricas diferentes (uma
 * com 4 critérios, outra com 7) sem que a escala se torne incomparável.
 *
 * Retorna `null` quando a rubrica é vazia ou as notas estão incompletas — o
 * chamador deve validar antes; aqui preferimos não inventar um número.
 */
export function computeWeightedScore(
  rubric: readonly RubricCriterion[],
  scores: Readonly<Record<string, unknown>>,
): WeightedScoreBreakdown | null {
  if (rubric.length === 0) return null;

  const totalWeight = rubric.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) return null;

  const contributions: WeightedScoreBreakdown['contributions'][number][] = [];
  let accumulated = 0;

  for (const criterion of rubric) {
    const value = scores[criterion.key];
    const numeric = typeof value === 'number' ? value : Number(value);

    if (!Number.isFinite(numeric)) return null;
    if (criterion.maxScore <= 0) return null;

    // Um critério com nota acima do máximo é truncado em vez de rejeitado aqui:
    // a rejeição é responsabilidade de `validateScores`, e truncar mantém o
    // cálculo total dentro de 0–100 mesmo se o dado chegar inconsistente.
    const clamped = Math.min(Math.max(numeric, 0), criterion.maxScore);
    const ratio = clamped / criterion.maxScore;
    const points = (ratio * criterion.weight * 100) / totalWeight;

    contributions.push({
      key: criterion.key,
      raw: numeric,
      maxScore: criterion.maxScore,
      weight: criterion.weight,
      ratio,
      points,
    });

    accumulated += points;
  }

  return {
    score: Math.round(accumulated * 100) / 100,
    contributions,
    totalWeight,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Recomendação
// ───────────────────────────────────────────────────────────────────────────────
export type ReviewRecommendation =
  | 'ACCEPT'
  | 'MINOR_REVISION'
  | 'MAJOR_REVISION'
  | 'REJECT';

export interface DecisionThresholds {
  /** Nota a partir da qual a recomendação é ACCEPT. */
  acceptThreshold: number;
  /** Nota abaixo da qual a recomendação é REJECT. */
  rejectThreshold: number;
}

export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  acceptThreshold: 70,
  rejectThreshold: 45,
};

/**
 * Sugere uma recomendação a partir da nota.
 *
 * É uma SUGESTÃO: a decisão final é humana e o sistema registra quem decidiu.
 * Automatizar a decisão sobre um trabalho científico retiraria do comitê a
 * responsabilidade que é dele.
 */
export function suggestRecommendation(
  score: number,
  thresholds: DecisionThresholds = DEFAULT_THRESHOLDS,
): ReviewRecommendation {
  const { acceptThreshold, rejectThreshold } = thresholds;

  if (score >= acceptThreshold) return 'ACCEPT';
  if (score < rejectThreshold) return 'REJECT';
  // Faixa intermediária: quanto mais perto do aceite, menor a revisão exigida.
  const midpoint = (acceptThreshold + rejectThreshold) / 2;
  return score >= midpoint ? 'MINOR_REVISION' : 'MAJOR_REVISION';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Consenso entre pareceres
// ───────────────────────────────────────────────────────────────────────────────
export interface ReviewSummaryInput {
  id: string;
  recommendation: ReviewRecommendation | null;
  weightedScore: number | null;
  /** Notas por critério, para detectar divergência ponto a ponto. */
  scores?: Readonly<Record<string, unknown>>;
}

export interface ReviewConsensus {
  reviewCount: number;
  /** Distribuição de recomendações, para o painel do comitê. */
  distribution: Readonly<Record<ReviewRecommendation, number>>;
  /** Recomendação majoritária. `null` quando há empate. */
  majorityRecommendation: ReviewRecommendation | null;
  /** Média das notas ponderadas. `null` quando nenhum parecer tem nota. */
  averageScore: number | null;
  /** Desvio-padrão das notas. Detecta pareceres radicalmente opostos. */
  scoreStdDev: number | null;
  /**
   * `true` quando os pareceres divergem a ponto de exigir atenção humana:
   * recomendação empatada, ou desvio-padrão alto.
   */
  requiresDiscussion: boolean;
  /** Justificativa legível da divergência, para o comitê. */
  discussionReasons: readonly string[];
}

/** Desvio-padrão acima disso é sinalizado como divergência relevante. */
export const DIVERGENCE_STD_DEV_THRESHOLD = 15;

/**
 * Consolida os pareceres de uma submissão.
 *
 * Deliberadamente NÃO devolve uma "decisão automática": devolve o retrato do
 * comitê, incluindo quando ele está dividido. Um sistema que resolve divergência
 * sozinho esconde o problema em vez de expô-lo.
 */
export function summarizeReviews(
  reviews: readonly ReviewSummaryInput[],
): ReviewConsensus {
  const distribution: Record<ReviewRecommendation, number> = {
    ACCEPT: 0,
    MINOR_REVISION: 0,
    MAJOR_REVISION: 0,
    REJECT: 0,
  };

  const scored: number[] = [];

  for (const review of reviews) {
    if (review.recommendation) {
      distribution[review.recommendation] += 1;
    }
    if (typeof review.weightedScore === 'number' && Number.isFinite(review.weightedScore)) {
      scored.push(review.weightedScore);
    }
  }

  const reviewCount = reviews.length;

  // ── Recomendação majoritária ────────────────────────────────────────────────
  let majority: ReviewRecommendation | null = null;
  let maxCount = 0;
  let tie = false;

  for (const [recommendation, count] of Object.entries(distribution) as [
    ReviewRecommendation,
    number,
  ][]) {
    if (count > maxCount) {
      maxCount = count;
      majority = recommendation;
      tie = false;
    } else if (count === maxCount && count > 0) {
      tie = true;
    }
  }

  if (tie) majority = null;

  // ── Média e desvio-padrão ──────────────────────────────────────────────────
  const averageScore =
    scored.length > 0
      ? Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 100) / 100
      : null;

  let scoreStdDev: number | null = null;
  if (scored.length > 1 && averageScore !== null) {
    const variance =
      scored.reduce((sum, value) => sum + (value - averageScore) ** 2, 0) / scored.length;
    scoreStdDev = Math.round(Math.sqrt(variance) * 100) / 100;
  }

  // ── Divergências que exigem discussão ──────────────────────────────────────
  const discussionReasons: string[] = [];

  if (tie && maxCount > 0) {
    discussionReasons.push(
      'Os pareceres estão empatados entre recomendações diferentes.',
    );
  }

  const hasAccept = distribution.ACCEPT > 0;
  const hasReject = distribution.REJECT > 0;
  if (hasAccept && hasReject) {
    discussionReasons.push(
      'Há ao menos um parecer de aceite e um de rejeição.',
    );
  }

  if (scoreStdDev !== null && scoreStdDev >= DIVERGENCE_STD_DEV_THRESHOLD) {
    discussionReasons.push(
      `As notas divergem significativamente (desvio-padrão ${scoreStdDev.toFixed(1)}).`,
    );
  }

  return {
    reviewCount,
    distribution,
    majorityRecommendation: majority,
    averageScore,
    scoreStdDev,
    requiresDiscussion: discussionReasons.length > 0,
    discussionReasons,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Revisão cega — controle de acesso a artefatos
// ───────────────────────────────────────────────────────────────────────────────
export type SubmissionFileKind =
  | 'BLIND_PDF'
  | 'IDENTIFIED_PDF'
  | 'SUPPLEMENTARY'
  | 'PRESENTATION'
  | 'CAMERA_READY';

/** Quem está consultando a submissão. */
export type ViewerRole =
  | 'AUTHOR'
  | 'REVIEWER'
  | 'CHAIR'
  | 'ORGANIZER'
  | 'STAFF';

/**
 * Decide se um artefato pode ser acessado por este papel, nesta submissão.
 *
 * ─── A REGRA CENTRAL ─────────────────────────────────────────────────────────
 * Quando `isBlind` é verdadeiro e o consultante é REVISOR:
 *   • BLIND_PDF         → permitido
 *   • IDENTIFIED_PDF    → NEGADO (revelaria a autoria)
 *   • PRESENTATION,
 *     CAMERA_READY      → NEGADO (costumam conter nomes e afiliações)
 *   • SUPPLEMENTARY     → NEGADO por padrão (pode conter dados identificadores);
 *                         liberar exigiria uma decisão explícita do comitê.
 *
 * Autores, comitê e organização acessam tudo: eles já conhecem a autoria.
 */
export function canAccessSubmissionFile(input: {
  kind: SubmissionFileKind;
  viewerRole: ViewerRole;
  /** A revisão cega está ativa para esta submissão/trilha? */
  isBlind: boolean;
}): boolean {
  const { kind, viewerRole, isBlind } = input;

  // Quem não é revisor nunca é afetado pelo sigilo da revisão cega.
  if (viewerRole !== 'REVIEWER') return true;

  if (!isBlind) return true;

  return kind === 'BLIND_PDF';
}

/** Tipos de arquivo visíveis a um revisor em revisão cega. */
export function visibleKindsForReviewer(isBlind: boolean): readonly SubmissionFileKind[] {
  if (!isBlind) {
    return ['BLIND_PDF', 'IDENTIFIED_PDF', 'SUPPLEMENTARY', 'PRESENTATION', 'CAMERA_READY'];
  }
  return ['BLIND_PDF'];
}

/**
 * Remove dados de autoria de uma submissão destinada a revisor cego.
 *
 * Devolve o objeto sem os campos que identificam a autoria. Note que a remoção é
 * ESTRUTURAL (campos ausentes), não cosmética: deixar o campo presente e apenas
 * não exibi-lo na UI é o erro que produz vazamento por serialização.
 */
export function redactForBlindReview<T extends Record<string, unknown>>(
  submission: T,
  isBlind: boolean,
): Omit<T, 'authors' | 'submittedById'> & {
  authors?: undefined;
  submittedById?: undefined;
} {
  if (!isBlind) {
    return submission as Omit<T, 'authors' | 'submittedById'>;
  }

  const { authors: _authors, submittedById: _submittedById, ...rest } = submission;
  return rest as Omit<T, 'authors' | 'submittedById'>;
}

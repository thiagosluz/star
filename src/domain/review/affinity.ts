/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Afinidade para distribuição de pareceristas
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA REAL DA DISTRIBUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma chamada de trabalhos com 300 submissões e 40 revisores não é resolvida
 *  "no olho". Mas a alternativa comum — distribuir por sorteio — produz pareceres
 *  ruins: quem não domina o tema escreve superficialmente, e o comitê decide com
 *  informação fraca.
 *
 *  Este módulo calcula um score de afinidade EXPLICÁVEL: cada componente
 *  contribui com um valor rastreável, e a UI mostra POR QUE aquele revisor foi
 *  sugerido. Um score opaco ("0.73") não ajuda o comitê a decidir nem a auditar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ORDEM DAS OPERAÇÕES (importa)
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. FILTRAR conflitos  (src/domain/review/conflict-of-interest.ts)
 *      2. PONTUAR afinidade  (este arquivo)
 *      3. EQUILIBRAR carga   (penalidade por excesso de pareceres)
 *
 *  Pontuar antes de filtrar seria trabalho jogado fora — e, pior, sugerir um
 *  nome que depois é descartado mina a confiança no sistema.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Normalização de texto
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Tokeniza um texto para comparação de tema.
 *
 * ─── A ORDEM IMPORTA: STEMMING ANTES DO FILTRO ───────────────────────────────
 * Aplicamos o stemming ANTES de comparar com a lista de stop words. Se a lista
 * guardasse as formas originais, um token como "análise" seria reduzido a
 * "analis" e não casaria com "analise" — a stop word passaria batido e poluiria
 * o casamento de temas.
 *
 * Por isso a lista abaixo também está em formas já reduzidas. É a única forma de
 * garantir que os dois lados da comparação falem a mesma língua.
 */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => stem(token))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

/** Stemming leve: suficiente para plurais e flexões comuns em pt/en. */
function stem(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith('ing') && token.length > 6) return token.slice(0, -3);
  if (token.endsWith('es') && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

/**
 * Stop words.
 *
 * ─── POR QUE ALGUMAS APARECEM DUAS VEZES ─────────────────────────────────────
 * O `stem` só remove finais que casam com uma regra ('s', 'es', 'ing'), então
 * singulares e plurais produzem tokens DIFERENTES:
 *
 *     tokenize('estudo')   → ['estudo']
 *     tokenize('estudos')  → ['estud']
 *
 * Isso é aceitável para casamento de tema (as formas são consistentes em ambos
 * os lados da comparação), mas significa que a lista precisa conter as duas
 * formas dos termos genéricos — senão o singular passa pelo filtro.
 *
 * A alternativa seria um stemmer mais agressivo (remover vogal final), o que
 * passaria a confundir termos legítimos: "física" viraria "fisic" e "físico"
 * também, colidindo áreas distintas. Preferimos a lista explícita.
 */
const STOP_WORDS = new Set([
  // Português
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'sobre', 'entre', 'e', 'ou', 'que', 'como', 'um', 'uma',
  'ao', 'aos', 'se', 'sua', 'seu', 'suas', 'seus', 'este', 'esta', 'esse',
  'essa', 'isso', 'mais', 'meno', 'menos', 'muito', 'pouco', 'sao', 'ser', 'esta', 'estao',
  // Termos genéricos de artigo científico: aparecem em quase toda submissão e não
  // distinguem tema. Listados em singular E plural (forma reduzida).
  'estudo', 'estud', 'analise', 'analis', 'pesquisa', 'pesquis',
  'trabalho', 'trabalh', 'artigo', 'artig', 'proposta', 'propost',
  'abordagem', 'abordagen', 'abordage',
  // Inglês
  'the', 'an', 'of', 'in', 'on', 'for', 'with', 'without', 'about', 'between',
  'and', 'or', 'that', 'as', 'is', 'are', 'was', 'were', 'to', 'from', 'by', 'at',
  'this', 'these', 'those', 'study', 'studies', 'research', 'paper', 'approach',
]);


/** Conjunto de tokens únicos de um texto. */
export function tokenSet(texts: readonly (string | null | undefined)[]): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const token of tokenize(text)) tokens.add(token);
  }
  return tokens;
}

/**
 * Jaccard: interseção / união.
 *
 * Escolhido em vez de "contagem de termos em comum" porque não premia quem
 * simplesmente escreveu mais. Dois textos com 5 termos em comum, mas um com 500
 * termos, são menos parecidos que dois com 5 em comum e 20 no total.
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Entradas
// ───────────────────────────────────────────────────────────────────────────────
export interface SubmissionProfile {
  /** Título, resumo e palavras-chave concatenados ou separados. */
  title: string;
  abstract: string;
  keywords: readonly string[];
  /** Trilha em que foi submetido. */
  trackId?: string | null;
}

export interface ReviewerProfile {
  userId: string;
  name: string;
  /** Áreas de interesse declaradas (usadas para casar com o tema). */
  expertiseKeywords: readonly string[];
  /** Trilhas em que o revisor se declarou apto. */
  preferredTrackIds?: readonly string[];
  /** Quantidade de pareceres já atribuídos e não concluídos. */
  activeAssignmentCount: number;
  /** Limite individual de pareceres simultâneos (0 ou ausente = sem limite). */
  maxConcurrentAssignments?: number;
  /** Total de pareceres já emitidos (histórico de experiência). */
  completedReviewCount?: number;
}

export type AffinityBand = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'WEAK';

export interface AffinityResult {
  userId: string;
  name: string;
  /** Score final 0–100, já com penalidade de carga. */
  score: number;
  /** Score antes da penalidade de carga — útil para explicar a sugestão. */
  rawScore: number;
  band: AffinityBand;
  /** Detalhamento rastreável de cada componente. */
  breakdown: readonly AffinityComponent[];
  /** Apto a receber mais um parecer? */
  available: boolean;
  /** Motivo legível quando indisponível ou com score baixo. */
  notes: readonly string[];
}

export interface AffinityComponent {
  key: 'keyword_overlap' | 'track_match' | 'title_match' | 'experience' | 'workload_penalty';
  label: string;
  weight: number;
  /** Valor normalizado do componente (0–1). */
  value: number;
  /** Pontos que o componente somou (ou subtraiu) no score 0–100. */
  points: number;
}

/**
 * Pesos do score de afinidade. Somam 1.0 nos componentes positivos.
 *
 * A trilha tem peso alto porque é uma declaração EXPLÍCITA de área: quando o
 * revisor diz "avalia esta trilha", essa informação vale mais que a inferência
 * por palavras.
 */
export const AFFINITY_WEIGHTS = {
  keywordOverlap: 0.4,
  trackMatch: 0.35,
  titleMatch: 0.15,
  experience: 0.1,
} as const;

/** Pontos subtraídos por parecer ativo, e teto da penalidade. */
export const WORKLOAD_PENALTY_PER_ASSIGNMENT = 6;
export const MAX_WORKLOAD_PENALTY = 30;

/** Score mínimo para valer a pena sugerir um revisor. */
export const MIN_USEFUL_AFFINITY = 25;

/**
 * Calcula a afinidade de vários revisores para UMA submissão.
 *
 * Devolve o resultado ordenado do mais para o menos afim. Revisores indisponíveis
 * (carga cheia) permanecem na lista, marcados — o comitê pode decidir ampliar o
 * limite, e esconder o nome só dificultaria essa decisão.
 */
export function rankReviewersByAffinity(
  submission: SubmissionProfile,
  reviewers: readonly ReviewerProfile[],
): AffinityResult[] {
  const submissionTokens = tokenSet([
    submission.title,
    submission.abstract,
    ...submission.keywords,
  ]);
  const titleTokens = tokenSet([submission.title]);

  return reviewers
    .map((reviewer) => scoreReviewer(submission, submissionTokens, titleTokens, reviewer))
    .sort((a, b) => {
      // Disponíveis primeiro; depois por score; depois por nome (ordem estável).
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
}

function scoreReviewer(
  submission: SubmissionProfile,
  submissionTokens: ReadonlySet<string>,
  titleTokens: ReadonlySet<string>,
  reviewer: ReviewerProfile,
): AffinityResult {
  const notes: string[] = [];
  const breakdown: AffinityComponent[] = [];

  // ── 1. Sobreposição de tema (título + resumo + palavras-chave) ─────────────
  const reviewerTokens = tokenSet(reviewer.expertiseKeywords);
  const keywordOverlap = jaccard(submissionTokens, reviewerTokens);
  const keywordPoints = keywordOverlap * AFFINITY_WEIGHTS.keywordOverlap * 100;
  breakdown.push({
    key: 'keyword_overlap',
    label: 'Sobreposição de áreas de interesse',
    weight: AFFINITY_WEIGHTS.keywordOverlap,
    value: keywordOverlap,
    points: round2(keywordPoints),
  });

  if (keywordOverlap === 0) {
    notes.push('Nenhuma palavra-chave de interesse coincide com a submissão.');
  }

  // ── 2. Trilha declarada ────────────────────────────────────────────────────
  const preferred = reviewer.preferredTrackIds ?? [];
  const trackMatch =
    submission.trackId && preferred.includes(submission.trackId) ? 1 : 0;
  const trackPoints = trackMatch * AFFINITY_WEIGHTS.trackMatch * 100;
  breakdown.push({
    key: 'track_match',
    label: 'Apto para a trilha',
    weight: AFFINITY_WEIGHTS.trackMatch,
    value: trackMatch,
    points: round2(trackPoints),
  });

  if (trackMatch === 0 && preferred.length > 0) {
    notes.push('O revisor não se declarou apto para esta trilha.');
  }

  // ── 3. Casamento específico no título ──────────────────────────────────────
  // Peso menor que o tema geral: o título é curto e um único termo raro pode
  // gerar falso positivo — por isso vale menos que a trilha.
  const titleMatch = jaccard(titleTokens, reviewerTokens);
  const titlePoints = titleMatch * AFFINITY_WEIGHTS.titleMatch * 100;
  breakdown.push({
    key: 'title_match',
    label: 'Termos do título',
    weight: AFFINITY_WEIGHTS.titleMatch,
    value: titleMatch,
    points: round2(titlePoints),
  });

  // ── 4. Experiência ─────────────────────────────────────────────────────────
  // Satura em 10 pareceres: a partir daí o revisor é experiente, e continuar
  // premiando volume incentivaria sobrecarga nos mesmos nomes.
  const completed = reviewer.completedReviewCount ?? 0;
  const experience = Math.min(completed, 10) / 10;
  const experiencePoints = experience * AFFINITY_WEIGHTS.experience * 100;
  breakdown.push({
    key: 'experience',
    label: 'Experiência prévia',
    weight: AFFINITY_WEIGHTS.experience,
    value: experience,
    points: round2(experiencePoints),
  });

  const rawScore = keywordPoints + trackPoints + titlePoints + experiencePoints;

  // ── 5. Penalidade de carga ─────────────────────────────────────────────────
  const active = reviewer.activeAssignmentCount;
  const penalty = Math.min(active * WORKLOAD_PENALTY_PER_ASSIGNMENT, MAX_WORKLOAD_PENALTY);
  breakdown.push({
    key: 'workload_penalty',
    label: 'Carga atual de pareceres',
    weight: 0,
    value: active,
    points: -round2(penalty),
  });

  if (active > 0) {
    notes.push(`Já tem ${active} parecer(es) em andamento.`);
  }

  const max = reviewer.maxConcurrentAssignments ?? 0;
  const available = max === 0 || active < max;

  if (!available) {
    notes.push(`Atingiu o limite de ${max} pareceres simultâneos.`);
  }

  const score = Math.max(0, Math.min(100, rawScore - penalty));

  return {
    userId: reviewer.userId,
    name: reviewer.name,
    score: round2(score),
    rawScore: round2(rawScore),
    band: bandFor(score),
    breakdown,
    available,
    notes,
  };
}

function bandFor(score: number): AffinityBand {
  if (score >= 70) return 'EXCELLENT';
  if (score >= 50) return 'GOOD';
  if (score >= MIN_USEFUL_AFFINITY) return 'FAIR';
  return 'WEAK';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Rótulo em pt-BR para a faixa de afinidade. */
export const AFFINITY_BAND_LABELS: Record<AffinityBand, string> = {
  EXCELLENT: 'Excelente',
  GOOD: 'Boa',
  FAIR: 'Razoável',
  WEAK: 'Fraca',
};

// ───────────────────────────────────────────────────────────────────────────────
//  Sugestão de distribuição
// ───────────────────────────────────────────────────────────────────────────────
export interface ReviewerSuggestion {
  userId: string;
  name: string;
  score: number;
  band: AffinityBand;
  reasons: readonly string[];
}

/**
 * Sugere os N melhores revisores para uma submissão.
 *
 * Filtra apenas scores abaixo do mínimo útil: sugerir alguém com afinidade
 * "fraca" é pior que não sugerir ninguém, porque induz o comitê ao erro de
 * achar que houve avaliação de mérito onde não houve.
 */
export function suggestReviewers(
  submission: SubmissionProfile,
  reviewers: readonly ReviewerProfile[],
  limit = 5,
): ReviewerSuggestion[] {
  return rankReviewersByAffinity(submission, reviewers)
    .filter((result) => result.available && result.score >= MIN_USEFUL_AFFINITY)
    .slice(0, limit)
    .map((result) => ({
      userId: result.userId,
      name: result.name,
      score: result.score,
      band: result.band,
      reasons: result.breakdown
        .filter((component) => component.points > 0)
        .sort((a, b) => b.points - a.points)
        .map((component) => `${component.label}: ${Math.round(component.value * 100)}%`),
    }));
}

/**
 * Verifica se uma submissão tem pareceres suficientes.
 *
 * `requiredReviews` é configurável por trilha: uma trilha de pós-graduação pode
 * exigir 3 pareceres, um evento de iniciação científica pode exigir 2.
 */
export interface ReviewQuorum {
  satisfied: boolean;
  submitted: number;
  required: number;
  missing: number;
  message: string;
}

export function evaluateReviewQuorum(
  submittedCount: number,
  requiredReviews: number,
): ReviewQuorum {
  const missing = Math.max(0, requiredReviews - submittedCount);

  if (requiredReviews <= 0) {
    return {
      satisfied: true,
      submitted: submittedCount,
      required: 0,
      missing: 0,
      message: 'A trilha não exige número mínimo de pareceres.',
    };
  }

  return {
    satisfied: missing === 0,
    submitted: submittedCount,
    required: requiredReviews,
    missing,
    message:
      missing === 0
        ? `${submittedCount} parecer(es) recebido(s) — quórum atingido.`
        : `Faltam ${missing} parecer(es) de ${requiredReviews} exigidos.`,
  };
}

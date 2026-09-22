/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — afinidade e integridade de submissão
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  AFFINITY_WEIGHTS,
  MAX_WORKLOAD_PENALTY,
  MIN_USEFUL_AFFINITY,
  evaluateReviewQuorum,
  jaccard,
  rankReviewersByAffinity,
  suggestReviewers,
  tokenSet,
  tokenize,
  type ReviewerProfile,
  type SubmissionProfile,
} from '../../src/domain/review/affinity';

import {
  MAX_FILE_SIZE_BYTES,
  MAX_KEYWORDS,
  MIN_ABSTRACT_LENGTH,
  MIN_TITLE_LENGTH,
  canDeleteSubmission,
  canTransitionSubmission,
  evaluateSubmissionReadiness,
  fileReplacementCreatesVersion,
  isEditableByAuthor,
  isSha256Hex,
  isTerminalStatus,
  normalizeKeywords,
  requiresNewVersionForResubmission,
  validateSubmissionContent,
  validateSubmissionFile,
  verifyStoredObject,
} from '../../src/domain/review/submission-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
const submission: SubmissionProfile = {
  title: 'Aprendizado de máquina aplicado à saúde pública',
  abstract:
    'Este trabalho investiga modelos de aprendizado de máquina para predição de surtos epidemiológicos em dados de vigilância.',
  keywords: ['aprendizado de máquina', 'saúde pública', 'epidemiologia'],
  trackId: 'track-ml',
};

function profile(overrides: Partial<ReviewerProfile> = {}): ReviewerProfile {
  return {
    userId: 'r1',
    name: 'Revisor Um',
    expertiseKeywords: ['aprendizado de máquina', 'epidemiologia'],
    preferredTrackIds: ['track-ml'],
    activeAssignmentCount: 0,
    maxConcurrentAssignments: 5,
    completedReviewCount: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('tokenização', () => {
  it('remove acentos e pontuação', () => {
    const tokens = tokenize('Aprendizado de Máquina: saúde-pública!');
    expect(tokens).toContain('aprendizado');
    expect(tokens).toContain('maquina');
    expect(tokens).toContain('saude');
  });

  it('descarta stop words', () => {
    const tokens = tokenize('o estudo de uma análise sobre a pesquisa');
    // O tokenizador aplica stemming ANTES de filtrar, então as stop words são
    // comparadas em forma reduzida ("analis", "estud").
    expect(tokens.join(' ')).not.toMatch(/\banalis/);
    expect(tokens.join(' ')).not.toMatch(/\bestud/);
    expect(tokens.join(' ')).not.toMatch(/\bpesquis/);
    expect(tokens).toHaveLength(0);
  });

  it('aplica stemming leve para casar plurais', () => {
    expect(tokenize('redes')).toContain(tokenize('rede')[0]);
    expect(tokenize('modelos')).toContain(tokenize('modelo')[0]);
  });

  it('descarta tokens muito curtos', () => {
    expect(tokenize('a de ml ia')).toHaveLength(0);
  });

  it('tokenSet une vários textos', () => {
    const set = tokenSet(['aprendizado de máquina', 'saúde pública']);
    expect(set.size).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('jaccard()', () => {
  it('é 1 para conjuntos idênticos', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });

  it('é 0 para conjuntos disjuntos', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('não premia quem escreveu mais (diferente de contagem)', () => {
    // 2 em comum: um conjunto de 4 e outro de 100 → Jaccard baixo.
    const small = new Set(['a', 'b']);
    const large = new Set(['a', 'b', ...Array.from({ length: 98 }, (_, i) => `x${i}`)]);
    expect(jaccard(small, large)).toBeLessThan(0.05);
  });

  it('é simétrico', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });

  it('devolve 0 com conjunto vazio', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('rankReviewersByAffinity()', () => {
  it('pontua afinidade alta para revisor alinhado', () => {
    const [best] = rankReviewersByAffinity(submission, [profile()]);

    /**
     * O score é deliberadamente CONSERVADOR.
     *
     * A sobreposição de palavras usa Jaccard (interseção / união), que não premia
     * quem simplesmente escreveu mais. Como o resumo de uma submissão tem dezenas
     * de tokens e a lista de interesses do revisor tem poucos, um revisor bem
     * alinhado ainda fica na casa dos 40–50 — o que é o comportamento desejado:
     * a escala reserva a faixa alta para alinhamento excepcional.
     */
    expect(best?.score).toBeGreaterThan(40);
    expect(best?.band).toMatch(/EXCELLENT|GOOD|FAIR/);
  });

  it('pontua afinidade baixa para revisor fora do tema', () => {
    const [worst] = rankReviewersByAffinity(submission, [
      profile({
        expertiseKeywords: ['direito constitucional', 'história medieval'],
        preferredTrackIds: ['track-direito'],
      }),
    ]);
    expect(worst?.score).toBeLessThan(MIN_USEFUL_AFFINITY);
    expect(worst?.band).toBe('WEAK');
  });

  it('ordena do mais para o menos afim', () => {
    const ranked = rankReviewersByAffinity(submission, [
      profile({ userId: 'ruim', name: 'Ruim', expertiseKeywords: ['direito'], preferredTrackIds: [] }),
      profile({ userId: 'bom', name: 'Bom' }),
      profile({ userId: 'medio', name: 'Médio', expertiseKeywords: ['saúde pública'], preferredTrackIds: [] }),
    ]);

    expect(ranked[0]?.userId).toBe('bom');
    expect(ranked[ranked.length - 1]?.userId).toBe('ruim');
  });

  it('penaliza carga alta', () => {
    const [semCarga] = rankReviewersByAffinity(submission, [profile({ activeAssignmentCount: 0 })]);
    const [comCarga] = rankReviewersByAffinity(submission, [profile({ activeAssignmentCount: 4 })]);

    expect(comCarga!.score).toBeLessThan(semCarga!.score);
    expect(comCarga!.rawScore).toBe(semCarga!.rawScore);
  });

  it('limita a penalidade de carga ao teto', () => {
    const [muitoCarregado] = rankReviewersByAffinity(submission, [
      profile({ activeAssignmentCount: 100 }),
    ]);
    const penalty = muitoCarregado!.breakdown.find((c) => c.key === 'workload_penalty');
    expect(penalty?.points).toBe(-MAX_WORKLOAD_PENALTY);
  });

  it('marca indisponível quando atinge o limite de pareceres', () => {
    const [result] = rankReviewersByAffinity(submission, [
      profile({ activeAssignmentCount: 5, maxConcurrentAssignments: 5 }),
    ]);
    expect(result?.available).toBe(false);
    expect(result?.notes.join(' ')).toMatch(/limite/i);
  });

  it('sem limite configurado, está sempre disponível', () => {
    const [result] = rankReviewersByAffinity(submission, [
      profile({ activeAssignmentCount: 99, maxConcurrentAssignments: 0 }),
    ]);
    expect(result?.available).toBe(true);
  });

  it('coloca disponíveis antes dos indisponíveis', () => {
    const ranked = rankReviewersByAffinity(submission, [
      profile({ userId: 'cheio', name: 'Cheio', activeAssignmentCount: 5, maxConcurrentAssignments: 5 }),
      profile({ userId: 'livre', name: 'Livre' }),
    ]);
    expect(ranked[0]?.userId).toBe('livre');
  });

  it('o score nunca é negativo nem passa de 100', () => {
    for (const reviewer of [
      profile({ activeAssignmentCount: 50 }),
      profile(),
    ]) {
      const [result] = rankReviewersByAffinity(submission, [reviewer]);
      expect(result!.score).toBeGreaterThanOrEqual(0);
      expect(result!.score).toBeLessThanOrEqual(100);
    }
  });

  it('produz detalhamento com todos os componentes', () => {
    const [result] = rankReviewersByAffinity(submission, [profile()]);
    const keys = result!.breakdown.map((c) => c.key);

    expect(keys).toContain('keyword_overlap');
    expect(keys).toContain('track_match');
    expect(keys).toContain('title_match');
    expect(keys).toContain('experience');
    expect(keys).toContain('workload_penalty');
  });

  it('a trilha declarada pesa mais que a sobreposição de texto', () => {
    // Declaração explícita de área vale mais que inferência por palavras.
    expect(AFFINITY_WEIGHTS.trackMatch).toBeGreaterThan(AFFINITY_WEIGHTS.titleMatch);
  });

  it('satura a experiência em 10 pareceres', () => {
    const [dez] = rankReviewersByAffinity(submission, [profile({ completedReviewCount: 10 })]);
    const [cem] = rankReviewersByAffinity(submission, [profile({ completedReviewCount: 100 })]);
    expect(dez!.score).toBe(cem!.score);
  });

  it('ordem estável por nome em caso de empate', () => {
    const ranked = rankReviewersByAffinity(submission, [
      profile({ userId: 'b', name: 'Bruno' }),
      profile({ userId: 'a', name: 'Ana' }),
    ]);
    expect(ranked[0]?.name).toBe('Ana');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('suggestReviewers()', () => {
  it('sugere apenas quem tem afinidade útil', () => {
    const suggestions = suggestReviewers(submission, [
      profile({ userId: 'bom', name: 'Bom' }),
      profile({ userId: 'ruim', name: 'Ruim', expertiseKeywords: ['direito'], preferredTrackIds: [] }),
    ]);

    expect(suggestions.map((s) => s.userId)).toContain('bom');
    expect(suggestions.map((s) => s.userId)).not.toContain('ruim');
  });

  it('respeita o limite de sugestões', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      profile({ userId: `r${i}`, name: `Revisor ${i}` }),
    );
    expect(suggestReviewers(submission, many, 3)).toHaveLength(3);
  });

  it('exclui revisores indisponíveis', () => {
    const suggestions = suggestReviewers(submission, [
      profile({ userId: 'cheio', activeAssignmentCount: 5, maxConcurrentAssignments: 5 }),
    ]);
    expect(suggestions).toHaveLength(0);
  });

  it('fornece razões legíveis', () => {
    const [suggestion] = suggestReviewers(submission, [profile()]);
    expect(suggestion!.reasons.length).toBeGreaterThan(0);
    expect(suggestion!.reasons[0]).toMatch(/:/);
  });

  it('devolve lista vazia sem candidatos', () => {
    expect(suggestReviewers(submission, [])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateReviewQuorum()', () => {
  it('satisfeito quando atinge o exigido', () => {
    const quorum = evaluateReviewQuorum(3, 3);
    expect(quorum.satisfied).toBe(true);
    expect(quorum.missing).toBe(0);
  });

  it('insatisfeito quando faltam pareceres', () => {
    const quorum = evaluateReviewQuorum(1, 3);
    expect(quorum.satisfied).toBe(false);
    expect(quorum.missing).toBe(2);
    expect(quorum.message).toMatch(/Faltam 2/);
  });

  it('exigência zero é sempre satisfeita', () => {
    expect(evaluateReviewQuorum(0, 0).satisfied).toBe(true);
  });

  it('exceder o exigido continua satisfeito', () => {
    expect(evaluateReviewQuorum(5, 2).satisfied).toBe(true);
    expect(evaluateReviewQuorum(5, 2).missing).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('máquina de estados da submissão', () => {
  it('permite o caminho normal', () => {
    expect(canTransitionSubmission('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransitionSubmission('SUBMITTED', 'UNDER_REVIEW')).toBe(true);
    expect(canTransitionSubmission('UNDER_REVIEW', 'ACCEPTED')).toBe(true);
  });

  it('ACCEPTED e REJECTED são TERMINAIS', () => {
    // O resultado de uma avaliação é um registro; desfazê-lo geraria
    // inconsistência entre o que o autor viu e o que o comitê decidiu.
    for (const target of ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED'] as const) {
      expect(canTransitionSubmission('ACCEPTED', target)).toBe(false);
    }
    expect(isTerminalStatus('ACCEPTED')).toBe(true);
    expect(isTerminalStatus('REJECTED')).toBe(true);
  });

  it('não permite transição para o mesmo estado', () => {
    expect(canTransitionSubmission('SUBMITTED', 'SUBMITTED')).toBe(false);
  });

  it('permite revisão solicitada voltar a envio', () => {
    expect(canTransitionSubmission('REVISION_REQUESTED', 'SUBMITTED')).toBe(true);
  });

  it('WITHDRAWN e CANCELED são terminais', () => {
    expect(isTerminalStatus('WITHDRAWN')).toBe(true);
    expect(isTerminalStatus('CANCELED')).toBe(true);
  });

  it('autor só edita em rascunho ou revisão solicitada', () => {
    expect(isEditableByAuthor('DRAFT')).toBe(true);
    expect(isEditableByAuthor('REVISION_REQUESTED')).toBe(true);
    expect(isEditableByAuthor('SUBMITTED')).toBe(false);
    expect(isEditableByAuthor('UNDER_REVIEW')).toBe(false);
    expect(isEditableByAuthor('ACCEPTED')).toBe(false);
  });

  it('reenvio durante a revisão cria nova versão', () => {
    expect(requiresNewVersionForResubmission('UNDER_REVIEW')).toBe(true);
    expect(requiresNewVersionForResubmission('REVISION_REQUESTED')).toBe(true);
    expect(requiresNewVersionForResubmission('ACCEPTED')).toBe(false);
  });

  it('substituição de arquivo só não versiona em rascunho', () => {
    expect(fileReplacementCreatesVersion('DRAFT')).toBe(false);
    for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED'] as const) {
      expect(fileReplacementCreatesVersion(status)).toBe(true);
    }
  });

  /**
   * Excluir e editar são perguntas DIFERENTES (revisão da FASE 4).
   *
   * `REVISION_REQUESTED` é editável — o autor pode corrigir e reenviar — e ainda
   * assim não pode ser excluída: a essa altura já existe uma versão enviada e um
   * parecer que se refere a ela. Só o rascunho sai da história sem levar registro
   * nenhum junto.
   */
  it('apenas o RASCUNHO pode ser excluído', () => {
    expect(canDeleteSubmission('DRAFT')).toBe(true);

    for (const status of [
      'SUBMITTED',
      'UNDER_REVIEW',
      'REVISION_REQUESTED',
      'ACCEPTED',
      'REJECTED',
      'WITHDRAWN',
      'CANCELED',
    ] as const) {
      expect(canDeleteSubmission(status)).toBe(false);
    }
  });

  it('o que é editável não é necessariamente excluível', () => {
    expect(isEditableByAuthor('REVISION_REQUESTED')).toBe(true);
    expect(canDeleteSubmission('REVISION_REQUESTED')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateSubmissionFile()', () => {
  const magicPdf = [0x25, 0x50, 0x44, 0x46, 0x2d];

  it('aceita PDF válido', () => {
    const result = validateSubmissionFile({
      fileName: 'artigo.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      magicBytes: magicPdf,
    });
    expect(result.valid).toBe(true);
  });

  it('rejeita arquivo vazio', () => {
    const result = validateSubmissionFile({
      fileName: 'vazio.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 0,
      magicBytes: magicPdf,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'EMPTY')).toBe(true);
  });

  it('rejeita arquivo acima do limite', () => {
    const result = validateSubmissionFile({
      fileName: 'grande.pdf',
      mimeType: 'application/pdf',
      sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      magicBytes: magicPdf,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'TOO_LARGE')).toBe(true);
  });

  it('aceita exatamente no limite', () => {
    const result = validateSubmissionFile({
      fileName: 'limite.pdf',
      mimeType: 'application/pdf',
      sizeBytes: MAX_FILE_SIZE_BYTES,
      magicBytes: magicPdf,
    });
    expect(result.valid).toBe(true);
  });

  it('REJEITA arquivo cuja assinatura não é PDF (mesmo com mime correto)', () => {
    // O mime declarado pelo cliente é arbitrário; a assinatura é a evidência.
    const result = validateSubmissionFile({
      fileName: 'falso.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      magicBytes: [0x50, 0x4b, 0x03, 0x04], // ZIP disfarçado
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'NOT_PDF')).toBe(true);
  });

  it('sem assinatura, usa o mime declarado', () => {
    const result = validateSubmissionFile({
      fileName: 'doc.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1024,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.code === 'INVALID_MIME')).toBe(true);
  });

  it('aceita application/x-pdf como variação', () => {
    const result = validateSubmissionFile({
      fileName: 'artigo.pdf',
      mimeType: 'application/x-pdf',
      sizeBytes: 1024,
    });
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('verifyStoredObject() — integridade pós-upload', () => {
  const hash = 'a'.repeat(64);

  it('aceita quando tamanho e hash conferem', () => {
    expect(
      verifyStoredObject({
        declaredSize: 1024,
        storedSize: 1024,
        declaredChecksum: hash,
        storedChecksum: hash,
      }),
    ).toEqual({ ok: true });
  });

  it('aceita quando o storage não reporta checksum', () => {
    // Alguns backends S3 não calculam SHA-256; exigir isso inviabilizaria.
    expect(
      verifyStoredObject({
        declaredSize: 1024,
        storedSize: 1024,
        declaredChecksum: hash,
        storedChecksum: null,
      }),
    ).toEqual({ ok: true });
  });

  it('REJEITA quando o hash diverge (arquivo trocado)', () => {
    const result = verifyStoredObject({
      declaredSize: 1024,
      storedSize: 1024,
      declaredChecksum: hash,
      storedChecksum: 'b'.repeat(64),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('HASH_MISMATCH');
  });

  it('rejeita quando o tamanho diverge', () => {
    const result = verifyStoredObject({
      declaredSize: 1024,
      storedSize: 2048,
      declaredChecksum: hash,
      storedChecksum: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('SIZE_MISMATCH');
  });

  it('rejeita quando o objeto não existe', () => {
    const result = verifyStoredObject({
      declaredSize: 1024,
      storedSize: 0,
      declaredChecksum: hash,
      storedChecksum: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MISSING_OBJECT');
  });

  it('rejeita hash declarado em formato inválido', () => {
    const result = verifyStoredObject({
      declaredSize: 1024,
      storedSize: 1024,
      declaredChecksum: 'nao-e-hash',
      storedChecksum: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('INVALID_HASH');
  });

  it('isSha256Hex valida o formato', () => {
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(isSha256Hex('a'.repeat(63))).toBe(false);
    expect(isSha256Hex('g'.repeat(64))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateSubmissionContent()', () => {
  const valid = {
    title: 'Um título suficientemente longo',
    abstract: 'R'.repeat(MIN_ABSTRACT_LENGTH),
    keywords: ['um', 'dois', 'tres'],
    language: 'pt-BR',
  };

  it('aceita conteúdo válido', () => {
    expect(validateSubmissionContent(valid).valid).toBe(true);
  });

  it('rejeita título curto', () => {
    const result = validateSubmissionContent({ ...valid, title: 'Curto' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]?.field).toBe('title');
  });

  it('rejeita resumo curto (impede avaliação de mérito)', () => {
    const result = validateSubmissionContent({ ...valid, abstract: 'Muito curto.' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.field === 'abstract')).toBe(true);
  });

  it('rejeita poucas palavras-chave', () => {
    const result = validateSubmissionContent({ ...valid, keywords: ['um', 'dois'] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.field === 'keywords')).toBe(true);
  });

  it('rejeita palavras-chave demais', () => {
    const result = validateSubmissionContent({
      ...valid,
      keywords: Array.from({ length: MAX_KEYWORDS + 1 }, (_, i) => `kw${i}`),
    });
    expect(result.valid).toBe(false);
  });

  it('ignora palavras-chave duplicadas na contagem', () => {
    const result = validateSubmissionContent({
      ...valid,
      keywords: ['tema', 'TEMA', 'tema ', 'outro'],
    });
    expect(result.valid).toBe(false); // só 2 distintas
    if (!result.valid) expect(result.errors.some((e) => e.field === 'keywords')).toBe(true);
  });

  it('ignora palavras-chave vazias', () => {
    const result = validateSubmissionContent({
      ...valid,
      keywords: ['um', '', '   ', 'dois', 'tres'],
    });
    expect(result.valid).toBe(true);
  });

  /**
   * A lista NORMALIZADA é a que vai para o banco (revisão da FASE 4).
   *
   * A contagem e a gravação usam a mesma função: sem isso, `teste, teste, teste`
   * passaria como três na tela e viraria uma no índice de afinidade dos revisores.
   */
  it('normaliza a lista gravada — sem vazias, sem repetidas e sem espaços sobrando', () => {
    expect(normalizeKeywords([' Saúde ', '', 'saúde', '   ', 'Dados', 'dados abertos'])).toEqual([
      'Saúde',
      'Dados',
      'dados abertos',
    ]);

    expect(normalizeKeywords([])).toEqual([]);
    // A primeira grafia é a que fica: quem digitou "Saúde" não vê "saúde" de volta.
    expect(normalizeKeywords(['Saúde', 'SAÚDE'])).toEqual(['Saúde']);
  });

  it('rejeita idioma não suportado', () => {
    const result = validateSubmissionContent({ ...valid, language: 'fr' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.field === 'language')).toBe(true);
  });

  it('aceita os três idiomas suportados', () => {
    for (const language of ['pt-BR', 'en', 'es']) {
      expect(validateSubmissionContent({ ...valid, language }).valid).toBe(true);
    }
  });

  it('aplica trim antes de medir', () => {
    const result = validateSubmissionContent({
      ...valid,
      title: `   ${'T'.repeat(MIN_TITLE_LENGTH)}   `,
    });
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateSubmissionReadiness()', () => {
  const base = {
    title: 'Um título suficientemente longo',
    abstract: 'R'.repeat(MIN_ABSTRACT_LENGTH),
    keywords: ['um', 'dois', 'tres'],
    language: 'pt-BR',
    trackId: 'track-1',
    files: [{ kind: 'BLIND_PDF' as const, checksum: 'a'.repeat(64) }],
    requiresBlindReview: true,
    authorCount: 1,
  };

  it('pronta quando tudo está presente', () => {
    const result = evaluateSubmissionReadiness(base);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('bloqueia sem PDF cego quando a trilha exige revisão cega', () => {
    const result = evaluateSubmissionReadiness({
      ...base,
      files: [{ kind: 'IDENTIFIED_PDF', checksum: 'a'.repeat(64) }],
    });

    expect(result.ready).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/revisão cega/i);
  });

  it('avisa (não bloqueia) quando falta a versão identificada', () => {
    // A versão identificada é necessária para publicar, não para avaliar.
    const result = evaluateSubmissionReadiness(base);
    expect(result.ready).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/identificação/i);
  });

  it('bloqueia sem nenhum arquivo quando não exige revisão cega', () => {
    const result = evaluateSubmissionReadiness({
      ...base,
      requiresBlindReview: false,
      files: [],
    });

    expect(result.ready).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/anexe o arquivo/i);
  });

  it('bloqueia sem trilha', () => {
    const result = evaluateSubmissionReadiness({ ...base, trackId: null });
    expect(result.ready).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/trilha/i);
  });

  it('bloqueia sem autores', () => {
    const result = evaluateSubmissionReadiness({ ...base, authorCount: 0 });
    expect(result.ready).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/autor/i);
  });

  it('ignora arquivo sem checksum (upload não confirmado)', () => {
    const result = evaluateSubmissionReadiness({
      ...base,
      files: [{ kind: 'BLIND_PDF', checksum: null }],
    });
    expect(result.ready).toBe(false);
  });

  it('acumula múltiplos bloqueios', () => {
    const result = evaluateSubmissionReadiness({
      ...base,
      title: 'x',
      trackId: null,
      authorCount: 0,
      files: [],
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(4);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  PROPOSTA DE PROGRAMAÇÃO (FASE 33)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A mesma máquina de prontidão serve artigo e minicurso — e é ela que precisa
   *  saber a diferença, não um `if` no serviço. Sem trilha e sem PDF, o que bloqueia
   *  um artigo não pode bloquear uma proposta de palestra.
   */
  describe('proposta que não é científica', () => {
    it('NÃO exige trilha nem arquivo, mas avisa sobre o arquivo', () => {
      const result = evaluateSubmissionReadiness({
        ...base,
        trackId: null,
        files: [],
        requiresBlindReview: false,
        proposalKind: 'MINICOURSE',
      });

      expect(result.ready).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings.join(' ')).toMatch(/nenhum arquivo/i);
    });

    it('com arquivo anexado, nem o aviso aparece', () => {
      const result = evaluateSubmissionReadiness({
        ...base,
        trackId: null,
        files: [{ kind: 'SUPPLEMENTARY', checksum: 'b'.repeat(64) }],
        requiresBlindReview: false,
        proposalKind: 'WORKSHOP',
      });

      expect(result.ready).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('o ARTIGO continua exigindo trilha e PDF — o afrouxamento é só do que não é científico', () => {
      const paper = evaluateSubmissionReadiness({
        ...base,
        trackId: null,
        files: [],
        requiresBlindReview: false,
        proposalKind: 'PAPER',
      });
      const poster = evaluateSubmissionReadiness({
        ...base,
        trackId: null,
        files: [],
        requiresBlindReview: false,
        proposalKind: 'POSTER',
      });

      expect(paper.ready).toBe(false);
      expect(paper.blockers.join(' ')).toMatch(/trilha/i);
      expect(poster.ready).toBe(false);
      expect(poster.blockers.join(' ')).toMatch(/trilha/i);
    });

    it('sem autores continua bloqueando, seja artigo ou minicurso', () => {
      const result = evaluateSubmissionReadiness({
        ...base,
        trackId: null,
        files: [],
        requiresBlindReview: false,
        authorCount: 0,
        proposalKind: 'SPEAKER',
      });

      expect(result.ready).toBe(false);
      expect(result.blockers.join(' ')).toMatch(/autor/i);
    });
  });
});

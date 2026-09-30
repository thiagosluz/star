/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 51 · dívida E32 — a regra pura da troca de trilha
 *
 *  A decisão vive no domínio porque as duas pontas a fazem: a TELA esconde o seletor
 *  com ela, e o SERVIÇO recusa a troca com ela. Se fossem duas perguntas, a tela
 *  ofereceria o que o serviço nega.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { canChangeSubmissionTrack } from '../../src/domain/review/submission-rules';

const SEM_DEPENDENCIA = { reviewCount: 0, assignmentCount: 0 };

describe('E32 — trocar a trilha depende do que já depende dela', () => {
  it('rascunho sem parecer e sem atribuição PODE', () => {
    const verdict = canChangeSubmissionTrack({ status: 'DRAFT', ...SEM_DEPENDENCIA });

    expect(verdict.allowed).toBe(true);
  });

  it('parecer é a primeira recusa — e a mensagem diz que é do comitê', () => {
    const verdict = canChangeSubmissionTrack({
      status: 'DRAFT',
      reviewCount: 1,
      assignmentCount: 0,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe('HAS_REVIEWS');
    expect(verdict.message).toMatch(/rubrica/i);
    expect(verdict.message).toMatch(/comitê/i);
  });

  it('atribuição a revisor também recusa (a fila foi montada por trilha)', () => {
    const verdict = canChangeSubmissionTrack({
      status: 'DRAFT',
      reviewCount: 0,
      assignmentCount: 2,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe('HAS_ASSIGNMENTS');
    expect(verdict.message).toMatch(/revisores/i);
  });

  it('fora do rascunho recusa, mesmo sem parecer nem atribuição', () => {
    for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED'] as const) {
      const verdict = canChangeSubmissionTrack({ status, ...SEM_DEPENDENCIA });

      expect(verdict.allowed, status).toBe(false);
      expect(verdict.code).toBe('NOT_DRAFT');
      expect(verdict.message).toMatch(/comitê/i);
    }
  });

  it('o PARECER tem precedência sobre o estado na resposta', () => {
    /**
     * Uma submissão em revisão com parecer: o motivo mais útil é "já tem parecer", e
     * não "não é rascunho" — é o parecer que amarra a nota à rubrica da trilha.
     */
    const verdict = canChangeSubmissionTrack({
      status: 'REVISION_REQUESTED',
      reviewCount: 1,
      assignmentCount: 1,
    });

    expect(verdict.code).toBe('HAS_REVIEWS');
  });

  it('toda recusa traz motivo E caminho — nunca só "não pode"', () => {
    const recusas = [
      canChangeSubmissionTrack({ status: 'DRAFT', reviewCount: 1, assignmentCount: 0 }),
      canChangeSubmissionTrack({ status: 'DRAFT', reviewCount: 0, assignmentCount: 1 }),
      canChangeSubmissionTrack({ status: 'ACCEPTED', ...SEM_DEPENDENCIA }),
    ];

    for (const verdict of recusas) {
      expect(verdict.message, verdict.code).toBeTruthy();
      expect((verdict.message ?? '').length).toBeGreaterThan(30);
    }
  });
});

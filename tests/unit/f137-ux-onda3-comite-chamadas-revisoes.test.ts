import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  countProposalKeywords,
  describeProposalKindDefaults,
  formatAssignmentStatusLabel,
  formatRecommendationLabel,
  formatSubmissionStatusLabel,
  submissionStatusTone,
} from '@/domain/review/review-ux-rules';
import { CallCreateFields } from '@/components/admin/call-create-fields';
import { DecisionForm } from '@/components/review/decision-form';

describe('FASE 137 — UX Onda 3 (Comitê Científico, Chamadas e Pareceres)', () => {
  it('traduz enums de recomendação, atribuição e status da submissão para português sem vazar inglês', () => {
    expect(formatRecommendationLabel('ACCEPT')).toBe('Aceitar');
    expect(formatRecommendationLabel('MINOR_REVISION')).toBe('Aceitar com revisões menores');
    expect(formatRecommendationLabel('MAJOR_REVISION')).toBe('Revisões maiores');
    expect(formatRecommendationLabel('REJECT')).toBe('Rejeitar');

    expect(formatAssignmentStatusLabel('ASSIGNED')).toBe('Atribuído');
    expect(formatAssignmentStatusLabel('IN_PROGRESS')).toBe('Em andamento');
    expect(formatAssignmentStatusLabel('SUBMITTED')).toBe('Parecer enviado');
    expect(formatAssignmentStatusLabel('DECLINED')).toBe('Recusado');

    expect(formatSubmissionStatusLabel('SUBMITTED')).toBe('Aguardando atribuição');
    expect(formatSubmissionStatusLabel('UNDER_REVIEW')).toBe('Em avaliação');
    expect(formatSubmissionStatusLabel('ACCEPTED')).toBe('Aceita');
    expect(formatSubmissionStatusLabel('REJECTED')).toBe('Rejeitada');

    expect(submissionStatusTone('ACCEPTED')).toBe('success');
    expect(submissionStatusTone('UNDER_REVIEW')).toBe('warning');
    expect(submissionStatusTone('SUBMITTED')).toBe('info');
    expect(submissionStatusTone('REJECTED')).toBe('destructive');
  });

  it('countProposalKeywords conta palavras-chave distintas ignorando espaços e duplicatas', () => {
    expect(countProposalKeywords('')).toBe(0);
    expect(countProposalKeywords('saúde, , educação, SAÚDE, tecnologia')).toBe(3);
    expect(countProposalKeywords('a, b, c, d, e')).toBe(5);
  });

  it('describeProposalKindDefaults diferencia chamadas científicas de atividades/palestrantes', () => {
    expect(describeProposalKindDefaults('PAPER')).toContain('revisão cega');
    expect(describeProposalKindDefaults('POSTER')).toContain('revisão cega');
    expect(describeProposalKindDefaults('SPEAKER')).toContain('revisão aberta');
    expect(describeProposalKindDefaults('WORKSHOP')).toContain('trilha opcional');
  });

  it('CallCreateFields e DecisionForm renderizam SSR preservando contratos e rótulos em português', () => {
    const callHtml = renderToStaticMarkup(
      createElement(CallCreateFields, {
        eventTimezone: 'America/Bahia',
        trackOptions: [{ value: '', label: 'Sem trilha' }],
        blindOptions: [{ value: '', label: 'Padrão do tipo' }],
        blindHint: 'Dica de cegueira',
      }),
    );

    expect(callHtml).toContain('name="title"');
    expect(callHtml).toContain('name="slug"');
    expect(callHtml).toContain('<textarea');
    expect(callHtml).toContain('name="instructions"');
    expect(callHtml.indexOf('name="title"')).toBeLessThan(callHtml.indexOf('name="slug"'));

    const decisionHtml = renderToStaticMarkup(
      createElement(DecisionForm, {
        tenantSlug: 'ufba-demo',
        submissionId: 'sub-1',
        consensus: {
          reviewCount: 2,
          averageScore: 84.5,
          scoreStdDev: 2.1,
          distribution: {
            ACCEPT: 2,
            MINOR_REVISION: 0,
            MAJOR_REVISION: 0,
            REJECT: 0,
          },
          requiresDiscussion: false,
          discussionReasons: [],
        },
        quorumSatisfied: true,
        quorumMessage: 'Quórum atingido (2 de 2).',
        suggested: 'ACCEPT',
        action: async () => ({ ok: true, message: 'ok' }),
      }),
    );

    expect(decisionHtml).toContain('Aceitar: 2');
    expect(decisionHtml).toContain('Sugestão a partir da média:');
    expect(decisionHtml).not.toContain('ACCEPT: 2');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Texto da decisão da proposta (FASE 36, dívida E47)
 *
 *  A proposta era recebida com protocolo (FASE 33) e decidida em silêncio: o
 *  proponente só descobria o resultado abrindo "Minhas submissões" por acaso. Este
 *  teste prende o que o aviso DIZ — e, principalmente, que as três decisões dizem
 *  coisas DIFERENTES, porque "aceita", "recusada" e "ajustes solicitados" pedem ações
 *  diferentes de quem lê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DECISION_NOTICE_TEXT,
  PROPOSAL_DECISIONS,
  decisionNoticeText,
  isProposalDecision,
} from '../../src/domain/review/decision-notice-rules';
import {
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_LABELS,
  renderEmail,
} from '../../src/domain/communication/email-templates';

const CONTEXT = { brandName: 'Universidade Federal da Bahia' };

const payload = {
  recipientName: 'Ana Souza',
  eventTitle: 'Congresso de Tecnologia 2026',
  callTitle: 'Chamada de minicursos',
  proposalTitle: 'Introdução a Rust para cientistas de dados',
  protocol: '2026-AB12',
  proposalsUrl: 'http://localhost:3000/t/ufba/submissoes',
};

describe('texto da decisão', () => {
  it('as três decisões têm rótulo e orientação, e nenhuma é vazia', () => {
    expect(PROPOSAL_DECISIONS).toEqual(['ACCEPTED', 'REJECTED', 'REVISION_REQUESTED']);

    for (const decision of PROPOSAL_DECISIONS) {
      const text = decisionNoticeText(decision);

      expect(text.label.length).toBeGreaterThan(2);
      expect(text.outcome.length).toBeGreaterThan(40);
      expect(text).toBe(DECISION_NOTICE_TEXT[decision]);
    }
  });

  it('as três orientações são DISTINTAS (a mesma frase para tudo não avisa nada)', () => {
    const outcomes = PROPOSAL_DECISIONS.map((decision) => decisionNoticeText(decision).outcome);
    const labels = PROPOSAL_DECISIONS.map((decision) => decisionNoticeText(decision).label);

    expect(new Set(outcomes).size).toBe(3);
    expect(new Set(labels).size).toBe(3);
  });

  it('a recusa diz o que NÃO aconteceu; os ajustes dizem o que fazer agora', () => {
    expect(decisionNoticeText('REJECTED').outcome).toContain('não foi selecionada');
    expect(decisionNoticeText('REVISION_REQUESTED').outcome).toContain('envie de novo');
  });

  it('reconhece apenas as decisões que fecham a avaliação', () => {
    expect(isProposalDecision('ACCEPTED')).toBe(true);
    expect(isProposalDecision('WITHDRAWN')).toBe(false);
    expect(isProposalDecision('DRAFT')).toBe(false);
    expect(isProposalDecision(1)).toBe(false);
  });
});

describe('template PROPOSAL_DECIDED', () => {
  it('entrou no catálogo, com rótulo', () => {
    expect(EMAIL_TEMPLATE_KEYS).toContain('PROPOSAL_DECIDED');
    expect(EMAIL_TEMPLATE_LABELS.PROPOSAL_DECIDED).toBeTruthy();
  });

  it('o assunto começa pela SITUAÇÃO — dá para decidir o que ler sem abrir', () => {
    const rendered = renderEmail(
      'PROPOSAL_DECIDED',
      {
        ...payload,
        decisionLabel: DECISION_NOTICE_TEXT.ACCEPTED.label,
        outcome: DECISION_NOTICE_TEXT.ACCEPTED.outcome,
        notes: null,
      },
      CONTEXT,
    );

    expect(rendered.subject).toContain('Aceita');
    expect(rendered.subject).toContain(payload.proposalTitle);
    expect(rendered.text).toContain('aceita');
    expect(rendered.text).toContain(payload.protocol);
    expect(rendered.text).toContain(payload.proposalsUrl);
  });

  it('o parecer do comitê entra literal — é o que a pessoa lê para ajustar', () => {
    const rendered = renderEmail(
      'PROPOSAL_DECIDED',
      {
        ...payload,
        decisionLabel: DECISION_NOTICE_TEXT.REVISION_REQUESTED.label,
        outcome: DECISION_NOTICE_TEXT.REVISION_REQUESTED.outcome,
        notes: 'Detalhar a carga horária e a ementa.',
      },
      CONTEXT,
    );

    expect(rendered.html).toContain('Detalhar a carga horária e a ementa.');
    expect(rendered.text).toContain('Detalhar a carga horária e a ementa.');
  });

  it('sem parecer, o destaque não vira "null" na tela do e-mail', () => {
    const rendered = renderEmail(
      'PROPOSAL_DECIDED',
      {
        ...payload,
        decisionLabel: DECISION_NOTICE_TEXT.REJECTED.label,
        outcome: DECISION_NOTICE_TEXT.REJECTED.outcome,
        notes: null,
      },
      CONTEXT,
    );

    expect(rendered.html).not.toContain('Parecer do comitê');
    expect(rendered.html).not.toContain('null');
  });

  it('ESCAPA o parecer: o texto do comitê é texto de usuário', () => {
    const rendered = renderEmail(
      'PROPOSAL_DECIDED',
      {
        ...payload,
        decisionLabel: DECISION_NOTICE_TEXT.REJECTED.label,
        outcome: DECISION_NOTICE_TEXT.REJECTED.outcome,
        notes: '<img src=x onerror="alert(1)">',
      },
      CONTEXT,
    );

    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img src=x');
  });
});

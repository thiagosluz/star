/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — DENÚNCIA E MODERAÇÃO DO PERFIL PÚBLICO (FASE 56 · E62)
 *
 *  O que estes testes prendem, e por que cada um importa:
 *
 *    • o catálogo de categorias é FECHADO e cada uma diz o que significa — quem
 *      denuncia precisa escolher com o mesmo entendimento de quem triagem;
 *    • `OTHER` exige detalhes, e o mínimo é um PISO: "spam" não é relato;
 *    • o TETO de 2000 vale para todas as categorias — passar dele é erro de
 *      gravação se o domínio não recusar antes;
 *    • a denúncia ABERTA é a única que aceita decisão: decidir duas vezes não pode
 *      ser possível pela tela nem pelo serviço;
 *    • a NOTA da decisão é obrigatória nos DOIS desfechos — "dispensada" sem
 *      justificativa é indistinguível de "ninguém olhou";
 *    • a consequência de cada ação está escrita (o serviço aplica a mesma frase), e
 *      ocultar NÃO é apagar: o `@handle` continua existindo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DECISION_NOTE_MAX_LENGTH,
  DECISION_NOTE_MIN_LENGTH,
  HIDDEN_REASON_FALLBACK,
  HIDDEN_REASON_MAX_LENGTH,
  PROFILE_MODERATION_ACTIONS,
  PROFILE_MODERATION_ACTION_LABELS,
  PROFILE_REPORT_CATEGORIES,
  PROFILE_REPORT_CATEGORY_LABELS,
  PROFILE_REPORT_CATEGORY_MEANINGS,
  PROFILE_REPORT_STATUSES,
  PROFILE_REPORT_STATUS_LABELS,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_DETAILS_MIN_LENGTH,
  canDecideReport,
  decisionNoteProblem,
  decisionNoteProblemMessage,
  detailsProblem,
  detailsProblemMessage,
  isProfileModerationAction,
  isProfileReportCategory,
  profileModerationEffect,
  requiresDetails,
} from '../../src/domain/profile/profile-moderation-rules';

describe('catálogo de categorias', () => {
  it('cobre as cinco categorias do schema, com rótulo e significado', () => {
    expect(PROFILE_REPORT_CATEGORIES).toEqual([
      'FALSE_IDENTITY',
      'OFFENSIVE_CONTENT',
      'PRIVACY',
      'SPAM',
      'OTHER',
    ]);

    for (const category of PROFILE_REPORT_CATEGORIES) {
      expect(PROFILE_REPORT_CATEGORY_LABELS[category].length).toBeGreaterThan(0);
      expect(PROFILE_REPORT_CATEGORY_MEANINGS[category].length).toBeGreaterThan(0);
    }

    /**
     * A sigla em inglês não chega à tela: o rótulo é português de produto, e nenhum
     * deles repete a chave do enum.
     */
    for (const category of PROFILE_REPORT_CATEGORIES) {
      expect(PROFILE_REPORT_CATEGORY_LABELS[category]).not.toBe(category);
    }
  });

  it('reconhece só o que está no catálogo', () => {
    expect(isProfileReportCategory('SPAM')).toBe(true);
    expect(isProfileReportCategory('spam')).toBe(false);
    expect(isProfileReportCategory('')).toBe(false);
    expect(isProfileReportCategory(null)).toBe(false);
    expect(isProfileReportCategory(42)).toBe(false);
  });
});

describe('requiresDetails', () => {
  it('exige o relato apenas em OTHER, que não diz nada sozinha', () => {
    expect(requiresDetails('OTHER')).toBe(true);
    expect(requiresDetails('SPAM')).toBe(false);
    expect(requiresDetails('FALSE_IDENTITY')).toBe(false);
    expect(requiresDetails('OFFENSIVE_CONTENT')).toBe(false);
    expect(requiresDetails('PRIVACY')).toBe(false);
  });
});

describe('detailsProblem', () => {
  it('aceita a categoria que se explica sem detalhes', () => {
    expect(detailsProblem('SPAM', '')).toBeNull();
    expect(detailsProblem('SPAM', '   ')).toBeNull();
    expect(detailsProblem('SPAM', null)).toBeNull();
    expect(detailsProblem('SPAM', undefined)).toBeNull();
    /** Fora de OTHER o piso não vale: um detalhe curto é permitido. */
    expect(detailsProblem('SPAM', 'links repetidos')).toBeNull();
    expect(detailsProblem('OFFENSIVE_CONTENT', 'ofensa')).toBeNull();
  });

  it('exige o relato em OTHER', () => {
    expect(detailsProblem('OTHER', '')).toBe('REQUIRED');
    expect(detailsProblem('OTHER', '    ')).toBe('REQUIRED');
    expect(detailsProblem('OTHER', null)).toBe('REQUIRED');
  });

  it('aplica o PISO de 10 caracteres só quando o detalhe é exigido', () => {
    expect(REPORT_DETAILS_MIN_LENGTH).toBe(10);

    expect(detailsProblem('OTHER', 'spam')).toBe('TOO_SHORT');
    /** Nove caracteres ainda é curto; dez já passa. */
    expect(detailsProblem('OTHER', '123456789')).toBe('TOO_SHORT');
    expect(detailsProblem('OTHER', '1234567890')).toBeNull();
    expect(detailsProblem('OTHER', '  perfil usa dados de terceiros  ')).toBeNull();
  });

  it('recusa acima do teto da coluna, em qualquer categoria', () => {
    expect(REPORT_DETAILS_MAX_LENGTH).toBe(2000);

    const noLimite = 'a'.repeat(REPORT_DETAILS_MAX_LENGTH);
    const passou = 'a'.repeat(REPORT_DETAILS_MAX_LENGTH + 1);

    expect(detailsProblem('OTHER', noLimite)).toBeNull();
    expect(detailsProblem('OTHER', passou)).toBe('TOO_LONG');
    expect(detailsProblem('SPAM', passou)).toBe('TOO_LONG');
  });

  it('cada recusa tem uma frase que diz o que corrigir', () => {
    expect(detailsProblemMessage('REQUIRED')).toMatch(/descreva o motivo/i);
    expect(detailsProblemMessage('TOO_SHORT')).toContain(String(REPORT_DETAILS_MIN_LENGTH));
    expect(detailsProblemMessage('TOO_LONG')).toContain(String(REPORT_DETAILS_MAX_LENGTH));
  });
});

describe('canDecideReport', () => {
  it('só a denúncia aberta aceita decisão', () => {
    expect(PROFILE_REPORT_STATUSES).toEqual(['OPEN', 'DISMISSED', 'ACTIONED']);

    expect(canDecideReport('OPEN')).toBe(true);
    expect(canDecideReport('DISMISSED')).toBe(false);
    expect(canDecideReport('ACTIONED')).toBe(false);

    for (const status of PROFILE_REPORT_STATUSES) {
      expect(PROFILE_REPORT_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

describe('ações da moderação', () => {
  it('são duas, com rótulo e consequência escrita', () => {
    expect(PROFILE_MODERATION_ACTIONS).toEqual(['DISMISS', 'HIDE']);

    for (const action of PROFILE_MODERATION_ACTIONS) {
      expect(PROFILE_MODERATION_ACTION_LABELS[action].length).toBeGreaterThan(0);
      expect(profileModerationEffect(action).length).toBeGreaterThan(0);
    }
  });

  it('a consequência diz o que muda — e que ocultar NÃO apaga', () => {
    expect(profileModerationEffect('DISMISS')).toMatch(/nada muda/i);
    expect(profileModerationEffect('HIDE')).toMatch(/deixa de aparecer/i);
    /** O ponto que o modelo documenta: o handle e a conta continuam existindo. */
    expect(profileModerationEffect('HIDE')).toMatch(/continua/i);
  });

  it('reconhece só as ações conhecidas', () => {
    expect(isProfileModerationAction('HIDE')).toBe(true);
    expect(isProfileModerationAction('DISMISS')).toBe(true);
    expect(isProfileModerationAction('DELETE')).toBe(false);
    expect(isProfileModerationAction(undefined)).toBe(false);
  });
});

describe('nota da decisão', () => {
  it('é obrigatória nos dois desfechos', () => {
    expect(decisionNoteProblem('')).toBe('REQUIRED');
    expect(decisionNoteProblem('   ')).toBe('REQUIRED');
    expect(decisionNoteProblem(null)).toBe('REQUIRED');
    expect(decisionNoteProblem(undefined)).toBe('REQUIRED');
  });

  it('tem piso e teto próprios, menores que os do relato no motivo', () => {
    expect(DECISION_NOTE_MIN_LENGTH).toBe(10);
    expect(DECISION_NOTE_MAX_LENGTH).toBe(1000);

    expect(decisionNoteProblem('ok')).toBe('TOO_SHORT');
    expect(decisionNoteProblem('123456789')).toBe('TOO_SHORT');
    expect(decisionNoteProblem('1234567890')).toBeNull();
    expect(decisionNoteProblem('a'.repeat(DECISION_NOTE_MAX_LENGTH))).toBeNull();
    expect(decisionNoteProblem('a'.repeat(DECISION_NOTE_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('a frase de cada recusa diz o que falta', () => {
    expect(decisionNoteProblemMessage('REQUIRED')).toMatch(/justificativa/i);
    expect(decisionNoteProblemMessage('TOO_SHORT')).toContain(String(DECISION_NOTE_MIN_LENGTH));
    expect(decisionNoteProblemMessage('TOO_LONG')).toContain(String(DECISION_NOTE_MAX_LENGTH));
  });

  it('a razão gravada no perfil é MENOR que a nota, e tem texto de reserva', () => {
    /**
     * A coluna do perfil é `VarChar(500)` e a da decisão é `VarChar(1000)`: a razão é
     * um recorte, e sem ele uma justificativa longa faria o `UPDATE` do usuário
     * falhar — a decisão se perderia pelo tamanho do texto, não pelo mérito.
     */
    expect(HIDDEN_REASON_MAX_LENGTH).toBe(500);
    expect(HIDDEN_REASON_MAX_LENGTH).toBeLessThan(DECISION_NOTE_MAX_LENGTH);
    expect(HIDDEN_REASON_FALLBACK).toBe('decisão da moderação');
  });
});

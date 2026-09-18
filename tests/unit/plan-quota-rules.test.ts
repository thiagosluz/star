/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — quotas, planos e natureza do vínculo (FASE 14)
 *
 *  O que só o domínio pode provar, sem banco:
 *    • a QUOTA DE MEMBROS conta equipe e ignora participante (o critério que tornou
 *      a quota aplicável depois que a inscrição pública passou a criar vínculo);
 *    • `null` (ilimitado) e `0` (nenhum) são coisas diferentes em toda a API;
 *    • o tipo do vínculo não é rebaixado por uma inscrição pública;
 *    • a troca de plano distingue "usar o padrão do plano" de "editar a quota".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  MIN_PLAN_MEMBERS,
  PLAN_DEFINITIONS,
  evaluateQuotaUsage,
  evaluateMemberQuota,
  planQuotas,
  quotaUsageLabel,
  quotaWarnings,
  validatePlanChange,
  validateProvisioning,
} from '../../src/domain/platform/platform-rules';
import {
  classifyMembershipKind,
  countsTowardMemberQuota,
  isMemberKind,
  kindAfterPublicRegistration,
} from '../../src/domain/tenancy/membership-rules';

describe('natureza do vínculo — equipe × participante', () => {
  it('vínculo sem papel vigente é MEMBRO (convite cujo papel ainda não saiu)', () => {
    expect(classifyMembershipKind([])).toBe('MEMBER');
  });

  it('vínculo cujo único papel é PARTICIPANT veio da inscrição pública', () => {
    expect(classifyMembershipKind(['PARTICIPANT'])).toBe('PARTICIPANT');
  });

  it('qualquer outro papel faz do vínculo equipe', () => {
    expect(classifyMembershipKind(['PARTICIPANT', 'ADMIN'])).toBe('MEMBER');
    expect(classifyMembershipKind(['STAFF'])).toBe('MEMBER');
    expect(classifyMembershipKind(['SPONSOR'])).toBe('MEMBER');
    expect(classifyMembershipKind(['REVIEWER', 'PARTICIPANT'])).toBe('MEMBER');
  });

  it('só MEMBRO consome a quota do plano', () => {
    expect(countsTowardMemberQuota('MEMBER')).toBe(true);
    expect(countsTowardMemberQuota('PARTICIPANT')).toBe(false);
    expect(isMemberKind('MEMBER')).toBe(true);
    expect(isMemberKind('PARTICIPANT')).toBe(false);
  });

  it('a inscrição pública cria PARTICIPANT e NUNCA rebaixa quem é da equipe', () => {
    expect(kindAfterPublicRegistration(null)).toBe('PARTICIPANT');
    expect(kindAfterPublicRegistration('PARTICIPANT')).toBe('PARTICIPANT');
    // O caso que importa: membro que se inscreve num evento aberto continua membro.
    expect(kindAfterPublicRegistration('MEMBER')).toBe('MEMBER');
  });
});

describe('quota de membros', () => {
  it('plano sem limite não decide nada', () => {
    expect(evaluateMemberQuota({ currentCount: 9_999, maxMembers: null })).toEqual({
      allowed: true,
      message: null,
      remaining: null,
    });
  });

  it('informa quantas vagas restam', () => {
    expect(evaluateMemberQuota({ currentCount: 3, maxMembers: 10 })).toMatchObject({
      allowed: true,
      remaining: 7,
    });
  });

  it('recusa no limite e acima dele, com caminho de saída na mensagem', () => {
    const atLimit = evaluateMemberQuota({ currentCount: 2, maxMembers: 2 });
    const exceeded = evaluateMemberQuota({ currentCount: 5, maxMembers: 2 });

    expect(atLimit.allowed).toBe(false);
    expect(atLimit.remaining).toBe(0);
    expect(exceeded.allowed).toBe(false);
    expect(exceeded.message).toContain('2 membro(s)');
    expect(exceeded.message).toContain('plataforma');
  });
});

describe('quotas do plano', () => {
  it('devolve as três quotas, e a de armazenamento não fica de fora', () => {
    expect(planQuotas('FREE')).toEqual({
      maxEvents: PLAN_DEFINITIONS.FREE.maxEvents,
      maxMembers: PLAN_DEFINITIONS.FREE.maxMembers,
      maxStorageBytes: PLAN_DEFINITIONS.FREE.maxStorageBytes,
    });
  });

  it('ENTERPRISE é ilimitado em eventos e membros (`null`, não zero)', () => {
    const quotas = planQuotas('ENTERPRISE');

    expect(quotas.maxEvents).toBeNull();
    expect(quotas.maxMembers).toBeNull();
    expect(quotas.maxStorageBytes).toBeNull();
  });

  it('todo plano declara as três quotas', () => {
    for (const plan of ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const) {
      const quotas = planQuotas(plan);
      expect(Object.keys(quotas).sort()).toEqual(['maxEvents', 'maxMembers', 'maxStorageBytes']);
    }
  });
});

describe('uso da quota (o que a tela mostra)', () => {
  it('classifica os quatro estados', () => {
    expect(evaluateQuotaUsage(3, null).state).toBe('UNLIMITED');
    expect(evaluateQuotaUsage(3, 10).state).toBe('OK');
    expect(evaluateQuotaUsage(10, 10).state).toBe('AT_LIMIT');
    expect(evaluateQuotaUsage(11, 10).state).toBe('EXCEEDED');
  });

  it('descreve o uso em texto curto', () => {
    expect(quotaUsageLabel(evaluateQuotaUsage(3, null))).toBe('3 (ilimitado)');
    expect(quotaUsageLabel(evaluateQuotaUsage(3, 10))).toBe('3 de 10');
    expect(quotaUsageLabel(evaluateQuotaUsage(10, 10))).toContain('no limite');
    expect(quotaUsageLabel(evaluateQuotaUsage(11, 10))).toContain('acima da quota');
  });
});

describe('validação da troca de plano', () => {
  it('recusa plano desconhecido', () => {
    const result = validatePlanChange({ plan: 'PLATINUM' as never });

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
  });

  it('com `useDefaults` aplica exatamente as quotas do plano', () => {
    const result = validatePlanChange({
      plan: 'PROFESSIONAL',
      maxEvents: 7,
      maxMembers: 7,
      useDefaults: true,
    });

    expect(result.normalized).toEqual({
      plan: 'PROFESSIONAL',
      maxEvents: PLAN_DEFINITIONS.PROFESSIONAL.maxEvents,
      maxMembers: PLAN_DEFINITIONS.PROFESSIONAL.maxMembers,
      maxStorageBytes: PLAN_DEFINITIONS.PROFESSIONAL.maxStorageBytes,
    });
  });

  it('sem `useDefaults` respeita o acordo específico', () => {
    const result = validatePlanChange({ plan: 'STARTER', maxEvents: 200, maxMembers: 42 });

    expect(result.normalized).toMatchObject({ maxEvents: 200, maxMembers: 42 });
  });

  it('quota informada como nula significa ILIMITADO, não zero', () => {
    const result = validatePlanChange({ plan: 'FREE', maxEvents: null, maxMembers: null });

    expect(result.normalized?.maxEvents).toBeNull();
    expect(result.normalized?.maxMembers).toBeNull();
  });

  it('exige pelo menos um membro — o proprietário ocupa uma vaga', () => {
    const zero = validatePlanChange({ plan: 'FREE', maxMembers: 0 });

    expect(zero.valid).toBe(false);
    expect(zero.errors.join(' ')).toContain(String(MIN_PLAN_MEMBERS));

    // Zero EVENTO continua válido: instituição que ainda não vai publicar nada.
    expect(validatePlanChange({ plan: 'FREE', maxEvents: 0 }).valid).toBe(true);
  });

  it('recusa quota fracionária', () => {
    expect(validatePlanChange({ plan: 'FREE', maxMembers: 2.5 }).valid).toBe(false);
    expect(validatePlanChange({ plan: 'FREE', maxEvents: -1 }).valid).toBe(false);
  });

  it('o provisionamento também recusa plano sem vaga para o proprietário', () => {
    const result = validateProvisioning({
      name: 'Instituição Teste',
      slug: 'instituicao-teste',
      plan: 'FREE',
      ownerEmail: 'dono@exemplo.test',
      maxMembers: 0,
    });

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
  });
});

describe('avisos de redução de quota', () => {
  it('avisa quando a nova quota fica abaixo do uso', () => {
    const warnings = quotaWarnings({
      eventCount: 12,
      memberCount: 40,
      quotas: { maxEvents: 10, maxMembers: 5 },
    });

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('12 evento(s)');
    expect(warnings[1]).toContain('40 membro(s)');
  });

  it('não avisa nada quando a quota comporta o uso', () => {
    expect(
      quotaWarnings({ eventCount: 2, memberCount: 3, quotas: { maxEvents: 10, maxMembers: 100 } }),
    ).toEqual([]);
  });

  it('quota ilimitada nunca gera aviso', () => {
    expect(
      quotaWarnings({ eventCount: 999, memberCount: 999, quotas: { maxEvents: null, maxMembers: null } }),
    ).toEqual([]);
  });
});

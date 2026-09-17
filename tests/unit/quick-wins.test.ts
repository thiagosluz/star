/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes UNITÁRIOS — itens rápidos da FASE 12
 *
 *  Cobre as três decisões de domínio do mutirão:
 *    • quota de eventos do plano (C2);
 *    • evento restrito à comunidade (I3);
 *    • mensagens do barramento de invalidação de cache (I1).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { evaluateEventQuota } from '../../src/domain/platform/platform-rules';
import {
  isOpenToPublicEvent,
  readEventRegistrationPolicy,
  restrictedEventNotice,
} from '../../src/domain/events/public-registration-rules';
import { decodeInvalidation, encodeInvalidation } from '../../src/lib/tenancy/cache-bus';

describe('evaluateEventQuota — quota de eventos do plano (C2)', () => {
  it('permite enquanto há espaço e informa quanto falta', () => {
    const decision = evaluateEventQuota({ currentCount: 1, maxEvents: 3 });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(2);
  });

  it('recusa quando a quota foi atingida, com mensagem acionável', () => {
    const decision = evaluateEventQuota({ currentCount: 3, maxEvents: 3 });

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.message).toMatch(/3 evento/i);
    expect(decision.message).toMatch(/plataforma/i);
  });

  it('recusa quando a quota já foi estourada (dado legado, sem migração)', () => {
    // Uma instituição que criou eventos antes desta fase pode estar acima do teto.
    const decision = evaluateEventQuota({ currentCount: 7, maxEvents: 3 });

    expect(decision.allowed).toBe(false);
  });

  it('`null` é ILIMITADO — e `0` é NENHUM evento', () => {
    expect(evaluateEventQuota({ currentCount: 999, maxEvents: null })).toMatchObject({
      allowed: true,
      remaining: null,
    });

    const none = evaluateEventQuota({ currentCount: 0, maxEvents: 0 });
    expect(none.allowed).toBe(false);
  });
});

describe('readEventRegistrationPolicy — evento restrito à comunidade (I3)', () => {
  it('chave ausente significa evento ABERTO (o padrão desde a FASE 10)', () => {
    expect(readEventRegistrationPolicy({})).toEqual({ requiresMembership: false });
    expect(readEventRegistrationPolicy(undefined)).toEqual({ requiresMembership: false });
    expect(readEventRegistrationPolicy(null)).toEqual({ requiresMembership: false });
  });

  it('só o booleano `true` restringe', () => {
    expect(
      readEventRegistrationPolicy({ registrationRequiresMembership: true }).requiresMembership,
    ).toBe(true);

    for (const value of [false, 'true', 1, 'sim', {}]) {
      expect(
        readEventRegistrationPolicy({ registrationRequiresMembership: value }).requiresMembership,
      ).toBe(false);
    }
  });

  it('settings inválido não derruba a página: cai no padrão aberto', () => {
    for (const value of ['texto', 42, [], true]) {
      expect(readEventRegistrationPolicy(value).requiresMembership).toBe(false);
    }
  });

  it('preserva outras chaves de settings (só lê a sua)', () => {
    const settings = { outroRecurso: 'valor', registrationRequiresMembership: true };

    expect(readEventRegistrationPolicy(settings).requiresMembership).toBe(true);
    expect(settings.outroRecurso).toBe('valor');
  });
});

describe('isOpenToPublicEvent — quem pode se inscrever sem vínculo (I3)', () => {
  it('evento publicado e sem restrição é aberto', () => {
    expect(isOpenToPublicEvent({ eventStatus: 'REGISTRATION_OPEN', settings: {} })).toBe(true);
  });

  it('evento restrito à comunidade NÃO é aberto, mesmo publicado', () => {
    expect(
      isOpenToPublicEvent({
        eventStatus: 'REGISTRATION_OPEN',
        settings: { registrationRequiresMembership: true },
      }),
    ).toBe(false);
  });

  it('evento em rascunho não é aberto nem sem restrição', () => {
    expect(isOpenToPublicEvent({ eventStatus: 'DRAFT', settings: {} })).toBe(false);
  });

  it('a mensagem do evento restrito nomeia a instituição', () => {
    expect(restrictedEventNotice('Universidade Federal da Bahia')).toContain(
      'Universidade Federal da Bahia',
    );
  });
});

describe('cache-bus — mensagens do barramento (I1)', () => {
  it('normaliza o identificador (caixa e espaços)', () => {
    expect(encodeInvalidation('  UFBA-Demo  ')).toBe('ufba-demo');
  });

  it('mensagem vazia significa "invalide tudo"', () => {
    expect(decodeInvalidation('')).toEqual({ identifier: null });
    expect(decodeInvalidation('   ')).toEqual({ identifier: null });
  });

  it('lê um slug válido e descarta lixo', () => {
    expect(decodeInvalidation('ufba-demo')).toEqual({ identifier: 'ufba-demo' });
    expect(decodeInvalidation('a'.repeat(200))).toBeNull();
  });
});

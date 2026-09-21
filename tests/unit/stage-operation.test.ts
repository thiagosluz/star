/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — Operação de palco do sorteio (FASE 22)
 *
 *  Domínio puro: sem banco, sem servidor. O foco é o que quebra a operação no dia do
 *  evento: desfazer entrega sem motivo, filtro de data interpretado no fuso errado,
 *  premiar mais gente do que o ranking tem e chaveiro de semente mal declarado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DELIVERY_REVERSAL_REASON_MAX,
  DELIVERY_REVERSAL_REASON_MIN,
  MAX_REVIEWER_AWARDS,
  describeRaffleHistoryFilter,
  evaluateDeliveryReversal,
  isRaffleResultPublished,
  parseRaffleHistoryFilter,
  raffleFilterIsActive,
  rafflePublicationState,
  resolveReviewerAwardCount,
} from '../../src/domain/raffles/stage-rules';
import {
  LEGACY_SEED_KEY_VERSION,
  parseSeedKeyRing,
  seedKeyVersionLabel,
} from '../../src/domain/raffles/seed-key-rules';

// ═══════════════════════════════════════════════════════════════════════════════
describe('G8 — desfazer a entrega do prêmio', () => {
  it('posição SEM entrega não tem o que desfazer', () => {
    const decision = evaluateDeliveryReversal({ deliveredAt: null, reason: 'marquei errado' });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('NOT_DELIVERED');
  });

  it('motivo vazio é recusado — a reversão não pode apagar um fato em silêncio', () => {
    const decision = evaluateDeliveryReversal({ deliveredAt: new Date(), reason: '   ' });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe('REASON_REQUIRED');
      expect(decision.message).toContain(String(DELIVERY_REVERSAL_REASON_MIN));
    }
  });

  it('motivo curto demais é recusado', () => {
    const decision = evaluateDeliveryReversal({ deliveredAt: new Date(), reason: 'ops' });
    expect(decision.allowed).toBe(false);
  });

  it('motivo válido é aceito e volta sem espaços nas pontas', () => {
    const decision = evaluateDeliveryReversal({
      deliveredAt: new Date(),
      reason: '  entreguei para a pessoa errada  ',
    });

    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.reason).toBe('entreguei para a pessoa errada');
  });

  it('motivo gigante é truncado no teto da coluna', () => {
    const decision = evaluateDeliveryReversal({
      deliveredAt: new Date(),
      reason: 'x'.repeat(500),
    });

    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.reason).toHaveLength(DELIVERY_REVERSAL_REASON_MAX);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G9 — filtro do histórico', () => {
  const timeZone = 'America/Bahia';

  it('sem filtro nenhum, o período fica nulo e o filtro não está ativo', () => {
    const result = parseRaffleHistoryFilter({ status: 'ALL', from: '', to: '', timeZone });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter.status).toBeNull();
      expect(result.filter.from).toBeNull();
      expect(result.filter.to).toBeNull();
      expect(raffleFilterIsActive(result.filter)).toBe(false);
    }
  });

  it('o DIA é o da instituição, não o do servidor (armadilha 38)', () => {
    const result = parseRaffleHistoryFilter({
      status: 'DRAWN',
      from: '2026-10-18',
      to: '2026-10-18',
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Meia-noite em Salvador (UTC−3) é 03:00Z…
      expect(result.filter.from?.toISOString()).toBe('2026-10-18T03:00:00.000Z');
      // …e o fim do dia é 02:59:59.999Z do dia seguinte, ainda dentro do dia local.
      expect(result.filter.to?.toISOString()).toBe('2026-10-19T02:59:59.000Z');
    }
  });

  it('situação inválida é recusada com nome próprio', () => {
    const result = parseRaffleHistoryFilter({ status: 'APURADO', timeZone });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_STATUS');
  });

  it('data fora do formato é recusada', () => {
    const result = parseRaffleHistoryFilter({ from: '18/10/2026', timeZone });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_DATE');
  });

  it('período invertido é recusado em vez de devolver lista vazia', () => {
    const result = parseRaffleHistoryFilter({ from: '2026-10-20', to: '2026-10-18', timeZone });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_RANGE');
  });

  it('o rótulo diz o que está sendo mostrado', () => {
    const result = parseRaffleHistoryFilter({
      status: 'CANCELED',
      from: '2026-10-01',
      to: '2026-10-05',
      timeZone,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const label = describeRaffleHistoryFilter(result.filter);
      expect(label).toContain('Cancelado');
      expect(label).toContain('01/10/2026');
      expect(label).toContain('05/10/2026');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G10 — quantos revisores premiar', () => {
  it('zero ou negativo é recusado', () => {
    expect(resolveReviewerAwardCount({ requested: 0, rankedCount: 5 }).ok).toBe(false);
    expect(resolveReviewerAwardCount({ requested: -3, rankedCount: 5 }).ok).toBe(false);
  });

  it('ranking vazio é recusado com o critério explicado', () => {
    const decision = resolveReviewerAwardCount({ requested: 3, rankedCount: 0 });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('NO_RANKING');
  });

  it('pedir mais do que existe premia quem existe e AVISA que cortou', () => {
    const decision = resolveReviewerAwardCount({ requested: 5, rankedCount: 3 });

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.top).toBe(3);
      expect(decision.capped).toBe(true);
    }
  });

  it('o teto do domínio limita o pedido', () => {
    const decision = resolveReviewerAwardCount({ requested: 999, rankedCount: 999 });

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.top).toBe(MAX_REVIEWER_AWARDS);
      expect(decision.capped).toBe(true);
    }
  });

  it('pedido dentro do ranking não é marcado como cortado', () => {
    const decision = resolveReviewerAwardCount({ requested: 2, rankedCount: 4 });

    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.capped).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G11 — o que o público pode ver', () => {
  it('publicado E apurado é o único estado que aparece', () => {
    expect(isRaffleResultPublished({ isPublic: true, status: 'DRAWN' })).toBe(true);
    expect(isRaffleResultPublished({ isPublic: true, status: 'DRAFT' })).toBe(false);
    expect(isRaffleResultPublished({ isPublic: false, status: 'DRAWN' })).toBe(false);
    expect(isRaffleResultPublished({ isPublic: true, status: 'CANCELED' })).toBe(false);
  });

  it('o estado distingue "não publicado" de "publicado mas não apurado"', () => {
    expect(rafflePublicationState({ isPublic: false, status: 'DRAFT' })).toBe('NOT_PUBLISHED');
    expect(rafflePublicationState({ isPublic: true, status: 'DRAFT' })).toBe('NOT_DRAWN');
    expect(rafflePublicationState({ isPublic: true, status: 'CANCELED' })).toBe('CANCELED');
    expect(rafflePublicationState({ isPublic: true, status: 'DRAWN' })).toBe('PUBLISHED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G12 — chaveiro do cofre de sementes', () => {
  it('vazio significa "só a chave legada"', () => {
    const ring = parseSeedKeyRing('');

    expect(ring.current).toBeNull();
    expect(ring.keys.size).toBe(0);
    expect(ring.problems).toHaveLength(0);
  });

  it('a versão ATUAL é a maior declarada', () => {
    const ring = parseSeedKeyRing('1:segredo-antigo-com-16+,5:segredo-novo-com-16+');

    expect(ring.current).toBe(5);
    expect(ring.keys.get(1)).toBe('segredo-antigo-com-16+');
    expect(ring.problems).toHaveLength(0);
  });

  it('a versão 0 é reservada à chave legada', () => {
    const ring = parseSeedKeyRing('0:segredo-com-16-caracteres');

    expect(ring.keys.size).toBe(0);
    expect(ring.current).toBeNull();
    expect(ring.problems[0]).toContain('reservada');
  });

  it('versão não inteira é recusada com o motivo', () => {
    const ring = parseSeedKeyRing('um:segredo-com-16-caracteres');

    expect(ring.keys.size).toBe(0);
    expect(ring.problems[0]).toContain('versão');
  });

  it('segredo curto é recusado — chave de brinquedo não sela nada', () => {
    const ring = parseSeedKeyRing('1:curto');

    expect(ring.keys.size).toBe(0);
    expect(ring.problems[0]).toContain('16');
  });

  it('versão repetida vale a PRIMEIRA e o problema é declarado', () => {
    const ring = parseSeedKeyRing('2:primeiro-segredo-16+,2:segundo-segredo-16+');

    expect(ring.keys.get(2)).toBe('primeiro-segredo-16+');
    expect(ring.problems[0]).toContain('repetida');
  });

  it('o segredo pode conter ":" (a divisão é no primeiro)', () => {
    const ring = parseSeedKeyRing('3:parte1:parte2:parte3');

    expect(ring.keys.get(3)).toBe('parte1:parte2:parte3');
  });

  it('espaços e entradas vazias são tolerados', () => {
    const ring = parseSeedKeyRing(' 1:segredo-com-16-caracteres , , 2:outro-segredo-16+ ');

    expect(ring.keys.size).toBe(2);
    expect(ring.problems).toHaveLength(0);
  });

  it('o rótulo da versão distingue a legada', () => {
    expect(seedKeyVersionLabel(LEGACY_SEED_KEY_VERSION)).toContain('legada');
    expect(seedKeyVersionLabel(null)).toContain('legada');
    expect(seedKeyVersionLabel(4)).toBe('versão 4');
  });
});

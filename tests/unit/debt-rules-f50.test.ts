/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — regras do mutirão de dívidas (FASE 50)
 *
 *  Três regras puras que passaram a decidir comportamento de produto e não podem
 *  depender de banco para serem conferidas:
 *   • E59 — qual chave de crédito usar e como o estorno se identifica;
 *   • E59 — o que é uma inscrição VIVA (a mesma definição do índice parcial);
 *   • E53 — o que é uma rubrica PRÓPRIA (a mesma pergunta da precedência).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { registrationCreditKey, reversalKeyOf } from '../../src/lib/gamification/xp-reversal';
import { registrationIsLive } from '../../src/domain/events/registration-rules';
import { rubricIsCustom, resolveEffectiveRubric } from '../../src/domain/review/review-rules';

const BASE = 'registration:tenant:user:activity';

describe('E59 — a chave do crédito e a do estorno', () => {
  it('sem histórico, a chave é a BASE', () => {
    expect(registrationCreditKey({ base: BASE, existingKeys: [] })).toBe(BASE);
  });

  it('crédito vigente (sem estorno) repete a MESMA chave — não paga de novo', () => {
    expect(registrationCreditKey({ base: BASE, existingKeys: [BASE] })).toBe(BASE);
  });

  it('crédito já estornado abre GERAÇÃO NOVA (a vaga voltou a ser usada)', () => {
    const chave = registrationCreditKey({
      base: BASE,
      existingKeys: [BASE, reversalKeyOf(BASE)],
    });

    expect(chave).not.toBe(BASE);
    expect(chave).toContain(':retry:');
  });

  it('depois da segunda volta, a geração seguinte não colide com a primeira', () => {
    const primeira = registrationCreditKey({ base: BASE, existingKeys: [BASE, reversalKeyOf(BASE)] });

    const segunda = registrationCreditKey({
      base: BASE,
      existingKeys: [BASE, reversalKeyOf(BASE), primeira, reversalKeyOf(primeira)],
    });

    expect(segunda).not.toBe(primeira);
    expect(segunda).not.toBe(BASE);
  });

  it('o estorno é derivado do crédito que ele devolve', () => {
    expect(reversalKeyOf(BASE)).toBe(`${BASE}:reversal`);
    expect(reversalKeyOf(`${BASE}:retry:2`)).toBe(`${BASE}:retry:2:reversal`);
  });
});

describe('E59 — o que é uma inscrição VIVA', () => {
  it('as quatro situações do índice parcial são vivas', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED'] as const) {
      expect(registrationIsLive(status), status).toBe(true);
    }
  });

  it('cancelada e ausente são HISTÓRICO: não bloqueiam a volta', () => {
    expect(registrationIsLive('CANCELED')).toBe(false);
    expect(registrationIsLive('NO_SHOW')).toBe(false);
  });
});

describe('E53 — o que é uma rubrica PRÓPRIA', () => {
  const propria = [{ key: 'criterio_0', label: 'Clareza', weight: 1, maxScore: 10 }];

  it('lista vazia, nula ou inválida é PADRÃO (não é própria)', () => {
    expect(rubricIsCustom([])).toBe(false);
    expect(rubricIsCustom(null)).toBe(false);
    expect(rubricIsCustom(undefined)).toBe(false);
    expect(rubricIsCustom('texto')).toBe(false);
  });

  it('rubrica válida é própria — e é o que faz a chamada vencer a trilha', () => {
    expect(rubricIsCustom(propria)).toBe(true);

    const efetiva = resolveEffectiveRubric({ callRubric: propria, trackRubric: [] });

    expect(efetiva.source).toBe('CALL');
    expect(efetiva.rubric).toHaveLength(1);
  });

  it('a mesma pergunta decide a precedência e a contagem do congelamento', () => {
    /** Sem rubrica na chamada, quem manda é a trilha — e a trilha PODE congelar. */
    const daTrilha = resolveEffectiveRubric({ callRubric: [], trackRubric: propria });

    expect(rubricIsCustom([])).toBe(false);
    expect(daTrilha.source).toBe('TRACK');
  });
});

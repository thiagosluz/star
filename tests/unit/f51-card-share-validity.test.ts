/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — validade do link compartilhado (FASE 51 · dívida E70)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. o PADRÃO é não expirar — e "sem prazo" é a PRIMEIRA opção da tela;
 *   2. revogado e expirado são estados DISTINTOS, com rótulos distintos (a lista
 *      do dono precisa dizer qual dos dois aconteceu);
 *   3. a data escolhida vale até o FIM do dia no fuso da instituição — não até a
 *      meia-noite que começa o dia, e não no fuso do servidor;
 *   4. a contagem de aberturas é rotulada como leitura, não como pessoa.
 *
 *  Tudo aqui é função pura: nenhum banco, nenhum relógio de parede (o `now` entra
 *  por parâmetro).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHARE_VALIDITY,
  SHARE_VALIDITY_CHOICES,
  SHARE_VALIDITY_DAYS,
  SHARE_VALIDITY_IDS,
  SHARE_VALIDITY_LABELS,
  cardShareStatus,
  isCardShareOpen,
  isShareValidityId,
  shareExpiryFor,
  shareMomentLabel,
  shareValidityLabel,
  shareViewCountLabel,
} from '../../src/domain/gamification/card-share-rules';

/** Fuso das instituições do seed: as datas deste arquivo são lidas em UTC-3. */
const TZ = 'America/Bahia';

// ═══════════════════════════════════════════════════════════════════════════════
describe('opções de validade oferecidas na tela', () => {
  it('"sem prazo" é a PRIMEIRA opção — e o padrão', () => {
    expect(SHARE_VALIDITY_CHOICES[0]?.id).toBe('NEVER');
    expect(SHARE_VALIDITY_CHOICES[0]?.label).toBe('Sem prazo');
    expect(DEFAULT_SHARE_VALIDITY).toBe('NEVER');
    expect(SHARE_VALIDITY_DAYS.NEVER).toBeNull();
  });

  it('as opções de prazo são 7, 30 e 90 dias, mais a data escolhida', () => {
    expect(SHARE_VALIDITY_CHOICES.map((choice) => choice.id)).toEqual([
      'NEVER',
      'DAYS_7',
      'DAYS_30',
      'DAYS_90',
      'ON_DATE',
    ]);

    expect(SHARE_VALIDITY_DAYS.DAYS_7).toBe(7);
    expect(SHARE_VALIDITY_DAYS.DAYS_30).toBe(30);
    expect(SHARE_VALIDITY_DAYS.DAYS_90).toBe(90);
    expect(SHARE_VALIDITY_DAYS.ON_DATE).toBeNull();
  });

  it('toda opção tem rótulo, e as opções cobrem exatamente os ids aceitos', () => {
    for (const id of SHARE_VALIDITY_IDS) {
      expect(SHARE_VALIDITY_LABELS[id]?.length ?? 0).toBeGreaterThan(0);
      expect(isShareValidityId(id)).toBe(true);
    }

    expect(SHARE_VALIDITY_CHOICES).toHaveLength(SHARE_VALIDITY_IDS.length);
    expect(isShareValidityId('DAYS_15')).toBe(false);
    expect(isShareValidityId('')).toBe(false);
  });

  it('não existe escolha de "limite de aberturas" — o que se mede não se proíbe', () => {
    expect(SHARE_VALIDITY_IDS.some((id) => id.includes('VIEW') || id.includes('LIMIT'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('estado do link', () => {
  const NOW = new Date('2027-03-12T12:00:00Z');

  it('sem prazo e sem revogação é válido', () => {
    expect(cardShareStatus({ revokedAt: null, expiresAt: null, now: NOW })).toBe('VALID');
    expect(isCardShareOpen({ revokedAt: null, expiresAt: null, now: NOW })).toBe(true);
  });

  it('prazo no futuro continua válido; no passado está expirado', () => {
    expect(cardShareStatus({ revokedAt: null, expiresAt: new Date('2027-03-20T00:00:00Z'), now: NOW })).toBe(
      'VALID',
    );
    expect(cardShareStatus({ revokedAt: null, expiresAt: new Date('2027-03-01T00:00:00Z'), now: NOW })).toBe(
      'EXPIRED',
    );
    expect(isCardShareOpen({ revokedAt: null, expiresAt: new Date('2027-03-01T00:00:00Z'), now: NOW })).toBe(
      false,
    );
  });

  it('no INSTANTE do prazo o link já não abre (mesma régua da exportação com prazo)', () => {
    expect(cardShareStatus({ revokedAt: null, expiresAt: NOW, now: NOW })).toBe('EXPIRED');
  });

  it('revogado vence expirado: o ATO do dono não é apagado pelo relógio', () => {
    expect(
      cardShareStatus({
        revokedAt: new Date('2027-03-05T10:00:00Z'),
        expiresAt: new Date('2027-03-01T00:00:00Z'),
        now: NOW,
      }),
    ).toBe('REVOKED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('rótulo do estado', () => {
  it('diz qual dos dois fechou o link', () => {
    expect(shareValidityLabel({ status: 'REVOKED', expiresAt: null, timeZone: TZ })).toBe('revogado');
    expect(shareValidityLabel({ status: 'EXPIRED', expiresAt: null, timeZone: TZ })).toBe('expirado');
    expect(shareValidityLabel({ status: 'VALID', expiresAt: null, timeZone: TZ })).toBe('sem prazo');
  });

  it('com prazo, diz a DATA no fuso da instituição — não no do servidor', () => {
    /** 02:30 UTC do dia 12 ainda é dia 11 em Salvador (UTC-3). */
    const expiresAt = new Date('2027-03-12T02:30:00Z');

    expect(shareValidityLabel({ status: 'VALID', expiresAt, timeZone: TZ })).toBe('expira em 11/03/2027');
    expect(shareValidityLabel({ status: 'VALID', expiresAt, timeZone: 'UTC' })).toBe('expira em 12/03/2027');
  });

  it('o rótulo de um link expirado com prazo não mistura as duas histórias', () => {
    expect(
      shareValidityLabel({ status: 'EXPIRED', expiresAt: new Date('2027-03-01T00:00:00Z'), timeZone: TZ }),
    ).toBe('expirado');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cálculo do prazo a partir da escolha da tela', () => {
  const NOW = new Date('2027-03-12T12:00:00Z');

  it('"sem prazo" não gera validade nenhuma', () => {
    const result = shareExpiryFor({ validity: 'NEVER', now: NOW, timeZone: TZ });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiresAt).toBeNull();
  });

  it('7, 30 e 90 dias contam a partir de agora', () => {
    for (const [validity, days] of [
      ['DAYS_7', 7],
      ['DAYS_30', 30],
      ['DAYS_90', 90],
    ] as const) {
      const result = shareExpiryFor({ validity, now: NOW, timeZone: TZ });

      expect(result.ok, validity).toBe(true);
      if (!result.ok) continue;

      expect(result.expiresAt?.getTime()).toBe(NOW.getTime() + days * 86_400_000);
    }
  });

  it('a data escolhida vale até o FIM do dia, no fuso da instituição', () => {
    const result = shareExpiryFor({ validity: 'ON_DATE', day: '2027-03-20', now: NOW, timeZone: TZ });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /** 20/03/2027 às 23:59 em Salvador = 21/03/2027 às 02:59 UTC. */
    expect(result.expiresAt?.toISOString()).toBe('2027-03-21T02:59:00.000Z');
  });

  it('data sem forma de data é recusada, e o motivo é dito', () => {
    const result = shareExpiryFor({ validity: 'ON_DATE', day: '20/03/2027', now: NOW, timeZone: TZ });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_DAY');
    expect(result.message).toContain('data');
  });

  it('data já passada é recusada — o link não pode nascer expirado', () => {
    const result = shareExpiryFor({ validity: 'ON_DATE', day: '2027-03-01', now: NOW, timeZone: TZ });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DAY_IN_PAST');
  });

  it('prazo desconhecido é RECUSADO em vez de cair no "sem prazo"', () => {
    const result = shareExpiryFor({ validity: 'DAYS_3650', now: NOW, timeZone: TZ });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_CHOICE');
  });

  it('o dia de hoje ainda vale: o fim do dia é no futuro', () => {
    const result = shareExpiryFor({ validity: 'ON_DATE', day: '2027-03-12', now: NOW, timeZone: TZ });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiresAt && result.expiresAt.getTime() > NOW.getTime()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('contagem de aberturas', () => {
  it('sem abertura, a tela diz que ninguém abriu (não mostra zero solto)', () => {
    expect(shareViewCountLabel(0, TZ, null)).toBe('nenhuma abertura ainda');
  });

  it('conta LEITURA, não pessoa — e o rótulo diz quando foi a última', () => {
    const last = new Date('2027-03-12T17:32:00Z');

    expect(shareViewCountLabel(1, TZ, last)).toBe('1 abertura · última em 12/03/2027 às 14:32');
    expect(shareViewCountLabel(3, TZ, last)).toBe('3 aberturas · última em 12/03/2027 às 14:32');
    expect(shareViewCountLabel(3, TZ, null)).toBe('3 aberturas');
  });

  it('o instante da abertura aparece no fuso da instituição', () => {
    expect(shareMomentLabel(new Date('2027-03-12T17:32:00Z'), TZ)).toBe('12/03/2027 às 14:32');
    expect(shareMomentLabel(null, TZ)).toBeNull();
  });
});

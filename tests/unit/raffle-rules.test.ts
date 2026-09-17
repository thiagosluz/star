/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — motor de sorteios
 *
 *  Um sorteio é um ato público: os casos de borda aqui são os que decidem se o
 *  resultado é aceito por quem perdeu. Cobre escopo, piso de minutos, fuso, data
 *  de referência, exclusão de ganhadores anteriores, amostragem sem reposição e
 *  integridade do hash.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_WINNERS,
  RAFFLE_SCOPES,
  buildResultPayload,
  dayKey,
  evaluateEligibility,
  evaluateReadiness,
  hashResult,
  isPresenceValid,
  matchesScope,
  referenceDayKey,
  selectWinners,
  validateRaffleConfig,
  verifyResult,
  type AttendanceSample,
  type EligibleParticipant,
  type RaffleConfig,
  type RaffleResultPayload,
} from '../../src/domain/raffles/raffle-rules';

const TZ = 'America/Bahia'; // UTC−3

// ───────────────────────────────────────────────────────────────────────────────
function attendance(overrides: Partial<AttendanceSample> = {}): AttendanceSample {
  return {
    attendanceId: `att-${Math.random().toString(36).slice(2, 8)}`,
    userId: 'user-1',
    userName: 'Participante Um',
    activityId: 'atividade-1',
    activityTitle: 'Minicurso',
    activityStartsAt: new Date('2026-09-17T13:00:00.000Z'),
    checkedInAt: new Date('2026-09-17T13:00:00.000Z'),
    minutesAttended: 120,
    status: 'PRESENT',
    ...overrides,
  };
}

function config(overrides: Partial<RaffleConfig> = {}): RaffleConfig {
  return {
    scope: 'EVENT',
    referenceDate: null,
    activityId: null,
    minAttendanceMinutes: 0,
    winnersCount: 1,
    allowPriorEventWinners: false,
    ...overrides,
  };
}

/** Fila determinística para o sorteio. */
function sequence(values: readonly number[]): (max: number) => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 0;
    index += 1;
    return Math.max(0, value);
  };
}

function participant(userId: string, minutes = 100): EligibleParticipant {
  return {
    userId,
    userName: userId,
    minutes,
    attendanceIds: [`att-${userId}`],
    referenceAttendanceId: `att-${userId}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateRaffleConfig()', () => {
  it('aceita configuração completa', () => {
    const result = validateRaffleConfig({
      scope: 'ACTIVITY',
      activityId: 'atividade-1',
      minAttendanceMinutes: 60,
      winnersCount: 3,
      title: 'Sorteio de brindes',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('exige data no escopo DAY e atividade no escopo ACTIVITY', () => {
    const day = validateRaffleConfig({ scope: 'DAY', winnersCount: 1 });
    expect(day.valid).toBe(false);
    expect(day.errors.join(' ')).toMatch(/data de referência/i);

    const activity = validateRaffleConfig({ scope: 'ACTIVITY', winnersCount: 1 });
    expect(activity.valid).toBe(false);
    expect(activity.errors.join(' ')).toMatch(/atividade alvo/i);
  });

  it('recusa escopo desconhecido', () => {
    const result = validateRaffleConfig({ scope: 'GALAXY', winnersCount: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/escopo inválido/i);
  });

  it('recusa número de vencedores inválido ou absurdo', () => {
    expect(validateRaffleConfig({ scope: 'EVENT', winnersCount: 0 }).valid).toBe(false);
    expect(validateRaffleConfig({ scope: 'EVENT', winnersCount: -3 }).valid).toBe(false);
    expect(validateRaffleConfig({ scope: 'EVENT', winnersCount: 1.5 }).valid).toBe(false);
    expect(validateRaffleConfig({ scope: 'EVENT', winnersCount: MAX_WINNERS + 1 }).valid).toBe(false);
  });

  it('recusa piso de minutos negativo ou acima de 24h', () => {
    expect(
      validateRaffleConfig({ scope: 'EVENT', winnersCount: 1, minAttendanceMinutes: -10 }).valid,
    ).toBe(false);
    expect(
      validateRaffleConfig({ scope: 'EVENT', winnersCount: 1, minAttendanceMinutes: 1441 }).valid,
    ).toBe(false);
  });

  it('devolve TODOS os erros, e não apenas o primeiro', () => {
    const result = validateRaffleConfig({ scope: 'DAY', winnersCount: 0, minAttendanceMinutes: -1 });
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('lista os três escopos', () => {
    expect(RAFFLE_SCOPES).toEqual(['EVENT', 'DAY', 'ACTIVITY']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('presença e escopo', () => {
  it('ABSENT não comprova presença', () => {
    expect(isPresenceValid('PRESENT')).toBe(true);
    expect(isPresenceValid('PARTIAL')).toBe(true);
    expect(isPresenceValid('ABSENT')).toBe(false);
  });

  it('escopo EVENT aceita qualquer presença válida', () => {
    const verdict = matchesScope(attendance(), config({ scope: 'EVENT' }), TZ);
    expect(verdict.matches).toBe(true);
  });

  it('escopo ACTIVITY recusa presença em outra atividade', () => {
    const match = matchesScope(
      attendance({ activityId: 'atividade-1' }),
      config({ scope: 'ACTIVITY', activityId: 'atividade-1' }),
      TZ,
    );
    expect(match.matches).toBe(true);

    const other = matchesScope(
      attendance({ activityId: 'atividade-2' }),
      config({ scope: 'ACTIVITY', activityId: 'atividade-1' }),
      TZ,
    );
    expect(other.matches).toBe(false);
    expect(other.reason).toMatch(/outra atividade/i);
  });

  it('escopo DAY usa o dia LOCAL da atividade, e não o dia UTC', () => {
    /**
     * 2026-09-18T01:30Z é 2026-09-17T22:30 em Salvador. A atividade é do dia 17 —
     * e o sorteio "do dia 17" precisa incluir quem estava lá à noite.
     */
    const nightActivity = attendance({
      activityStartsAt: new Date('2026-09-18T01:30:00.000Z'),
      checkedInAt: new Date('2026-09-18T01:30:00.000Z'),
    });

    const sameDay = matchesScope(
      nightActivity,
      config({ scope: 'DAY', referenceDate: new Date('2026-09-17T12:00:00.000Z') }),
      TZ,
    );

    expect(sameDay.matches).toBe(true);

    const nextDay = matchesScope(
      nightActivity,
      config({ scope: 'DAY', referenceDate: new Date('2026-09-18T12:00:00.000Z') }),
      TZ,
    );

    expect(nextDay.matches).toBe(false);
    expect(nextDay.reason).toMatch(/2026-09-17/);
  });

  it('sem atividade vinculada, o dia vem do credenciamento', () => {
    const eventLevel = attendance({
      activityId: null,
      activityStartsAt: null,
      checkedInAt: new Date('2026-09-17T20:00:00.000Z'),
    });

    const verdict = matchesScope(
      eventLevel,
      config({ scope: 'DAY', referenceDate: new Date('2026-09-17T12:00:00.000Z') }),
      TZ,
    );

    expect(verdict.matches).toBe(true);
  });

  it('escopo DAY sem data não casa com nada (fail-closed)', () => {
    const verdict = matchesScope(attendance(), config({ scope: 'DAY', referenceDate: null }), TZ);
    expect(verdict.matches).toBe(false);
  });

  it('as chaves de dia são estáveis e usam o fuso pedido', () => {
    const instant = new Date('2026-09-18T01:30:00.000Z');

    expect(dayKey(instant, 'UTC')).toBe('2026-09-18');
    expect(dayKey(instant, TZ)).toBe('2026-09-17');
    expect(referenceDayKey(new Date('2026-09-17T12:00:00.000Z'), TZ)).toBe('2026-09-17');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateEligibility()', () => {
  it('soma os minutos do participante e mantém a evidência', () => {
    const result = evaluateEligibility({
      attendances: [
        attendance({ userId: 'u1', userName: 'Ana', attendanceId: 'a1', minutesAttended: 60 }),
        attendance({ userId: 'u1', userName: 'Ana', attendanceId: 'a2', minutesAttended: 90 }),
        attendance({ userId: 'u2', userName: 'Bruno', attendanceId: 'b1', minutesAttended: 30 }),
      ],
      config: config(),
      timeZone: TZ,
    });

    expect(result.eligible).toHaveLength(2);
    expect(result.inspectedAttendances).toBe(3);

    const ana = result.eligible.find((entry) => entry.userId === 'u1');
    expect(ana?.minutes).toBe(150);
    expect(ana?.attendanceIds).toEqual(['a1', 'a2']);
    // A presença de referência é a mais longa (evidência mais forte).
    expect(ana?.referenceAttendanceId).toBe('a2');
  });

  it('NÃO inclui quem não compareceu (sem registro em attendances)', () => {
    const result = evaluateEligibility({
      attendances: [attendance({ userId: 'u1' })],
      config: config(),
      timeZone: TZ,
    });

    expect(result.eligible.map((entry) => entry.userId)).toEqual(['u1']);
  });

  it('piso de minutos ZERO aceita quem compareceu sem check-out (0 minuto medido)', () => {
    /**
     * Sem saída registrada, `minutesAttended` é 0 — mas a pessoa COMPARECEU.
     * Excluí-la puniria o participante por uma falha de operação do credenciamento.
     */
    const result = evaluateEligibility({
      attendances: [attendance({ userId: 'u1', minutesAttended: 0 })],
      config: config({ minAttendanceMinutes: 0 }),
      timeZone: TZ,
    });

    expect(result.eligible).toHaveLength(1);
  });

  it('piso de minutos positivo exclui quem não atingiu, com o motivo', () => {
    const result = evaluateEligibility({
      attendances: [
        attendance({ userId: 'u1', userName: 'Ana', minutesAttended: 45 }),
        attendance({ userId: 'u2', userName: 'Bruno', minutesAttended: 90 }),
      ],
      config: config({ minAttendanceMinutes: 60 }),
      timeZone: TZ,
    });

    expect(result.eligible.map((entry) => entry.userId)).toEqual(['u2']);

    const rejected = result.rejected.find((entry) => entry.userId === 'u1');
    expect(rejected?.reason).toMatch(/45 min/);
    expect(rejected?.reason).toMatch(/60 min/);
  });

  it('presença marcada como ausente é descartada', () => {
    const result = evaluateEligibility({
      attendances: [attendance({ userId: 'u1', status: 'ABSENT' })],
      config: config(),
      timeZone: TZ,
    });

    expect(result.eligible).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/ausente/i);
  });

  it('escopo ACTIVITY considera apenas a atividade alvo', () => {
    const result = evaluateEligibility({
      attendances: [
        attendance({ userId: 'u1', activityId: 'alvo', minutesAttended: 90 }),
        attendance({ userId: 'u2', activityId: 'outra', minutesAttended: 300 }),
      ],
      config: config({ scope: 'ACTIVITY', activityId: 'alvo', minAttendanceMinutes: 60 }),
      timeZone: TZ,
    });

    expect(result.eligible.map((entry) => entry.userId)).toEqual(['u1']);
    expect(result.rejected.find((entry) => entry.userId === 'u2')?.reason).toMatch(/outra atividade/i);
  });

  it('escopo DAY filtra pelo dia de referência', () => {
    const result = evaluateEligibility({
      attendances: [
        attendance({
          userId: 'u1',
          userName: 'Ana',
          activityStartsAt: new Date('2026-09-17T13:00:00.000Z'),
          checkedInAt: new Date('2026-09-17T13:00:00.000Z'),
        }),
        attendance({
          userId: 'u2',
          userName: 'Bruno',
          activityStartsAt: new Date('2026-09-18T13:00:00.000Z'),
          checkedInAt: new Date('2026-09-18T13:00:00.000Z'),
        }),
      ],
      config: config({ scope: 'DAY', referenceDate: new Date('2026-09-17T12:00:00.000Z') }),
      timeZone: TZ,
    });

    expect(result.eligible.map((entry) => entry.userId)).toEqual(['u1']);
    expect(result.rejected.find((entry) => entry.userId === 'u2')?.reason).toMatch(/dia 2026-09-18/);
  });

  it('EXCLUI quem já ganhou sorteio anterior neste evento', () => {
    const result = evaluateEligibility({
      attendances: [
        attendance({ userId: 'u1', userName: 'Ana' }),
        attendance({ userId: 'u2', userName: 'Bruno' }),
      ],
      config: config({ allowPriorEventWinners: false }),
      timeZone: TZ,
      priorWinnerIds: ['u1'],
    });

    expect(result.eligible.map((entry) => entry.userId)).toEqual(['u2']);
    expect(result.rejected.find((entry) => entry.userId === 'u1')?.reason).toMatch(/já foi sorteado/i);
  });

  it('PERMITE ganhadores anteriores quando a flag está ligada', () => {
    const result = evaluateEligibility({
      attendances: [attendance({ userId: 'u1' })],
      config: config({ allowPriorEventWinners: true }),
      timeZone: TZ,
      priorWinnerIds: ['u1'],
    });

    expect(result.eligible.map((entry) => entry.userId)).toEqual(['u1']);
  });

  it('a ordem da explicação segue o recorte, não o piso de minutos', () => {
    /**
     * Bruno não estava no dia sorteado E tem poucos minutos. A explicação correta
     * é "estava em outro dia" — dizer "abaixo do piso" seria um fato verdadeiro
     * aplicado ao motivo errado.
     */
    const result = evaluateEligibility({
      attendances: [
        attendance({
          userId: 'u2',
          userName: 'Bruno',
          minutesAttended: 5,
          activityStartsAt: new Date('2026-09-20T13:00:00.000Z'),
        }),
      ],
      config: config({ scope: 'DAY', referenceDate: new Date('2026-09-17T12:00:00.000Z'), minAttendanceMinutes: 60 }),
      timeZone: TZ,
    });

    expect(result.rejected[0]?.reason).toMatch(/dia 2026-09-20/);
  });

  it('lista vazia devolve zero elegíveis sem quebrar', () => {
    const result = evaluateEligibility({ attendances: [], config: config(), timeZone: TZ });

    expect(result.eligible).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.inspectedAttendances).toBe(0);
  });

  it('um mesmo participante aparece UMA vez, com os minutos somados', () => {
    const result = evaluateEligibility({
      attendances: [
        attendance({ userId: 'u1', attendanceId: 'a1', minutesAttended: 30 }),
        attendance({ userId: 'u1', attendanceId: 'a2', minutesAttended: 30 }),
        attendance({ userId: 'u1', attendanceId: 'a3', minutesAttended: 30 }),
      ],
      config: config(),
      timeZone: TZ,
    });

    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0]?.minutes).toBe(90);
  });

  it('ordena os elegíveis por nome (listagem estável na tela)', () => {
    const result = evaluateEligibility({
      attendances: [
        attendance({ userId: 'u3', userName: 'Carla' }),
        attendance({ userId: 'u1', userName: 'Ana' }),
        attendance({ userId: 'u2', userName: 'Bruno' }),
      ],
      config: config(),
      timeZone: TZ,
    });

    expect(result.eligible.map((entry) => entry.userName)).toEqual(['Ana', 'Bruno', 'Carla']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('selectWinners()', () => {
  it('sorteia a quantidade pedida, SEM repetir', () => {
    const pool = [participant('u1'), participant('u2'), participant('u3'), participant('u4')];

    const winners = selectWinners(pool, 3, sequence([0, 1, 2]));

    expect(winners).toHaveLength(3);
    expect(new Set(winners.map((entry) => entry.userId)).size).toBe(3);
  });

  it('nunca devolve o mesmo participante duas vezes, com qualquer sequência', () => {
    const pool = [participant('u1'), participant('u2'), participant('u3')];

    // Todas as sequências possíveis de índices (inclusive as "impossíveis").
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 3; b += 1) {
        for (let c = 0; c < 3; c += 1) {
          const winners = selectWinners(pool, 3, sequence([a, b, c]));
          expect(new Set(winners.map((entry) => entry.userId)).size, `seq ${a}${b}${c}`).toBe(3);
        }
      }
    }
  });

  it('entrega o que existe quando o pedido excede os elegíveis (quórum menor)', () => {
    const winners = selectWinners([participant('u1'), participant('u2')], 5, sequence([0, 0]));

    expect(winners).toHaveLength(2);
  });

  it('devolve vazio com pedido zero ou pool vazio (quórum zero)', () => {
    expect(selectWinners([participant('u1')], 0, sequence([0]))).toHaveLength(0);
    expect(selectWinners([], 3, sequence([0]))).toHaveLength(0);
  });

  it('não modifica o pool original', () => {
    const pool = [participant('u1'), participant('u2'), participant('u3')];
    const before = pool.map((entry) => entry.userId);

    selectWinners(pool, 3, sequence([2, 2, 2]));

    expect(pool.map((entry) => entry.userId)).toEqual(before);
  });

  it('todos os elegíveis podem sair, dependendo da aleatoriedade', () => {
    const pool = [participant('u1'), participant('u2'), participant('u3')];
    const winners = selectWinners(pool, 1, sequence([2]));

    expect(winners[0]?.userId).toBe('u3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('hash do resultado', () => {
  const payload: RaffleResultPayload = {
    validationVersion: 1,
    raffleId: 'raffle-1',
    tenantId: 'tenant-1',
    eventId: 'evento-1',
    scope: 'EVENT',
    activityId: null,
    referenceDate: null,
    minAttendanceMinutes: 60,
    winnersCount: 2,
    allowPriorEventWinners: false,
    eligibleCount: 10,
    drawnAt: '2026-09-20T18:00:00.000Z',
    winners: [
      { position: 1, userId: 'u3', minutes: 180 },
      { position: 2, userId: 'u1', minutes: 90 },
    ],
  };

  it('é determinístico', () => {
    expect(buildResultPayload(payload)).toBe(buildResultPayload({ ...payload }));
    expect(hashResult(buildResultPayload(payload))).toBe(hashResult(buildResultPayload({ ...payload })));
  });

  it('o hash é SHA-256 em hexadecimal', () => {
    expect(hashResult(buildResultPayload(payload))).toMatch(/^[a-f0-9]{64}$/);
  });

  it('DETECTA qualquer alteração no resultado', () => {
    const original = hashResult(buildResultPayload(payload));

    const tampered: Partial<RaffleResultPayload>[] = [
      { winners: [{ position: 1, userId: 'u4', minutes: 180 }, payload.winners[1]!] },
      { winners: [payload.winners[1]!, payload.winners[0]!] },
      { winners: [{ position: 1, userId: 'u3', minutes: 181 }, payload.winners[1]!] },
      { minAttendanceMinutes: 0 },
      { winnersCount: 1 },
      { eligibleCount: 11 },
      { allowPriorEventWinners: true },
      { scope: 'DAY' },
      { drawnAt: '2026-09-20T18:00:01.000Z' },
    ];

    for (const change of tampered) {
      const hash = hashResult(buildResultPayload({ ...payload, ...change }));
      expect(hash, `alteração não detectada: ${JSON.stringify(change)}`).not.toBe(original);
    }
  });

  it('verifyResult() confirma o que está íntegro e recusa o adulterado', () => {
    const hash = hashResult(buildResultPayload(payload));

    expect(verifyResult(payload, hash)).toBe(true);
    expect(verifyResult({ ...payload, winnersCount: 99 }, hash)).toBe(false);
    expect(verifyResult(payload, 'a'.repeat(64))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateReadiness()', () => {
  it('libera quando há elegíveis suficientes', () => {
    const readiness = evaluateReadiness(10, 3);

    expect(readiness.canDraw).toBe(true);
    expect(readiness.willDraw).toBe(3);
    expect(readiness.shortfall).toBe(0);
  });

  it('AVISA quando há menos elegíveis que vagas, e libera assim mesmo', () => {
    const readiness = evaluateReadiness(4, 10);

    expect(readiness.canDraw).toBe(true);
    expect(readiness.willDraw).toBe(4);
    expect(readiness.shortfall).toBe(6);
    expect(readiness.message).toMatch(/entregará 4/i);
  });

  it('BLOQUEIA com quórum zero e explica o que conferir', () => {
    const readiness = evaluateReadiness(0, 5);

    expect(readiness.canDraw).toBe(false);
    expect(readiness.willDraw).toBe(0);
    expect(readiness.message).toMatch(/credenciamento/i);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — missões
 *
 *  O teste mais importante deste arquivo é o do `periodKey` NUNCA nulo: em
 *  PostgreSQL, NULL não colide com NULL em índice único, então uma chave nula
 *  para missões de uso único permitiria DEZENAS de linhas de progresso para a
 *  mesma missão do mesmo participante.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TARGET,
  ONCE_PERIOD_KEY,
  advanceProgress,
  canClaim,
  isTaskWindowOpen,
  isoWeekKey,
  parseTaskTarget,
  progressRatio,
  taskExpiry,
  taskPeriodKey,
  withExpiry,
  type TaskSchedule,
} from '../../src/domain/gamification/task-rules';

const TZ = 'America/Bahia';

function schedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    kind: 'ONE_OFF',
    repeatEveryHours: 0,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('parseTaskTarget()', () => {
  it('usa o padrão quando o alvo está ausente', () => {
    expect(parseTaskTarget(null).target).toEqual(DEFAULT_TARGET);
    expect(parseTaskTarget(undefined).target).toEqual(DEFAULT_TARGET);
    expect(parseTaskTarget({}).target).toEqual(DEFAULT_TARGET);
  });

  it('lê os campos previstos', () => {
    const { target, errors } = parseTaskTarget({
      count: 3,
      activityType: 'mini_course',
      trackId: 'trilha-1',
      minutes: 120,
    });

    expect(errors).toHaveLength(0);
    expect(target).toEqual({
      count: 3,
      activityType: 'MINI_COURSE',
      trackId: 'trilha-1',
      minutes: 120,
    });
  });

  it('NÃO lança com JSON malformado — devolve o padrão e o motivo', () => {
    // Derrubar a lista de missões do participante por causa de um JSON corrompido
    // seria desproporcional.
    const array = parseTaskTarget([1, 2, 3]);
    expect(array.target).toEqual(DEFAULT_TARGET);
    expect(array.errors.length).toBeGreaterThan(0);

    const invalid = parseTaskTarget({ count: 0, minutes: -5 });
    expect(invalid.target.count).toBe(DEFAULT_TARGET.count);
    expect(invalid.target.minutes).toBeNull();
    expect(invalid.errors).toHaveLength(2);
  });

  it('aceita `total` como sinônimo de `count`', () => {
    expect(parseTaskTarget({ total: 4 }).target.count).toBe(4);
  });

  it('descarta filtros em branco', () => {
    const { target } = parseTaskTarget({ count: 1, activityType: '   ', trackId: '' });
    expect(target.activityType).toBeNull();
    expect(target.trackId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('taskPeriodKey()', () => {
  const noon = new Date('2026-09-17T15:00:00.000Z'); // 12:00 em Salvador

  it('missão de uso único tem chave NÃO NULA (`once`)', () => {
    // Este é o ponto: `null` não colide com `null` no índice único do PostgreSQL,
    // e o mesmo usuário acumularia várias linhas de progresso da mesma missão.
    const key = taskPeriodKey(schedule({ kind: 'ONE_OFF' }), noon, TZ);
    expect(key).toBe(ONCE_PERIOD_KEY);
    expect(key).not.toBeNull();

    for (const kind of ['ONE_OFF', 'EVENT_LONG', 'ACHIEVEMENT'] as const) {
      const value = taskPeriodKey(schedule({ kind }), noon, TZ);
      expect(value, `tipo ${kind}`).toBe(ONCE_PERIOD_KEY);
    }
  });

  it('missão diária usa o dia local da instituição', () => {
    expect(taskPeriodKey(schedule({ kind: 'DAILY' }), noon, TZ)).toBe('2026-09-17');

    // 01:30Z ainda é dia 16 em Salvador: a missão diária não pode virar.
    const lateNight = new Date('2026-09-17T01:30:00.000Z');
    expect(taskPeriodKey(schedule({ kind: 'DAILY' }), lateNight, TZ)).toBe('2026-09-16');
  });

  it('missão semanal usa a semana ISO', () => {
    expect(taskPeriodKey(schedule({ kind: 'WEEKLY' }), noon, TZ)).toMatch(/^2026-W\d{2}$/);
  });

  it('missão repetível usa blocos de tempo', () => {
    const every6h = schedule({ kind: 'ONE_OFF', repeatEveryHours: 6 });
    const key = taskPeriodKey(every6h, noon, TZ);

    expect(key).toMatch(/^r\d+$/);
    // Mesmo bloco de 6h → mesma chave; 6h depois → chave diferente.
    expect(taskPeriodKey(every6h, new Date('2026-09-17T17:59:00.000Z'), TZ)).toBe(key);
    expect(taskPeriodKey(every6h, new Date('2026-09-17T21:00:00.000Z'), TZ)).not.toBe(key);
  });

  it('a chave é estável dentro do mesmo dia e muda no dia seguinte', () => {
    const daily = schedule({ kind: 'DAILY' });
    const morning = new Date('2026-09-17T12:00:00.000Z');
    const evening = new Date('2026-09-17T23:00:00.000Z');
    const tomorrow = new Date('2026-09-18T12:00:00.000Z');

    expect(taskPeriodKey(daily, morning, TZ)).toBe(taskPeriodKey(daily, evening, TZ));
    expect(taskPeriodKey(daily, tomorrow, TZ)).not.toBe(taskPeriodKey(daily, morning, TZ));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isoWeekKey()', () => {
  it('acerta semanas conhecidas', () => {
    // 2026-01-01 é uma quinta-feira → semana 1 de 2026.
    expect(isoWeekKey(new Date('2026-01-01T12:00:00.000Z'), 'UTC')).toBe('2026-W01');
    // A segunda-feira 2025-12-29 já pertence à semana 1 de 2026 (regra ISO).
    expect(isoWeekKey(new Date('2025-12-29T12:00:00.000Z'), 'UTC')).toBe('2026-W01');
    // 2026-09-17 é quinta-feira da semana 38.
    expect(isoWeekKey(new Date('2026-09-17T12:00:00.000Z'), 'UTC')).toBe('2026-W38');
  });

  it('a semana começa na segunda, não no domingo', () => {
    // Domingo 2026-09-20 fecha a semana 38; segunda 21 abre a 39.
    expect(isoWeekKey(new Date('2026-09-20T12:00:00.000Z'), 'UTC')).toBe('2026-W38');
    expect(isoWeekKey(new Date('2026-09-21T12:00:00.000Z'), 'UTC')).toBe('2026-W39');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('janela de validade', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('respeita início e fim', () => {
    expect(isTaskWindowOpen(schedule(), now)).toBe(true);
    expect(
      isTaskWindowOpen(schedule({ startsAt: new Date('2026-09-18T00:00:00.000Z') }), now),
    ).toBe(false);
    expect(isTaskWindowOpen(schedule({ endsAt: new Date('2026-09-16T00:00:00.000Z') }), now)).toBe(
      false,
    );
  });

  it('o fim da janela é exclusivo no instante exato', () => {
    expect(isTaskWindowOpen(schedule({ endsAt: now }), now)).toBe(false);
  });

  it('deriva expiração do fim do período', () => {
    // Sem `endsAt` explícito, a missão diária expira na virada do dia local.
    const expiry = taskExpiry(schedule({ kind: 'DAILY' }), now, TZ);
    expect(expiry).not.toBeNull();
    expect(expiry!.getTime()).toBeGreaterThan(now.getTime());

    // Missão de uso único sem prazo não expira.
    expect(taskExpiry(schedule(), now, TZ)).toBeNull();

    // Repetível expira no fim do bloco corrente (6h depois do início do bloco).
    const expiry6h = taskExpiry(schedule({ repeatEveryHours: 6 }), now, TZ);
    expect(expiry6h!.getTime() % (6 * 3_600_000)).toBe(0);
    expect(expiry6h!.getTime()).toBeGreaterThan(now.getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('advanceProgress()', () => {
  it('avança e completa ao atingir o alvo', () => {
    let state = { progress: 0, target: 3, status: 'NOT_STARTED' as const };

    state = advanceProgress(state, 1);
    expect(state).toEqual({ progress: 1, target: 3, status: 'IN_PROGRESS' });

    state = advanceProgress(state, 1);
    expect(state).toEqual({ progress: 2, target: 3, status: 'IN_PROGRESS' });

    state = advanceProgress(state, 1);
    expect(state).toEqual({ progress: 3, target: 3, status: 'COMPLETED' });
  });

  it('nunca passa do alvo', () => {
    // Exibir 7/3 confunde e não significa nada.
    const state = advanceProgress({ progress: 2, target: 3, status: 'IN_PROGRESS' }, 10);
    expect(state).toEqual({ progress: 3, target: 3, status: 'COMPLETED' });
  });

  it('não regride missão concluída ou resgatada', () => {
    const completed = { progress: 3, target: 3, status: 'COMPLETED' as const };
    expect(advanceProgress(completed, 5)).toEqual(completed);

    const claimed = { progress: 3, target: 3, status: 'CLAIMED' as const };
    expect(advanceProgress(claimed, 5)).toEqual(claimed);
  });

  it('não avança missão expirada', () => {
    const expired = { progress: 1, target: 3, status: 'EXPIRED' as const };
    expect(advanceProgress(expired, 1)).toEqual(expired);
  });

  it('avanço zero ou negativo não muda nada', () => {
    const state = { progress: 1, target: 3, status: 'IN_PROGRESS' as const };
    expect(advanceProgress(state, 0)).toEqual(state);
    expect(advanceProgress(state, -4)).toEqual(state);
    expect(advanceProgress(state, Number.NaN)).toEqual(state);
  });

  it('alvo inválido é tratado como 1', () => {
    const state = advanceProgress({ progress: 0, target: 0, status: 'NOT_STARTED' }, 1);
    expect(state).toEqual({ progress: 1, target: 1, status: 'COMPLETED' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resgate e expiração', () => {
  it('só é resgatável quando concluída', () => {
    expect(canClaim('COMPLETED')).toBe(true);
    expect(canClaim('CLAIMED')).toBe(false);
    expect(canClaim('IN_PROGRESS')).toBe(false);
    expect(canClaim('EXPIRED')).toBe(false);
    expect(canClaim('NOT_STARTED')).toBe(false);
  });

  it('a fração de progresso fica em 0–1', () => {
    expect(progressRatio({ progress: 0, target: 4, status: 'NOT_STARTED' })).toBe(0);
    expect(progressRatio({ progress: 2, target: 4, status: 'IN_PROGRESS' })).toBe(0.5);
    expect(progressRatio({ progress: 4, target: 4, status: 'COMPLETED' })).toBe(1);
    expect(progressRatio({ progress: 9, target: 4, status: 'COMPLETED' })).toBe(1);
  });

  it('marca expirado somente o que passou da janela e não foi concluído', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const past = new Date('2026-09-16T12:00:00.000Z');
    const future = new Date('2026-09-18T12:00:00.000Z');

    expect(
      withExpiry({ progress: 1, target: 3, status: 'IN_PROGRESS' }, past, now).status,
    ).toBe('EXPIRED');
    expect(
      withExpiry({ progress: 1, target: 3, status: 'IN_PROGRESS' }, future, now).status,
    ).toBe('IN_PROGRESS');
    // O que já foi concluído permanece resgatável mesmo depois da janela: o
    // participante cumpriu a missão dentro do prazo.
    expect(withExpiry({ progress: 3, target: 3, status: 'COMPLETED' }, past, now).status).toBe(
      'COMPLETED',
    );
    expect(withExpiry({ progress: 3, target: 3, status: 'CLAIMED' }, past, now).status).toBe(
      'CLAIMED',
    );
    expect(withExpiry({ progress: 1, target: 3, status: 'IN_PROGRESS' }, null, now).status).toBe(
      'IN_PROGRESS',
    );
  });
});

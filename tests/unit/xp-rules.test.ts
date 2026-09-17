/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — regras de XP, níveis, prestígio e ofensiva
 *
 *  O que importa provar aqui:
 *    • nível e prestígio são FUNÇÃO do saldo (não há estado paralelo);
 *    • a curva é coerente (forma fechada == somatório);
 *    • a ofensiva usa o dia LOCAL da instituição, não o dia UTC.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  LEVEL_CAP,
  MAX_PRESTIGE,
  PRESTIGE_COST_XP,
  STREAK_MILESTONES,
  XP_SOURCES,
  applyStreak,
  dayKey,
  levelFromXp,
  levelTitle,
  reachedStreakMilestone,
  resolveXpProgress,
  seasonKey,
  streakBonusXp,
  xpToNextLevel,
  xpToReachLevel,
} from '../../src/domain/gamification/xp-rules';
import { XP_SOURCE_KINDS } from '../../src/domain/gamification/types';

const TZ = 'America/Bahia'; // UTC−3, sem horário de verão

// ═══════════════════════════════════════════════════════════════════════════════
describe('tabela de XP', () => {
  it('cobre TODAS as origens do enum', () => {
    for (const source of XP_SOURCE_KINDS) {
      expect(XP_SOURCES[source], `origem sem valor: ${source}`).toBeTypeOf('number');
    }
  });

  it('não credita XP por origem em `TASK_COMPLETED`, `BONUS` e `ADMIN_ADJUSTMENT`', () => {
    // O valor vem do caso concreto (xpReward da missão / amount explícito). Um
    // padrão aqui creditaria em dobro — ou crédito fantasma.
    expect(XP_SOURCES.TASK_COMPLETED).toBe(0);
    expect(XP_SOURCES.BONUS).toBe(0);
    expect(XP_SOURCES.ADMIN_ADJUSTMENT).toBe(0);
  });

  it('valoriza o esforço científico acima da presença', () => {
    expect(XP_SOURCES.SUBMISSION_ACCEPTED).toBeGreaterThan(XP_SOURCES.REVIEW_COMPLETED);
    expect(XP_SOURCES.REVIEW_COMPLETED).toBeGreaterThan(XP_SOURCES.CHECKIN);
    expect(XP_SOURCES.MINI_COURSE_COMPLETION).toBeGreaterThan(XP_SOURCES.CHECKIN);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('curva de níveis', () => {
  it('cresce linearmente, inclusive no teto', () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(2)).toBe(150);
    expect(xpToNextLevel(3)).toBe(200);
    // O nível 50 tem custo de conclusão: é o XP que falta para subir de prestígio.
    // Devolver 0 aqui tornaria o topo da curva inalcançável (ver comentário no código).
    expect(xpToNextLevel(LEVEL_CAP)).toBe(2550);
    expect(xpToNextLevel(0)).toBe(0);
    expect(xpToNextLevel(-3)).toBe(0);
  });

  it('a forma fechada de `xpToReachLevel` é igual ao somatório', () => {
    // A forma fechada é otimização; o somatório é a definição. Se divergirem, a
    // culpa é da fórmula.
    let accumulated = 0;
    for (let level = 1; level <= LEVEL_CAP + 1; level += 1) {
      expect(xpToReachLevel(level), `nível ${level}`).toBe(accumulated);
      accumulated += xpToNextLevel(level);
    }
  });

  it('documenta o custo de um ciclo de prestígio', () => {
    // 25n² + 25n − 50 com n = 51 (fim do ciclo de 50 níveis).
    expect(xpToReachLevel(LEVEL_CAP)).toBe(63_700);
    expect(PRESTIGE_COST_XP).toBe(66_250);
    expect(xpToReachLevel(LEVEL_CAP + 1)).toBe(PRESTIGE_COST_XP);
  });

  it('`levelFromXp` acerta exatamente as fronteiras', () => {
    for (let level = 1; level <= LEVEL_CAP; level += 1) {
      const floor = xpToReachLevel(level);
      expect(levelFromXp(floor), `piso do nível ${level}`).toBe(level);

      if (level > 1) {
        expect(levelFromXp(floor - 1), `véspera do nível ${level}`).toBe(level - 1);
      }
    }
  });

  it('`levelFromXp` é monotônico e tolera entradas estranhas', () => {
    let previous = 1;
    for (let xp = 0; xp <= PRESTIGE_COST_XP; xp += 137) {
      const level = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }

    expect(levelFromXp(-500)).toBe(1);
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(Number.MAX_SAFE_INTEGER)).toBe(LEVEL_CAP);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveXpProgress()', () => {
  it('zera no nível 1 sem prestígio', () => {
    const progress = resolveXpProgress(0);
    expect(progress.level).toBe(1);
    expect(progress.prestigeLevel).toBe(0);
    expect(progress.xpIntoLevel).toBe(0);
    expect(progress.xpToNextLevel).toBe(100);
    expect(progress.levelRatio).toBe(0);
    expect(progress.atPrestigeGate).toBe(false);
    expect(progress.title).toBe('Iniciante');
  });

  it('fecha o ciclo e sobe o prestígio exatamente no custo', () => {
    const before = resolveXpProgress(PRESTIGE_COST_XP - 1);
    expect(before.level).toBe(LEVEL_CAP);
    expect(before.prestigeLevel).toBe(0);
    expect(before.atPrestigeGate).toBe(true);
    // No teto, o que falta é COMPLETAR o nível 50 — e isso vale prestígio.
    expect(before.xpToNextLevel).toBe(1);
    expect(before.levelRatio).toBeCloseTo((2550 - 1) / 2550, 5);

    const at = resolveXpProgress(PRESTIGE_COST_XP);
    expect(at.prestigeLevel).toBe(1);
    expect(at.level).toBe(1);
    expect(at.xpInCycle).toBe(0);
    expect(at.title).toBe('Iniciante · Prestígio 1');
  });

  it('satura no prestígio máximo sem estourar a conta', () => {
    const progress = resolveXpProgress(PRESTIGE_COST_XP * (MAX_PRESTIGE + 5));
    expect(progress.prestigeLevel).toBe(MAX_PRESTIGE);
    expect(progress.level).toBe(LEVEL_CAP);
  });

  it('trata saldo negativo como zero para nível, sem esconder o valor real', () => {
    // Ajuste administrativo pode deixar o saldo negativo. O nível não pode ser
    // "nível −3", mas o número do livro-razão precisa continuar visível.
    const progress = resolveXpProgress(-750);
    expect(progress.totalXp).toBe(-750);
    expect(progress.effectiveXp).toBe(0);
    expect(progress.level).toBe(1);
    expect(progress.prestigeLevel).toBe(0);
  });

  it('mantém as frações dentro de 0–1 em toda a faixa', () => {
    for (let xp = 0; xp <= PRESTIGE_COST_XP * 2; xp += 911) {
      const progress = resolveXpProgress(xp);
      expect(progress.levelRatio).toBeGreaterThanOrEqual(0);
      expect(progress.levelRatio).toBeLessThanOrEqual(1);
      expect(progress.cycleRatio).toBeGreaterThanOrEqual(0);
      expect(progress.cycleRatio).toBeLessThanOrEqual(1);
    }
  });

  it('o progresso dentro do nível é o excedente sobre o piso', () => {
    const floor = xpToReachLevel(5);
    const progress = resolveXpProgress(floor + 30);
    expect(progress.level).toBe(5);
    expect(progress.xpIntoLevel).toBe(30);
    expect(progress.xpToNextLevel).toBe(xpToNextLevel(5) - 30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('títulos', () => {
  it('sobe por faixas', () => {
    expect(levelTitle(1)).toBe('Iniciante');
    expect(levelTitle(4)).toBe('Iniciante');
    expect(levelTitle(5)).toBe('Explorador');
    expect(levelTitle(10)).toBe('Veterano');
    expect(levelTitle(20)).toBe('Especialista');
    expect(levelTitle(35)).toBe('Mestre');
    expect(levelTitle(LEVEL_CAP)).toBe('Lenda');
  });

  it('exibe o prestígio no título', () => {
    expect(levelTitle(35, 2)).toBe('Mestre · Prestígio 2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('chaves de data no fuso da instituição', () => {
  it('o dia local não é o dia UTC', () => {
    // 2026-09-17T01:30Z é 2026-09-16T22:30 em Salvador (UTC−3). Quem fez
    // check-in à noite do dia 16 não pode "aparecer" no dia 17.
    const instant = new Date('2026-09-17T01:30:00.000Z');
    expect(dayKey(instant, 'UTC')).toBe('2026-09-17');
    expect(dayKey(instant, TZ)).toBe('2026-09-16');
  });

  it('deriva a temporada por trimestre', () => {
    expect(seasonKey(new Date('2026-01-15T12:00:00.000Z'), TZ)).toBe('2026-Q1');
    expect(seasonKey(new Date('2026-04-01T12:00:00.000Z'), TZ)).toBe('2026-Q2');
    expect(seasonKey(new Date('2026-09-17T12:00:00.000Z'), TZ)).toBe('2026-Q3');
    expect(seasonKey(new Date('2026-12-31T12:00:00.000Z'), TZ)).toBe('2026-Q4');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('ofensiva (streak)', () => {
  const base = {
    currentStreak: 0,
    longestStreak: 0,
    timeZone: TZ,
  };

  it('começa em 1 na primeira atividade', () => {
    const state = applyStreak({
      ...base,
      lastActivityAt: null,
      now: new Date('2026-09-17T15:00:00.000Z'),
    });

    expect(state.currentStreak).toBe(1);
    expect(state.longestStreak).toBe(1);
    expect(state.isNewDay).toBe(true);
  });

  it('não conta duas vezes no mesmo dia', () => {
    const state = applyStreak({
      ...base,
      currentStreak: 4,
      longestStreak: 4,
      lastActivityAt: new Date('2026-09-17T11:00:00.000Z'),
      now: new Date('2026-09-17T23:00:00.000Z'),
    });

    expect(state.currentStreak).toBe(4);
    expect(state.isNewDay).toBe(false);
  });

  it('avança quando o último dia foi o anterior', () => {
    const state = applyStreak({
      ...base,
      currentStreak: 4,
      longestStreak: 4,
      lastActivityAt: new Date('2026-09-16T23:50:00.000Z'), // dia 16 local
      now: new Date('2026-09-17T00:30:00.000Z'), // dia 17 local? não: 21:30 do dia 16
    });

    // 2026-09-17T00:30Z ainda é dia 16 em Salvador: mesmo dia, sem avanço.
    expect(state.isNewDay).toBe(false);

    const next = applyStreak({
      ...base,
      currentStreak: 4,
      longestStreak: 4,
      lastActivityAt: new Date('2026-09-16T23:50:00.000Z'),
      now: new Date('2026-09-17T13:00:00.000Z'), // 10:00 do dia 17 local
    });

    expect(next.currentStreak).toBe(5);
    expect(next.longestStreak).toBe(5);
    expect(next.isNewDay).toBe(true);
  });

  it('quebra a ofensiva e preserva o recorde', () => {
    const state = applyStreak({
      ...base,
      currentStreak: 9,
      longestStreak: 9,
      lastActivityAt: new Date('2026-09-13T13:00:00.000Z'),
      now: new Date('2026-09-17T13:00:00.000Z'),
    });

    expect(state.currentStreak).toBe(1);
    expect(state.longestStreak).toBe(9);
    expect(state.wasBroken).toBe(true);
  });

  it('o recorde nunca diminui', () => {
    const state = applyStreak({
      ...base,
      currentStreak: 2,
      longestStreak: 30,
      lastActivityAt: new Date('2026-09-17T13:00:00.000Z'),
      now: new Date('2026-09-18T13:00:00.000Z'),
    });

    expect(state.currentStreak).toBe(3);
    expect(state.longestStreak).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('bônus de ofensiva', () => {
  it('só reconhece marcos exatos', () => {
    for (const milestone of STREAK_MILESTONES) {
      expect(reachedStreakMilestone(milestone)).toBe(true);
    }
    expect(reachedStreakMilestone(4)).toBe(false);
    expect(reachedStreakMilestone(0)).toBe(false);
  });

  it('cresce em degraus e satura', () => {
    expect(streakBonusXp(1)).toBe(0);
    expect(streakBonusXp(3)).toBe(30);
    expect(streakBonusXp(7)).toBe(60);
    expect(streakBonusXp(30)).toBe(150);
    expect(streakBonusXp(100)).toBe(300);
    // Sem saturação, "aparecer todo dia" viraria a única estratégia racional.
    expect(streakBonusXp(10_000)).toBe(300);
  });
});

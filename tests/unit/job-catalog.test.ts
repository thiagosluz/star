/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Catálogo das rotinas automáticas (FASE 36)
 *
 *  O catálogo é a fonte que o WORKER usa para agendar e a TELA usa para mostrar. Se
 *  os dois lados lessem listas diferentes, a governança mentiria sobre a cadência —
 *  e o defeito apareceria como "a rotina não roda" dias depois.
 *
 *  O que este arquivo prende:
 *
 *    • toda rotina do catálogo tem rótulo, descrição, cadência e a unidade do que
 *      ela conta (sem isso a tela compararia números que significam coisas
 *      diferentes);
 *    • a tradução da expressão cron cobre exatamente as cadências que o catálogo
 *      usa, e devolve `null` quando não sabe (melhor não opinar sobre atraso do que
 *      inventar);
 *    • a saúde de uma rotina segue a ORDEM das regras: falha > em andamento >
 *      atraso (com folga de duas passadas) > em dia;
 *    • uma execução órfã tem prazo de validade, senão a rotina nunca mais rodaria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  JOB_CATALOG,
  JOB_HEALTH_LABELS,
  JOB_KEYS,
  JOB_RUN_STATUSES,
  JOB_RUN_STATUS_LABELS,
  JOB_STALE_AFTER_MS,
  JOB_TRIGGERS,
  JOB_TRIGGER_LABELS,
  cronIntervalMinutes,
  isJobKey,
  isJobRunStatus,
  isStaleJobRun,
  jobDefinition,
  jobHealthOf,
  type JobHealth,
} from '../../src/domain/platform/job-catalog';

describe('catálogo das rotinas', () => {
  it('cobre exatamente as chaves declaradas, cada uma completa', () => {
    expect(Object.keys(JOB_CATALOG).sort()).toEqual([...JOB_KEYS].sort());

    for (const key of JOB_KEYS) {
      const definition = jobDefinition(key);

      expect(definition.key).toBe(key);
      expect(definition.label.length).toBeGreaterThan(2);
      expect(definition.description.length).toBeGreaterThan(20);
      expect(definition.cadenceLabel.length).toBeGreaterThan(2);
      expect(definition.itemsLabel.length).toBeGreaterThan(2);
      // A cadência em português precisa casar com a expressão cron: cron não é para
      // quem opera, mas os dois descrevem a mesma coisa.
      expect(cronIntervalMinutes(definition.pattern), `cron ilegível em ${key}`).not.toBeNull();
    }
  });

  it('reconhece apenas chaves do catálogo', () => {
    for (const key of JOB_KEYS) expect(isJobKey(key)).toBe(true);

    expect(isJobKey('inventada')).toBe(false);
    expect(isJobKey('')).toBe(false);
    expect(isJobKey(null)).toBe(false);
  });

  it('a inspeção de arquivos e as partições entraram nesta fase', () => {
    expect(JOB_KEYS).toContain('file-scan');
    expect(JOB_KEYS).toContain('audit-partitions');
    expect(jobDefinition('file-scan').pattern).toBe('*/5 * * * *');
    expect(jobDefinition('audit-partitions').pattern).toBe('0 3 * * *');
  });
});

describe('estados e gatilhos da execução', () => {
  it('todo estado e todo gatilho têm rótulo', () => {
    expect(JOB_RUN_STATUSES).toEqual(['RUNNING', 'OK', 'FAILED', 'SKIPPED']);

    for (const status of JOB_RUN_STATUSES) expect(JOB_RUN_STATUS_LABELS[status]).toBeTruthy();
    for (const trigger of JOB_TRIGGERS) expect(JOB_TRIGGER_LABELS[trigger]).toBeTruthy();
  });

  it('reconhece apenas os estados do catálogo', () => {
    expect(isJobRunStatus('OK')).toBe(true);
    expect(isJobRunStatus('RUNNING')).toBe(true);
    expect(isJobRunStatus('ok')).toBe(false);
    expect(isJobRunStatus(undefined)).toBe(false);
  });

  it('a execução órfã vence em meia hora (senão a rotina travaria para sempre)', () => {
    const started = new Date('2026-09-23T12:00:00.000Z');

    expect(JOB_STALE_AFTER_MS).toBe(30 * 60 * 1000);
    expect(isStaleJobRun(started, new Date('2026-09-23T12:29:59.000Z'))).toBe(false);
    expect(isStaleJobRun(started, new Date('2026-09-23T12:31:00.000Z'))).toBe(true);
  });
});

describe('cadência a partir da expressão cron', () => {
  it('lê as três formas que o catálogo usa', () => {
    expect(cronIntervalMinutes('*/15 * * * *')).toBe(15);
    expect(cronIntervalMinutes('*/5 * * * *')).toBe(5);
    expect(cronIntervalMinutes('0 */6 * * *')).toBe(360);
    expect(cronIntervalMinutes('0 * * * *')).toBe(60);
    expect(cronIntervalMinutes('0 3 * * *')).toBe(1440);
  });

  it('devolve null quando não sabe — não opina sobre atraso', () => {
    expect(cronIntervalMinutes('0 3 * * 1')).toBeNull();
    expect(cronIntervalMinutes('0,30 * * * *')).toBeNull();
    expect(cronIntervalMinutes('* * * * *')).toBeNull();
    expect(cronIntervalMinutes('0 3 * *')).toBeNull();
    expect(cronIntervalMinutes('*/0 * * * *')).toBeNull();
  });
});

describe('saúde da rotina', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');

  it('sem execução registrada: "nunca rodou" (o caso que a tela existe para mostrar)', () => {
    expect(jobHealthOf({ lastStatus: null, lastStartedAt: null, pattern: '0 * * * *', now })).toBe('NEVER');
    expect(jobHealthOf({ lastStatus: 'OK', lastStartedAt: null, pattern: '0 * * * *', now })).toBe('NEVER');
  });

  it('falha é o mais grave, e em andamento é notícia boa', () => {
    expect(
      jobHealthOf({
        lastStatus: 'FAILED',
        lastStartedAt: new Date('2026-09-23T11:59:00.000Z'),
        pattern: '0 * * * *',
        now,
      }),
    ).toBe('FAILING');

    expect(
      jobHealthOf({
        lastStatus: 'RUNNING',
        lastStartedAt: new Date('2026-09-23T11:00:00.000Z'),
        pattern: '0 * * * *',
        now,
      }),
    ).toBe('RUNNING');
  });

  it('o atraso é medido contra a cadência da PRÓPRIA rotina, com folga de duas passadas', () => {
    const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);

    // Rotina de 15 minutos: 20 min ainda é "em dia"; acima de 30, atrasada.
    expect(jobHealthOf({ lastStatus: 'OK', lastStartedAt: at(20), pattern: '*/15 * * * *', now })).toBe('OK');
    expect(jobHealthOf({ lastStatus: 'OK', lastStartedAt: at(31), pattern: '*/15 * * * *', now })).toBe('LATE');

    // Rotina diária: 2 horas depois continua em dia — cadência é o que decide.
    expect(jobHealthOf({ lastStatus: 'OK', lastStartedAt: at(120), pattern: '0 3 * * *', now })).toBe('OK');
    // ...mas 3 dias depois, não.
    expect(jobHealthOf({ lastStatus: 'OK', lastStartedAt: at(3 * 1440), pattern: '0 3 * * *', now })).toBe('LATE');
  });

  it('cadência que não sabe ler não acusa atraso (nem inventa saúde)', () => {
    expect(
      jobHealthOf({
        lastStatus: 'OK',
        lastStartedAt: new Date('2026-01-01T00:00:00.000Z'),
        pattern: '0 3 * * 1',
        now,
      }),
    ).toBe('OK');
  });

  it('todo estado de saúde tem rótulo (a tela nunca mostra o código cru)', () => {
    const states: JobHealth[] = ['OK', 'RUNNING', 'LATE', 'FAILING', 'NEVER'];

    for (const state of states) expect(JOB_HEALTH_LABELS[state]).toBeTruthy();
  });
});

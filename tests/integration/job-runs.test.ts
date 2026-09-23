/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Registro das execuções das rotinas (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LINHA EM `job_runs` FAZ DUAS COISAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela é HISTÓRICO (quando rodou, quantos itens, por que falhou) e é EXCLUSÃO MÚTUA
 *  (uma execução por rotina, decidida pelo índice único parcial). Este arquivo prova
 *  as duas — e prova principalmente o caso que ninguém pensa: a execução que morreu
 *  no meio. Sem o reaproveitamento da linha órfã, o worker que reinicia no meio de
 *  uma passada deixa a rotina travada PARA SEMPRE, em silêncio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE SE APODERA DA ROTINA ANTES DE MEDIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O worker real da stack roda as MESMAS rotinas no mesmo banco. Disputar o
 *  agendador com ele tornaria o teste refém do relógio de outro processo (a rotina
 *  das partições roda todo dia às 3h — e um teste que falha à noite é pior que teste
 *  nenhum). O `takeOver` abaixo encerra qualquer execução em andamento ANTES de
 *  medir, e o que se prova em seguida é a regra, não a corrida.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import {
  claimJobRun,
  finishJobRun,
  lastRunPerJob,
  listRecentJobRuns,
  runTrackedJob,
} from '../../src/lib/platform/job-runs';
import { JOB_KEYS, JOB_STALE_AFTER_MS } from '../../src/domain/platform/job-catalog';

/** A rotina deste teste: a única do catálogo que NÃO é varredura de dado de gente. */
const JOB = 'audit-partitions';

const createdRuns: string[] = [];

/**
 * Encerra o que estiver em andamento e reserva a rotina.
 *
 * `updateMany` em vez de `deleteMany` de propósito: a linha do worker real continua
 * existindo como registro (com o motivo da limpeza), em vez de sumir do histórico.
 */
async function takeOver(): Promise<string> {
  await adminPrisma.jobRun.updateMany({
    where: { job: JOB, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      error: 'Encerrada pelo teste de integração da FASE 36.',
    },
  });

  const claim = await claimJobRun({ job: JOB, trigger: 'MANUAL', actorId: null });

  if (!claim.ok) throw new Error('Não foi possível reservar a rotina: outra execução está em andamento.');

  createdRuns.push(claim.runId);

  return claim.runId;
}

afterAll(async () => {
  /** O histórico criado aqui não deve sobrar no painel de governança. */
  await adminPrisma.jobRun.deleteMany({ where: { id: { in: createdRuns } } });
  await adminPrisma.jobRun.deleteMany({
    where: { job: JOB, error: 'Falha proposital do teste de integração.' },
  });
});

describe('reserva da rotina', () => {
  it('abre a execução como RUNNING, com o gatilho e o autor de quem pediu', async () => {
    const actorId = randomUUID();

    const claim = await claimJobRun({ job: JOB, trigger: 'MANUAL', actorId });

    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    createdRuns.push(claim.runId);

    const row = await adminPrisma.jobRun.findUniqueOrThrow({ where: { id: claim.runId } });

    expect(row.job).toBe(JOB);
    expect(row.status).toBe('RUNNING');
    expect(row.trigger).toBe('MANUAL');
    expect(row.triggeredById).toBe(actorId);
    expect(row.finishedAt).toBeNull();
    expect(row.items).toBe(0);
    expect(row.host).toBeTruthy();

    await finishJobRun(claim.runId, { status: 'OK', items: 3 });
  });

  it('UMA execução por rotina: o segundo pedido é recusado enquanto a primeira roda', async () => {
    const runId = await takeOver();

    const second = await claimJobRun({ job: JOB, trigger: 'SCHEDULE' });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('ALREADY_RUNNING');

    await finishJobRun(runId, { status: 'OK', items: 0 });
  });

  it('execução ÓRFÃ é encerrada como falha e a rotina volta a rodar', async () => {
    /**
     * O cenário real: o worker foi reiniciado (deploy, OOM) no meio da passada. A
     * linha ficou `RUNNING` para sempre — e sem este reaproveitamento a rotina
     * NUNCA mais rodaria: um travamento silencioso e permanente.
     */
    const stale = await adminPrisma.jobRun.create({
      data: {
        job: JOB,
        status: 'RUNNING',
        trigger: 'SCHEDULE',
        startedAt: new Date(Date.now() - JOB_STALE_AFTER_MS - 60_000),
        host: 'worker-que-morreu',
      },
      select: { id: true },
    });

    const claim = await claimJobRun({ job: JOB });

    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    createdRuns.push(claim.runId);

    const reaped = await adminPrisma.jobRun.findUniqueOrThrow({ where: { id: stale.id } });

    expect(reaped.status).toBe('FAILED');
    expect(reaped.error).toContain('interrompida');
    expect(reaped.finishedAt).toBeInstanceOf(Date);

    await finishJobRun(claim.runId, { status: 'OK', items: 0 });
  });

  it('execução recente NÃO é reaproveitada (a outra instância pode estar trabalhando)', async () => {
    const recent = await adminPrisma.jobRun.create({
      data: { job: JOB, status: 'RUNNING', trigger: 'SCHEDULE', host: 'irma-viva' },
      select: { id: true },
    });

    const claim = await claimJobRun({ job: JOB });

    expect(claim.ok).toBe(false);

    const untouched = await adminPrisma.jobRun.findUniqueOrThrow({ where: { id: recent.id } });

    expect(untouched.status).toBe('RUNNING');

    await adminPrisma.jobRun.delete({ where: { id: recent.id } });
  });
});

describe('fechamento do registro', () => {
  it('grava o resultado e quantos itens a passada tratou', async () => {
    const runId = await takeOver();

    const closed = await finishJobRun(runId, { status: 'OK', items: 7 });

    expect(closed).toBe(true);

    const row = await adminPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });

    expect(row.status).toBe('OK');
    expect(row.items).toBe(7);
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  it('fechar duas vezes não sobrescreve o primeiro resultado', async () => {
    const runId = await takeOver();

    expect(await finishJobRun(runId, { status: 'OK', items: 2 })).toBe(true);
    /** 0 linhas afetadas = resposta de negócio, não erro (invariante nº 5). */
    expect(await finishJobRun(runId, { status: 'FAILED', items: 99 })).toBe(false);

    const row = await adminPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });

    expect(row.status).toBe('OK');
    expect(row.items).toBe(2);
  });

  it('o motivo da falha é truncado, para o registro não virar um despejo', async () => {
    const runId = await takeOver();

    await finishJobRun(runId, { status: 'FAILED', items: 0, error: 'x'.repeat(5000) });

    const row = await adminPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });

    expect(row.error).toHaveLength(2000);
  });
});

describe('ciclo completo de uma rotina', () => {
  it('sucesso: devolve o número de itens e fecha a execução', async () => {
    const outcome = await runTrackedJob(JOB, async () => 12, { trigger: 'SCHEDULE' });

    expect(outcome.status).toBe('OK');
    expect(outcome.items).toBe(12);

    const recent = await listRecentJobRuns({ limit: 5 });
    const mine = recent.find((run) => run.job === JOB);

    expect(mine?.items).toBe(12);
    createdRuns.push(mine!.id);
  });

  it('falha: a exceção vira registro com o motivo — e NÃO sobe para o worker', async () => {
    const outcome = await runTrackedJob(JOB, async () => {
      throw new Error('Falha proposital do teste de integração.');
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.error).toContain('Falha proposital');

    const recent = await listRecentJobRuns({ limit: 5 });
    const mine = recent.find((run) => run.job === JOB);

    expect(mine?.status).toBe('FAILED');
    expect(mine?.error).toContain('Falha proposital');
    createdRuns.push(mine!.id);
  });

  it('rotina ocupada: a passada é PULADA, sem esperar e sem duplicar', async () => {
    const held = await takeOver();

    const outcome = await runTrackedJob(JOB, async () => 1);

    expect(outcome.status).toBe('SKIPPED');
    expect(outcome.items).toBe(0);

    /** A execução que já estava em andamento não foi tocada. */
    const row = await adminPrisma.jobRun.findUniqueOrThrow({ where: { id: held } });
    expect(row.status).toBe('RUNNING');

    await finishJobRun(held, { status: 'OK', items: 0 });
  });
});

describe('leitura para a tela de governança', () => {
  it('a última execução existe para TODA rotina do catálogo (inclusive as que nunca rodaram)', async () => {
    const last = await lastRunPerJob();

    /**
     * A leitura percorre o catálogo, e não as execuções: uma rotina que nunca rodou
     * precisa aparecer como "nunca rodou" — é o caso que exige ação.
     */
    expect(Object.keys(last).sort()).toEqual([...JOB_KEYS].sort());

    for (const key of JOB_KEYS) {
      const entry = last[key];

      if (entry) {
        expect(entry.startedAt).toBeInstanceOf(Date);
        expect(['RUNNING', 'OK', 'FAILED', 'SKIPPED']).toContain(entry.status);
      }
    }
  });

  it('o histórico vem do mais recente para o mais antigo e respeita o teto', async () => {
    const runs = await listRecentJobRuns({ limit: 3 });

    expect(runs.length).toBeLessThanOrEqual(3);

    for (let index = 1; index < runs.length; index += 1) {
      expect(runs[index - 1]!.startedAt.getTime()).toBeGreaterThanOrEqual(
        runs[index]!.startedAt.getTime(),
      );
    }
  });
});

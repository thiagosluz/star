/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Registro das execuções das rotinas automáticas (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SERVIÇO RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As quatro varreduras rodavam desde fases diferentes e só sabiam falar pelo
 *  `console.log` do worker: quem opera não tinha como responder "a rotina das 3h
 *  rodou ontem?", "quantas vagas ela liberou?" nem "por que falhou?".
 *
 *  Aqui cada passada abre e fecha uma linha em `job_runs`. E a linha faz DUAS
 *  coisas: registra o trabalho e **reserva a rotina** — o índice único parcial
 *  (`job_runs_running_key`, `WHERE status = 'RUNNING'`) garante UMA execução por
 *  rotina, decidida pelo banco.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO ADVISORY LOCK
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O pool roda sob PgBouncer em modo TRANSAÇÃO: a conexão troca entre comandos, e
 *  `pg_advisory_lock` (escopo de SESSÃO) não sobrevive à troca — dois workers
 *  acreditariam ter o lock. `pg_advisory_xact_lock` resolveria, mas amarraria a
 *  exclusão à transação inteira da varredura, que é longa e faz várias escritas por
 *  instituição. A linha com índice parcial não tem nenhum dos dois problemas, e
 *  ainda deixa o histórico (ADR-186).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CONEXÃO É A DE PLATAFORMA (invariante nº 1)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `job_runs` não tem `tenantId`: a execução é da PLATAFORMA (uma passada atende
 *  todas as instituições). Por isso o acesso é pelo `adminPrisma` — o mesmo
 *  caminho de `src/lib/platform/**` — e não por `withTenant`, que devolveria
 *  contagem zero sob o contexto de uma instituição.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { hostname } from 'node:os';

import { adminPrisma } from '@/lib/db/admin-client';
import { errorMessage, isUniqueViolation } from '@/lib/db/prisma-errors';
import {
  JOB_CATALOG,
  isStaleJobRun,
  type JobKey,
  type JobRunStatus,
  type JobTrigger,
} from '@/domain/platform/job-catalog';

export interface JobRunRow {
  id: string;
  job: JobKey;
  status: JobRunStatus;
  trigger: JobTrigger;
  startedAt: Date;
  finishedAt: Date | null;
  items: number;
  error: string | null;
  triggeredById: string | null;
  host: string | null;
}

export type ClaimResult =
  | { ok: true; runId: string }
  /** Outra execução da mesma rotina está em andamento (ou o claim foi perdido). */
  | { ok: false; reason: 'ALREADY_RUNNING' };

export interface ClaimInput {
  job: JobKey;
  trigger?: JobTrigger;
  /** Quem pediu pelo painel (nulo quando o relógio disparou). */
  actorId?: string | null;
  now?: Date;
}

/**
 * Reserva a rotina e abre o registro da execução.
 *
 * O caminho normal é um `INSERT` que o índice parcial aceita. Quando ele é
 * recusado, há duas possibilidades — e as duas importam:
 *
 *   • **outra instância está rodando agora** → a passada é pulada (é o
 *     comportamento correto: a rotina é periódica, a próxima passada pega o
 *     trabalho);
 *   • **a execução anterior morreu no meio** (worker reiniciado, OOM) → a linha
 *     ficou `RUNNING` para sempre e a rotina **nunca mais rodaria**. A execução
 *     velha é encerrada como `FAILED` e o claim é tentado de novo.
 */
export async function claimJobRun(input: ClaimInput): Promise<ClaimResult> {
  const now = input.now ?? new Date();

  const attempt = async (): Promise<ClaimResult> =>
    adminPrisma.jobRun
      .create({
        data: {
          job: input.job,
          status: 'RUNNING',
          trigger: input.trigger ?? 'SCHEDULE',
          triggeredById: input.actorId ?? null,
          host: hostname(),
        },
        select: { id: true },
      })
      .then((row) => ({ ok: true as const, runId: row.id }))
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
        return { ok: false as const, reason: 'ALREADY_RUNNING' as const };
      });

  const first = await attempt();
  if (first.ok) return first;

  const running = await adminPrisma.jobRun.findFirst({
    where: { job: input.job, status: 'RUNNING' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true },
  });

  if (!running || !isStaleJobRun(running.startedAt, now)) return first;

  await finishJobRun(running.id, {
    status: 'FAILED',
    items: 0,
    error: 'Execução interrompida: o worker que a iniciou não a concluiu.',
  });

  return attempt();
}

/**
 * Fecha o registro.
 *
 * O `updateMany` é CONDICIONAL (`status = 'RUNNING'`): se o coletor de execuções
 * órfãs já tiver fechado esta linha, a atualização afeta 0 linhas e nada é
 * sobrescrito — a mesma disciplina de concorrência do resto do projeto.
 */
export async function finishJobRun(
  runId: string,
  input: { status: Exclude<JobRunStatus, 'RUNNING'>; items: number; error?: string | null },
): Promise<boolean> {
  const updated = await adminPrisma.jobRun.updateMany({
    where: { id: runId, status: 'RUNNING' },
    data: {
      status: input.status,
      items: input.items,
      error: input.error?.slice(0, 2000) ?? null,
      finishedAt: new Date(),
    },
  });

  return updated.count === 1;
}

/**
 * Roda uma rotina já registrada, cuidando do ciclo inteiro.
 *
 * O `run` devolve quantos itens a passada tratou; qualquer exceção vira `FAILED`
 * com o motivo gravado — e a exceção **não** sobe, porque uma varredura que falha
 * não pode derrubar o worker nem as outras rotinas.
 */
export async function runTrackedJob(
  job: JobKey,
  run: () => Promise<number>,
  options: { trigger?: JobTrigger; actorId?: string | null } = {},
): Promise<{ status: JobRunStatus; items: number; error: string | null }> {
  const claim = await claimJobRun({ job, trigger: options.trigger, actorId: options.actorId });

  if (!claim.ok) {
    return { status: 'SKIPPED', items: 0, error: null };
  }

  try {
    const items = await run();
    await finishJobRun(claim.runId, { status: 'OK', items });
    return { status: 'OK', items, error: null };
  } catch (error) {
    const message = errorMessage(error);
    await finishJobRun(claim.runId, { status: 'FAILED', items: 0, error: message });

    return { status: 'FAILED', items: 0, error: message };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura (a tela da governança)
// ───────────────────────────────────────────────────────────────────────────────
export async function listRecentJobRuns(input: { limit?: number } = {}): Promise<JobRunRow[]> {
  const rows = await adminPrisma.jobRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: Math.min(Math.max(1, input.limit ?? 40), 200),
    select: {
      id: true,
      job: true,
      status: true,
      trigger: true,
      startedAt: true,
      finishedAt: true,
      items: true,
      error: true,
      triggeredById: true,
      host: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    job: row.job as JobKey,
    status: row.status as JobRunStatus,
    trigger: row.trigger as JobTrigger,
  }));
}

/**
 * A última execução de CADA rotina do catálogo.
 *
 * Percorre o catálogo (e não as execuções) de propósito: uma rotina que nunca
 * rodou precisa APARECER na tela como "nunca rodou" — é justamente o caso que o
 * operador precisa ver.
 */
export async function lastRunPerJob(): Promise<
  Record<string, { status: JobRunStatus; startedAt: Date; items: number; error: string | null; trigger: JobTrigger } | null>
> {
  const entries = await Promise.all(
    Object.keys(JOB_CATALOG).map(async (job) => {
      const row = await adminPrisma.jobRun.findFirst({
        where: { job },
        orderBy: { startedAt: 'desc' },
        select: { status: true, startedAt: true, items: true, error: true, trigger: true },
      });

      return [
        job,
        row
          ? {
              status: row.status as JobRunStatus,
              startedAt: row.startedAt,
              items: row.items,
              error: row.error,
              trigger: row.trigger as JobTrigger,
            }
          : null,
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
}

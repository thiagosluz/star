/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Missões e tarefas
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ARMADILHA DO `periodKey` NULO (leia antes de mexer)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `UserTaskProgress` tem `@@unique([tenantId, userId, taskDefinitionId,
 *  periodKey])`. Em PostgreSQL, NULL NÃO colide com NULL: se as missões não
 *  periódicas usassem `periodKey = NULL`, cada avaliação criaria uma LINHA NOVA
 *  e o mesmo participante teria dez progressos da mesma missão.
 *
 *  Por isso toda missão recebe uma chave de período NÃO NULA — inclusive as de
 *  uso único, que usam o sentinela `'once'`. A unicidade passa a valer de fato e
 *  o `upsert` vira a operação natural.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { dayKey } from '@/domain/gamification/xp-rules';
import type { ActivityType, TaskKind, TaskProgressStatus } from '@/domain/gamification/types';

/** Chave de período para missões de uso único (nunca `null`; ver cabeçalho). */
export const ONCE_PERIOD_KEY = 'once';

// ───────────────────────────────────────────────────────────────────────────────
//  Meta
// ───────────────────────────────────────────────────────────────────────────────
export interface TaskTarget {
  /** Quantas ocorrências do gatilho completam a missão. */
  count: number;
  activityType: ActivityType | null;
  trackId: string | null;
  /** Minutos mínimos de presença (usado por metas de carga horária). */
  minutes: number | null;
}

export const DEFAULT_TARGET: TaskTarget = {
  count: 1,
  activityType: null,
  trackId: null,
  minutes: null,
};

/**
 * Lê o alvo do JSON livre do banco.
 *
 * Nunca lança: um alvo corrompido vira o padrão (`count = 1`) e o motivo é
 * devolvido para quem chamou registrar/logar. Derrubar a listagem de missões do
 * participante por causa de um JSON malformado seria desproporcional.
 */
export function parseTaskTarget(raw: unknown): { target: TaskTarget; errors: string[] } {
  const errors: string[] = [];

  if (raw === null || raw === undefined) {
    return { target: { ...DEFAULT_TARGET }, errors };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { target: { ...DEFAULT_TARGET }, errors: ['Alvo deve ser um objeto JSON.'] };
  }

  const record = raw as Record<string, unknown>;

  const count = toPositiveInt(record.count ?? record.total);
  if (record.count !== undefined && count === null) {
    errors.push('`count` deve ser um inteiro maior que zero.');
  }

  const minutes = record.minutes === undefined ? null : toPositiveInt(record.minutes);
  if (record.minutes !== undefined && minutes === null) {
    errors.push('`minutes` deve ser um inteiro maior que zero.');
  }

  const activityType =
    typeof record.activityType === 'string' && record.activityType.trim().length > 0
      ? (record.activityType.trim().toUpperCase() as ActivityType)
      : null;

  const trackId =
    typeof record.trackId === 'string' && record.trackId.trim().length > 0
      ? record.trackId.trim()
      : null;

  return {
    target: {
      count: count ?? DEFAULT_TARGET.count,
      activityType,
      trackId,
      minutes,
    },
    errors,
  };
}

function toPositiveInt(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const floored = Math.floor(numeric);
  return floored > 0 ? floored : null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Janela e chave de período
// ───────────────────────────────────────────────────────────────────────────────
export interface TaskSchedule {
  kind: TaskKind;
  repeatEveryHours: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** A missão está dentro da janela de validade? */
export function isTaskWindowOpen(task: TaskSchedule, now: Date): boolean {
  if (task.startsAt && task.startsAt.getTime() > now.getTime()) return false;
  if (task.endsAt && task.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Chave da janela corrente.
 *
 * • DAILY   → `2026-09-17` (dia no fuso da instituição)
 * • WEEKLY  → `2026-W38`   (semana ISO)
 * • repetível por horas → `r<bloco>` (a cada N horas desde a época)
 * • demais  → `once` (sentinela; ver cabeçalho do arquivo)
 */
export function taskPeriodKey(task: TaskSchedule, now: Date, timeZone: string): string {
  if (task.repeatEveryHours > 0) {
    const block = Math.floor(now.getTime() / (task.repeatEveryHours * 3_600_000));
    return `r${block}`;
  }

  if (task.kind === 'DAILY') return dayKey(now, timeZone);
  if (task.kind === 'WEEKLY') return isoWeekKey(now, timeZone);

  return ONCE_PERIOD_KEY;
}

/** Semana ISO-8601 (`2026-W38`) calculada sobre a data local da instituição. */
export function isoWeekKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1970');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '1');

  // Algoritmo ISO: quinta-feira da mesma semana define o ano e o número.
  const target = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = (target.getUTCDay() + 6) % 7; // segunda = 0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);

  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));

  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Expiração derivada do fim do período (missões diárias/semanais). */
export function taskExpiry(task: TaskSchedule, now: Date, timeZone: string): Date | null {
  if (task.endsAt) return task.endsAt;

  if (task.repeatEveryHours > 0) {
    const block = Math.floor(now.getTime() / (task.repeatEveryHours * 3_600_000)) + 1;
    return new Date(block * task.repeatEveryHours * 3_600_000);
  }

  if (task.kind === 'DAILY') {
    const next = new Date(now.getTime() + 86_400_000);
    return new Date(`${dayKey(next, timeZone)}T00:00:00.000Z`);
  }

  return null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Progresso
// ───────────────────────────────────────────────────────────────────────────────
export interface ProgressState {
  progress: number;
  target: number;
  status: TaskProgressStatus;
}

/**
 * Aplica um avanço de progresso.
 *
 * Regras:
 *   • missão já COMPLETED/CLAIMED não regride nem "re-completa";
 *   • EXPIRED não anda (a janela fechou);
 *   • o progresso nunca passa do alvo — exibir 7/3 confunde e não significa nada.
 */
export function advanceProgress(state: ProgressState, delta = 1): ProgressState {
  if (state.status === 'EXPIRED' || state.status === 'CLAIMED') return state;

  const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.floor(delta)) : 0;
  const target = Math.max(1, Math.floor(state.target));
  const progress = Math.min(target, Math.max(0, Math.floor(state.progress)) + safeDelta);

  if (progress >= target) {
    return { progress: target, target, status: 'COMPLETED' };
  }

  return {
    progress,
    target,
    status: progress > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
  };
}

/** O progresso pode ser resgatado agora? */
export function canClaim(status: TaskProgressStatus): boolean {
  return status === 'COMPLETED';
}

/** Fração 0–1 de conclusão. */
export function progressRatio(state: ProgressState): number {
  const target = Math.max(1, state.target);
  return Math.min(1, Math.max(0, state.progress / target));
}

/** Marca como expirado o que passou da janela — derivado, nunca gravado por engano. */
export function withExpiry(
  state: ProgressState,
  expiresAt: Date | null,
  now: Date,
): ProgressState {
  if (!expiresAt) return state;
  if (state.status === 'CLAIMED' || state.status === 'COMPLETED') return state;
  if (expiresAt.getTime() > now.getTime()) return state;
  return { ...state, status: 'EXPIRED' };
}

/** Rótulos em pt-BR para o painel de missões. */
export const TASK_KIND_LABELS: Readonly<Record<TaskKind, string>> = {
  DAILY: 'Diária',
  WEEKLY: 'Semanal',
  EVENT_LONG: 'Do evento',
  ONE_OFF: 'Única',
  ACHIEVEMENT: 'Conquista',
};

export const PROGRESS_STATUS_LABELS: Readonly<Record<TaskProgressStatus, string>> = {
  NOT_STARTED: 'Não iniciada',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída — resgate disponível',
  CLAIMED: 'Resgatada',
  EXPIRED: 'Expirada',
};

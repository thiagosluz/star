/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — UX de Criação de Evento & Grade de Programação (FASE 135 · ADR-527)
 *
 *  Regras puras (sem Prisma nem Next) para reduzir atrito cognitivo de
 *  organizadores leigos na Onda 1:
 *    1. Geração automática de slug a partir do título (`slugifyTitle`);
 *    2. Cálculo automático de carga horária em minutos entre `Início` e `Término`
 *       (`computeDurationMinutes`) e formatação humana (`formatWorkloadHuman`);
 *    3. Agrupamento cronológico da programação por dia (`groupActivitiesByDay`)
 *       e resumo de saúde da grade (`summarizeSchedule`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { stripDiacritics } from '@/domain/shared/text-rules';

export function slugifyTitle(title: string, maxLength = 60): string {
  const normalized = stripDiacritics(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/-+$/g, '');
}

/**
 * Calcula a duração em minutos entre dois valores de `<input type="datetime-local">`
 * (`YYYY-MM-DDTHH:mm`). Retorna `null` se inválido ou se o término não for posterior.
 */
export function computeDurationMinutes(startsAtLocal: string, endsAtLocal: string): number | null {
  if (!startsAtLocal || !endsAtLocal) return null;
  const start = Date.parse(startsAtLocal);
  const end = Date.parse(endsAtLocal);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const diffMin = Math.round((end - start) / 60_000);
  return diffMin > 0 ? diffMin : null;
}

export function formatWorkloadHuman(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 0) return `${rem} min`;
  if (rem === 0) return `${hours}h`;
  return `${hours}h${String(rem).padStart(2, '0')}`;
}

export interface ScheduleDayGroup<T> {
  readonly dateKey: string;
  readonly label: string;
  readonly items: readonly T[];
}

export function groupActivitiesByDay<T extends { startsAt: Date }>(
  activities: readonly T[],
  timeZone = 'America/Bahia',
): ScheduleDayGroup<T>[] {
  const sorted = [...activities].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const byDay = new Map<string, { label: string; items: T[] }>();

  const keyFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const labelFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  for (const activity of sorted) {
    const key = keyFmt.format(activity.startsAt);
    const existing = byDay.get(key);
    if (existing) {
      existing.items.push(activity);
    } else {
      const rawLabel = labelFmt.format(activity.startsAt);
      const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
      byDay.set(key, { label, items: [activity] });
    }
  }

  return Array.from(byDay.entries()).map(([dateKey, entry]) => ({
    dateKey,
    label: entry.label,
    items: entry.items,
  }));
}

export interface ScheduleSummary {
  readonly totalActivities: number;
  readonly totalMinutes: number;
  readonly totalWorkloadLabel: string;
  readonly withoutRoomCount: number;
}

export function summarizeSchedule(
  activities: readonly { workloadMinutes: number; roomId: string | null }[],
): ScheduleSummary {
  let totalMinutes = 0;
  let withoutRoomCount = 0;
  for (const item of activities) {
    totalMinutes += Math.max(0, item.workloadMinutes);
    if (!item.roomId) withoutRoomCount += 1;
  }
  return {
    totalActivities: activities.length,
    totalMinutes,
    totalWorkloadLabel: formatWorkloadHuman(totalMinutes),
    withoutRoomCount,
  };
}

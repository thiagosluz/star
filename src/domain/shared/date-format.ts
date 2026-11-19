/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO COMPARTILHADO — Formatação de datas pt-BR (FASE 117 · ADR-472)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE CACHEAR OS FORMATADORES `Intl.DateTimeFormat`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Instanciar `new Intl.DateTimeFormat('pt-BR', ...)` dentro de loops de listas
 *  e tabelas custa CPU em cada linha. Cachear por `(preset, timeZone)` mantém
 *  o módulo puro (sem Prisma/Next) e garante formatação consistente entre domínio,
 *  servidor e navegador.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { instantToZonedWallTime } from '@/domain/events/scheduling-rules';

type FormatPreset = 'shortDate' | 'dateTime' | 'timeOnly';

const PRESET_OPTIONS: Record<FormatPreset, Intl.DateTimeFormatOptions> = {
  shortDate: { day: '2-digit', month: '2-digit', year: 'numeric' },
  dateTime: {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  timeOnly: { hour: '2-digit', minute: '2-digit' },
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(preset: FormatPreset, timeZone?: string): Intl.DateTimeFormat {
  const key = `${preset}:${timeZone ?? 'local'}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const options: Intl.DateTimeFormatOptions = timeZone
    ? { ...PRESET_OPTIONS[preset], timeZone }
    : PRESET_OPTIONS[preset];
  const created = new Intl.DateTimeFormat('pt-BR', options);
  formatterCache.set(key, created);
  return created;
}

function toValidDate(input: Date | string | null | undefined): Date | null {
  if (!input) return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD HH:mm` em UTC — usado em tabelas operacionais de plataforma. */
export function formatUtcMoment(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

/** `dd/MM/aaaa, HH:mm` (ou fallback `'—'` para data ausente/inválida). */
export function formatDateTimePtBr(
  input: Date | string | null | undefined,
  timeZone?: string,
): string {
  const date = toValidDate(input);
  if (!date) return '—';
  return getFormatter('dateTime', timeZone).format(date);
}

/** `dd/MM/aaaa` (ou fallback `'—'` para data ausente/inválida). */
export function formatShortDatePtBr(
  input: Date | string | null | undefined,
  timeZone?: string,
): string {
  const date = toValidDate(input);
  if (!date) return '—';
  return getFormatter('shortDate', timeZone).format(date);
}

/** `HH:mm` (ou fallback `'—'` para data ausente/inválida). */
export function formatTimePtBr(
  input: Date | string | null | undefined,
  timeZone?: string,
): string {
  const date = toValidDate(input);
  if (!date) return '—';
  return getFormatter('timeOnly', timeZone).format(date);
}

/**
 * Converte um instante para o valor de `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`).
 *
 * Quando `timeZone` é informado, projeta no fuso IANA do evento (`instantToZonedWallTime`);
 * sem `timeZone`, usa a hora local do processo/navegador.
 */
export function toDatetimeLocalInput(date: Date | null, timeZone?: string): string {
  if (!date) return '';
  if (timeZone) return instantToZonedWallTime(date, timeZone);

  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

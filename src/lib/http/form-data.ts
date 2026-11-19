/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HTTP / SERVER ACTIONS — Parsers seguros de FormData (FASE 117 · ADR-473)
 *
 *  HTML `<form>` não distingue ausência de string vazia. Concentrar os parsers
 *  aqui elimina cópias locais de `nullable`, `toInt` e `toDate` nas Server Actions.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Extrai texto aparado; entradas ausentes ou `File` viram string vazia. */
export function formText(value: FormDataEntryValue | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Converte string vazia ou ausente em `null`. */
export function formNullableText(value: FormDataEntryValue | null | undefined): string | null {
  const text = formText(value);
  return text.length > 0 ? text : null;
}

/** Inteiro truncado com valor padrão quando ausente, vazio ou não numérico. */
export function formInt(value: FormDataEntryValue | null | undefined, fallback = 0): number {
  const text = formNullableText(value);
  if (!text) return fallback;

  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

/** Inteiro opcional: campo vazio vira `null`, nunca `0`. */
export function formNullableInt(value: FormDataEntryValue | null | undefined): number | null {
  const text = formNullableText(value);
  if (!text) return null;

  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

/** Checkbox HTML (`"on"`, `"true"`, `"1"`). */
export function formBoolean(value: FormDataEntryValue | null | undefined): boolean {
  const text = formText(value).toLowerCase();
  return text === 'on' || text === 'true' || text === '1';
}

/** Converte texto de data em `Date`, devolvendo `null` se vazio ou inválido. */
export function formDate(value: FormDataEntryValue | null | undefined): Date | null {
  const text = formNullableText(value);
  if (!text) return null;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

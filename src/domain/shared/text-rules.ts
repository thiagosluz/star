/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO COMPARTILHADO — Normalização textual (FASE 117 · ADR-472)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Remove marcas diacríticas (acentos) preservando caixa e demais caracteres. */
export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO COMPARTILHADO — Arredondamento numérico (FASE 117 · ADR-472)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Arredonda para duas casas decimais mantendo zero positivo. */
export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO COMPARTILHADO — Leitura segura de objetos JSON (FASE 117 · ADR-472)
 *
 *  Substitui cópias locais de `asRecord` / `settingsObject` espalhadas entre
 *  regras de domínio e serviços que leem colunas `Json` do Prisma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Devolve o objeto se for um registro simples (não nulo e não array); senão `null`. */
export function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/** Devolve uma cópia rasa segura como registro, ou `{}` quando o valor não é objeto. */
export function asRecord(value: unknown): Record<string, unknown> {
  const record = asRecordOrNull(value);
  return record ? { ...record } : {};
}

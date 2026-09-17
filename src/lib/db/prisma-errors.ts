/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Utilitários de erro do Prisma
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É COMPARTILHADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Várias partes do sistema usam o BANCO como árbitro final sob concorrência
 *  (lotação de atividade, posição na lista de espera, tiragem de carta, crédito
 *  de XP idempotente). Todas dependem de reconhecer "violação de unicidade" e,
 *  em alguns casos, QUAL índice foi violado.
 *
 *  O nome do índice não chega onde se espera: com o driver adapter do Prisma 7
 *  ele vem aninhado em `meta.driverAdapterError.cause.constraint.index`, e não em
 *  `meta.target` como no engine binário antigo. Essa leitura estava duplicada em
 *  cada serviço; aqui existe uma vez só, testada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** O erro é violação de restrição única (P2002)? */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Nome do índice/constraint violado, nas duas formas conhecidas.
 *
 * Devolve `null` quando o driver não informa — o chamador trata como conflito
 * não reconhecido e propaga, que é o comportamento seguro.
 */
export function violatedIndexName(error: unknown): string | null {
  const meta = (error as { meta?: Record<string, unknown> }).meta;
  if (!meta) return null;

  // Formato antigo (engine binário).
  const legacy = meta.target;
  if (typeof legacy === 'string') return legacy;
  if (Array.isArray(legacy) && typeof legacy[0] === 'string') return legacy[0];

  // Formato do driver adapter.
  const driverError = meta.driverAdapterError as
    | { cause?: { constraint?: { index?: string } } }
    | undefined;

  return driverError?.cause?.constraint?.index ?? null;
}

/**
 * A falha é transitória (vale tentar de novo)?
 *
 *   • `P2034` — conflito de escrita / deadlock.
 *   • `P2028` — a transação não terminou a tempo.
 *   • Mensagens de serialização/deadlock que o driver repassa cruas.
 */
export function isTransientDbError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const code = (error as { code?: string }).code;
  if (code === 'P2034' || code === 'P2028') return true;

  const message = String((error as { message?: string }).message ?? '');
  return (
    message.includes('write conflict') ||
    message.includes('deadlock') ||
    message.includes('could not serialize') ||
    message.includes('Transaction API error')
  );
}

/** Mensagem legível de qualquer erro, sem `[object Object]`. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'erro desconhecido';
}

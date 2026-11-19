/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INFRAESTRUTURA — Configuração canônica do Redis (FASE 117 · ADR-472)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/** URL de conexão do Redis com fallback local de desenvolvimento. */
export function getRedisUrl(): string {
  const configured = process.env.REDIS_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_REDIS_URL;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INFRAESTRUTURA — Cache JSON distribuído em Redis com invalidação O(1) (FASE 116)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE REDIS VERSIONADO EM VEZ DE `KEYS`/`SCAN`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Muitas mutações de evento (atividade, palestrante, patrocinador, chamada,
 *  inscrição) conhecem o `tenantId` (ou `eventId`), mas não o `eventSlug` nem
 *  todos os sub-recursos em cache. Apagar com `KEYS`/`SCAN` trava o Redis sob
 *  carga.
 *
 *  Com uma chave de versão por escopo (`INCR ef:cache:ver:<namespace>:<scope>`),
 *  uma única operação O(1) invalida instantaneamente TODAS as chaves daquele
 *  escopo em TODAS as réplicas Node.js — e as entradas antigas expiram sozinhas
 *  pelo TTL curto (`EX`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  FALHA ABERTA (CACHE NUNCA DERRUBA A APLICAÇÃO)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mesma disciplina de `rate-limit-storage.ts` e `cache-bus.ts`: `lazyConnect`,
 *  `enableOfflineQueue: false`, `connectTimeout: 500ms` e `stream.unref()`. Se o
 *  Redis cair, `get` devolve `null` e `set`/`bump` ignoram o erro após logar uma
 *  única vez — toda leitura cai silenciosamente no PostgreSQL.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import Redis from 'ioredis';

import {
  deserializeCachePayload,
  serializeCachePayload,
  versionCounterKey,
  versionedCacheKey,
  type PublicCacheNamespace,
} from '@/domain/cache/public-cache-rules';
import { logger } from '@/lib/observability/logger';

export interface RedisCacheClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  status?: string;
  connect?(): Promise<void>;
}

interface RedisWithStream {
  stream?: { unref?: () => void };
}

const globalForCache = globalThis as unknown as {
  __eventflowPublicCacheClient?: Redis;
  __eventflowPublicCacheWarned?: boolean;
};

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

function warnUnavailableOnce(error: unknown): void {
  if (globalForCache.__eventflowPublicCacheWarned) return;
  globalForCache.__eventflowPublicCacheWarned = true;

  const message = error instanceof Error ? error.message : String(error);
  logger.warn('public_cache.redis_unavailable', {
    message: `Cache de leitura pública operando em fallback direto ao banco (${message}).`,
  });
}

function defaultClient(): Redis {
  if (!globalForCache.__eventflowPublicCacheClient) {
    const client = new Redis(redisUrl(), {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 500, 2_000)),
    });
    client.on('error', warnUnavailableOnce);
    client.on('connect', () => (client as unknown as RedisWithStream).stream?.unref?.());
    globalForCache.__eventflowPublicCacheClient = client;
  }

  return globalForCache.__eventflowPublicCacheClient;
}

async function ensureConnected(client: RedisCacheClientLike): Promise<boolean> {
  if (!client.status || client.status === 'ready') return true;
  if (client.status === 'wait' && typeof client.connect === 'function') {
    try {
      await client.connect();
      return true;
    } catch (error) {
      warnUnavailableOnce(error);
      return false;
    }
  }
  return false;
}

/**
 * Em suítes Vitest, o cache global fica desligado por padrão para não interferir
 * em testes de integração que alteram o banco diretamente via Prisma sem passar
 * pelas Server Actions. Testes dedicados da FASE 116 ativam o cache injetando o
 * cliente ou passando `force: true`.
 */
export function isPublicReadCacheEnabled(options?: { force?: boolean }): boolean {
  if (options?.force) return true;
  if (process.env.VITEST === 'true' || process.env.DISABLE_PUBLIC_CACHE === '1') {
    return false;
  }
  return true;
}

export async function getDirectJsonCache<T>(
  key: string,
  options?: { client?: RedisCacheClientLike; force?: boolean },
): Promise<T | null> {
  if (!isPublicReadCacheEnabled(options)) return null;

  const client = options?.client ?? defaultClient();
  try {
    if (!(await ensureConnected(client))) return null;
    const raw = await client.get(key);
    if (raw === null) return null;
    return deserializeCachePayload<T>(raw);
  } catch (error) {
    warnUnavailableOnce(error);
    return null;
  }
}

export async function setDirectJsonCache<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  options?: { client?: RedisCacheClientLike; force?: boolean },
): Promise<void> {
  if (!isPublicReadCacheEnabled(options)) return;

  const client = options?.client ?? defaultClient();
  try {
    if (!(await ensureConnected(client))) return;
    await client.set(key, serializeCachePayload(value), 'EX', Math.max(1, Math.round(ttlSeconds)));
  } catch (error) {
    warnUnavailableOnce(error);
  }
}

export async function deleteDirectJsonCache(
  key: string,
  options?: { client?: RedisCacheClientLike; force?: boolean },
): Promise<void> {
  if (!isPublicReadCacheEnabled(options)) return;

  const client = options?.client ?? defaultClient();
  try {
    if (!(await ensureConnected(client))) return;
    await client.del(key);
  } catch (error) {
    warnUnavailableOnce(error);
  }
}

async function readVersion(
  client: RedisCacheClientLike,
  namespace: PublicCacheNamespace,
  scopeId: string,
): Promise<string> {
  const raw = await client.get(versionCounterKey(namespace, scopeId));
  return raw && /^\d+$/.test(raw) ? raw : '0';
}

export async function getVersionedJsonCache<T>(
  namespace: PublicCacheNamespace,
  scopeId: string,
  suffix: string,
  options?: { client?: RedisCacheClientLike; force?: boolean },
): Promise<T | null> {
  if (!isPublicReadCacheEnabled(options)) return null;

  const client = options?.client ?? defaultClient();
  try {
    if (!(await ensureConnected(client))) return null;
    const version = await readVersion(client, namespace, scopeId);
    const raw = await client.get(versionedCacheKey(namespace, scopeId, version, suffix));
    if (raw === null) return null;
    return deserializeCachePayload<T>(raw);
  } catch (error) {
    warnUnavailableOnce(error);
    return null;
  }
}

export async function setVersionedJsonCache<T>(
  namespace: PublicCacheNamespace,
  scopeId: string,
  suffix: string,
  value: T,
  ttlSeconds: number,
  options?: { client?: RedisCacheClientLike; force?: boolean },
): Promise<void> {
  if (!isPublicReadCacheEnabled(options)) return;

  const client = options?.client ?? defaultClient();
  try {
    if (!(await ensureConnected(client))) return;
    const version = await readVersion(client, namespace, scopeId);
    const key = versionedCacheKey(namespace, scopeId, version, suffix);
    await client.set(key, serializeCachePayload(value), 'EX', Math.max(1, Math.round(ttlSeconds)));
  } catch (error) {
    warnUnavailableOnce(error);
  }
}

/**
 * Invalida em O(1) todas as entradas cacheadas sob `(namespace, scopeId)`.
 */
export async function bumpCacheVersion(
  namespace: PublicCacheNamespace,
  scopeId: string,
  options?: { client?: RedisCacheClientLike; force?: boolean },
): Promise<void> {
  if (!isPublicReadCacheEnabled(options)) return;

  const client = options?.client ?? defaultClient();
  try {
    if (!(await ensureConnected(client))) return;
    await client.incr(versionCounterKey(namespace, scopeId));
  } catch (error) {
    warnUnavailableOnce(error);
  }
}

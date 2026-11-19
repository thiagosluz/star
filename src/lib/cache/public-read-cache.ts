/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Fachada semântica de cache público e invalidação (FASE 116)
 *
 *  Centraliza:
 *    1. Invalidação coordenada (Redis versionado + `revalidateTag` do Next.js)
 *       quando um evento, programação, página, palestrante, patrocinador,
 *       chamada, sorteio, inscrição, instituição ou certificado muda;
 *    2. Helpers `getOrSetVersionedPublicCache` / `getOrSetDirectPublicCache`
 *       para os serviços de leitura pública.
 *
 *  `safeRevalidateTag` absorve erro quando chamado fora de um contexto HTTP do
 *  Next.js (worker BullMQ, seed, CLI ou testes Vitest).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  PUBLIC_EVENTS_DIRECTORY_TAG,
  certificateCacheKey,
  publicCertificateTag,
  publicEventTag,
  publicEventTenantTag,
  type PublicCacheNamespace,
} from '@/domain/cache/public-cache-rules';
import {
  bumpCacheVersion,
  deleteDirectJsonCache,
  getDirectJsonCache,
  getVersionedJsonCache,
  setDirectJsonCache,
  setVersionedJsonCache,
  type RedisCacheClientLike,
} from '@/lib/cache/redis-json-cache';
import { adminPrisma } from '@/lib/db/admin-client';

const PUBLIC_TENANTS_TAG = 'public-tenants';

/**
 * Carregamento dinâmico de `next/cache` para não acoplar serviços `src/lib/**`
 * ao bundler do Next.js quando importados diretamente pelo worker, CLI ou specs
 * E2E em Node ESM (onde `import 'next/cache'` sem `.js` falha na carga do módulo).
 */
export async function safeRevalidateTag(tag: string): Promise<void> {
  try {
    const mod = await import('next/cache');
    mod.revalidateTag(tag, 'max');
  } catch {
    // Fora de requisição Next.js (worker, seed, Vitest, Playwright): o Redis já foi invalidado.
  }
}

/**
 * Invalida TODAS as projeções públicas e da API v1 de uma instituição/evento.
 *
 * Chamada nas mutações de evento, página pública, programação, palestrantes,
 * patrocinadores, chamadas, sorteios, inscrições (vagas) e chaves da API v1.
 */
export async function invalidatePublicEventCache(input: {
  tenantId: string;
  eventSlug?: string | null;
  includeDirectory?: boolean;
  client?: RedisCacheClientLike;
  force?: boolean;
}): Promise<void> {
  const opts = { client: input.client, force: input.force };

  await Promise.all([
    bumpCacheVersion('public-event', input.tenantId, opts),
    bumpCacheVersion('api-v1', input.tenantId, opts),
    input.includeDirectory ? bumpCacheVersion('public-directory', 'global', opts) : Promise.resolve(),
  ]);

  await safeRevalidateTag(publicEventTenantTag(input.tenantId));
  if (input.eventSlug) {
    await safeRevalidateTag(publicEventTag(input.tenantId, input.eventSlug));
  }
  if (input.includeDirectory) {
    await safeRevalidateTag(PUBLIC_EVENTS_DIRECTORY_TAG);
    await safeRevalidateTag(PUBLIC_TENANTS_TAG);
  }
}

/**
 * Variante para ações que conhecem apenas o `tenantSlug` (resolve o `id` pela
 * tabela global `tenants` e invalida Redis + tags antes do retorno da action).
 */
export async function invalidatePublicEventCacheBySlug(input: {
  tenantSlug: string;
  eventSlug?: string | null;
  includeDirectory?: boolean;
}): Promise<void> {
  try {
    const tenant = await adminPrisma.tenant.findUnique({
      where: { slug: input.tenantSlug },
      select: { id: true },
    });
    if (!tenant) {
      if (input.includeDirectory) {
        await invalidatePublicDirectoryCache();
      }
      return;
    }
    await invalidatePublicEventCache({
      tenantId: tenant.id,
      eventSlug: input.eventSlug,
      includeDirectory: input.includeDirectory,
    });
  } catch {
    // Nunca quebra a mutação principal se a invalidação auxiliar falhar.
  }
}

/**
 * Invalida o diretório público `/eventos` e a vitrine `/organizacoes`.
 */
export async function invalidatePublicDirectoryCache(options?: {
  tenantId?: string | null;
  client?: RedisCacheClientLike;
  force?: boolean;
}): Promise<void> {
  const opts = { client: options?.client, force: options?.force };
  await Promise.all([
    bumpCacheVersion('public-directory', 'global', opts),
    options?.tenantId ? bumpCacheVersion('public-event', options.tenantId, opts) : Promise.resolve(),
    options?.tenantId ? bumpCacheVersion('api-v1', options.tenantId, opts) : Promise.resolve(),
  ]);

  await safeRevalidateTag(PUBLIC_EVENTS_DIRECTORY_TAG);
  await safeRevalidateTag(PUBLIC_TENANTS_TAG);
  if (options?.tenantId) {
    await safeRevalidateTag(publicEventTenantTag(options.tenantId));
  }
}

/**
 * Invalida imediatamente a validação pública de um certificado (ex.: revogação).
 */
export async function invalidatePublicCertificateCache(
  code: string,
  options?: { client?: RedisCacheClientLike; force?: boolean },
): Promise<void> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;

  await deleteDirectJsonCache(certificateCacheKey(normalized), options);
  await safeRevalidateTag(publicCertificateTag(normalized));
}

export async function getOrSetVersionedPublicCache<T>(input: {
  namespace: PublicCacheNamespace;
  scopeId: string;
  suffix: string;
  ttlSeconds: number;
  loader: () => Promise<T>;
  shouldCache?: (value: T) => boolean;
  client?: RedisCacheClientLike;
  force?: boolean;
}): Promise<{ value: T; hit: boolean }> {
  const opts = { client: input.client, force: input.force };
  const cached = await getVersionedJsonCache<T>(input.namespace, input.scopeId, input.suffix, opts);
  if (cached !== null) {
    return { value: cached, hit: true };
  }

  const fresh = await input.loader();
  const cacheable = input.shouldCache ? input.shouldCache(fresh) : fresh !== null && fresh !== undefined;
  if (cacheable) {
    await setVersionedJsonCache(
      input.namespace,
      input.scopeId,
      input.suffix,
      fresh,
      input.ttlSeconds,
      opts,
    );
  }

  return { value: fresh, hit: false };
}

export async function getOrSetDirectPublicCache<T>(input: {
  key: string;
  ttlSeconds: number;
  loader: () => Promise<T>;
  shouldCache?: (value: T) => boolean;
  client?: RedisCacheClientLike;
  force?: boolean;
}): Promise<{ value: T; hit: boolean }> {
  const opts = { client: input.client, force: input.force };
  const cached = await getDirectJsonCache<T>(input.key, opts);
  if (cached !== null) {
    return { value: cached, hit: true };
  }

  const fresh = await input.loader();
  const cacheable = input.shouldCache ? input.shouldCache(fresh) : fresh !== null && fresh !== undefined;
  if (cacheable) {
    await setDirectJsonCache(input.key, fresh, input.ttlSeconds, opts);
  }

  return { value: fresh, hit: false };
}

import { describe, expect, it, vi } from 'vitest';

import {
  CHECKIN_INITIAL_QUEUE_LIMIT,
  CHECKIN_SEARCH_QUEUE_LIMIT,
  deserializeCachePayload,
  isWallClockNow,
  resolveCheckinInitialQueueLimit,
  serializeCachePayload,
  shouldCacheCertificateVerdict,
  shouldCachePublicDirectoryQuery,
} from '@/domain/cache/public-cache-rules';
import {
  getOrSetVersionedPublicCache,
  invalidatePublicEventCache,
} from '@/lib/cache/public-read-cache';
import type { RedisCacheClientLike } from '@/lib/cache/redis-json-cache';

function createMemoryRedis(): RedisCacheClientLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    status: 'ready',
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return 'OK';
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) {
        if (store.delete(k)) n++;
      }
      return n;
    },
    async incr(key) {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    },
  };
}

describe('FASE 116 — Regras puras de cache público e teto de payload do balcão', () => {
  it('serializeCachePayload / deserializeCachePayload preservam instâncias Date aninhadas sem perder precisão', () => {
    const startsAt = new Date('2026-11-20T14:30:00.000Z');
    const original = {
      id: 'evt-1',
      title: 'Congresso Koveno',
      startsAt,
      nested: [{ openedAt: new Date('2026-11-20T15:00:00.000Z'), count: 3 }],
    };

    const raw = serializeCachePayload(original);
    const restored = deserializeCachePayload<typeof original>(raw);

    expect(restored).not.toBeNull();
    expect(restored?.startsAt).toBeInstanceOf(Date);
    expect(restored?.startsAt.getTime()).toBe(startsAt.getTime());
    expect(restored?.nested[0]?.openedAt).toBeInstanceOf(Date);
    expect(restored?.nested[0]?.openedAt.toISOString()).toBe('2026-11-20T15:00:00.000Z');
  });

  it('shouldCachePublicDirectoryQuery só libera a vitrine padrão sem busca livre ou filtros combinatórios', () => {
    expect(
      shouldCachePublicDirectoryQuery({
        activeTab: 'eventos',
        query: '',
        period: 'upcoming',
        page: 1,
      }),
    ).toBe(true);

    expect(
      shouldCachePublicDirectoryQuery({
        activeTab: 'eventos',
        query: 'rust',
        period: 'upcoming',
        page: 1,
      }),
    ).toBe(false);

    expect(
      shouldCachePublicDirectoryQuery({
        activeTab: 'eventos',
        query: '',
        category: 'TECHNOLOGY',
        period: 'upcoming',
        page: 1,
      }),
    ).toBe(false);

    expect(
      shouldCachePublicDirectoryQuery({
        activeTab: 'instituicoes',
        query: '',
        period: 'upcoming',
        page: 1,
      }),
    ).toBe(false);

    expect(
      shouldCachePublicDirectoryQuery({
        activeTab: 'eventos',
        query: '',
        period: 'upcoming',
        page: 2,
      }),
    ).toBe(false);
  });

  it('shouldCacheCertificateVerdict recusa NOT_FOUND e NOT_ISSUED e aceita estados estáveis', () => {
    expect(shouldCacheCertificateVerdict('VALID')).toBe(true);
    expect(shouldCacheCertificateVerdict('REVOKED')).toBe(true);
    expect(shouldCacheCertificateVerdict('EXPIRED')).toBe(true);
    expect(shouldCacheCertificateVerdict('NOT_FOUND')).toBe(false);
    expect(shouldCacheCertificateVerdict('NOT_ISSUED')).toBe(false);
  });

  it('isWallClockNow aceita relógio real e rejeita datas sintéticas de viagem no tempo', () => {
    const ref = new Date('2026-11-18T12:00:00.000Z').getTime();
    expect(isWallClockNow(undefined, ref)).toBe(true);
    expect(isWallClockNow(new Date(ref + 1_500), ref)).toBe(true);
    expect(isWallClockNow(new Date(ref + 60_000), ref)).toBe(false);
    expect(isWallClockNow(new Date(ref - 60_000), ref)).toBe(false);
  });

  it('resolveCheckinInitialQueueLimit reduz janela inicial sem busca para 25 e amplia para 60 com filtro', () => {
    expect(resolveCheckinInitialQueueLimit(undefined)).toBe(CHECKIN_INITIAL_QUEUE_LIMIT);
    expect(resolveCheckinInitialQueueLimit('   ')).toBe(25);
    expect(resolveCheckinInitialQueueLimit('Bruno')).toBe(CHECKIN_SEARCH_QUEUE_LIMIT);
    expect(resolveCheckinInitialQueueLimit('CR-1234')).toBe(60);
  });
});

describe('FASE 116 — Comportamento de cache versionado O(1) e falha aberta (Redis indisponível)', () => {
  it('reaproveita valor em HIT, invalida instantaneamente por versão O(1) e faz fallback sem lançar se Redis falhar', async () => {
    const redis = createMemoryRedis();
    const loader = vi
      .fn<() => Promise<{ title: string; updatedAt: Date }>>()
      .mockResolvedValueOnce({ title: 'Versão 1', updatedAt: new Date('2026-11-18T10:00:00Z') })
      .mockResolvedValueOnce({ title: 'Versão 2', updatedAt: new Date('2026-11-18T11:00:00Z') });

    const first = await getOrSetVersionedPublicCache({
      namespace: 'public-event',
      scopeId: 'tenant-1',
      suffix: 'detail:congresso',
      ttlSeconds: 60,
      loader,
      client: redis,
      force: true,
    });
    expect(first.hit).toBe(false);
    expect(first.value.title).toBe('Versão 1');
    expect(loader).toHaveBeenCalledTimes(1);

    const second = await getOrSetVersionedPublicCache({
      namespace: 'public-event',
      scopeId: 'tenant-1',
      suffix: 'detail:congresso',
      ttlSeconds: 60,
      loader,
      client: redis,
      force: true,
    });
    expect(second.hit).toBe(true);
    expect(second.value.title).toBe('Versão 1');
    expect(second.value.updatedAt).toBeInstanceOf(Date);
    expect(loader).toHaveBeenCalledTimes(1);

    await invalidatePublicEventCache({
      tenantId: 'tenant-1',
      eventSlug: 'congresso',
      client: redis,
      force: true,
    });

    const third = await getOrSetVersionedPublicCache({
      namespace: 'public-event',
      scopeId: 'tenant-1',
      suffix: 'detail:congresso',
      ttlSeconds: 60,
      loader,
      client: redis,
      force: true,
    });
    expect(third.hit).toBe(false);
    expect(third.value.title).toBe('Versão 2');
    expect(loader).toHaveBeenCalledTimes(2);

    // Falha aberta: Redis fora do ar nunca impede a leitura no banco
    const brokenRedis: RedisCacheClientLike = {
      status: 'ready',
      async get() {
        throw new Error('ECONNREFUSED');
      },
      async set() {
        throw new Error('ECONNREFUSED');
      },
      async del() {
        throw new Error('ECONNREFUSED');
      },
      async incr() {
        throw new Error('ECONNREFUSED');
      },
    };
    const fallbackLoader = vi.fn().mockResolvedValue({ title: 'Direto do banco' });
    const fallback = await getOrSetVersionedPublicCache({
      namespace: 'public-event',
      scopeId: 'tenant-1',
      suffix: 'detail:congresso',
      ttlSeconds: 60,
      loader: fallbackLoader,
      client: brokenRedis,
      force: true,
    });
    expect(fallback.hit).toBe(false);
    expect(fallback.value.title).toBe('Direto do banco');
    expect(fallbackLoader).toHaveBeenCalledTimes(1);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — rate limit distribuído (FASE 13, item A1)
 *
 *  O Redis é injetado (`createRedisRateLimitStorage({ redis })`), então estes
 *  testes provam o CONTRATO sem depender de infraestrutura:
 *
 *    • `consume` conta e decide numa chamada só (o contrato do Better Auth 1.7);
 *    • o `PEXPIRE` só acontece na primeira contagem da janela — renovar o TTL a
 *      cada tentativa transformaria a janela em "tempo desde a última tentativa",
 *      e um atacante insistente nunca seria bloqueado;
 *    • `retryAfter` é derivado do TTL restante, não de um valor fixo;
 *    • Redis fora do ar → FALHA ABERTA (com métrica), porque o limitador é
 *      mitigação e quem autoriza é o RBAC.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRedisRateLimitStorage } from '../../src/lib/auth/rate-limit-storage';
import { incCounter, renderMetrics, resetMetrics } from '../../src/lib/observability/metrics';

/**
 * Redis de mentira que executa a MESMA semântica do script Lua: `INCR` + `PEXPIRE`
 * na primeira contagem + `PTTL`. O relógio é controlado (`now`) para que a
 * expiração seja testada sem `await sleep`.
 */
function fakeRedis(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const keys = new Map<string, { count: number; expiresAt: number }>();
  const expirations: { key: string; milliseconds: number }[] = [];

  return {
    status: 'ready',
    keys,
    expirations,
    connect: vi.fn(async () => undefined),
    async incr(key: string) {
      const current = keys.get(key);

      if (!current || current.expiresAt <= now()) {
        keys.set(key, { count: 1, expiresAt: current?.expiresAt ?? 0 });
        return 1;
      }

      current.count += 1;
      return current.count;
    },
    async pexpire(key: string, milliseconds: number) {
      const current = keys.get(key);
      if (!current) return 0;

      expirations.push({ key, milliseconds });
      current.expiresAt = now() + milliseconds;

      return 1;
    },
    async eval(_script: string, _numberOfKeys: number, key: string, windowMs: number) {
      const count = await this.incr(String(key));

      if (count === 1) {
        await this.pexpire(String(key), Number(windowMs));
      }

      const ttl = keys.get(String(key))!.expiresAt - now();

      return [count, ttl];
    },
  };
}

describe('rate limit — decisão', () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  it('permite até o máximo e nega a tentativa seguinte', async () => {
    const redis = fakeRedis();
    const storage = createRedisRateLimitStorage({ redis, prefix: 'teste:rl:' });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(storage.consume('login:1.2.3.4', { window: 60, max: 3 })).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
    }

    const denied = await storage.consume('login:1.2.3.4', { window: 60, max: 3 });

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBe(60);
  });

  it('usa prefixo próprio: chaves de domínios diferentes não se misturam', async () => {
    const redis = fakeRedis();
    const storage = createRedisRateLimitStorage({ redis, prefix: 'teste:rl:' });

    await storage.consume('ip:9.9.9.9', { window: 30, max: 1 });
    await storage.consume('ip:9.9.9.9', { window: 30, max: 1 });

    expect([...redis.keys.keys()]).toEqual(['teste:rl:ip:9.9.9.9']);
  });

  it('define o TTL UMA vez por janela (janela fixa, não deslizante)', async () => {
    let clock = 1_000;
    const redis = fakeRedis({ now: () => clock });
    const storage = createRedisRateLimitStorage({ redis });

    await storage.consume('ip:5.5.5.5', { window: 60, max: 5 });
    clock += 10_000;
    await storage.consume('ip:5.5.5.5', { window: 60, max: 5 });
    clock += 10_000;
    await storage.consume('ip:5.5.5.5', { window: 60, max: 5 });

    expect(redis.expirations).toEqual([{ key: 'ef:rl:ip:5.5.5.5', milliseconds: 60_000 }]);
  });

  it('libera de novo depois que a janela expira', async () => {
    let clock = 5_000;
    const redis = fakeRedis({ now: () => clock });
    const storage = createRedisRateLimitStorage({ redis });

    await storage.consume('ip:7.7.7.7', { window: 1, max: 1 });
    await expect(storage.consume('ip:7.7.7.7', { window: 1, max: 1 })).resolves.toMatchObject({
      allowed: false,
    });

    clock += 1_100;

    await expect(storage.consume('ip:7.7.7.7', { window: 1, max: 1 })).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  it('arredonda a janela em segundos para milissegundos', async () => {
    const redis = fakeRedis();
    const storage = createRedisRateLimitStorage({ redis });

    await storage.consume('ip:3.3.3.3', { window: 90, max: 1 });

    expect(redis.expirations[0]!.milliseconds).toBe(90_000);
  });
});

describe('rate limit — indisponibilidade e métricas', () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  it('FALHA ABERTA quando o Redis está fora, registrando o incidente', async () => {
    const storage = createRedisRateLimitStorage({
      redis: {
        status: 'ready',
        incr: async () => 0,
        pexpire: async () => 0,
        eval: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
        },
      },
    });

    await expect(storage.consume('ip:1.1.1.1', { window: 60, max: 1 })).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });

    expect(renderMetrics()).toContain('rate_limit_unavailable_total 1');
  });

  it('conta a negativa na métrica `rate_limit_denied_total`', async () => {
    const storage = createRedisRateLimitStorage({ redis: fakeRedis() });

    await storage.consume('ip:2.2.2.2', { window: 60, max: 1 });
    await storage.consume('ip:2.2.2.2', { window: 60, max: 1 });

    expect(renderMetrics()).toContain('rate_limit_denied_total 1');
  });

  it('conecta o cliente preguiçoso antes do primeiro uso', async () => {
    const redis = fakeRedis();
    redis.status = 'wait';

    await createRedisRateLimitStorage({ redis }).consume('ip:4.4.4.4', { window: 60, max: 1 });

    expect(redis.connect).toHaveBeenCalledTimes(1);
  });

  it('não confunde métrica de indisponibilidade com negativa', async () => {
    incCounter('rate_limit_denied_total');

    const storage = createRedisRateLimitStorage({
      redis: {
        status: 'ready',
        incr: async () => 0,
        pexpire: async () => 0,
        eval: async () => {
          throw new Error('sem conexão');
        },
      },
    });

    await storage.consume('ip:6.6.6.6', { window: 60, max: 1 });

    const metrics = renderMetrics();

    expect(metrics).toContain('rate_limit_denied_total 1');
    expect(metrics).toContain('rate_limit_unavailable_total 1');
  });
});

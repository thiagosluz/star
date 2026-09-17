/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RATE LIMIT DISTRIBUÍDO EM REDIS (FASE 13, item A1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O limitador do Better Auth rodava em MEMÓRIA, por processo. Com duas instâncias,
 *  cada uma contava a metade das tentativas — e o limite efetivo dobrava. Em um
 *  endpoint de login, isso não é uma degradação: é a proteção que desaparece.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA OPERAÇÃO ATÔMICA, E NÃO `get` + `set`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O contrato do Better Auth 1.7 manda implementar `consume(key, {window, max})` —
 *  uma única chamada que CONTA e DECIDE — justamente porque ler e depois escrever
 *  abre a janela clássica: N requisições simultâneas leem o mesmo valor, todas se
 *  acham dentro do limite, e o limite é burlado em paralelo. Este arquivo faz o
 *  par `INCR`/`PEXPIRE` dentro de um script Lua, que o Redis executa como uma
 *  operação isolada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUANDO O REDIS CAI: FALHA ABERTA, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem Redis, `consume` devolve `allowed: true` e registra o incidente (log + métrica
 *  `rate_limit_unavailable_total`). Falhar FECHADO significaria que uma indisponi-
 *  bilidade do Redis impede todo mundo de entrar — trocar "proteção contra força
 *  bruta" por "produto fora do ar" é um mau negócio. O limitador é mitigação, não
 *  autorização: quem autoriza é o RBAC, e esse não depende de Redis.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import Redis from 'ioredis';

import { logger } from '@/lib/observability/logger';
import { incCounter } from '@/lib/observability/metrics';

export interface RateLimitDecision {
  allowed: boolean;
  /** Segundos até a janela liberar. `null` quando permitido. */
  retryAfter: number | null;
}

export interface RateLimitStorage {
  consume: (key: string, rule: { window: number; max: number }) => Promise<RateLimitDecision>;
}

/**
 * Conta e decide em um passo.
 *
 * Devolve `{ contador, ttlMs }`. O `PEXPIRE` só acontece na PRIMEIRA contagem da
 * janela: renovar o TTL a cada requisição transformaria a janela em "tempo desde a
 * última tentativa", e um atacante que insistisse nunca seria bloqueado.
 */
const CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

interface RedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
  status?: string;
  connect?(): Promise<void>;
}

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

const globalForLimiter = globalThis as unknown as {
  __eventflowRateLimitClient?: Redis;
  __eventflowRateLimitWarned?: boolean;
};

function client(): Redis {
  globalForLimiter.__eventflowRateLimitClient ??= new Redis(redisUrl(), {
    lazyConnect: true,
    // Falha rápido: uma requisição de login não pode esperar o Redis voltar.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 500, 2_000)),
  });

  return globalForLimiter.__eventflowRateLimitClient;
}

function warnUnavailable(error: unknown): void {
  incCounter('rate_limit_unavailable_total');

  if (globalForLimiter.__eventflowRateLimitWarned) return;
  globalForLimiter.__eventflowRateLimitWarned = true;

  logger.warn('rate_limit.storage_unavailable', {
    message: 'Rate limit operando sem Redis: as tentativas não são contadas entre instâncias.',
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Constrói o storage usado por `rateLimit.customStorage` do Better Auth.
 *
 * O prefixo separa as chaves do limitador das chaves de sessão/cache do mesmo Redis
 * — sem ele, um `DEL` de manutenção em um domínio apagaria o outro.
 */
export function createRedisRateLimitStorage(options: {
  prefix?: string;
  /** Injetável para teste: permite simular Redis fora do ar sem derrubar nada. */
  redis?: RedisLike;
} = {}): RateLimitStorage {
  const prefix = options.prefix ?? 'ef:rl:';

  return {
    async consume(key, rule) {
      const windowMs = Math.max(1, Math.floor(rule.window)) * 1_000;

      try {
        const redis = options.redis ?? client();

        if (redis.status === 'wait' && redis.connect) {
          await redis.connect();
        }

        const result = (await redis.eval(CONSUME_SCRIPT, 1, `${prefix}${key}`, windowMs)) as [
          number | string,
          number | string,
        ];

        const count = Number(result[0]);
        const ttlMs = Number(result[1]);

        if (count <= rule.max) {
          return { allowed: true, retryAfter: null };
        }

        incCounter('rate_limit_denied_total');

        // TTL negativo (chave sem expiração, caso raro) cai em 1 s: melhor bloquear
        // por pouco tempo do que devolver `retryAfter` inválido ao cliente.
        const retryAfter = ttlMs > 0 ? Math.ceil(ttlMs / 1_000) : 1;

        return { allowed: false, retryAfter };
      } catch (error) {
        warnUnavailable(error);
        return { allowed: true, retryAfter: null };
      }
    },
  };
}

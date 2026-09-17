/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BARRAMENTO DE INVALIDAÇÃO DO CACHE DE INSTITUIÇÃO (FASE 12, item I1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE ELE RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `tenant-resolver.ts` guarda a IDENTIDADE da instituição (nome, tema, fuso,
 *  plano) em um `Map` por processo, com TTL de 30 s. A decisão de ACESSO não passa
 *  por ele — o status é relido a cada resolução (FASE 9) —, mas a identidade ainda
 *  fica desatualizada até o TTL expirar, e **cada instância tem o seu Map**: mudar
 *  o nome de uma instituição só aparecia imediatamente na instância que atendeu a
 *  requisição.
 *
 *  Este módulo publica a invalidação no Redis (que já está na stack para o BullMQ) e
 *  mantém um assinante por processo, de modo que TODAS as instâncias descartem a
 *  entrada ao mesmo tempo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ACONTECE SE O REDIS CAIR — E POR QUE ISSO NÃO DERRUBA NADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cache é otimização; a verdade está no banco. Por isso TODA falha aqui é
 *  absorvida:
 *    • publicar é "fire and forget" — erro é registrado UMA vez e ignorado;
 *    • assinar é best-effort — sem Redis, o cache volta a ser local, com TTL, que
 *      é exatamente o comportamento anterior a esta fase;
 *    • as conexões usam `lazyConnect` + `enableOfflineQueue: false`, para que uma
 *      indisponibilidade não enfileire comandos nem segure requisições.
 *
 *  Nada neste arquivo pode lançar. Uma exceção aqui dentro seria uma falha de
 *  cache que derruba uma página — o oposto do que o cache existe para fazer.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import Redis from 'ioredis';

/** Canal único do barramento. Um canal por assunto; nada de canal genérico. */
export const TENANT_CACHE_CHANNEL = 'eventflow:tenant-cache';

/**
 * Mensagem do canal: o slug a invalidar, ou string vazia para "tudo".
 *
 * Invalidação total (sem identificador) é usada quando o chamador não sabe o slug —
 * é o caso do seed e de scripts administrativos.
 */
export function encodeInvalidation(identifier?: string): string {
  return identifier?.trim().toLowerCase() ?? '';
}

/** Interpreta a mensagem recebida. `null` = mensagem inútil (ignorada). */
export function decodeInvalidation(raw: string): { identifier: string | null } | null {
  if (typeof raw !== 'string') return null;

  const value = raw.trim().toLowerCase();
  if (value.length === 0) return { identifier: null };
  if (value.length > 63) return null;

  return { identifier: value };
}

interface RedisLike {
  stream?: { unref?: () => void };
}

const globalForBus = globalThis as unknown as {
  __eventflowTenantCacheBus?: {
    publisher?: Redis;
    subscriber?: Redis;
    started?: boolean;
    warned?: boolean;
  };
};

const state = (globalForBus.__eventflowTenantCacheBus ??= {});

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

/** Registra a falha UMA vez: log repetido a cada requisição vira ruído. */
function warnOnce(error: unknown): void {
  if (state.warned) return;
  state.warned = true;

  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[tenant-cache] barramento indisponível (${message}). ` +
      'A invalidação volta a ser local, com TTL de 30 s — nenhum acesso é afetado.',
  );
}

function createClient(): Redis {
  const client = new Redis(redisUrl(), {
    lazyConnect: true,
    // Falha rápido em vez de enfileirar: uma requisição nunca espera o Redis.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 500, 2_000)),
  });

  // Não segura o processo vivo (testes e scripts encerram normalmente).
  client.on('error', warnOnce);
  client.on('connect', () => (client as RedisLike).stream?.unref?.());

  return client;
}

function publisher(): Redis {
  state.publisher ??= createClient();
  return state.publisher;
}

/**
 * Avisa todas as instâncias para descartarem a entrada em cache.
 *
 * NUNCA lança e NUNCA espera: a operação que chamou (salvar perfil, suspender,
 * provisionar) já terminou do ponto de vista do negócio.
 */
export function publishTenantInvalidation(identifier?: string): void {
  void (async () => {
    try {
      const client = publisher();
      if (client.status === 'wait') await client.connect();
      await client.publish(TENANT_CACHE_CHANNEL, encodeInvalidation(identifier));
    } catch (error) {
      warnOnce(error);
    }
  })();
}

/**
 * Passa a escutar o canal, aplicando cada invalidação recebida ao cache LOCAL.
 *
 * O chamador (o resolvedor de tenant) injeta a função que limpa o cache — assim
 * este módulo não conhece o cache, e não existe import circular entre os dois.
 * Chamar mais de uma vez é inofensivo: só a primeira conexão é criada.
 */
export function startTenantInvalidationSubscriber(
  handler: (identifier: string | null) => void,
): void {
  if (state.started) return;
  state.started = true;

  const client = createClient();
  state.subscriber = client;

  client.on('message', (_channel: string, raw: string) => {
    const message = decodeInvalidation(raw);
    if (!message) return;

    try {
      handler(message.identifier);
    } catch (error) {
      warnOnce(error);
    }
  });

  void (async () => {
    try {
      await client.connect();
      await client.subscribe(TENANT_CACHE_CHANNEL);
    } catch (error) {
      warnOnce(error);
    }
  })();
}

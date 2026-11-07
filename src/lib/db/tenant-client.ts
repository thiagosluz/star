/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Cliente Prisma — conexão de RUNTIME com contexto de tenant (RLS)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  RLS depende de uma variável de sessão do PostgreSQL (`app.tenant_id`). O
 *  Prisma trabalha com um POOL de conexões: cada query pode cair em uma conexão
 *  física diferente. Se fizermos `SET app.tenant_id = X` fora de uma transação,
 *  o valor fica "grudado" naquela conexão e pode vazar para a próxima
 *  requisição — inclusive de outro tenant. É o bug clássico, e é grave.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SOLUÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todo acesso a dados roda dentro de `prisma.$transaction(...)`. Em uma
 *  transação interativa o Prisma fixa UMA conexão, então:
 *
 *      1. `SELECT set_config('app.tenant_id', $1, true)`   -- `true` = LOCAL
 *      2. as queries de domínio
 *      3. COMMIT/ROLLBACK  ->  o SET LOCAL é descartado pelo PostgreSQL
 *
 *  A conexão volta ao pool limpa. Não há janela de vazamento.
 *
 *  O cliente transacional é propagado por `AsyncLocalStorage`, de modo que o
 *  código de domínio chama `db.event.findMany()` e recebe o cliente já escopado,
 *  sem passar `tx` de mão em mão.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
// Import relativo pelo mesmo motivo documentado em `admin-client.ts`.
import { PrismaClient } from '#db/prisma-client';

// ───────────────────────────────────────────────────────────────────────────────
//  Conexão: role de runtime, NUNCA a admin.
// ───────────────────────────────────────────────────────────────────────────────
function buildRuntimeConnectionString(): string {
  const explicit = process.env.APP_DATABASE_URL;
  if (explicit) return explicit;

  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? '5432';
  const db = process.env.POSTGRES_DB ?? 'eventflow';
  const user = process.env.APP_DB_USER ?? 'eventflow_app';
  const pass = process.env.APP_DB_PASSWORD ?? 'eventflow_app_password';

  return `postgresql://${user}:${pass}@${host}:${port}/${db}?schema=public`;
}

export interface RuntimePoolConfig {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  DIMENSIONAMENTO EXPLÍCITO DO POOL (FASE 96 · ADR-403)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Passar apenas a string de conexão para `new PrismaPg(connString)` delegava o
 *  limite ao padrão oculto do `pg` (10 conexões), sem visibilidade operacional e
 *  sem controle por variável de ambiente para alinhar `DB_POOL_MAX × réplicas`
 *  ao `default_pool_size` do PgBouncer.
 */
export function resolveRuntimePoolConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimePoolConfig {
  const parsedMax = Number(env.DB_POOL_MAX ?? 10);
  const max = Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : 10;

  const parsedIdle = Number(env.DB_IDLE_TIMEOUT_MS ?? 30_000);
  const idleTimeoutMillis = Number.isInteger(parsedIdle) && parsedIdle >= 1_000 ? parsedIdle : 30_000;

  const parsedConn = Number(env.DB_CONN_TIMEOUT_MS ?? 5_000);
  const connectionTimeoutMillis =
    Number.isInteger(parsedConn) && parsedConn >= 1_000 ? parsedConn : 5_000;

  return {
    connectionString: buildRuntimeConnectionString(),
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  };
}

const globalForRuntime = globalThis as unknown as {
  __eventflowRuntimePrisma?: PrismaClient;
};

function createRuntimeClient(): PrismaClient {
  const adapter = new PrismaPg(resolveRuntimePoolConfig());
  return new PrismaClient({
    adapter,
    /**
     * Apenas `warn` — `error` foi deliberadamente omitido.
     *
     * Violações de restrição única e conflitos de escrita são ESPERADOS neste
     * sistema: o controle de lotação e a ordem da lista de espera usam índices
     * únicos e UPDATEs condicionais no banco como garantia definitiva sob
     * concorrência (ver registration-service.ts).
     *
     * Com `log: ['error']`, cada perdedora de corrida imprimiria uma mensagem de
     * erro, poluindo o log e escondendo falhas reais. O tratamento continua
     * explícito na aplicação: P2002 é convertido em resposta de domínio
     * (DUPLICATE / retry de posição) e P2034 em retry da transação.
     */
    log: process.env.NODE_ENV === 'development' ? ['warn'] : [],
  });
}

/**
 * Cliente "cru". Não use diretamente: fora de `withTenant()` ele não tem
 * contexto e a RLS (fail-closed) não retorna nenhuma linha.
 *
 * Cacheado no objeto global para que o hot reload do Next.js em desenvolvimento
 * não crie um pool novo a cada alteração de arquivo.
 */
const basePrisma: PrismaClient =
  globalForRuntime.__eventflowRuntimePrisma ?? createRuntimeClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRuntime.__eventflowRuntimePrisma = basePrisma;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Propagação do contexto
// ───────────────────────────────────────────────────────────────────────────────
export type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;

interface TenantContext {
  tx: TxClient;
  tenantId: string;
}

const contextStore = new AsyncLocalStorage<TenantContext>();

/** Erro explícito quando o código de domínio roda fora de um contexto de tenant. */
export class MissingTenantContextError extends Error {
  constructor(operation: string) {
    super(
      `Operação "${operation}" executada sem contexto de tenant. ` +
        `Envolva a chamada em withTenant(tenantId, ...). ` +
        `(A RLS é fail-closed: sem contexto, nenhuma linha é acessível.)`,
    );
    this.name = 'MissingTenantContextError';
  }
}

/**
 * Cliente de dados consciente do tenant.
 *
 * Fora de `withTenant()` (avaliado exclusivamente via `AsyncLocalStorage`), o proxy
 * LANÇA erro em vez de retornar vazio. Falhar ruidosamente é melhor que devolver `[]`
 * e mascarar um bug de escopo — e eliminar variáveis globais de módulo (`ambientTenantId`,
 * FASE 96 · ADR-407) garante isolamento mesmo sob `concurrency > 1` no worker do BullMQ.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const ctx = contextStore.getStore();

    if (!ctx) {
      // Permite acesso a membros internos do Prisma (`$transaction`, etc.) para
      // que `withTenant` possa ser implementado sobre o próprio objeto.
      if (typeof prop === 'string' && prop.startsWith('$')) {
        return Reflect.get(basePrisma, prop, receiver);
      }
      throw new MissingTenantContextError(String(prop));
    }

    return Reflect.get(ctx.tx, prop, receiver);
  },
});

// ───────────────────────────────────────────────────────────────────────────────
//  Aplicação do contexto no banco
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Define `app.tenant_id` como LOCAL da transação corrente.
 *
 * `set_config(name, value, is_local = true)` é parametrizável: o valor do tenant
 * vai como bind parameter, não interpolado na string SQL. Não há superfície de
 * injeção mesmo que o valor venha de input do usuário.
 */
async function bindTenantToTransaction(tx: TxClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

export interface WithTenantOptions {
  /** Timeout da transação em ms. Default: 10s (o default do Prisma é 5s). */
  timeout?: number;
  /** Tempo máximo de espera por uma conexão do pool, em ms. */
  maxWait?: number;
}

/**
 * Executa `fn` dentro de uma transação com o contexto de tenant aplicado.
 *
 * @example
 *   const eventos = await withTenant(tenant.id, () => db.event.findMany());
 *
 * Todo o trabalho de banco feito dentro do callback enxerga — e só pode escrever
 * em — dados daquele tenant.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TxClient) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  if (!tenantId) {
    throw new MissingTenantContextError('withTenant (tenantId vazio)');
  }

  return basePrisma.$transaction(
    async (tx) => {
      await bindTenantToTransaction(tx, tenantId);
      return contextStore.run({ tx, tenantId }, () => fn(tx));
    },
    {
      timeout: options.timeout ?? 10_000,
      maxWait: options.maxWait ?? 5_000,
    },
  );
}

/** Tenant do contexto corrente (útil para logs e auditoria). */
export function currentTenantId(): string | undefined {
  return contextStore.getStore()?.tenantId;
}

/**
 * Cliente com privilégio administrativo, para operações legítimas que
 * atravessam tenants (jobs de plataforma, relatórios globais).
 *
 * A role `eventflow_app` NÃO tem BYPASSRLS, então mesmo aqui os dados de tenant
 * permanecem protegidos: só tabelas globais (`tenants`) são plenamente legíveis.
 */
export function systemClient(): PrismaClient {
  return basePrisma;
}

/** Encerra o pool. Use em shutdown gracioso e no teardown de testes. */
export async function disconnectDb(): Promise<void> {
  await basePrisma.$disconnect();
}

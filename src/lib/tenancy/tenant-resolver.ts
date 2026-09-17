/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Resolução de tenant contra o banco
 *
 *  O domínio decide *qual identificador* a requisição carrega; aqui traduzimos
 *  esse identificador para uma instituição concreta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CACHE EM MEMÓRIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A resolução acontece em TODA requisição de página pública. Sem cache, cada
 *  visita a uma landing page geraria um SELECT em `tenants`.
 *
 *  Usamos um Map com TTL curto (30s). Em produção com múltiplas instâncias isso
 *  vira um cache por processo, e a invalidação entre instâncias tem até 30s de
 *  atraso. Quando houver Redis em produção, este módulo é o único ponto a trocar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O MAP VIVE NO `globalThis` (FASE 9)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Porque ele NÃO é um detalhe de performance: desde a FASE 9 o status da
 *  instituição decide se o tráfego passa. E o Next.js empacota o Proxy, as páginas
 *  e as Server Actions SEPARADAMENTE — cada bundle tem a sua própria instância
 *  deste módulo. Com um `Map` de módulo, a suspensão invalidava o cache do bundle
 *  que executou a ação, e o Proxy continuava servindo a instituição suspensa pelo
 *  TTL inteiro. Foi exatamente o que o E2E pegou.
 *
 *  Ancorar o cache em `globalThis` faz todos os bundles do MESMO processo
 *  compartilharem uma única tabela — a mesma solução já usada no cliente Prisma
 *  (`admin-client.ts`). Entre processos (múltiplas instâncias) o problema continua
 *  existindo e está registrado como dívida técnica: exige Redis pub/sub.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import {
  publishTenantInvalidation,
  startTenantInvalidationSubscriber,
} from '@/lib/tenancy/cache-bus';
import type { TenantResolution } from '@/domain/tenancy/resolution';

/** Projeção enxuta: só o que a aplicação precisa para operar. */
export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  plan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  customDomain: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  locale: string;
  timezone: string;
  settings: unknown;
}

export type TenantLookupFailure =
  | { kind: 'not-found'; identifier: string }
  | { kind: 'not-operational'; tenant: ResolvedTenant; reason: string }
  | { kind: 'error'; message: string };

export type TenantLookupResult =
  | { kind: 'ok'; tenant: ResolvedTenant }
  | TenantLookupFailure;

// ───────────────────────────────────────────────────────────────────────────────
//  Cache
// ───────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  expiresAt: number;
  result: TenantLookupResult;
}

/**
 * O cache do processo — compartilhado por TODOS os bundles do Next.js.
 *
 * Ver o cabeçalho do arquivo: com um `Map` de módulo, a invalidação feita em uma
 * Server Action não alcançava o Proxy (bundles distintos), e uma instituição
 * suspensa continuava servindo páginas.
 */
const globalForTenantCache = globalThis as unknown as {
  __eventflowTenantCache?: Map<string, CacheEntry>;
};

const cache: Map<string, CacheEntry> =
  globalForTenantCache.__eventflowTenantCache ?? new Map<string, CacheEntry>();

globalForTenantCache.__eventflowTenantCache = cache;

function cacheKey(resolution: Extract<TenantResolution, { kind: 'resolved' }>): string {
  return resolution.isCustomDomain
    ? `domain:${resolution.identifier}`
    : `slug:${resolution.identifier}`;
}

function readCache(key: string): TenantLookupResult | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.result;
}

function writeCache(key: string, result: TenantLookupResult): void {
  // Descarte simples do mais antigo quando o cache cresce demais. Evita
  // crescimento sem limite em processos de vida longa.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
}

/**
 * Invalida o cache LOCALMENTE. É o que o barramento chama em cada instância.
 *
 * Exportada para o `cache-bus` aplicar a invalidação recebida do Redis sem chamar
 * `invalidateTenantCache` (que publica) — publicar em resposta a uma publicação
 * seria um eco infinito entre instâncias.
 */
export function invalidateTenantCacheLocally(identifier?: string): void {
  if (!identifier) {
    cache.clear();
    return;
  }
  cache.delete(`slug:${identifier}`);
  cache.delete(`domain:${identifier}`);
}

/**
 * Invalida o cache — aqui e em TODAS as instâncias (FASE 12, item I1).
 *
 * Chamado quando uma instituição é criada, alterada ou removida. A limpeza local é
 * imediata; o aviso às outras instâncias vai pelo Redis e não bloqueia nada (ver
 * `cache-bus.ts`: a operação de negócio não espera o barramento).
 */
export function invalidateTenantCache(identifier?: string): void {
  invalidateTenantCacheLocally(identifier);
  publishTenantInvalidation(identifier);
}

/**
 * Liga esta instância ao barramento de invalidação.
 *
 * No escopo do módulo de propósito: a primeira importação do resolvedor — que
 * acontece em qualquer requisição — já deixa a instância escutando. Sem isso, a
 * assinatura dependeria de alguém lembrar de inicializá-la.
 */
startTenantInvalidationSubscriber((identifier) =>
  invalidateTenantCacheLocally(identifier ?? undefined),
);

/**
 * Lê apenas o status da instituição.
 *
 * É a consulta mais barata possível (chave primária, uma coluna) e é o que a
 * decisão de acesso usa. Existe separada da resolução completa para deixar claro
 * no código que este dado nunca vem de cache.
 */
async function readTenantStatus(tenantId: string): Promise<ResolvedTenant['status'] | null> {
  const tenant = await adminPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });

  return tenant?.status ?? null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resolução
// ───────────────────────────────────────────────────────────────────────────────
const TENANT_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  plan: true,
  customDomain: true,
  logoUrl: true,
  primaryColor: true,
  locale: true,
  timezone: true,
  settings: true,
} as const;

/**
 * Busca o tenant correspondente a uma resolução já interpretada.
 *
 * A tabela `tenants` é lida com a conexão ADMIN de propósito: ela é global
 * (não tem RLS por `tenantId`) e é justamente o que permite descobrir em qual
 * tenant estamos — não existe contexto antes dessa consulta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O CACHE GUARDA A IDENTIDADE; O STATUS É RELIDO (FASE 9)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Desde a FASE 9 o `status` decide se o tráfego passa. Um dado que decide ACESSO
 *  não pode vir de um cache que ninguém consegue invalidar de forma confiável: o
 *  Next.js empacota Proxy, páginas e Server Actions em bundles separados, e cada
 *  instância da aplicação tem a própria memória — a suspensão feita em uma Server
 *  Action podia levar 30s para alcançar o Proxy (o E2E pegou exatamente isso).
 *
 *  A solução é separar as duas coisas pelo custo que têm: a IDENTIDADE (nome,
 *  tema, fuso, plano) vem do cache, porque muda raramente e não decide nada; o
 *  STATUS é relido a cada resolução, em uma consulta por chave primária. Custa uma
 *  leitura indexada por requisição e elimina a janela inteira — em qualquer bundle,
 *  em qualquer instância, sem depender de invalidação.
 *
 *  Quando o Redis entrar em produção, a leitura de status pode voltar ao cache com
 *  invalidação distribuída; até lá, a decisão de acesso é sempre fresca.
 */
export async function lookupTenant(
  resolution: TenantResolution,
): Promise<TenantLookupResult> {
  if (resolution.kind !== 'resolved') {
    return { kind: 'error', message: 'Resolução não aponta para um tenant.' };
  }

  const key = cacheKey(resolution);
  const cached = readCache(key);

  if (cached) {
    /**
     * Revalidação do único campo que decide acesso.
     *
     * Se o status mudou, o cache é descartado e a resolução completa acontece de
     * novo (a identidade também pode ter mudado na mesma alteração).
     */
    if (cached.kind === 'ok' || cached.kind === 'not-operational') {
      const currentStatus = await readTenantStatus(cached.tenant.id);

      if (currentStatus === cached.tenant.status) return cached;

      cache.delete(key);
    } else {
      return cached;
    }
  }

  let result: TenantLookupResult;

  try {
    const tenant = resolution.isCustomDomain
      ? await adminPrisma.tenant.findFirst({
          where: { customDomain: resolution.identifier },
          select: TENANT_SELECT,
        })
      : await adminPrisma.tenant.findUnique({
          where: { slug: resolution.identifier },
          select: TENANT_SELECT,
        });

    if (!tenant) {
      result = { kind: 'not-found', identifier: resolution.identifier };
    } else if (tenant.status !== 'ACTIVE') {
      result = {
        kind: 'not-operational',
        tenant: tenant as ResolvedTenant,
        reason: tenant.status,
      };
    } else {
      result = { kind: 'ok', tenant: tenant as ResolvedTenant };
    }
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Falha ao consultar o banco.',
    };
  }

  /**
   * Só o que tem INSTITUIÇÃO entra no cache: resultados positivos e "existe, mas
   * não opera". Erros de conexão não podem ficar presos por 30 segundos — e
   * "não encontrado" também não, por um motivo prático: um slug recém-provisionado
   * responderia 404 em outro bundle que tivesse guardado a ausência antes de a
   * instituição existir. A ausência é barata de reconsultar e cara de errar.
   */
  if (result.kind === 'ok' || result.kind === 'not-operational') {
    writeCache(key, result);
  }

  return result;
}

/** O tenant está em estado que permite uso? */
export function isOperational(tenant: ResolvedTenant): boolean {
  return tenant.status === 'ACTIVE';
}

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
 *  Usamos um Map com TTL curto (30s). É deliberadamente simples: em produção com
 *  múltiplas instâncias isso vira um cache por processo, e a invalidação entre
 *  instâncias tem até 30s de atraso. Aceitável para dados de tenant (mudam
 *  raramente e não são sensíveis). Quando houver Redis em produção, este módulo
 *  é o único ponto a trocar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
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

const cache = new Map<string, CacheEntry>();

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

/** Invalida o cache. Chamado quando um tenant é criado/alterado/removido. */
export function invalidateTenantCache(identifier?: string): void {
  if (!identifier) {
    cache.clear();
    return;
  }
  cache.delete(`slug:${identifier}`);
  cache.delete(`domain:${identifier}`);
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
 */
export async function lookupTenant(
  resolution: TenantResolution,
): Promise<TenantLookupResult> {
  if (resolution.kind !== 'resolved') {
    return { kind: 'error', message: 'Resolução não aponta para um tenant.' };
  }

  const key = cacheKey(resolution);
  const cached = readCache(key);
  if (cached) return cached;

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

  // Só resultados positivos e "não encontrado" são cacheados: erros de conexão
  // não devem ficar presos no cache por 30 segundos.
  writeCache(key, result);
  return result;
}

/** O tenant está em estado que permite uso? */
export function isOperational(tenant: ResolvedTenant): boolean {
  return tenant.status === 'ACTIVE';
}

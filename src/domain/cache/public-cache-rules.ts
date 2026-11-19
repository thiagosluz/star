/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO PURO — Regras de cache de leitura pública e API v1 (FASE 116)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTAS REGRAS MORAM NO DOMÍNIO PURO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Decisões de segurança e frescor de cache não são "detalhe de infra":
 *    1. Cachear `NOT_FOUND` em `/validar/[code]` permite flood de memória por
 *       enumeração aleatória de códigos;
 *    2. Cachear buscas livres (`?q=...`) em `/eventos` explode chaves com taxa
 *       de acerto próxima de zero;
 *    3. Cachear leituras com relógio sintético (testes de viagem no tempo) quebra
 *       determinismo de janelas de inscrição;
 *    4. Serializar `Date` em JSON sem marcador explícito devolve `string` no
 *       retorno e quebra `.getTime()` apenas em produção (armadilha já vivida na
 *       vitrine pública).
 *
 *  Tudo aqui é função pura, sem dependência de Next.js, Prisma ou Redis.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const PUBLIC_EVENT_CACHE_TTL_SECONDS = 60;
export const PUBLIC_DIRECTORY_CACHE_TTL_SECONDS = 60;
export const PUBLIC_CERTIFICATE_CACHE_TTL_SECONDS = 60;
export const EVENT_API_CACHE_TTL_SECONDS = 60;

/** Janela máxima (±5s) para considerar um `now` como relógio real (não sintético). */
export const WALL_CLOCK_TOLERANCE_MS = 5_000;

/** Teto inicial de cards na fila manual do balcão (sem busca) × com busca ativa. */
export const CHECKIN_INITIAL_QUEUE_LIMIT = 25;
export const CHECKIN_SEARCH_QUEUE_LIMIT = 60;

export const PUBLIC_EVENTS_DIRECTORY_TAG = 'public-events-directory';

export type PublicCacheNamespace = 'public-event' | 'public-directory' | 'public-cert' | 'api-v1';

const DATE_MARKER_KEY = '__efDate';

export function publicEventTag(tenantId: string, eventSlug: string): string {
  return `public-event:${tenantId}:${eventSlug.trim().toLowerCase()}`;
}

export function publicEventTenantTag(tenantId: string): string {
  return `public-event-tenant:${tenantId}`;
}

export function publicCertificateTag(code: string): string {
  return `public-cert:${code.trim().toUpperCase()}`;
}

export function versionCounterKey(namespace: PublicCacheNamespace, scopeId: string): string {
  return `ef:cache:ver:${namespace}:${scopeId.trim().toLowerCase()}`;
}

export function versionedCacheKey(
  namespace: PublicCacheNamespace,
  scopeId: string,
  version: string,
  suffix: string,
): string {
  return `ef:cache:${namespace}:${scopeId.trim().toLowerCase()}:v${version}:${suffix.trim().toLowerCase()}`;
}

export function certificateCacheKey(code: string): string {
  return `ef:cache:public-cert:${code.trim().toUpperCase()}`;
}

/**
 * Só cacheia leituras públicas cujo `now` acompanha o relógio real.
 *
 * Testes e simulações que injetam datas futuras/passadas passam longe do cache
 * automaticamente, preservando determinismo sem precisar de flag extra.
 */
export function isWallClockNow(now: Date | undefined, referenceMs: number = Date.now()): boolean {
  if (!now) return true;
  return Math.abs(now.getTime() - referenceMs) <= WALL_CLOCK_TOLERANCE_MS;
}

/**
 * Decide se uma consulta do diretório `/eventos` é elegível ao cache compartilhado.
 *
 * Apenas a listagem padrão (sem texto livre, sem filtros combinatórios e na
 * página 1) concentra a vasta maioria do tráfego de entrada e tem alta taxa de
 * reaproveitamento sem multiplicar chaves.
 */
export function shouldCachePublicDirectoryQuery(input: {
  activeTab: string;
  query: string;
  category?: string | null;
  modality?: string | null;
  city?: string | null;
  state?: string | null;
  period: string;
  page: number;
}): boolean {
  return (
    input.activeTab === 'eventos' &&
    input.query.trim() === '' &&
    !input.category &&
    !input.modality &&
    !input.city &&
    !input.state &&
    input.period === 'upcoming' &&
    input.page === 1
  );
}

/**
 * Decide se um veredito de validação pública de certificado deve ser cacheado.
 *
 * Apenas estados estáveis (`VALID`, `REVOKED`, `EXPIRED`) entram em cache.
 * `NOT_FOUND` nunca é cacheado (anti-flood contra enumeração) e `NOT_ISSUED`
 * (`QUEUED`) é transitório enquanto o worker gera o PDF.
 */
export function shouldCacheCertificateVerdict(status: string): boolean {
  return status === 'VALID' || status === 'REVOKED' || status === 'EXPIRED';
}

/**
 * Limite de participantes renderizados na fila manual do balcão `/credenciamento`.
 *
 * Sem busca digitada, renderizar 25 cards corta pela metade o HTML e o payload RSC
 * em eventos com 500+ inscritos; ao digitar um filtro (`?q=`), amplia para 60.
 */
export function resolveCheckinInitialQueueLimit(query?: string | null): number {
  return query && query.trim().length > 0 ? CHECKIN_SEARCH_QUEUE_LIMIT : CHECKIN_INITIAL_QUEUE_LIMIT;
}

/**
 * Serialização JSON com preservação explícita de instâncias `Date`.
 *
 * Evita a armadilha clássica de receber `string` onde o TypeScript declara `Date`
 * após leitura do Redis (que só explodiria em runtime ao chamar `.getTime()`).
 */
export function serializeCachePayload<T>(value: T): string {
  const replacer = function (this: Record<string, unknown>, key: string, val: unknown): unknown {
    const raw = this && typeof this === 'object' ? this[key] : val;
    if (raw instanceof Date) {
      return { [DATE_MARKER_KEY]: raw.toISOString() };
    }
    return val;
  };
  return JSON.stringify(value, replacer);
}

export function deserializeCachePayload<T>(raw: string): T | null {
  try {
    return JSON.parse(raw, (_key, val: unknown) => {
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        const record = val as Record<string, unknown>;
        const iso = record[DATE_MARKER_KEY];
        if (Object.keys(record).length === 1 && typeof iso === 'string') {
          const parsed = new Date(iso);
          return Number.isNaN(parsed.getTime()) ? val : parsed;
        }
      }
      return val;
    }) as T;
  } catch {
    return null;
  }
}

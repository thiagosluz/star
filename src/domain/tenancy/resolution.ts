/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Resolução de tenant
 *
 *  Traduz uma requisição HTTP em "de qual instituição é esta página".
 *
 *  Três estratégias, avaliadas em ordem de prioridade:
 *
 *    1. DOMÍNIO CUSTOMIZADO   eventos.ufba.br      -> tenants.customDomain
 *    2. SUBDOMÍNIO             ufba.eventflow.app   -> tenants.slug
 *    3. PATH                  /t/ufba/...          -> tenants.slug
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É DOMÍNIO E NÃO MIDDLEWARE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra "host X resolve para tenant Y" é lógica de negócio, não de
 *  transporte. Isolando-a aqui, ela é testável sem subir servidor, e o
 *  middleware do Next.js vira uma casca fina que apenas lê a requisição e
 *  aplica o resultado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Slugs que não podem virar nome de instituição: colidem com rotas do sistema. */
export const RESERVED_SLUGS: readonly string[] = Object.freeze([
  'www',
  'app',
  'api',
  'admin',
  'auth',
  'login',
  'logout',
  'signup',
  'register',
  'dashboard',
  'settings',
  'billing',
  'support',
  'help',
  'docs',
  'blog',
  'status',
  'static',
  'assets',
  'public',
  'cdn',
  'mail',
  'smtp',
  'ftp',
  't',
  '_next',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
]);

const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED_SLUGS);

/**
 * Formato válido de slug: minúsculas, dígitos e hífen; 3 a 63 caracteres;
 * não começa nem termina com hífen; sem hífen duplo.
 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,61}[a-z0-9]$/;

export function isValidSlug(slug: string): boolean {
  if (!SLUG_PATTERN.test(slug)) return false;
  if (RESERVED_SET.has(slug)) return false;
  return true;
}

/** Normaliza para comparação: minúsculas, sem espaços nas pontas. */
export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

/** Normaliza um hostname: remove porta, minúsculas, sem ponto final. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resultado da resolução
// ───────────────────────────────────────────────────────────────────────────────
export type TenantResolutionSource = 'custom-domain' | 'subdomain' | 'path' | 'header';

export type TenantResolution =
  | {
      kind: 'resolved';
      source: TenantResolutionSource;
      /** Slug ou domínio a ser buscado no banco. */
      identifier: string;
      /** `true` quando `identifier` é um domínio, não um slug. */
      isCustomDomain: boolean;
      /** Caminho restante após remover o prefixo `/t/<slug>`, se houver. */
      rewrittenPath?: string;
    }
  | { kind: 'platform'; reason: 'root-domain' | 'reserved-subdomain' }
  | { kind: 'none'; reason: 'no-host' | 'invalid-slug' };

export interface ResolveTenantInput {
  host: string | null | undefined;
  pathname: string;
  rootDomain: string;
  /** Header de override, usado por E2E e ambientes sem DNS wildcard. */
  forcedTenantHeader?: string | null;
  /** Habilita a estratégia por path (`/t/<slug>`). */
  allowPathStrategy?: boolean;
}

/** Prefixo de path que carrega o slug do tenant. */
export const PATH_TENANT_PREFIX = '/t';

/**
 * Resolve o tenant a partir da requisição.
 *
 * A ORDEM IMPORTA: o domínio customizado tem precedência sobre o subdomínio
 * porque um tenant que configurou `eventos.ufba.br` espera que esse domínio
 * mande, e não que o subdomínio do host raiz seja interpretado.
 */
export function resolveTenant(input: ResolveTenantInput): TenantResolution {
  const { host, pathname, rootDomain, forcedTenantHeader, allowPathStrategy = true } = input;

  const normalizedRoot = normalizeHost(rootDomain);

  // ── 0. Override explícito (E2E / dev sem DNS wildcard) ─────────────────────
  // Só é confiado quando o host é o domínio raiz, para que um tenant não possa
  // forjar contexto em seu próprio domínio.
  if (forcedTenantHeader) {
    const candidate = normalizeSlug(forcedTenantHeader);
    const hostName = host ? normalizeHost(host) : '';
    const isRootHost =
      hostName === normalizedRoot ||
      hostName === 'localhost' ||
      hostName === '127.0.0.1' ||
      hostName === '';

    if (isRootHost && isValidSlug(candidate)) {
      return {
        kind: 'resolved',
        source: 'header',
        identifier: candidate,
        isCustomDomain: false,
      };
    }
  }

  // ── 1. Estratégia por PATH ─────────────────────────────────────────────────
  if (allowPathStrategy) {
    const match = matchPathTenant(pathname);
    if (match) {
      if (!isValidSlug(match.slug)) return { kind: 'none', reason: 'invalid-slug' };
      return {
        kind: 'resolved',
        source: 'path',
        identifier: match.slug,
        isCustomDomain: false,
        rewrittenPath: match.rest,
      };
    }
  }

  if (!host) return { kind: 'none', reason: 'no-host' };

  const hostName = normalizeHost(host);

  // ── 2. Localhost e IP: não há como derivar tenant do host ──────────────────
  if (
    hostName === 'localhost' ||
    hostName === '127.0.0.1' ||
    hostName === '::1' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostName)
  ) {
    return { kind: 'platform', reason: 'root-domain' };
  }

  // ── 3. Domínio raiz da plataforma -> landing institucional ─────────────────
  if (hostName === normalizedRoot) {
    return { kind: 'platform', reason: 'root-domain' };
  }

  // ── 4. Subdomínio do domínio raiz -> slug do tenant ────────────────────────
  if (hostName.endsWith(`.${normalizedRoot}`)) {
    const sub = hostName.slice(0, -(normalizedRoot.length + 1));

    // Subdomínio aninhado (a.b.root) não é suportado: evita ambiguidade.
    if (sub.includes('.')) return { kind: 'platform', reason: 'root-domain' };

    if (RESERVED_SET.has(sub)) {
      return { kind: 'platform', reason: 'reserved-subdomain' };
    }
    if (!isValidSlug(sub)) return { kind: 'none', reason: 'invalid-slug' };

    return {
      kind: 'resolved',
      source: 'subdomain',
      identifier: sub,
      isCustomDomain: false,
    };
  }

  // ── 5. Qualquer outro host -> domínio customizado de algum tenant ──────────
  // Não validamos formato de slug aqui: é um FQDN e será buscado como domínio.
  return {
    kind: 'resolved',
    source: 'custom-domain',
    identifier: hostName,
    isCustomDomain: true,
  };
}

/**
 * Extrai `/t/<slug>/resto` -> `{ slug, rest }`.
 * Retorna null quando o path não usa a estratégia por prefixo.
 */
export function matchPathTenant(
  pathname: string,
): { slug: string; rest: string } | null {
  if (!pathname.startsWith(`${PATH_TENANT_PREFIX}/`)) return null;

  const withoutPrefix = pathname.slice(PATH_TENANT_PREFIX.length + 1);
  if (withoutPrefix.length === 0) return null;

  const slashIndex = withoutPrefix.indexOf('/');
  const slug = slashIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIndex);
  const rest = slashIndex === -1 ? '/' : withoutPrefix.slice(slashIndex);

  if (slug.length === 0) return null;
  return { slug: normalizeSlug(slug), rest: rest.length > 0 ? rest : '/' };
}

/**
 * Dado um slug, devolve o path canônico interno.
 * Usado para o rewrite do middleware e para gerar links.
 */
export function tenantPath(slug: string, path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${PATH_TENANT_PREFIX}/${slug}${clean === '/' ? '' : clean}`;
}

/**
 * Constrói a URL pública de um tenant.
 * Em produção com domínio wildcard, prefere o subdomínio; caso contrário, o path.
 */
export function buildTenantUrl(options: {
  slug: string;
  rootDomain: string;
  protocol?: string;
  path?: string;
  /** `false` força a estratégia por path (útil em dev sem DNS wildcard). */
  useSubdomain?: boolean;
}): string {
  const {
    slug,
    rootDomain,
    protocol = 'https',
    path = '/',
    useSubdomain = true,
  } = options;

  if (useSubdomain) {
    return `${protocol}://${slug}.${normalizeHost(rootDomain)}${path}`;
  }
  return `${protocol}://${normalizeHost(rootDomain)}${tenantPath(slug, path)}`;
}

/** Motivo legível, para logs e telas de erro. */
export function describeResolution(resolution: TenantResolution): string {
  switch (resolution.kind) {
    case 'resolved':
      return `tenant "${resolution.identifier}" via ${resolution.source}`;
    case 'platform':
      return resolution.reason === 'root-domain'
        ? 'domínio raiz da plataforma'
        : 'subdomínio reservado';
    case 'none':
      return resolution.reason === 'no-host'
        ? 'host ausente'
        : 'identificador de tenant inválido';
  }
}

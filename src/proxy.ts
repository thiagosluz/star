/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PROXY (antigo Middleware) — resolução de tenant
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NOTA SOBRE O NEXT.JS 16
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No Next.js 16 o Middleware passou a se chamar **Proxy** e roda por padrão no
 *  **runtime Node.js** (não mais no Edge). Isso é decisivo aqui: podemos usar o
 *  Prisma diretamente para resolver o tenant, sem um hop HTTP para uma API
 *  interna nem um cache distribuído só para isso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO FAZ (E O QUE NÃO FAZ)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  FAZ:
 *    • descobre a qual instituição a requisição pertence (subdomínio, domínio
 *      customizado ou prefixo de path);
 *    • reescreve a URL para o segmento `/t/<slug>` quando o tenant vem do host,
 *      de modo que o restante da aplicação use sempre a mesma estrutura;
 *    • injeta headers com o tenant resolvido, evitando uma segunda consulta ao
 *      banco nas camadas seguintes;
 *    • bloqueia rotas administrativas de tenant quando não há tenant no host.
 *
 *  NÃO FAZ:
 *    • autenticação ou autorização. A documentação do Next é explícita: o Proxy
 *      serve para verificações OTIMISTAS, não como solução de autorização. Toda
 *      checagem real acontece em `requirePermission()` na camada de dados, perto
 *      do dado. Confiar no Proxy para autorizar seria uma vulnerabilidade.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenant, tenantPath, PATH_TENANT_PREFIX } from '@/domain/tenancy/resolution';
import { lookupTenant } from '@/lib/tenancy/tenant-resolver';

/** Headers internos com o resultado da resolução. */
export const TENANT_HEADERS = {
  id: 'x-ef-tenant-id',
  slug: 'x-ef-tenant-slug',
  source: 'x-ef-tenant-source',
} as const;

/**
 * Segmentos que pertencem à INSTITUIÇÃO e por isso, quando o host não identifica
 * um tenant, não fazem sentido e devem responder 404 em vez de cair na landing
 * da plataforma.
 */
const TENANT_ONLY_SEGMENTS = new Set(['dashboard', 'admin']);

/** Segmentos reservados da plataforma que nunca viram rota de tenant. */
const PLATFORM_SEGMENTS = new Set([
  'api',
  '_next',
  'login',
  'signup',
  'onboarding',
  'selecionar-instituicao',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
]);

function firstSegment(pathname: string): string {
  const withoutLeading = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const index = withoutLeading.indexOf('/');
  return index === -1 ? withoutLeading : withoutLeading.slice(0, index);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const rootDomain = process.env.ROOT_DOMAIN ?? 'lvh.me';
  const host = request.headers.get('host');

  // Header de override para E2E e ambientes sem DNS wildcard.
  // Só é aceito quando o host é o domínio raiz (ver `resolveTenant`).
  const forcedTenant = request.headers.get('x-ef-tenant');

  const resolution = resolveTenant({
    host,
    pathname,
    rootDomain,
    forcedTenantHeader: forcedTenant,
    allowPathStrategy: true,
  });

  // ── Path strategy: `/t/<slug>/...` já é a URL canônica.
  //    Resolvemos o tenant para injetar os headers e para exibir 404 em slug
  //    inexistente antes de renderizar a página.
  if (resolution.kind === 'resolved' && resolution.source === 'path') {
    const lookup = await lookupTenant(resolution);

    if (lookup.kind !== 'ok') {
      return NextResponse.rewrite(new URL('/404-tenant', request.url), {
        status: 404,
      });
    }

    const headers = new Headers(request.headers);
    headers.set(TENANT_HEADERS.id, lookup.tenant.id);
    headers.set(TENANT_HEADERS.slug, lookup.tenant.slug);
    headers.set(TENANT_HEADERS.source, 'path');

    return NextResponse.next({ request: { headers } });
  }

  // ── Nenhum tenant no host ──────────────────────────────────────────────────
  if (resolution.kind !== 'resolved') {
    const segment = firstSegment(pathname);

    // Rota de instituição sem instituição no host: não existe.
    if (TENANT_ONLY_SEGMENTS.has(segment)) {
      return NextResponse.rewrite(new URL('/404-tenant', request.url), { status: 404 });
    }

    return NextResponse.next();
  }

  // ── Tenant vindo do host (subdomínio ou domínio customizado) ───────────────
  const lookup = await lookupTenant(resolution);

  if (lookup.kind !== 'ok') {
    return NextResponse.rewrite(new URL('/404-tenant', request.url), { status: 404 });
  }

  const { tenant } = lookup;

  // Rotas de plataforma continuam acessíveis mesmo em host de tenant
  // (ex.: o endpoint de auth precisa responder no domínio do tenant para que o
  // cookie de sessão seja do mesmo site).
  const segment = firstSegment(pathname);
  if (PLATFORM_SEGMENTS.has(segment)) {
    const headers = new Headers(request.headers);
    headers.set(TENANT_HEADERS.id, tenant.id);
    headers.set(TENANT_HEADERS.slug, tenant.slug);
    headers.set(TENANT_HEADERS.source, resolution.source);
    return NextResponse.next({ request: { headers } });
  }

  // Reescreve para a rota canônica por path, mantendo a URL visível no browser.
  const target = `${tenantPath(tenant.slug, pathname)}${search}`;
  const headers = new Headers(request.headers);
  headers.set(TENANT_HEADERS.id, tenant.id);
  headers.set(TENANT_HEADERS.slug, tenant.slug);
  headers.set(TENANT_HEADERS.source, resolution.source);

  return NextResponse.rewrite(new URL(target, request.url), {
    request: { headers },
  });
}

export const config = {
  /**
   * Roda em tudo, EXCETO:
   *  - `/api/*`         os route handlers resolvem o tenant por conta própria
   *  - `/_next/*`       assets do framework
   *  - arquivos com extensão (favicon, imagens, css)
   *
   * Manter o Proxy fora de `/api` evita custo desnecessário: uma Server Action
   * ou Route Handler já recebe os headers que o Proxy injetou na navegação.
   */
  matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)'],
};

export { PATH_TENANT_PREFIX };

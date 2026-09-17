/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RÓTULO DE ROTA PARA MÉTRICAS (FASE 13)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO USAR O PATHNAME DIRETO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Métrica com rótulo de alta cardinalidade é um vazamento de memória com outro
 *  nome: `/t/ufba-demo/...`, `/t/fiocruz-demo/...` e cada slug novo criariam uma
 *  série permanente no processo e no banco de séries do coletor.
 *
 *  Aqui o slug do tenant vira um curinga (`/t/<curinga>`) e só o primeiro
 *  segmento funcional sobrevive, então o conjunto de rótulos é FECHADO e
 *  conhecido: `/`, `/login`, `/dashboard`, `/t/<curinga>/admin`, etc.
 *
 *  Vive em `lib/observability` (e não dentro de `proxy.ts`) porque é uma função
 *  pura, sem infraestrutura: o Proxy é um dos consumidores, o teste é outro, e
 *  importar o Proxy só para testar isto arrastaria Prisma e Redis para o teste.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { PATH_TENANT_PREFIX } from '@/domain/tenancy/resolution';

/**
 * `PATH_TENANT_PREFIX` é a CONSTANTE DE PATH (`/t`, com barra) e é usada como
 * prefixo literal em `startsWith`. Aqui comparamos com um SEGMENTO de URL, então a
 * barra precisa sair — comparar `'t' === '/t'` era sempre falso e fazia todo
 * `/t/<slug>/...` virar o rótulo `/t`, que não é o que esta função promete.
 */
const TENANT_SEGMENT = PATH_TENANT_PREFIX.replace(/^\//, '');

export function routeLabel(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return '/';

  if (segments[0] === TENANT_SEGMENT) {
    // `/t/<slug>` e `/t/<slug>/<área>` — o slug nunca entra no rótulo.
    return segments.length <= 2
      ? `/${TENANT_SEGMENT}/*`
      : `/${TENANT_SEGMENT}/*/${segments[2]}`;
  }

  return `/${segments[0]}`;
}

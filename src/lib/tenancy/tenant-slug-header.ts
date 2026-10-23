import { headers } from 'next/headers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O SLUG DA INSTITUIÇÃO, LIDO DO HEADER QUE O PROXY INJETA (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE: `not-found.tsx` NÃO RECEBE `params`
 * ─────────────────────────────────────────────────────────────────────────────
 *  A página de "não encontrado" da instituição precisa do slug para oferecer o
 *  caminho de volta certo (`/t/<slug>/eventos` ou `/t/<slug>/dashboard`). O Next
 *  renderiza o `not-found` como `createElement(Component, null)` — sem props e sem
 *  `params` —, então o slug tem de vir de outro lugar.
 *
 *  Os dois lugares possíveis eram `useParams()` (que obrigaria a página inteira a ser
 *  client component, levando JS para uma tela que não interage) e este header. O
 *  header já existe: o Proxy resolve a instituição em TODA navegação e a publica em
 *  `x-ef-tenant-slug`, que é a MESMA resolução que o layout usou para validar o
 *  vínculo. Ler dali não é uma segunda fonte da verdade — é a mesma, já resolvida.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O NOME É LITERAL AQUI, E UM TESTE O PRENDE AO PROXY
 * ─────────────────────────────────────────────────────────────────────────────
 *  Importar `TENANT_HEADERS` de `src/proxy.ts` arrastaria o módulo inteiro do Proxy
 *  (NextResponse, métricas, resolvedor de tenant) para dentro de uma página. O nome
 *  repetido é aceitável porque NÃO fica silencioso: `tests/unit/f75-paginas-de-erro`
 *  lê o Proxy e reprova se as duas declarações divergirem.
 *
 *  Sem o header (renderização fora do Proxy, `notFound()` num layout), a resposta é
 *  `null` — e o domínio cai num destino que sempre existe, em vez de montar
 *  `/t/null/dashboard`.
 */
export const TENANT_SLUG_HEADER = 'x-ef-tenant-slug';

/** O slug da instituição da requisição, ou `null` quando não há resolução. */
export async function currentTenantSlug(): Promise<string | null> {
  const value = (await headers()).get(TENANT_SLUG_HEADER)?.trim();

  return value ? value : null;
}

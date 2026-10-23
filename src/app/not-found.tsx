import type { Metadata } from 'next';

import { AreaNotFound } from '@/components/shell/area-not-found';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NÃO ENCONTRADO — a RAIZ e as telas de PLATAFORMA (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A RAIZ TAMBÉM PRECISA DE UMA (e o que isso muda)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Este arquivo cobre DOIS casos que o Next trata igual:
 *
 *    1. **endereço sem rota nenhuma** (`/qualquer-coisa`) — hoje cairia na página
 *       padrão do framework, em inglês e sem caminho de volta;
 *    2. **`notFound()` lançado por uma tela de plataforma** — `/superadmin/tenants/<id>`
 *       inexistente, `/instituicao-bloqueada` sem slug, `/t/<slug>` de instituição que
 *       não existe.
 *
 *  As duas cascas de instituição têm `not-found.tsx` próprio, porque a saída delas é
 *  outra (o painel, a vitrine). Aqui a saída é a da plataforma: a página inicial e a
 *  vitrine de eventos.
 */
export const metadata: Metadata = { title: 'Página não encontrada' };

export default function PlatformNotFound() {
  return <AreaNotFound area="platform" />;
}

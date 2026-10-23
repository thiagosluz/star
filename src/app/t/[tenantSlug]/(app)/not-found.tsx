import type { Metadata } from 'next';

import { AreaNotFound } from '@/components/shell/area-not-found';
import { currentTenantSlug } from '@/lib/tenancy/tenant-slug-header';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NÃO ENCONTRADO — a casca AUTENTICADA da instituição (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM CAI AQUI
 * ─────────────────────────────────────────────────────────────────────────────
 *  As telas do painel chamam `notFound()` quando o alvo não existe — um evento, uma
 *  demanda, uma submissão, uma sala. O levantamento da fase contou **26 chamadas de
 *  `notFound()` em 20 arquivos** só nesta casca, e todas passam a responder com ESTA
 *  página em vez de a página padrão do Next.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O SLUG VEM DO HEADER, NÃO DE `params`
 * ─────────────────────────────────────────────────────────────────────────────
 *  `not-found.tsx` é renderizado sem props (ver `tenant-slug-header.ts`): sem o slug,
 *  "voltar ao painel" não teria para onde apontar e a saída viraria a página inicial
 *  da plataforma — que é o caminho de quem não pertence à instituição, não o de quem
 *  estava trabalhando nela.
 *
 *  Esta tela roda DENTRO do layout `(app)`, então continua exigindo sessão e vínculo:
 *  o 404 não é uma porta dos fundos — quem não tem acesso à instituição nunca chega
 *  aqui, é redirecionado antes.
 */
export const metadata: Metadata = { title: 'Página não encontrada' };

export default async function AppAreaNotFound() {
  return <AreaNotFound area="app" tenantSlug={await currentTenantSlug()} />;
}

import { notFound } from 'next/navigation';

import { getTenantContext } from '@/lib/events/event-repository';
import { isValidSlug } from '@/domain/tenancy/resolution';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Layout das páginas PÚBLICAS da instituição — grupo `(public)`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE LAYOUT EXISTE (e não reutiliza o do grupo `(app)`)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A landing page de um evento é uma VITRINE: quem chega vem de campanha, de
 *  rede social, de um link compartilhado. Exigir login para ver o evento
 *  destruiria a conversão — e é exatamente o que acontecia antes desta correção:
 *  o layout autenticado envolvia todas as rotas de `/t/[tenantSlug]`, então
 *  `/t/ufba/eventos` redirecionava para o login.
 *
 *  Route groups permitem dois layouts com a MESMA URL:
 *
 *      (public)/eventos/...        -> público, sem autenticação
 *      (app)/dashboard/...         -> autenticado, com cabeçalho e RBAC
 *
 *  Os parênteses não aparecem na URL. `/t/ufba/eventos` continua sendo
 *  `/t/ufba/eventos`.
 *
 *  O que AINDA é validado aqui: a instituição existe e está ativa. Uma página
 *  pública de instituição inexistente ou suspensa deve responder 404 — isso não
 *  é autorização de usuário, é validade de conteúdo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PublicTenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  if (!isValidSlug(tenantSlug)) {
    notFound();
  }

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    notFound();
  }

  return <div className="flex min-h-screen flex-col">{children}</div>;
}

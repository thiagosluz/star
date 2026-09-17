import { redirect } from 'next/navigation';

/**
 * Raiz da instituição — `/t/<slug>`.
 *
 * O layout já validou que a instituição existe, está ativa e que o usuário tem
 * vínculo ATIVO com ela. Aqui só encaminhamos para o painel.
 *
 * Esta página precisa existir: o Proxy reescreve requisições de subdomínio para
 * `/t/<slug>`, então sem ela um acesso a `ufba.lvh.me/` resultaria em 404 mesmo
 * com todo o contexto resolvido corretamente.
 */
export default async function TenantRootPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  redirect(`/t/${tenantSlug}/dashboard`);
}

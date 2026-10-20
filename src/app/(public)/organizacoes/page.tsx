import { permanentRedirect } from 'next/navigation';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DIRETÓRIO PÚBLICO DE INSTITUIÇÕES (LEGADO REDIRECIONADO — FASE 71 · ADR-350)
 *
 *  A vitrine de instituições foi unificada em `/eventos?aba=instituicoes`.
 *  Para preservar links externos, bookmarks e indexadores de busca antigos,
 *  esta rota executa redirecionamento permanente (308), preservando os termos
 *  de busca e o número da página requisitada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function OrganizationsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { q, pagina } = await searchParams;
  const params = new URLSearchParams();
  params.set('aba', 'instituicoes');
  if (q && q.trim().length > 0) params.set('q', q.trim());
  if (pagina && pagina !== '1') params.set('pagina', pagina);

  permanentRedirect(`/eventos?${params.toString()}`);
}

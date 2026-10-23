import Link from 'next/link';

import { Badge, PageHeader } from '@/components/ui';

/**
 * Página exibida quando o host pede uma instituição que não existe, está
 * suspensa ou não é operável. O Proxy reescreve para cá.
 *
 * Deliberadamente genérica: não confirmamos se o slug existe mas está suspenso
 * ou se não existe, para não vazar a existência de instituições privadas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O TOPO VEM DO `PageHeader` — E SEM `eyebrow` (FASE 78 · fatia 4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Esta é uma tela de ESTADO do ENDEREÇO, e não a página de uma instituição: o
 * slug que a pessoa pediu não chegou a existir, então não há casa para nomear
 * nem grupo de navegação a anunciar. O `eyebrow` fica vazio de propósito — uma
 * linha acima do título que dissesse "Plataforma" seria um lugar que a tela não
 * ocupa, e o `badge` é o slot que o componente reserva para o ESTADO.
 *
 * O "Erro 404" que era um parágrafo solto acima do título virou `badge`: é o
 * mesmo fato (o código da resposta), no lugar que o desenho define para ele —
 * ao lado do título, e não empilhado sobre ele.
 */
export const metadata = { title: 'Instituição não encontrada' };

export default function TenantNotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        title="Instituição não encontrada"
        badge={<Badge tone="neutral">Erro 404</Badge>}
        description="O endereço acessado não corresponde a nenhuma instituição ativa na plataforma. Verifique o link ou procure a página correta do evento."
      />

      <Link
        href="/"
        className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        Ir para a página inicial
      </Link>
    </main>
  );
}

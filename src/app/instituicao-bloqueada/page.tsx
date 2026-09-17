import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Lock, ShieldAlert } from 'lucide-react';

import { blockedNotice, isTrafficAllowed } from '@/domain/platform/platform-rules';
import { findTenantNotice } from '@/lib/platform/global-repository';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Página de instituição bloqueada
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA PÁGINA EXISTE (E POR QUE NÃO É A 404)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A suspensão de uma instituição não é um erro de digitação: é uma decisão da
 *  plataforma. Quem trabalha lá precisa entender que o sistema não perdeu os
 *  dados, e o MOTIVO precisa estar visível — foi por isso que a suspensão exige
 *  justificativa.
 *
 *  Uma 404 mandaria o dono procurar suporte achando que a instituição havia sido
 *  apagada. Esta página diz o que aconteceu, com o motivo informado e um caminho
 *  de contato.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ELA NÃO CONSULTA NADA DO CONTEÚDO BLOQUEADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nome, estado e motivo — e só. Nenhum evento, nenhuma pessoa, nenhuma
 *  contagem. Uma tela de bloqueio que mostra o que está bloqueado é uma tela de
 *  vazamento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata: Metadata = {
  title: 'Instituição indisponível',
  robots: { index: false, follow: false },
};

/** Não é página de conteúdo: nunca é cacheada nem indexada. */
export const dynamic = 'force-dynamic';

export default async function BlockedTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string; estado?: string }>;
}) {
  const { slug } = await searchParams;

  if (!slug) notFound();

  const tenant = await findTenantNotice(slug);
  if (!tenant) notFound();

  /**
   * Se a instituição voltou a operar, este endereço não faz mais sentido: em vez
   * de uma tela de bloqueio desatualizada (que alguém guardou nos favoritos), o
   * acesso é encaminhado para a página real.
   */
  if (isTrafficAllowed(tenant.status)) {
    redirect(`/t/${tenant.slug}`);
  }

  const notice = blockedNotice({
    tenantName: tenant.name,
    status: tenant.status,
    reason: tenant.suspensionReason,
  });

  const suspended = tenant.status === 'SUSPENDED';

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-6 py-16"
      data-testid="tenant-blocked"
      data-tenant-status={tenant.status}
    >
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
              suspended ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
            }`}
          >
            {suspended ? <Lock className="size-5" aria-hidden /> : <ShieldAlert className="size-5" aria-hidden />}
          </span>

          <div className="min-w-0">
            <p className="label-caps text-muted-foreground">
              {tenant.slug}
            </p>
            <h1 className="text-xl font-semibold text-foreground">{notice.title}</h1>
          </div>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{notice.body}</p>

        <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
          <p>
            Os dados da instituição estão preservados. Nada foi apagado — o acesso é que está
            interrompido.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/organizacoes"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Ver outras instituições
          </Link>
          <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Ir para a página inicial
          </Link>
        </div>
      </div>
    </main>
  );
}

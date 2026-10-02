import Link from 'next/link';
import { Building2, LogIn, LogOut, Palette, UserRound } from 'lucide-react';

import { signOutAction } from '@/app/actions/auth-actions';
import { ThemeChoice } from '@/components/theme/theme-choice';
import { TenantMenu, type MembershipSummary } from '@/components/tenancy/tenant-menu';
import { Avatar } from '@/components/ui/feedback';
import { buttonClasses } from '@/components/ui/button';
import { NAV_MODE_RAIL } from '@/lib/shell/nav-mode';
import { readNavMode } from '@/lib/shell/nav-mode-server';
import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BLOCO DE CONTA — rodapé do shell (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O MENU DE CONTEXTO MUDOU DE LUGAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Antes, o seletor de instituição e o botão "Sair" ficavam soltos no cabeçalho,
 *  sem relação visual com o nome do usuário. Quem procurava "trocar de
 *  instituição" tinha que adivinhar que o nome no topo era um menu.
 *
 *  Agora os três andam juntos: avatar + nome (gatilho do menu de contexto, que já
 *  existe desde a FASE 2) e "Sair" ao lado. Uma conta, um bloco.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ELE LÊ O ESTADO DA BARRA, EM VEZ DE RECEBÊ-LO (FASE 59)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este bloco chega ao shell como `ReactNode` já montado — ele atravessa a
 *  fronteira do layout como ELEMENTO, e não aceita prop nova depois de criado.
 *  Ler o mesmo cookie aqui (uma leitura por requisição, deduplicada pelo
 *  `cookies()`) mantém UM dono do estado — o cookie — em vez de criar um caminho
 *  paralelo para a mesma verdade.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function AccountBlock({
  user,
  memberships,
  currentSlug,
  className,
}: {
  user: { name: string; email: string };
  /** Ausente no painel de plataforma (não há contexto de instituição). */
  memberships?: readonly MembershipSummary[];
  currentSlug?: string;
  className?: string;
}) {
  /**
   * Barra recolhida: sobra o avatar.
   *
   * O bloco degrada em vez de sumir — a área de conta é o caminho para trocar de
   * instituição, ver a própria sessão e sair, e nenhuma dessas coisas pode
   * depender da largura da barra. O avatar fica; o nome e o e-mail viram
   * `sr-only`, e o seletor de contexto recebe um nome acessível explícito, porque
   * o avatar é decorativo (`aria-hidden`) e não nomearia coisa nenhuma.
   */
  const compact = (await readNavMode()) === NAV_MODE_RAIL;

  const identificacao = (
    <span className={cn('flex min-w-0 items-center gap-2.5', compact && 'justify-center')}>
      <Avatar name={user.name} size="sm" />
      <span className={cn('min-w-0', compact && 'sr-only')}>
        <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
      </span>
    </span>
  );

  return (
    /**
     * `min-w-0` na LINHA e `shrink-0` nos dois botões: o seletor de instituição é quem
     * encolhe (e trunca nome/e-mail); o tema e o sair nunca são espremidos para fora da
     * barra — foi assim que o botão de sair apareceu cortado na borda (FASE 61).
     */
    <div className={cn('flex min-w-0 items-center gap-2', compact && 'flex-col', className)}>
      {memberships && currentSlug ? (
        <TenantMenu
          memberships={memberships}
          currentSlug={currentSlug}
          compact={compact}
          label={compact ? `Conta de ${user.name}` : undefined}
        >
          {identificacao}
        </TenantMenu>
      ) : (
        identificacao
      )}

      {/**
        * ───────────────────────────────────────────────────────────────────────────
        *  O TEMA MORA ONDE A PESSOA JÁ PROCURA PELO QUE É DELA (FASE 61)
        * ───────────────────────────────────────────────────────────────────────────
        *  O menu de conta é o lugar que existe em TODAS as telas do sistema — no
        *  painel da instituição, na governança da plataforma e (via `/conta`) fora
        *  de qualquer casa. Um controle de aparência escondido numa tela de
        *  configuração seria encontrado por quem já sabe que ele existe.
        *
        *  É um `<details>` e não um menu controlado por JavaScript: abre antes de o
        *  React hidratar, fecha com `Esc` nativamente e não guarda estado nenhum no
        *  cliente — o mesmo desenho do seletor de instituição ao lado. Na barra
        *  recolhida ele encolhe para o ícone, com o nome preservado em `sr-only`.
        */}
      <details className="relative shrink-0">
        <summary
          title="Tema da interface"
          data-testid="account-theme-menu"
          className="inline-flex size-9 cursor-pointer list-none items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground"
        >
          <Palette className="size-4" aria-hidden />
          <span className="sr-only">Tema da interface</span>
        </summary>

        <div className="absolute left-0 bottom-full z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <ThemeChoice />
        </div>
      </details>

      <form action={signOutAction} className="shrink-0">
        <button
          type="submit"
          title="Sair da conta"
          aria-label="Sair da conta"
          data-testid="sign-out"
          className="inline-flex size-9 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground"
        >
          <LogOut className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}

/**
 * Cabeçalho público da instituição.
 *
 * Vive fora do shell autenticado, mas usa a MESMA tipografia, os mesmos tokens e os
 * mesmos botões — é o que faz a página pública pertencer ao produto, e não parecer
 * um site separado. A identidade mostrada é a da INSTITUIÇÃO (logo e nome), porque
 * é dela a vitrine; a plataforma assina no rodapé.
 */
export function PublicHeader({
  tenant,
  isAuthenticated,
  loginHref,
  accountHref,
  className,
}: {
  tenant: { slug: string; name: string; logoUrl: string | null };
  isAuthenticated: boolean;
  loginHref: string;
  accountHref: string;
  className?: string;
}) {
  return (
    <header className={cn('border-b border-border bg-card', className)}>
      <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
        <Link href={`/t/${tenant.slug}`} className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-low text-on-surface-variant">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt="" className="size-full object-cover" />
            ) : (
              <Building2 className="size-5" aria-hidden />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-body-lg font-semibold text-foreground">
              {tenant.name}
            </span>
            <span className="label-caps">Eventos e inscrições</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-2">
          <Link
            href={`/t/${tenant.slug}/eventos`}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            Programação
          </Link>
          <Link href="/organizacoes" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            Instituições
          </Link>

          {isAuthenticated ? (
            <Link href={accountHref} className={buttonClasses({ size: 'sm' })}>
              <UserRound className="size-4" aria-hidden />
              Minha área
            </Link>
          ) : (
            <Link href={loginHref} className={buttonClasses({ size: 'sm' })}>
              <LogIn className="size-4" aria-hidden />
              Entrar
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Rodapé público — assinatura da plataforma, discreta. */
export function PublicFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t border-border bg-card', className)}>
      <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground lg:px-8">
        <p>
          Organizado com <span className="font-medium text-foreground">EventFlow</span> —
          plataforma de eventos acadêmicos, corporativos e comunitários.
        </p>
        <Link href="/organizacoes" className="underline-offset-4 hover:text-foreground hover:underline">
          Descobrir outras instituições
        </Link>
      </div>
    </footer>
  );
}

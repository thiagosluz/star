import Link from 'next/link';
import { Building2, LogIn, LogOut, UserRound } from 'lucide-react';

import { signOutAction } from '@/app/actions/auth-actions';
import { TenantMenu, type MembershipSummary } from '@/components/tenancy/tenant-menu';
import { Avatar } from '@/components/ui/feedback';
import { buttonClasses } from '@/components/ui/button';
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
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function AccountBlock({
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
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="min-w-0 flex-1">
        {memberships && currentSlug ? (
          <TenantMenu memberships={memberships} currentSlug={currentSlug}>
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar name={user.name} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {user.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </span>
            </span>
          </TenantMenu>
        ) : (
          <span className="flex min-w-0 items-center gap-2.5 px-2 py-1">
            <Avatar name={user.name} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {user.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
          </span>
        )}
      </div>

      <form action={signOutAction}>
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

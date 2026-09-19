import Link from 'next/link';
import { Building2, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { MobileNav } from '@/components/shell/mobile-nav';
import { NavLink } from '@/components/ui/navigation';
import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SHELL DO SISTEMA — a moldura de toda tela autenticada (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDA EM RELAÇÃO À NAVEGAÇÃO ANTERIOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Antes: uma faixa horizontal no topo, com 11 destinos em ordem de chegada
 *  histórica ("Painel, Eventos, Minhas inscrições, Submissões, Comitê, Revisões,
 *  Conquistas, Cartas, Certificados, Credenciamento, Administração"). Nada dizia
 *  o que era do participante e o que era da gestão, e em telas menores metade
 *  ficava escondida.
 *
 *  Agora: barra lateral fixa, com os mesmos destinos **agrupados por intenção**
 *  (Participação · Comitê científico · Operação · Administração), ícone em cada
 *  item, estado ativo derivado da rota e gaveta no mobile. O mesmo componente
 *  serve à instituição e à plataforma (`variant`), o que garante que as duas
 *  áreas pareçam o mesmo produto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FILTRAGEM POR PERMISSÃO CONTINUA NO SERVIDOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este componente RECEBE a navegação já filtrada (quem decide é `can()`, na
 *  página que o usa). Shell não conhece RBAC: se conhecesse, haveria dois lugares
 *  decidindo o que aparece — e o segundo envelheceria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface ShellNavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Item de raiz de seção: só fica ativo na rota exata. */
  exact?: boolean;
}

export interface ShellNavGroup {
  title: string;
  items: readonly ShellNavItem[];
}

export interface ShellContext {
  /** Nome exibido no bloco de contexto (instituição ou plataforma). */
  name: string;
  /** Linha secundária: papéis, plano, e-mail do operador. */
  detail?: string;
  logoUrl?: string | null;
  /** Rota do bloco de contexto (ex.: seletor de instituição). */
  href?: string;
  /** `data-testid` do bloco — os testes E2E usam `active-tenant`. */
  testId?: string;
}

export function ShellNav({ groups }: { groups: readonly ShellNavGroup[] }) {
  return (
    <nav aria-label="Navegação principal" className="space-y-6">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="label-caps px-3 pb-1">{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    exact={item.exact}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
    </nav>
  );
}

function ShellContextBlock({ context, variant }: { context: ShellContext; variant: 'tenant' | 'platform' }) {
  const badge = variant === 'platform' ? 'Plataforma' : undefined;

  const content = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-low text-on-surface-variant">
        {context.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={context.logoUrl} alt="" className="size-full object-cover" />
        ) : variant === 'platform' ? (
          <ShieldCheck className="size-5" aria-hidden />
        ) : (
          <Building2 className="size-5" aria-hidden />
        )}
      </span>

      <span className="min-w-0" data-testid={context.testId}>
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{context.name}</span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium tracking-wide text-brand uppercase">
              {badge}
            </span>
          ) : null}
        </span>
        {context.detail ? (
          <span className="block truncate text-xs text-muted-foreground">{context.detail}</span>
        ) : null}
      </span>
    </div>
  );

  return context.href ? (
    <Link
      href={context.href}
      className="block rounded-md p-2 transition-colors hover:bg-surface-low"
      title="Trocar contexto"
    >
      {content}
    </Link>
  ) : (
    <div className="p-2">{content}</div>
  );
}

export function AppShell({
  variant = 'tenant',
  brand,
  context,
  navGroups,
  account,
  children,
  contentClassName,
}: {
  variant?: 'tenant' | 'platform';
  brand?: { label: string; tagline?: string };
  context: ShellContext;
  navGroups: readonly ShellNavGroup[];
  account: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  const brandLabel = brand?.label ?? 'EventFlow';

  return (
    <div className="flex min-h-screen bg-surface">
      {/* ── Barra lateral (desktop) ─────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-5 py-4">
          <p className="font-display text-title text-foreground">{brandLabel}</p>
          {brand?.tagline ? (
            <p className="label-caps mt-0.5">{brand.tagline}</p>
          ) : null}
        </div>

        <div className="border-b border-border py-2">
          <ShellContextBlock context={context} variant={variant} />
        </div>

        {/**
         * `min-h-0` é OBRIGATÓRIO aqui, e não é detalhe de estilo.
         *
         * Um item flex em coluna tem `min-height: auto`: nunca encolhe abaixo do próprio
         * conteúdo — exatamente o que `flex-1 overflow-y-auto` precisa que ele faça. Sem
         * o `min-h-0`, um grupo de menu a mais faz a barra lateral (que é `h-screen`)
         * transbordar, e o rodapé da conta é empurrado para FORA da tela: o seletor de
         * instituição fica inalcançável. Foi o E2E que pegou, ao clicar no menu de troca
         * com a navegação já cheia.
         */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <ShellNav groups={navGroups} />
        </div>

        <div className="border-t border-border px-4 py-4">{account}</div>
      </aside>

      {/* ── Conteúdo ────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
          {/**
           * A gaveta NÃO repete o bloco de contexto (instituição/papéis).
           *
           * Dois motivos: a barra superior já mostra o nome ao lado do botão, e o
           * bloco de conta — no rodapé da gaveta — já traz o seletor de instituição.
           * Repetir criava `data-testid="active-tenant"` DUAS vezes no DOM, e o
           * Playwright reprova em modo estrito (`resolved to 2 elements`) mesmo com
           * um dos elementos escondido por CSS. Foi assim que a suíte E2E pegou.
           */}
          <MobileNav brandLabel={brandLabel} nav={<ShellNav groups={navGroups} />} account={account} />
          <span className="min-w-0 flex-1 truncate font-display text-body-lg font-semibold text-foreground">
            {context.name}
          </span>
        </header>

        <main className={cn('flex-1 px-4 py-6 lg:px-8 lg:py-8', contentClassName)}>
          <div className="mx-auto w-full max-w-[var(--content-max)]">{children}</div>
        </main>
      </div>
    </div>
  );
}

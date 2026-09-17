'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NAVEGAÇÃO — trilha, título de página e itens de menu (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA FASE CHAMA DE "NAVEGABILIDADE"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não é só um menu melhor: é a pessoa saber ONDE ESTÁ e COMO VOLTAR. As três
 *  peças abaixo cobrem isso em qualquer tela:
 *    • `Breadcrumbs` — o caminho até aqui, com o último item não clicável;
 *    • `PageHeader`   — o título da tela e as ações dela, no mesmo lugar sempre;
 *    • `NavLink`      — item de menu que sabe se está ativo (por rota, não por
 *      prop passada à mão, que é como os menus divergiam entre as telas).
 *
 *  O estado ativo é derivado de `usePathname`: a tela nova não precisa avisar
 *  nada ao menu, e por isso não há como esquecer de avisar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: readonly Crumb[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Trilha de navegação" className={cn('flex items-center gap-1.5', className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? (
              <ChevronRight className="size-3.5 text-on-surface-variant/60" aria-hidden />
            ) : null}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? 'page' : undefined}
                className="text-xs font-medium text-foreground"
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * Cabeçalho padrão de tela.
 *
 * Toda página do sistema começa por aqui: mesma trilha, mesmo tamanho de título,
 * mesmas ações à direita. É o que faz telas diferentes parecerem o mesmo produto.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  badge,
  className,
  ...props
}: ComponentProps<'header'> & {
  title: string;
  description?: ReactNode;
  breadcrumbs?: readonly Crumb[];
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <header className={cn('space-y-4', className)} {...props}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-title-lg text-foreground">{title}</h1>
            {badge}
          </div>
          {description ? (
            <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * Item de menu com estado ativo derivado da rota.
 *
 * `exact` existe para o item "raiz" de uma seção (`/t/<slug>/administracao`), que
 * de outra forma ficaria sempre ativo, porque toda sub-rota começa com ele.
 */
export function NavLink({
  href,
  icon,
  label,
  exact = false,
  className,
  onNavigate,
}: {
  href: string;
  icon?: ReactNode;
  label: string;
  exact?: boolean;
  className?: string;
  /** Fechar a gaveta no mobile depois de navegar. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-primary-soft font-medium text-brand'
          : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
        className,
      )}
    >
      {icon ? (
        <span className={cn('shrink-0', active ? 'text-brand' : 'text-on-surface-variant')}>
          {icon}
        </span>
      ) : null}
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Abas de navegação por rota (mesma URL, seções irmãs). */
export function TabNav({
  items,
  className,
}: {
  items: readonly { href: string; label: string; badge?: ReactNode }[];
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Seções"
      className={cn('flex flex-wrap gap-1 border-b border-border', className)}
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.badge}
          </Link>
        );
      })}
    </nav>
  );
}

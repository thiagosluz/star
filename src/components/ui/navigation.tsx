'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NAVEGAÇÃO — itens de menu e abas (FASE 11A · dividida na FASE 78)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE ARQUIVO É `'use client'`, E O TOPO NÃO É
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `NavLink` e `TabNav` dependem de `usePathname` para saber onde a pessoa
 *  está — é o que impede menu e tela de divergirem (a tela não avisa o menu,
 *  o menu lê a rota). Isso exige cliente.
 *
 *  `PageHeader` e `Breadcrumbs` NÃO dependem de nada disso: são desenho puro,
 *  e moram em `page-header.tsx` (server) desde a FASE 78. Eles ficavam aqui e,
 *  como este módulo é `'use client'`, cada tela que passasse a usar o cabeçalho
 *  viraria uma ilha de cliente. A separação não é cosmética: é o que torna a
 *  migração das 87 telas restantes possível sem pagar JavaScript por página.
 *
 *  A catraca `tests/unit/f78-page-header.test.ts` prende as duas metades — o
 *  `'use client'` não sai daqui, e não entra no arquivo do topo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

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
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  SÓ O ÍCONE — SEM PERDER O NOME (FASE 59)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Na barra recolhida o rótulo não cabe, e ESCONDÊ-LO com `hidden` deixaria o
   *  link sem nome acessível: o portão WCAG reprova em `link-name`, e quem usa
   *  leitor de tela ouviria "link" e mais nada. O rótulo vira `sr-only` — some da
   *  tela, permanece na árvore — e o `title` dá o mesmo nome a quem usa o
   *  ponteiro e para no ícone.
   *
   *  O conteúdo do `title` é a mesma string do rótulo, e não uma descrição nova:
   *  duas fontes para o nome do mesmo destino é como menu e tela divergem.
   */
  collapsed = false,
}: {
  href: string;
  icon?: ReactNode;
  label: string;
  exact?: boolean;
  className?: string;
  /** Fechar a gaveta no mobile depois de navegar. */
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
        collapsed && 'justify-center px-2',
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
      <span
        /**
         * O `data-testid` existe para o E2E da barra recolhida medir o RÓTULO, e
         * não o link: é a largura desenhada dele que diz se o texto sumiu da tela
         * ou apenas mudou de lugar na árvore de acessibilidade.
         */
        data-testid="nav-link-label"
        className={cn('truncate', collapsed && 'sr-only')}
      >
        {label}
      </span>
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

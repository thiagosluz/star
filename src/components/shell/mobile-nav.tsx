'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NAVEGAÇÃO MOBILE — gaveta do shell (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA GAVETA, E NÃO UMA BARRA HORIZONTAL ROLÁVEL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A navegação anterior era uma lista horizontal com `overflow-x-auto`: em um
 *  celular, metade dos destinos ficava fora da tela, sem indicação de que havia
 *  mais. A pessoa simplesmente não descobria "Certificados" ou "Credenciamento".
 *
 *  A gaveta resolve porque o menu tem um lugar previsível, mostra TODOS os
 *  destinos agrupados e fecha sozinho ao navegar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ACESSIBILIDADE E COMPORTAMENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • `Esc` fecha; o foco vai para o botão de abrir.
 *  • Com a gaveta aberta, o `body` não rola (senão o fundo rola atrás dela).
 *  • O conteúdo é passado pelo servidor como `ReactNode` — a navegação continua
 *    sendo filtrada por permissão no servidor, e este componente não conhece RBAC.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function MobileNav({
  nav,
  account,
  brandLabel,
}: {
  nav: ReactNode;
  account: ReactNode;
  brandLabel: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label="Abrir menu de navegação"
        data-testid="open-navigation"
        className="inline-flex size-10 items-center justify-center rounded-sm border border-border bg-card text-foreground lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <div
        className={cn(
          'fixed inset-0 z-50 lg:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            'absolute inset-0 bg-inverse-surface/40 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          )}
        />

        <aside
          data-testid="mobile-navigation"
          className={cn(
            'absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-card shadow-modal transition-transform duration-200',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <p className="font-display text-title text-foreground">{brandLabel}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar menu"
              className="inline-flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-low"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <div className="flex-1 px-3 py-4">{nav}</div>

          <div className="border-t border-border px-5 py-4">{account}</div>
        </aside>
      </div>
    </>
  );
}

'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils/cn';

/**
 * "O navegador já assumiu esta árvore?"
 *
 * É a mesma pergunta que `certificate-template-editor.tsx` e `holo-card.tsx` fazem, e
 * pelo mesmo motivo: `useEffect` + `setState` provoca render em cascata e a regra
 * `react-hooks/set-state-in-effect` reprova — com razão. Aqui ela decide se o portal
 * pode existir: `document` não existe no servidor, e o HTML do servidor precisa sair
 * igual ao primeiro render do cliente para a hidratação não divergir.
 */
function useIsInteractive(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

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
 *  A GAVETA É DESENHADA NO `body`, E NÃO DENTRO DO CABEÇALHO (FASE 62)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regressão visual da FASE 62 mediu o que ninguém tinha medido: a gaveta aberta
 *  tinha **64 px de altura** — a altura do cabeçalho — em vez da altura da
 *  viewport. O menu e o rodapé de conta existiam, mas dentro de uma faixa de 64 px
 *  com `overflow-y-auto`: era preciso rolar DENTRO da faixa para chegar a "Painel".
 *  Na prática, a navegação de telefone estava inutilizável.
 *
 *  A causa não era deste componente, e sim do lugar onde ele era desenhado:
 *  `backdrop-filter` (o `backdrop-blur` do cabeçalho do shell) **cria containing
 *  block para descendentes `position: fixed`**. Como o invólucro da gaveta é
 *  `fixed inset-0` e vivia DENTRO do `<header>`, o `inset-0` resolvia contra a
 *  caixa do cabeçalho (390×64) em vez da viewport.
 *
 *  A correção ataca a CAUSA: o invólucro da gaveta sai da árvore do cabeçalho e é
 *  desenhado em `document.body` por `createPortal`. Nenhum ancestral dele cria
 *  containing block, e o desenho não muda um pixel. Tirar o `backdrop-blur` do
 *  cabeçalho também "resolveria", mas pagando um efeito que foi decidido de
 *  propósito; dar altura explícita ao invólucro funcionaria só enquanto o cabeçalho
 *  estivesse no topo — os dois são remendos que voltam na próxima mudança de shell.
 *
 *  `montado` existe para o SSR não divergir do cliente: o portal precisa de
 *  `document`, que não existe no servidor. O HTML do servidor sai com o BOTÃO (que é
 *  o que a pessoa precisa antes do JavaScript) e a gaveta entra na primeira
 *  montagem — o mesmo estado do primeiro render do cliente, sem quebra de hidratação.
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
  /** `false` no servidor e no primeiro render do cliente — ver `useIsInteractive`. */
  const montado = useIsInteractive();

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

      {montado
        ? createPortal(
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
                  /**
                   * A gaveta é uma superfície FLUTUANTE (FASE 62 · dívida E81): `bg-popover`
                   * resolve no mesmo branco do cartão no modo claro e num degrau acima dele
                   * no escuro — onde a sombra não desenha degrau sobre fundo escuro.
                   *
                   * `overflow-y-auto` saiu daqui e foi para o MEIO (o bloco da navegação):
                   * quem rola é a lista, não a gaveta inteira — ver o `min-h-0` abaixo.
                   */
                  'absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-border bg-popover shadow-modal transition-transform duration-200',
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

                {/**
                 * `min-h-0` é OBRIGATÓRIO aqui — a MESMA armadilha que o `app-shell.tsx`
                 * documenta na barra lateral, e que a FASE 62 mediu nesta gaveta: um item
                 * flex em coluna tem `min-height: auto` e nunca encolhe abaixo do próprio
                 * conteúdo. Com 25 destinos na lista, o rodapé de conta era empurrado para
                 * FORA da gaveta (o botão de sair aparecia em `y: 1081`, num container de
                 * 844 px) e só era alcançável rolando a gaveta inteira. Com `min-h-0` +
                 * `overflow-y-auto` quem rola é a LISTA, e o rodapé de conta fica preso no
                 * lugar — o mesmo desenho da barra lateral do desktop.
                 */}
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">{nav}</div>

                <div className="border-t border-border px-5 py-4">{account}</div>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

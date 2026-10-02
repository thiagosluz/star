import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { toggleNavModeAction } from '@/app/actions/nav-actions';
import { NAV_MODE_RAIL, type NavMode } from '@/lib/shell/nav-mode';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BOTÃO DE RECOLHER A BARRA LATERAL (FASE 59)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM `<form>` E UM BOTÃO — DE PROPÓSITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não há `useState` aqui, e não é economia: o estado da barra é o cookie, lido
 *  no servidor. Se este botão carregasse o estado no cliente, haveria DUAS
 *  fontes para a mesma verdade — e elas divergem no primeiro F5 feito em outra
 *  aba. Sendo um `<form>` com Server Action, ele funciona antes de qualquer
 *  JavaScript carregar: o navegador envia, o servidor inverte o cookie e
 *  redesenha a página.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O NOME ACESSÍVEL DIZ A AÇÃO, NÃO O ESTADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Recolher menu" × "Expandir menu" é o nome; `aria-expanded` é quem informa o
 *  estado. É o que o portão WCAG cobra (e o que um leitor de tela precisa ouvir
 *  antes de ativar o controle). O ícone sozinho seria um botão sem nome — a
 *  mesma falha que reprova um link só com ícone.
 *
 *  O rótulo fica em `sr-only` porque a barra recolhida não tem largura para
 *  texto: o nome continua existindo para quem ouve a tela, e o `title` atende
 *  quem usa o ponteiro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function NavCollapseToggle({ mode }: { mode: NavMode }) {
  const recolhida = mode === NAV_MODE_RAIL;
  const rotulo = recolhida ? 'Expandir menu' : 'Recolher menu';

  return (
    <form action={toggleNavModeAction} className="shrink-0">
      <button
        type="submit"
        title={rotulo}
        aria-expanded={!recolhida}
        data-testid="nav-collapse-toggle"
        className="inline-flex size-9 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground"
      >
        {recolhida ? (
          <PanelLeftOpen className="size-4" aria-hidden />
        ) : (
          <PanelLeftClose className="size-4" aria-hidden />
        )}
        <span className="sr-only">{rotulo}</span>
      </button>
    </form>
  );
}

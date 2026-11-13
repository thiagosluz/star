'use client';

import { useEffect } from 'react';

export const KOVENO_UNSAVED_LEAVE_REQUEST_EVENT = 'koveno:unsaved-leave-request';

export interface UnsavedLeaveRequestDetail {
  href: string;
  message: string;
  title?: string;
}

// Permite concluir uma saída externa/documental depois que o usuário já confirmou no modal do sistema
let bypassNextBeforeUnload = false;

export function allowNextUnload() {
  bypassNextBeforeUnload = true;
}

export function requestUnsavedLeave(detail: UnsavedLeaveRequestDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('koveno:navigation-cancel'));
  window.dispatchEvent(
    new CustomEvent<UnsavedLeaveRequestDetail>(KOVENO_UNSAVED_LEAVE_REQUEST_EVENT, {
      detail,
    }),
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PREVENÇÃO DE PERDA DE RASCUNHO EM EDITORES CRÍTICOS (FASE 103 · ADR-431)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PROTEÇÃO CONTRA NAVEGAÇÃO ACIDENTAL COM DIÁLOGO DO SISTEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Em editores visuais e formulários complexos (submissão, parecer, decisão,
 *  proposta e editor de certificados), cliques acidentais em links do menu
 *  lateral, breadcrumbs ou cabeçalho descartariam dados não salvos.
 *
 *  Este hook intercepta:
 *    1. `beforeunload`: aciona o aviso nativo exigido pelo navegador ao fechar
 *       ou recarregar a aba;
 *    2. Cliques em links internos (`capture: true`): cancela a barra de progresso
 *       global e solicita confirmação via `<UnsavedChangesDialog />` (`ConfirmDialog`
 *       do sistema), eliminando o antigo `window.confirm` do navegador.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function useUnsavedChanges(
  isDirty: boolean,
  message = 'Você tem alterações não salvas no rascunho. Se sair agora, o que ainda não foi salvo será perdido.',
) {
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassNextBeforeUnload) {
        bypassNextBeforeUnload = false;
        return;
      }
      e.preventDefault();
      e.returnValue = '';
    };

    const handleClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      // Cliques com modificadores ou botão auxiliar abrem nova aba/janela e não descartam o rascunho atual
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (anchor.hasAttribute('data-bypass-unsaved-guard')) return;

      const href = anchor.getAttribute('href');
      if (
        !href ||
        href.startsWith('#') ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:')
      ) {
        return;
      }
      if (anchor.href === window.location.href) return;

      e.preventDefault();
      e.stopPropagation();
      requestUnsavedLeave({ href: anchor.href, message });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClick, true);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClick, true);
    };
  }, [isDirty, message]);
}

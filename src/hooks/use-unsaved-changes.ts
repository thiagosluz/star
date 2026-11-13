'use client';

import { useEffect } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PREVENÇÃO DE PERDA DE RASCUNHO EM EDITORES CRÍTICOS (FASE 103 · ADR-431)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PROTEÇÃO CONTRA NAVEGAÇÃO ACIDENTAL E FECHAMENTO DE ABA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Em editores visuais e formulários complexos (como o editor visual de certificados),
 *  qualquer recarga acidental, clique em breadcrumb ou fechar de aba descartaria
 *  minutos de diagramação.
 *
 *  Este hook intercepta:
 *    1. `beforeunload`: aciona o diálogo nativo do navegador para fechar ou recarregar a aba;
 *    2. Cliques em links locais: captura na fase de captura (`capture: true`) e pergunta
 *       ao operador se deseja descartar as alterações não salvas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function useUnsavedChanges(
  isDirty: boolean,
  message = 'Você tem alterações não salvas no rascunho. Deseja realmente sair desta página?',
) {
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
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
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      if (anchor.href === window.location.href) return;

      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClick, true);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClick, true);
    };
  }, [isDirty, message]);
}


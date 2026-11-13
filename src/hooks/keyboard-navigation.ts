/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GUARDAS DE NAVEGAÇÃO POR TECLADO EM LISTAS OPERACIONAIS (FASE 105 · ADR-435)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SEPARAR A GUARDA DE ALVO E O LIMITE DE ÍNDICE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Listeners globais em `window` permitem operar filas e diretórios com setas
 *  (`ArrowDown`/`ArrowUp`), `Enter` e `Espaço`. Sem esta guarda:
 *    1. Pressionar `Enter` ou `Espaço` com o foco em um link, botão de página ou
 *       menu lateral sequestraria a ação do elemento focado;
 *    2. Quando a lista encolhe após uma filtragem, o índice ativo ficaria fora
 *       dos limites até a próxima interação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface ListKeyEventLike {
  key: string;
  defaultPrevented?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target: EventTarget | null;
}

export function shouldIgnoreListKeyEvent(event: ListKeyEventLike): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return true;
  }

  const target = event.target;
  if (!target || typeof target !== 'object') {
    return false;
  }

  const element = target as Partial<HTMLElement> & { tagName?: string };
  const tagName = element.tagName?.toUpperCase();

  if (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    element.isContentEditable
  ) {
    return true;
  }

  if (
    (event.key === 'Enter' || event.key === ' ') &&
    typeof element.closest === 'function' &&
    element.closest('a, button, [role="button"], summary') !== null
  ) {
    return true;
  }

  return false;
}

export function clampListIndex(index: number | null, length: number): number | null {
  if (index === null || length <= 0) {
    return null;
  }
  return Math.max(0, Math.min(index, length - 1));
}


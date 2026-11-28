'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HOOK — Estado do Estúdio de Certificados com Undo/Redo e Blocos (FASE 131)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useState } from 'react';

import {
  MAX_LAYOUT_ELEMENTS,
  type CertificatePageFormat,
} from '@/domain/certificates/certificate-layout-rules';
import {
  STUDIO_QUICK_BLOCKS,
  alignElementOnPage,
  createStudioHistory,
  pushStudioHistory,
  redoStudioHistory,
  undoStudioHistory,
  type StudioPageAlignAction,
  type StudioQuickBlockId,
} from '@/domain/certificates/certificate-studio-rules';
import { emptyElement, type EditorElement } from '@/components/admin/certificate-template/types';

export function useTemplateStudio(initialElements: EditorElement[], page: CertificatePageFormat) {
  const [history, setHistory] = useState(() => createStudioHistory(initialElements));
  const [selected, setSelected] = useState<number | null>(initialElements.length > 0 ? 0 : null);

  const elements = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const commit = useCallback((updater: (current: EditorElement[]) => EditorElement[]) => {
    setHistory((prev) => pushStudioHistory(prev, updater(prev.present)));
  }, []);

  const update = useCallback(
    (index: number, patch: Partial<EditorElement>) => {
      commit((current) =>
        current.map((element, position) =>
          position === index ? { ...element, ...patch } : element,
        ),
      );
    },
    [commit],
  );

  const addElement = useCallback(() => {
    setHistory((prev) => {
      if (prev.present.length >= MAX_LAYOUT_ELEMENTS) return prev;
      const next = [...prev.present, emptyElement(prev.present.length)];
      setSelected(next.length - 1);
      return pushStudioHistory(prev, next);
    });
  }, []);

  const addQuickBlock = useCallback(
    (blockId: StudioQuickBlockId) => {
      const block = STUDIO_QUICK_BLOCKS.find((item) => item.id === blockId);
      if (!block) return;

      setHistory((prev) => {
        if (prev.present.length >= MAX_LAYOUT_ELEMENTS) return prev;
        const created = block.build(page, prev.present.length);
        const next = [...prev.present, created];
        setSelected(next.length - 1);
        return pushStudioHistory(prev, next);
      });
    },
    [page],
  );

  const duplicateSelected = useCallback(() => {
    if (selected === null) return;
    setHistory((prev) => {
      const source = prev.present[selected];
      if (!source || prev.present.length >= MAX_LAYOUT_ELEMENTS) return prev;
      const copy: EditorElement = {
        ...source,
        id: `${source.id}-copia-${prev.present.length + 1}`,
        xMm: Math.min(source.xMm + 6, 260),
        yMm: Math.min(source.yMm + 6, 260),
      };
      const next = [...prev.present, copy];
      setSelected(next.length - 1);
      return pushStudioHistory(prev, next);
    });
  }, [selected]);

  const removeElement = useCallback((index: number) => {
    setHistory((prev) => {
      const next = prev.present.filter((_, position) => position !== index);
      return pushStudioHistory(prev, next);
    });
    setSelected((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  }, []);

  const alignSelected = useCallback(
    (action: StudioPageAlignAction) => {
      if (selected === null) return;
      commit((current) =>
        current.map((element, position) => {
          if (position !== selected) return element;
          const aligned = alignElementOnPage({ element, page, action });
          return { ...element, ...aligned };
        }),
      );
    },
    [selected, page, commit],
  );

  const undo = useCallback(() => {
    setHistory((prev) => undoStudioHistory(prev));
  }, []);

  const redo = useCallback(() => {
    setHistory((prev) => redoStudioHistory(prev));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return {
    elements,
    selected,
    setSelected,
    canUndo,
    canRedo,
    update,
    addElement,
    addQuickBlock,
    duplicateSelected,
    removeElement,
    alignSelected,
    undo,
    redo,
  };
}

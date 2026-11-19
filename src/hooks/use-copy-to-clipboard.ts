'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HOOK — Cópia para área de transferência com retorno temporário (FASE 117 · ADR-474)
 *
 *  Substitui o padrão repetido de `useState` + `navigator.clipboard.writeText` +
 *  `setTimeout` sem limpeza no unmount. Suporta múltiplos itens por chave (`key`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_COPY_KEY = 'default';

export interface UseCopyToClipboardResult {
  copiedKey: string | null;
  isCopied: (key?: string) => boolean;
  copy: (text: string, key?: string) => Promise<boolean>;
}

export function useCopyToClipboard(resetMs = 2_000): UseCopyToClipboardResult {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    async (text: string, key = DEFAULT_COPY_KEY): Promise<boolean> => {
      try {
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
          return false;
        }
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          setCopiedKey((current) => (current === key ? null : current));
          timerRef.current = null;
        }, resetMs);
        return true;
      } catch {
        return false;
      }
    },
    [resetMs],
  );

  const isCopied = useCallback(
    (key = DEFAULT_COPY_KEY): boolean => copiedKey === key,
    [copiedKey],
  );

  return { copiedKey, isCopied, copy };
}

'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HOOK — Detecção segura de hidratação no cliente (FASE 117 · ADR-474)
 *
 *  Usa `useSyncExternalStore` com callbacks em escopo de módulo para evitar
 *  `useEffect` + `setState` (regra `react-hooks/set-state-in-effect`) e manter
 *  SSR e primeiro render do cliente idênticos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useSyncExternalStore } from 'react';

function emptySubscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

/** `false` no servidor e na hidratação inicial; `true` assim que o cliente assume. */
export function useIsInteractive(): boolean {
  return useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
}

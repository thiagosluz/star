'use client';

import { forwardRef, type AnchorHTMLAttributes } from 'react';
import Link, { type LinkProps } from 'next/link';

import { startNavigationProgress } from './navigation-progress-bar';

export interface AppLinkProps
  extends LinkProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> {
  skipProgress?: boolean;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AppLink — Link Canônico da Plataforma Koveno (FASE 101 · ADR-423)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EXISTE E POR QUE USA ONNAVIGATE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No App Router do Next.js 16, <Link> expõe a prop `onNavigate`, invocada pelo
 *  client router exatamente quando a navegação no cliente vai acontecer de fato
 *  (após validar URLs locais, alvos diferentes de _blank e cliques não modificados).
 *
 *  AppLink aproveita essa integração nativa do Next.js 16 para disparar
 *  `startNavigationProgress()` de forma determinística, permitindo também
 *  que navegações que não devam exibir a barra usem `skipProgress`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  { skipProgress, onNavigate, ...props },
  ref,
) {
  return (
    <Link
      ref={ref}
      onNavigate={(e) => {
        if (!skipProgress) {
          startNavigationProgress();
        }
        onNavigate?.(e);
      }}
      {...props}
    />
  );
});


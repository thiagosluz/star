'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FEEDBACK INSTANTÂNEO DE TRANSIÇÃO DE ROTA — `RouteProgress` (FASE 97 · ADR-410)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE CLIENT-SIDE NO `AppShell` E NÃO `loading.tsx` NO LAYOUT PAI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No Next.js 16 + React 19, colocar `loading.tsx` em `/t/[tenantSlug]/(app)` ou
 *  `/superadmin` envolve toda `page.tsx` filha em `<Suspense>` já na renderização
 *  inicial de documento HTML (`renderToStream` / `renderToWebFizzStream`). Como o
 *  layout pai resolve antes da página filha:
 *    1. O servidor despacha `HTTP 200 OK` + `<template id="B:0">` antes de `page.tsx`
 *       executar `notFound()` ou `redirect()`, convertendo respostas reais de 404 e
 *       307 em HTTP 200 (e `htmlLimitedBots` afeta apenas `serveStreamingMetadata`,
 *       não `supportsDynamicResponse`).
 *    2. A página real é enviada dentro de `<div hidden id="S:0">`, que depende de
 *       `<script>$RC("B:0","S:0")</script>` para ficar visível — quebrando o contrato
 *       de aprimoramento progressivo (`javaScriptEnabled: false`).
 *
 *  Em vez de envolver o SSR num `<Suspense>` global, `RouteProgress` atua exatamente
 *  onde ocorre a sensação de travamento em rede real: na navegação SPA entre rotas
 *  internas (`<Link>` / `<a href>`), exibindo feedback imediato na casca (`AppShell`)
 *  sem interferir no status HTTP 404/307 nem na visibilidade sem JavaScript.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function RouteProgress({
  variant = 'tenant',
  forceVisible = false,
}: {
  variant?: 'tenant' | 'platform';
  forceVisible?: boolean;
}) {
  const pathname = usePathname();
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  const isNavigating = forceVisible || (navigatingTo !== null && navigatingTo !== pathname);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;

      if (
        (anchor.target && anchor.target !== '_self') ||
        anchor.hasAttribute('download')
      ) {
        return;
      }

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (url.origin !== window.location.origin) return;

      // Mesmo pathname: não dispara barra de transição de página.
      if (url.pathname === window.location.pathname) return;

      setNavigatingTo(url.pathname);
    }

    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, []);

  useEffect(() => {
    if (!navigatingTo || navigatingTo === pathname) return;

    const timer = window.setTimeout(() => {
      setNavigatingTo(null);
    }, 8_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [navigatingTo, pathname]);

  if (!isNavigating) return null;

  const testId = variant === 'platform' ? 'platform-route-loading' : 'app-route-loading';
  const label =
    variant === 'platform'
      ? 'Carregando painel da plataforma'
      : 'Carregando página';

  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-primary/20"
    >
      <div className="h-full w-2/3 animate-pulse bg-primary" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Esqueleto estrutural reutilizável para estados de carregamento do painel
 * autenticado (`tenant` e `platform`).
 */
export function RouteLoadingSkeleton({
  variant = 'tenant',
}: {
  variant?: 'tenant' | 'platform';
}) {
  const testId =
    variant === 'platform'
      ? 'platform-route-skeleton'
      : 'app-route-skeleton';
  const label =
    variant === 'platform'
      ? 'Carregando painel da plataforma'
      : 'Carregando página';

  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36 rounded-md" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}


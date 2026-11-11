'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  KOVENO_NAVIGATION_START_EVENT,
  KOVENO_NAVIGATION_STOP_EVENT,
} from '@/components/ui/navigation-progress-bar';
import { Skeleton } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FEEDBACK INSTANTÂNEO DE TRANSIÇÃO DE ROTA — `RouteProgress` (FASE 97 · ADR-410)
 *  UNIFICADO COM `NavigationProgressBar` (FASE 102 · ADR-426)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UNIFICADO E INTEGRADO AOS EVENTOS GLOBAIS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nas fases 97 e 99/101, dois componentes concorrentes de barra de transição
 *  atuavam em paralelo na mesma coordenada (`top-0 z-50`): o `RouteProgress` no
 *  `AppShell` e o `NavigationProgressBar` no `RootLayout`.
 *
 *  Na FASE 102, a barra visual foi consolidada no `NavigationProgressBar` (com
 *  progressão suave, temporização e suporte a searchParams), enquanto o
 *  `RouteProgress` fornece a âncora de acessibilidade semântica (ARIA live region
 *  e testId) sincronizada com os eventos canônicos de navegação da plataforma,
 *  eliminando a sobreposição de duas barras no topo da tela.
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
  const [isNavigating, setIsNavigating] = useState(forceVisible);

  useEffect(() => {
    function handleStart() {
      setIsNavigating(true);
    }

    function handleStop() {
      setIsNavigating(false);
    }

    window.addEventListener(KOVENO_NAVIGATION_START_EVENT, handleStart);
    window.addEventListener(KOVENO_NAVIGATION_STOP_EVENT, handleStop);

    return () => {
      window.removeEventListener(KOVENO_NAVIGATION_START_EVENT, handleStart);
      window.removeEventListener(KOVENO_NAVIGATION_STOP_EVENT, handleStop);
    };
  }, []);

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (isNavigating) {
      setIsNavigating(false);
    }
  }

  const active = forceVisible || isNavigating;
  if (!active) return null;

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
      className="sr-only"
    >
      <span>{label}</span>
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


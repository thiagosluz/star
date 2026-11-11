'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BARRA DE PROGRESSO DE NAVEGAÇÃO GLOBAL (FASE 99 · ADR-415 / FASE 100 · ADR-422)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EXISTE E POR QUE É CLIENT-SIDE LEVE E RESILIENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No App Router do Next.js 16, transições entre páginas disparadas por <Link>
 *  ou programáticas (useTransition / router.replace / router.push) acontecem via
 *  client router (RSC streaming). O navegador NÃO ativa o spinner nativo da aba.
 *
 *  Na FASE 100 (ADR-422):
 *    • O listener de cliques escuta no ciclo de borbulhamento (bubble phase, não
 *      capture), respeitando de forma fidedigna e.defaultPrevented (ex.: links
 *      interceptados que cancelam navegação);
 *    • Suporte nativo a navegações programáticas via evento `koveno:navigation-start`
 *      e helper `startNavigationProgress()`;
 *    • Respeito irrestrito a `prefers-reduced-motion` com classes motion-reduce.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const KOVENO_NAVIGATION_START_EVENT = 'koveno:navigation-start';
export const KOVENO_NAVIGATION_STOP_EVENT = 'koveno:navigation-stop';

export function startNavigationProgress() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(KOVENO_NAVIGATION_START_EVENT));
  }
}

export function stopNavigationProgress() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(KOVENO_NAVIGATION_STOP_EVENT));
  }
}

function NavigationProgressBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'idle' | 'loading' | 'completing'>('idle');
  const [progress, setProgress] = useState(0);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentPathRef = useRef<string>('');

  function completeProgress() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setProgress(100);
    setStatus('completing');

    timeoutRef.current = setTimeout(() => {
      setStatus('idle');
      setProgress(0);
    }, 250);
  }

  function startProgress() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setStatus('loading');
    setProgress(20);

    // Avança suavemente até ~80% enquanto o servidor responde
    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 80) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 80;
        }
        return prev + Math.max(2, Math.floor((80 - prev) / 5));
      });
    }, 100);

    // Failsafe: se a navegação falhar ou for abortada, reseta após 8 segundos
    timeoutRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setStatus('idle');
      setProgress(0);
    }, 8000);
  }

  // Atualiza o caminho corrente após resolução
  useEffect(() => {
    const fullPath = `${pathname}?${searchParams.toString()}`;
    if (currentPathRef.current && currentPathRef.current !== fullPath) {
      if (status === 'loading') {
        const finishTimer = setTimeout(() => {
          completeProgress();
        }, 0);
        currentPathRef.current = fullPath;
        return () => clearTimeout(finishTimer);
      }
    }
    currentPathRef.current = fullPath;
  }, [pathname, searchParams, status]);

  // Interceptador de cliques em links internos (fase de borbulhamento) e eventos programáticos
  useEffect(() => {
    function handleDocumentClick(e: MouseEvent) {
      // Se outro handler já cancelou o evento (ex: modal, preventDefault), não ativa a barra
      if (e.defaultPrevented) return;
      if (e.button !== 0) return; // apenas botão esquerdo
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = (e.target as HTMLElement)?.closest('a');
      if (!target) return;

      const href = target.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      if (target.target === '_blank' || target.hasAttribute('download')) return;

      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;

        // Se for a mesma página e mesma query, não anima
        const targetPath = `${url.pathname}${url.search}`;
        const currentPath = `${window.location.pathname}${window.location.search}`;
        if (targetPath === currentPath) return;

        startProgress();
      } catch {
        // Href inválido, ignora
      }
    }

    function handleCustomStart() {
      startProgress();
    }

    function handleCustomStop() {
      completeProgress();
    }

    // Escuta na fase de borbulhamento (false) para respeitar e.defaultPrevented
    document.addEventListener('click', handleDocumentClick, false);
    window.addEventListener(KOVENO_NAVIGATION_START_EVENT, handleCustomStart);
    window.addEventListener(KOVENO_NAVIGATION_STOP_EVENT, handleCustomStop);

    return () => {
      document.removeEventListener('click', handleDocumentClick, false);
      window.removeEventListener(KOVENO_NAVIGATION_START_EVENT, handleCustomStart);
      window.removeEventListener(KOVENO_NAVIGATION_STOP_EVENT, handleCustomStop);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (status === 'idle') return null;

  return (
    <div
      aria-hidden="true"
      data-testid="navigation-progress-bar"
      className={cn(
        'pointer-events-none fixed left-0 right-0 top-0 z-50 h-[2.5px] transition-opacity duration-200 motion-reduce:transition-none',
        status === 'completing' ? 'opacity-90' : 'opacity-100',
      )}
    >
      <div
        className="h-full bg-primary shadow-sm transition-[width] duration-150 ease-out motion-reduce:transition-none"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export function NavigationProgressBar() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressBarInner />
    </Suspense>
  );
}

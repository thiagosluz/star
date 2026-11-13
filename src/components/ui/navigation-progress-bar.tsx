'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BARRA DE PROGRESSO DE NAVEGAÇÃO GLOBAL (FASE 99 · ADR-415 / FASE 101 · ADR-423)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EXISTE E POR QUE É CLIENT-SIDE LEVE E RESILIENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No App Router do Next.js 16, transições entre páginas disparadas por <Link>
 *  ou programáticas (useTransition / router.replace / router.push) acontecem via
 *  client router (RSC streaming). O navegador NÃO ativa o spinner nativo da aba.
 *
 *  Na FASE 101 (ADR-423):
 *    • O listener de cliques escuta na fase de captura (capture: true) antes de
 *      handlers locais, interceptando a intenção de navegação para links internos
 *      válidos sem ser silenciado pelo preventDefault intrínseco do router do Next.js;
 *    • Ignora links externos, abas novas (_blank), downloads, âncoras locais (#),
 *      links com role="button", links com data-no-progress e cliques na mesma URL;
 *    • O componente canônico <AppLink> integra-se nativamente via prop onNavigate;
 *    • Suporte a transições programáticas via startNavigationProgress() / stopNavigationProgress();
 *    • Conclusão via requestAnimationFrame sem cascading renders no React 19;
 *    • Failsafe suave que conclui e esmaece em caso de rede lenta ou cancelamento;
 *    • Respeito irrestrito a `prefers-reduced-motion` com classes motion-reduce.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const KOVENO_NAVIGATION_START_EVENT = 'koveno:navigation-start';
export const KOVENO_NAVIGATION_STOP_EVENT = 'koveno:navigation-stop';
export const KOVENO_NAVIGATION_CANCEL_EVENT = 'koveno:navigation-cancel';

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

export function cancelNavigationProgress() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(KOVENO_NAVIGATION_CANCEL_EVENT));
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

  const completeProgress = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setProgress(100);
    setStatus('completing');

    timeoutRef.current = setTimeout(() => {
      setStatus('idle');
      setProgress(0);
    }, 250);
  }, []);

  const cancelProgress = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus('idle');
    setProgress(0);
  }, []);

  const startProgress = useCallback(() => {
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

    // Failsafe: se a navegação demorar excessivamente ou for abortada, conclui suavemente
    timeoutRef.current = setTimeout(() => {
      completeProgress();
    }, 10000);
  }, [completeProgress]);

  // Atualiza o caminho corrente após resolução da rota
  useEffect(() => {
    const fullPath = `${pathname}?${searchParams.toString()}`;
    if (currentPathRef.current && currentPathRef.current !== fullPath) {
      if (status === 'loading') {
        const raf = requestAnimationFrame(() => {
          completeProgress();
        });
        currentPathRef.current = fullPath;
        return () => cancelAnimationFrame(raf);
      }
    }
    currentPathRef.current = fullPath;
  }, [pathname, searchParams, status, completeProgress]);

  // Interceptador de cliques em links internos (fase de captura) e eventos programáticos
  useEffect(() => {
    function handleDocumentClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return; // apenas botão esquerdo principal
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // ignora cliques com modificadores

      const target = (e.target as HTMLElement)?.closest('a');
      if (!target) return;
      if (target.hasAttribute('data-no-progress')) return;
      if (target.getAttribute('role') === 'button') return;

      const href = target.getAttribute('href');
      if (
        !href ||
        href.startsWith('#') ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:')
      ) {
        return;
      }
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
        // Href malformado, ignora
      }
    }

    function handleCustomStart() {
      startProgress();
    }

    function handleCustomStop() {
      completeProgress();
    }

    function handleCustomCancel() {
      cancelProgress();
    }

    // Escuta na fase de captura (true) para interceptar antes de preventDefault do cliente
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener(KOVENO_NAVIGATION_START_EVENT, handleCustomStart);
    window.addEventListener(KOVENO_NAVIGATION_STOP_EVENT, handleCustomStop);
    window.addEventListener(KOVENO_NAVIGATION_CANCEL_EVENT, handleCustomCancel);

    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener(KOVENO_NAVIGATION_START_EVENT, handleCustomStart);
      window.removeEventListener(KOVENO_NAVIGATION_STOP_EVENT, handleCustomStop);
      window.removeEventListener(KOVENO_NAVIGATION_CANCEL_EVENT, handleCustomCancel);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [cancelProgress, completeProgress, startProgress]);

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

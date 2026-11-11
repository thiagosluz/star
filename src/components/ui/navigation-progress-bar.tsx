'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BARRA DE PROGRESSO DE NAVEGAÇÃO GLOBAL (FASE 99 · ADR-415)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EXISTE E POR QUE É CLIENT-SIDE LEVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No App Router do Next.js 16, transições entre páginas disparadas por <Link>
 *  acontecem via client router (RSC streaming). O navegador NÃO ativa o spinner
 *  nativo de carregamento na aba nem altera o ponteiro do mouse.
 *
 *  Em rotas dinâmicas que levam de 200ms a 600ms no servidor, isso gerava uma
 *  sensação de "o clique não funcionou" e causava cliques duplos acidentais.
 *
 *  Este componente escuta cliques em links internos e o ciclo de pathname/searchParams,
 *  animando uma linha fina de progresso no topo da viewport.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

function NavigationProgressBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'idle' | 'loading' | 'completing'>('idle');
  const [progress, setProgress] = useState(0);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentPathRef = useRef<string>('');

  // Atualiza o caminho corrente após resolução
  useEffect(() => {
    const fullPath = `${pathname}?${searchParams.toString()}`;
    if (currentPathRef.current && currentPathRef.current !== fullPath) {
      // Concluiu navegação!
      if (status === 'loading') {
        const finishTimer = setTimeout(() => {
          setProgress(100);
          setStatus('completing');

          if (intervalRef.current) clearInterval(intervalRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);

          timeoutRef.current = setTimeout(() => {
            setStatus('idle');
            setProgress(0);
          }, 250);
        }, 0);

        currentPathRef.current = fullPath;
        return () => clearTimeout(finishTimer);
      }
    }
    currentPathRef.current = fullPath;
  }, [pathname, searchParams, status]);

  // Interceptador de cliques em links internos
  useEffect(() => {
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

    function handleDocumentClick(e: MouseEvent) {
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

    document.addEventListener('click', handleDocumentClick, true);

    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
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
        'pointer-events-none fixed left-0 right-0 top-0 z-50 h-[2.5px] transition-opacity duration-200',
        status === 'completing' ? 'opacity-90' : 'opacity-100',
      )}
    >
      <div
        className="h-full bg-primary shadow-sm transition-[width] duration-150 ease-out"
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


import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('FASE 101 — Correção Empírica da Reatividade, Interceptação Real de Links e useOptimistic Estável (ADR-423 a ADR-425)', () => {
  const root = process.cwd();

  describe('1. Interceptação Fidedigna de Navegação com Capture e AppLink (ADR-423)', () => {
    const appLinkPath = resolve(root, 'src/components/ui/app-link.tsx');
    const progressBarPath = resolve(root, 'src/components/ui/navigation-progress-bar.tsx');
    const uiIndexPath = resolve(root, 'src/components/ui/index.ts');

    it('AppLink expõe componente canônico integrado a onNavigate do Next.js 16', () => {
      expect(existsSync(appLinkPath)).toBe(true);
      const src = readFileSync(appLinkPath, 'utf8');

      expect(src).toContain("import Link, { type LinkProps } from 'next/link';");
      expect(src).toContain('export interface AppLinkProps');
      expect(src).toContain('export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>');
      expect(src).toContain('startNavigationProgress()');
      expect(src).toContain('onNavigate?.(e)');
      expect(src).toContain('skipProgress');
    });

    it('src/components/ui/index.ts reexporta AppLink e helpers de navegação', () => {
      expect(existsSync(uiIndexPath)).toBe(true);
      const src = readFileSync(uiIndexPath, 'utf8');

      expect(src).toContain("export { AppLink, type AppLinkProps } from './app-link';");
      expect(src).toContain("export { NavigationProgressBar } from './navigation-progress-bar';");
      expect(src).toContain('export { startNavigationProgress, stopNavigationProgress }');
    });

    it('NavigationProgressBar captura links na fase de captura com proteção completa contra links falsos', () => {
      expect(existsSync(progressBarPath)).toBe(true);
      const src = readFileSync(progressBarPath, 'utf8');

      // Escuta na fase de captura (true) para não ser silenciado pelo preventDefault intrínseco do router
      expect(src).toContain("addEventListener('click', handleDocumentClick, true)");
      // Validações rigorosas antes de animar
      expect(src).toContain('e.button !== 0');
      expect(src).toContain('e.metaKey || e.ctrlKey || e.shiftKey || e.altKey');
      expect(src).toContain("target.hasAttribute('data-no-progress')");
      expect(src).toContain("target.getAttribute('role') === 'button'");
      expect(src).toContain("href.startsWith('#')");
      expect(src).toContain("target.target === '_blank'");
      expect(src).toContain("target.hasAttribute('download')");
      expect(src).toContain('targetPath === currentPath');
      // Conclusão com requestAnimationFrame sem cascading renders
      expect(src).toContain('requestAnimationFrame(');
    });
  });

  describe('2. Balcão de Check-in com useOptimistic em Transição Assíncrona Real (ADR-424)', () => {
    const queuePath = resolve(root, 'src/components/gamification/checkin-queue.tsx');

    it('QueueRow executa transição assíncrona, desabilita botão e exibe feedback de erro sem engolir alerta', () => {
      expect(existsSync(queuePath)).toBe(true);
      const src = readFileSync(queuePath, 'utf8');

      // Transição assíncrona com startTransition
      expect(src).toContain('startTransition(async () => {');
      expect(src).toContain('setOptimisticInside(nextInside);');
      expect(src).toContain('const result = await action(state, formData);');
      expect(src).toContain('setState(result);');

      // Botão desabilitado em trânsito (pending || isPending)
      expect(src).toContain('const busy = pending || isPending;');
      expect(src).toContain('disabled={busy}');

      // Feedback de erro preservado com role="alert"
      expect(src).toContain("role={state.ok ? 'status' : 'alert'}");
      expect(src).toContain('data-testid={`checkin-feedback-${entry.registrationId}`}');
    });
  });

  describe('3. Idempotência de URL em Filtros Reativos (ADR-425)', () => {
    const filterBarPath = resolve(root, 'src/components/review/comite-filter-bar.tsx');

    it('ComiteFilterBar não dispara transição nem barra quando a URL resultante é idêntica à atual', () => {
      expect(existsSync(filterBarPath)).toBe(true);
      const src = readFileSync(filterBarPath, 'utf8');

      expect(src).toContain('targetUrl === currentUrl');
      expect(src).toContain('startNavigationProgress()');
      expect(src).toContain('router.replace(targetUrl, { scroll: false });');
    });
  });
});


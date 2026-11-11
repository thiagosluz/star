import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('FASE 99 — Excelência de UX, Reatividade e Foco Operacional', () => {
  const root = process.cwd();

  describe('1. Feedback de Transição Global (NavigationProgressBar · ADR-415)', () => {
    const componentPath = join(root, 'src/components/ui/navigation-progress-bar.tsx');
    const layoutPath = join(root, 'src/app/layout.tsx');

    it('componente de barra de progresso existe e está exportado no sistema de UI', () => {
      expect(existsSync(componentPath)).toBe(true);
      const componentSrc = readFileSync(componentPath, 'utf8');
      expect(componentSrc).toContain('export function NavigationProgressBar');
      expect(componentSrc).toContain('data-testid="navigation-progress-bar"');

      const uiIndexSrc = readFileSync(join(root, 'src/components/ui/index.ts'), 'utf8');
      expect(uiIndexSrc).toContain("export { NavigationProgressBar } from './navigation-progress-bar';");
    });

    it('envolve o leitor de searchParams em Suspense para evitar deopt de SSR', () => {
      const componentSrc = readFileSync(componentPath, 'utf8');
      expect(componentSrc).toContain('<Suspense fallback={null}>');
      expect(componentSrc).toContain('<NavigationProgressBarInner />');
      expect(componentSrc).toContain('usePathname');
      expect(componentSrc).toContain('useSearchParams');
    });

    it('está incluído no RootLayout da aplicação dentro do body', () => {
      const layoutSrc = readFileSync(layoutPath, 'utf8');
      expect(layoutSrc).toContain("import { NavigationProgressBar } from '@/components/ui';");
      expect(layoutSrc).toContain('<NavigationProgressBar />');
      expect(layoutSrc).toContain('<body');
    });
  });

  describe('2. Filtros com Busca Debounce e useTransition (ComiteFilterBar · ADR-416)', () => {
    const filterBarPath = join(root, 'src/components/review/comite-filter-bar.tsx');

    it('componente ComiteFilterBar existe e adota useTransition com debounce', () => {
      expect(existsSync(filterBarPath)).toBe(true);
      const src = readFileSync(filterBarPath, 'utf8');
      expect(src).toContain('export function ComiteFilterBar');
      expect(src).toContain('useTransition()');
      expect(src).toContain('startTransition');
      expect(src).toContain('scroll: false');
      expect(src).toContain('setTimeout');
    });

    it('preserva os contratos de formulário GET e testids para acessibilidade e testes', () => {
      const src = readFileSync(filterBarPath, 'utf8');
      expect(src).toContain('method="GET"');
      expect(src).toContain('name="busca"');
      expect(src).toContain('name="evento"');
      expect(src).toContain('name="status"');
      expect(src).toContain('data-testid="comite-search-input"');
      expect(src).toContain('data-testid="comite-event-filter"');
      expect(src).toContain('data-testid="comite-status-filter"');
      expect(src).toContain('data-testid="comite-filter-submit"');
      expect(src).toContain('Limpar filtros');
    });

    it('oferece atalho de teclado "/" para focar o campo de busca', () => {
      const src = readFileSync(filterBarPath, 'utf8');
      expect(src).toContain("e.key === '/'");
      expect(src).toContain('searchInputRef.current?.focus()');
    });
  });

  describe('3. Suspense Granular de Listagens (ADR-417)', () => {
    const skeletonPath = join(root, 'src/components/review/submissions-list-skeleton.tsx');
    const comitePagePath = join(root, 'src/app/t/[tenantSlug]/(app)/comite/page.tsx');

    it('esqueleto de submissões existe com animação de pulso e data-testid', () => {
      expect(existsSync(skeletonPath)).toBe(true);
      const src = readFileSync(skeletonPath, 'utf8');
      expect(src).toContain('export function SubmissionsListSkeleton');
      expect(src).toContain('data-testid="submissions-skeleton"');
    });

    it('/comite/page.tsx envolve a listagem em Suspense mantendo o topo estável', () => {
      const pageSrc = readFileSync(comitePagePath, 'utf8');
      expect(pageSrc).toContain('<Suspense');
      expect(pageSrc).toContain('fallback={<SubmissionsListSkeleton />}');
      expect(pageSrc).toContain('ComiteFilterBar');
    });
  });

  describe('4. Micro-interações Otimistas com React 19 (ADR-418)', () => {
    const queuePath = join(root, 'src/components/gamification/checkin-queue.tsx');

    it('CheckinQueue adota useOptimistic para resposta instantânea no balcão', () => {
      const src = readFileSync(queuePath, 'utf8');
      expect(src).toContain('useOptimistic');
      expect(src).toContain('optimisticInside');
      expect(src).toContain('setOptimisticInside(nextInside)');
    });

    it('mantém os atributos de contrato e testids atualizados otimisticamente', () => {
      const src = readFileSync(queuePath, 'utf8');
      expect(src).toContain("data-inside={optimisticInside ? 'true' : 'false'}");
      expect(src).toContain("mode === 'in' ? 'checkin-button' : 'checkout-button'");
    });
  });

  describe('5. Empty States Orientados à Ação e Foco Operacional (ADR-419)', () => {
    it('/revisoes/page.tsx utiliza EmptyState com orientação e link para submissões', () => {
      const src = readFileSync(join(root, 'src/app/t/[tenantSlug]/(app)/revisoes/page.tsx'), 'utf8');
      expect(src).toContain('<EmptyState');
      expect(src).toContain('Nenhum parecer atribuído no momento');
      expect(src).toContain('Ver chamadas e submissões');
    });

    it('/certificados/page.tsx utiliza EmptyState preservando data-testid="certificates-empty"', () => {
      const src = readFileSync(join(root, 'src/app/t/[tenantSlug]/(app)/certificados/page.tsx'), 'utf8');
      expect(src).toContain('<EmptyState');
      expect(src).toContain('data-testid="certificates-empty"');
      expect(src).toContain('Nenhum certificado emitido ainda');
      expect(src).toContain('Emitir um certificado acima');
    });

    it('MonitorConsole garante autofocus no campo de crachá na montagem', () => {
      const src = readFileSync(join(root, 'src/components/credentials/monitor-console.tsx'), 'utf8');
      expect(src).toContain('inputRef.current?.focus()');
      expect(src).toContain('autoFocus');
    });
  });
});

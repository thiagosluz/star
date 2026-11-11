import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('FASE 100 — Correções Críticas de Reatividade, Suspense Cirúrgico e Comportamento Operacional (ADR-420 a ADR-422)', () => {
  const root = process.cwd();

  describe('1. Suspense Cirúrgico Real e Streaming no Comitê (ADR-420)', () => {
    const pagePath = resolve(root, 'src/app/t/[tenantSlug]/(app)/comite/page.tsx');
    const skeletonPath = resolve(root, 'src/components/review/submissions-list-skeleton.tsx');

    it('/comite/page.tsx entrega cabeçalho e filtros no fluxo imediato e delega a lista ao boundary assíncrono ComiteResults', () => {
      expect(existsSync(pagePath)).toBe(true);
      const src = readFileSync(pagePath, 'utf8');

      // Verifica que ComitePage entrega ComiteFilterBar antes do Suspense com transição suave
      expect(src).toContain('<ComiteFilterBar');
      expect(src).toContain('<Suspense fallback={<SubmissionsListSkeleton />}>');
      expect(src).toContain('<ComiteResults');
      expect(src).toContain('key={filterKey}');
      expect(src).toContain('async function ComiteResults(');

      // Garante que o isolamento RLS e withTenant estão presentes
      expect(src).toContain('withTenant(');
      expect(src).toContain('listSubmissionsForChair');
    });

    it('SubmissionsListSkeleton cobre tanto métricas (StatCards) quanto a listagem de trabalhos sob Suspense', () => {
      expect(existsSync(skeletonPath)).toBe(true);
      const src = readFileSync(skeletonPath, 'utf8');

      expect(src).toContain('data-testid="submissions-skeleton"');
      expect(src).toContain('grid gap-4 sm:grid-cols-3');
      expect(src).toContain('motion-reduce:animate-none');
    });
  });

  describe('2. Tratamento Unificado de Erros com useOptimistic e Transição Assíncrona (ADR-421 / ADR-424)', () => {
    const queuePath = resolve(root, 'src/components/gamification/checkin-queue.tsx');

    it('CheckinQueue executa Server Action assíncrona com useOptimistic e preserva feedback de erro após rollback', () => {
      expect(existsSync(queuePath)).toBe(true);
      const src = readFileSync(queuePath, 'utf8');

      // Transição assíncrona idiomática com useActionState mantendo o estado pendente até resolução do servidor (ADR-427)
      expect(src).toContain('useActionState(');
      expect(src).toContain("formData.get('mode')");
      expect(src).toContain('checkOutAction : checkInAction');

      // useOptimistic integrado com reversão segura e botão desabilitado em pendência
      expect(src).toContain('useOptimistic(');
      expect(src).toContain('disabled={busy}');
      expect(src).toContain("role={state.ok ? 'status' : 'alert'}");
      expect(src).toContain('data-testid={`checkin-feedback-${entry.registrationId}`}');

      // Acessibilidade e suporte a movimento reduzido
      expect(src).toContain('motion-reduce:animate-none');
      expect(src).toContain('data-testid="queue-empty"');
    });
  });

  describe('3. Barra de Navegação Resiliente e Filtros com Debounce Seguro (ADR-422 / ADR-423)', () => {
    const progressBarPath = resolve(root, 'src/components/ui/navigation-progress-bar.tsx');
    const filterBarPath = resolve(root, 'src/components/review/comite-filter-bar.tsx');

    it('NavigationProgressBar escuta na fase de captura para links internos e suporta navegação programática', () => {
      expect(existsSync(progressBarPath)).toBe(true);
      const src = readFileSync(progressBarPath, 'utf8');

      expect(src).toContain('export function startNavigationProgress');
      expect(src).toContain('export function stopNavigationProgress');
      expect(src).toContain("addEventListener('click', handleDocumentClick, true)");
      expect(src).toContain('target.hasAttribute(\'data-no-progress\')');
      expect(src).toContain('koveno:navigation-start');
      expect(src).toContain('motion-reduce:transition-none');
    });

    it('ComiteFilterBar integra startNavigationProgress, evita closures antigas e limpa com Escape', () => {
      expect(existsSync(filterBarPath)).toBe(true);
      const src = readFileSync(filterBarPath, 'utf8');

      // Integração com barra de progresso
      expect(src).toContain('startNavigationProgress()');

      // Leitura de referências atualizadas (previne stale closure no debounce)
      expect(src).toContain('latestFiltersRef.current');

      // Limpeza real na tecla Escape
      expect(src).toContain("e.key === 'Escape'");
      expect(src).toContain("setBusca('')");

      // Proteção de atalho '/' contra inputs e contentEditable
      expect(src).toContain('isContentEditable');

      // Acessibilidade durante transição de estado pendente
      expect(src).toContain('aria-live="polite"');
    });
  });
});


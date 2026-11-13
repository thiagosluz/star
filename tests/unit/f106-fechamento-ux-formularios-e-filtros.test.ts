import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { CheckinSearchFilter } from '@/components/credentials/checkin-filter-bar';
import { CheckinQueue } from '@/components/gamification/checkin-queue';
import { ComiteFilterBar } from '@/components/review/comite-filter-bar';
import { DecisionForm } from '@/components/review/decision-form';
import { ReviewForm } from '@/components/review/review-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/t/demo/comite',
}));

describe('FASE 106 · Preservação de Formulários Acadêmicos, Paridade de Filtros e Acessibilidade', () => {
  describe('ADR-437 · Preservação de Estado e Guardião de Rascunho (ReviewForm, DecisionForm, CreateSubmissionForm)', () => {
    it('ReviewForm controla recommendation, feedbackToAuthor e confidentialComments com useUnsavedChanges', () => {
      const source = readFileSync(
        join(process.cwd(), 'src/components/review/review-form.tsx'),
        'utf-8',
      );
      expect(source).toContain('useUnsavedChanges(isDirty && !state?.ok && !alreadySubmitted)');
      expect(source).toContain('value={recommendation}');
      expect(source).toContain('value={feedbackToAuthor}');
      expect(source).toContain('value={confidentialComments}');

      const html = renderToStaticMarkup(
        createElement(ReviewForm, {
          tenantSlug: 'demo',
          submissionId: '00000000-0000-0000-0000-000000000001',
          rubric: [{ key: 'clareza', label: 'Clareza', weight: 1, maxScore: 10 }],
          action: vi.fn(),
          alreadySubmitted: false,
        }),
      );
      const dom = new JSDOM(html).window.document;
      expect(dom.querySelector('select[name="recommendation"]')).not.toBeNull();
      expect(dom.querySelector('textarea[name="feedbackToAuthor"]')).not.toBeNull();
      expect(dom.querySelector('textarea[name="confidentialComments"]')).not.toBeNull();
    });

    it('DecisionForm controla decision, notes e overrideQuorum com useUnsavedChanges', () => {
      const source = readFileSync(
        join(process.cwd(), 'src/components/review/decision-form.tsx'),
        'utf-8',
      );
      expect(source).toContain('useUnsavedChanges(isDirty && !state?.ok)');
      expect(source).toContain('value={decision}');
      expect(source).toContain('value={notes}');
      expect(source).toContain('checked={overrideQuorum}');

      const html = renderToStaticMarkup(
        createElement(DecisionForm, {
          tenantSlug: 'demo',
          submissionId: '00000000-0000-0000-0000-000000000001',
          consensus: {
            reviewCount: 2,
            averageScore: 80,
            scoreStdDev: 5,
            distribution: { ACCEPT: 2, MINOR_REVISION: 0, MAJOR_REVISION: 0, REJECT: 0 },
            requiresDiscussion: false,
            discussionReasons: [],
          },
          quorumSatisfied: false,
          quorumMessage: 'Aguardando mais pareceres',
          suggested: 'ACCEPT',
          action: vi.fn(),
        }),
      );
      const dom = new JSDOM(html).window.document;
      expect(dom.querySelector('select[name="decision"]')).not.toBeNull();
      expect(dom.querySelector('textarea[name="notes"]')).not.toBeNull();
      expect(dom.querySelector('input[name="overrideQuorum"]')).not.toBeNull();
    });

    it('CreateSubmissionForm rastreia keywords e aplica useUnsavedChanges', () => {
      const source = readFileSync(
        join(process.cwd(), 'src/components/review/create-submission-form.tsx'),
        'utf-8',
      );
      expect(source).toContain('useUnsavedChanges(isDirty && !state?.ok)');
      expect(source).toContain('value={fields.keywords}');
      expect(source).toContain('onValueChange={(keywords) => update({ keywords })}');
    });
  });

  describe('ADR-438 · Paridade de Filtros, Limpeza Segura e Empty State Acionável', () => {
    it('CheckinSearchFilter exibe botão de limpeza (×) somente quando há busca e cancela timer no Escape/unmount', () => {
      const emptyHtml = renderToStaticMarkup(
        createElement(CheckinSearchFilter, {
          tenantSlug: 'demo',
          selectedEventId: 'ev-1',
          initialQuery: '',
        }),
      );
      const emptyDom = new JSDOM(emptyHtml).window.document;
      expect(emptyDom.querySelector('[data-testid="checkin-search-clear"]')).toBeNull();

      const filledHtml = renderToStaticMarkup(
        createElement(CheckinSearchFilter, {
          tenantSlug: 'demo',
          selectedEventId: 'ev-1',
          initialQuery: 'Maria',
        }),
      );
      const filledDom = new JSDOM(filledHtml).window.document;
      const clearBtn = filledDom.querySelector('[data-testid="checkin-search-clear"]');
      expect(clearBtn).not.toBeNull();
      expect(clearBtn?.getAttribute('aria-label')).toBe('Limpar busca');

      const source = readFileSync(
        join(process.cwd(), 'src/components/credentials/checkin-filter-bar.tsx'),
        'utf-8',
      );
      expect(source).toContain('Boolean(targetEl?.isContentEditable)');
      expect(source).toContain('clearTimeout(debounceTimerRef.current)');
    });

    it('CheckinQueue renderiza link acionável "Limpar busca" quando lista está vazia e há busca ativa', () => {
      const html = renderToStaticMarkup(
        createElement(CheckinQueue, {
          entries: [],
          tenantSlug: 'demo',
          checkInAction: vi.fn(),
          checkOutAction: vi.fn(),
          clearSearchHref: '/t/demo/credenciamento?evento=ev-1',
        }),
      );
      const dom = new JSDOM(html).window.document;
      const clearLink = dom.querySelector('[data-testid="queue-clear-search"]');
      expect(clearLink).not.toBeNull();
      expect(clearLink?.getAttribute('href')).toBe('/t/demo/credenciamento?evento=ev-1');
    });

    it('ComiteFilterBar inicia aria-live vazio, dá aria-label ao botão de ícone e exibe botão (×) quando há busca', () => {
      const html = renderToStaticMarkup(
        createElement(ComiteFilterBar, {
          tenantSlug: 'demo',
          events: [{ id: 'ev-1', title: 'Congresso Demo' }],
          initialBusca: 'telemedicina',
          initialEvento: '',
          initialStatus: '',
          hasActiveFilters: true,
        }),
      );
      const dom = new JSDOM(html).window.document;
      const live = dom.querySelector('[data-testid="comite-filter-live"]');
      const submitBtn = dom.querySelector('[data-testid="comite-filter-submit"]');
      const clearBtn = dom.querySelector('[data-testid="comite-search-clear"]');

      expect(live?.getAttribute('aria-live')).toBe('polite');
      expect(live?.textContent).toBe('');
      expect(submitBtn?.getAttribute('aria-label')).toBe('Aplicar filtros');
      expect(clearBtn).not.toBeNull();
      expect(clearBtn?.getAttribute('aria-label')).toBe('Limpar busca');
    });

    it('nenhum arquivo em src/ chama window.confirm/alert/prompt e UnsavedChangesDialog está montado no RootLayout', () => {
      const arquivos = (readdirSync(join(process.cwd(), 'src'), { recursive: true }) as string[])
        .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

      const violacoes: string[] = [];
      for (const rel of arquivos) {
        const conteudo = readFileSync(join(process.cwd(), 'src', rel), 'utf-8');
        if (/\bwindow\.(confirm|alert|prompt)\s*\(/.test(conteudo)) {
          violacoes.push(rel);
        }
      }
      expect(violacoes).toEqual([]);

      const hookSource = readFileSync(
        join(process.cwd(), 'src/hooks/use-unsaved-changes.ts'),
        'utf-8',
      );
      expect(hookSource).toContain('koveno:unsaved-leave-request');
      expect(hookSource).toContain('koveno:navigation-cancel');

      const dialogSource = readFileSync(
        join(process.cwd(), 'src/components/ui/unsaved-changes-dialog.tsx'),
        'utf-8',
      );
      expect(dialogSource).toContain('ConfirmDialog');
      expect(dialogSource).toContain('testId="unsaved-changes-dialog"');
      expect(dialogSource).toContain('tone="danger"');

      const layoutSource = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf-8');
      expect(layoutSource).toContain('<UnsavedChangesDialog />');
    });
  });
});


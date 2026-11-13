import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { FavoriteButton } from '@/components/events/favorite-button';
import { KeywordsInput } from '@/components/review/keywords-input';
import { clampListIndex, shouldIgnoreListKeyEvent } from '@/hooks/keyboard-navigation';

vi.mock('next/navigation', () => ({
  unstable_rethrow: vi.fn(),
}));

vi.mock('@/app/actions/agenda-actions', () => ({
  toggleFavoriteAction: vi.fn(),
}));

describe('FASE 105 · Polimento de UX, Acessibilidade Assistiva e Guardião de Rascunhos', () => {
  describe('ADR-435 · Guardas de Navegação por Teclado em Listas Operacionais', () => {
    it('ignora eventos com defaultPrevented ou teclas modificadoras (Ctrl/Meta/Alt)', () => {
      expect(
        shouldIgnoreListKeyEvent({ key: 'ArrowDown', defaultPrevented: true, target: null }),
      ).toBe(true);
      expect(shouldIgnoreListKeyEvent({ key: 'Enter', ctrlKey: true, target: null })).toBe(true);
      expect(shouldIgnoreListKeyEvent({ key: 'Enter', metaKey: true, target: null })).toBe(true);
      expect(shouldIgnoreListKeyEvent({ key: ' ', altKey: true, target: null })).toBe(true);
    });

    it('ignora entradas em campos de formulário e regiões contentEditable', () => {
      const dom = new JSDOM(
        '<input id="i" /><textarea id="t"></textarea><select id="s"></select><div id="c" contenteditable="true"></div>',
      ).window.document;

      expect(shouldIgnoreListKeyEvent({ key: 'ArrowDown', target: dom.getElementById('i') })).toBe(
        true,
      );
      expect(shouldIgnoreListKeyEvent({ key: 'ArrowUp', target: dom.getElementById('t') })).toBe(
        true,
      );
      expect(shouldIgnoreListKeyEvent({ key: 'Enter', target: dom.getElementById('s') })).toBe(true);
      expect(
        shouldIgnoreListKeyEvent({
          key: ' ',
          target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget,
        }),
      ).toBe(true);
    });

    it('não sequestra Enter ou Espaço quando o foco está em link, botão ou summary', () => {
      const dom = new JSDOM(
        '<a href="/x" id="link"><span>Abrir</span></a><button id="btn">Salvar</button><div role="button" id="rb">Ação</div><summary id="sum">Detalhes</summary><li id="row">Linha</li>',
      ).window.document;

      const spanInsideLink = dom.querySelector('#link span');
      expect(shouldIgnoreListKeyEvent({ key: 'Enter', target: spanInsideLink })).toBe(true);
      expect(shouldIgnoreListKeyEvent({ key: ' ', target: dom.getElementById('btn') })).toBe(true);
      expect(shouldIgnoreListKeyEvent({ key: 'Enter', target: dom.getElementById('rb') })).toBe(
        true,
      );
      expect(shouldIgnoreListKeyEvent({ key: ' ', target: dom.getElementById('sum') })).toBe(true);

      // Em elemento não interativo (ex.: linha da lista ou body), o atalho continua ativo
      expect(shouldIgnoreListKeyEvent({ key: 'Enter', target: dom.getElementById('row') })).toBe(
        false,
      );
      expect(shouldIgnoreListKeyEvent({ key: ' ', target: dom.getElementById('row') })).toBe(false);
      expect(shouldIgnoreListKeyEvent({ key: 'ArrowDown', target: dom.getElementById('row') })).toBe(
        false,
      );
    });

    it('clampListIndex ajusta o índice ativo quando a lista encolhe ou zera', () => {
      expect(clampListIndex(null, 5)).toBeNull();
      expect(clampListIndex(2, 0)).toBeNull();
      expect(clampListIndex(-3, 4)).toBe(0);
      expect(clampListIndex(10, 3)).toBe(2);
      expect(clampListIndex(1, 3)).toBe(1);
    });
  });

  describe('ADR-436 · Silêncio Inicial do aria-live e Cobertura Completa de Rascunho', () => {
    it('FavoriteButton nasce com região aria-live vazia para não poluir leitores de tela', () => {
      const html = renderToStaticMarkup(
        createElement(FavoriteButton, {
          tenantSlug: 'demo',
          eventId: '00000000-0000-0000-0000-000000000001',
          eventSlug: 'evento-1',
          activityId: '00000000-0000-0000-0000-000000000002',
          activityTitle: 'Oficina Prática',
          favorited: false,
          origem: 'PROGRAMACAO',
          variant: 'painel',
        }),
      );

      const dom = new JSDOM(html).window.document;
      const live = dom.querySelector('[data-testid="agenda-live-00000000-0000-0000-0000-000000000002"]');
      expect(live).not.toBeNull();
      expect(live?.getAttribute('aria-live')).toBe('polite');
      expect(live?.textContent).toBe('');
    });

    it('KeywordsInput aceita valor controlado preservando contagem e acessibilidade', () => {
      const html = renderToStaticMarkup(
        createElement(KeywordsInput, {
          value: 'ux, react, nextjs',
          onValueChange: vi.fn(),
        }),
      );

      const dom = new JSDOM(html).window.document;
      const input = dom.querySelector('[data-testid="keywords-input"]') as HTMLInputElement | null;
      const count = dom.querySelector('[data-testid="keywords-count"]');
      expect(input?.getAttribute('value')).toBe('ux, react, nextjs');
      expect(count?.getAttribute('data-count')).toBe('3');
      expect(count?.getAttribute('data-enough')).toBe('true');
    });

    it('useUnsavedChanges ignora cliques com modificadores e cliques para a mesma URL', () => {
      const hookSource = readFileSync(
        join(process.cwd(), 'src/hooks/use-unsaved-changes.ts'),
        'utf-8',
      );
      expect(hookSource).toContain('e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0');
      expect(hookSource).toContain('anchor.href === window.location.href');
    });

    it('SubmissionDraftForm inclui keywords em isDirty e exibe "Salvando…" no estado pending', () => {
      const formSource = readFileSync(
        join(process.cwd(), 'src/components/review/submission-draft-form.tsx'),
        'utf-8',
      );
      expect(formSource).toContain('fields.keywords !== lastSaved.keywords');
      expect(formSource).toContain("pending ? 'Salvando…' : 'Salvar dados'");
    });
  });
});


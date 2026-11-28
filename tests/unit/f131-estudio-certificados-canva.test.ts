import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  MAX_STUDIO_HISTORY,
  STUDIO_COLOR_SWATCHES,
  STUDIO_QUICK_BLOCKS,
  alignElementOnPage,
  createStudioHistory,
  pushStudioHistory,
  redoStudioHistory,
  resolveStageElementPreviewText,
  resolveStageFontStyle,
  snapElementPosition,
  undoStudioHistory,
} from '@/domain/certificates/certificate-studio-rules';
import { ElementInspector } from '@/components/admin/certificate-template/element-inspector';
import { StudioToolbar } from '@/components/admin/certificate-template/studio-toolbar';

describe('FASE 131 — Estúdio Visual de Certificados (Estilo Canva)', () => {
  it('blocos rápidos em 1 clique respeitam dimensões da página em paisagem e retrato', () => {
    expect(STUDIO_QUICK_BLOCKS.map((b) => b.id)).toEqual([
      'title',
      'participant',
      'body',
      'signature',
      'qr',
      'code',
    ]);

    for (const block of STUDIO_QUICK_BLOCKS) {
      const landscape = block.build('A4_LANDSCAPE', 0);
      expect(landscape.xMm).toBeGreaterThanOrEqual(0);
      expect(landscape.xMm + landscape.widthMm).toBeLessThanOrEqual(297);
      expect(landscape.yMm + landscape.heightMm).toBeLessThanOrEqual(210);

      const portrait = block.build('A4_PORTRAIT', 1);
      expect(portrait.xMm).toBeGreaterThanOrEqual(0);
      expect(portrait.xMm + portrait.widthMm).toBeLessThanOrEqual(210);
      expect(portrait.yMm + portrait.heightMm).toBeLessThanOrEqual(297);
    }
  });

  it('snapElementPosition encaixa magneticamente no centro horizontal/vertical dentro da tolerância', () => {
    // Em A4_LANDSCAPE (297x210), caixa 100x20 tem centro em x=98.5, y=95
    const snapped = snapElementPosition({
      xMm: 100.2,
      yMm: 93.4,
      widthMm: 100,
      heightMm: 20,
      page: 'A4_LANDSCAPE',
    });
    expect(snapped).toEqual({
      xMm: 98.5,
      yMm: 95,
      snapCenterX: true,
      snapCenterY: true,
    });

    const free = snapElementPosition({
      xMm: 40,
      yMm: 30,
      widthMm: 100,
      heightMm: 20,
      page: 'A4_LANDSCAPE',
    });
    expect(free).toEqual({
      xMm: 40,
      yMm: 30,
      snapCenterX: false,
      snapCenterY: false,
    });
  });

  it('alignElementOnPage centraliza horizontalmente, verticalmente e ajusta largura útil', () => {
    const base = { xMm: 12, yMm: 25, widthMm: 97, heightMm: 10 };

    expect(
      alignElementOnPage({ element: base, page: 'A4_LANDSCAPE', action: 'center-x' }),
    ).toEqual({ xMm: 100, yMm: 25, widthMm: 97 });

    expect(
      alignElementOnPage({ element: base, page: 'A4_LANDSCAPE', action: 'center-y' }),
    ).toEqual({ xMm: 12, yMm: 100, widthMm: 97 });

    expect(
      alignElementOnPage({ element: base, page: 'A4_LANDSCAPE', action: 'full-width' }),
    ).toEqual({ xMm: 20, yMm: 25, widthMm: 257 });
  });

  it('resolve texto WYSIWYG ao vivo para TEXT, VARIABLE, BODY e QR e estilos de fonte', () => {
    expect(
      resolveStageElementPreviewText({ kind: 'VARIABLE', text: '', variable: 'nome' }, 'FULL'),
    ).not.toContain('[');

    const bodyText = resolveStageElementPreviewText(
      { kind: 'BODY', text: 'Certificamos {{nome}} em {{evento}}.', variable: '' },
      'FULL',
    );
    expect(bodyText).toContain('Certificamos ');
    expect(bodyText).not.toContain('{{nome}}');

    expect(resolveStageElementPreviewText({ kind: 'QR', text: '', variable: '' }, 'FULL')).toBe(
      'QR',
    );

    expect(resolveStageFontStyle('HELVETICA_BOLD')).toMatchObject({ fontWeight: 700 });
    expect(resolveStageFontStyle('TIMES_ITALIC')).toMatchObject({ fontStyle: 'italic' });
    expect(resolveStageFontStyle('COURIER').fontFamily).toContain('monospace');
  });

  it('pilha imutável de histórico suporta Desfazer, Refazer e teto máximo', () => {
    let h = createStudioHistory('v0');
    for (let i = 1; i <= MAX_STUDIO_HISTORY + 5; i += 1) {
      h = pushStudioHistory(h, `v${i}`);
    }
    expect(h.past.length).toBe(MAX_STUDIO_HISTORY);
    expect(h.present).toBe(`v${MAX_STUDIO_HISTORY + 5}`);

    const undone = undoStudioHistory(h);
    expect(undone.present).toBe(`v${MAX_STUDIO_HISTORY + 4}`);
    expect(undone.future[0]).toBe(`v${MAX_STUDIO_HISTORY + 5}`);

    const redone = redoStudioHistory(undone);
    expect(redone.present).toBe(`v${MAX_STUDIO_HISTORY + 5}`);
    expect(redone.future).toHaveLength(0);
  });

  it('StudioToolbar e ElementInspector renderizam controles visuais e paleta curada no SSR', () => {
    const toolbarHtml = renderToStaticMarkup(
      createElement(StudioToolbar, {
        elementsCount: 2,
        canUndo: true,
        canRedo: false,
        onAddQuickBlock: () => undefined,
        onUndo: () => undefined,
        onRedo: () => undefined,
      }),
    );
    expect(toolbarHtml).toContain('data-testid="studio-toolbar"');
    expect(toolbarHtml).toContain('data-testid="studio-add-title"');
    expect(toolbarHtml).toContain('data-testid="studio-undo"');
    expect(toolbarHtml).toContain('data-testid="studio-redo"');

    const inspectorHtml = renderToStaticMarkup(
      createElement(ElementInspector, {
        element: STUDIO_QUICK_BLOCKS[0]!.build('A4_LANDSCAPE', 0),
        index: 0,
        elementsCount: 1,
        onUpdate: () => undefined,
        onAlign: () => undefined,
        onDuplicate: () => undefined,
        onRemove: () => undefined,
      }),
    );
    expect(inspectorHtml).toContain('data-testid="studio-inspector"');
    expect(inspectorHtml).toContain('data-testid="studio-center-x"');
    expect(inspectorHtml).toContain(
      `data-testid="inspector-swatch-${STUDIO_COLOR_SWATCHES[0]!.hex.slice(1).toLowerCase()}"`,
    );
  });
});

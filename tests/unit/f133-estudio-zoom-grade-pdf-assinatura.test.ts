import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CERTIFICATE_TEMPLATE_PRESETS } from '@/domain/certificates/certificate-layout-rules';
import {
  STUDIO_FONT_PREVIEW_SAMPLE,
  STUDIO_GRID_STEP_MM,
  buildSignatureBlockText,
  ensureStageReadableColor,
  resolveStageWidthPx,
  snapElementPosition,
} from '@/domain/certificates/certificate-studio-rules';
import { ElementInspector } from '@/components/admin/certificate-template/element-inspector';
import { TemplateWorkbench } from '@/components/admin/certificate-template/template-workbench';

const guardActionMock = vi.fn();

vi.mock('@/lib/auth/guard-action', () => ({
  guardAction: (...args: unknown[]) => guardActionMock(...args),
}));

import { POST as previewPdfPost } from '@/app/api/t/[tenantSlug]/certificados/previa-pdf/route';

describe('FASE 133 — Estúdio de Certificados (Fase C: Zoom, Grade 5mm, Assinatura e Prévia PDF Real)', () => {
  it('calcula a largura proporcional do palco para os níveis de zoom 75%, 100% e 125%', () => {
    expect(resolveStageWidthPx(75)).toBe(900);
    expect(resolveStageWidthPx(100)).toBe(1200);
    expect(resolveStageWidthPx(125)).toBe(1500);
  });

  it('encaixa coordenadas na grade de 5mm preservando prioridade do centro da folha', () => {
    const onGrid = snapElementPosition({
      xMm: 23.4,
      yMm: 47.6,
      widthMm: 100,
      heightMm: 20,
      page: 'A4_LANDSCAPE',
      gridStepMm: STUDIO_GRID_STEP_MM,
    });
    expect(onGrid.snapCenterX).toBe(false);
    expect(onGrid.snapCenterY).toBe(false);
    expect(onGrid.xMm).toBe(25);
    expect(onGrid.yMm).toBe(50);

    // Centro horizontal de width=100 em A4 paisagem (297mm) = 98.5mm (não múltiplo de 5)
    const centerWins = snapElementPosition({
      xMm: 99,
      yMm: 41.2,
      widthMm: 100,
      heightMm: 20,
      page: 'A4_LANDSCAPE',
      gridStepMm: STUDIO_GRID_STEP_MM,
    });
    expect(centerWins.snapCenterX).toBe(true);
    expect(centerWins.xMm).toBe(98.5);
    expect(centerWins.yMm).toBe(40);
  });

  it('monta bloco pronto de assinatura com linha, nome, cargo e instituição opcional', () => {
    const simple = buildSignatureBlockText({
      name: 'Prof. Dr. Ana Silva',
      role: 'Coordenação Geral',
    });
    expect(simple).toContain('______________________________');
    expect(simple).toContain('Prof. Dr. Ana Silva');
    expect(simple).toContain('Coordenação Geral');

    const withInst = buildSignatureBlockText({
      name: 'Prof. Dr. Ana Silva',
      role: 'Coordenação Geral',
      institution: 'UFBA',
    });
    expect(withInst.endsWith('UFBA')).toBe(true);
  });

  it('garante contraste legível no palco sem alterar cores já escuras', () => {
    expect(ensureStageReadableColor('#111827')).toBe('#111827');
    expect(ensureStageReadableColor('#1d4ed8')).toBe('#1d4ed8');
    const darkened = ensureStageReadableColor('#9ca3af');
    expect(darkened).not.toBe('#9ca3af');
    expect(darkened).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('renderiza controles de zoom, grade 5mm, botão PDF real, amostra de fonte e atalho de assinatura', () => {
    const preset = CERTIFICATE_TEMPLATE_PRESETS[0]!;
    const elements = preset.layout.elements.map((el) => ({
      id: el.id,
      kind: el.kind,
      text: el.text,
      variable: el.variable,
      xMm: el.xMm,
      yMm: el.yMm,
      widthMm: el.widthMm,
      heightMm: el.heightMm,
      align: el.align,
      font: el.font,
      sizePt: el.sizePt,
      color: el.color,
      lineHeight: el.lineHeight,
    }));

    const workbenchHtml = renderToStaticMarkup(
      createElement(TemplateWorkbench, {
        tenantSlug: 'ufba-demo',
        model: {
          templateId: null,
          name: 'Modelo Teste',
          eventId: null,
          kind: '',
          page: 'A4_LANDSCAPE',
          elements,
          backgroundHref: null,
          backgroundInfo: null,
          backgroundNotice: null,
          previewSvg: null,
          previewWorstSvg: null,
        },
        elements,
        selected: 0,
        interactive: true,
        previewFull: null,
        previewWorst: null,
        canUndo: false,
        canRedo: false,
        onSelect: () => {},
        onMove: () => {},
        onResize: () => {},
        onUpdate: () => {},
        onAddQuickBlock: () => {},
        onAlignSelected: () => {},
        onDuplicateSelected: () => {},
        onRemoveSelected: () => {},
        onUndo: () => {},
        onRedo: () => {},
      }),
    );

    expect(workbenchHtml).toContain('data-testid="stage-zoom-75"');
    expect(workbenchHtml).toContain('data-testid="stage-zoom-100"');
    expect(workbenchHtml).toContain('data-testid="stage-zoom-125"');
    expect(workbenchHtml).toContain('data-testid="stage-grid-toggle"');
    expect(workbenchHtml).toContain('data-testid="studio-preview-pdf"');

    const textElement = {
      id: 'sig-1',
      kind: 'TEXT' as const,
      text: 'Coordenação',
      variable: '',
      xMm: 20,
      yMm: 160,
      widthMm: 100,
      heightMm: 16,
      align: 'CENTER',
      font: 'TIMES_BOLD',
      sizePt: 12,
      color: '#0F172A',
      lineHeight: 1.3,
    };

    const inspectorHtml = renderToStaticMarkup(
      createElement(ElementInspector, {
        element: textElement,
        index: 0,
        elementsCount: 1,
        onUpdate: () => {},
        onAlign: () => {},
        onDuplicate: () => {},
        onRemove: () => {},
      }),
    );

    expect(inspectorHtml).toContain('data-testid="inspector-font-preview"');
    expect(inspectorHtml).toContain(STUDIO_FONT_PREVIEW_SAMPLE);
    expect(inspectorHtml).toContain('data-testid="inspector-apply-signature-template"');
  });

  it('POST /api/t/[slug]/certificados/previa-pdf gera PDF real para layout válido e recusa 400 para layout vazio', async () => {
    guardActionMock.mockResolvedValue({
      ok: true,
      tenantId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
    });

    const preset = CERTIFICATE_TEMPLATE_PRESETS[0]!;
    const okRes = await previewPdfPost(
      new Request('http://localhost:3000/api/t/ufba-demo/certificados/previa-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: preset.layout.page,
          elements: preset.layout.elements,
          variant: 'FULL',
        }),
      }),
      { params: Promise.resolve({ tenantSlug: 'ufba-demo' }) },
    );

    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await okRes.arrayBuffer());
    const header = Buffer.from(bytes.slice(0, 7)).toString('ascii');
    expect(header).toBe('%PDF-1.');

    const badRes = await previewPdfPost(
      new Request('http://localhost:3000/api/t/ufba-demo/certificados/previa-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'A4_LANDSCAPE', elements: [] }),
      }),
      { params: Promise.resolve({ tenantSlug: 'ufba-demo' }) },
    );
    expect(badRes.status).toBe(400);
  });
});

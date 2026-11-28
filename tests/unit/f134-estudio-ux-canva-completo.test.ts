import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  STUDIO_BODY_VARIABLE_CHIPS,
  convertVariableElementToEditable,
  resolveStageWidthPx,
} from '@/domain/certificates/certificate-studio-rules';
import { ElementInspector } from '@/components/admin/certificate-template/element-inspector';
import { TemplateElementsFieldset } from '@/components/admin/certificate-template/elements-fieldset';

describe('FASE 134 — Estúdio de Certificados (Fase D: Edição Direta, Ajustar à Tela e Tabela Recolhível)', () => {
  it('resolveStageWidthPx retorna null no modo Ajustar (sem scroll horizontal) e mantém 75/100/125%', () => {
    expect(resolveStageWidthPx('fit')).toBeNull();
    expect(resolveStageWidthPx(75)).toBe(900);
    expect(resolveStageWidthPx(100)).toBe(1200);
    expect(resolveStageWidthPx(125)).toBe(1500);
  });

  it('converte variável corpo em BODY editável com gabarito e demais variáveis em TEXT preenchido', () => {
    const corpoPatch = convertVariableElementToEditable({
      id: 'corpo-1',
      kind: 'VARIABLE',
      text: '',
      variable: 'corpo',
      xMm: 24,
      yMm: 90,
      widthMm: 249,
      heightMm: 20,
      align: 'CENTER',
      font: 'HELVETICA',
      sizePt: 13,
      color: '#1E293B',
      lineHeight: 1.4,
    });
    expect(corpoPatch.kind).toBe('BODY');
    expect(corpoPatch.variable).toBe('');
    expect(corpoPatch.text).toContain('{{nome}}');
    expect(corpoPatch.heightMm).toBe(32);

    const tituloPatch = convertVariableElementToEditable({
      id: 'titulo-1',
      kind: 'VARIABLE',
      text: '',
      variable: 'titulo',
      xMm: 24,
      yMm: 44,
      widthMm: 249,
      heightMm: 12,
      align: 'CENTER',
      font: 'HELVETICA_BOLD',
      sizePt: 22,
      color: '#1D4ED8',
      lineHeight: 1.2,
    });
    expect(tituloPatch.kind).toBe('TEXT');
    expect(tituloPatch.variable).toBe('');
    expect(tituloPatch.text?.length).toBeGreaterThan(5);
  });

  it('inspetor exibe Personalizar este texto em VARIABLE e chips clicáveis de variáveis em BODY', () => {
    const variableHtml = renderToStaticMarkup(
      createElement(ElementInspector, {
        element: {
          id: 'v1',
          kind: 'VARIABLE',
          text: '',
          variable: 'corpo',
          xMm: 24,
          yMm: 90,
          widthMm: 249,
          heightMm: 36,
          align: 'CENTER',
          font: 'HELVETICA',
          sizePt: 13,
          color: '#1E293B',
          lineHeight: 1.4,
        },
        index: 2,
        elementsCount: 5,
        onUpdate: () => {},
        onAlign: () => {},
        onDuplicate: () => {},
        onRemove: () => {},
      }),
    );

    expect(variableHtml).toContain('data-testid="inspector-kind"');
    expect(variableHtml).toContain('data-testid="inspector-convert-editable"');

    const bodyHtml = renderToStaticMarkup(
      createElement(ElementInspector, {
        element: {
          id: 'b1',
          kind: 'BODY',
          text: 'Certificamos {{nome}}',
          variable: '',
          xMm: 24,
          yMm: 90,
          widthMm: 249,
          heightMm: 36,
          align: 'CENTER',
          font: 'HELVETICA',
          sizePt: 13,
          color: '#1E293B',
          lineHeight: 1.4,
        },
        index: 2,
        elementsCount: 5,
        onUpdate: () => {},
        onAlign: () => {},
        onDuplicate: () => {},
        onRemove: () => {},
      }),
    );

    for (const chip of STUDIO_BODY_VARIABLE_CHIPS) {
      expect(bodyHtml).toContain(`data-testid="inspector-insert-var-${chip.key}"`);
    }
  });

  it('recolhe a tabela técnica em <details> no modo interativo e a mantém aberta sem JS', () => {
    const row = {
      id: 'el-1',
      kind: 'TEXT' as const,
      text: 'Título',
      variable: '',
      xMm: 20,
      yMm: 30,
      widthMm: 200,
      heightMm: 12,
      align: 'CENTER',
      font: 'HELVETICA_BOLD',
      sizePt: 20,
      color: '#0F172A',
      lineHeight: 1.3,
    };

    const interactiveHtml = renderToStaticMarkup(
      createElement(TemplateElementsFieldset, {
        rows: [row],
        elementsCount: 1,
        selected: 0,
        page: 'A4_LANDSCAPE',
        interactive: true,
        hasCorpoVariable: false,
        onSelect: () => {},
        onUpdate: () => {},
        onAddElement: () => {},
        onRemoveSelected: () => {},
      }),
    );
    expect(interactiveHtml).toContain('data-testid="elements-advanced-details"');
    expect(interactiveHtml).toContain('data-testid="elements-advanced-toggle"');

    const noJsHtml = renderToStaticMarkup(
      createElement(TemplateElementsFieldset, {
        rows: [row],
        elementsCount: 1,
        selected: 0,
        page: 'A4_LANDSCAPE',
        interactive: false,
        hasCorpoVariable: false,
        onSelect: () => {},
        onUpdate: () => {},
        onAddElement: () => {},
        onRemoveSelected: () => {},
      }),
    );
    expect(noJsHtml).not.toContain('data-testid="elements-advanced-details"');
    expect(noJsHtml).toContain('data-testid="no-js-hint"');
  });
});

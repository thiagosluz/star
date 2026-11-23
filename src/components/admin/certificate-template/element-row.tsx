'use client';

import { Fragment } from 'react';

import {
  CERTIFICATE_ALIGNMENTS,
  CERTIFICATE_ALIGNMENT_LABELS,
  CERTIFICATE_ELEMENT_KINDS,
  CERTIFICATE_ELEMENT_KIND_LABELS,
  CERTIFICATE_FONTS,
  CERTIFICATE_FONT_LABELS,
  CERTIFICATE_VARIABLES,
  type CertificatePageFormat,
} from '@/domain/certificates/certificate-layout-rules';
import { Input, Select, Textarea } from '@/components/ui';
import { BodyTemplateField } from '@/components/admin/certificate-template/body-template-field';
import type { EditorElement } from '@/components/admin/certificate-template/types';

/**
 * Célula de conteúdo por tipo de elemento.
 * Mantém os `<input type="hidden">` paralelos por índice para que o formulário No-JS
 * mantenha alinhamento perfeito no parsing de `buildLayoutFromRows`.
 */
export function ElementContentCell({
  index,
  element,
  onUpdate,
}: {
  index: number;
  element: EditorElement;
  onUpdate: (patch: Partial<EditorElement>) => void;
}) {
  if (element.kind === 'VARIABLE') {
    return (
      <>
        <Select
          name="elementVariable"
          value={element.variable}
          onChange={(event) => onUpdate({ variable: event.target.value })}
          aria-label={`Variável do elemento ${index + 1}`}
        >
          <option value="">—</option>
          {CERTIFICATE_VARIABLES.map((variable) => (
            <option key={variable.key} value={variable.key} title={variable.source}>
              {variable.label}
            </option>
          ))}
        </Select>
        <input type="hidden" name="elementText" value="" />
      </>
    );
  }

  if (element.kind === 'BODY') {
    return (
      <>
        <input type="hidden" name="elementVariable" value="" />
        <p className="text-xs text-muted-foreground">
          Gabarito — o campo fica logo abaixo da linha, com a legenda das variáveis.
        </p>
      </>
    );
  }

  if (element.kind === 'QR') {
    return (
      <>
        <input type="hidden" name="elementVariable" value="" />
        <Input value="" disabled aria-label={`Texto do elemento ${index + 1}`} />
        <input type="hidden" name="elementText" value="" />
      </>
    );
  }

  return (
    <>
      <input type="hidden" name="elementVariable" value="" />
      <Textarea
        name="elementText"
        value={element.text}
        rows={1}
        className="h-11 min-h-0 py-2"
        onChange={(event) => onUpdate({ text: event.target.value })}
        aria-label={`Texto do elemento ${index + 1}`}
      />
    </>
  );
}

/** Linha da tabela de propriedades de um elemento do certificado (+ editor BODY quando aplicável). */
export function TemplateElementRow({
  index,
  element,
  filled,
  isSelected,
  page,
  interactive,
  hasCorpoVariable,
  onSelect,
  onUpdate,
}: {
  index: number;
  element: EditorElement;
  filled: boolean;
  isSelected: boolean;
  page: CertificatePageFormat;
  interactive: boolean;
  hasCorpoVariable: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<EditorElement>) => void;
}) {
  return (
    <Fragment>
      <tr
        data-testid={`element-row-${index}`}
        data-filled={filled ? 'true' : 'false'}
        className={isSelected ? 'bg-primary/5' : undefined}
      >
        <td className="p-1">
          <button
            type="button"
            onClick={onSelect}
            className="rounded px-1 text-muted-foreground hover:text-foreground"
            aria-label={`Selecionar elemento ${index + 1}`}
            data-testid={`element-select-${index}`}
          >
            {index + 1}
          </button>
        </td>
        <td className="p-1">
          <Select
            name="elementKind"
            value={element.kind}
            onChange={(event) => onUpdate({ kind: event.target.value as EditorElement['kind'] })}
            aria-label={`Tipo do elemento ${index + 1}`}
          >
            {CERTIFICATE_ELEMENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {CERTIFICATE_ELEMENT_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
        </td>
        <td className="p-1">
          <ElementContentCell index={index} element={element} onUpdate={onUpdate} />
        </td>
        <td className="p-1">
          <Input
            name="elementX"
            value={element.xMm}
            inputMode="decimal"
            className="w-16"
            onChange={(event) => onUpdate({ xMm: Number(event.target.value) || 0 })}
            aria-label={`X do elemento ${index + 1}`}
          />
        </td>
        <td className="p-1">
          <Input
            name="elementY"
            value={element.yMm}
            inputMode="decimal"
            className="w-16"
            onChange={(event) => onUpdate({ yMm: Number(event.target.value) || 0 })}
            aria-label={`Y do elemento ${index + 1}`}
          />
        </td>
        <td className="p-1">
          <Input
            name="elementWidth"
            value={element.widthMm}
            inputMode="decimal"
            className="w-16"
            onChange={(event) => onUpdate({ widthMm: Number(event.target.value) || 0 })}
            aria-label={`Largura do elemento ${index + 1}`}
          />
        </td>
        <td className="p-1">
          <Input
            name="elementHeight"
            value={element.heightMm}
            inputMode="decimal"
            className="w-16"
            onChange={(event) => onUpdate({ heightMm: Number(event.target.value) || 0 })}
            aria-label={`Altura do elemento ${index + 1}`}
          />
        </td>
        <td className="p-1">
          <Select
            name="elementAlign"
            value={element.align}
            onChange={(event) => onUpdate({ align: event.target.value })}
            aria-label={`Alinhamento do elemento ${index + 1}`}
          >
            {CERTIFICATE_ALIGNMENTS.map((align) => (
              <option key={align} value={align}>
                {CERTIFICATE_ALIGNMENT_LABELS[align]}
              </option>
            ))}
          </Select>
        </td>
        <td className="p-1">
          <Select
            name="elementFont"
            value={element.font}
            onChange={(event) => onUpdate({ font: event.target.value })}
            aria-label={`Fonte do elemento ${index + 1}`}
          >
            {CERTIFICATE_FONTS.map((font) => (
              <option key={font} value={font}>
                {CERTIFICATE_FONT_LABELS[font]}
              </option>
            ))}
          </Select>
        </td>
        <td className="p-1">
          <Input
            name="elementSize"
            value={element.sizePt}
            inputMode="decimal"
            className="w-16"
            onChange={(event) => onUpdate({ sizePt: Number(event.target.value) || 0 })}
            aria-label={`Corpo do elemento ${index + 1}`}
          />
        </td>
        <td className="p-1">
          <input type="hidden" name="elementLineHeight" value={element.lineHeight} />
          <Input
            name="elementColor"
            value={element.color}
            className="w-24"
            onChange={(event) => onUpdate({ color: event.target.value })}
            aria-label={`Cor do elemento ${index + 1}`}
          />
        </td>
      </tr>

      {element.kind === 'BODY' ? (
        <tr data-testid={`element-body-row-${index}`}>
          <td colSpan={11} className="bg-primary/5 p-2">
            <BodyTemplateField
              index={index}
              element={element}
              page={page}
              interactive={interactive}
              hasCorpoVariable={hasCorpoVariable}
              onChange={(text) => onUpdate({ text })}
              onHeight={(heightMm) => onUpdate({ heightMm })}
            />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

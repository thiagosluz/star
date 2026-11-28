'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UI — Inspetor Contextual do Elemento Selecionado (FASE 131)
 *
 *  Substitui a busca manual na planilha de 11 colunas para usuários comuns:
 *  basta clicar em qualquer elemento no palco para editar texto/variável, fonte,
 *  tamanho, cor, alinhamento, centralizar na folha, duplicar ou remover.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  Copy,
  Maximize2,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';

import {
  CERTIFICATE_FONTS,
  CERTIFICATE_FONT_LABELS,
  CERTIFICATE_VARIABLES,
  MAX_LAYOUT_ELEMENTS,
} from '@/domain/certificates/certificate-layout-rules';
import {
  STUDIO_COLOR_SWATCHES,
  STUDIO_FONT_PREVIEW_SAMPLE,
  buildSignatureBlockText,
  resolveStageFontStyle,
  type StudioPageAlignAction,
} from '@/domain/certificates/certificate-studio-rules';
import { Button, Input, Select, Textarea } from '@/components/ui';
import type { EditorElement } from '@/components/admin/certificate-template/types';

export function ElementInspector({
  element,
  index,
  elementsCount,
  onUpdate,
  onAlign,
  onDuplicate,
  onRemove,
}: {
  element: EditorElement | null;
  index: number | null;
  elementsCount: number;
  onUpdate: (patch: Partial<EditorElement>) => void;
  onAlign: (action: StudioPageAlignAction) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  if (!element || index === null) {
    return (
      <aside
        className="flex flex-col justify-center rounded-md border border-dashed border-border bg-surface-low/50 p-4 text-center text-xs text-muted-foreground"
        data-testid="studio-inspector-empty"
      >
        <SlidersHorizontal className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden="true" />
        Clique em qualquer elemento no palco para editar texto, fonte, cor ou alinhamento.
      </aside>
    );
  }

  const isTextLike = element.kind !== 'QR';

  return (
    <aside
      className="space-y-4 rounded-md border border-border bg-card p-4 text-xs"
      data-testid="studio-inspector"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Elemento {index + 1} · {element.kind === 'QR' ? 'QR Code' : element.kind === 'BODY' ? 'Corpo' : element.kind === 'VARIABLE' ? 'Variável' : 'Texto'}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={elementsCount >= MAX_LAYOUT_ELEMENTS}
            onClick={onDuplicate}
            title="Duplicar elemento"
            aria-label="Duplicar elemento selecionado"
            data-testid="studio-duplicate"
          >
            <Copy className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            title="Remover elemento"
            aria-label="Remover elemento selecionado"
            data-testid="studio-remove"
          >
            <Trash2 className="size-3.5 text-destructive" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {element.kind === 'VARIABLE' ? (
        <label className="block space-y-1 font-medium text-foreground">
          <span>Campo dinâmico</span>
          <Select
            value={element.variable}
            onChange={(e) => onUpdate({ variable: e.target.value })}
            data-testid="inspector-variable"
          >
            <option value="">Escolha uma variável…</option>
            {CERTIFICATE_VARIABLES.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </Select>
        </label>
      ) : element.kind === 'TEXT' || element.kind === 'BODY' ? (
        <div className="space-y-1.5">
          <label className="block space-y-1 font-medium text-foreground">
            <span>{element.kind === 'BODY' ? 'Texto do corpo (com {{variáveis}})' : 'Texto'}</span>
            <Textarea
              value={element.text}
              rows={element.kind === 'BODY' ? 3 : 2}
              className="min-h-0 py-2 text-xs"
              onChange={(e) => onUpdate({ text: e.target.value })}
              data-testid="inspector-text"
            />
          </label>
          {element.kind === 'TEXT' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onUpdate({
                  text: buildSignatureBlockText({
                    name: 'Prof. Dr. Nome da Coordenação',
                    role: 'Coordenação Geral do Evento',
                  }),
                  align: 'CENTER',
                  heightMm: Math.max(element.heightMm, 18),
                })
              }
              data-testid="inspector-apply-signature-template"
            >
              Inserir modelo de assinatura
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <span className="block font-medium text-foreground">Alinhar na folha</span>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAlign('center-x')}
            data-testid="studio-center-x"
          >
            <AlignHorizontalJustifyCenter className="size-3.5" aria-hidden="true" />
            Centralizar H
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAlign('center-y')}
            data-testid="studio-center-y"
          >
            <AlignVerticalJustifyCenter className="size-3.5" aria-hidden="true" />
            Centralizar V
          </Button>
          {isTextLike ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAlign('full-width')}
              data-testid="studio-full-width"
            >
              <Maximize2 className="size-3.5" aria-hidden="true" />
              Largura útil
            </Button>
          ) : null}
        </div>
      </div>

      {isTextLike ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 font-medium text-foreground">
              <span>Fonte</span>
              <Select
                value={element.font}
                onChange={(e) => onUpdate({ font: e.target.value })}
                data-testid="inspector-font"
              >
                {CERTIFICATE_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {CERTIFICATE_FONT_LABELS[f]}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 font-medium text-foreground">
              <span>Tamanho (pt)</span>
              <Input
                type="number"
                min={6}
                max={72}
                value={element.sizePt}
                onChange={(e) => onUpdate({ sizePt: Number(e.target.value) || 12 })}
                data-testid="inspector-size"
              />
            </label>
          </div>

          <p
            data-testid="inspector-font-preview"
            className="rounded-sm border border-border bg-surface-low px-2.5 py-1.5 text-sm text-foreground"
            style={resolveStageFontStyle(element.font)}
          >
            {STUDIO_FONT_PREVIEW_SAMPLE}
          </p>

          <div className="space-y-1.5">
            <span className="block font-medium text-foreground">Alinhamento do texto</span>
            <div className="inline-flex rounded-sm border border-border bg-surface-low p-0.5">
              {(
                [
                  { value: 'LEFT', label: 'Esquerda', Icon: AlignLeft },
                  { value: 'CENTER', label: 'Centralizado', Icon: AlignCenter },
                  { value: 'RIGHT', label: 'Direita', Icon: AlignRight },
                ] as const
              ).map(({ value, label, Icon }) => {
                const active = element.align === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={label}
                    aria-pressed={active}
                    onClick={() => onUpdate({ align: value })}
                    data-testid={`inspector-align-${value.toLowerCase()}`}
                    className={`rounded-xs px-2.5 py-1.5 transition ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="block font-medium text-foreground">Cor do texto</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {STUDIO_COLOR_SWATCHES.map((swatch) => {
                const active = element.color.toUpperCase() === swatch.hex.toUpperCase();
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    title={swatch.label}
                    aria-label={`Cor ${swatch.label}`}
                    aria-pressed={active}
                    onClick={() => onUpdate({ color: swatch.hex })}
                    data-testid={`inspector-swatch-${swatch.hex.slice(1).toLowerCase()}`}
                    className={`size-6 rounded-full border transition ${
                      active ? 'ring-2 ring-primary ring-offset-2 border-foreground' : 'border-border'
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  />
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </aside>
  );
}

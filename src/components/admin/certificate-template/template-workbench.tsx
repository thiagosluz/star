'use client';

import { useState } from 'react';
import { Move } from 'lucide-react';

import {
  measureCertificateBody,
  resolveBodyTemplate,
  sampleVariableValues,
  type CertificateBodyFit,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';
import type {
  StudioPageAlignAction,
  StudioQuickBlockId,
} from '@/domain/certificates/certificate-studio-rules';
import { ElementInspector } from '@/components/admin/certificate-template/element-inspector';
import { StudioToolbar } from '@/components/admin/certificate-template/studio-toolbar';
import { TemplatePreviewPanel } from '@/components/admin/certificate-template/template-preview-panel';
import { TemplateStage } from '@/components/admin/certificate-template/template-stage';
import type { EditorElement, EditorModel } from '@/components/admin/certificate-template/types';

/** Bancada visual estilo estúdio: barra de blocos + palco WYSIWYG + inspetor contextual + prévia fiel do servidor. */
export function TemplateWorkbench({
  model,
  elements,
  selected,
  interactive,
  previewFull,
  previewWorst,
  canUndo,
  canRedo,
  onSelect,
  onMove,
  onResize,
  onUpdate,
  onAddQuickBlock,
  onAlignSelected,
  onDuplicateSelected,
  onRemoveSelected,
  onUndo,
  onRedo,
}: {
  model: EditorModel;
  elements: EditorElement[];
  selected: number | null;
  interactive: boolean;
  previewFull: string | null;
  previewWorst: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onSelect: (index: number | null) => void;
  onMove: (index: number, xMm: number, yMm: number) => void;
  onResize: (index: number, widthMm: number, heightMm: number) => void;
  onUpdate: (index: number, patch: Partial<EditorElement>) => void;
  onAddQuickBlock: (blockId: StudioQuickBlockId) => void;
  onAlignSelected: (action: StudioPageAlignAction) => void;
  onDuplicateSelected: () => void;
  onRemoveSelected: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [stageVariant, setStageVariant] = useState<CertificatePreviewVariant>('FULL');

  const bodyElement = elements.find((element) => element.kind === 'BODY') ?? null;
  const bodyFitFor = (variant: CertificatePreviewVariant): CertificateBodyFit | null => {
    if (!bodyElement) return null;

    return measureCertificateBody({
      text: resolveBodyTemplate(bodyElement.text, sampleVariableValues(variant)),
      box: bodyElement,
    });
  };
  const fullBodyFit = bodyFitFor('FULL');
  const worstBodyFit = bodyFitFor('WORST_CASE');
  const selectedElement = selected !== null ? (elements[selected] ?? null) : null;

  return (
    <section className="space-y-4" data-testid="template-workbench">
      {interactive ? (
        <StudioToolbar
          elementsCount={elements.length}
          canUndo={canUndo}
          canRedo={canRedo}
          onAddQuickBlock={onAddQuickBlock}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Move className="size-4" aria-hidden /> Palco ao vivo
            </h2>

            {interactive ? (
              <div className="inline-flex rounded-sm border border-border bg-surface-low p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setStageVariant('FULL')}
                  aria-pressed={stageVariant === 'FULL'}
                  data-testid="stage-sample-full"
                  className={`rounded-xs px-2.5 py-1 font-medium transition ${
                    stageVariant === 'FULL'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Dados completos
                </button>
                <button
                  type="button"
                  onClick={() => setStageVariant('WORST_CASE')}
                  aria-pressed={stageVariant === 'WORST_CASE'}
                  data-testid="stage-sample-worst"
                  className={`rounded-xs px-2.5 py-1 font-medium transition ${
                    stageVariant === 'WORST_CASE'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Dados opcionais vazios
                </button>
              </div>
            ) : null}
          </div>

          {interactive ? (
            <TemplateStage
              page={model.page}
              elements={elements}
              selected={selected}
              backgroundHref={model.backgroundHref}
              previewVariant={stageVariant}
              onSelect={onSelect}
              onMove={onMove}
              onResize={onResize}
            />
          ) : (
            <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              O posicionamento por arrastar precisa de JavaScript. Sem ele, use as colunas X e Y do formulário — o
              resultado é o mesmo.
            </p>
          )}
        </div>

        {interactive ? (
          <ElementInspector
            element={selectedElement}
            index={selected}
            elementsCount={elements.length}
            onUpdate={(patch) => {
              if (selected !== null) onUpdate(selected, patch);
            }}
            onAlign={onAlignSelected}
            onDuplicate={onDuplicateSelected}
            onRemove={onRemoveSelected}
          />
        ) : null}
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Prévia fiel do documento (PDF/SVG do servidor)</h2>

        {previewFull || previewWorst ? (
          <div className="grid gap-3 md:grid-cols-2">
            <TemplatePreviewPanel
              variant="FULL"
              label="Com todos os dados"
              svg={previewFull}
              body={bodyElement}
              fit={fullBodyFit}
              page={model.page}
            />
            <TemplatePreviewPanel
              variant="WORST_CASE"
              label="Com dados opcionais vazios"
              svg={previewWorst}
              body={bodyElement}
              fit={worstBodyFit}
              page={model.page}
            />
          </div>
        ) : (
          <p
            className="rounded-md border border-border p-3 text-xs text-muted-foreground"
            data-testid="template-preview-empty"
          >
            Salve o modelo e clique em <strong>Atualizar prévia</strong> para ver o documento com dados de exemplo.
          </p>
        )}
      </div>
    </section>
  );
}

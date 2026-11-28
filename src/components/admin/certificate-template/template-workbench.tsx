'use client';

import { useState } from 'react';
import { FileDown, Grid3X3, Loader2, Move } from 'lucide-react';

import {
  measureCertificateBody,
  resolveBodyTemplate,
  sampleVariableValues,
  type CertificateBodyFit,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';
import {
  STUDIO_ZOOM_LEVELS,
  type StudioPageAlignAction,
  type StudioQuickBlockId,
  type StudioZoomPercent,
} from '@/domain/certificates/certificate-studio-rules';
import { Button } from '@/components/ui';
import { ElementInspector } from '@/components/admin/certificate-template/element-inspector';
import { StudioToolbar } from '@/components/admin/certificate-template/studio-toolbar';
import { TemplatePreviewPanel } from '@/components/admin/certificate-template/template-preview-panel';
import { TemplateStage } from '@/components/admin/certificate-template/template-stage';
import type { EditorElement, EditorModel } from '@/components/admin/certificate-template/types';

/** Bancada visual estilo estúdio: barra de blocos + palco WYSIWYG (zoom/grade) + inspetor + prévia PDF real. */
export function TemplateWorkbench({
  tenantSlug,
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
  tenantSlug: string;
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
  const [zoom, setZoom] = useState<StudioZoomPercent>('fit');
  const [snapGrid, setSnapGrid] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handlePreviewPdf = async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const response = await fetch(`/api/t/${encodeURIComponent(tenantSlug)}/certificados/previa-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: model.page,
          elements,
          templateId: model.templateId,
          variant: stageVariant,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
        setPdfError(data?.message ?? data?.error?.message ?? 'Não foi possível gerar a prévia em PDF.');
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'previa-certificado.pdf';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setPdfError('Falha de conexão ao gerar a prévia em PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Move className="size-4" aria-hidden /> Palco ao vivo
            </h2>

            {interactive ? (
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex rounded-sm border border-border bg-surface-low p-0.5 text-xs"
                  role="group"
                  aria-label="Zoom do palco"
                >
                  {STUDIO_ZOOM_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setZoom(level)}
                      aria-pressed={zoom === level}
                      data-testid={`stage-zoom-${level}`}
                      className={`rounded-xs px-2 py-1 font-medium transition ${zoom === level
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                      {level === 'fit' ? 'Ajustar' : `${level}%`}
                    </button>
                  ))}
                </div>

                <Button
                  type="button"
                  variant={snapGrid ? 'primary' : 'outline'}
                  size="sm"
                  aria-pressed={snapGrid}
                  onClick={() => setSnapGrid((prev) => !prev)}
                  data-testid="stage-grid-toggle"
                >
                  <Grid3X3 className="size-3.5" aria-hidden="true" />
                  Grade 5 mm
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pdfLoading}
                  onClick={handlePreviewPdf}
                  data-testid="studio-preview-pdf"
                >
                  {pdfLoading ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileDown className="size-3.5" aria-hidden="true" />
                  )}
                  {pdfLoading ? 'Gerando PDF…' : 'Abrir PDF real'}
                </Button>

                <div className="inline-flex rounded-sm border border-border bg-surface-low p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setStageVariant('FULL')}
                    aria-pressed={stageVariant === 'FULL'}
                    data-testid="stage-sample-full"
                    className={`rounded-xs px-2.5 py-1 font-medium transition ${stageVariant === 'FULL'
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
                    className={`rounded-xs px-2.5 py-1 font-medium transition ${stageVariant === 'WORST_CASE'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                      }`}
                  >
                    Dados opcionais vazios
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {pdfError ? (
            <p
              role="alert"
              data-testid="studio-preview-pdf-error"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {pdfError}
            </p>
          ) : null}

          {interactive ? (
            <TemplateStage
              page={model.page}
              elements={elements}
              selected={selected}
              backgroundHref={model.backgroundHref}
              previewVariant={stageVariant}
              zoom={zoom}
              snapGrid={snapGrid}
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

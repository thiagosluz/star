'use client';

import { Move } from 'lucide-react';

import {
  measureCertificateBody,
  resolveBodyTemplate,
  sampleVariableValues,
  type CertificateBodyFit,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';
import { TemplatePreviewPanel } from '@/components/admin/certificate-template/template-preview-panel';
import { TemplateStage } from '@/components/admin/certificate-template/template-stage';
import type { EditorElement, EditorModel } from '@/components/admin/certificate-template/types';

/** Bancada superior do editor: palco esquemático lado a lado com a prévia dupla (FULL e WORST_CASE). */
export function TemplateWorkbench({
  model,
  elements,
  selected,
  interactive,
  previewFull,
  previewWorst,
  onSelect,
  onMove,
  onResize,
}: {
  model: EditorModel;
  elements: EditorElement[];
  selected: number | null;
  interactive: boolean;
  previewFull: string | null;
  previewWorst: string | null;
  onSelect: (index: number | null) => void;
  onMove: (index: number, xMm: number, yMm: number) => void;
  onResize: (index: number, widthMm: number, heightMm: number) => void;
}) {
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

  return (
    <section className="grid gap-4 xl:grid-cols-2" data-testid="template-workbench">
      <div className="space-y-2 rounded-md border border-border bg-card p-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Move className="size-4" aria-hidden /> Posições
        </h2>

        {interactive ? (
          <>
            <p className="text-xs text-muted-foreground">
              Arraste a caixa para posicionar e o canto para redimensionar. O número é a linha da tabela.
            </p>
            <TemplateStage
              page={model.page}
              elements={elements}
              selected={selected}
              backgroundHref={model.backgroundHref}
              onSelect={onSelect}
              onMove={onMove}
              onResize={onResize}
            />
          </>
        ) : (
          <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
            O posicionamento por arrastar precisa de JavaScript. Sem ele, use as colunas X e Y do formulário — o
            resultado é o mesmo.
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-border bg-card p-3">
        <h2 className="text-sm font-semibold">Prévia do documento</h2>

        {previewFull || previewWorst ? (
          <div className="grid gap-3 sm:grid-cols-2">
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

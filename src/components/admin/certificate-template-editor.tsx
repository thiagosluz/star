'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Save } from 'lucide-react';

import type { CertificateTemplateActionState } from '@/app/actions/certificate-actions';
import { MAX_LAYOUT_ELEMENTS } from '@/domain/certificates/certificate-layout-rules';
import { Input, Select } from '@/components/ui';
import { useIsInteractive } from '@/hooks/use-is-interactive';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { BackgroundAssetPanel } from '@/components/admin/certificate-template/background-asset-panel';
import { TemplateElementsFieldset } from '@/components/admin/certificate-template/elements-fieldset';
import { TemplateWorkbench } from '@/components/admin/certificate-template/template-workbench';
import { useTemplateStudio } from '@/components/admin/certificate-template/use-template-studio';
import {
  emptyElement,
  type EditorElement,
  type EditorModel,
} from '@/components/admin/certificate-template/types';

export type { EditorElement, EditorModel };

function SubmitButton({ label, testId }: { label: string; testId: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
      {pending ? 'Salvando…' : label}
    </button>
  );
}

export interface TemplateEditorProps {
  tenantSlug: string;
  model: EditorModel;
  eventTitle: string | null;
  kinds: { value: string; label: string }[];
  saveAction: (
    prev: CertificateTemplateActionState | null,
    formData: FormData,
  ) => Promise<CertificateTemplateActionState>;
  previewAction: (
    prev: CertificateTemplateActionState | null,
    formData: FormData,
  ) => Promise<CertificateTemplateActionState>;
  uploadAction: (
    prev: CertificateTemplateActionState | null,
    formData: FormData,
  ) => Promise<CertificateTemplateActionState>;
  clearBackgroundAction: (
    prev: CertificateTemplateActionState | null,
    formData: FormData,
  ) => Promise<CertificateTemplateActionState>;
}

/**
 * Orquestrador do editor visual do certificado: sincroniza o estado do formulário
 * com a bancada (`TemplateWorkbench`), a tabela (`TemplateElementsFieldset`) e a arte
 * de fundo (`BackgroundAssetPanel`), preservando a submissão completa sem JS.
 */
export function CertificateTemplateEditor({
  tenantSlug,
  model,
  eventTitle,
  kinds,
  saveAction,
  previewAction,
  uploadAction,
  clearBackgroundAction,
}: TemplateEditorProps) {
  const interactive = useIsInteractive();
  const studio = useTemplateStudio(model.elements, model.page);
  const { elements, selected, setSelected, update, addElement, removeElement } = studio;

  const [saveState, saveFormAction] = useActionState<CertificateTemplateActionState | null, FormData>(
    saveAction,
    null,
  );
  const isDirty = !saveState?.ok && JSON.stringify(elements) !== JSON.stringify(model.elements);
  useUnsavedChanges(isDirty);

  const [previewState, previewFormAction] = useActionState<CertificateTemplateActionState | null, FormData>(
    previewAction,
    null,
  );
  const [uploadState, uploadFormAction] = useActionState<CertificateTemplateActionState | null, FormData>(
    uploadAction,
    null,
  );
  const [clearState, clearFormAction] = useActionState<CertificateTemplateActionState | null, FormData>(
    clearBackgroundAction,
    null,
  );

  const serverPreview = typeof previewState?.data?.previewSvg === 'string' ? previewState.data.previewSvg : null;
  const serverPreviewWorst =
    typeof previewState?.data?.previewWorstSvg === 'string' ? previewState.data.previewWorstSvg : null;
  const previewFull = serverPreview ?? model.previewSvg;
  const previewWorst = serverPreviewWorst ?? model.previewWorstSvg;

  const hasCorpoVariable = elements.some(
    (element) => element.kind === 'VARIABLE' && element.variable === 'corpo',
  );

  const rowCount = interactive ? Math.min(Math.max(elements.length + 1, 8), MAX_LAYOUT_ELEMENTS) : MAX_LAYOUT_ELEMENTS;
  const rows = Array.from({ length: rowCount }, (_, index) => elements[index] ?? emptyElement(index));

  return (
    <div className="space-y-6" data-testid="template-editor">
      {model.backgroundNotice ? (
        <p className="rounded-md border border-warning bg-warning-soft p-3 text-xs text-warning-strong" data-testid="background-notice">
          {model.backgroundNotice}
        </p>
      ) : null}

      {saveState && !saveState.ok ? (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="template-error">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden /> {saveState.message}
          </p>
          {saveState.details?.length ? (
            <ul className="list-disc space-y-0.5 pl-6 text-xs text-muted-foreground">
              {saveState.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {saveState?.ok ? (
        <p className="flex items-center gap-2 rounded-md border border-success bg-success-soft p-3 text-sm text-success-strong" data-testid="template-saved">
          <CheckCircle2 className="size-4" aria-hidden /> {saveState.message}
        </p>
      ) : null}

      <TemplateWorkbench
        tenantSlug={tenantSlug}
        model={model}
        elements={elements}
        selected={selected}
        interactive={interactive}
        previewFull={previewFull}
        previewWorst={previewWorst}
        canUndo={studio.canUndo}
        canRedo={studio.canRedo}
        onSelect={setSelected}
        onMove={(index, xMm, yMm) => update(index, { xMm, yMm })}
        onResize={(index, widthMm, heightMm) => update(index, { widthMm, heightMm })}
        onUpdate={update}
        onAddQuickBlock={studio.addQuickBlock}
        onAlignSelected={studio.alignSelected}
        onDuplicateSelected={studio.duplicateSelected}
        onRemoveSelected={() => selected !== null && removeElement(selected)}
        onUndo={studio.undo}
        onRedo={studio.redo}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form action={saveFormAction} className="space-y-6" data-testid="template-form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          {model.templateId ? <input type="hidden" name="templateId" value={model.templateId} /> : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium">
              <span>Nome do modelo</span>
              <Input name="name" defaultValue={model.name} required maxLength={120} data-testid="template-name" />
            </label>

            <div className="space-y-1.5 text-sm font-medium">
              <span>Vale para</span>
              <p className="rounded-md border border-border bg-card px-3 py-2 text-sm font-normal" data-testid="template-event-fixed">
                {model.eventId ? `Este evento — ${eventTitle ?? 'evento da rota'}` : 'Todos os eventos da instituição (modelo padrão)'}
              </p>
              {model.eventId ? <input type="hidden" name="eventId" value={model.eventId} /> : null}
            </div>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Tipo de certificado</span>
              <Select name="kind" defaultValue={model.kind} data-testid="template-kind">
                <option value="">Qualquer tipo</option>
                {kinds.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="block max-w-xs space-y-1.5 text-sm font-medium">
            <span>Página</span>
            <Select name="page" defaultValue={model.page} data-testid="template-page">
              <option value="A4_LANDSCAPE">A4 paisagem (297 × 210 mm)</option>
              <option value="A4_PORTRAIT">A4 retrato (210 × 297 mm)</option>
            </Select>
          </label>

          <TemplateElementsFieldset
            rows={rows}
            elementsCount={elements.length}
            selected={selected}
            page={model.page}
            interactive={interactive}
            hasCorpoVariable={hasCorpoVariable}
            onSelect={setSelected}
            onUpdate={update}
            onAddElement={addElement}
            onRemoveSelected={() => selected !== null && removeElement(selected)}
          />

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton label="Salvar modelo" testId="template-submit" />
            <button
              type="submit"
              formAction={previewFormAction}
              data-testid="template-preview-submit"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <RotateCcw className="size-4" aria-hidden /> Atualizar prévia
            </button>
          </div>
        </form>

        <BackgroundAssetPanel
          tenantSlug={tenantSlug}
          model={model}
          uploadFormAction={uploadFormAction}
          clearFormAction={clearFormAction}
          uploadState={uploadState}
          clearState={clearState}
        />
      </div>
    </div>
  );
}

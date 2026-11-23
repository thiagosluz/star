'use client';

import type { CertificateTemplateActionState } from '@/app/actions/certificate-actions';
import type { EditorModel } from '@/components/admin/certificate-template/types';

/** Painel lateral para envio e remoção da arte de fundo (JPEG RGB) do modelo salvo. */
export function BackgroundAssetPanel({
  tenantSlug,
  model,
  uploadFormAction,
  clearFormAction,
  uploadState,
  clearState,
}: {
  tenantSlug: string;
  model: EditorModel;
  uploadFormAction: (payload: FormData) => void;
  clearFormAction: (payload: FormData) => void;
  uploadState: CertificateTemplateActionState | null;
  clearState: CertificateTemplateActionState | null;
}) {
  return (
    <aside className="space-y-4">
      <section className="space-y-2" data-testid="template-background">
        <h2 className="text-sm font-semibold">Arte de fundo</h2>

        {model.templateId ? (
          <>
            <form action={uploadFormAction} encType="multipart/form-data" className="space-y-2">
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="templateId" value={model.templateId} />
              <input type="hidden" name="eventId" value={model.eventId} />
              <input
                type="file"
                name="background"
                accept="image/jpeg"
                required
                aria-label="Arquivo da arte de fundo (JPEG)"
                data-testid="background-file"
                className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground"
              />
              <p className="text-xs text-muted-foreground">
                JPEG em RGB, no mínimo 150 dpi para a página escolhida. CMYK e JPEG progressivo são recusados:
                o PDF embute o arquivo como está, e converter mudaria as cores sem ninguém perceber.
              </p>
              <button
                type="submit"
                data-testid="background-submit"
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Aplicar arte
              </button>
            </form>

            {model.backgroundBytes > 0 ? (
              <form action={clearFormAction} className="flex items-center justify-between gap-2 text-xs">
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="templateId" value={model.templateId} />
                <input type="hidden" name="eventId" value={model.eventId} />
                <span className="text-muted-foreground">
                  Arte atual: {Math.round(model.backgroundBytes / 1024)} KB
                </span>
                <button
                  type="submit"
                  data-testid="background-clear"
                  className="rounded-md border border-border px-2 py-1 font-medium hover:bg-accent"
                >
                  Remover arte
                </button>
              </form>
            ) : null}

            {[uploadState, clearState].map((feedback, index) =>
              feedback ? (
                <p
                  key={index}
                  role={feedback.ok ? 'status' : 'alert'}
                  data-testid={feedback.ok ? 'background-ok' : 'background-error'}
                  className={`text-xs ${feedback.ok ? 'text-success-strong' : 'text-destructive'}`}
                >
                  {feedback.message}
                  {feedback.details?.length ? ` ${feedback.details.join(' ')}` : ''}
                </p>
              ) : null,
            )}
          </>
        ) : (
          <p
            className="rounded-md border border-border p-3 text-xs text-muted-foreground"
            data-testid="background-needs-save"
          >
            Salve o modelo primeiro: a arte é guardada junto dele e o caminho no bucket usa o identificador
            do modelo.
          </p>
        )}
      </section>
    </aside>
  );
}

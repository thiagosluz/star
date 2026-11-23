'use client';

import {
  CERTIFICATE_PAGE_FORMATS,
  type CertificateBodyFit,
  type CertificatePageFormat,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';
import type { EditorElement } from '@/components/admin/certificate-template/types';

/** Prévia do documento gerada no servidor com sobreposição visual de estouro do corpo. */
export function TemplatePreviewPanel({
  variant,
  label,
  svg,
  body,
  fit,
  page,
}: {
  variant: CertificatePreviewVariant;
  label: string;
  svg: string | null;
  body: EditorElement | null;
  fit: CertificateBodyFit | null;
  page: CertificatePageFormat;
}) {
  const pageSize = CERTIFICATE_PAGE_FORMATS[page];
  const warning = fit?.warning ?? null;
  const slug = variant === 'FULL' ? 'full' : 'worst';

  return (
    <figure className="space-y-1" data-testid={`template-preview-${slug}`}>
      <figcaption className="text-xs font-medium">{label}</figcaption>

      {svg ? (
        // Papel branco nos dois modos para o SVG transparente com tinta escura; exceção em f61-varredura-escuro.test.ts.
        <div className="relative overflow-hidden rounded-md border border-border bg-white">
          <div
            data-testid={variant === 'FULL' ? 'template-preview' : 'template-preview-worst-svg'}
            className="[&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          {warning && body ? (
            <div
              data-testid={`template-preview-body-warning-${slug}`}
              className="pointer-events-none absolute border-2 border-destructive bg-destructive/10"
              style={{
                left: `${(body.xMm / pageSize.widthMm) * 100}%`,
                top: `${(body.yMm / pageSize.heightMm) * 100}%`,
                width: `${(body.widthMm / pageSize.widthMm) * 100}%`,
                height: `${(body.heightMm / pageSize.heightMm) * 100}%`,
              }}
            >
              <span className="absolute -top-5 left-0 rounded-sm bg-destructive px-1 text-xs whitespace-nowrap text-destructive-foreground">
                Não cabe: {warning.overflowLines} linha(s)
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
          Salve o modelo e clique em <strong>Atualizar prévia</strong> para ver o documento com dados de
          exemplo.
        </p>
      )}

      {fit ? (
        <p className="text-xs text-muted-foreground">
          {fit.lineCount} linha(s) no corpo · cabem {fit.maxLines}
        </p>
      ) : null}
    </figure>
  );
}

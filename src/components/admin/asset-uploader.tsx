'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ImageUp, Loader2, XCircle } from 'lucide-react';

import type { LandingActionState } from '@/app/actions/landing-actions';
import { Button, Input } from '@/components/ui';
import { uploadAssetFile } from '@/components/admin/asset-upload';
import {
  ASSET_TARGET_LABELS,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_BYTES,
  formatBytes,
  type AssetTarget,
} from '@/domain/events/image-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UPLOAD DE IMAGEM COM DESTINO EM COLUNA (FASE 17, item E4 · FASE 23)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE COMPONENTE É, DEPOIS DA FASE 23
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A esteira de três etapas (assina → navegador envia → servidor confere e grava)
 *  saiu daqui para `asset-upload.ts`, porque a galeria de imagens passou a precisar
 *  dela com outro destino (o formulário do bloco, e não uma coluna do evento).
 *
 *  O que fica aqui é o que é DESTE caso: a moldura com pré-visualização e o destino
 *  fixo — capa, logotipo do evento ou logotipo do patrocinador, todos gravados pelo
 *  servidor assim que a imagem é confirmada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

type Phase = 'idle' | 'uploading' | 'done' | 'error';

export function AssetUploader({
  tenantSlug,
  eventId,
  target,
  sponsorId,
  currentUrl,
  requestUploadAction,
  confirmUploadAction,
  disabled = false,
}: {
  tenantSlug: string;
  eventId: string;
  target: AssetTarget;
  /** Só para `SPONSOR_LOGO`. */
  sponsorId?: string;
  currentUrl: string | null;
  requestUploadAction: (
    prev: LandingActionState | null,
    formData: FormData,
  ) => Promise<LandingActionState>;
  confirmUploadAction: (
    prev: LandingActionState | null,
    formData: FormData,
  ) => Promise<LandingActionState>;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(currentUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const maxBytes = MAX_IMAGE_BYTES[target];
  const label = ASSET_TARGET_LABELS[target];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const file = inputRef.current?.files?.[0];
    if (!file) {
      setPhase('error');
      setMessage('Selecione uma imagem.');
      return;
    }

    setMessage(null);
    setPhase('uploading');

    const result = await uploadAssetFile({
      file,
      tenantSlug,
      eventId,
      target,
      ...(sponsorId ? { sponsorId } : {}),
      requestUploadAction,
      confirmUploadAction,
    });

    if (!result.ok) {
      setPhase('error');
      setMessage(result.message);
      return;
    }

    setUrl(result.url);
    setPhase('done');
    setMessage('Imagem enviada e vinculada.');

    /**
     * O refresh do servidor é necessário porque a imagem aparece em OUTRO ponto da
     * página (o cabeçalho do evento, o cartão do patrocinador na lista): o estado
     * local cobre o preview deste componente, e o refresh cobre o resto. Sem ele, o
     * organizador veria a imagem antiga ao lado da mensagem de sucesso.
     */
    router.refresh();
  }

  const busy = phase === 'uploading';

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid={`asset-uploader-${target}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-low">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={label}
              className="size-full object-contain"
              data-testid={`asset-preview-${target}`}
            />
          ) : (
            <ImageUp className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">
            {label}
            {url ? (
              <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-success-strong">
                <CheckCircle2 className="size-3" aria-hidden />
                definida
              </span>
            ) : null}
          </p>

          <p className="text-xs text-muted-foreground">
            PNG, JPEG, WebP ou AVIF · até {formatBytes(maxBytes)}. SVG não é aceito (pode conter
            script).
          </p>

          {!disabled ? (
            <form onSubmit={handleSubmit} className="space-y-2">
              <Input
                ref={inputRef}
                type="file"
                accept={IMAGE_ACCEPT_ATTRIBUTE}
                aria-label={label}
                className="h-auto py-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-surface-high file:px-2 file:py-1 file:text-xs"
              />
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <ImageUp className="size-3.5" aria-hidden />
                )}
                {busy ? 'Enviando imagem…' : url ? 'Substituir imagem' : 'Enviar imagem'}
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {message ? (
        <p
          role={phase === 'error' ? 'alert' : 'status'}
          data-testid={`asset-status-${target}`}
          className={`flex items-start gap-1.5 text-xs ${
            phase === 'error' ? 'text-destructive' : 'text-success-strong'
          }`}
        >
          {phase === 'error' ? (
            <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          {message}
        </p>
      ) : null}
    </div>
  );
}

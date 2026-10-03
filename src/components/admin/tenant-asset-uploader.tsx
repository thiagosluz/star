'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ImageUp, Loader2, XCircle } from 'lucide-react';

import { Button, Input } from '@/components/ui';import { uploadAssetFile, type AssetUploadAction } from '@/components/admin/asset-upload';
import {
  ASSET_TARGET_LABELS,
  IMAGE_ACCEPT_ATTRIBUTE,
  IMAGE_INPUT_LABEL,
  MAX_IMAGE_BYTES,
  WEBP_STORAGE_NOTICE,
  formatBytes,
  webpSavingsLabel,
} from '@/domain/events/image-rules';
import type { TenantPageImageTarget } from '@/lib/tenancy/tenant-page-asset-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UPLOAD DA CAPA E DO LOGOTIPO DA INSTITUIÇÃO (FASE 64 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO REUSA O `AssetUploader` DO EVENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Aquele componente exige `eventId` e declara os destinos do EVENTO (`COVER`,
 *  `LOGO`, `SPONSOR_LOGO`) — a página da instituição não tem evento, e o destino
 *  dela é a finalidade própria (`TENANT_COVER`, `TENANT_LOGO`).
 *
 *  O que NÃO se duplica é a esteira: `uploadAssetFile` (assinatura + magic bytes +
 *  checksum no navegador), as três etapas e o texto da conversão são os MESMOS
 *  módulos. Duplicar a leitura dos magic bytes seria duplicar justamente a parte
 *  que impede servir um arquivo disfarçado de imagem (o mesmo raciocínio da FASE 47
 *  ao reusar a esteira para a foto da pessoa).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PROPORÇÃO É DITA, E NÃO IMPOSTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Capa é uma faixa larga e o logotipo é quadrado — mas recortar a imagem de quem
 *  envia seria decidir por ele, e a FASE 40 já aprendeu que arte de terceiro entra
 *  como está. O que a tela faz é DIZER a proporção esperada e mostrar a
 *  pré-visualização na proporção em que a imagem vai aparecer (`object-cover`): o
 *  organizador vê o recorte antes de publicar, e não depois.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
type Phase = 'idle' | 'uploading' | 'done' | 'error';

export function TenantAssetUploader({
  tenantSlug,
  target,
  currentUrl,
  requestUploadAction,
  confirmUploadAction,
}: {
  tenantSlug: string;
  target: TenantPageImageTarget;
  currentUrl: string | null;
  requestUploadAction: AssetUploadAction;
  confirmUploadAction: AssetUploadAction;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(currentUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const maxBytes = MAX_IMAGE_BYTES[target];
  const label = ASSET_TARGET_LABELS[target];
  const ehCapa = target === 'TENANT_COVER';

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
      target,
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

    /**
     * A mensagem diz o que ACONTECEU com o arquivo: o organizador escolheu um PNG
     * de 3 MB e o que ficou guardado é um WebP menor — sem o número, a conversão
     * seria uma decisão do sistema que ele nunca vê.
     */
    const savings = webpSavingsLabel(result.sourceBytes, result.sizeBytes);
    setMessage(
      `Imagem enviada e guardada em WebP (${formatBytes(result.sizeBytes)}${
        savings ? ` — ${savings}` : ''
      }). Ela entra no rascunho: publique para os visitantes verem.`,
    );

    /**
     * O refresh cobre o que o estado local não cobre (a prévia logo abaixo, que é
     * renderizada pelo servidor com o rascunho recém-gravado).
     */
    router.refresh();
  }

  const busy = phase === 'uploading';

  return (
    <div
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid={`tenant-asset-uploader-${target}`}
    >
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-low ${
            ehCapa ? 'h-20 w-40' : 'size-20'
          }`}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={label}
              className="size-full object-cover"
              data-testid={`tenant-asset-preview-${target}`}
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
            {ehCapa
              ? 'Proporção de capa (bem larga, como 3:1). A imagem aparece preenchendo a faixa do topo.'
              : 'Proporção quadrada. A marca aparece ao lado do nome da instituição.'}{' '}
            {IMAGE_INPUT_LABEL} · até {formatBytes(maxBytes)}. SVG não é aceito (pode conter script).
          </p>

          <p className="text-xs text-muted-foreground" data-testid={`tenant-asset-webp-note-${target}`}>
            {WEBP_STORAGE_NOTICE}
          </p>

          <form onSubmit={handleSubmit} className="space-y-2">
            <Input
              ref={inputRef}
              type="file"
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              aria-label={label}
              data-testid={`tenant-asset-input-${target}`}
              className="h-auto py-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-surface-high file:px-2 file:py-1 file:text-xs"
            />
            <Button type="submit" size="sm" disabled={busy} data-testid={`tenant-asset-submit-${target}`}>
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Enviando imagem…
                </>
              ) : (
                <>
                  <ImageUp className="size-3.5" aria-hidden />
                  {url ? 'Substituir imagem' : 'Enviar imagem'}
                </>
              )}
            </Button>
          </form>
        </div>
      </div>

      {message ? (
        <p
          role={phase === 'error' ? 'alert' : 'status'}
          data-testid={`tenant-asset-status-${target}`}
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

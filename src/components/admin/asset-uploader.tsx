'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ImageUp, Loader2, XCircle } from 'lucide-react';

import type { LandingActionState } from '@/app/actions/landing-actions';
import { Button, Input } from '@/components/ui';
import {
  ASSET_TARGET_LABELS,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_BYTES,
  formatBytes,
  type AssetTarget,
} from '@/domain/events/image-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UPLOAD DE IMAGEM DIRETO AO STORAGE (FASE 17, item E4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS MESMAS TRÊS ETAPAS DO PDF DE SUBMISSÃO, COM UMA DIFERENÇA DECISIVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. lê os primeiros bytes do arquivo (assinatura real) e calcula o SHA-256
 *      2. pede a URL pré-assinada — o servidor valida tamanho E assinatura
 *      3. envia o arquivo direto ao bucket público de assets
 *      4. confirma: o servidor lê o objeto de volta e só então grava a URL
 *
 *  A diferença está no passo 1: aqui a ASSINATURA DO ARQUIVO é enviada ao servidor
 *  junto do tipo declarado. É ela que permite recusar um `.exe` renomeado para
 *  `.png` — e numa imagem que vai ser servida pública e indefinidamente, isso é o
 *  que separa "conteúdo do organizador" de "arquivo arbitrário no domínio da
 *  instituição".
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Quantos bytes iniciais cobrem todas as assinaturas aceitas (AVIF precisa de 12). */
const MAGIC_BYTES_TO_READ = 16;

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readMagicBytes(file: File): Promise<number[]> {
  const slice = file.slice(0, MAGIC_BYTES_TO_READ);
  const buffer = await slice.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

type Phase = 'idle' | 'hashing' | 'requesting' | 'uploading' | 'confirming' | 'done' | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Selecionar imagem',
  hashing: 'Conferindo arquivo…',
  requesting: 'Preparando envio…',
  uploading: 'Enviando imagem…',
  confirming: 'Validando no armazenamento…',
  done: 'Imagem publicada',
  error: 'Tentar novamente',
};

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

    /**
     * O limite é checado aqui TAMBÉM, e não só no servidor: enviar 30 MB pela rede
     * para receber "excede o limite" no fim é desperdício de banda do organizador.
     * A validação do servidor continua sendo a que decide.
     */
    if (file.size > maxBytes) {
      setPhase('error');
      setMessage(`A imagem excede o limite de ${formatBytes(maxBytes)} para ${label.toLowerCase()}.`);
      return;
    }

    setMessage(null);

    try {
      setPhase('hashing');
      const checksum = await sha256Hex(file);
      const magicBytes = await readMagicBytes(file);

      setPhase('requesting');
      const requestForm = new FormData();
      requestForm.set('tenantSlug', tenantSlug);
      requestForm.set('eventId', eventId);
      requestForm.set('target', target);
      if (sponsorId) requestForm.set('sponsorId', sponsorId);
      requestForm.set('fileName', file.name);
      requestForm.set('mimeType', file.type);
      requestForm.set('sizeBytes', String(file.size));
      requestForm.set('checksum', checksum);
      requestForm.set('magicBytes', magicBytes.join(','));

      const requestResult = await requestUploadAction(null, requestForm);
      if (!requestResult.ok) {
        setPhase('error');
        setMessage(requestResult.message ?? 'Não foi possível preparar o envio.');
        return;
      }

      const ticket = requestResult.data as {
        uploadUrl: string;
        objectKey: string;
        bucket: string;
        requiredHeaders: Record<string, string>;
        mimeType: string;
      };

      setPhase('uploading');
      const put = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: ticket.requiredHeaders,
        body: file,
      });

      if (!put.ok) {
        setPhase('error');
        setMessage(`O envio ao armazenamento falhou (HTTP ${put.status}).`);
        return;
      }

      setPhase('confirming');
      const confirmForm = new FormData();
      confirmForm.set('tenantSlug', tenantSlug);
      confirmForm.set('eventId', eventId);
      confirmForm.set('target', target);
      if (sponsorId) confirmForm.set('sponsorId', sponsorId);
      confirmForm.set('objectKey', ticket.objectKey);
      confirmForm.set('bucket', ticket.bucket);
      confirmForm.set('fileName', file.name);
      confirmForm.set('mimeType', ticket.mimeType);
      confirmForm.set('sizeBytes', String(file.size));
      confirmForm.set('checksum', checksum);

      const confirmResult = await confirmUploadAction(null, confirmForm);
      if (!confirmResult.ok) {
        setPhase('error');
        setMessage(confirmResult.message ?? 'A validação da imagem falhou.');
        return;
      }

      setUrl((confirmResult.data?.url as string | undefined) ?? null);
      setPhase('done');
      setMessage('Imagem enviada e vinculada.');

      /**
       * O refresh do servidor é necessário porque a imagem aparece em OUTRO ponto da
       * página (o `<img>` do preview, o cabeçalho do evento): o estado local cobre o
       * preview deste componente, e o refresh cobre o resto. Sem ele, o organizador
       * veria a capa antiga ao lado da mensagem de sucesso.
       */
      router.refresh();
    } catch (error) {
      setPhase('error');
      setMessage(
        error instanceof Error ? `Falha no envio: ${error.message}` : 'Falha inesperada no envio.',
      );
    }
  }

  const busy = phase === 'hashing' || phase === 'requesting' || phase === 'uploading' || phase === 'confirming';

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
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ImageUp className="size-3.5" aria-hidden />}
                {busy ? PHASE_LABEL[phase] : url ? 'Substituir imagem' : 'Enviar imagem'}
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

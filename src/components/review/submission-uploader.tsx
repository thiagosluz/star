'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileUp, Loader2, ShieldCheck, XCircle } from 'lucide-react';

import type { ActionState } from '@/app/actions/review-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Upload direto ao object storage
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS ETAPAS, E POR QUE O CHECKSUM É CALCULADO AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. calcula SHA-256 do arquivo (Web Crypto, no navegador)
 *      2. pede a URL pré-assinada ao servidor
 *      3. envia o arquivo DIRETO ao storage (não passa pela aplicação)
 *      4. confirma ao servidor, que CONFERE o objeto armazenado
 *
 *  Calcular o hash no cliente é o que dá ao servidor algo a comparar. Sem ele,
 *  a confirmação só poderia verificar o tamanho — e um arquivo de mesmo tamanho
 *  e conteúdo diferente passaria.
 *
 *  O arquivo nunca atravessa a aplicação: sem isso, um PDF de 20 MB seria
 *  carregado inteiro na memória do processo Node antes de ir ao storage.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type UploadKind =
  | 'BLIND_PDF'
  | 'IDENTIFIED_PDF'
  | 'SUPPLEMENTARY'
  | 'PRESENTATION'
  | 'CAMERA_READY';

export interface UploadedArtifact {
  kind: UploadKind;
  fileName: string;
  sizeBytes: number;
  checksum: string;
  version: number;
}

const KIND_LABELS: Record<UploadKind, string> = {
  BLIND_PDF: 'Versão cega (sem identificação)',
  IDENTIFIED_PDF: 'Versão identificada (com autores)',
  SUPPLEMENTARY: 'Material suplementar',
  PRESENTATION: 'Apresentação',
  CAMERA_READY: 'Versão final (camera-ready)',
};

/** Limite alinhado ao domínio (`MAX_FILE_SIZE_BYTES`). */
const MAX_BYTES = 25 * 1024 * 1024;

/** Calcula o SHA-256 em hexadecimal usando a Web Crypto API. */
async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Lê os primeiros bytes do arquivo para validar a assinatura de PDF. */
async function readMagicBytes(file: File, count = 5): Promise<number[]> {
  const slice = file.slice(0, count);
  const buffer = await slice.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

type Phase = 'idle' | 'hashing' | 'requesting' | 'uploading' | 'confirming' | 'done' | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Selecionar arquivo',
  hashing: 'Calculando integridade…',
  requesting: 'Preparando envio…',
  uploading: 'Enviando arquivo…',
  confirming: 'Verificando integridade…',
  done: 'Anexado',
  error: 'Tentar novamente',
};

/**
 * Botão de envio.
 *
 * O estado `busy` vem do componente pai (e não de `useFormStatus`) porque o
 * fluxo é orquestrado por JavaScript: as actions são chamadas diretamente para
 * obter o retorno, em vez de submetidas ao React. `useFormStatus` só funcionaria
 * para o envio de formulário padrão.
 */
function SubmitButton({ phase }: { phase: Phase }) {
  const busy = phase !== 'idle' && phase !== 'done' && phase !== 'error';

  return (
    <button
      type="submit"
      disabled={busy || phase === 'done'}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <FileUp className="size-4" aria-hidden />
      )}
      {busy ? PHASE_LABEL[phase] : phase === 'done' ? 'Anexado' : 'Anexar arquivo'}
    </button>
  );
}

export function SubmissionUploader({
  tenantSlug,
  submissionId,
  kind,
  requestUploadAction,
  confirmUploadAction,
  existing,
  disabled,
}: {
  tenantSlug: string;
  submissionId: string;
  kind: UploadKind;
  requestUploadAction: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
  confirmUploadAction: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
  existing: UploadedArtifact | null;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedArtifact | null>(existing);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  /**
   * Executa o fluxo completo. Chamado no submit do formulário, porque é aqui que
   * temos os três pedaços que precisam andar juntos: o arquivo (para o hash), a
   * URL assinada (do servidor) e o PUT (para o storage).
   */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const selected = inputRef.current?.files?.[0] ?? file;
    if (!selected) {
      setPhase('error');
      setMessage('Selecione um arquivo PDF.');
      return;
    }

    if (selected.size > MAX_BYTES) {
      setPhase('error');
      setMessage(`O arquivo excede o limite de ${Math.floor(MAX_BYTES / 1024 / 1024)} MB.`);
      return;
    }

    setMessage(null);

    try {
      // ── 1. Hash e assinatura do arquivo ──────────────────────────────────
      setPhase('hashing');
      const checksum = await sha256Hex(selected);
      const magicBytes = await readMagicBytes(selected);

      // ── 2. URL pré-assinada ──────────────────────────────────────────────
      setPhase('requesting');
      const requestForm = new FormData();
      requestForm.set('tenantSlug', tenantSlug);
      requestForm.set('submissionId', submissionId);
      requestForm.set('kind', kind);
      requestForm.set('fileName', selected.name);
      requestForm.set('mimeType', selected.type || 'application/pdf');
      requestForm.set('sizeBytes', String(selected.size));
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
        version: number;
      };

      // ── 3. Envio direto ao storage ───────────────────────────────────────
      setPhase('uploading');
      const put = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: ticket.requiredHeaders,
        body: selected,
      });

      if (!put.ok) {
        setPhase('error');
        setMessage(
          `O envio ao armazenamento falhou (HTTP ${put.status}). Verifique sua conexão e tente novamente.`,
        );
        return;
      }

      // ── 4. Confirmação com verificação de integridade ────────────────────
      setPhase('confirming');
      const confirmForm = new FormData();
      confirmForm.set('tenantSlug', tenantSlug);
      confirmForm.set('submissionId', submissionId);
      confirmForm.set('kind', kind);
      confirmForm.set('objectKey', ticket.objectKey);
      confirmForm.set('bucket', ticket.bucket);
      confirmForm.set('fileName', selected.name);
      confirmForm.set('mimeType', selected.type || 'application/pdf');
      confirmForm.set('sizeBytes', String(selected.size));
      confirmForm.set('checksum', checksum);
      confirmForm.set('version', String(ticket.version));

      const confirmResult = await confirmUploadAction(null, confirmForm);

      if (!confirmResult.ok) {
        setPhase('error');
        setMessage(confirmResult.message ?? 'A verificação do arquivo falhou.');
        return;
      }

      setUploaded({
        kind,
        fileName: selected.name,
        sizeBytes: selected.size,
        checksum,
        version: ticket.version,
      });
      setPhase('done');
      setMessage('Arquivo anexado e verificado.');

      /**
       * ─── O REFRESH DO SERVIDOR NÃO É COSMÉTICO ────────────────────────────
       * Os bloqueios de envio ("anexe a versão cega") são calculados no
       * componente de SERVIDOR a partir dos arquivos já confirmados. Sem
       * revalidar, o autor anexava o PDF, via "Arquivo anexado e verificado" e
       * continuava com o botão "Enviar para avaliação" desabilitado por um
       * bloqueio que já não existe.
       *
       * As actions são chamadas diretamente (não por `<form action>`), então o
       * React não revalida sozinho: a revalidação precisa ser explícita.
       */
      router.refresh();
    } catch (error) {
      setPhase('error');
      setMessage(
        error instanceof Error
          ? `Falha no envio: ${error.message}`
          : 'Falha inesperada no envio.',
      );
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{KIND_LABELS[kind]}</p>

          {uploaded ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-success-strong" aria-hidden />
              <span className="truncate">{uploaded.fileName}</span>
              <span className="shrink-0">
                · {(uploaded.sizeBytes / 1024 / 1024).toFixed(2)} MB · v{uploaded.version}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              PDF de até {Math.floor(MAX_BYTES / 1024 / 1024)} MB
            </p>
          )}

          {uploaded ? (
            <p
              className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground"
              title={`SHA-256: ${uploaded.checksum}`}
            >
              <ShieldCheck className="size-3" aria-hidden />
              {uploaded.checksum.slice(0, 16)}…
            </p>
          ) : null}
        </div>

        {!uploaded && !disabled ? (
          <form onSubmit={handleSubmit} className="shrink-0">
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="mb-2 block w-full max-w-56 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
              aria-label={KIND_LABELS[kind]}
            />
            <SubmitButton phase={phase} />
          </form>
        ) : null}
      </div>

      {message ? (
        <p
          role={phase === 'error' ? 'alert' : undefined}
          className={`flex items-start gap-1.5 text-xs ${
            phase === 'error' ? 'text-destructive' : 'text-muted-foreground'
          }`}
          data-testid={`upload-status-${kind}`}
        >
          {phase === 'error' ? (
            <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : null}
          {message}
        </p>
      ) : null}

      {disabled ? (
        <p className="text-xs text-muted-foreground">
          A submissão já foi enviada; alterações criam uma nova versão.
        </p>
      ) : null}
    </div>
  );
}

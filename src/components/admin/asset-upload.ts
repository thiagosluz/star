import type { LandingActionState } from '@/app/actions/landing-actions';
import {
  MAX_IMAGE_BYTES,
  formatBytes,
  type AssetTarget,
} from '@/domain/events/image-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ESTEIRA DE UPLOAD DE IMAGEM (FASE 23, item E10)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU MÓDULO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 17 escreveu as três etapas (assina → envia → confirma) dentro do
 *  componente da capa. A galeria precisa das MESMAS etapas dentro de um formulário
 *  de bloco, e uma segunda cópia divergiria no primeiro ajuste — provavelmente no
 *  cálculo da assinatura do arquivo (os MAGIC BYTES), que é justamente a parte que
 *  impede servir um arquivo disfarçado de imagem.
 *
 *  Módulo neutro (sem `'use client'`): é importado pelos componentes de cliente, mas
 *  não é um componente — é a operação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Quantos bytes iniciais cobrem todas as assinaturas aceitas (AVIF precisa de 12). */
const MAGIC_BYTES_TO_READ = 16;

export type AssetUploadAction = (
  prev: LandingActionState | null,
  formData: FormData,
) => Promise<LandingActionState>;

export interface UploadAssetInput {
  file: File;
  tenantSlug: string;
  eventId: string;
  target: AssetTarget;
  /** Só para `SPONSOR_LOGO`. */
  sponsorId?: string;
  requestUploadAction: AssetUploadAction;
  confirmUploadAction: AssetUploadAction;
}

export type UploadAssetResult =
  | { ok: true; url: string; objectKey: string; sizeBytes: number }
  | { ok: false; message: string };

/** SHA-256 em hexadecimal, no navegador (Web Crypto). */
async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Primeiros bytes do arquivo — é o que permite ao servidor conferir a assinatura. */
async function readMagicBytes(file: File): Promise<number[]> {
  const slice = file.slice(0, MAGIC_BYTES_TO_READ);
  const buffer = await slice.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

export async function uploadAssetFile(input: UploadAssetInput): Promise<UploadAssetResult> {
  const { file } = input;
  const maxBytes = MAX_IMAGE_BYTES[input.target];

  /**
   * O limite é checado aqui TAMBÉM, e não só no servidor: enviar 30 MB pela rede para
   * receber "excede o limite" no fim é desperdício de banda de quem está no evento. A
   * validação do servidor continua sendo a que decide.
   */
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `A imagem excede o limite de ${formatBytes(maxBytes)} para esta finalidade.`,
    };
  }

  try {
    const checksum = await sha256Hex(file);
    const magicBytes = await readMagicBytes(file);

    const requestForm = new FormData();
    requestForm.set('tenantSlug', input.tenantSlug);
    requestForm.set('eventId', input.eventId);
    requestForm.set('target', input.target);
    if (input.sponsorId) requestForm.set('sponsorId', input.sponsorId);
    requestForm.set('fileName', file.name);
    requestForm.set('mimeType', file.type);
    requestForm.set('sizeBytes', String(file.size));
    requestForm.set('checksum', checksum);
    requestForm.set('magicBytes', magicBytes.join(','));

    const requestResult = await input.requestUploadAction(null, requestForm);
    if (!requestResult.ok) {
      return { ok: false, message: requestResult.message ?? 'Não foi possível preparar o envio.' };
    }

    const ticket = requestResult.data as {
      uploadUrl: string;
      objectKey: string;
      bucket: string;
      requiredHeaders: Record<string, string>;
      mimeType: string;
    };

    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.requiredHeaders,
      body: file,
    });

    if (!put.ok) {
      return { ok: false, message: `O envio ao armazenamento falhou (HTTP ${put.status}).` };
    }

    const confirmForm = new FormData();
    confirmForm.set('tenantSlug', input.tenantSlug);
    confirmForm.set('eventId', input.eventId);
    confirmForm.set('target', input.target);
    if (input.sponsorId) confirmForm.set('sponsorId', input.sponsorId);
    confirmForm.set('objectKey', ticket.objectKey);
    confirmForm.set('bucket', ticket.bucket);
    confirmForm.set('fileName', file.name);
    confirmForm.set('mimeType', ticket.mimeType);
    confirmForm.set('sizeBytes', String(file.size));
    confirmForm.set('checksum', checksum);

    const confirmResult = await input.confirmUploadAction(null, confirmForm);
    if (!confirmResult.ok) {
      return { ok: false, message: confirmResult.message ?? 'A validação da imagem falhou.' };
    }

    const url = confirmResult.data?.url;
    if (typeof url !== 'string') {
      return { ok: false, message: 'O servidor não devolveu o endereço da imagem.' };
    }

    return { ok: true, url, objectKey: ticket.objectKey, sizeBytes: file.size };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? `Falha no envio: ${error.message}` : 'Falha inesperada no envio.',
    };
  }
}

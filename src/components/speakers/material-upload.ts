import type { SpeakerActionState } from '@/app/actions/speaker-actions';
import {
  MAX_MATERIAL_BYTES,
  validateMaterialUpload,
} from '@/domain/speakers/speaker-rules';
import { formatBytes } from '@/domain/events/image-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ESTEIRA DE UPLOAD DE MATERIAL (FASE 25, item E20)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS MESMAS TRÊS ETAPAS DO RESTO DA PLATAFORMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. pede a URL pré-assinada (o servidor valida tipo, tamanho e VÍNCULO)
 *      2. o navegador envia DIRETO ao storage (o arquivo não passa pelo Node)
 *      3. confirma, e o servidor lê o objeto de volta antes de gravar
 *
 *  O SHA-256 é calculado AQUI e conferido lá: sem isso, uma rede instável produziria
 *  um material truncado sem ninguém perceber — e o palestrante só descobriria na hora
 *  da aula.
 *
 *  A validação local (`validateMaterialUpload`) repete a do servidor de propósito: um
 *  arquivo de 60 MB não deve atravessar a rede para receber "excede o limite" no fim.
 *  Quem DECIDE continua sendo o servidor.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const MAGIC_BYTES_TO_READ = 16;

export type SpeakerUploadAction = (
  prev: SpeakerActionState | null,
  formData: FormData,
) => Promise<SpeakerActionState>;

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

export type UploadMaterialResult =
  | { ok: true; materialId: string }
  | { ok: false; message: string };

export async function uploadSpeakerMaterial(input: {
  file: File;
  tenantSlug: string;
  eventId: string;
  activityId: string;
  speakerProfileId: string;
  title: string;
  description: string;
  kind: string;
  visibility: string;
  requestUploadAction: SpeakerUploadAction;
  confirmUploadAction: SpeakerUploadAction;
}): Promise<UploadMaterialResult> {
  const { file } = input;

  const local = validateMaterialUpload({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    // Sem os bytes aqui: a validação local é de conveniência (tipo declarado +
    // extensão); a assinatura real é conferida no servidor, que lê o objeto do bucket.
    magicBytes: null,
  });

  if (!local.ok) {
    return { ok: false, message: local.errors[0]?.message ?? 'Material não aceito.' };
  }

  if (file.size > MAX_MATERIAL_BYTES) {
    return { ok: false, message: `O material excede o limite de ${formatBytes(MAX_MATERIAL_BYTES)}.` };
  }

  try {
    const checksum = await sha256Hex(file);
    const magicBytes = await readMagicBytes(file);

    const requestForm = new FormData();
    requestForm.set('tenantSlug', input.tenantSlug);
    requestForm.set('eventId', input.eventId);
    requestForm.set('activityId', input.activityId);
    requestForm.set('speakerProfileId', input.speakerProfileId);
    requestForm.set('fileName', file.name);
    requestForm.set('mimeType', file.type || local.mimeType);
    requestForm.set('sizeBytes', String(file.size));
    requestForm.set('magicBytes', magicBytes.join(','));

    const requested = await input.requestUploadAction(null, requestForm);
    if (!requested.ok) {
      return { ok: false, message: requested.message ?? 'Não foi possível preparar o envio.' };
    }

    const ticket = requested.data as {
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
    confirmForm.set('activityId', input.activityId);
    confirmForm.set('speakerProfileId', input.speakerProfileId);
    confirmForm.set('title', input.title.trim().length > 0 ? input.title : file.name);
    confirmForm.set('description', input.description);
    confirmForm.set('kind', input.kind);
    confirmForm.set('visibility', input.visibility);
    confirmForm.set('objectKey', ticket.objectKey);
    confirmForm.set('bucket', ticket.bucket);
    confirmForm.set('fileName', file.name);
    confirmForm.set('mimeType', ticket.mimeType);
    confirmForm.set('sizeBytes', String(file.size));
    confirmForm.set('checksum', checksum);

    const confirmed = await input.confirmUploadAction(null, confirmForm);
    if (!confirmed.ok) {
      return { ok: false, message: confirmed.message ?? 'A validação do material falhou.' };
    }

    const materialId = confirmed.data?.materialId;
    if (typeof materialId !== 'string') {
      return { ok: false, message: 'O servidor não confirmou o material.' };
    }

    return { ok: true, materialId };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `Falha no envio: ${error.message}` : 'Falha inesperada no envio.',
    };
  }
}

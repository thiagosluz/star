/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Imagens do evento por upload direto ao storage (FASE 17, item E4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O MESMO FLUXO EM TRÊS ETAPAS DO UPLOAD DE SUBMISSÃO, POR OUTRO MOTIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Em submissão, o motivo de não passar o arquivo pela aplicação é TAMANHO (um PDF
 *  de 20 MB na memória do processo Node). Aqui o motivo principal é outro: a imagem
 *  vai ser servida PÚBLICA e INDEFINIDAMENTE, então o que importa é que o objeto no
 *  bucket tenha o tipo certo e o nome certo.
 *
 *      1. `requestAssetUpload`  → URL assinada, com tipo e tamanho travados
 *      2. (navegador → storage)
 *      3. `confirmAssetUpload`  → confere o objeto, GRAVA a URL no evento/patrocínio
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A URL ASSINADA TRAVA — E O QUE ELA NÃO TRAVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela trava a chave exata, o tamanho e a validade. O que ela NÃO trava é o
 *  conteúdo: quem tem a URL pode enviar qualquer coisa. É por isso que a confirmação
 *  lê o objeto de volta (`inspectObject`) e só então grava a URL no banco — e é por
 *  isso que a chave do objeto NUNCA é a que o cliente pediu (o nome final é gerado
 *  aqui, no servidor).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  BUCKETS,
  createUploadUrl,
  deleteObject,
  inspectObject,
  sanitizeFileName,
  UPLOAD_URL_TTL_SECONDS,
} from '@/lib/storage/s3-client';
import { isSha256Hex, verifyStoredObject } from '@/domain/review/submission-rules';
import {
  canonicalExtension,
  validateImageUpload,
  type AssetTarget,
  type ImageMimeType,
} from '@/domain/events/image-rules';
import type { TxClient } from '@/lib/db/tenant-client';

export type AssetErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INTEGRITY'
  | 'STORAGE'
  | 'INTERNAL';

export type AssetResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AssetErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Chave do objeto
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Chave do objeto no bucket de assets.
 *
 * Três decisões, todas com motivo:
 *   • particionada por instituição no primeiro segmento — permite ciclo de vida e
 *     remoção cirúrgica por LGPD, como no upload de submissão;
 *   • o identificador único fica no INÍCIO do nome: dois envios de `capa.png` não
 *     colidem, e o segundo não sobrescreve o primeiro (o que deixaria a URL antiga
 *     apontando para a imagem nova);
 *   • a extensão vem do tipo REAL detectado, não do nome enviado.
 */
export function buildAssetObjectKey(input: {
  tenantId: string;
  eventId: string;
  target: AssetTarget;
  mimeType: ImageMimeType;
  fileName: string;
}): string {
  const base = sanitizeFileName(input.fileName).replace(/\.[a-z0-9]{2,5}$/i, '');
  const extension = canonicalExtension(input.mimeType);

  return [
    'tenants',
    input.tenantId,
    'eventos',
    input.eventId,
    'assets',
    input.target.toLowerCase(),
    `${randomUUID()}-${base || 'imagem'}.${extension}`,
  ].join('/');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Etapa 1 — URL pré-assinada
// ───────────────────────────────────────────────────────────────────────────────
export interface AssetUploadTicket {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  requiredHeaders: Record<string, string>;
  expiresInSeconds: number;
  /** Tipo que será GRAVADO — pode diferir do declarado pelo cliente (assinatura real). */
  mimeType: ImageMimeType;
  maxBytes: number;
}

export async function requestAssetUpload(input: {
  tenantId: string;
  eventId: string;
  target: AssetTarget;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  magicBytes?: readonly number[] | null;
}): Promise<AssetResult<AssetUploadTicket>> {
  const validation = validateImageUpload({
    target: input.target,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    magicBytes: input.magicBytes ?? null,
  });

  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: validation.errors[0]?.message ?? 'Imagem não aceita.',
      details: validation.errors.map((error) => error.message),
    };
  }

  try {
    const event = await withTenant(input.tenantId, (tx) =>
      tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      }),
    );

    if (!event) {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    const objectKey = buildAssetObjectKey({
      tenantId: input.tenantId,
      eventId: input.eventId,
      target: input.target,
      mimeType: validation.mimeType,
      fileName: input.fileName,
    });

    const bucket = BUCKETS.assets();

    const ticket = await createUploadUrl({
      bucket,
      objectKey,
      contentType: validation.mimeType,
      contentLength: input.sizeBytes,
    });

    return {
      ok: true,
      uploadUrl: ticket.uploadUrl,
      objectKey: ticket.objectKey,
      bucket: ticket.bucket,
      requiredHeaders: ticket.requiredHeaders,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      mimeType: validation.mimeType,
      maxBytes: validation.maxBytes,
    };
  } catch (error) {
    console.error(`[asset] falha ao preparar upload: ${errorMessage(error)}`);
    return { ok: false, code: 'STORAGE', message: 'Não foi possível preparar o envio da imagem.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Etapa 3 — confirmação e gravação
// ───────────────────────────────────────────────────────────────────────────────
export interface ConfirmAssetInput {
  tenantId: string;
  eventId: string;
  actorId: string;
  target: AssetTarget;
  /** Só para `SPONSOR_LOGO`: em qual patrocinador gravar a URL. */
  sponsorId?: string;
  objectKey: string;
  bucket: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Confere o objeto enviado e grava a URL pública no destino.
 *
 * A URL é montada a partir da chave NO BUCKET, e não do que o cliente mandou: o
 * cliente informa a chave (é o que ele recebeu) e o serviço confere que ela pertence
 * ao prefixo da instituição/evento/finalidade. Sem essa conferência, uma chave
 * arbitrária viraria a capa do evento — e o organizador apontaria a capa para o PDF
 * de submissão de outra pessoa.
 */
export async function confirmAssetUpload(
  input: ConfirmAssetInput,
): Promise<AssetResult<{ url: string; objectKey: string; sizeBytes: number }>> {
  if (!isSha256Hex(input.checksum)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Checksum SHA-256 inválido.' };
  }

  if (input.bucket !== safeBucket()) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Bucket de destino não permitido.' };
  }

  const expectedPrefix = `tenants/${input.tenantId}/eventos/${input.eventId}/assets/${input.target.toLowerCase()}/`;
  if (!input.objectKey.startsWith(expectedPrefix)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A chave do objeto não corresponde a esta instituição, evento e finalidade.',
    };
  }

  try {
    const stored = await inspectObject(input.bucket, input.objectKey);

    const integrity = verifyStoredObject({
      declaredSize: input.sizeBytes,
      storedSize: stored.sizeBytes,
      declaredChecksum: input.checksum,
      storedChecksum: stored.checksum,
    });

    if (!integrity.ok) {
      // Objeto inválido é removido: deixá-lo no bucket só acumularia lixo pago.
      await deleteObject(input.bucket, input.objectKey).catch(() => undefined);
      return { ok: false, code: 'INTEGRITY', message: integrity.message };
    }

    const storedMime = stored.contentType ?? input.mimeType;
    const realMime = detectImageMimeFromContentType(storedMime, input.mimeType);

    if (!realMime) {
      await deleteObject(input.bucket, input.objectKey).catch(() => undefined);
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'O objeto armazenado não é uma imagem aceita (PNG, JPEG, WebP ou AVIF).',
      };
    }

    const url = publicObjectUrl(input.bucket, input.objectKey);

    const written = await withTenant(input.tenantId, async (tx) => {
      if (input.target === 'SPONSOR_LOGO') {
        return writeSponsorLogo(tx, input, url);
      }

      const column = input.target === 'COVER' ? 'coverImageUrl' : 'logoUrl';

      const before = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, coverImageUrl: true, logoUrl: true },
      });

      if (!before) return { ok: false as const, reason: 'NOT_FOUND' as const };

      await tx.event.update({
        where: { id: before.id },
        data: input.target === 'COVER' ? { coverImageUrl: url } : { logoUrl: url },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'event',
          entityId: before.id,
          changes: {
            [column]: {
              from: input.target === 'COVER' ? before.coverImageUrl : before.logoUrl,
              to: url,
            },
          },
        },
        tx,
      );

      return { ok: true as const };
    });

    if (!written.ok) {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento ou patrocinador não encontrado.' };
    }

    return { ok: true, url, objectKey: input.objectKey, sizeBytes: stored.sizeBytes };
  } catch (error) {
    console.error(`[asset] falha ao confirmar upload: ${errorMessage(error)}`);
    return { ok: false, code: 'STORAGE', message: 'Não foi possível confirmar a imagem enviada.' };
  }
}

async function writeSponsorLogo(
  tx: TxClient,
  input: ConfirmAssetInput,
  url: string,
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' }> {
  if (!input.sponsorId) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const sponsor = await tx.sponsor.findFirst({
    where: { id: input.sponsorId, tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
    select: { id: true, name: true, logoUrl: true },
  });

  if (!sponsor) return { ok: false, reason: 'NOT_FOUND' };

  await tx.sponsor.update({ where: { id: sponsor.id }, data: { logoUrl: url } });

  await recordAudit(
    {
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'UPDATE',
      entityType: 'sponsor',
      entityId: sponsor.id,
      changes: { logoUrl: { from: sponsor.logoUrl, to: url } },
    },
    tx,
  );

  return { ok: true };
}

/**
 * URL pública do objeto.
 *
 * O bucket de assets é o ÚNICO público do projeto, e isso é uma decisão de
 * desenho da FASE 1: capa e logotipo aparecem na página pública, e assinar uma URL
 * por exibição faria a página depender de uma chamada de servidor para cada
 * imagem. O que NÃO vai para este bucket continua com URL assinada (submissões,
 * certificados), porque ali o conteúdo é dado pessoal ou trabalho não publicado.
 *
 * O host vem de `S3_PUBLIC_ENDPOINT`, e não de `S3_ENDPOINT`: em Docker o servidor
 * fala `http://minio:9000`, que o navegador do visitante não resolve. É a mesma
 * distinção que o cliente de assinatura já faz (`publicClient`).
 */
export function publicObjectUrl(bucket: string, objectKey: string): string {
  const base = (
    process.env.S3_PUBLIC_URL ??
    process.env.S3_PUBLIC_ENDPOINT ??
    process.env.S3_ENDPOINT ??
    'http://localhost:9000'
  ).replace(/\/+$/, '');

  return `${base}/${bucket}/${objectKey}`;
}

function safeBucket(): string {
  return BUCKETS.assets();
}

/**
 * Tipo real do objeto armazenado.
 *
 * O storage devolve o `Content-Type` que foi ASSINADO no upload — e a assinatura
 * foi feita com o tipo validado. Ainda assim conferimos: um bucket com política
 * frouxa ou um `PutObject` fora da aplicação poderiam ter gravado outra coisa ali, e
 * é a página pública que serviria o resultado.
 */
function detectImageMimeFromContentType(
  contentType: string,
  fallback: string,
): ImageMimeType | null {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  return asImageMime(normalized) ?? asImageMime(fallback);
}

function asImageMime(value: string): ImageMimeType | null {
  return value === 'image/png' ||
    value === 'image/jpeg' ||
    value === 'image/webp' ||
    value === 'image/avif'
    ? value
    : null;
}

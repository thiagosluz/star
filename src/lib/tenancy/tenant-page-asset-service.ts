/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Capa e logotipo da página da INSTITUIÇÃO
 *                                                            (FASE 64 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA ESTEIRA NÃO É A DO EVENTO, E O QUE ELA REUSA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A esteira do acervo (`asset-service.ts`) é do EVENTO em três pontos que não dão
 *  para contornar: a chave do objeto é particionada por evento
 *  (`tenants/<id>/eventos/<id>/assets/...`), o dono da imagem é uma coluna do
 *  evento e a leitura confere a existência de um evento. A página da instituição não
 *  tem evento nenhum — ela é da CASA.
 *
 *  O que NÃO se duplica é a parte que importa, e é por isso que este arquivo tem
 *  poucas linhas próprias:
 *
 *    • **validação** — `validateImageUpload` (allowlist, teto de bytes, assinatura
 *      real por magic bytes) e `verifyStoredObject` (tamanho e SHA-256 do objeto
 *      gravado), as MESMAS funções;
 *    • **conversão** — `encodeAssetAsWebp`, a F46: o arquivo é decodificado no
 *      servidor (é isso que dá a palavra final sobre o conteúdo ser imagem), vira
 *      WebP com a política da FINALIDADE e o ORIGINAL É APAGADO;
 *    • **quota** — `ensureStorageRoom`, conferida ANTES de assinar a URL (F21),
 *      exatamente como nos três caminhos existentes. Recusar depois do envio
 *      deixaria objeto pago e órfão no bucket.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ENVIO ENTRA NO ACERVO DA INSTITUIÇÃO (`media_assets`)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A coluna `MediaAsset.eventId` é NULÁVEL desde a FASE 24, e o comentário do
 *  modelo diz para que: "Nulo = acervo da instituição". É o caso exato desta página.
 *
 *  Registrar aqui não é formalidade: a tabela é a ORIGEM da medida de
 *  armazenamento (`storageUsage` soma `media_assets` por instituição), é ela que
 *  permite apagar a imagem depois, e é ela que deduplica o MESMO arquivo enviado
 *  duas vezes. Sem o registro, a capa da instituição seria bytes invisíveis para a
 *  quota do plano e para o acervo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { isSha256Hex, verifyStoredObject } from '@/domain/review/submission-rules';
import { encodeAssetAsWebp } from '@/lib/storage/image-converter';
import { ensureStorageRoom } from '@/lib/storage/storage-quota';
import { registerAsset } from '@/lib/admin/media-asset-service';
import { publicObjectUrl } from '@/lib/admin/asset-service';
import {
  BUCKETS,
  createUploadUrl,
  deleteObject,
  getObjectBuffer,
  inspectObject,
  putObjectBuffer,
  sanitizeFileName,
  UPLOAD_URL_TTL_SECONDS,
} from '@/lib/storage/s3-client';
import {
  canonicalExtension,
  formatBytes,
  STORED_IMAGE_MIME,
  validateImageUpload,
  webpKeyFor,
  type ImageMimeType,
} from '@/domain/events/image-rules';

/**
 * As duas finalidades desta tela.
 *
 * O TIPO é o do catálogo canônico (`AssetTarget`) — a capa e o logotipo da
 * instituição entraram lá na fatia 4, com o próprio teto de bytes e a própria
 * política de WebP. O que este arquivo declara é quais delas ESTA tela aceita: as
 * do evento (`COVER`, `LOGO`) não passam por aqui, porque quem as grava é a coluna
 * do evento.
 */
export const TENANT_PAGE_IMAGE_TARGETS = ['TENANT_COVER', 'TENANT_LOGO'] as const;
export type TenantPageImageTarget = (typeof TENANT_PAGE_IMAGE_TARGETS)[number];

export function isTenantPageImageTarget(value: unknown): value is TenantPageImageTarget {
  return (
    typeof value === 'string' &&
    (TENANT_PAGE_IMAGE_TARGETS as readonly string[]).includes(value)
  );
}

export type TenantPageAssetErrorCode =
  | 'INVALID_INPUT'
  | 'INTEGRITY'
  | 'QUOTA_EXCEEDED'
  | 'STORAGE'
  | 'NOT_FOUND';

export type TenantPageAssetResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: TenantPageAssetErrorCode; message: string; details?: readonly string[] };

/**
 * Prefixo das imagens da página da instituição.
 *
 * `tenants/<id>/pagina/...` — irmão de `eventos/`, e não dentro dele: a imagem não
 * pertence a nenhuma edição. O `confirm` confere este prefixo antes de aceitar a
 * chave, e é essa conferência que impede que uma chave arbitrária (o PDF de uma
 * submissão, a capa do evento de outra casa) vire a capa da instituição.
 */
export function tenantPageAssetPrefix(tenantId: string): string {
  return `tenants/${tenantId}/pagina/`;
}

export function buildTenantPageAssetKey(input: {
  tenantId: string;
  target: TenantPageImageTarget;
  fileName: string;
  mimeType: ImageMimeType;
}): string {
  const base = sanitizeFileName(input.fileName).replace(/\.[a-z0-9]{2,5}$/i, '');
  const extension = canonicalExtension(input.mimeType);

  return `${tenantPageAssetPrefix(input.tenantId)}${input.target.toLowerCase()}/${randomUUID()}-${base || 'imagem'}.${extension}`;
}

export interface TenantPageAssetTicket {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  requiredHeaders: Record<string, string>;
  expiresInSeconds: number;
  /** Tipo que será GRAVADO — a assinatura real pode corrigir o declarado. */
  mimeType: ImageMimeType;
  maxBytes: number;
}

/**
 * Etapa 1 — valida o que o cliente declarou, confere a QUOTA e assina a URL.
 *
 * A ordem é a decisão da FASE 21 e não é renegociável: validar → conferir espaço →
 * assinar. Assinar antes de medir transformaria a recusa em objeto órfão no bucket.
 */
export async function requestTenantPageAssetUpload(input: {
  tenantId: string;
  target: TenantPageImageTarget;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  magicBytes?: readonly number[] | null;
  /** SHA-256 declarado pelo navegador — vai ASSINADO no PUT (dívida E26). */
  checksumSha256?: string | null;
}): Promise<TenantPageAssetResult<TenantPageAssetTicket>> {
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
    /**
     * A página precisa EXISTIR antes de receber imagem.
     *
     * Poderia parecer zelo: a capa é uma URL no rascunho, e o rascunho é criado no
     * primeiro "salvar". Mas assinar uma URL de upload para uma página que não
     * existe deixa o objeto no bucket sem nenhuma linha que o referencie — e a
     * quota da instituição passa a contar bytes que ninguém consegue apagar pela
     * tela. A tela do editor cria a página (gravando o rascunho) antes de oferecer
     * a capa, então esta recusa só aparece para quem chama a action por fora.
     */
    const room = await ensureStorageRoom({
      tenantId: input.tenantId,
      incomingBytes: input.sizeBytes,
    });

    if (!room.ok) {
      return {
        ok: false,
        code: 'QUOTA_EXCEEDED',
        message: room.message,
        details: [
          `A instituição ocupa ${formatBytes(room.usage.totalBytes)} de ${formatBytes(room.usage.maxBytes ?? 0)}.`,
        ],
      };
    }

    const bucket = BUCKETS.assets();
    const objectKey = buildTenantPageAssetKey({
      tenantId: input.tenantId,
      target: input.target,
      fileName: input.fileName,
      mimeType: validation.mimeType,
    });

    const ticket = await createUploadUrl({
      bucket,
      objectKey,
      contentType: validation.mimeType,
      contentLength: input.sizeBytes,
      checksumSha256: input.checksumSha256 ?? null,
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
    console.error(`[f64] falha ao preparar o envio da imagem da página: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'STORAGE',
      message: 'Não foi possível preparar o envio da imagem.',
    };
  }
}

export interface ConfirmTenantPageAssetInput {
  tenantId: string;
  actorId: string;
  target: TenantPageImageTarget;
  objectKey: string;
  bucket: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Etapa 3 — confere o objeto, converte para WebP, apaga o original e registra no acervo.
 *
 * Devolve a URL pública do objeto GRAVADO. Quem grava a URL na página é o serviço de
 * gravação do rascunho (fatia 1), na mesma transação da trilha — esta função não
 * conhece a tabela da página, e é por isso que ela serve a capa e ao logotipo sem
 * saber qual dos dois está tratando.
 */
export async function confirmTenantPageAssetUpload(
  input: ConfirmTenantPageAssetInput,
): Promise<
  TenantPageAssetResult<{
    url: string;
    objectKey: string;
    /** Tamanho do objeto GRAVADO (o WebP), não o do arquivo enviado. */
    sizeBytes: number;
    /** Tamanho e tipo do arquivo ENVIADO — a tela mostra a economia com eles. */
    sourceBytes: number;
    sourceMime: ImageMimeType;
  }>
> {
  if (!isSha256Hex(input.checksum)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Checksum SHA-256 inválido.' };
  }

  if (input.bucket !== BUCKETS.assets()) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Bucket de destino não permitido.' };
  }

  if (!input.objectKey.startsWith(tenantPageAssetPrefix(input.tenantId))) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A chave do objeto não corresponde a esta instituição e finalidade.',
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
      await deleteObject(input.bucket, input.objectKey).catch(() => undefined);
      return { ok: false, code: 'INTEGRITY', message: integrity.message };
    }

    const realMime = asImageMime(stored.contentType) ?? asImageMime(input.mimeType);

    if (!realMime) {
      await deleteObject(input.bucket, input.objectKey).catch(() => undefined);
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'O objeto armazenado não é uma imagem aceita (PNG, JPEG, WebP ou AVIF).',
      };
    }

    const conversion = await encodeAssetAsWebp({
      bytes: await getObjectBuffer(input.bucket, input.objectKey),
      target: input.target,
      sourceMime: realMime,
    });

    if (!conversion.ok) {
      await deleteObject(input.bucket, input.objectKey).catch(() => undefined);
      return { ok: false, code: 'INVALID_INPUT', message: conversion.message };
    }

    const finalObjectKey = webpKeyFor(input.objectKey);

    const written = await putObjectBuffer({
      bucket: input.bucket,
      objectKey: finalObjectKey,
      body: conversion.bytes,
      contentType: STORED_IMAGE_MIME,
      metadata: { 'original-mime': realMime, 'original-size': String(stored.sizeBytes) },
    });

    /**
     * O ORIGINAL É APAGADO (F46). É best-effort de propósito: manter os dois
     * dobraria o espaço para servir sempre o mesmo pixel, mas uma falha aqui não
     * pode desfazer a confirmação — o pior caso é um objeto órfão, e o log diz isso
     * em vez de esconder.
     */
    await deleteObject(input.bucket, input.objectKey).catch((error: unknown) => {
      console.error(
        `[f64] imagem original da página não removida (${input.objectKey}): ${
          error instanceof Error ? error.message : 'falha desconhecida'
        }`,
      );
    });

    const url = publicObjectUrl(input.bucket, finalObjectKey);

    /**
     * O registro no acervo é o que faz estes bytes contarem na quota do plano e
     * poderem ser apagados pela tela do acervo. `eventId: null` é o acervo DA
     * INSTITUIÇÃO — o caso previsto no modelo desde a FASE 24.
     */
    const registered = await withTenant(input.tenantId, (tx) =>
      registerAsset(tx, {
        tenantId: input.tenantId,
        eventId: null,
        actorId: input.actorId,
        target: input.target,
        bucket: input.bucket,
        objectKey: finalObjectKey,
        url,
        fileName: input.fileName,
        mimeType: STORED_IMAGE_MIME,
        sizeBytes: written.sizeBytes,
        checksum: written.checksum,
      }),
    );

    return {
      ok: true,
      url: registered.url,
      objectKey: finalObjectKey,
      sizeBytes: written.sizeBytes,
      sourceBytes: stored.sizeBytes,
      sourceMime: realMime,
    };
  } catch (error) {
    console.error(`[f64] falha ao confirmar a imagem da página: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'STORAGE',
      message: 'Não foi possível confirmar a imagem enviada.',
    };
  }
}

function asImageMime(value: string | null | undefined): ImageMimeType | null {
  const normalized = (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

  return normalized === 'image/png' ||
    normalized === 'image/jpeg' ||
    normalized === 'image/webp' ||
    normalized === 'image/avif'
    ? normalized
    : null;
}

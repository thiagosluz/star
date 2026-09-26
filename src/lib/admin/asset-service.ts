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
 *      3. `confirmAssetUpload`  → lê o objeto, converte para WebP, apaga o original
 *                                 e GRAVA a URL no evento/patrocínio
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A URL ASSINADA TRAVA — E O QUE ELA NÃO TRAVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela trava a chave exata, o tamanho e a validade. O que ela NÃO trava é o
 *  CONTEÚDO: quem tem a URL pode enviar qualquer coisa. É por isso que a confirmação
 *  lê o objeto de volta (`inspectObject`), DECODIFICA os bytes (FASE 46) e só então
 *  grava a URL no banco — e é por isso que a chave do objeto NUNCA é a que o cliente
 *  pediu (o nome final é gerado aqui, no servidor).
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
  getObjectBuffer,
  inspectObject,
  putObjectBuffer,
  sanitizeFileName,
  UPLOAD_URL_TTL_SECONDS,
} from '@/lib/storage/s3-client';
import { isSha256Hex, verifyStoredObject } from '@/domain/review/submission-rules';
import { encodeAssetAsWebp } from '@/lib/storage/image-converter';
import { registerAsset } from '@/lib/admin/media-asset-service';
import { ensureStorageRoom } from '@/lib/storage/storage-quota';
import {
  canonicalExtension,
  formatBytes,
  STORED_IMAGE_MIME,
  validateImageUpload,
  webpKeyFor,
  type AssetTarget,
  type ImageMimeType,
} from '@/domain/events/image-rules';
import type { TxClient } from '@/lib/db/tenant-client';

export type AssetErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INTEGRITY'
  /** A instituição esgotou a quota de armazenamento do plano (FASE 21). */
  | 'QUOTA_EXCEEDED'
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

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A QUOTA DO PLANO É CONFERIDA ANTES DE ASSINAR (FASE 21)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Substituir a capa NÃO devolve os bytes da anterior: o objeto antigo continua
     *  no bucket e no acervo (é histórico). Então toda imagem conta como ADIÇÃO — e a
     *  recusa acontece aqui, antes de o navegador enviar qualquer byte.
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
}/**
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
): Promise<
  AssetResult<{
    url: string;
    objectKey: string;
    /** Tamanho do objeto GRAVADO (o WebP), não o do arquivo que o cliente enviou. */
    sizeBytes: number;
    /** Tamanho e tipo do arquivo ENVIADO — a tela mostra a economia com eles. */
    sourceBytes: number;
    sourceMime: ImageMimeType;
  }>
> {
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

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A IMAGEM É RECONVERTIDA AQUI, E O ORIGINAL VAI EMBORA (FASE 46)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O que o organizador enviou (PNG, JPEG, WebP ou AVIF) é lido de volta,
     *  decodificado e gravado no formato de armazenamento. O objeto enviado é
     *  APAGADO: manter os dois dobraria o espaço para servir sempre o mesmo pixel —
     *  e é justamente o espaço que a fase veio economizar.
     *
     *  A chave nova (e não a mesma com outro conteúdo) existe porque a extensão do
     *  objeto é lida por CDN, cache e navegador: um `.png` com bytes de WebP é uma
     *  mentira gravada no bucket.
     *
     *  Falhar aqui é RECUSAR, com o objeto apagado junto. É o único ponto do sistema
     *  que DECODIFICA o arquivo enviado, então é ele que dá a palavra final sobre o
     *  conteúdo ser ou não uma imagem.
     */
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

    const storedWebp = await putObjectBuffer({
      bucket: input.bucket,
      objectKey: finalObjectKey,
      body: conversion.bytes,
      contentType: STORED_IMAGE_MIME,
      /**
       * O que foi enviado fica no METADADO do objeto: o acervo guarda o WebP, e sem
       * esta linha ninguém conseguiria dizer depois de onde ele veio — nem auditar a
       * economia da conversão olhando o bucket.
       */
      metadata: {
        'original-mime': realMime,
        'original-size': String(stored.sizeBytes),
      },
    });

    // Best-effort: o objeto enviado não é mais referenciado por nada. Se a remoção
    // falhar, sobra lixo pago no bucket — e o log diz isso, em vez de esconder.
    await deleteObject(input.bucket, input.objectKey).catch((error: unknown) => {
      console.error(
        `[asset] objeto original não removido (${input.objectKey}): ${
          error instanceof Error ? error.message : 'falha desconhecida'
        }`,
      );
    });

    const finalUrl = publicObjectUrl(input.bucket, finalObjectKey);
    const storedBytes = storedWebp.sizeBytes;
    const storedChecksum = storedWebp.checksum;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  TODO ENVIO ENTRA NA BIBLIOTECA (FASE 24, item E14)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O registro acontece ANTES do destino: a capa, o logotipo do patrocinador e a
     *  imagem da galeria passam a existir no acervo da instituição, com autor,
     *  tamanho e checksum. Sem isso, a biblioteca seria uma tela sobre arquivos que
     *  ela não conhece.
     *
     *  `registerAsset` procura o mesmo checksum e REAPROVEITA o registro quando o
     *  arquivo já existe: subir a mesma foto para a capa e para a galeria deixa de
     *  criar dois objetos iguais no bucket.
     *
     *  Para `GALLERY` e `SPEAKER_AVATAR` nada é gravado em coluna: a URL volta para o
     *  formulário e o vínculo acontece quando o bloco (ou o perfil do palestrante) é
     *  salvo. É o que permite a mesma esteira servir a três telas diferentes sem que
     *  o serviço conheça as três.
     */
    if (input.target === 'GALLERY' || input.target === 'SPEAKER_AVATAR') {
      const registered = await withTenant(input.tenantId, (tx) =>
        registerAsset(tx, {
          tenantId: input.tenantId,
          eventId: input.eventId,
          actorId: input.actorId,
          target: input.target,
          bucket: input.bucket,
          objectKey: finalObjectKey,
          url: finalUrl,
          fileName: input.fileName,
          mimeType: STORED_IMAGE_MIME,
          sizeBytes: storedBytes,
          checksum: storedChecksum,
        }),
      );

      return {
        ok: true,
        url: registered.url,
        objectKey: finalObjectKey,
        sizeBytes: storedBytes,
        sourceBytes: stored.sizeBytes,
        sourceMime: realMime,
      };
    }

    const written = await withTenant(input.tenantId, async (tx) => {
      /**
       * O registro no acervo vem primeiro, na MESMA transação do vínculo: se a
       * gravação da coluna falhar, não fica um registro de imagem que ninguém
       * usa — e se o registro falhar, a coluna não aponta para um objeto que a
       * biblioteca não conhece.
       */
      const registered = await registerAsset(tx, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        actorId: input.actorId,
        target: input.target,
        bucket: input.bucket,
        objectKey: finalObjectKey,
        url: finalUrl,
        fileName: input.fileName,
        mimeType: STORED_IMAGE_MIME,
        sizeBytes: storedBytes,
        checksum: storedChecksum,
      });

      const boundUrl = registered.url;

      if (input.target === 'SPONSOR_LOGO') {
        return writeSponsorLogo(tx, input, boundUrl);
      }

      const column = input.target === 'COVER' ? 'coverImageUrl' : 'logoUrl';

      const before = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, coverImageUrl: true, logoUrl: true },
      });

      if (!before) return { ok: false as const, reason: 'NOT_FOUND' as const };

      await tx.event.update({
        where: { id: before.id },
        data: input.target === 'COVER' ? { coverImageUrl: boundUrl } : { logoUrl: boundUrl },
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
              to: boundUrl,
            },
          },
        },
        tx,
      );

      return { ok: true as const, url: boundUrl };
    });

    if (!written.ok) {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento ou patrocinador não encontrado.' };
    }

    return {
      ok: true,
      url: written.url,
      objectKey: finalObjectKey,
      sizeBytes: storedBytes,
      sourceBytes: stored.sizeBytes,
      sourceMime: realMime,
    };
  } catch (error) {
    console.error(`[asset] falha ao confirmar upload: ${errorMessage(error)}`);
    return { ok: false, code: 'STORAGE', message: 'Não foi possível confirmar a imagem enviada.' };
  }
}

async function writeSponsorLogo(
  tx: TxClient,
  input: ConfirmAssetInput,
  url: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: 'NOT_FOUND' }> {
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

  return { ok: true, url };
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

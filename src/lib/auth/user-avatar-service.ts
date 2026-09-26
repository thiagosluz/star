/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Foto da pessoa (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA ESTEIRA TEM DE DIFERENTE DA DO ACERVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela é a MESMA esteira em três etapas da capa do evento (`requestAssetUpload` →
 *  navegador → `confirmAssetUpload`), com a mesma validação (allowlist, assinatura
 *  real, imagem que DECODIFICA) e a mesma conversão para WebP da FASE 46. O que muda
 *  é o DONO:
 *
 *    • a chave é global (`users/<id>/avatar/...`), porque a identidade não pertence a
 *      instituição nenhuma (ADR-002);
 *    • NÃO há registro em `media_assets` — aquele acervo é da instituição e tem RLS
 *      por `tenantId`, e a foto da pessoa não é ativo de ninguém além dela;
 *    • NÃO há quota de plano: o plano mede o que a instituição guarda, e esta foto é
 *      do indivíduo (que pode não ter instituição nenhuma);
 *    • a foto ANTERIOR é apagada: a coluna aponta para um único objeto, e deixar a
 *      antiga no bucket seria guardar uma imagem que ninguém mais referencia — em um
 *      caso, a pedido da própria pessoa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O BUCKET É O PÚBLICO (E O QUE ISSO SIGNIFICA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A foto existe para APARECER: é o avatar do perfil público (`/u/<handle>`) e dos
 *  cartões de equipe na página do evento — os dois servidos a visitantes anônimos.
 *  Guardá-la em bucket privado exigiria assinar uma URL por cartão em cada
 *  renderização (e o navegador não cachearia nada).
 *
 *  A consequência precisa estar dita: o arquivo é público, e a matriz de visibilidade
 *  do perfil público decide se ele APARECE na página, não se ele é acessível a quem
 *  tiver a URL. Quem restringe a foto depois já a publicou — a tela diz isso ao
 *  oferecer a remoção, e o objeto é apagado quando a pessoa remove.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { adminPrisma } from '@/lib/db/admin-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { isSha256Hex, verifyStoredObject } from '@/domain/review/submission-rules';
import { encodeAssetAsWebp } from '@/lib/storage/image-converter';
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
  STORED_IMAGE_MIME,
  USER_AVATAR_TARGET,
  validateImageUpload,
  webpKeyFor,
  type ImageMimeType,
} from '@/domain/events/image-rules';

export type AvatarErrorCode = 'INVALID_INPUT' | 'INTEGRITY' | 'STORAGE' | 'NOT_FOUND';

export type AvatarResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AvatarErrorCode; message: string; details?: readonly string[] };

/** Prefixo das fotos de pessoa — o que o `confirm` confere antes de aceitar a chave. */
export function userAvatarPrefix(userId: string): string {
  return `users/${userId}/avatar/`;
}

/**
 * Chave do objeto no bucket público.
 *
 * O identificador único fica no INÍCIO do nome (dois envios do mesmo `foto.png` não
 * colidem) e a extensão vem do tipo REAL detectado — a mesma régua do acervo. A
 * extensão final, depois da conversão, é sempre `.webp` (`webpKeyFor`).
 */
export function buildUserAvatarKey(input: {
  userId: string;
  fileName: string;
  mimeType: ImageMimeType;
}): string {
  const base = sanitizeFileName(input.fileName).replace(/\.[a-z0-9]{2,5}$/i, '');
  const extension = canonicalExtension(input.mimeType);

  return `${userAvatarPrefix(input.userId)}${randomUUID()}-${base || 'foto'}.${extension}`;
}

export interface UserAvatarTicket {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  requiredHeaders: Record<string, string>;
  expiresInSeconds: number;
  mimeType: ImageMimeType;
  maxBytes: number;
}

/** Etapa 1 — valida o que o cliente declarou e assina a URL de envio. */
export async function requestUserAvatarUpload(input: {
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  magicBytes?: readonly number[] | null;
}): Promise<AvatarResult<UserAvatarTicket>> {
  const validation = validateImageUpload({
    target: USER_AVATAR_TARGET,
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
    const bucket = BUCKETS.assets();
    const objectKey = buildUserAvatarKey({
      userId: input.userId,
      fileName: input.fileName,
      mimeType: validation.mimeType,
    });

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
    console.error(`[avatar] falha ao preparar envio: ${errorMessage(error)}`);
    return { ok: false, code: 'STORAGE', message: 'Não foi possível preparar o envio da foto.' };
  }
}

export interface ConfirmUserAvatarInput {
  userId: string;
  objectKey: string;
  bucket: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Etapa 3 — confere o objeto, converte para WebP, grava a URL em `user.image` e
 * apaga o que não é mais referenciado (o arquivo enviado e a foto anterior).
 */
export async function confirmUserAvatarUpload(
  input: ConfirmUserAvatarInput,
): Promise<
  AvatarResult<{
    url: string;
    objectKey: string;
    sizeBytes: number;
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

  if (!input.objectKey.startsWith(userAvatarPrefix(input.userId))) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A chave do objeto não corresponde à sua foto.',
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
      target: USER_AVATAR_TARGET,
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

    await deleteObject(input.bucket, input.objectKey).catch((error: unknown) => {
      console.error(
        `[avatar] objeto enviado não removido (${input.objectKey}): ${
          error instanceof Error ? error.message : 'falha desconhecida'
        }`,
      );
    });

    const previous = await adminPrisma.user.findUnique({
      where: { id: input.userId },
      select: { image: true },
    });

    if (!previous) {
      await deleteObject(input.bucket, finalObjectKey).catch(() => undefined);
      return { ok: false, code: 'NOT_FOUND', message: 'Conta não encontrada.' };
    }

    const url = publicUrl(input.bucket, finalObjectKey);

    await adminPrisma.user.update({ where: { id: input.userId }, data: { image: url } });

    /**
     * A foto ANTERIOR sai do bucket quando é nossa (prefixo desta pessoa).
     *
     * O teste do prefixo não é zelo excessivo: `user.image` pode ter vindo de um
     * provedor social ou de um endereço externo, e apagar o que não é nosso — ou o
     * que é de outra pessoa — seria destruição de dado alheio. Falha aqui não desfaz
     * a troca: vira log, e o objeto fica órfão.
     */
    const obsoleteKey = objectKeyFromPublicUrl(previous.image, input.bucket, input.userId);

    if (obsoleteKey && obsoleteKey !== finalObjectKey) {
      await deleteObject(input.bucket, obsoleteKey).catch((error: unknown) => {
        console.error(
          `[avatar] foto anterior não removida (${obsoleteKey}): ${
            error instanceof Error ? error.message : 'falha desconhecida'
          }`,
        );
      });
    }

    return {
      ok: true,
      url,
      objectKey: finalObjectKey,
      sizeBytes: written.sizeBytes,
      sourceBytes: stored.sizeBytes,
      sourceMime: realMime,
    };
  } catch (error) {
    console.error(`[avatar] falha ao confirmar envio: ${errorMessage(error)}`);
    return { ok: false, code: 'STORAGE', message: 'Não foi possível salvar a sua foto.' };
  }
}

/**
 * Remove a foto da conta.
 *
 * Apagar o objeto é o que dá sentido à promessa da tela: a matriz de visibilidade
 * esconde a foto da PÁGINA, mas só a remoção tira o arquivo do ar. Sem isso, "remover
 * foto" seria uma mentira educada.
 */
export async function removeUserAvatar(userId: string): Promise<AvatarResult<{ removed: boolean }>> {
  try {
    const current = await adminPrisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });

    if (!current) {
      return { ok: false, code: 'NOT_FOUND', message: 'Conta não encontrada.' };
    }

    const bucket = BUCKETS.assets();
    const obsoleteKey = objectKeyFromPublicUrl(current.image, bucket, userId);

    await adminPrisma.user.update({ where: { id: userId }, data: { image: null } });

    if (obsoleteKey) {
      await deleteObject(bucket, obsoleteKey).catch((error: unknown) => {
        console.error(
          `[avatar] foto removida da conta, mas o objeto ficou (${obsoleteKey}): ${
            error instanceof Error ? error.message : 'falha desconhecida'
          }`,
        );
      });
    }

    return { ok: true, removed: current.image !== null };
  } catch (error) {
    console.error(`[avatar] falha ao remover: ${errorMessage(error)}`);
    return { ok: false, code: 'STORAGE', message: 'Não foi possível remover a sua foto.' };
  }
}

function asImageMime(value: string | null | undefined): ImageMimeType | null {
  const normalized = (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

  return normalized === 'image/png' ||
    normalized === 'image/jpeg' ||
    normalized === 'image/webp' ||
    normalized === 'image/avif'
    ? (normalized as ImageMimeType)
    : null;
}

/** URL pública do objeto — mesma montagem do acervo (bucket público de assets). */
function publicUrl(bucket: string, objectKey: string): string {
  const base = (
    process.env.S3_PUBLIC_URL ??
    process.env.S3_PUBLIC_ENDPOINT ??
    process.env.S3_ENDPOINT ??
    'http://localhost:9000'
  ).replace(/\/+$/, '');

  return `${base}/${bucket}/${objectKey}`;
}

/**
 * Chave do objeto a partir da URL pública — SÓ quando ela é desta pessoa.
 *
 * Devolve `null` para qualquer URL que não seja do bucket de assets sob o prefixo
 * dela (foto de provedor social, endereço externo, foto de outra pessoa). É a guarda
 * que impede a remoção de apagar objeto alheio.
 */
export function objectKeyFromPublicUrl(
  url: string | null,
  bucket: string,
  userId: string,
): string | null {
  if (!url) return null;

  const marker = `/${bucket}/`;
  const index = url.indexOf(marker);

  if (index < 0) return null;

  const key = url.slice(index + marker.length);
  return key.startsWith(userAvatarPrefix(userId)) ? key : null;
}

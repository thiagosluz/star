/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NAVEGADOR — Integridade (SHA-256) e assinatura (magic bytes) (FASE 117 · ADR-473)
 *
 *  Compartilhado pelas esteiras de upload (`asset-upload`, `material-upload`,
 *  `submission-uploader`) e pela conferência pública de sorteio (`raffle-audit`).
 *  Módulo neutro (sem `'use client'`), usando apenas Web Crypto API padrão.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** 16 bytes cobrem todas as assinaturas aceitas na plataforma (PNG, JPEG, WebP, AVIF, PDF). */
export const DEFAULT_MAGIC_BYTES_LENGTH = 16;

/** Calcula o SHA-256 em hexadecimal minúsculo via Web Crypto API. */
export async function sha256Hex(
  input: Blob | ArrayBuffer | Uint8Array | string,
): Promise<string> {
  let bytes: BufferSource;

  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Blob) {
    bytes = await input.arrayBuffer();
  } else if (input instanceof Uint8Array) {
    bytes = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  } else {
    bytes = input;
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Lê os primeiros bytes de um arquivo/blob para conferência de assinatura no servidor. */
export async function readMagicBytes(
  file: Blob,
  count = DEFAULT_MAGIC_BYTES_LENGTH,
): Promise<number[]> {
  const slice = file.slice(0, count);
  const buffer = await slice.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

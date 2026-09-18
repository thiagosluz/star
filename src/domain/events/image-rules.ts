/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Imagens do evento (capa, logotipo, patrocínio)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE IMAGEM NÃO É "SÓ UM UPLOAD"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O upload de submissão já existia (FASE 4) com validação de PDF. Imagem é um
 *  caso diferente em três pontos, e os três motivam este módulo:
 *
 *    1. **O arquivo é servido como conteúdo de página.** Um `Content-Type`
 *       `text/html` num objeto do bucket é XSS servido pelo domínio da
 *       instituição, porque o navegador interpreta `text/html` como documento.
 *       Por isso a allowlist de tipo é fechada e a assinatura real do arquivo é
 *       conferida — a extensão é só um palpite do cliente.
 *    2. **O peso importa mais.** Uma capa aparece no hero; 20 MB de imagem é uma
 *       página que não carrega no celular de quem se inscreve. O limite é por
 *       finalidade: capa maior, logotipo pequeno.
 *    3. **O nome do arquivo vai para a URL pública do objeto.** Ele é sanitizado
 *       no storage (`sanitizeFileName`), e aqui só validamos a extensão.
 *
 *  SVG fica FORA da allowlist de propósito: SVG é um documento XML que aceita
 *  `<script>` e `onload`. Servir SVG enviado por usuário é XSS armazenado com
 *  outro nome.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Finalidades
// ───────────────────────────────────────────────────────────────────────────────
export const ASSET_TARGETS = ['COVER', 'LOGO', 'SPONSOR_LOGO', 'GALLERY', 'SPEAKER_AVATAR'] as const;
export type AssetTarget = (typeof ASSET_TARGETS)[number];

export const ASSET_TARGET_LABELS: Record<AssetTarget, string> = {
  COVER: 'Imagem de capa',
  LOGO: 'Logotipo do evento',
  SPONSOR_LOGO: 'Logotipo do patrocinador',
  GALLERY: 'Imagem da galeria',
  // FASE 25: a foto do palestrante entra pela MESMA esteira da capa (allowlist de
  // tipo, assinatura real, biblioteca de mídia). Um upload paralelo para o avatar
  // divergiria justamente na verificação de assinatura, que é a parte de segurança.
  SPEAKER_AVATAR: 'Foto do palestrante',
};

/**
 * Limite por finalidade, em bytes.
 *
 * A capa pode ser uma foto de 5 MB (é o que sai de uma câmera); o logotipo, não —
 * logo é vetor ou PNG tratado, e aceitar 5 MB nele só serviria para publicar uma
 * página lenta. A galeria fica no meio: são fotos, mas várias na MESMA página, e o
 * peso delas soma.
 */
export const MAX_IMAGE_BYTES: Record<AssetTarget, number> = {
  COVER: 5 * 1024 * 1024,
  LOGO: 1 * 1024 * 1024,
  SPONSOR_LOGO: 1 * 1024 * 1024,
  GALLERY: 3 * 1024 * 1024,
  /**
   * Foto de palestrante: é retrato, e retrato quadrado de 2 MB é o teto generoso de
   * uma foto de celular já reduzida. Ela aparece num avatar de 56 px na vitrine —
   * aceitar 5 MB aqui seria publicar uma página pesada por uma imagem que ninguém vê
   * em tamanho grande.
   */
  SPEAKER_AVATAR: 2 * 1024 * 1024,
};

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<ImageMimeType, readonly string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
};

export const IMAGE_ACCEPT_ATTRIBUTE = IMAGE_MIME_TYPES.join(',');

// ───────────────────────────────────────────────────────────────────────────────
//  Assinaturas de arquivo (magic bytes)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Cada assinatura diz "este arquivo É uma imagem deste tipo" — não "o cliente
 * disse que é". É a diferença entre validar e confiar.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
/** `RIFF<4 bytes de tamanho>WEBP`. */
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_BRAND = [0x57, 0x45, 0x42, 0x50];
/** `ftyp` no deslocamento 4 e marca `avif`/`avis` em seguida. */
const FTYP_BRAND = [0x66, 0x74, 0x79, 0x70];
const AVIF_BRANDS = [
  [0x61, 0x76, 0x69, 0x66],
  [0x61, 0x76, 0x69, 0x73],
];

function startsWith(bytes: readonly number[], signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function matchesAt(bytes: readonly number[], signature: readonly number[], offset: number): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Tipo REAL do arquivo, deduzido da assinatura.
 *
 * `null` significa "não é nenhuma das imagens aceitas" — inclusive quando os
 * bytes não foram enviados (o chamador decide o que fazer com isso).
 */
export function detectImageMime(magicBytes: readonly number[] | null | undefined): ImageMimeType | null {
  // 8 bytes é o mínimo entre as assinaturas aceitas (PNG). Cada verificador
  // confere o próprio comprimento, então não é preciso exigir o máximo aqui — e
  // exigir seria pior: um cliente que enviasse só os 8 primeiros bytes de um PNG
  // legítimo seria recusado por um motivo que não é dele.
  if (!magicBytes || magicBytes.length < 8) return null;

  if (startsWith(magicBytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(magicBytes, JPEG_SIGNATURE)) return 'image/jpeg';

  if (startsWith(magicBytes, RIFF_SIGNATURE) && matchesAt(magicBytes, WEBP_BRAND, 8)) {
    return 'image/webp';
  }

  if (
    matchesAt(magicBytes, FTYP_BRAND, 4) &&
    AVIF_BRANDS.some((brand) => matchesAt(magicBytes, brand, 8))
  ) {
    return 'image/avif';
  }

  return null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação
// ───────────────────────────────────────────────────────────────────────────────
export type ImageValidationError =
  | { code: 'EMPTY'; message: string }
  | { code: 'TOO_LARGE'; message: string }
  | { code: 'UNSUPPORTED_TYPE'; message: string }
  | { code: 'NOT_AN_IMAGE'; message: string }
  | { code: 'NOT_SVG'; message: string }
  | { code: 'TYPE_MISMATCH'; message: string };

export type ImageValidation =
  | { ok: true; mimeType: ImageMimeType; maxBytes: number }
  | { ok: false; errors: readonly ImageValidationError[] };

export interface ImageDescriptor {
  target: AssetTarget;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Primeiros bytes do arquivo. Sem eles, a validação cai (mais fraca) no tipo declarado. */
  magicBytes?: readonly number[] | null;
}

/**
 * Valida o arquivo de imagem declarado para uma finalidade.
 *
 * Ordem das checagens, do mais barato ao mais caro: tamanho → tipo declarado →
 * assinatura real. Quando a assinatura está disponível, ela é a ÚLTIMA palavra: um
 * arquivo com assinatura de imagem e extensão `png` é aceito mesmo que o cliente
 * tenha mandado `application/octet-stream` (navegador antigo, câmera, arrastar e
 * soltar). O contrário não vale: extensão de imagem com assinatura de outra coisa é
 * recusado, porque aí o conteúdo não é o que o objeto vai dizer que é.
 */
export function validateImageUpload(input: ImageDescriptor): ImageValidation {
  const maxBytes = MAX_IMAGE_BYTES[input.target];
  const errors: ImageValidationError[] = [];

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    errors.push({ code: 'EMPTY', message: 'O arquivo está vazio.' });
    return { ok: false, errors };
  }

  if (input.sizeBytes > maxBytes) {
    errors.push({
      code: 'TOO_LARGE',
      message: `A imagem excede o limite de ${formatBytes(maxBytes)} para ${ASSET_TARGET_LABELS[
        input.target
      ].toLowerCase()}.`,
    });
  }

  const declared = normalizeMime(input.mimeType);
  const extension = fileExtension(input.fileName);

  if (declared === 'image/svg+xml' || extension === 'svg') {
    errors.push({
      code: 'NOT_SVG',
      message: 'SVG não é aceito: um SVG pode conter script e seria executado no navegador do visitante.',
    });
    return { ok: false, errors };
  }

  const actual = detectImageMime(input.magicBytes);

  if (actual) {
    /**
     * Assinatura conhecida: ela decide, e o tipo declarado deixa de importar.
     *
     * Não é frouxidão — é o caso normal. Câmera, "arrastar e soltar" e alguns
     * navegadores mandam `application/octet-stream` com um JPEG dentro. O que será
     * GRAVADO e SERVIDO é `actual`, então a página nunca anuncia um tipo que o
     * arquivo não tem.
     */
    return finish(errors, actual, maxBytes);
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  BYTES ENVIADOS QUE NÃO SÃO IMAGEM: RECUSA, SEM EXCEÇÃO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Este é o ponto que separa "validar" de "confiar no cliente". Se o cliente
   *  mandou os primeiros bytes e eles não são de nenhuma imagem aceita, o conteúdo
   *  NÃO é uma imagem — ainda que a extensão diga `.png` e o tipo declarado diga
   *  `image/png`. Um `text/html` renomeado cairia aqui, e servi-lo público seria
   *  XSS no domínio da instituição.
   *
   *  O caminho mais fraco (tipo declarado + extensão) fica reservado para quando os
   *  bytes NÃO chegaram — aí não há o que conferir, e é o melhor possível.
   */
  const hasBytes = Array.isArray(input.magicBytes) && input.magicBytes.length > 0;

  if (hasBytes) {
    errors.push({
      code: 'NOT_AN_IMAGE',
      message: 'O conteúdo do arquivo não é uma imagem PNG, JPEG, WebP ou AVIF.',
    });
    return { ok: false, errors };
  }

  /**
   * Sem assinatura: aceitamos apenas tipo declarado + extensão coerentes entre si.
   * É mais fraco, e é o melhor possível quando o cliente não envia os bytes — o
   * serviço pede os bytes justamente para cair no caminho forte.
   */
  if (!declared || !isAllowedMime(declared)) {
    errors.push({
      code: 'UNSUPPORTED_TYPE',
      message: 'Formato não aceito. Envie PNG, JPEG, WebP ou AVIF.',
    });
    return { ok: false, errors };
  }

  if (!extensionMatches(extension, declared)) {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `O arquivo ${input.fileName} não corresponde ao formato declarado (${declared}).`,
    });
    return { ok: false, errors };
  }

  return finish(errors, declared, maxBytes);
}

function finish(
  errors: ImageValidationError[],
  mimeType: ImageMimeType,
  maxBytes: number,
): ImageValidation {
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, mimeType, maxBytes };
}

function normalizeMime(mimeType: string): string {
  return mimeType.trim().toLowerCase();
}

function isAllowedMime(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

function extensionMatches(extension: string | null, mimeType: ImageMimeType): boolean {
  if (!extension) return false;
  return EXTENSION_BY_MIME[mimeType].includes(extension);
}

function fileExtension(fileName: string): string | null {
  const match = /\.([a-z0-9]{2,5})$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / 1024 / 1024;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Extensão canônica para gravar o objeto.
 *
 * O nome final NÃO usa o nome enviado: dois organizadores enviando `capa.png`
 * colidiriam no mesmo caminho do bucket. O serviço prefixa um identificador único
 * e mantém só a extensão — que aqui é derivada do tipo REAL.
 */
export function canonicalExtension(mimeType: ImageMimeType): string {
  return EXTENSION_BY_MIME[mimeType][0] ?? 'png';
}

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
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ENTRA É O QUE O USUÁRIO TEM; O QUE FICA É WEBP (FASE 46)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Aceitar PNG, JPEG, WebP e AVIF é aceitar o que sai de câmera, de editor e de
 *  celular. GUARDAR é outra decisão: o acervo da instituição é servido público e
 *  indefinidamente, então o formato de armazenamento é UM (`WEBP_POLICY`) e a
 *  conversão acontece na confirmação do upload, no servidor — converter no
 *  navegador deixaria a garantia na mão de quem envia.
 *
 *  A política é DADO, com duas variáveis por finalidade:
 *    • **modo** — `FOTOGRAFIA` (foto, com perda calibrada) × `GRAFICO` (logo:
 *      perda em borda de letra aparece, então vai sem perda);
 *    • **maior lado** — o teto em pixels, porque uma foto de 12 MP num avatar de
 *      56 px é peso que ninguém vê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Finalidades
// ───────────────────────────────────────────────────────────────────────────────
export const ASSET_TARGETS = ['COVER', 'LOGO', 'SPONSOR_LOGO', 'GALLERY', 'SPEAKER_AVATAR'] as const;
export type AssetTarget = (typeof ASSET_TARGETS)[number];

/**
 * Foto da PESSOA (FASE 47) — alvo que NÃO pertence ao acervo da instituição.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE FICA FORA DE `ASSET_TARGETS`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aquele catálogo é o do acervo da INSTITUIÇÃO: as chaves são particionadas por
 *  instituição e evento (`tenants/<id>/eventos/<id>/assets/...`) e todo envio entra em
 *  `media_assets`, tabela com RLS por instituição. A foto de perfil é da IDENTIDADE,
 *  que é global (ADR-002): não há instituição por onde particionar nem acervo onde
 *  entrar.
 *
 *  Ela compartilha todo o resto — limites, allowlist, assinatura real e a conversão
 *  para WebP da FASE 46 —, e é por isso que entra nas tabelas abaixo em vez de ganhar
 *  um caminho paralelo. O que a FASE 47 lhe deu foi o ESCRITOR: até aqui `user.image`
 *  era lido pelo perfil público e pelos cartões de equipe e não tinha quem o
 *  escrevesse.
 */
export const USER_AVATAR_TARGET = 'USER_AVATAR' as const;

/** Todo alvo de imagem aceito pelo sistema: o do acervo e o da pessoa. */
export const IMAGE_TARGETS = [...ASSET_TARGETS, USER_AVATAR_TARGET] as const;
export type ImageTarget = (typeof IMAGE_TARGETS)[number];

export const ASSET_TARGET_LABELS: Record<ImageTarget, string> = {
  COVER: 'Imagem de capa',
  LOGO: 'Logotipo do evento',
  SPONSOR_LOGO: 'Logotipo do patrocinador',
  GALLERY: 'Imagem da galeria',
  // FASE 25: a foto do palestrante entra pela MESMA esteira da capa (allowlist de
  // tipo, assinatura real, biblioteca de mídia). Um upload paralelo para o avatar
  // divergiria justamente na verificação de assinatura, que é a parte de segurança.
  SPEAKER_AVATAR: 'Foto do palestrante',
  USER_AVATAR: 'Sua foto',
};

/**
 * Limite por finalidade, em bytes.
 *
 * A capa pode ser uma foto de 5 MB (é o que sai de uma câmera); o logotipo, não —
 * logo é vetor ou PNG tratado, e aceitar 5 MB nele só serviria para publicar uma
 * página lenta. A galeria fica no meio: são fotos, mas várias na MESMA página, e o
 * peso delas soma.
 */
export const MAX_IMAGE_BYTES: Record<ImageTarget, number> = {
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
  /** Foto da pessoa: mesmo raciocínio do palestrante — é retrato, e é visto pequeno. */
  USER_AVATAR: 2 * 1024 * 1024,
};

// ───────────────────────────────────────────────────────────────────────────────
//  Formato de armazenamento — WebP (FASE 46)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Como a imagem é codificada ao ser guardada.
 *
 * `FOTOGRAFIA` usa perda calibrada (é o que a foto suporta); `GRAFICO` vai sem
 * perda, porque logotipo tem borda de letra e a perda aparece justamente ali —
 * num logo, o artefato do JPEG/WebP com perda é visível a olho nu.
 */
export type WebpEncodingMode = 'FOTOGRAFIA' | 'GRAFICO';

export interface WebpPolicy {
  mode: WebpEncodingMode;
  /** Maior lado permitido, em pixels. `null` = não redimensiona. */
  maxLongestSide: number | null;
}

/**
 * Política de armazenamento por finalidade.
 *
 * Os tetos saem de ONDE a imagem é exibida, não de um número redondo:
 *   • foto do palestrante — avatar de 56 px na vitrine e a ficha; 512 px sobra;
 *   • capa — o hero da página pública; 1920 px cobre a largura de tela comum;
 *   • galeria — a imagem abre ampliada; 2560 px é o limite do que se percebe;
 *   • logotipo e patrocinador — **sem redimensionar**: logo é pequeno e é visto
 *     no tamanho que o arquivo tem; reduzir aqui não economiza nada relevante e
 *     borraria a marca.
 *
 * Nenhum teto AUMENTA a imagem: o redimensionamento só reduz.
 */
export const WEBP_POLICY: Record<ImageTarget, WebpPolicy> = {
  COVER: { mode: 'FOTOGRAFIA', maxLongestSide: 1920 },
  GALLERY: { mode: 'FOTOGRAFIA', maxLongestSide: 2560 },
  SPEAKER_AVATAR: { mode: 'FOTOGRAFIA', maxLongestSide: 512 },
  // A foto da pessoa aparece no mesmo tamanho da do palestrante (avatar da vitrine,
  // cartão de equipe e perfil público) — o mesmo teto, pela mesma razão.
  USER_AVATAR: { mode: 'FOTOGRAFIA', maxLongestSide: 512 },
  LOGO: { mode: 'GRAFICO', maxLongestSide: null },
  SPONSOR_LOGO: { mode: 'GRAFICO', maxLongestSide: null },
};

/** Qualidade da codificação com perda. 82 é o joelho da curva para foto. */
export const WEBP_QUALITY = 82;

/** O tipo GRAVADO no banco e no objeto — o único, para toda imagem de upload. */
export const STORED_IMAGE_MIME = 'image/webp' as const;

/**
 * Teto de pixels da imagem de ORIGEM.
 *
 * O limite de bytes não protege contra bomba de descompressão: um PNG de 2 MB
 * pode declarar 30.000 × 30.000 e pedir gigabytes ao ser aberto. 40 MP é acima de
 * qualquer câmera de celular comum (12–50 MP) e cabe na memória do processo.
 */
export const MAX_SOURCE_PIXELS = 40_000_000;

/** Formatos aceitos NA ENTRADA, para o texto da tela (o que fica é WebP). */
export const IMAGE_INPUT_LABEL = 'PNG, JPEG, WebP ou AVIF';

/**
 * O aviso que acompanha todo campo de imagem.
 *
 * Ele diz as DUAS coisas que a conversão faz — inclusive a que a pessoa não pediu
 * e interessa a ela: os dados da câmera (data, modelo e, em foto de celular, as
 * coordenadas) não vão junto para a página pública.
 */
export const WEBP_STORAGE_NOTICE =
  'Guardamos toda imagem em WebP: o arquivo fica menor e os dados da câmera (data e local) não são publicados.';

/**
 * Chave do objeto no formato de armazenamento.
 *
 * O upload assina a chave com a extensão do arquivo ENVIADO (`capa.png`); a
 * conversão grava noutra chave, e não por cima: um objeto `.png` com bytes de WebP
 * seria uma mentira gravada no bucket — e é a extensão que o CDN e o navegador
 * usam para decidir o que fazer com o arquivo.
 */
export function webpKeyFor(objectKey: string): string {
  const key = objectKey.trim();
  if (/\.webp$/i.test(key)) return key;

  const extension = /\.[a-z0-9]{2,5}$/i;
  return extension.test(key) ? key.replace(extension, '.webp') : `${key}.webp`;
}

/**
 * Rótulo curto do formato guardado, para a tela do acervo.
 *
 * O acervo mostra o TIPO GRAVADO, e não uma suposição: o que entrou antes da FASE 46
 * continua PNG ou JPEG no bucket, e a tela precisa dizer a verdade sobre o que está
 * lá — é assim que o organizador confere que a conversão aconteceu.
 */
export function imageFormatLabel(mimeType: string): string {
  switch (mimeType.split(';')[0]?.trim().toLowerCase()) {
    case 'image/webp':
      return 'WebP';
    case 'image/png':
      return 'PNG';
    case 'image/jpeg':
      return 'JPEG';
    case 'image/avif':
      return 'AVIF';
    default:
      return mimeType;
  }
}

/**
 * Quanto a conversão economizou, em texto — `null` quando não houve economia.
 *
 * Existe para a tela poder MOSTRAR o efeito da regra em vez de afirmá-lo: em
 * imagem muito pequena o WebP pode sair maior que o original, e aí a frase certa
 * é nenhuma.
 */
export function webpSavingsLabel(sourceBytes: number, storedBytes: number): string | null {
  if (!Number.isFinite(sourceBytes) || !Number.isFinite(storedBytes)) return null;
  if (sourceBytes <= 0 || storedBytes <= 0) return null;
  if (storedBytes >= sourceBytes) return null;

  const saved = Math.round((1 - storedBytes / sourceBytes) * 100);
  return saved <= 0 ? null : `${saved}% menor`;
}

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
  target: ImageTarget;
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
  // GB antes de MB: a quota de armazenamento do plano é medida em GiB, e "5120 MB"
  // não diz nada a quem lê. Os limites de imagem (KB/MB) continuam com o mesmo texto.
  if (bytes >= 1024 ** 3) {
    const gb = bytes / 1024 ** 3;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    const mb = bytes / 1024 / 1024;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }

  /**
   * Abaixo de 1 KB, bytes — e não "0 KB".
   *
   * A FASE 47 mostrou a diferença ao exibir a economia da foto: uma imagem de 96 bytes
   * virava "0 KB", que diz ao leitor que o arquivo não tem tamanho. Só aparece em
   * imagem minúscula (ícone, marca), e é exatamente onde o número redondo mente.
   */
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
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

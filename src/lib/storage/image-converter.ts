/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INFRAESTRUTURA — Conversão da imagem enviada para o formato de armazenamento
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONVERSÃO ACONTECE AQUI, E NÃO NO NAVEGADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Converter no navegador seria mais barato (o arquivo subiria já menor), mas a
 *  garantia ficaria com quem envia: um cliente que ignore o passo, ou que fale
 *  direto com a URL assinada, deixaria o acervo fora do padrão. Aqui a regra vale
 *  para todo caminho — capa, logotipo, patrocinador, galeria e foto do palestrante
 *  passam pela MESMA confirmação (`confirmAssetUpload`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CONVERSÃO TAMBÉM É UMA VALIDAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Antes desta fase, o conteúdo do objeto era confiado: a assinatura do arquivo
 *  era conferida nos primeiros bytes que o CLIENTE mandou, e a confirmação só
 *  relia o `Content-Type` gravado no bucket. Quem tivesse a URL assinada podia
 *  gravar outra coisa ali. Decodificar para reconverter fecha essa porta: o que não
 *  é imagem não vira imagem, e é recusado — junto com o objeto, que é apagado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS COISAS QUE A DECODIFICAÇÃO FAZ DE PROPÓSITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • **assenta a orientação** (`rotate()` sem argumento aplica o EXIF): sem isso,
 *      a foto de celular deitada continuaria dependendo de o navegador honrar o
 *      EXIF — e o WebP gravado não leva mais o EXIF junto;
 *    • **descarta os metadados**: não há `withMetadata()`, então data, modelo da
 *      câmera e coordenadas não seguem para a página pública. É privacidade de
 *      brinde, e é o motivo de o aviso na tela falar do assunto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import sharp from 'sharp';

import {
  MAX_SOURCE_PIXELS,
  WEBP_POLICY,
  WEBP_QUALITY,
  type ImageMimeType,
  type ImageTarget,
  type WebpEncodingMode,
} from '@/domain/events/image-rules';

export interface WebpEncodedImage {
  bytes: Buffer;
  widthPx: number;
  heightPx: number;
  mode: WebpEncodingMode;
  /** A imagem foi reduzida para caber no teto da finalidade. */
  resized: boolean;
}

export type WebpEncoding = ({ ok: true } & WebpEncodedImage) | { ok: false; message: string };

/**
 * O sinal de ANIMAÇÃO de um WebP está no contêiner, e não no quadro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE LER OS BYTES, SE O DECODIFICADOR JÁ CONTA OS QUADROS
 * ─────────────────────────────────────────────────────────────────────────────
 *  Duas razões, e as duas importam:
 *    • `pages` depende de o decodificador enxergar múltiplos quadros, e um WebP
 *      animado de UM quadro (ou com o cabeçalho que o libvips não conta) passaria
 *      pela checagem e seria achatado em silêncio;
 *    • a checagem por bytes acontece ANTES de decodificar, então um arquivo animado
 *      não gasta memória para depois ser recusado.
 *
 *  O bit 1 (0x02) do primeiro byte de flags do `VP8X` é o `ANIMATION` do formato
 *  (WebP Container Specification).
 */
function isAnimatedWebp(bytes: Buffer): boolean {
  if (bytes.length < 21) return false;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF') return false;
  if (bytes.toString('latin1', 8, 12) !== 'WEBP') return false;
  if (bytes.toString('latin1', 12, 16) !== 'VP8X') return false;

  return ((bytes[20] ?? 0) & 0x02) !== 0;
}

const ANIMATED_REFUSAL =
  'Imagem animada não é aceita. Envie um quadro único (PNG, JPEG, WebP ou AVIF).';

/**
 * Decodifica a imagem enviada e a grava no formato de armazenamento.
 *
 * Devolve erro como VALOR (o serviço decide o que fazer: recusar e apagar o
 * objeto), nunca lança para o chamador. Nenhuma mensagem aqui cita detalhe interno
 * do libvips: quem lê é o organizador que enviou a foto.
 */
export async function encodeAssetAsWebp(input: {
  bytes: Buffer;
  target: ImageTarget;
  sourceMime: ImageMimeType;
}): Promise<WebpEncoding> {
  const policy = WEBP_POLICY[input.target];

  try {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  IMAGEM ANIMADA É RECUSADA, NÃO ACHATADA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O decodificador entrega o PRIMEIRO quadro por padrão. Aceitar em silêncio
     *  transformaria um WebP animado que funcionava ontem num quadro parado hoje —
     *  uma degradação sem aviso. Recusar com o motivo escrito é a resposta honesta.
     *
     *  A checagem vem ANTES de decodificar: recusar um arquivo animado não precisa
     *  abrir o arquivo animado.
     */
    if (isAnimatedWebp(input.bytes)) {
      return { ok: false, message: ANIMATED_REFUSAL };
    }

    /**
     * A leitura do CABEÇALHO não passa pelo limite de pixels de propósito: medir é
     * barato (só o cabeçalho é lido) e é o que permite recusar a imagem grande com
     * uma mensagem que diz o tamanho, em vez de estourar um erro genérico de libvips.
     * O limite volta a valer na codificação, que é a etapa que aloca memória.
     */
    const header = await sharp(input.bytes, { limitInputPixels: false }).metadata();

    if (!header.width || !header.height) {
      return { ok: false, message: 'Não foi possível ler as medidas da imagem.' };
    }

    if ((header.pages ?? 1) > 1) {
      return { ok: false, message: ANIMATED_REFUSAL };
    }

    if (header.width * header.height > MAX_SOURCE_PIXELS) {
      return {
        ok: false,
        message: `A imagem tem ${header.width} × ${header.height} pixels, acima do limite de ${Math.round(
          MAX_SOURCE_PIXELS / 1_000_000,
        )} megapixels.`,
      };
    }

    let pipeline = sharp(input.bytes, {
      limitInputPixels: MAX_SOURCE_PIXELS,
      failOn: 'error',
    }).rotate();

    let resized = false;

    if (policy.maxLongestSide !== null) {
      const before = { width: header.width, height: header.height };
      pipeline = pipeline.resize({
        width: policy.maxLongestSide,
        height: policy.maxLongestSide,
        fit: 'inside',
        // Sem isto, uma imagem menor que o teto seria AMPLIADA — e ampliar só gasta
        // bytes para piorar a nitidez.
        withoutEnlargement: true,
      });

      resized = before.width > policy.maxLongestSide || before.height > policy.maxLongestSide;
    }

    const encoded =
      policy.mode === 'GRAFICO'
        ? await pipeline.webp({ lossless: true, effort: 4 }).toBuffer({ resolveWithObject: true })
        : await pipeline
            .webp({ quality: WEBP_QUALITY, effort: 4 })
            .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      bytes: encoded.data,
      widthPx: encoded.info.width,
      heightPx: encoded.info.height,
      mode: policy.mode,
      resized,
    };
  } catch (error) {
    /**
     * `failOn: 'error'` faz arquivo truncado ou corrompido cair aqui em vez de ser
     * convertido pela metade — o navegador de quem visita a página não teria
     * piedade do resultado. O log guarda o motivo real; a tela recebe o motivo útil.
     */
    console.error(
      `[imagem] recusa na conversão: ${
        error instanceof Error ? error.message : 'falha desconhecida'
      }`,
    );

    return {
      ok: false,
      message: 'O conteúdo do arquivo não pôde ser lido como imagem. Envie PNG, JPEG, WebP ou AVIF.',
    };
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A MINIATURA DO ACERVO (FASE 56 · dívida E18)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ACERVO PRECISAVA DISTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A galeria desenhava cada imagem INTEIRA dentro de um quadrado de ~200 px: abrir o
 *  acervo com vinte fotos de 3 MB baixava dezenas de megabytes para mostrar vinte
 *  quadrados. O peso não estava na tela — estava em não existir uma versão pequena
 *  para pedir.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MINIATURA É DERIVADA, E NUNCA SUBSTITUI O ORIGINAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O recorte é `cover` (a galeria quer o quadrado cheio, sem faixa), a qualidade é
 *  mais baixa (70) e o teto é 320 px — o suficiente para um cartão em tela retina e
 *  umas cem vezes menor que a foto. O ORIGINAL continua no bucket: é ele que a página
 *  pública renderiza.
 *
 *  O `rotate()` respeita a orientação do EXIF (mesma régua do WebP da FASE 46): sem
 *  ele, a mesma foto sairia deitada na galeria e em pé na página.
 *
 *  Imagem pequena é AMPLIADA de propósito: o cartão precisa do quadrado cheio, e uma
 *  miniatura de 80 px com tarja branca ficaria pior do que a mesma imagem esticada.
 */
export const THUMBNAIL_MAX_SIZE_PX = 320;
export const THUMBNAIL_QUALITY = 70;

export async function encodeThumbnailAsWebp(input: {
  bytes: Buffer;
  maxSizePx?: number;
}): Promise<
  { ok: true; bytes: Buffer; widthPx: number; heightPx: number } | { ok: false; message: string }
> {
  const maxSizePx = input.maxSizePx ?? THUMBNAIL_MAX_SIZE_PX;

  try {
    const encoded = await sharp(input.bytes, {
      limitInputPixels: MAX_SOURCE_PIXELS,
      failOn: 'error',
    })
      .rotate()
      .resize({ width: maxSizePx, height: maxSizePx, fit: 'cover' })
      .webp({ quality: THUMBNAIL_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      bytes: encoded.data,
      widthPx: encoded.info.width ?? maxSizePx,
      heightPx: encoded.info.height ?? maxSizePx,
    };
  } catch {
    return { ok: false, message: 'Não foi possível gerar a miniatura desta imagem.' };
  }
}

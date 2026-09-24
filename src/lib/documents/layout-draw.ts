/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DESENHO DO LAYOUT — o mesmo desenho no SVG e no PDF
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A GEOMETRIA SAI DAQUI, E NÃO DE CADA RENDERIZADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O organizador arrasta um elemento e vê a prévia; depois o participante baixa o
 *  PDF. Se cada renderizador decidisse a quebra de linha, o alinhamento e o recorte
 *  da arte por conta própria, a prévia poderia mostrar uma coisa e o documento sair
 *  outra — e um certificado com o texto cortado é um defeito de documento, não de
 *  tela.
 *
 *  Então TUDO que decide o desenho acontece aqui, em milímetros, com origem no canto
 *  superior esquerdo (o espaço em que a tela pensa). Cada formato só converte:
 *
 *    • SVG ....... 1 unidade de usuário = 1 mm, e o `viewBox` é a página em mm;
 *    • PDF ....... milímetros viram pontos e o Y é invertido (a origem do PDF é o
 *                  canto INFERIOR esquerdo).
 *
 *  A matriz de posicionamento é a mesma nos dois: nos dois formatos a imagem é
 *  desenhada dentro do QUADRADO UNITÁRIO e a matriz leva esse quadrado para a
 *  página. `svgMatrix()` usa a matriz como está; `pdfMatrix()` converte unidade e
 *  inverte o Y — a única diferença entre os dois documentos.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ARTE ENTRA COMO ESTÁ (E A ORIENTAÇÃO EXIF VIRA MATEMÁTICA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os bytes do JPEG vão para o PDF no `/DCTDecode`, sem recomprimir: é o que mantém
 *  o arquivo determinístico. Foto de celular, porém, costuma vir "deitada" com a
 *  orientação no EXIF — e o PDF não lê EXIF. Recodificar o arquivo para endireitar
 *  os pixels mudaria os bytes; então a rotação e o espelho entram na MATRIZ.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  elementText,
  pageFormat,
  visibleElements,
  type CertificateAlignment,
  type CertificateBackground,
  type CertificateFontKey,
  type CertificateLayout,
  type CertificateLayoutElement,
  type CertificatePageFormat,
  type CertificateVariableValues,
} from '@/domain/certificates/certificate-layout-rules';
import { approximateWidth, buildQrMatrix, escapePdfText, escapeXml } from '@/lib/documents/pdf-text';

// ───────────────────────────────────────────────────────────────────────────────
//  Unidades
// ───────────────────────────────────────────────────────────────────────────────
export const PT_PER_MM = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

/**
 * Fração do corpo usada como altura da primeira linha de base.
 *
 * É APROXIMAÇÃO, e declarada: a altura real de cada fonte padrão do PDF varia entre
 * 0,68 e 0,72 do corpo. Como o MESMO número serve à tela e ao arquivo, o que o
 * organizador vê na prévia é o que sai impresso — que é o que importa aqui.
 */
const ASCENT_RATIO = 0.78;

// ───────────────────────────────────────────────────────────────────────────────
//  Fontes
// ───────────────────────────────────────────────────────────────────────────────
/** Nome do recurso de fonte no PDF — a ordem casa com `PDF_FONT_OBJECTS`. */
export const PDF_FONT_RESOURCES: Readonly<Record<CertificateFontKey, string>> = {
  HELVETICA: 'F1',
  HELVETICA_BOLD: 'F2',
  TIMES: 'F3',
  TIMES_BOLD: 'F4',
  COURIER: 'F5',
};

/** Empilhamento equivalente no navegador — é a mesma família, com o fallback do sistema. */
const SVG_FONT_FAMILIES: Readonly<Record<CertificateFontKey, string>> = {
  HELVETICA: 'Helvetica, Arial, sans-serif',
  HELVETICA_BOLD: 'Helvetica, Arial, sans-serif',
  TIMES: 'Times New Roman, Times, serif',
  TIMES_BOLD: 'Times New Roman, Times, serif',
  COURIER: 'Courier New, Courier, monospace',
};

const SVG_FONT_WEIGHTS: Readonly<Record<CertificateFontKey, string>> = {
  HELVETICA: 'normal',
  HELVETICA_BOLD: 'bold',
  TIMES: 'normal',
  TIMES_BOLD: 'bold',
  COURIER: 'normal',
};

// ───────────────────────────────────────────────────────────────────────────────
//  Quebra de linha e alinhamento
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Quebra o texto na largura do elemento, em PT (a régua da fonte).
 *
 * A largura é medida com a MESMA aproximação usada para centralizar texto no PDF
 * desde a FASE 6 — uma segunda tabela de larguras criaria duas réguas para o mesmo
 * tipo, e a quebra da tela divergiria da quebra do arquivo.
 */
export function wrapToWidth(text: string, widthPt: number, sizePt: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;

      // Palavra sozinha maior que a caixa fica como está: cortá-la no meio
      // inventaria um erro de digitação que não existe no dado.
      if (!current || approximateWidth(candidate, sizePt) <= widthPt) {
        current = candidate;
        continue;
      }

      lines.push(current);
      current = word;
    }

    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Linhas que cabem na ALTURA do elemento.
 *
 * O que não couber sai, e a última linha fica com reticências: um documento que
 * perde texto em silêncio é pior do que um documento que avisa que não coube.
 */
export function layoutTextLines(input: {
  text: string;
  widthMm: number;
  heightMm: number;
  sizePt: number;
  lineHeight: number;
}): string[] {
  const lines = wrapToWidth(input.text, mmToPt(input.widthMm), input.sizePt);
  const lineHeightPt = input.sizePt * input.lineHeight;
  const maxLines = Math.max(1, Math.floor(mmToPt(input.heightMm) / lineHeightPt));

  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(kept[maxLines - 1] ?? '', mmToPt(input.widthMm), input.sizePt);

  return kept;
}

/**
 * Apara a linha até que ela caiba COM as reticências.
 *
 * Só acrescentar o "…" no fim não funciona: a última linha de um bloco cheio já
 * encosta na largura, e o marcador de corte não caberia — e aí o texto seria cortado
 * em silêncio, que é exatamente o que as reticências existem para evitar.
 */
export function ellipsize(line: string, widthPt: number, sizePt: number): string {
  const marker = '…';

  if (approximateWidth(`${line}${marker}`, sizePt) <= widthPt) return `${line}${marker}`;

  const words = line.split(' ');
  while (words.length > 1) {
    words.pop();
    const candidate = `${words.join(' ')}${marker}`;
    if (approximateWidth(candidate, sizePt) <= widthPt) return candidate;
  }

  // Uma palavra só, maior que a caixa: corta por caractere — o marcador de corte é
  // informação, e perdê-lo é pior do que cortar a palavra.
  let single = words[0] ?? '';

  while (single.length > 1 && approximateWidth(`${single}${marker}`, sizePt) > widthPt) {
    single = single.slice(0, -1);
  }

  return `${single}${marker}`;
}

/** X (em mm) onde a linha começa, conforme o alinhamento do elemento. */
export function alignedX(
  element: Pick<CertificateLayoutElement, 'align' | 'xMm' | 'widthMm'>,
  line: string,
  sizePt: number,
): number {
  const lineWidthMm = ptToMm(approximateWidth(line, sizePt));

  const positions: Record<CertificateAlignment, number> = {
    LEFT: element.xMm,
    CENTER: element.xMm + Math.max(element.widthMm - lineWidthMm, 0) / 2,
    RIGHT: element.xMm + Math.max(element.widthMm - lineWidthMm, 0),
  };

  return positions[element.align];
}

/** Linha de base (em mm, do topo) de cada linha do elemento. */
export function baselines(element: Pick<CertificateLayoutElement, 'yMm' | 'sizePt' | 'lineHeight'>, lineCount: number): number[] {
  const firstBaseline = element.yMm + ptToMm(element.sizePt) * ASCENT_RATIO;
  const step = ptToMm(element.sizePt * element.lineHeight);

  return Array.from({ length: lineCount }, (_, index) => firstBaseline + index * step);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Matriz de posicionamento (o quadrado unitário → a página)
// ───────────────────────────────────────────────────────────────────────────────
export type Matrix = readonly [number, number, number, number, number, number];

/**
 * Arredonda uma medida em mm para o mícron.
 *
 * O `COVER` de uma arte 3508 × 2480 em A4 paisagem dá 210,00000000000003 mm de altura
 * por conta do ponto flutuante — e uma arte que "não cobre a página" por
 * 0,00000000000003 mm é ruído de conta, não geometria.
 */
function roundLength(mm: number): number {
  return Math.round(mm * 1_000_000) / 1_000_000;
}

/**
 * Orientação EXIF → rotação (em sentido HORÁRIO na tela) e espelho horizontal.
 *
 * As cinco primeiras são rotações; 5 e 7 (transpostas, típicas de scanner) são
 * espelho MAIS rotação, e a ordem importa: o espelho acontece no espaço da imagem
 * (o quadrado unitário) e a rotação depois — invertidos, a 5 e a 7 sairiam trocadas.
 */
const ORIENTATION_TRANSFORM: Readonly<Record<number, { rotation: 0 | 90 | 180 | 270; flipX: boolean }>> = {
  1: { rotation: 0, flipX: false },
  2: { rotation: 0, flipX: true },
  3: { rotation: 180, flipX: false },
  4: { rotation: 180, flipX: true },
  5: { rotation: 90, flipX: true },
  6: { rotation: 90, flipX: false },
  7: { rotation: 270, flipX: true },
  8: { rotation: 270, flipX: false },
};

export function orientationTransform(orientation: number): { rotation: 0 | 90 | 180 | 270; flipX: boolean } {
  return ORIENTATION_TRANSFORM[orientation] ?? { rotation: 0, flipX: false };
}

/**
 * Matriz que leva o quadrado unitário ao retângulo pedido, girado em torno do
 * próprio centro. Espaço de tela: Y cresce para BAIXO.
 */
export function placementMatrix(input: {
  preRotationWidth: number;
  preRotationHeight: number;
  centerX: number;
  centerY: number;
  rotation: 0 | 90 | 180 | 270;
  flipX: boolean;
}): Matrix {
  const radians = (input.rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(radians));
  const sin = Math.round(Math.sin(radians));

  let a = cos * input.preRotationWidth;
  let b = -sin * input.preRotationWidth;
  const c = sin * input.preRotationHeight;
  const d = cos * input.preRotationHeight;
  const e = input.centerX - (a + c) / 2;
  const f = input.centerY - (b + d) / 2;

  /**
   * `-0` não é `0` para quem compara matriz: um seno zero deixa o sinal negativo no
   * coeficiente, e a matriz "igual" falharia em teste e em relatório de geometria.
   */
  const noNegativeZero = (value: number): number => (value === 0 ? 0 : value);
  const clean = (
    a1: number,
    b1: number,
    c1: number,
    d1: number,
    e1: number,
    f1: number,
  ): Matrix => [
    noNegativeZero(a1),
    noNegativeZero(b1),
    noNegativeZero(c1),
    noNegativeZero(d1),
    noNegativeZero(e1),
    noNegativeZero(f1),
  ];

  if (input.flipX) {
    // Espelhar o DOMÍNIO (u → 1-u) é o que inverte a imagem, e não o desenho dela.
    const a0 = a;
    const b0 = b;
    a = -a0;
    b = -b0;

    return clean(a, b, c, d, e + a0, f + b0);
  }

  return clean(a, b, c, d, e, f);
}

export interface BackgroundPlacement {
  matrix: Matrix;
  /** Dimensões desenhadas, em mm, já depois da rotação. */
  drawnWidthMm: number;
  drawnHeightMm: number;
  /** Sobra em mm de cada lado (para o aviso de recorte). */
  overflowXMm: number;
  overflowYMm: number;
}

/**
 * Onde a arte é desenhada na página.
 *
 * `COVER` usa UM fator de escala para os dois eixos: é o que impede a marca da
 * instituição de sair achatada. `STRETCH` usa dois, e é escolha explícita de quem
 * desenhou a arte no tamanho da página.
 */
export function backgroundPlacement(  background: CertificateBackground,
  page: CertificatePageFormat,
): BackgroundPlacement {
  const { widthMm: pageWidth, heightMm: pageHeight } = pageFormat(page);

  const swapped = background.orientation >= 5;
  const effectiveWidthPx = swapped ? background.heightPx : background.widthPx;
  const effectiveHeightPx = swapped ? background.widthPx : background.heightPx;

  const coverScale = Math.max(pageWidth / effectiveWidthPx, pageHeight / effectiveHeightPx);
  const scaleX = background.fit === 'STRETCH' ? pageWidth / effectiveWidthPx : coverScale;
  const scaleY = background.fit === 'STRETCH' ? pageHeight / effectiveHeightPx : coverScale;

  const drawnWidthMm = roundLength(effectiveWidthPx * scaleX);
  const drawnHeightMm = roundLength(effectiveHeightPx * scaleY);

  const { rotation, flipX } = orientationTransform(background.orientation);
  const swapsAxes = rotation === 90 || rotation === 270;

  const matrix = placementMatrix({
    preRotationWidth: swapsAxes ? drawnHeightMm : drawnWidthMm,
    preRotationHeight: swapsAxes ? drawnWidthMm : drawnHeightMm,
    centerX: pageWidth / 2,
    centerY: pageHeight / 2,
    rotation,
    flipX,
  });

  return {
    matrix,
    drawnWidthMm,
    drawnHeightMm,
    overflowXMm: Math.max(drawnWidthMm - pageWidth, 0),
    overflowYMm: Math.max(drawnHeightMm - pageHeight, 0),
  };
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/** A matriz como o SVG a entende (mm, origem no topo esquerdo). */
export function svgMatrixValue(matrix: Matrix): string {
  return `matrix(${matrix.map(formatNumber).join(' ')})`;
}

/**
 * A mesma matriz no espaço do PDF: milímetros viram pontos e o Y é invertido.
 *
 * A inversão é sobre a ALTURA DA PÁGINA (`y' = H - y`), e é a única coisa que muda
 * entre os dois formatos.
 */
export function pdfMatrixValue(matrix: Matrix, pageHeightPt: number): string {
  const [a, b, c, d, e, f] = matrix.map((value) => value * PT_PER_MM) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  return [a, -b, -c, d, e, pageHeightPt - f].map(formatNumber).join(' ');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cores
// ───────────────────────────────────────────────────────────────────────────────
export function hexToRgb(color: string): { r: number; g: number; b: number } {
  const hex = color.replace('#', '');

  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
  };
}

export function pdfColor(color: string): string {
  const { r, g, b } = hexToRgb(color);

  return `${formatNumber(r)} ${formatNumber(g)} ${formatNumber(b)} rg`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  QR Code
// ───────────────────────────────────────────────────────────────────────────────
export interface QrPlacement {
  /** Lado do QR em mm — o menor lado da caixa, para o código sair quadrado. */
  sizeMm: number;
  /** Canto superior esquerdo do QR, em mm. */
  xMm: number;
  yMm: number;
}

export function qrPlacement(element: Pick<CertificateLayoutElement, 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>): QrPlacement {
  const sizeMm = Math.min(element.widthMm, element.heightMm);

  return { sizeMm, xMm: element.xMm, yMm: element.yMm };
}

// ───────────────────────────────────────────────────────────────────────────────
//  SVG
// ───────────────────────────────────────────────────────────────────────────────
export interface LayoutSvgInput {
  layout: CertificateLayout;
  values: CertificateVariableValues;
  qrPayload: string;
  /** `href` da arte — `data:` URI, para o arquivo não depender de URL assinada. */
  backgroundHref?: string | null;
}

/**
 * Desenha o layout em SVG, em milímetros.
 *
 * O `viewBox` é a página em mm, então as coordenadas do layout entram cruas: o
 * mesmo número que o organizador digitou no campo "Y" é o que posiciona o texto.
 */
export function drawLayoutSvg(input: LayoutSvgInput): string {
  const { widthMm, heightMm } = pageFormat(input.layout.page);
  const parts: string[] = [];

  if (input.layout.background && input.backgroundHref) {
    const placement = backgroundPlacement(input.layout.background, input.layout.page);
    parts.push(
      `  <image href="${escapeXml(input.backgroundHref)}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="${svgMatrixValue(placement.matrix)}"/>`,
    );
  }

  for (const element of visibleElements(input.layout, input.values)) {
    if (element.kind === 'QR') {
      const qr = buildQrMatrix(input.qrPayload);
      const placement = qrPlacement(element);
      const moduleSize = placement.sizeMm / qr.size;
      const rects: string[] = [];

      for (let row = 0; row < qr.size; row += 1) {
        for (let column = 0; column < qr.size; column += 1) {
          if (!qr.data[row * qr.size + column]) continue;

          rects.push(
            `<rect x="${formatNumber(placement.xMm + column * moduleSize)}" y="${formatNumber(placement.yMm + row * moduleSize)}" width="${formatNumber(moduleSize)}" height="${formatNumber(moduleSize)}"/>`,
          );
        }
      }

      parts.push(
        `  <g fill="${element.color}" data-element="${escapeXml(element.id)}">\n    ${rects.join('\n    ')}\n  </g>`,
      );
      continue;
    }

    const text = elementText(element, input.values);
    if (text === null) continue;

    const lines = layoutTextLines({
      text,
      widthMm: element.widthMm,
      heightMm: element.heightMm,
      sizePt: element.sizePt,
      lineHeight: element.lineHeight,
    });
    const tops = baselines(element, lines.length);

    const svgLines = lines
      .map((line, index) => {
        const x = alignedX(element, line, element.sizePt);
        return `<text x="${formatNumber(x)}" y="${formatNumber(tops[index] ?? element.yMm)}" font-family="${SVG_FONT_FAMILIES[element.font]}" font-size="${formatNumber(ptToMm(element.sizePt))}" font-weight="${SVG_FONT_WEIGHTS[element.font]}" fill="${element.color}">${escapeXml(line)}</text>`;
      })
      .join('\n    ');

    parts.push(`  <g data-element="${escapeXml(element.id)}">\n    ${svgLines}\n  </g>`);
  }

  return `  <g data-layout="${escapeXml(input.layout.page)}" data-page="${widthMm}x${heightMm}">\n${parts.join('\n')}\n  </g>`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  PDF
// ───────────────────────────────────────────────────────────────────────────────
export interface LayoutPdfInput {
  layout: CertificateLayout;
  values: CertificateVariableValues;
  qrPayload: string;
  /** A página em pontos: A4 paisagem é 841,89 × 595,28. */
  widthPt: number;
  heightPt: number;
  /**
   * Bytes ORIGINAIS do JPEG. Sem eles o PDF sai sem a arte — e por isso o serviço
   * recusa renderizar quando o layout diz que existe arte e ela não pôde ser lida:
   * um certificado que perde a identidade da instituição em silêncio é pior do que
   * uma emissão que falha e diz por quê.
   */
  backgroundBytes?: Uint8Array | null;
  /** Nome do XObject da imagem no PDF (`Im0`). */
  imageName?: string;
}

export interface LayoutPdfDrawing {
  operations: string[];
  /** O objeto de imagem (stream binário) que o chamador numera. */
  imageObject: Buffer | null;
}

/**
 * Desenha o layout em operadores de PDF.
 *
 * A imagem entra como um XObject cujo stream são os BYTES ORIGINAIS do JPEG, com
 * `/Filter /DCTDecode`: o PDF embute o arquivo como está, sem recomprimir, e é isso
 * que mantém o documento determinístico.
 */
export function drawLayoutPdf(input: LayoutPdfInput): LayoutPdfDrawing {
  const operations: string[] = [];

  const xPt = (mm: number) => mmToPt(mm);
  /** PDF tem origem no canto inferior esquerdo; o layout pensa a partir do topo. */
  const yPt = (mm: number) => input.heightPt - mmToPt(mm);

  let imageObject: Buffer | null = null;

  if (input.layout.background && input.backgroundBytes) {
    const placement = backgroundPlacement(input.layout.background, input.layout.page);
    const name = input.imageName ?? 'Im0';

    imageObject = buildJpegXObject(input.layout.background, input.backgroundBytes);

    operations.push('q');
    // Recorte na página: o excesso do `COVER` não deve nem ser pintado.
    operations.push(`0 0 ${formatNumber(input.widthPt)} ${formatNumber(input.heightPt)} re W n`);
    operations.push(`${pdfMatrixValue(placement.matrix, input.heightPt)} cm`);
    operations.push(`/${name} Do`);
    operations.push('Q');
  }

  for (const element of visibleElements(input.layout, input.values)) {
    if (element.kind === 'QR') {
      const qr = buildQrMatrix(input.qrPayload);
      const placement = qrPlacement(element);
      const moduleSize = placement.sizeMm / qr.size;

      operations.push('0 0 0 rg');

      for (let row = 0; row < qr.size; row += 1) {
        for (let column = 0; column < qr.size; column += 1) {
          if (!qr.data[row * qr.size + column]) continue;

          const x = placement.xMm + column * moduleSize;
          const top = placement.yMm + row * moduleSize;
          operations.push(
            `${formatNumber(xPt(x))} ${formatNumber(yPt(top + moduleSize))} ${formatNumber(xPt(moduleSize))} ${formatNumber(xPt(moduleSize))} re f`,
          );
        }
      }

      continue;
    }

    const text = elementText(element, input.values);
    if (text === null) continue;

    const lines = layoutTextLines({
      text,
      widthMm: element.widthMm,
      heightMm: element.heightMm,
      sizePt: element.sizePt,
      lineHeight: element.lineHeight,
    });
    const tops = baselines(element, lines.length);

    operations.push(pdfColor(element.color));

    lines.forEach((line, index) => {
      const x = alignedX(element, line, element.sizePt);
      operations.push(
        `BT /${PDF_FONT_RESOURCES[element.font]} ${formatNumber(element.sizePt)} Tf ${formatNumber(xPt(x))} ${formatNumber(yPt(tops[index] ?? element.yMm))} Td (${escapePdfText(line)}) Tj ET`,
      );
    });
  }

  return { operations, imageObject };
}

/**
 * Objeto de imagem do PDF a partir do JPEG.
 *
 * Os bytes entram CRUS: o PDF guarda o arquivo como está, e o `/Length` é o tamanho
 * exato do stream (errado, o leitor perde o fim da imagem). `/DeviceGray` e
 * `/DeviceRGB` saem do número de componentes lido no upload — CMYK é recusado antes
 * de chegar aqui.
 */
export function buildJpegXObject(background: CertificateBackground, bytes: Uint8Array): Buffer {
  const colorSpace = background.colorComponents === 1 ? '/DeviceGray' : '/DeviceRGB';
  const header = Buffer.from(
    `<< /Type /XObject /Subtype /Image /Width ${background.widthPx} /Height ${background.heightPx} ` +
      `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
    'latin1',
  );
  const tail = Buffer.from('\nendstream', 'latin1');

  return Buffer.concat([header, Buffer.from(bytes), tail]);
}

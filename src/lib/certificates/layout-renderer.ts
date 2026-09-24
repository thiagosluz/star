/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RENDERIZADOR DO CERTIFICADO COM LAYOUT (versão 2 do documento)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE MÓDULO EXISTE AO LADO DO RENDERIZADOR ANTIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O desenho fixo da FASE 6 continua sendo o desenho dos certificados JÁ emitidos:
 *  eles não têm layout no snapshot, e re-renderizá-los com outra geometria mudaria o
 *  arquivo de um documento que já está nas mãos de alguém. Então o renderizador
 *  antigo ficou INTACTO, e o layout entrou aqui — a versão do documento decide qual
 *  dos dois desenha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele não lê banco, não resolve variável e não decide layout: recebe os valores já
 *  congelados, o layout e os bytes da arte. É o que permite usar os MESMOS bytes no
 *  arquivo emitido e na prévia da tela — se a prévia passasse por outro caminho,
 *  ela mostraria um certificado que não é o que será baixado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  pageFormat,
  type CertificateLayout,
  type CertificateVariableValues,
} from '@/domain/certificates/certificate-layout-rules';
import { drawLayoutPdf, drawLayoutSvg, mmToPt } from '@/lib/documents/layout-draw';
import { PDF_FONT_OBJECTS, assemblePdf, escapePdfText, escapeXml, pdfDate } from '@/lib/documents/pdf-text';

export interface CertificateLayoutDocument {
  /** Todas as variáveis já resolvidas (conteúdo congelado + auditoria). */
  values: CertificateVariableValues;
  layout: CertificateLayout;
  /** Bytes ORIGINAIS do JPEG da arte, quando o layout tem fundo. */
  backgroundBytes: Uint8Array | null;
  /**
   * Instante da emissão (o mesmo do conteúdo assinado). Entra nos metadados do PDF
   * como data de criação — a data do ARQUIVO, não a do relógio de quem renderiza:
   * senão o mesmo certificado geraria bytes diferentes a cada tentativa.
   */
  issuedAt: Date;
}

/** Dimensões da página em pontos (1 pt = 1/72 in), derivadas dos milímetros. */
export function pageSizePt(layout: CertificateLayout): { widthPt: number; heightPt: number } {
  const { widthMm, heightMm } = pageFormat(layout.page);

  return { widthPt: mmToPt(widthMm), heightPt: mmToPt(heightMm) };
}

function backgroundDataUri(bytes: Uint8Array): string {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * SVG do certificado com layout, em milímetros.
 *
 * A arte entra como `data:` URI de propósito: o SVG fica AUTOSSUFICIENTE e não
 * depende de URL assinada (que expira). Um documento que "abre sem a arte" depois de
 * uma hora não é documento.
 */
export function renderCertificateLayoutSvg(document: CertificateLayoutDocument): string {
  const { widthMm, heightMm } = pageFormat(document.layout.page);

  const body = drawLayoutSvg({
    layout: document.layout,
    values: document.values,
    qrPayload: document.values.url_validacao,
    backgroundHref: document.backgroundBytes ? backgroundDataUri(document.backgroundBytes) : null,
  });

  const label = `${document.values.titulo} — ${document.values.nome}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" role="img" aria-label="${escapeXml(label)}">
  <rect width="100%" height="100%" fill="#ffffff"/>
${body}
</svg>
`;
}

/**
 * PDF do certificado com layout.
 *
 * A numeração de objetos é CONTRATO: catálogo (1), páginas (2), página (3), conteúdo
 * (4), as fontes (5 em diante), a imagem da arte (logo após as fontes, quando
 * existe) e as informações. O `/Length` do stream de conteúdo é medido em BYTES.
 */
export function renderCertificateLayoutPdf(document: CertificateLayoutDocument): Buffer {
  const { widthPt, heightPt } = pageSizePt(document.layout);
  const hasBackground = document.layout.background !== null;

  const drawing = drawLayoutPdf({
    layout: document.layout,
    values: document.values,
    qrPayload: document.values.url_validacao,
    widthPt,
    heightPt,
    backgroundBytes: document.backgroundBytes,
  });

  const firstFontObject = 5;
  const fontsDictionary = PDF_FONT_OBJECTS.map(
    (_, index) => `/F${index + 1} ${firstFontObject + index} 0 R`,
  ).join(' ');

  const imageObjectIndex = firstFontObject + PDF_FONT_OBJECTS.length;
  const xObjectDictionary =
    drawing.imageObject && hasBackground ? ` /XObject << /Im0 ${imageObjectIndex} 0 R >>` : '';

  const content = drawing.operations.join('\n');
  const contentBuffer = Buffer.from(content, 'latin1');

  const objects: (string | Buffer)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Resources << /Font << ${fontsDictionary} >>${xObjectDictionary} >> /Contents 4 0 R >>`,
    Buffer.concat([
      Buffer.from(`<< /Length ${contentBuffer.length} >>\nstream\n`, 'latin1'),
      contentBuffer,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    ...PDF_FONT_OBJECTS,
  ];

  if (drawing.imageObject && hasBackground) {
    objects.push(drawing.imageObject);
  }

  const issued = pdfDate(document.issuedAt);
  objects.push(
    `<< /Title (${escapePdfText(document.values.titulo)}) /Author (${escapePdfText(document.values.instituicao)}) /Subject (${escapePdfText(document.values.codigo_validacao)}) /Creator (EventFlow) /Producer (EventFlow) /CreationDate (D:${issued}) /ModDate (D:${issued}) >>`,
  );

  return assemblePdf(objects);
}

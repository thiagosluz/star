/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RENDERIZAÇÃO DA FOLHA DE CRACHÁS (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PDF É ESCRITO À MÃO AQUI TAMBÉM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Pela MESMA razão do certificado: determinismo (o mesmo lote gera sempre os mesmos
 *  bytes) e rastreabilidade (o arquivo sai de código legível, sem biblioteca de
 *  terceiros cujo comportamento precise ser auditado). As primitivas de texto, QR e
 *  montagem vêm de `@/lib/documents/pdf-text` — uma regra só para os dois documentos.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A ETIQUETA PRECISA TER, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. **QR Code** com o código do crachá — é o que a câmera lê;
 *  2. **Código do crachá por extenso** (`CR-XXXX-XXXX`) — quando o leitor falha, o
 *     monitor digita; e é o que a pessoa usa para se identificar no balcão;
 *  3. **Nome da pessoa** — a etiqueta é lida por GENTE na porta, antes de qualquer
 *     leitor: sem o nome, o crachá não serve para o que ele existe.
 *
 *  Nada além disso: o QR carrega só o código (nenhum dado pessoal circula em papel e
 *  em leitor de terceiros), e a etiqueta não vira lista de participantes.
 *
 *  A folha é A4 retrato com OITO crachás (2 colunas × 4 linhas), com marcas de corte:
 *  é o formato que sai de impressora comum, sem impressora de etiquetas (dívida
 *  declarada da fase).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  approximateWidth,
  assemblePdf,
  buildQrMatrix,
  escapePdfText,
  PDF_TEXT_FONT_OBJECTS,
  pdfDate,
  wrapText,
} from '@/lib/documents/pdf-text';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  DEFAULT_LABEL_LAYOUT,
  labelPositions,
  mmToPt,
  type LabelSheetLayout,
} from '@/domain/events/badge-print-rules';

/** A4 retrato em pontos: 595 × 842. */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/** Grade da folha: 2 colunas × 4 linhas = 8 crachás por página. */
export const BADGE_COLUMNS = 2;
export const BADGE_ROWS = 4;
export const BADGES_PER_PAGE = BADGE_COLUMNS * BADGE_ROWS;

const MARGIN_X = 28;
const MARGIN_Y = 34;

export interface BadgeLabel {
  /** Nome da pessoa (o que a porta lê). */
  name: string;
  /** Código do crachá, já no formato canônico. */
  code: string;
  /** Linha pequena: evento e, quando houver, a inscrição principal. */
  subtitle?: string | null;
}

export interface BadgeSheetDocument {
  tenantName: string;
  eventTitle: string;
  /** Data de geração — entra no metadado, nunca como `new Date()` escondido. */
  generatedAt: Date;
  badges: readonly BadgeLabel[];
}

/** Uma etiqueta desenhada dentro da célula (canto inferior esquerdo da célula). */
function drawBadge(input: {
  operations: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  badge: BadgeLabel;
  tenantName: string;
  /** `false` na folha adesiva: a etiqueta já tem borda, e a moldura viraria tinta a mais. */
  frame?: boolean;
}): void {
  const { operations, x, y, width, height, badge, tenantName, frame = true } = input;

  // ── Moldura (marca de corte) ───────────────────────────────────────────────
  if (frame) {
    operations.push('0.72 0.75 0.8 RG 0.5 w', `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  }

  /**
   * ── AS MEDIDAS ACOMPANHAM A CÉLULA (FASE 37) ───────────────────────────────
   *
   *  A folha A4 da FASE 31 tem células de ~269 × 193 pt e o desenho foi feito para
   *  elas (QR de 96 pt, nome de 13 pt). A etiqueta adesiva é MENOS da metade disso
   *  (63,5 × 33,9 mm ≈ 180 × 96 pt): manter os números fixos faria o QR (96 pt) estourar
   *  a altura da etiqueta e o nome sair por cima do código.
   *
   *  A referência é a altura da célula da folha A4, e cada medida é o produto dela por
   *  um fator com PISO — abaixo disso o texto fica ilegível e o QR deixa de ser lido.
   *  Na folha A4 o fator é 1, então os números são exatamente os de antes (o teste da
   *  fase anterior continua prendendo isso).
   */
  const scale = Math.min(1, Math.max(0.42, height / 193));
  const padding = Math.max(5, 14 * scale);
  const nameSize = Math.max(8, Math.round(13 * scale));
  const codeSize = Math.max(7, Math.round(12 * scale));
  const originSize = Math.max(5, Math.round(8 * scale));

  // ── QR Code como vetor, à esquerda ────────────────────────────────────────
  const qr = buildQrMatrix(badge.code);
  const qrSize = Math.min(height - 34 * scale, Math.max(40, 96 * scale));
  const moduleSize = qrSize / qr.size;
  const qrX = x + padding;
  const qrY = y + (height - qrSize) / 2;

  operations.push('0 0 0 rg');

  for (let row = 0; row < qr.size; row += 1) {
    for (let column = 0; column < qr.size; column += 1) {
      if (!qr.data[row * qr.size + column]) continue;

      // PDF tem origem no canto INFERIOR esquerdo: a linha 0 do QR é o topo.
      const moduleX = qrX + column * moduleSize;
      const moduleY = qrY + qrSize - (row + 1) * moduleSize;

      operations.push(
        `${moduleX.toFixed(2)} ${moduleY.toFixed(2)} ${moduleSize.toFixed(2)} ${moduleSize.toFixed(2)} re f`,
      );
    }
  }

  // ── Textos, à direita do QR ───────────────────────────────────────────────
  const textX = qrX + qrSize + padding;
  const textWidth = x + width - padding - textX;

  operations.push('0.06 0.09 0.16 rg');

  const nameLines = wrapText(badge.name, Math.max(8, Math.floor(textWidth / (nameSize * 0.55)))).slice(0, 2);
  let cursor = y + height - Math.max(16, 30 * scale);

  nameLines.forEach((line) => {
    operations.push(`BT /F2 ${nameSize} Tf ${textX.toFixed(2)} ${cursor.toFixed(2)} Td (${escapePdfText(line)}) Tj ET`);
    cursor -= nameSize + 3;
  });

  // Código do crachá: é o que o monitor digita quando o leitor falha.
  operations.push('0.11 0.31 0.85 rg');
  operations.push(
    `BT /F2 ${codeSize} Tf ${textX.toFixed(2)} ${(y + Math.max(14, 30 * scale)).toFixed(2)} Td (${escapePdfText(badge.code)}) Tj ET`,
  );

  operations.push('0.42 0.45 0.5 rg');

  const subtitle = badge.subtitle ?? tenantName;
  operations.push(
    `BT /F1 ${originSize} Tf ${textX.toFixed(2)} ${(y + Math.max(7, 18 * scale)).toFixed(2)} Td (${escapePdfText(
      wrapText(subtitle, Math.max(10, Math.floor(textWidth / (originSize * 0.5))))[0]!,
    )}) Tj ET`,
  );
}

/**
 * Gera a folha de crachás em PDF.
 *
 * O lote pode ter QUALQUER tamanho: as páginas são criadas conforme a necessidade
 * (`BADGES_PER_PAGE` por página), e a última pode ficar incompleta — imprimir 3
 * crachás não deve gerar uma página em branco depois.
 */
export function renderBadgeSheetPdf(document: BadgeSheetDocument): Buffer {
  const badges = [...document.badges];
  const pageCount = Math.max(1, Math.ceil(badges.length / BADGES_PER_PAGE));
  const fontCount = PDF_TEXT_FONT_OBJECTS.length;

  /**
   * Numeração de objetos (1-based), fixada ANTES de montar o corpo: a página precisa
   * referenciar o conteúdo e o catálogo precisa referenciar as páginas.
   */
  const firstContents = 3 + fontCount;
  const contentsRef = (page: number) => firstContents + page * 2;
  const pageRef = (page: number) => contentsRef(page) + 1;
  const infoRef = contentsRef(pageCount - 1) + 2;

  const cellWidth = (PAGE_WIDTH - MARGIN_X * 2) / BADGE_COLUMNS;
  const cellHeight = (PAGE_HEIGHT - MARGIN_Y * 2) / BADGE_ROWS;

  const contents: string[] = [];

  for (let page = 0; page < pageCount; page += 1) {
    const operations: string[] = [];
    const slice = badges.slice(page * BADGES_PER_PAGE, (page + 1) * BADGES_PER_PAGE);

    // Cabeçalho discreto: sem ele, uma folha impressa não diz de que evento ela é.
    operations.push('0.42 0.45 0.5 rg');
    operations.push(
      `BT /F1 8 Tf ${MARGIN_X} ${(PAGE_HEIGHT - 20).toFixed(2)} Td (${escapePdfText(
        `${document.eventTitle} · ${document.tenantName}`,
      )}) Tj ET`,
    );
    operations.push(
      `BT /F1 8 Tf ${(PAGE_WIDTH - MARGIN_X - approximateWidth(`página ${page + 1}/${pageCount}`, 8)).toFixed(2)} ${(
        PAGE_HEIGHT - 20
      ).toFixed(2)} Td (${escapePdfText(`página ${page + 1}/${pageCount}`)}) Tj ET`,
    );

    slice.forEach((badge, index) => {
      const column = index % BADGE_COLUMNS;
      const row = Math.floor(index / BADGE_COLUMNS);

      drawBadge({
        operations,
        x: MARGIN_X + column * cellWidth,
        y: PAGE_HEIGHT - MARGIN_Y - cellHeight - row * cellHeight,
        width: cellWidth - 6,
        height: cellHeight - 6,
        badge,
        tenantName: document.tenantName,
      });
    });

    contents.push(operations.join('\n'));
  }

  const issued = pdfDate(document.generatedAt);

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, page) => `${pageRef(page)} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...PDF_TEXT_FONT_OBJECTS,
  ];

  contents.forEach((body, page) => {
    const buffer = Buffer.from(body, 'latin1');

    objects.push(`<< /Length ${buffer.length} >>\nstream\n${body}\nendstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentsRef(page)} 0 R >>`,
    );
  });

  objects.push(
    `<< /Title (${escapePdfText(`Crachás · ${document.eventTitle}`)}) /Author (${escapePdfText(
      document.tenantName,
    )}) /Subject (${escapePdfText(`${badges.length} crachá(s)`)}) /Creator (EventFlow) /Producer (EventFlow) /CreationDate (D:${issued}) /ModDate (D:${issued}) >>`,
  );

  // O objeto de informação é o ÚLTIMO: a numeração calculada acima depende disso.
  if (objects.length !== infoRef) {
    throw new Error(
      `Numeração de objetos inconsistente na folha de crachás (esperado ${infoRef}, obtido ${objects.length}).`,
    );
  }

  return assemblePdf(objects);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Folha de ETIQUETAS adesivas (FASE 37)
// ───────────────────────────────────────────────────────────────────────────────
export interface BadgeLabelSheetDocument extends BadgeSheetDocument {
  layout: LabelSheetLayout;
}

/**
 * A folha de etiquetas adesivas.
 *
 * Três diferenças em relação à folha A4 da FASE 31, e todas têm motivo:
 *
 *   • **sem moldura** — a etiqueta JÁ tem borda; desenhar a marca de corte imprimiria
 *     tinta em cima do recorte e sujaria a borda de todo crachá;
 *   • **sem cabeçalho de página** — a folha inteira é etiqueta, e qualquer texto fora
 *     da grade cairia no papel de suporte (ou na etiqueta do vizinho);
 *   • **a posição vem do LAYOUT** (milímetros), não de uma grade fixa: é o que faz a
 *     impressão cair dentro da etiqueta de qualquer modelo.
 *
 * A última página pode ficar incompleta: imprimir 3 crachás não gera uma folha em branco
 * depois, e a etiqueta vazia simplesmente não é tocada (não se imprime na que sobra).
 */
export function renderBadgeLabelSheetPdf(document: BadgeLabelSheetDocument): Buffer {
  const badges = [...document.badges];
  const positions = labelPositions(document.layout);
  const perPage = positions.length;
  const pageCount = Math.max(1, Math.ceil(badges.length / perPage));
  const fontCount = PDF_TEXT_FONT_OBJECTS.length;
  const pageWidth = mmToPt(A4_WIDTH_MM);
  const pageHeight = mmToPt(A4_HEIGHT_MM);

  const firstContents = 3 + fontCount;
  const contentsRef = (page: number) => firstContents + page * 2;
  const pageRef = (page: number) => contentsRef(page) + 1;
  const infoRef = contentsRef(pageCount - 1) + 2;

  const contents: string[] = [];

  for (let page = 0; page < pageCount; page += 1) {
    const operations: string[] = [];
    const slice = badges.slice(page * perPage, (page + 1) * perPage);

    slice.forEach((badge, index) => {
      const position = positions[index];
      if (!position) return;

      drawBadge({
        operations,
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
        badge,
        tenantName: document.tenantName,
        frame: false,
      });
    });

    contents.push(operations.join('\n'));
  }

  const issued = pdfDate(document.generatedAt);

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, page) => `${pageRef(page)} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...PDF_TEXT_FONT_OBJECTS,
  ];

  contents.forEach((body, page) => {
    const buffer = Buffer.from(body, 'latin1');

    objects.push(`<< /Length ${buffer.length} >>\nstream\n${body}\nendstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentsRef(page)} 0 R >>`,
    );
  });

  objects.push(
    `<< /Title (${escapePdfText(`Etiquetas · ${document.eventTitle}`)}) /Author (${escapePdfText(
      document.tenantName,
    )}) /Subject (${escapePdfText(
      `${badges.length} crachá(s) · grade ${document.layout.columns}x${document.layout.rows} de ${document.layout.labelWidthMm}x${document.layout.labelHeightMm} mm`,
    )}) /Creator (EventFlow) /Producer (EventFlow) /CreationDate (D:${issued}) /ModDate (D:${issued}) >>`,
  );

  if (objects.length !== infoRef) {
    throw new Error(
      `Numeração de objetos inconsistente nas etiquetas (esperado ${infoRef}, obtido ${objects.length}).`,
    );
  }

  return assemblePdf(objects);
}

/** O layout padrão, reexportado para a tela e para os testes não importarem o domínio. */
export const BADGE_LABEL_DEFAULT_LAYOUT = DEFAULT_LABEL_LAYOUT;

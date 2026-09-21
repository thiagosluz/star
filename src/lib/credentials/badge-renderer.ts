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
  PDF_FONT_OBJECTS,
  pdfDate,
  wrapText,
} from '@/lib/documents/pdf-text';

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
}): void {
  const { operations, x, y, width, height, badge, tenantName } = input;

  // ── Moldura (marca de corte) ───────────────────────────────────────────────
  operations.push('0.72 0.75 0.8 RG 0.5 w', `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);

  // ── QR Code como vetor, à esquerda ────────────────────────────────────────
  const qr = buildQrMatrix(badge.code);
  const qrSize = Math.min(height - 34, 96);
  const moduleSize = qrSize / qr.size;
  const qrX = x + 14;
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
  const textX = qrX + qrSize + 14;
  const textWidth = x + width - 14 - textX;

  operations.push('0.06 0.09 0.16 rg');

  const nameSize = 13;
  const nameLines = wrapText(badge.name, Math.max(8, Math.floor(textWidth / (nameSize * 0.55)))).slice(0, 2);
  let cursor = y + height - 30;

  nameLines.forEach((line) => {
    operations.push(`BT /F2 ${nameSize} Tf ${textX.toFixed(2)} ${cursor.toFixed(2)} Td (${escapePdfText(line)}) Tj ET`);
    cursor -= nameSize + 3;
  });

  // Código do crachá: é o que o monitor digita quando o leitor falha.
  operations.push('0.11 0.31 0.85 rg');
  operations.push(
    `BT /F2 12 Tf ${textX.toFixed(2)} ${(y + 30).toFixed(2)} Td (${escapePdfText(badge.code)}) Tj ET`,
  );

  operations.push('0.42 0.45 0.5 rg');

  const subtitle = badge.subtitle ?? tenantName;
  operations.push(
    `BT /F1 8 Tf ${textX.toFixed(2)} ${(y + 18).toFixed(2)} Td (${escapePdfText(
      wrapText(subtitle, Math.max(10, Math.floor(textWidth / (8 * 0.5))))[0]!,
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
  const fontCount = PDF_FONT_OBJECTS.length;

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
    ...PDF_FONT_OBJECTS,
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

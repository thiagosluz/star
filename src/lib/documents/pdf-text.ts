/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PRIMITIVAS DE DOCUMENTO — texto, QR e data para PDF/SVG
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO SAIU DO RENDERIZADOR DE CERTIFICADO (FASE 31)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O crachá (etiqueta com QR, nome e código) é um SEGUNDO documento em PDF, e ele
 *  precisa exatamente das mesmas primitivas do certificado: o QR como vetor, o
 *  escape do operador `Tj`, a quebra de linha e a data no formato do PDF.
 *
 *  Duas cópias da MESMA regra divergem — foi assim que a regra da vaga mudou em um
 *  ponto e ficou para trás em três (armadilha 55). Aqui a regra é uma só, e os dois
 *  renderizadores a importam. O renderizador do certificado continua EXPORTANDO
 *  estes nomes (re-export), porque eram a API dele e há teste que os usa: a
 *  assinatura pública não mudou.
 *
 *  Nada de terceiros: `qrcode` já era dependência do projeto (usado no certificado).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import QRCode from 'qrcode';

/** Dimensões do QR (do próprio gerador) — usadas para reservar espaço no layout. */
export function buildQrMatrix(text: string): { size: number; data: Uint8Array } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });

  return { size: qr.modules.size, data: qr.modules.data };
}

/** Escapa texto para XML — sem isso, um `&` no nome do evento quebra o SVG. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Escapa texto para o operador `Tj` do PDF. */
export function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Largura aproximada em Helvetica.
 *
 * As larguras reais das 14 fontes padrão estão em tabelas da especificação; usamos
 * uma média ponderada por caractere (maiúsculas e dígitos são mais largos). É
 * aproximação suficiente para CENTRALIZAR texto — e aproximação documentada é
 * melhor que uma tabela de 224 números que ninguém vai conferir.
 */
export function approximateWidth(text: string, fontSize: number): number {
  let units = 0;

  for (const char of text) {
    if (/[A-Z0-9]/.test(char)) units += 0.62;
    else if (/[a-z]/.test(char)) units += 0.52;
    else if (char === ' ') units += 0.28;
    else units += 0.4;
  }

  return units * fontSize;
}

/**
 * Quebra o texto em linhas de até `maxChars` caracteres.
 *
 * Quebra por caractere, não por palavra: os documentos daqui são blocos curtos e
 * centralizados, e quebrar no meio de uma palavra é visualmente melhor do que
 * deixar uma linha enorme sair da moldura. O corte é feito em espaços quando
 * possível.
 */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }

    if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current.length > 0) lines.push(current);

  return lines.length > 0 ? lines : [''];
}

/** Data no formato do PDF (`D:YYYYMMDDHHmmSSZ`), sempre em UTC. */
export function pdfDate(date: Date): string {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);

  return `${iso}Z`;
}

/**
 * Monta o arquivo PDF a partir dos objetos já numerados.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A MONTAGEM É COMPARTILHADA, E O CONTEÚDO NÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `xref` com offsets corretos e `trailer` são exigência do formato — errar isso
 *  produz um arquivo que abre em alguns leitores e não em outros, e é o tipo de
 *  defeito que ninguém encontra olhando a tela. O certificado (uma página) e a
 *  folha de crachás (N páginas) montam o MESMO rodapé, com números de objeto
 *  diferentes; o que cada um desenha na página é problema do renderizador.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM OBJETO PODE SER `Buffer` (FASE 40)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A arte de fundo do certificado entra como imagem JPEG, e os bytes dela são
 *  BINÁRIOS. Passar por string funcionaria em `latin1` — byte vira caractere e volta
 *  igual —, mas dependeria de nunca haver conversão de codificação no meio do
 *  caminho. Com `Buffer`, o fluxo da imagem atravessa a montagem sem interpretação
 *  nenhuma, e o offset da `xref` é medido em bytes de verdade.
 */
export function assemblePdf(objects: readonly (string | Buffer)[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let cursor = parts[0]?.length ?? 0;

  objects.forEach((body, index) => {
    const header = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    const content = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');

    offsets.push(cursor);
    parts.push(header, content, tail);
    cursor += header.length + content.length + tail.length;
  });

  const xrefOffset = cursor;
  const total = objects.length + 1;

  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  xref += `trailer\n<< /Size ${total} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(parts);
}

/**
 * Fontes dos documentos que JÁ EXISTIAM (certificado de desenho fixo e folha de
 * crachás).
 *
 * Elas continuam sendo duas, e não cinco, de propósito: acrescentar objetos de fonte
 * sem uso mudaria os bytes dos documentos que a plataforma já emite, sem mudar nada
 * do que se vê. Documento emitido é documento — o desenho antigo continua sendo o
 * desenho antigo, byte a byte.
 */
export const PDF_TEXT_FONT_OBJECTS = [
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
] as const;

/**
 * Todas as fontes padrão oferecidas ao editor visual (FASE 40).
 *
 * A ORDEM é contrato: os renderizadores referenciam as fontes por número de objeto
 * (`/F1 5 0 R`), e as três últimas são as que o organizador escolhe entre serifa e
 * monoespaçada. Continuam sendo as 14 fontes base do PDF, que não precisam ser
 * embutidas — uma fonte da instituição (`.ttf`) mudaria o hash do documento e não é
 * oferecida.
 */
export const PDF_FONT_OBJECTS = [
  ...PDF_TEXT_FONT_OBJECTS,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
] as const;

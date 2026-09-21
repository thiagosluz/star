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
 */
export function assemblePdf(objects: readonly string[]): Buffer {
  const header = '%PDF-1.4\n';
  let pdf = header;
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  const total = objects.length + 1;

  pdf += `xref\n0 ${total}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${total} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/** Objetos de fonte reutilizados pelos dois documentos (Helvetica e negrito). */
export const PDF_FONT_OBJECTS = [
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
] as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Renderização do certificado — SVG e PDF
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PDF É ESCRITO À MÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um certificado é um documento com valor probatório. Duas propriedades
 *  importam mais que conveniência:
 *
 *    1. DETERMINISMO — o mesmo conteúdo precisa produzir bytes idênticos. Com uma
 *       biblioteca de PDF, isso depende de metadados internos (IDs, datas,
 *       versões) que mudam entre versões da lib e entre execuções.
 *    2. RASTREABILIDADE — o arquivo é gerado por ~200 linhas legíveis, sem
 *       dependência de terceiros cujo comportamento precise ser auditado.
 *
 *  Usamos as 14 fontes padrão do PDF (Helvetica), que NÃO precisam ser embutidas:
 *  com uma fonte embutida, o arquivo carregaria um binário de fonte e o hash
 *  passaria a depender dele.
 *
 *  O QR Code é desenhado como VETOR (retângulos) nos dois formatos. Embutir uma
 *  imagem exigiria um XObject com os bits da imagem — mais complexo, maior e sem
 *  ganho: o QR é preto e branco por definição.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  approximateWidth,
  assemblePdf,
  buildQrMatrix,
  escapePdfText,
  escapeXml,
  PDF_FONT_OBJECTS,
  pdfDate,
  wrapText,
} from '@/lib/documents/pdf-text';

export interface CertificateDocument {
  /** Título do documento (ex.: "Certificado de conclusão de minicurso"). */
  title: string;
  recipientName: string;
  bodyText: string;
  eventTitle: string;
  tenantName: string;
  period: string | null;
  workloadLabel: string;
  validationCode: string;
  validationUrl: string;
  contentHash: string;
  signature: string;
  keyId: string;
  signatureAlg: string;
  issuedAt: Date;
}

/**
 * As primitivas de documento (QR, escape, quebra de linha, montagem do PDF) vivem
 * em `@/lib/documents/pdf-text` desde a FASE 31 — o crachá precisa das MESMAS
 * regras. Estes nomes continuam sendo reexportados porque eram a API pública deste
 * módulo e há teste que os importa daqui.
 */
export {
  approximateWidth,
  buildQrMatrix,
  escapePdfText,
  escapeXml,
  PDF_FONT_OBJECTS,
  pdfDate,
  wrapText,
} from '@/lib/documents/pdf-text';

// ───────────────────────────────────────────────────────────────────────────────
//  SVG
// ───────────────────────────────────────────────────────────────────────────────


/**
 * Gera o certificado em SVG (A4 paisagem: 297 × 210 mm).
 *
 * SVG é o formato "de tela": abre em qualquer navegador, escala sem perder
 * nitidez e serve de base para impressão digital. O PDF é o formato "de arquivo".
 */
export function renderCertificateSvg(document: CertificateDocument): string {
  const width = 1123;
  const height = 794;

  const qr = buildQrMatrix(document.validationUrl);
  const qrSize = 160;
  const moduleSize = qrSize / qr.size;

  const qrRects: string[] = [];
  for (let row = 0; row < qr.size; row += 1) {
    for (let column = 0; column < qr.size; column += 1) {
      if (!qr.data[row * qr.size + column]) continue;
      const x = (width - qrSize - 60 + column * moduleSize).toFixed(2);
      const y = (height - qrSize - 120 + row * moduleSize).toFixed(2);
      qrRects.push(`<rect x="${x}" y="${y}" width="${moduleSize.toFixed(2)}" height="${moduleSize.toFixed(2)}"/>`);
    }
  }

  /**
   * O corpo do texto é QUEBRADO em linhas de tamanho fixo.
   *
   * Sem quebra, um texto longo sai pela borda do certificado — e um documento
   * oficial com texto cortado é pior do que um documento feio.
   */
  const bodyLines = wrapText(document.bodyText, 74);
  const bodySvg = bodyLines
    .map(
      (line, index) =>
        `<text x="${width / 2}" y="${310 + index * 34}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#1f2937">${escapeXml(line)}</text>`,
    )
    .join('\n  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(document.title)}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="#1d4ed8" stroke-width="4"/>
  <rect x="36" y="36" width="${width - 72}" height="${height - 72}" fill="none" stroke="#93c5fd" stroke-width="1"/>

  <text x="${width / 2}" y="140" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" letter-spacing="3" fill="#1d4ed8">${escapeXml(document.tenantName.toUpperCase())}</text>
  <text x="${width / 2}" y="200" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="bold" fill="#111827">${escapeXml(document.title)}</text>
  <text x="${width / 2}" y="260" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" font-style="italic" fill="#374151">${escapeXml(document.recipientName)}</text>

  ${bodySvg}

  <text x="${width / 2}" y="470" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#4b5563">${escapeXml(document.eventTitle)}${document.period ? ` · ${escapeXml(document.period)}` : ''}</text>
  <text x="${width / 2}" y="500" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#4b5563">Carga horária: ${escapeXml(document.workloadLabel)}</text>

  <g transform="translate(60, ${height - 120})">
    <text font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" fill="#111827">Código de validação</text>
    <text y="24" font-family="monospace" font-size="20" fill="#1d4ed8">${escapeXml(document.validationCode)}</text>
    <text y="52" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#6b7280">Valide em ${escapeXml(document.validationUrl)}</text>
    <text y="72" font-family="monospace" font-size="10" fill="#6b7280">SHA-256: ${escapeXml(document.contentHash)}</text>
  </g>

  <g fill="#111827">
  ${qrRects.join('\n  ')}
  </g>

  <text x="${width - 60}" y="${height - 96}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#6b7280">Assinado com ${escapeXml(document.signatureAlg)} · chave ${escapeXml(document.keyId)}</text>
  <text x="${width - 60}" y="${height - 78}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#6b7280">Emitido em ${escapeXml(formatIssuedAt(document.issuedAt))}</text>
  <text x="${width - 60}" y="${height - 60}" text-anchor="end" font-family="monospace" font-size="9" fill="#9ca3af">${escapeXml(document.signature.slice(0, 44))}…</text>
</svg>
`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  PDF
// ───────────────────────────────────────────────────────────────────────────────
/** A4 paisagem em pontos (1 pt = 1/72 in): 842 × 595. */
const PDF_WIDTH = 842;
const PDF_HEIGHT = 595;





/**
 * Gera o certificado em PDF.
 *
 * Estrutura mínima válida: catálogo → páginas → página → conteúdo, com tabela
 * `xref` (exigida por leitores estritos) e `trailer`. Nenhuma data automática:
 * tudo que entra no arquivo vem do conteúdo canônico, para que o mesmo
 * certificado gere sempre os mesmos bytes.
 */
export function renderCertificatePdf(document: CertificateDocument): Buffer {
  const qr = buildQrMatrix(document.validationUrl);
  const qrSize = 120;
  const moduleSize = qrSize / qr.size;
  const qrOriginX = PDF_WIDTH - qrSize - 50;
  const qrOriginY = 60;

  const operations: string[] = [];

  // ── Moldura ────────────────────────────────────────────────────────────────
  operations.push('0.11 0.31 0.85 RG 2 w', `18 18 ${PDF_WIDTH - 36} ${PDF_HEIGHT - 36} re S`);
  operations.push('0.58 0.77 0.99 RG 0.6 w', `26 26 ${PDF_WIDTH - 52} ${PDF_HEIGHT - 52} re S`);

  // ── Textos ─────────────────────────────────────────────────────────────────
  const center = (text: string, y: number, size: number, font: 'F1' | 'F2'): string => {
    const x = (PDF_WIDTH - approximateWidth(text, size)) / 2;
    return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y} Td (${escapePdfText(text)}) Tj ET`;
  };

  operations.push(center(document.tenantName.toUpperCase(), 520, 12, 'F1'));
  operations.push(center(document.title, 478, 22, 'F2'));
  operations.push(center(document.recipientName, 430, 26, 'F1'));

  const bodyLines = wrapText(document.bodyText, 92);
  bodyLines.forEach((line, index) => {
    operations.push(center(line, 386 - index * 20, 13, 'F1'));
  });

  const eventLine = document.period ? `${document.eventTitle} · ${document.period}` : document.eventTitle;
  operations.push(center(eventLine, 264, 11, 'F1'));
  operations.push(center(`Carga horária: ${document.workloadLabel}`, 246, 11, 'F1'));

  // ── Bloco de validação (esquerda) ──────────────────────────────────────────
  operations.push(`BT /F2 10 Tf 50 150 Td (Codigo de validacao) Tj ET`);
  operations.push(`BT /F2 16 Tf 50 130 Td (${escapePdfText(document.validationCode)}) Tj ET`);
  operations.push(
    `BT /F1 8 Tf 50 112 Td (${escapePdfText(`Valide em ${document.validationUrl}`)}) Tj ET`,
  );
  operations.push(`BT /F1 7 Tf 50 98 Td (SHA-256: ${escapePdfText(document.contentHash)}) Tj ET`);
  operations.push(
    `BT /F1 7 Tf 50 84 Td (${escapePdfText(`Assinatura ${document.signatureAlg} · chave ${document.keyId}`)}) Tj ET`,
  );
  operations.push(
    `BT /F1 7 Tf 50 70 Td (${escapePdfText(`Emitido em ${formatIssuedAt(document.issuedAt)}`)} ) Tj ET`,
  );

  // ── QR Code como vetor ─────────────────────────────────────────────────────
  operations.push('0 0 0 rg');
  for (let row = 0; row < qr.size; row += 1) {
    for (let column = 0; column < qr.size; column += 1) {
      if (!qr.data[row * qr.size + column]) continue;
      const x = qrOriginX + column * moduleSize;
      // PDF tem origem no canto INFERIOR esquerdo: a linha 0 do QR é o topo.
      const y = qrOriginY + qrSize - (row + 1) * moduleSize;
      operations.push(
        `${x.toFixed(2)} ${y.toFixed(2)} ${moduleSize.toFixed(2)} ${moduleSize.toFixed(2)} re f`,
      );
    }
  }

  const content = operations.join('\n');
  const contentBuffer = Buffer.from(content, 'latin1');

  const issued = pdfDate(document.issuedAt);

  /**
   * A numeração de objetos é CONTRATO do arquivo: a página referencia as fontes por
   * `5 0 R` e `6 0 R`, e a ordem abaixo mantém isso (e é a mesma de antes da FASE 31,
   * quando a montagem passou a ser compartilhada com o crachá).
   */
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${contentBuffer.length} >>\nstream\n${content}\nendstream`,
    ...PDF_FONT_OBJECTS,
    `<< /Title (${escapePdfText(document.title)}) /Author (${escapePdfText(document.tenantName)}) /Subject (${escapePdfText(document.validationCode)}) /Creator (EventFlow) /Producer (EventFlow) /CreationDate (D:${issued}) /ModDate (D:${issued}) >>`,
  ];

  return assemblePdf(objects);
}

/** Data legível para exibição. */
export function formatIssuedAt(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}



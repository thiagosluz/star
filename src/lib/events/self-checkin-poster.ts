/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RENDERIZAÇÃO DO CARTAZ A4 DE AUTOCREDENCIAMENTO / AUTOCHECK-IN (FASE 113)
 *
 *  Gera a URL pública do ponto (`/t/<slug>/presenca/<token>`), o QR Code em SVG/PNG
 *  e um cartaz vetorial A4 em PDF pronto para impressão pela organização.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import QRCode from 'qrcode';

import {
  PDF_TEXT_FONT_OBJECTS,
  assemblePdf,
  buildQrMatrix,
  escapePdfText,
  pdfDate,
  wrapText,
} from '@/lib/documents/pdf-text';
import { badgeAccentColor } from '@/lib/credentials/badge-renderer';
import { pdfFillOperator } from '@/domain/events/credential-categories';
import { tenantPath } from '@/domain/tenancy/resolution';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { publicBaseUrl } from '@/lib/public-url';
import type { SelfCheckinPresentation } from '@/lib/events/self-checkin-service';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const TEXT_COLOR = '#0f172a';
const MUTED_COLOR = '#6b737f';

export function selfCheckinPath(tenantSlug: string, token: string): string {
  return tenantPath(tenantSlug, `/presenca/${token.trim().toUpperCase()}`);
}

export function selfCheckinUrl(tenantSlug: string, token: string): string {
  return `${publicBaseUrl()}${selfCheckinPath(tenantSlug, token)}`;
}

export async function selfCheckinQrDataUrl(url: string, width = 320): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width,
  });
}

export async function selfCheckinQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 1024,
  });
}

export async function selfCheckinQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 1024,
  });
}

/**
 * Gera cartaz A4 em PDF com QR Code vetorial de alta nitidez para impressão.
 */
export function renderSelfCheckinPosterPdf(
  presentation: SelfCheckinPresentation,
  options: { includePin?: boolean; generatedAt?: Date } = {},
): Buffer {
  const generatedAt = options.generatedAt ?? new Date();
  const url = selfCheckinUrl(presentation.tenantSlug, presentation.token);
  const accent = badgeAccentColor({ primaryColor: presentation.primaryColor });
  const includePin = options.includePin === true;

  const ops: string[] = [];

  // Faixa superior com a cor primária do evento.
  ops.push(pdfFillOperator(accent));
  ops.push(`0 ${(PAGE_HEIGHT - 24).toFixed(2)} ${PAGE_WIDTH.toFixed(2)} 24.00 re f`);

  // Moldura sutil do cartaz.
  ops.push('0.82 0.84 0.88 RG 1 w');
  ops.push('36 36 523 754 re S');

  const centerText = (text: string, y: number, font: 'F1' | 'F2', size: number, color: string) => {
    // Estimativa simples de largura em WinAnsi (~0.52 * size * len) para centralizar na página.
    const approxWidth = text.length * size * 0.5;
    const x = Math.max(54, (PAGE_WIDTH - approxWidth) / 2);
    ops.push(pdfFillOperator(color));
    ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(text)}) Tj ET`);
  };

  let cursorY = PAGE_HEIGHT - 68;

  centerText(presentation.tenantName.toUpperCase(), cursorY, 'F2', 11, MUTED_COLOR);
  cursorY -= 26;

  const eventLines = wrapText(presentation.eventTitle, 44).slice(0, 2);
  for (const line of eventLines) {
    centerText(line, cursorY, 'F2', 18, TEXT_COLOR);
    cursorY -= 24;
  }

  cursorY -= 6;
  const targetBanner = presentation.activityTitle
    ? 'AUTOCHECK-IN DA ATIVIDADE'
    : 'AUTOCREDENCIAMENTO NA PORTARIA';
  centerText(targetBanner, cursorY, 'F2', 12, accent);
  cursorY -= 24;

  if (presentation.activityTitle) {
    const actLines = wrapText(presentation.activityTitle, 46).slice(0, 2);
    for (const line of actLines) {
      centerText(line, cursorY, 'F2', 16, TEXT_COLOR);
      cursorY -= 22;
    }
  }

  const whenLabel = formatZonedDateTime(presentation.startsAt, presentation.timezone);
  const placeParts = [
    presentation.roomName ?? presentation.venueName ?? null,
    whenLabel,
  ].filter(Boolean);
  if (placeParts.length > 0) {
    centerText(placeParts.join(' · '), cursorY, 'F1', 10, MUTED_COLOR);
    cursorY -= 20;
  }

  // QR Code vetorial centralizado (240 × 240 pt).
  const qrSize = 240;
  const qrX = (PAGE_WIDTH - qrSize) / 2;
  const qrY = Math.max(250, cursorY - qrSize - 16);
  const qr = buildQrMatrix(url);
  const mod = qrSize / qr.size;

  ops.push('0.90 0.91 0.94 RG 1 w');
  ops.push(`${(qrX - 14).toFixed(2)} ${(qrY - 14).toFixed(2)} ${(qrSize + 28).toFixed(2)} ${(qrSize + 28).toFixed(2)} re S`);
  ops.push('0 0 0 rg');

  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (!qr.data[row * qr.size + col]) continue;
      const mx = qrX + col * mod;
      const my = qrY + qrSize - (row + 1) * mod;
      ops.push(`${mx.toFixed(2)} ${my.toFixed(2)} ${mod.toFixed(2)} ${mod.toFixed(2)} re f`);
    }
  }

  let infoY = qrY - 40;
  centerText(`Código do ponto: ${presentation.token}`, infoY, 'F2', 13, accent);
  infoY -= 20;
  centerText(url.slice(0, 74), infoY, 'F1', 9, MUTED_COLOR);
  infoY -= 32;

  // Bloco de orientações e travas de segurança.
  const instructions: string[] = [
    '1. Aponte a câmera do celular para o QR Code acima.',
    '2. Entre com sua conta na Koveno para confirmar sua presença.',
  ];
  if (presentation.policy.requireGeo) {
    instructions.push(
      `3. Autorize a localização (GPS): validação ativa até ${presentation.policy.geoRadiusMeters} m do local.`,
    );
  }
  if (presentation.totpEnabled) {
    instructions.push(
      '4. Digite o código dinâmico de 6 dígitos exibido no telão da sala (troca a cada 60 s).',
    );
  } else if (presentation.pinRequired) {
    instructions.push(
      includePin && presentation.pinCode
        ? `4. Informe o código da sala (PIN): ${presentation.pinCode}`
        : '4. Solicite o código da sala (PIN) à equipe ou ao palestrante no local.',
    );
  }

  let textY = infoY;
  for (const line of instructions) {
    const wrapped = wrapText(line, 68);
    for (const part of wrapped) {
      ops.push(pdfFillOperator(TEXT_COLOR));
      ops.push(`BT /F1 11 Tf 64.00 ${textY.toFixed(2)} Td (${escapePdfText(part)}) Tj ET`);
      textY -= 17;
    }
  }

  centerText(
    `Gerado em ${generatedAt.toLocaleDateString('pt-BR')} · Koveno`,
    54,
    'F1',
    8,
    MUTED_COLOR,
  );

  const fontCount = PDF_TEXT_FONT_OBJECTS.length;
  const contentStream = ops.join('\n');
  const contentsObjNum = 3 + fontCount;
  const pageObjNum = contentsObjNum + 1;

  const fontRefs = PDF_TEXT_FONT_OBJECTS.map((_, idx) => `/F${idx + 1} ${3 + idx} 0 R`).join(' ');

  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${pageObjNum} 0 R] /Count 1 >>`,
    ...PDF_TEXT_FONT_OBJECTS,
    `<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>\nstream\n${contentStream}\nendstream`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << ${fontRefs} >> >> /Contents ${contentsObjNum} 0 R >>`,
    `<< /Title (${escapePdfText(`Cartaz QR · ${presentation.activityTitle ?? presentation.eventTitle}`)}) /Producer (Koveno) /CreationDate (D:${pdfDate(generatedAt)}) >>`,
  ];

  return assemblePdf(objects);
}

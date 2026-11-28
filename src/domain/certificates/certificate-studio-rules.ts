/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Estúdio Visual de Certificados (FASE 131)
 *
 *  Regras puras (sem Prisma nem Next) para a experiência estilo Canva:
 *    1. Blocos prontos em 1 clique (`STUDIO_QUICK_BLOCKS`);
 *    2. Paleta curada de cores institucionais (`STUDIO_COLOR_SWATCHES`);
 *    3. Encaixe magnético ao centro da folha (`snapElementPosition`) e ações
 *       rápidas de alinhamento (`alignElementOnPage`);
 *    4. Resolução WYSIWYG do texto no palco (`resolveStageElementPreviewText`);
 *    5. Pilha imutável de Desfazer/Refazer (`pushHistory`, `undoHistory`, `redoHistory`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  resolveBodyTemplate,
  sampleVariableValues,
  type CertificateElementKind,
  type CertificatePageFormat,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';

export interface StudioElementLike {
  id: string;
  kind: CertificateElementKind;
  text: string;
  variable: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  align: string;
  font: string;
  sizePt: number;
  color: string;
  lineHeight: number;
}

export type StudioQuickBlockId = 'title' | 'participant' | 'body' | 'signature' | 'qr' | 'code';

export interface StudioQuickBlock {
  readonly id: StudioQuickBlockId;
  readonly label: string;
  readonly description: string;
  readonly build: (page: CertificatePageFormat, index: number) => StudioElementLike;
}

function pageDimsMm(page: CertificatePageFormat): [number, number] {
  return page === 'A4_PORTRAIT' ? [210, 297] : [297, 210];
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

export const STUDIO_QUICK_BLOCKS: readonly StudioQuickBlock[] = [
  {
    id: 'title',
    label: 'Título',
    description: 'Cabeçalho centralizado em destaque',
    build: (page, index) => {
      const [w] = pageDimsMm(page);
      return {
        id: `titulo-${index + 1}`,
        kind: 'TEXT',
        text: 'CERTIFICADO DE PARTICIPAÇÃO',
        variable: '',
        xMm: 20,
        yMm: 28,
        widthMm: w - 40,
        heightMm: 14,
        align: 'CENTER',
        font: 'HELVETICA_BOLD',
        sizePt: 22,
        color: '#0F172A',
        lineHeight: 1.25,
      };
    },
  },
  {
    id: 'participant',
    label: 'Nome do participante',
    description: 'Variável dinâmica do titular',
    build: (page, index) => {
      const [w] = pageDimsMm(page);
      return {
        id: `nome-${index + 1}`,
        kind: 'VARIABLE',
        text: '',
        variable: 'nome',
        xMm: 20,
        yMm: 78,
        widthMm: w - 40,
        heightMm: 14,
        align: 'CENTER',
        font: 'HELVETICA_BOLD',
        sizePt: 20,
        color: '#1E293B',
        lineHeight: 1.25,
      };
    },
  },
  {
    id: 'body',
    label: 'Corpo do certificado',
    description: 'Texto corrido com variáveis {{...}}',
    build: (page, index) => {
      const [w] = pageDimsMm(page);
      return {
        id: `corpo-${index + 1}`,
        kind: 'BODY',
        text: 'Certificamos que {{nome}} participou de {{evento}}, realizado em {{periodo}}, com carga horária total de {{carga_horaria}}.',
        variable: '',
        xMm: 25,
        yMm: 98,
        widthMm: w - 50,
        heightMm: 36,
        align: 'CENTER',
        font: 'HELVETICA',
        sizePt: 13,
        color: '#1E293B',
        lineHeight: 1.45,
      };
    },
  },
  {
    id: 'signature',
    label: 'Assinatura / Rodapé',
    description: 'Linha de coordenação na base',
    build: (page, index) => {
      const [w, h] = pageDimsMm(page);
      return {
        id: `assinatura-${index + 1}`,
        kind: 'TEXT',
        text: 'Coordenação Geral do Evento',
        variable: '',
        xMm: roundMm((w - 110) / 2),
        yMm: h - 38,
        widthMm: 110,
        heightMm: 10,
        align: 'CENTER',
        font: 'HELVETICA',
        sizePt: 11,
        color: '#334155',
        lineHeight: 1.3,
      };
    },
  },
  {
    id: 'qr',
    label: 'QR de validação',
    description: 'Selo escaneável de autenticidade',
    build: (page, index) => {
      const [w, h] = pageDimsMm(page);
      return {
        id: `qr-${index + 1}`,
        kind: 'QR',
        text: '',
        variable: '',
        xMm: w - 42,
        yMm: h - 42,
        widthMm: 26,
        heightMm: 26,
        align: 'CENTER',
        font: 'HELVETICA',
        sizePt: 10,
        color: '#0F172A',
        lineHeight: 1.2,
      };
    },
  },
  {
    id: 'code',
    label: 'Código de validação',
    description: 'Código alfanumérico de conferência',
    build: (page, index) => {
      const [w, h] = pageDimsMm(page);
      return {
        id: `codigo-${index + 1}`,
        kind: 'VARIABLE',
        text: '',
        variable: 'codigo',
        xMm: 20,
        yMm: h - 20,
        widthMm: w - 70,
        heightMm: 8,
        align: 'LEFT',
        font: 'COURIER',
        sizePt: 9,
        color: '#475569',
        lineHeight: 1.2,
      };
    },
  },
];

export interface StudioColorSwatch {
  readonly label: string;
  readonly hex: string;
}

export const STUDIO_COLOR_SWATCHES: readonly StudioColorSwatch[] = [
  { label: 'Preto grafite', hex: '#0F172A' },
  { label: 'Ardósia', hex: '#1E293B' },
  { label: 'Cinza editorial', hex: '#475569' },
  { label: 'Índigo', hex: '#4F46E5' },
  { label: 'Azul institucional', hex: '#1D4ED8' },
  { label: 'Verde esmeralda', hex: '#0F766E' },
  { label: 'Bordô acadêmico', hex: '#881337' },
  { label: 'Âmbar escuro', hex: '#92400E' },
];

export const SNAP_TOLERANCE_MM = 3;
export const STUDIO_GRID_STEP_MM = 5;
export const STUDIO_ZOOM_LEVELS = [75, 100, 125] as const;
export type StudioZoomPercent = (typeof STUDIO_ZOOM_LEVELS)[number];
export const STUDIO_BASE_STAGE_WIDTH_PX = 1200;
export const STUDIO_FONT_PREVIEW_SAMPLE = 'Certificado · AaBbCc 123';

export function resolveStageWidthPx(zoom: StudioZoomPercent): number {
  return Math.round((STUDIO_BASE_STAGE_WIDTH_PX * zoom) / 100);
}

export function buildSignatureBlockText(input: {
  name: string;
  role: string;
  institution?: string;
}): string {
  const line = '______________________________';
  const parts = [line, input.name.trim(), input.role.trim()];
  if (input.institution?.trim()) {
    parts.push(input.institution.trim());
  }
  return parts.filter(Boolean).join('\n');
}

function snapToGridMm(value: number, stepMm: number, maxMm: number): number {
  const snapped = Math.round(value / stepMm) * stepMm;
  return roundMm(Math.max(0, Math.min(maxMm, snapped)));
}

export function snapElementPosition(input: {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  page: CertificatePageFormat;
  toleranceMm?: number;
  gridStepMm?: number;
}): { xMm: number; yMm: number; snapCenterX: boolean; snapCenterY: boolean } {
  const [pageW, pageH] = pageDimsMm(input.page);
  const tolerance = input.toleranceMm ?? SNAP_TOLERANCE_MM;
  const centerX = roundMm((pageW - input.widthMm) / 2);
  const centerY = roundMm((pageH - input.heightMm) / 2);

  const snapCenterX = Math.abs(input.xMm - centerX) <= tolerance;
  const snapCenterY = Math.abs(input.yMm - centerY) <= tolerance;
  const grid = input.gridStepMm && input.gridStepMm > 0 ? input.gridStepMm : null;

  const nextX = snapCenterX
    ? centerX
    : grid
      ? snapToGridMm(input.xMm, grid, Math.max(0, pageW - input.widthMm))
      : roundMm(input.xMm);
  const nextY = snapCenterY
    ? centerY
    : grid
      ? snapToGridMm(input.yMm, grid, Math.max(0, pageH - input.heightMm))
      : roundMm(input.yMm);

  return {
    xMm: nextX,
    yMm: nextY,
    snapCenterX,
    snapCenterY,
  };
}

export type StudioPageAlignAction = 'center-x' | 'center-y' | 'full-width';

export function alignElementOnPage(input: {
  element: Pick<StudioElementLike, 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>;
  page: CertificatePageFormat;
  action: StudioPageAlignAction;
  marginMm?: number;
}): { xMm: number; yMm: number; widthMm: number } {
  const [pageW, pageH] = pageDimsMm(input.page);
  const margin = input.marginMm ?? 20;

  if (input.action === 'center-x') {
    return {
      xMm: roundMm(Math.max(0, (pageW - input.element.widthMm) / 2)),
      yMm: input.element.yMm,
      widthMm: input.element.widthMm,
    };
  }

  if (input.action === 'center-y') {
    return {
      xMm: input.element.xMm,
      yMm: roundMm(Math.max(0, (pageH - input.element.heightMm) / 2)),
      widthMm: input.element.widthMm,
    };
  }

  const nextWidth = roundMm(Math.max(20, pageW - margin * 2));
  return {
    xMm: margin,
    yMm: input.element.yMm,
    widthMm: nextWidth,
  };
}

export function resolveStageElementPreviewText(
  element: Pick<StudioElementLike, 'kind' | 'text' | 'variable'>,
  variant: CertificatePreviewVariant,
): string {
  if (element.kind === 'QR') {
    return 'QR';
  }

  const samples = sampleVariableValues(variant);

  if (element.kind === 'VARIABLE') {
    if (!element.variable) return '[escolha uma variável]';
    const value = samples[element.variable as keyof typeof samples];
    return value && value.length > 0 ? value : `[${element.variable} vazio]`;
  }

  if (element.kind === 'BODY') {
    const resolved = resolveBodyTemplate(element.text, samples).trim();
    return resolved.length > 0 ? resolved : 'Digite o corpo do certificado com variáveis {{...}}';
  }

  return element.text.trim().length > 0 ? element.text : 'Texto livre';
}

export interface StudioFontStyle {
  readonly fontFamily: string;
  readonly fontWeight: number;
  readonly fontStyle: 'normal' | 'italic';
}

export function resolveStageFontStyle(font: string): StudioFontStyle {
  switch (font) {
    case 'HELVETICA_BOLD':
      return { fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700, fontStyle: 'normal' };
    case 'HELVETICA_OBLIQUE':
      return { fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 400, fontStyle: 'italic' };
    case 'TIMES':
      return { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400, fontStyle: 'normal' };
    case 'TIMES_BOLD':
      return { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, fontStyle: 'normal' };
    case 'TIMES_ITALIC':
      return { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400, fontStyle: 'italic' };
    case 'COURIER':
      return { fontFamily: '"Courier New", Courier, monospace', fontWeight: 400, fontStyle: 'normal' };
    case 'COURIER_BOLD':
      return { fontFamily: '"Courier New", Courier, monospace', fontWeight: 700, fontStyle: 'normal' };
    default:
      return { fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 400, fontStyle: 'normal' };
  }
}

function linearizeChannel(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

/**
 * Garante contraste mínimo WCAG AA (>= 4.5:1 mesmo sob destaque `bg-primary/10`
 * no papel branco do palco) sem alterar a cor gravada no layout/PDF.
 */
export function ensureStageReadableColor(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return '#111827';

  const raw = match[1]!;
  let r = Number.parseInt(raw.slice(0, 2), 16);
  let g = Number.parseInt(raw.slice(2, 4), 16);
  let b = Number.parseInt(raw.slice(4, 6), 16);

  const MAX_STAGE_LUMINANCE = 0.15;
  if (relativeLuminance(r, g, b) <= MAX_STAGE_LUMINANCE) {
    return hex;
  }

  for (let step = 0; step < 12 && relativeLuminance(r, g, b) > MAX_STAGE_LUMINANCE; step += 1) {
    r = Math.floor(r * 0.85);
    g = Math.floor(g * 0.85);
    b = Math.floor(b * 0.85);
  }

  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Histórico imutável de Desfazer / Refazer
// ───────────────────────────────────────────────────────────────────────────────
export const MAX_STUDIO_HISTORY = 30;

export interface StudioHistory<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export function createStudioHistory<T>(initial: T): StudioHistory<T> {
  return { past: [], present: initial, future: [] };
}

export function pushStudioHistory<T>(history: StudioHistory<T>, next: T): StudioHistory<T> {
  const past = [...history.past, history.present].slice(-MAX_STUDIO_HISTORY);
  return { past, present: next, future: [] };
}

export function undoStudioHistory<T>(history: StudioHistory<T>): StudioHistory<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, MAX_STUDIO_HISTORY),
  };
}

export function redoStudioHistory<T>(history: StudioHistory<T>): StudioHistory<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0]!;
  return {
    past: [...history.past, history.present].slice(-MAX_STUDIO_HISTORY),
    present: next,
    future: history.future.slice(1),
  };
}

import {
  DEFAULT_ELEMENT_COLOR,
  type CertificateElementKind,
  type CertificatePageFormat,
} from '@/domain/certificates/certificate-layout-rules';

/**
 * Id do aviso que ensina os atalhos do palco — referenciado por cada caixa com
 * `aria-describedby` (dívida E55).
 */
export const STAGE_HINT_ID = 'template-stage-keyboard-hint';

export interface EditorElement {
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

export interface EditorModel {
  templateId: string | null;
  name: string;
  eventId: string;
  kind: string;
  page: CertificatePageFormat;
  backgroundHref: string | null;
  backgroundNotice: string | null;
  /** Tamanho da arte gravada, em bytes (0 quando não há). */
  backgroundBytes: number;
  /** Prévia renderizada no servidor ao abrir a página (todos os dados). */
  previewSvg: string | null;
  /** Segunda prévia: pior caso real com variáveis opcionais vazias. */
  previewWorstSvg: string | null;
  elements: EditorElement[];
}

/** Uma caixa vazia para o organizador começar. */
export function emptyElement(index: number): EditorElement {
  return {
    id: `elemento-${index + 1}`,
    kind: 'TEXT',
    text: '',
    variable: '',
    xMm: 30,
    yMm: 30 + index * 8,
    widthMm: 200,
    heightMm: 10,
    align: 'CENTER',
    font: 'HELVETICA',
    sizePt: 12,
    color: DEFAULT_ELEMENT_COLOR,
    lineHeight: 1.4,
  };
}

export function clampMm(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(max, min));
}

export function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Formatação determinística pt-BR no servidor e no cliente (sem hydration mismatch). */
export const COUNT_FORMAT = new Intl.NumberFormat('pt-BR');
export const MM_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

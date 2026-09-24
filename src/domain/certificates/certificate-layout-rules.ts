/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Layout do certificado (arte de fundo e variáveis)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O LAYOUT É DADO, E NÃO CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 39 o desenho do certificado eram coordenadas escritas dentro do
 *  renderizador: para mudar a posição do nome era preciso mudar o código. Cada
 *  instituição tem identidade rígida (logotipo no topo, chancelas no rodapé, texto
 *  formal com número de portaria), e essa identidade não cabe em constante de
 *  programa.
 *
 *  Então o desenho virou DADO — um layout em milímetros — e o renderizador passou a
 *  ser quem obedece. Três consequências:
 *
 *    1. O layout é CONGELADO no certificado (snapshot na emissão). Editar o modelo
 *       depois não pode mexer em documento já emitido — o mesmo congelamento da
 *       rubrica (F39) e do texto (F6).
 *    2. O layout entra no CONTEÚDO CANÔNICO, então ele é a versão 2 do documento.
 *       Um desenho diferente é um documento diferente.
 *    3. A MILÍMETRO é a unidade, não o pixel: o PDF é medido em pontos (1/72 in) e a
 *       tela em pixels, e converter de mm em cada ponta mantém a mesma régua física.
 *       Um certificado impresso "3 mm fora" é um defeito de impressão, não de CSS.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SÓ JPEG — E POR QUE CMYK É RECUSADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PDF do projeto é escrito à mão (ver `renderer.ts`): o JPEG entra como está, no
 *  operador `/DCTDecode`, sem recomprimir — o que mantém os bytes do arquivo
 *  idênticos e o documento determinístico. PNG exigiria decodificar e recomprimir.
 *
 *  CMYK e JPEG progressivo são RECUSADOS em vez de "convertidos": o mesmo princípio
 *  da medida de etiqueta que o sistema não entende (armadilha 87, ADR-193) — a
 *  alternativa é um documento oficial com as cores da instituição erradas, que
 *  ninguém percebe olhando a tela e todo mundo percebe na impressão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O BLOCO PROBATÓRIO NÃO É OPCIONAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QR Code, código de validação e endereço de validação podem mudar de lugar, de
 *  corpo e de cor — não podem SUMIR. Eles são o que a página pública `/validar/<cod>`
 *  confere, e um certificado bonito que ninguém consegue validar não é certificado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';

// ───────────────────────────────────────────────────────────────────────────────
//  Formato da página
// ───────────────────────────────────────────────────────────────────────────────
export const MM_PER_INCH = 25.4;
export const POINTS_PER_INCH = 72;

export interface PageFormat {
  widthMm: number;
  heightMm: number;
}

/**
 * Só A4, nas duas orientações, e só porque o mundo do certificado é A4: papel
 * tamanho carta exigiria uma decisão de impressão que a fase não tomou.
 */
export const CERTIFICATE_PAGE_FORMATS: Readonly<Record<'A4_LANDSCAPE' | 'A4_PORTRAIT', PageFormat>> = {
  A4_LANDSCAPE: { widthMm: 297, heightMm: 210 },
  A4_PORTRAIT: { widthMm: 210, heightMm: 297 },
};

export type CertificatePageFormat = keyof typeof CERTIFICATE_PAGE_FORMATS;

export const CERTIFICATE_PAGE_FORMAT_LABELS: Readonly<Record<CertificatePageFormat, string>> = {
  A4_LANDSCAPE: 'A4 paisagem (297 × 210 mm)',
  A4_PORTRAIT: 'A4 retrato (210 × 297 mm)',
};

export const DEFAULT_PAGE_FORMAT: CertificatePageFormat = 'A4_LANDSCAPE';

export function pageFormat(format: CertificatePageFormat): PageFormat {
  return CERTIFICATE_PAGE_FORMATS[format];
}

/**
 * Converte o que veio do formulário/banco em formato de página conhecido.
 *
 * `null` para desconhecido: o chamador escolhe o padrão (A4 paisagem) em vez de
 * aceitar um valor que o desenho não sabe medir.
 */
export function parsePageFormat(value: unknown): CertificatePageFormat | null {
  return typeof value === 'string' && value in CERTIFICATE_PAGE_FORMATS
    ? (value as CertificatePageFormat)
    : null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Elementos
// ───────────────────────────────────────────────────────────────────────────────
export const CERTIFICATE_ELEMENT_KINDS = ['TEXT', 'VARIABLE', 'QR'] as const;
export type CertificateElementKind = (typeof CERTIFICATE_ELEMENT_KINDS)[number];

export const CERTIFICATE_ELEMENT_KIND_LABELS: Readonly<Record<CertificateElementKind, string>> = {
  TEXT: 'Texto fixo',
  VARIABLE: 'Variável',
  QR: 'QR Code de validação',
};

/**
 * As cinco fontes são as padrão do PDF (as 14 base não precisam ser embutidas).
 * Escolher uma fonte da instituição exigiria embutir o binário da fonte NO PDF, e aí
 * o hash do documento passaria a depender dele — decisão adiada de propósito.
 */
export const CERTIFICATE_FONTS = ['HELVETICA', 'HELVETICA_BOLD', 'TIMES', 'TIMES_BOLD', 'COURIER'] as const;
export type CertificateFontKey = (typeof CERTIFICATE_FONTS)[number];

export const CERTIFICATE_FONT_LABELS: Readonly<Record<CertificateFontKey, string>> = {
  HELVETICA: 'Helvetica',
  HELVETICA_BOLD: 'Helvetica negrito',
  TIMES: 'Times (serifa)',
  TIMES_BOLD: 'Times negrito (serifa)',
  COURIER: 'Courier (monoespaçada)',
};

export const CERTIFICATE_ALIGNMENTS = ['LEFT', 'CENTER', 'RIGHT'] as const;
export type CertificateAlignment = (typeof CERTIFICATE_ALIGNMENTS)[number];

export const CERTIFICATE_ALIGNMENT_LABELS: Readonly<Record<CertificateAlignment, string>> = {
  LEFT: 'À esquerda',
  CENTER: 'Centralizado',
  RIGHT: 'À direita',
};

/**
 * Como a arte preenche a página.
 *
 * `COVER` é o padrão e existe por um motivo: ESTICAR uma arte com logotipo deforma o
 * logotipo, e uma instituição prefere perder 2 mm de borda a ver a própria marca
 * achatada. `STRETCH` fica disponível para quem desenhou a arte exatamente no
 * tamanho da página.
 */
export const BACKGROUND_FITS = ['COVER', 'STRETCH'] as const;
export type BackgroundFit = (typeof BACKGROUND_FITS)[number];

export const BACKGROUND_FIT_LABELS: Readonly<Record<BackgroundFit, string>> = {
  COVER: 'Cobrir (corta o excesso, sem deformar)',
  STRETCH: 'Esticar (a arte tem exatamente o tamanho da página)',
};

export interface CertificateBackground {
  /** Objeto no bucket privado. O layout guarda a CHAVE, não a URL assinada. */
  objectKey: string;
  /** SHA-256 dos bytes do arquivo — é o que amarra a arte ao documento assinado. */
  checksum: string;
  widthPx: number;
  heightPx: number;
  /** Orientação EXIF (1–8). Guardada como DADO em vez de recodificar o arquivo. */
  orientation: number;
  /**
   * Componentes de cor do JPEG: 1 (cinza) ou 3 (RGB/YCbCr).
   *
   * Guardado porque o PDF precisa declarar `/DeviceGray` ou `/DeviceRGB` no objeto
   * de imagem, e reler o arquivo na renderização só para descobrir isso atrasaria a
   * emissão. CMYK (4) não chega até aqui — é recusado no upload.
   */
  colorComponents: number;
  sizeBytes: number;
  fit: BackgroundFit;
}

export interface CertificateLayoutElement {
  id: string;
  kind: CertificateElementKind;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  align: CertificateAlignment;
  font: CertificateFontKey;
  sizePt: number;
  /** `#rrggbb`. */
  color: string;
  /** Multiplicador da entrelinha. */
  lineHeight: number;
  /** Conteúdo do elemento `TEXT`. */
  text: string | null;
  /** Chave da variável no elemento `VARIABLE`. */
  variable: CertificateVariableKey | null;
}

export interface CertificateLayout {
  page: CertificatePageFormat;
  background: CertificateBackground | null;
  elements: CertificateLayoutElement[];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Limites
// ───────────────────────────────────────────────────────────────────────────────
export const MAX_LAYOUT_ELEMENTS = 24;
export const MAX_ELEMENT_TEXT = 600;
export const MIN_FONT_PT = 6;
export const MAX_FONT_PT = 72;
export const MIN_ELEMENT_SIDE_MM = 3;
export const MIN_TEXT_WIDTH_MM = 12;
export const MIN_LINE_HEIGHT = 1;
export const MAX_LINE_HEIGHT = 3;
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
export const MIN_BACKGROUND_DPI = 150;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * Cor padrão de um elemento novo.
 *
 * Mora no DOMÍNIO porque é o mesmo valor que `buildLayoutFromRows` aplica quando o
 * formulário manda cor vazia: a tela não pode ter um "cinza padrão" próprio, senão o
 * elemento nasce de uma cor e é gravado em outra. (E o arquivo de tela não pode
 * carregar literal de cor — a trava do sistema de design reprova.)
 */
export const DEFAULT_ELEMENT_COLOR = '#111827';

// ───────────────────────────────────────────────────────────────────────────────
//  Variáveis
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Catálogo FECHADO de variáveis.
 *
 * Fechado de propósito: o editor não oferece campo livre de expressão. Cada
 * variável declara a FONTE (de onde o valor sai) — e uma variável sem fonte é uma
 * armadilha, porque o documento sai formal com um rótulo vazio. É por isso que CPF
 * e "título da apresentação" NÃO estão aqui: o participante não tem campo de
 * documento e o certificado não se liga à submissão (dívida E54).
 *
 * `canBeEmpty` diz o que fazer quando o dado não existe naquele certificado: o
 * ELEMENTO desaparece da página. Não fica o rótulo sozinho, e não reflui os outros
 * elementos (as posições são absolutas) — é a mesma régua do "`null` não é `0`" da
 * FASE 32.
 */
export interface CertificateVariable {
  key: string;
  label: string;
  /** De onde o valor sai, dito em uma frase — é o que a tela mostra ao organizador. */
  source: string;
  /** Pode faltar em um certificado real (atividade de evento, período sem datas). */
  canBeEmpty: boolean;
  sample: string;
}

export const CERTIFICATE_VARIABLES = [
  {
    key: 'nome',
    label: 'Nome do participante',
    source: 'nome gravado no certificado',
    canBeEmpty: false,
    sample: 'Ana Souza',
  },
  {
    key: 'titulo',
    label: 'Título do certificado',
    source: 'tipo do certificado (ex.: Certificado de conclusão de minicurso)',
    canBeEmpty: false,
    sample: 'Certificado de conclusão de minicurso',
  },
  {
    key: 'corpo',
    label: 'Texto formal do certificado',
    source: 'frase montada na emissão, com evento, período e carga horária',
    canBeEmpty: false,
    sample:
      'Certificamos que Ana Souza participou pela conclusão do minicurso "Rust para iniciantes", realizado em 12/03/2026, com carga horária de 4 horas.',
  },
  {
    key: 'evento',
    label: 'Nome do evento',
    source: 'título do evento',
    canBeEmpty: false,
    sample: 'Congresso de Tecnologia 2026',
  },
  {
    key: 'atividade',
    label: 'Nome da atividade',
    source: 'título da atividade (vazio no certificado do evento inteiro)',
    canBeEmpty: true,
    sample: 'Rust para iniciantes',
  },
  {
    key: 'carga_horaria',
    label: 'Carga horária',
    source: 'minutos apurados, formatados (ex.: 4 horas)',
    canBeEmpty: false,
    sample: '4 horas',
  },
  {
    key: 'periodo',
    label: 'Período do evento',
    source: 'datas do evento no fuso da instituição (vazio sem datas)',
    canBeEmpty: true,
    sample: '12 a 14 de março de 2026',
  },
  {
    key: 'data_emissao',
    label: 'Data de emissão',
    source: 'instante da emissão, no fuso da instituição',
    canBeEmpty: false,
    sample: '20/03/2026',
  },
  {
    key: 'instituicao',
    label: 'Nome da instituição',
    source: 'nome da instituição',
    canBeEmpty: false,
    sample: 'Universidade Federal da Bahia',
  },
  {
    key: 'codigo_validacao',
    label: 'Código de validação',
    source: 'código público do certificado',
    canBeEmpty: false,
    sample: 'CERT-7KQ4M2XP',
  },
  {
    key: 'url_validacao',
    label: 'Endereço de validação',
    source: 'endereço público que valida o código',
    canBeEmpty: false,
    sample: 'https://eventflow.test/validar/CERT-7KQ4M2XP',
  },
  {
    key: 'hash',
    label: 'Impressão do conteúdo (SHA-256)',
    source: 'hash do conteúdo assinado — linha de auditoria',
    canBeEmpty: false,
    sample: '3f9a…',
  },
  {
    key: 'assinatura',
    label: 'Assinatura digital',
    source: 'assinatura destacada do conteúdo',
    canBeEmpty: true,
    sample: 'MIIBIjANBgkq…',
  },
  {
    key: 'chave',
    label: 'Chave de assinatura',
    source: 'identificador da chave usada',
    canBeEmpty: true,
    sample: 'cert-2026-01',
  },
] as const satisfies readonly CertificateVariable[];

export type CertificateVariableKey = (typeof CERTIFICATE_VARIABLES)[number]['key'];

export const CERTIFICATE_VARIABLE_KEYS: readonly string[] = CERTIFICATE_VARIABLES.map((item) => item.key);

/**
 * O bloco probatório. Sem ele o layout é recusado, em qualquer etapa.
 *
 * `qr` não é variável de texto (é o ELEMENTO `QR`), então a checagem é sobre a
 * presença de um elemento de cada tipo.
 */
export const REQUIRED_VARIABLE_KEYS: readonly CertificateVariableKey[] = ['codigo_validacao', 'url_validacao'];

export function isCertificateVariableKey(value: string): value is CertificateVariableKey {
  return CERTIFICATE_VARIABLE_KEYS.includes(value);
}

/**
 * Valores de exemplo, tirados do PRÓPRIO catálogo.
 *
 * É o que a prévia do editor mostra: um certificado com o nome e a carga horária de
 * mentira, mas com a geometria de verdade. Escrever os exemplos na tela criaria uma
 * segunda lista de variáveis — e a que ficasse para trás apareceria na prévia sem
 * existir no documento.
 */
export function sampleVariableValues(): CertificateVariableValues {
  const values: Record<string, string> = {};

  for (const variable of CERTIFICATE_VARIABLES) {
    values[variable.key] = variable.sample;
  }

  return values as CertificateVariableValues;
}

/**
 * As variáveis que são CONTEÚDO do documento — as que entram no hash.
 *
 * Elas precisam ser CONGELADAS na emissão, e não lidas de novo na renderização: o
 * nome do evento, o nome da instituição e o título da atividade vivem em outras
 * tabelas, e uma edição posterior faria o MESMO documento (mesmo hash) sair impresso
 * diferente. Congelar é o que faz o hash valer alguma coisa.
 */
export const CONTENT_VARIABLE_KEYS: readonly CertificateVariableKey[] = [
  'nome',
  'titulo',
  'corpo',
  'evento',
  'atividade',
  'carga_horaria',
  'periodo',
  'data_emissao',
  'instituicao',
  'codigo_validacao',
  'url_validacao',
] as const;

/**
 * As variáveis de AUDITORIA saem do próprio documento (hash, assinatura e chave),
 * então NÃO entram no conteúdo assinado: o hash não pode depender de si mesmo. Elas
 * continuam verificáveis — quem alterar o que está impresso nelas faz a validação
 * pública reprovar, porque o hash e a assinatura são conferidos contra o conteúdo.
 */
export const AUDIT_VARIABLE_KEYS: readonly CertificateVariableKey[] = ['hash', 'assinatura', 'chave'] as const;

export type CertificateContentValues = Readonly<Record<string, string>>;

/**
 * Só as chaves de conteúdo, na ordem do catálogo.
 *
 * Aceita um mapa PARCIAL de propósito: na emissão o mapa tem as 14 variáveis, e na
 * renderização tem só as 11 de conteúdo que foram congeladas. Chave ausente vira
 * string vazia — o que mantém a serialização estável nos dois caminhos.
 */
export function contentValuesFrom(
  values: Readonly<Record<string, string | undefined>>,
): CertificateContentValues {
  const content: Record<string, string> = {};

  for (const key of CONTENT_VARIABLE_KEYS) {
    content[key] = (values[key] ?? '').trim();
  }

  return content as CertificateContentValues;
}

/**
 * Serialização canônica do conteúdo congelado.
 *
 * Ordem do CATÁLOGO, chaves ausentes como string vazia (e não omitidas): o payload
 * de um certificado de evento, sem atividade, precisa serializar igual ao de outro
 * sem atividade — e diferente do de um com atividade.
 */
export function serializeContentValues(values: CertificateContentValues): string {
  const ordered: Record<string, string> = {};

  for (const key of CONTENT_VARIABLE_KEYS) {
    ordered[key] = (values[key] ?? '').trim();
  }

  return JSON.stringify(ordered);
}

/** Data de emissão no fuso da instituição — a tela nunca formata no fuso do processo. */
export function formatIssuedAtLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** Valores disponíveis na renderização — todos strings já formatadas. */
export type CertificateVariableValues = Readonly<Record<CertificateVariableKey, string>>;

/**
 * Resolve as variáveis a partir do documento.
 *
 * Pura, e é ela que o renderizador e a PRÉVIA usam: uma segunda implementação na tela
 * faria a prévia mostrar outra coisa que não o certificado.
 */
export function resolveCertificateVariables(document: {
  recipientName: string;
  title: string;
  bodyText: string;
  eventTitle: string;
  activityTitle: string;
  workloadLabel: string;
  period: string;
  issuedAtLabel: string;
  tenantName: string;
  validationCode: string;
  validationUrl: string;
  contentHash: string;
  signature: string;
  keyId: string;
}): CertificateVariableValues {
  return {
    nome: document.recipientName,
    titulo: document.title,
    corpo: document.bodyText,
    evento: document.eventTitle,
    atividade: document.activityTitle,
    carga_horaria: document.workloadLabel,
    periodo: document.period,
    data_emissao: document.issuedAtLabel,
    instituicao: document.tenantName,
    codigo_validacao: document.validationCode,
    url_validacao: document.validationUrl,
    hash: document.contentHash,
    assinatura: document.signature,
    chave: document.keyId,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação
// ───────────────────────────────────────────────────────────────────────────────
export type LayoutErrorCode =
  | 'NO_ELEMENTS'
  | 'TOO_MANY_ELEMENTS'
  | 'DUPLICATE_ELEMENT_ID'
  | 'INVALID_BOX'
  | 'OUT_OF_PAGE'
  | 'INVALID_FONT_SIZE'
  | 'INVALID_COLOR'
  | 'INVALID_LINE_HEIGHT'
  | 'UNKNOWN_VARIABLE'
  | 'MISSING_TEXT'
  | 'TEXT_TOO_LONG'
  | 'MISSING_VALIDATION_BLOCK'
  | 'INVALID_BACKGROUND'
  | 'NOT_JPEG'
  | 'JPEG_CMYK'
  | 'JPEG_PROGRESSIVE'
  | 'BACKGROUND_TOO_LARGE'
  | 'BACKGROUND_TOO_SMALL'
  | 'BACKGROUND_TRUNCATED';

export interface LayoutIssue {
  code: LayoutErrorCode;
  message: string;
}

export type LayoutValidation = { ok: true } | { ok: false; issues: readonly LayoutIssue[] };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Um número utilizável em geometria (finito e não negativo). */
function isUsableNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Valida o fundo como DADO já aceito (checksum e medidas coerentes).
 *
 * A aceitação do ARQUIVO é outro caminho (`validateCertificateBackground`), porque
 * ela depende dos bytes — este aqui valida o que foi gravado, que é o que a emissão
 * vai reencontrar.
 */
export function validateBackgroundData(background: CertificateBackground): LayoutIssue[] {
  const issues: LayoutIssue[] = [];

  if (!background.objectKey.trim()) {
    issues.push({ code: 'INVALID_BACKGROUND', message: 'A arte de fundo não tem objeto gravado.' });
  }

  if (!/^[0-9a-f]{64}$/i.test(background.checksum)) {
    issues.push({ code: 'INVALID_BACKGROUND', message: 'A arte de fundo não tem impressão (SHA-256) válida.' });
  }

  if (
    !Number.isInteger(background.widthPx) ||
    !Number.isInteger(background.heightPx) ||
    background.widthPx <= 0 ||
    background.heightPx <= 0
  ) {
    issues.push({ code: 'INVALID_BACKGROUND', message: 'A arte de fundo não tem medidas conhecidas.' });
  }

  if (!Number.isInteger(background.orientation) || background.orientation < 1 || background.orientation > 8) {
    issues.push({ code: 'INVALID_BACKGROUND', message: 'A orientação da arte de fundo é inválida.' });
  }

  if (background.colorComponents !== 1 && background.colorComponents !== 3) {
    issues.push({ code: 'INVALID_BACKGROUND', message: 'A arte de fundo não está em tons de cinza nem em RGB.' });
  }

  if (!isUsableNumber(background.sizeBytes) || background.sizeBytes <= 0) {
    issues.push({ code: 'INVALID_BACKGROUND', message: 'A arte de fundo não tem tamanho conhecido.' });
  }

  return issues;
}

export interface LayoutLimits {
  /** Medida da página em mm — vem do formato, e é o que prende o elemento dentro dela. */
  widthMm: number;
  heightMm: number;
}

/**
 * Valida o layout inteiro.
 *
 * A ordem das checagens é a mesma do resto do projeto: forma do dado → limites →
 * regra de produto (o bloco probatório). Assim a primeira mensagem já é a que
 * resolve o problema de quem está editando.
 */
export function validateLayout(layout: CertificateLayout): LayoutValidation {
  const issues: LayoutIssue[] = [];
  const { widthMm, heightMm } = pageFormat(layout.page);

  if (layout.elements.length === 0) {
    issues.push({ code: 'NO_ELEMENTS', message: 'O modelo não tem nenhum elemento.' });
  }

  if (layout.elements.length > MAX_LAYOUT_ELEMENTS) {
    issues.push({
      code: 'TOO_MANY_ELEMENTS',
      message: `O modelo tem ${layout.elements.length} elementos; o limite é ${MAX_LAYOUT_ELEMENTS}.`,
    });
  }

  const seenIds = new Set<string>();
  const seenVariables = new Set<string>();
  let hasQr = false;

  for (const [index, element] of layout.elements.entries()) {
    const position = index + 1;

    if (seenIds.has(element.id)) {
      issues.push({
        code: 'DUPLICATE_ELEMENT_ID',
        message: `O elemento ${position} repete o identificador "${element.id}".`,
      });
    }
    seenIds.add(element.id);

    if (
      !isUsableNumber(element.xMm) ||
      !isUsableNumber(element.yMm) ||
      !isUsableNumber(element.widthMm) ||
      !isUsableNumber(element.heightMm)
    ) {
      issues.push({ code: 'INVALID_BOX', message: `O elemento ${position} tem posição ou tamanho inválido.` });
      continue;
    }

    const minWidth = element.kind === 'QR' ? MIN_ELEMENT_SIDE_MM : MIN_TEXT_WIDTH_MM;

    if (element.widthMm < minWidth || element.heightMm < MIN_ELEMENT_SIDE_MM) {
      issues.push({
        code: 'INVALID_BOX',
        message: `O elemento ${position} é pequeno demais (mínimo ${minWidth} × ${MIN_ELEMENT_SIDE_MM} mm).`,
      });
      continue;
    }

    /**
     * Fundo e direita arredondados: um elemento de 296,995 mm de largura em uma
     * página de 297 mm é "dentro", e recusá-lo por causa de meio milésimo de
     * milímetro seria um defeito de arredondamento, não de desenho.
     */
    const right = round2(element.xMm + element.widthMm);
    const bottom = round2(element.yMm + element.heightMm);

    if (right > widthMm || bottom > heightMm) {
      issues.push({
        code: 'OUT_OF_PAGE',
        message: `O elemento ${position} sai da página (termina em ${right} × ${bottom} mm, e a página tem ${widthMm} × ${heightMm} mm).`,
      });
    }

    if (element.sizePt < MIN_FONT_PT || element.sizePt > MAX_FONT_PT) {
      issues.push({
        code: 'INVALID_FONT_SIZE',
        message: `O corpo do elemento ${position} precisa ficar entre ${MIN_FONT_PT} e ${MAX_FONT_PT} pt.`,
      });
    }

    if (!COLOR_PATTERN.test(element.color)) {
      issues.push({
        code: 'INVALID_COLOR',
        message: `A cor do elemento ${position} precisa estar no formato #rrggbb.`,
      });
    }

    if (element.lineHeight < MIN_LINE_HEIGHT || element.lineHeight > MAX_LINE_HEIGHT) {
      issues.push({
        code: 'INVALID_LINE_HEIGHT',
        message: `A entrelinha do elemento ${position} precisa ficar entre ${MIN_LINE_HEIGHT} e ${MAX_LINE_HEIGHT}.`,
      });
    }

    if (element.kind === 'QR') {
      hasQr = true;
      continue;
    }

    if (element.kind === 'VARIABLE') {
      if (!element.variable || !isCertificateVariableKey(element.variable)) {
        issues.push({ code: 'UNKNOWN_VARIABLE', message: `O elemento ${position} usa uma variável desconhecida.` });
      } else {
        seenVariables.add(element.variable);
      }
      continue;
    }

    if (!element.text || !element.text.trim()) {
      issues.push({ code: 'MISSING_TEXT', message: `O texto fixo do elemento ${position} está vazio.` });
    } else if (element.text.length > MAX_ELEMENT_TEXT) {
      issues.push({
        code: 'TEXT_TOO_LONG',
        message: `O texto do elemento ${position} passa de ${MAX_ELEMENT_TEXT} caracteres.`,
      });
    }
  }

  if (!hasQr) {
    issues.push({
      code: 'MISSING_VALIDATION_BLOCK',
      message: 'O modelo precisa de um elemento de QR Code para o certificado poder ser validado.',
    });
  }

  for (const required of REQUIRED_VARIABLE_KEYS) {
    if (!seenVariables.has(required)) {
      const variable = CERTIFICATE_VARIABLES.find((item) => item.key === required);
      issues.push({
        code: 'MISSING_VALIDATION_BLOCK',
        message: `O modelo precisa mostrar ${variable?.label.toLowerCase() ?? required} para o certificado poder ser validado.`,
      });
    }
  }

  if (layout.background) {
    issues.push(...validateBackgroundData(layout.background));
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Normalização
// ───────────────────────────────────────────────────────────────────────────────
export function normalizeLayout(layout: CertificateLayout): CertificateLayout {
  return {
    page: layout.page,
    background: layout.background
      ? {
          objectKey: layout.background.objectKey,
          checksum: layout.background.checksum.toLowerCase(),
          widthPx: Math.round(layout.background.widthPx),
          heightPx: Math.round(layout.background.heightPx),
          orientation: layout.background.orientation,
          colorComponents: layout.background.colorComponents,
          sizeBytes: Math.round(layout.background.sizeBytes),
          fit: layout.background.fit,
        }
      : null,
    elements: layout.elements.map((element) => ({
      id: element.id.trim(),
      kind: element.kind,
      xMm: round2(element.xMm),
      yMm: round2(element.yMm),
      widthMm: round2(element.widthMm),
      heightMm: round2(element.heightMm),
      align: element.align,
      font: element.font,
      sizePt: round2(element.sizePt),
      color: element.color.toLowerCase(),
      lineHeight: round2(element.lineHeight),
      text: element.text === null ? null : element.text,
      variable: element.variable,
    })),
  };
}

/**
 * Serialização canônica do layout — a base do hash do documento.
 *
 * A ordem das chaves é CONTRATO, como no conteúdo canônico do certificado: mudar a
 * ordem muda o hash de todo certificado emitido com layout. `null` é explícito (e
 * não `undefined`) para que a serialização de um layout lido do banco seja igual à
 * do layout recém-montado.
 */
export function serializeLayout(layout: CertificateLayout): string {
  const normalized = normalizeLayout(layout);

  return JSON.stringify({
    page: normalized.page,
    background: normalized.background
      ? {
          objectKey: normalized.background.objectKey,
          checksum: normalized.background.checksum,
          widthPx: normalized.background.widthPx,
          heightPx: normalized.background.heightPx,
          orientation: normalized.background.orientation,
          colorComponents: normalized.background.colorComponents,
          sizeBytes: normalized.background.sizeBytes,
          fit: normalized.background.fit,
        }
      : null,
    elements: normalized.elements.map((element) => ({
      id: element.id,
      kind: element.kind,
      xMm: element.xMm,
      yMm: element.yMm,
      widthMm: element.widthMm,
      heightMm: element.heightMm,
      align: element.align,
      font: element.font,
      sizePt: element.sizePt,
      color: element.color,
      lineHeight: element.lineHeight,
      text: element.text,
      variable: element.variable,
    })),
  });
}

export function hashLayout(layout: CertificateLayout): string {
  return createHash('sha256').update(serializeLayout(layout), 'utf8').digest('hex');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Montagem a partir das linhas do formulário
// ───────────────────────────────────────────────────────────────────────────────
export interface LayoutRows {
  page: CertificatePageFormat;
  background: CertificateBackground | null;
  ids: readonly string[];
  kinds: readonly string[];
  texts: readonly string[];
  variables: readonly string[];
  xMm: readonly string[];
  yMm: readonly string[];
  widthMm: readonly string[];
  heightMm: readonly string[];
  aligns: readonly string[];
  fonts: readonly string[];
  sizePt: readonly string[];
  colors: readonly string[];
  lineHeights: readonly string[];
}

const DEFAULT_COLOR = DEFAULT_ELEMENT_COLOR;

function numberOrFallback(raw: string | undefined, fallback: number): number {
  const text = (raw ?? '').trim();
  /**
   * Campo vazio é AUSENTE, não zero: `Number('')` devolve `0` (e `0` é finito), então
   * tratar vazio como número colocaria todo elemento sem corpo declarado em 0 pt —
   * um elemento invisível, gravado sem erro nenhum.
   */
  if (!text) return fallback;

  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  const value = (raw ?? '').trim().toUpperCase();
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Monta o layout a partir das linhas postadas pelo formulário.
 *
 * Existe pelo mesmo motivo de `buildRubricFromRows` (FASE 39): o formulário SEM
 * JavaScript manda uma linha vazia a mais, o identificador pode vir vazio e um
 * número pode chegar como texto — e nada disso pode virar um layout inválido
 * gravado no banco. Linha sem conteúdo é DESCARTADA (não é erro: é a linha em
 * branco que o organizador deixou).
 */
export function buildLayoutFromRows(rows: LayoutRows): CertificateLayout {
  const elements: CertificateLayoutElement[] = [];
  const takenIds = new Set<string>();

  rows.kinds.forEach((rawKind, index) => {
    const kind = pick(rawKind, CERTIFICATE_ELEMENT_KINDS, 'TEXT');
    const text = (rows.texts[index] ?? '').trim();
    const variable = (rows.variables[index] ?? '').trim();
    const id = (rows.ids[index] ?? '').trim();

    // QR existe por presença; TEXTO e VARIÁVEL precisam de conteúdo.
    if (kind === 'TEXT' && !text) return;
    if (kind === 'VARIABLE' && !variable) return;

    let finalId = id || `elemento-${index + 1}`;
    if (takenIds.has(finalId)) {
      let suffix = 2;
      while (takenIds.has(`${finalId}-${suffix}`)) suffix += 1;
      finalId = `${finalId}-${suffix}`;
    }
    takenIds.add(finalId);

    elements.push({
      id: finalId,
      kind,
      xMm: numberOrFallback(rows.xMm[index], 20),
      yMm: numberOrFallback(rows.yMm[index], 20),
      widthMm: numberOrFallback(rows.widthMm[index], kind === 'QR' ? 30 : 120),
      heightMm: numberOrFallback(rows.heightMm[index], kind === 'QR' ? 30 : 12),
      align: pick(rows.aligns[index], CERTIFICATE_ALIGNMENTS, 'LEFT'),
      font: pick(rows.fonts[index], CERTIFICATE_FONTS, 'HELVETICA'),
      sizePt: numberOrFallback(rows.sizePt[index], 12),
      color: (rows.colors[index] ?? '').trim() || DEFAULT_COLOR,
      lineHeight: numberOrFallback(rows.lineHeights[index], 1.4),
      text: kind === 'TEXT' ? text : null,
      variable: kind === 'VARIABLE' && isCertificateVariableKey(variable) ? variable : null,
    });
  });

  return normalizeLayout({ page: rows.page, background: rows.background, elements });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Elementos visíveis na renderização
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O que de fato sai na página, com o texto já resolvido.
 *
 * Elemento de variável SEM valor desaparece — não fica o rótulo órfão nem sobra o
 * espaço com aparência de falha. As posições são absolutas, então nada reflui: os
 * outros elementos ficam exatamente onde o organizador os colocou.
 */
export function visibleElements(
  layout: CertificateLayout,
  values: CertificateVariableValues,
): CertificateLayoutElement[] {
  const visible: CertificateLayoutElement[] = [];

  for (const element of layout.elements) {
    if (element.kind === 'TEXT') {
      visible.push(element);
      continue;
    }

    if (element.kind === 'QR') {
      visible.push(element);
      continue;
    }

    const value = element.variable ? values[element.variable] : '';
    if (!value || !value.trim()) continue;

    visible.push(element);
  }

  return visible;
}

/** Texto final de um elemento (já com a variável resolvida). `null` no QR. */
export function elementText(
  element: CertificateLayoutElement,
  values: CertificateVariableValues,
): string | null {
  if (element.kind === 'QR') return null;
  if (element.kind === 'VARIABLE') return element.variable ? values[element.variable] : null;

  return element.text;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura do JPEG (puro, sem dependência)
// ───────────────────────────────────────────────────────────────────────────────
export interface JpegInfo {
  widthPx: number;
  heightPx: number;
  /** Orientação EXIF (1–8); 1 quando o arquivo não traz EXIF. */
  orientation: number;
  /** 1 = tons de cinza, 3 = YCbCr/RGB, 4 = CMYK/YCCK. */
  components: number;
  progressive: boolean;
}

export type JpegReadResult =
  | { ok: true; info: JpegInfo }
  | { ok: false; issue: LayoutIssue };

/**
 * Lê medidas, orientação e formato de um JPEG.
 *
 * POR QUE ESCREVER ISSO À MÃO: as medidas decidem o recorte da arte (`COVER`) e a
 * resolução efetiva na página. Aceitar o que o navegador DECLARA seria confiar em
 * dado do cliente para decidir geometria de documento oficial — e uma arte que o
 * cliente diz ser 3508 × 2480 e é 500 × 350 sairia impressa pixelada.
 *
 * A varredura para no primeiro SOF (é lá que estão as medidas) e no SOS (começo dos
 * dados comprimidos): ler o arquivo inteiro não é preciso.
 */
export function readJpegInfo(bytes: Uint8Array): JpegReadResult {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { ok: false, issue: { code: 'NOT_JPEG', message: 'A arte precisa ser um arquivo JPEG.' } };
  }

  let orientation = 1;
  let offset = 2;

  /** Byte seguro: fora do arquivo o valor é 0, e as checagens abaixo param antes de usar lixo. */
  const byteAt = (index: number): number => bytes[index] ?? 0;

  while (offset + 4 <= bytes.length) {
    if (byteAt(offset) !== 0xff) {
      // Fora de um marcador só existem dados comprimidos, e eles não interessam.
      break;
    }

    const marker = byteAt(offset + 1);
    offset += 2;

    // Marcadores sem conteúdo (RSTn, TEM) não têm comprimento.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda) break; // SOS: daqui para frente são bytes comprimidos

    if (offset + 2 > bytes.length) break;
    const length = (byteAt(offset) << 8) | byteAt(offset + 1);
    if (length < 2) break;
    const segmentEnd = offset + length;
    if (segmentEnd > bytes.length) break;

    if (marker === 0xe1) {
      orientation = readExifOrientation(bytes, offset + 2, segmentEnd) ?? orientation;
    }

    // SOF0 (baseline), SOF1 (estendido), SOF2 (progressivo), SOF9/10/11 (aritmético).
    const isFrameHeader =
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc9 || marker === 0xca || marker === 0xcb;

    if (isFrameHeader) {
      if (offset + 8 > bytes.length) break;

      const heightPx = (byteAt(offset + 3) << 8) | byteAt(offset + 4);
      const widthPx = (byteAt(offset + 5) << 8) | byteAt(offset + 6);
      const components = byteAt(offset + 7);

      if (widthPx <= 0 || heightPx <= 0) break;

      return {
        ok: true,
        info: {
          widthPx,
          heightPx,
          orientation,
          components,
          progressive: marker === 0xc2 || marker === 0xca,
        },
      };
    }

    offset = segmentEnd;
  }

  /**
   * Chegar aqui significa que o SOF não apareceu: arquivo cortado, ou um JPEG que
   * não é JPEG. Recusar é a resposta honesta — seguir sem medidas seria inventar
   * geometria.
   */
  return {
    ok: false,
    issue: { code: 'BACKGROUND_TRUNCATED', message: 'Não foi possível ler as medidas da arte (arquivo incompleto).' },
  };
}

/**
 * Orientação EXIF do segmento APP1.
 *
 * Lida e GUARDADA como dado: recodificar o arquivo para "endireitar" os pixels
 * mudaria os bytes e quebraria o determinismo do documento. O renderizador aplica a
 * rotação na hora de desenhar.
 */
function readExifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  // "Exif\0\0"
  if (start + 6 > end) return null;
  if (!(bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66)) {
    return null;
  }

  const tiff = start + 6;
  if (tiff + 8 > end) return null;

  const littleEndian = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const bigEndian = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifdOffset = view.getUint32(tiff + 4, littleEndian);
  const ifd = tiff + ifdOffset;
  if (ifd + 2 > end) return null;

  const entries = view.getUint16(ifd, littleEndian);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return null;

    const tag = view.getUint16(entry, littleEndian);
    if (tag !== 0x0112) continue;

    const value = view.getUint16(entry + 8, littleEndian);
    return value >= 1 && value <= 8 ? value : null;
  }

  return null;
}

export interface BackgroundValidationOk {
  ok: true;
  info: JpegInfo;
  checksum: string;
  sizeBytes: number;
}

export type BackgroundValidation =
  | BackgroundValidationOk
  | { ok: false; issues: readonly LayoutIssue[] };

/**
 * Aceita (ou recusa) o arquivo de arte.
 *
 * A ordem é a da casa: tamanho → é JPEG → o JPEG que o PDF à mão sabe embutir →
 * resolução mínima para a página. As duas últimas checagens são a razão de a
 * validação receber o FORMATO da página: 150 dpi em A4 paisagem são 1754 × 1240
 * pixels, e uma arte menor que isso sai serrilhada em papel.
 */
export function validateCertificateBackground(input: {
  bytes: Uint8Array;
  page: CertificatePageFormat;
}): BackgroundValidation {
  const issues: LayoutIssue[] = [];
  const sizeBytes = input.bytes.length;

  if (sizeBytes <= 0) {
    return { ok: false, issues: [{ code: 'NOT_JPEG', message: 'O arquivo está vazio.' }] };
  }

  if (sizeBytes > MAX_BACKGROUND_BYTES) {
    return {
      ok: false,
      issues: [
        {
          code: 'BACKGROUND_TOO_LARGE',
          message: `A arte tem ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB; o limite é ${MAX_BACKGROUND_BYTES / (1024 * 1024)} MB.`,
        },
      ],
    };
  }

  const read = readJpegInfo(input.bytes);
  if (!read.ok) {
    return { ok: false, issues: [read.issue] };
  }

  const info = read.info;

  if (info.components === 4) {
    issues.push({
      code: 'JPEG_CMYK',
      message:
        'A arte está em CMYK. Exporte em RGB (a conversão automática mudaria as cores da instituição sem ninguém perceber).',
    });
  }

  if (info.components !== 1 && info.components !== 3 && info.components !== 4) {
    issues.push({ code: 'NOT_JPEG', message: 'A arte tem um formato de cor que o sistema não entende.' });
  }

  if (info.progressive) {
    issues.push({
      code: 'JPEG_PROGRESSIVE',
      message: 'A arte é um JPEG progressivo. Exporte como JPEG padrão (baseline) para o PDF sair em qualquer leitor.',
    });
  }

  const { widthMm, heightMm } = pageFormat(input.page);
  /**
   * A orientação EXIF troca os lados: um JPEG "deitado" com orientação 6 ou 8 é
   * desenhado girado, e medir a resolução sem considerar isso acusaria arte boa como
   * pequena.
   */
  const swapped = info.orientation >= 5;
  const drawnWidthPx = swapped ? info.heightPx : info.widthPx;
  const drawnHeightPx = swapped ? info.widthPx : info.heightPx;

  const dpiX = drawnWidthPx / (widthMm / MM_PER_INCH);
  const dpiY = drawnHeightPx / (heightMm / MM_PER_INCH);

  if (dpiX < MIN_BACKGROUND_DPI || dpiY < MIN_BACKGROUND_DPI) {
    issues.push({
      code: 'BACKGROUND_TOO_SMALL',
      message: `A arte tem ${Math.round(drawnWidthPx)} × ${Math.round(drawnHeightPx)} pixels; para esta página o mínimo é ${Math.ceil((MIN_BACKGROUND_DPI * widthMm) / MM_PER_INCH)} × ${Math.ceil((MIN_BACKGROUND_DPI * heightMm) / MM_PER_INCH)} (${MIN_BACKGROUND_DPI} dpi).`,
    });
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    info,
    checksum: hashBackground(input.bytes),
    sizeBytes,
  };
}

export function hashBackground(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Aviso de recorte — não é recusa.
 *
 * Arte com proporção diferente da página e ajuste `COVER` perde borda. O sistema
 * avisa e mostra a prévia: quem desenhou a arte sabe melhor que a regra se a perda
 * importa.
 */
export function backgroundFitNotice(background: CertificateBackground, page: CertificatePageFormat): string | null {
  if (background.fit !== 'COVER') return null;

  const swapped = background.orientation >= 5;
  const drawnWidthPx = swapped ? background.heightPx : background.widthPx;
  const drawnHeightPx = swapped ? background.widthPx : background.heightPx;

  const { widthMm, heightMm } = pageFormat(page);
  const artRatio = drawnWidthPx / drawnHeightPx;
  const pageRatio = widthMm / heightMm;

  const difference = Math.abs(artRatio - pageRatio) / pageRatio;
  if (difference <= 0.05) return null;

  return artRatio > pageRatio
    ? 'A arte é mais larga que a página: as laterais serão cortadas para preencher a altura.'
    : 'A arte é mais alta que a página: o topo e o rodapé serão cortados para preencher a largura.';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Modelos prontos
// ───────────────────────────────────────────────────────────────────────────────
export interface CertificateTemplatePreset {
  id: string;
  name: string;
  description: string;
  layout: CertificateLayout;
}

interface ElementSeed {
  id: string;
  kind: CertificateElementKind;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  align?: CertificateAlignment;
  font?: CertificateFontKey;
  /** Obrigatório em texto e variável; o QR não usa corpo. */
  sizePt?: number;
  color?: string;
  lineHeight?: number;
  text?: string;
  variable?: CertificateVariableKey;
}

function seed(partial: ElementSeed): CertificateLayoutElement {
  return {
    id: partial.id,
    kind: partial.kind,
    xMm: partial.xMm,
    yMm: partial.yMm,
    widthMm: partial.widthMm,
    heightMm: partial.heightMm,
    align: partial.align ?? 'CENTER',
    font: partial.font ?? 'HELVETICA',
    sizePt: partial.sizePt ?? 12,
    color: partial.color ?? '#111827',
    lineHeight: partial.lineHeight ?? 1.4,
    text: partial.text ?? null,
    variable: partial.variable ?? null,
  };
}

/**
 * Bloco probatório comum a todos os modelos.
 *
 * Ele fica no RODAPÉ porque é onde a instituição costuma reservar espaço para
 * chancelas — e porque uma linha de auditoria no meio do texto formal atrapalha a
 * leitura do documento.
 */
const VALIDATION_BLOCK: ElementSeed[] = [
  { id: 'codigo', kind: 'VARIABLE', variable: 'codigo_validacao', xMm: 24, yMm: 172, widthMm: 70, heightMm: 8, align: 'LEFT', font: 'HELVETICA_BOLD', sizePt: 11, color: '#1d4ed8' },
  { id: 'url', kind: 'VARIABLE', variable: 'url_validacao', xMm: 24, yMm: 180, widthMm: 90, heightMm: 6, align: 'LEFT', sizePt: 8, color: '#4b5563' },
  { id: 'qr', kind: 'QR', xMm: 240, yMm: 158, widthMm: 34, heightMm: 34 },
  { id: 'auditoria', kind: 'VARIABLE', variable: 'hash', xMm: 24, yMm: 190, widthMm: 250, heightMm: 5, align: 'LEFT', font: 'COURIER', sizePt: 6, color: '#9ca3af' },
];

function withValidationBlock(seeds: ElementSeed[]): CertificateLayoutElement[] {
  return [...seeds, ...VALIDATION_BLOCK].map(seed);
}

/**
 * Cinco pontos de partida. Nenhum deles traz arte: a arte é da instituição, e um
 * modelo pronto com desenho de exemplo seria substituído no primeiro uso.
 *
 * Todos deixam o TOPO (até 40 mm) e o RODAPÉ (abaixo de 165 mm, fora do bloco
 * probatório) livres para o logotipo e as chancelas da arte.
 */
export const CERTIFICATE_TEMPLATE_PRESETS: readonly CertificateTemplatePreset[] = [
  {
    id: 'classico-institucional',
    name: 'Clássico institucional',
    description:
      'Tudo centralizado, com faixa livre no topo para o logotipo e no rodapé para as chancelas. Nome em serifa grande.',
    layout: {
      page: DEFAULT_PAGE_FORMAT,
      background: null,
      elements: withValidationBlock([
        { id: 'titulo', kind: 'VARIABLE', variable: 'titulo', xMm: 24, yMm: 44, widthMm: 249, heightMm: 12, sizePt: 22, font: 'HELVETICA_BOLD', color: '#1d4ed8' },
        { id: 'nome', kind: 'VARIABLE', variable: 'nome', xMm: 24, yMm: 64, widthMm: 249, heightMm: 16, font: 'TIMES_BOLD', sizePt: 30 },
        { id: 'corpo', kind: 'VARIABLE', variable: 'corpo', xMm: 34, yMm: 92, widthMm: 229, heightMm: 40, sizePt: 13, lineHeight: 1.6, color: '#374151' },
        { id: 'evento', kind: 'VARIABLE', variable: 'evento', xMm: 24, yMm: 136, widthMm: 249, heightMm: 8, sizePt: 12, font: 'HELVETICA_BOLD' },
        { id: 'periodo', kind: 'VARIABLE', variable: 'periodo', xMm: 24, yMm: 146, widthMm: 249, heightMm: 7, sizePt: 11, color: '#4b5563' },
        { id: 'carga', kind: 'VARIABLE', variable: 'carga_horaria', xMm: 24, yMm: 156, widthMm: 249, heightMm: 7, sizePt: 11, color: '#4b5563' },
      ]),
    },
  },
  {
    id: 'faixa-lateral',
    name: 'Faixa lateral',
    description:
      'Bloco de texto à direita, alinhado à esquerda: para artes com faixa colorida ou logotipo vertical na lateral esquerda.',
    layout: {
      page: DEFAULT_PAGE_FORMAT,
      background: null,
      elements: withValidationBlock([
        { id: 'titulo', kind: 'VARIABLE', variable: 'titulo', xMm: 112, yMm: 48, widthMm: 161, heightMm: 14, align: 'LEFT', sizePt: 20, font: 'HELVETICA_BOLD', color: '#0f172a' },
        { id: 'nome', kind: 'VARIABLE', variable: 'nome', xMm: 112, yMm: 70, widthMm: 161, heightMm: 14, align: 'LEFT', font: 'TIMES_BOLD', sizePt: 26 },
        { id: 'corpo', kind: 'VARIABLE', variable: 'corpo', xMm: 112, yMm: 92, widthMm: 161, heightMm: 44, align: 'LEFT', sizePt: 12, lineHeight: 1.6, color: '#334155' },
        { id: 'evento', kind: 'VARIABLE', variable: 'evento', xMm: 112, yMm: 142, widthMm: 161, heightMm: 7, align: 'LEFT', sizePt: 11, font: 'HELVETICA_BOLD' },
        { id: 'carga', kind: 'VARIABLE', variable: 'carga_horaria', xMm: 112, yMm: 151, widthMm: 161, heightMm: 7, align: 'LEFT', sizePt: 10, color: '#475569' },
      ]),
    },
  },
  {
    id: 'minimalista',
    name: 'Minimalista',
    description: 'Só o essencial, com muito espaço em branco. Bom para arte de fundo discreta ou papel timbrado.',
    layout: {
      page: DEFAULT_PAGE_FORMAT,
      background: null,
      elements: withValidationBlock([
        { id: 'nome', kind: 'VARIABLE', variable: 'nome', xMm: 30, yMm: 86, widthMm: 237, heightMm: 16, font: 'HELVETICA', sizePt: 28, color: '#0f172a' },
        { id: 'corpo', kind: 'VARIABLE', variable: 'corpo', xMm: 40, yMm: 110, widthMm: 217, heightMm: 34, sizePt: 12, lineHeight: 1.7, color: '#475569' },
        { id: 'evento', kind: 'VARIABLE', variable: 'evento', xMm: 30, yMm: 148, widthMm: 237, heightMm: 7, sizePt: 10, color: '#64748b' },
      ]),
    },
  },
  {
    id: 'diploma',
    name: 'Diploma',
    description: 'Título em serifa com maiúsculas espaçadas e texto formal longo, no estilo de diploma acadêmico.',
    layout: {
      page: DEFAULT_PAGE_FORMAT,
      background: null,
      elements: withValidationBlock([
        { id: 'titulo', kind: 'VARIABLE', variable: 'titulo', xMm: 24, yMm: 50, widthMm: 249, heightMm: 14, font: 'TIMES_BOLD', sizePt: 26, color: '#1c1917' },
        { id: 'nome', kind: 'VARIABLE', variable: 'nome', xMm: 24, yMm: 76, widthMm: 249, heightMm: 16, font: 'TIMES_BOLD', sizePt: 32, color: '#1c1917' },
        { id: 'corpo', kind: 'VARIABLE', variable: 'corpo', xMm: 40, yMm: 102, widthMm: 217, heightMm: 44, font: 'TIMES', sizePt: 13, lineHeight: 1.7, color: '#292524' },
        { id: 'periodo', kind: 'VARIABLE', variable: 'periodo', xMm: 24, yMm: 150, widthMm: 249, heightMm: 7, font: 'TIMES', sizePt: 11, color: '#57534e' },
      ]),
    },
  },
  {
    id: 'formal-com-portaria',
    name: 'Formal com portaria',
    description:
      'Texto formal com a linha de portaria de reconhecimento no rodapé. O número da portaria é texto fixo: o organizador edita.',
    layout: {
      page: DEFAULT_PAGE_FORMAT,
      background: null,
      elements: withValidationBlock([
        { id: 'instituicao', kind: 'VARIABLE', variable: 'instituicao', xMm: 24, yMm: 42, widthMm: 249, heightMm: 7, sizePt: 12, font: 'HELVETICA_BOLD', color: '#1d4ed8' },
        { id: 'titulo', kind: 'VARIABLE', variable: 'titulo', xMm: 24, yMm: 54, widthMm: 249, heightMm: 12, sizePt: 20, font: 'HELVETICA_BOLD' },
        { id: 'nome', kind: 'VARIABLE', variable: 'nome', xMm: 24, yMm: 74, widthMm: 249, heightMm: 15, font: 'TIMES_BOLD', sizePt: 28 },
        { id: 'corpo', kind: 'VARIABLE', variable: 'corpo', xMm: 30, yMm: 96, widthMm: 237, heightMm: 38, sizePt: 12, lineHeight: 1.6, color: '#374151' },
        { id: 'carga', kind: 'VARIABLE', variable: 'carga_horaria', xMm: 24, yMm: 138, widthMm: 249, heightMm: 7, sizePt: 11, color: '#4b5563' },
        { id: 'portaria', kind: 'TEXT', text: 'Reconhecido pela Portaria nº ______/______ — publicada no Diário Oficial.', xMm: 24, yMm: 150, widthMm: 249, heightMm: 6, sizePt: 9, color: '#6b7280' },
      ]),
    },
  },
];

export function findPreset(id: string): CertificateTemplatePreset | null {
  return CERTIFICATE_TEMPLATE_PRESETS.find((preset) => preset.id === id) ?? null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Qual modelo vale para este certificado
// ───────────────────────────────────────────────────────────────────────────────
export interface TemplateCandidate {
  id: string;
  /** Nulo = modelo da instituição (vale para todos os eventos). */
  eventId: string | null;
  /** Nulo = serve a qualquer tipo de certificado. */
  kind: string | null;
}

/**
 * A precedência, do mais específico ao mais genérico:
 *
 *   EVENTO + TIPO  →  EVENTO  →  INSTITUIÇÃO + TIPO  →  INSTITUIÇÃO  →  PADRÃO do código
 *
 * É a mesma forma da precedência da rubrica (CHAMADA → TRILHA → PADRÃO, FASE 33): o
 * alvo mais específico manda, e quem não configurou nada cai no padrão — nunca em
 * "nenhum desenho".
 *
 * Não há desempate aqui, e isso é deliberado: os índices ÚNICOS PARCIAIS da migração
 * garantem no máximo um modelo por combinação. Um desempate por `updatedAt` esconderia
 * a ambiguidade em vez de recusá-la — e o desenho de um documento não pode depender de
 * qual linha voltou primeiro.
 */
export function selectEffectiveTemplate<T extends TemplateCandidate>(
  candidates: readonly T[],
  target: { eventId: string; kind: string },
): T | null {
  const specificity = (candidate: TemplateCandidate): number => {
    const sameEvent = candidate.eventId === target.eventId;
    const sameKind = candidate.kind === target.kind;

    if (sameEvent && sameKind) return 4;
    if (sameEvent && candidate.kind === null) return 3;
    if (candidate.eventId === null && sameKind) return 2;
    if (candidate.eventId === null && candidate.kind === null) return 1;

    return 0;
  };

  let best: T | null = null;
  let bestSpecificity = 0;

  for (const candidate of candidates) {
    const score = specificity(candidate);
    if (score > bestSpecificity) {
      best = candidate;
      bestSpecificity = score;
    }
  }

  return best;
}

/** Layout de partida quando o organizador começa do zero: o primeiro modelo pronto. */
export function defaultLayout(): CertificateLayout {
  const first = CERTIFICATE_TEMPLATE_PRESETS[0];
  /**
   * O catálogo é deste módulo, então a lista vazia é defeito de programação e não
   * caminho de produto — devolver um layout vazio (que a validação recusa) mantém a
   * falha visível em vez de lançar no meio de uma transação.
   */
  if (!first) return { page: DEFAULT_PAGE_FORMAT, background: null, elements: [] };

  return normalizeLayout({
    page: first.layout.page,
    background: null,
    elements: first.layout.elements.map((element) => ({ ...element })),
  });
}

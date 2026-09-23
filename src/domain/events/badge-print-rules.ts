/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Impressão do crachá: folha adesiva e etiqueta térmica (FASE 37)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A GEOMETRIA É DADO, E NÃO CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 31 imprimia uma folha A4 com oito crachás e marcas de corte — serve para
 *  recortar e pronto. Etiqueta adesiva é outra história: **a folha tem medida**, e
 *  imprimir 1 mm fora significa a etiqueta sair torta ou o QR cair na do vizinho. As
 *  medidas variam por modelo, por lote e por impressora, então fixar uma folha no
 *  código garantiria que ele estivesse errado para quase todo mundo.
 *
 *  Aqui a folha é uma **grade configurável** (colunas, linhas, tamanho da etiqueta e
 *  margens, tudo em milímetros) e o padrão é o que a organização escolheu: **63,5 ×
 *  33,9 mm, 3 colunas × 8 linhas em A4** — a grade mais comum de etiqueta adesiva em
 *  folha, centralizada. Quem tem outra folha muda os números na tela; ninguém precisa
 *  de deploy para acertar a impressão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  E O ZPL É TEXTO, NÃO BINÁRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Impressora térmica de crachá fala ZPL II (padrão de fato entre Zebra, Argox, TSC,
 *  Elgin e GoDex — quem usa linguagem própria aceita ZPL no modo de emulação). O
 *  arquivo é **texto puro**: dá para abrir, ler e entender o que vai sair na etiqueta,
 *  o que é exatamente o que falta quando a impressão sai errada no dia do evento.
 *
 *  As duas decisões que a etiqueta térmica impõe: **DPI** (203 ou 300 — a mesma medida
 *  em milímetros vira uma contagem de pontos diferente) e **tamanho do rolo**. O padrão
 *  é 203 dpi e 100 × 50 mm, o crachá de cordão mais comum.
 *
 *  Puro: sem Prisma, sem Next, sem `Buffer` — só aritmética, `TextEncoder` e string.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Unidades
// ───────────────────────────────────────────────────────────────────────────────
/** 1 mm em pontos PostScript/PDF (72 pt = 1 in). */
export const MM_TO_PT = 72 / 25.4;
/** 1 mm em polegadas — o caminho para os pontos da impressora térmica. */
export const MM_TO_IN = 1 / 25.4;

/** A4 retrato em milímetros — a única folha que este módulo conhece. */
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

export function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

/** Milímetros → pontos da impressora, no DPI informado. */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round(mm * MM_TO_IN * dpi);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Folha de etiquetas adesivas
// ───────────────────────────────────────────────────────────────────────────────
export interface LabelSheetLayout {
  columns: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  /** Margem da borda da folha até a PRIMEIRA etiqueta. */
  marginLeftMm: number;
  marginTopMm: number;
  /** Espaço entre etiquetas (0 quando a folha é uma grade contínua). */
  gapXMm: number;
  gapYMm: number;
}

/**
 * O padrão escolhido pelo humano: 3 × 8 etiquetas de 63,5 × 33,9 mm, **centralizadas**
 * em A4 (a sobra de 19,5 mm na largura e 25,8 mm na altura divide-se igualmente).
 *
 * Centralizar é a única margem que dá para afirmar sem conhecer a folha: quem usa uma
 * folha com margem própria ajusta os dois números na tela, e o resultado é conferido na
 * primeira impressão — que é como isso se acerta de verdade, com a régua na mão.
 */
export const DEFAULT_LABEL_LAYOUT: LabelSheetLayout = {
  columns: 3,
  rows: 8,
  labelWidthMm: 63.5,
  labelHeightMm: 33.9,
  marginLeftMm: 9.75,
  marginTopMm: 12.9,
  gapXMm: 0,
  gapYMm: 0,
};

export const LABEL_COLUMNS_MIN = 1;
export const LABEL_COLUMNS_MAX = 5;
export const LABEL_ROWS_MIN = 1;
export const LABEL_ROWS_MAX = 12;
export const LABEL_SIDE_MIN_MM = 10;
export const LABEL_SIDE_MAX_MM = 210;

export function labelsPerPage(layout: LabelSheetLayout): number {
  return layout.columns * layout.rows;
}

export interface LabelPosition {
  /** Canto INFERIOR esquerdo, em pontos de PDF (origem embaixo). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LabelLayoutCheck = { ok: true } | { ok: false; code: 'INVALID' | 'DOES_NOT_FIT'; message: string };

/**
 * A grade cabe na folha?
 *
 * A checagem existe porque a alternativa é a impressão sair com a última coluna fora do
 * papel — e ninguém descobre isso olhando a tela, só depois de gastar uma folha de
 * etiqueta (que não é barata e não se reaproveita).
 */
export function validateLabelLayout(layout: LabelSheetLayout): LabelLayoutCheck {
  const integers = [layout.columns, layout.rows];

  if (integers.some((value) => !Number.isInteger(value))) {
    return { ok: false, code: 'INVALID', message: 'Colunas e linhas precisam ser números inteiros.' };
  }

  if (layout.columns < LABEL_COLUMNS_MIN || layout.columns > LABEL_COLUMNS_MAX) {
    return {
      ok: false,
      code: 'INVALID',
      message: `Colunas: use de ${LABEL_COLUMNS_MIN} a ${LABEL_COLUMNS_MAX}.`,
    };
  }

  if (layout.rows < LABEL_ROWS_MIN || layout.rows > LABEL_ROWS_MAX) {
    return { ok: false, code: 'INVALID', message: `Linhas: use de ${LABEL_ROWS_MIN} a ${LABEL_ROWS_MAX}.` };
  }

  const sides = [layout.labelWidthMm, layout.labelHeightMm];
  if (sides.some((side) => !Number.isFinite(side) || side < LABEL_SIDE_MIN_MM || side > LABEL_SIDE_MAX_MM)) {
    return {
      ok: false,
      code: 'INVALID',
      message: `A etiqueta precisa medir entre ${LABEL_SIDE_MIN_MM} e ${LABEL_SIDE_MAX_MM} mm de cada lado.`,
    };
  }

  const margins = [layout.marginLeftMm, layout.marginTopMm, layout.gapXMm, layout.gapYMm];
  if (margins.some((value) => !Number.isFinite(value) || value < 0)) {
    return { ok: false, code: 'INVALID', message: 'Margens e espaços não podem ser negativos.' };
  }

  const usedWidth =
    layout.marginLeftMm * 2 + layout.columns * layout.labelWidthMm + (layout.columns - 1) * layout.gapXMm;
  const usedHeight =
    layout.marginTopMm * 2 + layout.rows * layout.labelHeightMm + (layout.rows - 1) * layout.gapYMm;

  if (usedWidth > A4_WIDTH_MM + 0.01 || usedHeight > A4_HEIGHT_MM + 0.01) {
    return {
      ok: false,
      code: 'DOES_NOT_FIT',
      message:
        `A grade não cabe em A4 (${A4_WIDTH_MM} × ${A4_HEIGHT_MM} mm): ` +
        `ocuparia ${usedWidth.toFixed(1)} × ${usedHeight.toFixed(1)} mm. ` +
        'Reduza o tamanho da etiqueta, o número de colunas/linhas ou as margens.',
    };
  }

  return { ok: true };
}

/**
 * Onde cada etiqueta cai na página, em pontos de PDF.
 *
 * A ordem é a de LEITURA (da esquerda para a direita, de cima para baixo): o crachá 1 é
 * o primeiro da primeira linha. Se a ordem fosse a de impressão de algum modelo
 * específico, a lista de nomes sairia embaralhada para todo o resto.
 */
export function labelPositions(layout: LabelSheetLayout): LabelPosition[] {
  const positions: LabelPosition[] = [];
  const width = mmToPt(layout.labelWidthMm);
  const height = mmToPt(layout.labelHeightMm);

  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const leftMm = layout.marginLeftMm + column * (layout.labelWidthMm + layout.gapXMm);
      const topMm = layout.marginTopMm + row * (layout.labelHeightMm + layout.gapYMm);

      positions.push({
        x: mmToPt(leftMm),
        // PDF conta de baixo para cima: a linha 0 está no ALTO da folha.
        y: mmToPt(A4_HEIGHT_MM) - mmToPt(topMm) - height,
        width,
        height,
      });
    }
  }

  return positions;
}

/**
 * Lê um número em milímetros aceitando vírgula decimal ("63,5" e "63.5").
 *
 * ─── AUSENTE USA O PADRÃO; TEXTO QUE NÃO É NÚMERO É ERRO ──────────────────────
 *  `null` = o parâmetro não veio (ou veio vazio, como o formulário manda quando ninguém
 *  mexe no campo): vale o PADRÃO, senão um link sem `margem-esquerda` imprimiria colado
 *  na borda sem ninguém ter mexido em nada.
 *
 *  Texto que não vira número devolve `null` DE PROPÓSITO, e quem chama recusa: trocar em
 *  silêncio "6 3,5" por 63,5 mm imprimiria a folha inteira na medida errada, e o defeito
 *  só apareceria depois de gastar a folha de etiqueta. O mesmo vale para o DPI — a medida
 *  em milímetros é física e os pontos são fixos, então 100 mm a 203 dpi sai com 67 mm numa
 *  impressora de 300 dpi.
 */
function readNumber(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback;

  const text = raw.trim();
  if (text === '') return fallback;

  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export type LabelLayoutResult =
  | { ok: true; layout: LabelSheetLayout }
  | { ok: false; code: 'INVALID' | 'DOES_NOT_FIT'; message: string };

/** Os campos numéricos da folha, na ordem em que a mensagem de erro os nomeia. */
const LABEL_LAYOUT_FIELDS: readonly [keyof LabelSheetLayout, string, number][] = [
  ['columns', 'colunas', DEFAULT_LABEL_LAYOUT.columns],
  ['rows', 'linhas', DEFAULT_LABEL_LAYOUT.rows],
  ['labelWidthMm', 'largura', DEFAULT_LABEL_LAYOUT.labelWidthMm],
  ['labelHeightMm', 'altura', DEFAULT_LABEL_LAYOUT.labelHeightMm],
  ['marginLeftMm', 'margem-esquerda', DEFAULT_LABEL_LAYOUT.marginLeftMm],
  ['marginTopMm', 'margem-superior', DEFAULT_LABEL_LAYOUT.marginTopMm],
  ['gapXMm', 'espaco-horizontal', DEFAULT_LABEL_LAYOUT.gapXMm],
  ['gapYMm', 'espaco-vertical', DEFAULT_LABEL_LAYOUT.gapYMm],
];

/**
 * A folha pedida pela tela, com o padrão preenchendo o que não veio.
 *
 * Colunas e linhas são arredondadas (o formulário é texto livre): "3,4" colunas não
 * existe, e recusar por isso seria implicar com quem digitou uma casa decimal.
 */
export function labelLayoutFromParams(params: URLSearchParams): LabelLayoutResult {
  const layout: LabelSheetLayout = { ...DEFAULT_LABEL_LAYOUT };

  for (const [field, param, fallback] of LABEL_LAYOUT_FIELDS) {
    const value = readNumber(params.get(param), fallback);

    if (value === null) {
      return {
        ok: false,
        code: 'INVALID',
        message: `A medida "${param}" precisa ser um número em milímetros (ex.: 63,5).`,
      };
    }

    layout[field] = field === 'columns' || field === 'rows' ? Math.round(value) : value;
  }

  const check = validateLabelLayout(layout);

  return check.ok ? { ok: true, layout } : check;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Etiqueta térmica (ZPL II)
// ───────────────────────────────────────────────────────────────────────────────
export const THERMAL_DPI_OPTIONS = [203, 300] as const;
export type ThermalDpi = (typeof THERMAL_DPI_OPTIONS)[number];

export interface ThermalLabelConfig {
  /** 203 dpi (padrão das térmicas de bancada) ou 300 dpi (as de crachá). */
  dpi: ThermalDpi;
  widthMm: number;
  heightMm: number;
  /** Ampliação do QR no ZPL: 1 a 10. */
  qrMagnification: number;
}

export const DEFAULT_THERMAL_CONFIG: ThermalLabelConfig = {
  dpi: 203,
  widthMm: 100,
  heightMm: 50,
  qrMagnification: 3,
};

export const THERMAL_SIDE_MIN_MM = 20;
export const THERMAL_SIDE_MAX_MM = 300;
export const QR_MAGNIFICATION_MIN = 1;
export const QR_MAGNIFICATION_MAX = 10;

export const THERMAL_DPI_LABELS: Record<ThermalDpi, string> = {
  203: '203 dpi (8 pontos/mm)',
  300: '300 dpi (12 pontos/mm)',
};

export type ThermalCheck = { ok: true } | { ok: false; message: string };

export function validateThermalConfig(config: ThermalLabelConfig): ThermalCheck {
  if (!(THERMAL_DPI_OPTIONS as readonly number[]).includes(config.dpi)) {
    return { ok: false, message: `DPI precisa ser ${THERMAL_DPI_OPTIONS.join(' ou ')}.` };
  }

  for (const [name, side] of [
    ['largura', config.widthMm],
    ['altura', config.heightMm],
  ] as const) {
    if (!Number.isFinite(side) || side < THERMAL_SIDE_MIN_MM || side > THERMAL_SIDE_MAX_MM) {
      return {
        ok: false,
        message: `A ${name} da etiqueta precisa ficar entre ${THERMAL_SIDE_MIN_MM} e ${THERMAL_SIDE_MAX_MM} mm.`,
      };
    }
  }

  if (
    !Number.isInteger(config.qrMagnification) ||
    config.qrMagnification < QR_MAGNIFICATION_MIN ||
    config.qrMagnification > QR_MAGNIFICATION_MAX
  ) {
    return {
      ok: false,
      message: `A ampliação do QR vai de ${QR_MAGNIFICATION_MIN} a ${QR_MAGNIFICATION_MAX}.`,
    };
  }

  return { ok: true };
}

/**
 * Texto seguro para um campo ZPL.
 *
 * `^` e `~` são os caracteres de CONTROLE da linguagem: um nome com `^` (ou um acento,
 * que em ZPL depende da página de código) pode virar comando e a etiqueta sai errada — ou
 * o lote inteiro para. Com `^FH` ligado, `_XX` é o escape de byte em hexadecimal, então
 * TUDO o que não é ASCII imprimível simples — e o próprio `_` — vira par hexadecimal.
 * Acentos em UTF-8 (dois bytes) saem como dois pares (`_C3_A9`), e a impressora recebe
 * `^CI28` (UTF-8) no início do rótulo.
 */
export function zplFieldText(value: string): string {
  const bytes = new TextEncoder().encode(value.normalize('NFC'));
  let out = '';

  for (const byte of bytes) {
    const isPlain =
      byte >= 0x20 &&
      byte <= 0x7e &&
      byte !== 0x5f && // "_" é o caractere de escape do próprio ^FH
      byte !== 0x5e && // "^" inicia comando
      byte !== 0x7e; // "~" inicia comando

    out += isPlain ? String.fromCharCode(byte) : `_${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }

  return out;
}

/**
 * Quebra o texto em no máximo `limit` linhas, por LARGURA em pontos da impressora.
 *
 * ─── A ÚLTIMA LINHA LEVA O RESTO ──────────────────────────────────────────────
 *  Quando as linhas permitidas acabam, o que sobra entra INTEIRO na última — mesmo que
 *  ela fique mais larga que o espaço. Cortar palavras seria o silêncio pior: o nome
 *  sairia da etiqueta sem ninguém saber, e o crachá que não diz o nome não serve para a
 *  porta. Uma linha que estoura é VISÍVEL na primeira impressão, e o operador diminui o
 *  corpo ou troca a etiqueta — decisão dele, com o papel na mão.
 */
export function wrapZplText(value: string, availableDots: number, fontHeightDots: number, limit = 2): string[] {
  const perLine = Math.max(6, Math.floor(availableDots / Math.max(1, fontHeightDots * 0.58)));
  const words = value.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const candidate = current.length === 0 ? word : `${current} ${word}`;

    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }

    if (lines.length === limit - 1) {
      lines.push(`${current} ${words.slice(index).join(' ')}`.trim());
      return lines;
    }

    lines.push(current);
    current = word;
  }

  lines.push(current);

  return lines;
}

/**
 * As proporções do nome, da maior para a menor: a primeira que couber o nome INTEIRO vence.
 *
 * O piso (0,09) é ~4,5 mm num rótulo de 50 mm de altura: abaixo disso o nome deixa de ser
 * legível à distância de um braço, que é o uso na porta.
 */
export const ZPL_NAME_HEIGHT_RATIOS = [0.18, 0.15, 0.13, 0.11, 0.09] as const;
export const ZPL_NAME_MAX_LINES = 4;
/** Respiro entre as linhas do nome, em pontos. */
export const ZPL_NAME_LINE_GAP = 4;

/**
 * Escolhe o tamanho do nome e o número de linhas para que o nome INTEIRO caiba.
 *
 * ─── POR QUE NÃO É UM TAMANHO FIXO ────────────────────────────────────────────
 *  "Ana Souza" e "Maria da Conceição Aparecida dos Santos Oliveira Albuquerque" não
 *  cabem no mesmo corpo de letra numa etiqueta de 100 mm: com o corpo grande, o nome
 *  longo sai CORTADO — e o crachá que não diz o nome inteiro não serve para a porta,
 *  que é onde ele é lido.
 *
 * ─── E CABER NÃO É SÓ CABER NA LARGURA ────────────────────────────────────────
 *  Quatro linhas de corpo grande ocupam a etiqueta INTEIRA e empurram o código e a
 *  origem para fora do papel — o ZPL imprime o que não cabe, e o que passa da borda
 *  some. Por isso a proporção só é aceita se o bloco do nome caber também na ALTURA
 *  disponível (`maxBlockDots`), que é a etiqueta menos o código, a origem e os respiros.
 *
 *  O ZPL não quebra linha sozinho: a quebra é feita aqui, por largura em pontos.
 */
export function fitZplName(
  name: string,
  availableDots: number,
  heightDots: number,
  maxBlockDots: number,
): { fontDots: number; lines: string[] } {
  const wanted = name.trim().replace(/\s+/g, ' ');
  const blockOf = (fontDots: number, lines: string[]): number =>
    lines.length * fontDots + (lines.length - 1) * ZPL_NAME_LINE_GAP;

  for (const ratio of ZPL_NAME_HEIGHT_RATIOS) {
    const fontDots = Math.max(14, Math.round(heightDots * ratio));
    const lines = wrapZplText(wanted, availableDots, fontDots, ZPL_NAME_MAX_LINES);

    if (lines.join(' ') !== wanted) continue;
    if (blockOf(fontDots, lines) <= maxBlockDots) return { fontDots, lines };
  }

  const fontDots = Math.max(12, Math.round(heightDots * ZPL_NAME_HEIGHT_RATIOS.at(-1)!));
  return { fontDots, lines: wrapZplText(wanted, availableDots, fontDots, ZPL_NAME_MAX_LINES) };
}

export interface ZplBadge {
  name: string;
  code: string;
  eventTitle: string;
  tenantName: string;
}

/**
 * O rótulo ZPL de UM crachá.
 *
 * A composição repete a do PDF — QR à esquerda, nome grande à direita, código e origem
 * embaixo — porque a etiqueta é lida do MESMO jeito nos dois mundos: a porta olha o
 * nome, o monitor lê o QR e digita o código quando o leitor falha.
 *
 * O ZPL não quebra linha sozinho: o nome é quebrado aqui, em ATÉ DUAS linhas, e o que
 * não couber é cortado — uma etiqueta de 100 mm com o nome em quatro linhas empurraria o
 * código para fora do papel.
 */
export function buildBadgeZpl(badge: ZplBadge, config: ThermalLabelConfig): string {
  const widthDots = mmToDots(config.widthMm, config.dpi);
  const heightDots = mmToDots(config.heightMm, config.dpi);

  const padding = mmToDots(3, config.dpi);
  /**
   * O QR ocupa a ALTURA da etiqueta, com teto de 30 mm: numa etiqueta de 100 × 50 mm ele
   * chegaria a 44 mm e comeria todo o espaço do nome — e um QR de 30 mm já é lido de
   * longe por qualquer leitor de balcão.
   */
  const qrSizeDots = Math.max(
    mmToDots(12, config.dpi),
    Math.min(heightDots - padding * 2, mmToDots(30, config.dpi), Math.round(widthDots * 0.4)),
  );
  const textX = padding + qrSizeDots + mmToDots(3, config.dpi);
  const textWidthDots = Math.max(mmToDots(10, config.dpi), widthDots - textX - padding);

  const codeHeight = Math.max(14, Math.round(heightDots * 0.15));
  const originHeight = Math.max(10, Math.round(heightDots * 0.11));
  /** O que sobra da etiqueta para o NOME, depois do código, da origem e dos respiros. */
  const nameBlockDots = Math.max(
    codeHeight,
    heightDots - padding * 2 - codeHeight - originHeight - (8 + 6),
  );

  const name = fitZplName(badge.name, textWidthDots, heightDots, nameBlockDots);

  const lines: string[] = [
    '^XA',
    /** UTF-8: sem isto, acento em etiqueta sai como dois caracteres estranhos. */
    '^CI28',
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    /** Sem deslocamento: a etiqueta começa no canto que o operador já calibrou. */
    '^LH0,0',
  ];

  lines.push(
    `^FO${padding},${padding}^BQN,2,${config.qrMagnification}^FH^FDLA,${zplFieldText(badge.code)}^FS`,
  );

  let cursor = padding;

  name.lines.forEach((line, index) => {
    lines.push(`^FO${textX},${cursor}^A0N,${name.fontDots},${name.fontDots}^FH^FD${zplFieldText(line)}^FS`);
    cursor += name.fontDots + (index < name.lines.length - 1 ? ZPL_NAME_LINE_GAP : 0);
  });

  cursor += 8;

  lines.push(`^FO${textX},${cursor}^A0N,${codeHeight},${codeHeight}^FH^FD${zplFieldText(badge.code)}^FS`);
  cursor += codeHeight + 6;

  lines.push(
    `^FO${textX},${cursor}^A0N,${originHeight},${originHeight}^FH^FD${zplFieldText(
      `${badge.tenantName} · ${badge.eventTitle}`,
    )}^FS`,
  );

  lines.push('^XZ');

  return `${lines.join('\n')}\n`;
}

/**
 * O arquivo ZPL do lote inteiro: **uma etiqueta por rótulo**, na ordem da lista.
 *
 * Poderia ser um `^XA…^XZ` com cópias (`^CN`), mas etiqueta por etiqueta é o que
 * permite conferir o arquivo antes de imprimir — e o operador que precisa reimprimir
 * UM crachá recorta o bloco dele em vez de refazer o lote.
 */
export function buildBadgeZplBatch(badges: readonly ZplBadge[], config: ThermalLabelConfig): string {
  return badges.map((badge) => buildBadgeZpl(badge, config)).join('');
}

export type ThermalConfigResult =
  | { ok: true; config: ThermalLabelConfig }
  | { ok: false; message: string };

/**
 * Os campos numéricos da etiqueta térmica. O DPI fica de fora porque ele não é uma
 * medida: é uma ESCOLHA de um conjunto fechado, e o tratamento é outro.
 */
/** Os campos de MEDIDA da etiqueta — o que é milímetro, e não escolha de conjunto. */
type ThermalNumberField = 'widthMm' | 'heightMm' | 'qrMagnification';

const THERMAL_NUMBER_FIELDS: readonly [ThermalNumberField, string, number][] = [
  ['widthMm', 'largura', DEFAULT_THERMAL_CONFIG.widthMm],
  ['heightMm', 'altura', DEFAULT_THERMAL_CONFIG.heightMm],
  ['qrMagnification', 'ampliacao-qr', DEFAULT_THERMAL_CONFIG.qrMagnification],
];

/**
 * A etiqueta térmica pedida pela tela, com o padrão preenchendo o que não veio.
 *
 * ─── O DPI ERRADO É RECUSADO, NÃO SUBSTITUÍDO ─────────────────────────────────
 *  A tela oferece 203 e 300 no `select`, então qualquer outro valor chegou por link
 *  editado à mão. Cair para 203 em silêncio seria o pior desfecho possível: `^PW`/`^LL`
 *  são contagens de PONTOS, e a mesma etiqueta de 100 mm impressa a 203 dpi numa
 *  impressora de 300 dpi sai com 67 mm — encolhida, sem erro nenhum, e o operador só
 *  descobre com o rolo na mão. Recusar diz o que aceita.
 */
export function thermalConfigFromParams(params: URLSearchParams): ThermalConfigResult {
  const config = { ...DEFAULT_THERMAL_CONFIG };

  for (const [field, param, fallback] of THERMAL_NUMBER_FIELDS) {
    const value = readNumber(params.get(param), fallback);

    if (value === null) {
      return {
        ok: false,
        message: `A medida "${param}" precisa ser um número em milímetros (ex.: 100).`,
      };
    }

    config[field] = field === 'qrMagnification' ? Math.round(value) : value;
  }

  const dpiRaw = params.get('dpi');
  const dpi = readNumber(dpiRaw, DEFAULT_THERMAL_CONFIG.dpi);

  if (dpi === null || !(THERMAL_DPI_OPTIONS as readonly number[]).includes(dpi)) {
    return {
      ok: false,
      message: `DPI precisa ser ${THERMAL_DPI_OPTIONS.join(' ou ')}${
        dpiRaw !== null && dpiRaw.trim() !== '' ? ` (recebido: ${dpiRaw})` : ''
      }.`,
    };
  }

  const candidate: ThermalLabelConfig = { ...config, dpi: dpi as ThermalDpi };
  const check = validateThermalConfig(candidate);

  return check.ok ? { ok: true, config: candidate } : check;
}

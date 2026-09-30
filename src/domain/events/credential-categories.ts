/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Categoria do crachá: rótulo e cor (FASE 51 · dívida E42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA É A ÚNICA FONTE, E NÃO UMA POR SAÍDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MESMA categoria aparece em QUATRO desenhos diferentes:
 *
 *    1. a folha A4 para recortar (PDF);
 *    2. a etiqueta adesiva (PDF com grade em milímetros);
 *    3. o rolo da impressora térmica (ZPL II);
 *    4. o crachá na tela do participante (`/t/<slug>/meu-cracha`).
 *
 *  Se cada uma escolhesse a própria cor, o crachá impresso na secretaria e o
 *  crachá aberto no celular diriam coisas diferentes sobre a mesma pessoa — e
 *  ninguém descobre isso antes do dia do evento. Por isso o rótulo em português e
 *  o TOKEN de cor vivem aqui, e os quatro desenhos leem daqui.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A COR VEM EM DOIS FORMATOS (token e valor)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela (React) resolve cor por TOKEN — `var(--ef-…))` —, e é assim que o tema
 *  do evento e o modo escuro funcionam sem nenhum `if`. Já o PDF e o ZPL **não
 *  resolvem variável CSS**: operador de PDF precisa de `r g b rg`, e a impressora
 *  térmica precisa de `^FO…^GB…^FS`, ambos com o número escrito.
 *
 *  É exatamente a exceção técnica do e-mail transacional
 *  (`src/domain/communication/email-theme.ts`), e a defesa é a mesma: o valor
 *  literal vive em UM lugar, nomeado pelo token que espelha, e um teste lê o
 *  `globals.css` e falha se os dois divergirem
 *  (`tests/unit/f51-credential-category.test.ts`). A marca continua tendo uma
 *  fonte da verdade; o PDF só não consegue consultá-la em tempo de renderização.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CATEGORIA É ESCOLHIDA, E NÃO DEDUZIDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O papel no RBAC não diz o que a pessoa é no evento: o mesmo `ADMIN` pode ser a
 *  diretoria (VIP) ou o apoio técnico (EQUIPE). Deduzir seria adivinhação com
 *  consequência na porta — e a portaria, que conhece o evento, é quem sabe. Por
 *  isso a coluna `EventCredential.category` é DADO, com `PARTICIPANT` de padrão, e
 *  esta é a régua que diz o que cada valor significa.
 *
 *  Puro: sem Prisma, sem Next, sem `Buffer`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * As categorias de crachá. SEIS é o tamanho do conjunto de propósito: a cor só
 * economiza tempo na porta enquanto a recepção consegue distinguir as faixas de
 * longe. Cada categoria nova custaria uma cor que ninguém sabe nomear.
 */
export const CREDENTIAL_CATEGORIES = [
  'PARTICIPANT',
  'SPEAKER',
  'STAFF',
  'PRESS',
  'VIP',
  'GUEST',
] as const;

export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number];

/** Quem não teve categoria escolhida é participante — o crachá que já existe. */
export const DEFAULT_CREDENTIAL_CATEGORY: CredentialCategory = 'PARTICIPANT';

/**
 * Os valores da paleta da categoria, **espelhados** de `src/app/globals.css`.
 *
 * Nomeados pelo token que espelham (`CREDENTIAL_CATEGORY_TOKENS` abaixo), porque
 * o que este arquivo guarda não é uma cor escolhida aqui: é a cor que o sistema
 * já usa, no formato que o PDF e a impressora entendem.
 */
export const CREDENTIAL_CATEGORY_PALETTE = {
  primary: '#4f46e5',
  secondary: '#00668a',
  tertiary: '#005338',
  warning: '#f59e0b',
  danger: '#ef4444',
  neutral: '#464555',
} as const;

export type CredentialCategoryColorKey = keyof typeof CREDENTIAL_CATEGORY_PALETTE;

/** O token do `globals.css` que cada valor espelha — é o que o teste compara. */
export const CREDENTIAL_CATEGORY_TOKENS: Record<CredentialCategoryColorKey, string> = {
  primary: '--ef-primary-container',
  secondary: '--ef-secondary',
  tertiary: '--ef-tertiary',
  warning: '--ef-warning',
  danger: '--ef-danger',
  neutral: '--ef-on-surface-variant',
};

export interface CredentialCategoryDefinition {
  key: CredentialCategory;
  /** Rótulo em português — o que a portaria lê na faixa e no seletor. */
  label: string;
  /**
   * A quem a categoria se destina, em uma linha. A tela mostra isto no seletor:
   * "Convidado" e "Imprensa" são a mesma pessoa em eventos diferentes, e quem
   * escolhe precisa saber qual usar.
   */
  description: string;
  /** A chave da cor na paleta — a ponte entre a tela e o papel. */
  colorKey: CredentialCategoryColorKey;
  /** O token de design system correspondente (`--ef-…`), para a tela. */
  colorToken: string;
  /** O valor do token, para quem NÃO resolve variável CSS (PDF e ZPL). */
  color: string;
  /**
   * O `tone` do primitivo `Badge` (`src/components/ui/badge.tsx`) desta categoria.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE A TELA RECEBE UM TOM, E NÃO O HEXADECIMAL
   * ─────────────────────────────────────────────────────────────────────────────
   *  Componente do sistema não escreve cor: a trava
   *  (`tests/unit/design-system-guard.test.ts`) reprova hexadecimal e paleta crua
   *  em `src/components/**`, e o `Badge` só aceita seis TONS semânticos. Mapear
   *  aqui — onde o catálogo de categorias já vive — mantém uma régua só: mudar o
   *  tom de uma categoria é mudar esta linha, e o papel e a tela continuam
   *  concordando sobre qual categoria é qual.
   */
  tone: CredentialCategoryTone;
}

/** Os tons do primitivo `Badge` que uma categoria pode usar. */
export const CREDENTIAL_CATEGORY_TONES = ['primary', 'info', 'success', 'warning', 'danger', 'neutral'] as const;

export type CredentialCategoryTone = (typeof CREDENTIAL_CATEGORY_TONES)[number];

function define(
  key: CredentialCategory,
  label: string,
  description: string,
  colorKey: CredentialCategoryColorKey,
  tone: CredentialCategoryTone,
): CredentialCategoryDefinition {
  return {
    key,
    label,
    description,
    colorKey,
    tone,
    colorToken: CREDENTIAL_CATEGORY_TOKENS[colorKey],
    color: CREDENTIAL_CATEGORY_PALETTE[colorKey],
  };
}

/**
 * O catálogo. As seis cores são token de ESTADO/MARCA do design system, e não
 * uma paleta nova: quem já conhece o produto reconhece a faixa sem aprender cor.
 */
export const CREDENTIAL_CATEGORY_DEFINITIONS: Readonly<Record<CredentialCategory, CredentialCategoryDefinition>> = {
  PARTICIPANT: define(
    'PARTICIPANT',
    'Participante',
    'Quem se inscreveu no evento ou em uma atividade. É o padrão.',
    'primary',
    'primary',
  ),
  SPEAKER: define(
    'SPEAKER',
    'Palestrante',
    'Quem ministra atividade — mesa, oficina, palestra.',
    'secondary',
    'info',
  ),
  STAFF: define(
    'STAFF',
    'Equipe',
    'Quem trabalha no evento: apoio, secretaria, portaria.',
    'tertiary',
    'success',
  ),
  PRESS: define('PRESS', 'Imprensa', 'Jornalista, fotógrafo e quem cobre o evento.', 'warning', 'warning'),
  VIP: define('VIP', 'Autoridade', 'Diretoria, convidado institucional e autoridade.', 'danger', 'danger'),
  GUEST: define(
    'GUEST',
    'Convidado',
    'Acompanhante e convidado sem função no evento.',
    'neutral',
    'neutral',
  ),
};

/**
 * Todas as categorias, na ordem do catálogo.
 *
 * A ordem é a do seletor: o padrão primeiro (é o que a maioria recebe) e as
 * exceções depois, na ordem em que a portaria costuma precisar delas.
 */
export const CREDENTIAL_CATEGORY_LIST: readonly CredentialCategoryDefinition[] = CREDENTIAL_CATEGORIES.map(
  (key) => CREDENTIAL_CATEGORY_DEFINITIONS[key],
);

/** Rótulo por categoria — para listas e mensagens. */
export function credentialCategoryLabel(category: string | null | undefined): string {
  return resolveCredentialCategory(category).label;
}

/**
 * Normaliza o que veio do banco (ou de um formulário) para uma categoria REAL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  VALOR DESCONHECIDO CAI NO PADRÃO, E O PADRÃO É DITO — NÃO INVENTADO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Três casos chegam aqui, e os três terminam em `PARTICIPANT`:
 *
 *    • `null`/`undefined`/vazio — crachá gravado antes da coluna existir;
 *    • caixa diferente (`"staff"`, `"Staff"`) — a coluna é texto livre no banco,
 *      não enum, e a normalização é honesta: a MESMA categoria em outra caixa;
 *    • qualquer outra coisa (`"CHEFE"`, um valor de uma versão futura) — o crachá
 *      continua imprimível, com a faixa neutra.
 *
 *  **Recusar** a emissão por causa de um valor estranho deixaria a pessoa SEM
 *  crachá na porta, o que é pior que um crachá de participante; e **inventar** uma
 *  categoria (uma cor nova para cada texto desconhecido) faria a cor perder o
 *  sentido, que é justamente o que esta dívida veio consertar. O chamador que
 *  precisa AVISAR tem `isKnownCredentialCategory` para isso.
 */
export function resolveCredentialCategory(
  raw: string | null | undefined,
): CredentialCategoryDefinition {
  const candidate = typeof raw === 'string' ? raw.trim().toUpperCase() : '';

  return isKnownCredentialCategory(candidate)
    ? CREDENTIAL_CATEGORY_DEFINITIONS[candidate]
    : CREDENTIAL_CATEGORY_DEFINITIONS[DEFAULT_CREDENTIAL_CATEGORY];
}

/** O valor está no catálogo? (normalizado: `"staff"` é `STAFF`) */
export function isKnownCredentialCategory(value: string | null | undefined): value is CredentialCategory {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';

  return (CREDENTIAL_CATEGORIES as readonly string[]).includes(candidate);
}

/** A cor da categoria — a função que o PDF e o ZPL chamam. */
export function credentialCategoryColor(category: string | null | undefined): string {
  return resolveCredentialCategory(category).color;
}

/** O token de design system da categoria — o que a tela usa. */
export function credentialCategoryToken(category: string | null | undefined): string {
  return resolveCredentialCategory(category).colorToken;
}

/** O tom do primitivo `Badge` da categoria — o que a tela usa como cor. */
export function credentialCategoryTone(category: string | null | undefined): CredentialCategoryTone {
  return resolveCredentialCategory(category).tone;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cor → operadores de PDF
// ───────────────────────────────────────────────────────────────────────────────
export interface PdfRgb {
  /** Componentes de 0 a 1, na ordem do operador `rg` do PDF. */
  r: number;
  g: number;
  b: number;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Converte o hexadecimal da paleta em componentes de 0 a 1.
 *
 * ─── POR QUE O PARÂMETRO É `unknown` E NÃO `string` ───────────────────────────
 *  Esta função já é o ponto onde o desenho do crachá recebe cor de FORA (a cor do
 *  tema do evento vem do banco, gravada pelo organizador). Um valor que não é
 *  hexadecimal — `null`, um número, texto — devolve `null` em vez de virar `NaN`:
 *  um `NaN` no meio de um stream de PDF não lança, ele **corrompe** o arquivo, e o
 *  defeito aparece na impressora, não no teste.
 */
export function pdfRgb(color: unknown): PdfRgb | null {
  if (typeof color !== 'string') return null;

  const text = color.trim();
  if (!HEX.test(text)) return null;

  const body = text.slice(1);
  const full =
    body.length === 3
      ? body
          .split('')
          .map((digit) => `${digit}${digit}`)
          .join('')
      : body;

  return {
    r: Number.parseInt(full.slice(0, 2), 16) / 255,
    g: Number.parseInt(full.slice(2, 4), 16) / 255,
    b: Number.parseInt(full.slice(4, 6), 16) / 255,
  };
}

/** O operador de cor de PREENCHIMENTO do PDF (`r g b rg`). */
export function pdfFillOperator(color: string): string {
  const rgb = pdfRgb(color);
  if (!rgb) return '0 0 0 rg';

  return `${rgb.r.toFixed(3)} ${rgb.g.toFixed(3)} ${rgb.b.toFixed(3)} rg`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cor → faixa do crachá (o desenho)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A geometria da faixa de categoria, em fração da etiqueta.
 *
 * É um DADO e não um número solto dentro dos renderizadores: a faixa tem de cair
 * no mesmo lugar relativo nas quatro saídas, em qualquer medida de etiqueta — a
 * folha A4 (célula de 193 pt) e o rolo de 100 × 50 mm são tamanhos muito diferentes.
 *
 * A faixa fica no TOPO, e não na lateral: o QR ocupa a esquerda do crachá inteiro,
 * e uma barra vertical cairia em cima dele na etiqueta estreita (63,5 mm) da folha
 * adesiva. É a primeira coisa que a recepção vê, de longe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O PISO DE 5 pt, SOZINHO, ERA UM DEFEITO — E O DESENHO O REVELOU (E42)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O piso existe para a faixa não sumir na etiqueta pequena. Mas ele, sozinho,
 *  criava o defeito OPOSTO na etiqueta adesiva: numa célula de 63,5 × 33,9 mm
 *  (~96 pt de altura), 5 pt são 5,2% da altura, e o desenho ainda reserva um
 *  respiro de 10 pt acima do nome. Somados, os 15 pt comiam o espaço que o QR
 *  precisava — a etiqueta ficava com o QR colado no texto.
 *
 *  A faixa é IDENTIDADE, não conteúdo: ela não pode competir com o nome e o código.
 *  A altura é então **proporcional primeiro, com piso e teto depois** — a etiqueta
 *  adesiva fica com ~6,7 pt e a folha A4 com ~13,5 pt: visível nas duas, dominante
 *  em nenhuma.
 */
export const CREDENTIAL_STRIPE_HEIGHT_RATIO = 0.07;
/** Teto da fração: etiqueta muito alta não vira faixa grossa. */
export const CREDENTIAL_STRIPE_MAX_RATIO = 0.09;
export const CREDENTIAL_STRIPE_MIN_PT = 4;
export const CREDENTIAL_STRIPE_MAX_PT = 16;

/** Altura da faixa, em pontos, para uma etiqueta da altura informada. */
export function credentialStripeHeight(cellHeightPt: number): number {
  const ratio = Math.min(
    CREDENTIAL_STRIPE_MAX_RATIO,
    Math.max(0, CREDENTIAL_STRIPE_HEIGHT_RATIO),
  );
  const wanted = Number.isFinite(cellHeightPt) ? cellHeightPt * ratio : CREDENTIAL_STRIPE_MIN_PT;

  return Math.min(CREDENTIAL_STRIPE_MAX_PT, Math.max(CREDENTIAL_STRIPE_MIN_PT, wanted));
}

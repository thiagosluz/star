/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Tema e blocos da landing page pública
 *
 *  Cada evento tem uma página pública altamente personalizável. Este módulo
 *  define o CONTRATO dessa personalização e as garantias de segurança que ela
 *  precisa respeitar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO MAIS IMPORTANTE: TEMA É DADO, NÃO CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O organizador escolhe cores, tipografia, layout e blocos. Nada disso vira CSS
 *  arbitrário: o tema é um objeto JSON validado por Zod, e a renderização
 *  traduz esses valores em CSS custom properties sob um prefixo próprio.
 *
 *  Por que isso importa: um bloco do tipo `CUSTOM_HTML` existe no enum do banco
 *  e, se renderizado como HTML cru, é XSS armazenado com o nome do organizador.
 *  As regras abaixo tratam esse caso explicitamente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';

import { formatZonedDateTime } from '@/domain/events/scheduling-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Cores
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Aceita apenas hex (#rgb, #rrggbb, #rrggbbaa) ou `oklch(...)`.
 *
 * Deliberadamente NÃO aceitamos `rgb()`, `hsl()`, nomes ou qualquer coisa que
 * possa conter `;`, `}` ou `url(`. O valor é injetado em uma custom property;
 * um valor malicioso poderia escapar do contexto e injetar regras CSS.
 * A allowlist de formatos elimina essa classe inteira de ataque.
 */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const OKLCH = /^oklch\(\s*[\d.]+%?\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+%?)?\s*\)$/;

export const colorSchema = z
  .string()
  .trim()
  .refine((value) => HEX.test(value) || OKLCH.test(value), {
    message: 'Cor deve estar em hexadecimal (#rrggbb) ou oklch().',
  });

/** Raio de borda, em pixels. Limitado para não destruir o layout. */
const radiusSchema = z.number().min(0).max(48);

/**
 * URL absoluta **http(s)**, com allowlist de protocolo.
 *
 * `z.string().url()` sozinho NÃO é suficiente: ele aceita `javascript:alert(1)`,
 * `data:text/html,...` e `vbscript:`. Como estas URLs viram `src` de imagem e
 * `href` de link na página pública, aceitá-las seria XSS. A validação explícita
 * de protocolo fecha essa classe inteira de ataque.
 */
export const safeUrlSchema = z
  .string()
  .trim()
  .max(1024)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, { message: 'A URL deve ser absoluta e usar http ou https.' });

export const themeSchema = z.object({
  primaryColor: colorSchema.optional(),
  secondaryColor: colorSchema.optional(),
  accentColor: colorSchema.optional(),
  backgroundColor: colorSchema.optional(),
  textColor: colorSchema.optional(),

  /** Modo escuro derivado das cores ou forçado. */
  colorMode: z.enum(['light', 'dark', 'auto']).optional().default('light'),

  radius: radiusSchema.optional().default(12),

  /** Fonte: limitada a uma allowlist. Não aceitamos `font-family` livre. */
  fontFamily: z
    .enum(['inter', 'geist', 'system', 'serif', 'mono', 'rounded'])
    .optional()
    .default('inter'),

  /** Densidade vertical do layout. */
  spacing: z.enum(['compact', 'normal', 'spacious']).optional().default('normal'),

  /** Estilo do hero da página inicial. */
  heroStyle: z.enum(['solid', 'gradient', 'image', 'minimal']).optional().default('gradient'),

  /** Efeito de entrada dos blocos. Respeita `prefers-reduced-motion` na UI. */
  animation: z.enum(['none', 'fade', 'slide']).optional().default('fade'),

  /** URL de imagem de fundo do hero. Validada como URL http(s). */
  heroImageUrl: safeUrlSchema.optional(),
});

export type EventTheme = z.input<typeof themeSchema>;
export type ResolvedEventTheme = z.output<typeof themeSchema>;

// ───────────────────────────────────────────────────────────────────────────────
//  Tema padrão e resolução
// ───────────────────────────────────────────────────────────────────────────────
export const DEFAULT_THEME: ResolvedEventTheme = {
  colorMode: 'light',
  radius: 12,
  fontFamily: 'inter',
  spacing: 'normal',
  heroStyle: 'gradient',
  animation: 'fade',
};

/** Stack de fontes por chave da allowlist — evita aceitar CSS livre. */
export const FONT_STACKS: Record<ResolvedEventTheme['fontFamily'], string> = {
  inter: 'var(--font-inter), system-ui, sans-serif',
  geist: 'var(--font-geist-sans), system-ui, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  rounded: 'ui-rounded, "Segoe UI", system-ui, sans-serif',
};

const SPACING_SCALE: Record<ResolvedEventTheme['spacing'], number> = {
  compact: 0.75,
  normal: 1,
  spacious: 1.35,
};

/**
 * Normaliza um tema vindo do banco.
 *
 * Um tema inválido NUNCA quebra a página pública: caímos no padrão. É melhor
 * uma página com a aparência da plataforma do que um erro 500 na vitrine do
 * cliente. Os problemas são registrados em log pelo chamador.
 */
export function resolveTheme(raw: unknown): {
  theme: ResolvedEventTheme;
  isValid: boolean;
} {
  const parsed = themeSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return { theme: parsed.data, isValid: true };
  }
  return { theme: DEFAULT_THEME, isValid: false };
}

/**
 * Converte o tema em CSS custom properties, sob o prefixo `--ef-`.
 *
 * O prefixo não é cosmético: isola as variáveis do evento das variáveis do
 * design system da plataforma, impedindo que um evento sobrescreva estilos de
 * outra parte da aplicação.
 */
export function themeToCssVariables(input: ResolvedEventTheme): Record<string, string> {
  const theme = input;
  const vars: Record<string, string> = {
    '--ef-radius': `${theme.radius}px`,
    '--ef-font-sans': FONT_STACKS[theme.fontFamily],
    '--ef-spacing-scale': String(SPACING_SCALE[theme.spacing]),
  };

  if (theme.primaryColor) vars['--ef-primary'] = theme.primaryColor;
  if (theme.secondaryColor) vars['--ef-secondary'] = theme.secondaryColor;
  if (theme.accentColor) vars['--ef-accent'] = theme.accentColor;
  if (theme.backgroundColor) vars['--ef-background'] = theme.backgroundColor;
  if (theme.textColor) vars['--ef-text'] = theme.textColor;

  return vars;
}

/** Serializa as variáveis para o atributo `style` de um elemento. */
export function themeToStyleString(input: ResolvedEventTheme): string {
  return Object.entries(themeToCssVariables(input))
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Blocos da landing page
// ───────────────────────────────────────────────────────────────────────────────
export const PAGE_BLOCK_TYPES = [
  'HERO',
  'RICH_TEXT',
  'SCHEDULE',
  'SPEAKERS',
  'SPONSORS',
  'FAQ',
  'GALLERY',
  'COUNTDOWN',
  'VENUE_MAP',
  'REGISTRATION_CTA',
  'TRACKS',
  'CUSTOM_HTML',
] as const;

export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];

/**
 * Blocos que NÃO podem ser renderizados com conteúdo livre do organizador.
 *
 * `CUSTOM_HTML` está aqui de propósito: renderizar HTML arbitrário informado
 * pelo organizador é XSS armazenado. Na prática ele é renderizado como TEXTO
 * (ou sanitizado), e a UI emite um aviso. Está documentado e há teste.
 */
export const SANDBOXED_BLOCK_TYPES: ReadonlySet<PageBlockType> = new Set<PageBlockType>([
  'CUSTOM_HTML',
]);

export interface PageBlock {
  id: string;
  type: PageBlockType;
  content: unknown;
  style: unknown;
  displayOrder: number;
  isVisible: boolean;
}

/**
 * Ordena e filtra blocos para renderização.
 *
 * Regras:
 *   • blocos invisíveis são descartados;
 *   • a ordem é `displayOrder`, com desempate estável pelo id (evita "pulos"
 *     de layout entre renders quando dois blocos têm a mesma ordem);
 *   • blocos de tipo desconhecido são descartados em vez de quebrar a página —
 *     permite adicionar tipos novos sem medo de quebrar eventos antigos.
 */
export function selectRenderableBlocks(blocks: readonly PageBlock[]): PageBlock[] {
  const KNOWN = new Set<string>(PAGE_BLOCK_TYPES);

  return [...blocks]
    .filter((block) => block.isVisible && KNOWN.has(block.type))
    .sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Ordem canônica sugerida para uma página nova.
 *
 * Ajuda o organizador a montar uma página que converte: apresentação, prova
 * social, agenda, e a chamada para ação no fim.
 */
export const RECOMMENDED_BLOCK_ORDER: readonly PageBlockType[] = [
  'HERO',
  'RICH_TEXT',
  'TRACKS',
  'SPEAKERS',
  'SCHEDULE',
  'VENUE_MAP',
  'SPONSORS',
  'FAQ',
  'GALLERY',
  'COUNTDOWN',
  'REGISTRATION_CTA',
];

/** Rótulos para a UI de edição (pt-BR). */
export const BLOCK_LABELS: Record<PageBlockType, string> = {
  HERO: 'Destaque',
  RICH_TEXT: 'Texto',
  SCHEDULE: 'Agenda',
  SPEAKERS: 'Palestrantes',
  SPONSORS: 'Patrocinadores',
  FAQ: 'Perguntas frequentes',
  GALLERY: 'Galeria',
  COUNTDOWN: 'Contagem regressiva',
  VENUE_MAP: 'Localização',
  REGISTRATION_CTA: 'Chamada para inscrição',
  TRACKS: 'Trilhas temáticas',
  CUSTOM_HTML: 'HTML personalizado',
};

// ───────────────────────────────────────────────────────────────────────────────
//  Editor da página: conteúdo dos blocos (FASE 17, item E3)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A FASE 3 definiu o CONTRATO do tema e deixou `content` como `Json` livre,
 * validado pela camada de aplicação. A FASE 17 é quem escreve esse conteúdo, então
 * é aqui que o contrato passa a existir de verdade — um schema por tipo de bloco.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE VALIDAR NO DOMÍNIO, E NÃO NO FORMULÁRIO
 * ─────────────────────────────────────────────────────────────────────────────
 *  O conteúdo gravado é renderizado na página PÚBLICA do evento. Um `content`
 *  inválido não é um detalhe cosmético: ele é publicado. Validar só na tela
 *  deixaria a porta aberta para qualquer outro caminho de escrita (script,
 *  Server Action chamada diretamente, dado importado).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS FAMÍLIAS DE CAMPO
 * ─────────────────────────────────────────────────────────────────────────────
 *  • TEXTO (`labelSchema`, `textSchema`) — sai do React escapado, então o risco é
 *    só tamanho; o limite existe para o bloco não virar um dump que quebra o
 *    layout.
 *  • URL (`safeUrlSchema`) — vira `src`/`href` na página pública. É por isso que a
 *    allowlist de protocolo (http/https) vive no domínio, e não no formulário.
 */

/** Teto de blocos por página: uma página com 200 blocos não é uma landing page. */
export const MAX_PAGE_BLOCKS = 30;
export const MAX_FAQ_ITEMS = 30;
export const MAX_GALLERY_IMAGES = 24;
export const MAX_BLOCK_TEXT_LENGTH = 8000;

/** Passo entre blocos: deixa espaço para inserir no meio sem renumerar tudo. */
export const BLOCK_ORDER_STEP = 10;

const labelSchema = z.string().trim().max(200);
const textSchema = z.string().trim().max(MAX_BLOCK_TEXT_LENGTH);

const faqItemSchema = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(2000),
});

const galleryItemSchema = z.object({
  url: safeUrlSchema,
  caption: labelSchema.optional(),
});

/**
 * Conteúdo aceito por cada tipo de bloco.
 *
 * Blocos que extraem os dados do próprio evento (agenda, local, trilhas,
 * palestrantes) aceitam só um título opcional: o corpo deles é o dado real, não
 * texto livre — o organizador não deve poder escrever uma agenda que não existe.
 *
 * Listas aceitam VAZIO de propósito: um bloco recém-criado ainda não tem itens, e
 * exigir o primeiro item transformaria "adicionar bloco" em erro de validação. O
 * item, quando existe, é estrito.
 */
export const blockContentSchemas: Record<PageBlockType, z.ZodType> = {
  HERO: z.object({
    headline: labelSchema.optional(),
    subheadline: labelSchema.optional(),
    ctaLabel: labelSchema.optional(),
    ctaUrl: safeUrlSchema.optional(),
  }),
  RICH_TEXT: z.object({ title: labelSchema.optional(), body: textSchema.default('') }),
  SCHEDULE: z.object({ title: labelSchema.optional() }),
  SPEAKERS: z.object({ title: labelSchema.optional() }),
  SPONSORS: z.object({
    title: labelSchema.optional(),
    /** Filtra por cota: o bloco mostra só os patrocinadores daquela cota. */
    tierId: z.string().uuid().optional(),
  }),
  FAQ: z.object({
    title: labelSchema.optional(),
    items: z.array(faqItemSchema).max(MAX_FAQ_ITEMS).default([]),
  }),
  GALLERY: z.object({
    title: labelSchema.optional(),
    images: z.array(galleryItemSchema).max(MAX_GALLERY_IMAGES).default([]),
  }),
  COUNTDOWN: z.object({ title: labelSchema.optional(), label: labelSchema.optional() }),
  VENUE_MAP: z.object({ title: labelSchema.optional() }),
  REGISTRATION_CTA: z.object({
    title: labelSchema.optional(),
    description: z.string().trim().max(600).optional(),
    ctaLabel: labelSchema.optional(),
  }),
  TRACKS: z.object({ title: labelSchema.optional() }),
  CUSTOM_HTML: z.object({
    title: labelSchema.optional(),
    /** Renderizado como TEXTO — ver `SANDBOXED_BLOCK_TYPES`. */
    html: z.string().trim().max(4000).default(''),
  }),
};

/** Explicação de cada bloco para o seletor do editor (pt-BR, para quem opera). */
export const BLOCK_DESCRIPTIONS: Record<PageBlockType, string> = {
  HERO: 'Cabeçalho de destaque. A página do evento já abre com um cabeçalho montado a partir dos dados do evento.',
  RICH_TEXT: 'Texto livre sobre o evento. Aceita parágrafos; HTML não é interpretado.',
  SCHEDULE: 'Agenda com as atividades cadastradas, com link direto para a inscrição.',
  SPEAKERS: 'Palestrantes das atividades, sem repetir nomes.',
  SPONSORS: 'Logotipos dos patrocinadores, agrupados por cota.',
  FAQ: 'Perguntas frequentes em pares pergunta/resposta.',
  GALLERY: 'Galeria de imagens por URL (edições anteriores, local, divulgação).',
  COUNTDOWN: 'Contagem regressiva até o início do evento.',
  VENUE_MAP: 'Local, endereço e link da transmissão online.',
  REGISTRATION_CTA: 'Chamada para ação de inscrição.',
  TRACKS: 'Trilhas temáticas da chamada de trabalhos.',
  CUSTOM_HTML: 'Bloco de código exibido como TEXTO, por segurança. HTML não é interpretado.',
};

/**
 * Tipos que o editor oferece mas a página NÃO desenha com conteúdo próprio.
 *
 * Existe para a tela poder dizer a verdade: oferecer um bloco que não aparece é
 * um formulário que mente. Hoje só o `HERO`, porque o cabeçalho do evento já
 * cumpre esse papel — e este é o motivo pelo qual ele não tem renderizador.
 */
export const BLOCK_WITHOUT_RENDERER: ReadonlySet<PageBlockType> = new Set<PageBlockType>([
  'HERO',
]);

/** Conteúdo inicial de um bloco novo: válido e vazio (o renderizador o ignora). */
export const DEFAULT_BLOCK_CONTENT: Record<PageBlockType, unknown> = {
  HERO: {},
  RICH_TEXT: { title: 'Sobre o evento', body: '' },
  SCHEDULE: {},
  SPEAKERS: {},
  SPONSORS: {},
  FAQ: { items: [] },
  GALLERY: { images: [] },
  COUNTDOWN: {},
  VENUE_MAP: {},
  REGISTRATION_CTA: {},
  TRACKS: {},
  CUSTOM_HTML: { html: '' },
};

export type BlockContentValidation =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; errors: readonly string[] };

/**
 * Normaliza e valida o conteúdo de um bloco.
 *
 * A normalização acontece ANTES da validação, e não é generosidade: o formulário
 * de perguntas frequentes envia todas as linhas que existem na tela, inclusive as
 * que o organizador deixou em branco ao clicar em "adicionar". Descartar linhas
 * totalmente vazias é o que separa "não preenchi esta" de "preenchi pela metade" —
 * a segunda continua sendo erro, com a linha identificada.
 */
export function validateBlockContent(type: PageBlockType, raw: unknown): BlockContentValidation {
  const schema = blockContentSchemas[type];

  const normalized = dropBlankListRows(type, raw ?? {});
  const parsed = schema.safeParse(normalized);

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }

  return { ok: true, content: parsed.data as Record<string, unknown> };
}

/** Remove itens de lista sem nenhum campo preenchido (ver `validateBlockContent`). */
function dropBlankListRows(type: PageBlockType, raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;

  const source = raw as Record<string, unknown>;
  const listKey = type === 'FAQ' ? 'items' : type === 'GALLERY' ? 'images' : null;
  if (!listKey) return source;

  const list = source[listKey];
  if (!Array.isArray(list)) return source;

  const kept = list.filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    return Object.values(entry as Record<string, unknown>).some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
  });

  return { ...source, [listKey]: kept };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ordem dos blocos
// ───────────────────────────────────────────────────────────────────────────────
export interface OrderedBlockRef {
  id: string;
  displayOrder: number;
}

/**
 * Ordem canônica dos blocos, com o MESMO critério da renderização
 * (`displayOrder`, desempate estável por id).
 *
 * A tela usa esta função para numerar a lista; se ela divergisse de
 * `selectRenderableBlocks`, o editor mostraria uma ordem e a página renderizaria
 * outra — o tipo de defeito que só aparece depois de publicar.
 */
export function orderBlockIds(blocks: readonly OrderedBlockRef[]): string[] {
  return [...blocks]
    .sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.id.localeCompare(b.id);
    })
    .map((block) => block.id);
}

/**
 * Move um bloco uma posição para cima ou para baixo.
 *
 * A lista resultante é a ORDEM COMPLETA — não uma troca de dois valores de
 * `displayOrder`. Motivo: subir um bloco sobre outro que tem a mesma ordem (dado
 * antigo, com empate) não muda nada visível, e o organizador clica de novo
 * achando que a tela travou. Reescrever a ordem inteira é idempotente e sempre
 * visível.
 */
export function moveBlockId(
  order: readonly string[],
  blockId: string,
  direction: 'up' | 'down',
): string[] {
  const current = [...order];
  const index = current.indexOf(blockId);
  if (index < 0) return current;

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= current.length) return current;

  const [moved] = current.splice(index, 1);
  if (moved === undefined) return current;

  current.splice(target, 0, moved);
  return current;
}

/** Converte uma ordem em `displayOrder` — de `BLOCK_ORDER_STEP` em `BLOCK_ORDER_STEP`. */
export function assignDisplayOrder(
  order: readonly string[],
): { id: string; displayOrder: number }[] {
  return order.map((id, index) => ({ id, displayOrder: index * BLOCK_ORDER_STEP }));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resumo do bloco para a lista do editor
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Uma linha explicando o que o bloco tem — sem abrir cada um para conferir.
 *
 * Um bloco vazio é dito explicitamente: ele existe na configuração e NÃO aparece
 * na página (o renderizador descarta conteúdo vazio), e descobrir isso olhando a
 * página publicada é tarde.
 */
export function summarizeBlockContent(type: PageBlockType, content: unknown): string {
  const source =
    typeof content === 'object' && content !== null && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};

  const title = typeof source.title === 'string' ? source.title.trim() : '';

  switch (type) {
    case 'RICH_TEXT': {
      const body = typeof source.body === 'string' ? source.body.trim() : '';
      return body.length > 0 ? `${body.length} caractere(s) de texto` : 'vazio — não aparece na página';
    }
    case 'FAQ': {
      const count = Array.isArray(source.items) ? source.items.length : 0;
      return count > 0 ? `${count} pergunta(s)` : 'nenhuma pergunta ainda';
    }
    case 'GALLERY': {
      const count = Array.isArray(source.images) ? source.images.length : 0;
      return count > 0 ? `${count} imagem(ns)` : 'nenhuma imagem ainda';
    }
    case 'CUSTOM_HTML': {
      const html = typeof source.html === 'string' ? source.html.trim() : '';
      return html.length > 0 ? 'exibido como texto (HTML não é interpretado)' : 'vazio — não aparece na página';
    }
    case 'VENUE_MAP':
      return title || 'Local e transmissão do evento';
    case 'SCHEDULE':
      return title || 'Agenda das atividades cadastradas';
    case 'SPEAKERS':
      return title || 'Palestrantes das atividades';
    case 'TRACKS':
      return title || 'Trilhas da chamada de trabalhos';
    case 'SPONSORS':
      return title || 'Patrocinadores por cota';
    case 'COUNTDOWN':
      return title || 'Contagem regressiva para o início';
    case 'REGISTRATION_CTA':
      return title || 'Chamada para inscrição';
    case 'HERO':
      return 'o cabeçalho do evento já cumpre este papel';
    default:
      return title || 'sem configuração';
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Publicação da página (FASE 23, item E13)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Estado de publicação da página.
 *
 * `SCHEDULED` é um estado PRÓPRIO, e não "publicada com data": a diferença aparece
 * na tela (o organizador precisa ver que ainda falta chegar a hora) e na leitura
 * pública (a consulta considera a data).
 *
 * `WINDOW_CLOSED` (FASE 24) é o fim da janela: a página continua configurada e
 * publicada, mas a data de término já passou e ela saiu do ar sozinha.
 */
export type PublicationState = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'WINDOW_CLOSED';

export const PUBLICATION_STATE_LABELS: Record<PublicationState, string> = {
  DRAFT: 'Rascunho — não aparece para visitantes',
  SCHEDULED: 'Agendada — entra no ar sozinha na data',
  PUBLISHED: 'Publicada — os visitantes estão vendo',
  WINDOW_CLOSED: 'Fora do ar pela data de término — a página saiu sozinha',
};

export interface PublicationPlanInput {
  /** Caixa "publicar a página" marcada no formulário. */
  publishNow: boolean;
  /** Data/hora escolhida para entrar no ar (opcional). */
  publishAt: Date | null;
  /** Data/hora escolhida para sair do ar (opcional) — FASE 24. */
  unpublishAt?: Date | null;
  now: Date;
  /**
   * Fuso usado nas mensagens (o do evento). Não afeta a decisão — as datas já
   * chegam como instantes — mas é o que faz a mensagem dizer a hora que o
   * organizador digitou.
   */
  timeZone?: string;
}

export type PublicationPlan =
  | {
      ok: true;
      state: PublicationState;
      /** O que deve ser GRAVADO em `isPublished`. */
      isPublished: boolean;
      /** O que deve ser GRAVADO em `publishAt`. */
      publishAt: Date | null;
      /** O que deve ser GRAVADO em `unpublishAt`. */
      unpublishAt: Date | null;
      message: string;
    }
  | { ok: false; message: string };

/**
 * Decide o que gravar a partir do que o organizador pediu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS CINCO REGRAS, E O DEFEITO QUE CADA UMA EVITA
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. **Publicar agora e agendar ao mesmo tempo é recusado.** Os dois pedidos são
 *     incompatíveis e o sistema não deve escolher por conta própria qual deles vale.
 *  2. **Despublicar LIMPA as datas.** Sem isto, a condição de visibilidade
 *     (`isPublished || publishAt <= now`) republicaria a página no instante
 *     seguinte: o organizador tira do ar e ela volta sozinha, porque a data
 *     agendada já passou. É o defeito mais fácil de escrever e o mais difícil de
 *     entender depois.
 *  3. **Data de entrada no passado é publicação imediata.** Uma data que já passou
 *     não agenda nada; tratá-la como erro faria o organizador redigitar, tratá-la
 *     como "agendada no passado" deixaria a página fora do ar para sempre.
 *  4. **Término antes do início é recusado** (FASE 24). Uma janela invertida nunca
 *     existiria no ar, e o organizador concluiria que o agendamento "não funciona".
 *  5. **Término já vencido é recusado ao publicar** (FASE 24). Aceitar gravaria uma
 *     página "publicada" que nunca aparece — o pior estado possível: a tela diz
 *     uma coisa e o site faz outra.
 */
export function planPublication(input: PublicationPlanInput): PublicationPlan {
  const scheduled = input.publishAt;
  const ends = input.unpublishAt ?? null;
  const zone = input.timeZone ?? 'UTC';

  if (input.publishNow && scheduled && scheduled.getTime() > input.now.getTime()) {
    return {
      ok: false,
      message: 'Escolha uma coisa: publicar agora ou agendar para depois.',
    };
  }

  if (ends) {
    /**
     * O início efetivo é o que SERÁ gravado: agora (publicação imediata) ou a data
     * agendada. Comparar com `now` sempre estaria errado para uma página agendada
     * que começa no futuro.
     */
    const effectiveStart =
      scheduled && scheduled.getTime() > input.now.getTime() ? scheduled : input.now;

    if (ends.getTime() <= effectiveStart.getTime()) {
      return {
        ok: false,
        message:
          scheduled && scheduled.getTime() > input.now.getTime()
            ? 'A data de término precisa ser depois da data de entrada no ar.'
            : 'A data de término precisa estar no futuro para a página entrar no ar.',
      };
    }
  }

  if (scheduled && scheduled.getTime() > input.now.getTime()) {
    const until = ends ? ` e sai do ar em ${formatDateTime(ends, zone)}` : '';
    return {
      ok: true,
      state: 'SCHEDULED',
      isPublished: false,
      publishAt: scheduled,
      unpublishAt: ends,
      message: `A página entra no ar em ${formatDateTime(scheduled, zone)}${until} — sem ninguém clicando.`,
    };
  }

  if (input.publishNow || scheduled) {
    const until = ends ? ` Sai do ar em ${formatDateTime(ends, zone)}.` : '';
    return {
      ok: true,
      state: 'PUBLISHED',
      isPublished: true,
      publishAt: null,
      unpublishAt: ends,
      message: `Página publicada — já visível para os visitantes.${until}`,
    };
  }

  return {
    ok: true,
    state: 'DRAFT',
    isPublished: false,
    // Despublicar limpa as DUAS datas (regra 2).
    publishAt: null,
    unpublishAt: null,
    message: 'Página salva como rascunho (não aparece para visitantes).',
  };
}

/**
 * A página está no ar neste instante?
 *
 * A consulta pública aplica a mesma regra no banco (`isPublished || publishAt <=
 * now`, dentro da janela); esta função existe para a TELA e para a
 * pré-visualização, que precisam explicar o estado sem repetir `if`s espalhados.
 */
export function resolvePublicationState(
  page: { isPublished: boolean; publishAt: Date | null; unpublishAt?: Date | null },
  now: Date,
): PublicationState {
  const ended = page.unpublishAt ? page.unpublishAt.getTime() <= now.getTime() : false;
  const started = page.isPublished || (page.publishAt ? page.publishAt.getTime() <= now.getTime() : false);

  if (started) return ended ? 'WINDOW_CLOSED' : 'PUBLISHED';
  if (page.publishAt) return 'SCHEDULED';
  return 'DRAFT';
}

function formatDateTime(date: Date, timeZone: string): string {
  return formatZonedDateTime(date, timeZone);
}

// ───────────────────────────────────────────────────────────────────────────────
//  SEO
// ───────────────────────────────────────────────────────────────────────────────
export interface EventSeoInput {
  title: string;
  summary?: string | null;
  subtitle?: string | null;
  startsAt: Date;
  endsAt: Date;
  venueName?: string | null;
  city?: string | null;
  country?: string | null;
  coverImageUrl?: string | null;
}

/**
 * Gera os metadados da página pública.
 *
 * `description` cai em cascata: resumo → subtítulo → frase montada com data e
 * local. Uma landing page sem descrição perde muito em compartilhamento, e o
 * organizador nem sempre preenche o resumo.
 */
export function buildEventMetadata(input: EventSeoInput): {
  title: string;
  description: string;
  openGraph: Record<string, unknown>;
} {
  const description =
    input.summary?.trim() ||
    input.subtitle?.trim() ||
    fallbackDescription(input);

  const location = [input.venueName, input.city, input.country]
    .filter(Boolean)
    .join(', ');

  return {
    title: input.title,
    description,
    openGraph: {
      title: input.title,
      description,
      type: 'website',
      ...(input.coverImageUrl ? { images: [{ url: input.coverImageUrl }] } : {}),
      ...(location ? { location } : {}),
    },
  };
}

function fallbackDescription(input: EventSeoInput): string {
  const period = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(input.startsAt);

  const local = [input.venueName, input.city].filter(Boolean).join(', ');

  return local
    ? `${input.title} — ${period}, em ${local}.`
    : `${input.title} — ${period}.`;
}

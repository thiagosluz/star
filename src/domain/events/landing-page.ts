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

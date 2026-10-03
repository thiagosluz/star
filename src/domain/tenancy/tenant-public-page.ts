/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — A página pública da INSTITUIÇÃO (FASE 64 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE MÓDULO COMPÕE O DO EVENTO EM VEZ DE COPIAR A RÉGUA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O editor de blocos do EVENTO (`src/domain/events/landing-page.ts`) já resolve,
 *  com testes, as duas perguntas difíceis deste tipo de tela: **o que pode ser
 *  gravado em cada tipo de bloco** e **como o tema vira CSS sem virar XSS**. A
 *  página da instituição tem os mesmos tipos de bloco e o mesmo tema.
 *
 *  Escrever um segundo validador "parecido" produziria duas réguas para a mesma
 *  ideia — e a lição da dívida E79 é exatamente essa: quando a regra é copiada, a
 *  cópia diverge no dia em que alguém corrige só um dos lados, e o defeito aparece
 *  no lado que ninguém olhou.
 *
 *  Então a decisão é explícita, e é a razão de este arquivo ser curto:
 *
 *    • **Tema**: `themeSchema`, `resolveTheme`, `themeToCssVariables` e o
 *      `safeUrlSchema` são IMPORTADOS do evento. Aqui só vive a PALETA padrão da
 *      instituição (que é outra: o azul institucional não é o índigo do evento).
 *    • **Conteúdo dos blocos**: os tipos que existem nos dois editores
 *      (`RICH_TEXT`, `FAQ`, `CUSTOM_HTML`, `HERO`, `TEAM`, `SPONSORS`) usam o
 *      schema DO EVENTO, por referência. Só os tipos que são invenção desta página
 *      — `ABOUT`, `PAST_EVENTS`, `CONTACT` — ganham schema aqui.
 *    • **Ordem e resumo dos blocos**: `orderBlockIds`, `moveBlockId`,
 *      `assignDisplayOrder` e `BLOCK_ORDER_STEP` são importados. Duas contas de
 *      ordem fariam o editor mostrar uma ordem e a página renderizar outra.
 *
 *  O que este arquivo NÃO faz: consultar o banco. Como todo o domínio do projeto,
 *  é função pura — a leitura e a gravação vivem em `src/lib/tenancy/**`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  BLOCK_ORDER_STEP,
  MAX_PAGE_BLOCKS,
  blockContentSchemas as EVENT_BLOCK_CONTENT_SCHEMAS,
  safeUrlSchema,
  selectRenderableBlocks,
  themeSchema,
  // O VALIDADOR do evento é a régua compartilhada: os tipos que existem nos dois
  // editores passam por ele, e não por uma reimplementação.
  validateBlockContent as validateEventBlockContent,
  type PageBlock,
  type ResolvedEventTheme,
} from '@/domain/events/landing-page';
// `canonicalize` vem do domínio de versões do EVENTO: a canonicalização (chaves
// ordenadas, recursiva) é contrato de hash e não pode existir em duas versões.
import { canonicalize } from '@/domain/events/page-version-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Tema da instituição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O tema é o MESMO contrato do evento — cores, raio, tipografia, densidade, estilo
 * do hero e animação. Reexportado com o nome da instituição porque a leitura da
 * página precisa de um nome que diga de quem é o tema; o VALOR é o mesmo objeto.
 */
export const tenantThemeSchema = themeSchema;
export type TenantTheme = z.input<typeof tenantThemeSchema>;
export type ResolvedTenantTheme = ResolvedEventTheme;

/**
 * A paleta padrão DA INSTITUIÇÃO, por modo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELA NÃO É A PALETA DO EVENTO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A da FASE 61 (índigo) foi escolhida para a página de um EVENTO. A vitrine da
 *  instituição tem outro papel — é a cara da casa, e a plataforma já usa o azul
 *  institucional em `tenants.primaryColor`. Usar a paleta do evento aqui faria a
 *  página da instituição nascer com a identidade de outra tela.
 *
 *  Assim como no evento, o mapa abaixo cobre TODOS os papéis: os que o organizador
 *  não escolher caem no padrão do MODO declarado, e nenhum `var()` do CSS chega a um
 *  token da plataforma (que a escala escura do visitante redefine — FASE 61).
 */
export const TENANT_THEME_PALETTE: Record<'light' | 'dark', {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}> = {
  light: {
    primary: '#0f6f8c',
    secondary: '#eef4f7',
    accent: '#e8a33d',
    background: '#fbfcfd',
    text: '#16202a',
  },
  dark: {
    primary: '#0f6f8c',
    secondary: 'oklch(0.26 0.01 230)',
    accent: '#e8a33d',
    background: 'oklch(0.15 0.01 230)',
    text: 'oklch(0.97 0 0)',
  },
};

// ───────────────────────────────────────────────────────────────────────────────
//  Blocos da página da instituição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os tipos que a página da instituição desenha.
 *
 * A lista NÃO é a do evento com três itens a mais: ela é a interseção possível —
 * blocos cujo corpo é dado da INSTITUIÇÃO, e não do evento. Ficaram de fora os que
 * não têm de onde tirar conteúdo fora do contexto de um evento (agenda, local,
 * palestrantes, contagem regressiva, chamadas de propostas, patrocínio por cota do
 * evento, galeria de uma edição específica).
 *
 * `PAST_EVENTS` é o **histórico automático** aprovado pelo humano: não é curadoria
 * manual, é a lista de eventos antigos do próprio sistema, lida na renderização.
 * Pela mesma régua da FASE 33/ADR-168, o bloco guarda só a decoração (título e
 * limite) — copiar o evento para dentro do bloco mentiria no dia seguinte.
 */
export const TENANT_PAGE_BLOCK_TYPES = [
  'HERO',
  'RICH_TEXT',
  'ABOUT',
  'PAST_EVENTS',
  'TEAM',
  'SPONSORS',
  'FAQ',
  'CONTACT',
  'CUSTOM_HTML',
] as const;

export type TenantPageBlockType = (typeof TENANT_PAGE_BLOCK_TYPES)[number];

/** Os tipos que existem nos dois editores — o schema vem do evento, por referência. */
const SHARED_BLOCK_TYPES: ReadonlySet<TenantPageBlockType> = new Set<TenantPageBlockType>([
  'HERO',
  'RICH_TEXT',
  'TEAM',
  'SPONSORS',
  'FAQ',
  'CUSTOM_HTML',
]);

export const TENANT_MAX_PAGE_BLOCKS = MAX_PAGE_BLOCKS;
export const TENANT_MAX_FAQ_ITEMS = 30;
export const TENANT_MAX_PAST_EVENTS = 24;
export const TENANT_DEFAULT_PAST_EVENTS = 6;
export const TENANT_BLOCK_ORDER_STEP = BLOCK_ORDER_STEP;

const labelSchema = z.string().trim().max(200);

/** Conteúdo exclusivo desta página — o dos tipos compartilhados está no evento. */
const TENANT_ONLY_BLOCK_CONTENT_SCHEMAS = {
  /**
   * A história da instituição. É texto longo porque é isso que ele é: o bloco de
   * texto do evento serve para um aviso curto, e usar o mesmo limite obrigaria a
   * fatiar a apresentação da casa em vários blocos.
   */
  ABOUT: z.object({
    title: labelSchema.optional(),
    body: z.string().trim().max(8000).default(''),
    /** Ano de fundação, como TEXTO: "1957" e "séc. XIX" são ambos legítimos. */
    foundedLabel: labelSchema.optional(),
  }),
  /**
   * O histórico de eventos — o bloco é AUTOMÁTICO.
   *
   * O limite é por bloco (e não da página) porque duas seções podem querer
   * quantidades diferentes: "os últimos 3" na dobra e "todos" mais abaixo.
   */
  PAST_EVENTS: z.object({
    title: labelSchema.optional(),
    description: z.string().trim().max(300).optional(),
    limit: z.number().int().min(1).max(TENANT_MAX_PAST_EVENTS).default(TENANT_DEFAULT_PAST_EVENTS),
  }),
  /**
   * Como falar com a instituição. `address` é texto de exibição (não vira mapa);
   * `mapUrl` é link absoluto http(s) — a mesma allowlist de protocolo do evento,
   * porque ele vira `href` na página pública.
   */
  CONTACT: z.object({
    title: labelSchema.optional(),
    address: z.string().trim().max(400).optional(),
    email: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(60).optional(),
    mapUrl: safeUrlSchema.optional(),
  }),
} as const;

/**
 * Os tipos que NÃO podem ser renderizados com conteúdo livre.
 *
 * `CUSTOM_HTML` continua aqui pelo mesmo motivo do evento: HTML arbitrário escrito
 * pelo organizador é XSS armazenado. A página da instituição o desenha como TEXTO.
 */
export const TENANT_SANDBOXED_BLOCK_TYPES: ReadonlySet<TenantPageBlockType> =
  new Set<TenantPageBlockType>(['CUSTOM_HTML']);

/**
 * O schema de conteúdo de CADA tipo desta página.
 *
 * A montagem por espalhamento é a garantia de que os tipos compartilhados usam o
 * objeto DO EVENTO — não uma cópia que envelhece. Um tipo novo no evento que também
 * valha aqui entra com uma linha na lista acima, e não com um schema novo.
 */
export const tenantBlockContentSchemas: Record<TenantPageBlockType, z.ZodType> = {
  HERO: EVENT_BLOCK_CONTENT_SCHEMAS.HERO,
  RICH_TEXT: EVENT_BLOCK_CONTENT_SCHEMAS.RICH_TEXT,
  TEAM: EVENT_BLOCK_CONTENT_SCHEMAS.TEAM,
  SPONSORS: EVENT_BLOCK_CONTENT_SCHEMAS.SPONSORS,
  FAQ: EVENT_BLOCK_CONTENT_SCHEMAS.FAQ,
  CUSTOM_HTML: EVENT_BLOCK_CONTENT_SCHEMAS.CUSTOM_HTML,
  ...TENANT_ONLY_BLOCK_CONTENT_SCHEMAS,
};

export type TenantPageBlock = Omit<PageBlock, 'type'> & { type: TenantPageBlockType };

/** Rótulos do seletor do editor (pt-BR, para quem opera). */
export const TENANT_BLOCK_LABELS: Record<TenantPageBlockType, string> = {
  HERO: 'Destaque',
  RICH_TEXT: 'Texto',
  ABOUT: 'Sobre a instituição',
  PAST_EVENTS: 'Histórico de eventos',
  TEAM: 'Equipe da instituição',
  SPONSORS: 'Patrocinadores e apoiadores',
  FAQ: 'Perguntas frequentes',
  CONTACT: 'Contato e localização',
  CUSTOM_HTML: 'HTML personalizado',
};

/** Uma linha dizendo o que o bloco mostra — o editor não deve precisar de ensaio. */
export const TENANT_BLOCK_DESCRIPTIONS: Record<TenantPageBlockType, string> = {
  HERO: 'Cabeçalho de destaque com chamada e imagem de fundo.',
  RICH_TEXT: 'Texto livre sobre a instituição. HTML não é interpretado.',
  ABOUT:
    'Apresentação e história da casa, com o ano de fundação. É o texto que responde "quem somos" a quem chega de fora.',
  PAST_EVENTS:
    'Os eventos que já terminaram, na ordem do mais recente. A lista é lida do sistema na hora de desenhar — não é digitada aqui.',
  TEAM:
    'A equipe da instituição, com a etiqueta de cada área. Quem não autorizou foto aparece com as iniciais, e o contato só sai se a pessoa permitir.',
  SPONSORS: 'Logotipos de patrocinadores e apoiadores, agrupados por cota.',
  FAQ: 'Perguntas frequentes em pares pergunta/resposta.',
  CONTACT: 'Endereço, e-mail, telefone e o link do mapa.',
  CUSTOM_HTML: 'Bloco de código exibido como TEXTO, por segurança. HTML não é interpretado.',
};

/**
 * Tipos que o editor oferece mas a página ainda NÃO desenha sozinha.
 *
 * `HERO` está aqui porque o cabeçalho da página já é montado com a identidade da
 * instituição (nome, logotipo, capa) — o mesmo motivo do `BLOCK_WITHOUT_RENDERER`
 * do evento. Está declarado para a tela poder dizer a verdade em vez de oferecer um
 * bloco que não aparece.
 */
export const TENANT_BLOCK_WITHOUT_RENDERER: ReadonlySet<TenantPageBlockType> =
  new Set<TenantPageBlockType>(['HERO']);

export const TENANT_DEFAULT_BLOCK_CONTENT: Record<TenantPageBlockType, unknown> = {
  HERO: {},
  RICH_TEXT: { title: 'Sobre a instituição', body: '' },
  ABOUT: { title: 'Nossa história', body: '' },
  PAST_EVENTS: { title: 'Edições anteriores', limit: TENANT_DEFAULT_PAST_EVENTS },
  TEAM: {},
  SPONSORS: {},
  FAQ: { items: [] },
  CONTACT: {},
  CUSTOM_HTML: { html: '' },
};

export type TenantBlockValidation =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; errors: readonly string[] };

/**
 * Normaliza e valida o conteúdo de um bloco desta página.
 *
 * A normalização de linhas em branco é a MESMA regra do evento, e vive lá
 * (`dropBlankListRows` dentro de `validateBlockContent`): o formulário de perguntas
 * frequentes envia todas as linhas da tela, inclusive as que ficaram vazias ao
 * clicar em "adicionar". Por isso o caminho para `FAQ` e `HERO` é literalmente a
 * função do evento — e não uma reimplementação.
 *
 * Os tipos exclusivos desta página passam pelo mesmo schema e pela mesma forma de
 * erro (`caminho: mensagem`), porque é isso que o formulário do editor espera.
 */
export function validateTenantBlockContent(
  type: TenantPageBlockType,
  raw: unknown,
): TenantBlockValidation {
  if (SHARED_BLOCK_TYPES.has(type)) {
    return validateSharedBlockContent(type, raw);
  }

  const parsed = tenantBlockContentSchemas[type].safeParse(raw ?? {});

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

/**
 * O caminho do conteúdo COMPARTILHADO.
 *
 * `validateBlockContent` do evento é tipado por `PageBlockType`, que é um supertipo
 * de `TenantPageBlockType` — a chamada é direta e é o ponto inteiro deste módulo:
 * uma régua só. O cast existe porque o TypeScript não sabe que o conjunto dos tipos
 * desta página é um subconjunto (a interseção é garantida em `SHARED_BLOCK_TYPES`,
 * conferida por `tests/unit/f64-pagina-da-instituicao.test.ts`).
 */
function validateSharedBlockContent(
  type: TenantPageBlockType,
  raw: unknown,
): TenantBlockValidation {
  return validateEventBlockContent(type as Parameters<typeof validateEventBlockContent>[0], raw);
}

/**
 * Ordena e filtra blocos para renderização, descartando tipo desconhecido.
 *
 * A ordenação e o descarte são os DO EVENTO (`selectRenderableBlocks`), com o
 * conjunto de tipos desta página no parâmetro `allowedTypes`. Escrever um segundo
 * `filter`/`sort` aqui criaria a régua paralela que a FASE 17 prendeu com teste: o
 * editor numeraria uma ordem e a página desenharia outra.
 */
export function selectRenderableTenantBlocks(
  blocks: readonly TenantPageBlock[],
): TenantPageBlock[] {
  return selectRenderableBlocks(blocks, TENANT_PAGE_BLOCK_TYPES);
}

// ───────────────────────────────────────────────────────────────────────────────
//  A página: rascunho × publicado
// ───────────────────────────────────────────────────────────────────────────────
export const MAX_TENANT_PAGE_DESCRIPTION = 2000;

/**
 * O conteúdo da página num instante — o que um snapshot guarda.
 *
 * `theme` é `unknown` de propósito: o snapshot é o que FOI publicado. Se um valor
 * fora do contrato entrou no banco por qualquer caminho, a página publicada
 * continua desenhando o que foi decidido no dia, e a leitura avisa em log
 * (`resolveTheme`). Revalidar aqui apagaria a diferença entre "não escolheu" e
 * "escolheu errado".
 */
export interface TenantPageSnapshot {
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  theme: unknown;
  blocks: TenantPageBlock[];
}

/** O rascunho, como o editor o mantém. */
export type TenantPageDraft = TenantPageSnapshot;

/**
 * A chave da diferença entre rascunho e publicado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O HASH É CANÔNICO, E NÃO UMA COMPARAÇÃO CAMPO A CAMPO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A tela precisa responder "tem alteração não publicada?" sem desenhar as duas
 *  versões lado a lado. Comparar campo a campo funcionaria hoje e mentiria amanhã:
 *  basta um campo novo entrar no snapshot sem entrar na comparação. O hash cobre o
 *  snapshot INTEIRO por construção — e a canonicalização (chaves ordenadas) é a
 *  mesma do histórico de versões do evento, então dois objetos iguais produzem o
 *  mesmo hash mesmo que o `JSON.stringify` os serialize em ordem diferente.
 */
export function tenantPageChecksum(snapshot: TenantPageSnapshot): string {
  return createHash('sha256').update(canonicalize(snapshot), 'utf8').digest('hex');
}

/** Formato do formulário de gravação — o que o serviço aceita para montar o rascunho. */
export interface TenantPageInput {
  title: string;
  description?: string | null;
  coverImageUrl?: string | null;
  logoUrl?: string | null;
  theme?: unknown;
  blocks?: readonly Partial<TenantPageBlock>[];
}

export type TenantPageValidation =
  | { ok: true; snapshot: TenantPageSnapshot }
  | { ok: false; code: string; message: string };

/**
 * Valida a página inteira e devolve o snapshot canônico para gravação.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O SERVIÇO NÃO VALIDA CAMPO A CAMPO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Publicar é gravar, e o que é gravado é o snapshot INTEIRO. Um validador de
 *  página é o único ponto por onde todo caminho de escrita passa (formulário,
 *  Server Action chamada direto, restauração, seed) — e é isso que impede que a
 *  validação exista só na tela. Um bloco inválido é recusado AQUI, com o índice do
 *  bloco na mensagem, porque "conteúdo inválido" sem dizer qual bloco é uma
 *  mensagem que não ajuda quem está tentando salvar.
 */
export function validateTenantPage(input: TenantPageInput): TenantPageValidation {
  const title = input.title.trim();

  if (title.length === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'A página precisa de um título.' };
  }

  if (title.length > 200) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'O título da página pode ter no máximo 200 caracteres.',
    };
  }

  const description = normalizeOptionalText(input.description, MAX_TENANT_PAGE_DESCRIPTION);

  if (description === undefined) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `A descrição pode ter no máximo ${MAX_TENANT_PAGE_DESCRIPTION} caracteres.`,
    };
  }

  const coverImageUrl = normalizeOptionalUrl(input.coverImageUrl);
  if (coverImageUrl === undefined) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A imagem de capa precisa ser uma URL absoluta http ou https.',
    };
  }

  const logoUrl = normalizeOptionalUrl(input.logoUrl);
  if (logoUrl === undefined) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'O logotipo precisa ser uma URL absoluta http ou https.',
    };
  }

  if (input.theme !== undefined) {
    const themeCheck = tenantThemeSchema.safeParse(input.theme);
    if (!themeCheck.success) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'O tema tem valores fora do permitido. Use hexadecimal (#rrggbb) ou oklch().',
      };
    }
  }

  const rawBlocks = input.blocks ?? [];

  if (rawBlocks.length > TENANT_MAX_PAGE_BLOCKS) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `A página aceita no máximo ${TENANT_MAX_PAGE_BLOCKS} blocos.`,
    };
  }

  const blocks: TenantPageBlock[] = [];

  for (const [index, raw] of rawBlocks.entries()) {
    const position = index + 1;
    const type = raw.type;

    if (!type || !isTenantBlockType(type)) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: `O bloco ${position} tem um tipo que esta página não desenha.`,
      };
    }

    const content = validateTenantBlockContent(type, raw.content ?? {});

    if (!content.ok) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: `Bloco ${position} (${TENANT_BLOCK_LABELS[type]}): ${content.errors.join('; ')}`,
      };
    }

    const id = typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : `bloco-${position}`;

    blocks.push({
      id,
      type,
      content: content.content,
      style: isPlainObject(raw.style) ? raw.style : {},
      displayOrder:
        typeof raw.displayOrder === 'number' && Number.isFinite(raw.displayOrder)
          ? raw.displayOrder
          : index * TENANT_BLOCK_ORDER_STEP,
      isVisible: raw.isVisible !== false,
    });
  }

  return {
    ok: true,
    snapshot: {
      title,
      description: description ?? null,
      coverImageUrl: coverImageUrl ?? null,
      logoUrl: logoUrl ?? null,
      theme: input.theme ?? {},
      blocks,
    },
  };
}

export function isTenantBlockType(value: string): value is TenantPageBlockType {
  return (TENANT_PAGE_BLOCK_TYPES as readonly string[]).includes(value);
}

/** `undefined` = inválido; `null` = ausente; string = valor limpo. */
function normalizeOptionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return undefined;

  return trimmed;
}

/** `undefined` = inválido; `null` = ausente; string = URL aceita. */
function normalizeOptionalUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  return safeUrlSchema.safeParse(trimmed).success ? trimmed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Estado de exibição
// ─────────────────────────────────────────────────────────────────────────────
export type TenantPagePublicationState = 'NEVER_PUBLISHED' | 'PUBLISHED' | 'CHANGES_PENDING';

export interface TenantPagePublication {
  state: TenantPagePublicationState;
  /** Quando a versão publicada foi ao ar. `null` = nunca publicada. */
  publishedAt: Date | null;
  /** A versão publicada tem exatamente o conteúdo do rascunho? */
  isUpToDate: boolean;
}

/**
 * O estado da página para a tela do organizador.
 *
 * `CHANGES_PENDING` existe porque as duas perguntas que o organizador faz são
 * diferentes: "o site está no ar?" e "o que eu acabei de editar já está no ar?".
 * Responder as duas com um booleano produz o defeito clássico de o editor dizer
 * "publicada" enquanto o visitante vê a versão da semana passada.
 */
export function resolveTenantPagePublication(page: {
  publishedSnapshot: unknown;
  publishedAt: Date | null;
  draft: TenantPageSnapshot;
}): TenantPagePublication {
  /**
   * O `readTenantPageSnapshot` é o TESTE de "existe versão publicada": um snapshot
   * sem a forma mínima (o `{}` de quem nunca publicou, um valor gravado por engano)
   * não é uma versão publicada, e a tela precisa dizer "nunca publicada" em vez de
   * desenhar uma página a partir de `undefined`.
   */
  const published = readTenantPageSnapshot(page.publishedSnapshot);

  if (published === null) {
    return { state: 'NEVER_PUBLISHED', publishedAt: null, isUpToDate: false };
  }

  const isUpToDate = tenantPageChecksum(published) === tenantPageChecksum(page.draft);

  return {
    state: isUpToDate ? 'PUBLISHED' : 'CHANGES_PENDING',
    publishedAt: page.publishedAt,
    isUpToDate,
  };
}

/**
 * Lê um snapshot gravado no banco.
 *
 * Devolve `null` quando o valor não tem a forma mínima (um objeto com `title`). É o
 * que faz uma linha corrompida virar "nunca publicada" — e não uma página pública
 * desenhada a partir de `undefined`.
 */
export function readTenantPageSnapshot(value: unknown): TenantPageSnapshot | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.title !== 'string' || value.title.trim().length === 0) return null;

  const blocks = Array.isArray(value.blocks) ? value.blocks : [];

  return {
    title: value.title,
    description: typeof value.description === 'string' ? value.description : null,
    coverImageUrl: typeof value.coverImageUrl === 'string' ? value.coverImageUrl : null,
    logoUrl: typeof value.logoUrl === 'string' ? value.logoUrl : null,
    theme: value.theme ?? {},
    blocks: blocks
      .filter(isPlainObject)
      .map((block, index) => readBlock(block, index))
      .filter((block): block is TenantPageBlock => block !== null),
  };
}

function readBlock(raw: Record<string, unknown>, index: number): TenantPageBlock | null {
  const type = raw.type;

  if (typeof type !== 'string' || !isTenantBlockType(type)) return null;

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `bloco-${index + 1}`,
    type,
    content: raw.content ?? {},
    style: raw.style ?? {},
    displayOrder:
      typeof raw.displayOrder === 'number' && Number.isFinite(raw.displayOrder)
        ? raw.displayOrder
        : index * TENANT_BLOCK_ORDER_STEP,
    isVisible: raw.isVisible !== false,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — O TEMA da página da instituição e o MODO do visitante
 *                                                            (FASE 64 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA DURA DESTA FATIA, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A paleta da instituição é IDENTIDADE; o claro/escuro é do VISITANTE. A
 *  instituição escolhe as cores, e quem escolhe o modo continua sendo quem lê a
 *  página — o cookie `ef_tema` da FASE 63, lido no servidor na primeira resposta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É DIFERENTE DA PÁGINA DO EVENTO (e é de propósito)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Na página do EVENTO (FASE 61, ADR-325) quem manda no modo é o ORGANIZADOR: a
 *  landing é um cartaz, e o visitante não escolhe a iluminação do cartaz. O
 *  `themeToCssVariables` do evento publica TODOS os papéis a partir do modo
 *  DECLARADO, e o CSS de lá não tem fallback para token da plataforma — nada
 *  escapa para o modo do sistema.
 *
 *  A página da INSTITUIÇÃO vive DENTRO do casco da plataforma (cabeçalho, rodapé e
 *  o controle de aparência da FASE 63). Se o tema da instituição publicasse os
 *  papéis de FUNDO e TEXTO a partir do modo dela, o visitante que escolheu "escuro"
 *  receberia uma página clara — e a escolha dele, visível no rodapé logo abaixo,
 *  viraria uma mentira. Era exatamente o defeito que o humano previu ao decidir
 *  (docs/fase-64-plano.md, decisão nº 3).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO O PROBLEMA É RESOLVIDO, SEM DUAS FONTES PARA A MESMA COR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `themeToCssVariables` continua sendo o ÚNICO mapa (o mesmo do evento, com a
 *  catraca `f61-tema-do-evento` prendendo papel faltante e valor `var(...)`). O que
 *  esta camada faz é escolher o MODO em que ele é chamado:
 *
 *    • o visitante escolheu `claro` ou `escuro` → esse modo manda. O padrão de todo
 *      papel que a instituição NÃO escolheu sai do `TENANT_THEME_PALETTE` daquele
 *      modo, e a página acompanha a plataforma (que o layout raiz já pintou);
 *    • o visitante escolheu `sistema` (ou não escolheu nada) → vale o modo que a
 *      INSTITUIÇÃO declarou para a própria paleta, porque é o modo em que ela
 *      escolheu as cores. É a mesma decisão do evento para o caso em que não há
 *      escolha de ninguém.
 *
 *  As cores que a instituição ESCOLHEU são publicadas como estão nos dois modos —
 *  a marca não inverte (a mesma régua de `EVENT_THEME_PALETTE`: `primary` é marca,
 *  não superfície). O que muda com o modo é só o que ela não escolheu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { themeToCssVariables } from '@/domain/events/landing-page';
import type { ThemeMode } from '@/lib/theme/theme-mode';
import {
  TENANT_THEME_PALETTE,
  type ResolvedTenantTheme,
} from '@/domain/tenancy/tenant-public-page';

/** Os dois modos que viram paleta. `sistema` não é um modo: é a ausência de escolha. */
export type TenantThemeMode = 'light' | 'dark';

/**
 * O modo EFETIVO da página.
 *
 * `sistema` devolve o modo declarado pela instituição (`declaredMode`) porque é o
 * modo em que ela escolheu as cores no editor — e é o único caso em que a página
 * pode escolher sozinha, já que ninguém escolheu por ela. Qualquer valor fora dos
 * três cai aqui também: fail-safe para a decisão da instituição, nunca para um
 * modo inventado.
 */
export function resolveTenantThemeMode(
  visitorMode: ThemeMode,
  declaredMode: ResolvedTenantTheme['colorMode'],
): TenantThemeMode {
  if (visitorMode === 'claro') return 'light';
  if (visitorMode === 'escuro') return 'dark';

  return declaredMode === 'dark' ? 'dark' : 'light';
}

export interface TenantThemeScope {
  /** Os papéis `--ef-*`, prontos para o atributo `style` do escopo. */
  variables: Record<string, string>;
  /** O modo EFETIVO — vai no `data-theme-mode`, que governa os controles nativos. */
  mode: TenantThemeMode;
  /**
   * O modo do VISITANTE foi quem decidiu? `false` = a página caiu no modo da
   * instituição (o visitante escolheu `sistema`). A tela usa isto para dizer a
   * verdade no aviso da prévia, e não para mudar cor nenhuma.
   */
  visitorDecided: boolean;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A MARCA COMO COR DE TEXTO — E POR QUE O TOM ESCOLHIDO NÃO SERVE AOS DOIS MODOS
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTA SEÇÃO CONSERTA (medido na fatia 5, com números)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 4 publicava os papéis `--ef-*` no escopo da página — e **nada os lia**.
 *  O `globals.css` declara os apelidos semânticos na RAIZ (`--brand: var(--ef-primary)`,
 *  `--primary: var(--ef-primary-container)`, …), e o CSS substitui `var()` **no elemento
 *  onde a declaração é feita**: sobrescrever `--ef-primary` num descendente NÃO
 *  re-resolve `--brand`. Medido com `theme.primaryColor = '#7b2ff7'` publicado no
 *  escopo: a cor computada do "Ver evento" (`text-brand`) continuava `#3525cd` no claro
 *  e `#a5b4fc` no escuro — os valores da raiz. A paleta da casa era um campo morto.
 *
 *  Desde então este módulo publica TAMBÉM os apelidos de IDENTIDADE que a página lê.
 *  **Superfície, texto, contorno e estado NÃO entram**: eles continuam vindo do modo do
 *  VISITANTE, que é a decisão do humano (ADR-332) e o que faz o claro/escuro dele
 *  valer. O que a casa escolhe é publicado nos apelidos de MARCA.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O TEXTO PRECISA DE UM TOM AJUSTADO — E O PREENCHIMENTO NÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não existe UM tom que sirva como texto pequeno sobre as duas superfícies: para o AA
 *  sobre a superfície clara a luminância tem de ser ≤ 0,15; sobre a escura, ≥ 0,28. São
 *  conjuntos DISJUNTOS — a mesma lição que a dívida do token de aviso ensinou na F52
 *  ("não existe um tom que sirva às duas superfícies": o mesmo `#d97706` dava 2,89:1 no
 *  painel claro e 4,15:1 no telão escuro).
 *
 *  Então os dois papéis se separam, e é isso que a decisão da casa já dizia:
 *
 *    • **PREENCHIMENTO** (`--primary`, `--primary-soft`, `--ring`) — é a IDENTIDADE: o
 *      botão, a borda e a faixa têm a cor da casa COMO ELA FOI ESCOLHIDA, nos dois modos
 *      (a marca não inverte). O que se escolhe por contraste é o RÓTULO em cima dela.
 *    • **TEXTO** (`--brand`) — é tinta sobre a superfície do modo: o tom da casa
 *      **clareado no escuro e escurecido no claro**, o mínimo necessário para alcançar o
 *      AA. A matiz é preservada, e o preenchimento não muda junto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ALVO É 5:1, E NÃO OS 4,5:1 DO AA — A MARGEM É MEDIDA, NÃO ESTÉTICA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A conta é feita contra o fundo da PALETA da instituição (`--ef-background`), e a
 *  superfície que a página realmente pinta é a do modo do visitante (o `--surface` da
 *  plataforma). As duas ficam a um fio uma da outra (`#fbfcfd` × `#f9f9ff` no claro;
 *  `oklch(0.15 0.01 230)` ≈ `#070c0f` × `#17181e` no escuro) — e é justamente por isso
 *  que o alvo tem folga: 5:1 deixa ~11% de margem e impede o portão WCAG AA de reprovar
 *  por meio tom. **Quem mede de verdade é o `axe`**, no portão da fase.
 */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

const BRANCO: Rgb = { r: 255, g: 255, b: 255 };

/**
 * O alvo de contraste do papel de TEXTO.
 *
 * 5 e não 4,5 (o mínimo do AA): a margem cobre a diferença entre o fundo da paleta da
 * instituição, que é o que o domínio conhece, e a superfície do modo do visitante, que é
 * a que a tela pinta. Ver o bloco acima.
 */
export const CONTRASTE_ALVO_DO_TEXTO = 5;

/** Canal sRGB (0–255) → linear (0–1). É a régua do WCAG 2.x. */
function linear(canal: number): number {
  const s = canal / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminância relativa de uma cor. */
function luminancia(cor: Rgb): number {
  return 0.2126 * linear(cor.r) + 0.7152 * linear(cor.g) + 0.0722 * linear(cor.b);
}

/** Razão de contraste entre dois RGB — sempre ≥ 1 (a ordem não importa). */
function razaoEntre(uma: Rgb, outra: Rgb): number {
  const a = luminancia(uma);
  const b = luminancia(outra);
  const [alta, baixa] = a >= b ? [a, b] : [b, a];

  return (alta + 0.05) / (baixa + 0.05);
}

function paraHex(cor: Rgb): string {
  const canal = (valor: number) =>
    Math.max(0, Math.min(255, Math.round(valor)))
      .toString(16)
      .padStart(2, '0');

  return `#${canal(cor.r)}${canal(cor.g)}${canal(cor.b)}`;
}

/** Mistura em sRGB — a mesma conta do `color-mix(in srgb)`, e o suficiente para legibilidade. */
function misturar(cor: Rgb, alvo: Rgb, peso: number): Rgb {
  return {
    r: cor.r + (alvo.r - cor.r) * peso,
    g: cor.g + (alvo.g - cor.g) * peso,
    b: cor.b + (alvo.b - cor.b) * peso,
  };
}

/**
 * Cor do tema → RGB.
 *
 * Aceita exatamente os formatos que `colorSchema` permite (`#rgb`, `#rrggbb`,
 * `#rrggbbaa` e `oklch(L C H)`) e devolve `null` para o resto — inclusive para um
 * `var()` que tenha escapado de outro caminho. O `oklch` é convertido porque a paleta
 * escura da instituição o usa (`TENANT_THEME_PALETTE.dark`), e uma cor não convertida
 * voltaria a ser um papel sem ajuste.
 */
export function paraRgb(cor: string): Rgb | null {
  const valor = cor.trim().toLowerCase();

  if (valor.startsWith('#')) {
    const hex = valor.slice(1);
    if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) return null;

    const completo =
      hex.length === 3
        ? hex
            .split('')
            .map((caractere) => caractere + caractere)
            .join('')
        : hex;

    return {
      r: Number.parseInt(completo.slice(0, 2), 16),
      g: Number.parseInt(completo.slice(2, 4), 16),
      b: Number.parseInt(completo.slice(4, 6), 16),
    };
  }

  if (valor.startsWith('oklch(') && valor.endsWith(')')) {
    return oklchParaRgb(valor.slice('oklch('.length, -1));
  }

  return null;
}

/** `oklch(L C H)` → sRGB, pelo caminho oklab → LMS → sRGB linear → gama. */
function oklchParaRgb(interno: string): Rgb | null {
  const partes = interno.split(/[\s/]+/).filter((parte) => parte.length > 0);

  const lightness = partes[0]?.endsWith('%')
    ? Number.parseFloat(partes[0]) / 100
    : Number.parseFloat(partes[0] ?? '');
  const chroma = Number.parseFloat(partes[1] ?? '');
  const hue = Number.parseFloat(partes[2] ?? '');

  if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) {
    return null;
  }

  const radianos = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radianos);
  const b = chroma * Math.sin(radianos);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: para255(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: para255(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: para255(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function para255(valorLinear: number): number {
  const s =
    valorLinear <= 0.0031308 ? 12.92 * valorLinear : 1.055 * valorLinear ** (1 / 2.4) - 0.055;

  return s * 255;
}

/**
 * Razão de contraste WCAG entre duas cores do tema. `null` quando alguma não é legível
 * pelo domínio (formato fora do schema) — quem chama decide o que fazer, e nunca finge
 * que mediu.
 */
export function razaoDeContraste(uma: string, outra: string): number | null {
  const a = paraRgb(uma);
  const b = paraRgb(outra);

  if (!a || !b) return null;

  return razaoEntre(a, b);
}

/**
 * O tom da casa no papel de TEXTO, ajustado ao modo até ser legível.
 *
 * O caminho é o menor possível: se a cor escolhida JÁ alcança o alvo sobre o fundo
 * daquele modo, ela sai como está (e é o caso do modo claro em todas as paletas da
 * casa). Só quando não alcança a cor caminha em direção ao preto (fundo claro) ou ao
 * branco (fundo escuro), em passos de 5%, até o primeiro passo que passa.
 *
 * Cor fora dos formatos do schema sai como veio: publicar o valor original é melhor do
 * que inventar um tom para um valor que o domínio não sabe ler.
 */
export function corDeTextoLegivel(input: {
  cor: string;
  fundo: string;
  alvo?: number;
}): string {
  const cor = paraRgb(input.cor);
  const fundo = paraRgb(input.fundo);
  const alvo = input.alvo ?? CONTRASTE_ALVO_DO_TEXTO;

  if (!cor || !fundo) return input.cor;

  const direcao = luminancia(fundo) > 0.5 ? { r: 0, g: 0, b: 0 } : BRANCO;

  for (let passo = 0; passo <= 20; passo += 1) {
    const atual = passo === 0 ? cor : misturar(cor, direcao, passo / 20);

    if (razaoEntre(atual, fundo) >= alvo) return paraHex(atual);
  }

  // Inalcançável na prática (100% é preto ou branco, e o contraste máximo é 21:1), mas o
  // retorno existe para a função nunca devolver um valor pior do que o que recebeu.
  return paraHex(misturar(cor, direcao, 1));
}

/**
 * O RÓTULO sobre a cor da casa — branco ou a tinta do modo, o que contrastar mais.
 *
 * É o outro lado do par de preenchimento: a casa escolhe a cor do botão, e quem decide
 * se o texto em cima é branco ou escuro é a MEDIÇÃO, não a preferência. Sem isto, uma
 * marca clara (amarelo, areia) sairia com rótulo branco — ilegível.
 */
export function corSobre(cor: string, tintaDoModo: string): string {
  const preenchimento = paraRgb(cor);
  const tinta = paraRgb(tintaDoModo);

  if (!preenchimento || !tinta) return '#ffffff';

  return razaoEntre(BRANCO, preenchimento) >= razaoEntre(tinta, preenchimento)
    ? '#ffffff'
    : tintaDoModo;
}

/**
 * Traduz o tema da instituição no escopo CSS da página, com o modo já resolvido.
 *
 * O `colorMode` é sobrescrito AQUI, e não no chamador: `themeToCssVariables` escolhe
 * a paleta padrão por ele, e um chamador que esquecesse de trocá-lo publicaria a
 * paleta do modo errado — o modo errado é justamente o defeito que esta fatia
 * existe para não ter. A sobrescrita vive em uma função só, com teste.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO ACHADO AQUI: O PADRÃO VINHA DA PALETA DO EVENTO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `themeToCssVariables` cobre os papéis que o organizador não escolheu com o mapa
 *  do EVENTO (`EVENT_THEME_PALETTE`, índigo `#4f46e5`). Ele faz isso corretamente
 *  para a página do evento, e o comentário de `TENANT_THEME_PALETTE` (fatia 1) diz
 *  que a página da instituição tem paleta PRÓPRIA — "o azul institucional não é o
 *  índigo do evento". Só que o mapa é UM e não conhece a instituição: a primeira
 *  versão desta função publicava `--ef-primary: #4f46e5` numa página cujo padrão
 *  documentado é `#0f6f8c`.
 *
 *  O teste deste arquivo pegou isso (`--ef-background` saindo `oklch(… 265)` em vez
 *  de `oklch(… 230)`). A correção NÃO está no mapa compartilhado — ele é a régua do
 *  evento e a catraca da FASE 61 o prende —, e sim aqui: um papel que a instituição
 *  NÃO escolheu passa a cair na paleta DELA, pelo modo EFETIVO. Os escolhidos
 *  continuam vencendo, e nenhum `var()` volta a alcançar token da plataforma.
 */
export function buildTenantThemeScope(input: {
  theme: ResolvedTenantTheme;
  visitorMode: ThemeMode;
}): TenantThemeScope {
  const declared = input.theme.colorMode;
  const mode = resolveTenantThemeMode(input.visitorMode, declared);
  const palette = TENANT_THEME_PALETTE[mode];
  const variables = themeToCssVariables({ ...input.theme, colorMode: mode });

  const marca = input.theme.primaryColor ?? palette.primary;
  const fundo = input.theme.backgroundColor ?? palette.background;
  const tinta = input.theme.textColor ?? palette.text;

  return {
    variables: {
      ...variables,
      '--ef-primary': marca,
      '--ef-secondary': input.theme.secondaryColor ?? palette.secondary,
      '--ef-accent': input.theme.accentColor ?? palette.accent,
      '--ef-background': fundo,
      '--ef-text': tinta,

      /**
       * ───────────────────────────────────────────────────────────────────────────
       *  OS APELIDOS QUE A PÁGINA REALMENTE LÊ (FASE 64 · fatia 5)
       * ───────────────────────────────────────────────────────────────────────────
       *  Sem estas sete linhas a paleta da casa era publicada e NÃO PINTAVA — os
       *  apelidos semânticos são resolvidos na raiz, e um descendente que sobrescreve
       *  `--ef-primary` não re-resolve `--brand`. Ver o bloco longo acima.
       *
       *  São só os de IDENTIDADE. Superfície (`--surface`, `--card`, `--background`),
       *  texto (`--foreground`, `--muted-foreground`) e contorno (`--border`) NÃO
       *  entram de propósito: continuam vindo do modo do VISITANTE (ADR-332), que é o
       *  que mantém o claro/escuro dele valendo por cima da paleta da casa.
       */
      '--brand': corDeTextoLegivel({ cor: marca, fundo }),
      '--brand-foreground': corSobre(marca, tinta),
      '--primary': marca,
      '--primary-foreground': corSobre(marca, tinta),
      '--primary-hover': `color-mix(in oklab, ${marca} 88%, ${mode === 'dark' ? 'white' : 'black'})`,
      '--primary-soft': `color-mix(in oklab, ${marca} 14%, ${fundo})`,
      '--ring': marca,
    },
    mode,
    visitorDecided: input.visitorMode === 'claro' || input.visitorMode === 'escuro',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O que o EDITOR deixa escolher
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As três cores que o editor da instituição oferece — e por que só três.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  FUNDO E TEXTO NÃO SÃO CAMPO DO EDITOR, E ISSO É A REGRA DESTA FATIA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Eles são os dois únicos papéis que PRECISAM mudar com o modo: um fundo claro
 *  com texto escuro é ilegível no escuro, e vice-versa. Se a instituição os
 *  escolhesse, a escolha dela teria de vencer o modo do visitante — que é
 *  exatamente o defeito que esta fatia existe para não ter (o visitante receberia
 *  uma página clara depois de pedir escuro).
 *
 *  Então o editor oferece a IDENTIDADE (a marca da casa) e deixa fundo e texto com
 *  a paleta do MODO — a mesma escala que a plataforma acabou de pintar. É a leitura
 *  literal da decisão do humano: a paleta é a identidade DENTRO do modo escolhido.
 *
 *  A consequência é dita na tela ("Fundo e texto seguem o modo"), porque campo que
 *  não existe e ninguém explica vira dúvida.
 */
export const TENANT_PALETTE_ROLES = [
  {
    key: 'primaryColor',
    label: 'Cor principal',
    hint: 'Botões, links e destaques. Vazio usa o azul institucional da plataforma.',
  },
  {
    key: 'secondaryColor',
    label: 'Cor secundária',
    hint: 'Faixas e superfícies de apoio.',
  },
  {
    key: 'accentColor',
    label: 'Cor de destaque',
    hint: 'Detalhes que precisam chamar atenção sem competir com a principal.',
  },
] as const;

export type TenantPaletteRole = (typeof TENANT_PALETTE_ROLES)[number]['key'];

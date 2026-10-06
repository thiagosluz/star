/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — O ESCOPO DE TEMA DA PÁGINA DO EVENTO
 *                                                       (FASE 69 · fatia 3 · E84)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA DURA DESTA FATIA, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O escopo do tema não publica só os `--ef-*`: ele publica TAMBÉM os papéis
 *  semânticos que os componentes do sistema leem lá dentro (`--muted-foreground`,
 *  `--card`, `--border`, …), presos ao MODO DO TEMA. Nenhuma tinta da plataforma
 *  volta a cair sobre a superfície que o ORGANIZADOR escolheu.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, E POR QUE PUBLICAR `--ef-*` NÃO BASTAVA (o mecanismo, medido)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `globals.css` declara os apelidos semânticos na RAIZ
 *  (`--muted-foreground: var(--ef-on-surface-variant)`, `--card: var(--ef-surface-lowest)`, …)
 *  e o CSS substitui `var()` **no elemento onde a declaração é feita**: sobrescrever
 *  um `--ef-*` num descendente NÃO re-resolve o apelido. É a MESMA armadilha que a
 *  FASE 64 documentou para a página da INSTITUIÇÃO (`--brand` publicado no escopo e
 *  a tela pintando a cor da raiz) — e aqui ela tem outra consequência, medida na
 *  FASE 66: os componentes do evento que escrevem `text-muted-foreground`,
 *  `bg-card` e `border-border` continuam lendo a escala do `<html>`, isto é, a do
 *  MODO DO VISITANTE, enquanto a superfície em volta é a do ORGANIZADOR.
 *
 *      organizador ESCURO + visitante claro ..... 2,10:1 sobre o fundo · 1,86:1 sobre o cartão
 *      organizador CLARO  + visitante escuro .... 1,62:1 sobre o fundo
 *
 *  (a primeira linha é a do levantamento; a segunda é a outra face do mesmo defeito,
 *  declarada no §8 do documento da FASE 66. O mínimo do AA para texto é 4,5:1.)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A TINTA NÃO PODE SEGUIR O MODO DO VISITANTE (e isso é medição, não gosto)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tentação é "deixar o visitante mandar também aqui". Não dá, e a razão é
 *  geométrica: a tinta tem de ser legível sobre a superfície **que o organizador
 *  escolheu**, e as tintas dos dois modos são OPOSTAS por construção — a clara é
 *  escura, a escura é clara (é a lição da dívida do token de aviso, FASE 52: "não
 *  existe um valor que sirva às duas superfícies"). Escolher a tinta pelo modo de
 *  quem visita é escolher a cor errada sempre que os dois modos divergirem — que é
 *  exatamente o defeito acima, com o sinal trocado.
 *
 *  Quem manda no modo desta página é o organizador (`resolveEventThemeMode`, ADR-325:
 *  a landing é um cartaz), e é a esse modo que os papéis ficam presos. O que o
 *  conserto garante é o que o levantamento pede em uma frase: **o modo do visitante
 *  não pinta mais nada dentro do tema** — ele governa a plataforma em volta (casco,
 *  cabeçalho, rodapé, área de conta), e não a superfície do outro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A RAMPA DA PLATAFORMA, E NÃO UMA MISTURA DAS CORES DO TEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É a forma que a FASE 64 usou para a INSTITUIÇÃO, aplicada ao caso em que ela não
 *  se resolve sozinha. Lá, os papéis que a instituição não escolhe (superfície, texto
 *  e contorno) continuam vindo da rampa da PLATAFORMA — e vêm certos por acidente
 *  feliz: `buildTenantThemeScope` faz o modo da página ser o do VISITANTE, então a
 *  rampa herdada já é a do modo efetivo. Aqui o modo efetivo é o do ORGANIZADOR, e a
 *  rampa herdada continua sendo a do visitante: o escopo precisa PUBLICAR a rampa do
 *  modo efetivo, que é o que a FASE 66 pediu em uma linha ("o tema publicar também os
 *  papéis semânticos (`card`, `border`, `muted-foreground`)").
 *
 *  Descartado: derivar os papéis da paleta do organizador com `color-mix` (o caminho
 *  do `.ef-muted`). Funciona, mas repinta o tema PADRÃO CLARO — o de quem não
 *  escolheu nada —, porque a mistura dá outro tom que o `--ef-on-surface-variant` da
 *  plataforma (`#464555` sobre `#f9f9ff` = 8,93:1; a mistura de 70% mede 7,00:1).
 *  Mudar o desenho de quem não tem defeito nenhum é consertar mais do que o defeito:
 *  no CLARO o par já passava (o defeito é de UM modo, como na FASE 66), e é por isso
 *  que o modo claro desta tabela é, valor a valor, a rampa do `:root` — o tema padrão
 *  claro não muda um pixel.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA TABELA É UMA CÓPIA — E POR QUE ISSO NÃO É "DUAS FONTES"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os valores existem no `globals.css` e precisam existir AQUI porque o escopo os
 *  publica no atributo `style` da página; não há como referenciá-los sem escrevê-los
 *  (o `--card` herdado já vem resolvido da raiz, e é justamente ele que está errado).
 *  O que impede a divergência não é a boa intenção: é a catraca
 *  `tests/unit/f69-contraste-do-tema-do-evento.test.ts`, que LÊ o `globals.css`,
 *  resolve as cadeias de `var()` do `:root` e do `.dark` e reprova papel por papel,
 *  modo por modo. Divergir deixa de ser possível em silêncio — a mesma régua da
 *  armadilha 101 ("a lista sai da FONTE ÚNICA e um teste catraca a prende").
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FICA DE FORA, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • **Marca** (`--primary`, `--brand`, `--ring`): a ação do evento já tem token
 *      próprio (`--theme-primary`, FASE 51 · E42) e nenhum componente dentro do tema
 *      lê `text-primary`/`bg-primary` — publicá-los aqui inventaria uma segunda
 *      identidade além da que o organizador escolheu;
 *    • **Pares de PREENCHIMENTO e de ESTADO** (`--primary-foreground` sobre
 *      `--primary`, `--success-strong` sobre `--surface-high`, a barra do "acontecendo
 *      agora"): preenchimento e superfície saem da MESMA rampa, então o par mantém a
 *      razão medida em qualquer modo (4,49:1 no claro) — trocar metade dele seria
 *      QUEBRAR o que hoje passa. A catraca prende as duas metades com número;
 *    • **`--popover`/`--popover-foreground`**: menu, gaveta e modal vivem no casco, não
 *      dentro do tema do evento. Publicá-los seria ampliar a superfície do conserto
 *      sem um leitor do outro lado.
 */
import {
  resolveEventThemeMode,
  themeToCssVariables,
  type ResolvedEventTheme,
} from '@/domain/events/landing-page';

/** Os dois modos que viram rampa. `auto` já foi resolvido antes de chegar aqui. */
export type EventPageThemeMode = 'light' | 'dark';

/**
 * OS PAPÉIS DE SUPERFÍCIE, TINTA E CONTORNO DA PLATAFORMA — por modo.
 *
 * Estes são os apelidos que o `globals.css` declara na RAIZ e que os componentes do
 * sistema leem sem prefixo. Cada valor abaixo é o que o `:root` (claro) e o `.dark`
 * (escuro) produzem depois de resolvidas as cadeias de `var()` — e é a catraca que
 * cobra isso, um a um.
 */
export const PAPEIS_DA_PLATAFORMA: Record<EventPageThemeMode, Record<string, string>> = {
  light: {
    '--background': '#f9f9ff',
    '--surface': '#f9f9ff',
    '--surface-low': '#f1f3ff',
    '--card': '#ffffff',
    '--card-foreground': '#181c24',
    '--foreground': '#181c24',
    '--muted': '#f1f3ff',
    '--muted-foreground': '#464555',
    '--accent': '#e5e8f4',
    '--accent-foreground': '#181c24',
    '--border': '#83808f',
    '--border-strong': '#777587',
    '--input': '#83808f',
    '--destructive': '#b91c1c',
  },
  dark: {
    '--background': '#17181e',
    '--surface': '#17181e',
    '--surface-low': '#1d1f26',
    '--card': '#23252d',
    '--card-foreground': '#e1e2ec',
    '--foreground': '#e1e2ec',
    '--muted': '#1d1f26',
    '--muted-foreground': '#c5c6d0',
    '--accent': '#2a2c35',
    '--accent-foreground': '#e1e2ec',
    '--border': '#7a7f8d',
    '--border-strong': '#8b90a1',
    '--input': '#7a7f8d',
    '--destructive': '#fca5a5',
  },
};

/** O que o `ThemeScope` injeta: os papéis prontos e o modo EFETIVO que os governa. */
export interface EventThemeScope {
  variables: Record<string, string>;
  /** Vai no `data-theme-mode` — é ele que governa os controles nativos. */
  mode: EventPageThemeMode;
}

/**
 * Traduz o tema do evento no escopo CSS da página.
 *
 * O modo é resolvido UMA vez, aqui, e acompanha as duas metades do mapa: os `--ef-*`
 * (que saem do modo declarado, como desde a FASE 61) e a rampa da plataforma daquele
 * modo. A única autoridade sobre claro/escuro continua sendo
 * `resolveEventThemeMode` — este módulo não inventa um quarto estado.
 *
 * O modo NÃO é parâmetro desta função, e isso é decisão: quem chama é a página do
 * organizador, e aceitar o modo do visitante aqui seria reabrir o defeito que a
 * fatia existe para fechar (ver o bloco longo do cabeçalho). Na página da
 * INSTITUIÇÃO o `visitorMode` entra porque lá o modo da página É o do visitante.
 */
export function buildEventThemeScope(input: { theme: ResolvedEventTheme }): EventThemeScope {
  const mode = resolveEventThemeMode(input.theme.colorMode);
  const variables: Record<string, string> = {
    ...themeToCssVariables(input.theme),
    ...PAPEIS_DA_PLATAFORMA[mode],
  };

  /**
   * A cor do evento também vira token DO SISTEMA (FASE 51 · E42): o crachá é
   * desenhado com a identidade do evento fora da página pública. Sem cor escolhida o
   * papel não é publicado e o token nasce na marca da plataforma (`globals.css`).
   */
  if (input.theme.primaryColor) {
    variables['--theme-primary'] = input.theme.primaryColor;
  }

  return { variables, mode };
}

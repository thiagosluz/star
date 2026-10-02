/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TEMA DA INTERFACE — a REGRA, e nada além dela (FASE 61 · dívida H3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A REGRA MORA SOZINHA, SEM `next/headers` E SEM `globals.css`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O valor do cookie chega de fora — de uma requisição, de um teste, de um
 *  formulário — e o que ele SIGNIFICA é aritmética de três palavras. Se a leitura
 *  do cookie e a interpretação do valor morassem no mesmo módulo, testar a regra
 *  exigiria levantar o Next inteiro; separadas, o portão unitário prova a regra
 *  sem infraestrutura (o mesmo raciocínio de `nav-mode.ts`, aplicado a uma decisão
 *  de interface). E a regra NÃO conhece cor: ela diz qual CLASSE e qual
 *  `color-scheme` acompanham a escolha, nunca qual é o tom — a escala escura é do
 *  `globals.css` (outro dono, outra fase).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `src/lib/theme/` E NÃO `src/lib/shell/`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A barra lateral é do CASCO autenticado (`src/lib/shell/`). O tema é do sistema
 *  inteiro: vale na página pública do evento, no `/conta` (que não tem casco), na
 *  tela de erro e na governança da plataforma. Guardá-lo junto do que é do shell
 *  criaria a impressão de que ele some quando o shell some — e ele não some.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PADRÃO É `sistema`, E ISSO É DELIBERADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cookie ausente, apagado, vazio, valor inventado à mão ou formato de uma versão
 *  futura caem TODOS no mesmo lugar: `sistema`. É a única resposta que não impõe
 *  uma preferência a quem nunca escolheu — quem já configurou o sistema
 *  operacional no escuro não recebe um clarão na cara na primeira visita, e quem
 *  usa o computador no claro não é empurrado para um tema que não pediu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Como o tema está desenhado nesta requisição. */
export type ThemeMode = 'claro' | 'escuro' | 'sistema';

/**
 * Os três valores, com o TIPO LITERAL preservado (`satisfies`, e não uma
 * anotação): é o literal que permite ao `switch` de `themeMarkup` saber que os
 * três casos cobrem a união inteira — com a anotação `: ThemeMode` o compilador
 * perde o literal e a exaustividade deixa de ser conferida.
 */
export const THEME_LIGHT = 'claro' satisfies ThemeMode;

/** Tema escuro, sempre — a classe `.dark` entra no `<html>`. */
export const THEME_DARK = 'escuro' satisfies ThemeMode;

/**
 * Segue o sistema operacional.
 *
 * É o valor de ORIGEM e o padrão de tudo: quem nunca escolheu não tem nada gravado,
 * e a decisão continua sendo de quem sabe — a `@media (prefers-color-scheme: dark)`
 * do `globals.css`.
 */
export const THEME_SYSTEM = 'sistema' satisfies ThemeMode;

/** Nome do cookie que guarda a preferência — mesma família de `ef_nav`/`ef_tenant`. */
export const THEME_COOKIE = 'ef_tema';

/**
 * Um ano: a preferência de tema é das mais estáveis que existem.
 *
 * Trinta dias (o prazo do layout da barra) obrigariam quem trabalha no escuro a
 * reescolher todo mês sem que nada tivesse mudado.
 */
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * As três opções, na ordem em que o controle as apresenta.
 *
 * É a FONTE ÚNICA da lista: o controle desenha esta ordem, a validação da Server
 * Action aceita exatamente estes valores, e um quarto modo no futuro passa a ser
 * uma linha aqui em vez de uma caçada a literais espalhados.
 */
export const THEME_MODES: readonly ThemeMode[] = [THEME_LIGHT, THEME_DARK, THEME_SYSTEM];

const MODOS_VALIDOS = new Set<string>(THEME_MODES);

/** Rótulo curto de cada opção, como aparece no controle. */
export const THEME_MODE_LABELS: Readonly<Record<ThemeMode, string>> = {
  claro: 'Claro',
  escuro: 'Escuro',
  sistema: 'Sistema',
};

/**
 * O que cada opção FAZ — a frase que responde "e se eu escolher isto?".
 *
 * Sem ela o controle obriga a pessoa a experimentar às cegas: "Sistema" não diz
 * nada sobre seguir o sistema operacional, e "Claro" não avisa que ele vence o
 * tema do computador.
 */
export const THEME_MODE_DESCRIPTIONS: Readonly<Record<ThemeMode, string>> = {
  claro: 'Sempre claro, mesmo que o seu sistema operacional esteja no escuro.',
  escuro: 'Sempre escuro, mesmo durante o dia.',
  sistema: 'Acompanha o tema do seu sistema operacional. É o padrão.',
};

/**
 * O valor é um dos três? Predicado de tipo, e não um `as ThemeMode` disfarçado.
 *
 * Quem chama ganha o estreitamento de graça, e o `Set` sai da MESMA lista que o
 * controle desenha — acrescentar um modo não exige lembrar de mexer aqui.
 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && MODOS_VALIDOS.has(value);
}

/**
 * Traduz o valor CRU do cookie (ou do `FormData`) no tema da interface.
 *
 * `unknown` de propósito: o valor vem de um cookie ou de um formulário, que são
 * texto vindo do cliente — qualquer coisa pode chegar aqui, e a função responde a
 * todas as hipóteses sem lançar e sem `any`.
 */
export function themeModeFromValue(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : THEME_SYSTEM;
}

/** Valor da propriedade CSS `color-scheme` — barras de rolagem e controles nativos. */
export type ThemeColorScheme = 'light' | 'dark' | 'light dark';

/**
 * O que cada escolha significa em TERMOS DE MARCAÇÃO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS REGRAS QUE NÃO PODEM SER CONFUNDIDAS
 * ─────────────────────────────────────────────────────────────────────────────
 *  • `dark` (a classe `.dark` do `globals.css`) entra **só** no escuro
 *    EXPLÍCITO. No modo `sistema` ela NÃO entra: quem responde ali é a `@media
 *    (prefers-color-scheme: dark)`, e escrever a classe resolveria a pergunta com
 *    a resposta errada — a página ficaria presa no escuro para sempre.
 *  • `dataTema` é escrito **sempre**, inclusive em `sistema`. É ele que diz ao CSS
 *    qual escolha a pessoa fez (para o claro explícito poder vencer a media query)
 *    e é ele que o E2E prende — um atributo que só existisse em dois dos três
 *    casos não permitiria distinguir "escolheu claro" de "não escolheu nada".
 *
 *  `colorScheme` acompanha porque nem tudo na página é CSS nosso: a barra de
 *  rolagem, o cursor de texto e os controles nativos são desenhados pelo
 *  navegador, e sem esta propriedade o formulário continuaria branco num tema
 *  escuro.
 */
export interface ThemeMarkup {
  /** A classe `.dark` (do `globals.css`) entra no `<html>`? */
  readonly dark: boolean;
  /** Valor do atributo `data-tema` — sempre presente. */
  readonly dataTema: ThemeMode;
  /** Valor da propriedade CSS `color-scheme` do `<html>`. */
  readonly colorScheme: ThemeColorScheme;
}

export function themeMarkup(mode: ThemeMode): ThemeMarkup {
  switch (mode) {
    case THEME_DARK:
      return { dark: true, dataTema: THEME_DARK, colorScheme: 'dark' };

    case THEME_LIGHT:
      return { dark: false, dataTema: THEME_LIGHT, colorScheme: 'light' };

    case THEME_SYSTEM:
      /**
       * `light dark` é a declaração de que a página ACEITA os dois: o navegador
       * escolhe pelo sistema operacional, exatamente como o CSS faz. Fixar
       * `light` aqui devolveria controles nativos claros dentro de uma página
       * escura.
       */
      return { dark: false, dataTema: THEME_SYSTEM, colorScheme: 'light dark' };
  }
}

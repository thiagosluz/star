/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 61 · dívida H3 — A PÁGINA PÚBLICA DO EVENTO É AUTOSSUFICIENTE EM TEMA
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A decisão da fase é "na página do evento quem manda é o organizador". Ela valia
 *  só para quem escolheu TODAS as cores: o CSS do evento (`event-theme.css`) tinha
 *  `--ef-background: var(--color-surface, …)`, `--ef-text: var(--color-on-surface, …)`
 *  e `--ef-primary: var(--color-primary, …)` — tokens da PLATAFORMA, que a escala
 *  escura redefine. Quem escolheu só a cor primária (ou declarou `colorMode: 'light'`)
 *  via a página pública escurecer junto com o painel.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CATRACA (o caso mais valioso deste arquivo)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O primeiro teste LÊ o CSS do evento e cruza cada `var(--…)` dele com o mapa que o
 *  `ThemeScope` injeta (`themeToCssVariables`). É isso que impede o furo de voltar:
 *  no dia em que alguém acrescentar uma cor ao CSS do evento — ou um fallback para
 *  um token da plataforma —, o papel não estará no mapa e este arquivo reprova.
 *  A única exceção declarada é a TIPOGRAFIA do produto, que não tem escala escura.
 *
 *  O resto do arquivo prende as duas metades da decisão:
 *    • o `colorMode` declarado é respeitado (`light` é claro mesmo com a plataforma
 *      escura; `dark` é escuro), e a cor escolhida nunca é substituída pelo padrão;
 *    • um tema COMPLETO produz exatamente os valores de antes desta entrega (a prova
 *      de que ninguém que já tinha escolhido tudo vê diferença).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EVENT_THEME_PALETTE,
  FONT_STACKS,
  resolveEventThemeMode,
  resolveTheme,
  themeToCssVariables,
  type ResolvedEventTheme,
} from '../../src/domain/events/landing-page';

const ROOT = process.cwd();
const CSS_DO_EVENTO = 'src/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

/**
 * Comentário não é código.
 *
 * O próprio cabeçalho do CSS cita `var(--color-surface, …)` para EXPLICAR o defeito
 * que deixou de existir. Ler comentário como estilo faria a catraca reprovar a
 * documentação da decisão — que é a armadilha que o `design-system-guard` já
 * documenta para o hexadecimal.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '');
}

const CSS = semComentarios(readFileSync(join(ROOT, CSS_DO_EVENTO), 'utf8'));

/** Todo papel `var(--nome…)` que o CSS do evento CONSOME, sem repetição. */
function papeisConsumidos(): string[] {
  const nomes = [...CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((achado) => achado[1]!);
  return [...new Set(nomes)].sort();
}

/** Todo papel que o CSS do evento DECLARA (`--nome: valor`), sem repetição. */
function papeisDeclarados(): string[] {
  const nomes = [...CSS.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/gm)].map((achado) => achado[1]!);
  return [...new Set(nomes)].sort();
}

/**
 * A tipografia do produto é a exceção, e ela é DECLARADA.
 *
 * `--font-display` e `--font-sans` não têm modo: a identidade do sistema é a mesma
 * escala escura ou clara, e é ela que faz a landing parecer do produto mesmo quando
 * o organizador escolhe outra paleta. Tudo o mais que o CSS do evento consumir tem
 * de vir do mapa — e é isso que o caso abaixo cobra.
 */
const TIPOGRAFIA_DO_PRODUTO = new Set(['--font-display', '--font-sans']);

/**
 * Os cinco papéis de COR do tema do evento — os únicos que a escala escura redefine
 * e, por isso, os únicos que podiam arrastar a página para o modo da plataforma.
 */
const PAPEIS_DE_COR = [
  '--ef-primary',
  '--ef-secondary',
  '--ef-accent',
  '--ef-background',
  '--ef-text',
] as const;

/** O tema completo de quem escolheu TUDO — usado na prova de não regressão. */
const TEMA_COMPLETO = {
  primaryColor: '#1d4ed8',
  secondaryColor: '#eef2ff',
  accentColor: '#0ea5e9',
  backgroundColor: '#fffdf5',
  textColor: '#1f2937',
  colorMode: 'light',
  radius: 20,
  fontFamily: 'serif',
  spacing: 'spacious',
  heroStyle: 'image',
  animation: 'none',
} as const;

/**
 * Os temas que o mapa precisa saber fechar, um por estado de escolha.
 *
 * "Sem nada escolhido" e "só a primária" são os dois casos do relato — e são
 * justamente os que o mapa antigo deixava cair no token da plataforma.
 */
const TEMAS: { nome: string; tema: ResolvedEventTheme }[] = [
  { nome: 'nada escolhido', tema: resolveTheme({}).theme },
  { nome: 'só a primária', tema: resolveTheme({ primaryColor: '#b91c1c' }).theme },
  { nome: 'completo claro', tema: resolveTheme(TEMA_COMPLETO).theme },
  { nome: 'completo escuro', tema: resolveTheme({ ...TEMA_COMPLETO, colorMode: 'dark' }).theme },
  { nome: 'automático', tema: resolveTheme({ ...TEMA_COMPLETO, colorMode: 'auto' }).theme },
];

describe('FASE 61 · o mapa fecha TODOS os papéis que o CSS do evento consome', () => {
  it('todo `var()` do CSS do evento é definido pelo mapa, em todo estado de escolha', () => {
    const violacoes: string[] = [];

    for (const papel of papeisConsumidos()) {
      if (TIPOGRAFIA_DO_PRODUTO.has(papel)) continue;

      for (const { nome, tema } of TEMAS) {
        if (!themeToCssVariables(tema)[papel]) {
          violacoes.push(`${papel} — consumido pelo CSS do evento e AUSENTE do mapa (${nome})`);
        }
      }
    }

    expect(
      violacoes,
      `\nEstes papéis do CSS do evento não são definidos pelo organizador — o \`var()\` cai no token\n` +
        `da plataforma e a página escurece junto com o painel. Feche o mapa em\n` +
        `themeToCssVariables() (src/domain/events/landing-page.ts):\n${violacoes.join('\n')}\n`,
    ).toEqual([]);
  });

  it('a exceção de tipografia é usada de verdade — a lista não pode apodrecer', () => {
    /**
     * Exceção registrada para papel que ninguém consome é dívida fantasma: ela
     * afrouxa a catraca para um nome que já não existe e esconde o próximo papel
     * que entrar com o mesmo nome.
     */
    const consumidos = new Set(papeisConsumidos());

    for (const papel of TIPOGRAFIA_DO_PRODUTO) {
      expect(consumidos.has(papel), `${papel}: exceção declarada e não consumida`).toBe(true);
    }
  });

  it('o CSS do evento NÃO declara `--ef-*`: a fonte única é o mapa', () => {
    /**
     * Declarar de novo no CSS criaria DUAS fontes da mesma cor — e a do CSS venceria
     * em qualquer superfície renderizada fora do `ThemeScope`. O mapa é a única
     * fonte, e é o que permite a catraca acima dizer "todo papel consumido aqui é
     * definido lá".
     */
    expect(papeisDeclarados()).toEqual([]);
  });

  it('nenhum PAPEL DE COR do mapa é uma referência — não há ponte para a plataforma', () => {
    /**
     * `var()` no valor de uma COR devolveria a dependência que esta entrega remove: um
     * mapa que publica `var(--color-surface)` é o mesmo defeito escrito de outro jeito.
     * O valor tem de ser o LITERAL do tema do evento.
     *
     * `--ef-font-sans` fica de fora, e não por conveniência: ele aponta para as
     * variáveis do `next/font` (`--font-inter`, `--font-geist-sans`), que são
     * tipografia e não têm modo — não existe escala escura de fonte. É a mesma
     * exceção declarada no caso acima, agora com o motivo escrito ao lado.
     */
    for (const { nome, tema } of TEMAS) {
      const vars = themeToCssVariables(tema);

      for (const papel of PAPEIS_DE_COR) {
        const valor = vars[papel]!;

        expect(valor, `${papel} (${nome})`).not.toContain('var(');
        expect(valor, `${papel} (${nome})`).not.toContain('--color-');
      }
    }
  });
});

describe('FASE 61 · o colorMode declarado é respeitado', () => {
  it('`light` declarado rende a paleta CLARA — a plataforma escura não a alcança', () => {
    const claro = themeToCssVariables(resolveTheme({ colorMode: 'light' }).theme);

    /**
     * O valor tem de ser o literal do tema (o mesmo que o CSS do evento usava como
     * fallback), e não a superfície escura da plataforma (`#17181e`) nem a clara
     * redefinida por ela. É esta igualdade que a página clara depende para continuar
     * clara dentro de um painel escuro.
     */
    expect(claro['--ef-background']).toBe(EVENT_THEME_PALETTE.light.background);
    expect(claro['--ef-text']).toBe(EVENT_THEME_PALETTE.light.text);
    expect(claro['--ef-secondary']).toBe(EVENT_THEME_PALETTE.light.secondary);
    expect(claro['--ef-primary']).toBe(EVENT_THEME_PALETTE.light.primary);
    expect(Object.values(claro)).not.toContain(EVENT_THEME_PALETTE.dark.background);
    expect(Object.values(claro)).not.toContain(EVENT_THEME_PALETTE.dark.text);
  });

  it('`dark` declarado rende a paleta ESCURA — quem escolheu foi o organizador', () => {
    const escuro = themeToCssVariables(resolveTheme({ colorMode: 'dark' }).theme);

    expect(escuro['--ef-background']).toBe(EVENT_THEME_PALETTE.dark.background);
    expect(escuro['--ef-text']).toBe(EVENT_THEME_PALETTE.dark.text);
    expect(escuro['--ef-secondary']).toBe(EVENT_THEME_PALETTE.dark.secondary);
    expect(Object.values(escuro)).not.toContain(EVENT_THEME_PALETTE.light.background);
  });

  it('`auto` e o não declarado rendem o CLARO: quem manda é o organizador, não o visitante', () => {
    /**
     * O não declarado já resolve para `light` no schema — e é a resposta certa: seguir
     * o sistema operacional de quem visita inverteria a decisão de terceiro.
     *
     * `auto` rende o claro pelo mesmo motivo, e por um motivo de cascata: o mapa
     * escreve no atributo `style`, que vence qualquer regra de classe (inclusive
     * dentro de uma media query). Enquanto o mapa publica todos os papéis, a media
     * query não tem como trocar a paleta.
     */
    expect(resolveTheme({}).theme.colorMode).toBe('light');
    expect(resolveEventThemeMode('light')).toBe('light');
    expect(resolveEventThemeMode('dark')).toBe('dark');
    expect(resolveEventThemeMode('auto')).toBe('light');
    expect(themeToCssVariables(resolveTheme({ colorMode: 'auto' }).theme)['--ef-background']).toBe(
      EVENT_THEME_PALETTE.light.background,
    );
  });

  it('a cor ESCOLHIDA nunca é substituída pelo padrão do modo', () => {
    const vars = themeToCssVariables(resolveTheme({ ...TEMA_COMPLETO, colorMode: 'dark' }).theme);

    expect(vars['--ef-primary']).toBe(TEMA_COMPLETO.primaryColor);
    expect(vars['--ef-secondary']).toBe(TEMA_COMPLETO.secondaryColor);
    expect(vars['--ef-accent']).toBe(TEMA_COMPLETO.accentColor);
    expect(vars['--ef-background']).toBe(TEMA_COMPLETO.backgroundColor);
    expect(vars['--ef-text']).toBe(TEMA_COMPLETO.textColor);
  });
});

describe('FASE 61 · quem já escolheu todas as cores não vê diferença', () => {
  it('um tema completo produz EXATAMENTE os valores de antes desta entrega', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA (o "antes" é o mapa da FASE 60, transcrito aqui)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O mapa antigo publicava as três variáveis estruturais e, para cada cor
     *  ESCOLHIDA, a sua variável — sem nenhum valor padrão. Para um tema completo a
     *  saída era, portanto, esta. O mapa novo só acrescenta `?? padrão` em papéis que
     *  o organizador NÃO escolheu; com tudo escolhido, o padrão nunca é alcançado e a
     *  saída tem de ser idêntica, chave por chave.
     */
    const vars = themeToCssVariables(resolveTheme(TEMA_COMPLETO).theme);

    expect(vars).toEqual({
      '--ef-radius': '20px',
      '--ef-font-sans': FONT_STACKS.serif,
      '--ef-spacing-scale': '1.35',
      '--ef-primary': '#1d4ed8',
      '--ef-secondary': '#eef2ff',
      '--ef-accent': '#0ea5e9',
      '--ef-background': '#fffdf5',
      '--ef-text': '#1f2937',
    });
  });

  it('o que ele NÃO escolheu recebe o padrão do modo declarado, e não o do outro modo', () => {
    /**
     * É o outro lado da prova acima: com UMA cor escolhida, os quatro papéis restantes
     * saem do padrão do modo (`dark`, no caso), sem tocar em nenhum valor do claro.
     */
    const vars = themeToCssVariables(
      resolveTheme({ primaryColor: '#b91c1c', colorMode: 'dark' }).theme,
    );

    expect(vars['--ef-primary']).toBe('#b91c1c');
    expect(vars['--ef-secondary']).toBe(EVENT_THEME_PALETTE.dark.secondary);
    expect(vars['--ef-accent']).toBe(EVENT_THEME_PALETTE.dark.accent);
    expect(vars['--ef-background']).toBe(EVENT_THEME_PALETTE.dark.background);
    expect(vars['--ef-text']).toBe(EVENT_THEME_PALETTE.dark.text);
    expect(Object.values(vars)).not.toContain(EVENT_THEME_PALETTE.light.background);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 69 · fatia 3 · E84 — A TINTA DA PLATAFORMA DENTRO DO TEMA DO EVENTO
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DE ONDE ESTE ARQUIVO NASCEU (de dois números, medidos na FASE 66)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A varredura da família da FASE 66 fechou a opacidade e deixou UMA metade aberta,
 *  com o número na mão: os componentes do tema ainda leem a escala do `<html>`
 *  (`text-muted-foreground`, `bg-card`, `border-border`), e a escala do `<html>` é a
 *  do MODO DO VISITANTE, não a do organizador. Medido, no navegador:
 *
 *      organizador ESCURO + visitante claro ... 2,10:1 sobre o fundo · 1,86:1 no cartão
 *      organizador CLARO  + visitante escuro .. 1,62:1 sobre o fundo
 *
 *  contra os 4,5:1 do AA para texto pequeno. O conserto está em
 *  `src/domain/events/event-page-theme-rules.ts` (o escopo publica os apelidos da
 *  plataforma no modo do TEMA) e este arquivo é a catraca dele: o par nos dois modos,
 *  a cópia da rampa do `globals.css` presa valor a valor, a identidade do organizador
 *  e a varredura das superfícies que vivem dentro do tema.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RÉGUA É A DA CASA, E A CONTA DA MISTURA É A DA FASE 65/66
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `paraRgb`/`razaoDeContraste` (domínio) para a razão do WCAG, e a conta do
 *  `color-mix(in oklab, …)` — o mesmo caminho que a FASE 65 prendeu em
 *  `f65-acontecendo-agora.test.ts` e a FASE 66 repetiu. Aqui ela é duplicada DE
 *  PROPÓSITO, pela mesma razão declarada lá: uma fase posterior não reescreve a régua
 *  de quem veio antes.
 *
 *  Os valores do NAVEGADOR estão presos abaixo (`MEDIDO_NO_NAVEGADOR`): foram lidos
 *  com `getComputedStyle` num evento real servido pelo container, ANTES e DEPOIS da
 *  correção, nas duas paletas do tema e nos dois estados do visitante.
 */
import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EVENT_THEME_PALETTE, resolveTheme } from '@/domain/events/landing-page';
import {
  PAPEIS_DA_PLATAFORMA,
  buildEventThemeScope,
  type EventPageThemeMode,
} from '@/domain/events/event-page-theme-rules';
import { paraRgb, razaoDeContraste } from '@/domain/tenancy/tenant-page-theme-rules';

type Rgb = NonNullable<ReturnType<typeof paraRgb>>;

const MODOS: readonly EventPageThemeMode[] = ['light', 'dark'];

// ═══════════════════════════════════════════════════════════════════════════════
//  A RÉGUA — RGB, a mistura do `color-mix(in oklab, …)` e a razão do WCAG
// ═══════════════════════════════════════════════════════════════════════════════

function linearizar(canal: number): number {
  const s = canal / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function codificar(valor: number): number {
  const s = valor <= 0.0031308 ? 12.92 * valor : 1.055 * valor ** (1 / 2.4) - 0.055;

  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

function paraOklab(cor: Rgb): { L: number; a: number; b: number } {
  const r = linearizar(cor.r);
  const g = linearizar(cor.g);
  const b = linearizar(cor.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function paraSrgb(lab: { L: number; a: number; b: number }): Rgb {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;

  return {
    r: codificar(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: codificar(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: codificar(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function corDoCss(valor: string): Rgb {
  const rgb = paraRgb(valor);

  if (!rgb) throw new Error(`o domínio não sabe ler a cor: ${valor}`);

  return rgb;
}

function misturarOklab(uma: string, outra: string, pesoDaPrimeira: number): Rgb {
  const a = paraOklab(corDoCss(uma));
  const b = paraOklab(corDoCss(outra));

  return paraSrgb({
    L: a.L * pesoDaPrimeira + b.L * (1 - pesoDaPrimeira),
    a: a.a * pesoDaPrimeira + b.a * (1 - pesoDaPrimeira),
    b: a.b * pesoDaPrimeira + b.b * (1 - pesoDaPrimeira),
  });
}

function paraHex(cor: Rgb): string {
  const canal = (valor: number) =>
    Math.max(0, Math.min(255, Math.round(valor)))
      .toString(16)
      .padStart(2, '0');

  return `#${canal(cor.r)}${canal(cor.g)}${canal(cor.b)}`;
}

function contraste(uma: Rgb, outra: Rgb): number {
  const razao = razaoDeContraste(paraHex(uma), paraHex(outra));

  if (razao === null) throw new Error('razão indeterminada entre duas cores resolvidas');

  return Math.round(razao * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AS FONTES — o CSS da plataforma, o do tema e os arquivos que vivem no tema
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * O CSS SEM COMENTÁRIOS, com o número da linha preservado (os comentários viram
 * espaços): o recorte de bloco conta chaves, e o cabeçalho deste projeto cita chaves e
 * `:root` no TEXTO — procurar seletor dentro de comentário daria o recorte errado.
 */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, (achado) => achado.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');
}

const GLOBALS = semComentarios(readFileSync('src/app/globals.css', 'utf8'));
const CSS_DO_EVENTO = semComentarios(
  readFileSync('src/app/t/[tenantSlug]/(public)/eventos/event-theme.css', 'utf8'),
);

/** Recorta um bloco do CSS contando chaves — `indexOf('}')` pararia num `color-mix(...)`. */
function recortarBloco(fonte: string, seletor: string): string {
  const inicio = fonte.indexOf(seletor);
  if (inicio === -1) throw new Error(`bloco não encontrado: ${seletor}`);

  let profundidade = 0;

  for (let i = fonte.indexOf('{', inicio); i < fonte.length; i += 1) {
    if (fonte[i] === '{') profundidade += 1;
    if (fonte[i] === '}') {
      profundidade -= 1;
      if (profundidade === 0) return fonte.slice(fonte.indexOf('{', inicio) + 1, i);
    }
  }

  throw new Error(`bloco sem fim: ${seletor}`);
}

/** As declarações `--nome: valor` de um bloco, na ordem em que aparecem. */
function declaracoes(bloco: string): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const achado of bloco.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    mapa.set(achado[1]!, achado[2]!.trim());
  }

  return mapa;
}

const PALETA_CRUA = {
  light: declaracoes(recortarBloco(GLOBALS, '\n:root {')),
  dark: declaracoes(recortarBloco(GLOBALS, '\n.dark {')),
} as const;

/**
 * O valor EFETIVO de um papel no modo pedido.
 *
 * A resolução é a do NAVEGADOR: o `.dark` redefine a paleta CRUA, e o apelido —
 * declarado no `:root` — resolve contra ela. Um `var()` que não seja um `--ef-*`
 * (ou que tenha mais de um passo) sai como veio: é o bastante para os papéis desta
 * catraca, e um valor inesperado faz o teste reprovar em vez de passar em silêncio.
 */
function resolver(papel: string, modo: EventPageThemeMode, saltos = 0): string | null {
  if (saltos > 4) return null;

  const bruto = modo === 'dark' ? (PALETA_CRUA.dark.get(papel) ?? PALETA_CRUA.light.get(papel)) : PALETA_CRUA.light.get(papel);

  if (!bruto) return null;

  const referencia = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(bruto);

  return referencia ? resolver(referencia[1]!, modo, saltos + 1) : bruto;
}

/** O peso da tinta do `.ef-card`, LIDO do CSS — não repetido aqui. */
function pesoDoCartao(): number {
  const achado = /color-mix\(in oklab, var\(--ef-background\)\s+([\d.]+)%,\s*var\(--ef-text\)/.exec(
    recortarBloco(CSS_DO_EVENTO, '\n.ef-card {'),
  );

  if (!achado?.[1]) throw new Error('o `.ef-card` não declara a mistura esperada');

  return Number.parseFloat(achado[1]) / 100;
}

/** O fundo do CARTÃO do tema — a outra superfície onde a tinta é desenhada. */
function fundoDoCartaoDoTema(modo: EventPageThemeMode): Rgb {
  const tema = EVENT_THEME_PALETTE[modo];

  return misturarOklab(tema.background, tema.text, pesoDoCartao());
}

/**
 * O QUE O ESCOPO PUBLICA — a régua das medições deste arquivo.
 *
 * Os casos de contraste e os números do navegador saem DAQUI, e não da tabela: quem
 * pinta a tela é o mapa que a `ThemeScope` injeta, e uma catraca que medisse a tabela
 * passaria com o escopo deixando de publicá-la (o defeito de volta, verde). Foi a
 * primeira versão deste arquivo, e a mutação do §6 do relatório mostrou o buraco.
 */
function publicado(modo: EventPageThemeMode): Record<string, string> {
  return buildEventThemeScope({ theme: resolveTheme({ colorMode: modo }).theme }).variables;
}

/** Um papel publicado, com erro explícito quando ele não existe — nunca `undefined` calado. */
function papelPublicado(modo: EventPageThemeMode, papel: string): string {
  const valor = publicado(modo)[papel];

  if (!valor) throw new Error(`o escopo não publica ${papel} no modo ${modo}`);

  return valor;
}

/** O mesmo, mas devolvendo `null` — quem pergunta "existe?" não pode lançar. */
function papelPublicadoOuNulo(modo: EventPageThemeMode, papel: string): string | null {
  return publicado(modo)[papel] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  O QUE O NAVEGADOR COMPUTOU — `getComputedStyle`, no container, com o evento real
// ═══════════════════════════════════════════════════════════════════════════════
/**
 *  A tela medida é a aba "Acontecendo agora" (`?aba=agora`, com uma atividade em
 *  curso), que é onde vivem os dois nós da família: a legenda da seção
 *  (`text-muted-foreground`) e o cartão do tema (`.ef-card`).
 *
 *  ANTES (o escopo publicava só os `--ef-*`; os apelidos vinham do `<html>`):
 *
 *      organizador claro  · visitante claro .... 8,93:1 no fundo · 7,45:1 no cartão
 *      organizador claro  · visitante ESCURO ... 1,62:1 no fundo · 1,35:1 no cartão
 *      organizador ESCURO · visitante claro .... 2,10:1 no fundo · 1,86:1 no cartão
 *      organizador escuro · visitante escuro ... 11,59:1 no fundo · 10,28:1 no cartão
 *
 *  DEPOIS (o escopo publica a rampa do modo do TEMA — os quatro casos passam, e os
 *  dois "visitante" de cada modo dão o MESMO número: a tela deixou de depender dele):
 *
 *      organizador claro  (qualquer visitante) . 8,93:1 no fundo · 7,45:1 no cartão
 *      organizador escuro (qualquer visitante) . 11,59:1 no fundo · 10,28:1 no cartão
 *
 *  E o `--card` da plataforma, que é a superfície do cartão `bg-card`: `#ffffff` no
 *  modo claro e `#23252d` no escuro — o que o escopo publica agora é a rampa do modo
 *  do organizador, e não a do visitante.
 */
const MEDIDO_NO_NAVEGADOR = {
  light: { sobreOFundo: 8.93, sobreOCartao: 7.45, textoMudo: '#464555', cartaoDaPlataforma: '#ffffff' },
  dark: { sobreOFundo: 11.59, sobreOCartao: 10.28, textoMudo: '#c5c6d0', cartaoDaPlataforma: '#23252d' },
  defeito: { escuroSobreOFundoEscuro: 2.1, escuroSobreOCartaoEscuro: 1.86, claroSobreOFundoClaro: 1.62 },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
//  (1) A CÓPIA DA RAMPA — o que impede a tabela de divergir do `globals.css`
// ═══════════════════════════════════════════════════════════════════════════════
describe('a rampa publicada pelo escopo é a do globals.css', () => {
  it('cada papel, nos dois modos, é o valor que o CSS resolve — valor a valor', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTA CÓPIA EXISTE, E POR QUE ELA NÃO É "DUAS FONTES"
     * ─────────────────────────────────────────────────────────────────────────────
     *  O escopo precisa PUBLICAR os apelidos no atributo `style` (o herdado já vem
     *  resolvido da raiz, e é ele que está errado) — não há como referenciá-los. O que
     *  impede a divergência não é a boa intenção: é este caso, que lê o `globals.css`,
     *  resolve as cadeias de `var()` do `:root` e do `.dark` e compara um a um. É a
     *  régua da armadilha 101: a lista sai da fonte única e uma catraca a prende.
     */
    const divergencias: string[] = [];

    for (const modo of MODOS) {
      for (const [papel, valor] of Object.entries(PAPEIS_DA_PLATAFORMA[modo])) {
        const doCss = resolver(papel, modo);

        if (doCss === null) {
          divergencias.push(`${papel} (${modo}) — não é um apelido declarado no globals.css`);
          continue;
        }

        if (doCss.toLowerCase() !== valor.toLowerCase()) {
          divergencias.push(`${papel} (${modo}) — tabela ${valor} × globals.css ${doCss}`);
        }
      }
    }

    expect(
      divergencias,
      `A rampa da plataforma publicada pelo escopo divergiu do globals.css:\n${divergencias.join('\n')}\n`,
    ).toEqual([]);
  });

  it('a tabela publica só apelidos — nenhum `--ef-*` (a identidade é do organizador)', () => {
    /**
     * O prefixo `--ef-` é o do TEMA DO EVENTO (`--ef-primary`, `--ef-background`, …).
     * Um papel da plataforma com esse prefixo entraria na frente da escolha do
     * organizador em silêncio: `--ef-primary` existe nos DOIS vocabulários, e é
     * exatamente esse o encontro que a fase precisa deixar impossível.
     */
    for (const modo of MODOS) {
      for (const papel of Object.keys(PAPEIS_DA_PLATAFORMA[modo])) {
        expect(papel, `papel do escopo no modo ${modo}`).not.toMatch(/^--ef-/);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (2) O PAR — a tinta secundária sobre as duas superfícies do tema
// ═══════════════════════════════════════════════════════════════════════════════
describe('a tinta secundária dentro do tema passa o AA nos dois modos', () => {
  it('o `--muted-foreground` publicado passa sobre o FUNDO e sobre o CARTÃO', () => {
    for (const modo of MODOS) {
      const tema = EVENT_THEME_PALETTE[modo];
      const tinta = corDoCss(papelPublicado(modo, '--muted-foreground'));

      expect(
        contraste(tinta, corDoCss(tema.background)),
        `o texto secundário sobre a --ef-background do tema no modo ${modo}`,
      ).toBeGreaterThanOrEqual(4.5);

      expect(
        contraste(tinta, fundoDoCartaoDoTema(modo)),
        `o texto secundário sobre o .ef-card do tema no modo ${modo}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('o texto secundário sobre o CARTÃO da plataforma (`bg-card`) também passa', () => {
    /**
     * A outra superfície da família: o cartão do "acontecendo agora" (`bg-card`) e o
     * cartão da galeria usam o `--card` da plataforma, que o escopo passou a publicar
     * no modo do organizador. Sem este caso, um `--card` correto e uma tinta errada
     * (ou o contrário) passariam — o par é que é a pergunta.
     */
    for (const modo of MODOS) {
      const tinta = corDoCss(papelPublicado(modo, '--muted-foreground'));
      const cartao = corDoCss(papelPublicado(modo, '--card'));

      expect(
        contraste(tinta, cartao),
        `o texto secundário sobre o --card da plataforma no modo ${modo}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('os números que o NAVEGADOR computou estão presos — depois, nos dois modos', () => {
    for (const modo of MODOS) {
      const tinta = corDoCss(papelPublicado(modo, '--muted-foreground'));
      const medido = MEDIDO_NO_NAVEGADOR[modo];

      expect(paraHex(tinta), `a tinta do modo ${modo}`).toBe(medido.textoMudo);
      expect(papelPublicado(modo, '--card').toLowerCase()).toBe(medido.cartaoDaPlataforma);
      expect(
        contraste(tinta, corDoCss(EVENT_THEME_PALETTE[modo].background)),
        `sobre o fundo do tema no modo ${modo} (getComputedStyle)`,
      ).toBe(medido.sobreOFundo);
      expect(
        contraste(tinta, fundoDoCartaoDoTema(modo)),
        `sobre o .ef-card do tema no modo ${modo} (getComputedStyle)`,
      ).toBe(medido.sobreOCartao);
    }

    /** E o fundo do cartão do tema é o hexadecimal que o navegador pintou. */
    expect(paraHex(fundoDoCartaoDoTema('light'))).toBe('#e4e5eb');
    expect(paraHex(fundoDoCartaoDoTema('dark'))).toBe('#171a1e');
  });

  it('o DEFEITO, medido: a tinta do OUTRO modo desaba no fundo do organizador', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  ESTE CASO É O QUE IMPEDE A VOLTA AO DE ANTES
     * ─────────────────────────────────────────────────────────────────────────────
     *  Ele reproduz o mecanismo exato (o apelido vindo do `<html>` em vez do escopo),
     *  com o número do levantamento: o `--ef-on-surface-variant` de um modo sobre a
     *  superfície do outro. Antes da correção os quatro casos abaixo eram a TELA; hoje
     *  são a prova de que a tela não pode voltar a ser isso sem alguém ver.
     */
    const tintaClara = resolver('--ef-on-surface-variant', 'light')!;
    const tintaEscura = resolver('--ef-on-surface-variant', 'dark')!;

    expect(tintaClara).toBe('#464555');
    expect(tintaEscura).toBe('#c5c6d0');

    const fundoEscuro = corDoCss(EVENT_THEME_PALETTE.dark.background);
    const fundoClaro = corDoCss(EVENT_THEME_PALETTE.light.background);

    expect(
      contraste(corDoCss(tintaClara), fundoEscuro),
      'a tinta clara da plataforma sobre a --ef-background do tema escuro (o defeito da F66)',
    ).toBe(MEDIDO_NO_NAVEGADOR.defeito.escuroSobreOFundoEscuro);
    expect(contraste(corDoCss(tintaClara), fundoDoCartaoDoTema('dark'))).toBe(
      MEDIDO_NO_NAVEGADOR.defeito.escuroSobreOCartaoEscuro,
    );
    expect(
      contraste(corDoCss(tintaEscura), fundoClaro),
      'a outra face: a tinta escura da plataforma sobre o tema claro',
    ).toBe(MEDIDO_NO_NAVEGADOR.defeito.claroSobreOFundoClaro);

    for (const razao of [
      contraste(corDoCss(tintaClara), fundoEscuro),
      contraste(corDoCss(tintaClara), fundoDoCartaoDoTema('dark')),
      contraste(corDoCss(tintaEscura), fundoClaro),
    ]) {
      expect(razao, 'o defeito é REPROVADO pelo AA — e é por isso que ele é defeito').toBeLessThan(
        4.5,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (3) A IDENTIDADE — a paleta que o organizador escolheu continua vencendo
// ═══════════════════════════════════════════════════════════════════════════════
describe('a identidade do organizador continua pintando', () => {
  const ESCOLHIDAS = {
    primaryColor: '#7b2ff7',
    secondaryColor: '#eef2ff',
    accentColor: '#0ea5e9',
    backgroundColor: '#fffdf5',
    textColor: '#1f2937',
  } as const;

  it('as cores escolhidas saem do escopo como ele as escolheu, nos dois modos', () => {
    for (const colorMode of ['light', 'dark', 'auto'] as const) {
      const theme = resolveTheme({ ...ESCOLHIDAS, colorMode }).theme;
      const { variables } = buildEventThemeScope({ theme });

      expect(variables['--ef-primary'], `primária (${colorMode})`).toBe(ESCOLHIDAS.primaryColor);
      expect(variables['--ef-secondary']).toBe(ESCOLHIDAS.secondaryColor);
      expect(variables['--ef-accent']).toBe(ESCOLHIDAS.accentColor);
      expect(variables['--ef-background']).toBe(ESCOLHIDAS.backgroundColor);
      expect(variables['--ef-text']).toBe(ESCOLHIDAS.textColor);
    }
  });

  it('os papéis da plataforma ACRESCENTAM — nunca sobrescrevem um `--ef-*`', () => {
    /**
     * O encontro perigoso é `--ef-primary`, que existe nos dois vocabulários (a paleta
     * crua da plataforma e o tema do evento). O escopo monta os `--ef-*` primeiro e a
     * rampa depois: se alguém puser um `--ef-*` na tabela, a escolha do organizador
     * perde para a plataforma e este caso reprova dizendo qual papel fez isso.
     */
    const theme = resolveTheme({ ...ESCOLHIDAS, colorMode: 'dark' }).theme;
    const { variables } = buildEventThemeScope({ theme });

    for (const [papel, valor] of Object.entries(PAPEIS_DA_PLATAFORMA.dark)) {
      expect(variables[papel], `${papel} no escopo`).toBe(valor);
      expect(papel.startsWith('--ef-'), `${papel} não é papel de plataforma`).toBe(false);
    }

    expect(variables['--ef-primary']).toBe(ESCOLHIDAS.primaryColor);
    expect(variables['--ef-background']).toBe(ESCOLHIDAS.backgroundColor);
    expect(variables['--theme-primary'], 'a cor do evento fora da página (E42)').toBe(
      ESCOLHIDAS.primaryColor,
    );
  });

  it('sem cor escolhida o `--theme-primary` não é publicado (o token nasce na marca)', () => {
    const { variables } = buildEventThemeScope({ theme: resolveTheme({}).theme });

    expect(variables['--theme-primary']).toBeUndefined();
    expect(variables['--ef-primary']).toBe(EVENT_THEME_PALETTE.light.primary);
  });

  it('o mapa do evento é o MESMO de antes — o escopo só acrescenta papéis', () => {
    /**
     * A prova de que a fatia não mexeu no que a FASE 61 entregou: para o tema que a
     * catraca `f61-tema-do-evento` prende, os papéis `--ef-*` continuam sendo
     * exatamente os doze... os nove de sempre. O que esta fase acrescenta é o que vem
     * DEPOIS deles.
     */
    const theme = resolveTheme({ ...ESCOLHIDAS, colorMode: 'dark' }).theme;
    const { variables } = buildEventThemeScope({ theme });

    expect(variables['--ef-radius']).toBe('12px');
    expect(variables['--ef-spacing-scale']).toBe('1');
    expect(Object.keys(variables).filter((papel) => papel.startsWith('--ef-')).sort()).toEqual([
      '--ef-accent',
      '--ef-background',
      '--ef-font-sans',
      '--ef-primary',
      '--ef-radius',
      '--ef-secondary',
      '--ef-spacing-scale',
      '--ef-text',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (4) O MODO — quem decide a rampa é o organizador, e o `data-theme-mode` diz qual
// ═══════════════════════════════════════════════════════════════════════════════
describe('o modo publicado é o do organizador', () => {
  it('`light`/`dark`/`auto` rendem a rampa do modo declarado — e o atributo acompanha', () => {
    for (const [colorMode, esperado] of [
      ['light', 'light'],
      ['dark', 'dark'],
      ['auto', 'light'],
    ] as const) {
      const { mode, variables } = buildEventThemeScope({
        theme: resolveTheme({ colorMode }).theme,
      });

      expect(mode, `modo efetivo de ${colorMode}`).toBe(esperado);
      expect(variables['--muted-foreground']).toBe(PAPEIS_DA_PLATAFORMA[esperado]['--muted-foreground']);
    }
  });

  it('a rampa NÃO é a do outro modo — o defeito não volta pela porta dos fundos', () => {
    const claro = buildEventThemeScope({ theme: resolveTheme({ colorMode: 'light' }).theme });
    const escuro = buildEventThemeScope({ theme: resolveTheme({ colorMode: 'dark' }).theme });

    expect(claro.variables['--muted-foreground']).toBe('#464555');
    expect(escuro.variables['--muted-foreground']).toBe('#c5c6d0');
    expect(escuro.variables['--card']).toBe('#23252d');
    expect(claro.variables['--card']).toBe('#ffffff');
  });

  it('a página usa o escopo do domínio — nenhuma segunda montagem no componente', () => {
    /**
     * A montagem mora em UM lugar. Se o componente voltar a chamar `themeToCssVariables`
     * (ou a publicar a rampa por conta própria), a catraca acima passa a medir uma
     * função que a tela não usa — que é meia catraca.
     */
    const fonte = semComentarios(
      readFileSync('src/components/events/theme-scope.tsx', 'utf8'),
    ).replace(/\/\*[\s\S]*?\*\//g, '');

    expect(fonte).toContain('buildEventThemeScope');
    expect(fonte, 'o componente não monta o mapa por conta própria').not.toContain(
      'themeToCssVariables(',
    );
    expect(fonte, 'o atributo acompanha o modo EFETIVO').toContain('data-theme-mode={mode}');
  });

  it('o LIMITE declarado: um tema que DECLARA `dark` e pinta fundo claro fica fora da régua', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE ESTA FATIA NÃO CONSERTA — e não é esquecimento
     * ─────────────────────────────────────────────────────────────────────────────
     *  A rampa sai do MODO DECLARADO (a decisão da FASE 61: "quem manda na página do
     *  evento é o organizador"), e não da luminância da superfície que ele escolheu. Um
     *  tema que se CONTRADIZ — declara `dark` e pinta `#ffffff` — recebe a rampa escura
     *  sobre um fundo claro, e o par desaba. É o mesmo limite que a FASE 61 já declarou
     *  para a paleta: a plataforma publica o que ele escolheu e não inventa uma terceira
     *  rampa para um tema incoerente. A alternativa (decidir a rampa pela cor de fundo)
     *  criaria uma SEGUNDA autoridade sobre o claro/escuro, brigando com o
     *  `data-theme-mode` — que é quem governa os controles nativos.
     *
     *  O número está aqui para o limite ser MEDIDO, e não uma desculpa.
     */
    const contraditorio = resolveTheme({
      colorMode: 'dark',
      backgroundColor: '#ffffff',
      textColor: '#111827',
    }).theme;
    const { variables } = buildEventThemeScope({ theme: contraditorio });

    expect(variables['--muted-foreground'], 'a rampa é a do modo DECLARADO').toBe('#c5c6d0');
    expect(
      contraste(corDoCss(variables['--muted-foreground']!), corDoCss('#ffffff')),
      'a rampa escura sobre o fundo claro que ele mesmo escolheu',
    ).toBeLessThan(4.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (5) A VARREDURA — as superfícies do tema usam papéis que o escopo publica
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VARREDURA É POR ARQUIVO, E NÃO POR UM "E SE ALGUÉM ESCREVER…"
 * ─────────────────────────────────────────────────────────────────────────────
 *  O defeito da E84 não é de um nó: é de uma FAMÍLIA (qualquer utilitário do sistema
 *  desenhado dentro do tema), e a FASE 66 provou que nó fora do portão sobrevive. A
 *  varredura lê os arquivos que comprovadamente vivem dentro do `ThemeScope` — os
 *  componentes do evento e as SETE telas que os desenham — e cobra que cada utilitário
 *  semântico que eles usam tenha o papel publicado aqui. Utilitário novo com papel
 *  fora da tabela reprova com o nome do arquivo e da classe.
 */
const ARQUIVOS_COM_O_TEMA = [
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/inscricao/page.tsx',
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/atividades/[activitySlug]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/palestrantes/[speakerId]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/sorteios/[raffleId]/palco/page.tsx',
  'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/previa/page.tsx',
] as const;

/**
 * APELIDO DO TAILWIND → a variável CSS que ele publica (`@theme inline`).
 *
 * O bloco declara `--color-muted-foreground: var(--muted-foreground)`: o que interessa
 * aqui é o NOME À DIREITA, e não a string inteira — foi o primeiro erro deste arquivo
 * (a varredura acusou 33 papéis "não publicados" porque comparava `var(--x)` com `--x`).
 */
const TOKENS_DO_TAILWIND = new Map(
  [...declaracoes(recortarBloco(GLOBALS, '@theme inline {')).entries()].flatMap(
    ([token, valor]) => {
      const referencia = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(valor);

      return referencia ? [[token, referencia[1]!] as const] : [];
    },
  ),
);

/**
 * AS EXCEÇÕES DECLARADAS — e a razão de cada uma é a MESMA, medida abaixo.
 *
 * Um par de ESTADO (o preenchimento e a tinta do aviso, o verde do ícone de sucesso)
 * tem as DUAS metades na mesma rampa da plataforma: `--warning-soft` é
 * `color-mix(--ef-warning, --ef-surface-lowest)` e o `--warning-strong` é o texto
 * desse fundo. Como as duas metades viajam juntas, a razão medida não depende do modo
 * do organizador — e trocar metade delas seria QUEBRAR o que hoje passa. Os quatro
 * números estão presos no caso do fim deste bloco.
 */
const EXCECOES_DE_ESTADO = new Set([
  '--warning',
  '--warning-soft',
  '--warning-strong',
  '--success-strong',
  '--surface-high',
]);

/**
 * E OS PARES FIXOS NOS DOIS MODOS — a segunda família isenta, com a razão MEDIDA.
 *
 * `--inverse-surface`/`--inverse-on-surface` são "a superfície que já é escura nos
 * dois modos" (o telão do sorteio e as cápsulas sobre imagem): os dois valores são
 * IDÊNTICOS no `:root` e no `.dark`, por decisão declarada no `globals.css`. Um papel
 * que não muda com o modo não tem o que o escopo republique — e o caso do fim deste
 * bloco PRENDE essa igualdade, para a isenção não virar promessa.
 */
const EXCECOES_FIXAS = new Set(['--inverse-surface', '--inverse-on-surface']);

describe('as superfícies que vivem no tema usam papéis que o escopo publica', () => {
  it('cada tela da lista desenha o tema — a lista não pode apodrecer', () => {
    for (const arquivo of ARQUIVOS_COM_O_TEMA) {
      const fonte = readFileSync(arquivo, 'utf8');

      expect(
        /ThemeScope|EventLanding/.test(fonte),
        `${arquivo} não passa pelo escopo do tema`,
      ).toBe(true);
    }
  });

  it('nenhum utilitário semântico do tema fica fora da tabela ou das exceções', () => {
    const infracoes: string[] = [];

    const arquivos = [
      ...readdirSync('src/components/events')
        .filter((nome) => nome.endsWith('.tsx'))
        .map((nome) => `src/components/events/${nome}`),
      ...ARQUIVOS_COM_O_TEMA,
    ];

    for (const arquivo of arquivos) {
      const fonte = semComentarios(readFileSync(arquivo, 'utf8'));

      for (const achado of fonte.matchAll(
        /(?:^|[\s"'`:])(?:[a-z-]+:)*(?:text|bg|border|ring|fill|stroke|outline|divide|placeholder|caret|decoration|from|via|to)-([a-z][a-z0-9-]*)/g,
      )) {
        const token = achado[1]!;
        const variavel = TOKENS_DO_TAILWIND.get(`--color-${token}`);

        if (!variavel) continue;

        const publicado =
          papelPublicadoOuNulo('light', variavel) !== null ||
          EXCECOES_DE_ESTADO.has(variavel) ||
          EXCECOES_FIXAS.has(variavel);

        if (!publicado) {
          infracoes.push(`${arquivo} → ${token} (${variavel})`);
        }
      }
    }

    expect(
      [...new Set(infracoes)],
      `Utilitário do sistema desenhado dentro do tema cujo papel o escopo não publica:\n${[
        ...new Set(infracoes),
      ].join('\n')}\n`,
    ).toEqual([]);
  });

  it('as exceções são PARES da mesma rampa — e a razão medida está presa', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTE CASO EXISTE (a exceção acima não pode ser uma promessa)
     * ─────────────────────────────────────────────────────────────────────────────
     *  "Está isento porque é par de estado" só vale com número. As duas metades vêm da
     *  MESMA rampa (a do `:root`, que é onde os apelidos de estado são declarados), e é
     *  por isso que elas viajam juntas em qualquer modo do organizador.
     *
     *  A tinta do aviso sobre o próprio fundo suave é TEXTO (4,5:1), e o preenchimento
     *  do sucesso sobre o trilho é componente (3:1). Medidos abaixo, nos dois modos.
     */
    const claro = {
      avisoSuave: misturarOklab('#f59e0b', '#ffffff', 0.14),
      avisoTinta: corDoCss(PALETA_CRUA.light.get('--ef-warning-strong')!),
      trilho: corDoCss(PALETA_CRUA.light.get('--ef-surface-high')!),
      sucesso: corDoCss(PALETA_CRUA.light.get('--ef-success-strong')!),
    };

    expect(
      contraste(claro.avisoTinta, claro.avisoSuave),
      'a tinta do aviso sobre o fundo suave (texto, AA 4,5:1)',
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contraste(claro.sucesso, claro.trilho),
      'o preenchimento do sucesso sobre o trilho (componente, 3:1)',
    ).toBeGreaterThanOrEqual(3);

    /** E as duas metades saem da rampa da PLATAFORMA, não da paleta do organizador. */
    expect(PALETA_CRUA.light.get('--ef-warning-strong')).toBe('#92400e');
    expect(PALETA_CRUA.dark.get('--ef-warning-strong')).toBe('#fcd34d');
  });

  it('os papéis do telão são IDÊNTICOS nos dois modos — a isenção é medida, não suposta', () => {
    /**
     * A segunda isenção só é honesta se o valor não mudar com o modo: um papel que
     * mudasse e não fosse publicado seria OUTRO caso do mesmo defeito. Aqui a igualdade
     * é conferida no próprio `globals.css` (o `.dark` repete os dois literais de
     * propósito) e o par texto/fundo é medido.
     */
    for (const papel of EXCECOES_FIXAS) {
      expect(resolver(papel, 'light'), `${papel} muda com o modo`).toBe(resolver(papel, 'dark'));
    }

    expect(
      contraste(
        corDoCss(PALETA_CRUA.light.get('--ef-inverse-on-surface')!),
        corDoCss(PALETA_CRUA.light.get('--ef-inverse-surface')!),
      ),
      'a tinta do telão sobre a superfície inversa (texto, AA 4,5:1)',
    ).toBeGreaterThanOrEqual(4.5);
  });
});

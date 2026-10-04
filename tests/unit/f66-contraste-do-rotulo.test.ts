/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 66 · O RÓTULO DE SEÇÃO E A FAMÍLIA DA OPACIDADE SOBRE O TEMA DO EVENTO
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DE ONDE ESTE ARQUIVO NASCEU (de um número, não de uma intenção)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 65 varreu a aba "Acontecendo agora" da página do evento e o portão WCAG AA
 *  reprovou QUATRO nós — os quatro com a MESMA causa: a plataforma emprestada para
 *  dentro do tema do organizador (`opacity-60` e um token de cor da plataforma sobre
 *  a superfície que ELE escolheu). A correção criou o papel `.ef-muted`
 *  (`color-mix(in oklab, var(--ef-text) 60%, var(--ef-background))`, medido em 5,08:1
 *  no claro e 5,91:1 no escuro).
 *
 *  A aba "Programação" ficou FORA daquele portão — e o QUINTO nó da mesma família
 *  sobreviveu dentro dela: o `eyebrow` do `SectionHeading`
 *  (`src/components/events/theme-scope.tsx`), `opacity-60` sobre a `--ef-background`,
 *  medido em **4,44:1** (`#72747c` sobre `#f9f9ff`) contra os 4,5:1 do AA para texto
 *  pequeno. **A lição é sobre o portão**: o defeito não sobreviveu por ser sutil —
 *  sobreviveu porque a tela onde ele mora não era medida. Fechar isto são duas
 *  metades que só valem juntas: a correção (esta catraca) e o caso no portão
 *  (`tests/e2e/accessibility.spec.ts`, a aba "Programação").
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RÉGUA É A DA CASA, E A CONTA DA MISTURA É A DA FASE 65
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `razaoDeContraste` (domínio) lê hexadecimal e `oklch()` — as duas formas que o
 *  schema do tema aceita —, e a conta do `color-mix(in oklab, …)` é a MESMA que a
 *  FASE 65 prendeu em `tests/unit/f65-acontecendo-agora.test.ts`. Ela está duplicada
 *  aqui DE PROPÓSITO: o arquivo da fase anterior é a catraca daquela fase, e uma fase
 *  posterior não reescreve a régua de quem veio antes (a lição vale mais que as
 *  quatro funções repetidas — a alternativa era editar um teste já entregue).
 *
 *  Os valores computados pelo NAVEGADOR estão presos abaixo (`MEDIDO_NO_NAVEGADOR`):
 *  foram lidos com `getComputedStyle` no Chromium, na página pública de um evento
 *  real, ANTES e DEPOIS da correção, nas duas paletas do tema.
 */
import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EVENT_THEME_PALETTE } from '@/domain/events/landing-page';
import { paraRgb, razaoDeContraste } from '@/domain/tenancy/tenant-page-theme-rules';

// ═══════════════════════════════════════════════════════════════════════════════
//  A RÉGUA — RGB, a mistura do `color-mix(in oklab, …)` e a razão do WCAG
// ═══════════════════════════════════════════════════════════════════════════════

type Rgb = NonNullable<ReturnType<typeof paraRgb>>;

/** Canal sRGB (0–255) → linear (0–1). É a MESMA função que a razão do WCAG usa. */
function linearizar(canal: number): number {
  const s = canal / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Linear (0–1) → canal sRGB (0–255), a volta da função acima. */
function codificar(valor: number): number {
  const s = valor <= 0.0031308 ? 12.92 * valor : 1.055 * valor ** (1 / 2.4) - 0.055;

  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** sRGB → oklab, pelas matrizes do padrão (Björn Ottosson). */
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

/** oklab → sRGB, pelas matrizes inversas (as mesmas de `oklchParaRgb`). */
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

/** Uma cor do CSS (hexadecimal ou `oklch()`) em RGB — ou erro, nunca `NaN` calado. */
function corDoCss(valor: string): Rgb {
  const rgb = paraRgb(valor);

  if (!rgb) throw new Error(`o domínio não sabe ler a cor: ${valor}`);

  return rgb;
}

/**
 * `color-mix(in oklab, uma <peso>, outra)` — a conta do NAVEGADOR.
 *
 * A mistura acontece em oklab (é o que o CSS pede). Misturar em sRGB daria outro tom:
 * é a diferença entre o mecanismo declarado e a opacidade que ele substituiu.
 *
 * A mistura sai em DOIS passos porque são duas perguntas diferentes: o `L` do oklab é
 * o que o navegador SERIALIZA (e o que se compara com `MEDIDO_NO_NAVEGADOR`), e o sRGB
 * é o que ele PINTA. Quantizar para 8 bits antes de medir o `L` moveria o número na
 * terceira decimal — pouco, mas o suficiente para a catraca medir a nossa conversão em
 * vez da do motor (foi exatamente o primeiro erro deste arquivo).
 */
function misturaEmOklab(
  uma: string,
  outra: string,
  pesoDaPrimeira: number,
): { L: number; a: number; b: number } {
  const a = paraOklab(corDoCss(uma));
  const b = paraOklab(corDoCss(outra));

  return {
    L: a.L * pesoDaPrimeira + b.L * (1 - pesoDaPrimeira),
    a: a.a * pesoDaPrimeira + b.a * (1 - pesoDaPrimeira),
    b: a.b * pesoDaPrimeira + b.b * (1 - pesoDaPrimeira),
  };
}

/** A mistura em sRGB — o que a tela pinta. */
function misturarOklab(uma: string, outra: string, pesoDaPrimeira: number): Rgb {
  return paraSrgb(misturaEmOklab(uma, outra, pesoDaPrimeira));
}

/**
 * A composição do `opacity` — que o navegador faz em sRGB (alfa sobre o fundo), e NÃO
 * em oklab. É o mecanismo do DEFEITO, e ele continua medido aqui para que a volta ao
 * desenho antigo não passe em silêncio.
 */
function misturarSrgb(uma: string, outra: string, pesoDaPrimeira: number): Rgb {
  const a = corDoCss(uma);
  const b = corDoCss(outra);

  return {
    r: a.r * pesoDaPrimeira + b.r * (1 - pesoDaPrimeira),
    g: a.g * pesoDaPrimeira + b.g * (1 - pesoDaPrimeira),
    b: a.b * pesoDaPrimeira + b.b * (1 - pesoDaPrimeira),
  };
}

function paraHex(cor: Rgb): string {
  const canal = (valor: number) =>
    Math.max(0, Math.min(255, Math.round(valor)))
      .toString(16)
      .padStart(2, '0');

  return `#${canal(cor.r)}${canal(cor.g)}${canal(cor.b)}`;
}

/** A razão entre dois RGB já resolvidos — a mesma conta de `razaoDeContraste`. */
function contrasteRgb(uma: Rgb, outra: Rgb): number {
  const razao = razaoDeContraste(paraHex(uma), paraHex(outra));

  if (razao === null) throw new Error('razão indeterminada entre duas cores resolvidas');

  return Math.round(razao * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AS FONTES — o CSS do tema, o do sistema e os componentes da página do evento
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * O CSS SEM COMENTÁRIOS: o recorte de bloco conta chaves, e os comentários deste
 * projeto citam `:root`, `opacity-60` e `@media` no TEXTO — procurar seletor dentro de
 * comentário daria o recorte errado (a armadilha já documentada na catraca da F61).
 * Os comentários viram ESPAÇOS (e não string vazia) para o número da linha continuar
 * valendo no diagnóstico.
 */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, (achado) => achado.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');
}

const CSS_DO_EVENTO = semComentarios(
  readFileSync('src/app/t/[tenantSlug]/(public)/eventos/event-theme.css', 'utf8'),
);
const TEMA_SCOPE = semComentarios(readFileSync('src/components/events/theme-scope.tsx', 'utf8'));

/** Os componentes da página pública — o conjunto que a varredura da família cobre. */
const COMPONENTES_DO_EVENTO = readdirSync('src/components/events')
  .filter((nome) => nome.endsWith('.tsx'))
  .map((nome) => ({ nome, fonte: semComentarios(readFileSync(`src/components/events/${nome}`, 'utf8')) }));

/** Recorta um bloco do CSS contando chaves — `indexOf('}')` pararia num `color-mix(...)`. */
function recortarBloco(fonte: string, seletor: string): string {
  const inicio = fonte.indexOf(seletor);
  if (inicio === -1) throw new Error(`bloco não encontrado: ${seletor}`);

  let profundidade = 0;
  let i = fonte.indexOf('{', inicio);

  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') profundidade += 1;
    if (fonte[i] === '}') {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
  }

  return fonte.slice(fonte.indexOf('{', inicio) + 1, i);
}

/**
 * O peso da tinta declarado por um papel do tema, LIDO da regra de verdade.
 *
 * Ler o número em vez de repeti-lo é o que faz esta catraca medir o CSS: mudar a
 * receita para 40% reprova aqui, e não só no olho de quem revisou.
 */
function pesoDoPapel(seletor: string): number {
  const regra = recortarBloco(CSS_DO_EVENTO, seletor);
  const achado = /color-mix\(in oklab, var\(--ef-text\)\s+([\d.]+)%,\s*var\(--ef-background\)\)/.exec(
    regra,
  );

  if (!achado?.[1]) throw new Error(`o \`${seletor}\` não declara a mistura esperada`);

  return Number.parseFloat(achado[1]) / 100;
}

/** O fundo do CARTÃO do tema — a outra superfície onde texto secundário é desenhado. */
function fundoDoCartao(modo: 'light' | 'dark'): Rgb {
  const tema = EVENT_THEME_PALETTE[modo];

  return misturarOklab(tema.background, tema.text, 0.92);
}

const MODOS = ['light', 'dark'] as const;

// ═══════════════════════════════════════════════════════════════════════════════
//  O QUE O NAVEGADOR COMPUTOU — lido com `getComputedStyle` no Chromium
// ═══════════════════════════════════════════════════════════════════════════════
/**
 *  Página pública de um evento real, servida pelo container (`web`), nas duas paletas
 *  do tema (o organizador escolhe `colorMode`), em 04/10/2026:
 *
 *  ANTES (o defeito), nó `<p class="text-xs font-semibold uppercase tracking-wider
 *  opacity-60">Programação</p>`:
 *
 *      claro   color rgb(24, 28, 36)  opacity 0.6   sobre --ef-background #f9f9ff
 *      escuro  color oklch(0.97 0 0)  opacity 0.6   sobre --ef-background #090b0f
 *
 *  DEPOIS (a correção), o mesmo nó com `.ef-muted`:
 *
 *      claro   color oklab(0.529122 -0.00011043 -0.0130331)  →  #686b73
 *      escuro  color oklab(0.642 -0.000348623 -0.00398478)   →  #8b8d8f
 *
 *  (e `opacity` computada = `1` nos dois: a cor passou a ser declarada, não composta)
 *
 *  E o fundo do cartão, para a outra metade da família:
 *
 *      claro   oklab(0.923186 0.0019489 -0.00832323)  →  #e4e5eb
 *      escuro  oklab(0.2156 -0.000801833 -0.00916499) →  #171a1e
 *
 *  Os dois `oklab` do cartão são os MESMOS que a FASE 65 prendeu no arquivo dela — a
 *  conta deste arquivo tem de cair neles, e não numa fórmula plausível. O `L` é medido
 *  na MISTURA (antes da quantização para 8 bits); o hexadecimal é o que a tela pinta e
 *  o que o `axe` mede. A distância entre os dois é de centésimos na razão, e ela fica
 *  dita: contraste sem a cor que o produziu não é reproduzível.
 */
const MEDIDO_NO_NAVEGADOR = {
  rotulo: {
    claro: { cor: '#181c24', opacidade: 0.6, composto: '#72747c', sobreOFundo: 4.44 },
    escuro: { sobreOFundo: 6.75 },
  },
  mutedClaro: { oklabL: 0.529122, hex: '#686b73', sobreOFundo: 5.08 },
  mutedEscuro: { oklabL: 0.642, hex: '#8b8d8f', sobreOFundo: 5.91 },
  cartaoClaro: { oklabL: 0.923186, hex: '#e4e5eb' },
  cartaoEscuro: { oklabL: 0.2156, hex: '#171a1e' },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
//  (1) O DEFEITO — o rótulo de seção sobre a `--ef-background` do organizador
// ═══════════════════════════════════════════════════════════════════════════════
describe('o rótulo de seção do tema passa o AA nos dois modos', () => {
  it('o `ef-muted` passa nos dois modos — e é a mistura que o CSS declara', () => {
    const peso = pesoDoPapel('\n.ef-muted {');

    expect(peso, 'o peso declarado no `.ef-muted`').toBe(0.6);

    for (const modo of MODOS) {
      const tema = EVENT_THEME_PALETTE[modo];
      const apagado = misturarOklab(tema.text, tema.background, peso);

      expect(
        contrasteRgb(apagado, corDoCss(tema.background)),
        `o rótulo do tema sobre a --ef-background no modo ${modo}`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    /** Os dois números presos — os mesmos que a FASE 65 mediu para este papel. */
    expect(
      contrasteRgb(
        misturarOklab(
          EVENT_THEME_PALETTE.light.text,
          EVENT_THEME_PALETTE.light.background,
          peso,
        ),
        corDoCss(EVENT_THEME_PALETTE.light.background),
      ),
    ).toBe(5.08);
    expect(
      contrasteRgb(
        misturarOklab(
          EVENT_THEME_PALETTE.dark.text,
          EVENT_THEME_PALETTE.dark.background,
          peso,
        ),
        corDoCss(EVENT_THEME_PALETTE.dark.background),
      ),
    ).toBe(5.91);
  });

  it('a OPACIDADE — o mecanismo do defeito — reprova no claro, e só nele', () => {
    /**
     *  Este caso é o que impede a "volta ao de antes" de passar despercebida, e é ele
     *  que explica por que o defeito sobreviveu: no modo ESCURO a composição passava
     *  (6,75:1). O defeito era de UM modo só — e o portão que não varria a aba não
     *  media nem um nem outro.
     */
    const claro = misturarSrgb(
      EVENT_THEME_PALETTE.light.text,
      EVENT_THEME_PALETTE.light.background,
      0.6,
    );
    const escuro = misturarSrgb(
      EVENT_THEME_PALETTE.dark.text,
      EVENT_THEME_PALETTE.dark.background,
      0.6,
    );

    expect(paraHex(claro), 'a cor que a opacidade pintava').toBe(
      MEDIDO_NO_NAVEGADOR.rotulo.claro.composto,
    );
    expect(
      contrasteRgb(claro, corDoCss(EVENT_THEME_PALETTE.light.background)),
      'opacity-60 sobre a --ef-background no modo claro',
    ).toBe(MEDIDO_NO_NAVEGADOR.rotulo.claro.sobreOFundo);
    expect(
      contrasteRgb(claro, corDoCss(EVENT_THEME_PALETTE.light.background)),
    ).toBeLessThan(4.5);

    expect(
      contrasteRgb(escuro, corDoCss(EVENT_THEME_PALETTE.dark.background)),
      'opacity-60 sobre a --ef-background no modo escuro (passava — o defeito era de um modo só)',
    ).toBe(MEDIDO_NO_NAVEGADOR.rotulo.escuro.sobreOFundo);
  });

  it('o rótulo do `SectionHeading` usa o papel do tema, e não uma opacidade', () => {
    /**
     *  A catraca do MECANISMO, e não só a do número: `opacity` num texto sobre o tema
     *  do organizador é uma cor que a catraca não consegue prever (ela depende do fundo
     *  que ele escolher). Quem devolver o rótulo ao `opacity-60` reprova aqui, com o
     *  motivo escrito — e é esta a mutação que a fase provou no navegador.
     */
    const linha = TEMA_SCOPE.split('\n').find((texto) => texto.includes('tracking-wider'));

    expect(linha, 'o rótulo do cabeçalho de seção não foi encontrado').toBeDefined();
    expect(linha, 'o rótulo usa o papel do tema').toContain('ef-muted');
    expect(linha, 'o rótulo não usa opacidade').not.toContain('opacity');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (2) A FAMÍLIA — o texto secundário sobre o CARTÃO do tema
// ═══════════════════════════════════════════════════════════════════════════════
describe('o texto secundário sobre o CARTÃO do tema passa o AA nos dois modos', () => {
  it('o `ef-muted-on-card` passa no cartão E no fundo, nos dois modos', () => {
    /**
     *  ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTE PAPEL EXISTE: O `.ef-muted` NÃO RESOLVE SOBRE O CARTÃO
     *  ─────────────────────────────────────────────────────────────────────────────
     *  O cartão já é a mistura do fundo com 8% da tinta — então a MESMA proporção de
     *  60% mede **4,24:1** sobre ele no claro: abaixo do AA. Foi o que a varredura da
     *  família achou ao medir, um a um, os nós de texto secundário que vivem dentro de
     *  cartões (o formulário de inscrição, o cartão do palestrante, a trilha, a
     *  chamada). 70% é o MENOR peso que passa nas DUAS superfícies e nos DOIS modos.
     */
    const peso = pesoDoPapel('\n.ef-muted-on-card {');

    expect(peso, 'o peso declarado no `.ef-muted-on-card`').toBe(0.7);

    for (const modo of MODOS) {
      const tema = EVENT_THEME_PALETTE[modo];
      const cartao = fundoDoCartao(modo);
      const apagado = misturarOklab(tema.text, tema.background, peso);

      expect(
        contrasteRgb(apagado, cartao),
        `o texto secundário sobre o .ef-card no modo ${modo}`,
      ).toBeGreaterThanOrEqual(4.5);

      expect(
        contrasteRgb(apagado, corDoCss(tema.background)),
        `o texto secundário sobre a --ef-background no modo ${modo}`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    /** Os quatro números do papel, presos. */
    expect(
      contrasteRgb(
        misturarOklab(EVENT_THEME_PALETTE.light.text, EVENT_THEME_PALETTE.light.background, peso),
        fundoDoCartao('light'),
      ),
      'o `on-card` sobre o cartão claro',
    ).toBe(5.84);
    expect(
      contrasteRgb(
        misturarOklab(EVENT_THEME_PALETTE.light.text, EVENT_THEME_PALETTE.light.background, peso),
        corDoCss(EVENT_THEME_PALETTE.light.background),
      ),
      'o `on-card` sobre o fundo claro',
    ).toBe(7);
    expect(
      contrasteRgb(
        misturarOklab(EVENT_THEME_PALETTE.dark.text, EVENT_THEME_PALETTE.dark.background, peso),
        fundoDoCartao('dark'),
      ),
      'o `on-card` sobre o cartão escuro',
    ).toBe(7.17);
  });

  it('a opacidade que ele substituiu reprovava no CARTÃO (o defeito, medido)', () => {
    const cartao = fundoDoCartao('light');
    const composto = misturarSrgb(
      EVENT_THEME_PALETTE.light.text,
      paraHex(cartao),
      0.6,
    );

    expect(
      contrasteRgb(composto, cartao),
      'opacity-60 sobre o .ef-card no modo claro',
    ).toBe(4.17);
    expect(contrasteRgb(composto, cartao)).toBeLessThan(4.5);

    /** E o `.ef-muted` de 60%, que resolve o FUNDO, também reprova sobre o cartão. */
    expect(
      contrasteRgb(
        misturarOklab(EVENT_THEME_PALETTE.light.text, EVENT_THEME_PALETTE.light.background, 0.6),
        cartao,
      ),
      'o `.ef-muted` de 60% sobre o cartão (por isso o papel do cartão é outro)',
    ).toBe(4.24);
  });

  it('a conta da mistura reproduz o MOTOR — os dois cartões que o navegador computou', () => {
    /**
     *  Sem este caso, a catraca mediria a nossa própria fórmula. Com ele, a fórmula
     *  responde pelos valores que o Chromium COMPUTOU na página real (o `L` do oklab da
     *  MISTURA e o hexadecimal que ele pinta) — os mesmos dois que a FASE 65 prendeu.
     */
    for (const modo of MODOS) {
      const medido = modo === 'light' ? MEDIDO_NO_NAVEGADOR.cartaoClaro : MEDIDO_NO_NAVEGADOR.cartaoEscuro;
      const tema = EVENT_THEME_PALETTE[modo];
      const mistura = misturaEmOklab(tema.background, tema.text, 0.92);

      expect(paraHex(paraSrgb(mistura)), `o fundo do cartão no modo ${modo}`).toBe(medido.hex);
      expect(mistura.L, `o L do oklab do cartão no modo ${modo}`).toBeCloseTo(medido.oklabL, 4);
    }

    /** E o rótulo corrigido é a cor que o navegador devolveu para o papel do tema. */
    const rotuloClaro = misturarOklab(
      EVENT_THEME_PALETTE.light.text,
      EVENT_THEME_PALETTE.light.background,
      pesoDoPapel('\n.ef-muted {'),
    );

    expect(paraHex(rotuloClaro)).toBe(MEDIDO_NO_NAVEGADOR.mutedClaro.hex);
    expect(
      misturaEmOklab(
        EVENT_THEME_PALETTE.light.text,
        EVENT_THEME_PALETTE.light.background,
        pesoDoPapel('\n.ef-muted {'),
      ).L,
      'o L do oklab que o navegador computou para o rótulo',
    ).toBeCloseTo(MEDIDO_NO_NAVEGADOR.mutedClaro.oklabL, 4);

    const rotuloEscuro = misturarOklab(
      EVENT_THEME_PALETTE.dark.text,
      EVENT_THEME_PALETTE.dark.background,
      pesoDoPapel('\n.ef-muted {'),
    );

    expect(paraHex(rotuloEscuro)).toBe(MEDIDO_NO_NAVEGADOR.mutedEscuro.hex);
    expect(
      misturaEmOklab(
        EVENT_THEME_PALETTE.dark.text,
        EVENT_THEME_PALETTE.dark.background,
        pesoDoPapel('\n.ef-muted {'),
      ).L,
      'o L do oklab que o navegador computou para o rótulo no modo escuro',
    ).toBeCloseTo(MEDIDO_NO_NAVEGADOR.mutedEscuro.oklabL, 4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (3) A VARREDURA DA FAMÍLIA — nenhuma opacidade baixa em texto do tema
// ═══════════════════════════════════════════════════════════════════════════════
describe('a família da opacidade está fechada nos componentes da página do evento', () => {
  it('nenhum texto do tema usa opacidade abaixo de 70% (a que passa foi medida)', () => {
    /**
     *  ─────────────────────────────────────────────────────────────────────────────
     *  A RÉGUA DA VARREDURA, E POR QUE ELA É ESTA
     *  ─────────────────────────────────────────────────────────────────────────────
     *  `opacity` num texto sobre o tema do organizador é a cor do defeito: ela compõe a
     *  tinta com o fundo que ELE escolheu. A varredura mediu a matriz inteira nos dois
     *  modos e nas duas superfícies do tema:
     *
     *      opacidade   sobre --ef-background   sobre .ef-card   (tema padrão CLARO)
     *         50%            3,24:1                3,10:1
     *         60%            4,44:1  ✗             4,17:1  ✗
     *         65%            5,22:1                4,85:1
     *         70%            6,16:1                5,66:1
     *         80%            8,72:1                7,75:1
     *         90%           12,22:1               10,53:1
     *
     *  No modo ESCURO todas passam (a de 50% inclusive, 4,98:1): o que reprova é a
     *  faixa abaixo de 65% no CLARO. Por isso a régua é **70%**, com margem, e não
     *  "o mínimo que passa hoje" — a opacidade compõe com um fundo que a plataforma não
     *  controla, e a margem é o que segura o caso do organizador que escolher um fundo
     *  um pouco mais escuro que o padrão.
     *
     *  A EXCEÇÃO DECLARADA (e ela é estreita): ÍCONE decorativo com `aria-hidden`. Ele
     *  não é texto — quem não vê o ícone lê a palavra ao lado —, e o próprio WCAG isenta
     *  o que é decorativo. A varredura cobra a marca `aria-hidden` na MESMA linha (ou
     *  nas duas seguintes, para o caso do atributo quebrado em outra linha), de modo
     *  que um ícone "decorativo" que perca a marca reprova aqui.
     */
    const infracoes: string[] = [];

    for (const { nome, fonte } of COMPONENTES_DO_EVENTO) {
      const linhas = fonte.split('\n');

      linhas.forEach((texto, indice) => {
        for (const achado of texto.matchAll(/opacity-(\d{1,3})/g)) {
          const valor = Number.parseInt(achado[1] ?? '0', 10);

          if (valor >= 70) continue;

          const janela = linhas.slice(indice, indice + 3).join(' ');
          if (janela.includes('aria-hidden')) continue;

          infracoes.push(`${nome}:${indice + 1} → ${texto.trim()}`);
        }
      });
    }

    expect(
      infracoes,
      `Opacidade abaixo de 70% em texto do tema (o papel do tema é medido; a opacidade não):\n${infracoes.join('\n')}\n`,
    ).toEqual([]);
  });

  it('a opacidade LEGÍTIMA continua onde ela é medida: 70% da descrição e do rótulo inativo', () => {
    /**
     *  A varredura acima não é "apagar a opacidade do produto": ela reprova a FAIXA que
     *  não alcança o AA. O que passa fica declarado aqui, com a medição — assim ninguém
     *  "limpa" o resto por engano (há três nós em 70% no caminho da página, e os três
     *  medem 6,16:1 sobre o fundo no claro e 8,96:1 no escuro).
     */
    const temaScope = COMPONENTES_DO_EVENTO.find((arquivo) => arquivo.nome === 'theme-scope.tsx');
    const landing = COMPONENTES_DO_EVENTO.find((arquivo) => arquivo.nome === 'event-landing.tsx');

    expect(temaScope?.fonte, 'a descrição do cabeçalho segue em 70%').toContain(
      'text-pretty opacity-70',
    );
    expect(landing?.fonte, 'o rótulo da aba inativa segue em 70%').toContain(
      'border-transparent opacity-70',
    );

    const composto = misturarSrgb(
      EVENT_THEME_PALETTE.light.text,
      EVENT_THEME_PALETTE.light.background,
      0.7,
    );

    expect(
      contrasteRgb(composto, corDoCss(EVENT_THEME_PALETTE.light.background)),
      'opacity-70 sobre a --ef-background no claro',
    ).toBe(6.16);
  });

  it('o que ficou FORA da correção está medido — o token da plataforma no modo escuro', () => {
    /**
     *  ─────────────────────────────────────────────────────────────────────────────
     *  O LIMITE DECLARADO DESTA FASE (e a dívida que ele já tem nome)
     *  ─────────────────────────────────────────────────────────────────────────────
     *  A varredura da família achou UMA segunda metade, e ela NÃO é de opacidade: os
     *  componentes da página do evento ainda usam token de TEXTO da PLATAFORMA
     *  (`text-muted-foreground`, `bg-card`, `border-border`) em alguns nós. No modo
     *  claro do organizador esses pares passam (o token claro sobre a superfície clara:
     *  8,93:1 sobre o fundo e 7,45:1 sobre o cartão). No modo ESCURO do organizador —
     *  e o organizador escolhe o modo dele — o token da plataforma continua sendo o
     *  CLARO, e o par desaba: **2,10:1** sobre o fundo e **1,86:1** sobre o cartão.
     *
     *  A correção disso NÃO é a desta fase e não cabe numa linha: ela é a MESMA
     *  pergunta que a dívida **E84** já registra (o claro/escuro do visitante na página
     *  do evento, onde o modo é do organizador) — o conserto é o tema publicar também os
     *  papéis SEMÂNTICOS (`card`, `border`, `muted-foreground`) para os componentes
     *  pararem de ler a escala do `html`. Números presos aqui para que a decisão da
     *  próxima fase comece pela medição, e não pela suspeita.
     */
    const plataformaClara = '#464555'; // --ef-on-surface-variant no `:root`
    const plataformaEscura = '#c5c6d0'; // o mesmo token em `.dark`

    const tema = EVENT_THEME_PALETTE.dark;
    const fundo = corDoCss(tema.background);
    const cartao = fundoDoCartao('dark');

    expect(
      contrasteRgb(corDoCss(plataformaClara), fundo),
      'o token de texto da plataforma sobre a --ef-background de um tema ESCURO',
    ).toBe(2.1);
    expect(contrasteRgb(corDoCss(plataformaClara), cartao)).toBe(1.86);

    /** E no modo claro do organizador o mesmo par passa — a assimetria é o achado. */
    const fundoClaro = corDoCss(EVENT_THEME_PALETTE.light.background);

    expect(contrasteRgb(corDoCss(plataformaClara), fundoClaro)).toBe(8.93);
    expect(contrasteRgb(corDoCss(plataformaEscura), fundoClaro)).toBe(1.62);

    /**
     *  O achado não é hipótese sobre um modo que não existe: o token da plataforma é o
     *  do `html`, e a página do evento o herda — o mesmo `getComputedStyle` da medição
     *  do rótulo devolveu `#f9f9ff`/`#090b0f` para a `--ef-background` do organizador,
     *  que é o modo DELE, e não o do visitante.
     */
    expect(tema.background).not.toBe(EVENT_THEME_PALETTE.light.background);
  });
});

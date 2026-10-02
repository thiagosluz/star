/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 62 · dívida E81 — A CATRACA DA ELEVAÇÃO DO MODO ESCURO
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE TESTE IMPEDE DE VOLTAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No modo escuro a sombra é PRETA em alfa: sobre uma superfície que já é escura
 *  ela não desenha degrau nenhum. O cartão do escuro se distinguia do fundo pelo
 *  TOM (`#23252d` sobre `#17181e`) e NADA separava o cartão do que flutua sobre ele
 *  — popover, menu, gaveta e modal eram o MESMO `#23252d`. A FASE 62 decidiu o que
 *  o modo escuro já fazia pela metade: **a elevação de lá é o TOM**, com um degrau
 *  por nível, e a sombra passa a ser reforço do que flutua sobre conteúdo.
 *
 *  A decisão inteira (e as alternativas descartadas) está no bloco de comentário
 *  do `.dark` em `src/app/globals.css`; aqui ela vira MEDIDA.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CATRACA PRENDE, E POR QUE ISSO É MENSURÁVEL
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. a escada de superfícies do escuro SOBE sem empate: degrau empatado com o
 *       vizinho é hierarquia perdida — o defeito que a dívida descreve;
 *    2. os dois saltos que o olho tem de enxergar (fundo→cartão e cartão→flutuante)
 *       têm razão de contraste MEDIDA, presa aqui como os pares do WCAG na F61;
 *    3. o modo CLARO não mudou: os valores claros continuam os do `:root`, o
 *       `popover` claro resolve no MESMO branco do cartão (o que ele resolvia antes
 *       de existir o token) e quem eleva no claro continua sendo a sombra;
 *    4. o tom flutuante tem LEITOR: `--popover` → `--ef-surface-popover` →
 *       `--color-popover`, que é o `bg-popover` dos menus, da gaveta e do modal.
 *
 *  A outra metade do contrato (as DUAS declarações escuras idênticas, valor a valor)
 *  já é presa por `f61-escala-escura.test.ts` e `f61-contraste-dos-dois-modos.test.ts`
 *  — os pares de texto e a hairline sobre o tom flutuante entraram LÁ, porque é lá
 *  que o WCAG dos dois modos é medido.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync('src/app/globals.css', 'utf8');

/** O arquivo SEM comentários: o bloco da decisão cita `:root` e `.dark` no texto. */
const CSS_SEM_COMENTARIOS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Recorta o conteúdo de um bloco contando chaves (há `color-mix(...)` no arquivo). */
function recortarBloco(fonte: string, seletor: string): string {
  const inicio = fonte.indexOf(seletor);

  if (inicio === -1) throw new Error(`bloco não encontrado no globals.css: ${seletor}`);

  const abre = fonte.indexOf('{', inicio);
  let profundidade = 0;
  let i = abre;

  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') profundidade += 1;
    else if (fonte[i] === '}') {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
  }

  return fonte.slice(abre + 1, i);
}

/** As declarações `--ef-*: #hex` de um bloco, na ordem do arquivo. */
function tonsDoBloco(bloco: string): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const achado of bloco.matchAll(/--(ef-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (achado[1] && achado[2]) mapa.set(achado[1], achado[2].toLowerCase());
  }

  return mapa;
}

const ESCURO = tonsDoBloco(recortarBloco(CSS_SEM_COMENTARIOS, '\n.dark {'));
const CLARO = tonsDoBloco(recortarBloco(CSS_SEM_COMENTARIOS, ':root'));
/** O `@theme inline`: é onde vivem os apelidos e as SOMBRAS do modo claro. */
const TEMA = recortarBloco(CSS_SEM_COMENTARIOS, '@theme inline');

/** O valor de um token da escala escura, ou erro com o nome — nunca `undefined` mudo. */
function escuro(nome: string): string {
  const valor = ESCURO.get(nome);

  if (!valor) throw new Error(`token --${nome} não encontrado na escala ESCURA (.dark)`);

  return valor;
}

function claro(nome: string): string {
  const valor = CLARO.get(nome);

  if (!valor) throw new Error(`token --${nome} não encontrado na escala CLARA (:root)`);

  return valor;
}

/** A luminância relativa do WCAG 2.x — a régua de "o que é mais claro". */
function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((posicao) => {
    const valor = Number.parseInt(hex.slice(posicao, posicao + 2), 16) / 255;

    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!;
}

/** Razão de contraste do WCAG entre dois tons (a "distância" que o olho mede). */
function contraste(a: string, b: string): number {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);

  return Math.round(((maior! + 0.05) / (menor! + 0.05)) * 100) / 100;
}

/**
 * A ESCADA DO ESCURO, do degrau que RECUA ao topo.
 *
 * `--ef-surface-bright` fica de fora por decisão escrita na F61: no escuro, "a
 * superfície mais clara da escada" é o PRÓPRIO cartão — ele empata com
 * `--ef-surface-lowest` de propósito, e não é um degrau novo.
 */
const ESCADA_ESCURA = [
  'ef-surface-dim',
  'ef-surface',
  'ef-surface-low',
  'ef-surface-lowest',
  'ef-surface-container',
  'ef-surface-high',
  'ef-surface-popover',
  'ef-surface-highest',
  'ef-surface-variant',
] as const;

/**
 * Os dois saltos de ELEVAÇÃO, medidos. O mínimo do WCAG não se aplica a tom sobre
 * tom (não é texto nem contorno): o que se exige aqui é que o degrau EXISTA e seja
 * visível — 1,16:1 entre o fundo e o cartão e 1,20:1 entre o cartão e o flutuante
 * são os números medidos desta escala, e `1,0:1` seria "empate", que é o defeito.
 */
const DEGRAUS_MEDIDOS: Record<string, number> = {
  'fundo→cartão': 1.16,
  'cartão→flutuante': 1.2,
};

/** O mínimo aceitável para um degrau ser considerado visível. */
const MINIMO_DO_DEGRAU = 1.1;

describe('FASE 62 · E81 — a elevação do modo escuro é por TOM', () => {
  it('a escada do escuro SOBE degrau por degrau, sem empate', () => {
    const empatados: string[] = [];
    const foraDeOrdem: string[] = [];

    for (let i = 1; i < ESCADA_ESCURA.length; i += 1) {
      const anterior = ESCADA_ESCURA[i - 1]!;
      const atual = ESCADA_ESCURA[i]!;
      const la = luminancia(escuro(anterior));
      const lb = luminancia(escuro(atual));

      if (la === lb) empatados.push(`--${anterior} = --${atual} (${escuro(anterior)})`);
      if (lb < la) {
        foraDeOrdem.push(`--${atual} (${escuro(atual)}) está ABAIXO de --${anterior} (${escuro(anterior)})`);
      }
    }

    /**
     * Degrau empatado é exatamente a "perda de hierarquia" da dívida: o cartão e o
     * popover do escuro tinham o mesmo `#23252d`, e com a sombra apagada nada dizia
     * que um flutuava sobre o outro.
     */
    expect(empatados, `\nDegraus com o MESMO tom no modo escuro:\n${empatados.join('\n')}\n`).toEqual([]);
    expect(foraDeOrdem, `\nA escada do escuro está fora de ordem:\n${foraDeOrdem.join('\n')}\n`).toEqual([]);
  });

  it('os dois saltos de elevação são MEDIDOS — não basta "ser mais claro"', () => {
    const saltos: [string, string, string][] = [
      ['fundo→cartão', 'ef-surface', 'ef-surface-lowest'],
      ['cartão→flutuante', 'ef-surface-lowest', 'ef-surface-popover'],
    ];

    for (const [nome, base, alvo] of saltos) {
      const medido = contraste(escuro(base), escuro(alvo));
      const esperado = DEGRAUS_MEDIDOS[nome];

      expect(esperado, `salto sem número medido: ${nome}`).toBeDefined();
      expect(
        medido,
        `${nome} [${escuro(base)} → ${escuro(alvo)}] mede ${medido}:1`,
      ).toBeCloseTo(esperado!, 2);

      /**
       * E o degrau tem de ser VISÍVEL: um tom "um pouco mais claro" que não se mede
       * é a hierarquia perdida de novo, agora com um nome novo no CSS.
       */
      expect(medido, `${nome} é um degrau que não se enxerga`).toBeGreaterThanOrEqual(
        MINIMO_DO_DEGRAU,
      );
    }
  });

  it('o modo CLARO não mudou: os valores do `:root` são os mesmos, e o popover claro é o cartão', () => {
    /**
     * A prova pedida pela fase: o token novo nasceu nas DUAS escalas, e no claro ele
     * vale `#ffffff` — EXATAMENTE o que `--popover` resolvia antes de ele existir
     * (`--popover: var(--ef-surface-lowest)`). Ou seja: nenhum pixel do modo claro
     * mudou; lá quem eleva continua sendo a sombra.
     */
    const esperados: [string, string][] = [
      ['ef-surface', '#f9f9ff'],
      ['ef-surface-dim', '#d7dae5'],
      ['ef-surface-bright', '#f9f9ff'],
      ['ef-surface-lowest', '#ffffff'],
      ['ef-surface-low', '#f1f3ff'],
      ['ef-surface-container', '#ebedfa'],
      ['ef-surface-high', '#e5e8f4'],
      ['ef-surface-popover', '#ffffff'],
      ['ef-surface-highest', '#dfe2ee'],
      ['ef-surface-variant', '#dfe2ee'],
    ];

    for (const [token, valor] of esperados) {
      expect(claro(token), `--${token} do modo claro mudou`).toBe(valor);
    }

    expect(claro('ef-surface-popover')).toBe(claro('ef-surface-lowest'));
    expect(claro('ef-surface-popover')).toBe('#ffffff');

    /**
     * E a sombra do claro continua sendo o que era: ela é a elevação DESSE modo, e o
     * tom do popover no claro só faz sentido enquanto for igual ao do cartão.
     */
    const sombraDoClaro = /--shadow-card:\s*([^;]+);/.exec(TEMA)?.[1]?.trim();

    expect(sombraDoClaro).toBe('0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -1px rgb(0 0 0 / 0.03)');
  });

  it('o tom flutuante tem LEITOR: `--popover` publica `--color-popover`', () => {
    /**
     * Token sem leitor é token que a próxima limpeza apaga — e a decisão desta fase
     * voltaria com ele. A corrente é `--popover` (apelido) → `--ef-surface-popover`
     * (paleta crua) → `--color-popover` (`@theme inline`), que é o `bg-popover` dos
     * menus, da gaveta e do modal.
     */
    const raiz = recortarBloco(CSS_SEM_COMENTARIOS, ':root');

    expect(raiz).toContain('--popover: var(--ef-surface-popover);');
    expect(TEMA).toContain('--color-popover: var(--popover);');
  });
});

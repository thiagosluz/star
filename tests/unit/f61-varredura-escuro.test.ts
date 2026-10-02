/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 61 · dívida H3 — A CATRACA DO QUE A ESCALA DE TOKENS NÃO ALCANÇA
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (e o que ele NÃO repete)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A varredura da fase respondeu uma pergunta: **onde a arquitetura de tokens não
 *  chega?** Onde ela chega, o modo escuro é só valor trocado (ADR-324). Onde não
 *  chega, alguém escreveu cor fixa, assumiu fundo claro ou dependeu de um token que
 *  a escala escura não declara — e é isso que este arquivo prende.
 *
 *  Três varreduras JÁ EXISTEM e não são repetidas aqui (a régua é uma só):
 *    • paleta crua do Tailwind (`bg-slate-500`), hexadecimal e tamanho de fonte
 *      arbitrário → `tests/unit/design-system-guard.test.ts`;
 *    • contraste dos dois modos e o par do TELÃO (`--ef-inverse-surface`, que a
 *      escala escura redeclara com o MESMO valor) →
 *      `tests/unit/f61-contraste-dos-dois-modos.test.ts`;
 *    • a escolha do modo (cookie, classe, `data-tema`) →
 *      `tests/unit/f61-modo-noturno.test.ts`.
 *
 *  O que sobra — e é o que está aqui — são os três buracos que nenhuma delas vê:
 *
 *    1. `bg-white` / `bg-black/25` — a utilidade SEM matiz. O regex da paleta
 *       procura `slate|gray|…|rose` seguido de dígitos e passa longe dela. Um
 *       retângulo branco fixo é invisível na varredura e ofuscante no escuro.
 *    2. `rgb(...)` / `hsl(...)` em valor arbitrário — `bg-[rgb(15_23_42/0.05)]`. O
 *       guard procura hexadecimal; e o véu "neutro" escrito em rgb é justamente o
 *       jeito mais comum de um componente assumir fundo claro sem parecer que
 *       assumiu: 5% de tinta escura sobre superfície escura é nada.
 *    3. Tokens que as TELAS usam e que a escala escura não declara. Não há regex
 *       que pegue isso — é preciso cruzar os componentes com o `globals.css`, que é
 *       o que o segundo bloco faz. Um token ausente no escuro não gera erro: o
 *       valor claro simplesmente vaza para dentro do tema escuro, e o defeito
 *       aparece como um retângulo claro no meio do painel.
 *
 *  A régua da fase vale para todas as três: **o modo claro não pode mudar**, e o
 *  que muda com o modo é VALOR de token, nunca uma segunda interface.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();
const DIRETORIOS = ['src/app', 'src/components'];

function listarFontes(dir: string, achados: string[] = []): string[] {
  for (const entrada of readdirSync(join(RAIZ, dir))) {
    const absoluto = join(RAIZ, dir, entrada);

    if (statSync(absoluto).isDirectory()) {
      listarFontes(join(dir, entrada), achados);
      continue;
    }

    if (/\.(?:tsx|ts)$/.test(entrada)) {
      achados.push(dir.split(sep).join('/') + '/' + entrada);
    }
  }

  return achados;
}

const FONTES = DIRETORIOS.flatMap((dir) => listarFontes(dir));

/**
 * Remove comentários antes de procurar cor.
 *
 * O comentário que EXPLICA por que um valor existe não é o valor: o próprio
 * `badge-renderer.ts` cita `var(--ef-…)` para dizer que o PDF não resolve variável
 * CSS, e `button.tsx` cita o `rgb(...)` que deixou de usar. Ler comentário como
 * estilo daria um teste que reprova a documentação da decisão.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function ler(caminho: string): string {
  return semComentarios(readFileSync(join(RAIZ, caminho), 'utf8'));
}

// ─── 1. Branco e preto crus ───────────────────────────────────────────────────

/**
 * A utilidade sem matiz. Note que `white`/`black` aceitam opacidade (`bg-black/25`)
 * porque é assim que elas aparecem de verdade — e é a opacidade que esconde o
 * defeito no escuro.
 */
const UTILIDADE_PB =
  /\b(?:bg|text|border|ring|divide|from|via|to|fill|stroke|outline|decoration|accent|caret|placeholder|shadow)-(?:white|black)(?:\/\d+)?\b/g;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ONDE O BRANCO E O PRETO CRUS SÃO O DESENHO, COM O MOTIVO ESCRITO
 * ─────────────────────────────────────────────────────────────────────────────
 *  São três arquivos, todos com a mesma natureza: a cor não está sobre uma
 *  SUPERFÍCIE DO TEMA, está sobre uma ARTE — o gradiente da carta, que vem da
 *  paleta escolhida pela instituição e não muda com o modo (a cor de uma conquista
 *  é como a cor de um time), ou o quadrado do QR. Nos dois casos o véu escuro e o
 *  brilho claro valem nos DOIS modos: tirá-los "para servir ao escuro" apagaria o
 *  efeito no claro, que é exatamente o que a fase proíbe.
 *
 *  O teto é por arquivo: a lista só pode ENCOLHER (como as dívidas do guard).
 */
const DEBITO_PB: Record<string, { teto: number; motivo: string }> = {
  'src/components/gamification/card-visual.tsx': {
    teto: 5,
    motivo:
      'véus e realces SOBRE A ARTE da carta (gradiente da paleta, dado do banco) — a arte não segue o tema',
  },
  'src/components/gamification/holo-card.tsx': {
    teto: 2,
    motivo: 'as duas cápsulas sobre o verso da carta — mesma razão',
  },
  'src/components/credentials/own-badge.tsx': {
    teto: 1,
    motivo:
      'o quadrado branco do QR: leitor de código exige módulo escuro sobre fundo branco — clarear ou escurecer isso quebraria a leitura no balcão',
  },
  'src/components/admin/certificate-template-editor.tsx': {
    teto: 2,
    motivo:
      'o palco e a prévia do certificado simulam PAPEL: o layout é tinta escura sobre SVG transparente, e sobre o cartão escuro o organizador não veria o que está posicionando — papel é branco nos dois modos',
  },
};

describe('FASE 61 · H3 — cor crua que a trava do design system não enxerga', () => {
  it('nenhum branco ou preto cru fora das exceções declaradas', () => {
    const violacoes: string[] = [];
    const obsoletas: string[] = [];

    for (const arquivo of FONTES) {
      const encontrados = (ler(arquivo).match(UTILIDADE_PB) ?? []).length;
      const teto = DEBITO_PB[arquivo]?.teto ?? 0;

      if (encontrados > teto) {
        violacoes.push(
          `${arquivo}: ${encontrados} ocorrência(s) (teto ${teto}) — use o token que inverte com o modo ` +
            '(bg-card, bg-on-surface/5, text-foreground, border-border…) ou declare a exceção com o motivo',
        );
      }

      if (encontrados < teto) {
        obsoletas.push(`${arquivo}: teto ${teto}, encontrado ${encontrados} — baixe o teto`);
      }
    }

    /**
     * Exceção registrada para arquivo que não existe (ou caminho com a barra
     * errada) é dívida fantasma: o teto fica preso num arquivo que ninguém lê e o
     * arquivo real entra sem teto. Este laço é o que mantém a lista honesta.
     */
    for (const arquivo of Object.keys(DEBITO_PB)) {
      if (!FONTES.includes(arquivo)) {
        violacoes.push(`${arquivo}: exceção registrada para arquivo que não está na varredura`);
      }
    }

    expect(violacoes, `\n${violacoes.join('\n')}\n`).toEqual([]);
    expect(obsoletas, `\nDívida quitada ainda registrada:\n${obsoletas.join('\n')}\n`).toEqual([]);
  });

  /**
   * `rgb()`/`hsl()` em componente — o véu "neutro" que assume fundo claro.
   *
   * As duas exceções não são estilo em superfície de tema:
   *  • `global-error.tsx` — a página de erro precisa desenhar SEM o CSS carregado,
   *    então usa estilo inline (é a mesma razão pela qual o guard já libera os
   *    hexadecimais dela);
   *  • `opengraph-image.tsx` — é uma IMAGEM gerada no servidor pelo `next/og`, com
   *    a paleta da carta; não é superfície que o modo escuro alcance.
   */
  const EXCECOES_RGB = [
    'src/app/global-error.tsx',
    'src/app/t/[tenantSlug]/(public)/carta/[token]/opengraph-image.tsx',
  ];
  const RGB_LITERAL = /(?:rgb|rgba|hsl|hsla)\(/g;

  it('nenhum componente escreve rgb() ou hsl() — a cor vem de token', () => {
    const violacoes: string[] = [];

    for (const arquivo of FONTES) {
      if (EXCECOES_RGB.includes(arquivo)) continue;

      const encontrados = (ler(arquivo).match(RGB_LITERAL) ?? []).length;

      if (encontrados > 0) {
        violacoes.push(
          `${arquivo}: ${encontrados} cor(es) em rgb()/hsl() — em valor arbitrário ` +
            '(`bg-[rgb(15_23_42/0.05)]`) ou em `style`, o tom não acompanha o modo; ' +
            'prefira o token e a opacidade dele (`bg-on-surface/5`)',
        );
      }
    }

    expect(violacoes, `\n${violacoes.join('\n')}\n`).toEqual([]);
  });
});

// ─── 2. A escala escura contra o que as telas usam ────────────────────────────

/** O conteúdo de um bloco do CSS, contando chaves (há `color-mix` e `var()` dentro). */
function recortarBloco(seletor: string): string {
  const inicio = CSS.indexOf(seletor);

  if (inicio === -1) throw new Error(`bloco ausente no globals.css: ${seletor}`);

  const abre = CSS.indexOf('{', inicio);
  let profundidade = 0;
  let i = abre;

  for (; i < CSS.length; i += 1) {
    if (CSS[i] === '{') profundidade += 1;
    else if (CSS[i] === '}') {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
  }

  return CSS.slice(abre + 1, i);
}

/** As declarações `--nome: valor;` de um bloco. */
function declaracoes(bloco: string): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const achado of bloco.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    if (achado[1] && achado[2]) mapa.set(achado[1], achado[2].trim());
  }

  return mapa;
}

const CSS = semComentarios(readFileSync(join(RAIZ, 'src/app/globals.css'), 'utf8'));

/** A escala CLARA: o `:root` de cima (a media query do sistema tem o seu próprio). */
const DECLARACOES_CLARAS = declaracoes(recortarBloco(':root'));
/** A escala ESCURA explícita — a classe que a fiação grava no `<html>`. */
const DECLARACOES_ESCURAS = declaracoes(recortarBloco('\n.dark {'));

/** O `@theme`: papel → utilidade do Tailwind (`--color-card: var(--card)`). */
const MAPA_DE_CORES = new Map(
  [...recortarBloco('@theme inline').matchAll(/--color-([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)/g)].map(
    (achado) => [achado[1]!, achado[2]!] as const,
  ),
);

/**
 * Os `--ef-*` que um token semântico alcança, seguindo `var(--…)` até o fim.
 *
 * São dois ou três saltos (`bg-card` → `--card` → `--ef-surface-lowest`; e
 * `bg-primary-soft` → `color-mix(… var(--ef-primary-fixed) …)`), e é por isso que
 * não basta procurar o nome do token no CSS escuro: quem manda no modo é o
 * `--ef-*` do fim da corrente.
 */
function tokensDeBase(nome: string): Set<string> {
  const bases = new Set<string>();
  const visitados = new Set<string>();
  const fila = [nome];

  while (fila.length > 0) {
    const atual = fila.pop()!;

    if (visitados.has(atual)) continue;
    visitados.add(atual);

    const valor = DECLARACOES_CLARAS.get(atual);
    if (valor === undefined) continue;

    for (const referencia of valor.matchAll(/--([a-z0-9-]+)/g)) {
      const alvo = referencia[1]!;

      if (alvo.startsWith('ef-')) bases.add(alvo);
      else fila.push(alvo);
    }
  }

  return bases;
}

/** Os prefixos de utilidade que carregam COR no Tailwind. */
const PREFIXOS = [
  'bg',
  'text',
  'border',
  'ring',
  'divide',
  'from',
  'via',
  'to',
  'fill',
  'stroke',
  'outline',
  'decoration',
  'accent',
  'caret',
  'placeholder',
];
const UTILIDADE_COR = new RegExp(`\\b(?:${PREFIXOS.join('|')})-([a-z][a-z0-9-]*)`, 'g');

/**
 * Que tokens de cor as telas e os componentes USAM, e em que arquivos.
 *
 * Só entra o que existe no `@theme` como cor: `text-sm`, `border-dashed` e
 * `bg-clip-text` também casam com o regex, mas não são cor — e uma classe que não
 * existe no `@theme` simplesmente não gera CSS (o Tailwind a ignora), então não há
 * token para cobrar do modo escuro.
 */
function tokensUsados(): Map<string, Set<string>> {
  const usados = new Map<string, Set<string>>();

  for (const arquivo of FONTES) {
    for (const achado of ler(arquivo).matchAll(UTILIDADE_COR)) {
      const token = achado[1]!;
      if (!MAPA_DE_CORES.has(token)) continue;

      const arquivos = usados.get(token) ?? new Set<string>();
      arquivos.add(arquivo);
      usados.set(token, arquivos);
    }
  }

  return usados;
}

describe('FASE 61 · H3 — a escala escura não deixa token para trás', () => {
  it('a escala escura declara todos os tokens da clara, e nenhum a mais', () => {
    /**
     * Token novo nasce nas DUAS escalas (ADR-324). Sem esta comparação, um
     * `--ef-*` novo só no `:root` vira valor claro dentro do tema escuro — e o
     * defeito é um retângulo claro no painel, que nenhum teste de contraste pega
     * (os pares medidos continuam passando; o que quebrou nem está na lista).
     */
    const claros = [...DECLARACOES_CLARAS.keys()].filter((nome) => nome.startsWith('ef-')).sort();
    const escuros = [...DECLARACOES_ESCURAS.keys()].filter((nome) => nome.startsWith('ef-')).sort();

    expect(escuros, 'token da escala clara ausente no modo escuro').toEqual(claros);
  });

  it('todo token de cor que as telas usam é declarado nas duas escalas', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A VARREDURA, DO LADO DO COMPONENTE
     * ─────────────────────────────────────────────────────────────────────────────
     *  O caso acima compara as duas escalas; este pergunta o que as TELAS usam. Um
     *  token declarado só no claro PASSA no caso acima? Não passa — mas um token
     *  que existe apenas porque a escala escura o declarou não aparece em nenhuma
     *  tela, e um que a tela usa por um caminho de `color-mix` (o `-soft`, o
     *  `primary-soft`) só é encontrado seguindo a corrente. É essa corrente que
     *  prende o que o modo escuro tem de cobrir de verdade.
     */
    const violacoes: string[] = [];

    for (const [token, arquivos] of tokensUsados()) {
      const alias = MAPA_DE_CORES.get(token)!;

      for (const base of tokensDeBase(alias)) {
        if (!DECLARACOES_ESCURAS.has(base)) {
          violacoes.push(
            `--${base} (alcançado por --color-${token} = var(--${alias})) não é declarado no modo escuro ` +
              `— usado em ${[...arquivos].join(', ')}`,
          );
        }
      }
    }

    expect(violacoes, `\n${violacoes.join('\n')}\n`).toEqual([]);
  });
});

// ─── 3. O impresso não tem modo escuro ────────────────────────────────────────

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PAPEL É BRANCO, E PDF/ZPL NÃO RESOLVEM `var()`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O certificado e o crachá nascem no servidor para papel: o operador de PDF é
 *  `r g b rg` e a impressora recebe `^FO…^GB…^FS`. Um `var(--ef-…)` no stream não
 *  seria "tema escuro" — seria um documento quebrado. Por isso os módulos abaixo
 *  recebem VALOR (o `badge-print-service` resolve o tema com `resolveTheme` e passa
 *  hexadecimal), e este caso prende a regra: o dia em que alguém escrever
 *  `var(--color-…)` num renderizador de documento, o teste diz onde.
 *
 *  O crachá NA TELA (`own-badge.tsx`) e o da FOLHA são documentos diferentes de
 *  propósito: a tela segue o tema, o papel não.
 */
const MODULOS_IMPRESSOS = [
  'src/lib/certificates/renderer.ts',
  'src/lib/certificates/layout-renderer.ts',
  'src/lib/documents/layout-draw.ts',
  'src/lib/credentials/badge-renderer.ts',
  'src/lib/events/badge-print-service.ts',
  'src/app/api/t/[tenantSlug]/credenciamento/crachas/folha/route.ts',
  'src/app/api/t/[tenantSlug]/credenciamento/crachas/impressao/route.ts',
  'src/app/api/t/[tenantSlug]/certificados/zip/route.ts',
  'src/app/api/certificados/[code]/arquivo/route.ts',
];

describe('FASE 61 · H3 — o documento impresso não lê token de tema', () => {
  it('nenhum renderizador de PDF/ZPL referencia variável CSS', () => {
    const leitores: string[] = [];

    for (const caminho of MODULOS_IMPRESSOS) {
      /** O arquivo precisa existir: renomear um renderizador não pode afrouxar isto. */
      const fonte = ler(caminho);

      if (fonte.includes('var(--')) leitores.push(caminho);
    }

    expect(
      leitores,
      `\nEstes módulos de impressão passaram a ler variável de tema (papel não tem modo escuro):\n${leitores.join('\n')}\n`,
    ).toEqual([]);
  });
});

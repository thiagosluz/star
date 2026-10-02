/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 61 · dívida H3 — A CATRACA DA ESCALA ESCURA COMPLETA
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE TESTE IMPEDE DE VOLTAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A H3 existiu por cinquenta fases porque o tema escuro era uma lista de vinte
 *  variáveis escritas "para não quebrar `dark:` herdado" — e ninguém tinha como
 *  saber que estava incompleta. Um token novo nascia só no `:root`, o modo escuro
 *  continuava com a cor clara naquele papel, e o defeito aparecia em UMA tela, na
 *  máquina de quem usa o sistema escuro. Não havia sintoma no `tsc`, no lint nem
 *  na suíte.
 *
 *  A régua desta catraca é o ADR-324: "token novo nasce nas DUAS escalas". Ela
 *  compara os conjuntos por nome — todo token de cor do `:root` tem de existir no
 *  bloco escuro — e confere que os dois blocos escuros (a classe `.dark` e a
 *  media query do sistema) são idênticos, porque dois blocos com o mesmo nome e
 *  valores diferentes é a divergência que ninguém vê.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FICA FIXO ENTRE OS MODOS, E POR QUE ISSO É DECISÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nove tokens têm o MESMO valor nos dois modos, e cada um tem motivo escrito:
 *  o telão do sorteio (`inverse-*`, `warning-strong-on-dark`) é escuro por desenho
 *  e a F52 mediu o aviso dele; a arte das cartas (`tier-*`) é cor de conquista, não
 *  superfície; e `surface-bright`/`surface-tint` são direções da escada Material 3.
 *  Este teste exige que a lista de exceções seja EXATA: token que ficar igual sem
 *  estar declarado reprova, e exceção que passar a divergir também — a lista não
 *  pode virar depósito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync('src/app/globals.css', 'utf8');

/**
 * O mesmo arquivo SEM comentários. O bloco da F61 explica a fase citando `@theme`
 * e `:root`, e procurar marca de seletor em texto de comentário daria falso
 * positivo — foi assim que a armadilha apareceu ao escrever este teste.
 */
const CSS_SEM_COMENTARIOS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Recorta o bloco de um seletor contando chaves (há `color-mix(...)` no arquivo). */
function recortarBloco(fonte: string, seletor: string): string {
  const inicio = fonte.indexOf(seletor);

  if (inicio === -1) throw new Error(`bloco não encontrado no globals.css: ${seletor}`);

  let profundidade = 0;
  let i = fonte.indexOf('{', inicio);
  const abre = i;

  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') profundidade += 1;
    if (fonte[i] === '}') {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
  }

  return fonte.slice(abre + 1, i);
}

/**
 * O bloco do modo escuro é recortado a partir da MARCA do seletor (`.dark {` no
 * começo de linha) para não casar com `dark:` herdado dentro de comentário.
 */
const RAIZ = recortarBloco(CSS_SEM_COMENTARIOS, ':root');
const CLASSE_ESCURA = recortarBloco(CSS_SEM_COMENTARIOS, '\n.dark {');
const MEDIA_ESCURA = recortarBloco(CSS_SEM_COMENTARIOS, '@media (prefers-color-scheme: dark)');
/**
 * O bloco do sistema é o `:root` GUARDADO. A guarda não é detalhe de estilo: sem
 * ela, quem escolheu "Claro" num sistema operacional escuro continuaria vendo
 * escuro (o defeito da H3 de cabeça para baixo), porque `:root` e `:root` têm a
 * mesma especificidade e a media query vem depois. Ver o caso
 * "a escolha explícita de claro vence a preferência escura do sistema".
 */
const SELETOR_DO_SISTEMA = ":root:not([data-tema='claro'])";
const SISTEMA_ESCURO = recortarBloco(MEDIA_ESCURA, SELETOR_DO_SISTEMA);

/**
 * Os tokens `--ef-*` de COR (valor hexadecimal) de um bloco, na ordem do arquivo.
 * Só a camada `--ef-*` interessa: é ela que o `@theme inline` publica, e é a única
 * que a escala escura redefine (ADR-324).
 */
function tokensDeCor(bloco: string): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const achado of bloco.matchAll(/--(ef-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (achado[1] && achado[2]) mapa.set(achado[1], achado[2].toLowerCase());
  }

  return mapa;
}

/**
 * As variáveis SEM prefixo — os apelidos que os componentes leem (`--card`,
 * `--border`, `--muted-foreground`). Elas não têm valor hexadecimal (são
 * `var(...)`), então são lidas por nome.
 */
function apelidos(bloco: string): Set<string> {
  const nomes = new Set<string>();

  for (const achado of bloco.matchAll(/^\s*--((?!ef-)[a-z0-9-]+):/gm)) {
    if (achado[1]) nomes.add(achado[1]);
  }

  return nomes;
}

const TOKENS_CLAROS = tokensDeCor(RAIZ);
const TOKENS_ESCUROS = tokensDeCor(CLASSE_ESCURA);
const TOKENS_DO_SISTEMA = tokensDeCor(SISTEMA_ESCURO);

/**
 * Os apelidos que os componentes leem e que PRECISAM ser reescritos no modo
 * escuro, porque o valor deles é uma MISTURA com o branco do `:root` — deixá-los
 * como estão faria o alerta de sucesso do escuro nascer com o fundo claro (e a
 * F61 mediu: um fundo claro com texto claro mede 1,3:1).
 */
const APELIDOS_MISTURADOS = ['primary-soft', 'success-soft', 'warning-soft', 'destructive-soft'];

/**
 * Os tokens que valem o MESMO nos dois modos, com o motivo. A lista é comparada
 * nos dois sentidos: token declarado aqui que passe a divergir reprova, e a
 * contagem abaixo impede um token novo de nascer clonando o claro.
 */
const FIXOS_ENTRE_OS_MODOS: Record<string, string> = {
  'ef-inverse-surface': 'o telão e as cápsulas sobre imagem já são escuros nos dois modos',
  'ef-inverse-on-surface': 'é o texto DAQUELA superfície, não do fundo da página',
  'ef-warning-strong-on-dark': 'o par de aviso do telão, medido na F52 (9,17:1)',
  'ef-tier-common-from': 'arte da carta (cor de conquista), não texto sobre superfície',
  'ef-tier-common-to': 'arte da carta',
  'ef-tier-rare-from': 'arte da carta',
  'ef-tier-rare-to': 'arte da carta',
  'ef-tier-epic-from': 'arte da carta',
  'ef-tier-epic-to': 'arte da carta',
  'ef-tier-legendary-from': 'arte da carta',
  'ef-tier-legendary-to': 'arte da carta',
  'ef-tier-mythic-from': 'arte da carta',
  'ef-tier-mythic-mid': 'arte da carta',
  'ef-tier-mythic-to': 'arte da carta',
};

/**
 * Os tokens que COINCIDEM em hexadecimal nos dois modos sem serem "o mesmo
 * papel". Eles existem porque a coincidência é legítima: o claro pede branco
 * sobre o indigo de ação e o escuro também, mas por outro motivo (o indigo do
 * botão do escuro é outro). A lista serve para o leitor — a catraca de verdade é
 * a CONTAGEM abaixo.
 */
const COINCIDEM_POR_OUTRO_MOTIVO: Record<string, string> = {
  'ef-on-primary': 'o rótulo do botão de ação é branco nos dois modos (indigos diferentes)',
  'ef-on-primary-container': 'tom de apoio sobre a marca: legível sobre o lilás claro e sobre o indigo escuro',
  'ef-primary-fixed-dim': 'tom de apoio da marca: mesma família nos dois modos',
  'ef-inverse-primary': 'tom da marca refletido no telão, que não muda',
};

/**
 * Quantos tokens de cor têm o MESMO valor nos dois modos. O número é o contrato:
 * 14 tokens fixos por desenho (telão, arte da carta, direções da escada) + 4
 * coincidências de tom = 18. Um token NOVO que nasça com o valor do claro reprova
 * aqui, e quem o criou tem de decidir conscientemente se ele é fixo — que é
 * exatamente a pergunta que a H3 deixou sem resposta por cinquenta fases.
 */
const TOKENS_IGUAIS_ENTRE_OS_MODOS = 18;

describe('FASE 61 · H3 — a escala escura não pode nascer incompleta', () => {
  it('TODO token de cor da escala clara existe também na escala escura', () => {
    const faltando = [...TOKENS_CLAROS.keys()].filter((token) => !TOKENS_ESCUROS.has(token)).sort();

    expect(
      faltando,
      `\nToken de cor sem valor no modo escuro (o papel existe no claro e não no escuro):\n${faltando.join('\n')}\n`,
    ).toEqual([]);
  });

  it('a escala escura não inventa token que não existe no claro', () => {
    /**
     * O outro lado da mesma régua: um token que só existe no escuro é o defeito
     * espelhado — o modo claro receberia a cor do escuro por herança, e o papel
     * não teria valor próprio na identidade.
     */
    const sobrando = [...TOKENS_ESCUROS.keys()].filter((token) => !TOKENS_CLAROS.has(token)).sort();

    expect(sobrando, `\nToken que só existe no modo escuro:\n${sobrando.join('\n')}\n`).toEqual([]);
  });

  it('o bloco da classe e o da media query do sistema são idênticos', () => {
    /**
     * Dois blocos com o mesmo nome e valores diferentes só aparecem na máquina de
     * quem usa o tema do sistema — que é, exatamente, a população descrita pela
     * H3. Comparar os dois conjuntos inteiros é o que impede essa divergência.
     */
    expect([...TOKENS_ESCUROS.keys()].sort()).toEqual([...TOKENS_DO_SISTEMA.keys()].sort());

    for (const [token, valor] of TOKENS_ESCUROS) {
      expect(TOKENS_DO_SISTEMA.get(token), `--${token} difere entre .dark e a media query`).toBe(valor);
    }
  });

  it('o que muda e o que fica fixo entre os modos é uma decisão CONTADA', () => {
    const iguais = [...TOKENS_CLAROS].filter(([token, valor]) => TOKENS_ESCUROS.get(token) === valor);

    /**
     * A contagem é a catraca. As duas listas acima são a explicação de cada caso;
     * o número é o que impede o próximo token de nascer clonando o claro sem
     * ninguém decidir nada.
     */
    expect(
      iguais.length,
      `tokens com o mesmo valor no claro e no escuro: ${iguais.map(([token]) => `--${token}`).join(', ')}`,
    ).toBe(TOKENS_IGUAIS_ENTRE_OS_MODOS);

    /** E cada token declarado como fixo precisa estar de fato igual nos dois modos. */
    for (const token of [...Object.keys(FIXOS_ENTRE_OS_MODOS), ...Object.keys(COINCIDEM_POR_OUTRO_MOTIVO)]) {
      expect(
        TOKENS_ESCUROS.get(token),
        `--${token} está declarado como fixo, mas o modo escuro o mudou`,
      ).toBe(TOKENS_CLAROS.get(token));
    }

    /**
     * Nenhum `--ef-*` de cor pode ficar de fora das duas listas sem estar na
     * contagem: se a contagem e as listas não fecham, o motivo de um token estar
     * igual é desconhecido — e é isso que a H3 foi por cinquenta fases.
     */
    expect(Object.keys(FIXOS_ENTRE_OS_MODOS).length + Object.keys(COINCIDEM_POR_OUTRO_MOTIVO).length).toBe(
      TOKENS_IGUAIS_ENTRE_OS_MODOS,
    );
  });

  it('os apelidos que os componentes leem continuam publicados — e os misturados são reescritos', () => {
    /**
     * Os componentes não leem `--ef-card`: leem `--card`. Se o bloco escuro
     * parasse de publicar o que o `@theme inline` traduz, a tela ficaria com o
     * valor do `:root` — o modo escuro "funcionaria" só nos lugares que usam o
     * prefixo, que é a metade invisível do defeito.
     */
    const doClaro = apelidos(RAIZ);
    const doEscuro = apelidos(CLASSE_ESCURA);

    for (const nome of APELIDOS_MISTURADOS) {
      expect(doClaro.has(nome), `--${nome} não existe no :root`).toBe(true);
      expect(doEscuro.has(nome), `--${nome} precisa ser reescrito no modo escuro (mistura com branco)`).toBe(
        true,
      );
    }

    /** Os demais vêm de `var()` puro e NÃO podem ser duplicados como literal. */
    const misturados = new Set(APELIDOS_MISTURADOS);
    const duplicadosLiterais = [...doEscuro]
      .filter((nome) => !misturados.has(nome))
      .map((nome) => {
        const declaracao = new RegExp(`^\\s*--${nome}:\\s*([^;]+);`, 'm').exec(CLASSE_ESCURA)?.[1] ?? '';

        return declaracao.includes('#') ? nome : null;
      })
      .filter((nome): nome is string => nome !== null);

    expect(
      duplicadosLiterais,
      `\nEstes apelidos ganharam valor literal no modo escuro — eles devem continuar vindo de var(--ef-*):\n${duplicadosLiterais.join('\n')}\n`,
    ).toEqual([]);
  });

  it('a escolha explícita de CLARO vence a preferência escura do sistema', () => {
    /**
     * ───────────────────────────────────────────────────────────────────────────
     *  O DEFEITO QUE ISTO PRENDE — e ele é o INVERSO do que a H3 descrevia
     * ───────────────────────────────────────────────────────────────────────────
     *  `@media (prefers-color-scheme: dark) { :root { … } }` sem guarda tem a
     *  MESMA especificidade do `:root` de cima, e vem DEPOIS: num sistema
     *  operacional escuro, quem escolheu "Claro" continuaria vendo escuro. A
     *  escolha da pessoa perderia para a do sistema operacional — o defeito da H3
     *  de cabeça para baixo, e igualmente invisível em revisão de código.
     *
     *  A guarda lê o `data-tema` que a fiação grava SEMPRE no `<html>`
     *  (`claro` | `escuro` | `sistema`), e o `:not()` ainda sobe a especificidade
     *  do seletor de (0,1,0) para (0,2,0).
     */
    expect(
      MEDIA_ESCURA,
      "a media query do sistema precisa da guarda :not([data-tema='claro'])",
    ).toContain(SELETOR_DO_SISTEMA);

    /** E o valor lido pela guarda é o mesmo que a fiação escreve — o contrato. */
    expect(MEDIA_ESCURA).toContain("[data-tema='claro']");

    /** O escuro explícito continua sendo a classe, e não um valor de `data-tema`. */
    expect(CSS_SEM_COMENTARIOS).toContain('\n.dark {');
  });

  it('o `@theme inline` NÃO é duplicado no modo escuro (os apelidos são a única ponte)', () => {
    /**
     * O ganho de desenho da fase: o `@theme` publica papel em utilidade do
     * Tailwind e é escrito UMA vez. Se alguém "resolver" o modo escuro com um
     * segundo `@theme`, as duas listas passam a envelhecer separadas — e metade
     * das utilidades fica presa no modo claro.
     */
    const posicaoDaClasse = CSS_SEM_COMENTARIOS.indexOf('\n.dark {');
    const depoisDoEscuro = CSS_SEM_COMENTARIOS.slice(posicaoDaClasse);

    expect(posicaoDaClasse, 'o bloco .dark precisa existir').toBeGreaterThan(0);
    expect(depoisDoEscuro).not.toContain('@theme');
    expect(
      CSS_SEM_COMENTARIOS.match(/@theme/g)?.length,
      'o arquivo deve ter os dois @theme originais (inline e tipografia)',
    ).toBe(2);
  });

  it('cada modo declara o `color-scheme` que lhe corresponde', () => {
    expect(RAIZ).toContain('color-scheme: light');
    expect(CLASSE_ESCURA).toContain('color-scheme: dark');
    expect(MEDIA_ESCURA).toContain('color-scheme: dark');
  });

  it('o seletor do modo escuro é `.dark` — o mesmo que a fiação grava', () => {
    /**
     * Três estados (claro · escuro · sistema) e UMA classe. A fase de tokens não
     * escreve a fiação: ela publica o seletor, e é este teste que fixa o
     * contrato entre as duas metades da fase.
     */
    expect(CSS_SEM_COMENTARIOS).toContain('\n.dark {');
    expect(CSS_SEM_COMENTARIOS, 'o modo do sistema é a media query, não uma classe').toContain(
      '@media (prefers-color-scheme: dark)',
    );
  });
});

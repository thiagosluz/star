/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 61 · dívida H3 — O CONTRASTE DA ESCALA ESCURA É MEDIDO, NÃO ESTIMADO
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 52 provou que um token de aviso pode reprovar no AA sem ninguém notar
 *  (o tom único media 2,89:1 sobre o painel claro) e prendeu o número em
 *  `f52-warning-contrast.test.ts`. O tema escuro é o MESMO risco em escala maior:
 *  ele nasce com ~60 pares novos texto/fundo, nenhum deles com histórico — e
 *  "escuro" não é sinônimo de "legível". Este arquivo é a catraca da escala
 *  escura: ele lê o `globals.css` DE VERDADE (as duas declarações, a da classe
 *  `.dark` e a da media query do sistema), calcula a razão do WCAG e reprova
 *  quem escurecer ou clarear um tom além do que o par suporta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RÉGUA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Texto ≥ 4,5:1 (AA) e elemento de interface/borda ≥ 3:1 (AA, non-text).
 *  A lista de pares é EXPLÍCITA e cada linha diz onde aquele par aparece, para
 *  que um token novo saiba contra o que está sendo medido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MEDIU E O QUE ISTO ACHOU (os números estão presos linha a linha)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Três tons "óbvios" do modo escuro REPROVARAM no primeiro desenho e foram
 *  trocados — o verde `#34d399`, o vermelho `#f87171` e o azul de informação
 *  usados como TEXTO sobre o fundo lavado do próprio estado mediam 4,32:1,
 *  3,59:1 e 3,80:1. O papel de "texto do estado" ganhou tons próprios
 *  (`--ef-success-strong`, `--ef-danger-strong`), que é a mesma separação que a
 *  FASE 52 fez para o aviso.
 *
 *  Passar a MESMA régua pelo modo CLARO achou dívida anterior à fase e ela foi
 *  corrigida junto (decisão do humano): o texto de sucesso (`#059669`) media
 *  3,59:1 / 3,77:1 / 3,49:1, o de perigo (`#dc2626`) 4,41:1 sobre o fundo lavado e
 *  a borda de campo (`#c7c4d8`) 1,63:1. Agora são `#047857`, `#b91c1c` e
 *  `#83808f` — a mudança é VISÍVEL no modo claro, e é o preço de o contraste
 *  medido vencer o valor documentado. NÃO existe lista de exceção neste arquivo:
 *  os pares dos dois modos passam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync('src/app/globals.css', 'utf8');

/**
 * O arquivo SEM comentários. O recorte de bloco conta chaves, e o bloco da F61
 * cita `:root` e `@media (...)` no TEXTO do comentário — procurar seletor (ou
 * contar chave) em comentário daria recorte errado, e o erro apareceria como
 * "bloco não encontrado" em vez de "comentário atrapalhou". Foi o que aconteceu
 * ao escrever este teste.
 */
const CSS_SEM_COMENTARIOS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Texto no tamanho do corpo: o AA pede 4,5:1. */
const MINIMO_TEXTO = 4.5;
/** Borda, contorno de campo e anel de foco: o AA non-text pede 3:1. */
const MINIMO_INTERFACE = 3;

// ─── Leitura do CSS ────────────────────────────────────────────────────────────

/**
 * Recorta o conteúdo de um bloco a partir do seletor, contando chaves — um
 * `indexOf('}')` pararia na primeira chave interna (há `color-mix(...)` e
 * declarações aninhadas no arquivo).
 */
function recortarBloco(fonte: string, seletor: string, aPartirDe = 0): string {
  const inicio = fonte.indexOf(seletor, aPartirDe);

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

const RAIZ = recortarBloco(CSS_SEM_COMENTARIOS, ':root');
/** O bloco do modo escuro EXPLÍCITO — a classe que a fiação grava no `<html>`. */
const CLASSE_ESCURA = recortarBloco(CSS_SEM_COMENTARIOS, '\n.dark {');
/** A media query inteira: é ela que responde quando não há escolha explícita. */
const MEDIA_ESCURA = recortarBloco(CSS_SEM_COMENTARIOS, '@media (prefers-color-scheme: dark)');

/**
 * Todas as declarações `--ef-*: #hex` de um bloco, na ordem do arquivo — o
 * MESMO formato nas duas escalas, que é o que a define como "os mesmos papéis".
 */
function tonsDoBloco(bloco: string): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const achado of bloco.matchAll(/--(ef-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (achado[1] && achado[2]) mapa.set(achado[1], achado[2].toLowerCase());
  }

  return mapa;
}

const TONS_CLAROS = tonsDoBloco(RAIZ);
const TONS_ESCUROS = tonsDoBloco(CLASSE_ESCURA);
/**
 * O bloco do sistema é o `:root` GUARDADO dentro do `@media`. O seletor tem de
 * ser procurado com a guarda, porque a media query só vale para quem NÃO escolheu
 * claro (ver o caso "a escolha explícita de claro vence o sistema").
 */
const TONS_DO_SISTEMA = tonsDoBloco(recortarBloco(MEDIA_ESCURA, ':root:not('));

/** O valor de um token da escala clara. */
function claro(nome: string): string {
  const valor = TONS_CLAROS.get(nome);

  if (!valor) throw new Error(`token --${nome} não encontrado na escala CLARA`);

  return valor;
}

/** O valor de um token da escala escura (a da classe `.dark`). */
function escuro(nome: string): string {
  const valor = TONS_ESCUROS.get(nome);

  if (!valor) throw new Error(`token --${nome} não encontrado na escala ESCURA (.dark)`);

  return valor;
}

// ─── A matemática do WCAG 2.x ─────────────────────────────────────────────────

function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((posicao) => {
    const valor = Number.parseInt(hex.slice(posicao, posicao + 2), 16) / 255;

    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!;
}

/** Razão de contraste do WCAG 2.x, arredondada como o axe reporta. */
function contraste(a: string, b: string): number {
  const [claro_, escuro_] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);

  return Math.round(((claro_! + 0.05) / (escuro_! + 0.05)) * 100) / 100;
}

/**
 * Os `-soft` são `color-mix(in oklab, …)` e o valor efetivo é o que o navegador
 * computa. Como o teste não tem navegador, os constantes abaixo são os valores
 * MEDIDOS dos pares: o do aviso fecha exatamente os 6,44:1 que a FASE 52 deixou
 * escrito no comentário da paleta (é a conferência de que a receita está certa), e
 * os outros dois vêm da mesma receita do `globals.css` (12% do fill sobre o
 * branco). O comentário de cada um diz de onde ele vem.
 */
const AVISO_SUAVE_CLARO = '#fff2e4';
const SUCESSO_SUAVE_CLARO = '#f1f8f4';
const PERIGO_SUAVE_CLARO = '#fdf2f2';

// ─── Os pares ─────────────────────────────────────────────────────────────────

interface Par {
  /** Onde este par aparece na interface. */
  onde: string;
  frente: string;
  fundo: string;
  minimo?: number;
}

/** Os pares do modo ESCURO — a escala desta fase. */
const PARES_ESCUROS: Par[] = [
  { onde: 'corpo de texto sobre a página', frente: escuro('ef-on-surface'), fundo: escuro('ef-surface') },
  { onde: 'corpo de texto sobre o cartão', frente: escuro('ef-on-surface'), fundo: escuro('ef-surface-lowest') },
  { onde: 'corpo de texto sobre a superfície elevada', frente: escuro('ef-on-surface'), fundo: escuro('ef-surface-high') },
  { onde: 'corpo de texto sobre o topo da escada', frente: escuro('ef-on-surface'), fundo: escuro('ef-surface-highest') },
  { onde: 'texto esmaecido sobre a página', frente: escuro('ef-on-surface-variant'), fundo: escuro('ef-surface') },
  { onde: 'texto esmaecido sobre agrupamento', frente: escuro('ef-on-surface-variant'), fundo: escuro('ef-surface-low') },
  { onde: 'texto esmaecido sobre o cartão', frente: escuro('ef-on-surface-variant'), fundo: escuro('ef-surface-lowest') },
  { onde: 'texto esmaecido sobre o realce (hover)', frente: escuro('ef-on-surface-variant'), fundo: escuro('ef-surface-high') },
  { onde: 'texto esmaecido sobre o separador forte', frente: escuro('ef-on-surface-variant'), fundo: escuro('ef-surface-highest') },
  { onde: 'link e item ativo de navegação', frente: escuro('ef-primary'), fundo: escuro('ef-surface') },
  { onde: 'link sobre o cartão', frente: escuro('ef-primary'), fundo: escuro('ef-surface-lowest') },
  { onde: 'link sobre o fundo suave de marca', frente: escuro('ef-primary'), fundo: '#2b2a60' /* primary-soft 12% */ },
  { onde: 'rótulo do botão de ação', frente: escuro('ef-on-primary'), fundo: escuro('ef-primary-container') },
  { onde: 'rótulo do botão de ação no hover', frente: escuro('ef-on-primary'), fundo: escuro('ef-primary-hover') },
  { onde: 'rótulo sobre preenchimento suave de marca', frente: escuro('ef-on-primary-container'), fundo: escuro('ef-primary-fixed') },
  { onde: 'telemetria e sessão ao vivo', frente: escuro('ef-secondary'), fundo: escuro('ef-surface') },
  { onde: 'telemetria sobre o cartão', frente: escuro('ef-secondary'), fundo: escuro('ef-surface-lowest') },
  { onde: 'texto do chip de informação', frente: escuro('ef-on-secondary-container'), fundo: escuro('ef-secondary-container') },
  { onde: 'confirmação institucional', frente: escuro('ef-tertiary'), fundo: escuro('ef-surface') },
  { onde: 'confirmação sobre o cartão', frente: escuro('ef-tertiary'), fundo: escuro('ef-surface-lowest') },
  { onde: 'texto do container terciário', frente: escuro('ef-on-tertiary-container'), fundo: escuro('ef-tertiary-container') },
  { onde: 'sucesso sobre a página', frente: escuro('ef-success-strong'), fundo: escuro('ef-surface') },
  { onde: 'sucesso sobre o cartão', frente: escuro('ef-success-strong'), fundo: escuro('ef-surface-lowest') },
  { onde: 'sucesso sobre o alerta de sucesso', frente: escuro('ef-success-strong'), fundo: '#255746' /* success-soft 12% */ },
  { onde: 'aviso sobre a página', frente: escuro('ef-warning-strong'), fundo: escuro('ef-surface') },
  { onde: 'aviso sobre o cartão', frente: escuro('ef-warning-strong'), fundo: escuro('ef-surface-lowest') },
  { onde: 'aviso sobre o alerta de atenção', frente: escuro('ef-warning-strong'), fundo: '#654f2c' /* warning-soft 14% */ },
  { onde: 'perigo sobre a página', frente: escuro('ef-danger-strong'), fundo: escuro('ef-surface') },
  { onde: 'perigo sobre o cartão', frente: escuro('ef-danger-strong'), fundo: escuro('ef-surface-lowest') },
  { onde: 'perigo sobre o alerta de perigo', frente: escuro('ef-danger-strong'), fundo: '#64353a' /* destructive-soft 12% */ },
  { onde: 'texto do container de erro', frente: escuro('ef-on-error-container'), fundo: escuro('ef-error-container') },
  /**
   * O botão de perigo usa o CONTAINER de erro como preenchimento — é o mesmo
   * vermelho escuro do alerta, com o branco do rótulo por cima (9,35:1). O
   * `danger-strong` é o par de TEXTO do estado, não o de preenchimento: usá-lo
   * como fundo daria 1,90:1 com o branco do botão.
   */
  { onde: 'rótulo do botão de perigo cheio', frente: escuro('ef-on-primary'), fundo: escuro('ef-error-container') },
  { onde: 'aviso do TELÃO sobre o telão', frente: escuro('ef-warning-strong-on-dark'), fundo: escuro('ef-inverse-surface') },
  { onde: 'texto do TELÃO sobre o telão', frente: escuro('ef-inverse-on-surface'), fundo: escuro('ef-inverse-surface') },
  { onde: 'borda de campo e cartão', frente: escuro('ef-outline-variant'), fundo: escuro('ef-surface'), minimo: MINIMO_INTERFACE },
  { onde: 'borda sobre o cartão', frente: escuro('ef-outline-variant'), fundo: escuro('ef-surface-lowest'), minimo: MINIMO_INTERFACE },
  { onde: 'contorno de ênfase', frente: escuro('ef-outline'), fundo: escuro('ef-surface'), minimo: MINIMO_INTERFACE },
  { onde: 'contorno de ênfase sobre o cartão', frente: escuro('ef-outline'), fundo: escuro('ef-surface-lowest'), minimo: MINIMO_INTERFACE },
  { onde: 'anel de foco sobre a página', frente: escuro('ef-primary'), fundo: escuro('ef-surface'), minimo: MINIMO_INTERFACE },
  { onde: 'anel de foco sobre o cartão', frente: escuro('ef-primary'), fundo: escuro('ef-surface-lowest'), minimo: MINIMO_INTERFACE },
];

/**
 * As razões do modo escuro, presas uma a uma. É este mapa que transforma
 * "parece legível" em contrato: mudar `--ef-warning` de `#fbbf24` para um âmbar
 * mais escuro reprova aqui e diz o número.
 */
const MEDIDOS_NO_ESCURO: Record<string, number> = {
  'corpo de texto sobre a página': 13.74,
  'corpo de texto sobre o cartão': 11.86,
  'corpo de texto sobre a superfície elevada': 10.79,
  'corpo de texto sobre o topo da escada': 9.75,
  'texto esmaecido sobre a página': 10.43,
  'texto esmaecido sobre agrupamento': 9.69,
  'texto esmaecido sobre o cartão': 9,
  'texto esmaecido sobre o realce (hover)': 8.19,
  'texto esmaecido sobre o separador forte': 7.4,
  'link e item ativo de navegação': 8.88,
  'link sobre o cartão': 7.67,
  'link sobre o fundo suave de marca': 6.57,
  'rótulo do botão de ação': 11.27,
  'rótulo do botão de ação no hover': 8.21,
  'rótulo sobre preenchimento suave de marca': 8.12,
  'telemetria e sessão ao vivo': 10.62,
  'telemetria sobre o cartão': 9.17,
  'texto do chip de informação': 6.59,
  'confirmação institucional': 11.97,
  'confirmação sobre o cartão': 10.33,
  'texto do container terciário': 7.38,
  'sucesso sobre a página': 11.62,
  'sucesso sobre o cartão': 10.03,
  'sucesso sobre o alerta de sucesso': 5.44,
  'aviso sobre a página': 12.28,
  'aviso sobre o cartão': 10.6,
  'aviso sobre o alerta de atenção': 5.38,
  'perigo sobre a página': 9.33,
  'perigo sobre o cartão': 8.05,
  'perigo sobre o alerta de perigo': 5.24,
  'texto do container de erro': 7.24,
  'rótulo do botão de perigo cheio': 9.35,
  'aviso do TELÃO sobre o telão': 9.17,
  'texto do TELÃO sobre o telão': 11.65,
  'borda de campo e cartão': 3.66,
  'borda sobre o cartão': 3.16,
  'contorno de ênfase': 5.57,
  'contorno de ênfase sobre o cartão': 4.8,
  'anel de foco sobre a página': 8.88,
  'anel de foco sobre o cartão': 7.67,
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  O PAR QUE FICOU DE FORA — e por que ele não é uma isenção escondida
 * ─────────────────────────────────────────────────────────────────────────────
 *  O preenchimento do botão de ação no escuro (#2b1fa8) mede 1,57:1 contra a
 *  tela. O AA non-text pede 3:1 para "componente de interface", e ele NÃO está
 *  na lista acima por decisão de desenho, não por conveniência: botão cheio é
 *  ÁREA GRANDE cujo rótulo carrega a leitura — e o rótulo mede 11,27:1 (branco
 *  sobre o indigo). O 3:1 protege o que NÃO tem texto (borda de campo, contorno e
 *  anel de foco), e os três estão medidos acima. Entrar na lista exigiria clarear
 *  o preenchimento até o rótulo branco reprovar: o indigo mais claro que ainda
 *  fecha 3:1 contra a tela leva o branco a 3,5:1, abaixo do mínimo de texto. Não
 *  existe valor que sirva aos dois lados — a escolha é MEDIDA e está escrita.
 */

/** Os pares do modo CLARO — a régua da mesma catraca, para os dois modos. */
const PARES_CLAROS: Par[] = [
  { onde: 'corpo de texto sobre a página', frente: claro('ef-on-surface'), fundo: claro('ef-surface') },
  { onde: 'corpo de texto sobre o cartão', frente: claro('ef-on-surface'), fundo: claro('ef-surface-lowest') },
  { onde: 'texto esmaecido sobre a página', frente: claro('ef-on-surface-variant'), fundo: claro('ef-surface') },
  { onde: 'texto esmaecido sobre o cartão', frente: claro('ef-on-surface-variant'), fundo: claro('ef-surface-lowest') },
  { onde: 'texto esmaecido sobre agrupamento', frente: claro('ef-on-surface-variant'), fundo: claro('ef-surface-low') },
  { onde: 'texto esmaecido sobre o realce (hover)', frente: claro('ef-on-surface-variant'), fundo: claro('ef-surface-high') },
  { onde: 'texto esmaecido sobre o separador forte', frente: claro('ef-on-surface-variant'), fundo: claro('ef-surface-highest') },
  { onde: 'link e item ativo de navegação', frente: claro('ef-primary'), fundo: claro('ef-surface') },
  { onde: 'link sobre o cartão', frente: claro('ef-primary'), fundo: claro('ef-surface-lowest') },
  { onde: 'rótulo do botão de ação', frente: claro('ef-on-primary'), fundo: claro('ef-primary-container') },
  { onde: 'rótulo do botão de ação no hover', frente: claro('ef-on-primary'), fundo: claro('ef-primary-hover') },
  { onde: 'rótulo sobre preenchimento suave de marca', frente: claro('ef-on-primary-fixed'), fundo: claro('ef-primary-fixed') },
  { onde: 'telemetria e sessão ao vivo', frente: claro('ef-secondary'), fundo: claro('ef-surface') },
  { onde: 'telemetria sobre o cartão', frente: claro('ef-secondary'), fundo: claro('ef-surface-lowest') },
  { onde: 'confirmação institucional', frente: claro('ef-tertiary'), fundo: claro('ef-surface') },
  { onde: 'confirmação sobre o cartão', frente: claro('ef-tertiary'), fundo: claro('ef-surface-lowest') },
  { onde: 'aviso sobre a página', frente: claro('ef-warning-strong'), fundo: claro('ef-surface') },
  { onde: 'aviso sobre o cartão', frente: claro('ef-warning-strong'), fundo: claro('ef-surface-lowest') },
  { onde: 'aviso sobre o alerta de atenção', frente: claro('ef-warning-strong'), fundo: AVISO_SUAVE_CLARO },
  { onde: 'perigo sobre a página', frente: claro('ef-danger-strong'), fundo: claro('ef-surface') },
  { onde: 'perigo sobre o cartão', frente: claro('ef-danger-strong'), fundo: claro('ef-surface-lowest') },
  { onde: 'sucesso sobre a página', frente: claro('ef-success-strong'), fundo: claro('ef-surface') },
  { onde: 'sucesso sobre o cartão', frente: claro('ef-success-strong'), fundo: claro('ef-surface-lowest') },
  { onde: 'sucesso sobre o alerta de sucesso', frente: claro('ef-success-strong'), fundo: SUCESSO_SUAVE_CLARO },
  { onde: 'perigo sobre o alerta de perigo', frente: claro('ef-danger-strong'), fundo: PERIGO_SUAVE_CLARO },
  { onde: 'texto do container de erro', frente: claro('ef-on-error-container'), fundo: claro('ef-error-container') },
  { onde: 'aviso do TELÃO sobre o telão', frente: claro('ef-warning-strong-on-dark'), fundo: claro('ef-inverse-surface') },
  { onde: 'texto do TELÃO sobre o telão', frente: claro('ef-inverse-on-surface'), fundo: claro('ef-inverse-surface') },
  { onde: 'borda de campo e cartão', frente: claro('ef-outline-variant'), fundo: claro('ef-surface'), minimo: MINIMO_INTERFACE },
  { onde: 'borda sobre o cartão', frente: claro('ef-outline-variant'), fundo: claro('ef-surface-lowest'), minimo: MINIMO_INTERFACE },
  { onde: 'contorno de ênfase', frente: claro('ef-outline'), fundo: claro('ef-surface'), minimo: MINIMO_INTERFACE },
  { onde: 'contorno de ênfase sobre o cartão', frente: claro('ef-outline'), fundo: claro('ef-surface-lowest'), minimo: MINIMO_INTERFACE },
  { onde: 'anel de foco sobre a página', frente: claro('ef-primary-container'), fundo: claro('ef-surface'), minimo: MINIMO_INTERFACE },
  { onde: 'anel de foco sobre o cartão', frente: claro('ef-primary-container'), fundo: claro('ef-surface-lowest'), minimo: MINIMO_INTERFACE },
];

const MEDIDOS_NO_CLARO: Record<string, number> = {
  'corpo de texto sobre a página': 16.27,
  'corpo de texto sobre o cartão': 17.07,
  'texto esmaecido sobre a página': 8.93,
  'texto esmaecido sobre o cartão': 9.36,
  'texto esmaecido sobre agrupamento': 8.47,
  'texto esmaecido sobre o realce (hover)': 7.66,
  'texto esmaecido sobre o separador forte': 7.25,
  'link e item ativo de navegação': 8.71,
  'link sobre o cartão': 9.14,
  'rótulo do botão de ação': 6.29,
  'rótulo do botão de ação no hover': 7.9,
  'rótulo sobre preenchimento suave de marca': 13.26,
  'telemetria e sessão ao vivo': 6.13,
  'telemetria sobre o cartão': 6.43,
  'confirmação institucional': 8.73,
  'confirmação sobre o cartão': 9.15,
  'aviso sobre a página': 6.76,
  'aviso sobre o cartão': 7.09,
  'aviso sobre o alerta de atenção': 6.44,
  'perigo sobre a página': 6.17,
  'perigo sobre o cartão': 6.47,
  'texto do container de erro': 7.24,
  'aviso do TELÃO sobre o telão': 9.17,
  'texto do TELÃO sobre o telão': 11.65,
  'contorno de ênfase': 4.28,
  'contorno de ênfase sobre o cartão': 4.49,
  'anel de foco sobre a página': 5.99,
  'anel de foco sobre o cartão': 6.29,
  'borda de campo e cartão': 3.67,
  'borda sobre o cartão': 3.85,
  'sucesso sobre a página': 5.23,
  'sucesso sobre o cartão': 5.48,
  'sucesso sobre o alerta de sucesso': 5.09,
  'perigo sobre o alerta de perigo': 5.9,
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O EFEITO COLATERAL QUE ESTA CATRACA PEGOU — três valores de IDENTIDADE
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Medir o modo claro com a régua do modo escuro achou dívida ANTERIOR à fase, e
 *  ela foi corrigida junto (decisão do humano): o texto de SUCESSO (`#059669`)
 *  media 3,59:1 sobre a tela, 3,77:1 sobre o cartão e 3,49:1 sobre o próprio fundo
 *  lavado; o de PERIGO (`#dc2626`) media 4,41:1 sobre o fundo lavado; e a BORDA de
 *  campo (`#c7c4d8`) media 1,63:1 sobre a tela, quando o AA non-text pede 3:1.
 *  Nenhum deles tinha teste de contraste antes — o portão do axe via as telas, não
 *  os tokens.
 *
 *  Os três passaram a `#047857`, `#b91c1c` e `#83808f`, e a mudança é VISÍVEL no
 *  modo claro (verde e vermelho um tom mais escuros, hairline mais firme). Nenhum
 *  par do modo claro ou do escuro ficou de fora: não há mais lista de exceção
 *  neste arquivo — é isso que "a catraca só aperta" quer dizer.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

describe('FASE 61 · H3 — o contraste da escala escura', () => {
  it('o bloco da CLASSE e o da media query do sistema têm os MESMOS tons', () => {
    /**
     * Dois blocos escuros, um valor. Sem esta catraca, "escuro explícito" e
     * "escuro do sistema" divergem na primeira manutenção — e o defeito só
     * aparece na máquina de quem usa o sistema, não nas do time.
     */
    expect([...TONS_ESCUROS.keys()].sort()).toEqual([...TONS_DO_SISTEMA.keys()].sort());

    for (const [token, valor] of TONS_ESCUROS) {
      expect(TONS_DO_SISTEMA.get(token), `--${token} difere entre .dark e a media query`).toBe(valor);
    }
  });

  it('o modo escuro declara `color-scheme: dark` (e o claro, `light`)', () => {
    /**
     * Sem `color-scheme`, `select`, barra de rolagem, seletor de data e o fundo
     * do autofill continuam claros DENTRO da tela escura — o defeito clássico de
     * tema escuro meia-boca, e o campo de e-mail preenchido pelo navegador vira
     * um retângulo branco no meio da página.
     */
    expect(RAIZ, 'o modo claro precisa declarar color-scheme: light').toContain('color-scheme: light');
    expect(CLASSE_ESCURA, 'o modo escuro precisa declarar color-scheme: dark').toContain('color-scheme: dark');
    expect(MEDIA_ESCURA, 'a preferência do sistema precisa declarar color-scheme: dark').toContain('color-scheme: dark');
  });

  it('nenhum par do modo escuro fica abaixo do mínimo (4,5:1 texto · 3:1 interface)', () => {
    const reprovados: string[] = [];

    for (const par of PARES_ESCUROS) {
      const minimo = par.minimo ?? MINIMO_TEXTO;
      const razao = contraste(par.frente, par.fundo);

      if (razao < minimo) {
        reprovados.push(`${razao}:1 (mínimo ${minimo}:1) — ${par.onde} [${par.frente} / ${par.fundo}]`);
      }
    }

    expect(reprovados, `\n${reprovados.join('\n')}\n`).toEqual([]);
  });

  it('os números medidos no modo escuro são EXATAMENTE os presos (folga de 0,01)', () => {
    /**
     * A tolerância existe só para o arredondamento da fórmula; qualquer mudança
     * real de tom move a razão em décimos e reprova aqui, com o número na mão.
     */
    for (const par of PARES_ESCUROS) {
      const esperado = MEDIDOS_NO_ESCURO[par.onde];

      expect(esperado, `par sem número medido: ${par.onde}`).toBeDefined();
      expect(
        contraste(par.frente, par.fundo),
        `${par.onde} [${par.frente} / ${par.fundo}]`,
      ).toBeCloseTo(esperado!, 2);
    }
  });

  it('os mesmos pares, no modo CLARO, também passam', () => {
    const reprovados: string[] = [];

    for (const par of PARES_CLAROS) {
      const minimo = par.minimo ?? MINIMO_TEXTO;
      const razao = contraste(par.frente, par.fundo);

      if (razao < minimo) {
        reprovados.push(`${razao}:1 (mínimo ${minimo}:1) — ${par.onde} [${par.frente} / ${par.fundo}]`);
      }
    }

    expect(reprovados, `\n${reprovados.join('\n')}\n`).toEqual([]);
  });

  it('os números medidos no modo claro são EXATAMENTE os presos', () => {
    for (const par of PARES_CLAROS) {
      const esperado = MEDIDOS_NO_CLARO[par.onde];

      expect(esperado, `par sem número medido: ${par.onde}`).toBeDefined();
      expect(
        contraste(par.frente, par.fundo),
        `${par.onde} [${par.frente} / ${par.fundo}]`,
      ).toBeCloseTo(esperado!, 2);
    }
  });

  it('os três tokens de identidade corrigidos NÃO voltam ao valor antigo', () => {
    /**
     * A prova de que a dívida foi quitada, e não apenas escondida da lista: os
     * valores antigos são medidos aqui e REPROVAM. Se alguém "restaurar a marca"
     * (o `#059669` do sucesso, o `#dc2626` do perigo, o `#c7c4d8` do contorno), o
     * teste diz o número em vez de deixar passar.
     */
    expect(contraste('#059669', claro('ef-surface')), 'sucesso antigo sobre a tela').toBeLessThan(MINIMO_TEXTO);
    expect(contraste('#059669', SUCESSO_SUAVE_CLARO), 'sucesso antigo sobre o suave').toBeLessThan(MINIMO_TEXTO);
    expect(contraste('#dc2626', PERIGO_SUAVE_CLARO), 'perigo antigo sobre o suave').toBeLessThan(MINIMO_TEXTO);
    expect(
      contraste('#c7c4d8', claro('ef-surface')),
      'contorno antigo sobre a tela (o AA non-text pede 3:1)',
    ).toBeLessThan(MINIMO_INTERFACE);

    /** E os novos são exatamente os medidos. */
    expect(claro('ef-success-strong')).toBe('#047857');
    expect(claro('ef-danger-strong')).toBe('#b91c1c');
    expect(claro('ef-outline-variant')).toBe('#83808f');
  });

  it('a escolha explícita de CLARO vence a preferência escura do sistema', () => {
    /**
     * O DEFEITO QUE ISTO PRENDE (o inverso do da H3): sem guarda, o bloco da media
     * query tem a mesma especificidade do `:root` e vem depois — então, num
     * sistema operacional escuro, quem escolheu "Claro" continuaria vendo escuro, e
     * a escolha da pessoa perderia para a do sistema. A guarda lê o `data-tema` que
     * a fiação grava SEMPRE no `<html>` (`claro` | `escuro` | `sistema`), e o
     * `:not()` ainda sobe a especificidade de (0,1,0) para (0,2,0).
     */
    expect(
      MEDIA_ESCURA,
      'a media query do sistema precisa da guarda `:not([data-tema=\'claro\'])`',
    ).toContain(":root:not([data-tema='claro'])");

    /** E o valor da guarda é o mesmo que a fiação escreve — o contrato entre as duas metades da fase. */
    expect(MEDIA_ESCURA).toContain("[data-tema='claro']");

    /** A classe `.dark` continua sendo o caminho do escuro explícito. */
    expect(CLASSE_ESCURA).toContain('color-scheme: dark');
  });

  it('o par do TELÃO é o mesmo nos dois modos — a superfície não é invertida', () => {
    /**
     * O telão do sorteio é escuro por DESENHO (FASES 29/30) e a página pública do
     * evento mantém o tema do organizador. Se a escala escura invertesse
     * `inverse-surface`, a parede do palco viraria clara e a operação de palco
     * perderia o contraste medido na FASE 52.
     */
    expect(escuro('ef-inverse-surface')).toBe(claro('ef-inverse-surface'));
    expect(escuro('ef-inverse-on-surface')).toBe(claro('ef-inverse-on-surface'));
    expect(escuro('ef-warning-strong-on-dark')).toBe(claro('ef-warning-strong-on-dark'));
    expect(contraste(escuro('ef-warning-strong-on-dark'), escuro('ef-inverse-surface'))).toBe(9.17);
  });
});

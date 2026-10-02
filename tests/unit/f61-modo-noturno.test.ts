/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — TEMA DA INTERFACE (FASE 61 · dívida H3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra do cookie `ef_tema`, e só ela — a leitura acontece na requisição, mas a
 *  INTERPRETAÇÃO do valor é aritmética de três palavras, e é aqui que ela é provada
 *  sem Next, sem navegador e sem banco.
 *
 *    • `'claro'`, `'escuro'` e `'sistema'` são os três valores, e nada mais;
 *    • **ausente, vazio ou desconhecido cai em `sistema`** — o padrão é não impor
 *      preferência a quem nunca escolheu, e é o que impede um cookie apagado, um
 *      valor inventado à mão ou um formato futuro de prender a pessoa num tema;
 *    • a marcação que cada escolha produz: a classe `.dark` entra **só** no
 *      escuro explícito, `data-tema` entra **sempre**, e o `color-scheme`
 *      acompanha para a barra de rolagem e os controles nativos;
 *    • e as duas catracas de TEXTO que impedem a regra de mentir: o `.dark` que a
 *      marcação promete existe no `globals.css`, e o `<html>` da aplicação é
 *      renderizado num arquivo só (se uma segunda árvore passar a desenhá-lo, o
 *      tema voltaria a piscar em alguma tela, e este teste avisa antes).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE_SECONDS,
  THEME_DARK,
  THEME_LIGHT,
  THEME_MODES,
  THEME_MODE_DESCRIPTIONS,
  THEME_MODE_LABELS,
  THEME_SYSTEM,
  isThemeMode,
  themeMarkup,
  themeModeFromValue,
} from '../../src/lib/theme/theme-mode';

const ROOT = process.cwd();

describe('themeModeFromValue — o valor do cookie vira tema', () => {
  it('aceita os três valores canônicos', () => {
    expect(themeModeFromValue('claro')).toBe(THEME_LIGHT);
    expect(themeModeFromValue('escuro')).toBe(THEME_DARK);
    expect(themeModeFromValue('sistema')).toBe(THEME_SYSTEM);
  });

  it('trata ausência, vazio e valor desconhecido como sistema', () => {
    /**
     * `undefined` é o cookie que nunca foi gravado — e é o caso da esmagadora
     * maioria das requisições (toda primeira visita, toda aba anônima). Os outros
     * são o que um cliente hostil (ou uma versão futura do formato) pode mandar:
     * nenhum deles pode produzir um tema que ninguém pediu, e todos caem em
     * `sistema`, que é a decisão devolvida a quem de fato sabe — o sistema
     * operacional.
     */
    const desconhecidos: unknown[] = [
      undefined,
      null,
      '',
      ' ',
      'CLARO',
      'Claro',
      'dark',
      'light',
      'noturno',
      'outra coisa',
      0,
      1,
      true,
      false,
      {},
      { tema: 'escuro' },
      ['escuro'],
      new String('escuro'),
    ];

    for (const valor of desconhecidos) {
      expect(themeModeFromValue(valor), `valor: ${JSON.stringify(valor)}`).toBe(THEME_SYSTEM);
    }
  });

  it('não confunde o nome do cookie com o valor', () => {
    /** O nome do cookie (`ef_tema`) nunca é um tema válido — a distração é fácil. */
    expect(themeModeFromValue(THEME_COOKIE)).toBe(THEME_SYSTEM);
    expect(isThemeMode(THEME_COOKIE)).toBe(false);
  });

  it('aceita exatamente a lista declarada — nem mais, nem menos', () => {
    /**
     * A catraca da LISTA ÚNICA: `THEME_MODES` é o que o controle desenha e o que a
     * Server Action aceita. Um valor que não esteja nela não pode passar pela
     * leitura, senão a pessoa ficaria com um tema que a interface não sabe marcar.
     */
    for (const modo of THEME_MODES) {
      expect(themeModeFromValue(modo)).toBe(modo);
      expect(isThemeMode(modo)).toBe(true);
    }

    expect(themeModeFromValue('quarto-modo')).toBe(THEME_SYSTEM);
  });
});

describe('themeMarkup — o que cada escolha escreve no <html>', () => {
  it('escuro explícito escreve a classe `.dark`', () => {
    expect(themeMarkup(THEME_DARK)).toEqual({
      dark: true,
      dataTema: 'escuro',
      colorScheme: 'dark',
    });
  });

  it('claro explícito NÃO escreve a classe e vence o sistema operacional', () => {
    /**
     * `color-scheme: light` é o que faz o claro EXPLÍCITO vencer: sem ele, quem
     * escolheu claro num computador configurado no escuro ficaria com a barra de
     * rolagem escura dentro de uma página clara.
     */
    expect(themeMarkup(THEME_LIGHT)).toEqual({
      dark: false,
      dataTema: 'claro',
      colorScheme: 'light',
    });
  });

  it('sistema NÃO escreve a classe `.dark` — quem responde é a media query', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ASSERÇÃO QUE DEFINE A FASE
     * ─────────────────────────────────────────────────────────────────────────────
     *  Escrever `.dark` em `sistema` resolveria a pergunta com a resposta errada: a
     *  página ficaria presa no escuro mesmo num sistema operacional claro, e a
     *  `@media (prefers-color-scheme: dark)` — que é quem sabe — nunca mais teria
     *  voz. `data-tema` continua sendo escrito, para o CSS distinguir "escolheu
     *  claro" de "não escolheu nada".
     */
    expect(themeMarkup(THEME_SYSTEM)).toEqual({
      dark: false,
      dataTema: 'sistema',
      colorScheme: 'light dark',
    });
  });

  it('`data-tema` é escrito SEMPRE e sempre diz a verdade sobre a escolha', () => {
    /**
     * Um atributo que só existisse em dois dos três casos tornaria impossível
     * separar "escolheu claro" de "não escolheu nada" — e é justamente essa
     * separação que o E2E usa para provar que a escolha foi gravada.
     */
    for (const modo of THEME_MODES) {
      expect(themeMarkup(modo).dataTema).toBe(modo);
    }
  });

  it('o padrão (cookie ausente) não escurece a página por conta própria', () => {
    const marcacao = themeMarkup(themeModeFromValue(undefined));

    expect(marcacao.dataTema).toBe(THEME_SYSTEM);
    expect(marcacao.dark).toBe(false);
  });

  it('só o escuro explícito produz a classe', () => {
    const comClasse = THEME_MODES.filter((modo) => themeMarkup(modo).dark);

    expect(comClasse).toEqual([THEME_DARK]);
  });
});

describe('o contrato da escolha — cookie e textos', () => {
  it('o cookie é `ef_tema`, na família de `ef_nav` e `ef_tenant`', () => {
    expect(THEME_COOKIE).toBe('ef_tema');
  });

  it('a validade é longa', () => {
    /**
     * Preferência de tema é das mais estáveis que existem: um prazo curto obrigaria
     * quem trabalha no escuro a reescolher sem que nada tivesse mudado.
     */
    expect(THEME_COOKIE_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(180 * 24 * 60 * 60);
  });

  it('as três opções são apresentadas na ordem claro · escuro · sistema', () => {
    expect(THEME_MODES).toEqual([THEME_LIGHT, THEME_DARK, THEME_SYSTEM]);
  });

  it('toda opção tem rótulo E a frase que diz o que ela faz', () => {
    for (const modo of THEME_MODES) {
      expect(THEME_MODE_LABELS[modo]?.length ?? 0).toBeGreaterThan(0);
      expect(THEME_MODE_DESCRIPTIONS[modo]?.length ?? 0).toBeGreaterThan(0);
    }

    /** Rótulos distintos: duas opções com o mesmo nome seriam indistinguíveis. */
    expect(new Set(Object.values(THEME_MODE_LABELS)).size).toBe(THEME_MODES.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Catracas de TEXTO — a regra promete marcação que mora em outros arquivos
// ───────────────────────────────────────────────────────────────────────────────
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function listarArquivos(dir: string, encontrados: string[] = []): string[] {
  for (const entrada of readdirSync(join(ROOT, dir))) {
    const absoluto = join(ROOT, dir, entrada);

    if (statSync(absoluto).isDirectory()) {
      listarArquivos(join(dir, entrada), encontrados);
      continue;
    }

    if (/\.tsx$/.test(entrada)) {
      encontrados.push(dir.split(sep).join('/') + '/' + entrada);
    }
  }

  return encontrados;
}

describe('catracas do sistema', () => {
  it('a classe `.dark` que a marcação promete existe no globals.css', () => {
    /**
     * A regra pura não conhece cor — ela só diz "escreva a classe `.dark`". Se o
     * seletor do escuro explícito mudasse de nome no CSS, o tema escuro pararia de
     * funcionar EM SILÊNCIO: o atributo continuaria lá, a cor, não.
     */
    const css = semComentarios(readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8'));

    expect(css).toMatch(/\.dark\s*\{/);
  });

  it('o `<html>` da aplicação é renderizado num arquivo só', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTA CATRACA EXISTE
     * ─────────────────────────────────────────────────────────────────────────────
     *  O tema só não pisca porque a classe sai na PRIMEIRA resposta. Duas árvores
     *  desenhando `<html>` significariam duas leituras do cookie — e a que
     *  esquecesse a leitura entregaria a página clara para depois escurecer.
     *
     *  `global-error.tsx` é a exceção declarada: ele substitui o layout raiz quando
     *  um erro escapa de tudo, desenha com estilo INLINE (o CSS pode não ter
     *  carregado) e é um componente de cliente — não tem acesso a cookie, e fingir
     *  que tem seria pior do que a ausência.
     */
    const comHtml = [...listarArquivos('src/app'), ...listarArquivos('src/components')].filter(
      (arquivo) => /<html[\s>]/.test(semComentarios(readFileSync(join(ROOT, arquivo), 'utf8'))),
    );

    expect(comHtml.sort()).toEqual(['src/app/global-error.tsx', 'src/app/layout.tsx']);
  });

  it('o layout raiz publica `data-tema` e lê a escolha pelo módulo do servidor', () => {
    /**
     * A leitura tem de ser a do SERVIDOR (`readThemeMode`), e não um `useState` ou
     * um script no cliente: o HTML precisa nascer com o tema certo.
     */
    const layout = semComentarios(readFileSync(join(ROOT, 'src/app/layout.tsx'), 'utf8'));

    expect(layout).toContain('readThemeMode');
    expect(layout).toContain('data-tema');
  });
});

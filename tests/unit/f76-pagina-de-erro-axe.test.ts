/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PÁGINA DE ERRO — RENDER ESTÁTICO + AXE (FASE 76 · fatia 3)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A F75 media a página de erro (`area-error-app`) por uma rota que ESTOURAVA de
 *  verdade: um id que não é uuid descia ao Prisma e virava 500 (armadilha 25). A
 *  fatia 1 fechou esse caminho — agora o malformado é 404 —, e o caso do E2E
 *  perdia a página de erro. A cobertura não pode cair em silêncio: o componente
 *  que desenha a tela continua precisando de prova de acessibilidade.
 *
 *  Não existe rota feita para falhar, e inventar uma seria medir o teste. O
 *  caminho honesto é renderizar o COMPONENTE com `renderToStaticMarkup` e rodar o
 *  `axe` sobre o HTML que ele produz. É o mesmo componente que os três
 *  `error.tsx` usam; o que muda por área é só a frase e o caminho de volta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE jsdom, E O QUE ELE NÃO MEDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `axe` roda sobre HTML estático, sim — estrutura, rótulos, landmarks, ordem de
 *  títulos, nomes acessíveis. O que ele NÃO consegue medir em jsdom é
 *  `color-contrast`: a regra lê cor computada e geometria, e o jsdom não faz
 *  layout. Aqui ela é desligada DE PROPÓSITO, e a cobertura de contraste não fica
 *  órfã: `tests/e2e/accessibility.spec.ts` mede o MESMO HTML estático (o fixture
 *  abaixo, preso por igualdade exata) num Chromium de verdade, com o CSS da casa.
 *  Quem quiser o caminho completo lê os dois arquivos juntos.
 *
 *  O `tests/e2e/accessibility.spec.ts` não consegue renderizar o `.tsx` no próprio
 *  processo: o transform do Playwright usa o runtime de JSX dele, e o resultado
 *  não é um elemento do React (medido: `{__pw_type, type, props, key}`). Daí o
 *  fixture: o E2E mede o HTML, este teste prova que o HTML é o do componente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { AreaError } from '../../src/components/shell/area-error';
import { ERROR_AREAS, type ErrorArea } from '../../src/domain/platform/error-pages';

const RAIZ = process.cwd();

/** O MESMO HTML que o E2E mede no Chromium. Preso por igualdade exata abaixo. */
const FIXTURE = 'tests/e2e/fixtures/f76-area-error-app.html';

/** Só o que IMPEDE o uso da tela reprova — a mesma régua do portão E2E. */
const IMPACTOS_REPROVADOS = ['critical', 'serious'] as const;

const TAGS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function renderizar(area: ErrorArea, tenantSlug = 'ufba-demo'): string {
  return renderToStaticMarkup(
    createElement(AreaError, {
      area,
      tenantSlug,
      error: new Error('falha de teste'),
      reset: () => undefined,
    }),
  );
}

async function violacoesReprovadas(html: string): Promise<string[]> {
  document.body.innerHTML = html;

  const resultado = await axe.run(document.body, {
    runOnly: { type: 'tag', values: TAGS_WCAG },
    rules: {
      /**
       * Declarado no cabeçalho: jsdom não faz layout. O contraste é medido no
       * E2E, no navegador, sobre o fixture abaixo.
       */
      'color-contrast': { enabled: false },
    },
  });

  return resultado.violations
    .filter((violacao) =>
      (IMPACTOS_REPROVADOS as readonly string[]).includes(violacao.impact ?? ''),
    )
    .map((violacao) => `${violacao.id} (${violacao.impact}): ${violacao.help}`);
}

describe('FASE 76 · a página de erro não perdeu a cobertura de acessibilidade', () => {
  it('o fixture do E2E é EXATAMENTE o que o componente renderiza hoje', () => {
    /**
     * ─── A CATRACA DO FIXTURE ───────────────────────────────────────────────────
     *  O E2E mede o arquivo; este teste prova que o arquivo é o componente. Se o
     *  componente mudar (uma classe, uma frase, um link) e o fixture não, a
     *  igualdade reprova aqui — e o E2E não mede um retrato velho sem ninguém
     *  saber. Regenerar é intencional, como atualizar uma tabela de catálogo.
     */
    const esperado = readFileSync(join(RAIZ, FIXTURE), 'utf8');

    expect(`${renderizar('app')}\n`).toBe(esperado);
  });

  it.each(ERROR_AREAS)('a área %s não tem violação crítica nem séria', async (area) => {
    const html = renderizar(area);
    const reprovadas = await violacoesReprovadas(html);

    expect(reprovadas, `violações em area-error-${area}`).toEqual([]);
  });

  it('o `<main>` é o landmark da tela, e é UM só', () => {
    /**
     * A F52 fixou um `<main>` por tela, e a página de erro é uma das que mais
     * facilmente ganharia um segundo (dentro da casca). O componente é o dono do
     * landmark; este caso prende a contagem no HTML renderizado.
     */
    const html = renderizar('app');

    expect((html.match(/<main/g) ?? []).length).toBe(1);
    expect(html).toContain('data-testid="area-error-app"');
  });

  it('a tela não vaza detalhe técnico nem culpa a pessoa', () => {
    const html = renderizar('app');

    for (const vazamento of ['invalid input syntax', 'Prisma', 'TypeError', 'digest', 'stack']) {
      expect(html, `a tela do erro vazou "${vazamento}"`).not.toContain(vazamento);
    }

    expect(html).toContain('A falha foi do nosso lado');
  });
});

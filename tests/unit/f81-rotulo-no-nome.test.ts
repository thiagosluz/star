import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 81 · O NOME ACESSÍVEL COMEÇA PELO TEXTO VISÍVEL (WCAG 2.5.3)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXISTE (e por que ele lê o FONTE)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `axe-core` 4.14 tirou a regra `label-content-name-mismatch` da tag
 *  `experimental`, e o portão de acessibilidade passou a reprovar três links de
 *  exportação: o texto visível (`Baixar .ics`) não era prefixo do nome acessível
 *  (`Baixar o arquivo .ics desta atividade: …`). O defeito é real — quem usa
 *  comando de voz fala o que está na tela.
 *
 *  O portão do navegador é a prova final, mas ele custa minutos e exige o
 *  container. Este teste é o feedback BARATO: lê o componente e reprova no
 *  `npm test` quando um dos nomes deixa de começar pelo texto visível. É uma
 *  catraca de FONTE, o mesmo padrão de `f63`/`f66`/`f72`: se a marcação do link
 *  sair do arquivo, o teste reprova em vez de passar vazio.
 *
 *  A régua é `startsWith`, não `contains`: a regra do `axe` exige que o texto
 *  visível seja uma subsequência CONTÍGUA do início do nome acessível. "contém"
 *  deixaria passar justamente o defeito que a fase corrigiu.
 */

const RAIZ = process.cwd();
const COMPONENTE = join(RAIZ, 'src/components/events/activity-export-links.tsx');
const FONTE = readFileSync(COMPONENTE, 'utf8');

interface LinkAcessivel {
  /** O `data-testid` que prende o link à tela. */
  testid: string;
  /** O texto que a pessoa LÊ no link (copiado do JSX, não inventado). */
  visivel: string;
  /** O nome acessível declarado no `aria-label`. */
  nome: string;
}

/**
 * Recorta UM `<a>` pelo `data-testid` e devolve o texto visível e o `aria-label`.
 *
 * Não é um parser de JSX: é a leitura da marcação que este componente usa (um
 * `<a>` com `aria-label` de template literal, um ícone `aria-hidden` e o texto
 * como último nó). Se a forma mudar, o teste falha alto — e é isso que se quer de
 * uma catraca.
 */
function recortarLink(testid: string): LinkAcessivel {
  const ancora = FONTE.indexOf(`data-testid="${testid}"`);

  expect(ancora, `o link "${testid}" sumiu de ${COMPONENTE}`).toBeGreaterThan(-1);

  const inicio = FONTE.lastIndexOf('<a', ancora);
  const fim = FONTE.indexOf('</a>', ancora);

  expect(inicio, `não achei a abertura do <a> de "${testid}"`).toBeGreaterThan(-1);
  expect(fim, `não achei o fechamento do <a> de "${testid}"`).toBeGreaterThan(inicio);

  const bloco = FONTE.slice(inicio, fim + '</a>'.length);
  const nome = /aria-label=\{`([^`]*)`\}/.exec(bloco)?.[1];
  const visivel = /aria-hidden \/>\s*([^<]+?)\s*<\/a>/.exec(bloco)?.[1]?.trim();

  expect(nome, `o link "${testid}" não declara aria-label de template literal`).toBeTruthy();
  expect(visivel, `o link "${testid}" não tem texto visível depois do ícone`).toBeTruthy();

  return { testid, visivel: visivel!, nome: nome! };
}

/** Os quatro links de exportação — os três do defeito e o do Google da atividade. */
const LINKS = [
  'exportar-google',
  'exportar-ics-atividade',
  'exportar-google-grade',
  'exportar-ics-grade',
] as const;

describe('f81 · o nome acessível dos links de exportação', () => {
  it('prende os quatro links no componente (a catraca não passa vazia)', () => {
    for (const testid of LINKS) {
      const link = recortarLink(testid);

      expect(link.visivel.length).toBeGreaterThan(0);
      expect(link.nome.length).toBeGreaterThan(link.visivel.length);
    }
  });

  it.each(LINKS)('o nome de "%s" começa pelo texto visível', (testid) => {
    const { visivel, nome } = recortarLink(testid);

    expect(
      nome.startsWith(visivel),
      `o nome acessível "${nome}" não começa pelo texto visível "${visivel}"`,
    ).toBe(true);
  });

  it('mantém o complemento que diz QUAL atividade/agenda é o alvo', () => {
    /**
     * O prefixo resolve a WCAG 2.5.3; o complemento é o que faz o link ser útil
     * numa lista de vinte atividades. Encurtar o nome até caber no texto visível
     * "consertaria" a regra e perderia o alvo — por isso o teste cobra os dois.
     */
    expect(recortarLink('exportar-google').nome).toContain('${title}');
    expect(recortarLink('exportar-ics-atividade').nome).toContain('${title}');
    expect(recortarLink('exportar-google-grade').nome).toContain('${nextTitle}');
    expect(recortarLink('exportar-ics-grade').nome).toContain('${eventTitle}');
  });
});

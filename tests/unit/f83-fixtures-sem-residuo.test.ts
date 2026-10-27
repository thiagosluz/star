/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CATRACA — fixture de integração que cria instituição tem de apagá-la (FASE 83)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ELA PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `tests/integration/member-lifecycle.test.ts` criava `f21-apertada-${RUN}` e o
 *  `afterAll` só chamava `$disconnect()`. A instituição ficava no banco de
 *  desenvolvimento e, quando a inscrição pública de outro teste caía nela, virava
 *  um segundo vínculo `ACTIVE` do `participante@eventflow.test` — o resíduo que a
 *  FASE 83 mediu. O mesmo padrão existia em `communication.test.ts` (duas
 *  instituições) e no caso de "outra instituição" de `stage-operation.test.ts`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CATRACA PROVA — E O QUE ELA NÃO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela lê o FONTE e reprova:
 *
 *    • criação FORA de um `it` (o normal é `beforeAll`) sem `afterAll` que apague
 *      ao menos uma instituição (`tenant.delete` / `tenant.deleteMany`);
 *    • criação DENTRO de um `it` que não apaga naquele mesmo corpo (o `finally` do
 *      caso vale: a limpeza não pode depender de o teste passar).
 *
 *  LIMITE HONESTO: isto prova a FORMA, não o EFEITO. Um `afterAll` que apague só
 *  UMA das duas instituições passa (o parser não casa cada `create` com cada
 *  `id`), e uma limpeza que falhe em runtime não é vista aqui. O efeito é medido
 *  de outro jeito: rodando o arquivo e conferindo o banco (foi assim que as
 *  famílias `f21-*`, `f15-*` e `f22-outra-*` apareceram). A catraca existe para
 *  impedir que a FORMA volte a faltar — que é o que aconteceu três vezes.
 *
 *  Não há allowlist: `partition-service.test.ts` cria e apaga a instituição no
 *  MESMO caso, dentro de `try/finally`, e por isso passa pela regra do `it` sem
 *  exceção.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();
const PASTA = join(RAIZ, 'tests', 'integration');

/** O que a limpeza precisa conter para valer — `delete` ou `deleteMany` do tenant. */
const LIMPA_TENANT = /\.tenant\.delete(?:Many)?\s*\(/;

/** A criação que interessa: `tenant.create`, `tenant.createMany` ou `tenant.upsert`. */
function ehCriacaoDeTenant(texto: string): boolean {
  return /(?:^|\.)tenant\.(?:create|createMany|upsert)$/.test(texto);
}

/** Todos os `.ts` de `tests/integration`, com caminho relativo e barras normais. */
function arquivosDeIntegracao(): string[] {
  const encontrados: string[] = [];

  const visitar = (pasta: string): void => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name);

      if (entrada.isDirectory()) {
        visitar(caminho);
        continue;
      }

      if (entrada.name.endsWith('.ts')) {
        encontrados.push(relative(RAIZ, caminho).split(sep).join('/'));
      }
    }
  };

  visitar(PASTA);

  return encontrados;
}

/** Chamadas cujo ALVO (o texto antes dos parênteses) satisfaz o predicado. */
function chamadas(
  arquivo: ts.SourceFile,
  alvo: (texto: string) => boolean,
): ts.CallExpression[] {
  const resultado: ts.CallExpression[] = [];

  const visitar = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && alvo(node.expression.getText(arquivo))) {
      resultado.push(node);
    }

    ts.forEachChild(node, visitar);
  };

  visitar(arquivo);

  return resultado;
}

/** O texto do ÚLTIMO argumento — o corpo, tanto em `afterAll(fn)` quanto em `it(nome, fn)`. */
function corpoDaChamada(chamada: ts.CallExpression): string {
  const ultimo = chamada.arguments[chamada.arguments.length - 1];

  return ultimo ? ultimo.getText() : '';
}

/** O intervalo do corpo, para saber se uma criação está DENTRO de um caso. */
function intervaloDoCorpo(chamada: ts.CallExpression): { inicio: number; fim: number } | null {
  const ultimo = chamada.arguments[chamada.arguments.length - 1];

  return ultimo ? { inicio: ultimo.getStart(), fim: ultimo.getEnd() } : null;
}

export interface ProblemaDeResiduo {
  arquivo: string;
  motivo: string;
}

/**
 * Analisa UMA fonte e devolve os problemas encontrados.
 *
 * Exportada para os casos sintéticos abaixo provarem que a catraca MORDE — um
 * teste que só varre a árvore atual passaria verde para sempre se o detector
 * estivesse quebrado.
 */
export function problemasDeResiduo(arquivo: string, fonte: string): ProblemaDeResiduo[] {
  const sourceFile = ts.createSourceFile(
    arquivo,
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const criacoes = chamadas(sourceFile, ehCriacaoDeTenant);
  if (criacoes.length === 0) return [];

  const casos = chamadas(sourceFile, (texto) => texto === 'it');
  const limpezas = chamadas(sourceFile, (texto) => texto === 'afterAll');
  const afterAllLimpa = limpezas.some((chamada) => LIMPA_TENANT.test(corpoDaChamada(chamada)));

  const problemas: ProblemaDeResiduo[] = [];

  for (const criacao of criacoes) {
    const posicao = criacao.getStart(sourceFile);

    const caso = casos.find((chamada) => {
      const intervalo = intervaloDoCorpo(chamada);

      return intervalo !== null && intervalo.inicio <= posicao && posicao < intervalo.fim;
    });

    if (caso) {
      /**
       * Criação dentro de um caso: a limpeza é daquele corpo. Não basta o
       * `afterAll` da fixture apagar OUTRA instituição — foi exatamente assim
       * que `f22-outra-…` sobreviveu em `stage-operation.test.ts`.
       */
      if (!LIMPA_TENANT.test(corpoDaChamada(caso))) {
        problemas.push({
          arquivo,
          motivo: 'o caso cria uma instituição e não a apaga no próprio corpo (`finally`)',
        });
      }

      continue;
    }

    if (!afterAllLimpa) {
      problemas.push({
        arquivo,
        motivo: 'a fixture cria instituição fora de um caso, mas o `afterAll` não apaga nenhuma',
      });
    }
  }

  return problemas;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('a catraca morde — casos sintéticos', () => {
  const CRIA = `await adminPrisma.tenant.create({ data: { slug: 'x' } });`;

  it('reprova `beforeAll` que cria e `afterAll` que só desconecta', () => {
    const fonte = `
      beforeAll(async () => { ${CRIA} });
      afterAll(async () => { await adminPrisma.$disconnect(); });
    `;

    const problemas = problemasDeResiduo('fixture.test.ts', fonte);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/afterAll/);
  });

  it('reprova caso que cria instituição e não apaga no próprio corpo', () => {
    const fonte = `
      it('alcança outra instituição', async () => {
        ${CRIA}
        expect(await ler('x')).toBeNull();
      });
    `;

    const problemas = problemasDeResiduo('fixture.test.ts', fonte);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/caso cria/);
  });

  it('reprova `beforeAll` que cria sem `afterAll` nenhum', () => {
    const fonte = `beforeAll(async () => { ${CRIA} });`;

    expect(problemasDeResiduo('fixture.test.ts', fonte)[0]?.motivo).toMatch(/afterAll/);
  });

  it('aceita `beforeAll` que cria com `afterAll` que apaga', () => {
    const fonte = `
      beforeAll(async () => { ${CRIA} });
      afterAll(async () => {
        await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
      });
    `;

    expect(problemasDeResiduo('fixture.test.ts', fonte)).toEqual([]);
  });

  it('aceita caso que cria e apaga no `finally` — a limpeza não depende de passar', () => {
    const fonte = `
      it('alcança outra instituição', async () => {
        ${CRIA}
        try {
          expect(await ler('x')).toBeNull();
        } finally {
          await adminPrisma.tenant.deleteMany({ where: { id: outra } });
        }
      });
    `;

    expect(problemasDeResiduo('fixture.test.ts', fonte)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a árvore de testes de integração', () => {
  it('não cria instituição sem a limpeza correspondente', () => {
    const arquivos = arquivosDeIntegracao();

    /**
     * A varredura vazia passaria para sempre: prender um arquivo conhecido e um
     * piso de quantidade é o que distingue "nada a reprovar" de "não li nada".
     */
    expect(arquivos.length).toBeGreaterThan(80);
    expect(arquivos).toContain('tests/integration/member-lifecycle.test.ts');

    const problemas = arquivos.flatMap((arquivo) =>
      problemasDeResiduo(arquivo, readFileSync(join(RAIZ, arquivo), 'utf8')),
    );

    expect(problemas).toEqual([]);
  });
});

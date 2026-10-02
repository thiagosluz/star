/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CATRACA DO LANDMARK ÚNICO (FASE 60 · dívida I2)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA, ESCRITA UMA VEZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  **Exatamente UM `<main>` por tela.** A decisão é da FASE 52 e tem duas
 *  metades, e as duas cabem nesta catraca:
 *
 *      1. a CASCA não é o landmark (o `AppShell` e nenhum `layout.tsx` pode
 *         declarar `<main>` — foi o achado H5, "dois landmarks na mesma página");
 *      2. toda tela DESENHA o seu, ou HERDA o de um componente que desenha
 *         (a página pública do evento herda o da `EventLanding`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É TEXTO LIDO, E NÃO UMA ASSERÇÃO MAIS FORTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A prova de verdade é o navegador (`tests/e2e/f60-landmark.spec.ts`, que percorre
 *  as telas e conta as regiões principais na árvore de acessibilidade). O que esta
 *  catraca acrescenta é a ANTECIPAÇÃO: a tela NOVA que nasce sem `<main>` reprova em
 *  `npm test`, antes de alguém lembrar de acrescentá-la à tabela do E2E.
 *
 *  Ela lê o fonte com três perguntas objetivas — e cada uma é respondida por
 *  EVIDÊNCIA, não por uma lista de exceções:
 *
 *      • a página desenha `<main>`? (o próprio arquivo, sem comentários);
 *      • a página RENDERIZA um componente importado de `@/components/**` que
 *        desenha `<main>`? (o componente é lido; se perder o landmark, a página
 *        volta a reprovar sozinha);
 *      • a página não desenha NADA? (um `redirect(...)` puro — `/superadmin` e
 *        `/t/<slug>` são redirecionamentos, e redirecionamento não tem conteúdo).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CATRACA NÃO VÊ (o limite, dito em voz alta)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela não segue a árvore de módulos: uma página que devolvesse o JSX por uma
 *  variável (`const tela = <EventLanding .../>; return tela;`) cairia no caminho do
 *  `redirect` e passaria. É falso NEGATIVO, e é por isso que a prova continua sendo
 *  o E2E — a catraca é a rede, não o chão. Falso POSITIVO não existe: as duas
 *  situações legítimas acima são reconhecidas por evidência.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/**
 * As árvores da dívida I2 — o painel de plataforma e a superfície pública.
 *
 * O painel autenticado da instituição (`(app)`) fica de fora de propósito: ele tem
 * cobertura própria desde a F52 e está em obra enquanto esta fase roda.
 */
const ARVORES = [
  'src/app/superadmin',
  'src/app/t/[tenantSlug]/(public)',
  'src/app/(public)',
  'src/app/validar',
];

/**
 * Os arquivos que NÃO podem ser landmark, porque envolvem todas as telas.
 *
 * Um `<main>` aqui dá DOIS landmarks em cada tela que já tem o seu — foi exatamente
 * o achado H5 da F52, e a casca só deixou de ser landmark naquela fase.
 */
const CASCAS = [
  'src/app/layout.tsx',
  'src/app/superadmin/layout.tsx',
  'src/app/t/[tenantSlug]/(app)/layout.tsx',
  'src/app/t/[tenantSlug]/(public)/layout.tsx',
  'src/components/shell/app-shell.tsx',
];

/** `<main>` de verdade — o que o app-shell citava era `` `<main>` `` em comentário. */
const LANDMARK = /<main[\s>]/;

/**
 * Comentário que CITA o landmark não é landmark.
 *
 * É a mesma precaução da trava do sistema de design: sem ela, o comentário que
 * explica a decisão da F52 (`Aqui havia um <main>…`) reprovaria a própria casca.
 */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function ler(caminho: string): string {
  return semComentarios(readFileSync(join(ROOT, caminho), 'utf8'));
}

/** Todas as `page.tsx` de uma árvore, em caminho relativo com barras normais. */
function paginasDe(dir: string, encontradas: string[] = []): string[] {
  for (const entrada of readdirSync(join(ROOT, dir))) {
    const absoluto = join(ROOT, dir, entrada);

    if (statSync(absoluto).isDirectory()) {
      paginasDe(dir + '/' + entrada, encontradas);
      continue;
    }

    if (entrada === 'page.tsx') {
      encontradas.push(dir.split(sep).join('/') + '/' + entrada);
    }
  }

  return encontradas;
}

/** Resolve `@/components/events/event-landing` para o arquivo que existe. */
function arquivoDoImporte(importe: string): string | null {
  const relativo = importe.replace(/^@\//, '');

  for (const candidato of [`src/${relativo}.tsx`, `src/${relativo}/index.tsx`]) {
    if (existsSync(join(ROOT, candidato))) return candidato;
  }

  return null;
}

interface ComponenteImportado {
  nome: string;
  arquivo: string;
}

/** Nomes importados de `@/components/**`, com o arquivo de cada um. */
function componentesImportados(conteudo: string): ComponenteImportado[] {
  const encontrados: ComponenteImportado[] = [];

  const nomeados = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](@\/components\/[^'"]+)['"]/g;
  const padrao = /import\s+(?:type\s+)?([A-Z][A-Za-z0-9]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"](@\/components\/[^'"]+)['"]/g;

  for (const casamento of conteudo.matchAll(nomeados)) {
    const nomes = casamento[1];
    const importe = casamento[2];
    if (!nomes || !importe) continue;

    const arquivo = arquivoDoImporte(importe);
    if (!arquivo) continue;

    for (const bruto of nomes.split(',')) {
      const nome = bruto.replace(/\btype\b/, '').split(/\s+as\s+/)[0]?.trim() ?? '';
      if (nome) encontrados.push({ nome, arquivo });
    }
  }

  for (const casamento of conteudo.matchAll(padrao)) {
    const nome = casamento[1];
    const importe = casamento[2];
    if (!nome || !importe) continue;

    const arquivo = arquivoDoImporte(importe);
    if (arquivo) encontrados.push({ nome, arquivo });
  }

  return encontrados;
}

/** A página RENDERIZA um componente que desenha `<main>`? */
function landmarkHerdado(conteudo: string): string | null {
  for (const { nome, arquivo } of componentesImportados(conteudo)) {
    const desenhado = new RegExp(`<${nome}[\\s/>]`).test(conteudo);
    if (desenhado && LANDMARK.test(ler(arquivo))) return `${nome} (${arquivo})`;
  }

  return null;
}

/** A página devolve JSX? (`return (` ou `return <`) */
const DESENHA_JSX = /return\s*\(?\s*</;

const PAGINAS = ARVORES.flatMap((arvore) => paginasDe(arvore)).sort();

describe('landmark único por tela (FASE 60 · dívida I2)', () => {
  it('encontra as telas das duas árvores — a catraca não pode passar vazia', () => {
    /**
     * Um `readdir` que devolve nada deixaria a catraca verde sem medir coisa
     * alguma. O número é o piso do que existe hoje (8 do painel + 14 públicas).
     */
    expect(PAGINAS.length).toBeGreaterThanOrEqual(20);
    expect(PAGINAS).toContain('src/app/superadmin/metricas/page.tsx');
    expect(PAGINAS).toContain(
      'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/inscricao/page.tsx',
    );
  });

  it('nenhuma CASCA é landmark', () => {
    const infratores = CASCAS.filter((caminho) => LANDMARK.test(ler(caminho)));

    expect(
      infratores,
      'A casca deixou de ser landmark na FASE 52: um <main> aqui duplica o de TODA tela que já tem o seu.',
    ).toEqual([]);
  });

  it('toda página tem UM landmark — o próprio ou um herdado', () => {
    const semLandmark: string[] = [];
    const comDois: string[] = [];

    for (const pagina of PAGINAS) {
      const conteudo = ler(pagina);
      const proprio = LANDMARK.test(conteudo);
      const herdado = landmarkHerdado(conteudo);

      if (proprio && herdado) {
        comDois.push(`${pagina} — desenha <main> e ainda renderiza ${herdado}`);
        continue;
      }

      if (proprio || herdado) continue;

      /**
       * Sem landmark próprio e sem herança: só passa quem NÃO desenha tela —
       * o redirecionamento puro (`/superadmin` → `/superadmin/metricas`).
       */
      const redireciona = /redirect\(/.test(conteudo);

      if (!DESENHA_JSX.test(conteudo) && redireciona) continue;

      semLandmark.push(pagina);
    }

    expect(
      semLandmark,
      'Estas telas não têm <main> e não herdam de ninguém: envolva o conteúdo em <main>, como as telas do painel já fazem.',
    ).toEqual([]);

    expect(
      comDois,
      'Estas telas teriam DOIS landmarks: a página desenha o seu e ainda renderiza um componente que já traz um.',
    ).toEqual([]);
  });

  it('a página do evento HERDA o landmark da EventLanding (e não desenha um segundo)', () => {
    /**
     * A metade da regra que mais fácil se perde: como a `EventLanding` ganhou o
     * `<main>` na F52, a página pública do evento NÃO deve ter o seu. Este cenário
     * existe para que "consertar" a página acrescentando um `<main>` reprove aqui —
     * e não só no navegador.
     */
    const pagina = 'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/page.tsx';
    const conteudo = ler(pagina);

    expect(conteudo).not.toMatch(LANDMARK);
    expect(landmarkHerdado(conteudo)).toContain('EventLanding');
    expect(ler('src/components/events/event-landing.tsx')).toMatch(LANDMARK);
  });
});

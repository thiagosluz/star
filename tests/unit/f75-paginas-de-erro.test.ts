/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS PÁGINAS DE ERRO — CATRACA DA FRASE E DA ESTRUTURA (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *  A decisão 4 criou as páginas que o app nunca teve (`error.tsx` e
 *  `not-found.tsx` eram **zero**): todo `notFound()` caía na página padrão do Next e
 *  todo erro de rota subia para o `global-error`. A parte que pode apodrecer sem
 *  ninguém notar não é o CSS — é a REDAÇÃO e a ESTRUTURA:
 *
 *    • a frase do 404 pode voltar a dizer "este recurso não existe" (e virar oráculo
 *      de existência de recurso privado);
 *    • a tela de erro pode ganhar `error.message` no JSX (e vazar detalhe técnico);
 *    • um dos três `not-found.tsx` pode ser apagado numa refatoração, e o visitante
 *      volta a ver a tela do framework em inglês;
 *    • a frase pode ser copiada para dentro do componente, e aí as áreas divergem.
 *
 *  Cada uma dessas regressões tem um caso aqui. A prova de que a página FUNCIONA é o
 *  portão de acessibilidade e o E2E funcional (`tests/e2e/f75-paginas-de-erro.spec.ts`):
 *  esta catraca lê a fonte e a tabela de frases, que é o que ela consegue provar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CATRACA **NÃO** PROVA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Ela não renderiza o JSX: um componente que importe a frase do domínio e não a
 *  mostre passaria. Quem pega isso é o E2E, que lê o texto na tela. A divisão é a
 *  mesma da catraca do landmark (FASE 60): o texto é a antecipação, o navegador é a
 *  prova.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ERROR_AREAS,
  errorContent,
  notFoundContent,
  tenantSlugFromParam,
  type ErrorArea,
} from '../../src/domain/platform/error-pages';

const ROOT = process.cwd();

function ler(caminho: string): string {
  return readFileSync(join(ROOT, caminho), 'utf8');
}

/** A frase que abre o arquivo, antes dos comentários — é o que o Next exige. */
function primeiraLinha(caminho: string): string {
  return ler(caminho).split(/\r?\n/)[0].trim();
}

const SLUG = 'ufba-demo';

/**
 * Onde cada área mora.
 *
 * A casca autenticada, a área pública da instituição e a raiz/plataforma — as TRÊS
 * cascas que existem no app. É o recorte que evita duplicação: um par de arquivos por
 * casca, e não um por página (seriam dezenas, com a mesma frase) nem um só na raiz
 * (que daria o painel a quem estava na vitrine).
 */
const ARQUIVOS: Record<ErrorArea, { erro: string; naoEncontrado: string }> = {
  app: {
    erro: 'src/app/t/[tenantSlug]/(app)/error.tsx',
    naoEncontrado: 'src/app/t/[tenantSlug]/(app)/not-found.tsx',
  },
  public: {
    erro: 'src/app/t/[tenantSlug]/(public)/error.tsx',
    naoEncontrado: 'src/app/t/[tenantSlug]/(public)/not-found.tsx',
  },
  platform: {
    erro: 'src/app/error.tsx',
    naoEncontrado: 'src/app/not-found.tsx',
  },
};

describe('as frases das páginas de erro (domínio)', () => {
  it('as três áreas têm título, descrição e caminho de volta', () => {
    for (const area of ERROR_AREAS) {
      const naoEncontrado = notFoundContent({ area, tenantSlug: SLUG });
      const erro = errorContent({ area, tenantSlug: SLUG });

      for (const texto of [
        naoEncontrado.eyebrow,
        naoEncontrado.title,
        naoEncontrado.description,
        erro.eyebrow,
        erro.title,
        erro.description,
        erro.retryLabel,
      ]) {
        expect(texto.trim(), `frase vazia na área ${area}`).not.toBe('');
      }

      expect(naoEncontrado.exits.length, `saída ausente na área ${area}`).toBeGreaterThanOrEqual(2);
      expect(erro.exits.length, `saída ausente na área ${area}`).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O 404 É UNIFORME — A REGRA QUE IMPEDE O ORÁCULO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Um recurso privado que responde "não existe" para quem não tem acesso, e
   *  "existe" para quem tem, conta a existência dele. As três hipóteses andam
   *  juntas: não existe · foi removido · não está disponível para você.
   */
  it('o não encontrado diz as três hipóteses juntas, sem confirmar nenhuma', () => {
    for (const area of ERROR_AREAS) {
      const { description } = notFoundContent({ area, tenantSlug: SLUG });

      expect(description, `área ${area}: falta "não existe"`).toMatch(/não existe/i);
      expect(description, `área ${area}: falta "removido"`).toMatch(/removido/i);
      expect(description, `área ${area}: falta "não está disponível"`).toMatch(
        /não está disponível/i,
      );
    }
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O ERRO NÃO VAZA DETALHE TÉCNICO E NÃO CULPA A PESSOA
   * ─────────────────────────────────────────────────────────────────────────────
   *  A varredura é por palavra, e é grosseira de propósito: qualquer uma destas na
   *  tela significa que a mensagem técnica (ou o rastro de pilha) vazou.
   */
  it('o erro não carrega mensagem técnica nem culpa quem estava usando', () => {
    const proibidas = [
      'stack',
      'digest',
      'TypeError',
      'undefined',
      'null',
      'exception',
      'traceback',
      'Prisma',
      'código do erro',
      'você fez',
      'sua culpa',
      'erro do usuário',
    ];

    for (const area of ERROR_AREAS) {
      const { title, description } = errorContent({ area, tenantSlug: SLUG });

      for (const palavra of proibidas) {
        expect(
          `${title} ${description}`.toLowerCase(),
          `área ${area}: a frase do erro cita "${palavra}"`,
        ).not.toContain(palavra.toLowerCase());
      }
    }
  });

  /**
   * A responsabilidade é NOMEADA: sem isso a pessoa não sabe se errou. "Do nosso
   * lado" é a frase que a decisão 4 pede — e ela é testável.
   */
  it('o erro nomeia a responsabilidade sem culpar a pessoa', () => {
    for (const area of ERROR_AREAS) {
      expect(errorContent({ area, tenantSlug: SLUG }).description).toMatch(/do nosso lado/i);
    }
  });

  it('a tabela de frases não tem campo para mensagem técnica', () => {
    const formatoErro = Object.keys(errorContent({ area: 'app', tenantSlug: SLUG })).sort();
    const formatoNaoEncontrado = Object.keys(
      notFoundContent({ area: 'app', tenantSlug: SLUG }),
    ).sort();

    /**
     * A lista é FECHADA: acrescentar `details`, `message` ou `digest` ao contrato
     * reprova aqui, antes de alguém ligá-lo no JSX.
     */
    expect(formatoErro).toEqual(['description', 'exits', 'eyebrow', 'retryLabel', 'title']);
    expect(formatoNaoEncontrado).toEqual(['description', 'exits', 'eyebrow', 'title']);
  });

  it('cada área tem o PRÓPRIO caminho de volta, e ele é o primeiro', () => {
    expect(notFoundContent({ area: 'app', tenantSlug: SLUG }).exits[0]?.href).toBe(
      `/t/${SLUG}/dashboard`,
    );
    expect(notFoundContent({ area: 'public', tenantSlug: SLUG }).exits[0]?.href).toBe(
      `/t/${SLUG}/eventos`,
    );
    expect(notFoundContent({ area: 'platform', tenantSlug: SLUG }).exits[0]?.href).toBe('/');
  });

  it('sem slug, a saída não vira link quebrado', () => {
    expect(notFoundContent({ area: 'app', tenantSlug: null }).exits[0]).toEqual({
      label: 'Escolher instituição',
      href: '/selecionar-instituicao',
    });
    expect(notFoundContent({ area: 'public', tenantSlug: null }).exits[0]).toEqual({
      label: 'Ver todos os eventos',
      href: '/eventos',
    });
  });

  it('todo caminho de volta é interno e absoluto — nada de "#" nem de URL externa', () => {
    for (const area of ERROR_AREAS) {
      for (const exit of [
        ...notFoundContent({ area, tenantSlug: SLUG }).exits,
        ...errorContent({ area, tenantSlug: SLUG }).exits,
      ]) {
        expect(exit.href.startsWith('/'), `${area}: ${exit.href} não é caminho interno`).toBe(true);
        expect(exit.href, `${area}: "${exit.href}" não leva a lugar nenhum`).not.toBe('#');
        expect(exit.label.trim()).not.toBe('');
      }
    }
  });

  it('o rótulo do botão é o de refazer, não o de recarregar a página', () => {
    /**
     * `reset` re-renderiza o segmento no SERVIDOR; recarregar a página perde o estado.
     * O rótulo é a promessa que a tela faz, então ele diz "tentar de novo".
     */
    expect(errorContent({ area: 'app', tenantSlug: SLUG }).retryLabel).toBe('Tentar de novo');
  });
});

describe('o slug que veio da URL', () => {
  it('aceita a string e o primeiro item da lista', () => {
    expect(tenantSlugFromParam('ufba')).toBe('ufba');
    expect(tenantSlugFromParam(['ufba', 'outro'])).toBe('ufba');
  });

  it('devolve null para ausência, vazio e espaço — nunca "undefined"', () => {
    expect(tenantSlugFromParam(undefined)).toBeNull();
    expect(tenantSlugFromParam('')).toBeNull();
    expect(tenantSlugFromParam([])).toBeNull();
    expect(tenantSlugFromParam('   ')).toBeNull();
  });
});

describe('os arquivos por área', () => {
  it('as três áreas têm os DOIS arquivos, e eles existem no disco', () => {
    for (const area of ERROR_AREAS) {
      expect(existsSync(join(ROOT, ARQUIVOS[area].erro)), `${area}: sem error.tsx`).toBe(true);
      expect(
        existsSync(join(ROOT, ARQUIVOS[area].naoEncontrado)),
        `${area}: sem not-found.tsx`,
      ).toBe(true);
    }
  });

  it('todo error.tsx é client component — sem `reset` de verdade ele não é boundary', () => {
    for (const area of ERROR_AREAS) {
      expect(primeiraLinha(ARQUIVOS[area].erro), `${area}: error.tsx precisa de 'use client'`).toBe(
        "'use client';",
      );
    }
  });

  it('os arquivos de rota DELEGAM o desenho — nenhum escreve a frase', () => {
    for (const area of ERROR_AREAS) {
      const erro = ler(ARQUIVOS[area].erro);
      const naoEncontrado = ler(ARQUIVOS[area].naoEncontrado);

      expect(erro, `${area}: error.tsx não usa o componente da área`).toContain('<AreaError');
      expect(
        naoEncontrado,
        `${area}: not-found.tsx não usa o componente da área`,
      ).toContain('<AreaNotFound');

      /**
       * A frase vem do domínio, e o teste a procura LITERALMENTE nos dois arquivos de
       * rota: se alguém copiar o texto para dentro de um deles, as áreas divergem sem
       * ninguém notar (é o defeito que a FASE 74 achou na prontidão da submissão).
       */
      for (const frase of [
        notFoundContent({ area, tenantSlug: SLUG }).description,
        errorContent({ area, tenantSlug: SLUG }).description,
      ]) {
        expect(erro, `${area}: a frase do erro foi escrita à mão no arquivo de rota`).not.toContain(
          frase,
        );
        expect(
          naoEncontrado,
          `${area}: a frase do não encontrado foi escrita à mão no arquivo de rota`,
        ).not.toContain(frase);
      }
    }
  });

  it('o desenho compartilhado não repete a frase da tabela', () => {
    const areaErro = ler('src/components/shell/area-error.tsx');
    const areaNaoEncontrado = ler('src/components/shell/area-not-found.tsx');

    for (const area of ERROR_AREAS) {
      expect(areaErro).not.toContain(errorContent({ area, tenantSlug: SLUG }).title);
      expect(areaNaoEncontrado).not.toContain(
        notFoundContent({ area, tenantSlug: SLUG }).title,
      );
    }

    /** E os dois usam o campo, não uma string solta. */
    expect(areaErro).toContain('content.retryLabel');
    expect(areaErro).toContain('content.exits');
    expect(areaNaoEncontrado).toContain('content.exits');
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  UM `<main>` POR TELA — O DESENHO É O DESTA TELA
   * ─────────────────────────────────────────────────────────────────────────────
   *  A casca não é landmark (FASE 52): o `<main>` das páginas de erro é o do
   *  componente compartilhado, e os arquivos de rota NÃO desenham um segundo. Se
   *  alguém "consertar" a página pondo outro lá, a tela passa a ter dois — e a
   *  catraca do landmark só olha `page.tsx`, não `error.tsx`/`not-found.tsx`.
   */
  it('o landmark mora no componente compartilhado, e só nele', () => {
    expect(ler('src/components/shell/area-not-found.tsx')).toMatch(/<main[\s>]/);
    expect(ler('src/components/shell/area-error.tsx')).toMatch(/<main[\s>]/);

    for (const area of ERROR_AREAS) {
      expect(ler(ARQUIVOS[area].erro), `${area}: error.tsx com <main> próprio`).not.toMatch(
        /<main[\s>]/,
      );
      expect(
        ler(ARQUIVOS[area].naoEncontrado),
        `${area}: not-found.tsx com <main> próprio`,
      ).not.toMatch(/<main[\s>]/);
    }
  });

  /**
   * O nome do header é literal em `tenant-slug-header.ts` para não arrastar o Proxy
   * inteiro para dentro de uma página. O literal só é aceitável porque está preso:
   * se o Proxy mudar o nome, este caso reprova antes de a saída da página virar
   * `/t/null/dashboard`.
   */
  it('o header do slug é o mesmo que o Proxy injeta', () => {
    const proxy = ler('src/proxy.ts');
    const helper = ler('src/lib/tenancy/tenant-slug-header.ts');

    const doProxy = /slug:\s*'([^']+)'/.exec(proxy)?.[1];
    const doHelper = /TENANT_SLUG_HEADER\s*=\s*'([^']+)'/.exec(helper)?.[1];

    expect(doProxy, 'não achei o nome do header em src/proxy.ts').toBeTruthy();
    expect(doHelper, 'não achei TENANT_SLUG_HEADER em tenant-slug-header.ts').toBe(doProxy);
  });
});

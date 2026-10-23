/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O TOPO ÚNICO — slots, trilha derivada e a catraca de server-ness (FASE 78 · fatia 1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *  A dívida H1 ("cabeçalhos escritos à mão") está aberta desde a F11B e só fecha
 *  porque o `PageHeader` passa a ser o topo ÚNICO: 87 telas vão migrar para ele
 *  nas próximas fatias. Um componente que 87 telas vão copiar não pode ser
 *  corrigido por inspeção — os invariantes que a fase promete viram teste:
 *
 *    • exatamente UM `<h1>` por tela (o título);
 *    • o eyebrow é `<p>` e fica FORA do `<h1>` (dentro, o nome acessível do
 *      título viraria "OperaçãoCredenciamento");
 *    • o ícone é decorativo (`aria-hidden`) e irmão do título;
 *    • o `data-testid` do título passa por prop — os 12 testids que já existem
 *      no produto não podem sumir na migração;
 *    • a VOLTA é derivada da trilha (penúltimo item) e o nome acessível dela diz
 *      o destino: "Voltar para Administração", nunca "← Painel";
 *    • a trilha é `nav` rotulado com `ol`/`li`, e o item final é a página atual.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CATRACA DE SERVER-NESS (a razão de metade desta fatia)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `PageHeader` morava em `navigation.tsx`, que é `'use client'` por causa de
 *  `NavLink`/`TabNav`. Espalhá-lo dali criaria ~96 ilhas de cliente. O teste lê
 *  os dois arquivos-fonte: o do topo NÃO pode ter a diretiva nem hook; o da
 *  navegação PRECISA continuar cliente (quem usa a rota é o menu).
 *
 *  A renderização é `renderToStaticMarkup`, o mesmo caminho dos testes da F63 e
 *  F64: o que está em julgamento é o HTML que o SERVIDOR entrega, e não um
 *  componente remontado pelo teste.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Breadcrumbs, PageHeader } from '../../src/components/ui/page-header';
import * as ui from '../../src/components/ui/index';

const RAIZ = process.cwd();

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

/** Varre um diretório de `src/` e devolve os arquivos `.ts`/`.tsx`. */
function arquivosDe(diretorio: string, encontrados: string[] = []): string[] {
  for (const entrada of readdirSync(join(RAIZ, diretorio))) {
    const absoluto = join(RAIZ, diretorio, entrada);

    if (statSync(absoluto).isDirectory()) {
      arquivosDe(`${diretorio}/${entrada}`, encontrados);
      continue;
    }

    if (/\.(?:tsx|ts)$/.test(entrada)) encontrados.push(`${diretorio}/${entrada}`);
  }

  return encontrados;
}

function paginasDe(diretorio: string): string[] {
  return arquivosDe(diretorio).filter((arquivo) => arquivo.endsWith('/page.tsx'));
}

/**
 * Remove comentários antes de procurar diretiva/hook.
 *
 * O comentário do arquivo do topo EXPLICA que ele não pode ganhar `'use client'`
 * — e cita `usePathname` para contar a história. Procurar no texto cru daria
 * falso positivo e o teste reprovaria a própria documentação.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** O HTML do servidor, montado num `document` do jsdom para inspeção por seletor. */
function renderizar(elemento: ReactElement): string {
  return renderToStaticMarkup(elemento);
}

function corpo(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Slots
// ───────────────────────────────────────────────────────────────────────────────
describe('PageHeader — os slots do contrato (FASE 78)', () => {
  const completo = () =>
    renderizar(
      createElement(PageHeader, {
        title: 'Equipe e participantes',
        titleTestId: 'tenant-page-title',
        eyebrow: 'Operação',
        icon: createElement('svg', { 'data-testid': 'icone-de-teste' }),
        description: 'Quem responde pela instituição e quem é público dos eventos.',
        badge: createElement('span', { 'data-testid': 'badge-de-teste' }, 'Exemplo'),
        actions: createElement('button', { type: 'button' }, 'Convidar membro'),
        breadcrumbs: [
          { label: 'Painel', href: '/painel' },
          { label: 'Administração', href: '/administracao' },
          { label: 'Equipe' },
        ],
      }),
    );

  it('renderiza cada slot', () => {
    const html = completo();
    const dom = corpo(html);

    expect(dom.querySelector('h1')?.textContent).toBe('Equipe e participantes');
    expect(dom.textContent).toContain('Operação');
    expect(dom.textContent).toContain('Quem responde pela instituição');
    expect(dom.querySelector('[data-testid="badge-de-teste"]')?.textContent).toBe('Exemplo');
    expect(dom.querySelector('header button')?.textContent).toBe('Convidar membro');
    expect(dom.querySelector('[data-testid="icone-de-teste"]')).not.toBeNull();
  });

  it('renderiza o mínimo: só o título', () => {
    const dom = corpo(renderizar(createElement(PageHeader, { title: 'Painel' })));

    expect(dom.querySelectorAll('header h1')).toHaveLength(1);
    expect(dom.querySelector('nav')).toBeNull();
    expect(dom.querySelector('header [data-testid="tenant-page-title"]')).toBeNull();
  });

  it('o data-testid do título passa para o <h1>', () => {
    const dom = corpo(completo());

    const h1 = dom.querySelector('h1');
    expect(h1?.getAttribute('data-testid')).toBe('tenant-page-title');
    expect(dom.querySelectorAll('[data-testid="tenant-page-title"]')).toHaveLength(1);
  });

  it('tem EXATAMENTE um <h1>, e nenhum outro heading', () => {
    const dom = corpo(completo());

    expect(dom.querySelectorAll('h1')).toHaveLength(1);
    expect(dom.querySelectorAll('h2, h3, h4, h5, h6')).toHaveLength(0);
  });

  it('o eyebrow é <p> e fica FORA do <h1>', () => {
    const dom = corpo(completo());

    const h1 = dom.querySelector('h1');
    const eyebrow = Array.from(dom.querySelectorAll('p')).find(
      (paragrafo) => paragrafo.textContent === 'Operação',
    );

    expect(eyebrow, 'o eyebrow precisa ser um parágrafo').toBeDefined();
    expect(eyebrow?.tagName).toBe('P');
    expect(eyebrow?.closest('h1')).toBeNull();
    expect(h1?.textContent).toBe('Equipe e participantes');
    expect(h1?.textContent).not.toContain('Operação');
    expect(h1?.contains(eyebrow ?? null)).toBe(false);
  });

  it('o ícone é irmão do <h1> e é aria-hidden', () => {
    const dom = corpo(completo());

    const icone = dom.querySelector('[data-testid="icone-de-teste"]');
    const caixa = icone?.closest('[aria-hidden="true"]');
    const h1 = dom.querySelector('h1');

    expect(caixa, 'o ícone precisa estar numa caixa aria-hidden').not.toBeNull();
    expect(caixa?.contains(icone ?? null)).toBe(true);
    expect(caixa?.parentElement).toBe(h1?.parentElement);
    expect(caixa?.nextElementSibling).toBe(h1);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Trilha e volta derivada
// ───────────────────────────────────────────────────────────────────────────────
describe('PageHeader — a volta é DERIVADA da trilha (FASE 78)', () => {
  const trilha = [
    { label: 'Painel', href: '/painel' },
    { label: 'Administração', href: '/administracao' },
    { label: 'Equipe' },
  ];

  it('nomeia o destino: "Voltar para Administração"', () => {
    const dom = corpo(
      renderizar(createElement(PageHeader, { title: 'Equipe', breadcrumbs: trilha })),
    );

    const volta = Array.from(dom.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Voltar para'),
    );

    expect(volta, 'a volta precisa existir e nomear o destino').toBeDefined();
    expect(volta?.getAttribute('href')).toBe('/administracao');
    expect(volta?.textContent).toContain('Voltar para Administração');
    expect(volta?.textContent).not.toBe('← Painel');
  });

  it('a seta é aria-hidden — o nome acessível é a frase, não o glifo', () => {
    const dom = corpo(
      renderizar(createElement(PageHeader, { title: 'Equipe', breadcrumbs: trilha })),
    );

    const volta = Array.from(dom.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Voltar para'),
    );
    const seta = volta?.querySelector('span');

    expect(seta?.getAttribute('aria-hidden')).toBe('true');
    expect(seta?.textContent).toBe('←');
  });

  it('é o PENÚLTIMO item, ainda que o último tenha href', () => {
    const dom = corpo(
      renderizar(
        createElement(PageHeader, {
          title: 'Equipe',
          breadcrumbs: [
            { label: 'Painel', href: '/painel' },
            { label: 'Administração', href: '/administracao' },
            { label: 'Equipe', href: '/equipe' },
          ],
        }),
      ),
    );

    const volta = Array.from(dom.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Voltar para'),
    );

    expect(volta?.getAttribute('href')).toBe('/administracao');
    expect(volta?.textContent).toContain('Voltar para Administração');
  });

  it('não desenha a volta quando o penúltimo item não tem destino', () => {
    const dom = corpo(
      renderizar(
        createElement(PageHeader, {
          title: 'Equipe',
          breadcrumbs: [{ label: 'Plataforma' }, { label: 'Equipe' }],
        }),
      ),
    );

    expect(dom.textContent).not.toContain('Voltar para');
  });

  it('não desenha a volta com um item só', () => {
    const dom = corpo(
      renderizar(
        createElement(PageHeader, { title: 'Painel', breadcrumbs: [{ label: 'Painel' }] }),
      ),
    );

    expect(dom.textContent).not.toContain('Voltar para');
  });
});

describe('Breadcrumbs — a trilha', () => {
  const itens = [
    { label: 'Painel', href: '/painel' },
    { label: 'Administração', href: '/administracao' },
    { label: 'Equipe' },
  ];

  it('é um nav rotulado com ol/li — não uma div de spans', () => {
    const dom = corpo(renderizar(createElement(Breadcrumbs, { items: itens })));

    const nav = dom.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Trilha de navegação');
    expect(nav?.querySelector('ol')).not.toBeNull();
    expect(nav?.querySelectorAll('ol > li')).toHaveLength(3);
    expect(nav?.querySelector('div')).toBeNull();
  });

  it('o item final é a página atual e não é link', () => {
    const dom = corpo(renderizar(createElement(Breadcrumbs, { items: itens })));

    const atual = dom.querySelector('[aria-current="page"]');
    expect(atual?.textContent).toBe('Equipe');
    expect(atual?.tagName).toBe('SPAN');
    expect(dom.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('os itens anteriores navegam', () => {
    const dom = corpo(renderizar(createElement(Breadcrumbs, { items: itens })));

    expect(dom.querySelector('a[href="/painel"]')?.textContent).toBe('Painel');
    expect(dom.querySelector('a[href="/administracao"]')?.textContent).toBe('Administração');
  });

  it('trilha vazia não desenha landmark nenhum', () => {
    const html = renderizar(createElement(Breadcrumbs, { items: [] }));

    expect(html).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Reexportação: as 9 páginas importam de `@/components/ui`
// ───────────────────────────────────────────────────────────────────────────────
describe('o barrel mantém o caminho único de import (FASE 78)', () => {
  it('`PageHeader`, `Breadcrumbs` e `Crumb` continuam exportados de @/components/ui', () => {
    /**
     * O import do barrel é a prova de que as 9 páginas que já usavam o componente
     * seguem compilando SEM edição — elas importam `PageHeader` daqui, e o tipo
     * `Crumb` continua no mesmo lugar.
     */
    expect(typeof ui.PageHeader).toBe('function');
    expect(typeof ui.Breadcrumbs).toBe('function');
    expect(typeof ui.NavLink).toBe('function');
    expect(typeof ui.TabNav).toBe('function');
  });

  it('o índice separa as duas fronteiras: topo server, menu client', () => {
    const fonte = ler('src/components/ui/index.ts');

    expect(fonte).toContain("export { Breadcrumbs, PageHeader, type Crumb } from './page-header';");
    expect(fonte).toContain("export { NavLink, TabNav } from './navigation';");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A catraca de server-ness
// ───────────────────────────────────────────────────────────────────────────────
const DIRETIVA_CLIENTE = /^\s*(['"])use client\1;?/;

/** Hooks do React e do Next que forçariam o componente a ser cliente. */
const HOOKS =
  /\buse(?:State|Effect|Pathname|Router|Ref|Memo|Callback|Context|Reducer|Id|LayoutEffect|SyncExternalStore|Transition|DeferredValue|InsertionEffect|ActionState|Optimistic)\b/;

describe('catraca — o topo é server e o menu continua cliente (FASE 78)', () => {
  const topo = semComentarios(ler('src/components/ui/page-header.tsx'));
  const navegacao = ler('src/components/ui/navigation.tsx');
  const navegacaoSemComentarios = semComentarios(navegacao);

  it('o arquivo do topo NÃO tem a diretiva `use client`', () => {
    expect(DIRETIVA_CLIENTE.test(topo)).toBe(false);
  });

  it('o arquivo do topo NÃO usa hook (nem importa next/navigation)', () => {
    expect(topo.match(HOOKS) ?? []).toEqual([]);
    expect(topo).not.toContain("from 'next/navigation'");
  });

  it('o arquivo do topo não precisa de `createContext`, efeito ou estado', () => {
    expect(topo).not.toContain('createContext');
    expect(topo).not.toContain('useSyncExternalStore');
  });

  it('`navigation.tsx` CONTINUA cliente, e por causa de NavLink/TabNav', () => {
    expect(DIRETIVA_CLIENTE.test(navegacao)).toBe(true);
    expect(navegacaoSemComentarios).toContain('usePathname');
    expect(navegacaoSemComentarios).toContain('export function NavLink');
    expect(navegacaoSemComentarios).toContain('export function TabNav');
  });

  it('`navigation.tsx` não redefine mais o topo', () => {
    expect(navegacaoSemComentarios).not.toContain('export function PageHeader');
    expect(navegacaoSemComentarios).not.toContain('export function Breadcrumbs');
    expect(navegacaoSemComentarios).not.toContain('export interface Crumb');
  });

  it('`headingLevel` não escapa da vitrine', () => {
    /**
     * A exceção da vitrine (rebaixar as amostras para `<h2>`) não pode virar
     * desculpa para uma tela real fugir do `<h1>`: nenhum `page.tsx` fora de
     * `/superadmin/design` pode passar a prop.
     */
    const infratores = paginasDe('src/app').filter(
      (arquivo) =>
        arquivo !== 'src/app/superadmin/design/page.tsx' && ler(arquivo).includes('headingLevel'),
    );

    expect(infratores).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Os 12 data-testid de <h1> do produto não podem sumir na migração
// ───────────────────────────────────────────────────────────────────────────────
const TESTIDS_DO_TITULO = [
  'tenant-page-title',
  'profile-name',
  'card-title',
  'call-title',
  'speaker-name',
  'audit-title',
  'raffle-result-title',
  'stage-off-title',
  'demand-detail-title',
  'verification-title',
  'tenant-detail-name',
  'shared-card-title',
] as const;

describe('a vitrine do guia de estilo (FASE 78)', () => {
  it('`/superadmin/design` mostra os seis casos do contrato', () => {
    /**
     * A vitrine é a referência visual da fatia 2: se uma amostra sumir, quem
     * migrar a próxima tela copia menos do que a fase prometeu. O teste prende
     * as seis molduras e a presença do componente REAL dentro da seção — a
     * conferência de pixel dela é do E2E, não daqui.
     */
    const fonte = ler('src/app/superadmin/design/page.tsx');

    for (const caso of [
      'design-header-base',
      'design-header-eyebrow',
      'design-header-icon',
      'design-header-breadcrumbs',
      'design-header-actions',
      'design-header-badge',
    ]) {
      expect(fonte, `a amostra ${caso} sumiu da vitrine`).toContain(`testId="${caso}"`);
    }

    /** Um `PageHeader` é o da própria página; os outros seis são as amostras. */
    expect(fonte.match(/<PageHeader/g) ?? []).toHaveLength(7);
    expect(fonte).toContain('headingLevel={2}');
  });
});

describe('os data-testid do título (FASE 78)', () => {
  it('os 12 continuam no produto — nenhum pode sumir', () => {
    /**
     * A migração da fatia 2 passou `card-title` e `demand-detail-title` para a
     * prop `titleTestId` do `PageHeader` (o `<h1>` agora é desenhado pelo
     * componente). O contrato que este teste prende é o do E2E — o testid
     * continua no `<h1>` —, e não a forma como ele chega lá: por isso as duas
     * grafias contam.
     */
    const fontes = ['src/app', 'src/components']
      .flatMap((diretorio) => arquivosDe(diretorio))
      .map((arquivo) => ler(arquivo))
      .join('\n');

    const ausentes = TESTIDS_DO_TITULO.filter(
      (testid) =>
        !fontes.includes(`data-testid="${testid}"`) && !fontes.includes(`titleTestId="${testid}"`),
    );

    expect(ausentes, `testid(s) sumiram das telas: ${ausentes.join(', ')}`).toEqual([]);
  });
});

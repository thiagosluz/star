/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A PÁGINA PÚBLICA DA INSTITUIÇÃO (FASE 64 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES CASOS PRENDEM, E POR QUE SEM NAVEGADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 1 provou a régua do DOMÍNIO (blocos, tema, os três grupos por data). O que
 *  falta é a régua da TELA, e ela tem três perguntas:
 *
 *    1. **Quando o "ver todos" aparece, e qual número ele anuncia?** — a resposta é do
 *       DADO (`hasMore` × `total`), e a lição da F54 é que a tela NÃO reconta: uma
 *       segunda contagem diria "ver todos os 6" embaixo de uma lista de 6, com 12 no
 *       banco. Isto é provado a frio, sem React.
 *    2. **O bloco `PAST_EVENTS` lê os eventos na RENDERIZAÇÃO?** — a régua do ADR-168:
 *       o bloco guarda só a decoração e o limite, e a lista vem do read model. O caso
 *       abaixo troca o read model e cobra que a lista desenhada mude, SEM tocar no
 *       conteúdo do bloco: se alguém copiar evento para dentro do bloco, ele cai.
 *    3. **O que a página desenha é o que o visitante vê?** — capa, título, descrição,
 *       os três grupos e os blocos, renderizados pelo componente REAL (o mesmo que a
 *       prévia da fatia 3 vai consumir), com o HTML do servidor inspecionado.
 *
 *  A renderização é `renderToStaticMarkup`, o mesmo caminho do teste da FASE 63: o que
 *  está em julgamento é o HTML que o SERVIDOR entrega — e não um componente remontado
 *  pelo teste, que passaria mesmo se a página não desenhasse nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  TENANT_PAGE_GROUP_LABELS,
  TENANT_PAGE_GROUP_ORDER,
  fraseDoGrupoVazio,
  grupoTemEventos,
  mostrarVerTodos,
  totalDoGrupo,
} from '../../src/domain/tenancy/tenant-page-presentation';
import type { TenantPageBlock } from '../../src/domain/tenancy/tenant-public-page';
import { TenantHome, TenantPublicPage } from '../../src/components/tenancy/tenant-page';
import type {
  PublicTenantEventCard,
  PublicTenantPageView,
} from '../../src/lib/tenancy/tenant-public-page-view';
import type { TenantEventGroupView } from '../../src/domain/tenancy/tenant-event-groups';

// ───────────────────────────────────────────────────────────────────────────────
//  Fixtures
// ───────────────────────────────────────────────────────────────────────────────
function cartao(patch: Partial<PublicTenantEventCard> = {}): PublicTenantEventCard {
  return {
    id: 'evento-1',
    slug: 'seminario-2026',
    title: 'Seminário de Letras',
    subtitle: null,
    summary: 'Encontro anual da casa.',
    periodLabel: '10 de novembro de 2026, 08:00 – 18:00',
    startsAt: new Date('2026-11-10T11:00:00.000Z'),
    endsAt: new Date('2026-11-10T21:00:00.000Z'),
    isHappeningNow: false,
    modality: 'IN_PERSON',
    city: 'Salvador',
    state: 'BA',
    venueName: 'Auditório A',
    coverImageUrl: null,
    primaryColor: null,
    remainingSeats: 12,
    ...patch,
  };
}

/** Um grupo do read model, com o que a tela lê (`events` × `total` × `hasMore`). */
function grupo(
  events: PublicTenantEventCard[],
  patch: { total?: number; hasMore?: boolean; limit?: number } = {},
): TenantEventGroupView<PublicTenantEventCard> {
  return {
    group: 'UPCOMING',
    items: [],
    events,
    total: patch.total ?? events.length,
    hasMore: patch.hasMore ?? false,
    limit: patch.limit ?? 6,
  };
}

function pagina(patch: Partial<PublicTenantPageView> = {}): PublicTenantPageView {
  return {
    pageId: 'pagina-1',
    identity: {
      tenantId: 'tenant-1',
      slug: 'instituto-de-letras',
      name: 'Instituto de Letras',
      timezone: 'America/Bahia',
      logoUrl: null,
      primaryColor: null,
      description: 'Apresentação do diretório.',
    },
    title: 'Instituto de Letras',
    description: 'A casa dos cursos de Letras.',
    coverImageUrl: null,
    logoUrl: null,
    theme: {
      primaryColor: '#0f6f8c',
      secondaryColor: '#eef4f7',
      accentColor: '#e8a33d',
      backgroundColor: '#fbfcfd',
      textColor: '#16202a',
      radius: 8,
      fontFamily: 'sans',
      density: 'comfortable',
      heroStyle: 'plain',
      animation: 'none',
      colorMode: 'light',
    },
    themeIsValid: true,
    blocks: [],
    events: {
      upcoming: grupo([cartao({ id: 'futuro', title: 'Seminário de 2027' })]),
      ongoing: grupo([cartao({ id: 'agora', title: 'Mostra em cartaz', isHappeningNow: true })]),
      past: grupo([cartao({ id: 'antigo', title: 'Edição de 2025' })]),
      total: 3,
      now: new Date('2026-11-10T12:00:00.000Z'),
      timeZone: 'America/Bahia',
    },
    publishedAt: new Date('2026-11-01T10:00:00.000Z'),
    ...patch,
  };
}

function bloco(patch: Partial<TenantPageBlock> = {}): TenantPageBlock {
  return {
    id: 'bloco-1',
    type: 'ABOUT',
    content: { title: 'Nossa história', body: 'Fundada em 1957.' },
    style: {},
    displayOrder: 0,
    isVisible: true,
    ...patch,
  };
}

/**
 * O HTML que o servidor entrega para a página — uma vez por caso.
 *
 * `createElement` em vez de JSX de propósito: os testes de unidade são `.ts`, e o
 * `include` do Vitest só casa arquivos de teste `.ts` (um `*.tsx` aqui seria ignorado
 * pela suíte). O que está em julgamento é o HTML que o componente REAL produz — a
 * forma de chamá-lo não muda isso.
 */
function html(page: PublicTenantPageView): string {
  return renderToStaticMarkup(createElement(TenantPublicPage, { page }));
}

// ───────────────────────────────────────────────────────────────────────────────
//  A régua da apresentação (pura)
// ───────────────────────────────────────────────────────────────────────────────
describe('a regra do "ver todos"', () => {
  it('o link aparece quando o serviço diz que há mais, e o número é o TOTAL dele', () => {
    const comMais = grupo([cartao()], { total: 12, hasMore: true, limit: 6 });

    expect(mostrarVerTodos(comMais)).toBe(true);
    /** 12 é o total do SERVIÇO — a tela não recontou os 1 item desenhado. */
    expect(totalDoGrupo(comMais)).toBe(12);
  });

  it('sem mais eventos o link não aparece e nenhum número é oferecido', () => {
    const exato = grupo([cartao(), cartao({ id: 'b' })], { total: 2, hasMore: false, limit: 6 });

    expect(mostrarVerTodos(exato)).toBe(false);
    expect(totalDoGrupo(exato)).toBeNull();
  });

  it('a decisão é do `hasMore` do serviço, e não de uma comparação feita na tela', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A MUTAÇÃO QUE ESTE CASO PEGA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Aqui o total (10) é MAIOR que o limite (6) e o serviço diz que NÃO há mais —
     *  combinação que acontece quando a definição de "tem mais" muda no domínio (por
     *  exemplo, passar a contar só o que ainda é público). Uma tela que decidisse por
     *  conta própria (`total > limit`) mostraria o link; a que obedece ao serviço, não.
     */
    const discordante = grupo([cartao()], { total: 10, hasMore: false, limit: 6 });

    expect(mostrarVerTodos(discordante)).toBe(false);
  });

  it('um grupo é "vazio" pelo TOTAL, e não pelo que foi desenhado', () => {
    /** O limite recortou a lista e ainda assim o grupo tem eventos. */
    const recortado = grupo([], { total: 4, hasMore: true, limit: 6 });

    expect(grupoTemEventos(recortado)).toBe(true);
    expect(grupoTemEventos(grupo([], { total: 0 }))).toBe(false);
  });

  it('os três grupos têm nome, verbo e frase de vazio, e a ordem é a da pergunta', () => {
    expect(TENANT_PAGE_GROUP_ORDER.map((item) => item.group)).toEqual([
      'UPCOMING',
      'ONGOING',
      'PAST',
    ]);

    /** A chave do read model de cada grupo — a tradução de vocabulário. */
    expect(TENANT_PAGE_GROUP_ORDER.map((item) => item.key)).toEqual([
      'upcoming',
      'ongoing',
      'past',
    ]);

    for (const { group } of TENANT_PAGE_GROUP_ORDER) {
      const labels = TENANT_PAGE_GROUP_LABELS[group];

      expect(labels.title.length, group).toBeGreaterThan(0);
      expect(labels.verTodos.length, group).toBeGreaterThan(0);
      expect(fraseDoGrupoVazio(group), group).toBe(labels.vazio);
    }

    /** "Acontecendo" não pode ser o título do grupo de eventos que já terminaram. */
    expect(TENANT_PAGE_GROUP_LABELS.ONGOING.title).toContain('Acontecendo');
    expect(TENANT_PAGE_GROUP_LABELS.PAST.title).not.toContain('Acontecendo');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A página desenhada (o HTML do servidor)
// ───────────────────────────────────────────────────────────────────────────────
describe('a página como o visitante a vê', () => {
  it('desenha um único <main>, com a capa, o título, a descrição e a identidade', () => {
    const markup = html(
      pagina({
        coverImageUrl: 'https://midia.exemplo.test/capa.webp',
        logoUrl: 'https://midia.exemplo.test/logo.webp',
      }),
    );

    expect(markup.match(/<main/g) ?? []).toHaveLength(1);
    expect(markup).toContain('https://midia.exemplo.test/capa.webp');
    expect(markup).toContain('https://midia.exemplo.test/logo.webp');
    expect(markup).toContain('Instituto de Letras');
    expect(markup).toContain('A casa dos cursos de Letras.');
  });

  it('desenha os TRÊS grupos, com o nome e o evento certo em cada um', () => {
    const markup = html(pagina());

    expect(markup).toContain('tenant-group-upcoming');
    expect(markup).toContain('tenant-group-ongoing');
    expect(markup).toContain('tenant-group-past');

    for (const { group } of TENANT_PAGE_GROUP_ORDER) {
      expect(markup, group).toContain(TENANT_PAGE_GROUP_LABELS[group].title);
    }

    expect(markup).toContain('Seminário de 2027');
    expect(markup).toContain('Mostra em cartaz');
    expect(markup).toContain('Edição de 2025');

    /** O cartão do grupo "acontecendo" ganha o selo; os outros não. */
    expect(markup).toContain('Acontecendo agora');
  });

  it('grupo sem eventos NÃO desaparece: ele diz o que ausente significa', () => {
    const markup = html(
      pagina({
        events: {
          upcoming: grupo([]),
          ongoing: grupo([]),
          past: grupo([]),
          total: 0,
          now: new Date('2026-11-10T12:00:00.000Z'),
          timeZone: 'America/Bahia',
        },
      }),
    );

    for (const { group } of TENANT_PAGE_GROUP_ORDER) {
      expect(markup, group).toContain(`tenant-group-empty-${group.toLowerCase()}`);
      expect(markup, group).toContain(fraseDoGrupoVazio(group));
    }
  });

  it('o "ver todos" aponta para a listagem da instituição e anuncia o total do serviço', () => {
    const markup = html(
      pagina({
        events: {
          upcoming: grupo([cartao()], { total: 12, hasMore: true }),
          ongoing: grupo([cartao({ id: 'agora', isHappeningNow: true })]),
          past: grupo([cartao({ id: 'antigo' })], { total: 1, hasMore: false }),
          total: 14,
          now: new Date('2026-11-10T12:00:00.000Z'),
          timeZone: 'America/Bahia',
        },
      }),
    );

    /** O caminho é o da listagem de eventos da instituição (é para lá que se vai). */
    expect(markup).toContain('href="/t/instituto-de-letras/eventos"');
    expect(markup).toContain('12 no total');

    /** E só o grupo que tem mais oferece o link — o de "antigos" não. */
    expect(markup).toContain('tenant-group-more-upcoming');
    expect(markup).not.toContain('tenant-group-more-ongoing');
    expect(markup).not.toContain('tenant-group-more-past');
  });

  it('o aviso de pré-visualização só existe quando a fatia 3 o pede', () => {
    const publica = html(pagina());
    expect(publica).not.toContain('tenant-page-preview-banner');
    expect(publica).not.toContain('Pré-visualização');

    const previa = renderToStaticMarkup(
      createElement(TenantPublicPage, {
        page: pagina(),
        preview: { publicationLabel: 'publicada', editorHref: '/t/x/administracao/pagina' },
      }),
    );

    expect(previa).toContain('tenant-page-preview-banner');
    expect(previa).toContain('Pré-visualização');
    expect(previa).toContain('href="/t/x/administracao/pagina"');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A raiz da instituição: a página personalizada OU o fallback
// ───────────────────────────────────────────────────────────────────────────────
describe('a raiz da instituição na tela', () => {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O FALLBACK É REQUISITO DE ACEITE, E AQUI ELE É PROVADO SEM BANCO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Quando `getPublicTenantPage` devolve `null` (nunca publicada, ou despublicada),
   *  `/t/<slug>` continua servindo a listagem de eventos da instituição. A prova de
   *  ponta a ponta é do E2E (com o banco); estas duas asserções prendem o desenho:
   *  sem página, o fallback aparece e a página personalizada NÃO; e o `<main>` é
   *  ÚNICO nos dois ramos (a catraca da FASE 60 reprovou a primeira versão, em que a
   *  página desenhava o seu e ainda renderizava o componente).
   */
  const fallback = createElement('p', { 'data-testid': 'fallback-de-mentira' }, 'Listagem de eventos');

  it('sem página publicada, desenha o fallback dentro do ÚNICO <main>', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantHome, { page: null, fallback }),
    );

    expect(markup.match(/<main/g) ?? []).toHaveLength(1);
    expect(markup).toContain('tenant-events-fallback');
    expect(markup).toContain('fallback-de-mentira');
    expect(markup).not.toContain('tenant-public-page');
  });

  it('com página publicada, desenha a página e NÃO o fallback', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantHome, { page: pagina(), fallback }),
    );

    expect(markup.match(/<main/g) ?? []).toHaveLength(1);
    expect(markup).toContain('tenant-public-page');
    expect(markup).not.toContain('tenant-events-fallback');
    expect(markup).not.toContain('fallback-de-mentira');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Os blocos
// ───────────────────────────────────────────────────────────────────────────────
describe('os blocos da instituição', () => {
  it('`PAST_EVENTS` lê os eventos NA RENDERIZAÇÃO — o bloco guarda só a decoração', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A RÉGUA DO ADR-168, E A MUTAÇÃO QUE ESTE CASO PEGA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O MESMO bloco (mesmo `content`) é renderizado duas vezes com read models
     *  diferentes. Se alguém copiar o evento para dentro do bloco — que é o caminho
     *  curto e errado —, as duas renderizações ficariam iguais e este caso reprova.
     */
    const blocoDeHistorico = bloco({
      id: 'historico',
      type: 'PAST_EVENTS',
      content: { title: 'Edições anteriores', limit: 6 },
    });

    const comEventoAntigo = html(
      pagina({
        blocks: [blocoDeHistorico],
        events: {
          upcoming: grupo([]),
          ongoing: grupo([]),
          past: grupo([cartao({ id: 'a', title: 'Congresso de 2024' })], {
            total: 1,
          }),
          total: 1,
          now: new Date('2026-11-10T12:00:00.000Z'),
          timeZone: 'America/Bahia',
        },
      }),
    );

    const comOutroEventoAntigo = html(
      pagina({
        blocks: [blocoDeHistorico],
        events: {
          upcoming: grupo([]),
          ongoing: grupo([]),
          past: grupo([cartao({ id: 'b', title: 'Congresso de 2025' })], {
            total: 1,
          }),
          total: 1,
          now: new Date('2026-11-10T12:00:00.000Z'),
          timeZone: 'America/Bahia',
        },
      }),
    );

    expect(comEventoAntigo).toContain('Congresso de 2024');
    expect(comEventoAntigo).not.toContain('Congresso de 2025');

    expect(comOutroEventoAntigo).toContain('Congresso de 2025');
    expect(comOutroEventoAntigo).not.toContain('Congresso de 2024');
  });

  it('`PAST_EVENTS` respeita o LIMITE do bloco, e sem histórico não desenha nada', () => {
    const blocoDeHistorico = bloco({
      id: 'historico',
      type: 'PAST_EVENTS',
      content: { title: 'Edições anteriores', limit: 2 },
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ASSERÇÃO É SOBRE A SEÇÃO DO BLOCO, E NÃO SOBRE A PÁGINA INTEIRA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O mesmo evento antigo aparece DUAS vezes na página: no grupo "Edições
     *  anteriores" (que tem o limite do grupo) e no bloco (que tem o limite DELE).
     *  Medir o HTML inteiro mediria os dois e não diria nada sobre o bloco — por isso
     *  o recorte da seção ANTES da contagem, como o teste precisa.
     */
    const antigos = [
      cartao({ id: 'a', slug: 'edicao-a', title: 'Edição A' }),
      cartao({ id: 'b', slug: 'edicao-b', title: 'Edição B' }),
      cartao({ id: 'c', slug: 'edicao-c', title: 'Edição C' }),
    ];

    const markup = html(
      pagina({
        blocks: [blocoDeHistorico],
        events: {
          upcoming: grupo([]),
          ongoing: grupo([]),
          past: grupo(antigos, { total: 3, hasMore: true }),
          total: 3,
          now: new Date('2026-11-10T12:00:00.000Z'),
          timeZone: 'America/Bahia',
        },
      }),
    );

    const secaoDoBloco = markup.slice(
      markup.indexOf('id="edicoes-anteriores"'),
      markup.indexOf('<footer'),
    );

    expect(secaoDoBloco).toContain('Edição A');
    expect(secaoDoBloco).toContain('Edição B');
    /** O TERCEIRO evento antigo existe (está no grupo), e o bloco não o desenha. */
    expect(markup).toContain('Edição C');
    expect(secaoDoBloco).not.toContain('Edição C');

    /** O caminho para o histórico completo fica no bloco. */
    expect(secaoDoBloco).toContain('Ver o histórico completo');

    /** Sem evento antigo nenhum, o bloco não vira uma seção vazia. */
    const semHistorico = html(
      pagina({
        blocks: [blocoDeHistorico],
        events: {
          upcoming: grupo([]),
          ongoing: grupo([]),
          past: grupo([]),
          total: 0,
          now: new Date('2026-11-10T12:00:00.000Z'),
          timeZone: 'America/Bahia',
        },
      }),
    );

    expect(semHistorico).not.toContain('id="edicoes-anteriores"');
  });

  it('o bloco de HTML livre sai como TEXTO — o `<script>` nunca é interpretado', () => {
    const markup = html(
      pagina({
        blocks: [
          bloco({
            id: 'html',
            type: 'CUSTOM_HTML',
            content: { html: '<script>alert(1)</script>' },
          }),
        ],
      }),
    );

    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
  });

  it('desenha os blocos na ORDEM que o domínio entregou, e o tipo sem leitura não vira seção', () => {
    const markup = html(
      pagina({
        blocks: [
          bloco({ id: 'sobre', type: 'ABOUT', content: { body: 'Primeiro.' } }),
          bloco({ id: 'contato', type: 'CONTACT', content: { email: 'casa@exemplo.test' } }),
          bloco({ id: 'equipe', type: 'TEAM', content: {}, displayOrder: 30 }),
        ],
      }),
    );

    expect(markup.indexOf('Primeiro.')).toBeGreaterThan(-1);
    expect(markup.indexOf('Primeiro.')).toBeLessThan(markup.indexOf('casa@exemplo.test'));

    /**
     * `TEAM` não tem de onde ler nesta fatia: ele NÃO desenha uma seção vazia (o que
     * diria ao visitante que a casa não tem equipe). `TENANT_BLOCK_WITHOUT_RENDERER`
     * é quem declara isso para o editor da fatia 3.
     */
    expect(markup).not.toContain('Equipe da instituição');
  });
});

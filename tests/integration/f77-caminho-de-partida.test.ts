/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — O caminho de partida na raiz do evento (FASE 77 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PROVA CENTRAL DA FATIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O guia e o painel são perguntas DIFERENTES na MESMA seção. Este teste renderiza
 *  a página de verdade (servidor + banco, guarda dublada) e prende, no MESMO HTML:
 *
 *    • o guia conta 1 de 3, 2 de 3 e 3 de 3 conforme o evento recebe atividade e
 *      página publicada;
 *    • o painel continua mostrando as pendências DELE — inclusive no caso 3/3, em
 *      que o caminho está completo e ainda falta inscrição;
 *    • no rascunho, o painel diz "Tudo em ordem" e o guia continua mostrando o
 *      caminho: as duas frases convivem porque uma fala de bloqueio e a outra de
 *      começo, e a nota da faixa diz isso em uma linha;
 *    • a faixa está DENTRO da seção de prontidão, acima da lista, e a raiz continua
 *      com as 5 `<section>` e os 17 cartões de antes (não nasceu a 6ª seção);
 *    • a pendência `sem-programacao` virou um link para o cartão da Programação.
 *
 *  O que é substituído: a sessão e a guarda de página (não existem fora de uma
 *  requisição do Next; a autorização tem cobertura própria) e o `next/link` (vira
 *  âncora, para o HTML mostrar o destino). O que NÃO é substituído: `getAdminEvent`,
 *  `getEventAreaCounts` e o render da página — é o caminho real que se quer medir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { EVENT_AREAS, eventAreaTestId } from '../../src/domain/events/event-areas';

const RUN = randomUUID().slice(0, 8);
const TENANT_SLUG = `f77-caminho-${RUN}`;
const TIME_ZONE = 'America/Bahia';

/** O que a guarda devolveria — a instituição do caso e um principal OWNER. */
const guarda = vi.hoisted(() => ({ tenantId: '', userId: '' }));

vi.mock('../../src/lib/auth/guard-page', () => ({
  requirePagePermission: async () => ({
    tenantId: guarda.tenantId,
    tenantName: `Instituição do caminho ${RUN}`,
    userId: guarda.userId,
    principal: {
      userId: guarda.userId,
      tenantId: guarda.tenantId,
      membershipStatus: 'ACTIVE',
      assignments: [{ role: 'OWNER', scope: 'TENANT' }],
    },
    context: null,
  }),
}));

/** Sem sessão: a guarda dublada acima é quem decide o contexto do caso. */
vi.mock('../../src/lib/auth/session', () => ({
  getRequestContext: async () => null,
  getPlatformContext: async () => null,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

/**
 * `next/link` vira âncora — preservando `data-testid` e `className`, que é como o
 * teste localiza cada passo da faixa no HTML.
 */
vi.mock('next/link', () => ({
  default: (props: {
    href: string;
    children?: unknown;
    className?: string;
    target?: string;
    rel?: string;
    'data-testid'?: string;
  }) =>
    createElement(
      'a',
      {
        href: props.href,
        className: props.className,
        target: props.target,
        rel: props.rel,
        'data-testid': props['data-testid'],
      },
      props.children as never,
    ),
}));

const { default: AdminEventDetailPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page'
);

let tenantId: string;
let eventId: string;
let draftId: string;

async function renderizar(id: string): Promise<string> {
  const elemento = (await AdminEventDetailPage({
    params: Promise.resolve({ tenantSlug: TENANT_SLUG, eventId: id }),
  })) as ReactElement;

  return renderToStaticMarkup(elemento);
}

/** O HTML entre dois marcadores — os próprios asserts falham se o marcador sumir. */
function trecho(html: string, inicio: string, fim: string): string {
  const de = html.indexOf(inicio);
  expect(de, `marcador não encontrado: ${inicio}`).toBeGreaterThanOrEqual(0);

  const ate = html.indexOf(fim, de);
  expect(ate, `fechamento não encontrado depois de ${inicio}`).toBeGreaterThan(de);

  return html.slice(de, ate + fim.length);
}

/** O recorte da faixa: o container até o fim do `<ol>` (a lista de pendências é `<ul>`). */
function faixaDePartida(html: string): string {
  return trecho(html, 'data-testid="event-launch-path"', '</ol>');
}

/** O passo, do link até o `</a>`, para ler o estado dele sem olhar os vizinhos. */
function passoDaFaixa(faixa: string, id: string): string {
  return trecho(faixa, `data-testid="event-launch-path-step-${id}"`, '</a>');
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  draftId = randomUUID();
  guarda.tenantId = tenantId;
  guarda.userId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do caminho de partida ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  const startsAt = new Date(Date.now() + 30 * 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 86_400_000);
  const registrationClosesAt = new Date(startsAt.getTime() - 7 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.event.createMany({
      data: [
        {
          id: eventId,
          tenantId,
          slug: `evento-f77-${RUN}`,
          title: `Evento do caminho de partida ${RUN}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: TIME_ZONE,
          startsAt,
          endsAt,
          registrationClosesAt,
          capacity: null,
          confirmedCount: 0,
        },
        {
          /**
           * O rascunho é o caso que o plano mediu: sem atividade, sem página e com
           * prazo — o painel não tem NENHUMA pendência, mas o caminho tem dois passos
           * por dar. É a coexistência sem contradição.
           */
          id: draftId,
          tenantId,
          slug: `evento-f77-rascunho-${RUN}`,
          title: `Rascunho do caminho de partida ${RUN}`,
          status: 'DRAFT',
          modality: 'IN_PERSON',
          timezone: TIME_ZONE,
          startsAt,
          endsAt,
          registrationClosesAt,
          capacity: null,
          confirmedCount: 0,
        },
      ],
    }),
  );
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o caminho de partida na raiz do evento', () => {
  it('evento novo: 1 de 3 — e o painel continua com as pendências dele no MESMO render', async () => {
    const html = await renderizar(eventId);
    const faixa = faixaDePartida(html);

    expect(faixa).toContain('Por onde começar');
    expect(faixa).toContain('1 dos 3 passos de partida foi dado.');

    /** O prazo já foi declarado; a programação e a página ainda não existem. */
    expect(passoDaFaixa(faixa, 'dados-e-prazos')).toContain('concluído');
    expect(passoDaFaixa(faixa, 'programacao')).toContain('a fazer');
    expect(passoDaFaixa(faixa, 'pagina-no-ar')).toContain('a fazer');

    /**
     * A prova da convivência: o guia (1 de 3) e o painel (`sem-programacao`,
     * `sem-inscricao`) aparecem no MESMO HTML, cada um respondendo à sua pergunta.
     */
    expect(html).toContain('data-testid="event-readiness-list"');
    expect(html).toContain('data-testid="event-readiness-sem-programacao"');
    expect(html).toContain('data-testid="event-readiness-sem-inscricao"');
    expect(html).not.toContain('data-testid="event-readiness-ok"');

    /** A nota diz, com todas as letras, por que as duas listas não se contradizem. */
    expect(faixa).toContain(
      'Os passos de partida mostram por onde começar; as pendências dizem o que atrapalha agora.',
    );

    /** O guia não usa a palavra do painel ("pronto" só vive no título da seção). */
    expect(faixa).not.toMatch(/pront[oa]s?/i);

    /**
     * ─────────────────────────────────────────────────────────────────────────
     *  A FAIXA NÃO É A 6ª SEÇÃO
     * ─────────────────────────────────────────────────────────────────────────
     *  A raiz tem 5 `<section>` (prontidão + quatro grupos) e 17 cartões. Uma seção
     *  nova entre a prontidão e o mapa empurraria os cartões de Configurar para
     *  baixo da dobra — e o teste mede o DOM, não a intenção.
     */
    expect((html.match(/<section/g) ?? []).length).toBe(5);
    expect(html).toContain('data-testid="event-areas-CONFIGURAR"');
    expect(html).toContain('data-testid="event-areas-VITRINE"');
    expect(html).toContain('data-testid="event-areas-OPERAR"');
    expect(html).toContain('data-testid="event-areas-RESULTADO"');

    for (const area of EVENT_AREAS) {
      expect(html, `o cartão da área ${area.id} sumiu`).toContain(
        `data-testid="${eventAreaTestId(area)}"`,
      );
    }

    /** A faixa mora DENTRO da seção de prontidão, ACIMA da lista de pendências. */
    const inicioProntidao = html.indexOf('data-testid="event-readiness"');
    const inicioFaixa = html.indexOf('data-testid="event-launch-path"');
    const inicioLista = html.indexOf('data-testid="event-readiness-list"');

    expect(inicioProntidao).toBeGreaterThanOrEqual(0);
    expect(inicioProntidao).toBeLessThan(inicioFaixa);
    expect(inicioFaixa).toBeLessThan(inicioLista);

    /**
     * O LINK MORTO VIROU LINK: a pendência `sem-programacao` agora aponta para o
     * cartão da Programação, que existe no DOM (o título dela é uma âncora para a
     * página /programacao).
     */
    const pendencia = trecho(
      html,
      'data-testid="event-readiness-sem-programacao"',
      '</li>',
    );

    expect(pendencia).toContain(`/administracao/eventos/${eventId}/programacao`);
    expect(pendencia).toContain('<a ');
  });

  it('com uma atividade: 2 de 3 — e a pendência de programação sai do painel', async () => {
    const startsAt = new Date(Date.now() + 30 * 86_400_000);

    await withTenant(tenantId, (tx) =>
      tx.activity.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: `atividade-f77-${RUN}`,
          title: 'Abertura do evento',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
        },
      }),
    );

    const html = await renderizar(eventId);
    const faixa = faixaDePartida(html);

    expect(faixa).toContain('2 dos 3 passos de partida foram dados.');
    expect(passoDaFaixa(faixa, 'dados-e-prazos')).toContain('concluído');
    expect(passoDaFaixa(faixa, 'programacao')).toContain('concluído');
    expect(passoDaFaixa(faixa, 'pagina-no-ar')).toContain('a fazer');

    /** O painel perdeu a pendência que o guia acabou de resolver — e não a inventou. */
    expect(html).not.toContain('data-testid="event-readiness-sem-programacao"');
    expect(html).toContain('data-testid="event-readiness-sem-inscricao"');
  });

  it('com a página publicada: 3 de 3 — e o painel ainda tem o que dizer', async () => {
    await withTenant(tenantId, (tx) =>
      tx.eventPage.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: `principal-f77-${RUN}`,
          title: `Página do evento ${RUN}`,
          isPublished: true,
        },
      }),
    );

    const html = await renderizar(eventId);
    const faixa = faixaDePartida(html);

    expect(faixa).toContain('Os três passos de partida foram dados.');
    for (const step of ['dados-e-prazos', 'programacao', 'pagina-no-ar']) {
      expect(passoDaFaixa(faixa, step)).toContain('concluído');
    }

    /**
     * O caminho está completo e o evento AINDA tem pendência (ninguém se inscreveu).
     * O guia não engole o painel: 3/3 fala dos três passos, não do evento inteiro.
     */
    expect(html).toContain('data-testid="event-readiness-sem-inscricao"');
    expect(html).toContain('data-testid="event-readiness-list"');

    /** Nem no caso 3/3 o guia diz a palavra proibida. */
    expect(faixa).not.toMatch(/pront[oa]s?/i);
    expect(faixa).toContain('Os três passos de partida foram dados.');
  });

  it('rascunho: o painel diz "Tudo em ordem" e a faixa continua mostrando o caminho', async () => {
    const html = await renderizar(draftId);
    const faixa = faixaDePartida(html);

    /**
     * O painel não tem o que acusar num rascunho com prazo — e está certo para a
     * pergunta dele. O caminho, que fala de ir ao ar, continua em 1 de 3. A nota
     * dentro da faixa é o que impede o organizador de ler as duas como contradição.
     */
    expect(html).toContain('data-testid="event-readiness-ok"');
    expect(html).not.toContain('data-testid="event-readiness-list"');

    expect(faixa).toContain('1 dos 3 passos de partida foi dado.');
    expect(faixa).toContain('as pendências dizem o que atrapalha agora');
    expect(faixa).toContain('2. Programação');
    expect(faixa).toContain('3. Página no ar');
    expect(faixa).not.toMatch(/pront[oa]s?/i);
  });
});

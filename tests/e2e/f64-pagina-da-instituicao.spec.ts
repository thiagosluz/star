import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, uniqueEmail } from './helpers';
import {
  publishTenantPublicPage,
  saveTenantPublicPageDraft,
  unpublishTenantPublicPage,
} from '../../src/lib/tenancy/tenant-public-page-write-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A PÁGINA PÚBLICA DA INSTITUIÇÃO (FASE 64 · fatia 2) — `/t/<slug>`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, EM TRÊS CENÁRIOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  (a) **A instituição SEM página publicada continua servindo o que servia.** Este é
 *      requisito de ACEITE, e é o cenário mais fácil de quebrar sem perceber: a raiz
 *      da casa é o endereço que o subdomínio inteiro usa (o Proxy reescreve
 *      `ufba.lvh.me/` para cá). Se ela passasse a exigir página publicada, todo link
 *      para a instituição levaria a um 404 — sem erro de tipo, sem teste vermelho,
 *      até alguém abrir. A prova é explícita: **status 200**, a listagem de eventos e
 *      NENHUM redirect.
 *
 *  (b) **O visitante ANÔNIMO vê a página publicada.** Sem sessão nenhuma, provada
 *      pela lição das fases anteriores: o contexto do navegador não tem cookie de
 *      sessão, e o cabeçalho oferece "Entrar" (e não "Minha área") — o que só
 *      acontece quando o servidor **não** encontrou usuário. Capa, título, descrição
 *      e os três grupos, com os eventos certos por data: um futuro, um em curso e um
 *      que já terminou.
 *
 *  (c) **O "ver todos" leva à listagem** — a lista completa, com paginação, no mesmo
 *      desenho das outras listas do produto. E o número que ele anuncia é o TOTAL do
 *      serviço, não os itens desenhados (a lição da F54).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS INSTITUIÇÕES, UMA POR ASSUNTO (a regra de independência entre casos)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O mesmo dado não pode servir a dois cenários: o caso do "ver todos" precisa que o
 *  grupo "Em breve" tenha MAIS eventos do que o limite, e o caso do anônimo precisa
 *  de contagens exatas que oito eventos quebrariam. Cada assunto tem a sua
 *  instituição, criada no `beforeAll` e usada por UM caso — nenhum caso depende da
 *  ordem, e nenhum lê o que o outro deixou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS FIXTURES DE DATA SÃO RELATIVAS AO AGORA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Em breve · Acontecendo agora · Antigas" é decidido por INSTANTE (a janela
 *  `[início, fim)`, em `tenant-event-groups.ts`). Escrever datas fixas faria o
 *  cenário mentir no dia seguinte: um evento ancorado em 10/11/2026 estaria no
 *  passado quando a suíte rodasse em 2027. Por isso as datas nascem de `Date.now()`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA É PUBLICADA PELO SERVIÇO, NÃO À MÃO NO BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `saveTenantPublicPageDraft` + `publishTenantPublicPage` são os caminhos REAIS da
 *  fatia 1 (validação, trilha e a separação rascunho × publicado). Inserir a linha
 *  com `e2eDb` pularia justamente a régua que a tela lê depois — e um snapshot
 *  gravado à mão poderia ter uma forma que o editor nunca produziria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f64-pagina';

const TITULO_DA_PAGINA = `Instituto de Artes ${RUN_ID}`;
const DESCRICAO_DA_PAGINA = 'A casa das artes, das letras e das ciências humanas.';
const CAPA = 'https://midia.exemplo.test/capa-f64.webp';
const TEXTO_DE_SOBRE = 'Fundada em 1957, a casa reúne nove cursos de graduação.';

const EVENTO_FUTURO = `Congresso de 2027 ${RUN_ID}`;
const EVENTO_EM_CURSO = `Mostra em cartaz ${RUN_ID}`;
const EVENTO_ANTIGO = `Seminário de 2025 ${RUN_ID}`;

const DIA = 86_400_000;

/**
 * As três instituições — uma por assunto.
 *
 * `basica` tem a página publicada e uma agenda de três eventos (um em cada grupo);
 * `movimentada` tem a página com MAIS eventos do que o limite, para o "ver todos"
 * existir; `semPagina` não tem linha nenhuma em `tenant_public_pages`.
 */
let basica: { id: string; slug: string };
let movimentada: { id: string; slug: string };
let semPagina: { id: string; slug: string };
let actorId: string;

async function signUpVia(
  api: APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f64');

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  return { id: user.id, email };
}

/**
 * Cria um evento com a JANELA DE DATAS pedida.
 *
 * O `createEvent` do helper ancora tudo em "daqui a N dias" e é o certo para os
 * outros specs; aqui a janela é o ASSUNTO do teste (é ela que decide o grupo), então
 * o evento nasce por esta função — pelo contexto de instituição, como todo dado de
 * tenant.
 */
async function criarEvento(input: {
  tenantId: string;
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.event.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        slug: input.slug,
        title: input.title,
        summary: 'Evento criado para o E2E da página da instituição.',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: 'America/Bahia',
        city: 'Salvador',
        state: 'BA',
        capacity: null,
        confirmedCount: 0,
        registrationOpensAt: new Date(Date.now() - DIA),
        registrationClosesAt: new Date(Date.now() + 30 * DIA),
      },
    });
  });
}

/** Publica a página de uma instituição pelo caminho real (rascunho e depois publicação). */
async function publicarPagina(input: {
  tenantId: string;
  title: string;
  description: string;
  coverImageUrl: string;
  blocks: { type: string; content: Record<string, unknown> }[];
}): Promise<void> {
  const rascunho = await saveTenantPublicPageDraft({
    tenantId: input.tenantId,
    actorId,
    title: input.title,
    description: input.description,
    coverImageUrl: input.coverImageUrl,
    blocks: input.blocks,
  });

  if (!rascunho.ok) {
    throw new Error(`Falha ao gravar o rascunho da página: ${rascunho.message}`);
  }

  const publicada = await publishTenantPublicPage({ tenantId: input.tenantId, actorId });

  if (!publicada.ok) {
    throw new Error(`Falha ao publicar a página: ${publicada.message}`);
  }
}

/**
 * A PROVA DE QUE NÃO HÁ SESSÃO — pelo cookie, que é o que o servidor lê.
 *
 * O cookie de sessão do Better Auth carrega o nome do produto no próprio nome
 * (`better-auth.session_token` e o prefixo seguro `__Secure-`). Um contexto novo do
 * Playwright nasce vazio, e é esta asserção que impede o teste de medir, sem saber,
 * uma página lida por alguém logado — a confirmação final é a do cabeçalho (o
 * "Entrar" que só existe para quem não está autenticado).
 */
async function provarQueNaoTemSessao(page: Page): Promise<void> {
  const cookies = await page.context().cookies();
  const deSessao = cookies.filter((cookie) =>
    cookie.name.toLowerCase().includes('session_token'),
  );

  expect(
    deSessao.map((cookie) => cookie.name),
    'o cenário do visitante anônimo está com cookie de sessão',
  ).toEqual([]);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const autor = await signUpVia(api, `Autora da Página ${RUN_ID}`);
    actorId = autor.id;

    const agora = Date.now();

    // ── (b) A INSTITUIÇÃO COM A PÁGINA E UMA AGENDA DE TRÊS EVENTOS ─────────────
    const basicaCriada = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Página ${RUN_ID}`,
    });

    basica = { id: basicaCriada.id, slug: basicaCriada.slug };

    await criarEvento({
      tenantId: basica.id,
      slug: `futuro-${RUN_ID}`,
      title: EVENTO_FUTURO,
      startsAt: new Date(agora + 7 * DIA),
      endsAt: new Date(agora + 9 * DIA),
    });

    await criarEvento({
      tenantId: basica.id,
      slug: `em-curso-${RUN_ID}`,
      title: EVENTO_EM_CURSO,
      startsAt: new Date(agora - DIA),
      endsAt: new Date(agora + DIA),
    });

    await criarEvento({
      tenantId: basica.id,
      slug: `antigo-${RUN_ID}`,
      title: EVENTO_ANTIGO,
      startsAt: new Date(agora - 10 * DIA),
      endsAt: new Date(agora - 3 * DIA),
    });

    await publicarPagina({
      tenantId: basica.id,
      title: TITULO_DA_PAGINA,
      description: DESCRICAO_DA_PAGINA,
      coverImageUrl: CAPA,
      blocks: [
        { type: 'ABOUT', content: { title: 'Nossa história', body: TEXTO_DE_SOBRE } },
        { type: 'PAST_EVENTS', content: { title: 'Edições anteriores', limit: 3 } },
      ],
    });

    // ── (c) A INSTITUIÇÃO COM MAIS EVENTOS DO QUE O LIMITE ──────────────────────
    const movimentadaCriada = await createTenant({
      label: `${TENANT_LABEL}-cheia`,
      name: `Instituição Movimentada ${RUN_ID}`,
    });

    movimentada = { id: movimentadaCriada.id, slug: movimentadaCriada.slug };

    for (let indice = 0; indice < 16; indice += 1) {
      await criarEvento({
        tenantId: movimentada.id,
        slug: `extra-${indice}-${RUN_ID}`,
        title: `Oficina extra ${indice} ${RUN_ID}`,
        startsAt: new Date(agora + (12 + indice) * DIA),
        endsAt: new Date(agora + (12 + indice) * DIA + DIA),
      });
    }

    /** Um antigo, para o grupo do histórico existir e NÃO ganhar link. */
    await criarEvento({
      tenantId: movimentada.id,
      slug: `antigo-cheia-${RUN_ID}`,
      title: `Encerrado ${RUN_ID}`,
      startsAt: new Date(agora - 20 * DIA),
      endsAt: new Date(agora - 15 * DIA),
    });

    await publicarPagina({
      tenantId: movimentada.id,
      title: `Instituto Movimentado ${RUN_ID}`,
      description: 'A casa que nunca para.',
      coverImageUrl: CAPA,
      blocks: [{ type: 'ABOUT', content: { body: TEXTO_DE_SOBRE } }],
    });

    // ── (a) A INSTITUIÇÃO SEM PÁGINA NENHUMA ───────────────────────────────────
    const semPaginaCriada = await createTenant({
      label: `${TENANT_LABEL}-sem`,
      name: `Instituição Sem Página ${RUN_ID}`,
    });

    semPagina = { id: semPaginaCriada.id, slug: semPaginaCriada.slug };

    for (const [indice, titulo] of [`Sem página A ${RUN_ID}`, `Sem página B ${RUN_ID}`].entries()) {
      await criarEvento({
        tenantId: semPagina.id,
        slug: `sem-pagina-${indice}-${RUN_ID}`,
        title: titulo,
        startsAt: new Date(agora + (indice + 1) * 10 * DIA),
        endsAt: new Date(agora + (indice + 1) * 10 * DIA + DIA),
      });
    }
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  /**
   * A instituição é dona de tudo o que este arquivo criou (a página e os eventos
   * caem em cascata); a autora da trilha é uma PESSOA e sai por id.
   */
  await e2eDb.tenant.deleteMany({
    where: { id: { in: [basica.id, movimentada.id, semPagina.id] } },
  });

  if (actorId) await e2eDb.user.deleteMany({ where: { id: actorId } });

  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (a) O FALLBACK — a instituição que nunca publicou
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(a) a instituição sem página publicada', () => {
  test('a raiz continua servindo a listagem de eventos — 200, sem redirect', async ({ page }) => {
    const resposta = await page.goto(`/t/${semPagina.slug}`);

    /**
     * O STATUS vem primeiro: sem ele, um 404 que por acaso tivesse o texto certo
     * passaria como sucesso — e "a tela continua no ar" é o requisito.
     */
    expect(resposta?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/t/${semPagina.slug}$`));

    /** A listagem de sempre: o título, a contagem vinda do serviço e dois eventos. */
    await expect(page.getByTestId('tenant-events-fallback')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Eventos' })).toBeVisible();
    await expect(
      page.getByText(`2 eventos disponíveis em Instituição Sem Página ${RUN_ID}.`),
    ).toBeVisible();

    await expect(page.locator('main ul > li')).toHaveCount(2);

    /** E a PÁGINA PERSONALIZADA não aparece: não há nenhuma publicada. */
    await expect(page.getByTestId('tenant-public-page')).toHaveCount(0);

    /** Um `<main>` só (o mesmo portão de landmark das outras telas públicas). */
    await expect(page.locator('main')).toHaveCount(1);
  });

  test('despublicar devolve a raiz à listagem, sem apagar o trabalho', async ({ page }) => {
    /**
     * ── O OUTRO LADO DO REQUISITO ──────────────────────────────────────────────
     *  "Nunca publicada" e "saiu do ar" têm de dar a MESMA resposta ao visitante (o
     *  read model devolve `null` nos dois casos). Este caso despublica a página da
     *  instituição `basica` e a republica no fim: se a raiz passasse a exigir a
     *  página, o visitante veria um 404 num endereço que funcionava ontem.
     */
    const fora = await unpublishTenantPublicPage({ tenantId: basica.id, actorId });

    expect(fora.ok, 'não foi possível despublicar a página da fixture').toBe(true);

    try {
      const resposta = await page.goto(`/t/${basica.slug}`);

      expect(resposta?.status()).toBe(200);
      await expect(page.getByTestId('tenant-events-fallback')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Eventos' })).toBeVisible();
      await expect(page.getByTestId('tenant-public-page')).toHaveCount(0);
    } finally {
      const volta = await publishTenantPublicPage({ tenantId: basica.id, actorId });
      expect(volta.ok, 'não foi possível republicar a página da fixture').toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (b) A PÁGINA PUBLICADA, LIDA POR QUEM NÃO TEM SESSÃO
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(b) o visitante anônimo', () => {
  test('vê capa, título, descrição e os três grupos com os eventos certos', async ({ page }) => {
    await provarQueNaoTemSessao(page);

    const resposta = await page.goto(`/t/${basica.slug}`);

    expect(resposta?.status()).toBe(200);

    /**
     * ── A CONFIRMAÇÃO DE QUE NÃO HÁ SESSÃO ─────────────────────────────────────
     *  O cabeçalho público desenha "Entrar" para quem NÃO está autenticado e "Minha
     *  área" para quem está — e quem decide é o servidor (`getAuthenticatedUser`).
     */
    await expect(page.getByRole('link', { name: 'Entrar' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Minha área' })).toHaveCount(0);

    /** ── A identidade da casa: capa, título e descrição publicados ───────────── */
    await expect(page.getByTestId('tenant-page-cover')).toHaveAttribute('src', CAPA);
    await expect(page.getByTestId('tenant-page-title')).toHaveText(TITULO_DA_PAGINA);
    await expect(page.getByTestId('tenant-page-description')).toHaveText(DESCRICAO_DA_PAGINA);

    /** ── Um `<main>` só: o portão WCAG AA varre exatamente um por tela ───────── */
    await expect(page.locator('main')).toHaveCount(1);

    /** ── Os TRÊS grupos, com o evento certo em cada um ───────────────────────── */
    const emBreve = page.getByTestId('tenant-group-upcoming');
    const acontecendo = page.getByTestId('tenant-group-ongoing');
    const antigos = page.getByTestId('tenant-group-past');

    await expect(emBreve).toContainText('Em breve');
    await expect(acontecendo).toContainText('Acontecendo agora');
    await expect(antigos).toContainText('Edições anteriores');

    await expect(emBreve.getByTestId('tenant-event-card')).toContainText(EVENTO_FUTURO);
    await expect(acontecendo.getByTestId('tenant-event-card')).toContainText(EVENTO_EM_CURSO);
    await expect(antigos.getByTestId('tenant-event-card')).toContainText(EVENTO_ANTIGO);

    /** Cada evento aparece no grupo DELE — e em nenhum outro. */
    await expect(emBreve).not.toContainText(EVENTO_EM_CURSO);
    await expect(emBreve).not.toContainText(EVENTO_ANTIGO);
    await expect(acontecendo).not.toContainText(EVENTO_FUTURO);
    await expect(acontecendo).not.toContainText(EVENTO_ANTIGO);
    await expect(antigos).not.toContainText(EVENTO_FUTURO);

    /**
     * ── O BLOCO `PAST_EVENTS` LÊ NA RENDERIZAÇÃO (ADR-168) ─────────────────────
     *  O bloco guarda só a decoração e o limite (o conteúdo publicado tem
     *  `{ title, limit }` e nenhum evento). O que ele desenha é o que o SISTEMA
     *  conhece agora — a prova é ele mostrar o mesmo evento antigo do grupo, sem
     *  ninguém ter digitado evento nenhum no bloco.
     */
    const blocoAntigos = page.locator('#edicoes-anteriores');

    await expect(blocoAntigos).toContainText(EVENTO_ANTIGO);
    await expect(blocoAntigos).not.toContainText(EVENTO_FUTURO);
    await expect(blocoAntigos).toContainText('Ver o histórico completo');

    /** O bloco `ABOUT` desenha o texto que o organizador escreveu. */
    await expect(page.getByText(TEXTO_DE_SOBRE)).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (c) O "VER TODOS" LEVA À LISTAGEM
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(c) o "ver todos"', () => {
  test('leva à listagem da instituição e anuncia o total do serviço', async ({ page }) => {
    await page.goto(`/t/${movimentada.slug}`);

    const emBreve = page.getByTestId('tenant-group-upcoming');

    /** O limite do grupo recorta a vitrine em seis cartões. */
    await expect(emBreve.getByTestId('tenant-event-card')).toHaveCount(6);
    await expect(emBreve).toContainText(`Oficina extra 0 ${RUN_ID}`);

    /**
     * ── A TELA NÃO RECONTA (LIÇÃO DA F54) ──────────────────────────────────────
     *  O número entre parênteses é o TOTAL do serviço — os dezesseis eventos do grupo
     *  "Em breve" —, e não os seis que foram desenhados. Recontar os cartões diria
     *  "6 no total".
     */
    const verTodos = page.getByTestId('tenant-group-more-upcoming');
    await expect(verTodos).toBeVisible();
    await expect(verTodos).toContainText('16 no total');

    /** Os grupos que não têm mais do que o limite não oferecem link nenhum. */
    await expect(page.getByTestId('tenant-group-more-past')).toHaveCount(0);
    await expect(page.getByTestId('tenant-group-more-ongoing')).toHaveCount(0);

    /** O caminho é a listagem da instituição — e ela existe, com paginação. */
    await verTodos.click();
    await expect(page).toHaveURL(new RegExp(`/t/${movimentada.slug}/eventos$`));

    /**
     * Dezessete eventos públicos (16 futuros + 1 antigo) contra o teto de 12 por
     * página: a listagem pagina de verdade, e a barra aparece.
     */
    await expect(page.getByTestId('events-pagination')).toBeVisible();
    await expect(page.getByTestId('events-page-info')).toContainText(/página 1 de \d+/);

    /** E os eventos extras estão lá — a lista inteira, não só o recorte da vitrine. */
    await expect(page.getByText(`Oficina extra 0 ${RUN_ID}`)).toBeVisible();
  });
});

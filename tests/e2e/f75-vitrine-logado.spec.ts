/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A vitrine da plataforma com sessão (a raiz que deixou de expulsar)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTAVA ERRADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A raiz `/` redirecionava quem tinha sessão: com instituição ativa ia para
 *  `/t/<slug>/dashboard`; autenticada sem vínculo, para `/selecionar-instituicao`.
 *  O endereço público da plataforma — a vitrine, que é justamente o que se mostra a
 *  quem chega de fora — ficava INACESSÍVEL para quem já é da casa, e o logo de
 *  qualquer página jogava a pessoa no painel.
 *
 *  A correção tirou o redirect e deu ao cabeçalho o par que o resto do produto já
 *  usava: com sessão, UM botão "Minha área"; sem sessão, os dois convites ("Entrar" e
 *  "Criar conta"). O destino do botão é o MESMO que o redirect dava.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CASO DA INSTITUIÇÃO ATIVA É O QUE IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Minha área" apontando para o painel parece trivial até alguém trocar o `href`
 *  por `/painel`, `/dashboard` ou `/t/<outro-slug>/dashboard`: a página continuaria
 *  abrindo e nenhum teste de fumaça notaria. Por isso o clique é seguido até a URL E
 *  até o título do painel DAQUELA instituição — o destino é fato, não string.
 *
 *  E o segundo ramo do mesmo redirect (autenticada SEM vínculo) também é medido: a
 *  pessoa que acabou de criar conta não pode ser mandada para "Entrar" nem para um
 *  painel que não existe — o lugar dela continua sendo o seletor de instituição.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PROVA DE QUE NÃO HÁ REDIRECT É A CADEIA VAZIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `page.goto` devolve a resposta do ÚLTIMO salto: um 307 seguido de 200 chegaria
 *  aqui como 200 e o teste passaria medindo outra coisa. Por isso o caso afirma
 *  `redirectedFrom() === null` — é a única asserção que diz "a raiz RESPONDEU", e não
 *  "a raiz terminou em algum lugar".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

/** A instituição da fixture: é o painel dela que o botão deve abrir. */
let tenantSlug: string;
let tenantName: string;
/** A pessoa COM vínculo ativo — o caso do redirect antigo para o painel. */
let comVinculoEmail: string;
/** A pessoa SEM vínculo — o caso do redirect antigo para o seletor de instituição. */
let semVinculoEmail: string;

const ORIGIN = 'http://localhost:3000';

/** Cadastra pela API (o caminho do Better Auth) e devolve o e-mail usado. */
async function signUp(api: APIRequestContext, name: string): Promise<string> {
  const email = `f75.${RUN_ID}.${Math.random().toString(36).slice(2, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGIN },
    data: { name, email, password: PASSWORD },
  });

  expect(response.ok(), `sign-up falhou: HTTP ${response.status()} ${await response.text()}`).toBe(
    true,
  );

  return email;
}

/** Entra de verdade: o cookie de sessão é o que faz a raiz desenhar o outro botão. */
async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: ORIGIN } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGIN },
    data: { email, password: PASSWORD },
  });

  expect(response.ok(), `login falhou para ${email}: HTTP ${response.status()}`).toBe(true);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: 'f75-vitrine',
      name: `Instituição da Vitrine ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    tenantName = tenant.name;

    comVinculoEmail = await signUp(api, 'Pessoa com Vínculo');

    const comVinculo = await e2eDb.user.findUniqueOrThrow({
      where: { email: comVinculoEmail },
      select: { id: true },
    });

    await linkUser({ userId: comVinculo.id, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: comVinculo.id, tenantId: tenant.id, role: 'PARTICIPANT' });

    /**
     * A OUTRA PESSOA NÃO RECEBE VÍNCULO NENHUM — e é isso que ela é.
     *
     * `getRequestContext()` devolve `activeTenant: null` para ela, e o ramo do
     * redirect que existia para este caso mandava ao seletor de instituição. Repetir
     * essa decisão é o que o botão precisa fazer.
     */
    semVinculoEmail = await signUp(api, 'Pessoa sem Vínculo');
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('a vitrine com e sem sessão', () => {
  test('1. anônimo: `/` responde 200 com os dois convites e o conteúdo público', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status(), 'a vitrine não respondeu 200 para o visitante').toBe(200);
    expect(response?.request().redirectedFrom()).toBeNull();

    await expect(page.getByTestId('platform-home-page')).toBeVisible();

    /** Os dois botões de antes, no lugar de sempre. */
    await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Criar conta', exact: true })).toBeVisible();

    /** E nenhum resquício do botão de conta: sem sessão, não há área para abrir. */
    await expect(page.getByRole('link', { name: 'Minha área' })).toHaveCount(0);

    /** O conteúdo público continua sendo o da vitrine (busca e destaques). */
    await expect(page.getByTestId('home-search-form')).toBeVisible();
    await expect(page.getByTestId('featured-events-section')).toBeVisible();
  });

  test('2. logado: `/` responde 200, mostra "Minha área" e esconde os convites', async ({
    page,
  }) => {
    await signInAs(page, comVinculoEmail);

    const response = await page.goto('/');

    /**
     * O `redirectedFrom()` vazio é a prova de que a raiz RESPONDEU — e não de que ela
     * redirecionou para algum lugar que também responde 200. Era exatamente este o
     * defeito: quem estava logado nunca via a vitrine.
     */
    expect(response?.status(), 'a vitrine não respondeu 200 para quem está logado').toBe(200);
    expect(
      response?.request().redirectedFrom(),
      'a raiz ainda redireciona quem tem sessão',
    ).toBeNull();

    await expect(page.getByTestId('platform-home-page')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Minha área' })).toBeVisible();

    /** Quem já entrou não recebe convite para entrar de novo. */
    await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Criar conta', exact: true })).toHaveCount(0);

    /** A vitrine é a MESMA página: o conteúdo público não desapareceu. */
    await expect(page.getByTestId('home-search-form')).toBeVisible();
    await expect(page.getByTestId('featured-events-section')).toBeVisible();
  });

  test('3. o clique em "Minha área" leva ao destino que o redirect dava (o painel da instituição)', async ({
    page,
  }) => {
    await signInAs(page, comVinculoEmail);
    await page.goto('/');

    const botao = page.getByRole('link', { name: 'Minha área' });

    await expect(botao).toBeVisible();

    /**
     * O destino medido é o do redirect antigo: `tenantPath(slug, '/dashboard')`.
     * Afirmado ANTES do clique porque é o `href` que prova o caminho — e DEPOIS,
     * porque um `href` correto com navegação quebrada continuaria errado.
     */
    await expect(botao).toHaveAttribute('href', `/t/${tenantSlug}/dashboard`);

    await botao.click();

    await page.waitForURL((url) => url.pathname === `/t/${tenantSlug}/dashboard`, {
      timeout: 30_000,
    });

    /** E o painel é o DESTA instituição — não um painel qualquer que respondeu. */
    await expect(page.getByRole('heading', { name: `Painel de ${tenantName}` })).toBeVisible();
  });

  test('4. logado sem vínculo: "Minha área" leva ao seletor, não ao login', async ({ page }) => {
    await signInAs(page, semVinculoEmail);
    await page.goto('/');

    const botao = page.getByRole('link', { name: 'Minha área' });

    await expect(botao).toBeVisible();
    await expect(botao).toHaveAttribute('href', '/selecionar-instituicao');

    await botao.click();

    await page.waitForURL((url) => url.pathname === '/selecionar-instituicao', {
      timeout: 30_000,
    });

    /** O caminho para resolver o vínculo — e nunca "Entrar", que ela já fez. */
    await expect(page).not.toHaveURL(/\/login/);
  });
});

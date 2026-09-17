/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Autenticação, tenancy e troca de contexto
 *
 *  Cobre os fluxos críticos da FASE 2 exercitando um NAVEGADOR REAL:
 *    1. cadastro e login pela interface;
 *    2. troca de instituição sem perder a sessão (o requisito central);
 *    3. papéis diferentes por instituição, refletidos na UI;
 *    4. isolamento: sem vínculo, sem acesso — mesmo com cookie forjado;
 *    5. convite pendente não concede contexto (fail-closed);
 *    6. instituição inexistente responde 404.
 *
 *  Pré-requisitos:
 *      docker compose up -d
 *      npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Cadastra um usuário pela interface e devolve o e-mail efetivamente usado. */
async function signUpThroughUi(
  page: import('@playwright/test').Page,
  name = 'Usuário E2E',
): Promise<string> {
  const email = uniqueEmail('e2e');

  await page.goto('/signup');
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar conta' }).click();

  // Sem vínculo, o destino é a página de seleção com o estado vazio.
  await expect(page).toHaveURL(/selecionar-instituicao/);
  return email;
}

/** Atalho: cadastra e devolve o registro do usuário já persistido. */
async function signUpAndLoadUser(
  page: import('@playwright/test').Page,
  name: string,
) {
  const email = await signUpThroughUi(page, name);
  return e2eDb.user.findUniqueOrThrow({ where: { email } });
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('autenticação', () => {
  test('página inicial oferece entrada e cadastro', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /toda a jornada do evento/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar' })).toBeVisible();
  });

  test('cadastro cria conta e leva ao seletor de instituição', async ({ page }) => {
    await signUpThroughUi(page);
    await expect(
      page.getByRole('heading', { name: /nenhuma instituição vinculada/i }),
    ).toBeVisible();
  });

  test('senha curta é rejeitada pela validação do cliente', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Nome completo').fill('Teste Curto');
    await page.getByLabel('E-mail').fill(uniqueEmail('curto'));
    await page.getByLabel('Senha').fill('123');
    await page.getByRole('button', { name: 'Criar conta' }).click();

    // O atributo minLength do input impede o envio; continuamos em /signup.
    await expect(page).toHaveURL(/signup/);
  });

  test('login com credenciais inválidas mostra erro sem revelar detalhes', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(uniqueEmail('naoexiste'));
    await page.getByLabel('Senha').fill('senha-errada-qualquer');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // O Next injeta um <div role="alert"> para anunciar mudanças de rota, então
    // filtramos pelo texto em vez de usar getByRole('alert') diretamente.
    await expect(page.getByText(/incorretos/i)).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('acesso a instituições', () => {
  test('rota de instituição exige autenticação', async ({ page }) => {
    const tenant = await createTenant({
      label: 'auth-guard',
      name: 'Instituição Guard',
    });

    await page.goto(`/t/${tenant.slug}/dashboard`);

    // Sem sessão: redireciona para o login preservando o destino.
    await expect(page).toHaveURL(/login/);
    expect(page.url()).toContain('redirectTo');
  });

  test('instituição inexistente responde 404', async ({ page }) => {
    const response = await page.goto('/t/nao-existe-mesmo-123/dashboard');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: /instituição não encontrada/i }),
    ).toBeVisible();
  });

  test('rota de instituição no domínio raiz sem contexto responde 404', async ({
    page,
  }) => {
    const response = await page.goto('/dashboard');
    expect(response?.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('troca de contexto sem perder a sessão', () => {
  test('troca entre duas instituições mantendo a sessão e mudando os papéis', async ({
    page,
    context,
  }) => {
    // ── Cenário: Ana é ADMIN na instituição A e CHAIR na instituição B ───────
    const tenantA = await createTenant({
      label: 'ctx-a',
      name: `Instituição Alfa ${RUN_ID}`,
    });
    const tenantB = await createTenant({
      label: 'ctx-b',
      name: `Instituição Beta ${RUN_ID}`,
    });

    const user = await signUpAndLoadUser(page, 'Ana Multi Contexto');

    await linkUser({ tenantId: tenantA.id, userId: user.id });
    await linkUser({ tenantId: tenantB.id, userId: user.id });
    await grantRole({ tenantId: tenantA.id, userId: user.id, role: 'ADMIN' });
    await grantRole({ tenantId: tenantB.id, userId: user.id, role: 'CHAIR' });

    // ── Confirma os dois vínculos no seletor ─────────────────────────────────
    await page.goto('/selecionar-instituicao');
    const options = page.getByTestId('tenant-options');
    await expect(options.getByText(tenantA.name)).toBeVisible();
    await expect(options.getByText(tenantB.name)).toBeVisible();

    /**
     * Sem cookie de contexto, a aplicação adota o primeiro vínculo ATIVO como
     * padrão. Por isso a instituição A já aparece como "Contexto atual" — o que
     * também significa que a linha dela não tem botão "Entrar".
     */
    const rowA = options.locator('li', { hasText: tenantA.name });
    await expect(rowA.getByText('Contexto atual')).toBeVisible();

    // Guarda o cookie de sessão para provar que ele NÃO muda na troca.
    const cookiesBefore = await context.cookies();
    const sessionBefore = cookiesBefore.find((c) => c.name.includes('session_token'));
    expect(sessionBefore).toBeDefined();

    // ── Entra na instituição A para carregar o painel ────────────────────────
    await page.goto(`/t/${tenantA.slug}/dashboard`);
    const activeTenant = page.getByTestId('active-tenant');
    await expect(activeTenant).toContainText(tenantA.name);
    await expect(activeTenant).toContainText('ADMIN');

    // ── Troca para a instituição B pelo menu do cabeçalho ────────────────────
    await page.locator('summary').first().click();
    const menuItemB = page.locator('li', { hasText: tenantB.name });
    await menuItemB.getByRole('button').click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenantB.slug}/dashboard`));
    // O papel mudou: agora é CHAIR, não mais ADMIN.
    await expect(activeTenant).toContainText(tenantB.name);
    await expect(activeTenant).toContainText('CHAIR');

    // ── A SESSÃO CONTINUA A MESMA ────────────────────────────────────────────
    // Este é o requisito central: trocar de contexto não é um novo login.
    const cookiesAfter = await context.cookies();
    const sessionAfter = cookiesAfter.find((c) => c.name.includes('session_token'));

    expect(sessionAfter).toBeDefined();
    expect(sessionAfter?.value).toBe(sessionBefore?.value);

    // E o usuário continua autenticado.
    await expect(page.getByRole('button', { name: /sair/i })).toBeVisible();
  });

  test('papéis com escopo de evento aparecem com seu alvo no painel', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'scope-evt',
      name: `Instituição Escopo ${RUN_ID}`,
    });
    const event = await createEvent({
      tenantId: tenant.id,
      slug: 'evento-escopo',
      title: 'Evento com Escopo',
    });

    const user = await signUpAndLoadUser(page, 'Bruno Escopo');

    await linkUser({ tenantId: tenant.id, userId: user.id });
    // Acúmulo de papéis no MESMO evento.
    await grantRole({
      tenantId: tenant.id,
      userId: user.id,
      role: 'ORGANIZER',
      scope: 'EVENT',
      eventId: event.id,
    });
    await grantRole({
      tenantId: tenant.id,
      userId: user.id,
      role: 'REVIEWER',
      scope: 'EVENT',
      eventId: event.id,
    });

    await page.goto(`/t/${tenant.slug}/dashboard`);

    // Ambos os papéis, ambos com o mesmo alvo de evento.
    const roleSummary = page.getByTestId('role-summary');
    await expect(roleSummary.getByText('ORGANIZER')).toBeVisible();
    await expect(roleSummary.getByText('REVIEWER')).toBeVisible();
    await expect(roleSummary.getByText('EVENT').first()).toBeVisible();

    // A permissão de revisão é `:own` — a de organização é ampla.
    const permissionList = page.getByTestId('permissions');
    await expect(permissionList.getByText('submission:decide')).toBeVisible();
    await expect(permissionList.getByText('review:submit:own')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('isolamento entre instituições', () => {
  test('usuário sem vínculo é redirecionado ao seletor, não recebe acesso', async ({
    page,
  }) => {
    const tenantA = await createTenant({
      label: 'iso-a',
      name: `Instituição Iso A ${RUN_ID}`,
    });
    const tenantB = await createTenant({
      label: 'iso-b',
      name: `Instituição Iso B ${RUN_ID}`,
    });

    const user = await signUpAndLoadUser(page, 'Carla Isolada');

    // Vínculo APENAS com A.
    await linkUser({ tenantId: tenantA.id, userId: user.id });
    await grantRole({ tenantId: tenantA.id, userId: user.id, role: 'PARTICIPANT' });

    // Acessa A: funciona.
    await page.goto(`/t/${tenantA.slug}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/t/${tenantA.slug}/dashboard`));
    await expect(page.getByTestId('active-tenant')).toContainText(tenantA.name);

    // Acessa B: NÃO tem vínculo -> volta ao seletor.
    await page.goto(`/t/${tenantB.slug}/dashboard`);
    await expect(page).toHaveURL(/selecionar-instituicao/);
    // E o nome da instituição B não aparece entre as opções disponíveis.
    await expect(
      page.getByTestId('tenant-options').getByText(tenantB.name),
    ).toHaveCount(0);
  });

  test('cookie de contexto adulterado é rejeitado (assinatura HMAC)', async ({
    page,
    context,
  }) => {
    const tenantA = await createTenant({
      label: 'tamper-a',
      name: `Instituição Tamper A ${RUN_ID}`,
    });
    const tenantB = await createTenant({
      label: 'tamper-b',
      name: `Instituição Tamper B ${RUN_ID}`,
    });

    const user = await signUpAndLoadUser(page, 'Usuário Tamper');

    await linkUser({ tenantId: tenantA.id, userId: user.id });
    await grantRole({ tenantId: tenantA.id, userId: user.id, role: 'ADMIN' });

    // Entra legitimamente em A.
    await page.goto(`/t/${tenantA.slug}/dashboard`);
    await expect(page.getByTestId('active-tenant')).toContainText(tenantA.name);

    // ── Ataque: reescreve o cookie de contexto para apontar para B ───────────
    const baseUrl = new URL(page.url());
    await context.addCookies([
      {
        name: 'ef_tenant',
        value: `${tenantB.slug}.assinatura-forjada-invalida`,
        domain: baseUrl.hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    /**
     * Sem assinatura válida o cookie é IGNORADO. O acesso continua sendo ao
     * tenant A — nunca a B.
     *
     * Navegamos pelo caminho canônico de A porque `/dashboard` no domínio raiz
     * é uma rota exclusiva de instituição e responde 404 (o Proxy bloqueia
     * rotas de tenant quando não há instituição no host). Isso é o
     * comportamento correto, não o objeto deste teste.
     */
    await page.goto(`/t/${tenantA.slug}/dashboard`);
    await expect(page.getByTestId('active-tenant')).toContainText(tenantA.name);

    // Prova cabal: o nome de B não aparece em lugar algum da página.
    await expect(page.getByText(tenantB.name)).toHaveCount(0);
    await expect(page).not.toHaveURL(new RegExp(tenantB.slug));
  });

  test('convite pendente não concede contexto operacional (fail-closed)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'invite',
      name: `Instituição Convite ${RUN_ID}`,
    });

    const user = await signUpAndLoadUser(page, 'Convidado Pendente');

    // Vínculo INVITED (convite ainda não aceito) + papel atribuído.
    await linkUser({ tenantId: tenant.id, userId: user.id, status: 'INVITED' });
    await grantRole({ tenantId: tenant.id, userId: user.id, role: 'ORGANIZER' });

    // O convite aparece no seletor, mas não é utilizável.
    await page.goto('/selecionar-instituicao');
    const row = page
      .getByTestId('tenant-options')
      .locator('li', { hasText: tenant.name });
    await expect(row).toBeVisible();
    await expect(row.getByText(/convite pendente/i)).toBeVisible();

    const enterButton = row.getByRole('button', { name: 'Entrar' });
    await expect(enterButton).toBeDisabled();
  });
});

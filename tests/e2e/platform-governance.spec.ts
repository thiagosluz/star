/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Diretório público e governança da plataforma (FASE 9)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS CINCO CENÁRIOS, NA ORDEM EM QUE ACONTECEM NA VIDA REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. quem NÃO é da plataforma não sabe que o painel existe (404, não 403);
 *      2. o SuperAdmin provisiona uma instituição e designa o proprietário;
 *      3. a pessoa designada entra e administra a instituição nova;
 *      4. um visitante anônimo encontra a instituição no diretório e abre a
 *         página pública dela;
 *      5. o SuperAdmin suspende a instituição e o corte vale IMEDIATAMENTE — na
 *         vitrine e no painel, sem esperar cache.
 *
 *  O passo 5 é o que dá sentido aos outros quatro: governança que não corta o
 *  acesso na hora não é governança, é registro de intenção.
 *
 *  A ordem importa e o arquivo roda com UM worker (`fullyParallel: false`): cada
 *  cenário depende do estado deixado pelo anterior — provisionar, usar, bloquear.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, e2eDb, grantPlatformRole } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

/** Endereço da instituição criada pelo painel nesta execução. */
const NEW_TENANT_SLUG = `vitrine-${RUN_ID}`;
const NEW_TENANT_NAME = `Instituto Vitrine ${RUN_ID}`;

const ownerEmail = `f9.owner.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;
const ownerName = `Proprietária do Instituto ${RUN_ID}`;
const superAdminEmail = `f9.super.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;

let ownerId: string;
let superAdminId: string;

/**
 * As contas são criadas no `beforeAll`, e não no primeiro teste.
 *
 * Playwright isola o navegador entre testes, mas NÃO promete o mesmo para o estado
 * do módulo: depender de uma variável atribuída em outro teste cria uma suíte que
 * só passa na ordem em que foi escrita. Aqui cada teste depende apenas do estado
 * durável (banco + estas constantes), nunca de uma variável preenchida por outro.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    ownerId = await signUp(api, ownerName, ownerEmail);
    superAdminId = await signUp(api, `SuperAdmin ${RUN_ID}`, superAdminEmail);

    // A concessão de plataforma é feita no banco: a UI de governança existe, mas
    // quem concede o PRIMEIRO SuperAdmin nunca é a própria UI.
    await grantPlatformRole({ userId: superAdminId });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  // O que o teste criou: a instituição provisionada, os usuários e a trilha.
  const tenants = await e2eDb.tenant.findMany({
    where: { slug: NEW_TENANT_SLUG },
    select: { id: true },
  });

  await e2eDb.auditLog.deleteMany({
    where: { tenantId: null, entityId: { in: tenants.map((tenant) => tenant.id) } },
  });
  await e2eDb.tenant.deleteMany({ where: { slug: NEW_TENANT_SLUG } });

  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUp(api: APIRequestContext, name: string, email: string): Promise<string> {
  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return user.id;
}

async function signInAs(page: Page, email: string): Promise<void> {
  // Múltiplos cadastros no mesmo contexto reutilizariam a sessão anterior.
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('governança da plataforma', () => {
  test('1. o painel de governança não existe para quem não é da plataforma', async ({ page }) => {
    // ── Anônimo: 404, e não 403 (um 403 confirmaria que o painel existe) ─────
    const anonymous = await page.goto('/superadmin');

    expect(anonymous?.status()).toBe(404);
    await expect(page.getByTestId('platform-overview')).toHaveCount(0);

    // ── Usuário comum, autenticado, sem papel de plataforma ──────────────────
    await signInAs(page, ownerEmail);

    const commonUser = await page.goto('/superadmin/tenants');
    expect(commonUser?.status()).toBe(404);

    const metrics = await page.goto('/superadmin/metricas');
    expect(metrics?.status()).toBe(404);
  });

  test('2. o SuperAdmin provisiona a instituição e designa o proprietário', async ({ page }) => {
    await signInAs(page, superAdminEmail);

    const panel = await page.goto('/superadmin/tenants');
    expect(panel?.status()).toBe(200);
    await expect(page.getByTestId('platform-tenants')).toBeVisible();

    const form = page.getByTestId('provision-form');
    await form.getByTestId('provision-name').fill(NEW_TENANT_NAME);
    await form.getByTestId('provision-slug').fill(NEW_TENANT_SLUG);
    await form.getByTestId('provision-plan').selectOption('STARTER');
    await form.getByTestId('provision-owner-email').fill(ownerEmail);
    await form
      .getByTestId('provision-description')
      .fill('Instituição criada pelo teste de governança da plataforma.');
    await form.getByTestId('provision-submit').click();

    await expect(page.getByTestId('provision-feedback')).toContainText(/criada/i, {
      timeout: 30_000,
    });

    // ── O banco confirma o estado inicial: ativa, com dono e papel OWNER ─────
    const tenant = await e2eDb.tenant.findUniqueOrThrow({
      where: { slug: NEW_TENANT_SLUG },
      select: { id: true, status: true, plan: true, isPublic: true, maxEvents: true },
    });

    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.plan).toBe('STARTER');
    expect(tenant.isPublic).toBe(true);
    // Quota herdada do plano STARTER, não zero.
    expect(tenant.maxEvents).toBe(10);

    const membership = await e2eDb.userTenantProfile.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: ownerId },
      select: { status: true },
    });
    expect(membership.status).toBe('ACTIVE');

    const assignment = await e2eDb.roleAssignment.findFirstOrThrow({
      where: { tenantId: tenant.id, userId: ownerId },
      select: { role: true, scope: true },
    });
    expect(assignment).toMatchObject({ role: 'OWNER', scope: 'TENANT' });

    // A instituição nova aparece na listagem do painel.
    await expect(page.getByTestId(`tenant-open-${NEW_TENANT_SLUG}`)).toBeVisible();
  });

  test('3. o proprietário designado administra a instituição nova', async ({ page }) => {
    await signInAs(page, ownerEmail);

    const response = await page.goto(`/t/${NEW_TENANT_SLUG}/administracao`);
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId('admin-stats')).toBeVisible();
    await expect(page.getByTestId('admin-areas')).toBeVisible();

    // O nome da instituição é o que o SuperAdmin registrou no provisionamento.
    await expect(page.getByText(NEW_TENANT_NAME).first()).toBeVisible();
  });

  test('4. o visitante anônimo encontra a instituição no diretório e a abre', async ({ page }) => {
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

    const directory = await page.goto('/organizacoes');
    expect(directory?.status()).toBe(200);
    await expect(page.getByTestId('organizations-directory')).toBeVisible();

    // A busca é por NOME: é o que um visitante tem em mãos.
    await page.getByTestId('directory-search').fill(`Instituto Vitrine ${RUN_ID}`);
    await page.getByTestId('directory-search-submit').click();

    const card = page.locator(`[data-testid="directory-card"][data-tenant-slug="${NEW_TENANT_SLUG}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('directory-card-name')).toContainText(`Instituto Vitrine ${RUN_ID}`);
    await expect(card).toContainText('Instituição criada pelo teste de governança');

    // O card oferece os DOIS endereços da instituição: o caminho e o subdomínio.
    await expect(card.getByTestId('directory-card-subdomain')).toContainText(
      `${NEW_TENANT_SLUG}.lvh.me`,
    );

    // Abrir a página pública não exige login.
    await card.getByTestId('directory-card-open').click();
    await expect(page).toHaveURL(new RegExp(`/t/${NEW_TENANT_SLUG}/eventos`));
    expect((await page.goto(`/t/${NEW_TENANT_SLUG}/eventos`))?.status()).toBe(200);
  });

  test('5. a suspensão corta a vitrine e o painel imediatamente', async ({ page }) => {
    await signInAs(page, superAdminEmail);

    const tenant = await e2eDb.tenant.findUniqueOrThrow({
      where: { slug: NEW_TENANT_SLUG },
      select: { id: true },
    });

    await page.goto(`/superadmin/tenants/${tenant.id}`);
    await expect(page.getByTestId('platform-tenant-detail')).toBeVisible();

    await page
      .getByTestId('suspend-reason')
      .fill('Inadimplência do plano STARTER e ausência de resposta ao suporte.');
    await page.getByTestId('suspend-submit').click();

    await expect(page.getByTestId('tenant-status-feedback')).toContainText(/suspensa/i, {
      timeout: 30_000,
    });

    const suspended = await e2eDb.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
      select: { status: true, suspensionReason: true, suspendedAt: true },
    });

    expect(suspended.status).toBe('SUSPENDED');
    expect(suspended.suspensionReason).toContain('Inadimplência');
    expect(suspended.suspendedAt).not.toBeNull();

    // ── O painel da instituição é cortado (com o motivo na tela) ─────────────
    const blockedPanel = await page.goto(`/t/${NEW_TENANT_SLUG}/administracao`);
    expect(blockedPanel?.status()).toBe(403);
    await expect(page.getByTestId('tenant-blocked')).toBeVisible();
    await expect(page.getByTestId('tenant-blocked')).toContainText(/suspenso/i);
    await expect(page.getByTestId('tenant-blocked')).toContainText('Inadimplência');

    // ── A vitrine pública também, e SEM esperar cache ────────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

    const blockedPublic = await page.goto(`/t/${NEW_TENANT_SLUG}/eventos`);
    expect(blockedPublic?.status()).toBe(403);
    await expect(page.getByTestId('tenant-blocked')).toBeVisible();

    /**
     * O diretório é a prova de que o status NÃO vem de cache: a instituição estava
     * listada minutos antes (cenário 4) e desaparece na primeira requisição após a
     * suspensão.
     */
    await page.goto('/organizacoes');
    await expect(page.getByTestId('organizations-directory')).toBeVisible();
    await expect(
      page.locator(`[data-testid="directory-card"][data-tenant-slug="${NEW_TENANT_SLUG}"]`),
    ).toHaveCount(0);
  });

  test('6. a reativação devolve o acesso', async ({ page }) => {
    await signInAs(page, superAdminEmail);

    const tenant = await e2eDb.tenant.findUniqueOrThrow({
      where: { slug: NEW_TENANT_SLUG },
      select: { id: true },
    });

    await page.goto(`/superadmin/tenants/${tenant.id}`);
    await page.getByTestId('reactivate-submit').click();

    await expect(page.getByTestId('tenant-status-feedback')).toContainText(/reativada/i, {
      timeout: 30_000,
    });

    await signInAs(page, ownerEmail);
    const response = await page.goto(`/t/${NEW_TENANT_SLUG}/administracao`);

    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('admin-stats')).toBeVisible();
  });
});

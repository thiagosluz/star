/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 125 — E2E: Cockpit de Patrocinadores por Intenção, Rotas Dedicadas e Estandes
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  cleanupRun,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  RUN_ID,
  signOut,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'Koveno#2026';
const TENANT_LABEL = 'f125-patrocinadores';

let tenantSlug: string;
let tenantId: string;
let adminEmail: string;
let eventId: string;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f125-${prefix}`);
  const up = await request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!up.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${up.status()} ${await up.text()}`);
  }

  return { email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await signOut(page);
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
  }
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição F125 ${RUN_ID}`,
    });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const admin = await signUpVia(api, 'admin', 'Admin F125');
    adminEmail = admin.email;

    const adminUser = await e2eDb.user.findUniqueOrThrow({
      where: { email: adminEmail },
      select: { id: true },
    });

    await linkUser({ tenantId, userId: adminUser.id });
    await grantRole({ tenantId, userId: adminUser.id, role: 'ADMIN' });

    const event = await e2eDb.event.create({
      data: {
        tenantId,
        slug: `evento-f125-${RUN_ID}`,
        title: `Simpósio F125 ${RUN_ID}`,
        description: 'Evento de teste da FASE 125.',
        status: 'PUBLISHED',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 3 * 86_400_000),
      },
      select: { id: true },
    });
    eventId = event.id;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 125 — Cockpit de Patrocinadores por Abas e Rotas Dedicadas', () => {
  test('navega pelas 3 abas, cria/edita cota e patrocinador em rotas dedicadas e filtra estande com pré-preenchimento', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    const baseUrl = `/t/${tenantSlug}/administracao/eventos/${eventId}/patrocinadores`;
    await page.goto(baseUrl);

    // 1. Faixa executiva + ponte com Financeiro + 3 abas visíveis
    await expect(page.getByTestId('sponsor-kpi-strip')).toBeVisible();
    await expect(page.getByTestId('sponsor-finance-link')).toHaveAttribute(
      'href',
      `/t/${tenantSlug}/administracao/eventos/${eventId}/financeiro`,
    );
    await expect(page.getByTestId('sponsor-tabs')).toBeVisible();
    await expect(page.getByTestId('sponsor-section')).toBeVisible();
    await expect(page.getByTestId('tier-section')).toHaveCount(0);

    // 2. Vai para aba Cotas e cria uma cota em /cotas/nova
    await page.getByTestId('sponsor-tab-cotas').click();
    await expect(page).toHaveURL(/\?aba=cotas$/);
    await expect(page.getByTestId('tier-section')).toBeVisible();

    await page.getByTestId('btn-nova-cota-aba').click();
    await expect(page).toHaveURL(/\/patrocinadores\/cotas\/nova$/);

    const createTier = page.getByTestId('create-tier');
    await createTier.getByLabel('Nome da cota').fill(`Diamante F125 ${RUN_ID}`);
    await createTier.getByLabel('Valor comercial (R$)').fill('12000,00');
    await createTier.getByTestId('tier-style-new-swatch-azul').click();
    await createTier.getByTestId('admin-submit').click();
    await expect(createTier.getByTestId('create-tier-feedback')).toContainText(/cota criada/i, {
      timeout: 20_000,
    });

    // Edita a cota recém-criada em /cotas/[tierId]/editar
    await page.goto(`${baseUrl}?aba=cotas`);
    const tierRow = page.getByTestId('tier-list').locator('li').first();
    const tierTestId = await tierRow.getAttribute('data-testid');
    const tierId = tierTestId?.replace('tier-', '') ?? '';

    await page.getByTestId(`edit-tier-${tierId}`).click();
    await expect(page).toHaveURL(new RegExp(`/patrocinadores/cotas/${tierId}/editar$`));

    const editTier = page.getByTestId(`tier-form-${tierId}`);
    await editTier.getByLabel('Limite de patrocinadores').fill('3');
    await editTier.getByTestId('admin-submit').click();
    await expect(editTier.getByTestId(`tier-form-${tierId}-feedback`)).toContainText(
      /cota atualizada/i,
      { timeout: 20_000 },
    );

    // 3. Cria patrocinador em /novo e edita em /[sponsorId]/editar
    await page.goto(`${baseUrl}/novo`);
    const sponsorName = `Parceiro F125 ${RUN_ID}`;
    const createSponsor = page.getByTestId('create-sponsor');
    await createSponsor.getByLabel('Nome', { exact: true }).fill(sponsorName);
    await createSponsor.getByLabel('Cota', { exact: true }).selectOption(tierId);
    await createSponsor.getByLabel('E-mail do contato', { exact: true }).fill('contato@f125.example.com');
    await createSponsor.getByLabel('Valor do contrato (R$)', { exact: true }).fill('10000,00');
    await createSponsor.getByTestId('admin-submit').click();
    await expect(createSponsor.getByTestId('create-sponsor-feedback')).toContainText(/cadastrado/i, {
      timeout: 20_000,
    });

    await page.goto(baseUrl);
    await expect(page.getByTestId('sponsor-kpi-contracts')).toContainText('10.000,00');

    const sponsorCard = page.getByTestId('sponsor-list').locator('li').filter({ hasText: sponsorName });
    const sponsorId = (await sponsorCard.getAttribute('data-testid'))?.replace('sponsor-', '') ?? '';

    await page.getByTestId(`edit-sponsor-${sponsorId}`).click();
    await expect(page).toHaveURL(new RegExp(`/patrocinadores/${sponsorId}/editar$`));

    const editSponsor = page.getByTestId(`sponsor-form-${sponsorId}`);
    await editSponsor.getByLabel('Valor do contrato (R$)', { exact: true }).fill('15000,00');
    await editSponsor.getByTestId('admin-submit').click();
    await expect(editSponsor.getByTestId(`sponsor-form-${sponsorId}-feedback`)).toContainText(
      /patrocinador atualizado/i,
      { timeout: 20_000 },
    );

    // 4. Confere receita atualizada no KPI e navega pelo atalho Estande & QR
    await page.goto(baseUrl);
    await expect(page.getByTestId('sponsor-kpi-contracts')).toContainText('15.000,00');

    await page.getByTestId(`booth-sponsor-${sponsorId}`).click();
    await expect(page).toHaveURL(new RegExp(`\\?aba=estandes&patrocinador=${sponsorId}$`));
    await expect(page.getByTestId('sponsor-experience-filter-banner')).toContainText(sponsorName);

    // E-mail do contato vem pré-preenchido em Convidar ou vincular pessoa
    await page.getByTestId('sponsor-experience').getByText('Convidar ou vincular pessoa').click();
    await expect(
      page.getByTestId(`sponsor-invite-${sponsorId}`).getByLabel('E-mail do contato'),
    ).toHaveValue('contato@f125.example.com');
  });
});

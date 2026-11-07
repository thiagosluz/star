/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 94 — E2E DA SEPARAÇÃO DO CADASTRO DE PATROCINADOR (/patrocinadores/novo)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Cenário no navegador:
 *    1. O organizador acessa `/administracao/eventos/[eventId]/patrocinadores`:
 *       a tela é um cockpit limpo, sem formulários densos inline de criação ou
 *       cópia misturados no rodapé, exibindo o botão "Novo patrocinador" no PageHeader.
 *    2. Ao clicar em "Novo patrocinador", navega para `/patrocinadores/novo`, que
 *       exibe PageHeader semântico com breadcrumbs de volta e os formulários de
 *       cadastro e cópia encapsulados em cards brancos elevados.
 *    3. Preenche e submete o formulário, recebe feedback de sucesso, e volta
 *       para o cockpit onde o novo patrocinador aparece em card padronizado.
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

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = 'f94-patrocinadores';

let tenantSlug: string;
let tenantId: string;
let adminEmail: string;
let eventId: string;
let tierId: string;
const eventSlug = `evento-f94-${RUN_ID}`;
const sponsorName = `Patrocinador F94 ${RUN_ID}`;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f94-${prefix}`);

  const response = await request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    const up = await request.post('/api/auth/sign-up/email', {
      headers: { origin: 'http://localhost:3000' },
      data: { name, email, password: PASSWORD },
    });
    if (!up.ok()) {
      throw new Error(
        `Falha ao cadastrar ${name}: HTTP ${up.status()} ${await up.text()}`,
      );
    }
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
      name: `Instituição da F94 ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const admin = await signUpVia(api, 'admin', 'Admin da F94');
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
        slug: eventSlug,
        title: `Congresso F94 ${RUN_ID}`,
        description: 'Evento para teste E2E da FASE 94',
        status: 'PUBLISHED',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 3 * 86_400_000),
      },
      select: { id: true },
    });
    eventId = event.id;

    const tier = await e2eDb.sponsorTier.create({
      data: {
        tenantId,
        eventId,
        name: `Cota Ouro ${RUN_ID}`,
        key: 'GOLD',
        rank: 1,
        color: '#FFD700',
        maxSponsors: 5,
        priceCents: 1500000,
        currency: 'BRL',
        description: 'Cota de destaque',
        benefits: ['Logo no site'],
      },
      select: { id: true },
    });
    tierId = tier.id;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 94 — Separação do cadastro de patrocinador (/patrocinadores/novo) e cockpit limpo', () => {
  test('navegação dedicada para /patrocinadores/novo, criação e retorno ao cockpit limpo', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    const sponsorsUrl = `/t/${tenantSlug}/administracao/eventos/${eventId}/patrocinadores`;
    await page.goto(sponsorsUrl);

    // 1. Cockpit limpo: PageHeader com botão primário Novo patrocinador
    await expect(page.getByTestId('sponsor-section')).toBeVisible();
    await expect(page.getByTestId('btn-novo-patrocinador')).toBeVisible();

    // 2. Os formulários antigos de criação e cópia NÃO devem estar presentes no cockpit
    await expect(page.getByTestId('create-sponsor')).toHaveCount(0);
    await expect(page.getByTestId('copy-sponsor-section')).toHaveCount(0);

    // 3. Estado vazio exibindo cartão com link para criar primeiro patrocinador
    await expect(page.getByTestId('empty-sponsors')).toBeVisible();

    // 4. Navegar para a página dedicada de cadastro
    await page.getByTestId('btn-novo-patrocinador').click();
    await expect(page).toHaveURL(new RegExp(`/patrocinadores/novo$`));

    // 5. Na página dedicada: PageHeader, breadcrumbs e containers cards
    await expect(page.getByTestId('new-sponsor-page')).toBeVisible();
    await expect(page.getByTestId('create-sponsor-section')).toBeVisible();
    await expect(page.getByTestId('copy-sponsor-section')).toBeVisible();

    const form = page.getByTestId('create-sponsor');
    await expect(form).toBeVisible();

    // Preenche o formulário
    await form.getByLabel('Nome', { exact: true }).fill(sponsorName);
    await form.getByLabel('Cota', { exact: true }).selectOption(tierId);
    await form.getByLabel('Site', { exact: true }).fill('https://patrocinador-f94.example.com');
    await form.getByLabel('Contato', { exact: true }).fill('Diretoria de Marketing');
    await form.getByLabel('E-mail do contato', { exact: true }).fill('mkt@patrocinador-f94.example.com');
    await form.getByLabel('Valor do contrato (R$)', { exact: true }).fill('15000,00');

    // Submete o formulário
    await form.getByTestId('admin-submit').click();

    // Feedback de criação exibido
    await expect(form.getByTestId('create-sponsor-feedback')).toContainText(/cadastrado/i, {
      timeout: 30_000,
    });

    // 6. Retorna ao cockpit de patrocinadores
    await page.goto(sponsorsUrl);

    // O estado vazio não aparece mais
    await expect(page.getByTestId('empty-sponsors')).toHaveCount(0);

    // O patrocinador recém-criado é listado dentro do cockpit em card destacado
    const sponsorCard = page.getByTestId('sponsor-list').locator('li').filter({ hasText: sponsorName });
    await expect(sponsorCard).toBeVisible();
    await expect(sponsorCard).toContainText(`Cota Ouro ${RUN_ID}`);
    await expect(sponsorCard).toContainText('visível');
  });
});


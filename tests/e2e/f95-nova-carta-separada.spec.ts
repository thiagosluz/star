/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 95 — E2E DA SEPARAÇÃO DO CADASTRO DE CARTAS (/cartas/nova)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Cenário no navegador:
 *    1. O organizador acessa `/administracao/cartas`:
 *       a tela é um cockpit limpo, sem formulário denso inline de criação no rodapé,
 *       exibindo o botão "Nova carta" no PageHeader e o empty state com CTA.
 *    2. Ao clicar em "Nova carta", navega para `/cartas/nova`, que exibe PageHeader
 *       semântico com breadcrumbs de volta e o formulário de 26 campos estruturado
 *       em card branco elevado.
 *    3. Preenche e submete o formulário, recebe feedback de sucesso, e volta
 *       para o cockpit onde a nova carta colecionável aparece em card branco elevado.
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
const TENANT_LABEL = 'f95-cartas';

let tenantSlug: string;
let tenantId: string;
let adminEmail: string;

const cardSlug = `carta-f95-${RUN_ID}`;
const cardName = `Guardiã Cósmica ${RUN_ID}`;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f95-${prefix}`);

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
      name: `Instituição da F95 ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const admin = await signUpVia(api, 'admin', 'Admin da F95');
    adminEmail = admin.email;

    const adminUser = await e2eDb.user.findUniqueOrThrow({
      where: { email: adminEmail },
      select: { id: true },
    });

    await linkUser({ tenantId, userId: adminUser.id });
    await grantRole({ tenantId, userId: adminUser.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 95 — Separação do cadastro de cartas colecionáveis (/cartas/nova) e cockpit limpo', () => {
  test('navegação dedicada para /cartas/nova, criação estruturada e retorno ao cockpit limpo', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    const cardsUrl = `/t/${tenantSlug}/administracao/cartas`;
    const novaCartaUrl = `/t/${tenantSlug}/administracao/cartas/nova`;

    // 1. Acessa o cockpit de cartas
    await page.goto(cardsUrl);

    // 2. Verifica a presença do botão primário "Nova carta" no cabeçalho
    const btnNovaCarta = page.getByTestId('btn-nova-carta');
    await expect(btnNovaCarta).toBeVisible();
    await expect(btnNovaCarta).toHaveAttribute('href', novaCartaUrl);

    // 3. Confirma que o cockpit NÃO possui o formulário denso inline no rodapé
    await expect(page.getByTestId('create-card')).toHaveCount(0);
    await expect(page.getByTestId('create-card-section')).toHaveCount(0);

    // 4. Catálogo inicialmente vazio com empty state estilizado e CTA
    await expect(page.getByTestId('cards-empty')).toBeVisible();
    await expect(page.getByTestId('btn-empty-nova-carta')).toBeVisible();

    // 5. Clica no botão para abrir a nova tela de criação
    await btnNovaCarta.click();
    await expect(page).toHaveURL(new RegExp(novaCartaUrl));

    // 6. Validações da página dedicada
    await expect(page.getByTestId('link-voltar-cartas')).toBeVisible();
    await expect(page.getByTestId('create-card-section')).toBeVisible();

    const form = page.getByTestId('create-card');
    await expect(form).toBeVisible();

    // Preenche o formulário estruturado
    await form.getByLabel('Identificador', { exact: true }).fill(cardSlug);
    await form.getByLabel('Nome', { exact: true }).fill(cardName);
    await form.getByLabel('Descrição', { exact: true }).fill('Concedida aos pioneiros do evento');
    await form.getByLabel('História (lore)', { exact: true }).fill('Uma entidade ancestral observando os avanços tecnológicos.');
    await form.getByLabel('Raridade', { exact: true }).selectOption('RARE');
    await form.getByLabel('Gatilho', { exact: true }).selectOption('CHECKIN');
    await form.getByLabel('Nível mínimo', { exact: true }).fill('2');
    await form.getByLabel('Tiragem (0 = ilimitada)', { exact: true }).fill('50');

    // Submete o formulário
    await form.getByTestId('admin-submit').click();

    // Feedback de criação exibido
    await expect(page.getByTestId('create-card-feedback')).toContainText(/carta criada/i, {
      timeout: 30_000,
    });

    // 7. Retorna ao cockpit de cartas
    await page.goto(cardsUrl);

    // O estado vazio não aparece mais
    await expect(page.getByTestId('cards-empty')).toHaveCount(0);

    // A carta recém-criada é listada no grid de cards com seus metadados
    const cardItem = page.getByTestId('admin-card-list').locator('li').filter({ hasText: cardName });
    await expect(cardItem).toBeVisible();
    await expect(cardItem).toContainText('Rara');
    await expect(cardItem).toContainText('Credenciamento');
    await expect(cardItem).toContainText('tiragem 0/50');
    await expect(cardItem).toContainText('ativa');
  });
});

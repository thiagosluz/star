/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 96 — E2E DA EDIÇÃO DEDICADA DE CARTAS (/cartas/[cardId]/editar) E BUSCA
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Cenário no navegador:
 *    1. O organizador cria uma carta e acessa `/administracao/cartas`:
 *       o card do catálogo traz link dedicado `card-edit-<id>` para
 *       `/administracao/cartas/<id>/editar` (sem `<details>` de 26 campos inline).
 *    2. Ao clicar em `Editar`, navega para `/administracao/cartas/<id>/editar`,
 *       altera nome e raridade na rota dedicada, recebe feedback de sucesso e
 *       retorna pelo breadcrumb `link-voltar-cartas` vendo os dados atualizados.
 *    3. Na seção de concessão manual (`grant-card-section`), filtra participantes
 *       por nome/e-mail via `?participante=` (`grant-participant-search`) e concede
 *       um exemplar à participante filtrada.
 *    4. Acessar `/administracao/cartas/<uuid-inexistente>/editar` responde 404.
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
const TENANT_LABEL = 'f96-cartas';

let tenantSlug: string;
let tenantId: string;
let adminEmail: string;

const cardSlug = `carta-f96-${RUN_ID}`;
const initialCardName = `Sentinela Inicial ${RUN_ID}`;
const updatedCardName = `Sentinela Lendária ${RUN_ID}`;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f96-${prefix}`);

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
      name: `Instituição da F96 ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const admin = await signUpVia(api, 'admin', 'Admin da F96');
    adminEmail = admin.email;

    const alice = await signUpVia(api, 'alice', `Alice Filtrada ${RUN_ID}`);
    const bruno = await signUpVia(api, 'bruno', `Bruno Outro ${RUN_ID}`);

    const [adminUser, aliceUser, brunoUser] = await Promise.all([
      e2eDb.user.findUniqueOrThrow({ where: { email: adminEmail }, select: { id: true } }),
      e2eDb.user.findUniqueOrThrow({ where: { email: alice.email }, select: { id: true } }),
      e2eDb.user.findUniqueOrThrow({ where: { email: bruno.email }, select: { id: true } }),
    ]);

    await linkUser({ tenantId, userId: adminUser.id });
    await grantRole({ tenantId, userId: adminUser.id, role: 'ADMIN' });

    await linkUser({ tenantId, userId: aliceUser.id, kind: 'PARTICIPANT' });
    await linkUser({ tenantId, userId: brunoUser.id, kind: 'PARTICIPANT' });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 96 — Edição dedicada (/cartas/[cardId]/editar) e busca de participante na concessão', () => {
  test('edita carta em rota dedicada, filtra participante na concessão e responde 404 para carta inexistente', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    const cardsUrl = `/t/${tenantSlug}/administracao/cartas`;
    const novaCartaUrl = `/t/${tenantSlug}/administracao/cartas/nova`;

    // 1. Cria uma carta na rota dedicada /cartas/nova
    await page.goto(novaCartaUrl);
    const createForm = page.getByTestId('create-card');
    await createForm.getByLabel('Identificador', { exact: true }).fill(cardSlug);
    await createForm.getByLabel('Nome', { exact: true }).fill(initialCardName);
    await createForm.getByLabel('Descrição', { exact: true }).fill('Descrição inicial da carta');
    await createForm.getByLabel('Raridade', { exact: true }).selectOption('COMMON');
    await createForm.getByLabel('Gatilho', { exact: true }).selectOption('CHECKIN');
    await createForm.getByTestId('admin-submit').click();

    await expect(page.getByTestId('create-card-feedback')).toContainText(/carta criada/i, {
      timeout: 30_000,
    });

    // 2. Abre o cockpit de cartas e localiza o link de edição dedicada
    await page.goto(cardsUrl);
    const cardItem = page.getByTestId('admin-card-list').locator('li').filter({ hasText: initialCardName });
    await expect(cardItem).toBeVisible();

    const editLink = cardItem.locator('[data-testid^="card-edit-"]');
    const editTestId = await editLink.getAttribute('data-testid');
    expect(editTestId).toBeTruthy();
    const cardId = editTestId!.replace('card-edit-', '');

    await expect(editLink).toHaveAttribute(
      'href',
      `/t/${tenantSlug}/administracao/cartas/${cardId}/editar`,
    );

    // 3. Navega para a rota dedicada de edição (/cartas/[cardId]/editar)
    await editLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/cartas/${cardId}/editar$`),
    );
    await expect(page.getByTestId('edit-card-section')).toBeVisible();

    const editForm = page.getByTestId(`card-form-${cardId}`);
    await expect(editForm).toBeVisible();
    await editForm.getByLabel('Nome', { exact: true }).fill(updatedCardName);
    await editForm.getByLabel('Raridade', { exact: true }).selectOption('LEGENDARY');
    await editForm.getByTestId('admin-submit').click();

    await expect(page.getByTestId(`card-form-${cardId}-feedback`)).toContainText(
      /carta atualizada/i,
      { timeout: 30_000 },
    );

    // 4. Retorna pelo breadcrumb ao cockpit e verifica os dados atualizados
    await page.getByTestId('link-voltar-cartas').click();
    await expect(page).toHaveURL(new RegExp(`${cardsUrl}$`));

    const updatedItem = page
      .getByTestId('admin-card-list')
      .locator('li')
      .filter({ hasText: updatedCardName });
    await expect(updatedItem).toBeVisible();
    await expect(updatedItem).toContainText('Lendária');

    // 5. Filtra participante na seção de concessão manual via ?participante=
    const searchForm = page.getByTestId('grant-participant-search');
    await expect(searchForm).toBeVisible();
    await searchForm.locator('input[name="participante"]').fill('Alice Filtrada');
    await searchForm.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/participante=Alice\+Filtrada/);

    const grantSelect = page.getByTestId('grant-card').getByLabel('Participante');
    await expect(grantSelect).toContainText('Alice Filtrada');
    await expect(grantSelect).not.toContainText('Bruno Outro');

    // 6. Rota de edição com UUID inexistente responde 404 uniforme
    const missingResponse = await page.goto(
      `/t/${tenantSlug}/administracao/cartas/00000000-0000-4000-8000-000000000000/editar`,
    );
    expect(missingResponse?.status()).toBe(404);
  });
});


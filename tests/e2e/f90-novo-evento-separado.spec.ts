/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 90 — E2E DA SEPARAÇÃO DO CADASTRO DE EVENTO (/eventos/novo)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Cenário no navegador:
 *    1. O organizador acessa `/administracao/eventos`: a tela é limpa, sem o
 *       formulário de criação misturado com a lista, e exibe o botão "Novo evento".
 *    2. Ao clicar em "Novo evento", navega para `/administracao/eventos/novo`,
 *       que exibe PageHeader semântico com volta para Eventos e o formulário
 *       `create-event` focado.
 *    3. Preenche e submete o formulário, recebe feedback de sucesso, e volta
 *       pelo link do PageHeader para a listagem onde o novo evento aparece.
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
const TENANT_LABEL = 'f90-eventos';

let tenantSlug: string;
let adminEmail: string;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f90-${prefix}`);

  const response = await request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(
      `Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`,
    );
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
      name: `Instituição da F90 ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;

    const admin = await signUpVia(api, 'admin', 'Admin da F90');
    const adminRow = await e2eDb.user.findUniqueOrThrow({
      where: { email: admin.email },
      select: { id: true },
    });
    await linkUser({ userId: adminRow.id, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: adminRow.id, tenantId: tenant.id, role: 'OWNER', scope: 'TENANT' });
    adminEmail = admin.email;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 90 · Separação do cadastro de evento (/eventos/novo) e listagem (/eventos)', () => {
  test('navegação entre acervo e cadastro dedicado com criação de evento', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    // 1. Acessa a listagem
    const rListagem = await page.goto(`/t/${tenantSlug}/administracao/eventos`);
    expect(rListagem?.status()).toBe(200);

    const btnNovo = page.getByTestId('btn-novo-evento');
    await expect(btnNovo).toBeVisible();
    await expect(btnNovo).toHaveText(/Novo evento/);

    // O formulário de criação NÃO deve existir na listagem
    await expect(page.getByTestId('create-event')).toHaveCount(0);

    // 2. Clica no botão e vai para a rota dedicada
    await btnNovo.click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/administracao/eventos/novo$`));

    // 3. A página de criação tem PageHeader com volta para Eventos
    const linkVoltar = page.getByRole('link', { name: /voltar para eventos/i });
    await expect(linkVoltar).toBeVisible();

    // 4. O formulário está presente e funcional
    const formNovo = page.getByTestId('create-event');
    await expect(formNovo).toBeVisible();

    const eventSlug = `simposio-${RUN_ID}`;
    const eventTitle = `Simpósio Internacional ${RUN_ID}`;

    await formNovo.getByLabel('Identificador (URL)').fill(eventSlug);
    await formNovo.getByLabel('Título').fill(eventTitle);
    await formNovo.getByLabel('Resumo').fill('Resumo do simpósio cadastrado na tela dedicada da F90.');
    await formNovo.getByLabel('Início').fill('2027-06-15T09:00');
    await formNovo.getByLabel('Término').fill('2027-06-15T18:00');
    await formNovo.getByLabel('Situação').selectOption('DRAFT');

    await formNovo.getByTestId('admin-submit').click();

    await expect(formNovo.getByTestId('create-event-feedback')).toContainText(/criado/i, {
      timeout: 30_000,
    });

    // 5. Retorna para a listagem pela volta do PageHeader
    await linkVoltar.click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/administracao/eventos$`));

    // 6. O evento recém-criado aparece na lista de eventos com link de gerenciar
    const listaEventos = page.getByTestId('admin-event-list');
    await expect(listaEventos).toBeVisible();
    await expect(listaEventos).toContainText(eventTitle);

    const linkGerenciar = page.getByTestId(`manage-${eventSlug}`);
    await expect(linkGerenciar).toBeVisible();
  });
});


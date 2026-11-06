/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 93 — E2E DA SEPARAÇÃO DO CADASTRO DE CHAMADA (/chamadas/nova)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Cenário no navegador:
 *    1. O organizador acessa `/administracao/eventos/[eventId]/chamadas`: a tela
 *       é um cockpit limpo, sem o formulário de cadastro de 11 campos e rubrica
 *       misturado no topo, exibindo o botão "Nova chamada" no PageHeader.
 *    2. Ao clicar em "Nova chamada", navega para `/chamadas/nova`, que exibe
 *       PageHeader semântico com breadcrumbs de volta para chamadas e o
 *       formulário `create-call` encapsulado no card branco padrão da plataforma.
 *    3. Preenche e submete o formulário, recebe feedback de sucesso, e volta
 *       para a listagem onde a nova chamada aparece em card destacado.
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
const TENANT_LABEL = 'f93-chamadas';

let tenantSlug: string;
let tenantId: string;
let adminEmail: string;
let eventId: string;
const eventSlug = `evento-f93-${RUN_ID}`;
const callSlug = `palestras-f93-${RUN_ID}`;
const callTitle = `Chamada de Palestras ${RUN_ID}`;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f93-${prefix}`);

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

function localInput(daysFromNow: number, hour: number): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  date.setHours(hour, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
      name: `Instituição da F93 ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const admin = await signUpVia(api, 'admin', 'Admin da F93');
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
        title: `Congresso F93 ${RUN_ID}`,
        description: 'Evento para teste E2E da FASE 93',
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

test.describe('FASE 93 — Separação do cadastro de chamada (/chamadas/nova) e cockpit limpo', () => {
  test('navegação dedicada para /chamadas/nova, criação e retorno ao cockpit limpo', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    const callsUrl = `/t/${tenantSlug}/administracao/eventos/${eventId}/chamadas`;
    await page.goto(callsUrl);

    // 1. Cockpit limpo: PageHeader com botão primário Nova chamada
    await expect(page.getByTestId('calls-panel')).toBeVisible();
    await expect(page.getByTestId('btn-nova-chamada')).toBeVisible();

    // 2. O formulário aninhado antigo NÃO deve estar presente no cockpit
    await expect(page.getByTestId('create-call-section')).toHaveCount(0);
    await expect(page.getByTestId('create-call')).toHaveCount(0);

    // 3. Estado vazio exibindo cartão com link para criar primeira chamada
    await expect(page.getByTestId('calls-empty')).toBeVisible();

    // 4. Navegar para a página dedicada de cadastro
    await page.getByTestId('btn-nova-chamada').click();
    await expect(page).toHaveURL(new RegExp(`/chamadas/nova$`));

    // 5. Na página dedicada: PageHeader, breadcrumb e container card com formulário
    await expect(page.getByTestId('new-call-page')).toBeVisible();
    await expect(page.getByTestId('create-call-section')).toBeVisible();

    const form = page.getByTestId('create-call');
    await expect(form).toBeVisible();

    // Preenche o cadastro
    await form.getByLabel('Tipo de proposta').selectOption('SPEAKER');
    await form.getByLabel('Identificador na URL').fill(callSlug);
    await form.getByLabel('Título da chamada').fill(callTitle);
    await form.getByLabel('Resumo').fill('Chamada de propostas para palestrantes convidados.');
    await form.getByLabel('Abre em').fill(localInput(-1, 8));
    await form.getByLabel('Encerra em').fill(localInput(20, 23));

    // Submete o formulário
    await form.getByTestId('admin-submit').click();

    // Feedback de criação exibido
    await expect(form.getByTestId('create-call-feedback')).toContainText(/criad/i, {
      timeout: 30_000,
    });

    // 6. Retorna ao cockpit de chamadas
    await page.goto(callsUrl);

    // O estado vazio não aparece mais
    await expect(page.getByTestId('calls-empty')).toHaveCount(0);

    // A chamada recém-criada é listada dentro do cockpit
    const callRow = page.locator(`[data-testid^="call-row-"]`).filter({ hasText: callTitle });
    await expect(callRow).toBeVisible();
    await expect(callRow).toContainText('Rascunho');
  });
});

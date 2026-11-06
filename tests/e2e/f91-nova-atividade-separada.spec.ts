/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 91 — E2E DA SEPARAÇÃO DO CADASTRO DE ATIVIDADE (/programacao/nova)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Cenário no navegador:
 *    1. O organizador acessa `/administracao/eventos/[eventId]/programacao`: a tela
 *       é um cockpit limpo, sem o formulário de cadastro misturado no rodapé,
 *       exibindo o botão "Nova atividade" no PageHeader.
 *    2. Ao clicar em "Nova atividade", navega para `/programacao/nova`, que exibe
 *       PageHeader semântico com breadcrumbs de volta para a Programação e o
 *       formulário `create-activity` encapsulado no card padrão da plataforma.
 *    3. Preenche e submete o formulário, recebe feedback de sucesso, e volta
 *       pelo breadcrumb para a listagem onde a nova atividade aparece.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';
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
const TENANT_LABEL = 'f91-atividades';

let tenantSlug: string;
let tenantId: string;
let adminEmail: string;
let eventId: string;
const eventSlug = `evento-f91-${RUN_ID}`;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f91-${prefix}`);

  const response = await request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  // Se não existir, tenta sign-up
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
      name: `Instituição da F91 ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const admin = await signUpVia(api, 'admin', 'Admin da F91');
    const adminRow = await e2eDb.user.findUniqueOrThrow({
      where: { email: admin.email },
      select: { id: true },
    });
    await linkUser({ userId: adminRow.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: adminRow.id, tenantId, role: 'OWNER', scope: 'TENANT' });
    adminEmail = admin.email;

    eventId = randomUUID();
    const startsAt = new Date(Date.now() + 10 * 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 2 * 86_400_000);

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: eventSlug,
          title: `Congresso F91 ${RUN_ID}`,
          status: 'DRAFT',
          modality: 'IN_PERSON',
          startsAt,
          endsAt,
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          capacity: null,
          confirmedCount: 0,
        },
      });
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 91 · Separação do cadastro de atividade (/programacao/nova) e cockpit limpo (/programacao)', () => {
  test('navegação entre cockpit de programação e cadastro dedicado de atividade', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    // 1. Acessa a página de programação do evento
    const rProgramacao = await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/programacao`);
    expect(rProgramacao?.status()).toBe(200);

    // Botão de nova atividade está presente no slot actions
    const btnNova = page.getByTestId('btn-nova-atividade');
    await expect(btnNova).toBeVisible();
    await expect(btnNova).toHaveText(/Nova atividade/);

    // O formulário create-activity NÃO deve estar presente no cockpit
    await expect(page.getByTestId('create-activity')).toHaveCount(0);

    // Estado vazio oferece link para cadastrar a primeira atividade
    const emptyState = page.getByTestId('activities-empty');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(/Cadastrar a primeira atividade/i);

    // 2. Clica no botão "Nova atividade" e navega para /programacao/nova
    await btnNova.click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/eventos/${eventId}/programacao/nova$`),
    );

    // 3. A página de criação tem PageHeader semântico com breadcrumbs
    await expect(page.getByTestId('new-activity-page')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Cadastrar nova atividade/i);

    // O formulário está dentro de um card com h2 semântico
    await expect(page.getByRole('heading', { level: 2, name: /dados da atividade/i })).toBeVisible();
    const formNova = page.getByTestId('create-activity');
    await expect(formNova).toBeVisible();

    // 4. Preenche os dados da atividade
    const activitySlug = `abertura-${RUN_ID}`;
    const activityTitle = `Palestra Magna de Abertura ${RUN_ID}`;

    await formNova.getByLabel('Identificador').fill(activitySlug);
    await formNova.getByLabel('Título').fill(activityTitle);
    await formNova.getByLabel('Tipo').selectOption('LECTURE');
    await formNova.getByLabel('Início').fill(localInput(11, 9));
    await formNova.getByLabel('Término').fill(localInput(11, 11));
    await formNova.getByLabel('Carga horária (min)').fill('90');
    await formNova.getByLabel('Vagas').fill('150');

    await formNova.getByTestId('admin-submit').click();

    await expect(formNova.getByTestId('create-activity-feedback')).toContainText(/criada/i, {
      timeout: 30_000,
    });

    // 5. Retorna para a programação pelo breadcrumb
    const linkProgramacao = page.getByRole('link', { name: 'Programação', exact: true });
    await expect(linkProgramacao).toBeVisible();
    await linkProgramacao.click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/eventos/${eventId}/programacao$`),
    );

    // 6. A atividade recém-criada aparece na listagem do cockpit
    const listaAtividades = page.getByTestId('activity-list');
    await expect(listaAtividades).toBeVisible();
    await expect(listaAtividades).toContainText(activityTitle);
    await expect(listaAtividades).toContainText('90 min');
  });
});


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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — FASE 97: Unificação de Missões e Palestrantes, loading.tsx e Pós-Criação
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Prova no navegador real:
 *    1. Criação dedicada de missão (`/administracao/missoes/nova`) + banner de
 *       confirmação com botão "Ver missões" (`create-mission-back-link`) e toast
 *       flutuante (`create-mission-toast`) + edição dedicada em
 *       `/administracao/missoes/[missionId]/editar` + retorno ao cockpit limpo.
 *    2. Cadastro dedicado de palestrante (`/administracao/eventos/[eventId]/palestrantes/novo`)
 *       + banner de confirmação (`speaker-form-back-link`) e toast (`speaker-form-toast`)
 *       + retorno à listagem `/palestrantes`.
 *    3. Status HTTP 404 real preservado em `/administracao/missoes/<uuid-inexistente>/editar`
 *       e `/administracao/missoes/id-invalido/editar` mesmo com `loading.tsx` ativo
 *       nos layouts autenticados (`htmlLimitedBots` universal, ADR-410).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = 'f97-missoes-palestrantes';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let adminEmail: string;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f97-${prefix}`);

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
      name: `Instituição F97 ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;
    eventId = randomUUID();

    const admin = await signUpVia(api, 'admin', 'Admin F97');
    adminEmail = admin.email;

    const adminUser = await e2eDb.user.findUniqueOrThrow({
      where: { email: adminEmail },
      select: { id: true },
    });

    await linkUser({ tenantId, userId: adminUser.id });
    await grantRole({ tenantId, userId: adminUser.id, role: 'ADMIN' });

    await e2eDb.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `congresso-f97-${RUN_ID}`,
        title: `Congresso F97 ${RUN_ID}`,
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date('2026-10-10T12:00:00.000Z'),
        endsAt: new Date('2026-10-12T20:00:00.000Z'),
      },
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 97 — Missões, Palestrantes, loading.tsx e Pós-Criação', () => {
  test('1. fluxo completo de missão (/nova e /[missionId]/editar), palestrante (/novo), toast + back-link e 404 real sob loading.tsx', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    // ── 1. Missões: cockpit -> /missoes/nova -> criar -> back-link -> /[missionId]/editar ──
    await page.goto(`/t/${tenantSlug}/administracao/missoes`);
    await expect(page.getByTestId('btn-nova-missao')).toBeVisible();
    await page.getByTestId('btn-nova-missao').click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/administracao/missoes/nova$`));
    await expect(page.getByTestId('create-mission-section')).toBeVisible();

    const createMissionForm = page.getByTestId('create-mission');
    await createMissionForm.getByLabel('Identificador').fill(`missao-f97-${RUN_ID}`);
    await createMissionForm.getByLabel('Nome').fill('Missão Trilha Científica');
    await createMissionForm.getByLabel('Recompensa em XP').fill('80');
    await createMissionForm.getByTestId('admin-submit').click();

    await expect(page.getByTestId('create-mission-feedback')).toContainText(/missão criada/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('create-mission-back-link')).toBeVisible();
    await expect(page.getByTestId('create-mission-toast')).toBeVisible();

    await page.getByTestId('create-mission-back-link').click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/administracao/missoes$`));

    const createdMission = await e2eDb.taskDefinition.findFirstOrThrow({
      where: { tenantId, slug: `missao-f97-${RUN_ID}` },
      select: { id: true },
    });

    await expect(page.getByTestId(`admin-mission-${createdMission.id}`)).toContainText(
      'Missão Trilha Científica',
    );

    // Navegar para a rota dedicada de edição da missão
    await page.getByTestId(`mission-edit-${createdMission.id}`).click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/missoes/${createdMission.id}/editar$`),
    );
    await expect(page.getByTestId('edit-mission-section')).toBeVisible();

    const editMissionForm = page.getByTestId(`mission-form-${createdMission.id}`);
    await editMissionForm.getByLabel('Nome').fill('Missão Trilha Científica (Editada)');
    await editMissionForm.getByTestId('admin-submit').click();

    await expect(page.getByTestId(`mission-form-${createdMission.id}-feedback`)).toContainText(
      /atualizada/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId(`mission-form-${createdMission.id}-back-link`)).toBeVisible();
    await expect(page.getByTestId(`mission-form-${createdMission.id}-toast`)).toBeVisible();

    await page.getByTestId(`mission-form-${createdMission.id}-back-link`).click();
    await expect(page.getByTestId(`admin-mission-${createdMission.id}`)).toContainText(
      'Missão Trilha Científica (Editada)',
    );

    // ── 2. Palestrantes: cockpit -> /palestrantes/novo -> criar -> back-link ──
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/palestrantes`);
    await expect(page.getByTestId('btn-novo-palestrante')).toBeVisible();
    await page.getByTestId('btn-novo-palestrante').click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/eventos/${eventId}/palestrantes/novo$`),
    );
    await expect(page.getByTestId('create-speaker-section')).toBeVisible();

    const speakerForm = page.getByTestId('speaker-form');
    await speakerForm.getByTestId('speaker-name').fill(`Palestrante F97 ${RUN_ID}`);
    await speakerForm.getByTestId('speaker-institution').fill('UFBA');
    await page.getByTestId('save-speaker').click();

    await expect(page.getByTestId('admin-speaker-feedback')).toContainText(/cadastrad/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('speaker-form-back-link')).toBeVisible();
    await expect(page.getByTestId('speaker-form-toast')).toBeVisible();

    await page.getByTestId('speaker-form-back-link').click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/eventos/${eventId}/palestrantes$`),
    );
    await expect(page.getByTestId('speaker-list')).toContainText(`Palestrante F97 ${RUN_ID}`);

    // ── 3. Status HTTP 404 real preservado com loading.tsx + htmlLimitedBots ──
    const respInexistente = await page.goto(
      `/t/${tenantSlug}/administracao/missoes/${randomUUID()}/editar`,
    );
    expect(respInexistente?.status()).toBe(404);

    const respMalformado = await page.goto(
      `/t/${tenantSlug}/administracao/missoes/id-invalido/editar`,
    );
    expect(respMalformado?.status()).toBe(404);
  });
});

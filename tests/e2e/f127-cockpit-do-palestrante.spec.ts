/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 127 — E2E: Cockpit do Palestrante por Intenção, Abas e Limpeza de Link
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  RUN_ID,
  signOut,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'Koveno#2026';
const TENANT_LABEL = 'f127-palestrante';

let tenantSlug: string;
let tenantId: string;
let speakerEmail: string;
let eventId: string;
let activityId: string;
let speakerProfileId: string;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail(`f127-${prefix}`);
  const up = await request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!up.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${up.status()} ${await up.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { id: user.id, email };
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
      name: `Instituição F127 ${RUN_ID}`,
    });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const speaker = await signUpVia(api, 'speaker', 'Profa. Helena F127');
    speakerEmail = speaker.email;

    await linkUser({ tenantId, userId: speaker.id, kind: 'PARTICIPANT' });

    const event = await createEvent({
      tenantId,
      slug: `evento-f127-${RUN_ID}`,
      title: `Congresso F127 ${RUN_ID}`,
      status: 'PUBLISHED',
    });
    eventId = event.id;

    const room = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.room.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          name: 'Auditório Central F127',
          capacity: 120,
        },
        select: { id: true },
      });
    });

    const activity = await createActivity({
      tenantId,
      eventId,
      slug: `palestra-f127-${RUN_ID}`,
      title: 'Arquitetura Moderna com Next.js 16',
      workloadMinutes: 90,
      roomId: room.id,
    });
    activityId = activity.id;

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const spkId = randomUUID();
      speakerProfileId = spkId;

      await tx.speakerProfile.create({
        data: {
          id: spkId,
          tenantId,
          userId: speaker.id,
          name: 'Profa. Helena F127',
          email: speakerEmail,
          institution: 'UFBA',
          bio: 'Pesquisadora em arquitetura web.',
          isConfirmed: true,
          isPublic: true,
        },
      });

      await tx.activitySpeaker.create({
        data: {
          id: randomUUID(),
          tenantId,
          activityId,
          speakerProfileId: spkId,
          userId: speaker.id,
          roleTitle: 'Keynote',
          isKeynote: true,
          workloadMinutes: 90,
        },
      });
    });

    await grantRole({
      tenantId,
      userId: speaker.id,
      role: 'SPEAKER',
      scope: 'ACTIVITY',
      eventId,
      activityId,
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 127 · Cockpit do Palestrante por Intenção', () => {
  test('exibe faixa executiva de KPIs, navega pelas abas, mostra sala e limpa URL após enviar link externo', async ({
    page,
  }) => {
    await signInAs(page, speakerEmail);
    await page.goto(`/t/${tenantSlug}/palestrante`);

    await expect(page.getByTestId('speaker-portal-kpis')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('speaker-kpi-profile')).toContainText('50%');
    await expect(page.getByTestId('speaker-kpi-activities')).toContainText('1');
    await expect(page.getByTestId('speaker-kpi-activities')).toContainText('1h30');
    await expect(page.getByTestId('speaker-kpi-materials')).toContainText('0');
    await expect(page.getByTestId('speaker-kpi-certificates')).toContainText('Aguardando');

    await expect(page.getByTestId('speaker-portal-tabs')).toBeVisible();

    const activityCard = page.getByTestId(`portal-activity-${activityId}`);
    await expect(activityCard).toContainText('Auditório Central F127');
    await expect(page.getByTestId(`portal-activity-public-${activityId}`)).toBeVisible();

    // Navega para a aba focada em Atividades & materiais (esconde o formulário de perfil)
    await page.getByTestId('speaker-tab-atividades').click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/palestrante\\?aba=atividades$`));
    await expect(page.getByTestId(`speaker-profile-form-${speakerProfileId}`)).toHaveCount(0);
    await expect(activityCard).toBeVisible();

    // Publica um link externo e valida limpeza automática do input
    const uploader = page.getByTestId(`material-uploader-${activityId}`);
    await uploader.getByLabel('Título do material').fill('Repositório de exemplos');
    await uploader.getByLabel('Ou aponte um link externo').fill('https://github.com/vercel/next.js');
    await page.getByTestId(`send-material-link-${activityId}`).click();

    await expect(page.getByTestId(`portal-materials-${activityId}`)).toContainText(
      'Repositório de exemplos',
      { timeout: 30_000 },
    );
    await expect(uploader.getByLabel('Ou aponte um link externo')).toHaveValue('');
    await expect(page.getByTestId('speaker-kpi-materials')).toContainText('1');

    // Navega para a aba de Perfil Público e Certificados
    await page.getByTestId('speaker-tab-perfil').click();
    await expect(page.getByTestId(`speaker-profile-form-${speakerProfileId}`)).toBeVisible();
    await expect(page.getByTestId(`portal-activity-${activityId}`)).toHaveCount(0);

    await page.getByTestId('speaker-tab-certificados').click();
    await expect(page.getByTestId(`speaker-certificate-${eventId}`)).toBeVisible();
    await expect(page.getByTestId(`speaker-profile-form-${speakerProfileId}`)).toHaveCount(0);
  });
});

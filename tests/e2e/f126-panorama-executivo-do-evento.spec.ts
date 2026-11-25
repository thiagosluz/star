/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 126 — E2E: Panorama Executivo e Painel Gráfico na Raiz do Evento
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
const TENANT_LABEL = 'f126-panorama-evento';

let tenantSlug: string;
let tenantId: string;
let adminEmail: string;
let eventId: string;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail(`f126-${prefix}`);
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
      name: `Instituição F126 ${RUN_ID}`,
    });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const admin = await signUpVia(api, 'admin', 'Admin F126');
    const participantA = await signUpVia(api, 'part-a', 'Participante A F126');
    const participantB = await signUpVia(api, 'part-b', 'Participante B F126');
    adminEmail = admin.email;

    await linkUser({ tenantId, userId: admin.id });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });
    await linkUser({ tenantId, userId: participantA.id, kind: 'PARTICIPANT' });
    await linkUser({ tenantId, userId: participantB.id, kind: 'PARTICIPANT' });

    const event = await createEvent({
      tenantId,
      slug: `evento-f126-${RUN_ID}`,
      title: `Congresso Executivo F126 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      capacity: 50,
    });
    eventId = event.id;

    const workshop = await createActivity({
      tenantId,
      eventId,
      slug: `oficina-f126-${RUN_ID}`,
      title: 'Oficina Prática de Arquitetura',
      type: 'WORKSHOP',
      capacity: 20,
      requiresRegistration: true,
    });

    await createActivity({
      tenantId,
      eventId,
      slug: `abertura-f126-${RUN_ID}`,
      title: 'Mesa de Abertura',
      type: 'LECTURE',
      capacity: null,
      requiresRegistration: false,
    });

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.activity.update({
        where: { id: workshop.id },
        data: { confirmedCount: 15 },
      });

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: null,
          userId: participantA.id,
          status: 'ATTENDED',
        },
      });

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: null,
          userId: participantB.id,
          status: 'CONFIRMED',
        },
      });

      await tx.event.update({
        where: { id: eventId },
        data: { confirmedCount: 2 },
      });

      await tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: participantA.id,
          status: 'PRESENT',
          source: 'MANUAL_STAFF',
          checkedInAt: new Date(),
          minutesAttended: 90,
        },
      });

      const sourceId = randomUUID();
      await tx.eventFundingSource.create({
        data: {
          id: sourceId,
          tenantId,
          eventId,
          name: 'Edital Fomento F126',
          kind: 'PUBLIC_GRANT',
          approvedCents: 1_000_000,
        },
      });

      await tx.eventFinancialEntry.createMany({
        data: [
          {
            id: randomUUID(),
            tenantId,
            eventId,
            sourceId,
            type: 'INCOME',
            status: 'SETTLED',
            category: 'GRANT_DISBURSEMENT',
            title: 'Repasse inicial edital',
            amountCents: 500_000,
            occurredOn: '2026-11-10',
            settledOn: '2026-11-11',
          },
          {
            id: randomUUID(),
            tenantId,
            eventId,
            sourceId,
            type: 'EXPENSE',
            status: 'SETTLED',
            category: 'CATERING',
            title: 'Coffee break credenciado',
            amountCents: 150_000,
            occurredOn: '2026-11-12',
            settledOn: '2026-11-12',
          },
        ],
      });
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 126 · Panorama Executivo e Painel Gráfico na Raiz do Evento', () => {
  test('exibe os 4 KPIs executivos, os 3 gráficos SSR e navega para /financeiro mantendo a raiz limpa', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}`);

    const overviewPanel = page.getByTestId('event-overview-panel');
    await expect(overviewPanel).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('event-kpi-registrations')).toContainText('2');
    await expect(page.getByTestId('event-kpi-registrations')).toContainText('4% ocupado');
    await expect(page.getByTestId('event-kpi-attendance')).toContainText('50%');
    await expect(page.getByTestId('event-kpi-attendance')).toContainText('1 presente(s)');
    await expect(page.getByTestId('event-kpi-academic')).toBeVisible();
    await expect(page.getByTestId('event-kpi-finance')).toContainText('3.500,00');

    const funnel = page.getByTestId('event-chart-funnel');
    await expect(funnel).toBeVisible();
    await expect(funnel).toContainText('Presentes');
    await expect(funnel).toContainText('1 (50%)');

    const activitiesChart = page.getByTestId('event-chart-activities');
    await expect(activitiesChart).toBeVisible();
    await expect(activitiesChart).toContainText('Oficina Prática de Arquitetura');
    await expect(activitiesChart).toContainText('15/20 (75%)');

    const pulseChart = page.getByTestId('event-chart-pulse');
    await expect(pulseChart).toBeVisible();
    await expect(pulseChart).toContainText('Teto aprovado');
    await expect(pulseChart).toContainText('10.000,00');

    await expect(page.getByTestId('event-readiness')).toBeVisible();
    await expect(page.getByTestId('event-areas-CONFIGURAR')).toBeVisible();
    await expect(page.locator('main details')).toHaveCount(0);

    await page.getByTestId('event-overview-finance-link').click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/eventos/${eventId}/financeiro`),
    );
  });
});

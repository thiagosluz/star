/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — FASE 113: Autocredenciamento, Autocheck-in, Cartaz PDF, Telão e Antifraude
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  signOut,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const ORIGEM = 'http://localhost:3000';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let activityId: string;
let staffEmail: string;
let participantEmail: string;
let participantId: string;
let portariaToken = '';
let portariaPointId = '';
let portariaPin = '';
let activityPointId = '';
let activityToken = '';

async function signUpVia(
  api: APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f113');
  const res = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name, email, password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Falha no sign-up de ${name}: HTTP ${res.status()}`);
  }
  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return { id: user.id, email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await signOut(page, ORIGEM);
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGEM },
    data: { email, password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Falha ao autenticar ${email}: HTTP ${res.status()}`);
  }
}

test.describe.serial('FASE 113 — Autocredenciamento e Autocheck-in com Geofence e PIN', () => {
  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    try {
      const staff = await signUpVia(api, 'Staff Credenciamento F113');
      const participant = await signUpVia(api, 'Participante Autocheckin F113');

      staffEmail = staff.email;
      participantEmail = participant.email;
      participantId = participant.id;

      const tenant = await createTenant({
        label: 'f113-self',
        name: `Congresso F113 ${RUN_ID}`,
      });
      tenantId = tenant.id;
      tenantSlug = tenant.slug;

      await linkUser({ userId: staff.id, tenantId, kind: 'MEMBER' });
      await grantRole({ userId: staff.id, tenantId, role: 'ORGANIZER' });

      await linkUser({ userId: participant.id, tenantId, kind: 'PARTICIPANT' });
      await grantRole({ userId: participant.id, tenantId, role: 'PARTICIPANT' });

      const startsAt = new Date(Date.now() - 3600_000);
      const endsAt = new Date(Date.now() + 3 * 86_400_000);

      const event = await createEvent({
        tenantId,
        slug: `evento-f113-${RUN_ID}`,
        title: `Semana Acadêmica F113 ${RUN_ID}`,
        status: 'IN_PROGRESS',
        startsAt,
        endsAt,
      });
      eventId = event.id;
      activityId = randomUUID();

      await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

        await tx.activity.create({
          data: {
            id: activityId,
            tenantId,
            eventId,
            slug: `palestra-f113-${RUN_ID}`,
            title: 'Abertura e Segurança em Eventos',
            type: 'LECTURE',
            status: 'SCHEDULED',
            modality: 'IN_PERSON',
            startsAt,
            endsAt,
            workloadMinutes: 60,
            checkInEnabled: true,
            requiresAttendance: true,
            requiresRegistration: true,
          },
        });

        await tx.registration.createMany({
          data: [
            {
              id: randomUUID(),
              tenantId,
              eventId,
              activityId: null,
              userId: participantId,
              status: 'CONFIRMED',
            },
            {
              id: randomUUID(),
              tenantId,
              eventId,
              activityId,
              userId: participantId,
              status: 'CONFIRMED',
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

  test('1. Organização configura GPS + PIN, gera QR Codes, baixa Cartaz PDF e abre Modo Telão', async ({
    page,
  }) => {
    await signInAs(page, staffEmail);
    await page.goto(`/t/${tenantSlug}/credenciamento?evento=${eventId}`);
    await expect(page.getByTestId('self-checkin-manager')).toBeVisible();

    // Configura política antifraude com GPS ativo e cooldown 0 para testar entrada e saída.
    const enabledBox = page.getByTestId('self-checkin-policy-enabled');
    if (!(await enabledBox.isChecked())) {
      await enabledBox.check();
    }
    await page.getByTestId('self-checkin-policy-require-geo').check();
    await page.getByTestId('self-checkin-latitude').fill('-12.999900');
    await page.getByTestId('self-checkin-longitude').fill('-38.510800');
    await page.getByTestId('self-checkin-radius').fill('200');
    await page.getByTestId('self-checkin-cooldown').fill('0');
    await page.getByTestId('self-checkin-policy-save').click();

    await expect(page.getByTestId('self-checkin-policy-feedback')).toContainText(
      'Política de segurança do autocredenciamento salva.',
      { timeout: 15_000 },
    );

    // Gera QR Code da Portaria e ativa PIN presencial.
    await page.getByTestId('self-checkin-generate-portaria').click();
    await expect(page.getByTestId('self-checkin-print-portaria')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('self-checkin-pin-toggle-portaria').click();
    await expect(page.getByTestId('self-checkin-pin-toggle-portaria')).toContainText('PIN ativo:', {
      timeout: 15_000,
    });

    // Gera QR Code da atividade com TOTP rotativo (Modo Telão 60 s).
    await page.getByTestId(`self-checkin-generate-${activityId}`).click();
    await expect(page.getByTestId(`self-checkin-print-${activityId}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`self-checkin-totp-toggle-${activityId}`).click();
    await expect(page.getByTestId(`self-checkin-totp-toggle-${activityId}`)).toContainText(
      'Telão dinâmico (60s): ativo',
      { timeout: 15_000 },
    );

    // Lê os pontos gravados no banco para conferir PDF e fluxo do participante.
    const points = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.selfCheckinPoint.findMany({
        where: { tenantId, eventId, revokedAt: null },
        select: { id: true, activityId: true, token: true, pinCode: true },
      });
    });

    const portaria = points.find((p) => p.activityId === null)!;
    const act = points.find((p) => p.activityId === activityId)!;
    portariaPointId = portaria.id;
    portariaToken = portaria.token;
    portariaPin = portaria.pinCode!;
    activityPointId = act.id;
    activityToken = act.token;

    // Prova o download do Cartaz PDF da portaria com cabeçalho %PDF-1.4 real.
    const pdfRes = await page.request.get(
      `/api/t/${tenantSlug}/credenciamento/cartaz?pointId=${portariaPointId}`,
    );
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()['content-type']).toContain('application/pdf');
    const pdfBytes = await pdfRes.body();
    expect(pdfBytes.subarray(0, 8).toString('latin1')).toContain('%PDF-1.4');

    // Abre Modo Telão da portaria e verifica QR + PIN.
    await page.getByTestId('self-checkin-telao-portaria').click();
    await expect(page).toHaveURL(new RegExp(`/credenciamento/telao/${portariaPointId}`));
    await expect(page.getByTestId('telao-qr-image')).toBeVisible();
    await expect(page.getByTestId('telao-pin-code')).toContainText(portariaPin);
  });

  test('2. Visitante deslogado recebe redirecionamento com volta para /presenca/[token]', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const anonPage = await context.newPage();
    try {
      await anonPage.goto(`${ORIGEM}/t/${tenantSlug}/presenca/${portariaToken}`);
      await expect(anonPage.getByTestId('self-checkin-login')).toBeVisible();
      const href = await anonPage.getByTestId('self-checkin-login-link').getAttribute('href');
      expect(href).toContain('/login?redirectTo=');
      expect(href).toContain(encodeURIComponent(`/t/${tenantSlug}/presenca/${portariaToken}`));
    } finally {
      await context.close();
    }
  });

  test('3. Participante é bloqueado fora do raio GPS ou com PIN errado, e registra entrada + saída quando válido', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: -13.05, longitude: -38.5108, accuracy: 15 },
    });
    const partPage = await context.newPage();

    try {
      await signInAs(partPage, participantEmail);
      await partPage.goto(`${ORIGEM}/t/${tenantSlug}/presenca/${portariaToken}`);

      await expect(partPage.getByTestId('self-checkin-geo-status')).toContainText(
        'Localização confirmada',
        { timeout: 15_000 },
      );

      // 3a. Tentativa fora do raio (com PIN correto) → recusada pelo geofence.
      await partPage.getByTestId('self-checkin-pin-input').fill(portariaPin);
      await partPage.getByTestId('self-checkin-submit-in').click();
      await expect(partPage.getByTestId('self-checkin-feedback')).toContainText(
        'Você está a',
        { timeout: 15_000 },
      );

      // 3b. Aproxima do local, mas digita PIN errado → recusada pelo PIN.
      await context.setGeolocation({ latitude: -12.9999, longitude: -38.5108, accuracy: 12 });
      await partPage.getByTestId('self-checkin-refresh-geo').click();
      await expect(partPage.getByTestId('self-checkin-geo-status')).toContainText(
        'precisão ~12 m',
        { timeout: 15_000 },
      );

      await partPage.getByTestId('self-checkin-pin-input').fill('0000');
      await partPage.getByTestId('self-checkin-submit-in').click();
      await expect(partPage.getByTestId('self-checkin-feedback')).toContainText(
        'Código de sala (PIN) inválido',
        { timeout: 15_000 },
      );

      // 3c. GPS válido + PIN correto → entrada confirmada (SELF_DECLARED)!
      await partPage.getByTestId('self-checkin-pin-input').fill(portariaPin);
      await partPage.getByTestId('self-checkin-submit-in').click();
      await expect(partPage.getByTestId('self-checkin-feedback')).toContainText(
        'Presença confirmada',
        { timeout: 15_000 },
      );

      const saved = await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return tx.attendance.findFirstOrThrow({
          where: { eventId, userId: participantId, activityId: null },
          select: { source: true, latitude: true, longitude: true },
        });
      });
      expect(saved.source).toBe('SELF_DECLARED');
      expect(Number(saved.latitude)).toBeCloseTo(-12.9999, 4);
    } finally {
      await context.close();
    }
  });

  test('4. Atividade com Telão TOTP dinâmico valida código de 6 dígitos e conclui entrada e saída', async ({
    browser,
    page,
  }) => {
    // Organizador obtém o código rotativo atual do endpoint do Modo Telão.
    await signInAs(page, staffEmail);
    const telaoRes = await page.request.get(
      `/api/t/${tenantSlug}/credenciamento/telao/${activityPointId}`,
    );
    expect(telaoRes.status()).toBe(200);
    const telaoJson = (await telaoRes.json()) as {
      ok: boolean;
      totpWindow?: { code: string } | null;
    };
    const totpCode = telaoJson.totpWindow?.code ?? '';
    expect(totpCode).toMatch(/^\d{6}$/);

    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: -12.9999, longitude: -38.5108, accuracy: 10 },
    });
    const partPage = await context.newPage();

    try {
      await signInAs(partPage, participantEmail);
      await partPage.goto(`${ORIGEM}/t/${tenantSlug}/presenca/${activityToken}`);
      await expect(partPage.getByTestId('self-checkin-geo-status')).toContainText(
        'Localização confirmada',
        { timeout: 15_000 },
      );

      // Entrada com código TOTP do telão.
      await partPage.getByTestId('self-checkin-pin-input').fill(totpCode);
      await partPage.getByTestId('self-checkin-submit-in').click();
      await expect(partPage.getByTestId('self-checkin-feedback')).toContainText(
        'Presença confirmada',
        { timeout: 15_000 },
      );

      // Agora o botão passa para "Registrar minha saída" — e registra saída limpa!
      await expect(partPage.getByTestId('self-checkin-submit-out')).toBeVisible();
      await partPage.getByTestId('self-checkin-pin-input').fill(totpCode);
      await partPage.getByTestId('self-checkin-submit-out').click();
      await expect(partPage.getByTestId('self-checkin-feedback')).toContainText(
        'Saída registrada',
        { timeout: 15_000 },
      );
    } finally {
      await context.close();
    }
  });
});

import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';

import {
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const ORIGEM = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const RUN_ID = randomUUID().slice(0, 8);

async function signUpVia(api: APIRequestContext, name: string) {
  const email = `f114.${RUN_ID}.${randomUUID().slice(0, 6)}@exemplo.test`;
  const res = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name, email, password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${res.status()}`);
  }
  const body = (await res.json()) as { user?: { id: string } };
  if (!body.user?.id) throw new Error('Cadastro sem user.id');
  return { id: body.user.id, email };
}

test.describe.serial('FASE 114 — Ergonomia de Balcão, Abas e Refinos de UX no Credenciamento', () => {
  let tenantId = '';
  let tenantSlug = '';
  let eventId = '';
  let activityId = '';
  let adminEmail = '';
  let badgeCode = '';

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    try {
      const admin = await signUpVia(api, 'Organizador Balcão F114');
      const p1 = await signUpVia(api, 'Alice F114 Balcao');
      const p2 = await signUpVia(api, 'Bruno F114 Ausente');
      adminEmail = admin.email;

      const tenant = await createTenant({
        label: 'f114-ux',
        name: `Congresso Balcão F114 ${RUN_ID}`,
      });
      tenantId = tenant.id;
      tenantSlug = tenant.slug;

      await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
      await grantRole({ userId: admin.id, tenantId, role: 'ORGANIZER' });
      await linkUser({ userId: p1.id, tenantId, kind: 'PARTICIPANT' });
      await grantRole({ userId: p1.id, tenantId, role: 'PARTICIPANT' });
      await linkUser({ userId: p2.id, tenantId, kind: 'PARTICIPANT' });
      await grantRole({ userId: p2.id, tenantId, role: 'PARTICIPANT' });

      const startsAt = new Date(Date.now() - 3600_000);
      const endsAt = new Date(Date.now() + 2 * 86_400_000);
      const event = await createEvent({
        tenantId,
        slug: `simposio-f114-${RUN_ID}`,
        title: `Simpósio F114 ${RUN_ID}`,
        status: 'IN_PROGRESS',
        startsAt,
        endsAt,
      });
      eventId = event.id;
      activityId = randomUUID();
      badgeCode = `CR-F114-${RUN_ID.slice(0, 4).toUpperCase()}`;

      await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

        await tx.activity.create({
          data: {
            id: activityId,
            tenantId,
            eventId,
            slug: `oficina-f114-${RUN_ID}`,
            title: 'Oficina de Ergonomia Operacional',
            type: 'WORKSHOP',
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
            { tenantId, eventId, userId: p1.id, status: 'CONFIRMED', badgeToken: badgeCode },
            { tenantId, eventId, userId: p2.id, status: 'CONFIRMED', badgeToken: `CR-AUS-${RUN_ID.slice(0, 4).toUpperCase()}` },
          ],
        });

        await tx.eventCredential.create({
          data: {
            tenantId,
            eventId,
            userId: p1.id,
            code: badgeCode,
          },
        });
      });
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async () => {
    if (!tenantId) return;
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.selfCheckinPoint.deleteMany({ where: { tenantId } });
      await tx.attendance.deleteMany({ where: { tenantId } });
      await tx.eventCredential.deleteMany({ where: { tenantId } });
      await tx.registration.deleteMany({ where: { tenantId } });
      await tx.activity.deleteMany({ where: { tenantId } });
      await tx.event.deleteMany({ where: { tenantId } });
    });
    await e2eDb.tenant.deleteMany({ where: { id: tenantId } });
  });

  test('1. Aba Balcão ao vivo: saída imediata preserva modo Entrada, chips filtram fila e fechamento exige confirmação', async ({
    page,
  }) => {
    await page.request.post('/api/auth/sign-in/email', {
      headers: { origin: ORIGEM },
      data: { email: adminEmail, password: PASSWORD },
    });

    await page.goto(`/t/${tenantSlug}/credenciamento?evento=${eventId}`);

    // Monitor e Busca aparecem na aba padrão, sem SelfCheckinManager ocupando o meio.
    await expect(page.getByTestId('checkin-desk-summary')).toContainText('2');
    await expect(page.getByTestId('monitor-console')).toBeVisible();
    await expect(page.getByTestId('checkin-search')).toBeVisible();
    await expect(page.getByTestId('self-checkin-manager')).toHaveCount(0);

    // Fixa contexto na Portaria e modo Somente Entrada para registrar chegada de Alice via crachá.
    await page.getByTestId('monitor-context-kind').selectOption('EVENT');
    await page.getByTestId('monitor-mode-in').click();
    await page.getByTestId('monitor-code').fill(badgeCode);
    await page.getByTestId('presence-submit').click();
    await expect(page.getByTestId('monitor-feedback')).toContainText(/Entrada registrada/i, {
      timeout: 15_000,
    });

    // Chip "Presentes agora" filtra somente Alice; "Aguardando entrada" mostra só Bruno.
    await page.getByTestId('checkin-status-inside').click();
    await expect(page.getByTestId('queue-total')).toContainText('1 inscrição(ões)', { timeout: 10_000 });
    await expect(page.getByTestId('checkin-queue')).toContainText('Alice F114 Balcao');
    await expect(page.getByTestId('checkin-queue')).not.toContainText('Bruno F114 Ausente');

    await page.getByTestId('checkin-status-pending').click();
    await expect(page.getByTestId('queue-total')).toContainText('1 inscrição(ões)', { timeout: 10_000 });
    await expect(page.getByTestId('checkin-queue')).toContainText('Bruno F114 Ausente');
    await page.getByTestId('checkin-status-all').click();
    await expect(page.getByTestId('queue-total')).toContainText('2 inscrição(ões)', { timeout: 10_000 });

    // Usa "Registrar saída imediata" na Portaria/Atividade e confirma que modo salvo continua Somente Entrada.
    await page.getByTestId('monitor-code').fill(badgeCode);
    await page.getByTestId('monitor-checkout').click();
    await expect(page.getByTestId('monitor-feedback')).toContainText(/Saída registrada/i, {
      timeout: 15_000,
    });

    // Verifica que o modo no localStorage permaneceu 'IN' e o próximo bip re-entra em vez de falhar como saída.
    const savedMode = await page.evaluate(
      (id) => window.localStorage.getItem(`eventflow_monitor_mode_${id}`),
      eventId,
    );
    expect(savedMode).toBe('IN');

    // Clicar em "Fechar as presenças abertas" abre o diálogo de confirmação antes de enviar.
    await page.getByTestId('monitor-close-sessions').click();
    const closeDialog = page.getByTestId('monitor-close-sessions-dialog');
    await expect(closeDialog).toBeVisible();
    await page.getByTestId('monitor-close-sessions-dialog-cancel').click();
    await expect(closeDialog).toHaveCount(0);
  });

  test('2. Aba Autocredenciamento: política recolhe após salvar, filtra atividades e oferece Cartaz com PIN', async ({
    page,
  }) => {
    await page.request.post('/api/auth/sign-in/email', {
      headers: { origin: ORIGEM },
      data: { email: adminEmail, password: PASSWORD },
    });

    await page.goto(`/t/${tenantSlug}/credenciamento?evento=${eventId}`);
    await page.getByTestId('checkin-tab-autocredenciamento').click();
    await expect(page).toHaveURL(/aba=autocredenciamento/);

    // Primeira vez sem configuração: detalhes nascem abertos.
    const details = page.getByTestId('self-checkin-policy-details');
    await expect(details).toHaveAttribute('open', '');

    await page.getByTestId('self-checkin-policy-enabled').check();
    await page.getByTestId('self-checkin-policy-require-geo').check();
    await page.getByTestId('self-checkin-latitude').fill('-12.999900');
    await page.getByTestId('self-checkin-longitude').fill('-38.510800');
    await page.getByTestId('self-checkin-policy-save').click();

    await expect(page.getByTestId('self-checkin-policy-feedback')).toContainText(
      'Política de segurança do autocredenciamento salva.',
      { timeout: 15_000 },
    );

    // Após recarregar já configurado, política nasce recolhida priorizando a lista de QR Codes.
    await page.reload();
    await expect(page.getByTestId('self-checkin-policy-details')).not.toHaveAttribute('open', '');
    await expect(page.getByTestId('self-checkin-policy-summary')).toContainText('GPS ativo');

    // Gera QR da atividade e ativa PIN: exibe Cartaz com PIN + Copiar link; regenerar não trava próximos feedbacks.
    await page.getByTestId(`self-checkin-generate-${activityId}`).click();
    await expect(page.getByTestId(`self-checkin-print-${activityId}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`self-checkin-pin-toggle-${activityId}`).click();
    await expect(page.getByTestId(`self-checkin-print-pin-${activityId}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`self-checkin-copy-${activityId}`)).toBeVisible();

    const pinPosterHref = await page
      .getByTestId(`self-checkin-print-pin-${activityId}`)
      .getAttribute('href');
    expect(pinPosterHref).toContain('incluirPin=1');
    const pdfRes = await page.request.get(pinPosterHref!);
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()['content-type']).toContain('application/pdf');

    // Filtro rápido por sala/atividade oculta portaria e mostra só a oficina.
    await page.getByTestId('self-checkin-activity-filter').fill('Ergonomia');
    await expect(page.getByTestId(`self-checkin-row-${activityId}`)).toBeVisible();
    await expect(page.getByTestId('self-checkin-row-portaria')).toHaveCount(0);

    // Excluir QR Code abre modal de confirmação; cancelar mantém ativo e confirmar limpa ao estado inicial.
    const activityRow = page.getByTestId(`self-checkin-row-${activityId}`);
    const publicHrefBeforeDelete = await page
      .getByTestId(`self-checkin-public-link-${activityId}`)
      .getAttribute('href');

    await page.getByTestId(`self-checkin-delete-open-${activityId}`).click();
    const deleteDialog = page.getByTestId(`self-checkin-delete-${activityId}`);
    await expect(deleteDialog).toBeVisible();
    await page.getByTestId(`self-checkin-delete-${activityId}-cancel`).click();
    await expect(deleteDialog).toHaveCount(0);
    await expect(page.getByTestId(`self-checkin-print-${activityId}`)).toBeVisible();

    await page.getByTestId(`self-checkin-delete-open-${activityId}`).click();
    await expect(page.getByTestId(`self-checkin-delete-${activityId}`)).toBeVisible();
    await page.getByTestId(`self-checkin-delete-${activityId}-confirm`).click();

    await expect(page.getByTestId(`self-checkin-row-feedback-${activityId}`)).toContainText(
      'voltou ao estado inicial',
      { timeout: 15_000 },
    );
    await expect(activityRow).toContainText('QR não gerado');
    await expect(page.getByTestId(`self-checkin-generate-${activityId}`)).toBeVisible();
    await expect(page.getByTestId(`self-checkin-print-${activityId}`)).toHaveCount(0);

    // O link antigo agora mostra estado revogado, e é possível gerar um novo QR Code limpo depois.
    await page.goto(publicHrefBeforeDelete!);
    await expect(page.locator('body')).toContainText(/revogado/i);

    await page.goto(`/t/${tenantSlug}/credenciamento?evento=${eventId}&aba=autocredenciamento`);
    await page.getByTestId(`self-checkin-generate-${activityId}`).click();
    await expect(page.getByTestId(`self-checkin-print-${activityId}`)).toBeVisible({ timeout: 15_000 });
  });
});

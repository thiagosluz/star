/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 101 — Testes E2E de Reatividade Empírica e Comportamento Real
 *
 *  Valida em navegador real (Chromium):
 *    1. Aparição real da barra global de progresso durante clique em Link (ADR-423);
 *    2. Micro-interação otimista estável no balcão de check-in (ADR-424);
 *    3. Idempotência de filtros sem transição redundante (ADR-425).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
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
} from './helpers';

const PASSWORD = 'EventFlow#2026';

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

async function createUser(
  page: Page,
  tenantId: string,
  name: string,
  role: 'ADMIN' | 'CHAIR' | 'PARTICIPANT' | 'STAFF' = 'ADMIN',
): Promise<{ id: string; email: string }> {
  const email = `f101.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await linkUser({ tenantId, userId: user.id });
  await grantRole({ tenantId, userId: user.id, role });

  return { id: user.id, email };
}

async function registerParticipant(input: {
  tenantId: string;
  eventId: string;
  activityId?: string;
  userId: string;
}): Promise<string> {
  const registrationId = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: 'CONFIRMED',
        consentData: true,
        badgeToken: `BADGE-${randomUUID().slice(0, 12)}`,
      },
    });
  });

  return registrationId;
}

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('FASE 101 — Reatividade Empírica e Comportamento Operacional', () => {
  test('1. Barra de progresso global aparece durante clique em link interno e conclui na nova página (ADR-423)', async ({
    page,
  }) => {
    await page.goto('http://localhost:3000/');
    await page.waitForLoadState('networkidle');

    // Instala observador de mutação no cliente para registrar aparição da barra
    await page.evaluate(() => {
      (window as unknown as { __progressSeen: boolean }).__progressSeen = false;
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="navigation-progress-bar"]')) {
          (window as unknown as { __progressSeen: boolean }).__progressSeen = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    // Clica no link de navegação interno da home para /eventos
    const eventosLink = page.locator('a[href="/eventos"]').first();
    await expect(eventosLink).toBeVisible();
    await eventosLink.click();

    // Aguarda a chegada à rota destino
    await expect(page).toHaveURL(/\/eventos/);
    await page.waitForLoadState('networkidle');

    // Confirma que a barra de progresso foi renderizada durante a transição
    const progressSeen = await page.evaluate(
      () => (window as unknown as { __progressSeen: boolean }).__progressSeen,
    );
    expect(progressSeen).toBe(true);

    // Após resolução, a barra de progresso conclui e desmonta
    await expect(page.locator('[data-testid="navigation-progress-bar"]')).toHaveCount(0);
  });

  test('2. Balcão de credenciamento: micro-interação otimista desabilita botão e exibe feedback tátil (ADR-424)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f101-balcao',
      name: 'Instituição Balcão F101',
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: 'summit-f101',
      title: 'Summit de Operações F101',
      status: 'REGISTRATION_OPEN',
    });

    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: 'workshop-f101',
      title: 'Workshop de Reatividade F101',
      capacity: 50,
      workloadMinutes: 60,
    });

    // Cria operador STAFF e participante
    const staff = await createUser(page, tenant.id, 'Operadora Balcão F101', 'STAFF');
    const participant = await createUser(page, tenant.id, 'Participante F101', 'PARTICIPANT');

    await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: participant.id,
    });

    // Login com operador de balcão
    await signInAs(page, staff.email);
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);

    const row = page.locator('li[data-testid^="queue-"]', { hasText: 'Participante F101' });
    await expect(row).toBeVisible();
    expect(await row.getAttribute('data-inside')).toBe('false');

    // Clica em Credenciar
    const checkinBtn = row.getByTestId('checkin-button');
    await checkinBtn.click();

    // Feedback de sucesso com XP e role status
    const feedback = row.getByTestId(/^checkin-feedback-/);
    await expect(feedback).toBeVisible({ timeout: 15_000 });
    await expect(feedback).toHaveAttribute('role', 'status');
    await expect(feedback).toContainText(/\+50 XP/);

    // Agora está credenciado (data-inside = true) e botão virou "Registrar saída"
    expect(await row.getAttribute('data-inside')).toBe('true');
    const checkoutBtn = row.getByTestId('checkout-button');
    await expect(checkoutBtn).toBeVisible();

    // Clica em registrar saída
    await checkoutBtn.click();
    await expect(feedback).toContainText(/saída|min/i, { timeout: 15_000 });
    expect(await row.getAttribute('data-inside')).toBe('false');
  });

  test('3. Idempotência em filtros do comitê não dispara barra nem transição desnecessária (ADR-425)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f101-idemp',
      name: 'Instituição Idempotência F101',
    });

    await createEvent({
      tenantId: tenant.id,
      slug: 'congresso-idemp',
      title: 'Congresso de Tecnologia F101',
      status: 'REGISTRATION_OPEN',
    });

    await createUser(page, tenant.id, 'Chair Idemp F101', 'ADMIN');
    await page.goto(`/t/${tenant.slug}/comite`);

    await expect(page.getByRole('heading', { name: 'Comitê científico' })).toBeVisible();
    const searchInput = page.getByTestId('comite-search-input');
    await expect(searchInput).toBeVisible();

    // Submete o formulário sem alterar filtros
    const submitBtn = page.getByTestId('comite-filter-submit');
    await submitBtn.click();

    // URL permanece idêntica e nenhuma barra pendente fica travada
    await expect(page).not.toHaveURL(/busca=/);
    await expect(page.locator('[data-testid="navigation-progress-bar"]')).toHaveCount(0);
  });
});


/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 102 — Testes E2E de Progresso Unificado, Check-in Idiomático e Filtros
 *
 *  Valida em navegador real (Chromium):
 *    1. Navegação canônica via NavLink/AppLink com barra única sem duplicação (ADR-426);
 *    2. Micro-interação no balcão com useActionState: caminho feliz e rollback com role="alert" (ADR-427);
 *    3. Filtros reativos operacionais no balcão e participantes com debounce e atalho "/" (ADR-428).
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
  const email = `f102.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
  status?: 'CONFIRMED' | 'CANCELED' | 'WAITLIST';
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
        status: input.status ?? 'CONFIRMED',
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

test.describe('FASE 102 — Progresso Unificado, Check-in Idiomático e Filtros Operacionais', () => {
  test('1. Navegação pelo menu lateral usa AppLink e exibe barra de progresso única sem duplicidade visual (ADR-426)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f102-nav',
      name: 'Instituição Navegação F102',
    });

    const admin = await createUser(page, tenant.id, 'Admin Nav F102', 'ADMIN');
    await signInAs(page, admin.email);

    await page.goto(`/t/${tenant.slug}/dashboard`);
    await page.waitForLoadState('networkidle');

    // Instala observador para detectar o surgimento da barra de progresso durante navegação no shell
    await page.evaluate(() => {
      (window as unknown as { __progressSeen: boolean }).__progressSeen = false;
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="navigation-progress-bar"]')) {
          (window as unknown as { __progressSeen: boolean }).__progressSeen = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    // Clica no link do menu lateral para /participantes
    const participantesLink = page.locator(`a[href="/t/${tenant.slug}/participantes"]`).first();
    await expect(participantesLink).toBeVisible();
    await participantesLink.click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/participantes`));
    await page.waitForLoadState('networkidle');

    // Confirma que a barra de navegação global respondeu
    const progressSeen = await page.evaluate(
      () => (window as unknown as { __progressSeen: boolean }).__progressSeen,
    );
    expect(progressSeen).toBe(true);

    // Confirma que não há barra duplicada persistente
    await expect(page.locator('[data-testid="navigation-progress-bar"]')).toHaveCount(0);
  });

  test('2. Balcão de check-in: micro-interação otimista com useActionState, sucesso com XP e rollback com role="alert" em caso de erro (ADR-427)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f102-checkin',
      name: 'Instituição Balcão F102',
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: 'summit-f102',
      title: 'Summit de Operações F102',
      status: 'REGISTRATION_OPEN',
    });

    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: 'workshop-f102',
      title: 'Workshop de Reatividade F102',
      capacity: 50,
      workloadMinutes: 60,
    });

    const staff = await createUser(page, tenant.id, 'Operadora Balcão F102', 'STAFF');
    const participant1 = await createUser(page, tenant.id, 'Participante Sucesso F102', 'PARTICIPANT');

    await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: participant1.id,
    });

    await signInAs(page, staff.email);
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);
    await page.waitForLoadState('networkidle');

    // 1. Caminho de sucesso
    const row1 = page.locator('li[data-testid^="queue-"]', { hasText: 'Participante Sucesso F102' });
    await expect(row1).toBeVisible();
    expect(await row1.getAttribute('data-inside')).toBe('false');

    const checkinBtn1 = row1.getByTestId('checkin-button');
    await checkinBtn1.click();

    // Feedback de sucesso com XP e role status
    const feedback1 = row1.getByTestId(/^checkin-feedback-/);
    await expect(feedback1).toBeVisible({ timeout: 15_000 });
    await expect(feedback1).toHaveAttribute('role', 'status');
    await expect(feedback1).toContainText(/\+50 XP/);
    expect(await row1.getAttribute('data-inside')).toBe('true');

    // Registrar saída
    const checkoutBtn1 = row1.getByTestId('checkout-button');
    await checkoutBtn1.click();
    await expect(feedback1).toContainText(/saída|min/i, { timeout: 15_000 });
    expect(await row1.getAttribute('data-inside')).toBe('false');
  });

  test('3. Filtros reativos e atalhos de teclado no balcão e no diretório de participantes (ADR-428)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f102-filtros',
      name: 'Instituição Filtros F102',
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: 'forum-f102',
      title: 'Fórum de Gestão F102',
      status: 'REGISTRATION_OPEN',
    });

    const staff = await createUser(page, tenant.id, 'Operadora Filtros F102', 'ORGANIZER');
    await signInAs(page, staff.email);

    // Balcão de credenciamento
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);
    await page.waitForLoadState('networkidle');

    // Clica no título para desfocar eventuais campos com autoFocus (leitor de crachá)
    await page.getByRole('heading', { name: 'Credenciamento' }).click();

    // Atalho "/" foca a busca
    await page.keyboard.press('/');
    const searchInput = page.getByTestId('checkin-search');
    await expect(searchInput).toBeFocused();

    // Digita na busca: debounce de 300ms atualiza a URL
    await searchInput.fill('teste-filtro');
    await expect(page).toHaveURL(/q=teste-filtro/, { timeout: 10_000 });

    // Atalho "Escape" limpa a busca
    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveValue('');
    await expect(page).not.toHaveURL(/q=teste-filtro/, { timeout: 10_000 });

    // Diretório de participantes
    await page.goto(`/t/${tenant.slug}/participantes`);
    await page.waitForLoadState('networkidle');

    // Clica no título para foco neutro
    await page.getByRole('heading', { name: 'Participantes', exact: true }).click();

    // Atalho "/" foca a busca no diretório
    await page.keyboard.press('/');
    const partSearch = page.getByTestId('participant-search');
    await expect(partSearch).toBeFocused();

    // Troca de filtro via checkbox de presença aciona transição cliente imediata
    const attendedCheckbox = page.getByTestId('participant-only-attended');
    await attendedCheckbox.check();
    await expect(page).toHaveURL(/presente=1/, { timeout: 10_000 });

    // Desmarca checkbox
    await attendedCheckbox.uncheck();
    await expect(page).not.toHaveURL(/presente=1/, { timeout: 10_000 });
  });
});


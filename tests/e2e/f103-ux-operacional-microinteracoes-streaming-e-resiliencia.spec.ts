/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 103 — Testes E2E de UX Operacional, Micro-interações Otimistas e Resiliência
 *
 *  Valida em navegador real (Chromium):
 *    1. FavoriteButton 100% otimista com chaveamento imediato no React 19 (ADR-429);
 *    2. Navegação operacional por teclado na fila de credenciamento (ArrowDown/Up + Enter · ADR-431);
 *    3. Streaming em /participantes com navegação por teclado para abrir ficha (ADR-430 / ADR-431).
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
  const email = `f103.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.describe('FASE 103 — UX Operacional, Micro-interações Otimistas e Resiliência', () => {
  test('1. FavoriteButton alterna instantaneamente via useOptimistic mantendo progressive enhancement (ADR-429)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f103-fav',
      name: `Instituição F103 ${RUN_ID}`,
    });
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `congresso-f103-${RUN_ID}`,
      title: `Congresso F103 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `palestra-f103-${RUN_ID}`,
      title: `Palestra Magistral F103 ${RUN_ID}`,
      status: 'SCHEDULED',
      capacity: 50,
      workloadMinutes: 60,
    });

    const user = await createUser(page, tenant.id, 'Participante F103', 'PARTICIPANT');
    await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: user.id,
    });

    await signInAs(page, user.email);

    await page.goto(`/t/${tenant.slug}/eventos/${event.slug}`);
    await page.waitForLoadState('networkidle');

    const favButton = page.locator(`[data-testid="agenda-favoritar-${activity.id}"]`);
    await expect(favButton).toBeVisible();
    await expect(favButton).toHaveAttribute('aria-pressed', 'false');
    await expect(favButton).toHaveText(/Adicionar à minha agenda/);

    // Clique com micro-interação otimista
    await favButton.click();

    // Imediatamente vira marcado
    await expect(favButton).toHaveAttribute('aria-pressed', 'true');
    await expect(favButton).toHaveText(/Remover da minha agenda/);
  });

  test('2. Fila de credenciamento suporta navegação operacional por teclado (ArrowDown + Enter) (ADR-431)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f103-queue',
      name: `Instituição Fila F103 ${RUN_ID}`,
    });
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `jornada-f103-${RUN_ID}`,
      title: `Jornada F103 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `sessao-f103-${RUN_ID}`,
      title: `Sessão Balcão F103 ${RUN_ID}`,
      status: 'SCHEDULED',
      capacity: 50,
      workloadMinutes: 60,
    });

    const staff = await createUser(page, tenant.id, 'Operador F103', 'STAFF');
    const participant = await createUser(page, tenant.id, 'Convidado Teclado', 'PARTICIPANT');

    const registrationId = await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: participant.id,
    });

    await signInAs(page, staff.email);
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);
    await page.waitForLoadState('networkidle');

    const queueHint = page.locator('[data-testid="queue-keyboard-hint"]');
    await expect(queueHint).toBeVisible();

    const row = page.locator(`[data-testid="queue-${registrationId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-active-row', 'false');

    // Desfoca qualquer input clicando no título
    await page.getByRole('heading', { name: 'Credenciamento', exact: true }).click();

    // Pressiona ArrowDown para ativar a primeira linha
    await page.keyboard.press('ArrowDown');
    await expect(row).toHaveAttribute('data-active-row', 'true');

    // Pressiona Enter para acionar a credenciação
    await page.keyboard.press('Enter');

    // O status muda e credenciamento é confirmado
    await expect(row).toHaveAttribute('data-inside', 'true');
  });

  test('3. Streaming de /participantes entrega esqueleto/tabela e navega por teclado (ArrowDown + Enter) para abrir ficha (ADR-430 / ADR-431)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f103-stream',
      name: `Instituição Streaming F103 ${RUN_ID}`,
    });
    const admin = await createUser(page, tenant.id, 'Admin F103', 'ADMIN');
    const participant = await createUser(page, tenant.id, 'Participante Lista', 'PARTICIPANT');

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `simposio-f103-${RUN_ID}`,
      title: `Simpósio Streaming F103 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      userId: participant.id,
    });

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/participantes`);
    await page.waitForLoadState('networkidle');

    // Dica de teclado e tabela presentes
    const hint = page.locator('[data-testid="directory-keyboard-hint"]');
    await expect(hint).toBeAttached();

    const adminRow = page.locator(`[data-testid="participant-row-${admin.id}"]`);
    await expect(adminRow).toBeVisible();

    const participantRow = page.locator(`[data-testid="participant-row-${participant.id}"]`);
    await expect(participantRow).toBeVisible();

    // Desfoca input clicando no topo
    await page.getByRole('heading', { name: 'Participantes', exact: true }).click();

    // Pressiona ArrowDown para ativar a primeira linha (admin)
    await page.keyboard.press('ArrowDown');
    await expect(adminRow).toHaveAttribute('data-active-row', 'true');

    // Pressiona ArrowDown novamente para navegar para a segunda linha (participante)
    await page.keyboard.press('ArrowDown');
    await expect(participantRow).toHaveAttribute('data-active-row', 'true');

    // Pressiona Enter para abrir a ficha do participante
    await page.keyboard.press('Enter');

    // Verifica que a navegação para a ficha 360 do participante ocorreu
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/participantes/${participant.id}`));
  });
});

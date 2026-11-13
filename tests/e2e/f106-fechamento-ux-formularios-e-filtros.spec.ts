/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 106 — Testes E2E de Fechamento de UX em Formulários e Filtros
 *
 *  Valida em navegador real (Chromium):
 *    1. Credenciamento: limpeza rápida (×) e empty state acionável ("Limpar busca") na fila;
 *    2. Comitê: silêncio inicial de aria-live, aria-label em Aplicar filtros e limpeza rápida (×);
 *    3. Nova submissão: sair com rascunho digitado abre ConfirmDialog do sistema (sem window.confirm).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupRun,
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
  const email = `f106.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
        activityId: null,
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

test.describe('FASE 106 — Fechamento de UX em Formulários e Filtros', () => {
  test('1. Credenciamento: empty state acionável e limpeza rápida (×) restauram a fila (ADR-438)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f106-checkin',
      name: `Instituição Checkin F106 ${RUN_ID}`,
    });
    const admin = await createUser(page, tenant.id, 'Admin Checkin F106', 'ADMIN');
    const participant = await createUser(page, tenant.id, 'Beatriz Inscrita F106', 'PARTICIPANT');
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-checkin-f106-${RUN_ID}`,
      title: `Evento Checkin F106 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    const regId = await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      userId: participant.id,
    });

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);
    await page.waitForLoadState('networkidle');

    const row = page.locator(`[data-testid="queue-${regId}"]`);
    await expect(row).toBeVisible();

    const searchInput = page.locator('[data-testid="checkin-search"]');
    await searchInput.fill('inexistente-xyz-f106');
    await expect(page).toHaveURL(/q=inexistente-xyz-f106/);
    await expect(page.locator('[data-testid="queue-empty"]')).toBeVisible();

    // Empty state oferece o link "Limpar busca"
    const clearEmptyLink = page.locator('[data-testid="queue-clear-search"]');
    await expect(clearEmptyLink).toBeVisible();

    // Botão rápido (×) no campo de busca também limpa e restaura a fila
    const clearSearchBtn = page.locator('[data-testid="checkin-search-clear"]');
    await expect(clearSearchBtn).toBeVisible();
    await clearSearchBtn.click();

    await expect(searchInput).toHaveValue('');
    await expect(row).toBeVisible();
  });

  test('2. Comitê: aria-live inicia vazio, botão tem aria-label e (×) limpa a busca (ADR-438)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f106-comite',
      name: `Instituição Comitê F106 ${RUN_ID}`,
    });
    const chair = await createUser(page, tenant.id, 'Coord Comitê F106', 'CHAIR');

    await signInAs(page, chair.email);
    await page.goto(`/t/${tenant.slug}/comite`);
    await page.waitForLoadState('networkidle');

    const live = page.locator('[data-testid="comite-filter-live"]');
    await expect(live).toBeAttached();
    await expect(live).toHaveText('');

    const submitBtn = page.locator('[data-testid="comite-filter-submit"]');
    await expect(submitBtn).toHaveAttribute('aria-label', 'Aplicar filtros');

    const searchInput = page.locator('[data-testid="comite-search-input"]');
    await searchInput.fill('protocolo-teste');
    await expect(page).toHaveURL(/busca=protocolo-teste/);

    const clearBtn = page.locator('[data-testid="comite-search-clear"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    await expect(searchInput).toHaveValue('');
    await expect(page).not.toHaveURL(/busca=protocolo-teste/);
  });

  test('3. Nova submissão: sair com alterações não salvas abre ConfirmDialog do sistema (sem window.confirm)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f106-unsaved-modal',
      name: `Instituição Modal Rascunho F106 ${RUN_ID}`,
    });
    const participant = await createUser(page, tenant.id, 'Autor Rascunho F106', 'PARTICIPANT');
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-submissao-f106-${RUN_ID}`,
      title: `Evento Submissão F106 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.track.create({
        data: {
          tenantId: tenant.id,
          eventId: event.id,
          name: 'Trilha Geral',
          slug: 'trilha-geral',
          requiresBlindReview: false,
          isActive: true,
        },
      });
    });

    let nativeDialogsCount = 0;
    page.on('dialog', async (dialog) => {
      nativeDialogsCount += 1;
      await dialog.dismiss();
    });

    await signInAs(page, participant.email);
    await page.goto(`/t/${tenant.slug}/submissoes/nova`);
    await page.waitForLoadState('networkidle');

    const titleInput = page.locator('[name="title"]');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('Artigo em andamento sobre acessibilidade');

    const sidebarLink = page.locator(`nav a[href="/t/${tenant.slug}/meus-compartilhamentos"]`).first();
    await expect(sidebarLink).toBeVisible();
    await sidebarLink.click();

    const modal = page.locator('[data-testid="unsaved-changes-dialog"]');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('role', 'alertdialog');
    await expect(modal).toContainText('Sair sem salvar alterações?');

    const cancelBtn = page.locator('[data-testid="unsaved-changes-dialog-cancel"]');
    await expect(cancelBtn).toBeFocused();
    await cancelBtn.click();

    await expect(modal).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/submissoes/nova$`));
    await expect(titleInput).toHaveValue('Artigo em andamento sobre acessibilidade');

    await sidebarLink.click();
    await expect(modal).toBeVisible();
    await page.locator('[data-testid="unsaved-changes-dialog-confirm"]').click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/meus-compartilhamentos$`));
    expect(nativeDialogsCount).toBe(0);
  });
});


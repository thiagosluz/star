/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 128 — E2E: Ciclo de Vida no Acervo de Eventos
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  cleanupRun,
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
const TENANT_LABEL = 'f128-acervo';

let tenantSlug: string;
let tenantId: string;
let ownerEmail: string;

async function signUpOwner(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f128-owner');
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

async function signInAsOwner(page: Page): Promise<void> {
  await signOut(page);
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email: ownerEmail, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao autenticar ${ownerEmail}: HTTP ${response.status()}`);
  }
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição F128 ${RUN_ID}`,
    });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    await e2eDb.tenant.update({
      where: { id: tenantId },
      data: { maxEvents: 25 },
    });

    const owner = await signUpOwner(api, 'Owner F128');
    ownerEmail = owner.email;

    await linkUser({ tenantId, userId: owner.id });
    await grantRole({ tenantId, userId: owner.id, role: 'OWNER' });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 128 — Ciclo de Vida no Acervo de Eventos', () => {
  test('abre a edição de dados diretamente pelo atalho na listagem', async ({ page }) => {
    const suffix = randomUUID().slice(0, 6);
    const slug = `atalho-${suffix}-${RUN_ID}`;
    const event = await createEvent({
      tenantId,
      slug,
      title: `Evento Atalho ${suffix}`,
      status: 'DRAFT',
    });

    await signInAsOwner(page);
    await page.goto(`/t/${tenantSlug}/administracao/eventos`);

    const editLink = page.getByTestId(`edit-event-${slug}`);
    await expect(editLink).toBeVisible({ timeout: 20_000 });
    await editLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/eventos/${event.id}/dados`),
    );
    await expect(page.locator('input[name="title"]')).toHaveValue(`Evento Atalho ${suffix}`);
  });

  test('clona dados básicos de um evento em rascunho limpo', async ({ page }) => {
    const suffix = randomUUID().slice(0, 6);
    const slug = `matriz-${suffix}-${RUN_ID}`;
    const clonedSlug = `matriz-${suffix}-ed2-${RUN_ID}`;

    const source = await createEvent({
      tenantId,
      slug,
      title: `Simpósio Original ${suffix}`,
      status: 'PUBLISHED',
    });

    await e2eDb.event.update({
      where: { id: source.id },
      data: { venueName: 'Pavilhão Ondina', modality: 'HYBRID' },
    });

    await signInAsOwner(page);
    await page.goto(`/t/${tenantSlug}/administracao/eventos`);

    const cloneTrigger = page.getByTestId(`clone-event-trigger-${slug}`);
    await expect(cloneTrigger).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await cloneTrigger.click();
      await expect(page.getByTestId(`clone-event-modal-${slug}`)).toBeVisible({ timeout: 2_000 });
    }).toPass();

    await page.getByTestId('clone-event-title').fill(`Simpósio Cloned ${suffix}`);
    await page.getByTestId('clone-event-slug').fill(clonedSlug);
    await page.getByTestId('clone-event-submit').click();

    await expect(page.getByTestId('clone-event-feedback-ok')).toBeVisible({ timeout: 20_000 });

    const clonedRow = await e2eDb.event.findFirstOrThrow({
      where: { tenantId, slug: clonedSlug, deletedAt: null },
      select: { id: true, status: true, venueName: true, modality: true },
    });
    expect(clonedRow.status).toBe('DRAFT');
    expect(clonedRow.venueName).toBe('Pavilhão Ondina');
    expect(clonedRow.modality).toBe('HYBRID');

    await page.getByTestId('clone-event-edit-link').click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/eventos/${clonedRow.id}/dados`),
    );
  });

  test('arquiva evento, filtra no acervo e restaura para rascunho', async ({ page }) => {
    const suffix = randomUUID().slice(0, 6);
    const slug = `arq-${suffix}-${RUN_ID}`;

    await createEvent({
      tenantId,
      slug,
      title: `Evento Arquivável ${suffix}`,
      status: 'PUBLISHED',
    });

    await signInAsOwner(page);
    await page.goto(`/t/${tenantSlug}/administracao/eventos`);

    const archiveTrigger = page.getByTestId(`archive-event-trigger-${slug}`);
    await expect(archiveTrigger).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await archiveTrigger.click();
      await expect(page.getByTestId(`archive-event-modal-${slug}`)).toBeVisible({ timeout: 2_000 });
    }).toPass();

    await page.getByTestId('archive-event-submit').click();
    await expect(page.getByTestId(`archive-event-modal-${slug}`)).toBeHidden({ timeout: 20_000 });

    await page.getByTestId('events-filter-ativos').click();
    await expect(page).toHaveURL(/situacao=ativos/);
    await expect(page.getByTestId(`event-row-${slug}`)).toHaveCount(0);

    await page.getByTestId('events-filter-arquivados').click();
    await expect(page).toHaveURL(/situacao=arquivados/);
    const archivedRow = page.getByTestId(`event-row-${slug}`);
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow).toContainText('Arquivado');

    const restoreTrigger = page.getByTestId(`archive-event-trigger-${slug}`);
    await expect(async () => {
      await restoreTrigger.click();
      await expect(page.getByTestId(`archive-event-modal-${slug}`)).toBeVisible({ timeout: 2_000 });
    }).toPass();

    await page.getByTestId('archive-event-submit').click();
    await expect(page.getByTestId(`archive-event-modal-${slug}`)).toBeHidden({ timeout: 20_000 });

    await page.getByTestId('events-filter-ativos').click();
    await expect(page.getByTestId(`event-row-${slug}`)).toBeVisible();
    await expect(page.getByTestId(`event-row-${slug}`)).toContainText('Rascunho');
  });

  test('exige palavra EXCLUIR e senha atual para excluir evento com segurança', async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 6);
    const slug = `del-${suffix}-${RUN_ID}`;
    const event = await createEvent({
      tenantId,
      slug,
      title: `Evento Excluível ${suffix}`,
      status: 'DRAFT',
    });

    await signInAsOwner(page);
    await page.goto(`/t/${tenantSlug}/administracao/eventos`);

    const deleteTrigger = page.getByTestId(`delete-event-trigger-${slug}`);
    await expect(deleteTrigger).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await deleteTrigger.click();
      await expect(page.getByTestId(`delete-event-modal-${slug}`)).toBeVisible({ timeout: 2_000 });
    }).toPass();

    await page.getByTestId('delete-event-word').fill('EXCLUIR');
    await page.getByTestId('delete-event-password').fill('SenhaIncorreta#999');
    await page.getByTestId('delete-event-submit').click();

    await expect(page.getByTestId('delete-event-feedback-error')).toBeVisible({ timeout: 20_000 });
    const stillActive = await e2eDb.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { deletedAt: true },
    });
    expect(stillActive.deletedAt).toBeNull();

    await page.getByTestId('delete-event-password').fill(PASSWORD);
    await page.getByTestId('delete-event-submit').click();

    await expect(page.getByTestId(`delete-event-modal-${slug}`)).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId(`event-row-${slug}`)).toHaveCount(0);

    const deletedRecord = await e2eDb.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { deletedAt: true, slug: true },
    });
    expect(deletedRecord.deletedAt).not.toBeNull();
    expect(deletedRecord.slug).not.toBe(slug);
  });
});

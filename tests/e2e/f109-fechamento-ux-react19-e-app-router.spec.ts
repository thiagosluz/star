/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 109 — Testes E2E de Fechamento UX, React 19 & App Router
 *
 *  Valida em navegador real (Chromium):
 *    1. AdminForm mantém proteção `useUnsavedChanges` em uma 2ª edição após
 *       salvamento bem-sucedido e CreateSubmissionForm filtra trilhas ao trocar
 *       de evento;
 *    2. GetSearchForm em `/validar/lote` e `/t/<slug>/panorama` navega como SPA
 *       sem recarregamento completo de documento;
 *    3. Preservação pós-erro `{ ok: false }` em RequestResetForm,
 *       ClaimInviteForm e checkboxes LGPD de EventRegistrationDataForm.
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
  role: 'OWNER' | 'PARTICIPANT' = 'PARTICIPANT',
  kind: 'MEMBER' | 'PARTICIPANT' = 'PARTICIPANT',
): Promise<{ id: string; email: string }> {
  const email = `f109.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await linkUser({ tenantId, userId: user.id, kind });
  await grantRole({ tenantId, userId: user.id, role });

  return { id: user.id, email };
}

test.describe('FASE 109 — Fechamento UX, React 19 & App Router', () => {
  test.afterAll(async () => {
    await cleanupRun();
  });

  test('1. AdminForm mantém guardião após 1º salvamento e CreateSubmissionForm filtra trilhas por evento', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f109-admin',
      name: `Instituição F109 ${RUN_ID}`,
    });
    const owner = await createUser(page, tenant.id, 'Dono F109', 'OWNER', 'MEMBER');

    const event1 = await createEvent({
      tenantId: tenant.id,
      slug: `evento-alfa-f109-${RUN_ID}`,
      title: `Evento Alfa F109 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    const event2 = await createEvent({
      tenantId: tenant.id,
      slug: `evento-beta-f109-${RUN_ID}`,
      title: `Evento Beta F109 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    await e2eDb.track.createMany({
      data: [
        {
          tenantId: tenant.id,
          eventId: event1.id,
          name: 'Trilha Alfa',
          slug: `alfa-${RUN_ID}`,
          isActive: true,
        },
        {
          tenantId: tenant.id,
          eventId: event2.id,
          name: 'Trilha Beta',
          slug: `beta-${RUN_ID}`,
          isActive: true,
        },
      ],
    });

    await signInAs(page, owner.email);

    // 1a. AdminForm pós-salvamento em dados do evento
    await page.goto(`/t/${tenant.slug}/administracao/eventos/${event1.id}/dados`);
    await page.waitForLoadState('networkidle');

    const form = page.locator('[data-testid="edit-event"]');
    const summaryInput = form.locator('input[name="summary"]');
    await summaryInput.fill('Primeiro resumo salvo F109');
    await form.locator('[data-testid="admin-submit"]').click();

    await expect(form.locator('[data-testid="edit-event-feedback"]')).toBeVisible();

    // Edita uma 2ª vez após state.ok === true e tenta sair pela barra lateral
    await summaryInput.fill('Segunda alteração não salva F109');
    await page.locator(`aside a[href="/t/${tenant.slug}/submissoes"]`).first().click();

    const unsavedDialog = page.locator('[data-testid="unsaved-changes-dialog"]');
    await expect(unsavedDialog).toBeVisible();
    await unsavedDialog.locator('[data-testid="unsaved-changes-dialog-cancel"]').click();
    await expect(unsavedDialog).toBeHidden();

    // 1b. CreateSubmissionForm acoplando trilha ao evento escolhido
    await page.goto(`/t/${tenant.slug}/submissoes/nova`);
    await page.waitForLoadState('networkidle');

    const eventSelect = page.locator('#eventId');
    const trackSelect = page.locator('#trackId');

    await eventSelect.selectOption(event1.id);
    await expect(trackSelect.locator('option')).toHaveCount(1);
    await expect(trackSelect.locator('option').first()).toContainText('Trilha Alfa');

    await eventSelect.selectOption(event2.id);
    await expect(trackSelect.locator('option')).toHaveCount(1);
    await expect(trackSelect.locator('option').first()).toContainText('Trilha Beta');
  });

  test('2. GetSearchForm em /validar/lote e /t/[slug]/panorama navega sem recarregamento completo', async ({
    page,
  }) => {
    await page.goto('/validar/lote');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      (window as unknown as { __f109SpaBatch?: string }).__f109SpaBatch = 'spa-lote-ok';
    });

    await page.locator('[data-testid="batch-codes"]').fill('CERT-INVALID1');
    await page.locator('[data-testid="batch-submit"]').click();

    await expect(page).toHaveURL(/\/validar\/lote\?.*codigos=CERT-INVALID1/);
    const batchMarker = await page.evaluate(
      () => (window as unknown as { __f109SpaBatch?: string }).__f109SpaBatch,
    );
    expect(batchMarker).toBe('spa-lote-ok');

    const tenant = await createTenant({
      label: 'f109-spa',
      name: `Instituição Panorama F109 ${RUN_ID}`,
    });
    const owner = await createUser(page, tenant.id, 'Gestor Panorama F109', 'OWNER', 'MEMBER');
    await signInAs(page, owner.email);

    await page.goto(`/t/${tenant.slug}/panorama`);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      (window as unknown as { __f109SpaPanorama?: string }).__f109SpaPanorama = 'spa-panorama-ok';
    });

    await page.locator('[data-testid="panorama-range"]').selectOption('30D');
    await page.locator('[data-testid="panorama-apply"]').click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/panorama\\?.*periodo=30D`));
    const panoramaMarker = await page.evaluate(
      () => (window as unknown as { __f109SpaPanorama?: string }).__f109SpaPanorama,
    );
    expect(panoramaMarker).toBe('spa-panorama-ok');
  });

  test('3. Preservação pós-erro em RequestResetForm, ClaimInviteForm e checkboxes LGPD de EventRegistrationDataForm', async ({
    page,
  }) => {
    // 3a. RequestResetForm (/esqueci-senha)
    await page.goto('/esqueci-senha');
    await page.waitForLoadState('networkidle');

    const resetEmail = page.locator('[data-testid="reset-email"]');
    await resetEmail.fill('email-invalido-f109');
    await page.locator('[data-testid="request-reset"]').click();

    await expect(page.locator('[data-testid="reset-request-error"]')).toBeVisible();
    await expect(resetEmail).toHaveValue('email-invalido-f109');

    // 3b. ClaimInviteForm (/t/[slug]/palestrante/convite) + EventRegistrationDataForm
    const tenant = await createTenant({
      label: 'f109-preserve',
      name: `Instituição Preserva F109 ${RUN_ID}`,
    });
    const participant = await createUser(page, tenant.id, 'Participante F109', 'PARTICIPANT');
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-dados-f109-${RUN_ID}`,
      title: `Evento Dados F109 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    await signInAs(page, participant.email);

    await page.goto(`/t/${tenant.slug}/palestrante/convite`);
    await page.waitForLoadState('networkidle');

    await page.locator('summary:has-text("Tenho um código de convite")').click();
    const tokenInput = page.locator('[data-testid="invite-token-input"]');
    await tokenInput.fill('TOKEN-ERRADO-F109');
    await page.locator('[data-testid="claim-by-token"]').click();

    await expect(page.locator('[data-testid="speaker-feedback-error"]')).toBeVisible();
    await expect(tokenInput).toHaveValue('TOKEN-ERRADO-F109');

    // Inscreve no evento primeiro para abrir o formulário complementar EventRegistrationDataForm
    await page.goto(`/t/${tenant.slug}/eventos/${event.slug}/inscricao`);
    await page.waitForLoadState('networkidle');

    const initialForm = page.locator('[data-testid="event-registration-form"]');
    await initialForm.locator('input[name="consentData"]').check();
    await initialForm.locator('button[type="submit"]').click();

    const dataBlock = page.locator('[data-testid="event-registration-data-form"]');
    await expect(dataBlock).toBeVisible();
    await dataBlock.locator('summary').click();

    const cpfInput = dataBlock.locator('[data-testid="event-registration-data-cpf"]');
    const consentData = dataBlock.locator('input[name="consentData"]');
    const consentImage = dataBlock.locator('input[name="consentImage"]');

    await cpfInput.fill('111.111.111-11');
    await consentData.check();
    await consentImage.check();
    await dataBlock.locator('button[type="submit"]').click();

    await expect(page.locator('[data-testid="event-registration-data-error"]')).toBeVisible();
    await expect(cpfInput).toHaveValue('111.111.111-11');
    await expect(consentData).toBeChecked();
    await expect(consentImage).toBeChecked();
  });
});

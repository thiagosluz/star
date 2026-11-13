/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 107 — Testes E2E de Preservação de Estado, Popstate e Filtros
 *
 *  Valida em navegador real (Chromium):
 *    1. AdminForm (/chamadas/nova): preserva campos preenchidos após recusa { ok: false }
 *       e intercepta o botão Voltar do navegador (`popstate`) com `UnsavedChangesDialog`;
 *    2. MessageComposer (/participantes/[id]): preserva mensagem longa quando o
 *       assunto é recusado pelo servidor e alerta antes de sair sem enviar;
 *    3. ParticipantFilterBar (/participantes): aria-live silencioso na carga inicial,
 *       limpeza rápida (×) e cancelamento do debounce ao pressionar Escape.
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
  role: 'ADMIN' | 'PARTICIPANT' = 'ADMIN',
  kind: 'MEMBER' | 'PARTICIPANT' = 'MEMBER',
): Promise<{ id: string; email: string }> {
  const email = `f107.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.describe('FASE 107 — Preservação de Estado, Popstate e Filtros', () => {
  test.afterAll(async () => {
    await cleanupRun();
  });

  test('1. AdminForm preserva valores após erro { ok: false } e intercepta Voltar (popstate) com diálogo do sistema (ADR-439/440)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f107-admin-form',
      name: `Instituição AdminForm F107 ${RUN_ID}`,
    });
    const admin = await createUser(page, tenant.id, 'Admin F107', 'ADMIN');
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-f107-${RUN_ID}`,
      title: `Evento F107 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    let nativeDialogsCount = 0;
    page.on('dialog', async (dialog) => {
      nativeDialogsCount += 1;
      await dialog.dismiss();
    });

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/administracao/eventos/${event.id}/chamadas`);
    await page.waitForLoadState('networkidle');

    // Navegação SPA real (pushState) como o usuário faz pelo botão "Nova chamada"
    await page.locator('[data-testid="btn-nova-chamada"]').click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/administracao/eventos/${event.id}/chamadas/nova$`));
    await page.waitForLoadState('networkidle');

    const slugInput = page.locator('[name="slug"]');
    const titleInput = page.locator('[name="title"]');
    const summaryInput = page.locator('[name="summary"]');
    const opensInput = page.locator('[name="opensAt"]');
    const closesInput = page.locator('[name="closesAt"]');

    const expectedSlug = `chamada-preservada-${RUN_ID.slice(0, 6)}`;
    const expectedTitle = 'Chamada de Pesquisa Aplicada';
    const expectedSummary = 'Este texto precisa sobreviver a qualquer recusa de datas.';

    await slugInput.fill(expectedSlug);
    await titleInput.fill(expectedTitle);
    await summaryInput.fill(expectedSummary);
    await opensInput.fill('2026-10-15T09:00');
    // Encerramento anterior à abertura provoca recusa no servidor
    await closesInput.fill('2026-10-01T18:00');

    await page.locator('[data-testid="admin-submit"]').click();

    const feedback = page.locator('[data-testid="create-call-feedback"]');
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveAttribute('role', 'alert');

    // Campos não controlados permanecem intactos após `{ ok: false }` no React 19
    await expect(slugInput).toHaveValue(expectedSlug);
    await expect(titleInput).toHaveValue(expectedTitle);
    await expect(summaryInput).toHaveValue(expectedSummary);

    // Aciona o botão Voltar do navegador (`popstate`) com rascunho ainda sujo
    await page.evaluate(() => window.history.back());

    const modal = page.locator('[data-testid="unsaved-changes-dialog"]');
    await expect(modal).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/administracao/eventos/${event.id}/chamadas/nova$`));
    await expect(titleInput).toHaveValue(expectedTitle);

    await page.locator('[data-testid="unsaved-changes-dialog-cancel"]').click();
    await expect(modal).not.toBeVisible();
    await expect(titleInput).toHaveValue(expectedTitle);

    await page.evaluate(() => window.history.back());
    await expect(modal).toBeVisible();
    await page.locator('[data-testid="unsaved-changes-dialog-confirm"]').click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/administracao/eventos/${event.id}/chamadas$`));
    expect(nativeDialogsCount).toBe(0);
  });

  test('2. MessageComposer preserva recado após assunto recusado e exibe diálogo ao sair sem salvar (ADR-439)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f107-composer',
      name: `Instituição Composer F107 ${RUN_ID}`,
    });
    const admin = await createUser(page, tenant.id, 'Admin Recado F107', 'ADMIN', 'MEMBER');
    const participant = await createUser(
      page,
      tenant.id,
      'Participante F107',
      'PARTICIPANT',
      'PARTICIPANT',
    );

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/participantes/${participant.id}`);
    await page.waitForLoadState('networkidle');

    const subjectInput = page.locator('[data-testid="message-subject"]');
    const bodyInput = page.locator('[data-testid="message-body"]');
    const longBody =
      'Orientação completa sobre o credenciamento e entrega do crachá na recepção principal.';

    // "Oi" passa no HTML required, mas falha no domínio (mínimo 3 caracteres)
    await subjectInput.fill('Oi');
    await bodyInput.fill(longBody);
    await page.locator('[data-testid="message-send"]').click();

    const feedback = page.locator('[data-testid="message-feedback"]');
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveAttribute('role', 'alert');

    await expect(subjectInput).toHaveValue('Oi');
    await expect(bodyInput).toHaveValue(longBody);

    const backLink = page.locator(`nav a[href="/t/${tenant.slug}/participantes"]`).first();
    await backLink.click();

    const modal = page.locator('[data-testid="unsaved-changes-dialog"]');
    await expect(modal).toBeVisible();
    await page.locator('[data-testid="unsaved-changes-dialog-confirm"]').click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/participantes$`));
  });

  test('3. ParticipantFilterBar: aria-live silencioso, limpeza rápida (×) e cancelamento do debounce no Escape (ADR-441)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f107-filters',
      name: `Instituição Filtros F107 ${RUN_ID}`,
    });
    const admin = await createUser(page, tenant.id, 'Admin Filtros F107', 'ADMIN', 'MEMBER');
    await createUser(page, tenant.id, 'Clara Mendes F107', 'PARTICIPANT', 'PARTICIPANT');

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/participantes`);
    await page.waitForLoadState('networkidle');

    const live = page.locator('[data-testid="participant-filter-live"]');
    await expect(live).toBeAttached();
    await expect(live).toHaveText('');

    const searchInput = page.locator('[data-testid="participant-search"]');
    await searchInput.fill('Clara');
    await expect(page).toHaveURL(/busca=Clara/);

    const clearBtn = page.locator('[data-testid="participant-search-clear"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(searchInput).toHaveValue('');
    await expect(page).not.toHaveURL(/busca=/);

    // Digita e pressiona Escape antes do debounce de 300ms: a busca não pode disparar depois
    await searchInput.click();
    await searchInput.fill('termo-cancelado');
    await searchInput.press('Escape');
    await expect(searchInput).toHaveValue('');

    await page.waitForTimeout(450);
    await expect(page).not.toHaveURL(/termo-cancelado/);
  });
});


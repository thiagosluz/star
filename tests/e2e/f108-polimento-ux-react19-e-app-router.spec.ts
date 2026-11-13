/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 108 — Testes E2E de Polimento UX, React 19 & App Router
 *
 *  Valida em navegador real (Chromium):
 *    1. Preservação pós-erro `{ ok: false }` em `InstitutionLeadForm`,
 *       `AccountEmailForm` e checkboxes `consentData`/`consentImage` em
 *       `EventRegistrationForm` (ADR-443);
 *    2. Gaveta `MobileNav` (foco inicial dentro do diálogo, fechamento e retorno
 *       de foco no `Escape`, fechamento automático após navegação) e `TenantMenu`
 *       (fechamento por `Escape`, clique externo e transição via `AppLink`) (ADR-444);
 *    3. `GetSearchForm` navegando sem recarregamento completo de documento no
 *       explorador `/eventos` e fechamento seguro em listagens GET (ADR-445).
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
  role: 'ADMIN' | 'PARTICIPANT' = 'PARTICIPANT',
  kind: 'MEMBER' | 'PARTICIPANT' = 'PARTICIPANT',
): Promise<{ id: string; email: string }> {
  const email = `f108.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.describe('FASE 108 — Polimento Final de UX, React 19 & App Router', () => {
  test.afterAll(async () => {
    await cleanupRun();
  });

  test('1. Preservação pós-erro em InstitutionLeadForm, AccountEmailForm e checkboxes LGPD em EventRegistrationForm (ADR-443)', async ({
    page,
  }) => {
    // 1a. LeadForm (/para-instituicoes) — erro de validação de domínio não apaga o formulário
    await page.goto('/para-instituicoes');
    await page.waitForLoadState('networkidle');

    const leadForm = page.locator('[data-testid="institution-lead-form"]');
    await leadForm.locator('#lead-name').fill('A');
    await leadForm.locator('#lead-email').fill('helena.f108@example.test');
    await leadForm.locator('#lead-org').fill('Universidade Federal F108');
    await leadForm.locator('#lead-message').fill('Precisamos de pareceres e certificados.');
    await leadForm.locator('button[type="submit"]').click();

    await expect(page.locator('[data-testid="lead-form-error"]')).toBeVisible();
    await expect(leadForm.locator('#lead-name')).toHaveValue('A');
    await expect(leadForm.locator('#lead-email')).toHaveValue('helena.f108@example.test');
    await expect(leadForm.locator('#lead-org')).toHaveValue('Universidade Federal F108');
    await expect(leadForm.locator('#lead-message')).toHaveValue(
      'Precisamos de pareceres e certificados.',
    );

    // 1b. AccountEmailForm (/conta) + EventRegistrationForm (/eventos/[slug])
    const tenant = await createTenant({
      label: 'f108-forms',
      name: `Instituição F108 ${RUN_ID}`,
    });
    const participant = await createUser(page, tenant.id, 'Helena F108', 'PARTICIPANT');
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-f108-${RUN_ID}`,
      title: `Simpósio F108 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    await signInAs(page, participant.email);

    await page.goto('/conta');
    await page.waitForLoadState('networkidle');

    const newEmailInput = page.locator('[data-testid="account-new-email"]');
    await newEmailInput.fill('novo.f108@example.test');
    await page.locator('[data-testid="account-email-password"]').fill('SenhaErrada#99');
    await page.locator('[data-testid="request-email-change"]').click();

    await expect(page.locator('[data-testid="account-email-feedback-error"]')).toBeVisible();
    await expect(newEmailInput).toHaveValue('novo.f108@example.test');

    await page.goto(`/t/${tenant.slug}/eventos/${event.slug}/inscricao`);
    await page.waitForLoadState('networkidle');

    const regForm = page.locator('[data-testid="event-registration-form"]');
    const cpfInput = regForm.locator('[data-testid="event-registration-cpf"]');
    const consentDataBox = regForm.locator('input[name="consentData"]');
    const consentImageBox = regForm.locator('input[name="consentImage"]');

    await cpfInput.fill('111.111.111-11');
    await consentDataBox.check();
    await consentImageBox.check();
    await regForm.locator('button[type="submit"]').click();

    await expect(page.locator('[data-testid="event-registration-error"]')).toBeVisible();
    await expect(cpfInput).toHaveValue('111.111.111-11');
    await expect(consentDataBox).toBeChecked();
    await expect(consentImageBox).toBeChecked();
  });

  test('2. MobileNav (foco, Escape, auto-fechamento em rota) e TenantMenu (Escape, clique externo e AppLink) (ADR-444)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f108-nav',
      name: `Instituição Nav F108 ${RUN_ID}`,
    });
    const admin = await createUser(page, tenant.id, 'Gestor Nav F108', 'ADMIN', 'MEMBER');

    await signInAs(page, admin.email);

    // 2a. Gaveta MobileNav (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/t/${tenant.slug}/dashboard`);
    await page.waitForLoadState('networkidle');

    const openBtn = page.locator('[data-testid="open-navigation"]');
    const drawer = page.locator('[data-testid="mobile-navigation"]');
    const closeBtn = drawer.locator('button[aria-label="Fechar menu"]');

    await openBtn.click();
    await expect(drawer).toHaveAttribute('aria-modal', 'true');
    await expect(closeBtn).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(openBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(openBtn).toBeFocused();

    await openBtn.click();
    await expect(drawer).toHaveAttribute('aria-modal', 'true');
    await drawer.locator(`a[href="/t/${tenant.slug}/minhas-mensagens"]`).click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/minhas-mensagens$`));
    await expect(openBtn).toHaveAttribute('aria-expanded', 'false');

    // 2b. TenantMenu no desktop (Escape, clique externo e navegação App Router)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/t/${tenant.slug}/dashboard`);
    await page.waitForLoadState('networkidle');

    const visibleSummary = page.locator('aside [data-testid="account-tenant-menu"]').first();
    const visibleDetails = visibleSummary.locator('..');

    await visibleSummary.click();
    await expect(visibleDetails).toHaveAttribute('open', '');

    await page.keyboard.press('Escape');
    await expect(visibleDetails).not.toHaveAttribute('open', '');
    await expect(visibleSummary).toBeFocused();

    await visibleSummary.click();
    await expect(visibleDetails).toHaveAttribute('open', '');
    await page.locator('main h1').first().click();
    await expect(visibleDetails).not.toHaveAttribute('open', '');

    await visibleSummary.click();
    await visibleDetails.locator('[data-testid="menu-my-account"]').click();
    await expect(page).toHaveURL(/\/conta$/);
  });

  test('3. GetSearchForm executa busca GET sem recarregamento completo de documento (ADR-445)', async ({
    page,
  }) => {
    await page.goto('/eventos');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      (window as unknown as { __f108SpaMarker?: string }).__f108SpaMarker = 'spa-ativo';
    });

    const searchForm = page.locator('[data-testid="events-search-form"]');
    const queryInput = searchForm.locator('input[name="q"]');
    await queryInput.fill('termo-f108');
    await queryInput.press('Enter');

    await expect(page).toHaveURL(/\/eventos\?.*q=termo-f108/);
    await expect(queryInput).toHaveValue('termo-f108');

    const marker = await page.evaluate(
      () => (window as unknown as { __f108SpaMarker?: string }).__f108SpaMarker,
    );
    expect(marker).toBe('spa-ativo');
  });
});


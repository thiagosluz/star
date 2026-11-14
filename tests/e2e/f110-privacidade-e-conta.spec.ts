import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
  signOut,
  uniqueEmail,
} from './helpers';

const ORIGEM = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const SENHA = 'SenhaF110!Segura2026';

let tenantId: string;
let tenantSlug: string;
let eventSlug: string;
let superAdminEmail: string;

async function cadastrarViaApi(
  api: APIRequestContext,
  nome: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f110');
  const res = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name: nome, email, password: SENHA },
  });
  expect(res.ok(), `sign-up ${email} respondeu ${res.status()}`).toBe(true);

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return { id: user.id, email };
}

async function entrarComo(page: Page, email: string): Promise<void> {
  await signOut(page, ORIGEM);
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGEM },
    data: { email, password: SENHA },
  });
  expect(res.ok(), `sign-in ${email} respondeu ${res.status()}`).toBe(true);
}

test.describe('FASE 110 — Privacidade, cookies reais, consentimento versionado e conta', () => {
  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    try {
      const tenant = await createTenant({
        label: 'f110-priv',
        name: 'Instituição Privacidade F110',
      });
      tenantId = tenant.id;
      tenantSlug = tenant.slug;

      const event = await createEvent({
        tenantId,
        slug: `simposio-f110-${Date.now().toString(36)}`,
        title: 'Simpósio de Privacidade F110',
        status: 'REGISTRATION_OPEN',
      });
      eventSlug = event.slug;

      await createActivity({
        tenantId,
        eventId: event.id,
        slug: 'aberta-f110',
        title: 'Mesa de abertura F110',
        requiresRegistration: false,
      });

      const superAdmin = await cadastrarViaApi(api, 'SuperAdmin F110');
      superAdminEmail = superAdmin.email;
      await grantPlatformRole({ userId: superAdmin.id, role: 'SUPERADMIN' });
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async () => {
    await cleanupRun();
    await e2eDb.$disconnect();
  });

  test('páginas públicas /privacidade, /termos e /acessibilidade respondem e estão ligadas no rodapé', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/privacidade');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacidade');
    await expect(page.getByTestId('privacy-inventory-version')).toContainText('2026.11-v1');
    await expect(page.getByTestId('inventory-preference-cookies')).toContainText('ef_tema');

    await page.getByRole('link', { name: 'Termos de uso' }).first().click();
    await expect(page).toHaveURL(/\/termos/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Termos de Uso');

    await page.getByRole('link', { name: 'Acessibilidade' }).first().click();
    await expect(page).toHaveURL(/\/acessibilidade/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Acessibilidade');
  });

  test('banner não-modal funciona em HTML e recusar preferências impede gravar ef_tema', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/');

    const banner = page.getByTestId('cookie-consent-banner');
    await expect(banner).toBeVisible();

    await page.getByTestId('cookie-consent-essential').click();
    await expect(banner).toBeHidden();

    // Tentar mudar o tema depois da recusa não grava `ef_tema` nem altera `data-tema`
    await expect(page.getByTestId('theme-preferences-disabled-notice')).toBeVisible();
    await page.getByTestId('theme-option-claro').click();
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'sistema');

    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === 'ef_tema')).toBe(false);
    expect(cookies.find((c) => c.name === 'ef_consentimento')?.value).toContain('ESSENTIAL_ONLY');

    // Aceitar preferências em /privacidade reativa o controle de tema
    await page.goto('/privacidade#cookies');
    await page.getByTestId('privacy-choose-all').click();
    await expect(page.getByTestId('theme-option-claro')).toBeEnabled();
    await page.getByTestId('theme-option-claro').click();
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');
  });

  test('inscrição grava snapshot versionado do consentimento visível em minhas-inscricoes', async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    let participantEmail = '';
    try {
      const user = await cadastrarViaApi(api, 'Participante Consentimento');
      participantEmail = user.email;
      await linkUser({ tenantId, userId: user.id, kind: 'PARTICIPANT' });
      await grantRole({ tenantId, userId: user.id, role: 'PARTICIPANT' });
    } finally {
      await api.dispose();
    }

    await page.context().clearCookies();
    await page.context().addCookies([
      { name: 'ef_consentimento', value: '2026.11-v1|ALL|e2e-consent', url: ORIGEM },
    ]);
    await entrarComo(page, participantEmail);

    await page.goto(`/t/${tenantSlug}/eventos/${eventSlug}/inscricao`);
    await page.locator('input[name="consentData"]').check();
    await page.getByRole('button', { name: 'Confirmar inscrição no evento' }).click();
    await expect(
      page.getByText(/Inscrição no evento confirmada!|Sua inscrição no evento está ativa/i),
    ).toBeVisible();

    await page.goto(`/t/${tenantSlug}/minhas-inscricoes`);
    const receipt = page.getByTestId('registration-consent-receipt').first();
    await expect(receipt).toContainText('2026.11-v1');
    await receipt.locator('summary').click();
    await expect(receipt).toContainText('Autorizo o tratamento dos meus dados pessoais');
  });

  test('/api/metrics mantém 404 sem token e /superadmin/metricas expõe alertas operacionais', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.context().addCookies([
      { name: 'ef_consentimento', value: '2026.11-v1|ALL|e2e-metrics', url: ORIGEM },
    ]);
    await entrarComo(page, superAdminEmail);

    // Em produção sem METRICS_TOKEN configurado, o endpoint segue fail-closed (404).
    // Os gauges Prometheus `eventflow_alert_firing` / `eventflow_alerts_firing_total` são
    // validados no Vitest com o token e exibidos ao SuperAdmin em /superadmin/metricas.
    const metricsRes = await page.request.get('/api/metrics');
    expect(metricsRes.status()).toBe(404);

    await page.goto('/superadmin/metricas');
    await expect(page.getByTestId('platform-operational-alerts')).toBeVisible();
    await expect(page.getByTestId('operational-alert-Http5xxSpike')).toBeVisible();
  });

  test('titular exclui a própria conta em /conta e perde acesso imediatamente', async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    let victimId = '';
    let victimEmail = '';
    try {
      const victim = await cadastrarViaApi(api, 'Titular Exclusão');
      victimId = victim.id;
      victimEmail = victim.email;
    } finally {
      await api.dispose();
    }

    await page.context().clearCookies();
    await page.context().addCookies([
      { name: 'ef_consentimento', value: '2026.11-v1|ALL|e2e-delete', url: ORIGEM },
    ]);
    await entrarComo(page, victimEmail);

    await page.goto('/conta');
    await expect(page.getByTestId('account-deletion-form')).toBeVisible();

    await page.getByTestId('account-delete-password').fill('SenhaErrada!');
    await page.getByTestId('account-delete-phrase').fill('EXCLUIR MINHA CONTA');
    await page.getByTestId('account-delete-submit').click();
    await expect(page.getByTestId('account-deletion-feedback-error')).toContainText('incorreta');

    await page.getByTestId('account-delete-password').fill(SENHA);
    await page.getByTestId('account-delete-phrase').fill('EXCLUIR MINHA CONTA');
    await page.getByTestId('account-delete-submit').click();

    await expect(page.getByTestId('account-deletion-done')).toBeVisible();

    const deletedUser = await e2eDb.user.findUniqueOrThrow({
      where: { id: victimId },
      select: { email: true, deletedAt: true, banned: true },
    });
    expect(deletedUser.deletedAt).not.toBeNull();
    expect(deletedUser.banned).toBe(true);
    expect(deletedUser.email).toBe(`deleted-${victimId}@anon.invalid`);
  });
});

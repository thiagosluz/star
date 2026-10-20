/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Vitrine Viva, Descoberta e Expansão Institucional (FASE 71)
 *
 *  Cobre:
 *    • Landing Page pública renovada (busca rápida, destaques, métricas);
 *    • Explorador unificado /eventos com abas e redirecionamento de /organizacoes;
 *    • Página pública /para-instituicoes e submissão de contato institucional;
 *    • Painel Superadmin /superadmin/leads com gestão de status e anotações.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, e2eDb, grantPlatformRole } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const superAdminEmail = `f71.super.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;
let superAdminId: string;

async function signUp(api: APIRequestContext, name: string, email: string): Promise<string> {
  const response = await api.post('/api/auth/sign-up/email', {
    data: { name, email, password: PASSWORD },
  });
  expect(response.ok(), `sign-up falhou: ${await response.text()}`).toBe(true);
  const data = (await response.json()) as { user: { id: string } };
  return data.user.id;
}

async function loginAs(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'));
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  try {
    superAdminId = await signUp(api, `SuperAdmin F71 ${RUN_ID}`, superAdminEmail);
    await grantPlatformRole({ userId: superAdminId });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun(RUN_ID);
  await e2eDb.institutionLead.deleteMany({
    where: { email: { contains: RUN_ID } },
  });
});

test.describe('Vitrine Viva e Expansão Institucional (FASE 71)', () => {
  test('1. Visitante navega na nova Landing Page e realiza busca rápida', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('[data-testid="platform-home-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="home-search-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="participant-journey-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="public-metrics-section"]')).toBeVisible();

    // Digita busca rápida e envia
    const searchInput = page.locator('input[name="q"]');
    await searchInput.fill('Tecnologia');
    await page.click('[data-testid="home-search-form"] button[type="submit"]');

    // É levado para /eventos?q=Tecnologia
    await page.waitForURL((url) => url.pathname === '/eventos' && url.searchParams.get('q') === 'Tecnologia');
    await expect(page.locator('[data-testid="unified-events-explorer"]')).toBeVisible();
  });

  test('2. Explorador unificado /eventos e redirecionamento de /organizacoes', async ({ page }) => {
    // Acessa /organizacoes e deve ser redirecionado para /eventos?aba=instituicoes
    await page.goto('/organizacoes');
    await page.waitForURL((url) => url.pathname === '/eventos' && url.searchParams.get('aba') === 'instituicoes');

    // Aba de instituições visível com diretório compatível
    await expect(page.locator('[data-testid="organizations-directory"]')).toBeVisible();

    // Clica na aba de eventos
    await page.click('[data-testid="tab-eventos"]');
    await page.waitForURL((url) => url.pathname === '/eventos' && (!url.searchParams.has('aba') || url.searchParams.get('aba') === 'eventos'));
    await expect(page.locator('[data-testid="events-search-form"]')).toBeVisible();
  });

  test('3. Visitante abre /para-instituicoes e envia formulário de lead', async ({ page }) => {
    await page.goto('/para-instituicoes');

    await expect(page.locator('[data-testid="para-instituicoes-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="differentials-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="plans-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="institution-lead-form"]')).toBeVisible();

    // Preenche o formulário
    await page.fill('#lead-name', `Reitor Dr. Roberto ${RUN_ID}`);
    await page.fill('#lead-email', `roberto.${RUN_ID}@universidade-e2e.test`);
    await page.fill('#lead-org', `Universidade Estadual de Testes ${RUN_ID}`);
    await page.fill('#lead-role', 'Reitor');
    await page.fill('#lead-phone', '(71) 98888-7777');
    await page.fill('#lead-message', 'Precisamos de credenciamento e submissão com urgência.');

    // Envia formulário
    await page.click('[data-testid="institution-lead-form"] button[type="submit"]');

    // Confirma feedback de sucesso
    await expect(page.locator('[data-testid="lead-form-success"]')).toBeVisible();
  });

  test('4. Superadmin acessa /superadmin/leads e gerencia o contato', async ({ page }) => {
    await loginAs(page, superAdminEmail);

    await page.goto('/superadmin/leads');
    await expect(page.locator('[data-testid="platform-leads-page"]')).toBeVisible();

    // Localiza o card do lead enviado no teste anterior
    const leadText = `Universidade Estadual de Testes ${RUN_ID}`;
    await expect(page.locator(`text=${leadText}`)).toBeVisible();

    // Atualiza anotações do lead
    const leadCard = page.locator(`article:has-text("${leadText}")`);
    const notesInput = leadCard.locator('textarea[name="notes"]');
    await notesInput.fill('Contato inicial realizado com a reitoria via E2E.');

    const statusSelect = leadCard.locator('select[name="status"]');
    await statusSelect.selectOption('CONTACTED');

    const submitBtn = leadCard.locator('button[type="submit"]');
    await submitBtn.click();

    // Verifica que o status atualizou para CONTACTED
    await expect(leadCard.locator('[data-testid^="lead-status-badge-"]')).toHaveText('Em contato');
  });
});

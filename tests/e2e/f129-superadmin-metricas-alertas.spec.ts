/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 129 — E2E: Painel Operacional de Alertas & Streaming em /superadmin/metricas
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  cleanupRun,
  e2eDb,
  grantPlatformRole,
  signOut,
  trackTestUser,
  uniqueEmail,
} from './helpers';

const ORIGEM = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const PASSWORD = 'Koveno#2026';

let superAdminEmail: string;

async function signUpSuperAdmin(api: APIRequestContext): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f129-superadmin');
  const res = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name: 'SuperAdmin F129', email, password: PASSWORD },
  });
  expect(res.ok(), `sign-up ${email} respondeu ${res.status()}`).toBe(true);

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  trackTestUser(user.id);
  return { id: user.id, email };
}

async function signInAsSuperAdmin(page: Page): Promise<void> {
  await signOut(page, ORIGEM);
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGEM },
    data: { email: superAdminEmail, password: PASSWORD },
  });
  expect(res.ok(), `sign-in ${superAdminEmail} respondeu ${res.status()}`).toBe(true);
}

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: ORIGEM });
  try {
    const admin = await signUpSuperAdmin(api);
    superAdminEmail = admin.email;
    await grantPlatformRole({ userId: admin.id, role: 'SUPERADMIN' });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 129 — Painel Operacional de Alertas em /superadmin/metricas', () => {
  test('exibe grupos semânticos, títulos em português, detalhes Prometheus recolhidos e data pt-BR', async ({
    page,
  }) => {
    await signInAsSuperAdmin(page);
    await page.goto('/superadmin/metricas');

    const alertsSection = page.getByTestId('platform-operational-alerts');
    await expect(alertsSection).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId('operational-alert-group-queue')).toContainText('Filas & Workers');
    await expect(page.getByTestId('operational-alert-group-web')).toContainText(
      'Aplicação & Segurança',
    );

    const queueDownRow = page.getByTestId('operational-alert-BullMQQueueDown');
    await expect(queueDownRow).toContainText('Conexão da fila com Redis');

    const details = page.getByTestId('operational-alert-details-Http5xxSpike');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(details).toContainText('http_requests_total');

    await expect(page.getByTestId('metrics-generated-at')).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  });

  test('permite atualizar leitura sob demanda e navegar do alerta de fila para /superadmin/rotinas', async ({
    page,
  }) => {
    await signInAsSuperAdmin(page);
    await page.goto('/superadmin/metricas');

    const refreshBtn = page.getByTestId('refresh-metrics-button');
    await expect(refreshBtn).toBeVisible({ timeout: 20_000 });
    await refreshBtn.click();
    await expect(page.getByTestId('platform-operational-alerts')).toBeVisible();

    await page.getByTestId('operational-alert-action-BullMQQueueDown').click();
    await expect(page).toHaveURL(/\/superadmin\/rotinas/);
  });
});

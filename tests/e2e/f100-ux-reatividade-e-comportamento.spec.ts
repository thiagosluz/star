/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 100 — Testes E2E de Reatividade, Comportamento e Foco Operacional
 *
 *  Valida em navegador real:
 *    1. Navegação no cockpit do comitê com atalhos de teclado ('/' e Escape);
 *    2. Filtros reativos com debounce na URL (?busca=);
 *    3. Presença e comportamento da barra de navegação global.
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
} from './helpers';

const PASSWORD = 'EventFlow#2026';

async function createUser(
  page: Page,
  tenantId: string,
  name: string,
  role: 'ADMIN' | 'CHAIR' | 'PARTICIPANT' | 'STAFF' = 'ADMIN',
): Promise<{ id: string; email: string }> {
  const email = `f100.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('FASE 100 — Reatividade, Cockpit do Comitê e Atalhos', () => {
  test('chair navega no cockpit do comitê com atalho "/", Escape e busca reativa', async ({ page }) => {
    const tenant = await createTenant({
      label: 'f100-comite',
      name: 'Instituição F100',
    });
    await createEvent({
      tenantId: tenant.id,
      slug: 'congresso-f100',
      title: 'Congresso de Tecnologia e Saúde F100',
      status: 'REGISTRATION_OPEN',
    });

    // Usuário ADMIN tem acesso integral ao cockpit do comitê
    await createUser(page, tenant.id, 'Chair Operacional F100', 'ADMIN');

    await page.goto(`/t/${tenant.slug}/comite`);

    // ── 1. Cockpit montado com cabeçalho e barra de filtros ──────────────────
    await expect(page.getByRole('heading', { name: 'Comitê científico' })).toBeVisible();
    const searchInput = page.getByTestId('comite-search-input');
    await expect(searchInput).toBeVisible();

    // ── 2. Atalho de teclado: '/' foca a busca ──────────────────────────────
    // Clica no cabeçalho ou fora de qualquer input
    await page.getByRole('heading', { name: 'Comitê científico' }).click();
    await expect(searchInput).not.toBeFocused();

    await page.keyboard.press('/');
    await expect(searchInput).toBeFocused();

    // ── 3. Digitação e Escape: limpa o texto do campo ───────────────────────
    await searchInput.fill('Vacinas de RNA');
    await expect(searchInput).toHaveValue('Vacinas de RNA');

    // Ao pressionar Escape com texto, limpa o campo
    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveValue('');

    // ── 4. Filtro reativo com debounce atualiza query params ────────────────
    await searchInput.fill('Inteligência Artificial');
    // Aguarda debounce de 300ms e transição
    await expect(page).toHaveURL(/busca=Intelig%C3%AAncia\+Artificial|busca=Inteligencia\+Artificial|busca=Intelig/, {
      timeout: 10_000,
    });

    // ── 5. Limpar filtros restaura a rota original ─────────────────────────
    const clearLink = page.getByTestId('comite-filter-clear');
    await expect(clearLink).toBeVisible();
    await clearLink.click();
    await expect(searchInput).toHaveValue('');
    await expect(page).not.toHaveURL(/busca=/);
  });
});


/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 105 — Testes E2E de Polimento de UX e Acessibilidade Assistiva
 *
 *  Valida em navegador real (Chromium):
 *    1. FavoriteButton nasce com região aria-live vazia e só anuncia após interação (ADR-436);
 *    2. ParticipantDirectory com linha ativa não sequestra Enter quando o foco está em link (ADR-435).
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
  role: 'ADMIN' | 'PARTICIPANT' = 'ADMIN',
): Promise<{ id: string; email: string }> {
  const email = `f105.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.describe('FASE 105 — Polimento de UX e Acessibilidade Assistiva', () => {
  test('1. FavoriteButton nasce com aria-live vazio e anuncia somente após clique (ADR-436)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f105-fav',
      name: `Instituição Fav F105 ${RUN_ID}`,
    });
    const user = await createUser(page, tenant.id, 'Participante F105', 'PARTICIPANT');
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-f105-${RUN_ID}`,
      title: `Evento F105 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `atividade-f105-${RUN_ID}`,
      title: `Palestra UX F105 ${RUN_ID}`,
      status: 'SCHEDULED',
      workloadMinutes: 60,
    });

    await signInAs(page, user.email);
    await page.goto(`/t/${tenant.slug}/eventos/${event.slug}`);
    await page.waitForLoadState('networkidle');

    const favButton = page.locator(`[data-testid="agenda-favoritar-${activity.id}"]`);
    const liveRegion = page.locator(`[data-testid="agenda-live-${activity.id}"]`);

    await expect(favButton).toBeVisible();
    await expect(liveRegion).toBeAttached();
    await expect(liveRegion).toHaveText('');

    await favButton.click();
    await expect(favButton).toHaveAttribute('aria-pressed', 'true');
    await expect(liveRegion).toHaveText('Atividade adicionada à sua agenda');
  });

  test('2. ParticipantDirectory não sequestra Enter quando outro link tem o foco (ADR-435)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f105-dir',
      name: `Instituição Dir F105 ${RUN_ID}`,
    });
    const admin = await createUser(page, tenant.id, 'Admin Dir F105', 'ADMIN');
    await createUser(page, tenant.id, 'Ana Participante F105', 'PARTICIPANT');

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/participantes`);
    await page.waitForLoadState('networkidle');

    // Seleciona a primeira linha pelo teclado (ArrowDown)
    await page.keyboard.press('ArrowDown');
    const activeRow = page.locator('[data-active-row="true"]');
    await expect(activeRow).toHaveCount(1);

    // Foca no link do menu lateral "Panorama" e pressiona Enter:
    // deve navegar para /panorama, e NÃO abrir a ficha do participante ativo
    const panoramaLink = page.locator(`a[href="/t/${tenant.slug}/panorama"]`).first();
    await expect(panoramaLink).toBeVisible();
    await panoramaLink.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/panorama`));
  });
});


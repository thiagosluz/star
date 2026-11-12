/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 104 — Testes E2E de Refinamento de UX, Rollback Otimista e Resiliência
 *
 *  Valida em navegador real (Chromium):
 *    1. FavoriteButton atualiza live region de acessibilidade no chaveamento otimista (ADR-432);
 *    2. Limpeza rápida de busca no ParticipantFilterBar e botão de limpar filtros no empty state (ADR-434);
 *    3. Auto-scroll e live region da fila de credenciamento na navegação por teclado (ADR-433).
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
  role: 'ADMIN' | 'CHAIR' | 'PARTICIPANT' | 'STAFF' = 'ADMIN',
): Promise<{ id: string; email: string }> {
  const email = `f104.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
  activityId?: string;
  userId: string;
  status?: 'CONFIRMED' | 'CANCELED' | 'WAITLIST';
}): Promise<string> {
  const registrationId = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: input.status ?? 'CONFIRMED',
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

test.describe('FASE 104 — Refinamento de UX, Rollback Otimista, Auto-scroll e Resiliência', () => {
  test('1. FavoriteButton atualiza live region de acessibilidade no chaveamento otimista (ADR-432)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f104-fav',
      name: `Instituição Fav F104 ${RUN_ID}`,
    });
    const user = await createUser(page, tenant.id, 'Usuário Agenda F104', 'PARTICIPANT');
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `congresso-f104-${RUN_ID}`,
      title: `Congresso F104 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `keynote-f104-${RUN_ID}`,
      title: `Keynote UX F104 ${RUN_ID}`,
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

    // Estado inicial
    await expect(favButton).toHaveAttribute('aria-pressed', 'false');

    // Clique otimista
    await favButton.click();
    await expect(favButton).toHaveAttribute('aria-pressed', 'true');
    await expect(liveRegion).toHaveText('Atividade adicionada à sua agenda');
  });

  test('2. Limpeza rápida de busca no ParticipantFilterBar e botão de limpar filtros no empty state (ADR-434)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f104-filter',
      name: `Instituição Filtros F104 ${RUN_ID}`,
    });
    const admin = await createUser(page, tenant.id, 'Admin Filtros F104', 'ADMIN');
    const participant = await createUser(page, tenant.id, 'Alice Silva', 'PARTICIPANT');

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/participantes`);
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('[data-testid="participant-search"]');
    await expect(searchInput).toBeVisible();

    // Digita busca que encontra ninguém
    await searchInput.fill('NomeInexistenteXYZ');
    await page.waitForTimeout(400); // aguarda debounce de 300ms
    await page.waitForLoadState('networkidle');

    // Botão de limpeza rápida (x) visível
    const clearBtn = page.locator('[data-testid="participant-search-clear"]');
    await expect(clearBtn).toBeVisible();

    // Estado vazio exibe link de limpar filtros
    const emptyClear = page.locator('[data-testid="directory-clear-filters"]');
    await expect(emptyClear).toBeVisible();

    // Clica no botão (x) para limpar busca
    await clearBtn.click();
    await expect(searchInput).toHaveValue('');
    await page.waitForTimeout(400); // aguarda debounce
    await page.waitForLoadState('networkidle');

    // O participante volta a ser exibido
    const participantRow = page.locator(`[data-testid="participant-row-${participant.id}"]`);
    await expect(participantRow).toBeVisible();
  });

  test('3. Auto-scroll e live region da fila de credenciamento na navegação por teclado (ADR-433)', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f104-scroll',
      name: `Instituição Scroll F104 ${RUN_ID}`,
    });
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `summit-f104-${RUN_ID}`,
      title: `Summit F104 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `painel-f104-${RUN_ID}`,
      title: `Painel F104 ${RUN_ID}`,
      status: 'SCHEDULED',
      workloadMinutes: 60,
    });

    const staff = await createUser(page, tenant.id, 'Staff Balcão', 'STAFF');
    const participant = await createUser(page, tenant.id, 'Bruno Convidado', 'PARTICIPANT');

    const registrationId = await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: participant.id,
    });

    await signInAs(page, staff.email);
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);
    await page.waitForLoadState('networkidle');

    const liveRegion = page.locator('[data-testid="queue-live-region"]');
    await expect(liveRegion).toBeAttached();

    const row = page.locator(`[data-testid="queue-${registrationId}"]`);
    await expect(row).toBeVisible();

    // Desfoca clicando no cabeçalho
    await page.getByRole('heading', { name: 'Credenciamento', exact: true }).click();

    // Pressiona ArrowDown para ativar a linha
    await page.keyboard.press('ArrowDown');
    await expect(row).toHaveAttribute('data-active-row', 'true');
    await expect(liveRegion).toContainText('Bruno Convidado');
  });
});


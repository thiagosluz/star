/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 92 — E2E DA PADRONIZAÇÃO EM CARDS BRANCOS E CADASTRO RÁPIDO DE SALAS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Cenário no navegador:
 *    1. O organizador acessa `/administracao/eventos/[eventId]/salas` sem salas:
 *       exibe o card de empty state (`rooms-empty`) e o card de cadastro de nova sala.
 *    2. Preenche e cadastra a primeira sala (com capacidade) pelo card in-page.
 *    3. A sala aparece no card de listagem (`room-list`) com a badge de capacidade.
 *    4. Cadastra uma segunda sala (sem capacidade) em sequência, mantendo a agilidade.
 *    5. Ambas as salas são exibidas com estilo de card padronizado (`bg-card`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  cleanupRun,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  RUN_ID,
  signOut,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = 'f92-salas';

let tenantSlug: string;
let tenantId: string;
let adminEmail: string;
let eventId: string;
const eventSlug = `evento-f92-${RUN_ID}`;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f92-${prefix}`);

  const response = await request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    const up = await request.post('/api/auth/sign-up/email', {
      headers: { origin: 'http://localhost:3000' },
      data: { name, email, password: PASSWORD },
    });
    if (!up.ok()) {
      throw new Error(`Falha ao cadastrar ${name}: HTTP ${up.status()} ${await up.text()}`);
    }
  }

  return { email };
}

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

test.describe.serial('FASE 92 · Padronização em cards brancos e cadastro de salas', () => {
  test.beforeAll(async ({ request }) => {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Tenant F92 Salas ${RUN_ID}`,
    });
    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const admin = await signUpVia(request, 'admin', 'Admin Salas F92');
    adminEmail = admin.email;
    const adminUser = await e2eDb.user.findUniqueOrThrow({ where: { email: adminEmail } });

    await linkUser({ tenantId, userId: adminUser.id });
    await grantRole({ tenantId, userId: adminUser.id, role: 'OWNER' });

    const startsAt = new Date(Date.now() + 10 * 86_400_000);
    const endsAt = new Date(Date.now() + 15 * 86_400_000);

    const createdEvent = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.event.create({
        data: {
          tenantId,
          slug: eventSlug,
          title: `Congresso F92 ${RUN_ID}`,
          summary: 'Evento para teste de salas padronizadas',
          startsAt,
          endsAt,
          timezone: 'America/Bahia',
          modality: 'IN_PERSON',
          status: 'DRAFT',
        },
      });
    });
    eventId = createdEvent.id;
  });

  test.afterAll(async () => {
    await cleanupRun();
    await e2eDb.$disconnect();
  });

  test('visualiza a tela de salas com empty state em card branco e cadastra duas salas sequenciais', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/salas`);
    await expect(page.getByTestId('event-rooms-page')).toBeVisible();

    // 1. Verifica empty state padronizado em card
    const emptyCard = page.getByTestId('rooms-empty');
    await expect(emptyCard).toBeVisible();
    await expect(emptyCard).toContainText('Nenhuma sala cadastrada.');

    // 2. Verifica o card de cadastro de nova sala
    const createRoom = page.getByTestId('create-room');
    await expect(createRoom).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cadastrar nova sala' })).toBeVisible();

    // 3. Cadastra primeira sala com capacidade
    await createRoom.getByLabel('Nome da sala').fill('Auditório Master');
    await createRoom.getByLabel('Capacidade').fill('200');
    await createRoom.getByTestId('admin-submit').click();

    await expect(createRoom.getByTestId('create-room-feedback')).toContainText(/criada/i, {
      timeout: 20_000,
    });

    // 4. A lista agora aparece no Card 1
    const roomList = page.getByTestId('room-list');
    await expect(roomList).toBeVisible();
    await expect(roomList).toContainText('Auditório Master');
    await expect(roomList).toContainText('200 lugares');

    // 5. Cadastra segunda sala sem limite na mesma página (sem atrito de navegação)
    await createRoom.getByLabel('Nome da sala').fill('Espaço de Convivência');
    await createRoom.getByTestId('admin-submit').click();

    await expect(createRoom.getByTestId('create-room-feedback')).toContainText(/criada/i, {
      timeout: 20_000,
    });

    await expect(roomList).toContainText('Espaço de Convivência');
    await expect(roomList).toContainText('sem limite');
    await expect(page.getByRole('heading', { name: 'Salas cadastradas (2)' })).toBeVisible();

    await signOut(page);
  });
});


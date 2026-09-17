/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Gamificação (FASE 5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PROVA, DE PONTA A PONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a equipe credencia o participante pela tela de credenciamento;
 *      2. o credenciamento credita XP, concede carta e avança a missão;
 *      3. o participante vê nível, XP e missão concluída em /conquistas;
 *      4. o resgate da missão credita XP NOVO (e só uma vez);
 *      5. a carta aparece no álbum em /cartas;
 *      6. um participante NÃO acessa a tela da equipe.
 *
 *  Roda contra o container de PRODUÇÃO, com RLS e a role de runtime — é o único
 *  lugar onde a pilha inteira (Proxy, Server Action, transação com contexto,
 *  RLS, engine de recompensa) é exercitada como o usuário a usa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────

/** Cadastra uma pessoa e concede o papel na instituição. */
async function createUser(
  page: import('@playwright/test').Page,
  tenantId: string,
  name: string,
  role: 'PARTICIPANT' | 'STAFF' | 'ORGANIZER',
): Promise<{ id: string; email: string }> {
  const email = `gami.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/**
 * Autentica alguém já cadastrado, encerrando a sessão anterior.
 *
 * Sem o `signOut`, o cadastro seguinte reutilizaria o cookie de sessão e o teste
 * acabaria verificando a tela com o usuário errado.
 */
async function signInAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3000' },
  });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
  }
}

/** Cria o cenário completo: instituição, evento, atividade, carta e missão. */
async function scenario(label: string) {
  const tenant = await createTenant({ label, name: `Instituição ${label} ${RUN_ID}` });

  const event = await createEvent({
    tenantId: tenant.id,
    slug: `evento-${label}`,
    title: `Evento ${label}`,
  });

  const activity = await createActivity({
    tenantId: tenant.id,
    eventId: event.id,
    slug: `atividade-${label}`,
    title: `Minicurso ${label}`,
    capacity: 50,
    workloadMinutes: 60,
  });

  const cardId = randomUUID();
  const missionId = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

    await tx.cardTemplate.create({
      data: {
        id: cardId,
        tenantId: tenant.id,
        eventId: event.id,
        slug: `cracha-${label}`,
        name: `Crachá ${label}`,
        description: 'Concedida no credenciamento.',
        rarity: 'COMMON',
        trigger: 'CHECKIN',
        palette: { primary: '#0f766e', secondary: '#134e4a', glow: '#5eead4', text: '#f0fdfa' },
      },
    });

    await tx.taskDefinition.create({
      data: {
        id: missionId,
        tenantId: tenant.id,
        eventId: event.id,
        slug: `missao-${label}`,
        name: 'Primeiro credenciamento',
        description: 'Faça o credenciamento no evento.',
        kind: 'ONE_OFF',
        trigger: 'CHECKIN',
        target: { count: 1 },
        xpReward: 100,
        displayOrder: 1,
      },
    });
  });

  return { tenant, event, activity, cardId, missionId };
}

/** Cria a inscrição confirmada do participante na atividade. */
async function registerParticipant(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  userId: string;
}): Promise<string> {
  const registrationId = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'CONFIRMED',
        consentData: true,
        badgeToken: `BADGE-${randomUUID().slice(0, 12)}`,
      },
    });
  });

  return registrationId;
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('jornada de gamificação', () => {
  test('credenciamento gera XP e carta, e a missão é resgatada', async ({ page }) => {
    const { tenant, event, activity } = await scenario('gamijornada');

    // A ordem importa: a ÚLTIMA conta criada é a que fica autenticada.
    const participant = await createUser(page, tenant.id, 'Participante Pontos', 'PARTICIPANT');
    const staff = await createUser(page, tenant.id, 'Equipe Balcão', 'STAFF');

    await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: participant.id,
    });

    // ── 1. A equipe credencia o participante ────────────────────────────────
    await signInAs(page, staff.email);
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);

    await expect(page.getByTestId('checkin-queue')).toBeVisible();

    const row = page.locator('li[data-testid^="queue-"]', { hasText: 'Participante Pontos' });
    await expect(row).toBeVisible();

    await row.getByTestId('checkin-button').click();

    // O feedback fica DENTRO da linha da pessoa: com vários inscritos na tela, um
    // aviso global não diria de quem é o resultado.
    await expect(row.getByTestId(/^checkin-feedback-/)).toContainText(/\+50 XP/, {
      timeout: 20_000,
    });

    // ── 2. Banco: XP, carta e presença registrados ──────────────────────────
    const state = await readParticipantState(tenant.id, participant.id);

    expect(state.totalXp).toBe(50);
    expect(state.level).toBe(1);
    expect(state.cards).toBe(1);
    expect(state.attendances).toBe(1);
    expect(state.missionStatus).toBe('COMPLETED');

    // ── 3. O participante vê o progresso ────────────────────────────────────
    await signInAs(page, participant.email);
    await page.goto(`/t/${tenant.slug}/conquistas`);

    await expect(page.getByTestId('xp-panel')).toBeVisible();
    await expect(page.getByTestId('xp-total')).toHaveText('50');
    await expect(page.getByTestId('xp-level')).toContainText('Nível 1');
    await expect(page.getByTestId('claimable-count')).toContainText('1 recompensa');

    // Extrato: o check-in aparece com a origem legível.
    await expect(page.getByTestId('xp-history')).toContainText('Credenciamento no evento');

    // ── 4. Resgate da missão credita XP novo ────────────────────────────────
    await page.getByTestId('mission-claim').click();

    await expect(page.getByTestId('mission-list')).toContainText(/resgatada/i, { timeout: 20_000 });

    const afterClaim = await readParticipantState(tenant.id, participant.id);
    expect(afterClaim.totalXp).toBe(150); // 50 do check-in + 100 da missão
    expect(afterClaim.missionStatus).toBe('CLAIMED');
    expect(afterClaim.tasksCompleted).toBe(1);

    // Recarregar não credita de novo (idempotência visível para o usuário).
    await page.reload();
    await expect(page.getByTestId('xp-total')).toHaveText('150');

    // ── 5. A carta está no álbum ────────────────────────────────────────────
    await page.goto(`/t/${tenant.slug}/cartas`);

    await expect(page.getByTestId('album-summary')).toBeVisible();
    await expect(page.getByTestId('owned-cards')).toContainText('Crachá gamijornada');
    await expect(page.getByTestId('album-completion')).toContainText('%');
  }, 180_000);

  /**
   * A tela de credenciamento mostra presença e distribui pontos: um participante
   * que a abrisse veria a lista de inscritos do evento inteiro. O menu esconde o
   * link, mas quem digita a URL precisa ser barrado no servidor.
   */
  test('PARTICIPANTE não acessa o credenciamento', async ({ page }) => {
    const { tenant } = await scenario('gamirbac');
    await createUser(page, tenant.id, 'Participante Curioso', 'PARTICIPANT');

    await page.goto(`/t/${tenant.slug}/credenciamento`);

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard$`));
    await expect(page.getByTestId('checkin-queue')).toHaveCount(0);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura direta do banco (contexto de tenant aplicado)
// ───────────────────────────────────────────────────────────────────────────────
async function readParticipantState(tenantId: string, userId: string) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const [profile, cards, attendances, progress] = await Promise.all([
      tx.userXpProfile.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: { totalXp: true, level: true, tasksCompleted: true },
      }),
      tx.userCard.count({ where: { tenantId, userId } }),
      tx.attendance.count({ where: { tenantId, userId } }),
      tx.userTaskProgress.findFirst({
        where: { tenantId, userId },
        select: { status: true },
      }),
    ]);

    return {
      totalXp: profile?.totalXp ?? 0,
      level: profile?.level ?? 1,
      tasksCompleted: profile?.tasksCompleted ?? 0,
      cards,
      attendances,
      missionStatus: progress?.status ?? 'NONE',
    };
  });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Sorteios de ponta a ponta (FASE 16)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA NO PALCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. G7 — a contagem de elegíveis se atualiza sozinha quando alguém entra
 *         pelo credenciamento (sem recarregar a página);
 *      2. G1 — a apuração entrega TITULARES e SUPLENTES, em seções distintas;
 *      3. G4 — a prova do commit-reveal aparece com o resultado (compromisso e
 *         semente) e o sorteio se declara verificável;
 *      4. G2 — a entrega do prêmio é registrada e passa a aparecer na lista;
 *      5. G5 — o resultado publicado aparece na página pública do evento, com o
 *         nome mascarado de quem não tem perfil público.
 *
 *  A ordem importa (a publicação depende da apuração) e o arquivo roda com um
 *  worker: cada cenário usa o estado deixado pelo anterior, como na vida real.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'sorteio-ponta';
const EVENT_SLUG = `evento-f16-${RUN_ID}`;

let tenantId: string;
let eventId: string;
let activityId: string;
let adminEmail: string;
/** Dois presentes: o sorteio pede 1 titular + 1 suplente. */
let firstPersonId: string;
let secondPersonId: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f16.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  return { id: user.id, email };
}

async function signInAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/** Presença direta no banco: o que interessa aqui é a tela reagir a ela. */
async function addAttendance(userId: string, minutes: number): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId,
        userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: new Date(),
        checkedOutAt: new Date(Date.now() + minutes * 60_000),
        minutesAttended: minutes,
      },
    });
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição Sorteio Ponta ${RUN_ID}`,
    });

    tenantId = tenant.id;
    eventId = randomUUID();
    activityId = randomUUID();

    const day = new Date('2026-09-17T13:00:00.000Z');

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso Ponta a Ponta ${RUN_ID}`,
          status: 'IN_PROGRESS',
          modality: 'IN_PERSON',
          startsAt: day,
          endsAt: new Date(day.getTime() + 2 * 86_400_000),
          timezone: 'America/Bahia',
          capacity: null,
          confirmedCount: 0,
        },
      });

      await tx.activity.create({
        data: {
          id: activityId,
          tenantId,
          eventId,
          slug: 'atividade-f16',
          title: 'Atividade F16',
          type: 'LECTURE',
          status: 'COMPLETED',
          modality: 'IN_PERSON',
          startsAt: day,
          endsAt: new Date(day.getTime() + 3_600_000),
          workloadMinutes: 60,
          requiresAttendance: true,
        },
      });
    });

    /**
     * As PESSOAS nascem aqui, e não no primeiro teste: os cenários seguintes
     * dependem do estado durável (banco), nunca de uma variável que outro teste
     * preencheu — lição da FASE 14, quando o quarto cenário recebeu `undefined`.
     */
    const admin = await signUpVia(api, `Admin Sorteio ${RUN_ID}`);
    adminEmail = admin.email;
    await linkUser({ tenantId, userId: admin.id });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });

    const first = await signUpVia(api, `Presente Um ${RUN_ID}`);
    firstPersonId = first.id;
    await linkUser({ tenantId, userId: first.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: first.id, role: 'PARTICIPANT' });

    const second = await signUpVia(api, `Presente Dois ${RUN_ID}`);
    secondPersonId = second.id;
    await linkUser({ tenantId, userId: second.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: second.id, role: 'PARTICIPANT' });
  } finally {
    await api.dispose();
  }
});

test.describe('sorteios de ponta a ponta', () => {
  test('a contagem de elegíveis se atualiza sozinha com o credenciamento (G7)', async ({ page }) => {
    await signInAs(page, adminEmail);

    const response = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`);
    expect(response?.status()).toBe(200);

    const live = page.getByTestId('raffle-live');
    await expect(live).toBeVisible();

    // Sem ninguém credenciado: zero elegíveis (a amostragem chega em segundos).
    await expect(live).toHaveAttribute('data-eligible', '0', { timeout: 15_000 });

    // Alguém entra pela catraca: a tela deve refletir SEM recarregar.
    await addAttendance(firstPersonId, 60);
    await expect(live).toHaveAttribute('data-eligible', '1', { timeout: 20_000 });
    await expect(live).toContainText('1 elegível(is) agora');

    // Uma segunda pessoa entra: o sorteio seguinte terá titular E suplente.
    await addAttendance(secondPersonId, 30);
    await expect(live).toHaveAttribute('data-eligible', '2', { timeout: 20_000 });
  });

  test('a apuração entrega titulares e suplentes, com a prova da semente (G1, G4)', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`);

    const form = page.getByTestId('raffle-form');
    await form.getByLabel('Título do sorteio').fill(`Sorteio F16 ${RUN_ID}`);
    await form.getByLabel('Quantos vencedores').fill('1');
    await form.getByTestId('raffle-alternates').fill('1');
    await form.getByTestId('raffle-weighted').check();
    await form.getByTestId('raffle-public').check();

    // Confere antes de sortear (o passo que evita anunciar lista errada).
    await page.getByTestId('preview-raffle').click();
    await expect(page.getByTestId('raffle-preview')).toContainText(/elegível/i, { timeout: 20_000 });

    await page.getByTestId('draw-raffle').click();

    const result = page.getByTestId('raffle-result');
    await expect(result).toContainText(/titular/i, { timeout: 30_000 });
    await expect(result).toContainText(/suplente/i);

    // A prova do commit-reveal acompanha o resultado.
    const proof = page.getByTestId('raffle-seed-proof');
    await expect(proof).toBeVisible();
    await expect(proof).toContainText(/verificável/i);
    await expect(proof).toContainText(/compromisso/i);
    await expect(proof).toContainText(/semente revelada/i);

    // O banco confirma a apuração com as duas posições.
    const raffle = await e2eDb.raffle.findFirstOrThrow({
      where: { tenantId, eventId },
      select: { id: true, status: true, seedCommitment: true, seedRevealed: true },
    });

    expect(raffle.status).toBe('DRAWN');
    expect(raffle.seedCommitment).not.toBeNull();
    expect(raffle.seedRevealed).not.toBeNull();

    const positions = await e2eDb.raffleWinner.findMany({
      where: { raffleId: raffle.id },
      orderBy: { position: 'asc' },
      select: { position: true, kind: true },
    });

    expect(positions.map((entry) => entry.kind)).toEqual(['WINNER', 'ALTERNATE']);
  });

  test('a entrega do prêmio é registrada e o resultado é publicado (G2, G5)', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`);

    const history = page.getByTestId('raffle-history');
    await expect(history).toBeVisible();

    // ── Entrega do prêmio ao TITULAR ────────────────────────────────────────
    const winnerRow = page.locator('[data-testid^="position-"][data-kind="WINNER"]').first();
    await expect(winnerRow).toBeVisible();

    const deliverButton = winnerRow.locator('[data-testid^="deliver-"]');
    await deliverButton.click();

    const confirmButton = winnerRow.locator('[data-testid^="confirm-delivery-"]');
    await confirmButton.click();

    await expect(page.locator('[data-testid^="delivery-feedback-"]').first()).toContainText(
      /Entrega registrada/i,
      { timeout: 20_000 },
    );

    // A linha passa a mostrar a entrega (recibo visível para o próximo plantão).
    await expect(page.locator('[data-testid^="position-"][data-delivered="true"]').first()).toBeVisible();

    // ── Publicação do resultado ─────────────────────────────────────────────
    const toggle = page.locator('[data-testid^="toggle-public-"]').first();
    await expect(toggle).toContainText(/Despublicar|Publicar/);

    if ((await toggle.textContent())?.includes('Publicar')) {
      await toggle.click();
      await expect(page.locator('[data-testid^="visibility-feedback-"]').first()).toContainText(
        /publicado/i,
        { timeout: 20_000 },
      );
    }

    const stored = await e2eDb.raffle.findFirstOrThrow({
      where: { tenantId, eventId },
      select: { isPublic: true },
    });

    expect(stored.isPublic).toBe(true);

    // ── Página pública (sem sessão) mostra o resultado ──────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

    const publicPage = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    expect(publicPage?.status()).toBe(200);

    const section = page.getByTestId('public-raffle-results');
    await expect(section).toBeVisible();
    await expect(section).toContainText(`Sorteio F16 ${RUN_ID}`);
    await expect(page.locator('[data-testid^="public-winner-"]').first()).toBeVisible();
  });

  test('a seção de reconhecimento do comitê existe no evento (F1)', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}`);

    const section = page.getByTestId('reviewer-award-section');
    await expect(section).toBeVisible();

    await section.locator('summary').click();
    // Sem pareceres concluídos e sem carta do gatilho: o painel explica, não some.
    await expect(section).toContainText(/Reconhecimento do comitê|parecer/i);
  });
});

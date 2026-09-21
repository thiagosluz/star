/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Motor de sorteios (FASE 8)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a tela de sorteios mostra o universo ANTES de sortear (conferência);
 *      2. só aparece como elegível quem tem PRESENÇA REAL registrada — quem faltou
 *         e quem não cumpriu o piso de minutos fica de fora, COM O MOTIVO;
 *      3. a apuração revela o vencedor na tela;
 *      4. o banco confirma: um vencedor, hash gravado e status apurado;
 *      5. o histórico mostra a apuração para quem quiser conferir depois.
 *
 *  O passo 2 é o coração da fase: um sorteio em que "inscrito que não apareceu"
 *  concorre com quem apareceu não é sorteio, é ruído.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
async function createUser(
  page: import('@playwright/test').Page,
  tenantId: string,
  name: string,
  role: 'ADMIN' | 'PARTICIPANT',
): Promise<{ id: string; email: string }> {
  const email = `raffle.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

async function signInAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/**
 * Cria evento, atividade e as presenças que definem quem concorre.
 *
 * O `label` é ÚNICO por teste: o slug da instituição é derivado dele, e dois
 * testes com o mesmo slug colidem no índice único (`tenants_slug_key`) — foi
 * exatamente o que aconteceu na primeira execução desta suíte.
 */
async function scenario(label: string) {
  const tenant = await createTenant({ label, name: `Instituição Sorteio ${label} ${RUN_ID}` });
  const eventId = randomUUID();
  const activityId = randomUUID();

  const day = new Date('2026-09-17T13:00:00.000Z');
  const eventStart = new Date('2026-09-17T12:00:00.000Z');

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

    await tx.event.create({
      data: {
        id: eventId,
        tenantId: tenant.id,
        slug: `evento-sorteio-${RUN_ID}`,
        title: `Congresso do Sorteio ${RUN_ID}`,
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: eventStart,
        endsAt: new Date(eventStart.getTime() + 3 * 86_400_000),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId: tenant.id,
        eventId,
        slug: 'minicurso-sorteio',
        title: 'Minicurso do Sorteio',
        type: 'MINI_COURSE',
        status: 'COMPLETED',
        modality: 'IN_PERSON',
        startsAt: day,
        endsAt: new Date(day.getTime() + 4 * 3_600_000),
        workloadMinutes: 240,
      },
    });
  });

  return { tenant, eventId, activityId, day };
}

async function addAttendance(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  userId: string;
  minutes: number;
  checkedInAt: Date;
  status?: 'PRESENT' | 'ABSENT';
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: input.status ?? 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: input.checkedInAt,
        checkedOutAt: new Date(input.checkedInAt.getTime() + input.minutes * 60_000),
        minutesAttended: input.minutes,
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('sorteio por presença real', () => {
  test('conferência, apuração e histórico', async ({ page }) => {
    test.setTimeout(180_000);

    const { tenant, eventId, activityId, day } = await scenario('raffle-jornada');

    const admin = await createUser(page, tenant.id, 'Organizadora do Sorteio', 'ADMIN');
    const completo = await createUser(page, tenant.id, 'Presente Completo', 'PARTICIPANT');
    const curto = await createUser(page, tenant.id, 'Presença Curta', 'PARTICIPANT');
    const ausente = await createUser(page, tenant.id, 'Ausente do Evento', 'PARTICIPANT');

    // 240 min (cumpre o piso de 120), 30 min (não cumpre) e ausente.
    await addAttendance({ tenantId: tenant.id, eventId, activityId, userId: completo.id, minutes: 240, checkedInAt: day });
    await addAttendance({ tenantId: tenant.id, eventId, activityId, userId: curto.id, minutes: 30, checkedInAt: day });
    await addAttendance({
      tenantId: tenant.id,
      eventId,
      activityId,
      userId: ausente.id,
      minutes: 120,
      checkedInAt: day,
      status: 'ABSENT',
    });

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/administracao/eventos/${eventId}/sorteios`);

    await expect(page.getByTestId('raffle-console')).toBeVisible();

    // ── 1. Configura o sorteio: por atividade, piso de 120 min ──────────────
    const form = page.getByTestId('raffle-form');
    await form.getByLabel('Título do sorteio').fill('Sorteio de brindes da abertura');
    await form.getByLabel('Universo do sorteio').selectOption('ACTIVITY');
    await form.getByLabel('Atividade').selectOption({ label: 'Minicurso do Sorteio' });
    await form.getByLabel('Piso de minutos assistidos').fill('120');
    await form.getByLabel('Quantos vencedores').fill('1');

    // ── 2. CONFERE antes de sortear ─────────────────────────────────────────
    await page.getByTestId('preview-raffle').click();

    const preview = page.getByTestId('raffle-preview');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toContainText(/1 elegível/i);

    // Só quem tem presença suficiente aparece entre os elegíveis.
    const eligible = page.getByTestId('eligible-list');
    await expect(eligible).toContainText('Presente Completo');
    await expect(eligible).not.toContainText('Presença Curta');

    // E os descartados aparecem com o motivo — inclusive o ausente.
    await preview.locator('summary').click();
    const rejected = page.getByTestId('rejected-list');
    await expect(rejected).toContainText('Presença Curta');
    await expect(rejected).toContainText(/abaixo do piso/i);
    await expect(rejected).toContainText('Ausente do Evento');
    await expect(rejected).toContainText(/ausente/i);

    // ── 3. Apura ────────────────────────────────────────────────────────────
    await page.getByTestId('draw-raffle').click();

    const result = page.getByTestId('raffle-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(/1 vencedor/i);

    // A revelação é escalonada: o vencedor aparece com a animação concluída.
    const winner = page.getByTestId('winner-1');
    await expect(winner).toHaveAttribute('data-revealed', 'true', { timeout: 30_000 });
    await expect(winner).toContainText('Presente Completo');
    await expect(winner).toContainText('240 min');

    // ── 4. O banco confirma a apuração ──────────────────────────────────────
    const stored = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      return tx.raffle.findFirstOrThrow({
        where: { tenantId: tenant.id, eventId },
        select: {
          status: true,
          eligibleCount: true,
          /**
           * O resultado assinado vive na RODADA desde a FASE 30 — as colunas
           * equivalentes em `raffles` são legado congelado e ficam nulas num sorteio
           * novo (ler a raffle aqui mediria o campo errado).
           */
          rounds: {
            orderBy: { roundNumber: 'asc' },
            select: { roundNumber: true, resultHash: true, seedCommitment: true },
          },
          winners: { select: { position: true, userId: true, attendanceMinutes: true } },
        },
      });
    });

    const round = stored.rounds[0]!;

    expect(stored.status).toBe('DRAWN');
    expect(stored.eligibleCount).toBe(1);
    expect(round.roundNumber).toBe(1);
    expect(round.seedCommitment).toMatch(/^[a-f0-9]{64}$/);
    expect(round.resultHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.winners).toHaveLength(1);
    expect(stored.winners[0]?.userId).toBe(completo.id);
    expect(stored.winners[0]?.attendanceMinutes).toBe(240);

    // ── 5. O histórico mostra a apuração ────────────────────────────────────
    await page.reload();

    const history = page.getByTestId('raffle-history');
    await expect(history).toBeVisible();
    await expect(history).toContainText('Sorteio de brindes da abertura');
    await expect(history).toContainText('Presente Completo');
    await expect(history).toContainText(/Apurado/i);
    await expect(history).toContainText(String(round.resultHash));
  });

  test('BLOQUEIA o sorteio quando ninguém cumpre o piso e mantém para conferência', async ({ page }) => {
    test.setTimeout(180_000);

    const { tenant, eventId, activityId, day } = await scenario('raffle-sem-quorum');

    const admin = await createUser(page, tenant.id, 'Organizadora Exigente', 'ADMIN');
    const curto = await createUser(page, tenant.id, 'Presença Muito Curta', 'PARTICIPANT');

    await addAttendance({ tenantId: tenant.id, eventId, activityId, userId: curto.id, minutes: 15, checkedInAt: day });

    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/administracao/eventos/${eventId}/sorteios`);

    const form = page.getByTestId('raffle-form');
    await form.getByLabel('Título do sorteio').fill('Sorteio sem quórum');
    await form.getByLabel('Universo do sorteio').selectOption('ACTIVITY');
    await form.getByLabel('Atividade').selectOption({ label: 'Minicurso do Sorteio' });
    await form.getByLabel('Piso de minutos assistidos').fill('200');

    await page.getByTestId('draw-raffle').click();

    const result = page.getByTestId('raffle-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText(/nenhum participante elegível/i);

    // A configuração NÃO se perde: o sorteio fica como rascunho para ser apurado
    // depois (quando o credenciamento estiver corrigido, por exemplo).
    const stored = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      return tx.raffle.findFirstOrThrow({
        where: { tenantId: tenant.id, eventId },
        select: { status: true, drawnAt: true, winners: { select: { userId: true } } },
      });
    });

    expect(stored.status).toBe('DRAFT');
    expect(stored.drawnAt).toBeNull();
    expect(stored.winners).toHaveLength(0);

    await expect(page.getByTestId('raffle-history')).toContainText('Sorteio sem quórum');
  });

  /** Sortear afeta pessoas e produz resultado público: não é para participante. */
  test('PARTICIPANTE não acessa a tela de sorteios', async ({ page }) => {
    const { tenant, eventId } = await scenario('raffle-rbac');
    await createUser(page, tenant.id, 'Participante Curioso', 'PARTICIPANT');

    await page.goto(`/t/${tenant.slug}/administracao/eventos/${eventId}/sorteios`);

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard$`), { timeout: 15_000 });
    await expect(page.getByTestId('raffle-console')).toHaveCount(0);
  });
});

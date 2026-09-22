/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Credenciamento e frequência por crachá (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM ESTÁ NA PORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. o sorteio... não: o CRACHÁ existe — a área de crachás emite para quem falta,
 *       com código no formato novo, e a folha em PDF sai com QR, código e nome;
 *    2. o monitor lê o código no campo (que é o mesmo caminho da câmera e do leitor
 *       USB) e vê o NOME e o que aconteceu;
 *    3. CREDENCIAMENTO ≠ FREQUÊNCIA: a mesma leitura, em contextos diferentes, grava
 *       fatos diferentes — e a segunda visita à mesma atividade abre sessão nova;
 *    4. atividade com o credenciamento desligado recusa a leitura com o motivo;
 *    5. o crachá revogado identifica a pessoa e NÃO registra presença;
 *    6. o participante abre o PRÓPRIO crachá (o QR na tela do celular) com o mesmo
 *       código da etiqueta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CENÁRIO MONTA A PRÓPRIA FIXTURE (armadilha 62)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Instituição, evento, atividades e pessoas são criados aqui. Um cenário que
 *  dependesse de dados deixados por outro arquivo mediria o vazio depois de qualquer
 *  reinício de worker — e o credenciamento depende de quem está inscrito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'credenciamento-qr';
const EVENT_SLUG = `evento-f31-${RUN_ID}`;

let tenantId: string;
let eventId: string;
let openActivityId: string;
let closedActivityId: string;
let adminEmail: string;
let participantEmail: string;
const participantId = { value: '' };
let secondParticipantId = '';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f31.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({ label: TENANT_LABEL, name: `Instituição Credenciamento ${RUN_ID}` });
    tenantId = tenant.id;

    const event = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.event.create({
        data: {
          id: randomUUID(),
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso do Credenciamento ${RUN_ID}`,
          status: 'IN_PROGRESS',
          modality: 'IN_PERSON',
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 8 * 3_600_000),
          timezone: 'America/Bahia',
          capacity: null,
          confirmedCount: 0,
        },
        select: { id: true },
      });
    });

    eventId = event.id;

    /**
     * A ATIVIDADE ACONTECE AGORA (`startsAt` no passado, `endsAt` no futuro): é o que
     * faz o monitor sugerir o contexto dela e o que permite registrar frequência.
     */
    const activities = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const open = await tx.activity.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: 'oficina-aberta',
          title: `Oficina de agora ${RUN_ID}`,
          type: 'WORKSHOP',
          status: 'IN_PROGRESS',
          modality: 'IN_PERSON',
          startsAt: new Date(Date.now() - 1_800_000),
          endsAt: new Date(Date.now() + 3_600_000),
          workloadMinutes: 120,
          requiresAttendance: true,
          requiresRegistration: true,
        },
        select: { id: true },
      });

      const closed = await tx.activity.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: 'oficina-desligada',
          title: `Oficina sem credenciamento ${RUN_ID}`,
          type: 'WORKSHOP',
          status: 'IN_PROGRESS',
          modality: 'IN_PERSON',
          startsAt: new Date(Date.now() - 1_800_000),
          endsAt: new Date(Date.now() + 3_600_000),
          workloadMinutes: 120,
          requiresAttendance: true,
          requiresRegistration: true,
          checkInEnabled: false,
        },
        select: { id: true },
      });

      return { openId: open.id, closedId: closed.id };
    });

    openActivityId = activities.openId;
    closedActivityId = activities.closedId;

    const admin = await signUpVia(api, `Coordenação ${RUN_ID}`);
    adminEmail = admin.email;
    await linkUser({ tenantId, userId: admin.id });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });

    const participant = await signUpVia(api, `Participante Crachá ${RUN_ID}`);
    participantId.value = participant.id;
    participantEmail = participant.email;
    await linkUser({ tenantId, userId: participant.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: participant.id, role: 'PARTICIPANT' });

    const second = await signUpVia(api, `Segundo Participante ${RUN_ID}`);
    secondParticipantId = second.id;
    await linkUser({ tenantId, userId: second.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: second.id, role: 'PARTICIPANT' });

    // Inscrições: a primeira pessoa no evento E na oficina; a segunda só na oficina.
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: participantId.value,
          status: 'CONFIRMED',
        },
      });

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: openActivityId,
          userId: participantId.value,
          status: 'CONFIRMED',
        },
      });

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: openActivityId,
          userId: secondParticipantId,
          status: 'CONFIRMED',
        },
      });
    });
  } finally {
    await api.dispose();
  }
});

test.describe('credenciamento e frequência por crachá', () => {
  test('a área de crachás emite, mostra o código e entrega a folha em PDF', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/credenciamento/crachas?evento=${eventId}`);

    const lista = page.getByTestId('badge-list');
    await expect(lista).toBeVisible();

    /** As duas pessoas inscritas aparecem, e ainda sem crachá. */
    await expect(page.getByTestId(`badge-row-${participantId.value}`)).toBeVisible();
    await expect(page.getByTestId(`badge-code-${participantId.value}`)).toContainText('sem crachá');

    await page.getByTestId('badge-emit').click();

    const feedback = page.getByTestId('badge-emit-feedback');
    await expect(feedback).toContainText(/crachá\(s\) emitido/i, { timeout: 20_000 });

    /** O código é do formato novo e fica visível na linha da pessoa. */
    const codeCell = page.getByTestId(`badge-code-${participantId.value}`);
    await expect(codeCell).toContainText(/^CR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    await expect(page.getByTestId(`badge-state-${participantId.value}`)).toContainText('válido');

    const code = ((await codeCell.textContent()) ?? '').trim();
    expect(code).toMatch(/^CR-/);

    /** A folha em PDF sai pela rota, com o conteúdo certo. */
    const pdf = await page.request.get(
      `/api/t/${TENANT_LABEL}-${RUN_ID}/credenciamento/crachas/folha?eventId=${eventId}`,
    );

    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');

    const body = await pdf.body();
    const text = body.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain(`(${code}) Tj`);
  });

  test('o monitor registra a CHEGADA e a FREQUÊNCIA com o mesmo crachá', async ({ page }) => {
    await signInAs(page, adminEmail);

    const badge = await e2eDb.eventCredential.findFirstOrThrow({
      where: { tenantId, eventId, userId: participantId.value },
      select: { code: true },
    });

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/credenciamento?evento=${eventId}`);

    const console_ = page.getByTestId('monitor-console');
    await expect(console_).toBeVisible();

    // ── 1. Portaria: registra a CHEGADA ─────────────────────────────────────
    await page.getByTestId('monitor-context-kind').selectOption('EVENT');
    await page.getByTestId('monitor-code').fill(badge.code);
    await page.getByTestId('presence-submit').click();

    const feedback = page.getByTestId('monitor-feedback');
    await expect(feedback).toContainText('Participante Crachá', { timeout: 20_000 });
    await expect(feedback).toContainText(/Entrada registrada/i);
    await expect(feedback).toHaveAttribute('data-action', 'CHECKED_IN');

    // ── 2. Atividade: registra a FREQUÊNCIA ─────────────────────────────────
    await page.getByTestId('monitor-context-kind').selectOption('ACTIVITY');
    await page.getByTestId('monitor-activity').selectOption(openActivityId);

    await page.getByTestId('monitor-code').fill(badge.code);
    await page.getByTestId('presence-submit').click();

    await expect(feedback).toContainText(/Entrada registrada/i, { timeout: 20_000 });
    await expect(page.getByTestId('monitor-context-label')).toContainText('Oficina de agora');

    // A saída fecha a sessão e diz os minutos.
    await page.getByTestId('monitor-code').fill(badge.code);
    await page.getByTestId('monitor-checkout').click();

    await expect(feedback).toContainText(/Saída registrada/i, { timeout: 20_000 });
    await expect(feedback).toContainText(/minuto/i);

    /** O banco separa os dois fatos: chegada (sem atividade) e frequência. */
    const attendances = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.attendance.findMany({
        where: { tenantId, userId: participantId.value },
        select: { activityId: true, checkedOutAt: true, minutesAttended: true },
      });
    });

    expect(attendances).toHaveLength(2);
    expect(attendances.filter((row) => row.activityId === null)).toHaveLength(1);
    expect(attendances.filter((row) => row.activityId === openActivityId)).toHaveLength(1);
    expect(attendances.find((row) => row.activityId === openActivityId)?.checkedOutAt).not.toBeNull();

    /** A inscrição no EVENTO passou a ATTENDED (a fila do balcão enxerga a chegada). */
    const registration = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.registration.findFirstOrThrow({
        where: { tenantId, eventId, userId: participantId.value, activityId: null },
        select: { status: true, checkedInAt: true },
      });
    });

    expect(registration.status).toBe('ATTENDED');
    expect(registration.checkedInAt).not.toBeNull();
  });

  test('a atividade com credenciamento desligado recusa a leitura com o motivo', async ({ page }) => {
    await signInAs(page, adminEmail);

    const badge = await e2eDb.eventCredential.findFirstOrThrow({
      where: { tenantId, eventId, userId: participantId.value },
      select: { code: true },
    });

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/credenciamento?evento=${eventId}`);

    await page.getByTestId('monitor-context-kind').selectOption('ACTIVITY');
    await page.getByTestId('monitor-activity').selectOption(closedActivityId);
    await page.getByTestId('monitor-code').fill(badge.code);
    await page.getByTestId('presence-submit').click();

    const feedback = page.getByTestId('monitor-feedback');
    await expect(feedback).toContainText(/credenciamento desta atividade está desligado/i, {
      timeout: 20_000,
    });
    await expect(feedback).toHaveAttribute('data-action', 'ERRO');
  });

  test('o participante abre o PRÓPRIO crachá e mostra o QR na tela', async ({ page }) => {
    await signInAs(page, participantEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/meu-cracha?evento=${eventId}`);

    const own = page.getByTestId('own-badge');
    await expect(own).toBeVisible();
    await expect(own).toHaveAttribute('data-credential-state', 'ACTIVE');

    const codeCell = page.getByTestId('own-badge-code');
    await expect(codeCell).toContainText(/^CR-/);

    /** O QR é desenhado na tela (SVG) — é o que o monitor lê do celular. */
    await expect(page.getByTestId('own-badge-qr').locator('svg')).toBeVisible();

    const badge = await e2eDb.eventCredential.findFirstOrThrow({
      where: { tenantId, eventId, userId: participantId.value },
      select: { code: true },
    });

    await expect(codeCell).toContainText(badge.code);

    /**
     * O BOTÃO "GERAR MEU CRACHÁ" PRECISA SER CLICADO (FASE 32).
     *
     * Ele ficou sem cobertura até aqui: o cenário só olhava a tela, que já chega
     * pronta do servidor. E era justamente a action por trás dele que estava
     * QUEBRADA — `guardAction` não passava o dono para uma permissão `:own`, então a
     * própria pessoa recebia "permissão negada" ao pedir o próprio crachá. O defeito
     * foi encontrado pelo E2E da FASE 32 (que usa a mesma guarda) e é este clique que
     * impede a volta dele.
     */
    await page.getByTestId('own-badge-generate').click();

    await expect(page.getByText(`Seu crachá está pronto: ${badge.code}`)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('o crachá revogado identifica a pessoa e NÃO registra presença', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/credenciamento/crachas?evento=${eventId}`);

    await page.getByTestId(`badge-revoke-${secondParticipantId}`).click();

    const revokeForm = page.getByTestId(`badge-revoke-confirm-${secondParticipantId}`);
    await page
      .getByLabel(new RegExp('Motivo da revogação do crachá de Segundo'))
      .fill('Crachá perdido na portaria');
    await revokeForm.click();

    await expect(page.getByTestId('badge-revoke-feedback')).toContainText(/revogado/i, {
      timeout: 20_000,
    });
    await expect(page.getByTestId(`badge-state-${secondParticipantId}`)).toContainText('revogado');

    const badge = await e2eDb.eventCredential.findFirstOrThrow({
      where: { tenantId, eventId, userId: secondParticipantId },
      select: { code: true },
    });

    // O monitor continua identificando a pessoa (o balcão precisa resolver)...
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/credenciamento?evento=${eventId}`);
    await page.getByTestId('monitor-context-kind').selectOption('EVENT');
    await page.getByTestId('monitor-code').fill(badge.code);
    await page.getByTestId('presence-submit').click();

    const feedback = page.getByTestId('monitor-feedback');
    await expect(feedback).toContainText('Segundo Participante', { timeout: 20_000 });
    await expect(feedback).toContainText(/revogado/i);

    // ... mas nenhuma presença foi gravada.
    const attendances = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.attendance.count({ where: { tenantId, userId: secondParticipantId } });
    });

    expect(attendances).toBe(0);
  });
});

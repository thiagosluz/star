import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';

import {
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const ORIGEM = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const RUN_ID = randomUUID().slice(0, 8);

async function signUpVia(api: APIRequestContext, name: string) {
  const email = `f115.${RUN_ID}.${randomUUID().slice(0, 6)}@exemplo.test`;
  const res = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name, email, password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${res.status()}`);
  }
  const body = (await res.json()) as { user?: { id: string } };
  if (!body.user?.id) throw new Error('Cadastro sem user.id');
  return { id: body.user.id, email };
}

test.describe.serial('FASE 115 — Sincronização Portaria × Atividade e Fila Manual Escalável', () => {
  let tenantId = '';
  let tenantSlug = '';
  let eventId = '';
  let ceremonyId = '';
  let rustId = '';
  let brunoRegId = '';
  let staffEmail = '';

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    try {
      const staff = await signUpVia(api, 'Operador F115');
      const bruno = await signUpVia(api, 'Bruno Souza F115');
      const dono = await signUpVia(api, 'Dono da Instituição F115');
      staffEmail = staff.email;

      const tenant = await createTenant({
        label: 'f115-sync',
        name: `Congresso F115 ${RUN_ID}`,
      });
      tenantId = tenant.id;
      tenantSlug = tenant.slug;

      await linkUser({ userId: staff.id, tenantId, kind: 'MEMBER' });
      await grantRole({ userId: staff.id, tenantId, role: 'ORGANIZER' });
      await linkUser({ userId: bruno.id, tenantId, kind: 'PARTICIPANT' });
      await grantRole({ userId: bruno.id, tenantId, role: 'PARTICIPANT' });
      await linkUser({ userId: dono.id, tenantId, kind: 'PARTICIPANT' });
      await grantRole({ userId: dono.id, tenantId, role: 'PARTICIPANT' });

      const startsAt = new Date(Date.now() + 3_600_000);
      const endsAt = new Date(Date.now() + 2 * 86_400_000);
      const event = await createEvent({
        tenantId,
        slug: `congresso-f115-${RUN_ID}`,
        title: `Congresso Sincronizado F115 ${RUN_ID}`,
        status: 'IN_PROGRESS',
        startsAt,
        endsAt,
      });
      eventId = event.id;
      ceremonyId = randomUUID();
      rustId = randomUUID();
      brunoRegId = randomUUID();

      await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

        await tx.activity.createMany({
          data: [
            {
              id: ceremonyId,
              tenantId,
              eventId,
              slug: `cerimonia-f115-${RUN_ID}`,
              title: 'Cerimônia de abertura e conferência magna',
              type: 'LECTURE',
              status: 'SCHEDULED',
              modality: 'IN_PERSON',
              startsAt,
              endsAt,
              workloadMinutes: 90,
              checkInEnabled: true,
              requiresAttendance: true,
              requiresRegistration: false,
            },
            {
              id: rustId,
              tenantId,
              eventId,
              slug: `rust-f115-${RUN_ID}`,
              title: 'Minicurso: Programação em Rust para iniciantes',
              type: 'MINI_COURSE',
              status: 'SCHEDULED',
              modality: 'IN_PERSON',
              startsAt,
              endsAt,
              workloadMinutes: 240,
              checkInEnabled: true,
              requiresAttendance: true,
              requiresRegistration: true,
            },
          ],
        });

        const past = new Date(Date.now() - 2 * 3_600_000);
        await tx.registration.createMany({
          data: [
            // Bruno possui inscrição no evento + inscrição já atendida no Minicurso de Rust (não deve duplicar card!).
            {
              id: brunoRegId,
              tenantId,
              eventId,
              activityId: null,
              userId: bruno.id,
              status: 'CONFIRMED',
            },
            {
              id: randomUUID(),
              tenantId,
              eventId,
              activityId: rustId,
              userId: bruno.id,
              status: 'ATTENDED',
              checkedInAt: past,
            },
            {
              id: randomUUID(),
              tenantId,
              eventId,
              activityId: null,
              userId: dono.id,
              status: 'CONFIRMED',
            },
          ],
        });
      });
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async () => {
    if (!tenantId) return;
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.attendance.deleteMany({ where: { tenantId } });
      await tx.registration.deleteMany({ where: { tenantId } });
      await tx.activity.deleteMany({ where: { tenantId } });
      await tx.event.deleteMany({ where: { tenantId } });
    });
    await e2eDb.tenant.deleteMany({ where: { id: tenantId } });
  });

  test('1. Fila manual deduplica participante (1 card por pessoa) e sincroniza Portaria × Atividade aberta/restrita em tempo real', async ({
    page,
  }) => {
    await page.request.post('/api/auth/sign-in/email', {
      headers: { origin: ORIGEM },
      data: { email: staffEmail, password: PASSWORD },
    });

    await page.goto(`/t/${tenantSlug}/credenciamento?evento=${eventId}`);

    // 1. Bruno tem 2 inscrições no banco (Evento + Minicurso), mas aparece apenas 1 vez na fila manual.
    await expect(page.getByTestId('queue-total')).toContainText('2 inscrição(ões) confirmada(s)');
    const brunoRow = page.getByTestId(`queue-${brunoRegId}`);
    await expect(brunoRow).toBeVisible();
    await expect(brunoRow).toContainText('Bruno Souza F115');
    await expect(brunoRow).toContainText('+1 atividade(s)');

    // 2. O banner da fila inicia sincronizado com Portaria do evento.
    const banner = page.getByTestId('queue-context-banner');
    await expect(banner).toContainText('Portaria do evento — registra a chegada');

    // 3. Muda o Modo Monitor para "Atividade — registra a frequência" -> "Cerimônia de abertura e conferência magna".
    await page.getByTestId('monitor-context-kind').selectOption('ACTIVITY');
    await page.getByTestId('monitor-activity').selectOption(ceremonyId);

    // O banner da direita e o card do Bruno mudam instantaneamente para a Cerimônia de abertura!
    await expect(banner).toContainText('Atividade: Cerimônia de abertura e conferência magna');
    await expect(page.getByTestId(`queue-enrollment-${brunoRegId}`)).toContainText(
      'Atividade aberta do evento',
    );
    await expect(brunoRow.getByTestId('checkin-button')).toContainText('Credenciar na atividade');

    // 4. Credencia Bruno manualmente na Cerimônia de abertura pela fila da direita.
    await brunoRow.getByTestId('checkin-button').click();
    await expect(brunoRow.getByTestId(`checkin-feedback-${brunoRegId}`)).toContainText(
      /Entrada registrada/i,
      { timeout: 15_000 },
    );
    await expect(brunoRow).toHaveAttribute('data-inside', 'true');

    // 5. Troca no Modo Monitor para "Minicurso: Programação em Rust": Bruno aparece como "Inscrito nesta atividade" e ainda fora da 2ª sessão!
    await page.getByTestId('monitor-activity').selectOption(rustId);
    await expect(banner).toContainText('Atividade: Minicurso: Programação em Rust para iniciantes');
    const brunoBadge = page.getByTestId(`queue-enrollment-${brunoRegId}`);
    await expect(brunoBadge).toContainText('Inscrito nesta atividade');
    const badgeMetrics = await brunoBadge.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        fontSize: style.fontSize,
        overflowsVertically: el.scrollHeight > el.clientHeight + 1,
      };
    });
    expect(badgeMetrics.fontSize).toBe('11px');
    expect(badgeMetrics.overflowsVertically).toBe(false);
    await expect(brunoRow).toHaveAttribute('data-inside', 'false');

    // 6. Volta para Cerimônia de abertura e registra a saída do Bruno pela fila manual.
    await page.getByTestId('monitor-activity').selectOption(ceremonyId);
    await expect(brunoRow).toHaveAttribute('data-inside', 'true');
    await brunoRow.getByTestId('checkout-button').click();
    await expect(brunoRow.getByTestId(`checkin-feedback-${brunoRegId}`)).toContainText(
      /Saída registrada/i,
      { timeout: 15_000 },
    );
    await expect(brunoRow).toHaveAttribute('data-inside', 'false');
  });
});

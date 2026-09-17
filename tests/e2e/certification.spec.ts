/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Certificação (FASE 6)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PROVA, DE PONTA A PONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a equipe credencia e registra a saída (presença MEDIDA);
 *      2. o participante emite o certificado pela tela;
 *      3. o WORKER gera o arquivo (fila BullMQ) e a tela passa a oferecer o PDF;
 *      4. o PDF baixado é um PDF de verdade (assinatura `%PDF` no conteúdo);
 *      5. um VISITANTE ANÔNIMO (sem cookie, sem login) valida o documento pelo
 *         código e vê a assinatura conferida.
 *
 *  O passo 5 é o coração da fase: validação pública que só funciona logado não é
 *  validação pública.
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
async function createUser(
  page: import('@playwright/test').Page,
  tenantId: string,
  name: string,
  role: 'PARTICIPANT' | 'ORGANIZER' | 'STAFF',
): Promise<{ id: string; email: string }> {
  const email = `cert.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3000' },
  });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

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
    slug: `minicurso-${label}`,
    title: `Minicurso ${label}`,
    capacity: 30,
    workloadMinutes: 60,
  });

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    await tx.activity.update({ where: { id: activity.id }, data: { type: 'MINI_COURSE' } });
  });

  return { tenant, event, activity };
}

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

/** Recua o horário do check-in para simular presença longa sem esperar de verdade. */
async function backdateCheckIn(tenantId: string, registrationId: string, minutes: number): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.attendance.updateMany({
      where: { tenantId, registrationId },
      data: { checkedInAt: new Date(Date.now() - minutes * 60_000) },
    });
  });
}

async function readCertificate(tenantId: string, userId: string) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.certificate.findFirst({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        validationCode: true,
        status: true,
        contentHash: true,
        workloadMinutes: true,
        storageKey: true,
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('certificação de ponta a ponta', () => {
  test('credencia, emite, gera pela fila e valida publicamente', async ({ page, browser }) => {
    test.setTimeout(240_000);

    const { tenant, event, activity } = await scenario('certjourney');

    const participant = await createUser(page, tenant.id, 'Participante Certificado', 'PARTICIPANT');
    const staff = await createUser(page, tenant.id, 'Equipe Credenciadora', 'STAFF');

    const registrationId = await registerParticipant({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: participant.id,
    });

    // ── 1. Credenciamento: entrada e saída ──────────────────────────────────
    await signInAs(page, staff.email);
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);

    const row = page.locator('li[data-testid^="queue-"]', { hasText: 'Participante Certificado' });
    await expect(row).toBeVisible();

    await row.getByTestId('checkin-button').click();
    await expect(row.getByTestId(/^checkin-feedback-/)).toContainText(/\+50 XP/, { timeout: 20_000 });

    // A presença precisa atingir 75 % da carga (45 de 60 min).
    await backdateCheckIn(tenant.id, registrationId, 60);

    await row.getByTestId('checkout-button').click();
    await expect(row.getByTestId(/^checkin-feedback-/)).toContainText(/60 min/, { timeout: 20_000 });

    // ── 2. O participante emite o certificado ───────────────────────────────
    await signInAs(page, participant.email);
    await page.goto(`/t/${tenant.slug}/certificados`);

    await page.getByLabel('Evento').selectOption(event.id);
    await page.getByLabel('Tipo de certificado').selectOption('MINI_COURSE');
    await page.getByTestId('request-certificate').click();

    await expect(page.getByTestId('certificate-feedback')).toContainText(/emitido|processamento/i, {
      timeout: 30_000,
    });

    const certificate = await readCertificate(tenant.id, participant.id);
    expect(certificate).not.toBeNull();
    if (!certificate) return;

    expect(certificate.workloadMinutes).toBe(60);
    expect(certificate.contentHash).toMatch(/^[a-f0-9]{64}$/);

    // ── 3. O worker gera o arquivo (fila BullMQ) ────────────────────────────
    /**
     * A tela é recarregada até o PDF aparecer. Isso prova o caminho assíncrono
     * inteiro: job enfileirado → worker → renderização → upload → status ISSUED.
     */
    const downloadLink = page.getByTestId(`download-${certificate.validationCode}`);
    await expect
      .poll(
        async () => {
          await page.reload();
          return downloadLink.count();
        },
        { timeout: 90_000, intervals: [2_000, 3_000, 5_000] },
      )
      .toBeGreaterThan(0);

    const issued = await readCertificate(tenant.id, participant.id);
    expect(issued?.status).toBe('ISSUED');
    expect(issued?.storageKey).toContain('certificado.pdf');

    // ── 4. O PDF é um PDF de verdade ────────────────────────────────────────
    const response = await page.request.get(
      `/api/certificados/${certificate.validationCode}/arquivo`,
    );

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('pdf');

    const body = await response.body();
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(1_000);

    // ── 5. Validação pública, SEM sessão ────────────────────────────────────
    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();

    try {
      await anonymousPage.goto(`/validar/${certificate.validationCode}`);

      await expect(anonymousPage.getByTestId('validation-verdict')).toHaveAttribute(
        'data-status',
        'VALID',
      );
      await expect(anonymousPage.getByTestId('certificate-recipient')).toHaveText(
        'Participante Certificado',
      );
      await expect(anonymousPage.getByTestId('certificate-workload')).toHaveText('1h');
      await expect(anonymousPage.getByTestId('signature-status')).toContainText(/verificada/i);

      // O download público funciona para quem tem o código.
      const publicDownload = await anonymousPage.request.get(
        `/api/certificados/${certificate.validationCode}/arquivo`,
      );
      expect(publicDownload.status()).toBe(200);
      expect(publicDownload.headers()['content-type']).toContain('pdf');
    } finally {
      await anonymous.close();
    }
  });

  test('código inexistente não valida nada', async ({ page }) => {
    await page.goto('/validar/CERT-22222222');

    await expect(page.getByTestId('validation-verdict')).toHaveAttribute(
      'data-status',
      'NOT_FOUND',
    );
    await expect(page.getByTestId('certificate-data')).toHaveCount(0);
  });
});

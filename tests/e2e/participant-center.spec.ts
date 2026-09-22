/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Central do participante e inteligência da instituição (FASE 32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. a administração abre o DIRETÓRIO e vê as pessoas de TODOS os eventos, com o
 *       e-mail mascarado;
 *    2. abre a FICHA de uma pessoa e encontra o que ela viveu (eventos, frequência,
 *       certificado, carta) — e a abertura entra na TRILHA;
 *    3. envia um RECADO pela ficha e o e-mail é enfileirado no outbox;
 *    4. o PARTICIPANTE entra, vê o recado em "Minhas mensagens" e o marca como lido;
 *    5. o PANORAMA mostra os números do período e a série por evento;
 *    6. a EXPORTAÇÃO em CSV baixa o arquivo e deixa rastro na trilha;
 *    7. quem não tem a permissão NÃO alcança o diretório (nem pelo menu, nem pela
 *       URL) — esconder link não é autorização.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CENÁRIO MONTA A PRÓPRIA FIXTURE (armadilha 62)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Instituição, evento, inscrições e pessoas nascem aqui. Depender de dado deixado
 *  por outro arquivo mediria o vazio depois de qualquer reinício de worker — e este
 *  módulo é justamente sobre dado acumulado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'central-participante';
const EVENT_SLUG = `evento-f32-${RUN_ID}`;

let tenantId: string;
let eventId: string;
let adminEmail: string;
let participantEmail: string;
let participantName: string;
let participantId: string;
let outsiderEmail: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f32.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
    const tenant = await createTenant({ label: TENANT_LABEL, name: `Instituição Central ${RUN_ID}` });
    tenantId = tenant.id;

    const event = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.event.create({
        data: {
          id: randomUUID(),
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso da Central ${RUN_ID}`,
          status: 'FINISHED',
          modality: 'IN_PERSON',
          startsAt: new Date(Date.now() - 7 * 86_400_000),
          endsAt: new Date(Date.now() - 6 * 86_400_000),
          timezone: 'America/Bahia',
        },
        select: { id: true },
      });
    });

    eventId = event.id;

    const admin = await signUpVia(api, 'Administradora da Central');
    adminEmail = admin.email;
    await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });

    /**
     * A PARTICIPANTE tem vínculo de participante E inscrição com presença: é o caso
     * completo — o que a ficha precisa mostrar.
     */
    const participant = await signUpVia(api, 'Participante da Central');
    participantEmail = participant.email;
    participantId = participant.id;
    participantName = 'Participante da Central';
    await linkUser({ userId: participant.id, tenantId, kind: 'PARTICIPANT' });
    /**
     * O PAPEL é o que abre a caixa de entrada: o vínculo diz que a pessoa participa,
     * o papel diz o que ela pode fazer (a lição da FASE 25 — vínculo sem papel não
     * chega à própria tela).
     */
    await grantRole({ userId: participant.id, tenantId, role: 'PARTICIPANT', scope: 'TENANT' });

    /**
     * QUEM SÓ TEM INSCRIÇÃO (sem vínculo) também precisa aparecer: é a UNIÃO que o
     * diretório faz, e o cenário tem de conter os dois lados dela.
     */
    const onlyRegistration = await signUpVia(api, 'Só Inscrição da Central');

    /** Pessoa SEM permissão de leitura: participante comum entra nesta lista. */
    const outsider = await signUpVia(api, 'Curiosa da Central');
    outsiderEmail = outsider.email;
    await linkUser({ userId: outsider.id, tenantId, kind: 'PARTICIPANT' });
    await grantRole({ userId: outsider.id, tenantId, role: 'PARTICIPANT', scope: 'TENANT' });

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      // A participante tem vínculo REMOVIDO do diretório por inscrição: o vínculo
      // fica, e a inscrição com presença é o que a ficha vai contar.
      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: participant.id,
          status: 'ATTENDED',
          consentData: true,
          checkedInAt: new Date(Date.now() - 7 * 86_400_000),
        },
      });

      await tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: participant.id,
          status: 'PRESENT',
          source: 'QR_CODE_CHECKIN',
          checkedInAt: new Date(Date.now() - 7 * 86_400_000),
          minutesAttended: 120,
        },
      });

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: onlyRegistration.id,
          status: 'CONFIRMED',
          consentData: true,
        },
      });

      await tx.certificate.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: participant.id,
          kind: 'ATTENDANCE',
          status: 'ISSUED',
          validationCode: `F32${RUN_ID}${randomUUID().slice(0, 4)}`.slice(0, 30),
          title: 'Certificado de participação',
          recipientName: 'Participante da Central',
          bodyText: 'Certificamos a participação no congresso.',
          workloadMinutes: 120,
          issuedAt: new Date(Date.now() - 6 * 86_400_000),
        },
      });

      await tx.userXpProfile.create({
        data: { id: randomUUID(), tenantId, userId: participant.id, totalXp: 80, level: 1 },
      });
    });
  } finally {
    await api.dispose();
  }
});

test.describe('central do participante', () => {
  test('a administração vê o diretório, abre a ficha e envia um recado', async ({ page }) => {
    await signInAs(page, adminEmail);

    // ── 1. O diretório lista as pessoas da instituição ────────────────────────
    await page.goto(`/t/${(await tenantSlug()).slug}/participantes`);

    const list = page.getByTestId('participant-list');
    await expect(list).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`participant-name-${participantId}`)).toContainText(participantName);

    // O e-mail aparece MASCARADO na lista (o endereço completo é da ficha).
    const masked = page.getByTestId(`participant-email-${participantId}`);
    await expect(masked).toContainText('@example.test');
    await expect(masked).not.toContainText(participantEmail.split('@')[0]);

    // A taxa de comparecimento da participante: 1 presença em 1 confirmada.
    await expect(page.getByTestId(`participant-rate-${participantId}`)).toContainText('100%');

    // ── 2. A ficha mostra o que ela viveu ─────────────────────────────────────
    await page.getByTestId(`participant-open-${participantId}`).click();

    const profile = page.getByTestId('participant-profile');
    await expect(profile).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('profile-identity')).toContainText(participantEmail);
    await expect(page.getByTestId('profile-events')).toContainText('Congresso da Central');
    await expect(page.getByTestId('profile-certificates')).toContainText('Certificado de participação');

    // ── 3. O recado sai da ficha ──────────────────────────────────────────────
    const subject = `Credenciamento do congresso ${RUN_ID}`;

    await page.getByTestId('message-subject').fill(subject);
    await page.getByTestId('message-body').fill('Traga o QR Code do crachá.\n\nEquipe da organização.');
    await page.getByTestId('message-send').click();

    await expect(page.getByTestId('message-feedback')).toContainText(/1 recado\(s\) enviado/i, {
      timeout: 30_000,
    });

    // ── 4. A leitura da ficha ficou na trilha ─────────────────────────────────
    const trail = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.auditLog.findMany({
        where: { tenantId, action: 'READ', entityType: 'participant', entityId: participantId },
        select: { id: true },
      });
    });

    expect(trail.length).toBeGreaterThanOrEqual(1);

    const emails = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.emailMessage.findMany({
        where: { tenantId, toUserId: participantId },
        select: { template: true, status: true, subject: true },
      });
    });

    expect(emails).toHaveLength(1);
    expect(emails[0]?.template).toBe('PARTICIPANT_MESSAGE');
    expect(emails[0]?.subject).toContain(subject);
  });

  test('o participante lê o recado na própria caixa de entrada', async ({ page }) => {
    await signInAs(page, participantEmail);
    await page.goto(`/t/${(await tenantSlug()).slug}/minhas-mensagens`);

    const inbox = page.getByTestId('inbox-list');
    await expect(inbox).toBeVisible({ timeout: 20_000 });
    await expect(inbox).toContainText(`Credenciamento do congresso ${RUN_ID}`);

    const message = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.participantMessage.findFirstOrThrow({
        where: { tenantId, userId: participantId },
        orderBy: { sentAt: 'desc' },
        select: { id: true, readAt: true },
      });
    });

    expect(message.readAt).toBeNull();

    await page.getByTestId(`inbox-mark-${message.id}`).click();
    await expect(page.getByTestId(`inbox-read-${message.id}`)).toBeVisible({ timeout: 20_000 });

    const after = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.participantMessage.findUniqueOrThrow({
        where: { id: message.id },
        select: { readAt: true },
      });
    });

    expect(after.readAt).not.toBeNull();
  });

  test('o panorama mostra os números do período e a série por evento', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${(await tenantSlug()).slug}/panorama`);

    const totals = page.getByTestId('panorama-totals');
    await expect(totals).toBeVisible({ timeout: 20_000 });
    // 1 presença em 2 inscrições confirmadas no evento — o TOTAL é do período.
    await expect(totals).toContainText('50%');
    await expect(totals).toContainText('120 min');
    await expect(totals).toContainText('4');

    const events = page.getByTestId('panorama-events');
    await expect(events).toContainText('Congresso da Central');
    await expect(page.getByTestId(`panorama-event-${eventId}`)).toContainText('2 confirmada(s)');
  });

  test('a exportação baixa o CSV e registra a exportação na trilha', async ({ page }) => {
    await signInAs(page, adminEmail);

    const slug = (await tenantSlug()).slug;
    const response = await page.request.get(`/api/t/${slug}/participantes/exportar`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');
    expect(response.headers()['content-disposition']).toContain('attachment');

    const body = await response.text();
    expect(body).toContain('Nome;E-mail;Origem');
    expect(body).toContain(participantName);
    // O arquivo carrega o e-mail COMPLETO (a lista da tela é que mascara).
    expect(body).toContain(participantEmail);

    const trail = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.auditLog.findMany({
        where: { tenantId, action: 'EXPORT', entityType: 'participant' },
        select: { id: true },
      });
    });

    expect(trail.length).toBeGreaterThanOrEqual(1);
  });

  test('quem não tem a permissão não alcança o diretório nem o panorama', async ({ page }) => {
    await signInAs(page, outsiderEmail);
    const slug = (await tenantSlug()).slug;

    for (const path of ['/participantes', '/panorama']) {
      await page.goto(`/t/${slug}${path}`);
      await expect(page).toHaveURL(new RegExp(`/t/${slug}/dashboard$`), { timeout: 15_000 });
    }

    // Também não aparece no menu: esconder link é a primeira linha, a guarda é a segunda.
    await page.goto(`/t/${slug}/dashboard`);
    await expect(page.getByRole('link', { name: 'Participantes' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Panorama' })).toHaveCount(0);
  });
});

/** O slug é derivado do rótulo pelo helper de fixture. */
async function tenantSlug(): Promise<{ slug: string }> {
  const tenant = await e2eDb.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { slug: true },
  });

  return tenant;
}

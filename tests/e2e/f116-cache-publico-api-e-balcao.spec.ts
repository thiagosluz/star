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
  const email = `f116.${RUN_ID}.${randomUUID().slice(0, 6)}@exemplo.test`;
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

test.describe.serial('FASE 116 — Cache público, invalidação imediata e janela inicial enxuta no balcão', () => {
  let tenantId = '';
  let tenantSlug = '';
  let eventId = '';
  let eventSlug = '';
  let staffEmail = '';
  let certCode = '';
  const participantIds: string[] = [];

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    try {
      const staff = await signUpVia(api, 'Organizador F116');
      staffEmail = staff.email;

      const tenant = await createTenant({
        label: 'f116-perf',
        name: `Instituição F116 ${RUN_ID}`,
      });
      tenantId = tenant.id;
      tenantSlug = tenant.slug;

      await linkUser({ userId: staff.id, tenantId, kind: 'MEMBER' });
      await grantRole({ userId: staff.id, tenantId, role: 'ORGANIZER' });

      const event = await createEvent({
        tenantId,
        slug: `evento-f116-${RUN_ID}`,
        title: `Evento Inicial F116 ${RUN_ID}`,
        status: 'REGISTRATION_OPEN',
      });
      eventId = event.id;
      eventSlug = event.slug;

      // Cria 30 participantes para validar a janela inicial de 25 cards no balcão
      const users = Array.from({ length: 30 }, (_, idx) => {
        const id = randomUUID();
        participantIds.push(id);
        const n = String(idx + 1).padStart(2, '0');
        return {
          id,
          name: idx === 29 ? `Zuleide Ultima F116 ${n}` : `Participante F116 ${n}`,
          email: `f116.p${n}.${RUN_ID}@exemplo.test`,
          emailVerified: true,
        };
      });
      await e2eDb.user.createMany({ data: users });

      certCode = `CERT-F116${RUN_ID.slice(0, 4).toUpperCase()}`;

      await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        await tx.userTenantProfile.createMany({
          data: users.map((u) => ({
            id: randomUUID(),
            tenantId,
            userId: u.id,
            status: 'ACTIVE',
            kind: 'PARTICIPANT',
            joinedAt: new Date(),
          })),
        });
        await tx.registration.createMany({
          data: users.map((u) => ({
            id: randomUUID(),
            tenantId,
            eventId,
            activityId: null,
            userId: u.id,
            status: 'CONFIRMED',
          })),
        });
        await tx.certificate.create({
          data: {
            id: randomUUID(),
            tenantId,
            eventId,
            userId: users[0]!.id,
            kind: 'PARTICIPATION',
            status: 'ISSUED',
            validationCode: certCode,
            title: 'Certificado de Participação F116',
            recipientName: users[0]!.name,
            bodyText: 'Certificamos a participação no evento.',
            workloadMinutes: 120,
            issuedAt: new Date(),
          },
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
      await tx.certificate.deleteMany({ where: { tenantId } });
      await tx.registration.deleteMany({ where: { tenantId } });
      await tx.event.deleteMany({ where: { tenantId } });
      await tx.roleAssignment.deleteMany({ where: { tenantId } });
      await tx.userTenantProfile.deleteMany({ where: { tenantId } });
    });
    await e2eDb.tenant.deleteMany({ where: { id: tenantId } });
    if (participantIds.length > 0) {
      await e2eDb.user.deleteMany({ where: { id: { in: participantIds } } });
    }
  });

  test('1. /validar/[code] expõe Cache-Control CDN seguro e /credenciamento limita janela inicial a 25 cards com busca completa', async ({
    page,
    request,
  }) => {
    // 1. Validação pública responde 200 com Cache-Control para CDN (max-age=0 no browser, s-maxage=30 na borda)
    const certRes = await request.get(`/validar/${certCode}`);
    expect(certRes.status()).toBe(200);
    expect(certRes.headers()['cache-control']).toContain('s-maxage=30');
    expect(certRes.headers()['cache-control']).toContain('max-age=0');

    // 2. Página pública do evento aquece cache sem expor Cache-Control: public (protege sessão e sala online)
    const eventRes = await request.get(`/t/${tenantSlug}/eventos/${eventSlug}`);
    expect(eventRes.status()).toBe(200);
    expect(eventRes.headers()['cache-control'] ?? '').not.toContain('s-maxage');

    // 3. Autentica como organizador e abre o balcão /credenciamento
    await page.request.post('/api/auth/sign-in/email', {
      headers: { origin: ORIGEM },
      data: { email: staffEmail, password: PASSWORD },
    });

    await page.goto(`/t/${tenantSlug}/credenciamento?evento=${eventId}`);
    await expect(page.getByTestId('checkin-desk-summary')).toContainText('Inscrições elegíveis: 30');
    await expect(page.getByTestId('queue-total')).toContainText('30 inscrição(ões) confirmada(s)');

    // Janela inicial sem busca exibe 25 cards (redução de payload) com aviso honesto de truncamento
    const rows = page.locator('[data-testid="checkin-queue"] > li');
    await expect(rows).toHaveCount(25);
    await expect(page.getByTestId('checkin-queue-truncation')).toContainText('25 primeiros de 30');

    // Buscar pela 30ª participante ("Zuleide") localiza direto no banco
    await page.getByLabel('Buscar').fill('Zuleide');
    await expect(page.locator('[data-testid="checkin-queue"]')).toContainText('Zuleide Ultima F116 30', {
      timeout: 15_000,
    });
  });
});

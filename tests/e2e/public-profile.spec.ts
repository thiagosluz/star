import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import {
  PUBLIC_PROFILE_FIELD_LABELS,
  PUBLIC_PROFILE_FIELDS,
} from '../../src/domain/profile/public-profile-rules';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'perfilpublico';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let subjectEmail: string;
let subjectId: string;
let viewerEmail: string;
let viewerId: string;

async function createUser(
  request: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `perfil.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await request.post('/api/auth/sign-up/email', {
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

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Perfil ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'Simpósio do Perfil Público',
    });

    eventId = event.id;

    const subject = await createUser(api, `Ana do Perfil ${RUN_ID}`);
    subjectId = subject.id;
    subjectEmail = subject.email;

    const viewer = await createUser(api, `Bruno do Perfil ${RUN_ID}`);
    viewerEmail = viewer.email;
    viewerId = viewer.id;

    /** Quem tem perfil precisa PARTICIPAR da casa — é a guarda da página pública. */
    await linkUser({ tenantId, userId: subject.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: subject.id, role: 'PARTICIPANT' });

    await linkUser({ tenantId, userId: viewer.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: viewer.id, role: 'PARTICIPANT' });

    /**
     * A participação no evento é o que faz a lista "quais eventos mostrar" existir, e o
     * XP é o que dá nível à página. Os dois entram por banco porque o cenário é sobre o
     * PERFIL, e não sobre se inscrever (esse caminho tem teste próprio).
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: subject.id,
          status: 'CONFIRMED',
          consentData: true,
          checkedInAt: new Date(),
        },
      });

      await tx.userXpProfile.create({
        data: { id: randomUUID(), tenantId, userId: subject.id, totalXp: 400, level: 5 },
      });

      /**
       * O SEGUNDO perfil de XP é o que faz a posição relativa existir: com uma pessoa
       * só na base, `standingFromRank` devolve `null` (não há "top %" de um universo de
       * um) — e a seção da página não aparece nem para quem é da casa.
       */
      await tx.userXpProfile.create({
        data: { id: randomUUID(), tenantId, userId: viewerId, totalXp: 100, level: 2 },
      });
    });
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('perfil público do participante', () => {
  test('1. a pessoa publica o próprio perfil e cada visitante vê o que foi autorizado', async ({
    page,
    browser,
  }) => {
    await signInAs(page, subjectEmail);

    await page.goto(`/t/${tenantSlug}/meu-perfil-publico`);
    await expect(page.getByTestId('my-public-profile')).toBeVisible();

    const handle = `ana-perfil-${RUN_ID}`;

    await page.getByLabel('@handle (o seu endereço)').fill(handle);
    /**
     * `exact: true` é OBRIGATÓRIO aqui: `getByLabel` casa por SUBSTRING, e o nível de
     * visibilidade se chama "Visibilidade: Título profissional" — sem o exato, o
     * localizador resolve DOIS controles e a violação de modo estrito derruba o teste.
     */
    await page.getByLabel('Título profissional', { exact: true }).fill('Pesquisadora em saúde pública');
    await page.getByLabel('Sobre você', { exact: true }).fill('Estudo vigilância epidemiológica e dados abertos.');
    await page.getByLabel('Interesses (separados por vírgula)').fill('Saúde pública, Dados abertos');
    await page.getByLabel('ORCID', { exact: true }).fill('0000-0002-1825-0097');

    /** O evento é escolhido UM a um — é o que autoriza a lista a aparecer. */
    await page.getByRole('checkbox', { name: 'Simpósio do Perfil Público' }).check();

    await page.getByTestId('save-public-profile').getByTestId('admin-submit').click();

    await expect(page.getByTestId('save-public-profile-feedback')).toContainText(/perfil salvo/i, {
      timeout: 30_000,
    });

    /** O endereço aparece na tela e o ORCID foi GRAVADO (não é campo decorativo). */
    await expect(page.getByTestId('my-profile-url')).toContainText(`/t/${tenantSlug}/u/${handle}`);

    const salvo = await e2eDb.user.findUniqueOrThrow({
      where: { id: subjectId },
      select: { publicHandle: true, orcidId: true, profileAudiences: true },
    });

    expect(salvo.publicHandle).toBe(handle);
    expect(salvo.orcidId).toBe('0000-0002-1825-0097');
    expect(salvo.profileAudiences).toMatchObject({ xp: 'ATTENDEES_ONLY', level: 'PUBLIC' });

    // ── A prévia do dono (o link abre em outra aba) ──────────────────────────
    const [previa] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('my-profile-open').click(),
    ]);

    await previa.waitForLoadState();

    await expect(previa.getByTestId('public-profile')).toBeVisible();
    await expect(previa.getByTestId('profile-owner-preview')).toBeVisible();
    await expect(previa.getByTestId('profile-name')).toHaveText(`Ana do Perfil ${RUN_ID}`);
    await expect(previa.getByTestId('profile-handle')).toHaveText(`@${handle}`);
    await expect(previa.getByTestId('profile-bio')).toContainText('vigilância epidemiológica');
    await expect(previa.getByTestId('profile-interests')).toContainText('Saúde pública');
    await expect(previa.getByTestId('profile-events')).toContainText('Simpósio do Perfil Público');

    await previa.close();

    // ── O anônimo: sem sessão nenhuma ────────────────────────────────────────
    const anonimo = await browser.newContext();
    const anonPage = await anonimo.newPage();

    try {
      await anonPage.goto(`/t/${tenantSlug}/u/${handle}`);

      await expect(anonPage.getByTestId('public-profile')).toBeVisible();
      await expect(anonPage.getByTestId('profile-owner-preview')).toHaveCount(0);
      await expect(anonPage.getByTestId('profile-name')).toHaveText(`Ana do Perfil ${RUN_ID}`);
      await expect(anonPage.getByTestId('profile-level')).toContainText('Nível 5');

      /** O XP é `ATTENDEES_ONLY`: o número não sai, nem dentro da faixa de nível. */
      await expect(anonPage.getByTestId('profile-level')).not.toContainText('400 XP');
      await expect(anonPage.getByTestId('profile-standing')).toHaveCount(0);
      await expect(anonPage.getByTestId('profile-collection')).toHaveCount(0);

      /** E o convite é honesto: há mais para quem participa. */
      await expect(anonPage.getByTestId('profile-more')).toBeVisible();
    } finally {
      await anonimo.close();
    }

    // ── Quem participa da instituição vê o que é da casa ─────────────────────
    await signInAs(page, viewerEmail);
    await page.goto(`/t/${tenantSlug}/u/${handle}`);

    await expect(page.getByTestId('public-profile')).toBeVisible();
    await expect(page.getByTestId('profile-level')).toContainText('400 XP');
    await expect(page.getByTestId('profile-collection')).toBeVisible();
    await expect(page.getByTestId('profile-standing')).toBeVisible();
    await expect(page.getByTestId('profile-more')).toHaveCount(0);
  });

  test('2. perfil privado responde 404 para os outros e o dono continua vendo a prévia', async ({
    page,
    browser,
  }) => {
    await signInAs(page, subjectEmail);
    await page.goto(`/t/${tenantSlug}/meu-perfil-publico`);

    const handle = `ana-perfil-${RUN_ID}`;
    await expect(page.getByTestId('my-public-profile')).toBeVisible();

    /**
     * O handle é preenchido aqui também, de propósito: o campo é `required`, e um
     * cenário que dependesse do que o teste anterior gravou deixaria de medir o 404 e
     * passaria a medir a validação do formulário.
     */
    await page.getByLabel('@handle (o seu endereço)').fill(handle);

    /** Tudo privado: a página deixa de existir para quem não é o dono. */
    for (const field of PUBLIC_PROFILE_FIELDS) {
      await page.getByLabel(`Visibilidade: ${PUBLIC_PROFILE_FIELD_LABELS[field]}`, { exact: true }).selectOption('PRIVATE');
    }

    await page.getByTestId('save-public-profile').getByTestId('admin-submit').click();
    await expect(page.getByTestId('save-public-profile-feedback')).toContainText(/perfil salvo/i, {
      timeout: 30_000,
    });

    const anonimo = await browser.newContext();
    const anonPage = await anonimo.newPage();

    try {
      const response = await anonPage.goto(`/t/${tenantSlug}/u/${handle}`);

      expect(response?.status()).toBe(404);
      await expect(anonPage.getByTestId('public-profile')).toHaveCount(0);
    } finally {
      await anonimo.close();
    }

    /** A prévia do dono sobrevive: é ele olhando o que ele mesmo configurou. */
    await page.goto(`/t/${tenantSlug}/u/${handle}`);
    await expect(page.getByTestId('public-profile')).toBeVisible();
    await expect(page.getByTestId('profile-owner-preview')).toBeVisible();
  });
});

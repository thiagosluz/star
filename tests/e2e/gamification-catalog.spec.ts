import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createActivity, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'gamicatalogo';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let activityId: string;
let adminEmail: string;
let participantEmail: string;

/** Cadastra uma pessoa e concede o papel na instituição. */
async function createUser(
  request: import('@playwright/test').APIRequestContext,
  name: string,
  role: 'ADMIN' | 'PARTICIPANT',
  kind: 'MEMBER' | 'PARTICIPANT',
): Promise<{ id: string; email: string }> {
  const email = `gcat.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  await linkUser({ tenantId, userId: user.id, kind });
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

/** O nome que o catálogo mostra para uma carta (o `<p>` de título do cartão). */
async function cardNames(page: import('@playwright/test').Page): Promise<string[]> {
  return page.getByTestId('admin-card-list').locator('p.font-medium').allInnerTexts();
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
      name: `Instituição do Catálogo ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'Congresso do Catálogo',
    });

    eventId = event.id;

    const activity = await createActivity({
      tenantId,
      eventId,
      slug: `oficina-${TENANT_LABEL}`,
      title: 'Oficina do Catálogo',
      capacity: 10,
      workloadMinutes: 120,
    });

    activityId = activity.id;

    const admin = await createUser(api, `Organizadora Catálogo ${RUN_ID}`, 'ADMIN', 'MEMBER');
    adminEmail = admin.email;

    const participant = await createUser(api, `Participante Catálogo ${RUN_ID}`, 'PARTICIPANT', 'PARTICIPANT');
    participantEmail = participant.email;
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('catálogo de gamificação', () => {
  test('1. a organização cria, EDITA e EXCLUI carta e missão pela tela', async ({ page }) => {
    await signInAs(page, adminEmail);

    // ── Carta: criar ────────────────────────────────────────────────────────
    await page.goto(`/t/${tenantSlug}/administracao/cartas`);

    const novaCarta = page.getByTestId('create-card');
    await novaCarta.getByLabel('Identificador').fill(`carta-catalogo-${RUN_ID}`);
    await novaCarta.getByLabel('Nome').fill('Carta Original');
    await novaCarta.getByTestId('admin-submit').click();

    await expect(page.getByTestId('create-card-feedback')).toContainText(/carta criada/i, {
      timeout: 30_000,
    });

    const carta = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.cardTemplate.findFirstOrThrow({
        where: { tenantId, slug: `carta-catalogo-${RUN_ID}` },
        select: { id: true, name: true },
      });
    });

    await expect(page.getByTestId(`admin-card-${carta.id}`)).toContainText('Carta Original');

    // ── Carta: editar ───────────────────────────────────────────────────────
    /**
     * O formulário de edição mora no MESMO lugar onde a carta aparece: quem quer
     * corrigir o nome não precisa procurar outra tela.
     */
    await page.getByTestId(`admin-card-${carta.id}`).getByText('Editar carta').click();

    const edicao = page.getByTestId(`card-form-${carta.id}`);
    await expect(edicao.getByLabel('Nome')).toHaveValue('Carta Original');

    await edicao.getByLabel('Nome').fill('Carta Editada');
    await edicao.getByTestId('admin-submit').click();

    await expect(page.getByTestId(`card-form-${carta.id}-feedback`)).toContainText(/atualizada/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId(`admin-card-${carta.id}`)).toContainText('Carta Editada');

    /** E o banco confirma: é o MESMO id, com o nome novo (editar não recria). */
    const depois = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.cardTemplate.findUniqueOrThrow({
        where: { id: carta.id },
        select: { id: true, name: true, deletedAt: true },
      });
    });

    expect(depois.name).toBe('Carta Editada');
    expect(depois.deletedAt).toBeNull();

    // ── Missão: criar, editar e excluir ─────────────────────────────────────
    await page.goto(`/t/${tenantSlug}/administracao/missoes`);

    const novaMissao = page.getByTestId('create-mission');
    await novaMissao.getByLabel('Identificador').fill(`missao-catalogo-${RUN_ID}`);
    await novaMissao.getByLabel('Nome').fill('Missão Original');
    await novaMissao.getByTestId('admin-submit').click();

    await expect(page.getByTestId('create-mission-feedback')).toContainText(/missão criada/i, {
      timeout: 30_000,
    });

    const missao = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.taskDefinition.findFirstOrThrow({
        where: { tenantId, slug: `missao-catalogo-${RUN_ID}` },
        select: { id: true },
      });
    });

    await page.getByTestId(`admin-mission-${missao.id}`).getByText('Editar missão').click();

    const edicaoMissao = page.getByTestId(`mission-form-${missao.id}`);
    await edicaoMissao.getByLabel('Nome').fill('Missão Editada');
    await edicaoMissao.getByTestId('admin-submit').click();

    await expect(page.getByTestId(`mission-form-${missao.id}-feedback`)).toContainText(
      /atualizada/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId(`admin-mission-${missao.id}`)).toContainText('Missão Editada');

    // ── Excluir a missão (com o diálogo de confirmação) ─────────────────────
    /**
     * Com `confirm`, o botão do formulário é o que ABRE o diálogo (`-open`); o envio
     * acontece no botão de dentro dele. Sem confirmar, o `inline-submit` enviaria
     * direto — e o cenário estaria medindo outro caminho.
     *
     * A asserção é o DESAPARECIMENTO da linha, e não a mensagem de sucesso: com a
     * revalidação, a missão sai da lista e leva junto o formulário e o seu recado. É o
     * que a pessoa vê.
     */
    await page.getByTestId(`mission-delete-${missao.id}-open`).click();
    await page.getByRole('button', { name: 'Excluir missão' }).click();

    await expect(page.getByTestId(`admin-mission-${missao.id}`)).toHaveCount(0, { timeout: 30_000 });

    const missaoExcluida = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.taskDefinition.findUniqueOrThrow({
        where: { id: missao.id },
        select: { deletedAt: true },
      });
    });

    /** Exclusão LÓGICA: a linha continua no banco (o histórico depende dela). */
    expect(missaoExcluida.deletedAt).not.toBeNull();

    // ── Excluir a carta ─────────────────────────────────────────────────────
    await page.goto(`/t/${tenantSlug}/administracao/cartas`);
    await page.getByTestId(`card-delete-${carta.id}-open`).click();
    await page.getByRole('button', { name: 'Excluir carta' }).click();

    await expect(page.getByTestId(`admin-card-${carta.id}`)).toHaveCount(0, { timeout: 30_000 });
    expect(await cardNames(page)).not.toContain('Carta Editada');
  });

  test('2. a inscrição confirmada credita XP e aparece no extrato do participante', async ({
    page,
  }) => {
    /**
     * O fato que faltava (FASE 43): inscrever-se era invisível para a gamificação.
     * Aqui ele é feito pelo CAMINHO DA PESSOA — a página da atividade — para o teste
     * medir o que acontece de verdade, e não o serviço chamado por outro teste.
     */
    await signInAs(page, participantEmail);

    await page.goto(`/t/${tenantSlug}/eventos/evento-${TENANT_LABEL}/atividades/oficina-${TENANT_LABEL}`);

    await page.getByRole('checkbox', { name: /autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();

    await expect(page.getByTestId('registration-status')).toContainText(/inscrição confirmada/i, {
      timeout: 30_000,
    });

    /** A inscrição aconteceu... */
    const inscricao = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.registration.findFirstOrThrow({
        where: { tenantId, activityId },
        select: { status: true },
      });
    });

    expect(inscricao.status).toBe('CONFIRMED');

    /** ...e o crédito saiu, com a origem legível para quem lê o extrato. */
    await page.goto(`/t/${tenantSlug}/conquistas`);

    await expect(page.getByTestId('xp-total')).toHaveText('30');
    await expect(page.getByTestId('xp-history')).toContainText('Inscrição confirmada');

    const credito = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.xpTransaction.findMany({
        where: { tenantId, source: 'REGISTRATION_CONFIRMED' },
        select: { amount: true },
      });
    });

    expect(credito).toHaveLength(1);
    expect(credito[0]?.amount).toBe(30);
  });
});

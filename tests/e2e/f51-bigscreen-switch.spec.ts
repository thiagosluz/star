/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O interruptor do telão do sorteio (FASE 51 · dívida E37)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A JORNADA, DO PONTO DE VISTA DE QUEM OPERA O PALCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O palco responde desde a CRIAÇÃO do sorteio e anuncia o título do prêmio — é assim
 *  que o organizador testa o endereço antes do evento e projeta o mesmo link no dia.
 *  O que faltava era poder NEGAR o acesso até a instituição decidir ligar o telão.
 *
 *    1. o organizador cria o sorteio "para o palco": o endereço existe e, no ar, ele
 *       anuncia o prêmio (o comportamento de sempre);
 *    2. ele desliga o telão no painel — com o aviso do que acontece com quem tem o link;
 *    3. quem tem o link passa a ver o AVISO: a página responde, diz que está desligada,
 *       e não mostra prêmio nem elegíveis (e não é 404: o organizador precisa
 *       distinguir "desligado" de "endereço errado");
 *    4. a virada fica na trilha, com quem desligou;
 *    5. ligar de novo devolve o palco;
 *    6. e o interruptor funciona SEM JavaScript — é um formulário de servidor.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f51-telao';
const EVENT_SLUG = `evento-f51-telao-${RUN_ID}`;
const ACTIVITY_TITLE = `Minicurso do telão ${RUN_ID}`;
const RAFFLE_TITLE = `Sorteio de encerramento ${RUN_ID}`;
const PRIZE_TITLE = `Notebook 14 polegadas ${RUN_ID}`;
const DAY = new Date('2026-09-17T13:00:00.000Z');

const slug = `${TENANT_LABEL}-${RUN_ID}`;

let tenantId: string;
let eventId: string;
let activityId: string;
let api: import('@playwright/test').APIRequestContext;

test.afterAll(async () => {
  await api?.dispose();
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/**
 * Cria a conta pelo contexto de REQUISIÇÃO (não pela página): o mesmo usuário serve
 * aos cenários com e sem JavaScript, e o cenário sem JS não tem página para assinar.
 */
async function createUser(name: string, role: 'ADMIN' | 'PARTICIPANT') {
  const email = `f51.telao.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
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

async function addAttendance(userId: string): Promise<void> {
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
        checkedInAt: DAY,
        checkedOutAt: new Date(DAY.getTime() + 120 * 60_000),
        minutesAttended: 120,
      },
    });
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL });

  const tenant = await createTenant({ label: TENANT_LABEL, name: `Instituição Telão ${RUN_ID}` });
  tenantId = tenant.id;
  eventId = randomUUID();
  activityId = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: `Congresso do Telão ${RUN_ID}`,
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-09-17T12:00:00.000Z'),
        endsAt: new Date('2026-09-20T23:00:00.000Z'),
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
        slug: `minicurso-telao-${RUN_ID}`,
        title: ACTIVITY_TITLE,
        type: 'MINI_COURSE',
        status: 'COMPLETED',
        modality: 'IN_PERSON',
        startsAt: DAY,
        endsAt: new Date(DAY.getTime() + 4 * 3_600_000),
        workloadMinutes: 240,
      },
    });
  });
});

const sorteiosUrl = () => `/t/${slug}/administracao/eventos/${eventId}/sorteios`;
const palcoUrl = (raffleId: string) => `/t/${slug}/eventos/${EVENT_SLUG}/sorteios/${raffleId}/palco`;

async function raffleRow() {
  return e2eDb.raffle.findFirstOrThrow({
    where: { tenantId, title: RAFFLE_TITLE },
    select: { id: true, bigscreenVisible: true },
  });
}

/** A trilha da virada, lida sob o contexto da instituição. */
async function switchTrail(raffleId: string) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.auditLog.findMany({
      where: { tenantId, entityType: 'raffle', entityId: raffleId, action: 'UPDATE' },
      orderBy: { createdAt: 'asc' },
      select: { changes: true, userId: true, createdAt: true },
    });
  });
}

/** Cria o sorteio "para o palco" pelo painel, como o organizador faz no dia. */
async function criarSorteioParaOPalco(page: Page): Promise<string> {
  await page.goto(sorteiosUrl());
  await expect(page.getByTestId('raffle-console')).toBeVisible();

  const form = page.getByTestId('raffle-form');
  await form.getByLabel('Título do sorteio').fill(RAFFLE_TITLE);
  await form.getByLabel('Universo do sorteio').selectOption('ACTIVITY');
  await form.getByLabel('Atividade').selectOption({ label: ACTIVITY_TITLE });
  await form.getByLabel('Piso de minutos assistidos').fill('60');
  await form.getByLabel('Quantos vencedores').fill('1');
  await form.getByTestId('raffle-prize-title').fill(PRIZE_TITLE);

  await page.getByTestId('create-raffle-for-stage').click();
  await expect(page.getByTestId('raffle-stage-created')).toBeVisible({ timeout: 30_000 });

  return (await raffleRow()).id;
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('interruptor do telão', () => {
  test('1. no ar o palco anuncia o prêmio; desligado ele avisa e não vaza nada', async ({ page }) => {
    test.setTimeout(180_000);

    const organizer = await createUser(`Organizador do Telão ${RUN_ID}`, 'ADMIN');
    const presente1 = await createUser(`Presente do Telão 1 ${RUN_ID}`, 'PARTICIPANT');
    const presente2 = await createUser(`Presente do Telão 2 ${RUN_ID}`, 'PARTICIPANT');
    await addAttendance(presente1.id);
    await addAttendance(presente2.id);

    await signInAs(page, organizer.email);

    const raffleId = await criarSorteioParaOPalco(page);

    // A coluna nasce LIGADA: nenhum sorteio existente muda de comportamento.
    expect((await raffleRow()).bigscreenVisible).toBe(true);

    /**
     * ── O PALCO NO AR (o comportamento de sempre) ────────────────────────────
     *  A parede anuncia o prêmio da rodada preparada e a contagem de elegíveis — é
     *  para isso que o endereço existe desde a criação do sorteio.
     */
    await page.goto(palcoUrl(raffleId));
    await expect(page.getByTestId('raffle-stage')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('stage-round-announce')).toContainText(PRIZE_TITLE);

    // ── O INTERRUPTOR, no painel ────────────────────────────────────────────
    await page.goto(sorteiosUrl());

    const interruptor = page.getByTestId(`stage-switch-${raffleId}`);
    await expect(interruptor).toHaveAttribute('data-bigscreen-visible', 'true');
    // O aviso diz o que acontece com quem tem o link.
    await expect(interruptor).toContainText(/quem tem o endereço vê o sorteio ao vivo/i);

    await page.getByTestId(`stage-switch-submit-${raffleId}`).click();

    await expect(page.getByTestId(`stage-switch-feedback-${raffleId}`)).toContainText(
      /desligado/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId(`stage-switch-${raffleId}`)).toHaveAttribute(
      'data-bigscreen-visible',
      'false',
    );
    expect((await raffleRow()).bigscreenVisible).toBe(false);

    /**
     * ── O TELÃO DESLIGADO: responde, AVISA e não conta nada ─────────────────
     *  Não é 404 (o organizador precisa distinguir "desligado" de "endereço errado"),
     *  e não é a página do sorteio (nem prêmio, nem elegíveis).
     */
    const resposta = await page.goto(palcoUrl(raffleId));
    expect(resposta?.status()).toBe(200);

    await expect(page.getByTestId('stage-off')).toBeVisible();
    await expect(page.getByTestId('stage-off-title')).toContainText(/desligado/i);
    await expect(page.getByTestId('stage-off-message')).toContainText(/desligou/i);

    // Nada do sorteio aparece — e nem o fluxo ao vivo é montado.
    await expect(page.getByText(PRIZE_TITLE)).toHaveCount(0);
    await expect(page.getByTestId('raffle-stage')).toHaveCount(0);
    await expect(page.getByTestId('stage-eligible')).toHaveCount(0);

    // O caminho de volta para quem organiza.
    await expect(page.getByTestId('stage-off-organizer-link')).toBeVisible();

    // ── A TRILHA guarda quem desligou e quando ──────────────────────────────
    const trilha = await switchTrail(raffleId);
    expect(trilha.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(trilha[0]!.changes)).toContain('bigscreenVisible');
    expect(trilha[0]!.userId).toBe(organizer.id);
    expect(trilha[0]!.createdAt).toBeInstanceOf(Date);

    // ── LIGAR DE NOVO devolve o palco ───────────────────────────────────────
    await page.goto(sorteiosUrl());
    await page.getByTestId(`stage-switch-submit-${raffleId}`).click();

    await expect(page.getByTestId(`stage-switch-feedback-${raffleId}`)).toContainText(/ligado/i, {
      timeout: 30_000,
    });
    expect((await raffleRow()).bigscreenVisible).toBe(true);

    await page.goto(palcoUrl(raffleId));
    await expect(page.getByTestId('raffle-stage')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('stage-round-announce')).toContainText(PRIZE_TITLE);
  });

  test('2. SEM JavaScript o interruptor também desliga (formulário de servidor)', async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const organizer = await createUser(`Organizador sem JS ${RUN_ID}`, 'ADMIN');
    const raffleId = (await raffleRow()).id;

    // O cenário anterior terminou com o telão LIGADO; o estado é conferido aqui para a
    // asserção medir a VIRADA, e não o que o teste anterior deixou.
    expect((await raffleRow()).bigscreenVisible).toBe(true);

    const contexto = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();

    try {
      await signInAs(page, organizer.email);
      await page.goto(sorteiosUrl());

      /**
       * O contexto é criado com `javaScriptEnabled: false`: o bundle NUNCA carrega, e o
       * clique no botão é um POST nativo do formulário. Se o interruptor dependesse de
       * hidratação, o telão ficaria no ar — e é justamente na abertura do evento, com a
       * rede do pavilhão, que isso importa (dívida E50, armadilha 88).
       */
      await page.getByTestId(`stage-switch-submit-${raffleId}`).click();
      await page.waitForLoadState('load');

      await expect
        .poll(async () => (await raffleRow()).bigscreenVisible, { timeout: 30_000 })
        .toBe(false);
    } finally {
      await contexto.close();
    }
  });
});

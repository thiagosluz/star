/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Quadro de demandas internas do evento (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. a organização cria a EQUIPE com líder e membros, e cria a demanda com prazo,
 *      equipe e responsável — o cartão nasce na primeira coluna e o responsável é
 *      avisado (mensagem na caixa de entrada);
 *   2. **o quadro funciona SEM JavaScript**: com o bundle desligado, o formulário do
 *      cartão move a demanda de verdade (é o que quita a dívida E50 no quadro);
 *   3. o ARRASTAR E SOLTAR move o cartão de coluna, e quem decide a ordem é o
 *      servidor — a coluna de conclusão carimba `completedAt` e o resumo conta;
 *   4. comentar com menção registra o comentário e avisa quem foi mencionado;
 *   5. o prazo vencido aparece como "Atrasada" no cartão e no resumo, e quem não tem
 *      permissão não entra no quadro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CONFERÊNCIA É DO DADO, NÃO DA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada cenário afirma a coluna, o `completedAt`, a linha do tempo e a mensagem no
 *  BANCO — a tela prova que o caminho existe, o dado prova que ele funcionou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'demandas-f38';
const EVENT_SLUG = `evento-f38-${RUN_ID}`;

let tenantId: string;
let eventId: string;
let organizerEmail: string;
let memberName: string;
let memberId: string;
let participantEmail: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f38.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Ontem/amanhã no calendário local do processo — o quadro mostra o rótulo do evento. */
function dayInput(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function boardState() {
  const columns = await e2eDb.demandColumn.findMany({
    where: { board: { eventId } },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, isDone: true },
  });

  const demands = await e2eDb.demand.findMany({
    where: { eventId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      columnId: true,
      position: true,
      completedAt: true,
      dueAt: true,
      teamId: true,
      assignees: { select: { userId: true } },
    },
  });

  return { columns, demands };
}

async function tableOf(demandId: string) {
  return e2eDb.demandEvent.findMany({
    where: { demandId },
    orderBy: { createdAt: 'asc' },
    select: { kind: true, fromValue: true, toValue: true },
  });
}

/**
 * Arrasta um cartão até uma coluna com eventos REAIS de HTML5.
 *
 * O `dragTo` do Playwright emula mouse, e mouse não dispara `dragstart` de HTML5 no
 * Chromium de forma confiável dentro do Docker. Aqui os eventos são construídos com
 * `DataTransfer` — e entre o `dragstart` e o `drop` há uma pausa, porque o componente
 * guarda o cartão arrastado em ESTADO do React (o `drop` síncrono veria o estado
 * anterior e não faria nada).
 */
async function dragCardToColumn(
  page: import('@playwright/test').Page,
  demandId: string,
  columnId: string,
): Promise<void> {
  await page.evaluate((id) => {
    const card = document.querySelector(`[data-demand-id="${id}"]`);
    const dataTransfer = new DataTransfer();
    card?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
  }, demandId);

  await page.waitForTimeout(150);

  await page.evaluate(
    ({ column, demand }) => {
      const target = document.querySelector(`[data-column-drop="${column}"]`);
      const card = document.querySelector(`[data-demand-id="${demand}"]`);
      const dataTransfer = new DataTransfer();

      target?.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
      target?.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
      card?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    },
    { column: columnId, demand: demandId },
  );
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição das Demandas ${RUN_ID}`,
    });
    tenantId = tenant.id;
    eventId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 20 * 86_400_000);

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso das Demandas ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          capacity: null,
          confirmedCount: 0,
        },
      });
    });

    const organizer = await signUpVia(api, `Organizador das Demandas ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });

    /** A pessoa que trabalha no evento: vínculo MEMBER ATIVO. */
    memberName = `Ana da Logística ${RUN_ID}`;
    const member = await signUpVia(api, memberName);
    memberId = member.id;
    await linkUser({ tenantId, userId: member.id, kind: 'MEMBER' });

    /** Quem só participa: NÃO pode ser atribuído nem entrar no quadro. */
    const participant = await signUpVia(api, `Participante ${RUN_ID}`);
    participantEmail = participant.email;
    await linkUser({ tenantId, userId: participant.id, kind: 'PARTICIPANT' });
  } finally {
    await api.dispose();
  }
});

const boardUrl = () => `/t/${slug}/administracao/eventos/${eventId}/demandas`;
const teamsUrl = () => `/t/${slug}/administracao/eventos/${eventId}/equipes`;

test.describe('quadro de demandas internas', () => {
  test('1. a equipe nasce com líder e a demanda com prazo, equipe e responsável', async ({ page }) => {
    await signInAs(page, organizerEmail);

    // ── A equipe, pela tela ────────────────────────────────────────────────────
    await page.goto(teamsUrl());
    await page.getByTestId('team-create').locator('summary').click();

    const teamForm = page.getByTestId('team-create-form');
    await teamForm.getByTestId('team-name').fill(`Logística ${RUN_ID}`);
    await teamForm.getByTestId('team-description').fill('Som, credenciamento e apoio');
    await teamForm.getByTestId('team-members').selectOption({ label: memberName });
    await teamForm.getByTestId('team-lead').selectOption({ label: memberName });

    await teamForm.getByTestId('inline-submit').click();

    await expect
      .poll(async () => e2eDb.eventTeam.count({ where: { eventId } }), { timeout: 30_000 })
      .toBe(1);

    const team = await e2eDb.eventTeam.findFirstOrThrow({
      where: { eventId },
      select: { id: true, name: true, members: { select: { userId: true, isLead: true } } },
    });

    expect(team.name).toBe(`Logística ${RUN_ID}`);
    expect(team.members).toEqual([{ userId: memberId, isLead: true }]);

    // ── A demanda, pela tela ───────────────────────────────────────────────────
    await page.goto(boardUrl());
    await page.getByTestId('demand-create').locator('summary').click();

    const form = page.getByTestId('demand-create-form');
    await form.getByTestId('demand-title').fill('Montar os crachás do credenciamento');
    await form.getByTestId('demand-description').fill('Conferir as etiquetas e a impressora térmica.');
    await form.getByTestId('demand-priority').selectOption('URGENT');
    await form.getByTestId('demand-team').selectOption({ label: `Logística ${RUN_ID}` });
    await form.getByTestId('demand-due').fill(dayInput(2));
    await form.getByTestId('demand-assignees').selectOption({ label: memberName });

    await form.getByTestId('inline-submit').click();

    await expect
      .poll(async () => (await boardState()).demands.length, { timeout: 30_000 })
      .toBe(1);

    const state = await boardState();
    const card = state.demands[0]!;

    /** Nasceu na PRIMEIRA coluna (a de menor posição) e com a equipe e a pessoa. */
    expect(card.columnId).toBe(state.columns[0]!.id);
    expect(state.columns.map((column) => column.name)).toEqual([
      'A fazer',
      'Em andamento',
      'Em revisão',
      'Bloqueado',
      'Concluído',
    ]);
    expect(card.teamId).toBe(team.id);
    expect(card.assignees.map((assignee) => assignee.userId)).toEqual([memberId]);
    expect(card.dueAt).not.toBeNull();

    /** O responsável foi avisado: a mensagem está na caixa de entrada dele. */
    await expect
      .poll(
        async () =>
          e2eDb.participantMessage.count({
            where: { userId: memberId, dedupeKey: { startsWith: `demand-assigned-${card.id}` } },
          }),
        { timeout: 30_000 },
      )
      .toBe(1);

    /** E o cartão mostra a prioridade e a equipe na tela. */
    await page.reload();
    await expect(page.getByTestId(`demand-card-priority-${card.id}`)).toContainText('Urgente');
    await expect(page.getByTestId(`demand-card-people-${card.id}`)).toContainText(memberName);
  });

  test('2. SEM JavaScript o formulário do cartão move a demanda', async ({ browser }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA DA DÍVIDA E50
     * ─────────────────────────────────────────────────────────────────────────────
     *  O contexto é criado com `javaScriptEnabled: false`: o bundle NUNCA carrega, e o
     *  clique no botão é um POST nativo do formulário. Era exatamente isto que faltava
     *  nas telas de operação — a ação em linha que só existia depois da hidratação
     *  (armadilha 88).
     */
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);

      const state = await boardState();
      const card = state.demands[0]!;
      const target = state.columns[1]!; // "Em andamento"

      await page.goto(boardUrl());

      const moveForm = page.getByTestId(`demand-move-select-${card.id}`).locator('..');
      await moveForm.getByTestId(`demand-move-select-${card.id}`).selectOption(target.id);
      await moveForm.getByTestId(`demand-move-submit-${card.id}`).click();

      await expect
        .poll(
          async () =>
            (
              await e2eDb.demand.findUniqueOrThrow({
                where: { id: card.id },
                select: { columnId: true },
              })
            ).columnId,
          { timeout: 30_000 },
        )
        .toBe(target.id);

      await expect.poll(async () => (await tableOf(card.id)).length, { timeout: 30_000 }).toBe(2);
      expect((await tableOf(card.id))[1]).toMatchObject({ kind: 'MOVED' });
    } finally {
      await context.close();
    }
  });

  test('3. arrastar e soltar move de coluna, e a coluna de conclusão carimba a data', async ({
    page,
  }) => {
    await signInAs(page, organizerEmail);
    await page.goto(boardUrl());

    const state = await boardState();
    const card = state.demands[0]!;
    const doing = state.columns[1]!;
    const done = state.columns[4]!;

    expect(card.columnId).toBe(doing.id);

    /** Arrasta para "Em revisão". */
    const review = state.columns[2]!;
    await dragCardToColumn(page, card.id, review.id);

    await expect
      .poll(
        async () =>
          (
            await e2eDb.demand.findUniqueOrThrow({
              where: { id: card.id },
              select: { columnId: true },
            })
          ).columnId,
        { timeout: 30_000 },
      )
      .toBe(review.id);

    /** E depois para "Concluído": a data de conclusão é gravada pelo SERVIDOR. */
    await dragCardToColumn(page, card.id, done.id);

    await expect
      .poll(
        async () =>
          (
            await e2eDb.demand.findUniqueOrThrow({
              where: { id: card.id },
              select: { completedAt: true },
            })
          ).completedAt,
        { timeout: 30_000 },
      )
      .not.toBeNull();

    const kinds = (await tableOf(card.id)).map((entry) => entry.kind);
    expect(kinds).toEqual(['CREATED', 'MOVED', 'MOVED', 'COMPLETED']);

    await page.reload();
    await expect(page.getByTestId('demand-card-situation-' + card.id)).toContainText('Concluída');
    await expect(page.getByTestId('demand-summary-done')).toContainText('1');
  });

  test('4. comentar com menção registra a conversa e avisa quem foi mencionado', async ({ page }) => {
    await signInAs(page, organizerEmail);

    const state = await boardState();
    const card = state.demands[0]!;

    await page.goto(`${boardUrl()}/${card.id}`);

    const form = page.getByTestId('demand-comment-form');
    await form
      .getByTestId('demand-comment-body')
      .fill('Ana, confirme a impressora térmica antes de quinta.');
    await form.getByTestId('demand-comment-mentions').selectOption({ label: memberName });
    await form.getByTestId('inline-submit').click();

    await expect
      .poll(
        async () => e2eDb.demandComment.count({ where: { demandId: card.id } }),
        { timeout: 30_000 },
      )
      .toBe(1);

    const comment = await e2eDb.demandComment.findFirstOrThrow({
      where: { demandId: card.id },
      select: { id: true, body: true, mentions: { select: { userId: true, notifiedAt: true } } },
    });

    expect(comment.body).toContain('impressora térmica');
    expect(comment.mentions.map((mention) => mention.userId)).toEqual([memberId]);
    expect(comment.mentions[0]!.notifiedAt).not.toBeNull();

    await expect
      .poll(
        async () =>
          e2eDb.participantMessage.count({
            where: { userId: memberId, dedupeKey: { startsWith: `demand-mention-${comment.id}` } },
          }),
        { timeout: 30_000 },
      )
      .toBe(1);

    await page.reload();
    await expect(page.getByTestId(`demand-comment-${comment.id}`)).toContainText(
      'impressora térmica',
    );
    await expect(page.getByTestId('demand-timeline')).toContainText('comentou');
  });

  test('5. o prazo vencido aparece como atrasado, e quem não tem permissão não entra', async ({
    page,
  }) => {
    await signInAs(page, organizerEmail);
    await page.goto(boardUrl());

    await page.getByTestId('demand-create').locator('summary').click();

    const form = page.getByTestId('demand-create-form');
    await form.getByTestId('demand-title').fill('Fechar o contrato do som');
    /** Ontem: o prazo é o FIM daquele dia, e já passou. */
    await form.getByTestId('demand-due').fill(dayInput(-1));
    await form.getByTestId('inline-submit').click();

    await expect
      .poll(async () => (await boardState()).demands.length, { timeout: 30_000 })
      .toBe(2);

    const late = (await boardState()).demands.find((demand) => demand.title.includes('contrato'))!;

    await page.reload();
    await expect(page.getByTestId(`demand-card-situation-${late.id}`)).toContainText('Atrasada');
    await expect(page.getByTestId('demand-summary-overdue')).toContainText('1');

    /**
     * Quem só participa do evento não entra no quadro: a guarda da página manda para
     * o painel. A asserção é o DESTINO, e não a ausência da palavra "demandas" na
     * URL — o slug da instituição deste teste contém essa palavra, e a primeira
     * versão desta linha passava a falhar por causa do nome do próprio tenant.
     */
    await signInAs(page, participantEmail);
    await page.goto(boardUrl());

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('demand-board')).toHaveCount(0);
  });
});

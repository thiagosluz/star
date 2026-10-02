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
 * A ordem dos cartões de UMA coluna, na mesma régua da tela (`position` crescente).
 *
 * A asserção de reordenação precisa da ORDEM, e não do `columnId`: é isso que o teclado
 * muda — o cartão fica na mesma coluna e troca de lugar dentro dela.
 */
async function columnOrder(columnId: string): Promise<string[]> {
  const rows = await e2eDb.demand.findMany({
    where: { columnId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });

  return rows.map((row) => row.id);
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ARRASTA ATÉ O SERVIDOR CONFIRMAR (FASE 60 · dívida I3)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O arrastar atravessa o ESTADO do React (o cartão sai no `dragstart` e o `drop`
 *  lê o que estiver guardado). Se o primeiro `dragstart` cair antes de o bundle
 *  assumir a página, o `drop` não encontra nada e o quadro fica parado — sem erro
 *  e sem POST. Repetir o gesto até a COLUNA MUDAR NO BANCO é a mesma defesa que o
 *  resto da suíte usa para ação em linha (F52 · armadilha 106): a prova é o efeito,
 *  não o clique.
 */
async function dragAte(
  page: import('@playwright/test').Page,
  demandId: string,
  columnId: string,
): Promise<void> {
  await expect(async () => {
    await dragCardToColumn(page, demandId, columnId);

    await expect
      .poll(
        async () =>
          (
            await e2eDb.demand.findUniqueOrThrow({
              where: { id: demandId },
              select: { columnId: true },
            })
          ).columnId,
        { timeout: 5_000 },
      )
      .toBe(columnId);
  }).toPass({ timeout: 45_000 });
}

/**
 * Abre o formulário de criação SÓ se ele estiver fechado.
 *
 * O estado do `<details>` é do DOM e sobrevive à regravação da página: depois de criar
 * um cartão ele continua aberto, e um clique cego no `summary` o fecharia — deixando o
 * campo invisível para o passo seguinte.
 */
async function openCreateForm(page: import('@playwright/test').Page): Promise<void> {
  const details = page.getByTestId('demand-create');
  const aberto = await details.evaluate((element) => (element as HTMLDetailsElement).open);

  if (!aberto) await details.locator('summary').click();
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CADA CASO PREPARA O PRÓPRIO CARTÃO (FASE 60 · dívida I3) — O QUE VAZAVA
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Os casos 2, 3, 4 e 5 liam `boardState().demands[0]` (ou `demands.length`) — o
 *  cartão que o caso 1 cria pela tela. Medido, rodando UM caso por vez:
 *
 *      npx playwright test demand-board.spec.ts --grep "2. SEM JavaScript"
 *        ✘ TypeError: Cannot read properties of undefined (reading 'id')
 *      npx playwright test demand-board.spec.ts --grep "3. arrastar"
 *        ✘ TypeError: Cannot read properties of undefined (reading 'columnId')
 *
 *  Rodando o arquivo inteiro passa (7 passed); rodando um caso só, não existe
 *  cartão nenhum. É a mesma família da dívida **E71** (a suíte de credenciamento
 *  dependia da ordem) — e o efeito num relatório é o pior possível: **um** tropeço
 *  do caso 1 (rede, banco, bundle) vira **três** casos vermelhos, porque 2 e 3
 *  morrem no mesmo `undefined`. Foi esse o "demand-board com 3 casos" medido na
 *  dívida I3, e é isso que este bloco fecha.
 *
 *  A fixture abaixo cria o cartão pelo MESMO caminho da tela (a criação tem
 *  cenário próprio no caso 1; aqui ela é preparação). O caso 7 já fazia isso com a
 *  coluna — "depender do que os casos anteriores deixaram faria o teste passar ou
 *  falhar conforme a ordem"—, e agora os quatro fazem igual.
 */
async function criarCartao(
  page: import('@playwright/test').Page,
  titulo: string,
  dueAt?: string,
): Promise<{ id: string; columnId: string }> {
  await page.goto(boardUrl());
  await openCreateForm(page);

  const form = page.getByTestId('demand-create-form');
  await form.getByTestId('demand-title').fill(titulo);

  if (dueAt) await form.getByTestId('demand-due').fill(dueAt);

  await form.getByTestId('inline-submit').click();

  await expect
    .poll(async () => (await boardState()).demands.some((demand) => demand.title === titulo), {
      timeout: 30_000,
    })
    .toBe(true);

  const cartao = (await boardState()).demands.find((demand) => demand.title === titulo)!;

  return { id: cartao.id, columnId: cartao.columnId };
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

    const titulo = 'Montar os crachás do credenciamento';

    const form = page.getByTestId('demand-create-form');
    await form.getByTestId('demand-title').fill(titulo);
    await form.getByTestId('demand-description').fill('Conferir as etiquetas e a impressora térmica.');
    await form.getByTestId('demand-priority').selectOption('URGENT');
    await form.getByTestId('demand-team').selectOption({ label: `Logística ${RUN_ID}` });
    await form.getByTestId('demand-due').fill(dayInput(2));
    await form.getByTestId('demand-assignees').selectOption({ label: memberName });

    await form.getByTestId('inline-submit').click();

    /**
     * A espera é o cartão DESTE caso, pelo título — não o total de demandas do
     * quadro (era `.toBe(1)`), que só valia enquanto este caso fosse o primeiro a
     * rodar (FASE 60 · dívida I3).
     */
    await expect
      .poll(async () => (await boardState()).demands.some((demand) => demand.title === titulo), {
        timeout: 30_000,
      })
      .toBe(true);

    const state = await boardState();
    const card = state.demands.find((demand) => demand.title === titulo)!;

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

      /** O cartão deste caso — criado aqui, sem depender do caso 1. */
      const cartao = await criarCartao(page, `Organizar a recepção ${RUN_ID}`);

      const target = (await boardState()).columns[1]!; // "Em andamento"

      const moveForm = page.getByTestId(`demand-move-select-${cartao.id}`).locator('..');
      await moveForm.getByTestId(`demand-move-select-${cartao.id}`).selectOption(target.id);
      await moveForm.getByTestId(`demand-move-submit-${cartao.id}`).click();

      await expect
        .poll(
          async () =>
            (
              await e2eDb.demand.findUniqueOrThrow({
                where: { id: cartao.id },
                select: { columnId: true },
              })
            ).columnId,
          { timeout: 30_000 },
        )
        .toBe(target.id);

      await expect.poll(async () => (await tableOf(cartao.id)).length, { timeout: 30_000 }).toBe(2);
      expect((await tableOf(cartao.id))[1]).toMatchObject({ kind: 'MOVED' });
    } finally {
      await context.close();
    }
  });

  test('3. arrastar e soltar move de coluna, e a coluna de conclusão carimba a data', async ({
    page,
  }) => {
    await signInAs(page, organizerEmail);

    /** O cartão deste caso nasce na PRIMEIRA coluna — o cenário mede o ARRASTAR. */
    const cartao = await criarCartao(page, `Fechar o áudio do palco ${RUN_ID}`);
    const state = await boardState();
    const review = state.columns[2]!;
    const done = state.columns[4]!;

    expect(cartao.columnId).toBe(state.columns[0]!.id);

    /** Arrasta para "Em revisão". */
    await dragAte(page, cartao.id, review.id);

    /** E depois para "Concluído": a data de conclusão é gravada pelo SERVIDOR. */
    await dragAte(page, cartao.id, done.id);

    await expect
      .poll(
        async () =>
          (
            await e2eDb.demand.findUniqueOrThrow({
              where: { id: cartao.id },
              select: { completedAt: true },
            })
          ).completedAt,
        { timeout: 30_000 },
      )
      .not.toBeNull();

    const kinds = (await tableOf(cartao.id)).map((entry) => entry.kind);
    expect(kinds).toEqual(['CREATED', 'MOVED', 'COMPLETED']);

    await page.reload();
    await expect(page.getByTestId('demand-card-situation-' + cartao.id)).toContainText('Concluída');
    await expect(page.getByTestId('demand-summary-done')).toContainText('1');
  });

  test('4. comentar com menção registra a conversa e avisa quem foi mencionado', async ({ page }) => {
    await signInAs(page, organizerEmail);

    /** O cartão deste caso — a conversa não depende do que outro caso deixou. */
    const cartao = await criarCartao(page, `Confirmar a impressora ${RUN_ID}`);

    await page.goto(`${boardUrl()}/${cartao.id}`);

    const form = page.getByTestId('demand-comment-form');
    await form
      .getByTestId('demand-comment-body')
      .fill('Ana, confirme a impressora térmica antes de quinta.');
    await form.getByTestId('demand-comment-mentions').selectOption({ label: memberName });
    await form.getByTestId('inline-submit').click();

    await expect
      .poll(
        async () => e2eDb.demandComment.count({ where: { demandId: cartao.id } }),
        { timeout: 30_000 },
      )
      .toBe(1);

    const comment = await e2eDb.demandComment.findFirstOrThrow({
      where: { demandId: cartao.id },
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

    const titulo = `Fechar o contrato do som ${RUN_ID}`;

    /**
     * O cartão nasce com o prazo de ONTEM, pelo mesmo formulário da tela — e a
     * espera é a existência DELE, não o total de demandas do quadro. Contar o total
     * amarravia este caso ao número de cartões que os outros deixaram (era
     * `.toBe(2)`): a mesma dependência de ordem que os casos 2, 3 e 4 acabaram de
     * perder (dívida I3).
     */
    const cartao = await criarCartao(page, titulo, dayInput(-1));

    const late = (await boardState()).demands.find((demand) => demand.title === titulo)!;

    expect(late.id).toBe(cartao.id);

    await page.goto(boardUrl());
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

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  A TERCEIRA PORTA: TECLADO (dívida E51)
   *
   *  O arrastar reordena DENTRO da coluna e o formulário do cartão troca de COLUNA —
   *  quem não usa ponteiro não tinha como mudar a ordem. O cenário monta três cartões
   *  na MESMA coluna e move o último para cima com `Alt + ↑`, provando:
   *
   *    • a ordem gravada no banco (a escrita é a mesma do arrastar, com a trava da
   *      ADR-203 pelo `fromColumnId`);
   *    • o anúncio na região viva (quem não vê a tela precisa ouvir a posição nova);
   *    • o FOCO no cartão depois da regravação (sem ele, a segunda tecla iria para o
   *      `body`);
   *    • e que a seta SOZINHA não move nada — o acorde é `Alt + seta`.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  test('6. o teclado reordena o cartão DENTRO da coluna e anuncia a posição', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(boardUrl());

    /** Dois cartões novos caem na primeira coluna ("A fazer"), junto do que já está lá. */
    for (const title of ['Separar os banners', 'Revisar a lista de presença']) {
      /**
       * O `<details>` do formulário fica ABERTO depois de enviar: clicar no `summary`
       * sem conferir FECHA o painel, e o campo deixa de estar visível (a primeira
       * versão deste cenário mediu o próprio clique, e não o quadro).
       */
      await openCreateForm(page);

      const form = page.getByTestId('demand-create-form');
      await form.getByTestId('demand-title').fill(title);
      await form.getByTestId('inline-submit').click();

      await expect
        .poll(async () => (await boardState()).demands.some((demand) => demand.title === title), {
          timeout: 30_000,
        })
        .toBe(true);
    }

    await page.reload();

    const state = await boardState();
    const column = state.columns[0]!;
    const ordem = await columnOrder(column.id);

    expect(ordem.length).toBeGreaterThanOrEqual(3);

    const ultimo = ordem[ordem.length - 1]!;
    const card = page.getByTestId(`demand-card-${ultimo}`);

    /**
     * O cartão precisa ser FOCÁVEL para o teclado alcançá-lo — é o `tabIndex` que a
     * dívida E51 acrescentou —, e o atalho vem descrito no aviso referenciado por
     * `aria-describedby`.
     */
    await card.focus();
    await expect(card).toBeFocused();

    /** A seta SOZINHA não reordena: sem o `Alt` o navegador rola a página. */
    await page.keyboard.press('ArrowUp');

    await expect.poll(async () => (await columnOrder(column.id)).indexOf(ultimo), { timeout: 10_000 }).toBe(
      ordem.length - 1,
    );

    await page.keyboard.press('Alt+ArrowUp');

    const posicaoEsperada = ordem.length - 2;

    await expect
      .poll(async () => (await columnOrder(column.id)).indexOf(ultimo), { timeout: 30_000 })
      .toBe(posicaoEsperada);

    /** A tela mostra a ordem nova, e o anúncio diz QUAL posição o cartão passou a ter. */
    await expect(card).toHaveAttribute('data-demand-index', String(posicaoEsperada));
    await expect(page.getByTestId('demand-board-announce')).toContainText(
      `agora é a ${posicaoEsperada + 1}ª de ${ordem.length} na coluna`,
    );

    /** O foco continua no cartão: sem isso, a próxima tecla se perderia. */
    await expect(card).toBeFocused();

    /**
     * A trilha guarda o fato como qualquer outro movimento — o teclado não é um caminho
     * paralelo de escrita.
     */
    const kinds = (await tableOf(ultimo)).map((entry) => entry.kind);
    expect(kinds[kinds.length - 1]).toBe('MOVED');

    /** Na ponta, o anúncio é honesto: "já é a primeira", e nada é escrito. */
    const movimentosAntes = (await tableOf(ultimo)).length;
    const primeiro = (await columnOrder(column.id))[0]!;

    await page.getByTestId(`demand-card-${primeiro}`).focus();
    await page.keyboard.press('Alt+ArrowUp');

    await expect(page.getByTestId('demand-board-announce')).toContainText('já é a primeira da coluna');
    await expect.poll(async () => (await columnOrder(column.id))[0], { timeout: 10_000 }).toBe(primeiro);
    expect((await tableOf(ultimo)).length).toBe(movimentosAntes);
  });
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A COLUNA TRUNCADA SE ANUNCIA (FASE 50 · dívida E52)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O quadro deixou de trazer todas as demandas do evento: cada coluna tem um teto, e
   *  o que ficou de fora aparece com o NÚMERO e o caminho para ver o resto. Aqui o teto
   *  é forçado a 1 pela URL — é o mesmo parâmetro que o link "Ver mais" usa.
   */
  test('7. coluna com mais cartões do que a janela avisa quantos ficaram de fora', async ({ page }) => {
    await signInAs(page, organizerEmail);

    /**
     * A COLUNA É PREPARADA PELO PRÓPRIO CASO: dois cartões na primeira coluna, criados
     * pela tela. Depender do que os casos anteriores deixaram faria o teste passar ou
     * falhar conforme a ordem — o defeito que a dívida E71 descreve.
     */
    /** A leitura cria o quadro (e as colunas) — depois dela as linhas existem. */
    await page.goto(boardUrl());

    const coluna = await primeiraColuna();

    /**
     * Dois cartões DIRETO no banco: é fixture, não comportamento sob teste (a criação
     * pela tela já tem o caso 1). O que este caso mede é a JANELA da coluna.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.demand.createMany({
        data: [
          {
            tenantId,
            boardId: coluna.boardId,
            eventId,
            columnId: coluna.id,
            title: `Truncada A ${RUN_ID}`,
            priority: 'NORMAL',
            position: 900,
          },
          {
            tenantId,
            boardId: coluna.boardId,
            eventId,
            columnId: coluna.id,
            title: `Truncada B ${RUN_ID}`,
            priority: 'NORMAL',
            position: 901,
          },
        ],
      });
    });

    await page.goto(`/t/${slug}/administracao/eventos/${eventId}/demandas?cartoes=1`);

    const aviso = page.getByTestId(`demand-column-truncated-${coluna.id}`);

    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await expect(aviso).toContainText('Mostrando 1 de');

    /** O caminho para ver o resto está na tela e é um link de verdade (sem JS). */
    await expect(page.getByTestId(`demand-column-more-${coluna.id}`)).toBeVisible();

    /** E a contagem do cabeçalho mostra a JANELA, não o total escondido. */
    await expect(page.getByTestId(`demand-column-count-${coluna.id}`)).toHaveText('1');
  });
});

/** A primeira coluna do quadro (a de menor posição) e o quadro a que ela pertence. */
async function primeiraColuna(): Promise<{ id: string; boardId: string }> {
  const primeira = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.demandColumn.findFirstOrThrow({
      where: { tenantId, board: { eventId } },
      orderBy: { position: 'asc' },
      select: { id: true, boardId: true },
    });
  });

  return { id: primeira.id, boardId: primeira.boardId };
}

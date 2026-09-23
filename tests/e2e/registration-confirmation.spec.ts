/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Confirmação de vaga com prazo (FASE 34)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. a organização ESCOLHE no cadastro da atividade que a vaga exige confirmação,
 *      com prazo, exigências e local — e a tela resume a escolha na programação;
 *   2. a pessoa se inscreve, a vaga fica RETIDA, e ela vê o prazo, o que levar e
 *      ONDE ir (sem botão de confirmar: quem confirma é a equipe);
 *   3. o aviso chega nos DOIS canais — e-mail no outbox e mensagem na caixa de
 *      entrada da plataforma;
 *   4. a EQUIPE confirma na fila de confirmações, e a pessoa passa a ver a vaga
 *      confirmada;
 *   5. o prazo vencido LIBERA a vaga e promove quem esperava, pelo caminho de
 *      PRODUÇÃO do relógio (`npm run registrations:expire`), com os dois avisos.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O VENCIMENTO PASSA PELA CLI, E NÃO POR ESCRITA NO BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O cenário 3 precisa de uma inscrição VENCIDA. Gravar `confirmationDueAt` no
 *  passado por escrita direta seria a fixture que isola a tela — e mediria a
 *  varredura sobre um estado que ninguém produziu. A CLI aceita `--agora=<ISO>` e roda
 *  a MESMA função do worker: o teste avança o relógio e chama o caminho que a
 *  operação usa de verdade (armadilha 66).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CENÁRIO MONTA A PRÓPRIA FIXTURE (armadilha 62)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Instituição, evento e contas nascem aqui: o Playwright reinicia o worker depois de
 *  uma falha, e o `RUN_ID` muda. A SEGUNDA atividade (a do vencimento) é criada por
 *  escrita direta de propósito: o caminho sob suspeita neste cenário é a LIBERAÇÃO
 *  automática, não a tela de cadastro — que o cenário 1 já cobre.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A LIBERAÇÃO RODA PELA CLI DE PRODUÇÃO, SEM PASSAR PELO `npm`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `npm run registrations:expire` é o comando que o cron usa; o que ele executa é
 *  `tsx prisma/scripts/expire-registrations.ts`. Chamamos o `tsx` direto com o `node`
 *  atual porque, no Windows, `execFileSync('npm.cmd')` exige `shell: true` — e abrir
 *  shell no meio de um teste troca uma dependência por um interpretador de linha de
 *  comando. O script é o MESMO; só o atalho do npm fica de fora.
 */
function runExpiryCli(agoraIso: string): string {
  return execFileSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'prisma/scripts/expire-registrations.ts', `--agora=${agoraIso}`],
    { encoding: 'utf8', cwd: process.cwd(), env: process.env },
  );
}

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'confirmacao-f34';
const EVENT_SLUG = `evento-f34-${RUN_ID}`;
const ACTIVITY_SLUG = `oficina-doacao-f34-${RUN_ID}`;
const ACTIVITY_TITLE = `Oficina com doação ${RUN_ID}`;
const PLACE = 'Secretaria do bloco B, térreo — das 9h às 18h';
const REQUIREMENT = '1 kg de alimento não perecível';
/** A segunda atividade: capacidade 1 e lista de espera, para provar a promoção. */
const RELEASE_SLUG = `oficina-liberacao-f34-${RUN_ID}`;
const RELEASE_TITLE = `Oficina da liberação ${RUN_ID}`;

let tenantId: string;
let eventId: string;
let releaseActivityId: string;
let organizerEmail: string;
let pendenteEmail: string;
let esperaEmail: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f34.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

function localInput(daysFromNow: number, hour: number): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  date.setHours(hour, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Confirmação ${RUN_ID}`,
    });
    tenantId = tenant.id;
    eventId = randomUUID();
    releaseActivityId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 20 * 86_400_000);

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso Solidário ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          /**
           * `capacity: null` = SEM limite. Omitir deixaria o default do modelo (`0`), e
           * "0 vagas" recusaria TODA inscrição com "a lotação total do evento foi
           * atingida" — o mesmo cuidado dos outros cenários de inscrição.
           */
          capacity: null,
          confirmedCount: 0,
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          registrationClosesAt: new Date(Date.now() + 18 * 86_400_000),
        },
      });

      /**
       * A atividade do VENCIMENTO: capacidade 1, lista de espera e prazo de 1 dia.
       * Prazo curto para que o `--agora` da CLI o alcance sem esperar.
       */
      await tx.activity.create({
        data: {
          id: releaseActivityId,
          tenantId,
          eventId,
          slug: RELEASE_SLUG,
          title: RELEASE_TITLE,
          type: 'WORKSHOP',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
          capacity: 1,
          waitlistEnabled: true,
          workloadMinutes: 180,
          confirmationPolicy: 'REQUIRED',
          confirmationWindowDays: 1,
          confirmationRequirements: [{ kind: 'ITEM', label: 'Um brinquedo' }],
          confirmationPlace: PLACE,
        },
      });
    });

    const organizer = await signUpVia(api, `Organizadora Solidária ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });

    /** A pessoa que vai ficar com a vaga RETIDA na atividade criada pela tela. */
    const pendente = await signUpVia(api, `Pessoa da Doação ${RUN_ID}`);
    pendenteEmail = pendente.email;

    /** Quem espera a vaga na atividade da liberação. */
    const espera = await signUpVia(api, `Pessoa da Espera ${RUN_ID}`);
    esperaEmail = espera.email;
  } finally {
    await api.dispose();
  }
});

const eventPanelUrl = () => `/t/${slug}/administracao/eventos/${eventId}`;
const confirmationsUrl = () => `/t/${slug}/administracao/eventos/${eventId}/confirmacoes`;
const activityUrl = (activitySlug: string) =>
  `/t/${slug}/eventos/${EVENT_SLUG}/atividades/${activitySlug}`;

/** O id da atividade pelo slug — o E2E não guarda id em memória (o banco é a memória). */
async function activityIdBySlug(activitySlug: string): Promise<string> {
  const activity = await e2eDb.activity.findFirstOrThrow({
    where: { eventId, slug: activitySlug },
    select: { id: true },
  });

  return activity.id;
}

/** A inscrição de uma pessoa numa atividade, direto do banco (o banco é a memória). */
async function registrationOf(email: string, activitySlug: string) {
  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const activity = await e2eDb.activity.findFirstOrThrow({
    where: { eventId, slug: activitySlug },
    select: { id: true },
  });

  return e2eDb.registration.findFirstOrThrow({
    where: { activityId: activity.id, userId: user.id },
    select: { id: true, status: true, confirmationDueAt: true, cancelReason: true },
  });
}

test.describe('confirmação de vaga com prazo', () => {
  test('1. a organização cria a atividade confirmável pela tela', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(eventPanelUrl());

    /**
     * A Programação nasce recolhida, e o `summary` da SEÇÃO é o primeiro: cada
     * atividade traz o próprio `<details>` ("Editar atividade") e o próprio bloco de
     * confirmação, também com `summary`. O clique é no da seção.
     */
    await page.getByTestId('activities-section').locator('summary').first().click();

    const form = page.getByTestId('create-activity');
    await form.getByLabel('Identificador').fill(ACTIVITY_SLUG);
    await form.getByLabel('Título').fill(ACTIVITY_TITLE);
    /**
     * `exact: true` no Tipo: o bloco de confirmação traz os seletores das exigências
     * ("Categoria da exigência 1…"), e o casamento por substring pegaria os quatro.
     */
    await form.getByLabel('Tipo', { exact: true }).selectOption('WORKSHOP');
    await form.getByLabel('Início').fill(localInput(21, 8));
    await form.getByLabel('Término').fill(localInput(21, 11));
    await form.getByLabel('Carga horária (min)').fill('180');
    await form.getByLabel('Vagas').fill('25');

    /**
     * A ESCOLHA DO ORGANIZADOR — e é ela que liga toda a fase. Sem marcar aqui, a
     * vaga continua sendo confirmada no ato da inscrição.
     */
    const confirmation = form.getByTestId('activity-confirmation');
    await confirmation.getByLabel('Confirmação de vaga').selectOption('REQUIRED');
    await confirmation.getByLabel('Prazo para confirmar (dias)').fill('3');
    await confirmation.getByLabel('Onde confirmar').fill(PLACE);
    await confirmation.getByLabel('Categoria da exigência 1').selectOption('DONATION');
    await confirmation.getByLabel('Descrição da exigência 1').fill(REQUIREMENT);

    await form.getByTestId('admin-submit').click();

    await expect(form.getByTestId('create-activity-feedback')).toContainText(/criad/i, {
      timeout: 30_000,
    });

    /** O resumo da atividade na programação assume a escolha. */
    await page.goto(eventPanelUrl());
    await page.getByTestId('activities-section').locator('summary').first().click();

    const item = page.locator('li', { hasText: ACTIVITY_TITLE }).first();
    await expect(item).toContainText(/exige confirmação/i);
    await expect(item).toContainText(/3 dia/i);

    /** E o link da fila de confirmações passa a existir no topo do evento. */
    await expect(page.getByTestId('confirmations-link')).toBeVisible();
  });

  test('2. a pessoa se inscreve: a vaga fica RETIDA e o aviso sai nos dois canais', async ({ page }) => {
    await signInAs(page, pendenteEmail);
    await page.goto(activityUrl(ACTIVITY_SLUG));

    await page.getByRole('checkbox', { name: /tratamento dos meus dados/i }).check();
    /** O rótulo do botão é "Confirmar inscrição" — e "confirmar" aqui é o ATO, não a confirmação de vaga. */
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();

    /**
     * ── A ASSERÇÃO É O ESTADO DURÁVEL, NÃO A MENSAGEM TRANSITÓRIA (armadilha 76) ──
     *
     *  A Server Action revalida a rota; o servidor relê a inscrição (agora `PENDING`) e
     *  a página passa a renderizar o bloco "já inscrito" no lugar do formulário — o
     *  cartão de sucesso do cliente sai de cena junto, porque ele vive no componente
     *  que foi substituído. O que ficou de verdade é o que a tela mostra agora.
     */
    const status = page.getByTestId('registration-status');
    await expect(status).toContainText(/falta confirmar/i, { timeout: 30_000 });

    /** A vaga está RETIDA no banco — é o que faz o prazo ter consequência. */
    const registration = await registrationOf(pendenteEmail, ACTIVITY_SLUG);
    expect(registration.status).toBe('PENDING');
    expect(registration.confirmationDueAt).toBeInstanceOf(Date);

    const activity = await e2eDb.activity.findFirstOrThrow({
      where: { id: (await e2eDb.activity.findFirstOrThrow({ where: { slug: ACTIVITY_SLUG }, select: { id: true } })).id },
      select: { confirmedCount: true },
    });
    expect(activity.confirmedCount).toBe(1);

    // ── O aviso nos DOIS canais ───────────────────────────────────────────────
    const outbox = await e2eDb.emailMessage.findMany({
      where: { dedupeKey: `registration-pending-${registration.id}` },
      select: { template: true, to: true },
    });

    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.template).toBe('REGISTRATION_PENDING');
    expect(outbox[0]!.to).toBe(pendenteEmail);

    /** Na plataforma: a caixa de entrada da pessoa, com o prazo e o que levar. */
    await page.goto(`/t/${slug}/minhas-mensagens`);

    await expect(page.getByTestId('inbox-summary')).toContainText('1 mensagem');
    await expect(page.getByTestId('inbox-list')).toContainText('Confirme sua vaga');
    await expect(page.getByTestId('inbox-list')).toContainText(REQUIREMENT);
    await expect(page.getByTestId('inbox-list')).toContainText(PLACE);
    // ── A tela de minhas inscrições: prazo, checklist e ONDE ir, sem botão ────
    await page.goto(`/t/${slug}/minhas-inscricoes`);

    const card = page.getByTestId('registration-confirmation');
    await expect(card).toHaveAttribute('data-confirmation-state', 'PENDING');
    await expect(card).toContainText(/falta confirmar/i);
    await expect(card).toContainText(PLACE);
    /**
     * ── A TELA MUDOU NA FASE 37, E DIZ MAIS ───────────────────────────────────
     *
     *  O que a pessoa vê agora é o CHECKLIST item a item, com o estado de cada exigência
     *  (o que já foi recebido e o que falta): a mesma informação de antes — o que levar —
     *  com o que o balcão registrou. O bloco antigo (`-requirements`) continua existindo
     *  para quem NÃO tem itens: inscrição anterior à fase, ou atividade que só declara o
     *  local. Por isso a asserção mudou de testid, e não de sentido.
     */
    const checklist = page.getByTestId('registration-confirmation-items');
    await expect(checklist).toContainText(REQUIREMENT);
    await expect(checklist).toContainText('A receber');

    /**
     * NÃO existe botão de confirmar para o participante: quem confirma é a equipe.
     * O botão que aparece no cartão é o de CANCELAR a inscrição (do componente de
     * cancelamento), e nada mais.
     */
    await expect(card.getByRole('button', { name: /confirmar/i })).toHaveCount(0);
  });

  test('3. a equipe confirma na fila e a pessoa vê a vaga confirmada', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(confirmationsUrl());

    /** A fila mostra a atividade, o combinado e quem espera. */
    const board = page.getByTestId('confirmation-pending');
    await expect(board).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('confirmation-requirements')).toContainText(REQUIREMENT);

    const registration = await registrationOf(pendenteEmail, ACTIVITY_SLUG);
    const row = page.getByTestId(`confirmation-row-${registration.id}`);

    await expect(row).toContainText(/confirma até/i);
    await expect(row).toContainText('Pessoa da Doação');

    await page
      .getByTestId(`confirm-registration-${registration.id}`)
      .getByTestId('inline-submit')
      .click();

    /**
     * ── A FILA ANDA SOZINHA, E É ISSO QUE SE AFIRMA ──────────────────────────
     *
     *  Depois da confirmação, o servidor relê a fila e a atividade que ainda tem
     *  pendentes passa a ser a selecionada — quem está trabalhando continua no
     *  trabalho, sem voltar para o topo a cada clique. O retorno do formulário é
     *  transitório (a página é re-renderizada pela própria action), então o que se
     *  prende é o ESTADO: a atividade perdeu o pendente e ganhou uma confirmada.
     */
    await expect(
      page.getByTestId(`confirmation-activity-${await activityIdBySlug(ACTIVITY_SLUG)}`),
    ).toContainText(/1 confirmada/i, { timeout: 30_000 });

    /** Abrindo a atividade, quem foi confirmado aparece na lista das confirmadas. */
    await page.getByTestId(`confirmation-activity-${await activityIdBySlug(ACTIVITY_SLUG)}`).click();

    await expect(page.getByTestId('confirmation-done')).toContainText('Pessoa da Doação', {
      timeout: 30_000,
    });

    /** O recibo saiu para a pessoa, e a inscrição virou CONFIRMED no banco. */
    const updated = await registrationOf(pendenteEmail, ACTIVITY_SLUG);
    expect(updated.status).toBe('CONFIRMED');

    const receipts = await e2eDb.emailMessage.findMany({
      where: { dedupeKey: `registration-confirmed-${registration.id}` },
      select: { template: true },
    });
    expect(receipts).toEqual([{ template: 'REGISTRATION_CONFIRMED' }]);

    /** E a pessoa vê a confirmação na tela dela. */
    await signInAs(page, pendenteEmail);
    await page.goto(`/t/${slug}/minhas-inscricoes`);

    const card = page.getByTestId('registration-confirmation');
    await expect(card).toHaveAttribute('data-confirmation-state', 'CONFIRMED');
    await expect(card).toContainText(/confirmada pela organização/i);
  });

  test('4. o prazo vencido libera a vaga e promove quem esperava (pela CLI de produção)', async ({
    page,
  }) => {
    // ── Duas inscrições na atividade de capacidade 1 ──────────────────────────
    await signInAs(page, pendenteEmail);
    await page.goto(activityUrl(RELEASE_SLUG));
    await page.getByRole('checkbox', { name: /tratamento dos meus dados/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();

    /** Mesmo cuidado do cenário 2: o estado durável é o que a página passa a renderizar. */
    await expect(page.getByTestId('registration-status')).toContainText(/falta confirmar/i, {
      timeout: 30_000,
    });

    await signInAs(page, esperaEmail);
    await page.goto(activityUrl(RELEASE_SLUG));
    await page.getByRole('checkbox', { name: /tratamento dos meus dados/i }).check();
    /** Com a única vaga retida, a tela oferece a LISTA DE ESPERA — outro rótulo. */
    await page.getByRole('button', { name: /lista de espera/i }).click();

    await expect(page.getByTestId('registration-status')).toContainText(/lista de espera/i, {
      timeout: 30_000,
    });

    const antes = await registrationOf(esperaEmail, RELEASE_SLUG);
    expect(antes.status).toBe('WAITLISTED');

    /**
     * ── O RELÓGIO AVANÇA PELO CAMINHO DE PRODUÇÃO ────────────────────────────
     *
     * `npm run registrations:expire -- --agora=<+3 dias>` roda a MESMA função que o
     * worker/`cron` roda; o `--agora` só move o instante de comparação. É o cenário
     * real: ninguém toca no banco para "fazer vencer".
     */
    const futuro = new Date(Date.now() + 3 * 86_400_000).toISOString();

    const saida = runExpiryCli(futuro);

    expect(saida).toContain('LIBERAÇÃO AUTOMÁTICA DAS VAGAS NÃO CONFIRMADAS');
    expect(saida).toMatch(/Liberadas: [1-9]/);

    /** A vaga foi LIBERADA e a espera foi promovida. */
    const liberada = await registrationOf(pendenteEmail, RELEASE_SLUG);
    expect(liberada.status).toBe('CANCELED');
    expect(liberada.cancelReason).toBe('Prazo de confirmação vencido');

    const promovida = await registrationOf(esperaEmail, RELEASE_SLUG);
    expect(promovida.status).toBe('CONFIRMED');

    /** A vaga não sumiu: passou de mão, e o contador continua em 1. */
    const contador = await e2eDb.activity.findUniqueOrThrow({
      where: { id: releaseActivityId },
      select: { confirmedCount: true, capacity: true },
    });
    expect(contador.confirmedCount).toBe(1);
    expect(contador.capacity).toBe(1);

    // ── OS DOIS AVISOS ────────────────────────────────────────────────────────
    expect(
      await e2eDb.emailMessage.findMany({
        where: { dedupeKey: `registration-released-${liberada.id}` },
        select: { template: true },
      }),
    ).toEqual([{ template: 'REGISTRATION_RELEASED' }]);

    expect(
      await e2eDb.emailMessage.findMany({
        where: { dedupeKey: `waitlist-promoted-${promovida.id}` },
        select: { template: true },
      }),
    ).toEqual([{ template: 'WAITLIST_PROMOTED' }]);

    // ── E na caixa de entrada de quem esperava ────────────────────────────────
    await signInAs(page, esperaEmail);
    await page.goto(`/t/${slug}/minhas-mensagens`);

    await expect(page.getByTestId('inbox-list')).toContainText('Você entrou', {
      timeout: 30_000,
    });

    /** Quem foi promovido vê a vaga CONFIRMADA — sem ter feito nada. */
    await page.goto(`/t/${slug}/minhas-inscricoes`);
    await expect(page.getByTestId('registration-confirmation')).toHaveAttribute(
      'data-confirmation-state',
      'CONFIRMED',
    );

    /**
     * E quem PERDEU o prazo não vê mais aquela atividade na lista: o cancelamento é
     * TERMINAL, e a lista de "minhas inscrições" só mostra o que está vivo. A pessoa
     * fica sabendo pelo aviso (e-mail e caixa de entrada), não por uma linha cinzenta
     * esquecida na tela.
     */
    await signInAs(page, pendenteEmail);
    await page.goto(`/t/${slug}/minhas-inscricoes`);

    await expect(page.getByTestId('my-registrations')).not.toContainText(RELEASE_TITLE);
  });

  test('5. rodar a liberação de novo não devolve uma segunda vaga', async () => {
    const antes = await e2eDb.activity.findUniqueOrThrow({
      where: { id: releaseActivityId },
      select: { confirmedCount: true },
    });

    const liberada = await registrationOf(pendenteEmail, RELEASE_SLUG);

    const futuro = new Date(Date.now() + 10 * 86_400_000).toISOString();

    const saida = runExpiryCli(futuro);

    expect(saida).toContain('LIBERAÇÃO AUTOMÁTICA DAS VAGAS NÃO CONFIRMADAS');

    /**
     * A varredura é CROSS-TENANT (o worker roda para todas as instituições), então a
     * linha "Liberadas: N" soma o banco inteiro e não serve de medida para este
     * cenário. O que se afirma é o efeito AQUI: o contador não mudou e nenhum aviso
     * foi repetido.
     */
    const depois = await e2eDb.activity.findUniqueOrThrow({
      where: { id: releaseActivityId },
      select: { confirmedCount: true },
    });

    expect(depois).toEqual(antes);

    expect(
      await e2eDb.emailMessage.count({
        where: { dedupeKey: `registration-released-${liberada.id}` },
      }),
    ).toBe(1);
  });
});

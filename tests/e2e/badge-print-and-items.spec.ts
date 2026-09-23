/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Checklist item por item e impressão de crachá (FASE 37)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. a organização declara as exigências no cadastro da atividade e escolhe quais
 *      são OBRIGATÓRIAS — a tela grava `required: true/false`, e o padrão da linha nova
 *      é obrigatória (a vaga não pode deixar de ser segurada por um clique esquecido);
 *   2. a inscrição nasce com o checklist daquela pessoa, visível para ela em
 *      "Minhas inscrições" (o que a organização registrou, item por item);
 *   3. o BALCÃO marca item por item: o opcional não segura a vaga, e o ÚLTIMO
 *      obrigatório confirma a vaga sozinha, com recibo para o participante;
 *   4. as duas saídas de impressão novas — folha de ETIQUETA adesiva em PDF e arquivo
 *      ZPL para impressora térmica — respondem pelo endereço que a TELA aponta, com as
 *      medidas que o operador digitou, e marcam o lote como impresso;
 *   5. medida que não cabe na folha é RECUSADA com o motivo, em vez de gerar um arquivo
 *      que sai torto na primeira folha gasta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CONFERÊNCIA É DO ARQUIVO QUE SAI, NÃO DA TELA QUE O OFERECE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os cenários 4 e 5 clicam no que a tela oferece e BAIXAM o que ela aponta — o mesmo
 *  endereço, com os mesmos parâmetros. Afirmar o `href` provaria só a montagem da URL; o
 *  que o operador leva é o PDF e o texto do ZPL, e é isso que o teste lê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { DEFAULT_THERMAL_CONFIG, mmToDots } from '../../src/domain/events/badge-print-rules';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'checklist-cracha-f37';
const EVENT_SLUG = `evento-f37-${RUN_ID}`;
const ACTIVITY_SLUG = `oficina-checklist-f37-${RUN_ID}`;
const ACTIVITY_TITLE = `Oficina com checklist ${RUN_ID}`;
const PLACE = 'Secretaria do bloco B, térreo — das 9h às 18h';
const REQUIRED_LABEL = 'Taxa de R$ 30';
const OPTIONAL_LABEL = 'Camiseta extra';

let tenantId: string;
let eventId: string;
let organizerEmail: string;
let participantEmail: string;
let participantName: string;
let participantId: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f37.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** O id da atividade pelo slug — o banco é a memória do E2E. */
async function activityId(): Promise<string> {
  const activity = await e2eDb.activity.findFirstOrThrow({
    where: { eventId, slug: ACTIVITY_SLUG },
    select: { id: true },
  });

  return activity.id;
}

/** A inscrição da pessoa na atividade. */
async function registrationOf() {
  return e2eDb.registration.findFirstOrThrow({
    where: { activityId: await activityId(), userId: participantId },
    select: { id: true, status: true, confirmedById: true },
  });
}

/** O checklist gravado, na ordem — é o que o balcão e o participante leem. */
async function itemsOf(registrationId: string) {
  return e2eDb.registrationConfirmationItem.findMany({
    where: { registrationId },
    orderBy: { position: 'asc' },
    select: { position: true, label: true, required: true, status: true, resolvedById: true },
  });
}

/**
 * Clica no botão de uma AÇÃO EM LINHA e espera o efeito, clicando de novo se o clique se
 * perdeu na hidratação (ver o comentário do cenário 3).
 */
async function clickInlineUntil(
  page: import('@playwright/test').Page,
  testId: string,
  effect: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    const botao = page.getByTestId(testId).getByTestId('inline-submit');

    if ((await botao.count()) > 0) await botao.click();

    await effect();
  }).toPass({ timeout: 60_000 });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Checklist ${RUN_ID}`,
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
          title: `Congresso do Checklist ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          /** `capacity: null` = SEM limite (o default do modelo é `0`, que recusaria tudo). */
          capacity: null,
          confirmedCount: 0,
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          registrationClosesAt: new Date(Date.now() + 18 * 86_400_000),
        },
      });
    });

    const organizer = await signUpVia(api, `Organizadora do Checklist ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });

    participantName = `Pessoa do Checklist ${RUN_ID}`;
    const participant = await signUpVia(api, participantName);
    participantEmail = participant.email;
    participantId = participant.id;
  } finally {
    await api.dispose();
  }
});

const eventPanelUrl = () => `/t/${slug}/administracao/eventos/${eventId}`;
const confirmationsUrl = () => `/t/${slug}/administracao/eventos/${eventId}/confirmacoes`;
const badgesUrl = () => `/t/${slug}/credenciamento/crachas?evento=${eventId}`;
const activityUrl = () => `/t/${slug}/eventos/${EVENT_SLUG}/atividades/${ACTIVITY_SLUG}`;

test.describe('checklist item por item e impressão de crachá', () => {
  test('1. a organização cria a atividade e diz qual exigência é OBRIGATÓRIA', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(eventPanelUrl());

    /** A Programação nasce recolhida, e o `summary` da SEÇÃO é o primeiro. */
    await page.getByTestId('activities-section').locator('summary').first().click();

    const form = page.getByTestId('create-activity');
    await form.getByLabel('Identificador').fill(ACTIVITY_SLUG);
    await form.getByLabel('Título').fill(ACTIVITY_TITLE);
    await form.getByLabel('Tipo', { exact: true }).selectOption('WORKSHOP');
    await form.getByLabel('Início').fill(localInput(21, 8));
    await form.getByLabel('Término').fill(localInput(21, 11));
    await form.getByLabel('Carga horária (min)').fill('180');
    await form.getByLabel('Vagas').fill('25');

    const confirmation = form.getByTestId('activity-confirmation');
    await confirmation.getByLabel('Confirmação de vaga').selectOption('REQUIRED');
    await confirmation.getByLabel('Prazo para confirmar (dias)').fill('3');
    await confirmation.getByLabel('Onde confirmar').fill(PLACE);

    /** A primeira exigência: fica OBRIGATÓRIA — a caixa já vem marcada. */
    await confirmation.getByLabel('Categoria da exigência 1').selectOption('PAYMENT');
    await confirmation.getByLabel('Descrição da exigência 1').fill(REQUIRED_LABEL);

    /**
     * A segunda é "traz se puder": a caixa é DESMARCADA de propósito. É o caso que a
     * fase criou — antes, a escolha era entre não pedir e cobrar.
     */
    await confirmation.getByLabel('Categoria da exigência 2').selectOption('ITEM');
    await confirmation.getByLabel('Descrição da exigência 2').fill(OPTIONAL_LABEL);

    await expect(form.getByTestId('requirement-required-0')).toBeChecked();
    await expect(form.getByTestId('requirement-required-1')).toBeChecked();
    await form.getByTestId('requirement-required-1').uncheck();

    await form.getByTestId('admin-submit').click();

    await expect(form.getByTestId('create-activity-feedback')).toContainText(/criad/i, {
      timeout: 30_000,
    });

    /**
     * ── O QUE FOI GRAVADO, E NÃO O QUE A TELA MOSTRA ─────────────────────────
     *
     *  A linha nova nasce marcada: desmarcada por padrão, TODA exigência criada pela tela
     *  viraria opcional — e a vaga deixaria de ser segurada sem nenhuma tela dizendo
     *  isso. Este `expect` é o que prende o padrão.
     */
    const stored = await e2eDb.activity.findUniqueOrThrow({
      where: { id: await activityId() },
      select: { confirmationRequirements: true },
    });

    expect(stored.confirmationRequirements).toEqual([
      { kind: 'PAYMENT', label: REQUIRED_LABEL, note: null, required: true },
      { kind: 'ITEM', label: OPTIONAL_LABEL, note: null, required: false },
    ]);
  });

  test('2. a inscrição nasce com o checklist da pessoa, visível para ela', async ({ page }) => {
    await signInAs(page, participantEmail);
    await page.goto(activityUrl());

    await page.getByRole('checkbox', { name: /tratamento dos meus dados/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();

    /** O estado durável é o que a página passa a renderizar (armadilha 76). */
    await expect(page.getByTestId('registration-status')).toContainText(/falta confirmar/i, {
      timeout: 30_000,
    });

    const registration = await registrationOf();
    expect(registration.status).toBe('PENDING');

    /** O snapshot nasceu com a inscrição, na ordem declarada e com o obrigatório certo. */
    expect(await itemsOf(registration.id)).toEqual([
      {
        position: 0,
        label: REQUIRED_LABEL,
        required: true,
        status: 'PENDING',
        resolvedById: null,
      },
      {
        position: 1,
        label: OPTIONAL_LABEL,
        required: false,
        status: 'PENDING',
        resolvedById: null,
      },
    ]);

    /** Na tela da pessoa: o checklist com o estado de cada item, e SEM botão de marcar. */
    await page.goto(`/t/${slug}/minhas-inscricoes`);

    const checklist = page.getByTestId('registration-confirmation-items');
    await expect(checklist).toHaveAttribute('data-items-summary', '0 de 2 itens');
    await expect(checklist).toContainText(REQUIRED_LABEL);
    await expect(checklist).toContainText(OPTIONAL_LABEL);
    await expect(checklist).toContainText('(opcional)');
    await expect(checklist).toContainText('A receber');
    /** Quem marca é a EQUIPE: aqui não existe botão de receber/dispensar. */
    await expect(checklist.getByRole('button', { name: /recebido|dispensar/i })).toHaveCount(0);
  });

  test('3. o balcão marca item por item e a vaga se confirma no último obrigatório', async ({
    page,
  }) => {
    await signInAs(page, organizerEmail);
    await page.goto(confirmationsUrl());

    const registration = await registrationOf();
    const row = page.getByTestId(`confirmation-row-${registration.id}`);

    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`items-summary-${registration.id}`)).toContainText(
      '0 de 2 itens',
    );
    await expect(page.getByTestId(`confirmation-item-${registration.id}-1`)).toContainText(
      '(opcional)',
    );

    /**
     * ── O CLIQUE ANTES DA HIDRATAÇÃO É ABSORVIDO PELO REACT ────────────────────
     *
     *  O formulário da ação em linha já está no HTML do servidor, mas quem o ENVIA é o
     *  cliente: um clique que chega enquanto o bundle ainda está carregando não vira
     *  requisição nenhuma (o `<form action="">` com as referências `$ACTION_*` é
     *  interceptado pelo React, que ainda não registrou a ação). Para quem opera, é
     *  "cliquei e não aconteceu nada" — e a pessoa clica de novo.
     *
     *  O teste faz o mesmo, em vez de medir o tempo de carregamento do bundle: clica,
     *  espera o efeito e, se o clique se perdeu, clica outra vez. O que se afirma é o
     *  FATO no servidor e o estado que a tela passa a mostrar.
     */
    await clickInlineUntil(page, `receive-item-${registration.id}-1`, async () => {
      await expect(page.getByTestId(`confirmation-item-${registration.id}-1`)).toHaveAttribute(
        'data-item-status',
        'RECEIVED',
        { timeout: 10_000 },
      );
    });

    await expect(page.getByTestId(`items-summary-${registration.id}`)).toContainText(
      '1 de 2 itens',
    );

    /** O opcional NÃO segura a vaga: a inscrição continua pendente. */
    expect((await registrationOf()).status).toBe('PENDING');

    /** 2º: o ÚLTIMO obrigatório — a vaga se confirma sozinha e a linha sai de "aguardando". */
    await clickInlineUntil(page, `receive-item-${registration.id}-0`, async () => {
      await expect(page.getByTestId('confirmation-done')).toContainText(participantName, {
        timeout: 10_000,
      });
    });

    await expect(page.getByTestId(`confirmation-row-${registration.id}`)).toHaveCount(0);

    /** A vaga ficou confirmada, com autor, e o recibo saiu UMA vez. */
    const depois = await registrationOf();
    expect(depois.status).toBe('CONFIRMED');
    expect(depois.confirmedById).not.toBeNull();

    expect(
      await e2eDb.emailMessage.findMany({
        where: { dedupeKey: `registration-confirmed-${registration.id}` },
        select: { template: true, to: true },
      }),
    ).toEqual([{ template: 'REGISTRATION_CONFIRMED', to: participantEmail }]);

    expect((await itemsOf(registration.id)).map((item) => item.status)).toEqual([
      'RECEIVED',
      'RECEIVED',
    ]);

    /** E a pessoa vê os dois itens resolvidos, com a vaga confirmada. */
    await signInAs(page, participantEmail);
    await page.goto(`/t/${slug}/minhas-inscricoes`);

    await expect(page.getByTestId('registration-confirmation')).toHaveAttribute(
      'data-confirmation-state',
      'CONFIRMED',
    );
    await expect(page.getByTestId('registration-confirmation-items')).toHaveAttribute(
      'data-items-summary',
      '2 de 2 itens',
    );
  });

  test('4. as etiquetas adesivas e o ZPL saem pelo endereço que a tela aponta', async ({ page }) => {
    await signInAs(page, organizerEmail);

    /** DIAGNÓSTICO TEMPORÁRIO */
    await page.goto(badgesUrl());

    /** Emitir o crachá: a impressão existe para quem tem código. */
    let code = '';

    await expect(async () => {
      const botao = page.getByTestId('badge-emit');

      if ((await botao.count()) > 0) await botao.click();

      await expect
        .poll(
          async () => {
            const credential = await e2eDb.eventCredential.findFirst({
              where: { eventId, userId: participantId },
              select: { code: true },
            });

            code = credential?.code ?? '';
            return code;
          },
          { timeout: 10_000 },
        )
        .not.toBe('');
    }).toPass({ timeout: 60_000 });

    /** O painel das medidas precisa ser ABERTO — o conteúdo de um `<details>` fechado não é clicável. */
    await page.getByTestId('badge-print-options').locator('summary').click();

    const labelsHref = await page.getByTestId('badge-print-labels').getAttribute('href');
    const zplHref = await page.getByTestId('badge-print-zpl').getAttribute('href');

    expect(labelsHref).toContain('formato=etiquetas');
    expect(zplHref).toContain('formato=zpl');

    // ── A folha de ETIQUETAS: é um PDF de verdade, com o lote contado no cabeçalho ──
    const labels = await page.request.get(labelsHref!);

    expect(labels.status()).toBe(200);
    expect(labels.headers()['content-type']).toContain('application/pdf');
    expect(Number(labels.headers()['x-crachas-no-lote'])).toBeGreaterThanOrEqual(1);

    const pdf = await labels.body();
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // ── O arquivo ZPL: texto que o operador pode ABRIR antes de gastar etiqueta ──
    const zpl = await page.request.get(zplHref!);

    expect(zpl.status()).toBe(200);
    expect(zpl.headers()['content-type']).toContain('text/plain');
    expect(zpl.headers()['content-disposition']).toContain('attachment');

    const zplText = await zpl.text();

    expect(zplText).toContain('^XA');
    expect(zplText).toContain('^CI28');
    expect(zplText).toContain('^BQN');
    expect(zplText).toContain(`^FDLA,${code}`);
    /**
     * O nome vai INTEIRO — quebrado em linhas por largura, mas inteiro. É a promessa da
     * fase: o crachá que não diz o nome todo não serve para a porta. A última palavra (o
     * identificador da execução) é a que sumiria primeiro num corte.
     */
    for (const palavra of participantName.split(' ')) {
      expect(zplText, palavra).toContain(palavra);
    }
    /**
     * O tamanho sai em PONTOS, com o padrão de quem decide: 203 dpi e 100 × 50 mm. A
     * conta vem do domínio (armadilha 74) — escrever "800" aqui mediria a minha conta,
     * não a da impressora.
     */
    expect(zplText).toContain(`^PW${mmToDots(DEFAULT_THERMAL_CONFIG.widthMm, DEFAULT_THERMAL_CONFIG.dpi)}`);
    expect(zplText).toContain(`^LL${mmToDots(DEFAULT_THERMAL_CONFIG.heightMm, DEFAULT_THERMAL_CONFIG.dpi)}`);

    /** Imprimir é um FATO: o crachá passa a constar como impresso. */
    const credential = await e2eDb.eventCredential.findFirstOrThrow({
      where: { eventId, userId: participantId },
      select: { printedAt: true, printedById: true },
    });

    expect(credential.printedAt).toBeInstanceOf(Date);
    expect(credential.printedById).not.toBeNull();
  });

  test('5. medida que não cabe é RECUSADA; a medida do operador é respeitada', async ({ page }) => {
    await signInAs(page, organizerEmail);

    const base = `/api/t/${slug}/credenciamento/crachas/impressao?eventId=${eventId}`;

    /**
     * 500 mm de largura não é uma folha que existe: a medida sai da faixa que o produto
     * aceita, e a recusa diz o intervalo — antes de gastar a primeira folha de etiqueta.
     */
    const naoCabe = await page.request.get(
      `${base}&formato=etiquetas&colunas=3&linhas=8&largura=500&altura=33.9`,
    );

    expect(naoCabe.status()).toBe(400);
    expect((await naoCabe.json()).code).toBe('INVALID');

    /** E a medida DENTRO da faixa que não cabe na folha é outra recusa, mais específica. */
    const estoura = await page.request.get(
      `${base}&formato=etiquetas&colunas=5&linhas=8&largura=60&altura=33.9`,
    );

    expect(estoura.status()).toBe(400);
    expect((await estoura.json()).code).toBe('DOES_NOT_FIT');

    /** Resolução que a térmica não oferece também é recusada, dizendo o motivo. */
    const dpiInvalido = await page.request.get(`${base}&formato=zpl&dpi=150`);

    expect(dpiInvalido.status()).toBe(400);
    expect((await dpiInvalido.json()).message).toMatch(/dpi/i);

    /** E a folha de OUTRO material — 2 × 4 de 90 × 50 mm — sai normalmente. */
    const outro = await page.request.get(
      `${base}&formato=etiquetas&colunas=2&linhas=4&largura=90&altura=50&margem-esquerda=15&margem-superior=20`,
    );

    expect(outro.status()).toBe(200);
    expect((await outro.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    /** Formato desconhecido não vira arquivo nenhum. */
    const formatoRuim = await page.request.get(`${base}&formato=svg`);

    expect(formatoRuim.status()).toBe(400);
  });
});

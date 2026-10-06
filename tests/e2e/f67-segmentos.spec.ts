/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A ABA "SEGMENTOS" DA COMUNICAÇÃO (FASE 67 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DE PONTA A PONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    (a) o segmento é MONTADO PELA TELA e a CONTAGEM muda conforme as condições —
 *        inclusive com a exclusão ("exceto quem…"), que tira UMA pessoa da seleção;
 *    (b) a PRÉVIA é MASCARADA pela régua da F60: quem ocultou o perfil sai `Ana S.`
 *        e quem não ocultou sai por inteiro — e a tela do segmento NÃO mostra e-mail
 *        de ninguém;
 *    (c) o segmento VAZIO é RECUSADO com o motivo do domínio, e o parâmetro
 *        obrigatório em branco também;
 *    (d) "enviar um teste só para mim" e o DISPARO mostram o RESULTADO REAL — e o
 *        reenvio da mesma campanha devolve "já existiam" em vez de duplicar;
 *    (e) o HISTÓRICO mostra a campanha com as FRASES CONGELADAS, o autor e a
 *        contagem.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PRIMEIRO CENÁRIO RODA COM O JAVASCRIPT DESLIGADO — E ISSO É A PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O requisito é "montar o segmento sem JavaScript", e um formulário `GET` que só
 *  funciona depois da hidratação não cumpre isso. Montar, contar e conferir o
 *  resultado num contexto com `javaScriptEnabled: false` é a única medida que
 *  responde à pergunta — e é também o que prende o endereço compartilhável.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS DOIS CENÁRIOS DEPENDEM DA MESMA FIXTURE, E NENHUM DEPENDE DO OUTRO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A instituição, o evento, as três atividades e as três pessoas nascem no
 *  `beforeAll`; cada cenário faz as PRÓPRIAS asserções. O cenário 2 não lê nada que
 *  o cenário 1 tenha deixado na tela — a contagem vem do banco, e é ele que decide.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

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

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f67-segmentos-${RUN_ID}`;
const EVENT_TITLE = 'Congresso dos Segmentos';

/**
 * Nomes de DUAS palavras de propósito: a máscara da F60 devolve `Ana S.`, e é
 * exatamente esse o texto que a tela interna tem de mostrar. Um sufixo com o
 * `RUN_ID` viraria uma terceira palavra e a máscara mudaria de forma.
 */
const NOME_OCULTA = 'Ana Souza';
const NOME_VISIVEL = 'Bruno Visível';
const NOME_FORA = 'Carla Nogueira';

const ASSUNTO = 'Sua vaga na oficina';
const CORPO = 'A sua vaga está confirmada. Traga o notebook e chegue dez minutos antes.';

interface Pessoa {
  id: string;
  email: string;
}

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let atividadeA: string;
let atividadeB: string;
let atividadeC: string;
let tituloAtividadeA: string;

let organizadora: Pessoa;
let oculta: Pessoa;
let visivel: Pessoa;
let fora: Pessoa;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<Pessoa> {
  const email = `f67.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/**
 * O contexto SEM JavaScript — é onde o cenário 1 roda.
 *
 * O login vai pela API (não pela tela de login) porque a tela de login é de outra
 * spec: aqui o que interessa é a aba de segmentos funcionando sem bundle.
 */
async function semJavaScript(browser: Browser, baseURL: string | undefined, email: string) {
  const contexto: BrowserContext = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await contexto.newPage();

  await signInAs(page, email);

  return { contexto, page };
}

/** Uma inscrição CONFIRMADA — a fixture do público do segmento. */
async function inscrever(input: { userId: string; activityId: string }): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'CONFIRMED',
      },
    });
  });
}

const basePath = (): string => `/t/${tenantSlug}/administracao/comunicacao`;
const segmentosPath = (extra = ''): string => `${basePath()}?aba=segmentos${extra}`;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição dos Segmentos ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: EVENT_TITLE,
    });

    eventId = event.id;

    tituloAtividadeA = `Oficina de Robótica ${RUN_ID}`;
    const activityA = await createActivity({
      tenantId,
      eventId,
      slug: `oficina-${RUN_ID}`,
      title: tituloAtividadeA,
      capacity: 30,
    });
    const activityB = await createActivity({
      tenantId,
      eventId,
      slug: `mesa-${RUN_ID}`,
      title: `Mesa-redonda de Saúde ${RUN_ID}`,
      capacity: 30,
    });
    const activityC = await createActivity({
      tenantId,
      eventId,
      slug: `jornada-${RUN_ID}`,
      title: `Jornada de Enfermagem ${RUN_ID}`,
      capacity: 30,
    });

    atividadeA = activityA.id;
    atividadeB = activityB.id;
    atividadeC = activityC.id;

    organizadora = await signUpVia(api, `Organizadora F67 ${RUN_ID}`);
    oculta = await signUpVia(api, NOME_OCULTA);
    visivel = await signUpVia(api, NOME_VISIVEL);
    fora = await signUpVia(api, NOME_FORA);

    await linkUser({ tenantId, userId: organizadora.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: organizadora.id, role: 'ADMIN' });

    for (const pessoa of [oculta, visivel, fora]) {
      await linkUser({ tenantId, userId: pessoa.id, kind: 'PARTICIPANT' });
      await grantRole({ tenantId, userId: pessoa.id, role: 'PARTICIPANT' });
    }

    /**
     * A ocultação do perfil da primeira pessoa.
     *
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE A COLUNA É FIXTURE, E NÃO A MODERAÇÃO DE VERDADE
     * ─────────────────────────────────────────────────────────────────────────────
     *  O caminho real (denúncia + decisão da plataforma) tem spec própria e é
     *  exercitado ponta a ponta na F60/F62, que leem a coluna DE VOLTA do banco. O
     *  que este arquivo mede é o EFEITO dela na tela do segmento — e escrever o
     *  efeito direto é o mesmo recorte que o E2E da ocultação usa para publicar o
     *  perfil ("o cenário é sobre o efeito, e publicar tem spec próprio").
     */
    await e2eDb.user.update({
      where: { id: oculta.id },
      data: {
        publicProfileHiddenAt: new Date(),
        publicProfileHiddenReason: 'Pedido da própria pessoa (fixture do E2E da F67).',
      },
    });

    /** A: ana + bruno · B: carla · C: ana + carla — os recortes do cenário. */
    await inscrever({ userId: oculta.id, activityId: atividadeA });
    await inscrever({ userId: visivel.id, activityId: atividadeA });
    await inscrever({ userId: fora.id, activityId: atividadeB });
    await inscrever({ userId: oculta.id, activityId: atividadeC });
    await inscrever({ userId: fora.id, activityId: atividadeC });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
test('1. montar o segmento SEM JavaScript: contagem, frases, máscara e recusa', async ({
  browser,
  baseURL,
}) => {
  const { contexto, page } = await semJavaScript(browser, baseURL, organizadora.email);

  try {
    await page.goto(segmentosPath());

    /** A aba é LINK com `aria-current` — e a caixa de saída continua ao lado. */
    await expect(page.getByTestId('communication-tab-segmentos')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('communication-tab-saida')).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    const formulario = page.getByTestId('segment-form');
    const contagem = page.getByTestId('segment-count');
    const recusa = page.getByTestId('segment-refused');

    // ── (c) O SEGMENTO VAZIO É RECUSADO, COM O TEXTO DO DOMÍNIO ──────────────
    await page.getByTestId('segment-count-submit').click();

    await expect(recusa).toBeVisible();
    await expect(page.getByTestId('segment-refused-message')).toHaveText(
      'Escolha ao menos uma condição para montar o segmento.',
    );
    await expect(page.getByTestId('segment-refused-issues')).toContainText(
      'sem condição o segmento selecionaria a instituição inteira',
    );

    // ── A condição escolhida, e o parâmetro OBRIGATÓRIO em branco ────────────
    await page.locator('select[name="evento"]').selectOption(eventId);
    await page.locator('select[name="c0"]').selectOption('inscrito-na-atividade');
    await page.getByTestId('segment-count-submit').click();

    /** A tela já oferece o parâmetro que a condição declara — e recusa sem ele. */
    await expect(page.locator('select[name="p0_atividade"]')).toBeVisible();
    await expect(recusa).toBeVisible();
    await expect(page.getByTestId('segment-refused-issues')).toContainText('Informe atividade');

    // ── (a) A CONTAGEM, E ELA MUDANDO CONFORME A CONDIÇÃO ───────────────────
    await page.locator('select[name="p0_atividade"]').selectOption(atividadeA);
    await page.getByTestId('segment-count-submit').click();

    await expect(contagem).toHaveText('2');

    // As FRASES do catálogo, com o NOME da atividade no lugar do uuid.
    await expect(page.getByTestId('segment-explanation')).toContainText(
      `Quem está inscrito na atividade ${tituloAtividadeA}.`,
    );

    // ── (b) A PRÉVIA MASCARADA: quem ocultou sai abreviado, quem não, inteiro ─
    await expect(page.getByTestId('segment-person')).toHaveCount(2);

    const pessoaOculta = page.getByTestId('segment-person').filter({ hasText: 'Ana S.' });
    await expect(pessoaOculta).toHaveAttribute('data-masked', 'true');
    await expect(page.getByTestId('segment-person-mask')).toHaveCount(1);

    const pessoaInteira = page.getByTestId('segment-person').filter({ hasText: NOME_VISIVEL });
    await expect(pessoaInteira).toHaveAttribute('data-masked', 'false');

    /** O nome inteiro de quem ocultou NÃO aparece — nem no HTML servido. */
    const html = await page.content();
    expect(html).not.toContain(NOME_OCULTA);

    /** E a tela do segmento não traz e-mail de ninguém. */
    expect(await page.getByTestId('segment-result').innerHTML()).not.toContain('@');

    // ── Outra atividade: a contagem é OUTRA (B tem uma pessoa só) ────────────
    await page.locator('select[name="p0_atividade"]').selectOption(atividadeB);
    await page.getByTestId('segment-count-submit').click();

    await expect(contagem).toHaveText('1');
    await expect(page.getByTestId('segment-people')).toContainText(NOME_FORA);

    // ── Duas condições (E): ninguém tem XP nesta instituição ────────────────
    await page.locator('select[name="p0_atividade"]').selectOption(atividadeA);
    await page.locator('select[name="c1"]').selectOption('xp-acima');

    /**
     * O parâmetro de uma condição só existe no DOM DEPOIS que a tela sabe qual
     * condição é — e quem sabe é o servidor. Sem JavaScript, escolher a condição e
     * enviar é o gesto que faz o campo aparecer: é o mesmo caminho de quem usa o
     * formulário sem bundle.
     */
    await page.getByTestId('segment-count-submit').click();
    await page.locator('input[name="p1_xp"]').fill('1');
    await page.getByTestId('segment-count-submit').click();

    await expect(contagem).toHaveText('0');
    await expect(page.getByTestId('segment-people-empty')).toBeVisible();
    await expect(page.getByTestId('segment-explanation')).toContainText('XP');

    // ── O "exceto quem…": A (ana + bruno) menos C (ana + carla) = bruno ──────
    await page.locator('select[name="c1"]').selectOption('');
    await page.locator('select[name="exceto"]').selectOption('inscrito-na-atividade');
    await page.getByTestId('segment-count-submit').click();
    await page.locator('select[name="x_atividade"]').selectOption(atividadeC);
    await page.getByTestId('segment-count-submit').click();

    await expect(contagem).toHaveText('1');
    await expect(page.getByTestId('segment-exclusion')).toContainText('Exceto:');
    await expect(page.getByTestId('segment-people')).toContainText(NOME_VISIVEL);
    await expect(page.getByTestId('segment-people')).not.toContainText('Ana S.');

    /** O endereço guarda a seleção: é ele que se manda para o colega conferir. */
    expect(page.url()).toContain('c0=inscrito-na-atividade');
    expect(page.url()).toContain(`p0_atividade=${atividadeA}`);
    expect(page.url()).toContain(`x_atividade=${atividadeC}`);

    /** O formulário continua sendo um formulário — e não depende de bundle. */
    await expect(formulario).toBeVisible();
  } finally {
    await contexto.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test('2. o teste só para mim, o disparo com o resultado REAL e o histórico', async ({ page }) => {
  await signInAs(page, organizadora.email);

  /**
   * O endereço do segmento é o MESMO que o formulário produz (cenário 1): o
   * cenário 2 entra por ele para medir o ENVIO, que é o que ele tem de diferente.
   */
  await page.goto(
    segmentosPath(
      `&segmento=1&evento=${eventId}&c0=inscrito-na-atividade&p0_atividade=${atividadeA}`,
    ),
  );

  await expect(page.getByTestId('segment-count')).toHaveText('2');

  // ── O texto: rótulos de verdade, sem JavaScript nenhum no caminho ──────────
  await page.getByLabel('Assunto').fill(ASSUNTO);
  await page.getByLabel('Corpo da mensagem').fill(CORPO);

  // Sem texto válido não existe botão de confirmar — e o motivo vem do domínio.
  await page.getByLabel('Assunto').fill('');
  await page.getByTestId('segment-count-submit').click();
  await expect(page.getByTestId('segment-text-missing')).toContainText('Escreva o assunto');
  await expect(page.getByTestId('segment-review-submit')).toHaveCount(0);

  await page.getByLabel('Assunto').fill(ASSUNTO);
  await page.getByTestId('segment-count-submit').click();

  // ── O passo de confirmação: a prévia com os dados REAIS da primeira pessoa ─
  await page.getByTestId('segment-review-submit').click();

  const confirmacao = page.getByTestId('segment-confirmation');
  await expect(confirmacao).toBeVisible();
  await expect(page.getByTestId('segment-confirm-subject')).toHaveText(ASSUNTO);

  const previa = page.getByTestId('segment-body-preview');
  await expect(previa).toContainText('Olá, Ana!');
  await expect(previa).toContainText(CORPO);
  await expect(previa).toContainText('Você recebe esta mensagem porque participa de');
  /** A máscara vale na PRÉVIA também: o nome inteiro de quem ocultou não aparece. */
  await expect(previa).not.toContainText(NOME_OCULTA);

  // ── "Enviar um teste só para mim" ─────────────────────────────────────────
  await page.getByTestId('campaign-test-submit').click();

  const retorno = page.getByTestId('campaign-send-feedback');
  await expect(retorno).toHaveAttribute('data-ok', 'true');
  await expect(retorno).toContainText('Teste registrado');
  await expect(retorno).toContainText(organizadora.email.slice(0, 2));
  await expect(retorno).not.toContainText(organizadora.email);

  /** O teste saiu pelo MESMO outbox — e sem chave do fato (não é uma campanha). */
  const testMessage = await e2eDb.emailMessage.findFirst({
    where: { tenantId, toUserId: organizadora.id, template: 'CAMPAIGN_MESSAGE' },
    select: { dedupeKey: true, to: true, subject: true },
  });

  expect(testMessage?.to).toBe(organizadora.email);
  expect(testMessage?.dedupeKey).toBeNull();
  expect(testMessage?.subject).toBe(ASSUNTO);

  // ── O DISPARO, com o resultado REAL da passada ────────────────────────────
  await page.getByTestId('campaign-dispatch-submit').click();

  await expect(retorno).toHaveAttribute('data-ok', 'true');
  await expect(retorno).toContainText('2 mensagem(ns) entraram na fila, 0 já existiam, 0 falharam');
  await expect(retorno).toContainText('Destinatários alcançados pela definição agora: 2.');

  /**
   * E o botão de disparar SAI de cena: um segundo clique criaria OUTRA campanha
   * (com chave do fato nova) e mandaria a mesma mensagem de novo. O caminho que
   * fica é o reenvio da MESMA campanha, onde o `dedupeKey` protege.
   */
  await expect(page.getByTestId('campaign-dispatch-submit')).toHaveCount(0);
  await expect(page.getByTestId('campaign-dispatched-note')).toContainText('histórico abaixo');

  const campanha = await e2eDb.communicationCampaign.findFirstOrThrow({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, recipientCount: true, reachedCount: true, failedCount: true },
  });

  expect(campanha.status).toBe('SENT');
  expect(campanha.recipientCount).toBe(2);
  expect(campanha.reachedCount).toBe(2);
  expect(campanha.failedCount).toBe(0);

  /** UMA linha por destinatário, com a chave do fato — e ninguém de fora. */
  const mensagens = await e2eDb.emailMessage.findMany({
    where: { tenantId, dedupeKey: { startsWith: `campaign:${campanha.id}:` } },
    select: { toUserId: true, dedupeKey: true },
  });

  expect(mensagens).toHaveLength(2);
  expect(mensagens.map((row) => row.toUserId).sort()).toEqual([oculta.id, visivel.id].sort());
  expect(mensagens.some((row) => row.toUserId === fora.id)).toBe(false);

  // ── (e) O HISTÓRICO: autor, frases congeladas e contagem ─────────────────
  const historico = page.getByTestId('campaign-row');
  await expect(historico).toHaveCount(1);
  await expect(page.getByTestId('campaign-subject')).toHaveText(ASSUNTO);
  await expect(page.getByTestId('campaign-meta')).toContainText(`Organizadora F67 ${RUN_ID}`);
  await expect(page.getByTestId('campaign-recipients')).toContainText('Selecionados: 2');
  await expect(page.getByTestId('campaign-explanation')).toContainText(
    `Quem está inscrito na atividade ${tituloAtividadeA}.`,
  );
  await expect(historico).toContainText('Enviada');
  await expect(page.getByTestId('campaign-error')).toHaveCount(0);

  // ── O REENVIO: caminho de operação, e o resultado diz que não duplicou ────
  await page.getByTestId(`campaign-resend-${campanha.id}`).getByTestId('inline-submit').click();

  const retornoReenvio = page.getByTestId(`campaign-resend-${campanha.id}-feedback`);
  await expect(retornoReenvio).toContainText('0 mensagem(ns) entraram na fila, 2 já existiam');

  /** O outbox continua com DUAS linhas: a chave do fato segurou a repetição. */
  const depois = await e2eDb.emailMessage.count({
    where: { tenantId, dedupeKey: { startsWith: `campaign:${campanha.id}:` } },
  });

  expect(depois).toBe(2);
});

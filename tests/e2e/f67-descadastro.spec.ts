/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O DESCADASTRO DE PONTA A PONTA (FASE 67 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, E COM QUE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O rodapé de uma campanha leva o endereço de descadastro DAQUELA pessoa, e o
 *  ponto de partida aqui é o e-mail REALMENTE GERADO pelo disparo — não um endereço
 *  montado à mão no teste. É o que garante que as duas metades da fase concordam: o
 *  token que o envio escreve no rodapé é o mesmo que a página sem login aceita.
 *
 *    (a) a pessoa clica no endereço do rodapé, a página diz DE QUE instituição é,
 *        o que PARA e o que CONTINUA, e ela sai;
 *    (b) depois de sair, ela SOME do segmento — provado por uma campanha NOVA
 *        disparada depois da saída, com os números do outbox;
 *    (c) o TRANSACIONAL continua chegando (o aviso de vaga retida é enfileirado
 *        pelo serviço, com a pessoa FORA);
 *    (d) a página é IDEMPOTENTE: recarregar e sair de novo não muda nada;
 *    (e) o CAMINHO DE VOLTA devolve a pessoa à contagem, e o disparo a alcança de
 *        novo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PROVA DO TRANSACIONAL É PELO SERVIÇO, E NÃO PELA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que se quer demonstrar é que as DUAS ROTAS DE E-MAIL DISCORDAM de propósito:
 *  a campanha pula quem saiu, e o aviso de vaga retida continua saindo. Isso é uma
 *  propriedade do serviço, e a tela não tem como prová-la — ela nem aparece na
 *  história. O `notifyConfirmationRequired` é chamado de verdade e o que se lê
 *  depois é a linha do OUTBOX, que é o registro do que saiu.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TOKEN NÃO PODE APARECER EM LOG DE TESTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As asserções usam o ENDEREÇO inteiro (que é o que a pessoa recebeu) e nunca o
 *  despejam no relatório: a falha do Playwright imprime o esperado e o recebido, e
 *  um token em claro no relatório de CI é um endereço de descadastro publicado.
 *  Quando é preciso comparar, compara-se o FATO (a pessoa sumiu do segmento), não o
 *  valor.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

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
import { notifyConfirmationRequired } from '../../src/lib/events/registration-notices';
import { unsubscribeUrlFor } from '../../src/lib/communication/unsubscribe-service';

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f67-descadastro-${RUN_ID}`;
const EVENT_TITLE = 'Congresso do Descadastro';
const ATIVIDADE_TITULO = 'Oficina com vaga retida';

const NOME_QUE_SAI = 'Denise Descadastra';
const NOME_QUE_FICA = 'Beto Continua';

/**
 * O corpo com os TRÊS marcadores e o assunto com um deles: é o que prova, de
 * passagem, que o e-mail que a pessoa recebe é o dela.
 */
const ASSUNTO = 'Sua vaga, {nome}';
const CORPO = 'Olá, {nome}! A sua vaga em {evento} está retida. — {instituicao}';

interface Pessoa {
  id: string;
  email: string;
}

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let activityId: string;
let organizadora: Pessoa;
let sai: Pessoa;
let fica: Pessoa;
/** A inscrição RETIDA de quem vai sair: é ela que dá o aviso transacional. */
let inscricaoRetidaId: string;

const basePath = (): string => `/t/${tenantSlug}/administracao/comunicacao`;
const segmentosPath = (extra = ''): string => `${basePath()}?aba=segmentos${extra}`;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<Pessoa> {
  const email = `f67d.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
 * A inscrição RETIDA, gravada no contexto da instituição.
 *
 * O `confirmationDueAt` é o que o aviso transacional exige para existir — sem ele o
 * serviço responde "inscrição sem prazo" e a prova (c) não teria o que medir.
 */
async function inscreverRetendo(input: {
  userId: string;
  dueAt: Date;
}): Promise<string> {
  const id = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        id,
        tenantId,
        eventId,
        activityId,
        userId: input.userId,
        status: 'PENDING',
        confirmationDueAt: input.dueAt,
      },
    });
  });

  return id;
}

/** O endereço de descadastro que ESTE disparo escreveu no rodapé de UMA pessoa. */
async function enderecoDoRodape(campaignId: string, userId: string): Promise<string> {
  const row = await e2eDb.emailMessage.findFirstOrThrow({
    where: { tenantId, toUserId: userId, dedupeKey: `campaign:${campaignId}:${userId}` },
    select: { html: true, text: true },
  });

  /**
   * O endereço é lido do TEXTO (a versão sem HTML do outbox), e não do HTML: o
   * texto é montado a partir do mesmo `unsubscribeUrl` do payload, e extrair do
   * HTML exigiria decodificar entidade (`&amp;`) — o que faria o teste medir o
   * escape em vez do endereço.
   */
  const match = row.text.match(/https?:\/\/[^\s]*\/descadastro\/[A-Za-z0-9_-]+/);

  if (!match) {
    throw new Error('O rodapé da campanha não trouxe endereço de descadastro.');
  }

  return match[0];
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Descadastro ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: EVENT_TITLE,
    });

    eventId = event.id;

    const activity = await createActivity({
      tenantId,
      eventId,
      slug: `oficina-${RUN_ID}`,
      title: ATIVIDADE_TITULO,
      capacity: 30,
    });

    activityId = activity.id;

    organizadora = await signUpVia(api, `Organizadora F67D ${RUN_ID}`);
    sai = await signUpVia(api, NOME_QUE_SAI);
    fica = await signUpVia(api, NOME_QUE_FICA);

    await linkUser({ tenantId, userId: organizadora.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: organizadora.id, role: 'ADMIN' });

    for (const pessoa of [sai, fica]) {
      await linkUser({ tenantId, userId: pessoa.id, kind: 'PARTICIPANT' });
      await grantRole({ tenantId, userId: pessoa.id, role: 'PARTICIPANT' });
    }

    /**
     * As DUAS pessoas inscritas na MESMA atividade, e as duas com a vaga retida: o
     * segmento da campanha passa a ter duas pessoas, o que permite medir a diferença
     * entre "a que saiu" e "a que ficou" no MESMO disparo.
     */
    const prazo = new Date(Date.now() + 7 * 86_400_000);

    inscricaoRetidaId = await inscreverRetendo({ userId: sai.id, dueAt: prazo });
    await inscreverRetendo({ userId: fica.id, dueAt: prazo });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  OS QUATRO CASOS SÃO UM PERCURSO, E POR ISSO SÃO `serial`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Eles contam UMA história em ordem: a pessoa sai (1), some do segmento (2), o
 *  transacional continua chegando (3) e ela volta (4). A ordem é o FATO medido — o
 *  segundo caso pergunta "depois que ela saiu, o disparo a alcança?", e a resposta
 *  não existe se a saída não tiver acontecido.
 *
 *  `describe.serial` é o que torna isso explícito e SEGURO: o Playwright não promete
 *  ordem entre `test()` de um arquivo, e a primeira versão deste spec (quatro
 *  `test()` soltos) reprovou por isso — o caso 2 media um banco em que a saída ainda
 *  não tinha acontecido e o sintoma apareceu como "a contagem não caiu", que é um
 *  diagnóstico que aponta para o produto errado. Em série, a dependência é declarada
 *  e o modo `serial` PARA a suíte no primeiro erro: o caso 3 não roda sobre uma
 *  história que não aconteceu.
 */
test.describe.configure({ mode: 'serial' });

test.describe('descadastro de ponta a ponta', () => {
test('1. o endereço do rodapé abre a página, explica e confirma a saída', async ({ page }) => {
  await signInAs(page, organizadora.email);

  // ── O disparo, pela TELA (o caminho real do organizador) ────────────────────
  await page.goto(
    segmentosPath(
      `&segmento=1&evento=${eventId}&c0=inscrito-na-atividade&p0_atividade=${activityId}`,
    ),
  );

  await expect(page.getByTestId('segment-count')).toHaveText('2');

  await page.getByLabel('Assunto').fill(ASSUNTO);
  await page.getByLabel('Corpo da mensagem').fill(CORPO);
  await page.getByTestId('segment-count-submit').click();
  await page.getByTestId('segment-review-submit').click();

  /**
   * A PRÉVIA mostra o rodapé de descadastro com um token de EXEMPLO (a prévia não
   * exibe credencial de terceiro) — e é isto que o organizador vê antes de enviar.
   */
  await expect(page.getByTestId('segment-body-preview')).toContainText(
    'continuam chegando',
  );

  await page.getByTestId('campaign-dispatch-submit').click();
  await expect(page.getByTestId('campaign-send-feedback')).toHaveAttribute('data-ok', 'true');

  const campanha = await e2eDb.communicationCampaign.findFirstOrThrow({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  // ── O endereço que ESTE disparo escreveu para a pessoa que vai sair ─────────
  const endereco = await enderecoDoRodape(campanha.id, sai.id);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O RODAPÉ E A PÁGINA CONCORDAM POR CONSTRUÇÃO — E AQUI ISSO É MEDIDO
   * ─────────────────────────────────────────────────────────────────────────────
   *  O endereço que o disparo escreveu no e-mail e o que o serviço deriva para a
   *  mesma pessoa têm de ser o MESMO: é o que faz o link do rodapé abrir a caixa de
   *  descadastro de quem o recebeu, e não a de ninguém. Se a derivação mudasse de um
   *  lado só, o e-mail sairia com um endereço que responde 404 — e a pessoa não teria
   *  como sair.
   */
  expect(endereco).toBe(enderecoDe(sai.id));

  /** A pessoa que FICA recebe o endereço DELA — os dois são diferentes. */
  expect(endereco).not.toBe(enderecoDe(fica.id));

  // ── A página sem login: nenhuma sessão, e ela fala da instituição ───────────
  const anonima = await page.context().browser()?.newContext({ baseURL: page.context().baseURL ?? undefined });

  if (!anonima) throw new Error('Não foi possível abrir um contexto anônimo.');

  try {
    const semSessao = await anonima.newPage();

    await semSessao.goto(endereco);

    await expect(semSessao.getByTestId('unsubscribe-state')).toBeVisible();
    await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
      'data-out',
      'false',
    );

    /** DE QUE instituição é — a primeira coisa que a pessoa precisa reconhecer. */
    await expect(semSessao.getByRole('main')).toContainText(
      `Instituição do Descadastro ${RUN_ID}`,
    );
    await expect(semSessao.getByRole('main')).toContainText(NOME_QUE_SAI.split(' ')[0] ?? '');

    /** O que PARA e o que CONTINUA, os dois ditos. */
    await expect(semSessao.getByTestId('unsubscribe-what-stops')).toContainText(
      'recados em massa',
    );
    await expect(semSessao.getByTestId('unsubscribe-keeps-list')).toContainText(
      'vaga está retida',
    );
    await expect(semSessao.getByTestId('unsubscribe-keeps-list')).toContainText('Certificado');

    /** E o e-mail de ninguém aparece na tela. */
    expect(await semSessao.content()).not.toContain(sai.email);

    // ── A saída ────────────────────────────────────────────────────────────────
    await semSessao.getByTestId('unsubscribe-confirm-submit').click();

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE SE ESPERA É O ESTADO, E NÃO A MENSAGEM
     * ─────────────────────────────────────────────────────────────────────────────
     *  O `revalidatePath` da ação faz a página voltar REDESENHADA: o formulário de
     *  saída sai de cena e o de volta entra no lugar dele. A mensagem de sucesso é
     *  do formulário que acabou de sumir, então esperar por ela seria esperar por um
     *  nó que o próprio conserto remove — e o teste reprovaria justamente quando a
     *  tela está certa. O que importa é o que a tela AFIRMA: `data-out="true"`.
     */
    await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
      'data-out',
      'true',
    );
    await expect(semSessao.getByTestId('unsubscribe-since')).toBeVisible();
    /** Depois de sair, o caminho que a tela oferece é a VOLTA. */
    await expect(semSessao.getByTestId('resubscribe-submit')).toBeVisible();
    await expect(semSessao.getByTestId('unsubscribe-confirm-submit')).toHaveCount(0);

    // Recarregar não muda nada: o estado é do BANCO, e não da última resposta.
    await semSessao.reload();
    await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
      'data-out',
      'true',
    );

    const depois = await e2eDb.communicationUnsubscribe.findFirstOrThrow({
      where: { tenantId, userId: sai.id },
      select: { unsubscribedAt: true, channel: true },
    });

    expect(depois.channel).toBe('LINK');
    expect(depois.unsubscribedAt).not.toBeNull();

    // ── O CAMINHO DE VOLTA, ainda no caso 1: ele funciona na mesma tela ─────────
    /**
     * A prova é o ESTADO, e o motivo é o mesmo da saída: a página volta
     * REDESENHADA, o formulário de volta sai de cena e a mensagem dele vai junto. O
     * que fica na tela — e o que a pessoa lê para saber que deu certo — é o bloco de
     * situação dizendo que ela voltou a receber.
     */
    await semSessao.getByTestId('resubscribe-submit').click();
    await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
      'data-out',
      'false',
    );
    await expect(semSessao.getByTestId('unsubscribe-confirm-submit')).toBeVisible();

    /**
     * ── VOLTAR DUAS VEZES É IDEMPOTENTE — E A PROVA DISSO É A LINHA ─────────────
     *  O segundo clique não tem mensagem para esperar (a tela volta a "você recebe"
     *  de novo), então o que se mede é o BANCO: a data da volta não é reescrita e
     *  nenhuma segunda linha nasce.
     */
    await semSessao.getByTestId('resubscribe-submit').click();
    await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
      'data-out',
      'false',
    );

    const voltou = await e2eDb.communicationUnsubscribe.findFirstOrThrow({
      where: { tenantId, userId: sai.id },
      select: { resubscribedAt: true },
    });

    expect(voltou.resubscribedAt).not.toBeNull();

    // ── E a saída DE NOVO, que é o estado com que os casos seguintes trabalham ─
    await semSessao.getByTestId('unsubscribe-confirm-submit').click();
    await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
      'data-out',
      'true',
    );

    /** Sair duas vezes não cria uma segunda linha nem muda o carimbo. */
    const linhas = await e2eDb.communicationUnsubscribe.count({
      where: { tenantId, userId: sai.id },
    });

    expect(linhas).toBe(1);
  } finally {
    await anonima.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test('2. quem saiu SOME do segmento, e o disparo seguinte não a alcança', async ({ page }) => {
  await signInAs(page, organizadora.email);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O SEGMENTO MUDOU DE TAMANHO, E O NÚMERO É A PROVA
   * ─────────────────────────────────────────────────────────────────────────────
   *  A tela é a MESMA do primeiro envio; o que mudou foi o banco. A contagem cai de
   *  2 para 1, e o "N de M" diz que uma pessoa do segmento saiu.
   */
  await page.goto(
    segmentosPath(
      `&segmento=1&evento=${eventId}&c0=inscrito-na-atividade&p0_atividade=${activityId}`,
    ),
  );

  await expect(page.getByTestId('segment-count')).toHaveText('1');
  await expect(page.getByTestId('segment-unsubscribed')).toContainText('saíram do canal');
  await expect(page.getByTestId('segment-people')).toContainText(NOME_QUE_FICA);
  await expect(page.getByTestId('segment-people')).not.toContainText(NOME_QUE_SAI);

  /**
   * ── E A PROVA PELO DISPARO, não só pela contagem da tela ────────────────────
   *  Uma campanha NOVA (chave do fato nova) com o MESMO segmento: se o filtro de
   *  "quem saiu" valesse só na contagem, a linha do outbox apareceria aqui.
   */
  await page.getByLabel('Assunto').fill('Segundo aviso da oficina');
  await page.getByLabel('Corpo da mensagem').fill('O material já está disponível no portal.');
  await page.getByTestId('segment-count-submit').click();
  await page.getByTestId('segment-review-submit').click();
  await page.getByTestId('campaign-dispatch-submit').click();

  await expect(page.getByTestId('campaign-send-feedback')).toHaveAttribute('data-ok', 'true');

  const campanha = await e2eDb.communicationCampaign.findFirstOrThrow({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, recipientCount: true, skippedCount: true },
  });

  expect(campanha.recipientCount).toBe(1);
  expect(campanha.skippedCount).toBe(1);

  const mensagens = await e2eDb.emailMessage.findMany({
    where: { tenantId, dedupeKey: { startsWith: `campaign:${campanha.id}:` } },
    select: { toUserId: true },
  });

  expect(mensagens).toHaveLength(1);
  expect(mensagens[0]?.toUserId).toBe(fica.id);
  expect(mensagens.some((row) => row.toUserId === sai.id)).toBe(false);
});

// ═══════════════════════════════════════════════════════════════════════════════
test('3. o TRANSACIONAL continua chegando para quem saiu', async () => {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A PROVA É PELO SERVIÇO — E O SERVIÇO NÃO CONHECE O DESCADASTRO
   * ─────────────────────────────────────────────────────────────────────────────
   *  O aviso de vaga retida é OBRIGAÇÃO da instituição com a pessoa: calá-lo faria
   *  alguém perder a vaga por não ter sido avisado de que precisava confirmar. Ele
   *  sai pelo MESMO outbox e não consulta o descadastro — e é isso que o teste mede,
   *  chamando o serviço de verdade e lendo o que ficou gravado.
   */
  const aviso = await notifyConfirmationRequired({ tenantId, registrationId: inscricaoRetidaId });

  expect(aviso.ok, aviso.ok ? '' : aviso.message).toBe(true);

  const transacional = await e2eDb.emailMessage.findFirstOrThrow({
    where: { tenantId, toUserId: sai.id, template: 'REGISTRATION_PENDING' },
    select: { subject: true, html: true, text: true },
  });

  expect(transacional.subject).toContain('Confirme sua vaga');
  expect(transacional.text).toContain('está reservada');
  /** E o transacional NÃO leva rodapé de descadastro — a saída dele é a conversa. */
  expect(transacional.html).not.toContain('/descadastro/');
  expect(transacional.text).not.toContain('recados em massa');

  /** O aviso também entrou na caixa de entrada da pessoa (FASE 34). */
  const naCaixa = await e2eDb.participantMessage.count({ where: { tenantId, userId: sai.id } });

  expect(naCaixa).toBeGreaterThan(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
test('4. o caminho de volta devolve a pessoa à contagem e ao disparo', async ({ page }) => {
  await signInAs(page, organizadora.email);

  const endereco = enderecoDe(sai.id);

  const anonima = await page.context().browser()?.newContext({ baseURL: page.context().baseURL ?? undefined });

  if (!anonima) throw new Error('Não foi possível abrir um contexto anônimo.');

  try {
    const semSessao = await anonima.newPage();

    await semSessao.goto(endereco);
    await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
      'data-out',
      'true',
    );

    await semSessao.getByTestId('resubscribe-submit').click();
    await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
      'data-out',
      'false',
    );
  } finally {
    await anonima.close();
  }

  // ── A contagem voltou, e o DISPARO alcança de novo ──────────────────────────
  await page.goto(
    segmentosPath(
      `&segmento=1&evento=${eventId}&c0=inscrito-na-atividade&p0_atividade=${activityId}`,
    ),
  );

  await expect(page.getByTestId('segment-count')).toHaveText('2');
  await expect(page.getByTestId('segment-people-empty')).toHaveCount(0);
  await expect(page.getByTestId('segment-unsubscribed')).toHaveCount(0);

  await page.getByLabel('Assunto').fill('Voltamos a falar');
  await page.getByLabel('Corpo da mensagem').fill('Este é o recado para quem tinha saído da lista.');
  await page.getByTestId('segment-count-submit').click();
  await page.getByTestId('segment-review-submit').click();
  await page.getByTestId('campaign-dispatch-submit').click();

  await expect(page.getByTestId('campaign-send-feedback')).toHaveAttribute('data-ok', 'true');

  const campanha = await e2eDb.communicationCampaign.findFirstOrThrow({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  const mensagens = await e2eDb.emailMessage.findMany({
    where: { tenantId, dedupeKey: { startsWith: `campaign:${campanha.id}:` } },
    select: { toUserId: true },
  });

  expect(mensagens).toHaveLength(2);
  expect(mensagens.some((row) => row.toUserId === sai.id)).toBe(true);
});
});

/**
 * O endereço de descadastro de alguém — derivado pelo SERVIÇO, e não garimpado de
 * uma linha do outbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ENDEREÇO NÃO É EXTRAÍDO DE UMA CAMPANHA ANTIGA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão deste helper procurava a última mensagem de campanha da pessoa
 *  e lia o endereço do rodapé dela. **Ele reprovou por vacuidade**: quando os testes
 *  rodam fora de ordem (e o Playwright não garante ordem entre `test()`), a pessoa
 *  ainda não tinha recebido campanha nenhuma, e o teste morria em "nenhum registro
 *  encontrado" — um erro de fixture disfarçado de defeito de produto.
 *
 *  O token é DETERMINÍSTICO por (instituição, pessoa), então o endereço pode ser
 *  montado a qualquer momento. E a prova de que ele é o MESMO que o rodapé levou
 *  continua existindo, no caso 1: o endereço lido do e-mail e o derivado aqui são
 *  comparados.
 */
function enderecoDe(userId: string): string {
  const url = unsubscribeUrlFor({ tenantSlug, tenantId, userId });

  if (!url) throw new Error('Não foi possível derivar o endereço de descadastro.');

  return url;
}

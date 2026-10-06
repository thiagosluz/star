import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';
import { favoriteActivity } from '../../src/lib/events/agenda-service';
import { ROOM_TRAVEL_MARGIN_MINUTES } from '../../src/domain/agenda/overlap-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — FAVORITAR e a tela "MINHA AGENDA" (FASE 65 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, EM CINCO CENÁRIOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  (a) **Favoritar e desfavoritar SEM JavaScript**, voltando para a MESMA página —
 *      o formulário é HTML de verdade e o POST acontece na submissão nativa;
 *  (b) **o favorito sobrevive ao reload** (a marca é do banco, não da tela);
 *  (c) **o choque AVISA e GRAVA**: com duas atividades sobrepostas, a segunda é
 *      marcada mesmo assim — a prova é a linha no banco e o `aria-pressed` virando
 *      `true` na MESMA página que mostra o aviso;
 *  (d) **"minha agenda" mostra as DUAS marcas** (uma inscrição e um favorito) e o
 *      resumo de choques com os dois títulos e o horário;
 *  (e) **a grade de OUTRA pessoa não aparece** — provado nos dois sentidos: a dona vê
 *      a dela, a outra pessoa não vê nada dela (negativa só depois da positiva).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE TODOS OS CENÁRIOS RODAM SEM JAVASCRIPT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O requisito da fatia é "funciona sem JavaScript", e `javaScriptEnabled: false` é a
 *  medida EXTREMA dele: sem bundle nenhum, o clique só pode virar POST se o `<form>`
 *  for um formulário de verdade. De quebra, some a armadilha que a suíte já mediu (a
 *  dívida E76: com o JavaScript ligado e o bundle ainda carregando, o React absorve o
 *  submit para reexecutá-lo depois da hidratação) — aqui não há hidratação nenhuma
 *  para engolir gesto, e o teste mede o que interessa, sem corrida.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CADA CASO CRIA A PRÓPRIA PESSOA (a regra de independência da casa)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As ATIVIDADES são leitura (o choque é uma propriedade do horário delas) e podem ser
 *  compartilhadas. O que NÃO se compartilha é o que cada caso ESCREVE: favorito e
 *  inscrição são de quem os criou, e cada caso assina a sua própria conta — nenhum
 *  caso lê o que o anterior deixou, e nenhum depende da ordem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f65-agenda';
const DIA = 86_400_000;

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;

/** O minicurso LONGO (13:00–17:00 UTC) — contém a palestra. */
let longaId: string;
/** A palestra DENTRO do minicurso (14:00–15:00 UTC). */
let internaId: string;
/** A mesa do fim do dia (18:00–19:00 UTC) — sem choque com ninguém. */
let mesaId: string;
/** A oficina da manhã (09:00–10:00 UTC) — o item da OUTRA pessoa no caso (e). */
let oficinaId: string;
/** A roda de conversa (20:00–21:00 UTC) — a inscrição da dona no caso (e). */
let rodaId: string;
/** A oficina da tarde (21:00–22:00 UTC) — a margem de deslocamento, caso (f). */
let margemPrimeiraId: string;
/** A palestra que começa QUANDO a primeira termina (22:00–23:00 UTC). */
let margemSegundaId: string;
/** A mesa que só começa uma hora depois (23:00–00:00 UTC) — fora da margem. */
let margemTerceiraId: string;

const TITULO_LONGA = `Minicurso de robótica educacional ${RUN_ID}`;
const TITULO_INTERNA = `Palestra sobre drones autônomos ${RUN_ID}`;
const TITULO_MESA = `Mesa-redonda de encerramento ${RUN_ID}`;
const TITULO_OFICINA = `Oficina de cerâmica ${RUN_ID}`;
const TITULO_RODA = `Roda de conversa ${RUN_ID}`;
const TITULO_MARGEM_PRIMEIRA = `Oficina de marcenaria ${RUN_ID}`;
const TITULO_MARGEM_SEGUNDA = `Palestra sobre clima ${RUN_ID}`;
const TITULO_MARGEM_TERCEIRA = `Mesa de tecnologia ${RUN_ID}`;

/**
 * O TEXTO DO AVISO DE DESLOCAMENTO (E86 · FASE 69).
 *
 * O número sai da CONSTANTE do domínio, e não de um "15" digitado aqui: o que este
 * arquivo prende é que a tela diz que existe margem, com o número que a régua usa.
 */
const AVISO_DE_DESLOCAMENTO = `Horários próximos demais para o deslocamento (margem de ${ROOM_TRAVEL_MARGIN_MINUTES} minutos)`;

/**
 * A hora FIXA do dia do evento.
 *
 * O choque é decidido por INSTANTE, e o instante é o dado do cenário — por isso as
 * atividades não nascem de "daqui a N horas" (o deslocamento relativo mudaria a
 * sobreposição conforme a hora em que a suíte roda). A base é o dia do evento e a hora
 * é ditada aqui.
 */
function naHora(horaUtc: number): Date {
  const instante = new Date(Date.now() + 3 * DIA);
  instante.setUTCHours(horaUtc, 0, 0, 0);
  return instante;
}

/** O rótulo no fuso do EVENTO — a MESMA régua que o domínio usa (`formatZonedDateTime`). */
function rotuloNoEvento(instante: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Bahia',
  }).format(instante);
}

const eventoUrl = (): string => `/t/${tenantSlug}/eventos/${eventSlug}`;
const minhaAgendaUrl = (): string => `/t/${tenantSlug}/minha-agenda?evento=${eventId}`;

async function criarAtividade(input: {
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  workloadMinutes: number;
}): Promise<string> {
  const id = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.activity.create({
      data: {
        id,
        tenantId,
        eventId,
        slug: input.slug,
        title: input.title,
        description: 'Atividade criada para o E2E da agenda pessoal.',
        type: 'LECTURE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        workloadMinutes: input.workloadMinutes,
        capacity: 30,
        waitlistEnabled: false,
        confirmedCount: 0,
        waitlistCount: 0,
        requiresRegistration: true,
      },
    });
  });

  return id;
}

test.beforeAll(async () => {
  const tenant = await createTenant({ label: TENANT_LABEL, name: `Instituição da Agenda ${RUN_ID}` });

  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const evento = await createEvent({
    tenantId,
    slug: `f65-evento-${RUN_ID}`,
    title: `Congresso da Agenda ${RUN_ID}`,
    status: 'REGISTRATION_OPEN',
    capacity: null,
  });

  eventId = evento.id;
  eventSlug = evento.slug;

  longaId = await criarAtividade({
    slug: `f65-longa-${RUN_ID}`,
    title: TITULO_LONGA,
    startsAt: naHora(13),
    endsAt: naHora(17),
    workloadMinutes: 240,
  });

  internaId = await criarAtividade({
    slug: `f65-interna-${RUN_ID}`,
    title: TITULO_INTERNA,
    startsAt: naHora(14),
    endsAt: naHora(15),
    workloadMinutes: 60,
  });

  mesaId = await criarAtividade({
    slug: `f65-mesa-${RUN_ID}`,
    title: TITULO_MESA,
    startsAt: naHora(18),
    endsAt: naHora(19),
    workloadMinutes: 60,
  });

  oficinaId = await criarAtividade({
    slug: `f65-oficina-${RUN_ID}`,
    title: TITULO_OFICINA,
    startsAt: naHora(9),
    endsAt: naHora(10),
    workloadMinutes: 60,
  });

  rodaId = await criarAtividade({
    slug: `f65-roda-${RUN_ID}`,
    title: TITULO_RODA,
    startsAt: naHora(20),
    endsAt: naHora(21),
    workloadMinutes: 60,
  });

  /**
   * ── AS TRÊS ATIVIDADES DA MARGEM (E86 · FASE 69) ──────────────────────────────
   *
   *  Encostadas de propósito: a palestra começa no MESMO minuto em que a oficina
   *  termina (22:00), e a mesa só entra uma hora depois (23:00). Nenhum dos dois
   *  pares se SOBREPÕE — o que os separa é o deslocamento, e é isso que a tela
   *  precisa explicar.
   */
  margemPrimeiraId = await criarAtividade({
    slug: `f65-margem-primeira-${RUN_ID}`,
    title: TITULO_MARGEM_PRIMEIRA,
    startsAt: naHora(21),
    endsAt: naHora(22),
    workloadMinutes: 60,
  });

  margemSegundaId = await criarAtividade({
    slug: `f65-margem-segunda-${RUN_ID}`,
    title: TITULO_MARGEM_SEGUNDA,
    startsAt: naHora(22),
    endsAt: naHora(23),
    workloadMinutes: 60,
  });

  margemTerceiraId = await criarAtividade({
    slug: `f65-margem-terceira-${RUN_ID}`,
    title: TITULO_MARGEM_TERCEIRA,
    startsAt: naHora(23),
    endsAt: naHora(0),
    workloadMinutes: 60,
  });
});

test.afterAll(async () => {
  /**
   * A instituição é dona de tudo o que este arquivo criou (evento, atividades,
   * inscrições e favoritos caem em cascata); as PESSOAS saem pela janela do
   * `cleanupRun`, como manda a regra da casa.
   */
  if (tenantId) await e2eDb.tenant.deleteMany({ where: { id: tenantId } });

  await cleanupRun();
  await e2eDb.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
//  Utilitários do arquivo
// ───────────────────────────────────────────────────────────────────────────────
interface Pessoa {
  id: string;
  email: string;
}

/** Assina, vincula e dá o papel de participante: a pessoa da vez. */
async function criarPessoa(request: APIRequestContext, nome: string): Promise<Pessoa> {
  const email = uniqueEmail('f65');

  const response = await request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name: nome, email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  await linkUser({ tenantId, userId: user.id, kind: 'PARTICIPANT' });
  await grantRole({ tenantId, userId: user.id, role: 'PARTICIPANT', scope: 'TENANT' });

  return { id: user.id, email };
}

/** Entra com a pessoa — pelo MESMO endpoint do formulário de login. */
async function entrar(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * Um contexto SEM JavaScript, com a pessoa já dentro.
 *
 * O contexto é sempre fechado por quem o abriu (`contexto.close()`), como o resto da
 * suíte faz — navegador aberto é navegador que polui a próxima medição.
 */
async function semJavaScript(
  browser: Browser,
  pessoa: Pessoa,
): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await browser.newContext({ javaScriptEnabled: false });
  const page = await contexto.newPage();

  await entrar(page, pessoa.email);

  return { contexto, page };
}

/** Uma inscrição CONFIRMADA da pessoa (o caminho da tela é da fatia irmã, não desta). */
async function inscrever(pessoa: Pessoa, activityId: string): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId,
        userId: pessoa.id,
        status: 'CONFIRMED',
      },
    });
  });
}

/** A linha de favorito existe no banco? — a prova de que o POST chegou e gravou. */
async function temFavorito(userId: string, activityId: string): Promise<boolean> {
  const linha = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.activityFavorite.findFirst({ where: { userId, activityId }, select: { id: true } });
  });

  return linha !== null;
}

/** Submete o formulário de favoritar/desfavoritar (sem JS, é navegação de verdade). */
async function submitir(page: Page, activityId: string): Promise<void> {
  await page.getByTestId(`agenda-favoritar-${activityId}`).click();
  await page.waitForLoadState('load');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  (a) SEM JAVASCRIPT
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(a) favoritar e desfavoritar sem JavaScript', () => {
  test('marca, volta para a MESMA página e desmarca', async ({ browser, request }) => {
    const pessoa = await criarPessoa(request, `Participante sem JS ${RUN_ID}`);
    const { contexto, page } = await semJavaScript(browser, pessoa);

    try {
      await page.goto(eventoUrl());

      const botao = page.getByTestId(`agenda-favoritar-${internaId}`);

      /**
       * O NOME ACESSÍVEL DIZ A AÇÃO **E** O ALVO — e o TEXTO VISÍVEL está contido nele
       * (o que mantém o comando de voz funcionando, WCAG 2.5.3).
       */
      await expect(botao).toHaveAttribute('aria-pressed', 'false');
      await expect(botao).toHaveAccessibleName(`Adicionar à minha agenda: ${TITULO_INTERNA}`);
      await expect(botao).toContainText('Adicionar à minha agenda');

      await submitir(page, internaId);

      /**
       * ── O CAMINHO DE VOLTA É A MESMA PÁGINA ──────────────────────────────────
       *
       *  Sem JavaScript, marcar é um POST que devolve a página inteira. O destino é
       *  DERIVADO (instituição + evento), e não recebido do formulário — e o
       *  `#atividade-<id>` faz a pessoa cair no cartão que ela acabou de marcar.
       */
      const depois = new URL(page.url());

      expect(depois.pathname).toBe(eventoUrl());
      expect(depois.searchParams.get('agenda')).toBe(internaId);
      expect(depois.hash).toBe(`#atividade-${internaId}`);

      const marcado = page.getByTestId(`agenda-favoritar-${internaId}`);

      await expect(marcado).toHaveAttribute('aria-pressed', 'true');
      await expect(marcado).toHaveAccessibleName(`Remover da minha agenda: ${TITULO_INTERNA}`);
      await expect(page.getByTestId(`marcas-${internaId}`)).toContainText('Favorito');
      await expect(page.getByTestId(`agenda-confirmacao-${internaId}`)).toContainText(
        'Adicionada à sua agenda',
      );
      await expect.poll(() => temFavorito(pessoa.id, internaId), { timeout: 15_000 }).toBe(true);

      /** A marca é da ATIVIDADE marcada: a mesa, que ninguém tocou, segue sem distintivo. */
      await expect(page.getByTestId(`marcas-${mesaId}`)).toHaveCount(0);

      /** E DESMARCAR também é um POST de formulário — o mesmo caminho, ao contrário. */
      await submitir(page, internaId);

      await expect(page.getByTestId(`agenda-favoritar-${internaId}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(page.getByTestId(`marcas-${internaId}`)).toHaveCount(0);
      await expect.poll(() => temFavorito(pessoa.id, internaId), { timeout: 15_000 }).toBe(false);
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (b) O FAVORITO SOBREVIVE AO RELOAD
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(b) o favorito é do banco, não da tela', () => {
  test('a marca continua depois de recarregar a página', async ({ browser, request }) => {
    const pessoa = await criarPessoa(request, `Participante do reload ${RUN_ID}`);
    const { contexto, page } = await semJavaScript(browser, pessoa);

    try {
      await page.goto(eventoUrl());
      await submitir(page, internaId);

      await expect(page.getByTestId(`marcas-${internaId}`)).toContainText('Favorito');

      await page.reload();

      await expect(page.getByTestId(`agenda-favoritar-${internaId}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByTestId(`marcas-${internaId}`)).toContainText('Favorito');

      /** E a linha está no banco: a marca é leitura, não estado de navegador. */
      await expect.poll(() => temFavorito(pessoa.id, internaId), { timeout: 15_000 }).toBe(true);
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (c) O CHOQUE AVISA E NÃO BLOQUEIA
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(c) o choque avisa e grava mesmo assim', () => {
  test('a segunda atividade sobreposta é marcada COM o aviso na tela', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Participante do choque ${RUN_ID}`);
    const { contexto, page } = await semJavaScript(browser, pessoa);

    try {
      await page.goto(eventoUrl());

      /** 1) O minicurso primeiro — sozinho, ele não choca com nada. */
      await expect(page.getByTestId(`choque-${longaId}`)).toHaveCount(0);
      await submitir(page, longaId);

      await expect(page.getByTestId(`agenda-favoritar-${longaId}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      /**
       * ── 2) O AVISO APARECE NA ESCOLHA, ANTES DO CLIQUE ────────────────────────
       *
       *  A palestra cai DENTRO do minicurso: o cartão dela já diz com quem disputa o
       *  horário, com o título e o horário do outro lado. Quem decide é a pessoa — e
       *  ela decide informada, não depois de o sistema gravar.
       */
      const aviso = page.getByTestId(`choque-${internaId}`);

      await expect(aviso).toBeVisible();
      /**
       * ── O AVISO DIZ QUE HÁ MARGEM DE DESLOCAMENTO (E86 · FASE 69) ─────────────
       *
       *  Aqui os dois itens se SOBREPÕEM, e mesmo assim o texto é o novo: o aviso é
       *  UM só, e a frase que explica o motivo (deslocamento, com o número de minutos)
       *  serve aos dois casos. Dizer "choque de horário" só neste seria a mesma tela
       *  com dois nomes para a mesma coisa.
       *
       *  O texto ANTIGO não existe mais — e o caso abaixo prende isso: um aviso que
       *  ainda dissesse "choque de horário" mandaria quem lê comparar dois relógios
       *  que não se cruzam no caso do deslocamento puro (o cenário (f)).
       */
      await expect(aviso).not.toContainText('Choque de horário');
      await expect(aviso).toContainText(AVISO_DE_DESLOCAMENTO);
      await expect(aviso).toContainText(TITULO_LONGA);
      await expect(aviso).toContainText(rotuloNoEvento(naHora(13)));
      await expect(aviso).toContainText('Você escolhe qual assistir');

      /** 3) E MARCA MESMO ASSIM — a agenda não bloqueia a decisão de ninguém. */
      await submitir(page, internaId);

      await expect(page.getByTestId(`agenda-favoritar-${internaId}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByTestId(`marcas-${internaId}`)).toContainText('Favorito');

      /** A prova mais dura: a linha existe no banco. */
      await expect.poll(() => temFavorito(pessoa.id, internaId), { timeout: 15_000 }).toBe(true);

      /** 4) O aviso CONTINUA (o fato não deixou de ser verdade) e os dois lados o mostram. */
      await expect(page.getByTestId(`choque-${internaId}`)).toContainText(TITULO_LONGA);
      await expect(page.getByTestId(`choque-${longaId}`)).toContainText(TITULO_INTERNA);

      /**
       * 5) FAVORITAR NÃO CONSOME VAGA: o contador de inscritos da atividade continua
       * zero — a marca é intenção, e a vaga é da inscrição (fatia irmã).
       */
      await expect(page.locator(`#atividade-${internaId}`)).toContainText('0/30 inscritos');
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (d) A TELA "MINHA AGENDA"
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(d) minha agenda — as duas marcas e o resumo de choques', () => {
  test('mostra a inscrição, o favorito e o par em choque', async ({ browser, request }) => {
    const pessoa = await criarPessoa(request, `Participante da grade ${RUN_ID}`);
    const { contexto, page } = await semJavaScript(browser, pessoa);

    try {
      /** A inscrição na palestra INTERNA (a que cai dentro do minicurso favoritado). */
      await inscrever(pessoa, internaId);

      /** E o favorito no minicurso, pelo caminho da TELA (o clique de verdade). */
      await page.goto(eventoUrl());
      await submitir(page, longaId);

      /**
       * ── AS MARCAS DISTINTAS NA PROGRAMAÇÃO ────────────────────────────────────
       *
       *  O item que a pessoa marcou e o item em que ela se inscreveu se anunciam de
       *  formas diferentes, com ícone e texto — nada aqui depende de cor.
       */
      await expect(page.getByTestId(`marcas-${longaId}`)).toContainText('Favorito');
      await expect(page.getByTestId(`marcas-${internaId}`)).toContainText('Inscrito');

      await page.goto(minhaAgendaUrl());

      /** Um `<main>` só: o mesmo portão de landmark das outras telas. */
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1, name: 'Minha agenda' })).toBeVisible();

      const itemDoFavorito = page.getByTestId(`agenda-item-${longaId}`);
      const itemDaInscricao = page.getByTestId(`agenda-item-${internaId}`);

      await expect(itemDoFavorito).toHaveAttribute('data-mark', 'FAVORITO');
      await expect(itemDoFavorito.getByTestId('marca-favorito')).toBeVisible();
      await expect(itemDoFavorito.getByTestId('marca-inscrito')).toHaveCount(0);

      await expect(itemDaInscricao).toHaveAttribute('data-mark', 'INSCRITO');
      await expect(itemDaInscricao.getByTestId('marca-inscrito')).toBeVisible();
      await expect(itemDaInscricao.getByTestId('marca-favorito')).toHaveCount(0);

      /** O link para a atividade é o caminho de volta para a página dela. */
      await expect(itemDaInscricao.getByRole('link', { name: 'Ver atividade' })).toHaveAttribute(
        'href',
        `/t/${tenantSlug}/eventos/${eventSlug}/atividades/f65-interna-${RUN_ID}`,
      );

      /** ── O RESUMO ────────────────────────────────────────────────────────── */
      await expect(page.getByTestId('resumo-itens')).toHaveText('2');
      await expect(page.getByTestId('resumo-inscritas')).toHaveText('1');
      await expect(page.getByTestId('resumo-favoritas')).toHaveText('1');
      await expect(page.getByTestId('resumo-choques')).toHaveText('1');

      /** ── OS CHOQUES, COM OS DOIS TÍTULOS E O HORÁRIO ─────────────────────── */
      const secaoDeChoques = page.getByTestId('minha-agenda-choques-secao');

      await expect(secaoDeChoques).toBeVisible();

      const choques = page.getByTestId('minha-agenda-choques');

      await expect(choques).toBeVisible();
      await expect(choques).toContainText(TITULO_LONGA);
      await expect(choques).toContainText(TITULO_INTERNA);
      await expect(choques).toContainText(rotuloNoEvento(naHora(13)));
      await expect(choques).toContainText(rotuloNoEvento(naHora(15)));
      await expect(secaoDeChoques).toContainText('A escolha é sua');

      /**
       * ── E DESMARCAR DA PRÓPRIA GRADE ──────────────────────────────────────────
       *
       *  O outro sentido do caminho de volta: marcado a partir de "minha agenda", o
       *  POST volta para ESTA tela, com o evento no `?evento=` (a agenda é por evento)
       *  e a atividade no `#atividade-`. É o mesmo formulário e a mesma ação — o que
       *  muda é a origem, e é ela que decide o destino.
       */
      await submitir(page, longaId);

      const depoisDeRemover = new URL(page.url());

      expect(depoisDeRemover.pathname).toBe(`/t/${tenantSlug}/minha-agenda`);
      expect(depoisDeRemover.searchParams.get('evento')).toBe(eventId);
      expect(depoisDeRemover.searchParams.get('agenda')).toBe(longaId);
      expect(depoisDeRemover.hash).toBe(`#atividade-${longaId}`);

      await expect(page.getByTestId(`agenda-item-${longaId}`)).toHaveCount(0);
      await expect(page.getByTestId(`agenda-item-${internaId}`)).toHaveAttribute(
        'data-mark',
        'INSCRITO',
      );

      /** O choque sumiu com o favorito: não há mais par disputando o horário. */
      await expect(page.getByTestId('resumo-itens')).toHaveText('1');
      await expect(page.getByTestId('resumo-favoritas')).toHaveText('0');
      await expect(page.getByTestId('resumo-choques')).toHaveText('0');
      await expect(page.getByTestId('minha-agenda-choques-secao')).toHaveCount(0);
      await expect.poll(() => temFavorito(pessoa.id, longaId), { timeout: 15_000 }).toBe(false);
    } finally {
      await contexto.close();
    }
  });

  test('sem nada marcado, a tela explica como marcar (estado vazio)', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Participante sem nada ${RUN_ID}`);
    const { contexto, page } = await semJavaScript(browser, pessoa);

    try {
      /**
       * E O CAMINHO DE QUEM CHEGA PELO PAINEL: a tela irmã ("Minhas inscrições") leva
       * à agenda com um clique — sem JavaScript, é um link de verdade.
       */
      await page.goto(`/t/${tenantSlug}/minhas-inscricoes`);
      await page.getByTestId('minha-agenda-link').click();
      await page.waitForLoadState('load');

      expect(new URL(page.url()).pathname).toBe(`/t/${tenantSlug}/minha-agenda`);

      await expect(page.getByRole('heading', { level: 1, name: 'Minha agenda' })).toBeVisible();
      await expect(page.getByText('Adicionar à minha agenda')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Ver eventos disponíveis' })).toBeVisible();
      await expect(page.getByTestId('minha-agenda')).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (f) A MARGEM DE DESLOCAMENTO ENTRE SALAS (E86 · FASE 69 · fatia 1)
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(f) o aviso de deslocamento entre salas', () => {
  test('avisa quem começa quando a outra termina e cala quem tem folga', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Participante do deslocamento ${RUN_ID}`);
    const { contexto, page } = await semJavaScript(browser, pessoa);

    try {
      await page.goto(eventoUrl());

      /** 1) A oficina primeiro — sozinha, ela não conflita com nada. */
      await expect(page.getByTestId(`choque-${margemPrimeiraId}`)).toHaveCount(0);
      await submitir(page, margemPrimeiraId);

      /**
       * ── 2) A PALESTRA QUE ENCOSTA: NENHUM HORÁRIO SE CRUZA, E O AVISO EXISTE ──
       *
       *  Antes da margem este cartão ficava mudo (o fim de uma é o início da outra, e
       *  `intervalosSeSobrepoem` responde `false`). É o caso real da dívida: dá para
       *  estar nas duas na teoria e em nenhuma na prática.
       */
      const aviso = page.getByTestId(`choque-${margemSegundaId}`);

      await expect(aviso).toBeVisible();
      await expect(aviso).toContainText(AVISO_DE_DESLOCAMENTO);
      await expect(aviso).toContainText(TITULO_MARGEM_PRIMEIRA);
      await expect(aviso).toContainText(rotuloNoEvento(naHora(21)));

      /** 3) E MARCA MESMO ASSIM: o aviso informa, não bloqueia. */
      await submitir(page, margemSegundaId);

      await expect(page.getByTestId(`agenda-favoritar-${margemSegundaId}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect.poll(() => temFavorito(pessoa.id, margemSegundaId), { timeout: 15_000 }).toBe(true);

      /** O aviso CONTINUA — o fato não deixou de ser verdade depois do clique. */
      await expect(page.getByTestId(`choque-${margemSegundaId}`)).toContainText(
        TITULO_MARGEM_PRIMEIRA,
      );

      /**
       * ── 4) A MESA UMA HORA DEPOIS: SILÊNCIO ────────────────────────────────────
       *
       *  A folga (60 min) é MAIOR que a margem (15 min), então quem atravessa o campus
       *  chega. Sem esta metade, "avisar sempre" passaria no teste — e aviso que
       *  aparece em todo par é o mesmo que aviso nenhum.
       */
      await expect(page.getByTestId(`choque-${margemTerceiraId}`)).toHaveCount(0);

      await submitir(page, margemTerceiraId);

      await expect(page.getByTestId(`choque-${margemTerceiraId}`)).toHaveCount(0);
      await expect(page.getByTestId(`choque-${margemSegundaId}`)).toBeVisible();
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (e) A GRADE DE OUTRA PESSOA NÃO APARECE
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(e) a agenda é de quem está na sessão', () => {
  test('a grade de uma pessoa não aparece na tela de outra', async ({ browser, request }) => {
    const dona = await criarPessoa(request, `Dona da grade ${RUN_ID}`);
    const outra = await criarPessoa(request, `Outra pessoa ${RUN_ID}`);

    /**
     * As duas marcas da Dona são criadas pelo SERVIÇO REAL (a fatia 1) — é o mesmo
     * caminho que o clique usa, e aqui o assunto não é o clique.
     */
    expect(
      await favoriteActivity({ tenantId, userId: dona.id, activityId: longaId }),
    ).toMatchObject({ ok: true });

    await inscrever(dona, rodaId);
    expect(
      await favoriteActivity({ tenantId, userId: outra.id, activityId: oficinaId }),
    ).toMatchObject({ ok: true });

    const primeiraDona = await semJavaScript(browser, dona);

    try {
      /** POSITIVA PRIMEIRO: a agenda da dona mostra o que é DELA. */
      await primeiraDona.page.goto(minhaAgendaUrl());

      await expect(primeiraDona.page.getByTestId(`agenda-item-${longaId}`)).toBeVisible();
      await expect(primeiraDona.page.getByTestId(`agenda-item-${rodaId}`)).toBeVisible();
      await expect(primeiraDona.page.getByTestId('resumo-itens')).toHaveText('2');
    } finally {
      await primeiraDona.contexto.close();
    }

    const segundaOutra = await semJavaScript(browser, outra);

    try {
      /** E ENTÃO A NEGATIVA: a outra pessoa vê a agenda DELA, e nada da dona. */
      await segundaOutra.page.goto(minhaAgendaUrl());

      await expect(segundaOutra.page.getByTestId(`agenda-item-${oficinaId}`)).toBeVisible();
      await expect(segundaOutra.page.getByTestId('resumo-itens')).toHaveText('1');

      await expect(segundaOutra.page.getByTestId(`agenda-item-${longaId}`)).toHaveCount(0);
      await expect(segundaOutra.page.getByTestId(`agenda-item-${internaId}`)).toHaveCount(0);
      await expect(segundaOutra.page.locator('main')).not.toContainText(TITULO_LONGA);
      await expect(segundaOutra.page.locator('main')).not.toContainText(TITULO_INTERNA);
      await expect(segundaOutra.page.getByTestId('minha-agenda-choques')).toHaveCount(0);
    } finally {
      await segundaOutra.contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  O caminho de quem NÃO tem sessão (a tela é de quem está logado)
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('a ausência de sessão', () => {
  test('leva ao login com o destino preservado, como a tela irmã', async ({ browser }) => {
    const contexto = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();

    try {
      const resposta = await page.goto(`/t/${tenantSlug}/minha-agenda`);

      expect(resposta?.status()).toBe(200);
      await expect(page).toHaveURL(/\/login\?redirectTo=/);

      /**
       * Quem responde primeiro ao visitante anônimo é o LAYOUT de instituição (o ponto
       * de autorização real), com o destino padrão do painel — exatamente o mesmo
       * comportamento de `/minhas-inscricoes`. A guarda DENTRO da página cobre a outra
       * metade do caminho (a sessão que cai entre a leitura do layout e a da página), e
       * por isso ela devolve o endereço desta tela.
       */
      const destino = new URL(page.url()).searchParams.get('redirectTo');
      expect(destino).toBe(`/t/${tenantSlug}/dashboard`);
    } finally {
      await contexto.close();
    }
  });
});

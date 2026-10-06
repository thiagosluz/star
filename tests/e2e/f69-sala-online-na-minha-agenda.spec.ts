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
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A SALA ONLINE NA "MINHA AGENDA" (FASE 69 · os quatro pontos da F68)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA FATIA CONSERTOU, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O endereço da sala online existia na página do evento e na página da atividade — e
 *  FALTAVA na tela que a pessoa abre cinco minutos antes da sessão. A correção reusa a
 *  régua e o serviço da FASE 68 (`online-room-rules.ts` + `online-room-service.ts`), e
 *  é isso que este arquivo prova: **não há uma segunda régua aqui**, há a mesma, sobre
 *  outra projeção.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PROVA É NO `page.content()`, E NÃO NO `toBeHidden()`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `toBeHidden()` passaria com o endereço dentro de um `hidden`, de um
 *  `style="display:none"` ou — o caso que importa — dentro do payload RSC que o Next
 *  embute nos `<script>` da página. As três coisas são vazamento: quem abrir o `Ctrl+U`
 *  lê o link. A asserção é sobre o DOCUMENTO INTEIRO, e ela é feita nos dois sentidos
 *  (contém para quem tem lugar, não contém para quem não tem): uma negativa que nunca
 *  pudesse ser positiva estaria medida por acidente.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS CINCO LADOS DA RÉGUA, TODOS AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • **confirmada na atividade** — vê a sala DA ATIVIDADE (e a do evento, se tiver
 *    lugar no evento);
 *  • **retendo vaga (`PENDING`, FASE 34)** — vê: a vaga é dela até o prazo vencer;
 *  • **lista de espera (`WAITLISTED`)** — NÃO vê, mesmo com o item na grade e a marca
 *    `Inscrito`: é o lado que separa esta régua de "está inscrito em alguma coisa";
 *  • **equipe do evento** — vê sem ter inscrição nenhuma (é quem monta a sala);
 *  • **anônimo** — não vê (a tela é de quem está logado, e o destino é o login).
 *
 *  E o caso que prende a régua POR ATIVIDADE: quem só FAVORITOU uma atividade ABERTA
 *  tem o item na grade e **não** recebe o endereço — favoritar é intenção, não lugar
 *  (a mesma fronteira que a FASE 65 fixou).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'senha-forte-e2e-f69';
const TENANT_LABEL = 'f69-agenda-sala';

const ENDERECO_EVENTO = 'https://sala.exemplo.test/transmissao-f69';
const ENDERECO_FECHADA = 'https://sala.exemplo.test/minicurso-fechado-f69';
const ENDERECO_ABERTA = 'https://sala.exemplo.test/palestra-aberta-f69';

let tenantId: string;
let tenantSlug: string;
let eventId: string;

/** A atividade que EXIGE inscrição própria — só quem tem lugar NELA vê a sala. */
let fechadaId: string;
/** A atividade ABERTA — quem tem lugar no EVENTO vê a sala dela (revisão da FASE 3). */
let abertaId: string;

const minhaAgendaUrl = (): string => `/t/${tenantSlug}/minha-agenda?evento=${eventId}`;

interface Pessoa {
  id: string;
  email: string;
}

/** Assina, vincula e concede o papel do público. */
async function criarPessoa(request: APIRequestContext, nome: string): Promise<Pessoa> {
  const email = uniqueEmail('f69agenda');

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

async function entrar(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);
}

/** Uma inscrição no banco: o ESTADO é o dado do cenário, não o caminho da tela. */
async function inscrever(input: {
  userId: string;
  status: 'PENDING' | 'CONFIRMED' | 'WAITLISTED';
  activityId?: string | null;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: input.status,
      },
    });
  });
}

/** O favorito pelo caminho do BANCO — aqui o assunto é a visibilidade, não o clique. */
async function favoritar(userId: string, activityId: string): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.activityFavorite.create({
      data: { id: randomUUID(), tenantId, activityId, userId },
    });
  });
}

test.beforeAll(async () => {
  const tenant = await createTenant({
    label: TENANT_LABEL,
    name: `Instituição da Agenda com Sala ${RUN_ID}`,
  });

  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const evento = await createEvent({
    tenantId,
    slug: `f69-agenda-sala-${RUN_ID}`,
    title: `Congresso transmitido ${RUN_ID}`,
    status: 'REGISTRATION_OPEN',
    capacity: null,
    onlineUrl: ENDERECO_EVENTO,
  });

  eventId = evento.id;

  const fechada = await createActivity({
    tenantId,
    eventId,
    slug: `f69-fechada-${RUN_ID}`,
    title: `Minicurso com sala própria ${RUN_ID}`,
    requiresRegistration: true,
    onlineUrl: ENDERECO_FECHADA,
  });

  fechadaId = fechada.id;

  const aberta = await createActivity({
    tenantId,
    eventId,
    slug: `f69-aberta-${RUN_ID}`,
    title: `Palestra aberta transmitida ${RUN_ID}`,
    requiresRegistration: false,
    onlineUrl: ENDERECO_ABERTA,
  });

  abertaId = aberta.id;
});

test.afterAll(async () => {
  if (tenantId) await e2eDb.tenant.deleteMany({ where: { id: tenantId } });

  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Um contexto com a pessoa dentro (ou anônimo, quando não há pessoa). */
async function abrir(
  browser: Browser,
  pessoa?: Pessoa,
): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();

  if (pessoa) await entrar(page, pessoa.email);

  return { contexto, page };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  (a) A POSITIVA — quem tem lugar vê, nas duas salas
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(a) quem tem lugar recebe o endereço na agenda', () => {
  test('a inscrição confirmada vê a sala da atividade e a do evento', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Confirmada ${RUN_ID}`);

    /** Inscrição NA ATIVIDADE (o lugar na sala dela) e NO EVENTO (a transmissão do dia). */
    await inscrever({ userId: pessoa.id, status: 'CONFIRMED', activityId: fechadaId });
    await inscrever({ userId: pessoa.id, status: 'CONFIRMED' });

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(minhaAgendaUrl());

      await expect(page.getByRole('heading', { level: 1, name: 'Minha agenda' })).toBeVisible();
      await expect(page.getByTestId(`agenda-item-${fechadaId}`)).toBeVisible();

      const salaDaAtividade = page.getByTestId(`minha-agenda-sala-online-${fechadaId}`);
      await expect(salaDaAtividade).toBeVisible();
      /** O `href` é o ENDEREÇO — um link com o endereço errado passaria por "existe". */
      await expect(salaDaAtividade).toHaveAttribute('href', ENDERECO_FECHADA);

      const salaDoEvento = page.getByTestId('minha-agenda-sala-online-evento');
      await expect(salaDoEvento).toBeVisible();
      await expect(salaDoEvento).toHaveAttribute('href', ENDERECO_EVENTO);

      /**
       * A POSITIVA DO MESMO `page.content()` QUE AS NEGATIVAS USAM. Sem ela, "o
       * endereço não está no HTML" poderia ser verdade por acidente (um texto escapado,
       * por exemplo) e as negativas ficariam verdes para sempre.
       */
      const conteudo = await page.content();
      expect(conteudo).toContain(ENDERECO_FECHADA);
      expect(conteudo).toContain(ENDERECO_EVENTO);
    } finally {
      await contexto.close();
    }
  });

  test('a inscrição que RETÉM vaga (PENDING) também vê — a vaga é dela até o prazo', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Retendo vaga ${RUN_ID}`);
    await inscrever({ userId: pessoa.id, status: 'PENDING', activityId: fechadaId });

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(minhaAgendaUrl());

      const sala = page.getByTestId(`minha-agenda-sala-online-${fechadaId}`);
      await expect(sala).toBeVisible();
      await expect(sala).toHaveAttribute('href', ENDERECO_FECHADA);
    } finally {
      await contexto.close();
    }
  });

  test('a EQUIPE do evento vê sem ter inscrição nenhuma — é quem monta a sala', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Equipe do evento ${RUN_ID}`);
    await grantRole({
      tenantId,
      userId: pessoa.id,
      role: 'ORGANIZER',
      scope: 'EVENT',
      eventId,
    });

    /** A agenda dela existe porque ela favoritou a atividade — e não por inscrição. */
    await favoritar(pessoa.id, fechadaId);

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(minhaAgendaUrl());

      const sala = page.getByTestId(`minha-agenda-sala-online-${fechadaId}`);
      await expect(sala).toBeVisible();
      await expect(sala).toHaveAttribute('href', ENDERECO_FECHADA);
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (b) A NEGATIVA — a lista de espera, na mesma tela e com o item na grade
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(b) quem NÃO tem lugar não recebe o endereço', () => {
  test('a lista de espera vê o item na agenda e nenhum endereço no documento', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Na espera ${RUN_ID}`);
    await inscrever({ userId: pessoa.id, status: 'WAITLISTED', activityId: fechadaId });

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(minhaAgendaUrl());

      /**
       * A SESSÃO E A GRADE ESTÃO VIVAS — é o que torna a negativa significativa. Sem
       * estas duas linhas, "não vê o endereço" poderia ser "não entrou" ou "a agenda
       * não tem o item", e o teste mediria outra coisa.
       */
      const item = page.getByTestId(`agenda-item-${fechadaId}`);
      await expect(item).toBeVisible();
      await expect(item).toContainText('Na lista de espera');
      await expect(item.getByTestId('marca-inscrito')).toBeVisible();

      await expect(page.getByTestId(`minha-agenda-sala-online-${fechadaId}`)).toHaveCount(0);
      await expect(page.getByTestId('minha-agenda-sala-online-evento')).toHaveCount(0);

      const conteudo = await page.content();
      expect(conteudo).not.toContain(ENDERECO_FECHADA);
      expect(conteudo).not.toContain(ENDERECO_EVENTO);
      expect(conteudo).not.toContain(ENDERECO_ABERTA);
    } finally {
      await contexto.close();
    }
  });

  test('favoritar uma atividade ABERTA não dá o endereço — favorito é intenção, não lugar', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `So favorito ${RUN_ID}`);
    await favoritar(pessoa.id, abertaId);

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(minhaAgendaUrl());

      const item = page.getByTestId(`agenda-item-${abertaId}`);
      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute('data-mark', 'FAVORITO');

      await expect(page.getByTestId(`minha-agenda-sala-online-${abertaId}`)).toHaveCount(0);

      const conteudo = await page.content();
      expect(conteudo).not.toContain(ENDERECO_ABERTA);
      expect(conteudo).not.toContain(ENDERECO_EVENTO);
    } finally {
      await contexto.close();
    }
  });

  test('o anônimo é levado ao login, e o endereço não está no documento', async ({ browser }) => {
    const { contexto, page } = await abrir(browser);

    try {
      await page.goto(minhaAgendaUrl());

      await expect(page).toHaveURL(/\/login\?redirectTo=/);

      const conteudo = await page.content();
      expect(conteudo).not.toContain(ENDERECO_FECHADA);
      expect(conteudo).not.toContain(ENDERECO_ABERTA);
      expect(conteudo).not.toContain(ENDERECO_EVENTO);
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (c) A ATIVIDADE ABERTA — o lugar vem da inscrição no EVENTO
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(c) a atividade aberta é liberada pela inscrição no evento', () => {
  test('com lugar no evento, o favorito na atividade aberta mostra a sala dela', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Inscrita no evento ${RUN_ID}`);

    await inscrever({ userId: pessoa.id, status: 'CONFIRMED' });
    await favoritar(pessoa.id, abertaId);

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(minhaAgendaUrl());

      const sala = page.getByTestId(`minha-agenda-sala-online-${abertaId}`);
      await expect(sala).toBeVisible();
      await expect(sala).toHaveAttribute('href', ENDERECO_ABERTA);

      /** A sala FECHADA continua fora: a inscrição no evento não abre aquele minicurso. */
      expect(await page.content()).not.toContain(ENDERECO_FECHADA);
    } finally {
      await contexto.close();
    }
  });
});

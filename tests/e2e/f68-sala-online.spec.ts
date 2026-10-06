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
  createEvent,
  createTenant,
  cleanupRun,
  e2eDb,
  grantRole,
  linkUser,
  RUN_ID,
  uniqueEmail,
} from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O ENDEREÇO DA SALA ONLINE E QUEM PODE VÊ-LO (FASE 68 · fatias 2 e 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, E POR QUE A PROVA É NO `page.content()`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A invariante da fase é "o endereço NÃO é renderizado para quem não tem lugar" —
 *  e "não renderizado" tem uma prova mais forte do que "não está visível": o
 *  endereço não pode estar no **HTML** da página. `expect(locator).toBeHidden()`
 *  passaria com o endereço no `hidden`, num `style="display:none"` ou dentro do
 *  payload RSC que o Next embute nos `<script>` da própria página — e as três coisas
 *  são vazamento: a primeira pessoa que abrir o `Ctrl+U` lê o link.
 *
 *  Por isso a asserção é `expect(await page.content()).not.toContain(ENDERECO)`: ela
 *  olha o documento INTEIRO, incluindo os dados serializados para o cliente. É essa
 *  medida que impede o endereço de viajar em props de Client Component (o caso do
 *  `HappeningNowView`, que é serializável) — se ele viajasse, estaria no HTML.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS TRÊS LADOS DA RÉGUA, TODOS NO MESMO ARQUIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • **anônimo** — não vê (era o vazamento: o bloco de LOCAL mostrava o endereço a
 *    qualquer visitante desde a primeira migração);
 *  • **lista de espera** — não vê, mesmo com sessão e inscrição viva: quem espera não
 *    tem lugar, e é o lado que separa esta régua de "está inscrito em algo";
 *  • **inscrição confirmada** — vê, e é essa a prova de que o mecanismo está vivo
 *    (negativa só depois da positiva, a regra da casa).
 *
 *  A prova positiva olha o `href` do link, e não só a presença do texto: um link
 *  desenhado com o endereço errado passaria por "existe".
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'senha-forte-e2e-f68';
const TENANT_LABEL = 'f68-sala';

const ENDERECO_EVENTO = 'https://sala.exemplo.test/transmissao-f68';
const ENDERECO_ATIVIDADE = 'https://sala.exemplo.test/minicurso-f68';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;
/** A atividade EM CURSO agora — é ela que a aba "Acontecendo agora" mostra. */
let emCursoId: string;

const eventoUrl = (): string => `/t/${tenantSlug}/eventos/${eventSlug}`;

interface Pessoa {
  id: string;
  email: string;
}

/** Assina, vincula como participante e concede o papel do público. */
async function criarPessoa(request: APIRequestContext, nome: string): Promise<Pessoa> {
  const email = uniqueEmail('f68sala');

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
  status: 'CONFIRMED' | 'WAITLISTED';
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

/** Uma atividade com horário EXPLÍCITO (o "agora" da aba é o instante real). */
async function criarAtividade(input: {
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  requiresRegistration: boolean;
  onlineUrl: string | null;
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
        description: 'Atividade criada para o E2E da sala online.',
        type: 'MINI_COURSE',
        status: 'SCHEDULED',
        modality: 'ONLINE',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        workloadMinutes: 60,
        capacity: 30,
        waitlistEnabled: false,
        confirmedCount: 0,
        waitlistCount: 0,
        requiresRegistration: input.requiresRegistration,
        onlineUrl: input.onlineUrl,
      },
    });
  });

  return id;
}

/**
 * A página do evento com a PROGRAMAÇÃO e o bloco de LOCAL (VENUE_MAP) publicados.
 *
 * Sem eles a página cai na composição padrão — Sobre + Programação — e o bloco que
 * guardava o vazamento nem seria renderizado: o teste mediria a ausência do endereço
 * porque o bloco não existe, e não porque a régua funcionou (a armadilha clássica de
 * "negativa sem positiva"). O `SCHEDULE` entra pelo mesmo motivo no outro lado: é ele
 * que desenha o CARTÃO DA ATIVIDADE, onde o endereço da atividade aparece.
 *
 * Uma página configurada SUBSTITUI a composição padrão (`hasConfiguredLayout`), então
 * os dois blocos precisam existir aqui — publicar só o `VENUE_MAP` deixaria a
 * programação de fora e a asserção do cartão mediria a ausência do bloco.
 */
async function publicarPaginaDoEvento(): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const page = await tx.eventPage.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        slug: 'principal',
        title: 'Página do evento',
        isHome: true,
        isPublished: true,
      },
    });

    await tx.pageBlock.create({
      data: {
        id: randomUUID(),
        tenantId,
        pageId: page.id,
        type: 'SCHEDULE',
        content: {},
        style: {},
        displayOrder: 0,
        isVisible: true,
      },
    });

    await tx.pageBlock.create({
      data: {
        id: randomUUID(),
        tenantId,
        pageId: page.id,
        type: 'VENUE_MAP',
        content: {},
        style: {},
        displayOrder: 1,
        isVisible: true,
      },
    });
  });
}

test.beforeAll(async () => {
  const tenant = await createTenant({ label: TENANT_LABEL, name: `Instituição da Sala ${RUN_ID}` });

  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const evento = await createEvent({
    tenantId,
    slug: `f68-sala-evento-${RUN_ID}`,
    title: `Congresso com transmissão ${RUN_ID}`,
    status: 'REGISTRATION_OPEN',
    capacity: null,
    /**
     * O evento começa ONTEM: a atividade em curso precisa caber na janela do evento
     * (`saveActivity` recusa atividade fora dela, e a fixture nasce pelo banco, mas a
     * incoerência apareceria na tela).
     */
    startsAtOffsetDays: -1,
    onlineUrl: ENDERECO_EVENTO,
  });

  eventId = evento.id;
  eventSlug = evento.slug;

  await publicarPaginaDoEvento();

  const agora = Date.now();

  /**
   * A atividade EM CURSO: começou há meia hora e termina daqui a meia hora. Ela é
   * ABERTA (`requiresRegistration: false`) de propósito: a inscrição no EVENTO dá
   * lugar nela — é o caminho que a régua aceita para atividade sem inscrição própria.
   */
  emCursoId = await criarAtividade({
    slug: `f68-em-curso-${RUN_ID}`,
    title: `Minicurso transmitido ao vivo ${RUN_ID}`,
    startsAt: new Date(agora - 30 * 60_000),
    endsAt: new Date(agora + 30 * 60_000),
    requiresRegistration: false,
    onlineUrl: ENDERECO_ATIVIDADE,
  });
});

test.afterAll(async () => {
  if (tenantId) await e2eDb.tenant.deleteMany({ where: { id: tenantId } });

  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Um contexto de navegador com a pessoa dentro (ou anônimo, quando não há pessoa). */
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
//  (a) O ANÔNIMO — o vazamento que a fatia 3 fechou
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(a) o visitante anônimo não recebe o endereço', () => {
  test('o endereço não está no HTML da página do evento nem no da aba "acontecendo agora"', async ({
    browser,
    request,
  }) => {
    const { contexto, page } = await abrir(browser);

    try {
      await page.goto(eventoUrl());

      /**
       * O bloco de LOCAL está renderizado (o endereço FÍSICO aparece) — sem isto, a
       * ausência do endereço online poderia ser só a ausência do bloco.
       */
      await expect(page.getByRole('heading', { name: 'Local' })).toBeVisible();
      await expect(page.getByTestId('evento-sala-online')).toHaveCount(0);

      const conteudo = await page.content();

      expect(conteudo).not.toContain(ENDERECO_EVENTO);
      expect(conteudo).not.toContain(ENDERECO_ATIVIDADE);

      /** E o cartão da atividade também não traz o endereço. */
      expect(conteudo).not.toContain(`atividade-sala-online-${emCursoId}`);

      await page.goto(`${eventoUrl()}?aba=agora`);

      await expect(page.getByTestId('agora')).toBeVisible();
      await expect(page.getByTestId(`agora-sala-online-${emCursoId}`)).toHaveCount(0);

      const conteudoDoAgora = await page.content();

      expect(conteudoDoAgora).not.toContain(ENDERECO_EVENTO);
      expect(conteudoDoAgora).not.toContain(ENDERECO_ATIVIDADE);

      /**
       * ─────────────────────────────────────────────────────────────────────────
       *  E O `.ics` TAMBÉM NÃO CARREGA O ENDEREÇO (a decisão da fase, presa)
       * ─────────────────────────────────────────────────────────────────────────
       *  O arquivo de UMA atividade é o MESMO para todo mundo e é público: se o
       *  endereço entrasse nele, a régua inteira cairia — ele é baixado por qualquer
       *  visitante e passaria a circular em calendários de terceiros. O convite para o
       *  calendário leva título, horário, sala e descrição, e o teste prende que o
       *  endereço NÃO está lá (o `.ics` da agenda pessoal tem teste próprio na FASE 65).
       */
      const ics = await request.get(
        `/api/t/${tenantSlug}/agenda/ics?atividade=${encodeURIComponent(emCursoId)}`,
      );

      expect(ics.ok(), await ics.text()).toBe(true);

      const corpo = await ics.text();

      expect(corpo).not.toContain(ENDERECO_EVENTO);
      expect(corpo).not.toContain(ENDERECO_ATIVIDADE);
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (b) A LISTA DE ESPERA — inscrição VIVA que NÃO dá lugar
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(b) quem está na lista de espera não recebe o endereço', () => {
  test('nem o do evento, nem o da atividade — com sessão e inscrição viva', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Na espera ${RUN_ID}`);
    await inscrever({ userId: pessoa.id, status: 'WAITLISTED' });

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(eventoUrl());

      /** A sessão está viva de verdade: o link do próprio crachá aparece na aba do agora. */
      await expect(page.getByRole('heading', { name: 'Local' })).toBeVisible();
      await expect(page.getByTestId('evento-sala-online')).toHaveCount(0);

      const conteudo = await page.content();
      expect(conteudo).not.toContain(ENDERECO_EVENTO);
      expect(conteudo).not.toContain(ENDERECO_ATIVIDADE);

      await page.goto(`${eventoUrl()}?aba=agora`);

      await expect(page.getByTestId('agora')).toBeVisible();
      /**
       * PROVA DE QUE A SESSÃO CHEGOU: o caminho do crachá só existe para quem tem
       * sessão (`authenticated`). Sem esta linha, "não vê o endereço" poderia ser
       * "não está logado" — e o teste estaria medindo a coisa errada.
       */
      await expect(page.getByTestId(`agora-cracha-${emCursoId}`)).toBeVisible();
      await expect(page.getByTestId(`agora-sala-online-${emCursoId}`)).toHaveCount(0);

      const conteudoDoAgora = await page.content();
      expect(conteudoDoAgora).not.toContain(ENDERECO_EVENTO);
      expect(conteudoDoAgora).not.toContain(ENDERECO_ATIVIDADE);
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (c) A INSCRIÇÃO CONFIRMADA — o outro lado, e a prova de que o mecanismo vive
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(c) quem tem inscrição confirmada recebe o endereço', () => {
  test('no bloco de LOCAL, no cartão da atividade e no cartão do "acontecendo agora"', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Inscrita confirmada ${RUN_ID}`);
    await inscrever({ userId: pessoa.id, status: 'CONFIRMED' });

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(eventoUrl());

      const linkDoEvento = page.getByTestId('evento-sala-online');
      await expect(linkDoEvento).toBeVisible();
      /** O `href` é o ENDEREÇO, e não um link qualquer que passaria por "existe". */
      await expect(linkDoEvento).toHaveAttribute('href', ENDERECO_EVENTO);

      const linkDaAtividade = page.getByTestId(`atividade-sala-online-${emCursoId}`);
      await expect(linkDaAtividade).toBeVisible();
      await expect(linkDaAtividade).toHaveAttribute('href', ENDERECO_ATIVIDADE);

      const conteudo = await page.content();
      expect(conteudo).toContain(ENDERECO_EVENTO);
      expect(conteudo).toContain(ENDERECO_ATIVIDADE);

      /** A aba do agora: o endereço da sala em que a atividade está acontecendo. */
      await page.goto(`${eventoUrl()}?aba=agora`);

      const linkDoAgora = page.getByTestId(`agora-sala-online-${emCursoId}`);
      await expect(linkDoAgora).toBeVisible();
      await expect(linkDoAgora).toHaveAttribute('href', ENDERECO_ATIVIDADE);

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  A POSITIVA DO MESMO `page.content()` QUE A NEGATIVA USA (caso (a))
       * ─────────────────────────────────────────────────────────────────────────────
       *  Sem esta linha, "o endereço não está no HTML" poderia ser verdade por acidente
       *  — um `page.content()` que nunca contivesse o endereço por outro motivo
       *  (um texto escapado, por exemplo) deixaria a negativa verde para sempre. Aqui,
       *  na MESMA aba e com a MESMA medida, o endereço está.
       *
       *  O endereço do EVENTO não aparece nesta aba de propósito: com `?aba=agora` os
       *  blocos da página não são renderizados (só a seção do agora), e é o cartão da
       *  atividade que leva a sala.
       */
      const conteudoDoAgora = await page.content();
      expect(conteudoDoAgora).toContain(ENDERECO_ATIVIDADE);
    } finally {
      await contexto.close();
    }
  });

  test('a página da atividade mostra a sala do minicurso para quem tem lugar', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Inscrita na atividade ${RUN_ID}`);

    /** Atividade FECHADA (inscrição própria): é a inscrição NELA que dá lugar. */
    const fechadaId = await criarAtividade({
      slug: `f68-fechada-${RUN_ID}`,
      title: `Oficina presencial transmitida ${RUN_ID}`,
      startsAt: new Date(Date.now() + 6 * 3_600_000),
      endsAt: new Date(Date.now() + 7 * 3_600_000),
      requiresRegistration: true,
      onlineUrl: 'https://sala.exemplo.test/oficina-f68',
    });

    await inscrever({ userId: pessoa.id, status: 'CONFIRMED', activityId: fechadaId });

    const { contexto, page } = await abrir(browser, pessoa);

    try {
      await page.goto(`${eventoUrl()}/atividades/f68-fechada-${RUN_ID}`);

      const link = page.getByTestId('atividade-sala-online');
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', 'https://sala.exemplo.test/oficina-f68');
    } finally {
      await contexto.close();
    }
  });
});

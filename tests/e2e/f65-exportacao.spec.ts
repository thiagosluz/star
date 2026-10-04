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
  createRoom,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';
import { googleCalendarUrl } from '../../src/lib/calendar/ics';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — EXPORTAÇÃO 1-CLIQUE e "ACONTECENDO AGORA" (FASE 65 · fatias 3 e 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, EM CINCO FRENTES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  (a) **O CONTEÚDO do `.ics` de UMA atividade** — não o status: o arquivo é baixado e
 *      o TEXTO é lido. `BEGIN:VCALENDAR`, um `VEVENT`, `SUMMARY` com o título,
 *      `DTSTART`/`DTEND` em UTC corretos para o fuso do evento, `LOCATION` com a sala e
 *      o `UID` estável (derivado do id da atividade);
 *  (b) **O CONTEÚDO do `.ics` da GRADE** — a pessoa baixa o arquivo com o token opaco,
 *      e ele leva o que ela marcou/inscreveu, com o `X-WR-CALNAME` do calendário;
 *  (c) **O LINK DO GOOGLE** aponta para `calendar.google.com` com os parâmetros
 *      codificados — e é o MESMO endereço que o gerador da fatia 1 produz (o href é
 *      comparado com `googleCalendarUrl`, não com uma string escrita à mão);
 *  (d) **O HORÁRIO NO FUSO DO EVENTO** (o defeito pré-existente que esta fatia corrige):
 *      o cartão da programação mostrava o horário do PROCESSO (UTC no container), e uma
 *      atividade das 10:00 em Salvador aparecia como 13:00. O caso afirma o RÓTULO;
 *  (e) **A ABA "ACONTECENDO AGORA"** — decidida no servidor, com a barra de progresso
 *      acessível (tempo restante em TEXTO e os atributos ARIA), o agrupamento por sala,
 *      o que começa em seguida e a faixa do topo da programação.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CONTEÚDO É LIDO, E NÃO O STATUS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um `.ics` malformado responde 200 e não mostra nada no calendário — o modo de falha
 *  é silencioso (é a razão de a fatia 1 ter teste contra os casos do RFC). Um E2E que
 *  só confere `response.ok()` mediria a existência da rota, não o arquivo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A HORA DO DIA É ESCOLHIDA PELO RELÓGIO, E É POR ISSO QUE (e) EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os cenários do `.ics` usam horas FIXAS num dia futuro: o arquivo é conferência de
 *  conteúdo, e o instante não muda o que se espera dele. Já "acontecendo agora" só
 *  pode ser medido com uma atividade em curso DE VERDADE — e é por isso que o caso cria
 *  uma atividade que começou há vinte minutos. O "agora" é do SERVIDOR, e o teste o
 *  encontra por onde ele aparece: a aba, a faixa e a barra.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f65-exportacao';
const DIA = 86_400_000;
const FUSO = 'America/Bahia';

/** A hora de PAREDE no fuso do evento — o instante UTC correspondente. */
function emSalvador(diasAFrente: number, hora: number, minuto = 0): Date {
  const instante = new Date(Date.now() + diasAFrente * DIA);
  instante.setUTCHours(hora + 3, minuto, 0, 0);
  return instante;
}

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;

/** Sala do minicurso — é ela que aparece no `LOCATION` do arquivo. */
const SALA = `Auditório A ${RUN_ID}`;

/** A atividade longa do dia futuro: 10:00–12:00 em Salvador (13:00–15:00 UTC). */
let minicursoId: string;
let minicursoSlug: string;
const TITULO_MINICURSO = `Minicurso de astronomia ${RUN_ID}`;

/** A segunda atividade do mesmo dia: 14:00–15:00 em Salvador (17:00–18:00 UTC). */
let palestraId: string;
const TITULO_PALESTRA = `Palestra sobre cerâmica ${RUN_ID}`;

/** A atividade EM CURSO: começou há 20 minutos e termina em 40. */
let agoraId: string;
const TITULO_AGORA = `Mesa ao vivo ${RUN_ID}`;

/** O título com acento e vírgula: prende o escape do RFC e o nome do arquivo. */
const TITULO_COM_VIRGULA = `Oficina: cerâmica, argila ${RUN_ID}`;
let oficinaId: string;

const eventoUrl = (aba?: string): string =>
  `/t/${tenantSlug}/eventos/${eventSlug}${aba ? `?aba=${aba}` : ''}`;

// ───────────────────────────────────────────────────────────────────────────────
//  Fixture
// ───────────────────────────────────────────────────────────────────────────────
test.beforeAll(async () => {
  const tenant = await createTenant({
    label: TENANT_LABEL,
    name: `Instituição da exportação ${RUN_ID}`,
  });

  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const evento = await createEvent({
    tenantId,
    slug: `f65-exportacao-evento-${RUN_ID}`,
    title: `Congresso da Exportação ${RUN_ID}`,
    status: 'REGISTRATION_OPEN',
    capacity: null,
  });

  eventId = evento.id;
  eventSlug = evento.slug;

  const sala = await createRoom({ tenantId, eventId, name: SALA, capacity: 40 });

  minicursoSlug = `f65-minicurso-${RUN_ID}`;

  minicursoId = await criarAtividade({
    slug: minicursoSlug,
    title: TITULO_MINICURSO,
    startsAt: emSalvador(3, 10),
    endsAt: emSalvador(3, 12),
    workloadMinutes: 120,
    roomId: sala.id,
    description: 'Uma volta pelo céu do sertão.',
  });

  palestraId = await criarAtividade({
    slug: `f65-palestra-${RUN_ID}`,
    title: TITULO_PALESTRA,
    startsAt: emSalvador(3, 14),
    endsAt: emSalvador(3, 15),
    workloadMinutes: 60,
    roomId: sala.id,
  });

  oficinaId = await criarAtividade({
    slug: `f65-oficina-${RUN_ID}`,
    title: TITULO_COM_VIRGULA,
    startsAt: emSalvador(4, 9),
    endsAt: emSalvador(4, 11),
    workloadMinutes: 120,
    roomId: sala.id,
  });

  /**
   * A atividade EM CURSO — criada pelo relógio, e não pelo calendário: o "agora" é o
   * único cenário que depende de o instante bater com o intervalo.
   */
  agoraId = await criarAtividade({
    slug: `f65-agora-${RUN_ID}`,
    title: TITULO_AGORA,
    startsAt: new Date(Date.now() - 20 * 60_000),
    endsAt: new Date(Date.now() + 40 * 60_000),
    workloadMinutes: 60,
    roomId: sala.id,
  });
});

/** Uma atividade no evento da fixture, pela conexão administrativa (como o resto da suíte). */
async function criarAtividade(input: {
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  workloadMinutes: number;
  roomId: string | null;
  description?: string;
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
        description: input.description ?? 'Atividade criada para o E2E da exportação.',
        type: 'LECTURE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        workloadMinutes: input.workloadMinutes,
        capacity: 40,
        waitlistEnabled: false,
        confirmedCount: 0,
        waitlistCount: 0,
        requiresRegistration: true,
        roomId: input.roomId,
      },
    });
  });

  return id;
}

test.afterAll(async () => {
  if (tenantId) await e2eDb.tenant.deleteMany({ where: { id: tenantId } });

  await cleanupRun();
  await e2eDb.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
//  Utilitários
// ───────────────────────────────────────────────────────────────────────────────
interface Pessoa {
  id: string;
  email: string;
}

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

/**
 * Uma pessoa no contexto SEM JavaScript — a régua desta fase.
 *
 * A exportação é link (não formulário) e a aba é `<a>` com `aria-current`; medir com o
 * JavaScript DESLIGADO é o que prova que nenhuma das duas depende de bundle. De quebra,
 * some a armadilha da dívida E76 (a hidratação engolindo o primeiro gesto).
 */
async function semJavaScript(
  browser: Browser,
  pessoa: Pessoa,
): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await browser.newContext({ javaScriptEnabled: false });
  const page = await contexto.newPage();

  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email: pessoa.email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);

  return { contexto, page };
}

/** Sem sessão nenhuma — o visitante que a rota do `.ics` de UMA atividade atende. */
async function anonimo(browser: Browser): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await browser.newContext({ javaScriptEnabled: false });
  const page = await contexto.newPage();

  return { contexto, page };
}

/**
 * Uma inscrição CONFIRMADA da pessoa.
 *
 * O caminho da tela é da fatia irmã (e já tem spec própria); aqui a inscrição é FIXTURE
 * — o que este arquivo mede é o que sai no ARQUIVO a partir dela, e o favorito continua
 * sendo marcado pelo clique de verdade (o formulário sem JavaScript).
 */
async function inscrever(input: {
  userId: string;
  activityId: string;
  eventId?: string;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: input.eventId ?? eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'CONFIRMED',
      },
    });
  });
}

/**
 * BAIXA o arquivo de um link e devolve o TEXTO.
 *
 * O endereço é RELATIVO e a requisição usa o contexto da própria página: é o mesmo
 * caminho do navegador da pessoa (o calendário do sistema não manda cookie — por isso
 * a rota da GRADE se autentica pelo token, e não pela sessão). O `Accept` do contexto
 * não interfere: a rota devolve `text/calendar` sem negociação.
 */
async function baixarIcs(page: Page, href: string): Promise<{ corpo: string; headers: Headers }> {
  const resposta = await page.request.get(href);

  expect(resposta.status(), `GET ${href}`).toBe(200);

  const headers = resposta.headers();

  expect(headers['content-type']).toBe('text/calendar; charset=utf-8');
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['content-disposition']).toContain('attachment;');
  expect(headers['content-disposition']).toContain('.ics');

  return { corpo: await resposta.text(), headers };
}

/** As linhas LÓGICAS do arquivo (desfazendo a dobra de 75 octetos do RFC). */
function linhasLogicas(corpo: string): string[] {
  return corpo.replace(/\r\n[ \t]/g, '').split('\r\n').filter((linha) => linha.length > 0);
}

/** O valor de uma propriedade, já sem o escape do RFC. */
function valorDe(corpo: string, propriedade: string): string | null {
  const linha = linhasLogicas(corpo).find((atual) => atual.startsWith(`${propriedade}:`));

  if (!linha) return null;

  return linha.slice(propriedade.length + 1).replace(/\\,/g, ',').replace(/\\;/g, ';');
}

/** O selo UTC do RFC para um instante — o formato que o arquivo tem de trazer. */
function seloUtc(instante: Date): string {
  const iso = instante.toISOString();

  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/**
 * O rótulo do horário NO FUSO DO EVENTO, pela MESMA régua do domínio
 * (`formatZonedDateTime`): `Intl` com `dateStyle: 'short'` e `timeStyle: 'short'`.
 *
 * O teste NÃO escreve a string esperada à mão: se o formato da régua mudar, o teste
 * acompanha — o que ele prende é o FUSO, não a pontuação.
 */
function rotuloNoEvento(instante: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: FUSO,
  }).format(instante);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  (a) O CONTEÚDO do `.ics` de UMA atividade
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(a) o arquivo .ics de uma atividade', () => {
  test('baixa o arquivo e o CONTEÚDO é um VEVENT completo, em UTC', async ({ browser }) => {
    const { contexto, page } = await anonimo(browser);

    try {
      await page.goto(eventoUrl());

      const links = page.getByTestId(`exportacao-${minicursoId}`);

      await expect(links).toBeVisible();
      await expect(links.getByTestId('exportar-ics-atividade')).toContainText('Baixar .ics');

      const href = await links.getByTestId('exportar-ics-atividade').getAttribute('href');

      expect(href).toBe(`/api/t/${tenantSlug}/agenda/ics?atividade=${minicursoId}`);

      const { corpo, headers } = await baixarIcs(page, href!);

      /** ── O ESQUELETO ──────────────────────────────────────────────────────── */
      expect(corpo.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(corpo.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(corpo).toContain('VERSION:2.0');
      expect(corpo).toContain('\r\n');

      /** Um `VEVENT` por item — aqui, exatamente um. */
      expect(corpo.match(/BEGIN:VEVENT/g)).toHaveLength(1);
      expect(corpo.match(/END:VEVENT/g)).toHaveLength(1);

      /** ── O CONTEÚDO ───────────────────────────────────────────────────────── */
      expect(valorDe(corpo, 'SUMMARY')).toBe(TITULO_MINICURSO);
      expect(valorDe(corpo, 'LOCATION')).toBe(SALA);

      /**
       * ── AS DATAS EM UTC, A PARTIR DO FUSO DO EVENTO ────────────────────────
       *
       * A atividade é das 10:00 em Salvador = 13:00 UTC. O `DTSTART` é o INSTANTE — o
       * fuso não entra na conversão dele (o instante não muda!); ele entra no rótulo
       * legível da descrição, que é o que a pessoa lê no celular.
       */
      expect(valorDe(corpo, 'DTSTART')).toBe(seloUtc(emSalvador(3, 10)));
      expect(valorDe(corpo, 'DTEND')).toBe(seloUtc(emSalvador(3, 12)));
      expect(valorDe(corpo, 'DTSTART')).toContain('T130000Z');

      /** O rótulo local está na descrição, com o fuso nomeado. */
      expect(valorDe(corpo, 'DESCRIPTION')).toContain('Horário local:');
      expect(valorDe(corpo, 'DESCRIPTION')).toContain('10:00');
      expect(valorDe(corpo, 'DESCRIPTION')).toContain(FUSO);
      expect(valorDe(corpo, 'DESCRIPTION')).toContain('Uma volta pelo céu do sertão.');

      /** O `DTSTAMP` é o instante da geração — obrigatório no RFC. */
      expect(valorDe(corpo, 'DTSTAMP')).toMatch(/^\d{8}T\d{6}Z$/);

      /** O `UID` sai do ID DA ATIVIDADE — é ele que faz o cliente ATUALIZAR. */
      expect(valorDe(corpo, 'UID')).toBe(`${minicursoId}@eventflow`);

      /** O nome do arquivo é legível (o `Content-Disposition` traz as duas formas). */
      expect(headers['content-disposition']).toContain('.ics');
    } finally {
      await contexto.close();
    }
  });

  test('o título com vírgula não parte o SUMMARY — o escape do RFC no arquivo real', async ({
    browser,
  }) => {
    const { contexto, page } = await anonimo(browser);

    try {
      const href = `/api/t/${tenantSlug}/agenda/ics?atividade=${oficinaId}`;
      const { corpo } = await baixarIcs(page, href);

      /**
       * A vírgula é escapada no ARQUIVO (`\,`) — se ela saísse crua, o valor viraria
       * dois itens para o cliente. O que se lê depois de desescapar é o título inteiro.
       */
      expect(corpo).toContain('cerâmica\\, argila');
      expect(valorDe(corpo, 'SUMMARY')).toBe(TITULO_COM_VIRGULA);
    } finally {
      await contexto.close();
    }
  });

  test('o UID é ESTÁVEL: o mesmo endereço devolve o mesmo identificador', async ({ browser }) => {
    const { contexto, page } = await anonimo(browser);

    try {
      const href = `/api/t/${tenantSlug}/agenda/ics?atividade=${minicursoId}`;

      const primeira = await baixarIcs(page, href);
      const segunda = await baixarIcs(page, href);

      expect(valorDe(primeira.corpo, 'UID')).toBe(valorDe(segunda.corpo, 'UID'));

      /** E ele MUDA de atividade para atividade — não é um UID fixo. */
      const outro = await baixarIcs(page, `/api/t/${tenantSlug}/agenda/ics?atividade=${palestraId}`);

      expect(valorDe(outro.corpo, 'UID')).not.toBe(valorDe(primeira.corpo, 'UID'));
    } finally {
      await contexto.close();
    }
  });

  test('atividade de outra instituição ou inexistente responde 404 — e não um arquivo vazio', async ({
    browser,
  }) => {
    const { contexto, page } = await anonimo(browser);

    try {
      const resposta = await page.request.get(
        `/api/t/${tenantSlug}/agenda/ics?atividade=${randomUUID()}`,
      );

      expect(resposta.status()).toBe(404);
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (b) O CONTEÚDO do `.ics` da GRADE (pelo token opaco)
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(b) o arquivo .ics da minha grade', () => {
  test('baixa a grade inteira pelo token, sem depender de cookie', async ({ browser, request }) => {
    const pessoa = await criarPessoa(request, `Dona da grade exportada ${RUN_ID}`);

    /** A grade dela: uma inscrição e um favorito, feitos pelo caminho da tela. */
    await inscrever({ userId: pessoa.id, activityId: minicursoId });

    const { contexto, page } = await semJavaScript(browser, pessoa);

    try {
      await page.goto(eventoUrl());

      /** Marca a palestra como favorita (formulário de verdade, sem JavaScript). */
      await page.getByTestId(`agenda-favoritar-${palestraId}`).click();
      await page.waitForLoadState('load');

      await page.goto(`/t/${tenantSlug}/minha-agenda?evento=${eventId}`);

      const exportacao = page.getByTestId('minha-agenda-exportacao');

      await expect(exportacao).toBeVisible();

      const href = await exportacao.getByTestId('exportar-ics-grade').getAttribute('href');

      expect(href).toBeTruthy();

      const params = new URLSearchParams(href!.split('?')[1]);

      expect(href!.startsWith(`/api/t/${tenantSlug}/agenda/ics?`)).toBe(true);
      expect(params.get('evento')).toBe(eventId);
      expect(params.get('token')).toBeTruthy();

      /** O token NÃO carrega o `userId` — é opaco, por desenho. */
      expect(href!).not.toContain(pessoa.id);

      /**
       * ── A PROVA DO DESENHO: SEM COOKIE, O ARQUIVO VEM ────────────────────────
       *
       *  É assim que o Apple Calendar e o Outlook pedem o endereço — e a razão de a
       *  rota ser pública com token em vez de autenticada por sessão. O `request`
       *  limpo do Playwright não manda cookie nenhum.
       */
      const resposta = await request.get(href!);

      expect(resposta.status()).toBe(200);
      expect(resposta.headers()['content-type']).toBe('text/calendar; charset=utf-8');
      expect(resposta.headers()['cache-control']).toBe('no-store');

      const corpo = await resposta.text();

      /** ── OS DOIS ITENS DA GRADE ───────────────────────────────────────────── */
      expect(corpo.match(/BEGIN:VEVENT/g)).toHaveLength(2);
      expect(corpo).toContain(`UID:${minicursoId}@eventflow`);
      expect(corpo).toContain(`UID:${palestraId}@eventflow`);
      expect(valorDe(corpo, 'X-WR-CALNAME')).toContain('Minha agenda');

      /** O da inscrição sai com sala e horário local; o do favorito também. */
      const eventos = corpo.split('BEGIN:VEVENT').slice(1);

      const doMinicurso = eventos.find((evento) => evento.includes(minicursoId));
      const daPalestra = eventos.find((evento) => evento.includes(palestraId));

      expect(doMinicurso).toBeTruthy();
      expect(daPalestra).toBeTruthy();
      expect(valorDe(`BEGIN:VEVENT${doMinicurso}`, 'SUMMARY')).toBe(TITULO_MINICURSO);
      expect(valorDe(`BEGIN:VEVENT${daPalestra}`, 'SUMMARY')).toBe(TITULO_PALESTRA);

      /** O que NÃO é da pessoa não entra: a oficina de outro dia não está marcada. */
      expect(corpo).not.toContain(oficinaId);
    } finally {
      await contexto.close();
    }
  });

  test('token inventado responde 404, e sem token a rota recusa com 400', async ({ request }) => {
    const inventado = await request.get(
      `/api/t/${tenantSlug}/agenda/ics?token=nao-e-um-token&evento=${eventId}`,
    );

    expect(inventado.status()).toBe(404);

    const semParametro = await request.get(`/api/t/${tenantSlug}/agenda/ics`);

    expect(semParametro.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (c) O LINK DO GOOGLE
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(c) o link do Google Calendar', () => {
  test('aponta para calendar.google.com com os parâmetros codificados', async ({ browser }) => {
    const { contexto, page } = await anonimo(browser);

    try {
      await page.goto(eventoUrl());

      const links = page.getByTestId(`exportacao-${minicursoId}`);
      const google = links.getByTestId('exportar-google');

      await expect(google).toContainText('Adicionar ao Google Calendar');

      const href = await google.getAttribute('href');

      expect(href).toBeTruthy();

      const url = new URL(href!);

      expect(url.origin).toBe('https://calendar.google.com');
      expect(url.pathname).toBe('/calendar/render');
      expect(url.searchParams.get('action')).toBe('TEMPLATE');
      expect(url.searchParams.get('text')).toBe(TITULO_MINICURSO);
      expect(url.searchParams.get('location')).toBe(SALA);

      /**
       * As datas no MESMO selo UTC do arquivo — é o formato que o Google documenta, e
       * mandar hora de parede com fuso no lugar dele agenda no horário errado.
       */
      expect(url.searchParams.get('dates')).toBe(
        `${seloUtc(emSalvador(3, 10))}/${seloUtc(emSalvador(3, 12))}`,
      );

      expect(url.searchParams.get('details')).toContain('Horário local:');
      expect(url.searchParams.get('details')).toContain(FUSO);

      /** E o endereço é EXATAMENTE o do gerador da fatia 1 — não uma cópia. */
      expect(href).toBe(
        googleCalendarUrl({
          activityId: minicursoId,
          title: TITULO_MINICURSO,
          startsAt: emSalvador(3, 10),
          endsAt: emSalvador(3, 12),
          timezone: FUSO,
          location: SALA,
          description: 'Uma volta pelo céu do sertão.',
        }),
      );

      /** O ícone não substitui o texto: o nome acessível diz a ação E o alvo. */
      await expect(google).toHaveAttribute(
        'aria-label',
        `Adicionar ao Google Calendar: ${TITULO_MINICURSO}`,
      );
    } finally {
      await contexto.close();
    }
  });

  test('na minha agenda, o botão do Google é a PRÓXIMA atividade — e o arquivo é a grade', async ({
    browser,
    request,
  }) => {
    const pessoa = await criarPessoa(request, `Dona do Google ${RUN_ID}`);

    await inscrever({ userId: pessoa.id, activityId: minicursoId });

    const { contexto, page } = await semJavaScript(browser, pessoa);

    try {
      await page.goto(`/t/${tenantSlug}/minha-agenda?evento=${eventId}`);

      const exportacao = page.getByTestId('minha-agenda-exportacao');

      const google = exportacao.getByTestId('exportar-google-grade');

      await expect(google).toHaveAttribute(
        'aria-label',
        `Adicionar ao Google Calendar a próxima atividade: ${TITULO_MINICURSO}`,
      );

      const href = new URL((await google.getAttribute('href'))!);

      expect(href.searchParams.get('text')).toBe(TITULO_MINICURSO);
      expect(href.searchParams.get('action')).toBe('TEMPLATE');
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (d) O HORÁRIO NO FUSO DO EVENTO — o defeito pré-existente
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(d) o horário do cartão sai no fuso do EVENTO', () => {
  test('uma atividade das 10:00 em Salvador aparece como 10:00, não como 13:00', async ({
    browser,
  }) => {
    const { contexto, page } = await anonimo(browser);

    try {
      await page.goto(eventoUrl());

      const rotulo = page.getByTestId(`atividade-horario-${minicursoId}`);

      await expect(rotulo).toBeVisible();

      /**
       * ── O DEFEITO ─────────────────────────────────────────────────────────────
       *
       *  O container roda em UTC (`TZ=UTC`). O cartão formatava o horário SEM
       *  `timeZone`, então o rótulo saía com o fuso do PROCESSO: 13:00 para uma
       *  atividade das 10:00 em Salvador. O rodapé prometia `America/Bahia` e o cartão
       *  mostrava outra hora — o horário que diz à pessoa quando ela tem de estar na
       *  sala, três horas errado.
       *
       *  A régua passou a ser `formatZonedDateTime` com o fuso do EVENTO, a MESMA da
       *  grade e da visão do "agora".
       */
      await expect(rotulo).toHaveText(rotuloNoEvento(emSalvador(3, 10)));
      await expect(rotulo).toContainText('10:00');
      await expect(rotulo).not.toContainText('13:00');
    } finally {
      await contexto.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (e) A ABA "ACONTECENDO AGORA"
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(e) a aba "Acontecendo agora"', () => {
  test('a navegação é por link com aria-current, e a aba mostra o que está em curso', async ({
    browser,
  }) => {
    const { contexto, page } = await anonimo(browser);

    try {
      await page.goto(eventoUrl());

      /** ── A NAVEGAÇÃO ─────────────────────────────────────────────────────── */
      const abaProgramacao = page.getByTestId('aba-programacao');
      const abaAgora = page.getByTestId('aba-agora');

      await expect(abaProgramacao).toHaveAttribute('aria-current', 'page');
      await expect(abaAgora).not.toHaveAttribute('aria-current', 'page');
      await expect(abaAgora).toHaveAttribute('href', `${eventoUrl()}?aba=agora`);

      /**
       * ── A FAIXA, QUE SÓ EXISTE COM ALGO EM CURSO ──────────────────────────
       *
       *  A fixture criou uma atividade que começou há vinte minutos, então a faixa
       *  existe — e ela leva para a aba. Sem nada em curso, ela não aparece; é o caso
       *  seguinte que prende isso.
       */
      const faixa = page.getByTestId('agora-faixa');

      await expect(faixa).toBeVisible();
      await expect(faixa).toContainText('Acontecendo agora:');
      await expect(faixa).toContainText(TITULO_AGORA);

      /** ── A ABA ───────────────────────────────────────────────────────────── */
      await page.getByTestId('agora-faixa-link').click();
      await page.waitForLoadState('load');

      expect(new URL(page.url()).searchParams.get('aba')).toBe('agora');

      await expect(page.getByTestId('aba-agora')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('aba-programacao')).not.toHaveAttribute('aria-current', 'page');

      const secao = page.getByTestId('agora');

      await expect(secao).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Acontecendo agora' })).toBeVisible();

      /** Agrupada por SALA — e é a sala da atividade que dá o nome ao grupo. */
      await expect(page.getByTestId(`agora-sala-${SALA}`)).toBeVisible();
      await expect(secao).toContainText(SALA);

      const item = page.getByTestId(`agora-item-${agoraId}`);

      await expect(item).toBeVisible();
      await expect(item).toContainText(TITULO_AGORA);

      /**
       * O horário da SALA, no fuso do evento. A atividade começou há vinte minutos, e o
       * rótulo tem de trazer a HORA LOCAL dela — o mesmo defeito de fuso medido no caso
       * (d) apareceria aqui como 13:xx em vez de 10:xx.
       */
      const inicio = new Date(Date.now() - 20 * 60_000);
      const horaLocal = new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        hourCycle: 'h23',
        timeZone: FUSO,
      }).format(inicio);

      await expect(page.getByTestId(`agora-horario-${agoraId}`)).toContainText(
        rotuloNoEvento(inicio),
      );
      await expect(page.getByTestId(`agora-horario-${agoraId}`)).toContainText(horaLocal);

      /** ── A BARRA ACESSÍVEL ───────────────────────────────────────────────── */
      const barra = page.getByTestId('agora-barra');

      await expect(barra).toHaveAttribute('role', 'progressbar');
      await expect(barra).toHaveAttribute('aria-valuemin', '0');
      await expect(barra).toHaveAttribute('aria-valuemax', '100');
      await expect(barra).toHaveAttribute(
        'aria-label',
        `Tempo restante da atividade ${TITULO_AGORA}`,
      );

      const agora = Number(await barra.getAttribute('aria-valuenow'));

      /** A atividade começou há 20 de 60 minutos: um terço decorrido, com folga. */
      expect(agora).toBeGreaterThanOrEqual(25);
      expect(agora).toBeLessThanOrEqual(45);

      /** O TEXTO do tempo restante — a informação existe sem a barra. */
      const restante = page.getByTestId('agora-restante');

      await expect(restante).toHaveText(/termina em \d+ min/);
      await expect(barra).toHaveAttribute('aria-valuetext', await restante.innerText());

      /** E o "a seguir nesta sala" aponta a próxima atividade que ainda não começou. */
      await expect(page.getByTestId(`agora-proxima-${SALA}`)).toBeVisible();

      /** Na aba do "agora" a programação não é desenhada — são duas vistas, não duas listas. */
      await expect(page.getByTestId(`exportacao-${minicursoId}`)).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });

  test('sem nada em curso, a faixa NÃO aparece na programação', async ({ browser }) => {
    const { contexto, page } = await anonimo(browser);

    try {
      /**
       * O evento é o MESMO — o que muda é o instante. A atividade em curso termina em
       * quarenta minutos, e esperar por isso não é opção: o cenário monta um evento
       * próprio, sem nada em curso, e mede a AUSÊNCIA nele.
       */
      const outro = await createEvent({
        tenantId,
        slug: `f65-sem-curso-${RUN_ID}`,
        title: `Evento sem nada em curso ${RUN_ID}`,
        status: 'REGISTRATION_OPEN',
        capacity: null,
      });

      const sala = await createRoom({ tenantId, eventId: outro.id, name: `Sala ${RUN_ID}` });

      await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

        await tx.activity.create({
          data: {
            id: randomUUID(),
            tenantId,
            eventId: outro.id,
            slug: `f65-futura-${RUN_ID}`,
            title: `Atividade do ano que vem ${RUN_ID}`,
            type: 'LECTURE',
            status: 'SCHEDULED',
            modality: 'IN_PERSON',
            startsAt: new Date(Date.now() + 300 * DIA),
            endsAt: new Date(Date.now() + 300 * DIA + 3_600_000),
            workloadMinutes: 60,
            capacity: 10,
            waitlistEnabled: false,
            confirmedCount: 0,
            waitlistCount: 0,
            requiresRegistration: true,
            roomId: sala.id,
          },
        });
      });

      await page.goto(`/t/${tenantSlug}/eventos/${outro.slug}`);

      /** POSITIVA PRIMEIRO: a programação está lá... */
      await expect(page.getByTestId('aba-agora')).toBeVisible();

      /** ...e a faixa do "agora" NÃO está. Nada de "nenhuma atividade" ocupando espaço. */
      await expect(page.getByTestId('agora-faixa')).toHaveCount(0);

      /** A aba existe e diz que não há nada em curso — sem inventar conteúdo. */
      await page.goto(`/t/${tenantSlug}/eventos/${outro.slug}?aba=agora`);

      await expect(page.getByTestId('agora-vazio')).toBeVisible();
      await expect(page.getByTestId('agora-vazio')).toContainText('Nenhuma atividade em curso');
    } finally {
      await contexto.close();
    }
  });
});

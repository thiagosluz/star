/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A EXPORTAÇÃO NA RAIZ DO EVENTO (FASE 77 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O NAVEGADOR PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. o painel **existe na raiz do evento** e oferece os DOIS arquivos — o de
 *     inscritos e o de presenças por atividade —, com o recorte do evento já
 *     preenchido (o pedido nasce apontando para ELE, não para a instituição);
 *  2. os dois botões criam pedidos de tipos DIFERENTES: o `kind` vai no próprio
 *     botão, e não num campo escondido (com dois botões, um `hidden` seria enviado
 *     junto e o POST diria sempre o mesmo tipo);
 *  3. o arquivo de presenças sai em FORMATO LONGO, com as três ausências ditas
 *     (`(sem atividade)`, `(em aberto)` e minutos vazios) e a marca d'água da F49;
 *  4. o evento em **RASCUNHO exporta** — o filtro que esconde rascunho é do
 *     diretório, não do dado;
 *  5. as exportações **recentes são do EVENTO** — a de outro evento não aparece
 *     (uma linha "3 linhas · Ana" sem contexto faria o organizador achar que o
 *     arquivo dele já existe);
 *  6. o painel **não aparece** para um papel sem `participant:read`, e o arquivo de
 *     um pedido real é **recusado pela rota** (403) para esse papel — a barreira é a
 *     rota, não o botão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A NOTA HONESTA SOBRE O CASO (6)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nenhum papel do catálogo tem `event:update` **sem** `participant:read`: os três
 *  que abrem a raiz (OWNER, ADMIN e ORGANIZER) têm as duas. Logo, no navegador, o
 *  papel sem `participant:read` não chega a ver a raiz — o que se mede é isso e a
 *  recusa da ROTA para o arquivo do mesmo pedido. A isolação do gate do painel
 *  ("tem `event:update`, não tem `participant:read`") é provada no componente, com
 *  os dois principals, em `tests/unit/f77-exportacao-do-evento.test.ts`. O ponto
 *  está declarado no §8 do documento da fase.
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
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

const TITULO_PUBLICADO = 'Congresso da Exportação do Evento';
const TITULO_RASCUNHO = 'Evento em Rascunho da Exportação';
const ATIVIDADE = 'Minicurso de Exportação';

let tenantId: string;
let tenantSlug: string;
let eventPublicadoId: string;
let eventRascunhoId: string;
let adminEmail: string;
let staffEmail: string;

/** Marcador único do arquivo: o que a linha de dados precisa conter. */
const PESSOA_ATIVIDADE = 'Ana da Atividade';
const PESSOA_PORTARIA = 'Bruno da Portaria';
const PESSOA_RASCUNHO = 'Carla do Rascunho';

async function signUpVia(api: Page['request'], name: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f77');
  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);

  const body = (await response.json()) as { user: { id: string } };

  return { id: body.user.id, email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);
}

/** Uma pessoa que aparece no CSV: nome + registro no evento. */
async function criarPessoa(name: string): Promise<string> {
  const id = randomUUID();

  await e2eDb.user.create({
    data: { id, name, email: uniqueEmail('f77.pessoa'), emailVerified: true },
  });

  return id;
}

async function registrar(input: { userId: string; eventId: string; activityId?: string | null }) {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        tenantId,
        eventId: input.eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: 'CONFIRMED',
      },
    });
  });
}

async function presenca(input: {
  userId: string;
  eventId: string;
  activityId?: string | null;
  checkedInAt: Date;
  checkedOutAt?: Date | null;
  minutes?: number | null;
}) {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.attendance.create({
      data: {
        tenantId,
        eventId: input.eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: 'PRESENT',
        source: 'QR_CODE_CHECKIN',
        checkedInAt: input.checkedInAt,
        checkedOutAt: input.checkedOutAt ?? null,
        minutesAttended: input.minutes ?? null,
      },
    });
  });
}

/**
 * O arquivo em linhas de DADO (sem BOM, sem os `#` de procedência), com o cabeçalho
 * em `header` e cada linha virando um objeto coluna → célula.
 */
function parseCsv(csv: string): { header: string[]; rows: Record<string, string>[] } {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const header = (lines[0] ?? '').split(';');

  const rows = lines.slice(1).map((line) => {
    const cells = line.split(';');
    const row: Record<string, string> = {};

    header.forEach((column, index) => {
      row[column] = cells[index] ?? '';
    });

    return row;
  });

  return { header, rows };
}

const painelUrl = (eventId: string) => `/t/${tenantSlug}/administracao/eventos/${eventId}`;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: 'f77-exportacao',
      name: `Instituição da Exportação ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const evento = await createEvent({
      tenantId,
      slug: `f77-congresso-${RUN_ID}`,
      title: TITULO_PUBLICADO,
      status: 'REGISTRATION_OPEN',
    });

    eventPublicadoId = evento.id;

    /** O evento recém-criado: é ele que o `<select>` do diretório esconde. */
    const rascunho = await createEvent({
      tenantId,
      slug: `f77-rascunho-${RUN_ID}`,
      title: TITULO_RASCUNHO,
      status: 'DRAFT',
    });

    eventRascunhoId = rascunho.id;

    const atividade = await createActivity({
      tenantId,
      eventId: eventPublicadoId,
      slug: `f77-minicurso-${RUN_ID}`,
      title: ATIVIDADE,
      startsAtOffsetDays: -1,
      workloadMinutes: 60,
    });

    const admin = await signUpVia(api, 'Administradora da Exportação F77');
    adminEmail = admin.email;

    await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });

    /**
     * A STAFF opera o dia do evento: tem `registration:read:any` e
     * `attendance:read`, e **não** tem `participant:read` — é o papel mais próximo
     * de "vê o evento, não vê o diretório".
     */
    const staff = await signUpVia(api, 'Equipe da Exportação F77');
    staffEmail = staff.email;

    await linkUser({ userId: staff.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: staff.id, tenantId, role: 'STAFF', scope: 'TENANT' });

    const ana = await criarPessoa(PESSOA_ATIVIDADE);
    const bruno = await criarPessoa(PESSOA_PORTARIA);
    const carla = await criarPessoa(PESSOA_RASCUNHO);

    /** Ana: presença NA atividade. */
    await registrar({ userId: ana, eventId: eventPublicadoId, activityId: atividade.id });
    await presenca({
      userId: ana,
      eventId: eventPublicadoId,
      activityId: atividade.id,
      checkedInAt: new Date('2026-09-01T13:00:00Z'), // 10:00 em Salvador
      checkedOutAt: new Date('2026-09-01T14:00:00Z'),
      minutes: 60,
    });

    /**
     * Bruno: chegou ao evento pela PORTARIA (sem atividade) e a sessão ficou ABERTA.
     * É a linha que prova as duas ausências do formato longo.
     */
    await registrar({ userId: bruno, eventId: eventPublicadoId });
    await presenca({
      userId: bruno,
      eventId: eventPublicadoId,
      activityId: null,
      checkedInAt: new Date('2026-09-01T16:00:00Z'),
      checkedOutAt: null,
      minutes: null,
    });

    /** Carla: inscrita e presente no evento em RASCUNHO (o que exporta mesmo assim). */
    await registrar({ userId: carla, eventId: eventRascunhoId });
    await presenca({
      userId: carla,
      eventId: eventRascunhoId,
      activityId: null,
      checkedInAt: new Date('2026-11-01T13:00:00Z'),
      checkedOutAt: new Date('2026-11-01T14:00:00Z'),
      minutes: 60,
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('a exportação na raiz do evento', () => {
  test('1. os dois botões, e o de presenças baixa o arquivo em formato longo', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(painelUrl(eventPublicadoId));

    /**
     * O painel está DENTRO de "Operar" e depois dos quatro cartões do grupo: os 17
     * cartões do mapa continuam onde estavam. A prova de posição é a do DOM — o
     * `event-export` vem depois do último `ul[data-testid^="event-area"]` do grupo.
     */
    const painel = page.getByTestId('event-export');
    await expect(painel).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('event-export-notice')).toContainText('24 horas');
    await expect(page.getByTestId('event-export-notice')).toContainText('em cada linha');

    /** DOIS tipos, dois botões — e o formulário de criação não manda `kind` escondido. */
    await expect(page.getByTestId('event-export-create-participantes')).toBeVisible();
    await expect(page.getByTestId('event-export-create-presencas')).toBeVisible();
    await expect(
      page.locator('form:has([data-testid="event-export-create-presencas"]) input[name="kind"]'),
    ).toHaveCount(0);

    /** O recorte do evento vai junto no pedido. */
    await expect(page.locator(`input[name="evento"][value="${eventPublicadoId}"]`)).toHaveCount(1);

    await page.getByTestId('event-export-create-presencas').click();

    const pronto = page.getByTestId('event-export-ready');
    await expect(pronto).toBeVisible({ timeout: 30_000 });
    await expect(pronto).toHaveAttribute('data-kind', 'ATTENDANCES_CSV');
    await expect(pronto).toContainText('Presenças por atividade');

    const href = await page.getByTestId('event-export-download').getAttribute('href');
    expect(href, 'o botão de presenças precisa produzir um download').toBeTruthy();

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()['x-exportacao-horas']).toBe('24');

    const { header, rows } = parseCsv(await response.text());

    /** O CONTRATO do formato longo: uma linha por sessão. */
    expect(header).toEqual(['Atividade', 'Pessoa', 'Entrada', 'Saída', 'Minutos', 'Exportado por']);

    const linhaDaAna = rows.find((row) => row['Pessoa'] === PESSOA_ATIVIDADE);
    expect(linhaDaAna, 'a pessoa presente na atividade tem de estar no arquivo').toBeDefined();
    expect(linhaDaAna?.['Atividade']).toBe(ATIVIDADE);
    expect(linhaDaAna?.['Entrada']).toBe('01/09/2026 10:00');
    expect(linhaDaAna?.['Saída']).toBe('01/09/2026 11:00');
    expect(linhaDaAna?.['Minutos']).toBe('60');

    /**
     * As TRÊS ausências ditas: a chegada pela portaria não some, a sessão aberta
     * não vira horário inventado e o minuto não apurado não vira zero.
     */
    const linhaDoBruno = rows.find((row) => row['Pessoa'] === PESSOA_PORTARIA);
    expect(linhaDoBruno, 'a chegada ao evento (sem atividade) tem de estar no arquivo').toBeDefined();
    expect(linhaDoBruno?.['Atividade']).toBe('(sem atividade)');
    expect(linhaDoBruno?.['Saída']).toBe('(em aberto)');
    expect(linhaDoBruno?.['Minutos']).toBe('');

    /** A marca d'água da F49 continua na ÚLTIMA coluna, em cada linha. */
    for (const row of rows) {
      expect(row['Exportado por']).toContain('Administradora da Exportação F77');
      expect(row['Exportado por']).toContain('válido até');
    }

    /** E o recorte está escrito na procedência do arquivo. */
    const bruto = await (await page.request.get(href!)).text();
    expect(bruto).toContain(`# Filtros: Evento: ${TITULO_PUBLICADO}`);
    expect(bruto).toContain('# Presenças por atividade');
  });

  test('2. o evento em RASCUNHO exporta, e as recentes são do EVENTO', async ({ page }) => {
    await signInAs(page, adminEmail);

    /** Primeiro uma exportação do evento PUBLICADO — ela não pode aparecer no outro. */
    await page.goto(painelUrl(eventPublicadoId));
    await page.getByTestId('event-export-create-participantes').click();
    await expect(page.getByTestId('event-export-ready')).toBeVisible({ timeout: 30_000 });

    /** Agora o RASCUNHO: o painel existe, a lista de recentes está vazia. */
    await page.goto(painelUrl(eventRascunhoId));

    const painel = page.getByTestId('event-export');
    await expect(painel).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('event-export-recent-empty')).toBeVisible();
    await expect(page.getByTestId('event-export-recent')).toHaveCount(0);

    await page.getByTestId('event-export-create-participantes').click();

    const pronto = page.getByTestId('event-export-ready');
    await expect(pronto).toBeVisible({ timeout: 30_000 });
    await expect(pronto).toHaveAttribute('data-kind', 'PARTICIPANTS_CSV');

    const href = await page.getByTestId('event-export-download').getAttribute('href');
    expect(href).toBeTruthy();

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);

    const bruto = await response.text();
    const { header, rows } = parseCsv(bruto);

    /**
     * A FORMA do arquivo é a do EVENTO: sem as colunas que não têm recorte por
     * evento (`Eventos`, `Eventos com presença`, `Rótulos`).
     */
    expect(header).toContain('Inscrições confirmadas');
    expect(header).toContain('Minutos');
    expect(header).not.toContain('Eventos');
    expect(header).not.toContain('Eventos com presença');
    expect(header).not.toContain('Rótulos');

    /** O rascunho exporta: o filtro que o esconde é do diretório, não do dado. */
    expect(bruto).toContain(`# Filtros: Evento: ${TITULO_RASCUNHO}`);

    const linhaDaCarla = rows.find((row) => row['Nome'] === PESSOA_RASCUNHO);
    expect(linhaDaCarla, 'a pessoa do evento em rascunho tem de estar no arquivo').toBeDefined();
    expect(linhaDaCarla?.['Minutos']).toBe('60');
    expect(linhaDaCarla?.['Visitas']).toBe('1');
  });

  test('3. o painel não aparece sem `participant:read`, e a rota recusa o arquivo', async ({
    page,
  }) => {
    /** O pedido é criado pela ADMINISTRADORA — o arquivo existe e é dela. */
    await signInAs(page, adminEmail);
    await page.goto(painelUrl(eventPublicadoId));
    await page.getByTestId('event-export-create-participantes').click();

    const href = await page
      .getByTestId('event-export-download')
      .getAttribute('href', { timeout: 30_000 });

    expect(href).toBeTruthy();

    /**
     * A STAFF tem vínculo ativo e opera o dia do evento — e não tem
     * `participant:read`. A raiz exige `event:update`, que ela também não tem, então
     * o destino é o painel: a tela não abre e o painel não é desenhado.
     */
    await signInAs(page, staffEmail);
    await page.goto(painelUrl(eventPublicadoId));

    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/dashboard$`), { timeout: 30_000 });
    await expect(page.getByTestId('event-export')).toHaveCount(0);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A BARREIRA É A ROTA, NÃO O BOTÃO
     * ─────────────────────────────────────────────────────────────────────────────
     *  O endereço do arquivo é o que um atacante chama. Ele responde 403 a quem não
     *  tem a permissão — a mesma que o painel usa para se esconder.
     */
    const recusa = await page.request.get(href!);
    expect(recusa.status()).toBe(403);
    expect(await recusa.text()).toContain('participant:read');
  });
});

import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { createDemand } from '../../src/lib/events/demand-service';
import { addDaysToDayKey, dueAtFromDay, localDayKey } from '../../src/domain/events/demand-rules';
import { monthKeyOf, shiftMonthKey } from '../../src/domain/events/demand-timeline-rules';
import { zonedWallTimeToInstant } from '../../src/domain/events/scheduling-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — AS TRÊS VISTAS DAS DEMANDAS (FASE 57)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. a tela abre no KANBAN — a vista que já existia continua sendo o padrão, e o
 *      cartão continua no lugar de sempre;
 *   2. o seletor leva ao **Gantt** e ao **calendário** por LINK (funciona sem
 *      JavaScript), preservando os filtros da barra;
 *   3. no Gantt há uma barra para a demanda com prazo, e a barra sem `startAt` é
 *      MARCADA como estimada (é a decisão da fase: o gráfico não mente sobre o
 *      planejamento);
 *   4. o calendário põe a demanda no dia do PRAZO, e andar um mês a tira de cena (ela
 *      vence no mês anterior — o calendário não a repete no mês errado);
 *   5. voltar ao Kanban devolve o quadro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A FIXTURE ANCORA NO DIA LOCAL DO EVENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As datas são calculadas no fuso do EVENTO (`America/Bahia`) e a demanda que o
 *  calendário precisa mostrar vence HOJE: assim ela cai no mês que a tela abre por
 *  padrão, qualquer que seja o dia em que a bateria roda (ancorar em "hoje + 5" faria o
 *  caso falhar no fim do mês — o defeito que a E71 descreve).
 *
 *  Nada aqui procura texto que a regravação possa desmontar: as asserções são por
 *  `data-testid`, por atributo e por URL.
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f57-vistas-${RUN_ID}`;
const EVENT_SLUG = `evento-f57-${RUN_ID}`;
const TIME_ZONE = 'America/Bahia';

const TITULO_COM_INICIO = 'Montar o credenciamento';
const TITULO_ESTIMADA = 'Fechar o contrato do som';
const TITULO_SEM_PRAZO = 'Escolher a arte do banner';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let admin: { id: string; email: string };

let comInicioId: string;
let estimadaId: string;
let semPrazoId: string;

/** Âncoras de dia no fuso do EVENTO — nunca no fuso do processo que roda o teste. */
const agora = new Date();
const hojeKey = localDayKey(agora, TIME_ZONE);
const inicioKey = addDaysToDayKey(hojeKey, -2);

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f57.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição das vistas ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: `Evento das vistas ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      capacity: 50,
    });

    eventId = event.id;

    admin = await signUpVia(api, `Administradora das vistas ${RUN_ID}`);
    await linkUser({ tenantId, userId: admin.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });

    /**
     * As demandas nascem pela RÉGUA REAL (`createDemand`), e não por `INSERT` à mão: o
     * quadro é criado na primeira escrita, com as colunas padrão, e as datas entram no
     * mesmo caminho que a tela usa.
     */
    const comInicio = await createDemand({
      tenantId,
      eventId,
      actorId: admin.id,
      title: TITULO_COM_INICIO,
      startAt: zonedWallTimeToInstant(`${inicioKey}T09:00`, TIME_ZONE),
      dueAt: dueAtFromDay(hojeKey, TIME_ZONE),
    });

    const estimada = await createDemand({
      tenantId,
      eventId,
      actorId: admin.id,
      title: TITULO_ESTIMADA,
      dueAt: dueAtFromDay(addDaysToDayKey(hojeKey, 3), TIME_ZONE),
    });

    const semPrazo = await createDemand({
      tenantId,
      eventId,
      actorId: admin.id,
      title: TITULO_SEM_PRAZO,
    });

    if (!comInicio.ok || !estimada.ok || !semPrazo.ok) {
      throw new Error('Não foi possível montar as demandas da fase 57.');
    }

    comInicioId = comInicio.demandId;
    estimadaId = estimada.demandId;
    semPrazoId = semPrazo.demandId;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

const boardUrl = () => `/t/${tenantSlug}/administracao/eventos/${eventId}/demandas`;

test('1. o Kanban continua o padrão e o seletor leva ao Gantt', async ({ page }) => {
  await signInAs(page, admin.email);
  await page.goto(boardUrl());

  // ── O Kanban, como sempre foi ────────────────────────────────────────────────
  await expect(page.getByTestId('demand-board-kanban')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`demand-card-${comInicioId}`)).toBeVisible();
  await expect(page.getByTestId('demand-view-kanban')).toHaveAttribute('aria-current', 'page');

  // ── Gantt, por LINK: sem JavaScript a vista nova continua alcançável ─────────
  await page.getByTestId('demand-view-gantt').click();

  await expect(page.getByTestId('demand-gantt')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('demand-gantt-axis')).toBeVisible();
  await expect(page.getByTestId('demand-view-gantt')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('demand-board-kanban')).toHaveCount(0);

  /** A demanda com início e prazo declarados tem barra no eixo. */
  const barra = page.getByTestId(`demand-gantt-bar-${comInicioId}`);
  await expect(barra).toBeVisible();
  await expect(page.getByTestId(`demand-gantt-row-${comInicioId}`)).toBeVisible();

  /** A barra tem DESTINO: clicar nela abre a ficha da demanda. */
  await expect(barra).toHaveAttribute('href', `/t/${tenantSlug}/administracao/eventos/${eventId}/demandas/${comInicioId}`);

  /** Sem `startAt`, a barra é marcada como ESTIMADA — a decisão da fase. */
  await expect(page.getByTestId(`demand-gantt-bar-${estimadaId}`)).toHaveAttribute(
    'data-estimated',
    '1',
  );

  /** O que não tem prazo não some: aparece na faixa "sem data", com link para a ficha. */
  await expect(
    page.getByTestId('demand-gantt-undated').getByRole('link', { name: TITULO_SEM_PRAZO }),
  ).toHaveAttribute(
    'href',
    `/t/${tenantSlug}/administracao/eventos/${eventId}/demandas/${semPrazoId}`,
  );
  await expect(page.getByTestId('demand-gantt-outside')).toBeVisible();

  /** Andar um período é um LINK que mantém a vista. */
  await page.getByTestId('demand-gantt-next').click();
  await expect(page).toHaveURL(/de=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByTestId('demand-gantt')).toBeVisible();
});

test('2. o calendário põe a demanda no dia do prazo, anda um mês e volta ao Kanban', async ({
  page,
}) => {
  await signInAs(page, admin.email);
  await page.goto(boardUrl());

  await page.getByTestId('demand-view-calendario').click();

  await expect(page.getByTestId('demand-calendar')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('demand-calendar-month')).toBeVisible();

  /**
   * A demanda do dia do PRAZO está na célula DAQUELE dia — a asserção é de parentesco no
   * DOM, e não de texto: é isso que prova que o calendário desenha no dia certo.
   */
  const celula = page.getByTestId(`demand-calendar-cell-${hojeKey}`);
  await expect(celula.getByTestId(`demand-calendar-demand-${comInicioId}`)).toBeVisible();

  /** Quem não tem prazo não tem dia: fica listada fora da grade, com link para a ficha. */
  await expect(
    page.getByTestId('demand-calendar-undated').getByRole('link', { name: TITULO_SEM_PRAZO }),
  ).toHaveAttribute(
    'href',
    `/t/${tenantSlug}/administracao/eventos/${eventId}/demandas/${semPrazoId}`,
  );

  // ── Um mês adiante: a demanda vence no mês anterior e sai da grade ───────────
  const mesSeguinte = shiftMonthKey(monthKeyOf(hojeKey), 1);

  await page.getByTestId('demand-calendar-next').click();

  await expect(page).toHaveURL(new RegExp(`mes=${mesSeguinte}`));
  await expect(page.getByTestId('demand-calendar')).toBeVisible();
  await expect(page.getByTestId(`demand-calendar-demand-${comInicioId}`)).toHaveCount(0);

  // ── E o seletor devolve o quadro ────────────────────────────────────────────
  await page.getByTestId('demand-view-kanban').click();

  await expect(page.getByTestId('demand-board-kanban')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('demand-calendar')).toHaveCount(0);
  await expect(page.getByTestId(`demand-card-${comInicioId}`)).toBeVisible();
});

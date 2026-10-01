import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { RUN_ID, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A FILA DO EVENTO E O ACEITE DA VAGA (dívidas E33 e E1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O que este cenário prova, e que nenhum teste de unidade prova: o caminho INTEIRO
 *  pelo navegador, com duas pessoas e uma instituição.
 *
 *    1. o evento tem UMA vaga; a primeira pessoa entra;
 *    2. a segunda **não é recusada** — ela entra na fila, e a tela diz a POSIÇÃO;
 *    3. a instituição **vê quem espera**, com nome e posição, na tela de confirmações;
 *    4. a primeira desiste, e a vaga vai para quem esperava, **retida com prazo**;
 *    5. quem foi chamado **aceita a vaga pela própria tela** — e ela é dele.
 *
 *  O passo 5 é o que fechou a dívida E1: sem ele a vaga venceria em 48 h e rodaria para
 *  o próximo, para sempre.
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `fila-evento-${RUN_ID}`;
const EVENT_SLUG = `evento-uma-vaga-${RUN_ID}`;

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let organizer: { id: string; email: string };
let primeira: { id: string; email: string };
let segunda: { id: string; email: string };

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `fila.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Inscreve a pessoa logada no evento pela tela pública. */
async function inscreverNoEvento(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/t/${tenantSlug}/eventos/${EVENT_SLUG}/inscricao`);
  await page.getByRole('checkbox', { name: /tratamento dos meus dados/i }).check();
  await page.getByRole('button', { name: /confirmar inscrição no evento/i }).click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Fila ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    /** UMA vaga: é o que faz a segunda pessoa bater na porta da fila. */
    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: `Evento de uma vaga ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      capacity: 1,
    });

    eventId = event.id;

    organizer = await signUpVia(api, 'Organizadora da Fila');
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });

    primeira = await signUpVia(api, 'Primeira da Fila');
    segunda = await signUpVia(api, 'Segunda da Fila');
  } finally {
    await api.dispose();
  }
});

test('1. evento lotado entra na fila, com posição — e a instituição vê quem espera', async ({
  page,
}) => {
  // ── A primeira pessoa ocupa a única vaga ────────────────────────────────────
  await signInAs(page, primeira.email);
  await inscreverNoEvento(page);
  await expect(page.getByTestId('event-registration-status')).toBeVisible({ timeout: 30_000 });

  // ── A segunda NÃO é recusada: entra na fila, e a tela diz a posição ─────────
  await signInAs(page, segunda.email);
  await inscreverNoEvento(page);

  await expect(page.getByText(/lista de espera/i).first()).toBeVisible({ timeout: 30_000 });
  /** A tela NOMEIA a posição: "você está na fila" sem o número não responde nada. */
  await expect(page.getByTestId('event-waitlist-status')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('event-registration-status')).toContainText(/posição é a 1ª/i);

  // ── A instituição vê a fila: nome e posição, na tela de confirmações ────────
  await signInAs(page, organizer.email);
  await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/confirmacoes`);

  const fila = page.getByTestId('event-waitlist');
  await expect(fila).toBeVisible({ timeout: 30_000 });
  await expect(fila).toContainText(/Fila do evento \(1\)/);
  await expect(page.getByTestId('event-waitlist-row-1')).toContainText('Segunda da Fila');
  /** A tela diz o que vai acontecer: promoção automática e prazo de 48 h. */
  await expect(fila).toContainText(/48 h/);
});

test('2. quem é chamado aceita a vaga pela própria tela, e ela passa a ser dele', async ({
  page,
}) => {
  // ── A primeira desiste: a linha sai da lista e a vaga é OFERECIDA ───────────
  await signInAs(page, primeira.email);
  await page.goto(`/t/${tenantSlug}/minhas-inscricoes`);
  await page.getByTestId('cancel-registration-open').click();
  await page.getByTestId('cancel-registration-confirm-confirm').click();

  /**
   * A lista revalida e a inscrição sai dela — é assim que o cancelamento aparece para
   * quem cancelou. (A mensagem da action é transitória: o botão que a mostraria deixou
   * de existir junto com a linha.)
   */
  await expect(page.getByText(/você ainda não se inscreveu/i)).toBeVisible({ timeout: 30_000 });

  /**
   * E a vaga foi para quem esperava, RETIDA COM PRAZO (dívida E1): o banco é quem
   * responde, e a janela é conferida em horas — medir milissegundos tornaria o teste
   * dependente do tempo de execução.
   */
  const promovida = await e2eDb.registration.findFirstOrThrow({
    where: { userId: segunda.id, activityId: null, deletedAt: null },
    select: { status: true, confirmationDueAt: true },
  });

  expect(promovida.status).toBe('PENDING');
  const horasAteVencer = (promovida.confirmationDueAt!.getTime() - Date.now()) / 3_600_000;
  expect(horasAteVencer).toBeGreaterThan(47);
  expect(horasAteVencer).toBeLessThan(49);

  // ── Quem esperava vê a OFERTA, com prazo, e decide ──────────────────────────
  await signInAs(page, segunda.email);
  await page.goto(`/t/${tenantSlug}/minhas-inscricoes`);

  const aceitar = page.getByTestId('accept-promotion');
  await expect(aceitar).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Sua até/i)).toBeVisible();

  await aceitar.click();

  /**
   * A prova do aceite é o ESTADO, não a mensagem: a linha revalida, e a oferta sai da
   * tela porque deixou de existir — é o espelho do cancelamento logo acima. O botão
   * sumir é a confirmação visual de que a vaga passou a ser dela.
   */
  await expect(page.getByTestId('accept-promotion')).toHaveCount(0, { timeout: 30_000 });

  // ── E a vaga é dela DE VERDADE: confirmada, sem prazo pendurado ─────────────
  const registro = await e2eDb.registration.findFirstOrThrow({
    where: { userId: segunda.id, activityId: null, deletedAt: null },
    select: { status: true, confirmationDueAt: true },
  });

  expect(registro.status).toBe('CONFIRMED');
  expect(registro.confirmationDueAt).toBeNull();
});

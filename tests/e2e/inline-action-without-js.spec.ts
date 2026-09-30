/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — a ação em linha ANTES do bundle (FASE 50 · dívida E50)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE ARQUIVO MEDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `InlineActionForm` (FASE 17) renderiza no servidor, mas quem ENVIAVA era o
 *  cliente: com o JavaScript ainda carregando, o clique era absorvido pelo React e
 *  **não virava requisição** — sem erro na tela e sem linha no log. A operação
 *  concluía que o botão "não funcionou" e clicava de novo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO SE MEDE "ANTES DO BUNDLE"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `javaScriptEnabled: false` é o caso EXTREMO e é o que interessa: sem JavaScript
 *  nenhum, o `<form>` precisa ser um formulário HTML de verdade, com `action` e
 *  campos — e o POST tem de acontecer. Se a ação só funciona depois da hidratação,
 *  este teste reprova.
 *
 *  O caminho destrutivo (com diálogo de confirmação) fica de fora de propósito: a
 *  confirmação é um portão de JavaScript, e um envio silencioso que apaga sem
 *  perguntar seria pior que o botão que não responde. O que a dívida pede é que a ação
 *  não se perca em silêncio — e ela não se perde onde o clique não destrói nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser, uniqueEmail } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

let tenantId: string;
let tenantSlug: string;
let adminEmail: string;
let eventId: string;
let registrationId: string;

async function signUpVia(api: Page['request'], name: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f50');
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

test.beforeAll(async ({ request }) => {
  const tenant = await createTenant({ label: 'f50-inline', name: `Instituição Sem JS ${RUN_ID}` });
  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const admin = await signUpVia(request, 'Administradora do Balcão');
  adminEmail = admin.email;
  await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
  await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });

  const evento = await e2eDb.event.create({
    data: {
      tenantId,
      slug: `f50-evento-${RUN_ID}`,
      title: 'Congresso da Confirmação',
      status: 'REGISTRATION_OPEN',
      modality: 'IN_PERSON',
      startsAt: new Date(Date.now() + 3 * 86_400_000),
      endsAt: new Date(Date.now() + 4 * 86_400_000),
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });

  eventId = evento.id;

  const atividade = await e2eDb.activity.create({
    data: {
      tenantId,
      eventId,
      slug: `f50-oficina-${RUN_ID}`,
      title: 'Oficina com doação',
      type: 'WORKSHOP',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: new Date(Date.now() + 3 * 86_400_000),
      endsAt: new Date(Date.now() + 3 * 86_400_000 + 3 * 3_600_000),
      workloadMinutes: 180,
      capacity: 5,
      requiresRegistration: true,
      confirmationPolicy: 'REQUIRED',
      confirmationWindowDays: 5,
      confirmationRequirements: [{ kind: 'DONATION', label: '1 kg de alimento', note: null }],
      confirmationPlace: 'Secretaria',
    },
    select: { id: true },
  });

  const pessoa = await signUpVia(request, 'Participante da Oficina');
  await linkUser({ userId: pessoa.id, tenantId, kind: 'PARTICIPANT' });

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const inscricao = await tx.registration.create({
      data: {
        tenantId,
        eventId,
        activityId: atividade.id,
        userId: pessoa.id,
        status: 'PENDING',
        confirmationDueAt: new Date(Date.now() + 5 * 86_400_000),
      },
      select: { id: true },
    });

    registrationId = inscricao.id;

    /**
     * O CHECKLIST nasce com a inscrição (FASE 37) e é ele que a fila do balcão mostra:
     * sem estas linhas a tela não tem o que resolver — e o teste mediria a fixture
     * vazia em vez da ação em linha.
     */
    await tx.registrationConfirmationItem.createMany({
      data: [
        {
          tenantId,
          registrationId: inscricao.id,
          position: 0,
          kind: 'DONATION',
          label: '1 kg de alimento',
          required: true,
          status: 'PENDING',
        },
        {
          tenantId,
          registrationId: inscricao.id,
          position: 1,
          kind: 'ITEM',
          label: '1 pacote de café',
          required: true,
          status: 'PENDING',
        },
      ],
    });
  });
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('ação em linha antes do bundle', () => {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  OS DOIS CENÁRIOS, E POR QUE OS DOIS
   * ─────────────────────────────────────────────────────────────────────────────
   *  1. **Sem JavaScript** (`javaScriptEnabled: false`) — o extremo: o `<form>` tem de
   *     ser um formulário HTML de verdade.
   *  2. **Com JavaScript, SEM o bundle** — a janela exata da dívida: a página já
   *     chegou, o React ainda não assumiu, e a pessoa clica. É o que acontece no
   *     celular de quem entra no balcão com a rede ruim.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O QUE A MEDIÇÃO MOSTROU (e por que a dívida virou catraca)
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O `InlineActionForm` entrou na FASE 17 com o medo de que o clique antes da
   *  hidratação se perdesse — a FASE 37 registrou "nenhum POST" na trilha de rede e a
   *  FASE 38 contornou o caso no quadro de demandas. Medido HOJE, com o React 19, os
   *  DOIS cenários enviam: o `<form>` renderizado no servidor é um formulário de
   *  verdade e o POST acontece sem o cliente.
   *
   *  A dívida, então, não se reproduz — e a resposta certa não é "nada a fazer": é
   *  deixar a MEDIÇÃO no lugar do medo. Se alguém trocar o formulário por um `onClick`
   *  (que era o desenho antigo), estes dois casos reprovam na hora.
   */
  test('SEM JavaScript o clique vira POST e resolve o item', async ({ browser }) => {
    const contexto = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();

    await signInAs(page as unknown as Page, adminEmail);
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/confirmacoes`);

    const botao = page.getByTestId(`receive-item-${registrationId}-0`);
    await expect(botao).toBeVisible({ timeout: 20_000 });

    await botao.click();
    await page.waitForLoadState('load');

    await expect
      .poll(async () => (await itemStatus(0)), { timeout: 30_000 })
      .not.toBe('PENDING');

    await contexto.close();
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A OUTRA METADE: MEDIDA, DOCUMENTADA E AINDA ABERTA (dívida E76)
   * ─────────────────────────────────────────────────────────────────────────────
   *  `fixme` aqui é MEDIÇÃO, não desistência: com o JavaScript ligado e o bundle
   *  AINDA CARREGANDO, o clique é absorvido pelo mecanismo de "replay" do React — ele
   *  intercepta o `submit` para reexecutá-lo depois da hidratação, e sem bundle não há
   *  hidratação para reexecutar. O item fica `PENDING`, sem erro na tela e sem linha no
   *  log: exatamente o sintoma que a FASE 37 descreveu.
   *
   *  Com o JavaScript DESLIGADO o mesmo formulário funciona (o caso acima passa), então
   *  o que falta é a janela do meio. As duas saídas conhecidas — um `<form>` com `action`
   *  de URL de verdade (rota que executa e redireciona) ou um caminho duplo
   *  React/nativo — mexem em TODAS as telas de operação e ficaram para uma fase própria,
   *  com a dívida registrada e o número medido aqui.
   */
  test.fixme('COM JavaScript e SEM o bundle, o clique também vira POST (dívida E76)', async ({ browser }) => {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();

    /**
     * O BUNDLE NÃO CARREGA: cada chunk do Next é abortado. A página chega íntegra (é
     * HTML do servidor) e o React nunca assume — exatamente a janela da dívida.
     */
    await page.route('**/_next/static/**', (route) => route.abort());

    await signInAs(page, adminEmail);
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/confirmacoes`);

    const botao = page.getByTestId(`receive-item-${registrationId}-1`);
    await expect(botao).toBeVisible({ timeout: 20_000 });

    await botao.click();
    await page.waitForLoadState('load');

    await expect
      .poll(async () => (await itemStatus(1)), { timeout: 30_000 })
      .not.toBe('PENDING');

    await contexto.close();
  });
});

/** O estado do item no banco — a prova de que o POST chegou ao servidor. */
async function itemStatus(position: number): Promise<string> {
  const item = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.registrationConfirmationItem.findFirst({
      where: { tenantId, registrationId, position },
      select: { status: true },
    });
  });

  return item?.status ?? 'PENDING';
}
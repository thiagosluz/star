import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — PAINEL DE PRONTIDÃO E ÁREAS DE GESTÃO (FASE 53)
 *
 *  A regra das pendências e o catálogo das áreas têm teste de unidade. O que só o
 *  navegador prova:
 *    • o painel diz o que FALTA, e aponta o caminho (a vaga retida leva à fila);
 *    • os quatro grupos aparecem com os seus cartões;
 *    • os atalhos que os E2E de OUTRAS fases usam continuam existindo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'painel-evento';

let tenantSlug: string;
let adminEmail: string;
let eventId: string;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f53.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()}`);

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

const eventoUrl = () => `/t/${tenantSlug}/administracao/eventos/${eventId}`;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({ label: TENANT_LABEL, name: `Instituicao Painel ${RUN_ID}` });
    tenantSlug = tenant.slug;

    const admin = await signUpVia(api, 'Administradora do Painel');
    adminEmail = admin.email;

    await linkUser({ userId: admin.id, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId: tenant.id, role: 'ADMIN', scope: 'TENANT' });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-painel-${RUN_ID}`,
      title: `Evento do Painel ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    eventId = event.id;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('painel de prontidão e áreas do evento', () => {
  test('1. o painel diz o que FALTA e leva ao caminho', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(eventoUrl());

    const painel = page.getByTestId('event-readiness');
    await expect(painel).toBeVisible({ timeout: 30_000 });

    /**
     * Este evento nasce em rascunho de programação: sem atividade e sem prazo de
     * inscrição. O painel precisa dizer isso — e não ficar vazio.
     */
    await expect(page.getByTestId('event-readiness-list')).toBeVisible();
    await expect(page.getByTestId('event-readiness-ok')).toHaveCount(0);

    /** Programação vazia é uma das pendências, e ela aponta para a seção da tela. */
    await expect(page.getByTestId('event-readiness-sem-programacao')).toBeVisible();
  });

  test('2. as áreas aparecem nos quatro grupos, com os atalhos de sempre', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(eventoUrl());

    await expect(page.getByTestId('event-areas-CONFIGURAR')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('event-areas-VITRINE')).toBeVisible();
    await expect(page.getByTestId('event-areas-OPERAR')).toBeVisible();

    /** O contrato com os E2E de outras fases: os atalhos continuam existindo. */
    await expect(page.getByTestId('calls-link')).toBeVisible();
    await expect(page.getByTestId('confirmations-link')).toBeVisible();
    await expect(page.getByTestId('raffles-link')).toBeVisible();

    /**
     * A ORDEM é a entrega: Configurar primeiro, Vitrine depois — e, desde a FASE 55,
     * **nenhuma sanfona na raiz**: as quatro seções que se editavam aqui viraram
     * páginas com cartão, e a raiz fica sendo prontidão + mapa.
     */
    const caixa = async (testId: string): Promise<number> => {
      const box = await page.getByTestId(testId).boundingBox();
      if (!box) throw new Error(`sem caixa para ${testId}`);
      return box.y;
    };

    const yConfigurar = await caixa('event-areas-CONFIGURAR');
    const yVitrine = await caixa('event-areas-VITRINE');

    /** Os cartões das áreas que saíram da raiz (FASE 55), todos no mesmo grupo. */
    await expect(page.getByTestId('event-area-dados')).toBeVisible();
    await expect(page.getByTestId('event-area-salas')).toBeVisible();
    await expect(page.getByTestId('event-area-programacao')).toBeVisible();

    expect(yConfigurar).toBeLessThan(yVitrine);

    /** Nenhuma `<details>` sobrou na raiz: o que se edita mora em página própria. */
    await expect(page.locator('main details')).toHaveCount(0);


    /** E existe UM lugar para ver o resultado público, com o verbo no rótulo. */
    const publico = page.getByTestId('event-areas-VITRINE').getByText('Ver página pública');
    await expect(publico).toBeVisible();

    /**
     * FASE 54 — O SELO DE CONTAGEM. O evento deste cenário nasceu agora: não tem
     * chamada, crachá nem vaga retida. O selo não pode ficar vazio nem mentir — ele
     * DIZ que não há, que é a informação que faz o organizador saber o que falta.
     */
    await expect(page.getByTestId('event-area-metric-chamadas')).toHaveText('nenhuma chamada');
    await expect(page.getByTestId('event-area-metric-crachas')).toHaveText('nenhum crachá emitido');
    await expect(page.getByTestId('event-area-metric-confirmacoes')).toHaveText('nenhuma vaga retida');

    /**
     * E o RECONHECIMENTO DO COMITÊ é RESULTADO — desde a FASE 55 como CARTÃO, no mesmo
     * padrão das outras áreas: a seção virou PÁGINA própria e a raiz só leva até ela.
     */
    await expect(page.getByTestId('event-area-reconhecimento')).toBeVisible();
    await page.getByTestId('event-area-reconhecimento').click();
    await expect(page).toHaveURL(/\/reconhecimento$/);
    await expect(page.getByTestId('reviewer-award-section')).toBeVisible();
  });

  test('3. o cartão leva à seção — a navegação continua funcionando', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(eventoUrl());

    await page.getByTestId('calls-link').click();
    await expect(page).toHaveURL(/\/chamadas$/);

    /**
     * A UNIFICAÇÃO DA FASE 53: a trilha é o eixo que a chamada usa para classificar a
     * submissão, então as duas telas viraram uma. A seção mantém o MESMO
     * `data-testid` (`tracks-section`) — é ele que os specs de rubrica usam.
     */
    await expect(page.getByTestId('tracks-section')).toBeVisible();
    await expect(page.getByText('Trilhas do evento')).toBeVisible();
  });
});

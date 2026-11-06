/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 89 — E2E DE `?evento=` DESCARTADO COM AVISO (`E89`) E SUPERFÍCIES DE
 *  PLATAFORMA FORA DO `.ef-theme` (`E90`)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Três cenários reais no navegador:
 *    1. `/credenciamento` com `?evento=` malformado e com UUID inexistente mostra
 *       o alerta `checkin-event-notice` e cai no primeiro evento publicado; com
 *       UUID válido do evento não exibe aviso.
 *    2. `/participantes` com `?evento=` malformado e com UUID inexistente mostra
 *       o alerta `participant-event-notice` e mantém a lista sem filtro; com UUID
 *       válido filtra sem aviso.
 *    3. `/t/<slug>/convite` e `/t/<slug>/palestrante/convite` (fora de `.ef-theme`)
 *       renderizam os cartões com fundo real (`backgroundColor !== rgba(0, 0, 0, 0)`),
 *       moldura (`borderTopWidth === '1px'`) e canto arredondado (`borderRadius === '12px'`),
 *       provando a quitação da dívida E90.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  RUN_ID,
  signOut,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = 'f89-query-tema';
const ID_MALFORMADO = 'nao-e-uuid';
const UUID_AUSENTE = randomUUID();

let tenantSlug: string;
let eventId: string;
let eventTitle: string;
let adminEmail: string;

async function signUpVia(
  request: APIRequestContext,
  prefix: string,
  name: string,
): Promise<{ email: string }> {
  const email = uniqueEmail(`f89-${prefix}`);

  const response = await request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(
      `Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`,
    );
  }

  return { email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await signOut(page);

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
  }
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da F89 ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    eventTitle = `Congresso da F89 ${RUN_ID}`;

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `f89-evento-${RUN_ID}`,
      title: eventTitle,
    });

    eventId = event.id;

    const admin = await signUpVia(api, 'admin', 'Admin da F89');
    const adminRow = await e2eDb.user.findUniqueOrThrow({
      where: { email: admin.email },
      select: { id: true },
    });
    await linkUser({ userId: adminRow.id, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: adminRow.id, tenantId: tenant.id, role: 'OWNER', scope: 'TENANT' });
    adminEmail = admin.email;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 89 · E89 (?evento= descartado com aviso) e E90 (cartão fora do .ef-theme)', () => {
  test('E89 · /credenciamento anuncia ?evento= malformado ou inexistente e silencia no UUID válido', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    const rMalformado = await page.goto(
      `/t/${tenantSlug}/credenciamento?evento=${ID_MALFORMADO}`,
    );
    expect(rMalformado?.status()).toBe(200);
    await expect(page.getByTestId('checkin-event-notice')).toBeVisible();
    await expect(page.getByTestId('checkin-event-notice')).toContainText(
      `O evento indicado no endereço foi descartado: o identificador não é válido. Exibindo "${eventTitle}".`,
    );

    const rAusente = await page.goto(
      `/t/${tenantSlug}/credenciamento?evento=${UUID_AUSENTE}`,
    );
    expect(rAusente?.status()).toBe(200);
    await expect(page.getByTestId('checkin-event-notice')).toBeVisible();
    await expect(page.getByTestId('checkin-event-notice')).toContainText(
      `O evento indicado no endereço não foi encontrado ou não está disponível para o seu acesso. Exibindo "${eventTitle}".`,
    );

    const rValido = await page.goto(`/t/${tenantSlug}/credenciamento?evento=${eventId}`);
    expect(rValido?.status()).toBe(200);
    await expect(page.getByTestId('checkin-event-notice')).toHaveCount(0);
  });

  test('E89 · /participantes anuncia ?evento= malformado ou inexistente e silencia no UUID válido', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    const rMalformado = await page.goto(
      `/t/${tenantSlug}/participantes?evento=${ID_MALFORMADO}`,
    );
    expect(rMalformado?.status()).toBe(200);
    await expect(page.getByTestId('participant-event-notice')).toBeVisible();
    await expect(page.getByTestId('participant-event-notice')).toContainText(
      'O filtro por evento foi descartado: o identificador no endereço não é válido. A lista continua sem esse filtro.',
    );

    const rAusente = await page.goto(
      `/t/${tenantSlug}/participantes?evento=${UUID_AUSENTE}`,
    );
    expect(rAusente?.status()).toBe(200);
    await expect(page.getByTestId('participant-event-notice')).toBeVisible();
    await expect(page.getByTestId('participant-event-notice')).toContainText(
      'O filtro por evento foi descartado: o evento informado no endereço não foi encontrado nesta instituição. A lista continua sem esse filtro.',
    );

    const rValido = await page.goto(`/t/${tenantSlug}/participantes?evento=${eventId}`);
    expect(rValido?.status()).toBe(200);
    await expect(page.getByTestId('participant-event-notice')).toHaveCount(0);
  });

  test('E90 · /convite e /palestrante/convite (fora de .ef-theme) têm fundo, borda de 1px e raio de 24px nos cartões', async ({
    page,
  }) => {
    await signOut(page);

    const rConvite = await page.goto(`/t/${tenantSlug}/convite`);
    expect(rConvite?.status()).toBe(200);

    const cartaoConvite = page.getByTestId('invitation-not-found');
    await expect(cartaoConvite).toBeVisible();

    const estiloConvite = await cartaoConvite.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        borderTopWidth: cs.borderTopWidth,
        borderRadius: cs.borderRadius,
      };
    });

    expect(estiloConvite.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(estiloConvite.borderTopWidth).toBe('1px');
    expect(estiloConvite.borderRadius).toBe('24px');

    const rPalestrante = await page.goto(`/t/${tenantSlug}/palestrante/convite`);
    expect(rPalestrante?.status()).toBe(200);

    const cartaoPalestrante = page.locator('main > div.rounded-xl').first();
    await expect(cartaoPalestrante).toBeVisible();

    const estiloPalestrante = await cartaoPalestrante.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        borderTopWidth: cs.borderTopWidth,
        borderRadius: cs.borderRadius,
      };
    });

    expect(estiloPalestrante.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(estiloPalestrante.borderTopWidth).toBe('1px');
    expect(estiloPalestrante.borderRadius).toBe('24px');
  });
});


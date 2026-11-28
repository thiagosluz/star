/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 131 — E2E: Estúdio Visual de Certificados (Estilo Canva)
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

const ORIGEM = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const PASSWORD = 'Koveno#2026';

let tenantSlug: string;
let tenantId: string;
let ownerEmail: string;
let eventId: string;

async function signUpOwner(api: APIRequestContext): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f131-owner');
  const res = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name: 'Owner F131', email, password: PASSWORD },
  });
  expect(res.ok(), `sign-up ${email} respondeu ${res.status()}`).toBe(true);

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return { id: user.id, email };
}

async function signInAsOwner(page: Page): Promise<void> {
  await signOut(page, ORIGEM);
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGEM },
    data: { email: ownerEmail, password: PASSWORD },
  });
  expect(res.ok(), `sign-in ${ownerEmail} respondeu ${res.status()}`).toBe(true);
}

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: ORIGEM });
  try {
    const tenant = await createTenant({
      label: 'f131-estudio',
      name: `Instituição Estúdio F131 ${RUN_ID}`,
    });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const owner = await signUpOwner(api);
    ownerEmail = owner.email;

    await linkUser({ tenantId, userId: owner.id });
    await grantRole({ tenantId, userId: owner.id, role: 'OWNER' });

    const event = await createEvent({
      tenantId,
      slug: `evento-f131-${randomUUID().slice(0, 6)}-${RUN_ID}`,
      title: `Congresso Estúdio F131 ${RUN_ID}`,
      status: 'PUBLISHED',
    });
    eventId = event.id;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('FASE 131 — Estúdio Visual de Certificados (Estilo Canva)', () => {
  test('monta certificado com bloco rápido, palco WYSIWYG, inspetor contextual, desfazer/refazer e salva', async ({
    page,
  }) => {
    await signInAsOwner(page);
    await page.goto(
      `/t/${tenantSlug}/administracao/eventos/${eventId}/certificados/modelos?novo=classico-institucional`,
    );

    await expect(page.getByTestId('studio-toolbar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('studio-inspector')).toBeVisible();

    const initialCount = await page.locator('[data-testid^="stage-element-"]').count();
    await page.getByTestId('studio-add-signature').click();
    await expect(page.locator('[data-testid^="stage-element-"]')).toHaveCount(initialCount + 1);

    const newStageEl = page.getByTestId(`stage-element-${initialCount}`);
    await expect(newStageEl).toContainText('Coordenação Geral do Evento');

    await page.getByTestId('inspector-text').fill('Diretoria Acadêmica F131');
    await expect(newStageEl).toContainText('Diretoria Acadêmica F131');

    await page.getByTestId('inspector-swatch-4f46e5').click();
    await page.getByTestId('studio-center-x').click();

    await page.getByTestId('studio-undo').click();
    await page.getByTestId('studio-redo').click();

    await page.getByTestId('template-name').fill(`Estúdio Canva F131 ${RUN_ID}`);
    await page.getByTestId('template-submit').click();
    await expect(page.getByTestId('template-saved')).toBeVisible({ timeout: 20_000 });
  });
});

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { RUN_ID, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { withTenant } from '../../src/lib/db/tenant-client';
import { sendParticipantMessage } from '../../src/lib/participants/message-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FATIA 4 DO MUTIRÃO DA JORNADA — a resposta do recado (dívida E45)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O que a pessoa encontra pelo navegador: o recado da instituição na caixa de
 *  entrada, o campo de resposta DENTRO dele e, depois de enviar, a própria resposta
 *  na conversa. E o que a instituição passa a ver: "respondeu", na ficha.
 *
 *  O recado é enviado pelo SERVIÇO (o caminho da tela de envio tem spec próprio) —
 *  o que este cenário mede é a RESPOSTA.
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f56-fatia4-${RUN_ID}`;

let tenantId: string;
let tenantSlug: string;
let pessoa: { id: string; email: string };
let equipe: { id: string; email: string };
let messageId: string;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f56f4.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Fatia 4 ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    pessoa = await signUpVia(api, 'Pessoa que responde');
    equipe = await signUpVia(api, 'Equipe que envia');

    /** A pessoa é do PÚBLICO; a equipe organiza (é dela o papel que envia recado). */
    await linkUser({ tenantId, userId: pessoa.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: pessoa.id, role: 'PARTICIPANT' });

    await linkUser({ tenantId, userId: equipe.id });
    await grantRole({ tenantId, userId: equipe.id, role: 'ADMIN' });

    const enviado = await sendParticipantMessage({
      tenantId,
      tenantSlug,
      actorId: equipe.id,
      userIds: [pessoa.id],
      subject: 'Sobre o seu credenciamento',
      body: 'Você retirou o crachá? Precisamos confirmar a sua presença na portaria.',
    });

    if (!enviado.ok) throw new Error(`Falha ao enviar o recado: ${enviado.message}`);

    const recado = await withTenant(tenantId, (tx) =>
      tx.participantMessage.findFirstOrThrow({
        where: { tenantId, userId: pessoa.id, parentId: null },
        select: { id: true },
      }),
    );

    messageId = recado.id;
  } finally {
    await api.dispose();
  }
});

test('a pessoa responde o recado e vê a resposta na conversa', async ({ page }) => {
  await signInAs(page, pessoa.email);
  await page.goto(`/t/${tenantSlug}/minhas-mensagens`);

  const recado = page.getByTestId(`inbox-message-${messageId}`);
  await expect(recado).toBeVisible({ timeout: 30_000 });
  await expect(recado).toContainText('Você retirou o crachá?');

  /** O campo de resposta está DENTRO do recado — responder é responder àquilo. */
  await page.getByTestId(`inbox-reply-body-${messageId}`).fill('Retirei sim, na terça de manhã.');
  await page.getByTestId(`inbox-reply-submit-${messageId}`).click();

  await expect(page.getByTestId(`inbox-reply-result-${messageId}`)).toContainText(/enviada/i, {
    timeout: 30_000,
  });

  /** E a conversa mostra a resposta, com o nome de quem escreveu. */
  const conversa = page.getByTestId(`inbox-thread-${messageId}`);
  await expect(conversa).toBeVisible();
  await expect(conversa).toContainText('Retirei sim, na terça de manhã.');

  const row = await withTenant(tenantId, (tx) =>
    tx.participantMessage.findFirstOrThrow({
      where: { tenantId, parentId: messageId, direction: 'INBOUND' },
      select: { body: true, sentById: true },
    }),
  );

  expect(row.body).toContain('Retirei sim');
  expect(row.sentById).toBe(pessoa.id);
});

test('a instituição vê "respondeu" na ficha da pessoa', async ({ page }) => {
  await signInAs(page, equipe.email);
  await page.goto(`/t/${tenantSlug}/participantes/${pessoa.id}`);

  const indicador = page.getByTestId(`profile-message-reply-${messageId}`);
  await expect(indicador).toBeVisible({ timeout: 30_000 });
  await expect(indicador).toContainText(/respondeu/i);
  await expect(indicador).toHaveAttribute('data-replied', '1');
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A OCULTAÇÃO DO PERFIL SUMA DAS SUPERFÍCIES QUE CITAM A PESSOA
 *  (FASE 60 · dívida E79)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE CENÁRIO PROVA, DE PONTA A PONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a pessoa tem perfil público ATIVO, está na equipe do evento (que o
 *         organizador põe na página publicada) e tem uma carta com link selado;
 *      2. as DUAS superfícies a citam: o cartão "Equipe do evento" mostra o nome e a
 *         etiqueta, e o link público mostra "Conquistada por <nome>";
 *      3. a moderação da plataforma decide OCULTAR pelo SERVIÇO REAL
 *         (`src/lib/platform/profile-moderation.ts`), não pela tela — a decisão
 *         atravessa o mesmo caminho do SuperAdmin;
 *      4. o cartão da equipe desaparece (e o COLEGA continua lá: a régua é da pessoa,
 *         não um blecaute da página);
 *      5. o link selado continua ABRINDO, sem nome, sem `@handle` e sem foto — a
 *         decisão da F60 (ver o PORQUÊ em `card-share-service.ts`).
 *
 *  A ORDEM importa e o arquivo roda em série: cada cenário depende do anterior, e o
 *  estado durável é o BANCO (o `reportId` da decisão é lido de volta de lá).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
} from './helpers';
import { decideReport } from '../../src/lib/platform/profile-moderation';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f60-ocultacao-${RUN_ID}`;
const CARD_SLUG = `guardiao-f60-${RUN_ID}`;
const CARD_NAME = 'Guardião do Método';

const HANDLE = `pessoa-oculta-${RUN_ID}`;
const NOME_PESSOA = `Ana Oculta ${RUN_ID}`;
const NOME_COLEGA = `Bruno Visivel ${RUN_ID}`;
const FOTO = `https://acervo.exemplo.test/${RUN_ID}/ana.webp`;

const NOTA = 'O perfil publica dado de terceiro sem autorizacao; medida confirmada na analise.';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;

let pessoa: { id: string; email: string };
let colegaId: string;
let organizadoraEmail: string;
let moderadorId: string;

/** O token do link selado, criado pela TELA no cenário 1 e usado no cenário 2. */
let token = '';

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f60.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** A carta no álbum da pessoa — a mesma fixture que o E2E do link usa (FASE 51). */
async function giveCard(userId: string): Promise<void> {
  const templateId = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.cardTemplate.create({
      data: {
        id: templateId,
        tenantId,
        slug: CARD_SLUG,
        name: CARD_NAME,
        description: 'Concedida por concluir um parecer.',
        lore: 'O trabalho invisível que sustenta a ciência',
        rarity: 'LEGENDARY',
        trigger: 'REVIEW_COMPLETED',
      },
    });

    await tx.userCard.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId,
        cardTemplateId: templateId,
        quantity: 1,
        source: 'REVIEW_COMPLETED',
        grantedAt: new Date('2026-03-12T15:00:00Z'),
      },
    });
  });
}

test.describe.configure({ mode: 'serial' });

// ═══════════════════════════════════════════════════════════════════════════════
test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Ocultação ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'Congresso da Ocultação',
    });

    eventId = event.id;
    eventSlug = event.slug;

    pessoa = await signUpVia(api, NOME_PESSOA);
    const colega = await signUpVia(api, NOME_COLEGA);
    const organizadora = await signUpVia(api, `Organizadora F60 ${RUN_ID}`);
    const moderador = await signUpVia(api, `Moderador F60 ${RUN_ID}`);

    colegaId = colega.id;
    organizadoraEmail = organizadora.email;
    moderadorId = moderador.id;

    await grantPlatformRole({ userId: moderador.id });

    await linkUser({ tenantId, userId: pessoa.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: pessoa.id, role: 'PARTICIPANT' });

    await linkUser({ tenantId, userId: colega.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: colega.id, role: 'PARTICIPANT' });

    await linkUser({ tenantId, userId: organizadora.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: organizadora.id, role: 'ADMIN' });

    /**
     * O perfil público da pessoa nasce aqui, direto no banco: o cenário é sobre o
     * EFEITO da ocultação, e publicar o perfil pela tela tem spec próprio
     * (`public-profile.spec.ts`) — a mesma escolha do E2E da moderação (F56).
     */
    await e2eDb.user.update({
      where: { id: pessoa.id },
      data: {
        publicHandle: HANDLE,
        image: FOTO,
        headline: 'Pesquisadora em saúde pública',
        profileAudiences: { displayName: 'PUBLIC', avatar: 'PUBLIC' },
      },
    });

    /** A equipe do evento com as duas pessoas: a ocultada e o contraste. */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.eventTeam.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          name: 'Presidência',
          members: {
            create: [
              { id: randomUUID(), tenantId, userId: pessoa.id, isLead: true },
              { id: randomUUID(), tenantId, userId: colega.id },
            ],
          },
        },
      });
    });

    await giveCard(pessoa.id);
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  if (tenantId) {
    const reports = await e2eDb.profileReport.findMany({
      where: { tenantId },
      select: { id: true },
    });

    /** A trilha da decisão é de PLATAFORMA (sem tenant) e não cai com a exclusão. */
    await e2eDb.auditLog.deleteMany({
      where: { entityType: 'profile_report', entityId: { in: reports.map((row) => row.id) } },
    });
  }

  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
test('1. o bloco da equipe e o link selado citam a pessoa', async ({ page, browser, baseURL }) => {
  // ── A página do evento, com o bloco "Equipe do evento", publicada ──────────
  await signInAs(page, organizadoraEmail);
  await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/pagina`);

  if (await page.getByTestId('create-page').isVisible().catch(() => false)) {
    await page.getByTestId('create-page').getByTestId('admin-submit').click();
  }

  const adicionar = page.getByTestId('add-block');
  await adicionar.getByLabel('Tipo de bloco').selectOption('TEAM');
  await adicionar.getByTestId('admin-submit').click();

  await expect(page.locator('[data-type="TEAM"]').first()).toBeVisible({ timeout: 30_000 });

  const publicacao = page.getByTestId('save-page');
  await publicacao.getByLabel('Publicar a página agora').check();
  await publicacao.getByTestId('admin-submit').click();
  await expect(page.getByTestId('landing-status')).toContainText('Publicada', { timeout: 30_000 });

  // ── O link selado, criado pela TELA de quem conquistou a carta ─────────────
  await signInAs(page, pessoa.email);
  await page.goto(`/t/${tenantSlug}/cartas/${CARD_SLUG}`);

  await page.getByTestId('share-create').click();

  const shareUrl = page.getByTestId('share-url');
  await expect(shareUrl).toHaveValue(/\/carta\/[A-Za-z0-9_-]{16,}$/, { timeout: 20_000 });

  token = (await shareUrl.inputValue()).split('/').pop() ?? '';
  expect(token.length).toBeGreaterThan(15);

  // ── As DUAS superfícies, vistas por quem não tem sessão ───────────────────
  const anonimo = await browser.newContext({ baseURL });
  const visitante = await anonimo.newPage();

  try {
    await visitante.goto(`/t/${tenantSlug}/eventos/${eventSlug}`);

    const equipe = visitante.getByTestId('team-block');
    await expect(equipe).toBeVisible({ timeout: 30_000 });
    await expect(equipe).toContainText(NOME_PESSOA);
    await expect(equipe).toContainText('Presidência');
    await expect(equipe.getByTestId('team-card')).toHaveCount(2);

    const carta = await visitante.goto(`/t/${tenantSlug}/carta/${token}`);
    expect(carta?.status()).toBe(200);

    await expect(visitante.getByTestId('shared-card-title')).toHaveText(CARD_NAME);
    await expect(visitante.getByTestId('shared-card-owner')).toContainText(NOME_PESSOA);
    await expect(visitante.getByTestId('shared-card-owner')).not.toContainText(HANDLE);
  } finally {
    await anonimo.close();
  }
});

test('2. a moderação oculta o perfil pelo serviço real da plataforma', async () => {
  const reported = await reportPublicProfile({
    tenantId,
    reporterUserId: colegaId,
    username: HANDLE,
    category: 'PRIVACY',
    details: 'O perfil publica o telefone de uma terceira pessoa, sem autorização dela.',
  });

  expect(reported.ok, reported.ok ? 'ok' : reported.message).toBe(true);
  if (!reported.ok) return;

  const decidida = await decideReport({
    reportId: reported.reportId,
    action: 'HIDE',
    note: NOTA,
    actorId: moderadorId,
  });

  expect(decidida.ok, decidida.ok ? 'ok' : decidida.message).toBe(true);
  if (!decidida.ok) return;

  expect(decidida.hiddenProfile).toBe(true);

  /** O efeito é lido do BANCO: a medida vale para a pessoa, e ocultar NÃO apaga. */
  const pessoaNoBanco = await e2eDb.user.findUniqueOrThrow({
    where: { id: pessoa.id },
    select: { publicProfileHiddenAt: true, publicProfileHiddenReason: true, publicHandle: true },
  });

  expect(pessoaNoBanco.publicProfileHiddenAt).not.toBeNull();
  expect(pessoaNoBanco.publicProfileHiddenReason).toBe(NOTA);
  expect(pessoaNoBanco.publicHandle).toBe(HANDLE);
});

test('3. o bloco da equipe deixa de citar a pessoa — e o colega continua lá', async ({
  browser,
  baseURL,
}) => {
  const anonimo = await browser.newContext({ baseURL });
  const visitante = await anonimo.newPage();

  try {
    await visitante.goto(`/t/${tenantSlug}/eventos/${eventSlug}`);

    const equipe = visitante.getByTestId('team-block');
    await expect(equipe).toBeVisible({ timeout: 30_000 });

    /** O colega continua: o bloco não desaparece — some a PESSOA ocultada. */
    await expect(equipe).toContainText(NOME_COLEGA);
    await expect(equipe.getByTestId('team-card')).toHaveCount(1);

    await expect(equipe).not.toContainText(NOME_PESSOA);

    /** Nem no HTML servido: a checagem é sobre a página inteira, e não só na grade. */
    const html = await visitante.content();
    expect(html).not.toContain(NOME_PESSOA);
    expect(html).not.toContain(HANDLE);
    expect(html).not.toContain(FOTO);
  } finally {
    await anonimo.close();
  }
});

test('4. o link selado continua ABRINDO, sem a identidade de quem foi ocultado', async ({
  browser,
  baseURL,
}) => {
  const anonimo = await browser.newContext({ baseURL });
  const visitante = await anonimo.newPage();

  try {
    const resposta = await visitante.goto(`/t/${tenantSlug}/carta/${token}`);

    /** A carta não é apagada pela medida — o que sai é a identidade (decisão da F60). */
    expect(resposta?.status()).toBe(200);

    await expect(visitante.getByTestId('shared-card-title')).toHaveText(CARD_NAME);

    const dono = visitante.getByTestId('shared-card-owner');
    await expect(dono).toContainText('Uma pessoa desta instituição');
    await expect(dono).not.toContainText(NOME_PESSOA);
    await expect(dono).not.toContainText(HANDLE);

    /**
     * E a decisão de moderação NÃO vira legenda: o token é compartilhado, e anunciar
     * "oculto pela moderação" contaria a medida a quem tem o link.
     */
    const html = await visitante.content();
    expect(html).not.toContain(NOME_PESSOA);
    expect(html).not.toContain(HANDLE);
    expect(html).not.toContain(FOTO);
    expect(html).not.toMatch(/por decis[ãa]o da modera/i);
  } finally {
    await anonimo.close();
  }
});

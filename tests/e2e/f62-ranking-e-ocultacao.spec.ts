/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O RANKING DE CONQUISTAS NÃO CITA QUEM A MODERAÇÃO OCULTOU
 *  (FASE 62 · dívida E80)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE CENÁRIO PROVA, DE PONTA A PONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a tela `/t/<slug>/conquistas` mostra a pessoa por inteiro enquanto não há
 *         decisão de moderação (o "antes" é medido, não presumido);
 *      2. a moderação da plataforma decide OCULTAR pelo SERVIÇO REAL
 *         (`src/lib/platform/profile-moderation.ts`), não pela tela — a decisão
 *         atravessa o mesmo caminho do SuperAdmin;
 *      3. o ranking deixa de citar a identidade: o nome sai abreviado (`Ana S.`) e o
 *         `@handle` e a foto não aparecem em lugar nenhum do HTML servido;
 *      4. a LINHA continua na lista, na MESMA posição, com o MESMO XP — é a decisão
 *         da dívida (posição e contagem são o conteúdo de um ranking), e é o que
 *         separa esta superfície da vitrine da equipe, onde a pessoa some;
 *      5. quem NÃO foi ocultado continua aparecendo por inteiro: a régua é da PESSOA,
 *         e não um blecaute da tela.
 *
 *  A ORDEM importa e o arquivo roda em série: cada cenário depende do anterior, e o
 *  estado durável é o BANCO (nada é guardado em variável de um teste para o outro
 *  além do identificador do cenário).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
} from './helpers';
import { decideReport } from '../../src/lib/platform/profile-moderation';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f62-ranking-${RUN_ID}`;

const HANDLE = `ana-oculta-${RUN_ID}`;
/**
 * O nome tem DUAS palavras de propósito: a máscara é por palavra (`Ana Oculta` →
 * `Ana O.`), e um nome com o sufixo da execução viraria três termos e uma abreviação
 * imprevisível — o teste estaria prendendo o sufixo, não a decisão.
 */
const NOME_PESSOA = 'Ana Oculta';
const NOME_MASCARADO = 'Ana O.';
const NOME_COLEGA = 'Bruno Visivel';
const FOTO = `https://acervo.exemplo.test/${RUN_ID}/ana.webp`;

/** O XP das duas pessoas: a pessoa ocultada lidera, e é ela que a lista destaca. */
const XP_PESSOA = 4_120;
const XP_COLEGA = 1_850;

const NOTA = 'O perfil publica dado de terceiro sem autorizacao; medida confirmada na analise.';

let tenantId: string;
let tenantSlug: string;

let pessoa: { id: string; email: string };
let colega: { id: string; email: string };
let moderadorId: string;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f62.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** O perfil de XP é o que coloca a pessoa no ranking (`totalXp > 0`). */
async function giveXp(userId: string, totalXp: number): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.userXpProfile.create({
      data: { id: randomUUID(), tenantId, userId, totalXp, level: 3, cardsCollected: 2 },
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
      name: `Instituição do Ranking ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    pessoa = await signUpVia(api, NOME_PESSOA);
    colega = await signUpVia(api, NOME_COLEGA);
    const moderador = await signUpVia(api, `Moderador F62 ${RUN_ID}`);

    moderadorId = moderador.id;

    await grantPlatformRole({ userId: moderador.id });

    for (const user of [pessoa, colega]) {
      await linkUser({ tenantId, userId: user.id, kind: 'MEMBER' });
      await grantRole({ tenantId, userId: user.id, role: 'PARTICIPANT' });
    }

    await giveXp(pessoa.id, XP_PESSOA);
    await giveXp(colega.id, XP_COLEGA);

    /**
     * A identidade pública nasce aqui, direto no banco: o cenário é sobre o EFEITO da
     * ocultação no ranking, e publicar o perfil pela tela tem spec próprio
     * (`public-profile.spec.ts`) — a mesma escolha do E2E da F60.
     */
    await e2eDb.user.update({
      where: { id: pessoa.id },
      data: { publicHandle: HANDLE, image: FOTO },
    });
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
test('1. antes da decisão, o ranking mostra a pessoa por inteiro', async ({ page }) => {
  await signInAs(page, colega.email);
  await page.goto(`/t/${tenantSlug}/conquistas`);

  const ranking = page.getByTestId('leaderboard');
  await expect(ranking).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId('leaderboard-1')).toContainText(NOME_PESSOA);
  await expect(page.getByTestId('leaderboard-1')).toContainText('4.120');
  await expect(page.getByTestId('leaderboard-2')).toContainText(NOME_COLEGA);
});

// ═══════════════════════════════════════════════════════════════════════════════
test('2. a moderação oculta o perfil pelo serviço real da plataforma', async () => {
  const reported = await reportPublicProfile({
    tenantId,
    reporterUserId: colega.id,
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

  /** O efeito é lido do BANCO: a medida vale para a PESSOA, e ocultar NÃO apaga. */
  const pessoaNoBanco = await e2eDb.user.findUniqueOrThrow({
    where: { id: pessoa.id },
    select: { publicProfileHiddenAt: true, publicHandle: true },
  });

  expect(pessoaNoBanco.publicProfileHiddenAt).not.toBeNull();
  expect(pessoaNoBanco.publicHandle).toBe(HANDLE);
});

// ═══════════════════════════════════════════════════════════════════════════════
test('3. o ranking deixa de citar a identidade — e a linha CONTINUA na lista', async ({
  page,
}) => {
  await signInAs(page, colega.email);
  await page.goto(`/t/${tenantSlug}/conquistas`);

  const ranking = page.getByTestId('leaderboard');
  await expect(ranking).toBeVisible({ timeout: 30_000 });

  /**
   * A posição e o XP NÃO mudam: é a decisão da dívida (mascarar, e não remover) — a
   * lista que encolhesse mentiria sobre o próprio tamanho e sobre a posição de todos.
   */
  await expect(page.getByTestId('leaderboard-1')).toContainText(NOME_MASCARADO);
  await expect(page.getByTestId('leaderboard-1')).toContainText('4.120');
  await expect(page.getByTestId('leaderboard-2')).toContainText(NOME_COLEGA);

  /** Duas linhas antes, duas depois: a contagem do painel continua batendo. */
  await expect(ranking.locator('[data-testid^="leaderboard-"]')).toHaveCount(2);

  await expect(ranking).not.toContainText(NOME_PESSOA);

  /** Nem no HTML servido: a checagem é sobre a página inteira, e não só na grade. */
  const html = await page.content();

  expect(html).not.toContain(NOME_PESSOA);
  expect(html).not.toContain(HANDLE);
  expect(html).not.toContain(FOTO);

  /**
   * E a decisão de moderação NÃO vira legenda: anunciar "perfil oculto" contaria a
   * medida da plataforma a colegas — a lição que o link selado da carta fixou.
   */
  expect(html).not.toMatch(/por decis[ãa]o da modera/i);
  expect(html).not.toMatch(/perfil oculto/i);
});

// ═══════════════════════════════════════════════════════════════════════════════
test('4. a própria pessoa ocultada continua vendo o ranking (a régua é da identidade)', async ({
  page,
}) => {
  await signInAs(page, pessoa.email);
  await page.goto(`/t/${tenantSlug}/conquistas`);

  const ranking = page.getByTestId('leaderboard');
  await expect(ranking).toBeVisible({ timeout: 30_000 });

  /**
   * A pessoa não perde o acesso ao próprio painel: o que sai é a CITAÇÃO pública da
   * identidade nas superfícies — o XP, a posição e o fato continuam sendo dela.
   */
  await expect(page.getByTestId('leaderboard-1')).toContainText('4.120');
  await expect(ranking.locator('[data-testid^="leaderboard-"]')).toHaveCount(2);
});

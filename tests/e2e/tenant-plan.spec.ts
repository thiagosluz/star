/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — QUOTAS E PLANOS (FASE 14: C1, C3, I4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, E POR QUE SÓ O NAVEGADOR PODE PROVAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A quota `maxMembers` era decorativa porque NÃO HAVIA caminho de escrita para
 *  vínculo de equipe (vincular era SQL ou seed). Um teste de serviço provaria a
 *  função; o que precisa ser provado é que existe um fluxo — com formulário,
 *  recusa legível e caminho de saída — e que a instituição enxerga a diferença
 *  entre EQUIPE e PÚBLICO na própria tela.
 *
 *  Os cenários, na ordem em que acontecem na operação real:
 *    1. o SuperAdmin provisiona a instituição e ela nasce com as QUOTAS DO PLANO
 *       (inclusive armazenamento) e as edita depois;
 *    2. a instituição abre a tela de Equipe e vê equipe e participantes separados;
 *    3. participante NÃO entra na tela de equipe (autorização, não cosmética);
 *    4. a quota RECUSA o vínculo quando está cheia, avisa quando o plano é reduzido
 *       abaixo do uso e libera quando o plano é ajustado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, e2eDb, grantPlatformRole, grantRole, linkUser, uniqueEmail } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

const TENANT_SLUG = `plano-${RUN_ID}`;
const TENANT_NAME = `Instituto Quotas ${RUN_ID}`;

const ownerEmail = uniqueEmail('f14.owner');
const superAdminEmail = uniqueEmail('f14.super');
const memberEmail = uniqueEmail('f14.membro');
const participantEmail = uniqueEmail('f14.participante');

let superAdminId: string;
let memberId: string;
let participantId: string;

/**
 * A instituição é resolvida pelo SLUG, no banco, a cada uso.
 *
 * A primeira versão guardava o id numa variável preenchida pelo primeiro teste, e o
 * quarto teste recebeu `undefined` — a suíte só passava na ordem em que foi escrita.
 * O estado durável é o banco (mesma lição do E2E de governança da FASE 9).
 */
async function tenantRef(): Promise<{ id: string }> {
  return e2eDb.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG }, select: { id: true } });
}

async function signUp(api: APIRequestContext, name: string, email: string): Promise<string> {
  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return user.id;
}

async function signInAs(page: Page, email: string): Promise<void> {
  // Múltiplos cadastros no mesmo contexto reutilizariam a sessão anterior.
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/** Abre o detalhe da instituição no painel de governança. */
async function openTenantDetail(page: Page): Promise<void> {
  await signInAs(page, superAdminEmail);

  const { id } = await tenantRef();
  const response = await page.goto(`/superadmin/tenants/${id}`);

  expect(response?.status()).toBe(200);
  await expect(page.getByTestId('platform-tenant-detail')).toBeVisible();
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    superAdminId = await signUp(api, `SuperAdmin ${RUN_ID}`, superAdminEmail);
    // O proprietário é designado no provisionamento (feito pela interface, no
    // primeiro teste); aqui só a conta precisa existir.
    await signUp(api, `Proprietária ${RUN_ID}`, ownerEmail);
    memberId = await signUp(api, `Membro ${RUN_ID}`, memberEmail);
    participantId = await signUp(api, `Participante ${RUN_ID}`, participantEmail);

    await grantPlatformRole({ userId: superAdminId });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  const tenants = await e2eDb.tenant.findMany({
    where: { slug: TENANT_SLUG },
    select: { id: true },
  });

  await e2eDb.auditLog.deleteMany({
    where: { tenantId: null, entityId: { in: tenants.map((tenant) => tenant.id) } },
  });
  await e2eDb.tenant.deleteMany({ where: { slug: TENANT_SLUG } });

  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('quotas e planos', () => {
  test('1. a instituição nasce com as quotas do plano e o SuperAdmin as edita', async ({ page }) => {
    await signInAs(page, superAdminEmail);

    await page.goto('/superadmin/tenants');

    const form = page.getByTestId('provision-form');
    await form.getByTestId('provision-name').fill(TENANT_NAME);
    await form.getByTestId('provision-slug').fill(TENANT_SLUG);
    await form.getByTestId('provision-plan').selectOption('FREE');
    await form.getByTestId('provision-owner-email').fill(ownerEmail);
    await form.getByTestId('provision-submit').click();

    await expect(page.getByTestId('provision-feedback')).toContainText(/criada/i, {
      timeout: 30_000,
    });

    const tenant = await e2eDb.tenant.findUniqueOrThrow({
      where: { slug: TENANT_SLUG },
      select: { id: true, plan: true, maxEvents: true, maxMembers: true, maxStorageBytes: true },
    });

    // As TRÊS quotas vêm do plano. O armazenamento era o que ficava no default do
    // schema (5 GiB) para qualquer plano — o defeito que a FASE 14 consertou.
    expect(tenant.plan).toBe('FREE');
    expect(tenant.maxEvents).toBe(3);
    expect(tenant.maxMembers).toBe(100);
    expect(Number(tenant.maxStorageBytes)).toBe(5 * 1024 ** 3);

    // ── Troca de plano pela interface ───────────────────────────────────────
    await openTenantDetail(page);

    const planForm = page.getByTestId('tenant-plan-form');
    await planForm.getByTestId('plan-change-select').selectOption('PROFESSIONAL');
    await planForm.getByTestId('plan-use-defaults').check();
    await planForm.getByTestId('plan-submit').click();

    await expect(page.getByTestId('tenant-plan-feedback')).toContainText(/Plano atualizado/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('tenant-plan-feedback')).toContainText('PROFESSIONAL');

    const updated = await e2eDb.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
      select: { plan: true, maxEvents: true, maxMembers: true, maxStorageBytes: true },
    });

    expect(updated.plan).toBe('PROFESSIONAL');
    expect(updated.maxEvents).toBe(50);
    expect(updated.maxMembers).toBe(5_000);
    expect(Number(updated.maxStorageBytes)).toBe(100 * 1024 ** 3);

    // A trilha de plataforma registra a mudança (sem tenant: é ato de plataforma).
    const audit = await e2eDb.auditLog.findFirst({
      where: { entityId: tenant.id, entityType: 'TenantPlan' },
      select: { tenantId: true, changes: true },
    });

    expect(audit?.tenantId).toBeNull();
    expect(JSON.stringify(audit?.changes)).toContain('PROFESSIONAL');
  });

  test('2. a instituição vê equipe e participantes separados', async ({ page }) => {
    const { id: tenantId } = await tenantRef();

    // Fixture do PÚBLICO: um vínculo de participante, como o que a inscrição
    // pública cria (o fluxo de inscrição em si é coberto pela FASE 10 e pelo teste
    // de integração da FASE 14).
    await linkUser({ tenantId, userId: participantId, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: participantId, role: 'PARTICIPANT' });

    await signInAs(page, ownerEmail);

    const response = await page.goto(`/t/${TENANT_SLUG}/administracao/equipe`);
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId('team-page')).toBeVisible();
    await expect(page.getByTestId('team-member-count')).toContainText('1');
    await expect(page.getByTestId('team-participant-count')).toContainText('1');

    const membersTable = page.getByTestId('team-members');

    await expect(membersTable).toContainText(ownerEmail);
    // O participante NÃO responde pela instituição — o defeito (I4) era exatamente
    // ele aparecendo aqui.
    await expect(membersTable).not.toContainText(participantEmail);
    await expect(page.getByTestId('team-participants')).toContainText(/acesso de participante/i);
  });

  test('3. participante não entra na tela de equipe', async ({ page }) => {
    await signInAs(page, participantEmail);

    // A guarda redireciona ao painel: negar com redirecionamento evita revelar a
    // existência de dado que a pessoa não pode ver.
    await page.goto(`/t/${TENANT_SLUG}/administracao/equipe`);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('team-page')).toHaveCount(0);
  });

  test('4. a quota recusa o vínculo, avisa na redução e libera no ajuste', async ({ page }) => {
    const { id: tenantId } = await tenantRef();

    await openTenantDetail(page);

    const memberForm = page.getByTestId('tenant-member-form');
    const planForm = page.getByTestId('tenant-plan-form');

    // ── Quota cheia: 1 membro (o proprietário) e teto de 1 ───────────────────
    await planForm.getByTestId('plan-use-defaults').uncheck();
    await planForm.getByTestId('plan-max-events').fill('5');
    await planForm.getByTestId('plan-max-members').fill('1');
    await planForm.getByTestId('plan-submit').click();

    await expect(page.getByTestId('tenant-plan-feedback')).toContainText(/Plano atualizado/i, {
      timeout: 30_000,
    });

    await memberForm.getByTestId('member-email').fill(memberEmail);
    await memberForm.getByTestId('member-role').selectOption('ADMIN');
    await memberForm.getByTestId('member-submit').click();

    await expect(page.getByTestId('tenant-member-feedback')).toContainText(/quota/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('tenant-member-feedback')).toContainText('Membros hoje: 1 de 1');

    // Nada foi gravado: a recusa é completa.
    const linkedAfterRefusal = await e2eDb.userTenantProfile.count({
      where: { tenantId, userId: memberId },
    });

    expect(linkedAfterRefusal).toBe(0);

    // ── Ajuste da quota libera o vínculo ────────────────────────────────────
    await planForm.getByTestId('plan-max-members').fill('3');
    await planForm.getByTestId('plan-submit').click();
    await expect(page.getByTestId('tenant-plan-feedback')).toContainText(/Plano atualizado/i, {
      timeout: 30_000,
    });

    await memberForm.getByTestId('member-email').fill(memberEmail);
    await memberForm.getByTestId('member-submit').click();

    await expect(page.getByTestId('tenant-member-feedback')).toContainText(/agora é ADMIN/i, {
      timeout: 30_000,
    });

    const profile = await e2eDb.userTenantProfile.findFirstOrThrow({
      where: { tenantId, userId: memberId },
      select: { kind: true, status: true },
    });

    expect(profile.kind).toBe('MEMBER');
    expect(profile.status).toBe('ACTIVE');

    // ── Redução abaixo do uso: aceita COM aviso ──────────────────────────────
    await planForm.getByTestId('plan-max-members').fill('1');
    await planForm.getByTestId('plan-submit').click();

    await expect(page.getByTestId('tenant-plan-feedback')).toContainText(/Plano atualizado/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('tenant-plan-feedback')).toContainText(
      /novos vínculos de equipe ficam bloqueados/i,
    );

    // Devolve o plano a um estado utilizável (a instituição é apagada no fim).
    await planForm.getByTestId('plan-max-members').fill('10');
    await planForm.getByTestId('plan-submit').click();
    await expect(page.getByTestId('tenant-plan-feedback')).toContainText(/Plano atualizado/i, {
      timeout: 30_000,
    });

    // ── A equipe cresceu para quem administra a instituição ──────────────────
    await signInAs(page, ownerEmail);
    await page.goto(`/t/${TENANT_SLUG}/administracao/equipe`);

    await expect(page.getByTestId('team-members')).toContainText(memberEmail);
    await expect(page.getByTestId('team-member-count')).toContainText('2');
    await expect(page.getByTestId('team-participant-count')).toContainText('1');
  });
});

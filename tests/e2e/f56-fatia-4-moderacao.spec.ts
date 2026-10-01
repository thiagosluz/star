import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantPlatformRole, grantRole, linkUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FATIA 4 DO MUTIRÃO DA JORNADA (dívida E62)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A jornada inteira, pelo navegador, em cinco fatos:
 *
 *    1. **quem pode denunciar** — o dono do perfil não vê o formulário, o anônimo vê o
 *       convite para entrar e quem está autenticado vê o formulário;
 *    2. **a denúncia pela TELA** — motivo `OTHER` (o que exige relato), resposta de
 *       sucesso e o estado "em análise" na volta à página;
 *    3. **a fila do SuperAdmin** — a denúncia aparece com categoria, relato, quem
 *       denunciou, quem foi denunciado e a casa em que o perfil foi visto;
 *    4. **a decisão que OCULTA** — decidir tira o perfil do ar e a página pública passa
 *       a mostrar o aviso no lugar do conteúdo;
 *    5. **a página oculta não oferece denúncia** — e a fila continua sendo 404 para
 *       quem não é da plataforma.
 *
 *  O passo 4 é o que dá sentido aos outros: fila de moderação que não muda nada é
 *  caixa de entrada, não governança.
 *
 *  A ORDEM importa: o arquivo roda em série e cada cenário depende do anterior
 *  (denunciar → ver na fila → decidir). O estado durável é o BANCO — o id da denúncia
 *  é lido de lá, e não de uma variável preenchida por outro teste.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f56-fatia4-moderacao-${RUN_ID}`;

const RELATO =
  'O perfil publica o telefone e o endereço de uma terceira pessoa, sem autorização dela.';
const NOTA_DECISAO = 'A exposicao de telefone e endereco de terceiro foi confirmada na analise.';

let tenantId: string;
let tenantSlug: string;
let tenantName: string;

/** A pessoa dona do perfil denunciado. */
let denunciada: { id: string; email: string };
/** Quem denuncia. */
let denunciante: { id: string; email: string };
/** O operador da plataforma que decide. */
let superAdminEmail: string;

const HANDLE = `perfil-denunciado-${RUN_ID}`;

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
    tenantName = tenant.name;

    denunciada = await signUpVia(api, 'Pessoa Denunciada');
    denunciante = await signUpVia(api, 'Pessoa Denunciante');

    /**
     * A página pública só existe onde a PESSOA participa, e o `@handle` é gravado
     * direto no banco porque o cenário é sobre a DENÚNCIA — publicar o perfil pela
     * tela tem teste próprio (`public-profile.spec.ts`).
     */
    await e2eDb.user.update({
      where: { id: denunciada.id },
      data: {
        publicHandle: HANDLE,
        headline: 'Pesquisadora em saúde pública',
        bio: 'Trabalho com vigilância epidemiológica e dados abertos de saúde.',
      },
    });

    await linkUser({ tenantId, userId: denunciada.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: denunciada.id, role: 'PARTICIPANT' });
    await linkUser({ tenantId, userId: denunciante.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: denunciante.id, role: 'PARTICIPANT' });

    const superAdmin = await signUpVia(api, `SuperAdmin Moderacao ${RUN_ID}`);
    superAdminEmail = superAdmin.email;
    await grantPlatformRole({ userId: superAdmin.id });
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

    /**
     * A trilha da DECISÃO não tem tenant (o ato é da plataforma) e por isso não cai
     * com a exclusão da instituição: apagar as linhas aqui evita deixar lixo
     * permanente na auditoria a cada execução do E2E.
     */
    await e2eDb.auditLog.deleteMany({
      where: { entityType: 'profile_report', entityId: { in: reports.map((row) => row.id) } },
    });
  }

  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
test('1. só quem está autenticado e NÃO é o dono vê o formulário', async ({ page, browser, baseURL }) => {
  // ── O dono do perfil: prévia dele mesmo, sem denúncia de si ─────────────────
  await signInAs(page, denunciada.email);
  await page.goto(`/t/${tenantSlug}/u/${HANDLE}`);

  await expect(page.getByTestId('public-profile')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('profile-owner-preview')).toBeVisible();
  await expect(page.getByTestId('profile-report-form')).toHaveCount(0);

  // ── O anônimo: o convite para entrar, e não o formulário ────────────────────
  const anonimo = await browser.newContext({ baseURL });
  const semSessao = await anonimo.newPage();

  try {
    await semSessao.goto(`/t/${tenantSlug}/u/${HANDLE}`);

    await expect(semSessao.getByTestId('profile-name')).toHaveText('Pessoa Denunciada', {
      timeout: 30_000,
    });
    await expect(semSessao.getByTestId('profile-report-anonymous')).toBeVisible();
    await expect(semSessao.getByTestId('profile-report-form')).toHaveCount(0);
  } finally {
    await anonimo.close();
  }
});

test('2. quem está autenticado denuncia o perfil pela tela', async ({ page }) => {
  await signInAs(page, denunciante.email);
  await page.goto(`/t/${tenantSlug}/u/${HANDLE}`);

  await expect(page.getByTestId('profile-report-form')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('profile-report-anonymous')).toHaveCount(0);

  await page.getByTestId('profile-report-form').locator('summary').click();

  /**
   * `OTHER` é escolhida de propósito: é a categoria que EXIGE o relato (mínimo de 10
   * caracteres), e é ela que prova que o campo de detalhes chega ao serviço.
   */
  await page.getByTestId('profile-report-category').selectOption('OTHER');
  await page.getByTestId('profile-report-details').fill(RELATO);
  await page.getByTestId('profile-report-submit').click();

  await expect(page.getByTestId('profile-report-result')).toContainText(/denúncia registrada/i, {
    timeout: 30_000,
  });

  // ── A denúncia existe no banco, ABERTA e com a casa de quem denunciou ────────
  const report = await e2eDb.profileReport.findFirstOrThrow({
    where: { tenantId, reporterUserId: denunciante.id, reportedUserId: denunciada.id },
    orderBy: { createdAt: 'desc' },
  });

  expect(report.status).toBe('OPEN');
  expect(report.category).toBe('OTHER');
  expect(report.details).toBe(RELATO);

  // ── E a tela passa a dizer que a análise está em andamento ──────────────────
  await page.reload();
  await expect(page.getByTestId('profile-report-pending')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('profile-report-form')).toHaveCount(0);
});

test('3. a fila do SuperAdmin mostra a denúncia com o motivo e a origem', async ({ page }) => {
  const report = await e2eDb.profileReport.findFirstOrThrow({
    where: { tenantId, reportedUserId: denunciada.id },
    orderBy: { createdAt: 'desc' },
  });

  await signInAs(page, superAdminEmail);

  const response = await page.goto('/superadmin/denuncias');
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId('moderation-queue')).toBeVisible({ timeout: 30_000 });

  const cartao = page.getByTestId(`moderation-report-${report.id}`);
  await expect(cartao).toBeVisible();

  /** O que quem decide precisa ler: o motivo, o relato e quem está envolvido. */
  await expect(cartao).toContainText('Outro motivo');
  await expect(page.getByTestId(`moderation-details-${report.id}`)).toContainText(RELATO);
  await expect(cartao).toContainText('Pessoa Denunciada');
  await expect(cartao).toContainText(`@${HANDLE}`);
  await expect(cartao).toContainText('Pessoa Denunciante');
  await expect(cartao).toContainText(tenantName);

  /** E os dois desfechos estão na tela, com a nota e a consequência escrita. */
  await expect(page.getByTestId(`moderation-note-${report.id}`)).toBeVisible();
  await expect(page.getByTestId(`moderation-dismiss-${report.id}`)).toBeVisible();
  await expect(page.getByTestId(`moderation-hide-${report.id}`)).toBeVisible();
  await expect(cartao).toContainText(/deixa de aparecer publicamente/i);
});

test('4. decidir pelo OCULTAR tira o perfil do ar e a página passa a avisar', async ({ page }) => {
  const report = await e2eDb.profileReport.findFirstOrThrow({
    where: { tenantId, reportedUserId: denunciada.id },
    orderBy: { createdAt: 'desc' },
  });

  await signInAs(page, superAdminEmail);
  await page.goto('/superadmin/denuncias');

  await expect(page.getByTestId(`moderation-report-${report.id}`)).toBeVisible({ timeout: 30_000 });

  /**
   * O contador é lido ANTES e DEPOIS: a fila é global (soma as denúncias de todas as
   * instituições), então o número absoluto não é previsível numa base de
   * desenvolvimento — o que é previsível é ele CAIR em um.
   */
  const antes = Number(await page.getByTestId('moderation-total').getAttribute('data-value'));

  await page.getByTestId(`moderation-note-${report.id}`).fill(NOTA_DECISAO);
  await page.getByTestId(`moderation-hide-${report.id}`).click();

  /**
   * A decisão tira a denúncia da FILA (`status` deixa de ser `OPEN`), e é isso que a
   * tela mostra: o cartão desaparece e o contador cai. O efeito no perfil é conferido
   * no banco logo abaixo — a tela não é a prova do que foi gravado.
   */
  await expect(page.getByTestId(`moderation-report-${report.id}`)).toHaveCount(0, {
    timeout: 30_000,
  });

  const depois = Number(await page.getByTestId('moderation-total').getAttribute('data-value'));
  expect(depois).toBe(antes - 1);

  // ── O banco confirma o efeito: ocultar NÃO apaga o handle ────────────────────
  const pessoa = await e2eDb.user.findUniqueOrThrow({
    where: { id: denunciada.id },
    select: { publicHandle: true, publicProfileHiddenAt: true, publicProfileHiddenReason: true },
  });

  expect(pessoa.publicProfileHiddenAt).not.toBeNull();
  expect(pessoa.publicProfileHiddenReason).toBe(NOTA_DECISAO);
  expect(pessoa.publicHandle).toBe(HANDLE);

  const decidida = await e2eDb.profileReport.findUniqueOrThrow({
    where: { id: report.id },
    select: { status: true, decidedAt: true, decisionNote: true, decidedById: true },
  });

  expect(decidida.status).toBe('ACTIONED');
  expect(decidida.decidedAt).not.toBeNull();
  expect(decidida.decisionNote).toBe(NOTA_DECISAO);
  expect(decidida.decidedById).not.toBeNull();

  // ── A página pública: o aviso no lugar do conteúdo ───────────────────────────
  await page.goto(`/t/${tenantSlug}/u/${HANDLE}`);

  await expect(page.getByTestId('profile-hidden')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('profile-hidden')).toContainText(
    'Este perfil está oculto por decisão da moderação',
  );
  await expect(page.getByTestId('profile-hidden-reason')).toContainText(NOTA_DECISAO);

  /** Nada do perfil é renderizado — nem nome, nem bio, nem o formulário. */
  await expect(page.getByTestId('profile-name')).toHaveCount(0);
  await expect(page.getByTestId('profile-bio')).toHaveCount(0);
  await expect(page.getByTestId('profile-report-form')).toHaveCount(0);
});

test('5. a página oculta não oferece denúncia, e a fila é 404 para quem não é da plataforma', async ({
  browser,
  baseURL,
}) => {
  const anonimo = await browser.newContext({ baseURL });
  const pagina = await anonimo.newPage();

  try {
    await pagina.goto(`/t/${tenantSlug}/u/${HANDLE}`);

    await expect(pagina.getByTestId('profile-hidden')).toBeVisible({ timeout: 30_000 });

    /** Perfil já oculto: não há o que denunciar, e o convite para entrar sairia de contexto. */
    await expect(pagina.getByTestId('profile-report-form')).toHaveCount(0);
    await expect(pagina.getByTestId('profile-report-anonymous')).toHaveCount(0);

    /** A fila não existe para quem não é da plataforma — 404, nunca 403. */
    const semPermissao = await pagina.goto('/superadmin/denuncias');
    expect(semPermissao?.status()).toBe(404);
  } finally {
    await anonimo.close();
  }
});

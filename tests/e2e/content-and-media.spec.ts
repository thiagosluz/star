/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Conteúdo e mídia (FASE 23)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. E9  — a pré-visualização mostra o RASCUNHO (o que o público ainda não vê),
 *               com o selo de prévia, e não interfere na página pública;
 *      2. E13 — agendar deixa a página fora do ar com o estado "Agendada", e
 *               publicar depois a coloca no ar;
 *      3. E12 — o histórico lista as versões e restaurar devolve o conteúdo anterior;
 *      4. E10 — o envio de imagem da galeria passa pela esteira real (assina → envia
 *               ao MinIO → confere) e a imagem aparece na página pública;
 *      5. E11 — copiar um patrocinador de outro evento cria o cadastro oculto, com a
 *               cota casada pela categoria.
 *
 *  O cenário do upload é o único que atravessa o STORAGE de verdade: os outros quatro
 *  usam apenas banco e renderização.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'conteudo-f23';
const EVENT_SLUG = `evento-f23-e2e-${RUN_ID}`;
const SECOND_EVENT_SLUG = `evento-f23-e2e-b-${RUN_ID}`;

/** PNG 1×1 válido — a assinatura do arquivo é o que a validação confere. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const TEXT_ORIGINAL = `Texto original da FASE 23 — ${RUN_ID}`;
const TEXT_ALTERADO = `Texto alterado da FASE 23 — ${RUN_ID}`;

let tenantId: string;
let eventId: string;
let secondEventId: string;
let adminEmail: string;
let sourceSponsorId: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f23.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição Conteúdo ${RUN_ID}`,
    });
    tenantId = tenant.id;

    eventId = randomUUID();
    secondEventId = randomUUID();
    const startsAt = new Date(Date.now() + 30 * 86_400_000);

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      for (const [id, slug, title] of [
        [eventId, EVENT_SLUG, `Congresso Conteúdo ${RUN_ID}`],
        [secondEventId, SECOND_EVENT_SLUG, `Simpósio Conteúdo ${RUN_ID}`],
      ] as const) {
        await tx.event.create({
          data: {
            id,
            tenantId,
            slug,
            title,
            summary: 'Evento para os testes da FASE 23.',
            status: 'REGISTRATION_OPEN',
            modality: 'IN_PERSON',
            startsAt,
            endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
            timezone: 'America/Bahia',
            confirmedCount: 0,
            registrationOpensAt: new Date(Date.now() - 86_400_000),
            registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
          },
        });
      }

      /**
       * Cota e patrocinador do evento de ORIGEM (o cenário 5 testa a CÓPIA, não o
       * cadastro — que a FASE 17 já cobre). Os dados nascem aqui para que a cópia
       * tenha o que copiar independentemente da ordem dos cenários.
       */
      const tierId = randomUUID();
      await tx.sponsorTier.create({
        data: {
          id: tierId,
          tenantId,
          eventId,
          key: 'GOLD',
          name: 'Ouro',
          rank: 10,
          maxSponsors: 0,
          priceCents: 0,
          currency: 'BRL',
          benefits: [],
        },
      });

      sourceSponsorId = randomUUID();
      await tx.sponsor.create({
        data: {
          id: sourceSponsorId,
          tenantId,
          eventId,
          slug: `parceiro-f23-${RUN_ID}`,
          name: `Instituto Parceiro ${RUN_ID}`,
          websiteUrl: 'https://example.org/parceiro',
          tierId,
          contactName: 'Marina Alves',
          contactEmail: 'marina@example.org',
          contractValueCents: 1_500_000,
          displayOrder: 0,
          isActive: true,
        },
      });
    });

    const admin = await signUpVia(api, `Admin Conteúdo ${RUN_ID}`);
    adminEmail = admin.email;
    await linkUser({ tenantId, userId: admin.id });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

/** Abre o editor de conteúdo do bloco de um tipo e devolve o locator do bloco. */
async function openBlockEditor(
  page: import('@playwright/test').Page,
  type: string,
): Promise<import('@playwright/test').Locator> {
  const block = page.locator(`[data-type="${type}"]`).last();
  await block.locator('summary', { hasText: 'Editar conteúdo' }).click();
  return block;
}

async function createPageWithTextBlock(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina`);

  await page.getByTestId('create-page').getByTestId('admin-submit').click();
  await expect(page.getByTestId('landing-status')).toContainText(/rascunho/i, { timeout: 20_000 });

  const blocks = page.locator('[data-testid^="block-"][data-type]');
  const before = await blocks.count();

  const addForm = page.getByTestId('add-block');
  await addForm.getByLabel('Tipo de bloco').selectOption('RICH_TEXT');
  await addForm.getByTestId('admin-submit').click();
  await expect(blocks).toHaveCount(before + 1, { timeout: 20_000 });

  const block = await openBlockEditor(page, 'RICH_TEXT');
  await block.getByLabel('Texto').fill(TEXT_ORIGINAL);
  await block.locator('[data-testid^="block-form-"]').getByTestId('admin-submit').click();
  await expect(block.getByTestId('block-form-feedback').or(block.locator('[role="status"]')).first()).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('conteúdo e mídia', () => {
  test('a pré-visualização mostra o rascunho e não interfere na página pública (E9)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await createPageWithTextBlock(page);

    // ── A prévia mostra o rascunho, com o selo ────────────────────────────────
    await page.getByTestId('preview-page').click();
    await expect(page.getByTestId('preview-banner')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('preview-banner')).toContainText(/rascunho/i);
    await expect(page.getByText(TEXT_ORIGINAL)).toBeVisible();

    // ── A página pública (sem sessão) NÃO tem o conteúdo ─────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    const publicPage = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    expect(publicPage?.status()).toBe(200);
    await expect(page.getByText(TEXT_ORIGINAL)).toHaveCount(0);
    // A composição padrão continua no ar (o resumo do evento).
    await expect(page.getByText('Evento para os testes da FASE 23.')).toBeVisible();
  });

  test('agendar deixa a página fora do ar e publicar a coloca no ar (E13)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina`);

    // ── Agenda para daqui a três dias ─────────────────────────────────────────
    const settings = page.getByTestId('page-settings');
    const inThreeDays = new Date(Date.now() + 3 * 86_400_000);
    const localValue = new Date(inThreeDays.getTime() - inThreeDays.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);

    await settings.getByLabel('Agendar para entrar no ar').fill(localValue);
    await settings.getByTestId('admin-submit').click();

    await expect(page.getByTestId('landing-status')).toContainText(/agendada/i, { timeout: 20_000 });

    // Fora do ar para o público.
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    await expect(page.getByText(TEXT_ORIGINAL)).toHaveCount(0);

    // ── Publica agora (a data é limpa) ────────────────────────────────────────
    await signInAs(page, adminEmail);
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina`);

    const published = page.getByTestId('page-settings');
    /**
     * A data agendada precisa ser APAGADA antes de publicar: as duas intenções juntas
     * são recusadas pelo domínio ("escolha uma coisa"), e o campo continua preenchido
     * com o valor que foi salvo. É o comportamento certo — o sistema não escolhe pelo
     * organizador — e a tela diz isso na dica do campo.
     */
    await published.getByLabel('Agendar para entrar no ar').fill('');
    await published.getByLabel('Publicar a página agora').check();
    await published.getByTestId('admin-submit').click();

    await expect(page.getByTestId('landing-status')).toContainText(/publicada/i, { timeout: 20_000 });

    const stored = await e2eDb.eventPage.findFirstOrThrow({
      where: { eventId },
      select: { isPublished: true, publishAt: true },
    });
    expect(stored.isPublished).toBe(true);
    // Despublicar/publicar limpa a data: ela não pode republicar a página sozinha.
    expect(stored.publishAt).toBeNull();

    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    await expect(page.getByText(TEXT_ORIGINAL)).toBeVisible();
  });

  test('o histórico de versões lista as alterações e restaura o conteúdo anterior (E12)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina`);

    // ── Segunda redação ───────────────────────────────────────────────────────
    const block = await openBlockEditor(page, 'RICH_TEXT');
    await block.getByLabel('Texto').fill(TEXT_ALTERADO);
    await block.locator('[data-testid^="block-form-"]').getByTestId('admin-submit').click();
    await expect(page.getByTestId('block-list')).toContainText(/caractere/, { timeout: 20_000 });

    // ── O histórico tem a versão com o texto original ─────────────────────────
    const history = page.getByTestId('version-history');
    await expect(history).toBeVisible();
    await history.locator('summary').click();

    const versionList = page.getByTestId('version-list');
    await expect(versionList).toBeVisible();
    const versionRows = page.locator('[data-testid^="version-"][data-current]');
    expect(await versionRows.count()).toBeGreaterThanOrEqual(3);

    // Exatamente UMA versão é o estado atual.
    await expect(page.locator('[data-testid^="version-"][data-current="true"]')).toHaveCount(1);

    const before = await e2eDb.eventPageVersion.findMany({
      where: { page: { eventId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, reason: true, snapshot: true },
    });
    expect(before.length).toBeGreaterThanOrEqual(3);

    /**
     * A versão a restaurar é escolhida pelo CONTEÚDO, não pela posição na lista: a
     * que guarda o texto original. Escolher por índice quebraria a cada alteração nova
     * no cenário — e o teste passaria a medir outra coisa sem avisar.
     */
    const originalVersion = before.find(
      (version) => JSON.stringify(version.snapshot).includes('Texto original da FASE 23'),
    );
    expect(originalVersion).toBeDefined();

    const restoreForm = page.getByTestId(`restore-${originalVersion!.id}`);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A CONFIRMAÇÃO AGORA É UM DIÁLOGO DO SISTEMA (revisão de UI)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O botão "Restaurar" abre o diálogo do produto — título, consequência escrita e um
     *  botão que NOMEIA a ação. Antes era `window.confirm`, que o Playwright dispensa
     *  automaticamente quando ninguém o trata (`false` = submissão cancelada, sem erro
     *  no servidor porque nada chegava lá — armadilha 33).
     *
     *  Aqui o fluxo é o do usuário: abre, confere o texto e confirma.
     */
    await restoreForm.getByTestId(`restore-${originalVersion!.id}-open`).click();

    const restoreDialog = page.getByTestId(`restore-${originalVersion!.id}-confirm`);
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog).toContainText('Restaurar esta versão?');
    await expect(restoreDialog).toContainText('continua no histórico');

    await restoreDialog.getByTestId(`restore-${originalVersion!.id}-confirm-confirm`).click();

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ASSERÇÃO É SOBRE O EFEITO, NÃO SOBRE A MENSAGEM
     * ─────────────────────────────────────────────────────────────────────────────
     *  Depois de restaurar, a Server Action revalida a página e a lista de versões é
     *  re-renderizada — o que substitui o formulário clicado e leva junto o estado
     *  local da mensagem de sucesso. Esperar pelo texto seria esperar por um nó que a
     *  própria revalidação remove.
     *
     *  `expect.poll` cobre a janela entre clicar e a gravação aparecer no banco: é o
     *  mesmo cuidado dos testes de ações assíncronas em E2E.
     */
    await expect
      .poll(
        async () => {
          const restored = await e2eDb.pageBlock.findFirst({
            where: { page: { eventId }, type: 'RICH_TEXT' },
            select: { content: true },
          });
          return JSON.stringify(restored?.content ?? {});
        },
        { timeout: 20_000 },
      )
      .toContain('Texto original da FASE 23');

    // A lista re-renderizada mostra a versão da restauração como a mais recente.
    await expect(versionList).toContainText('Restaurada de uma versão anterior');

    // ── O banco confirma que o conteúdo voltou ────────────────────────────────
    const restored = await e2eDb.pageBlock.findFirstOrThrow({
      where: { page: { eventId }, type: 'RICH_TEXT' },
      select: { content: true },
    });
    expect(JSON.stringify(restored.content)).toContain('Texto original da FASE 23');

    // ── E a restauração não mexeu na publicação ───────────────────────────────
    const pageRow = await e2eDb.eventPage.findFirstOrThrow({
      where: { eventId },
      select: { isPublished: true },
    });
    expect(pageRow.isPublished).toBe(true);

    // A própria restauração virou uma versão nova.
    const latest = await e2eDb.eventPageVersion.findFirstOrThrow({
      where: { page: { eventId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { reason: true },
    });
    expect(latest.reason).toBe('Restaurada de uma versão anterior');
  });

  test('o envio de imagem da galeria passa pela esteira real e aparece no site (E10)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina`);

    const blocks = page.locator('[data-testid^="block-"][data-type]');
    const before = await blocks.count();

    const addForm = page.getByTestId('add-block');
    await addForm.getByLabel('Tipo de bloco').selectOption('GALLERY');
    await addForm.getByTestId('admin-submit').click();
    await expect(blocks).toHaveCount(before + 1, { timeout: 20_000 });

    const block = await openBlockEditor(page, 'GALLERY');

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O FLUXO É "CLICAR E ESCOLHER", NÃO "DEFINIR O ARQUIVO"
     * ─────────────────────────────────────────────────────────────────────────────
     *  O `<input type="file">` é único e escondido: cada botão "Enviar imagem" guarda
     *  o ÍNDICE da linha e abre o seletor. Definir o arquivo direto no input pula o
     *  clique, o índice nunca é preenchido e o envio não acontece — sem erro visível,
     *  porque nada foi enviado.
     */
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      block.getByTestId('gallery-upload-0').click(),
    ]);

    await chooser.setFiles({
      name: 'foto-e2e.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });

    await expect(block.getByTestId('gallery-upload-status')).toContainText(/Imagem enviada/i, {
      timeout: 30_000,
    });

    // A URL do bucket foi preenchida na linha da galeria.
    const urlField = block.getByLabel('URL da imagem 1');
    await expect(urlField).toHaveValue(/eventflow-assets/, { timeout: 20_000 });
    const uploadedUrl = await urlField.inputValue();

    // ── Salva o bloco e confere a página pública ──────────────────────────────
    await block.locator('[data-testid^="block-form-"]').getByTestId('admin-submit').click();
    await expect(page.getByTestId('block-list')).toContainText(/1 imagem/i, { timeout: 20_000 });

    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    const publicPage = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    expect(publicPage?.status()).toBe(200);

    const image = page.locator(`img[src="${uploadedUrl}"]`);
    await expect(image).toBeVisible();

    // O objeto existe mesmo no storage e o bucket o serve (galeria é conteúdo público).
    const fetched = await page.request.get(uploadedUrl);
    expect(fetched.status()).toBe(200);
    expect(fetched.headers()['content-type']).toContain('image/png');
  });

  test('copiar um patrocinador de outro evento cria o cadastro oculto com a cota certa (E11)', async ({ page }) => {
    await signInAs(page, adminEmail);

    // A cota do evento de DESTINO tem outro nome, mas a mesma categoria.
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.sponsorTier.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId: secondEventId,
          key: 'GOLD',
          name: `Cota Ouro ${RUN_ID}`,
          rank: 10,
          maxSponsors: 0,
          priceCents: 0,
          currency: 'BRL',
          benefits: [],
        },
      });
    });

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${secondEventId}/patrocinadores`);

    const copySection = page.getByTestId('copy-sponsor-section');
    await expect(copySection).toBeVisible();

    const copyForm = page.getByTestId('copy-sponsor');
    // O id vem do fixture: escolher pelo rótulo exigiria casar texto de opção, que
    // depende do agrupamento por nome — o id é o dado que o formulário envia.
    await copyForm.getByLabel('Patrocinador').selectOption(sourceSponsorId);
    await copyForm.getByTestId('admin-submit').click();

    await expect(copyForm.getByTestId('copy-sponsor-feedback')).toContainText(/mesma cota/i, {
      timeout: 20_000,
    });

    // ── O cadastro entrou OCULTO e sem valor de contrato ──────────────────────
    const copied = await e2eDb.sponsor.findFirstOrThrow({
      where: { tenantId, eventId: secondEventId },
      select: {
        id: true,
        isActive: true,
        contractValueCents: true,
        contactEmail: true,
        tier: { select: { key: true, name: true } },
      },
    });

    expect(copied.isActive).toBe(false);
    expect(copied.contractValueCents).toBeNull();
    expect(copied.contactEmail).toBe('marina@example.org');
    expect(copied.tier?.key).toBe('GOLD');
    expect(copied.tier?.name).toBe(`Cota Ouro ${RUN_ID}`);

    // A linha aparece na tela marcada como oculta.
    await expect(
      page.locator(`[data-testid="sponsor-${copied.id}"][data-active="false"]`),
    ).toBeVisible();

    // Copiar de novo é recusado com o motivo.
    const second = page.getByTestId('copy-sponsor');
    await second.getByLabel('Patrocinador').selectOption(sourceSponsorId);
    await second.getByTestId('admin-submit').click();
    await expect(second.getByTestId('copy-sponsor-feedback')).toContainText(/já está cadastrado/i, {
      timeout: 20_000,
    });
  });
});

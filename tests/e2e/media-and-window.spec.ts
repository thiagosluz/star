/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Mídia e agendamento (FASE 24)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. E14 — a imagem enviada entra no ACERVO da instituição, pode ser
 *         reaproveitada pelo bloco de galeria e, quando está em uso, a exclusão é
 *         RECUSADA dizendo onde ela está;
 *      2. E16 — a página agendada com data de término sai do ar sozinha, sem perder
 *         a configuração;
 *      3. E17 — a data digitada é gravada no FUSO DO EVENTO (America/Bahia), não no
 *         fuso do processo;
 *      4. E15 — o patrocinador copiado guarda a origem e sincroniza os dados da
 *         empresa, preservando cota, valor e exibição do evento.
 *
 *  A ordem importa: o primeiro cenário cria a página e o acervo dos seguintes. O
 *  estado durável é o BANCO (lição da FASE 14) — nada é guardado em variável de
 *  módulo além dos ids resolvidos no `beforeAll`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'midia-f24';
const EVENT_SLUG = `evento-f24-e2e-${RUN_ID}`;
const SECOND_EVENT_SLUG = `evento-f24-e2e-b-${RUN_ID}`;

/** PNG 1×1 válido — a assinatura do arquivo é o que a validação confere. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

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
  const email = `f24.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
      name: `Instituição Mídia ${RUN_ID}`,
    });
    tenantId = tenant.id;

    eventId = randomUUID();
    secondEventId = randomUUID();
    const startsAt = new Date(Date.now() + 30 * 86_400_000);

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      for (const [id, slug, title] of [
        [eventId, EVENT_SLUG, `Congresso Mídia ${RUN_ID}`],
        [secondEventId, SECOND_EVENT_SLUG, `Simpósio Mídia ${RUN_ID}`],
      ] as const) {
        await tx.event.create({
          data: {
            id,
            tenantId,
            slug,
            title,
            summary: 'Evento para os testes da FASE 24.',
            status: 'REGISTRATION_OPEN',
            modality: 'IN_PERSON',
            // Fuso diferente de UTC de propósito: é ele que a conversão deve usar.
            timezone: 'America/Bahia',
            startsAt,
            endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
            confirmedCount: 0,
            registrationOpensAt: new Date(Date.now() - 86_400_000),
            registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
          },
        });
      }

      /**
       * Patrocinador de ORIGEM no primeiro evento, para o cenário da cópia e da
       * sincronia. A cota existe nos dois eventos com NOMES diferentes e a MESMA
       * chave — é o que prova que o casamento é pela categoria.
       */
      const sourceTierId = randomUUID();
      await tx.sponsorTier.create({
        data: {
          id: sourceTierId,
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

      sourceSponsorId = randomUUID();
      await tx.sponsor.create({
        data: {
          id: sourceSponsorId,
          tenantId,
          eventId,
          slug: `parceiro-f24-${RUN_ID}`,
          name: `Instituto Sincronia ${RUN_ID}`,
          description: 'Descrição original.',
          websiteUrl: 'https://example.org/antigo',
          logoUrl: null,
          tierId: sourceTierId,
          contactEmail: 'marina@example.org',
          contractValueCents: 1_500_000,
          displayOrder: 0,
          isActive: true,
        },
      });
    });

    const admin = await signUpVia(api, `Admin Mídia ${RUN_ID}`);
    adminEmail = admin.email;
    await linkUser({ tenantId, userId: admin.id });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

const pageUrl = () => `/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina`;
const mediaUrl = () => `/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina/midia`;

test.describe('mídia e agendamento', () => {
  test('a imagem enviada entra no acervo e pode ser reaproveitada na galeria (E14)', async ({ page }) => {
    await signInAs(page, adminEmail);

    // ── Prepara a página com um bloco de galeria ──────────────────────────────
    await page.goto(pageUrl());
    await page.getByTestId('create-page').getByTestId('admin-submit').click();
    await expect(page.getByTestId('landing-status')).toContainText(/rascunho/i, { timeout: 20_000 });

    const blocks = page.locator('[data-testid^="block-"][data-type]');
    const before = await blocks.count();

    const addForm = page.getByTestId('add-block');
    await addForm.getByLabel('Tipo de bloco').selectOption('GALLERY');
    await addForm.getByTestId('admin-submit').click();
    await expect(blocks).toHaveCount(before + 1, { timeout: 20_000 });

    // ── Envia a imagem pelo ACERVO ────────────────────────────────────────────
    await page.goto(mediaUrl());
    await expect(page.getByTestId('empty-media')).toBeVisible();

    const uploader = page.getByTestId('asset-uploader-GALLERY');

    /**
     * Aqui o `<input type="file">` é VISÍVEL (a moldura da capa/logotipo mostra o
     * seletor e o botão envia): o fluxo é "escolher e enviar", e não o
     * "clique-e-escolha" do input escondido do bloco de galeria.
     */
    await uploader.getByLabel('Imagem da galeria').setInputFiles({
      name: 'foto-f24.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await uploader.getByRole('button', { name: /Enviar imagem/i }).click();

    await expect(uploader.getByTestId('asset-status-GALLERY')).toContainText(/vinculada/i, {
      timeout: 30_000,
    });

    // A imagem entra no acervo, ainda SEM uso.
    const mediaList = page.getByTestId('media-list');
    await expect(mediaList).toBeVisible({ timeout: 20_000 });
    await expect(mediaList).toContainText('foto-f24.png');

    const assetRow = page.locator('[data-testid^="media-"][data-in-use]').first();
    const assetId = (await assetRow.getAttribute('data-testid'))?.replace('media-', '') ?? '';
    await expect(assetRow).toHaveAttribute('data-in-use', 'false');

    const urlField = page.getByTestId(`media-url-${assetId}`);
    const uploadedUrl = await urlField.inputValue();
    expect(uploadedUrl).toContain('eventflow-assets');

    // ── Reaproveita no bloco de galeria (seletor do acervo) ───────────────────
    await page.goto(pageUrl());
    const block = page.locator('[data-type="GALLERY"]').last();
    await block.locator('summary', { hasText: 'Editar conteúdo' }).click();
    await block.getByTestId('gallery-library-0').selectOption(uploadedUrl);
    await expect(block.getByLabel('URL da imagem 1')).toHaveValue(uploadedUrl);

    await block.locator('[data-testid^="block-form-"]').getByTestId('admin-submit').click();
    await expect(page.getByTestId('block-list')).toContainText(/1 imagem/i, { timeout: 20_000 });

    // ── Publica e confere a página pública ────────────────────────────────────
    const settings = page.getByTestId('page-settings');
    await settings.getByLabel('Publicar a página agora').check();
    await settings.getByTestId('admin-submit').click();
    await expect(page.getByTestId('landing-status')).toContainText(/publicada/i, { timeout: 20_000 });

    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    const publicPage = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    expect(publicPage?.status()).toBe(200);
    await expect(page.locator(`img[src="${uploadedUrl}"]`)).toBeVisible();
  });

  test('a imagem EM USO não pode ser excluída, e a tela diz onde ela está (E14)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(mediaUrl());

    const assetRow = page.locator('[data-testid^="media-"][data-in-use]').first();
    await expect(assetRow).toHaveAttribute('data-in-use', 'true', { timeout: 20_000 });

    const assetId = (await assetRow.getAttribute('data-testid'))?.replace('media-', '') ?? '';

    // O uso é descrito (bloco de galeria da página do evento).
    await expect(page.getByTestId(`media-usage-${assetId}`)).toContainText(/Bloco GALLERY/i);

    const deleteForm = page.getByTestId(`delete-media-${assetId}`);

    /**
     * A exclusão pede confirmação em DIÁLOGO DO SISTEMA (revisão de UI): abre, confere a
     * consequência escrita e só então confirma. Era `window.confirm`, que o Playwright
     * dispensava em silêncio — a ação nunca chegava ao servidor (armadilha 33).
     */
    await deleteForm.click();
    const deleteDialog = page.getByTestId(`delete-media-${assetId}-confirm`);
    await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
    await deleteDialog.getByTestId(`delete-media-${assetId}-confirm-confirm`).click();

    await expect(deleteForm.getByTestId(`delete-media-${assetId}-feedback`)).toContainText(
      /não pode ser excluída/i,
      { timeout: 20_000 },
    );

    // O registro continua no acervo.
    await expect(page.locator(`[data-testid="media-${assetId}"]`)).toBeVisible();
  });

  test('a página sai do ar sozinha na data de término, sem perder a configuração (E16)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(pageUrl());

    // ── Publica com término no futuro ─────────────────────────────────────────
    const inFiveDays = new Date(Date.now() + 5 * 86_400_000);
    const wallValue = (date: Date) =>
      new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

    const settings = page.getByTestId('page-settings');
    await settings.getByLabel('Sair do ar em').fill(wallValue(inFiveDays));
    await settings.getByTestId('admin-submit').click();

    await expect(page.getByTestId('publication-window')).toContainText(/sai em/i, { timeout: 20_000 });
    await expect(page.getByTestId('landing-status')).toContainText(/publicada/i);

    // ── O tempo passa: a data de término fica no passado ─────────────────────
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.eventPage.updateMany({
        where: { eventId },
        data: { unpublishAt: new Date(Date.now() - 3_600_000) },
      });
    });

    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    const publicPage = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    expect(publicPage?.status()).toBe(200);

    // A página saiu do ar: o visitante vê a composição padrão (resumo do evento).
    await expect(page.getByText('Evento para os testes da FASE 24.')).toBeVisible();

    // ── O editor explica o que aconteceu (e a configuração está lá) ──────────
    await signInAs(page, adminEmail);
    await page.goto(pageUrl());
    await expect(page.getByTestId('landing-status')).toContainText(/termino|término/i, {
      timeout: 20_000,
    });

    const stored = await e2eDb.eventPage.findFirstOrThrow({
      where: { eventId },
      select: { isPublished: true, unpublishAt: true },
    });
    expect(stored.isPublished).toBe(true);
    expect(stored.unpublishAt).not.toBeNull();
  });

  test('a data agendada é gravada no FUSO DO EVENTO, não em UTC (E17)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(pageUrl());

    /**
     * A tela mostra e recebe a data no fuso do evento (America/Bahia). O teste
     * preenche "18:00" e confere que o instante gravado é 21:00Z — três horas
     * depois, que é o deslocamento de Salvador.
     */
    const settings = page.getByTestId('page-settings');
    await settings.getByLabel('Sair do ar em').fill('');
    await settings.getByLabel('Publicar a página agora').uncheck();
    await settings.getByLabel('Agendar para entrar no ar').fill('2027-03-10T18:00');
    await settings.getByTestId('admin-submit').click();

    await expect(page.getByTestId('landing-status')).toContainText(/agendada/i, { timeout: 20_000 });

    // A mensagem diz em que fuso a data foi lida.
    await expect(settings.getByTestId('save-page-feedback')).toContainText(/America\/Bahia/i);

    const stored = await e2eDb.eventPage.findFirstOrThrow({
      where: { eventId },
      select: { publishAt: true },
    });

    expect(stored.publishAt?.toISOString()).toBe('2027-03-10T21:00:00.000Z');

    // ── E o campo devolve a MESMA hora de parede (ida e volta) ───────────────
    await page.reload();
    await expect(
      page.getByTestId('page-settings').getByLabel('Agendar para entrar no ar'),
    ).toHaveValue('2027-03-10T18:00');
  });

  test('o patrocinador copiado sincroniza com a origem, preservando cota e contrato (E15)', async ({ page }) => {
    await signInAs(page, adminEmail);

    // ── Copia a origem para o segundo evento ─────────────────────────────────
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${secondEventId}/patrocinadores`);

    const copyForm = page.getByTestId('copy-sponsor');
    await copyForm.getByLabel('Patrocinador').selectOption(sourceSponsorId);
    await copyForm.getByTestId('admin-submit').click();
    await expect(copyForm.getByTestId('copy-sponsor-feedback')).toContainText(/mesma cota/i, {
      timeout: 20_000,
    });

    const copied = await e2eDb.sponsor.findFirstOrThrow({
      where: { tenantId, eventId: secondEventId },
      select: { id: true, sourceSponsorId: true, isActive: true, contractValueCents: true },
    });

    expect(copied.sourceSponsorId).toBe(sourceSponsorId);
    expect(copied.isActive).toBe(false);
    expect(copied.contractValueCents).toBeNull();

    // A tela mostra a origem.
    await expect(page.getByTestId(`sponsor-source-${copied.id}`)).toContainText(
      `Instituto Sincronia ${RUN_ID}`,
    );

    // ── A ORIGEM muda de site e logotipo ─────────────────────────────────────
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.sponsor.update({
        where: { id: sourceSponsorId },
        data: { websiteUrl: 'https://example.org/novo', description: 'Descrição atualizada.' },
      });
    });

    // ── Sincroniza a cópia ───────────────────────────────────────────────────
    const syncForm = page.getByTestId(`sync-sponsor-${copied.id}`);
    await syncForm.getByTestId('inline-submit').click();

    await expect(syncForm.getByTestId(`sync-sponsor-${copied.id}-feedback`)).toContainText(
      /atualizados a partir de/i,
      { timeout: 20_000 },
    );

    const synced = await e2eDb.sponsor.findFirstOrThrow({
      where: { id: copied.id },
      select: {
        websiteUrl: true,
        description: true,
        isActive: true,
        contractValueCents: true,
        tier: { select: { key: true, name: true } },
      },
    });

    // Dados da EMPRESA: atualizados.
    expect(synced.websiteUrl).toBe('https://example.org/novo');
    expect(synced.description).toBe('Descrição atualizada.');

    // Do EVENTO: intactos.
    expect(synced.isActive).toBe(false);
    expect(synced.contractValueCents).toBeNull();
    expect(synced.tier?.key).toBe('GOLD');
    expect(synced.tier?.name).toBe(`Cota Ouro ${RUN_ID}`);
  });
});

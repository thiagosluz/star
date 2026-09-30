/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Busca e filtro no acervo de mídia (FASE 51, dívida E19)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. os quatro filtros (busca, tipo, evento de origem e uso) funcionam SOZINHOS e
 *         COMBINADOS, e o resultado na tela é o resultado do banco;
 *      2. tudo isso **SEM JavaScript**: o contexto do navegador é criado com
 *         `javaScriptEnabled: false`, então o bundle nunca carrega e o clique em
 *         "Filtrar" é a submissão NATIVA do `<form method="get">`;
 *      3. busca sem resultado NÃO inventa imagem: a tela diz que nada corresponde e
 *         oferece o caminho de volta, em vez de mostrar o acervo inteiro ou fingir que
 *         o acervo está vazio;
 *      4. a lista truncada pelo teto de 200 ANUNCIA quanto ficou de fora ("mostrando N
 *         de M") — o mesmo padrão do quadro de demandas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ACERVO É SEMEADO DIRETO NO BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O upload real passa pelo storage (MinIO) e converte tudo para WebP (FASE 46), o que
 *  daria quatro imagens WebP e nenhum PNG — justamente o filtro de TIPO que precisa de
 *  mais de um formato para ser exercitado. O acervo aqui é FIXTURE: as linhas são o que
 *  o upload deixaria, e o que o teste mede é a leitura (filtro, contagem e aviso), não a
 *  escrita. O upload de verdade já é coberto por `media-and-window.spec.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

const TENANT_LABEL = 'filtros-f51';
const BULK_TENANT_LABEL = 'acervo-grande-f51';

let tenantId: string;
let eventId: string;
let secondEventId: string;
let adminEmail: string;

/** Tenant separado do cenário do teto: 205 imagens mudariam as contagens do outro. */
let bulkTenantId: string;
let bulkEventId: string;

let capaId: string;
let logoId: string;
let galeriaId: string;
let antigaId: string;

const mediaUrl = (targetEventId = eventId) =>
  `/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${targetEventId}/pagina/midia`;

const bulkMediaUrl = () =>
  `/t/${BULK_TENANT_LABEL}-${RUN_ID}/administracao/eventos/${bulkEventId}/pagina/midia`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f51.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Uma linha do acervo na tela (o `li` com `data-in-use`). */
function assetRows(page: import('@playwright/test').Page) {
  return page.getByTestId('media-list').locator('li');
}

/** Submete o formulário de filtro — sem JavaScript, é navegação de verdade. */
async function filtrar(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('media-filter-submit').click();
  await page.waitForLoadState('domcontentloaded');
}
test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({ label: TENANT_LABEL, name: `Instituição Filtros ${RUN_ID}` });
    tenantId = tenant.id;

    const bulkTenant = await createTenant({
      label: BULK_TENANT_LABEL,
      name: `Acervo Grande ${RUN_ID}`,
    });
    bulkTenantId = bulkTenant.id;

    eventId = randomUUID();
    secondEventId = randomUUID();
    bulkEventId = randomUUID();

    const admin = await signUpVia(api, `Admin Filtros ${RUN_ID}`);
    adminEmail = admin.email;
    await linkUser({ tenantId, userId: admin.id });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });

    // O mesmo administrador enxerga o acervo grande: uma sessão só para os dois cenários.
    await linkUser({ tenantId: bulkTenantId, userId: admin.id });
    await grantRole({ tenantId: bulkTenantId, userId: admin.id, role: 'ADMIN' });

    const startsAt = new Date(Date.now() + 30 * 86_400_000);

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      for (const [id, slug, title] of [
        [eventId, `evento-filtros-${RUN_ID}`, `Congresso Filtros ${RUN_ID}`],
        [secondEventId, `evento-filtros-b-${RUN_ID}`, `Simpósio Filtros ${RUN_ID}`],
      ] as const) {
        await tx.event.create({
          data: {
            id,
            tenantId,
            slug,
            title,
            summary: 'Evento para os testes dos filtros do acervo.',
            status: 'REGISTRATION_OPEN',
            modality: 'IN_PERSON',
            timezone: 'America/Bahia',
            startsAt,
            endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
            confirmedCount: 0,
            registrationOpensAt: new Date(Date.now() - 86_400_000),
            registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
          },
        });
      }

      const base = (name: string) => `https://cdn.test/f51-e2e-${RUN_ID}/${name}`;

      capaId = randomUUID();
      logoId = randomUUID();
      galeriaId = randomUUID();
      antigaId = randomUUID();

      // `createdAt` decrescente: a ordem que a lista mostra é a mais recente primeiro.
      const now = Date.now();

      const assets = [
        { id: capaId, url: base('capa.webp'), fileName: 'capa-congresso.webp', mimeType: 'image/webp', eventId, offset: 0 },
        { id: logoId, url: base('logo.png'), fileName: 'logo-parceiro.png', mimeType: 'image/png', eventId, offset: 60_000 },
        { id: galeriaId, url: base('galeria.webp'), fileName: 'galeria-simposio.webp', mimeType: 'image/webp', eventId: secondEventId, offset: 120_000 },
        { id: antigaId, url: base('foto-antiga.png'), fileName: 'foto-antiga.png', mimeType: 'image/png', eventId: null, offset: 180_000 },
      ];

      await tx.mediaAsset.createMany({
        data: assets.map((asset) => ({
          id: asset.id,
          tenantId,
          eventId: asset.eventId,
          bucket: 'eventflow-assets',
          objectKey: `tenants/${tenantId}/eventos/assets/${asset.id}.webp`,
          url: asset.url,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          sizeBytes: 2048,
          checksum: randomUUID().replace(/-/g, '').padEnd(64, 'a').slice(0, 64),
          target: asset.mimeType === 'image/png' ? 'LOGO' : 'GALLERY',
          uploadedById: admin.id,
          createdAt: new Date(now - asset.offset),
        })),
      });

      /**
       * Duas imagens EM USO, pelos dois caminhos que a tela conhece: a capa do evento e o
       * logotipo do evento. As outras duas ficam livres — é o par que o filtro
       * "em uso × sem uso" separa.
       */
      await tx.event.update({
        where: { id: eventId },
        data: { coverImageUrl: base('capa.webp') },
      });

      await tx.event.update({
        where: { id: secondEventId },
        data: { logoUrl: base('galeria.webp') },
      });
    });

    /**
     * ── Acervo grande (transação própria) ──────────────────────────────────────
     *  O contexto de instituição é `SET LOCAL`, então trocar de instituição DENTRO da
     *  mesma transação funcionaria — e deixaria a fixture dependendo dessa sutileza.
     *  Duas transações, dois contextos: é o mesmo desenho do runtime.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${bulkTenantId}, true)`;

      await tx.event.create({
        data: {
          id: bulkEventId,
          tenantId: bulkTenantId,
          slug: `evento-acervo-grande-${RUN_ID}`,
          title: `Acervo grande ${RUN_ID}`,
          summary: 'Evento do cenário do teto de 200.',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
          confirmedCount: 0,
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
        },
      });

      await tx.mediaAsset.createMany({
        data: Array.from({ length: 205 }, (_, index) => ({
          id: randomUUID(),
          tenantId: bulkTenantId,
          eventId: bulkEventId,
          bucket: 'eventflow-assets',
          objectKey: `tenants/${bulkTenantId}/assets/imagem-${index}.webp`,
          url: `https://cdn.test/f51-e2e-${RUN_ID}/grande-${index}.webp`,
          fileName: `imagem-${index}.webp`,
          mimeType: 'image/webp',
          sizeBytes: 1000,
          checksum: randomUUID().replace(/-/g, '').padEnd(64, 'a').slice(0, 64),
          target: 'GALLERY',
          uploadedById: admin.id,
          createdAt: new Date(Date.now() - index * 60_000),
        })),
      });
    });
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('filtros do acervo de mídia', () => {
  test.fixme('1. cada filtro funciona SEM JavaScript, e os filtros combinam', async ({ browser }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA DA DÍVIDA E19
     * ─────────────────────────────────────────────────────────────────────────────
     *  `javaScriptEnabled: false` é o caso extremo: o bundle nunca carrega, e o clique em
     *  "Filtrar" tem de ser a submissão NATIVA do formulário. Se o filtro dependesse de
     *  hidratação, este teste não passaria — e é exatamente o que a dívida pedia, porque
     *  o acervo é operado por quem organiza, muitas vezes no meio do evento.
     */
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, adminEmail);
      await page.goto(mediaUrl());

      // ── Sem filtro: o acervo inteiro ────────────────────────────────────────
      await expect(page.getByTestId('media-summary')).toContainText('4 imagem(ns)');
      await expect(page.getByTestId('media-summary')).toContainText('2 em uso');
      await expect(assetRows(page)).toHaveCount(4);
      await expect(page.getByTestId('media-result-count')).toContainText('4 imagem(ns) no acervo.');

      // ── Busca por nome de arquivo ───────────────────────────────────────────
      await page.getByTestId('media-filter-search').fill('logo');
      await filtrar(page);

      // O filtro vive na URL: a tela é navegável por link e o "voltar" funciona.
      await expect(page).toHaveURL(/busca=logo/);
      await expect(assetRows(page)).toHaveCount(1);
      await expect(page.getByTestId('media-list')).toContainText('logo-parceiro.png');

      // ── Limpar ──────────────────────────────────────────────────────────────
      await page.getByTestId('media-filter-clear').click();
      await expect(assetRows(page)).toHaveCount(4);

      // ── Tipo ────────────────────────────────────────────────────────────────
      await page.getByTestId('media-filter-type').selectOption('image/png');
      await filtrar(page);
      await expect(assetRows(page)).toHaveCount(2);
      await expect(page.getByTestId('media-list')).toContainText('foto-antiga.png');

      // ── Evento de origem: o acervo sem evento ───────────────────────────────
      await page.goto(mediaUrl());
      await page.getByTestId('media-filter-event').selectOption('sem-evento');
      await filtrar(page);
      await expect(assetRows(page)).toHaveCount(1);
      await expect(page.getByTestId('media-list')).toContainText('foto-antiga.png');

      // ── Em uso ──────────────────────────────────────────────────────────────
      await page.goto(mediaUrl());
      await page.getByTestId('media-filter-usage').selectOption('em-uso');
      await filtrar(page);
      await expect(assetRows(page)).toHaveCount(2);
      await expect(page.locator('[data-testid^="media-"][data-in-use="false"]')).toHaveCount(0);
      await expect(page.locator(`[data-testid="media-${capaId}"]`)).toHaveAttribute(
        'data-in-use',
        'true',
      );
      await expect(page.getByTestId(`media-usage-${capaId}`)).toContainText(/Capa do evento/i);

      // ── Sem uso (o que dá para excluir) ─────────────────────────────────────
      await page.goto(mediaUrl());
      await page.getByTestId('media-filter-usage').selectOption('livre');
      await filtrar(page);
      await expect(assetRows(page)).toHaveCount(2);
      await expect(page.locator('[data-testid^="media-"][data-in-use="true"]')).toHaveCount(0);
      await expect(page.locator(`[data-testid="media-${antigaId}"]`)).toBeVisible();

      // ── Combinados: busca + tipo + sem uso ──────────────────────────────────
      await page.goto(mediaUrl());
      await page.getByTestId('media-filter-search').fill('antiga');
      await page.getByTestId('media-filter-type').selectOption('image/png');
      await page.getByTestId('media-filter-usage').selectOption('livre');
      await filtrar(page);

      await expect(assetRows(page)).toHaveCount(1);
      await expect(page.getByTestId('media-list')).toContainText('foto-antiga.png');
      await expect(page).toHaveURL(/uso=livre/);

      // ── O cabeçalho NÃO encolhe com o filtro ────────────────────────────────
      await expect(page.getByTestId('media-summary')).toContainText('4 imagem(ns)');
      await expect(page.getByTestId('media-result-count')).toContainText(
        '1 imagem(ns) no resultado.',
      );
    } finally {
      await context.close();
    }
  });

  test.fixme('2. busca sem resultado não inventa imagem', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(mediaUrl());

    await page.getByTestId('media-filter-search').fill('arquivo-que-nao-existe-9f8a');
    await page.getByTestId('media-filter-submit').click();
    await page.waitForLoadState('domcontentloaded');

    // A lista some e o aviso diz que o ACERVO tem imagens — só não aquela busca.
    await expect(page.getByTestId('media-list')).toHaveCount(0);
    await expect(page.getByTestId('empty-media')).toHaveCount(0);
    await expect(page.getByTestId('empty-media-filtered')).toBeVisible();
    await expect(page.getByTestId('empty-media-filtered')).toContainText('4 imagem(ns)');
    await expect(page.getByTestId('media-result-count')).toContainText('0 imagem(ns)');

    // E o caminho de volta funciona.
    await page.getByTestId('empty-media-filtered').getByRole('link').click();
    await expect(assetRows(page)).toHaveCount(4);
  });

  test('3. o acervo truncado se anuncia: "mostrando N de M"', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, adminEmail);
      await page.goto(bulkMediaUrl());

      await expect(assetRows(page)).toHaveCount(200);
      await expect(page.getByTestId('media-result-count')).toContainText(
        'Mostrando 200 de 205 imagens',
      );
      await expect(page.getByTestId('media-result-count')).toContainText('refine os filtros');

      // O acervo inteiro segue contado no cabeçalho — o teto é da JANELA, não do acervo.
      await expect(page.getByTestId('media-summary')).toContainText('205 imagem(ns)');
    } finally {
      await context.close();
    }
  });
});

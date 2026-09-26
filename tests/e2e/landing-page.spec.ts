/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Página pública, patrocínio e autoria (FASE 17)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. E3 — a página nasce como rascunho, o organizador monta os blocos, muda a
 *         ORDEM e publica; a página pública passa a renderizar o conteúdo e a
 *         desaparecer quando ele despublica;
 *      2. E4/E5 — o cadastro de patrocinador pela tela aparece na página pública e
 *         some ao ser ocultado (sem apagar o cadastro);
 *      3. E6 — o autor edita a lista de coautores na tela da submissão, com ordem e
 *         autor correspondente, e o dado fica gravado como ele definiu.
 *
 *  A ordem dos cenários importa: o segundo depende do evento publicado pelo
 *  primeiro. O estado durável é o BANCO (lição da FASE 14): nada é guardado em
 *  variável de módulo além de ids resolvidos no `beforeAll`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'landing-f17';
const EVENT_SLUG = `evento-f17-e2e-${RUN_ID}`;

/**
 * PNG 8×8 de verdade — a assinatura do arquivo é o que a validação confere, e a
 * imagem precisa DECODIFICAR para virar WebP (FASE 46).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE FIXTURE MUDOU DE 1×1 PARA 8×8
 * ─────────────────────────────────────────────────────────────────────────────
 *  O PNG 1×1 usado desde a FASE 17 tinha o CRC do `IDAT` ERRADO. O navegador perdoa
 *  e desenha; o libpng recusa o arquivo. Enquanto o conteúdo não era decodificado,
 *  ninguém notou — e a suíte inteira media uploads com um arquivo que não é imagem
 *  decodificável. Com a conversão para WebP, a recusa apareceu.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWM4oWHzHx9mGBkKAHkRisGTbO91AAAAAElFTkSuQmCC',
  'base64',
);

let tenantId: string;
let eventId: string;
let trackId: string;
let adminEmail: string;
let authorEmail: string;
let authorId: string;
let submissionId: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f17.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
      name: `Instituição Landing ${RUN_ID}`,
    });
    tenantId = tenant.id;

    eventId = randomUUID();
    trackId = randomUUID();

    const startsAt = new Date(Date.now() + 30 * 86_400_000);

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso Landing ${RUN_ID}`,
          summary: 'Evento criado para os testes da página pública.',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          capacity: null,
          confirmedCount: 0,
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
        },
      });

      await tx.track.create({
        data: {
          id: trackId,
          tenantId,
          eventId,
          slug: 'trilha-e2e',
          name: 'Trilha E2E da Página',
          description: 'Trilha criada para o cenário de página pública.',
          requiredReviews: 1,
          acceptanceThreshold: 70,
          rejectThreshold: 45,
          isActive: true,
        },
      });
    });

    /**
     * As contas nascem no `beforeAll` — e não no primeiro teste — porque um teste
     * que falha pode reiniciar o worker (armadilha 26) e os cenários seguintes
     * precisam do estado durável no banco.
     */
    const admin = await signUpVia(api, `Admin Landing ${RUN_ID}`);
    adminEmail = admin.email;
    await linkUser({ tenantId, userId: admin.id });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });

    const author = await signUpVia(api, `Autora Landing ${RUN_ID}`);
    authorEmail = author.email;
    authorId = author.id;
    await linkUser({ tenantId, userId: author.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: author.id, role: 'PARTICIPANT' });

    submissionId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.submission.create({
        data: {
          id: submissionId,
          tenantId,
          eventId,
          trackId,
          protocol: `F17-${RUN_ID.slice(0, 4).toUpperCase()}`,
          title: `Trabalho com coautoria ${RUN_ID}`,
          abstract:
            'Resumo suficientemente longo para permitir a avaliação de mérito por pares e o envio da submissão neste cenário de teste de autoria.',
          keywords: ['tecnologia', 'educação', 'coautoria'],
          status: 'DRAFT',
          submittedById: authorId,
          version: 1,
        },
      });

      await tx.submissionAuthor.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId,
          userId: authorId,
          authorOrder: 1,
          isCorresponding: true,
        },
      });
    });
  } finally {
    await api.dispose();
  }
});

test.describe('página pública, patrocínio e autoria', () => {
  test('a página nasce como rascunho e não muda o site antes de publicar (E3)', async ({ page }) => {
    await signInAs(page, adminEmail);

    const response = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina`);
    expect(response?.status()).toBe(200);

    // Sem página: o editor oferece criá-la.
    await expect(page.getByTestId('create-page')).toBeVisible();
    await page.getByTestId('create-page').getByTestId('admin-submit').click();

    await expect(page.getByTestId('landing-status')).toContainText(/rascunho/i, { timeout: 20_000 });
    await expect(page.getByTestId('empty-blocks')).toBeVisible();

    /**
     * A página pública continua na COMPOSIÇÃO PADRÃO: o rascunho não muda o site.
     * A prova é o resumo do evento (que a composição padrão usa) estar visível —
     * e não os blocos, que nem existem ainda.
     */
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    const publicPage = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    expect(publicPage?.status()).toBe(200);
    await expect(
      page.getByText('Evento criado para os testes da página pública.'),
    ).toBeVisible();

    await signInAs(page, adminEmail);
  });

  test('o organizador monta os blocos, reordena e publica; o site passa a renderizá-los (E3)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/pagina`);

    // ── Composição sugerida: ponto de partida, não uma página em branco ────────
    await page.getByTestId('seed-blocks').getByTestId('inline-submit').click();
    await expect(page.getByTestId('block-list')).toBeVisible({ timeout: 20_000 });

    const blocks = page.locator('[data-testid^="block-"][data-type]');
    const initialCount = await blocks.count();
    expect(initialCount).toBeGreaterThan(3);

    // ── Adiciona um bloco de texto e preenche ──────────────────────────────────
    const addForm = page.getByTestId('add-block');
    await addForm.getByLabel('Tipo de bloco').selectOption('RICH_TEXT');
    await addForm.getByTestId('admin-submit').click();

    /**
     * A espera é pela CONTAGEM, não por "está visível": a composição sugerida já
     * tem um bloco de texto, então `expect(últimoTexto).toBeVisible()` passaria
     * apontando para o bloco ANTIGO — e o teste editaria o bloco errado sem
     * perceber (foi exatamente o que aconteceu na primeira execução).
     */
    await expect(blocks).toHaveCount(initialCount + 1, { timeout: 20_000 });

    const textBlock = page.locator('[data-type="RICH_TEXT"]').last();
    await textBlock.locator('summary', { hasText: 'Editar conteúdo' }).click();
    await textBlock.getByLabel('Texto').fill(`Conteúdo publicado pela FASE 17 — ${RUN_ID}`);

    const blockId = await textBlock.getAttribute('data-testid');
    await textBlock.locator('[data-testid^="block-form-"]').getByTestId('admin-submit').click();
    await expect(page.locator(`[data-testid="block-summary-${blockId?.replace('block-', '')}"]`)).toContainText(
      /caractere/,
      { timeout: 20_000 },
    );

    // ── Reordena: sobe o bloco novo uma posição ───────────────────────────────
    const id = blockId?.replace('block-', '') ?? '';
    await page.getByTestId(`move-up-${id}`).getByTestId('inline-submit').click();

    // Ele deixa de ser o último e passa a ocupar a penúltima posição.
    await expect(
      page.locator('[data-testid^="block-"][data-type]').nth(initialCount - 1),
    ).toHaveAttribute('data-testid', `block-${id}`, { timeout: 20_000 });

    // ── Publica ───────────────────────────────────────────────────────────────
    const settings = page.getByTestId('page-settings');
    await settings.getByLabel('Título da página').fill(`Congresso Landing ${RUN_ID}`);
    await settings.getByLabel(/Publicar a página/).check();
    await settings.getByTestId('admin-submit').click();

    await expect(page.getByTestId('landing-status')).toContainText(/publicada/i, { timeout: 20_000 });

    // ── A página pública (sem sessão) mostra o conteúdo publicado ─────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

    const publicPage = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    expect(publicPage?.status()).toBe(200);
    await expect(page.getByText(`Conteúdo publicado pela FASE 17 — ${RUN_ID}`)).toBeVisible();

    const stored = await e2eDb.eventPage.findFirstOrThrow({
      where: { eventId },
      select: { isPublished: true },
    });
    expect(stored.isPublished).toBe(true);
  });

  test('o patrocinador cadastrado aparece na página e some ao ser ocultado (E4, E5)', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/patrocinadores`);

    // ── Cota ──────────────────────────────────────────────────────────────────
    const tierForm = page.getByTestId('create-tier');
    await tierForm.getByLabel('Nome da cota').fill(`Ouro ${RUN_ID}`);
    await tierForm.getByLabel('Ordem de exibição').fill('10');
    await tierForm.getByLabel('Limite de patrocinadores').fill('1');
    await tierForm.getByTestId('admin-submit').click();

    await expect(page.getByTestId('tier-list')).toContainText(`Ouro ${RUN_ID}`, { timeout: 20_000 });

    // ── Patrocinador ──────────────────────────────────────────────────────────
    const sponsorName = `Instituto Parceiro ${RUN_ID}`;
    const sponsorForm = page.getByTestId('create-sponsor');
    await sponsorForm.getByLabel('Nome').fill(sponsorName);
    // A primeira cota do seletor é a recém-criada ("Sem cota" vem antes por padrão).
    await sponsorForm.getByLabel('Cota').selectOption({ index: 1 });
    await sponsorForm.getByLabel('Site').fill('https://example.org/parceiro');
    await sponsorForm.getByTestId('admin-submit').click();

    await expect(page.getByTestId('sponsor-list')).toContainText(sponsorName, { timeout: 20_000 });

    // O limite da cota (1) já está ocupado: o segundo é RECUSADO com o motivo.
    const secondForm = page.getByTestId('create-sponsor');
    await secondForm.getByLabel('Nome').fill(`Segundo Parceiro ${RUN_ID}`);
    await secondForm.getByLabel('Cota').selectOption({ index: 1 });
    await secondForm.getByTestId('admin-submit').click();

    await expect(secondForm.getByTestId('create-sponsor-feedback')).toContainText(/completa|comporta/i, {
      timeout: 20_000,
    });

    // ── Página pública mostra o patrocinador ──────────────────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    await expect(page.getByText(sponsorName)).toBeVisible();

    // ── Ocultar tira da página SEM apagar o cadastro ──────────────────────────
    await signInAs(page, adminEmail);
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/patrocinadores`);

    const row = page.locator('[data-testid^="sponsor-"][data-active="true"]').last();
    await row.locator('[data-testid^="toggle-sponsor-"]').getByTestId('inline-submit').click();

    await expect(page.locator('[data-testid^="sponsor-"][data-active="false"]')).toHaveCount(1, {
      timeout: 20_000,
    });

    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    await expect(page.getByText(sponsorName)).toHaveCount(0);

    // O cadastro permanece (a remoção seria lógica; aqui nem foi removido).
    const stored = await e2eDb.sponsor.findFirstOrThrow({
      where: { tenantId, eventId },
      select: { isActive: true, deletedAt: true },
    });
    expect(stored.isActive).toBe(false);
    expect(stored.deletedAt).toBeNull();
  });

  test('a cota escolhe COR e TAMANHO da logo, e a página pública muda os dois (FASE 41)', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/patrocinadores`);

    /**
     * ─── A COTA NOVA NASCE COM COR E TAMANHO ────────────────────────────────────
     *
     *  Antes desta fase o campo de cor existia só dentro do "Editar cota" (recolhido)
     *  e o tamanho não existia em lugar nenhum: toda logo saía com a mesma altura na
     *  página pública. O cenário monta DUAS cotas com degraus diferentes e mede o
     *  resultado na página — é a única prova de que o tamanho é a hierarquia
     *  comprada, e não um número guardado sem leitor.
     */
    const grande = page.getByTestId('create-tier');
    await grande.getByLabel('Nome da cota').fill(`Vitrine Grande ${RUN_ID}`);
    await grande.getByLabel('Ordem de exibição').fill('70');
    await grande.getByTestId('tier-style-new-scale').selectOption('FEATURE');
    await grande.getByTestId('tier-style-new-color').fill('#b45309');
    await grande.getByTestId('admin-submit').click();
    await expect(page.getByTestId('tier-list')).toContainText(`Vitrine Grande ${RUN_ID}`, {
      timeout: 20_000,
    });

    const pequena = page.getByTestId('create-tier');
    await pequena.getByLabel('Nome da cota').fill(`Vitrine Pequena ${RUN_ID}`);
    await pequena.getByLabel('Ordem de exibição').fill('80');
    await pequena.getByTestId('tier-style-new-scale').selectOption('SMALL');
    // A cor sai pelo ATALHO (a amostra) em vez de digitada: é o caminho que o
    // organizador usa, e ele precisa escrever no mesmo campo que o servidor lê.
    await pequena.getByTestId('tier-style-new-swatch-prata').click();
    await pequena.getByTestId('admin-submit').click();
    await expect(page.getByTestId('tier-list')).toContainText(`Vitrine Pequena ${RUN_ID}`, {
      timeout: 20_000,
    });

    /**
     * A LISTA da tela mostra o degrau escolhido — sem isso, o organizador não tem
     * como saber o que já configurou sem abrir cota por cota.
     */
    await expect(page.getByTestId('tier-list')).toContainText('logo destaque');

    // ── Um patrocinador em cada cota, cada um com a SUA logo ──────────────────
    for (const [nomeCota, nomeEmpresa] of [
      [`Vitrine Grande ${RUN_ID}`, `Marca Grande ${RUN_ID}`],
      [`Vitrine Pequena ${RUN_ID}`, `Marca Pequena ${RUN_ID}`],
    ] as const) {
      const form = page.getByTestId('create-sponsor');
      await form.getByLabel('Nome').fill(nomeEmpresa);
      /** O rótulo da opção é o nome da cota, e cotas ilimitadas não têm sufixo. */
      await form.getByLabel('Cota').selectOption({ label: nomeCota });
      await form.getByTestId('admin-submit').click();
      await expect(page.getByTestId('sponsor-list')).toContainText(nomeEmpresa, { timeout: 20_000 });

      /**
       * A logo entra pela esteira real (assinatura do arquivo + bucket). Sem ela, o
       * cartão do patrocinador é só o NOME — e aí o tamanho da cota não teria o que
       * dimensionar, que é justamente o que este cenário mede.
       */
      const linha = page.locator('li[data-testid^="sponsor-"]').filter({ hasText: nomeEmpresa });
      const uploader = linha.getByTestId('asset-uploader-SPONSOR_LOGO');

      await uploader.getByLabel('Logotipo do patrocinador').setInputFiles({
        name: `logo-${RUN_ID}.png`,
        mimeType: 'image/png',
        buffer: PNG_1X1,
      });
      await uploader.getByRole('button', { name: /Enviar imagem/i }).click();
      await expect(uploader.getByTestId('asset-status-SPONSOR_LOGO')).toContainText(/guardada em WebP/i, {
        timeout: 30_000,
      });
    }

    // ── Página pública: cartões diferentes, por cota ──────────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);

    const faixaGrande = page.locator('[data-testid="sponsor-tier"][data-tier-scale="FEATURE"]').first();
    const faixaPequena = page.locator('[data-testid="sponsor-tier"][data-tier-scale="SMALL"]').first();

    /**
     * Com logo, o NOME do patrocinador é o `alt` da imagem (não há texto) — então a
     * asserção é sobre a imagem acessível, e não sobre o texto da faixa: procurar o
     * nome como texto não acharia nada e o teste reprovaria com o produto certo.
     */
    await expect(faixaGrande.getByRole('img', { name: `Marca Grande ${RUN_ID}` })).toBeVisible();
    await expect(faixaPequena.getByRole('img', { name: `Marca Pequena ${RUN_ID}` })).toBeVisible();

    await expect(faixaGrande).toContainText(`Vitrine Grande ${RUN_ID}`);
    await expect(faixaPequena).toContainText(`Vitrine Pequena ${RUN_ID}`);

    /**
     * O cartão da cota colorida traz o tom no `style` (é DADO, e vai inline de
     * propósito: a cor não é token do sistema, é a cor que o patrocinador comprou).
     */
    const cartaoGrande = faixaGrande.getByTestId('sponsor-card').first();
    await expect(cartaoGrande).toHaveAttribute('style', /color-mix/);

    /**
     * E a diferença de tamanho é MEDIDA, não presumida: as duas logos são o MESMO
     * PNG (1×1), então a única coisa que pode deixar um cartão mais alto que o outro
     * é o degrau escolhido na cota. Comparar atributo provaria apenas que o dado
     * chegou; medir prova que ele virou desenho.
     */
    const alturaGrande = (await cartaoGrande.boundingBox())?.height ?? 0;
    const alturaPequena = (await faixaPequena.getByTestId('sponsor-card').first().boundingBox())?.height ?? 0;

    expect(alturaGrande).toBeGreaterThan(0);
    expect(alturaGrande).toBeGreaterThan(alturaPequena);
  });

  test('o autor edita a lista de coautores, com ordem e correspondente (E6)', async ({ page }) => {
    await signInAs(page, authorEmail);

    const response = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/submissoes/${submissionId}`);
    expect(response?.status()).toBe(200);

    const editor = page.getByTestId('author-editor');
    await expect(editor).toBeVisible();

    // ── Adiciona dois coautores ───────────────────────────────────────────────
    await page.getByTestId('add-author-row').click();
    await page.getByTestId('add-author-row').click();

    /**
     * O primeiro autor tem CONTA: o nome vem do perfil e o campo é somente leitura
     * (o crédito usa sempre o nome cadastrado). Os coautores são convidados.
     */
    await editor.getByLabel('Instituição do autor 1').fill('Universidade Federal da Bahia');

    await editor.getByLabel('Nome do autor 2').fill(`Bruno Segundo ${RUN_ID}`);
    await editor.getByLabel('E-mail do autor 2').fill(`f17b.${RUN_ID}@exemplo.test`);
    await editor.getByLabel('Instituição do autor 2').fill('Universidade de São Paulo');

    await editor.getByLabel('Nome do autor 3').fill(`Carla Terceira ${RUN_ID}`);
    await editor.getByLabel('E-mail do autor 3').fill(`f17c.${RUN_ID}@exemplo.test`);

    // O correspondente passa a ser o SEGUNDO autor.
    await page.getByTestId('author-row-1').getByRole('radio').check();

    // ── Reordena: sobe o terceiro (seria o último) ─────────────────────────────
    await page.getByTestId('author-row-2').getByRole('button', { name: /para cima/i }).click();

    await page.getByTestId('save-authors').click();
    await expect(page.getByTestId('author-feedback')).toContainText(/autoria atualizada/i, {
      timeout: 20_000,
    });

    // ── O banco confirma ordem, correspondente e vínculo ──────────────────────
    const rows = await e2eDb.submissionAuthor.findMany({
      where: { submissionId },
      orderBy: { authorOrder: 'asc' },
      select: {
        authorOrder: true,
        guestName: true,
        guestEmail: true,
        userId: true,
        institution: true,
        isCorresponding: true,
      },
    });

    expect(rows.map((row) => row.authorOrder)).toEqual([1, 2, 3]);

    // Posição 1: quem submeteu mantém o vínculo de conta (nome vem do perfil).
    expect(rows[0]?.userId).toBe(authorId);
    expect(rows[0]?.guestName).toBeNull();
    expect(rows[0]?.institution).toBe('Universidade Federal da Bahia');

    // Posições 2 e 3: coautores convidados, na ordem definida na tela.
    expect(rows[1]?.guestName).toBe(`Carla Terceira ${RUN_ID}`);
    expect(rows[2]?.guestName).toBe(`Bruno Segundo ${RUN_ID}`);
    expect(rows[2]?.userId).toBeNull();

    // Exatamente um correspondente — e é o que estava marcado (Bruno, agora 3º).
    expect(rows.filter((row) => row.isCorresponding)).toHaveLength(1);
    expect(rows[2]?.isCorresponding).toBe(true);
  });
});

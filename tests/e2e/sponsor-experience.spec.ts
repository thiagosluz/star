import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'patrocinio-f42';
const EVENT_SLUG = `evento-f42-${RUN_ID}`;

/**
 * O caminho do decodificador que o LEITOR DE CRACHÁ já usa no navegador.
 *
 * Ele é injetado na página do teste para decodificar a imagem que a tela mostra — o
 * `qrcode` não traz decodificador, e escrever um aqui seria medir outra coisa.
 */
const JSQR_BUNDLE = path.join(process.cwd(), 'node_modules', 'jsqr', 'dist', 'jsQR.js');

/**
 * Lê o QR de DENTRO da imagem exibida.
 *
 * ─── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 *  Um `src` que começa com `data:image/png` não prova nada: a imagem pode estar em
 *  branco, apontar para outro endereço ou carregar um caminho relativo — que é
 *  justamente o defeito que a fase teve (endereço em texto, sem peça). Aqui a imagem
 *  é desenhada num canvas, os pixels são lidos e o código é decodificado; o que sai
 *  tem de ser o endereço ABSOLUTO do QR.
 */
async function decodeQrFromImage(page: import('@playwright/test').Page, qrId: string): Promise<string | null> {
  await page.addScriptTag({ path: JSQR_BUNDLE });

  return page.evaluate((id) => {
    type QrReading = { data: string } | null;
    type DecoderWindow = Window & {
      jsQR?: (data: Uint8ClampedArray, width: number, height: number) => QrReading;
    };

    const decoder = (window as DecoderWindow).jsQR;
    const image = document.querySelector<HTMLImageElement>(`[data-testid="qr-image-${id}"]`);

    if (!image || !decoder || image.naturalWidth === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext('2d');
    if (!context) return null;

    context.drawImage(image, 0, 0);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return decoder(pixels.data, pixels.width, pixels.height)?.data ?? null;
  }, qrId);
}

let tenantId: string;
let eventId: string;
let sponsorId: string;
let organizerEmail: string;
let participantEmail: string;
let contactEmail: string;
let outroParticipanteEmail: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;
const sponsorsUrl = () => `/t/${slug}/administracao/eventos/${eventId}/patrocinadores`;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f42.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

async function signIn(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Patrocínio ${RUN_ID}`,
    });
    tenantId = tenant.id;
    eventId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 30 * 86_400_000);

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso do Patrocínio ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
          confirmedCount: 0,
        },
      });

      /**
       * O patrocinador é criado DIRETO no banco: o que este cenário mede é a
       * EXPERIÊNCIA (QR, consentimento e lead), e o cadastro de patrocínio já tem
       * cenário próprio na FASE 17.
       */
      sponsorId = randomUUID();

      await tx.sponsor.create({
        data: {
          id: sponsorId,
          tenantId,
          eventId,
          name: `Instituto Parceiro F42 ${RUN_ID}`,
          slug: `instituto-parceiro-f42-${RUN_ID}`,
          description: 'Patrocinador do cenário de leitura por QR.',
          logoUrl: null,
          websiteUrl: null,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          taxId: null,
          contractValueCents: 1_500_000,
          contractStart: new Date('2026-08-01T00:00:00.000Z'),
          contractEnd: new Date('2026-12-31T00:00:00.000Z'),
          displayOrder: 0,
          isActive: true,
        },
      });
    });

    const organizer = await signUpVia(api, `Organizadora F42 ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });

    const participant = await signUpVia(api, `Participante F42 ${RUN_ID}`);
    participantEmail = participant.email;
    await linkUser({ tenantId, userId: participant.id });
    await grantRole({ tenantId, userId: participant.id, role: 'PARTICIPANT' });

    const contact = await signUpVia(api, `Contato do Patrocinador F42 ${RUN_ID}`);
    contactEmail = contact.email;
    await linkUser({ tenantId, userId: contact.id });

    /**
     * Segunda pessoa: o cenário 3 mede a leitura SEM autorização, e o crédito é um
     * por pessoa — usar a mesma do cenário 2 mediria a releitura, não a escolha.
     */
    const outro = await signUpVia(api, `Sem Consentimento F42 ${RUN_ID}`);
    outroParticipanteEmail = outro.email;
    await linkUser({ tenantId, userId: outro.id });
    await grantRole({ tenantId, userId: outro.id, role: 'PARTICIPANT' });
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('experiência do patrocinador', () => {
  test('1. a organização cria o QR, vincula o contato e o código aparece para imprimir', async ({
    page,
  }) => {
    await signIn(page, organizerEmail);
    await page.goto(sponsorsUrl());

    const painel = page.getByTestId('sponsor-experience');

    /**
     * O QR nasce na MESMA tela do cadastro do patrocínio: é decisão comercial
     * (o QR é parte do que a cota entrega), e não configuração escondida.
     */
    await painel.getByText('Criar QR do estande').click();

    const qrForm = page.getByTestId(`qr-new-${sponsorId}`);
    await qrForm.getByLabel('Nome do QR').fill('Estande — entrada');
    await qrForm.getByLabel('XP por visita').fill('120');
    await qrForm.getByLabel('Autorização (dias)').fill('30');
    await qrForm.getByTestId('admin-submit').click();

    /** A resposta diz o CÓDIGO: é ele que vai impresso no estande. */
    await expect(page.getByTestId(`qr-new-${sponsorId}-feedback`)).toContainText(/QR criado/i, {
      timeout: 30_000,
    });

    const qr = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.sponsorQrCode.findFirstOrThrow({
        where: { tenantId, sponsorId },
        select: { id: true, code: true, xpAmount: true, consentDays: true },
      });
    });

    expect(qr.xpAmount).toBe(120);
    expect(qr.consentDays).toBe(30);
    expect(qr.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    /**
     * ── A PEÇA DO ESTANDE ─────────────────────────────────────────────────────
     *
     *  Não basta o código em texto: quem lê o QR é a CÂMERA do participante. A
     *  imagem tem de existir e — o que o data URL não prova — carregar o endereço
     *  ABSOLUTO, porque um caminho relativo não abre nada no celular de quem está no
     *  pavilhão. Por isso a imagem é DECODIFICADA aqui, e não só inspecionada.
     */
    const enderecoEsperado = `http://localhost:3000/t/${slug}/patrocinio/${qr.code}`;
    const imagemDoQr = page.getByTestId(`qr-image-${qr.id}`);

    await expect(imagemDoQr).toBeVisible();
    await expect(imagemDoQr).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(imagemDoQr).toHaveAttribute('data-qr-url', enderecoEsperado);

    expect(await decodeQrFromImage(page, qr.id)).toBe(enderecoEsperado);

    // ── O arquivo que vai para a gráfica ─────────────────────────────────────
    const png = await page.request.get(`/api/t/${slug}/patrocinadores/qr/${qr.id}`);

    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toBe('image/png');
    expect((await png.body()).byteLength).toBeGreaterThan(500);

    const svg = await page.request.get(`/api/t/${slug}/patrocinadores/qr/${qr.id}?formato=svg`);

    expect(svg.status()).toBe(200);
    expect(svg.headers()['content-type']).toContain('image/svg+xml');
    expect(await svg.text()).toContain('<svg');

    // ── Vínculo manual: o contato já tem conta na instituição ────────────────
    /**
     * Os DOIS caminhos vivem no mesmo `<details>`, e por isso o painel é aberto UMA
     * vez: clicar de novo no `summary` o fecharia (foi o que quebrou este cenário na
     * primeira execução — o campo seguinte ficava invisível).
     */
    await painel.getByText('Convidar ou vincular pessoa').click();

    const linkForm = page.getByTestId(`sponsor-link-${sponsorId}`);
    await expect(linkForm.getByLabel('E-mail de quem JÁ tem conta')).toBeVisible();

    await linkForm.getByLabel('E-mail de quem JÁ tem conta').fill(contactEmail);
    await linkForm.getByTestId('admin-submit').click();

    await expect(page.getByTestId(`sponsor-team-${sponsorId}`)).toContainText('ativo', {
      timeout: 30_000,
    });

    /** E o convite por código continua existindo para quem NÃO tem conta ainda. */
    const inviteForm = page.getByTestId(`sponsor-invite-${sponsorId}`);
    await inviteForm.getByLabel('E-mail do contato').fill(`novo.contato.${RUN_ID}@exemplo.test`);
    await inviteForm.getByTestId('admin-submit').click();

    await expect(page.getByTestId(`sponsor-invite-${sponsorId}-feedback`)).toContainText(
      /convite gerado/i,
      { timeout: 30_000 },
    );
  });

  test('2. o participante lê o QR, autoriza, e o patrocinador vê o contato — até revogar', async ({
    page,
  }) => {
    const qr = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.sponsorQrCode.findFirstOrThrow({
        where: { tenantId, sponsorId },
        select: { id: true, code: true },
      });
    });

    // ── O participante lê o QR (é o que a câmera do celular abre) ────────────
    await signIn(page, participantEmail);
    await page.goto(`/t/${slug}/patrocinio/${qr.code}`);

    const leitura = page.getByTestId('sponsor-scan');
    await expect(leitura).toBeVisible();

    /** O texto do consentimento aparece ANTES dos botões. */
    await expect(page.getByTestId('consent-text')).toContainText('revogar');

    await page.getByTestId('scan-consent').click();

    await expect(page.getByTestId('scan-result')).toContainText('120 XP', { timeout: 30_000 });
    await expect(page.getByTestId('scan-result')).toContainText('compartilhados');

    // ── O patrocinador vê o contato na área dele ─────────────────────────────
    await signIn(page, contactEmail);
    await page.goto(`/t/${slug}/patrocinador`);

    await expect(page.getByTestId('sponsor-area')).toBeVisible();
    await expect(page.getByTestId('sponsor-visits')).toHaveText('1');
    await expect(page.getByTestId('sponsor-leads')).toHaveText('1');
    await expect(page.getByTestId('sponsor-lead-table')).toContainText(participantEmail);

    /** A área é de LEITURA: não há botão de editar cota, contrato ou QR. */
    await expect(page.getByRole('button', { name: /salvar|editar|excluir/i })).toHaveCount(0);

    /**
     * ── A MESMA PEÇA, DO LADO DO PATROCINADOR ─────────────────────────────────
     *
     *  Quem monta o estande é o patrocinador, e a peça é parte do que a cota dele
     *  entrega: ele vê a MESMA imagem (decodificada, com o endereço absoluto) e baixa
     *  o arquivo. Baixar é leitura — a área continua sem nenhuma ação de escrita.
     */
    const enderecoDoQr = `http://localhost:3000/t/${slug}/patrocinio/${qr.code}`;
    const imagemDoPatrocinador = page.getByTestId(`qr-image-${qr.id}`);

    await expect(imagemDoPatrocinador).toHaveAttribute('data-qr-url', enderecoDoQr);
    expect(await decodeQrFromImage(page, qr.id)).toBe(enderecoDoQr);

    /** O vínculo abre a SEGUNDA porta da rota: o patrocinador baixa o QR dele. */
    const arquivo = await page.request.get(`/api/t/${slug}/patrocinadores/qr/${qr.id}`);

    expect(arquivo.status()).toBe(200);
    expect(arquivo.headers()['content-type']).toBe('image/png');

    // ── O participante revoga, e o contato sai da lista ──────────────────────
    await signIn(page, participantEmail);
    await page.goto(`/t/${slug}/meus-compartilhamentos`);

    const lista = page.getByTestId('my-shares-list');
    await expect(lista).toContainText(participantEmail);

    /**
     * Com `confirm`, o botão do formulário é o que ABRE o diálogo (`-open`); o envio
     * acontece no botão de dentro dele. Sem confirmar, o `inline-submit` enviaria
     * direto — e o cenário estaria medindo outro caminho.
     */
    await page.locator('[data-testid^="revoke-"]').first().getByTestId(/revoke-.*-open/).click();

    await page.getByRole('button', { name: 'Revogar autorização' }).click();
    await expect(lista).toContainText('revogada', { timeout: 30_000 });

    await signIn(page, contactEmail);
    await page.goto(`/t/${slug}/patrocinador`);

    await expect(page.getByTestId('sponsor-leads')).toHaveText('0');
    await expect(page.getByTestId('sponsor-no-leads')).toBeVisible();

    /** A VISITA continua contada: o número não mente sobre o que aconteceu. */
    await expect(page.getByTestId('sponsor-visits')).toHaveText('1');
  });

  test('3. sem autorização o contato não existe, mas o crédito acontece igual', async ({ page }) => {
    const qr = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.sponsorQrCode.findFirstOrThrow({
        where: { tenantId, sponsorId },
        select: { id: true, code: true },
      });
    });

    /**
     * A segunda pessoa (criada no `beforeAll`) lê o MESMO QR e escolhe não
     * compartilhar: o crédito é igual, e o contato não nasce.
     */
    await signIn(page, outroParticipanteEmail);
    await page.goto(`/t/${slug}/patrocinio/${qr.code}`);

    await page.getByTestId('scan-no-consent').click();

    await expect(page.getByTestId('scan-result')).toContainText('120 XP', { timeout: 30_000 });
    await expect(page.getByTestId('scan-result')).toContainText('não compartilhar');

    /**
     * SEM VÍNCULO NÃO HÁ ARQUIVO: o QR é do patrocinador, e quem não é a organização
     * nem o dono não baixa a peça — nem com o `qrId` na mão.
     */
    const proibido = await page.request.get(`/api/t/${slug}/patrocinadores/qr/${qr.id}`);
    expect(proibido.status()).toBe(403);

    /** A visita conta; o contato NÃO aparece para o patrocinador. */
    await signIn(page, contactEmail);
    await page.goto(`/t/${slug}/patrocinador`);

    await expect(page.getByTestId('sponsor-visits')).toHaveText('2');
    await expect(page.getByTestId('sponsor-leads')).toHaveText('0');
  });
});

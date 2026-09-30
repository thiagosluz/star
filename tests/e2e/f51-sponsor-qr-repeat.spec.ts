/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — QR REPETIDO DO PATROCINADOR (FASE 51, dívida E57)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. o PRIMEIRO QR nasce sem aviso — o aviso não pode aparecer para quem está
 *      cadastrando o estande pela primeira vez;
 *   2. o SEGUNDO avisa e é RECUSADO: a mensagem diz QUANTOS já existem e o EFEITO
 *      (cada código novo é uma chance nova de creditar a mesma pessoa);
 *   3. com a confirmação marcada, ele grava — e o que a instituição confirmou fica
 *      na TRILHA ("por que este patrocinador tem quatro QRs?" tem resposta);
 *   4. **SEM JavaScript**, o mesmo aviso aparece e o segundo passo é uma NAVEGAÇÃO
 *      (`?confirmarQr=<sponsorId>`): a página recarrega com a confirmação já posta e
 *      o formulário pronto para gravar. Um `confirm()` do navegador não serviria —
 *      e o projeto proíbe caixa nativa justamente por isso;
 *   5. o aviso é do PAR (patrocinador, evento): outro patrocinador no mesmo evento
 *      NÃO dispara.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A DECISÃO É DA INSTITUIÇÃO, E NÃO DO SISTEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O mesmo patrocinador pode legitimamente ter dois estandes (a praça de alimentação
 *  e o palco), e um teto fixo recusaria um caso real — a instituição contornaria com
 *  dois cadastros, que é pior. O que o sistema faz é CONTAR, DIZER O EFEITO e pedir
 *  um segundo passo. Os cenários 2 e 3 são exatamente essa fronteira.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'qr-repetido-f51';
const EVENT_SLUG = `evento-qr-repetido-${RUN_ID}`;

let tenantId: string;
let slug: string;
let eventId: string;
let organizerEmail: string;
let sponsorId: string;
let otherSponsorId: string;

const sponsorsUrl = () => `/t/${slug}/administracao/eventos/${eventId}/patrocinadores`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f51qr.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Quantos QRs o patrocinador tem NAQUELE evento — a mesma conta do aviso. */
async function qrCount(targetSponsor = sponsorId): Promise<number> {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.sponsorQrCode.count({ where: { tenantId, sponsorId: targetSponsor, eventId, deletedAt: null } });
  });
}

/**
 * Clica até o efeito acontecer (a primeira submissão pode se perder na hidratação).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O ESCOPO FAZ PARTE DO CLIQUE
 * ─────────────────────────────────────────────────────────────────────────────
 *  `admin-submit` é o testid de TODA ação administrativa desta base: na tela do
 *  patrocinador ele resolve para DEZ botões (cotas, cadastro, convite, QR de cada
 *  patrocinador…), e o Playwright recusa clicar em locator ambíguo no modo estrito. O
 *  escopo é o formulário do QR daquele patrocinador — o mesmo caminho de quem usa.
 */
async function clickUntil(
  page: import('@playwright/test').Page,
  scopeTestId: string,
  effect: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    const escopo = page.getByTestId(scopeTestId);
    const botao = escopo.getByTestId('admin-submit');

    if ((await botao.count()) > 0) await botao.click();

    await effect();
  }).toPass({ timeout: 60_000 });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do QR Repetido ${RUN_ID}`,
    });

    tenantId = tenant.id;
    slug = tenant.slug;
    eventId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 30 * 86_400_000);

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso do QR Repetido ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
          confirmedCount: 0,
        },
      });

      /** Os patrocinadores nascem direto no banco: o cadastro tem cenário próprio. */
      sponsorId = randomUUID();
      otherSponsorId = randomUUID();

      for (const [id, name, order] of [
        [sponsorId, `Instituto Parceiro ${RUN_ID}`, 0],
        [otherSponsorId, `Editora Parceira ${RUN_ID}`, 1],
      ] as const) {
        await tx.sponsor.create({
          data: {
            id,
            tenantId,
            eventId,
            name,
            slug: `parceiro-${RUN_ID}-${order}`,
            description: null,
            logoUrl: null,
            websiteUrl: null,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
            taxId: null,
            contractValueCents: null,
            contractStart: null,
            contractEnd: null,
            displayOrder: order,
            isActive: true,
          },
        });
      }
    });

    const organizer = await signUpVia(api, `Organizadora do QR ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

/** Abre o painel do patrocinador e o formulário de QR, já aberto. */
async function openQrForm(
  page: import('@playwright/test').Page,
  targetSponsor = sponsorId,
): Promise<void> {
  await page.goto(sponsorsUrl());
  await expect(page.getByTestId('sponsor-experience')).toBeVisible({ timeout: 30_000 });

  const details = page.getByTestId(`qr-new-${targetSponsor}`).locator('xpath=ancestor::details[1]');

  if (!(await details.getAttribute('open'))) {
    await details.locator('summary').click();
  }

  await expect(page.getByTestId(`qr-new-${targetSponsor}`)).toBeVisible();
}

test.describe('QR repetido do patrocinador', () => {
  test('1. o PRIMEIRO QR nasce sem aviso', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await openQrForm(page);

    const form = page.getByTestId(`qr-new-${sponsorId}`);

    await form.getByLabel('Nome do QR').fill('Estande — entrada');
    await form.getByLabel('XP por visita').fill('25');

    await clickUntil(page, `qr-new-${sponsorId}`, async () => {
      expect(await qrCount()).toBe(1);
    });

    await expect(page.getByTestId(`qr-new-${sponsorId}-feedback`)).toContainText(/QR criado/i, {
      timeout: 30_000,
    });

    /** Nenhum aviso na primeira vez: o cadastro do primeiro estande é normal. */
    await expect(page.getByTestId(`qr-repeat-warning-${sponsorId}`)).toHaveCount(0);
  });

  test('2. o SEGUNDO avisa e é RECUSADO sem confirmação', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(sponsorsUrl());

    /** O aviso não aparece antes de tentar: é a RESPOSTA do servidor, com o número. */
    await expect(page.getByTestId(`qr-repeat-warning-${sponsorId}`)).toHaveCount(0);

    await openQrForm(page);

    const form = page.getByTestId(`qr-new-${sponsorId}`);

    await form.getByLabel('Nome do QR').fill('Estande — saída');
    await form.getByLabel('XP por visita').fill('25');

    await clickUntil(page, `qr-new-${sponsorId}`, async () => {
      await expect(page.getByTestId(`qr-repeat-warning-${sponsorId}`)).toBeVisible({ timeout: 10_000 });
    });

    /**
     * ── O AVISO DIZ O NÚMERO E O EFEITO (E57) ────────────────────────────────
     *  "já tem 1 QR" sozinho não diz por que isso importa; "cada QR credita de novo"
     *  sozinho não diz quanto já existe. Quem decide precisa das duas coisas.
     */
    const aviso = page.getByTestId(`qr-repeat-warning-${sponsorId}`);

    await expect(aviso).toContainText('1 QR');
    await expect(aviso).toContainText('creditar a mesma pessoa');
    await expect(page.getByTestId(`qr-repeat-count-${sponsorId}`)).toContainText('1');

    /** E NADA foi gravado: a recusa é antes do INSERT. */
    expect(await qrCount()).toBe(1);

    /** A confirmação é um ato explícito, com a consequência escrita. */
    await expect(page.getByTestId(`qr-repeat-confirm-${sponsorId}`)).toBeVisible();
  });

  test('3. com a confirmação, o segundo QR grava e a trilha registra o ato', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await openQrForm(page);

    const form = page.getByTestId(`qr-new-${sponsorId}`);

    await form.getByLabel('Nome do QR').fill('Estande — saída');
    await form.getByLabel('XP por visita').fill('25');

    /** Primeira tentativa: o aviso aparece (e nada grava). */
    await clickUntil(page, `qr-new-${sponsorId}`, async () => {
      await expect(page.getByTestId(`qr-repeat-warning-${sponsorId}`)).toBeVisible({ timeout: 10_000 });
    });

    /** Segunda tentativa, com a caixa marcada. */
    await page.getByTestId(`qr-repeat-confirm-${sponsorId}`).check();

    await clickUntil(page, `qr-new-${sponsorId}`, async () => {
      expect(await qrCount()).toBe(2);
    });

    const gravados = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.sponsorQrCode.findMany({
        where: { tenantId, sponsorId, eventId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { label: true },
      });
    });

    expect(gravados.map((qr) => qr.label)).toEqual(['Estande — entrada', 'Estande — saída']);

    /** A TRILHA guarda que houve repetição E que a instituição confirmou. */
    const trilha = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const logs = await tx.auditLog.findMany({
        where: { tenantId, entityType: 'sponsorQrCode', action: 'CREATE' },
        select: { changes: true },
      });

      return logs
        .map((row) => row.changes as Record<string, { to?: unknown }> | null)
        .filter((changes) => changes?.confirmed?.to === true);
    });

    expect(trilha.length).toBeGreaterThanOrEqual(1);
  });

  test('4. outro patrocinador no MESMO evento não dispara o aviso', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await openQrForm(page, otherSponsorId);

    const form = page.getByTestId(`qr-new-${otherSponsorId}`);

    await form.getByLabel('Nome do QR').fill('Estande da editora');

    await clickUntil(page, `qr-new-${otherSponsorId}`, async () => {
      expect(await qrCount(otherSponsorId)).toBe(1);
    });

    await expect(page.getByTestId(`qr-repeat-warning-${otherSponsorId}`)).toHaveCount(0);
  });

  test('5. SEM JavaScript, o segundo passo é uma NAVEGAÇÃO e grava', async ({ browser }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA DO "FUNCIONA SEM JAVASCRIPT" (E57)
     *  ─────────────────────────────────────────────────────────────────────────────
     *  Com o bundle desligado, a Server Action não existe: quem carrega a
     *  confirmação é a QUERY STRING (`?confirmarQr=<sponsorId>`), e o servidor
     *  redesenha o formulário com o campo de confirmação já marcado. Se o aviso
     *  dependesse de estado no cliente, este cenário não passaria — e é exatamente
     *  o caso do balcão com o notebook da secretaria.
     */
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);

      const antes = await qrCount();
      expect(antes).toBe(2);

      /** O passo 2 é uma navegação — o mesmo endereço que o link oferece. */
      await page.goto(`${sponsorsUrl()}?confirmarQr=${sponsorId}`);

      const form = page.getByTestId(`qr-new-${sponsorId}`);

      /** O formulário já vem ABERTO e com a confirmação posta. */
      await expect(form).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`qr-repeat-warning-${sponsorId}`)).toBeVisible();
      await expect(page.getByTestId(`qr-repeat-warning-${sponsorId}`)).toHaveAttribute(
        'data-confirmed',
        'true',
      );

      await form.getByLabel('Nome do QR').fill('Estande — mezanino');

      /**
       * O clique é a submissão NATIVA do formulário. A resposta do servidor é um
       * redesenho da página (o padrão do projeto para ação em linha sem JS).
       */
      await expect(async () => {
        await form.getByTestId('admin-submit').click();

        expect(await qrCount()).toBe(3);
      }).toPass({ timeout: 60_000 });

      const rotulos = await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

        return tx.sponsorQrCode.findMany({
          where: { tenantId, sponsorId, eventId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { label: true },
        });
      });

      expect(rotulos.map((qr) => qr.label)).toContain('Estande — mezanino');
    } finally {
      await context.close();
    }
  });
});
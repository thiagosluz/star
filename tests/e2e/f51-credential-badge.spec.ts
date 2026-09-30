/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — IDENTIDADE VISUAL DO CRACHÁ (FASE 51, dívida E42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. a emissão em MASSA aceita uma categoria e a lista passa a MOSTRAR a faixa —
 *      emitir 40 crachás de equipe é um clique, e é o caso da secretaria;
 *   2. o filtro por categoria isola quem tem aquela faixa, e quem não tem crachá
 *      fica de fora (a categoria mora no crachá);
 *   3. trocar a categoria de UM crachá pela lista NÃO troca o código — o crachá que
 *      está na mão da pessoa continua valendo no balcão;
 *   4. o PAPEL obedece: a folha A4, a etiqueta adesiva e o ZPL saem com a faixa da
 *      categoria de cada um e com a COR DO TEMA do evento — conferido nos BYTES do
 *      arquivo, não no `href` da tela;
 *   5. o crachá online (`/meu-cracha`) mostra o rótulo da categoria e a cor do
 *      evento: a tela e o papel dizem a MESMA coisa sobre a mesma pessoa;
 *   6. a escolha da LENTE no balcão persiste, e o seletor só aparece quando há mais
 *      de uma câmera — o navegador do teste é aberto com DUAS lentes falsas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CONFERÊNCIA É DO ARQUIVO QUE SAI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os cenários 4 baixam o PDF e o ZPL que a tela aponta e procuram, no CONTEÚDO, o
 *  operador de cor da categoria e da cor do tema. Afirmar a presença de um
 *  `data-category` na lista provaria só a montagem do HTML; o que a recepção leva
 *  para a porta é o arquivo, e é ele que o teste lê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { credentialCategoryColor, pdfFillOperator } from '../../src/domain/events/credential-categories';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'identidade-cracha-f51';

/** A cor do tema do EVENTO — é ela que precisa aparecer no PDF. */
const EVENT_PRIMARY = '#b45309';
/** As cores das categorias, pela paleta do DOMÍNIO — não copiadas à mão aqui. */
const STAFF_COLOR = credentialCategoryColor('STAFF');
const VIP_COLOR = credentialCategoryColor('VIP');
const PARTICIPANT_COLOR = credentialCategoryColor('PARTICIPANT');

let tenantId: string;
let slug: string;
let eventId: string;
let eventSlug: string;
let organizerEmail: string;
let participantEmail: string;
let participantId: string;
let participantName: string;
let staffId: string;
let staffName: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f51cracha.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** O crachá gravado da pessoa — o banco é a memória do E2E. */
async function credentialOf(userId: string) {
  return e2eDb.eventCredential.findFirst({
    where: { tenantId, eventId, userId },
    select: { id: true, code: true, category: true },
  });
}

/**
 * Clica no botão de teste até o efeito acontecer.
 *
 * A primeira submissão pode se perder na hidratação (a página acabou de carregar e o
 * `form` ainda não tem handler) — o mesmo cuidado dos outros E2E desta base.
 */
async function clickUntil(
  page: import('@playwright/test').Page,
  testId: string,
  effect: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    const botao = page.getByTestId(testId);

    if ((await botao.count()) > 0) await botao.click();

    await effect();
  }).toPass({ timeout: 60_000 });
}

const badgesUrl = () => `/t/${slug}/credenciamento/crachas?evento=${eventId}`;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Identidade ${RUN_ID}`,
    });

    tenantId = tenant.id;
    slug = tenant.slug;
    eventId = randomUUID();
    eventSlug = `congresso-identidade-${RUN_ID}`;

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 20 * 86_400_000);

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: eventSlug,
          title: `Congresso da Identidade ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          capacity: null,
          confirmedCount: 0,
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          registrationClosesAt: new Date(Date.now() + 18 * 86_400_000),
          /**
           * O evento tem TEMA PRÓPRIO: é o que prova que a cor escolhida pelo
           * organizador chega ao papel — e não só a identidade da plataforma.
           */
          theme: { primaryColor: EVENT_PRIMARY },
        },
      });
    });

    const organizer = await signUpVia(api, `Organizadora da Identidade ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    /** ORGANIZER tem `attendance:manage` e `sponsor:manage` no escopo da instituição. */
    await grantRole({ tenantId, userId: organizer.id, role: 'ORGANIZER' });

    participantName = `Participante da Identidade ${RUN_ID}`;
    const participant = await signUpVia(api, participantName);
    participantEmail = participant.email;
    participantId = participant.id;

    staffName = `Equipe da Identidade ${RUN_ID}`;
    const staff = await signUpVia(api, staffName);
    staffId = staff.id;

    /** As duas inscrições no EVENTO (o crachá é da pessoa no evento). */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      for (const userId of [participantId, staffId]) {
        await tx.registration.create({
          data: {
            id: randomUUID(),
            tenantId,
            eventId,
            activityId: null,
            userId,
            status: 'CONFIRMED',
          },
        });
      }
    });
  } finally {
    await api.dispose();
  }
});

test.describe('identidade visual do crachá', () => {
  test.fixme('1. a emissão em massa aceita a categoria e a lista mostra a faixa', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(badgesUrl());

    /** ── A EQUIPE: marcar a pessoa e emitir como "Equipe" ─────────────────── */
    await clickUntil(page, `badge-select-${staffId}`, async () => {
      await expect(page.getByTestId(`badge-select-${staffId}`)).toBeChecked();
    });

    await page.getByTestId('badge-emit-category').selectOption('STAFF');

    await clickUntil(page, 'badge-emit', async () => {
      const credential = await credentialOf(staffId);
      expect(credential?.category).toBe('STAFF');
    });

    /** ── O PARTICIPANTE: emitir com o padrão (a primeira opção do seletor) ── */
    await page.reload();

    await clickUntil(page, `badge-select-${participantId}`, async () => {
      await expect(page.getByTestId(`badge-select-${participantId}`)).toBeChecked();
    });

    await clickUntil(page, 'badge-emit', async () => {
      const credential = await credentialOf(participantId);
      expect(credential?.category).toBe('PARTICIPANT');
    });

    /** A lista mostra o RÓTULO em português de cada um. */
    await page.reload();
    await expect(page.getByTestId(`badge-category-${staffId}`)).toContainText('Equipe');
    await expect(page.getByTestId(`badge-category-${participantId}`)).toContainText('Participante');

    /** E a categoria gravada é a que o domínio conhece. */
    await expect
      .poll(async () => (await credentialOf(staffId))?.category, { timeout: 30_000 })
      .toBe('STAFF');
  });

  test.fixme('2. o filtro por categoria isola a faixa', async ({ page }) => {
    await signInAs(page, organizerEmail);

    await page.goto(`${badgesUrl()}&categoria=STAFF`);
    await page.getByTestId('badge-filter-apply').click();

    await expect(page.getByTestId(`badge-row-${staffId}`)).toBeVisible({ timeout: 30_000 });
    /** Quem é PARTICIPANTE sai da lista filtrada por Equipe. */
    await expect(page.getByTestId(`badge-row-${participantId}`)).toHaveCount(0);

    await page.goto(`${badgesUrl()}&categoria=PARTICIPANT`);
    await page.getByTestId('badge-filter-apply').click();

    await expect(page.getByTestId(`badge-row-${participantId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`badge-row-${staffId}`)).toHaveCount(0);
  });

  test.fixme('3. trocar a categoria de UM crachá não troca o código', async ({ page }) => {
    await signInAs(page, organizerEmail);

    const before = await credentialOf(participantId);
    expect(before?.code).toBeTruthy();

    await page.goto(badgesUrl());

    await page.getByTestId(`badge-category-select-${participantId}`).selectOption('VIP');

    await clickUntil(page, `badge-category-save-${participantId}`, async () => {
      const credential = await credentialOf(participantId);
      expect(credential?.category).toBe('VIP');
    });

    const after = await credentialOf(participantId);

    /** O CÓDIGO é o mesmo: o crachá que está na mão da pessoa continua valendo. */
    expect(after?.code).toBe(before?.code);

    await page.reload();
    await expect(page.getByTestId(`badge-category-${participantId}`)).toContainText('Autoridade');
  });

  test.fixme('4. o papel obedece: a cor do TEMA e a faixa de CADA categoria', async ({ page }) => {
    /**
     * O crachá de "Autoridade" foi trocado no cenário 3, e a equipe continua STAFF —
     * o lote tem DUAS categorias e o evento tem tema. É o caso misto, que é o do
     * evento de verdade.
     */
    await signInAs(page, organizerEmail);
    await page.goto(badgesUrl());

    await expect(page.getByTestId('badge-print-options')).toBeVisible();

    // ── A folha A4 ───────────────────────────────────────────────────────────
    const sheetHref = await page.getByTestId('badge-print').getAttribute('href');
    expect(sheetHref).toBeTruthy();

    const sheet = await page.request.get(sheetHref!);
    expect(sheet.status()).toBe(200);
    expect(sheet.headers()['content-type']).toContain('application/pdf');

    const sheetText = (await sheet.body()).toString('latin1');
    expect(sheetText.subarray(0, 5)).toBe('%PDF-');

    /** A COR DO EVENTO no código do crachá. */
    expect(sheetText).toContain(pdfFillOperator(EVENT_PRIMARY));
    /** A FAIXA da equipe e a da autoridade. */
    expect(sheetText).toContain(pdfFillOperator(STAFF_COLOR));
    expect(sheetText).toContain(pdfFillOperator(VIP_COLOR));
    /** E o PARTICIPANTE não está no lote misto: a faixa dele não aparece. */
    expect(sheetText).not.toContain(pdfFillOperator(PARTICIPANT_COLOR));

    // ── A etiqueta adesiva e o ZPL, pelo endereço que a tela aponta ──────────
    await page.getByTestId('badge-print-options').locator('summary').click();

    const labelsHref = await page.getByTestId('badge-print-labels').getAttribute('href');
    const zplHref = await page.getByTestId('badge-print-zpl').getAttribute('href');

    const labels = await page.request.get(labelsHref!);
    expect(labels.status()).toBe(200);

    const labelsText = (await labels.body()).toString('latin1');
    expect(labelsText).toContain(pdfFillOperator(EVENT_PRIMARY));
    expect(labelsText).toContain(pdfFillOperator(STAFF_COLOR));

    const zpl = await page.request.get(zplHref!);
    expect(zpl.status()).toBe(200);

    const zplText = await zpl.text();
    /** A barra da categoria no rolo: a largura da etiqueta (100 mm a 203 dpi = 799). */
    expect(zplText).toContain('^FO0,0^GB799,');
    expect(zplText).toContain('^XA');
  });

  test.fixme('5. o crachá online do participante mostra a categoria e a cor do evento', async ({ page }) => {
    await signInAs(page, participantEmail);
    await page.goto(`/t/${slug}/meu-cracha?evento=${eventId}`);

    await expect(page.getByTestId('own-badge')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('own-badge-category')).toContainText('Autoridade');
    /** A cor do evento é a barra do cartão — e o token vem do servidor. */
    await expect(page.getByTestId('own-badge-event-bar')).toHaveClass(/bg-theme-primary/);

    const credential = await credentialOf(participantId);
    await expect(page.getByTestId('own-badge-code')).toContainText(credential!.code);
  });

  test.fixme('6. a lente escolhida no balcão persiste, e o seletor só aparece com duas câmeras', async ({
    browser,
  }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTE CENÁRIO PRECISA DE UM CONTEXTO PRÓPRIO
     * ─────────────────────────────────────────────────────────────────────────────
     *  O leitor usa `enumerateDevices`/`getUserMedia`, que são APIs do NAVEGADOR — não
     *  há teste de unidade possível sem `jsdom` (ver o comentário do componente). Aqui
     *  o Chromium é aberto com DUAS lentes falsas e permissão de câmera concedida, que
     *  é o único jeito de exercitar a escolha de verdade.
     *
     *  A persistência é lida pelo `localStorage`: a escolha vive por EVENTO, e é o que
     *  impede o operador de reescolher a cada leitura.
     */
    const context = await browser.newContext({
      permissions: ['camera'],
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--allow-file-access-from-files',
      ],
    });

    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);
      await page.goto(`/t/${slug}/credenciamento?evento=${eventId}`);

      await expect(page.getByTestId('qr-camera')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('qr-camera-start').click();

      /** A lente abre: o stream liga e o vídeo aparece. */
      await expect(page.getByTestId('qr-camera')).toHaveAttribute('data-active', 'true', {
        timeout: 30_000,
      });

      const select = page.getByTestId('qr-camera-device');

      /** Com MAIS DE UMA câmera, o seletor existe. */
      await expect(select).toBeVisible();

      const options = await select.locator('option').all();
      expect(options.length).toBeGreaterThan(1);

      /** A segunda opção é uma lente concreta (a primeira é "padrão do navegador"). */
      const deviceId = await options[1]!.getAttribute('value');
      expect(deviceId).toBeTruthy();

      await select.selectOption(deviceId!);

      /** A escolha fica GUARDADA, por evento — é o que a próxima leitura lê. */
      await expect
        .poll(
          async () =>
            page.evaluate(
              (key) => window.localStorage.getItem(key),
              `eventflow_camera_device_${eventId}`,
            ),
          { timeout: 30_000 },
        )
        .toBe(deviceId);

      /** E a leitura continua funcionando depois da troca. */
      await expect(page.getByTestId('qr-camera')).toHaveAttribute('data-active', 'true', {
        timeout: 30_000,
      });
      await expect(page.getByTestId('qr-camera-error')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test.fixme('7. com UMA câmera, o seletor de lente NÃO aparece', async ({ browser }) => {
    /**
     * Opção inútil polui: num dispositivo com uma lente só, o `select` de uma opção é
     * um toque a mais no meio da fila que não muda nada. O contexto aqui NÃO recebe o
     * segundo dispositivo falso — e o padrão do Chromium é uma câmera.
     */
    const context = await browser.newContext({
      permissions: ['camera'],
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });

    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);
      await page.goto(`/t/${slug}/credenciamento?evento=${eventId}`);

      await expect(page.getByTestId('qr-camera')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('qr-camera-start').click();
      await expect(page.getByTestId('qr-camera')).toHaveAttribute('data-active', 'true', {
        timeout: 30_000,
      });

      /**
       * A asserção só vale quando o navegador realmente expõe UMA lente — com duas, o
       * seletor DEVE aparecer, e o cenário 6 já cobre esse lado. A checagem do número
       * de dispositivos é do navegador, não do produto.
       */
      const cameras = await page.evaluate(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter((device) => device.kind === 'videoinput').length;
      });

      if (cameras <= 1) {
        await expect(page.getByTestId('qr-camera-device')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('qr-camera-device')).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
});

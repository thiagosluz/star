/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Editor visual do certificado (FASE 40)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. o organizador parte de um MODELO PRONTO pela tela e salva o modelo da
 *      instituição — sem digitar coordenada nenhuma;
 *   2. com JavaScript, ele ARRASTA a caixa no palco e o arrastar escreve nos campos
 *      numéricos (a posição é do formulário, não de um estado paralelo) — e o que foi
 *      arrastado é o que fica gravado;
 *   3. SEM JavaScript, ele consegue o mesmo resultado digitando as medidas: as linhas
 *      até o teto estão no formulário e nenhum controle morto aparece;
 *   4. a PRÉVIA mostra o documento com dados de exemplo, saindo do MESMO renderizador
 *      que gera o PDF emitido (não de um desenho paralelo no navegador);
 *   5. a ARTE de fundo é aceita pela tela e o que não é JPEG utilizável é recusado com
 *      o motivo — em vez de virar um documento com as cores da instituição erradas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ARTE DO TESTE É UM JPEG DE VERDADE, MONTADO AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O upload é validado pelos BYTES (assinatura + medidas + resolução), então um
 *  arquivo de mentira com extensão `.jpg` seria recusado — que é justamente o
 *  comportamento sob teste. A fixture monta um SOF0 mínimo, na resolução mínima de A4.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'modelo-certificado-f40';
const EVENT_SLUG = `evento-f40-${RUN_ID}`;

let tenantId: string;
let eventId: string;
let organizerEmail: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;
const templatesUrl = () => `/t/${slug}/administracao/certificados/modelos`;

/** Um JPEG baseline de 3508 × 2480 (A4 paisagem a 300 dpi), montado byte a byte. */
function buildJpeg(input: { width: number; height: number; components?: number }): Buffer {
  const components = input.components ?? 3;
  const bytes: number[] = [0xff, 0xd8];

  bytes.push(0xff, 0xe0, 0x00, 0x10);
  bytes.push(0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);

  const sofLength = 8 + components * 3;
  bytes.push(0xff, 0xc0, (sofLength >> 8) & 0xff, sofLength & 0xff, 0x08);
  bytes.push((input.height >> 8) & 0xff, input.height & 0xff, (input.width >> 8) & 0xff, input.width & 0xff, components);

  for (let index = 0; index < components; index += 1) bytes.push(index + 1, 0x11, 0x00);

  bytes.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9);

  return Buffer.from(bytes);
}

const ART = buildJpeg({ width: 3508, height: 2480 });

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f40.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** O modelo gravado, pelo nome — lido direto do banco (a tela pode estar revalidando). */
async function storedTemplate(name: string) {
  return e2eDb.certificateTemplate.findFirst({
    where: { tenantId, name },
    select: {
      id: true,
      name: true,
      eventId: true,
      kind: true,
      layout: true,
      backgroundBytes: true,
    },
  });
}

function layoutOf(template: { layout: unknown } | null) {
  return template?.layout as {
    page: string;
    background: { checksum: string; sizeBytes: number; widthPx: number } | null;
    elements: { id: string; kind: string; variable: string | null; xMm: number; yMm: number }[];
  };
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
      name: `Instituição do Modelo Visual ${RUN_ID}`,
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
          title: `Congresso do Modelo Visual ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
          timezone: 'America/Bahia',
        },
      });
    });

    const organizer = await signUpVia(api, `Organizador do Modelo ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('editor visual do certificado', () => {
  test('1. o organizador CHEGA pela tela, parte de um modelo pronto e salva', async ({ page }) => {
    await signInAs(page, organizerEmail);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  CHEGAR PELA TELA, E NÃO POR ENDEREÇO DIGITADO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A primeira versão da fase entregou o editor sem NENHUM link para ele: a tela
     *  de certificados não apontava para os modelos e a lista de áreas de gestão
     *  também não. Funcionalidade que só existe na barra de endereços não existe para
     *  quem opera — e o cenário agora começa no painel e CLICA até o editor.
     */
    await page.goto(`/t/${slug}/administracao`);
    await page.getByTestId('admin-areas').getByText('Modelos de certificado').click();
    await expect(page).toHaveURL(new RegExp(`${templatesUrl().replace(/\//g, '\\/')}$`));

    await expect(page.getByTestId('preset-list')).toBeVisible();
    await expect(page.getByTestId('templates-empty')).toBeVisible();

    await page.getByTestId('preset-use-classico-institucional').click();

    const editor = page.getByTestId('template-editor');
    await expect(editor).toBeVisible();

    // O modelo pronto chega preenchido: cada linha do formulário é um elemento dele.
    await page.getByTestId('template-name').fill(`Modelo Clássico ${RUN_ID}`);
    await page.getByTestId('template-event').selectOption(eventId);

    await page.getByTestId('template-submit').click();

    await expect(page.getByTestId('template-saved')).toBeVisible({ timeout: 30_000 });

    const stored = await storedTemplate(`Modelo Clássico ${RUN_ID}`);
    expect(stored).not.toBeNull();
    expect(stored?.eventId).toBe(eventId);

    /**
     * ─── O MODELO NOVO CAI NO PRÓPRIO ENDEREÇO ────────────────────────────────────
     *
     *  Salvar um modelo NOVO deixava a página em `?novo=<modelo pronto>` — e é a URL
     *  que monta o editor. O modelo passava a existir no banco enquanto a tela seguia
     *  desenhando "modelo novo": a caixa de arte dizia "salve o modelo primeiro" DEPOIS
     *  de salvar e não havia `templateId` para o upload. A navegação para `?modelo=<id>`
     *  é o que reabre a tela completa, e é isso que este cenário prende — junto com o
     *  aviso de sucesso, que agora viaja na URL.
     */
    await expect(page).toHaveURL(new RegExp(`modelo=${stored!.id}`));
    await expect(page.getByTestId('template-saved')).toBeVisible();
    await expect(page.getByTestId('background-file')).toBeVisible();
    await expect(page.getByTestId('background-needs-save')).toHaveCount(0);

    const layout = layoutOf(stored);
    expect(layout.page).toBe('A4_LANDSCAPE');
    expect(layout.elements.length).toBeGreaterThan(5);
    // O bloco probatório está lá desde o primeiro minuto.
    expect(layout.elements.some((element) => element.kind === 'QR')).toBe(true);
    expect(layout.elements.map((element) => element.variable)).toContain('codigo_validacao');
    expect(layout.elements.map((element) => element.variable)).toContain('url_validacao');
  });

  test('2. a prévia mostra o DOCUMENTO, com os dados de exemplo', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(templatesUrl());

    const stored = await storedTemplate(`Modelo Clássico ${RUN_ID}`);
    if (!stored) throw new Error('O modelo do cenário 1 deveria existir.');

    await page.goto(`${templatesUrl()}?modelo=${stored.id}`);
    await page.getByTestId('template-preview-submit').click();

    const preview = page.getByTestId('template-preview');
    await expect(preview).toBeVisible({ timeout: 30_000 });

    // O SVG é o do renderizador do documento, em milímetros, com o exemplo do catálogo.
    await expect(preview.locator('svg')).toHaveCount(1);
    await expect(preview).toContainText('Ana Souza');
    await expect(preview.locator('svg')).toHaveAttribute('viewBox', '0 0 297 210');
  });

  test('3. ARRASTAR no palco escreve nos campos e a posição fica gravada', async ({ page }) => {
    const stored = await storedTemplate(`Modelo Clássico ${RUN_ID}`);
    if (!stored) throw new Error('O modelo do cenário 1 deveria existir.');

    await signInAs(page, organizerEmail);
    await page.goto(`${templatesUrl()}?modelo=${stored.id}`);

    const box = page.getByTestId('stage-element-1');
    await expect(box).toBeVisible();

    const xField = page.getByLabel('X do elemento 2');
    const before = Number(await xField.inputValue());

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  ROLAR ANTES DE ARRASTAR (o `page.mouse` NÃO rola sozinho)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O palco fica na bancada, no alto da página, mas em janela de 720 px de altura
     *  ele ainda começa ABAIXO da dobra (a página tem cabeçalho, avisos e a galeria
     *  antes do editor). `locator.hover()` traz o elemento
     *  para a área visível sozinho; `page.mouse.move` não — e o gesto caía fora da
     *  página (o alvo do `pointerdown` era o `html`, e por isso nada acontecia).
     *  Medir o alvo foi o que mostrou isso, em vez de "o arrastar não funciona".
     */
    await box.scrollIntoViewIfNeeded();

    const boxBounds = await box.boundingBox();
    if (!boxBounds) throw new Error('A caixa do elemento não tem medidas na tela.');

    await page.mouse.move(boxBounds.x + boxBounds.width / 2, boxBounds.y + boxBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxBounds.x + boxBounds.width / 2 + 64, boxBounds.y + boxBounds.height / 2 + 32, { steps: 8 });
    await page.mouse.up();

    // O arrastar ESCREVE no formulário: o campo numérico mudou junto.
    await expect(async () => {
      expect(Number(await xField.inputValue())).toBeGreaterThan(before);
    }).toPass({ timeout: 10_000 });

    const movedX = Number(await xField.inputValue());
    const movedY = Number(await page.getByLabel('Y do elemento 2').inputValue());

    await page.getByTestId('template-submit').click();
    await expect(page.getByTestId('template-saved')).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(async () => layoutOf(await storedTemplate(`Modelo Clássico ${RUN_ID}`)).elements[1]?.xMm, {
        timeout: 30_000,
      })
      .toBe(movedX);

    const saved = layoutOf(await storedTemplate(`Modelo Clássico ${RUN_ID}`));
    expect(saved.elements[1]?.yMm).toBe(movedY);
  });

  test('4. SEM JavaScript o organizador ajusta as variáveis pelos campos numéricos', async ({ browser }) => {
    /**
     * O caminho sem JavaScript, inteiro: o palco não aparece (arrastar precisa de
     * script), os botões de acrescentar/remover não existem, e o formulário oferece as
     * linhas até o TETO — preencher as medidas e enviar é o caminho nativo.
     */
    const stored = await storedTemplate(`Modelo Clássico ${RUN_ID}`);
    if (!stored) throw new Error('O modelo do cenário 1 deveria existir.');

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);
      await page.goto(`${templatesUrl()}?modelo=${stored.id}`);

      await expect(page.getByTestId('template-stage')).toHaveCount(0);
      await expect(page.getByTestId('element-add')).toHaveCount(0);
      await expect(page.getByTestId('element-remove')).toHaveCount(0);
      await expect(page.getByTestId('no-js-hint')).toBeVisible();

      const form = page.getByTestId('template-form');
      const xFields = form.locator('input[name="elementX"]');

      // As 24 linhas do teto estão no formulário.
      await expect(xFields).toHaveCount(24);

      // A primeira variável do modelo pronto é o título: troca por CARGA HORÁRIA.
      const variables = form.locator('select[name="elementVariable"]');
      await expect(variables.first()).toBeVisible();
      await variables.first().selectOption('carga_horaria');

      await xFields.first().fill('42.5');

      await form.getByTestId('template-submit').click();

      await expect
        .poll(async () => layoutOf(await storedTemplate(`Modelo Clássico ${RUN_ID}`)).elements[0]?.xMm, {
          timeout: 30_000,
        })
        .toBe(42.5);

      const saved = layoutOf(await storedTemplate(`Modelo Clássico ${RUN_ID}`));
      expect(saved.elements[0]?.variable).toBe('carga_horaria');
    } finally {
      await context.close();
    }
  });

  test('5. a ARTE de fundo entra pela tela e o que não serve é recusado com o motivo', async ({ page }) => {
    const stored = await storedTemplate(`Modelo Clássico ${RUN_ID}`);
    if (!stored) throw new Error('O modelo do cenário 1 deveria existir.');

    await signInAs(page, organizerEmail);
    await page.goto(`${templatesUrl()}?modelo=${stored.id}`);

    // CMYK é recusado ANTES de subir: o PDF embute o arquivo como está.
    await page.getByTestId('background-file').setInputFiles({
      name: 'arte-cmyk.jpg',
      mimeType: 'image/jpeg',
      buffer: buildJpeg({ width: 3508, height: 2480, components: 4 }),
    });
    await page.getByTestId('background-submit').click();
    await expect(page.getByTestId('background-error')).toContainText('RGB', { timeout: 30_000 });

    // E o JPEG em RGB, na resolução da página, entra.
    await page.getByTestId('background-file').setInputFiles({
      name: 'arte-rgb.jpg',
      mimeType: 'image/jpeg',
      buffer: ART,
    });
    await page.getByTestId('background-submit').click();
    await expect(page.getByTestId('background-ok')).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(async () => layoutOf(await storedTemplate(`Modelo Clássico ${RUN_ID}`)).background?.sizeBytes, {
        timeout: 30_000,
      })
      .toBe(ART.length);

    const saved = layoutOf(await storedTemplate(`Modelo Clássico ${RUN_ID}`));
    expect(saved.background?.widthPx).toBe(3508);
    expect(saved.background?.checksum).toMatch(/^[0-9a-f]{64}$/);

    // A galeria passa a mostrar o tamanho da arte do modelo.
    await page.goto(templatesUrl());
    await expect(page.getByTestId(`template-art-${stored.id}`)).toContainText('KB');
  });
});

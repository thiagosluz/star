/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O CORPO DO CERTIFICADO NO EDITOR (FASE 86 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. o organizador troca a variável `corpo` de um modelo pronto pelo elemento
 *      `BODY`, escreve um gabarito com DUAS variáveis e quebras de linha, salva e
 *      reabre o modelo com o texto intacto;
 *   2. a legenda das 12 variáveis INSERE o token na posição do cursor — e o que foi
 *      inserido é o que o servidor grava;
 *   3. token desconhecido aparece no campo E o servidor recusa o salvamento (o
 *      cliente não é a guarda);
 *   4. o contador mostra "1.240 de 2.000" e acusa o excesso;
 *   5. as DUAS prévias aparecem lado a lado, e o pior caso esvazia os opcionais;
 *   6. o aviso de "não cabe" aparece com os números e o botão AUMENTAR A CAIXA
 *      resolve o encaixe dentro da página;
 *   7. o conflito `BODY` + `{{corpo}}` é recusado no salvamento, com a mensagem que
 *      diz o que remover;
 *   8. um gabarito só com variável opcional avisa que pode sair vazio — e NÃO é
 *      bloqueado;
 *   9. sem JavaScript o mesmo `textarea` e a mesma legenda estão na página: o token
 *      é digitado à mão e o formulário salva pelo caminho nativo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CADA CASO CRIA O PRÓPRIO MODELO (a regra 1 do `helpers.ts`)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os casos 2 a 9 criam um modelo pelo SERVIÇO real (`saveCertificateTemplate`), e
 *  o caso 1 é o único que passa pela TELA inteira (modelo pronto → BODY → salvar).
 *  Assim um vermelho no caso 1 não derruba os outros: eles não leem "o modelo do caso
 *  anterior" — a suíte já pagou essa conta no E71/I3.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { saveCertificateTemplate } from '../../src/lib/certificates/certificate-template-service';
import {
  findPreset,
  type CertificateLayoutElement,
} from '../../src/domain/certificates/certificate-layout-rules';
import type { CertificateKind } from '../../src/domain/certificates/certificate-rules';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'corpo-certificado-f86';
const EVENT_SLUG = `evento-f86-${RUN_ID}`;
const TEMPLATE_NAME = `Corpo do certificado ${RUN_ID}`;

const GABARITO =
  'Certificamos que {{nome}} participou de {{evento}}.\nCarga horária: {{carga_horaria}}.';

let tenantId: string;
let eventId: string;
let organizerId: string;
let organizerEmail: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;
const templatesUrl = () => `/t/${slug}/administracao/certificados/modelos`;

interface StoredLayout {
  page: string;
  elements: {
    id: string;
    kind: string;
    text: string | null;
    variable: string | null;
    xMm: number;
    yMm: number;
    widthMm: number;
    heightMm: number;
  }[];
}

async function storedTemplate(name: string) {
  return e2eDb.certificateTemplate.findFirst({
    where: { tenantId, name },
    select: { id: true, name: true, layout: true },
  });
}

function layoutOf(template: { layout: unknown } | null): StoredLayout {
  return (template?.layout ?? { page: 'A4_LANDSCAPE', elements: [] }) as StoredLayout;
}

/**
 * Cria um modelo com o TERCEIRO elemento como `BODY` — a posição do `corpo` no
 * modelo pronto "Clássico institucional". O caminho é o SERVIÇO real, então o layout
 * nasce validado exatamente como o formulário o deixaria.
 *
 * O `kind` é o alvo do modelo e existe aqui por uma razão prática: o índice único
 * parcial garante UM modelo por combinação (evento × tipo), e a fixture usa oito
 * tipos diferentes para os oito cenários. Sem isso, o segundo modelo da mesma
 * instituição colidiria com o primeiro — o que é o COMPORTAMENTO CERTO do produto,
 * não um defeito do teste.
 */
async function createTemplateWithBody(
  name: string,
  bodyText: string,
  kind: CertificateKind,
): Promise<string> {
  const preset = findPreset('classico-institucional');
  if (!preset) throw new Error('O modelo pronto clássico sumiu do catálogo.');

  const elements: CertificateLayoutElement[] = preset.layout.elements.map((element, index) =>
    index === 2
      ? { ...element, kind: 'BODY', variable: null, text: bodyText }
      : { ...element },
  );

  const result = await saveCertificateTemplate({
    tenantId,
    actorId: organizerId,
    name,
    eventId: null,
    kind,
    rows: {
      page: preset.layout.page,
      ids: elements.map((element) => element.id),
      kinds: elements.map((element) => element.kind),
      texts: elements.map((element) => element.text ?? ''),
      variables: elements.map((element) => element.variable ?? ''),
      xMm: elements.map((element) => String(element.xMm)),
      yMm: elements.map((element) => String(element.yMm)),
      widthMm: elements.map((element) => String(element.widthMm)),
      heightMm: elements.map((element) => String(element.heightMm)),
      aligns: elements.map((element) => element.align),
      fonts: elements.map((element) => element.font),
      sizePt: elements.map((element) => String(element.sizePt)),
      colors: elements.map((element) => element.color),
      lineHeights: elements.map((element) => String(element.lineHeight)),
    },
  });

  if (!result.ok) throw new Error(`Falha ao criar o modelo da fixture: ${result.message}`);

  return result.templateId;
}

async function openTemplate(page: import('@playwright/test').Page, templateId: string): Promise<void> {
  await page.goto(`${templatesUrl()}?modelo=${templateId}`);
  await expect(page.getByTestId('template-editor')).toBeVisible();
}

/**
 * O modelo pronto SEM corpo próprio: ele ainda imprime o texto formal pela variável
 * `corpo`, que é justamente o que o cenário do conflito precisa manter viva.
 */
async function createPresetTemplate(name: string, kind: CertificateKind): Promise<string> {
  const result = await saveCertificateTemplate({
    tenantId,
    actorId: organizerId,
    name,
    eventId: null,
    kind,
    presetId: 'classico-institucional',
  });

  if (!result.ok) throw new Error(`Falha ao criar o modelo pronto da fixture: ${result.message}`);

  return result.templateId;
}

async function signInAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f86.corpo.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** O campo do gabarito do modelo pronto: o `corpo` é o TERCEIRO elemento. */
function bodyField(page: import('@playwright/test').Page) {
  return page.getByLabel('Gabarito do corpo do elemento 3');
}

async function save(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('template-submit').click();
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
      name: `Instituição do Corpo ${RUN_ID}`,
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
          title: `Congresso do Corpo ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
          timezone: 'America/Bahia',
        },
      });
    });

    const organizer = await signUpVia(api, `Organizador do Corpo ${RUN_ID}`);
    organizerId = organizer.id;
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

test.describe('o corpo do certificado no editor', () => {
  test('1. escolhe BODY, escreve o gabarito com duas variáveis e reabre com o texto', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(templatesUrl());

    await page.getByTestId('preset-use-classico-institucional').click();
    await expect(page.getByTestId('template-editor')).toBeVisible();

    await page.getByTestId('template-name').fill(TEMPLATE_NAME);

    /**
     * Esta tela é a dos MODELOS PADRÃO da instituição (FASE 86 · fatia 4): não há
     * mais "Vale para o evento" aqui. O cenário é de instituição mesmo — o que ele
     * prova é o campo do corpo, não o alvo.
     */
    await expect(page.getByTestId('template-event-fixed')).toContainText(
      'Todos os eventos da instituição',
    );

    /**
     * O modelo pronto imprime o texto formal pela VARIÁVEL `corpo` (terceiro
     * elemento). Trocá-la para `BODY` é o gesto que a fatia 3 entrega — e é também o
     * que evita o conflito `BODY` + `{{corpo}}`.
     */
    await page.getByLabel('Tipo do elemento 3').selectOption('BODY');

    const body = bodyField(page);
    await expect(body).toBeVisible();
    await body.fill(GABARITO);

    await expect(page.getByTestId('body-counter-2')).toContainText('de 2.000 caracteres');

    await save(page);
    await expect(page.getByTestId('template-saved')).toBeVisible({ timeout: 30_000 });

    const stored = await storedTemplate(TEMPLATE_NAME);
    expect(stored).not.toBeNull();

    const layout = layoutOf(stored);
    const bodyElements = layout.elements.filter((element) => element.kind === 'BODY');

    expect(bodyElements).toHaveLength(1);
    /**
     * A quebra de linha chega do formulário como CRLF (especificação do HTML) e a
     * porta do domínio a normaliza para `\n`; o texto é comparado já canônico.
     */
    expect(bodyElements[0]?.text).toBe(GABARITO);
    expect(layout.elements.some((element) => element.variable === 'corpo')).toBe(false);

    /** Reabrir prova que o servidor devolve o gabarito, com as quebras de linha. */
    await page.goto(`${templatesUrl()}?modelo=${stored!.id}`);
    await expect(bodyField(page)).toHaveValue(GABARITO);
  });

  test('2. a legenda insere o token no cursor e o texto inserido é o que fica gravado', async ({ page }) => {
    const templateId = await createTemplateWithBody(`${TEMPLATE_NAME} legenda`, GABARITO, 'ATTENDANCE');

    await signInAs(page, organizerEmail);
    await openTemplate(page, templateId);

    const body = bodyField(page);
    await body.fill('Certificamos que ');

    await page.getByTestId('body-insert-nome').click();
    await expect(body).toHaveValue('Certificamos que {{nome}}');

    /** O cursor volta para depois do token inserido, e o próximo entra ali. */
    await expect(body).toBeFocused();
    await body.press('End');
    await body.pressSequentially(' participou de ');
    await page.getByTestId('body-insert-evento').click();

    const expected = 'Certificamos que {{nome}} participou de {{evento}}';
    await expect(body).toHaveValue(expected);

    /** A legenda é a lista canônica: as 12 chaves, com o rótulo humano. */
    await expect(page.getByTestId('body-variable-legend-2').locator('button')).toHaveCount(12);
    await expect(page.getByTestId('body-variable-legend-2')).toContainText('Nome do participante');
    await expect(page.getByTestId('body-variable-legend-2')).toContainText('Nome do evento');

    await save(page);
    await expect(page.getByTestId('template-saved')).toBeVisible({ timeout: 30_000 });

    expect(layoutOf(await storedTemplate(`${TEMPLATE_NAME} legenda`)).elements[2]?.text).toBe(expected);
  });

  test('3. token desconhecido aparece no campo E o servidor recusa salvar', async ({ page }) => {
    const templateId = await createTemplateWithBody(`${TEMPLATE_NAME} inválido`, GABARITO, 'SPEAKER');

    await signInAs(page, organizerEmail);
    await openTemplate(page, templateId);

    const body = bodyField(page);
    await body.fill('Certificamos que {{apelido}} participou.');

    const errors = page.getByTestId('body-errors-2');
    await expect(errors).toBeVisible();
    await expect(errors).toContainText('{{apelido}}');
    /** A mensagem lista as válidas — não apaga o token em silêncio. */
    await expect(errors).toContainText('{{nome}}');
    await expect(errors).toContainText('{{evento}}');

    await save(page);
    await expect(page.getByTestId('template-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('template-error')).toContainText('{{apelido}}');

    /** O modelo gravado não mudou: a guarda é o servidor. */
    expect(layoutOf(await storedTemplate(`${TEMPLATE_NAME} inválido`)).elements[2]?.text).toBe(GABARITO);
  });

  test('4. o contador mostra "1.240 de 2.000" e acusa o excesso', async ({ page }) => {
    const templateId = await createTemplateWithBody(`${TEMPLATE_NAME} contador`, GABARITO, 'ORGANIZER');

    await signInAs(page, organizerEmail);
    await openTemplate(page, templateId);

    const body = bodyField(page);
    await body.fill('a'.repeat(1_240));

    const counter = page.getByTestId('body-counter-2');
    await expect(counter).toContainText('1.240 de 2.000');

    await body.fill('a'.repeat(2_001));
    await expect(counter).toContainText('2.001 de 2.000');
    await expect(counter).toContainText('passa do limite');
    await expect(page.getByTestId('body-errors-2')).toContainText('limite');
  });

  test('5. a segunda prévia mostra o pior caso ao lado da completa', async ({ page }) => {
    const templateId = await createTemplateWithBody(
      `${TEMPLATE_NAME} prévia`,
      '{{nome}} — {{atividade}} — {{periodo}}',
      'REVIEWER',
    );

    await signInAs(page, organizerEmail);
    await openTemplate(page, templateId);

    const full = page.getByTestId('template-preview');
    const worst = page.getByTestId('template-preview-worst-svg');

    await expect(page.getByText('Com todos os dados')).toBeVisible();
    await expect(page.getByText('Com dados opcionais vazios')).toBeVisible();

    await expect(full).toContainText('Rust para iniciantes');
    await expect(worst).not.toContainText('Rust para iniciantes');
    await expect(worst).toContainText('Ana Souza');
  });

  test('6. o aviso de "não cabe" mostra os números e o botão aumenta a caixa', async ({ page }) => {
    const templateId = await createTemplateWithBody(`${TEMPLATE_NAME} encaixe`, GABARITO, 'AUTHOR');

    await signInAs(page, organizerEmail);
    await openTemplate(page, templateId);

    const longText = Array.from({ length: 140 }, () => 'palavra').join(' ');
    await bodyField(page).fill(longText);

    const warning = page.getByTestId('body-fit-2');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('linha(s)');
    await expect(warning).toContainText('sobram');

    /** A marca aparece no LOCAL do corpo nas duas prévias. */
    await expect(page.getByTestId('template-preview-body-warning-full')).toBeVisible();

    const height = page.getByLabel('Altura do elemento 3');
    const before = Number(await height.inputValue());

    await page.getByTestId('body-fit-grow-2').click();

    await expect.poll(async () => Number(await height.inputValue()), { timeout: 5_000 }).toBeGreaterThan(before);
    await expect(page.getByTestId('body-fit-2')).toHaveCount(0);

    await save(page);
    await expect(page.getByTestId('template-saved')).toBeVisible({ timeout: 30_000 });

    const stored = layoutOf(await storedTemplate(`${TEMPLATE_NAME} encaixe`));
    expect(stored.elements[2]?.heightMm).toBeGreaterThan(before);

    await page.reload();
    await expect(page.getByTestId('body-fit-2')).toHaveCount(0);
  });

  test('7. BODY + a variável `corpo` é RECUSADO, com a mensagem do conflito', async ({ page }) => {
    const templateId = await createPresetTemplate(`${TEMPLATE_NAME} conflito`, 'MINI_COURSE');

    await signInAs(page, organizerEmail);
    await openTemplate(page, templateId);

    /** Transforma o TÍTULO em um segundo corpo, deixando a variável `corpo` viva. */
    await page.getByLabel('Tipo do elemento 1', { exact: true }).selectOption('BODY');

    await expect(page.getByTestId('body-corpo-conflict-0')).toBeVisible();
    await expect(page.getByTestId('body-corpo-conflict-0')).toContainText('duas vezes');

    await page.getByLabel('Gabarito do corpo do elemento 1', { exact: true }).fill('Certificamos que {{nome}} participou.');
    await save(page);

    await expect(page.getByTestId('template-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('template-error')).toContainText('duas vezes');
    await expect(page.getByTestId('template-error')).toContainText('{{corpo}}');

    /** O que está gravado continua sendo o modelo SEM corpo próprio. */
    const stored = layoutOf(await storedTemplate(`${TEMPLATE_NAME} conflito`));
    expect(stored.elements.filter((element) => element.kind === 'BODY')).toHaveLength(0);
    expect(stored.elements.some((element) => element.variable === 'corpo')).toBe(true);
  });

  test('8. gabarito só com opcional avisa que pode sair vazio, e NÃO bloqueia', async ({ page }) => {
    const templateId = await createTemplateWithBody(`${TEMPLATE_NAME} vazio`, '{{atividade}}', 'PARTICIPATION');

    await signInAs(page, organizerEmail);
    await openTemplate(page, templateId);

    const emptyWarning = page.getByTestId('body-empty-worst-2');
    await expect(emptyWarning).toBeVisible();
    await expect(emptyWarning).toContainText('o corpo fica vazio');
    await expect(emptyWarning).toContainText('continua salvável');

    await save(page);
    await expect(page.getByTestId('template-saved')).toBeVisible({ timeout: 30_000 });

    expect(layoutOf(await storedTemplate(`${TEMPLATE_NAME} vazio`)).elements[2]?.text).toBe('{{atividade}}');

    await page.reload();
    await expect(page.getByTestId('body-empty-worst-2')).toBeVisible();
  });

  test('9. SEM JavaScript o textarea e a legenda continuam na página, e o token é digitado', async ({
    browser,
  }) => {
    const templateId = await createTemplateWithBody(`${TEMPLATE_NAME} sem js`, GABARITO, 'MERIT');

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);
      await openTemplate(page, templateId);

      const body = bodyField(page);
      await expect(body).toBeVisible();

      /** Sem script não há botão de inserir: a legenda vira a lista de tokens. */
      await expect(page.getByTestId('body-insert-nome')).toHaveCount(0);
      await expect(page.getByTestId('body-variable-legend-2')).toContainText('{{nome}}');
      await expect(page.getByTestId('body-variable-legend-2')).toContainText('Nome do participante');

      const texto = 'Certificamos que {{nome}} participou.\nEmitido sem JavaScript.';
      await body.fill(texto);

      const form = page.getByTestId('template-form');
      await form.getByTestId('template-submit').click();

      await expect
        .poll(async () => layoutOf(await storedTemplate(`${TEMPLATE_NAME} sem js`)).elements[2]?.text, {
          timeout: 30_000,
        })
        .toBe(texto);
    } finally {
      await context.close();
    }
  });
});

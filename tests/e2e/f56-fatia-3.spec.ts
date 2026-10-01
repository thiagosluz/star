import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

import { RUN_ID, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { withTenant } from '../../src/lib/db/tenant-client';
import { BUCKETS, putObjectBuffer } from '../../src/lib/storage/s3-client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FATIA 3 DO MUTIRÃO DA JORNADA (dívidas E54 e E18)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Dois fatos que a pessoa encontra pelo navegador:
 *
 *    1. **O CPF no formulário de inscrição** — ele é OPCIONAL, a tela diz para que serve
 *       (o certificado) e um número que não confere é RECUSADO ali, com a pessoa na
 *       frente da tela para corrigir;
 *    2. **A miniatura no acervo** — a galeria pede uma versão pequena, e a rota a
 *       deriva na primeira visita e a guarda no bucket. Sem isso, abrir o acervo baixa
 *       a foto inteira para desenhar um quadrado.
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f56-fatia3-${RUN_ID}`;
const EVENT_SLUG = `evento-fatia3-${RUN_ID}`;

/** Um CPF que confere (dígitos verificadores certos) e um que não. */
const CPF_VALIDO = '529.982.247-25';
const CPF_INVALIDO = '529.982.247-24';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let pessoa: { id: string; email: string };

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f56f3.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
      name: `Instituição da Fatia 3 ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: `Evento da Fatia 3 ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      capacity: 50,
    });

    eventId = event.id;

    pessoa = await signUpVia(api, 'Pessoa da Fatia 3');
    await linkUser({ tenantId, userId: pessoa.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: pessoa.id, role: 'PARTICIPANT' });
  } finally {
    await api.dispose();
  }
});

test('1. o CPF é opcional, explicado — e um número que não confere é RECUSADO', async ({ page }) => {
  await signInAs(page, pessoa.email);
  await page.goto(`/t/${tenantSlug}/eventos/${EVENT_SLUG}/inscricao`);

  const cpf = page.getByTestId('event-registration-cpf');
  await expect(cpf).toBeVisible({ timeout: 30_000 });

  /** A tela diz PARA QUE SERVE: documento sem finalidade declarada não se pede. */
  await expect(page.getByText(/sai no certificado/i)).toBeVisible();

  // ── CPF que não confere: a inscrição para, e a mensagem diz o que fazer ────────
  await cpf.fill(CPF_INVALIDO);
  await page.getByRole('checkbox', { name: /Autorizo o tratamento/i }).check();
  await page.getByRole('button', { name: /Confirmar inscrição no evento/i }).click();

  await expect(page.getByTestId('event-registration-error')).toContainText(/CPF/i, {
    timeout: 30_000,
  });

  /** E nada foi gravado: a inscrição não nasce com documento errado. */
  const antes = await e2eDb.registration.count({
    where: { tenantId, eventId, userId: pessoa.id },
  });
  expect(antes).toBe(0);

  /**
   * O QUE A PESSOA DIGITOU CONTINUA NA TELA (defeito real, achado por este teste).
   *
   * O React 19 zera os campos do formulário depois que a Server Action responde — e a
   * mensagem de CPF inválido chegava com o campo VAZIO: para corrigir um dígito era
   * preciso redigitar tudo. A action passou a devolver os valores digitados, e é isto
   * que prende a correção.
   */
  await expect(cpf).toHaveValue(CPF_INVALIDO);

  // ── CPF que confere: a inscrição passa, e o banco guarda DÍGITOS ──────────────
  await cpf.fill(CPF_VALIDO);
  /** A caixa de consentimento o React também zera: a pessoa remarca antes de enviar. */
  await page.getByRole('checkbox', { name: /Autorizo o tratamento/i }).check();
  await page.getByRole('button', { name: /Confirmar inscrição no evento/i }).click();

  /**
   * A página RECARREGA no estado de inscrita (`revalidatePath`), e é ela — e não o
   * cartão de sucesso do formulário — que confirma o que aconteceu: quem se inscreve
   * pelo evento passa a ver a programação liberada, e o formulário sai de cena.
   */
  await expect(page.getByTestId('event-registration-status')).toContainText(/ativa/i, {
    timeout: 30_000,
  });

  const registration = await withTenant(tenantId, (tx) =>
    tx.registration.findFirstOrThrow({
      where: { tenantId, eventId, userId: pessoa.id, activityId: null },
      select: { formResponses: true },
    }),
  );

  /**
   * DÍGITOS, e não a máscara: o banco guarda o número, e a formatação é da impressão —
   * guardar `529.982.247-25` obrigaria a desformatar em toda leitura.
   */
  expect(registration.formResponses).toEqual({ cpf: '52998224725' });
});

test('2. a galeria pede a MINIATURA, e a rota entrega WebP pequeno', async ({ page }) => {
  /** Uma imagem "legada": PNG no bucket, do jeito que o acervo tinha antes da F46. */
  const bucket = BUCKETS.assets();
  const objectKey = `legacy/f56f3-${RUN_ID}.png`;
  const png = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .png()
    .toBuffer();

  await putObjectBuffer({ bucket, objectKey, body: png, contentType: 'image/png' });

  const asset = await withTenant(tenantId, (tx) =>
    tx.mediaAsset.create({
      data: {
        tenantId,
        eventId,
        bucket,
        objectKey,
        url: `http://localhost:9000/${bucket}/${objectKey}`,
        fileName: `legado-${RUN_ID}.png`,
        mimeType: 'image/png',
        sizeBytes: png.length,
        checksum: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
        target: 'GALLERY',
      },
      select: { id: true },
    }),
  );

  /** A pessoa precisa poder ver o acervo: `page:manage` vem do papel de organizadora. */
  const organizadora = await e2eDb.user.findFirstOrThrow({
    where: { email: pessoa.email },
    select: { id: true },
  });
  await grantRole({ tenantId, userId: organizadora.id, role: 'ADMIN' });

  await signInAs(page, pessoa.email);
  await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/pagina/midia`);

  /** A galeria aponta para a ROTA da miniatura — não para o original de 1600 px. */
  const imagem = page.locator(`[data-testid="media-${asset.id}"] img`);
  await expect(imagem).toBeVisible({ timeout: 30_000 });
  const src = await imagem.getAttribute('src');
  expect(src).toBe(`/api/t/${tenantSlug}/midia/${asset.id}/miniatura`);

  // ── E a rota responde WebP de verdade, guardando a miniatura para a próxima vez ──
  const resposta = await page.request.get(src ?? '');

  expect(resposta.status()).toBe(200);
  expect(resposta.headers()['content-type']).toBe('image/webp');

  const miniatura = await resposta.body();
  expect(miniatura.length).toBeGreaterThan(0);
  /** Menor que o original: é o ponto inteiro da dívida. */
  expect(miniatura.length).toBeLessThan(png.length);
});

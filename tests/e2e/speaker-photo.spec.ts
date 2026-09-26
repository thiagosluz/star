/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A foto do palestrante que NÃO tem conta na plataforma (FASE 46)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A JORNADA QUE NÃO EXISTIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem organiza um evento tem a foto do convidado em mãos — por e-mail, no contrato,
 *  no material de divulgação — e o convidado, muitas vezes, nunca vai entrar na
 *  plataforma. Até esta fase isso significava uma vitrine sem foto, e nem a
 *  organização podia resolver.
 *
 *  O cenário percorre o caminho inteiro, do navegador da organização até a página
 *  pública que o visitante anônimo vê:
 *
 *    1. cadastra o palestrante SEM e-mail (portanto sem conta e sem convite), envia a
 *       foto e declara ter autorização — e o que fica no bucket é WebP;
 *    2. corrige o nome DEPOIS: a foto continua lá (era o defeito silencioso que a fase
 *       consertou);
 *    3. tenta publicar OUTRA foto sem declarar autorização: é recusado com o motivo;
 *    4. remove a foto: a vitrine pública deixa de mostrá-la.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'foto-f46';
const EVENT_SLUG = `evento-f46-e2e-${RUN_ID}`;
const ACTIVITY_SLUG = `mesa-f46-${RUN_ID}`;
const SPEAKER_NAME = `Convidada Sem Conta ${RUN_ID}`;

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
let organizerEmail: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

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
      name: `Instituição Foto ${RUN_ID}`,
    });
    tenantId = tenant.id;

    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: `Encontro de Fotografia ${RUN_ID}`,
    });
    eventId = event.id;

    await createActivity({
      tenantId,
      eventId,
      slug: ACTIVITY_SLUG,
      title: `Mesa-redonda sobre imagem ${RUN_ID}`,
    });

    /**
     * Página publicada com o bloco de PALESTRANTES: é a vitrine que o visitante vê no
     * fim. Montar o cenário pelo banco é deliberado — o que este teste mede é a foto
     * na vitrine, não o editor de blocos (coberto nas FASES 17 e 23).
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const pageId = randomUUID();
      await tx.eventPage.create({
        data: {
          id: pageId,
          tenantId,
          eventId,
          slug: 'principal',
          title: 'Página principal',
          isHome: true,
          isPublished: true,
        },
      });

      await tx.pageBlock.create({
        data: {
          id: randomUUID(),
          tenantId,
          pageId,
          type: 'SPEAKERS',
          content: {},
          displayOrder: 10,
          isVisible: true,
        },
      });
    });

    const email = `f46.foto.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;
    const response = await api.post('/api/auth/sign-up/email', {
      headers: { origin: 'http://localhost:3000' },
      data: { name: `Organizadora Foto ${RUN_ID}`, email, password: PASSWORD },
    });

    if (!response.ok()) {
      throw new Error(`Falha ao cadastrar a organizadora: HTTP ${response.status()}`);
    }

    const organizer = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    organizerEmail = email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

const speakersUrl = () => `/t/${slug}/administracao/eventos/${eventId}/palestrantes`;
const publicEventUrl = () => `/t/${slug}/eventos/${EVENT_SLUG}`;

async function profileByName() {
  /**
   * A busca é por PREFIXO porque o cenário 2 renomeia a palestrante: um `where` pelo
   * nome exato deixaria de encontrar a linha no meio da jornada — e o teste mediria o
   * próprio acoplamento, não a regra.
   */
  return e2eDb.speakerProfile.findFirstOrThrow({
    where: { tenantId, name: { startsWith: SPEAKER_NAME } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, avatarUrl: true, avatarSource: true, bio: true },
  });
}

test.describe('foto do palestrante enviada pela organização', () => {
  test('1. a organização envia a foto, declara a autorização e a vitrine publica em WebP', async ({
    page,
  }) => {
    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());

    await page.getByTestId('toggle-speaker-form').click();

    const campo = page.getByTestId('speaker-photo-novo');
    await page.getByTestId('speaker-name').fill(SPEAKER_NAME);

    /**
     * O envio é imediato ao escolher o arquivo (a esteira assina → envia → confirma) e
     * a mensagem diz o que ficou GRAVADO: é a prova visível da conversão para quem usa.
     */
    await campo.getByLabel('Foto do palestrante').setInputFiles({
      name: 'retrato-f46.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });

    await expect(campo.getByTestId('speaker-photo-novo-feedback')).toContainText(/guardada em WebP/i, {
      timeout: 30_000,
    });
    await expect(campo.locator('img')).toHaveAttribute('src', /\.webp$/);

    await page.getByTestId('speaker-photo-auth-novo').check();
    await page.getByTestId('save-speaker').click();

    await expect(page.getByTestId('admin-speaker-feedback')).toContainText(/cadastrado/i, {
      timeout: 30_000,
    });

    // ── O banco confirma: WebP e origem ORGANIZATION ─────────────────────────
    const profile = await profileByName();
    expect(profile.avatarUrl).toMatch(/\.webp$/);
    expect(profile.avatarSource).toBe('ORGANIZATION');

    const row = page.getByTestId(`speaker-row-${profile.id}`);
    await expect(row.getByTestId(`speaker-row-photo-${profile.id}`)).toBeVisible();
    await expect(row.getByTestId(`speaker-row-photo-origin-${profile.id}`)).toContainText(
      /organização/i,
    );

    // ── Vincula à atividade (é o vínculo que leva o palestrante à vitrine) ───
    await row.getByTestId(`link-activity-${profile.id}`).selectOption({ label: `Mesa-redonda sobre imagem ${RUN_ID}` });
    await row.getByTestId(`submit-link-${profile.id}`).click();
    await expect(row.getByTestId(`speaker-activities-${profile.id}`)).toContainText(/Mesa-redonda/i, {
      timeout: 30_000,
    });

    // ── O visitante anônimo vê a foto na página pública ──────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

    const publicPage = await page.goto(publicEventUrl());
    expect(publicPage?.status()).toBe(200);

    const foto = page.locator(`img[src="${profile.avatarUrl}"]`);
    await expect(foto).toHaveCount(1);

    // E o arquivo servido é mesmo WebP (o bucket responde com o objeto gravado).
    const served = await page.request.get(profile.avatarUrl!);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toContain('image/webp');
  });

  test('2. corrigir o nome PRESERVA a foto, e tirá-la tira da vitrine', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());

    const before = await profileByName();
    const edit = page.getByTestId(`speaker-edit-${before.id}`);
    await edit.locator('summary').click();

    const novoNome = `${SPEAKER_NAME} (revisado)`;
    await edit.getByTestId('speaker-name').fill(novoNome);
    await edit.getByTestId(`save-speaker-${before.id}`).click();

    await expect(edit.getByTestId('admin-speaker-feedback')).toContainText(/atualizado/i, {
      timeout: 30_000,
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A FOTO SOBREVIVE À CORREÇÃO DO NOME
     * ─────────────────────────────────────────────────────────────────────────────
     *  O serviço gravava `avatarUrl: input.avatarUrl ?? null`: como o formulário de
     *  edição não mandava o campo, salvar um nome novo APAGAVA a foto — e a página
     *  pública passava a mostrar as iniciais sem que ninguém tivesse pedido.
     */
    const renamed = await e2eDb.speakerProfile.findUniqueOrThrow({
      where: { id: before.id },
      select: { name: true, avatarUrl: true, avatarSource: true },
    });

    expect(renamed.name).toBe(novoNome);
    expect(renamed.avatarUrl).toBe(before.avatarUrl);
    expect(renamed.avatarSource).toBe('ORGANIZATION');

    // ── A vitrine continua mostrando a mesma foto ────────────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    await page.goto(publicEventUrl());
    await expect(page.locator(`img[src="${before.avatarUrl}"]`)).toHaveCount(1);

    // ── E agora a REMOÇÃO: o palestrante sai da vitrine com iniciais ─────────
    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());

    const editAgain = page.getByTestId(`speaker-edit-${before.id}`);
    await editAgain.locator('summary').click();
    await editAgain.getByTestId(`speaker-photo-${before.id}-remove`).click();
    await editAgain.getByTestId(`save-speaker-${before.id}`).click();

    await expect(editAgain.getByTestId('admin-speaker-feedback')).toContainText(/atualizado/i, {
      timeout: 30_000,
    });

    const removed = await e2eDb.speakerProfile.findUniqueOrThrow({
      where: { id: before.id },
      select: { avatarUrl: true, avatarSource: true },
    });

    expect(removed.avatarUrl).toBeNull();
    expect(removed.avatarSource).toBeNull();

    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
    await page.goto(publicEventUrl());

    // A vitrine continua com a palestrante — sem foto.
    await expect(page.getByText(novoNome)).toBeVisible();
    await expect(page.locator(`img[src="${before.avatarUrl}"]`)).toHaveCount(0);
  });

  test('3. foto NOVA sem declaração de autorização é recusada', async ({ page }) => {
    /**
     * O cenário se garante sozinho: zera a foto pelo banco antes de tentar publicar de
     * novo. Assim ele mede a RECUSA, e não o que o cenário anterior deixou no caminho.
     */
    const alvo = await profileByName();
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.speakerProfile.update({
        where: { id: alvo.id },
        data: { avatarUrl: null, avatarSource: null },
      });
    });

    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());

    const profile = await profileByName();
    expect(profile.avatarUrl).toBeNull();

    const edit = page.getByTestId(`speaker-edit-${profile.id}`);
    await edit.locator('summary').click();

    /**
     * A caixa nasce DESMARCADA — como todo consentimento nesta plataforma (ADR-139).
     * Enviar a foto sem marcá-la é recusado pelo SERVIÇO, e a recusa diz o que falta.
     */
    await edit.getByLabel('Foto do palestrante (edição)').setInputFiles({
      name: 'outra-f46.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });

    await expect(edit.getByTestId(`speaker-photo-${profile.id}-feedback`)).toContainText(
      /guardada em WebP/i,
      { timeout: 30_000 },
    );

    await edit.getByTestId(`save-speaker-${profile.id}`).click();

    await expect(edit.getByTestId('admin-speaker-feedback')).toContainText(/autorização/i, {
      timeout: 30_000,
    });

    // E NADA foi publicado.
    const after = await profileByName();
    expect(after.avatarUrl).toBeNull();
  });
});

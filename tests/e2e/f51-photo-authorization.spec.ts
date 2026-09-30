/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A declaração de autorização da foto (FASE 51 · dívida E66)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A JORNADA, DO PONTO DE VISTA DE QUEM ORGANIZA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a E66 a organização marcava "tenho autorização" e a plataforma guardava só
 *  QUEM afirmou (na trilha). O que falta é a prova do consentimento: o TEXTO aceito,
 *  a VERSÃO dele, o CANAL por onde veio e a DATA.
 *
 *    1. a tela mostra o TEXTO da declaração (a pessoa precisa LER o que aceita) e o
 *       seletor de canal;
 *    2. foto NOVA sem canal é recusada — com o motivo no lugar onde a resposta do
 *       servidor aparece;
 *    3. com canal, o perfil nasce com texto + versão + canal + data, e a tela passa a
 *       mostrar QUAL redação está valendo;
 *    4. corrigir só o nome NÃO reexige nada e não reescreve a declaração vigente;
 *    5. remover a foto LIMPA a declaração (ela era sobre aquela imagem);
 *    6. e o formulário continua sendo um formulário de servidor: com o JavaScript
 *       DESLIGADO, salvar o cadastro ainda funciona.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type Page } from '@playwright/test';
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
const TENANT_LABEL = 'f51-autorizacao';
const EVENT_SLUG = `evento-f51-autorizacao-${RUN_ID}`;
const ACTIVITY_SLUG = `mesa-f51-${RUN_ID}`;
const SPEAKER_NAME = `Convidada Autorizada ${RUN_ID}`;

/** PNG 8×8 de verdade: a assinatura é conferida e a imagem precisa DECODIFICAR. */
const PNG_8X8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWM4oWHzHx9mGBkKAHkRisGTbO91AAAAAElFTkSuQmCC',
  'base64',
);

const slug = `${TENANT_LABEL}-${RUN_ID}`;

let tenantId: string;
let eventId: string;
let organizerEmail: string;
let organizerId: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signInAs(page: Page, email: string): Promise<void> {
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
      name: `Instituição Autorização ${RUN_ID}`,
    });
    tenantId = tenant.id;

    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: `Encontro de Autorização ${RUN_ID}`,
    });
    eventId = event.id;

    await createActivity({
      tenantId,
      eventId,
      slug: ACTIVITY_SLUG,
      title: `Mesa-redonda sobre imagem ${RUN_ID}`,
    });

    const email = `f51.autorizacao.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;
    const response = await api.post('/api/auth/sign-up/email', {
      headers: { origin: 'http://localhost:3000' },
      data: { name: `Organizadora Autorização ${RUN_ID}`, email, password: PASSWORD },
    });

    if (!response.ok()) {
      throw new Error(`Falha ao cadastrar a organizadora: HTTP ${response.status()}`);
    }

    const organizer = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    organizerEmail = email;
    organizerId = organizer.id;

    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

const speakersUrl = () => `/t/${slug}/administracao/eventos/${eventId}/palestrantes`;

/** A palestrante do cenário, sempre pelo PREFIXO (o nome é corrigido no meio da jornada). */
async function profileByName() {
  return e2eDb.speakerProfile.findFirstOrThrow({
    where: { tenantId, name: { startsWith: SPEAKER_NAME } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      avatarSource: true,
      photoAuthorizationText: true,
      photoAuthorizationVersion: true,
      photoAuthorizationChannel: true,
      photoAuthorizationAt: true,
    },
  });
}

/** Lê o perfil sob o contexto de instituição (a tabela está sob RLS + FORCE). */
async function readProfile(speakerProfileId: string) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.speakerProfile.findUniqueOrThrow({
      where: { id: speakerProfileId },
      select: {
        name: true,
        avatarUrl: true,
        photoAuthorizationText: true,
        photoAuthorizationVersion: true,
        photoAuthorizationChannel: true,
        photoAuthorizationAt: true,
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('declaração de autorização da foto', () => {
  test('1. o texto precisa ser LIDO, e a foto nova sem canal é recusada', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());

    await page.getByTestId('toggle-speaker-form').click();

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O TEXTO DA DECLARAÇÃO É VISÍVEL, NÃO UM RÓTULO
     * ─────────────────────────────────────────────────────────────────────────────
     *  "Tenho autorização" sem o texto não diz o que a pessoa aceitou. A frase que
     *  aparece aqui é a MESMA constante que o serviço grava no perfil.
     */
    const declaracao = page.getByTestId('speaker-photo-declaration-novo');
    await expect(declaracao).toBeVisible();
    await expect(page.getByTestId('speaker-photo-declaration-text-novo')).toContainText(
      /Declaro, em nome da organização/i,
    );
    await expect(declaracao).toContainText(/Redação/i);
    await expect(declaracao).toContainText(/v1/i);

    await page.getByTestId('speaker-name').fill(SPEAKER_NAME);

    // A foto sobe pela esteira (assina → envia → confirma) e vira WebP.
    await page
      .getByTestId('speaker-photo-novo')
      .getByLabel('Foto do palestrante')
      .setInputFiles({ name: 'retrato-f51.png', mimeType: 'image/png', buffer: PNG_8X8 });

    await expect(page.getByTestId('speaker-photo-novo-feedback')).toContainText(/guardada em WebP/i, {
      timeout: 30_000,
    });

    // ── Caixa marcada, canal NÃO escolhido: a foto nova é recusada ──────────────
    await page.getByTestId('speaker-photo-auth-novo').check();
    await page.getByTestId('save-speaker').click();

    await expect(page.getByTestId('admin-speaker-feedback')).toContainText(/canal/i, {
      timeout: 30_000,
    });

    // Nada foi criado: a recusa é antes de qualquer gravação.
    const semCanal = await e2eDb.speakerProfile.findFirst({
      where: { tenantId, name: SPEAKER_NAME },
      select: { id: true },
    });
    expect(semCanal).toBe(null);

    // ── Escolhido o canal, o cadastro passa ────────────────────────────────────
    await page.getByTestId('speaker-photo-channel-novo').selectOption({ label: 'E-mail' });
    await page.getByTestId('save-speaker').click();

    await expect(page.getByTestId('admin-speaker-feedback')).toContainText(/cadastrado/i, {
      timeout: 30_000,
    });

    const profile = await profileByName();

    expect(profile.avatarUrl).toMatch(/\.webp$/);
    expect(profile.photoAuthorizationText).toMatch(/Declaro, em nome da organização/i);
    expect(profile.photoAuthorizationVersion).toBe('v1');
    expect(profile.photoAuthorizationChannel).toBe('EMAIL');
    expect(profile.photoAuthorizationAt).toBeInstanceOf(Date);
  });

  test('2. a tela mostra a redação, o canal e a data que estão VALENDO', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());

    const profile = await profileByName();
    const edit = page.getByTestId(`speaker-edit-${profile.id}`);
    await edit.locator('summary').click();

    const vigente = edit.getByTestId(`speaker-photo-declaration-current-${profile.id}`);
    await expect(vigente).toBeVisible();
    await expect(vigente).toHaveAttribute('data-declaration-version', 'v1');
    await expect(vigente).toContainText(/E-mail/);
    await expect(vigente).toContainText(/\d{2}\/\d{2}\/\d{4}/);

    // O canal gravado vem PRÉ-SELECIONADO: corrigir o cadastro não perde o que foi
    // declarado, e a pessoa vê de onde veio o consentimento.
    await expect(edit.getByTestId(`speaker-photo-channel-${profile.id}`)).toHaveValue('EMAIL');
  });

  test('3. corrigir o nome PRESERVA a declaração (não reexige canal)', async ({ page }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ARMADILHA QUE ESTE CENÁRIO TRANCA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Se a exigência do canal valesse para QUALQUER gravação, corrigir um nome
     *  obrigaria a marcar a caixa e escolher o canal de novo — e a declaração viraria
     *  ruído (marcada sem ler, porque o formulário não deixa salvar).
     */
    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());

    const antes = await profileByName();
    const edit = page.getByTestId(`speaker-edit-${antes.id}`);
    await edit.locator('summary').click();

    const novoNome = `${SPEAKER_NAME} (revisado)`;
    await edit.getByTestId('speaker-name').fill(novoNome);
    await edit.getByTestId(`save-speaker-${antes.id}`).click();

    await expect(edit.getByTestId('admin-speaker-feedback')).toContainText(/atualizado/i, {
      timeout: 30_000,
    });

    const depois = await readProfile(antes.id);

    expect(depois.name).toBe(novoNome);
    expect(depois.avatarUrl).toBe(antes.avatarUrl);
    // A MESMA declaração, com a mesma hora: nada foi reescrito.
    expect(depois.photoAuthorizationAt?.getTime()).toBe(antes.photoAuthorizationAt?.getTime());
    expect(depois.photoAuthorizationText).toBe(antes.photoAuthorizationText);
    expect(depois.photoAuthorizationVersion).toBe('v1');
    expect(depois.photoAuthorizationChannel).toBe('EMAIL');
  });

  test('4. remover a foto LIMPA a declaração (ela era sobre aquela imagem)', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());

    const antes = await profileByName();
    const edit = page.getByTestId(`speaker-edit-${antes.id}`);
    await edit.locator('summary').click();

    await edit.getByTestId(`speaker-photo-${antes.id}-remove`).click();
    await edit.getByTestId(`save-speaker-${antes.id}`).click();

    await expect(edit.getByTestId('admin-speaker-feedback')).toContainText(/atualizado/i, {
      timeout: 30_000,
    });

    const depois = await readProfile(antes.id);

    expect(depois.avatarUrl).toBe(null);
    expect(depois.photoAuthorizationText).toBe(null);
    expect(depois.photoAuthorizationVersion).toBe(null);
    expect(depois.photoAuthorizationChannel).toBe(null);
    expect(depois.photoAuthorizationAt).toBe(null);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O FATO NÃO SE PERDE — ELE SAI DO PERFIL E FICA NA TRILHA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O que a E66 decide é que o perfil descreve só a foto publicada. Quem declarou,
     *  sob qual redação e por qual canal continua respondível pela auditoria.
     */
    const trilha = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.auditLog.findFirst({
        where: {
          tenantId,
          entityType: 'speakerProfile',
          entityId: antes.id,
          action: 'UPDATE',
        },
        orderBy: { createdAt: 'desc' },
        select: { changes: true, userId: true },
      });
    });

    expect(JSON.stringify(trilha?.changes ?? {})).toContain('retirada com a foto');
    expect(trilha?.userId).toBe(organizerId);
  });

  test('5. SEM JavaScript o cadastro continua salvando (formulário de servidor)', async ({
    browser,
  }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O EXTREMO: O BUNDLE NUNCA CARREGA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O formulário de edição é um `<form>` com ação de servidor, dentro de um
     *  `<details>` nativo — abrir e salvar não dependem de JavaScript. O espelho da
     *  régua no cliente (que só avisa antes do envio) some, e a autoridade volta a ser
     *  o serviço, como sempre foi.
     */
    const contexto = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();

    try {
      await signInAs(page, organizerEmail);
      await page.goto(speakersUrl());

      const antes = await e2eDb.speakerProfile.findFirstOrThrow({
        where: { tenantId, name: { startsWith: SPEAKER_NAME } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      const edit = page.getByTestId(`speaker-edit-${antes.id}`);
      await edit.locator('summary').click();

      // O texto da declaração e o seletor de canal estão no HTML servido.
      await expect(edit.getByTestId(`speaker-photo-declaration-text-${antes.id}`)).toContainText(
        /Declaro, em nome da organização/i,
      );
      await expect(edit.getByTestId(`speaker-photo-channel-${antes.id}`)).toBeVisible();

      const nomeFinal = `${SPEAKER_NAME} (sem javascript)`;
      await edit.getByTestId('speaker-name').fill(nomeFinal);
      await edit.getByTestId(`save-speaker-${antes.id}`).click();
      await page.waitForLoadState('load');

      await expect
        .poll(
          async () => {
            const perfil = await e2eDb.speakerProfile.findUniqueOrThrow({
              where: { id: antes.id },
              select: { name: true },
            });
            return perfil.name;
          },
          { timeout: 30_000 },
        )
        .toBe(nomeFinal);
    } finally {
      await contexto.close();
    }
  });
});

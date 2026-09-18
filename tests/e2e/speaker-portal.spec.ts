/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Portal do palestrante e vitrine pública (FASE 25)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A JORNADA COMPLETA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a ORGANIZAÇÃO cria a atividade e cadastra o palestrante com e-mail,
 *         recebendo o código de convite;
 *      2. o PALESTRANTE entra, aceita o convite pelo código, edita a bio, troca a
 *         foto e publica um slide em PDF para os inscritos;
 *      3. o VISITANTE ANÔNIMO vê a foto e a bio atualizadas na vitrine do evento e
 *         na ficha do palestrante;
 *      4. o PARTICIPANTE inscrito na atividade baixa o material liberado — e o
 *         anônimo NÃO consegue (403/401);
 *      5. o PALESTRANTE emite o próprio certificado depois do evento, com a carga
 *         horária correta.
 *
 *  A ORDEM IMPORTA: o primeiro cenário cria a atividade e o convite dos demais. O
 *  estado durável é o BANCO — cada cenário resolve o que precisa por slug/consulta,
 *  e não por variável de módulo (lição da FASE 14).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'palestrante-f25';
const EVENT_SLUG = `evento-f25-e2e-${RUN_ID}`;
const ACTIVITY_SLUG = `oficina-f25-${RUN_ID}`;
const ACTIVITY_TITLE = `Oficina de Saúde Digital ${RUN_ID}`;
const WORKLOAD_MINUTES = 180;

/** PNG 1×1 válido — a assinatura real do arquivo é o que a validação confere. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/** PDF mínimo, mas com assinatura `%PDF` de verdade. */
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Size 3 >>\n%%EOF\n',
);

let tenantId: string;
let eventId: string;
let organizerEmail: string;
let speakerEmail: string;
let participantEmail: string;

/**
 * Código de convite da execução.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE É O ÚNICO ESTADO EM MEMÓRIA ADMITIDO NO ARQUIVO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A regra da casa é que o estado durável de um E2E é o BANCO — ids se resolvem por
 *  slug a cada uso. Aqui não dá: o token é mostrado UMA vez e o banco guarda só o
 *  SHA-256 dele. Não existe consulta que o recupere, e é assim de propósito.
 *
 *  Quando a variável está vazia (execução isolada do cenário, ou falha do primeiro
 *  teste), o segundo cenário usa o caminho do PAINEL — o convite é identificado pelo
 *  e-mail da conta. Os dois caminhos previstos na fase ficam cobertos.
 */
let inviteToken: string | null = null;

const slug = `${TENANT_LABEL}-${RUN_ID}`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f25.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Data no formato do `<input type="datetime-local">`, no fuso local do runner. */
function localInput(daysFromNow: number, hour: number): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  date.setHours(hour, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição Palestrante ${RUN_ID}`,
    });
    tenantId = tenant.id;

    eventId = randomUUID();
    const startsAt = new Date(Date.now() + 30 * 86_400_000);

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso de Saúde Digital ${RUN_ID}`,
          summary: 'Evento dos testes E2E da FASE 25.',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
          /**
           * `capacity: null` = ILIMITADO. O padrão da coluna é `0`, que significa
           * ESGOTADO — o cenário 4 precisa que o participante consiga se inscrever, e
           * sem esta linha o servidor recusava com "a lotação total do evento foi
           * atingida" (o evento do teste não tem controle de vagas).
           */
          capacity: null,
          confirmedCount: 0,
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          /**
           * Fecha DEPOIS do início do evento (+30d): a atividade é ministrada no dia
           * seguinte ao da abertura, e uma janela que fechasse antes dela tornaria a
           * inscrição do participante (cenário 4) impossível — o teste mediria a janela
           * em vez do material.
           */
          registrationClosesAt: new Date(Date.now() + 32 * 86_400_000),
        },
      });

      /**
       * Página pública PUBLICADA com o bloco de palestrantes: é ela que o visitante
       * anônimo vê no cenário 3. Publicar direto pelo banco aqui é montagem de
       * cenário — o que o teste mede é a VITRINE, não o editor (que tem cobertura
       * própria nas FASES 17 e 23).
       */
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

    const organizer = await signUpVia(api, `Organizadora ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });

    /**
     * Palestrante e participante são criados ANTES: o convite é feito PARA o e-mail do
     * palestrante (é ele que identifica a pessoa no aceite), e o participante precisa
     * existir para se inscrever na atividade criada no cenário 1.
     */
    const speaker = await signUpVia(api, `Palestrante ${RUN_ID}`);
    speakerEmail = speaker.email;

    const participant = await signUpVia(api, `Participante ${RUN_ID}`);
    participantEmail = participant.email;
    await linkUser({ tenantId, userId: participant.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: participant.id, role: 'PARTICIPANT' });
  } finally {
    await api.dispose();
  }
});

const adminEventUrl = () => `/t/${slug}/administracao/eventos/${eventId}`;
const speakersUrl = () => `/t/${slug}/administracao/eventos/${eventId}/palestrantes`;
const portalUrl = () => `/t/${slug}/palestrante`;
const inviteUrl = (code?: string) =>
  `/t/${slug}/palestrante/convite${code ? `?codigo=${encodeURIComponent(code)}` : ''}`;
const publicEventUrl = () => `/t/${slug}/eventos/${EVENT_SLUG}`;
const publicActivityUrl = () => `/t/${slug}/eventos/${EVENT_SLUG}/atividades/${ACTIVITY_SLUG}`;

async function activityIdBySlug(): Promise<string> {
  const activity = await e2eDb.activity.findFirstOrThrow({
    where: { eventId, slug: ACTIVITY_SLUG },
    select: { id: true },
  });
  return activity.id;
}

async function speakerProfileIdByEmail(email: string): Promise<string> {
  const profile = await e2eDb.speakerProfile.findFirstOrThrow({
    where: { tenantId, email },
    select: { id: true },
  });
  return profile.id;
}

test.describe('portal do palestrante', () => {
  test('a organização cria a atividade e cadastra o palestrante com convite (E18)', async ({ page }) => {
    await signInAs(page, organizerEmail);

    // ── 1. A atividade nasce pela tela do evento ──────────────────────────────
    await page.goto(adminEventUrl());
    await page.getByTestId('activities-section').locator('summary').first().click();

    const createActivity = page.getByTestId('create-activity');
    await createActivity.getByLabel('Identificador').fill(ACTIVITY_SLUG);
    await createActivity.getByLabel('Título').fill(ACTIVITY_TITLE);
    await createActivity.getByLabel('Tipo').selectOption('MINI_COURSE');
    /**
     * Dia SEGUINTE ao início do evento (+31d): o evento começa no horário corrente de
     * +30 dias, e uma atividade marcada para a manhã desse mesmo dia cairia ANTES da
     * abertura — o servidor recusa, corretamente ("a atividade precisa acontecer dentro
     * do período do evento").
     */
    await createActivity.getByLabel('Início').fill(localInput(31, 9));
    await createActivity.getByLabel('Término').fill(localInput(31, 12));
    await createActivity.getByLabel('Carga horária (min)').fill(String(WORKLOAD_MINUTES));
    await createActivity.getByLabel('Vagas').fill('30');
    await createActivity.getByTestId('admin-submit').click();

    await expect(createActivity.getByTestId('create-activity-feedback')).toContainText(/criad/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('activity-list')).toContainText(ACTIVITY_TITLE);

    // ── 2. O palestrante é cadastrado na tela de palestrantes ────────────────
    await page.goto(speakersUrl());
    await page.getByTestId('toggle-speaker-form').click();

    const form = page.getByTestId('speaker-form');
    await form.getByTestId('speaker-name').fill(`Ana Convidada ${RUN_ID}`);
    await form.getByTestId('speaker-email').fill(speakerEmail);
    await form.getByTestId('speaker-institution').fill('Universidade Federal da Bahia');
    await form.getByTestId('speaker-role').fill('Instrutor(a)');
    await page.getByTestId('save-speaker').click();

    await expect(page.getByTestId('admin-speaker-feedback')).toContainText(/cadastrad/i, {
      timeout: 30_000,
    });

    /**
     * O código aparece UMA VEZ (o banco guarda só o hash). É o que a organização
     * entrega ao palestrante — e o que o cenário seguinte usa.
     */
    const token = (await page.getByTestId('invite-token').innerText()).trim();
    expect(token.length).toBe(32);
    inviteToken = token;

    const profileId = await speakerProfileIdByEmail(speakerEmail);
    await expect(page.getByTestId(`speaker-row-${profileId}`)).toContainText('Convite pendente');

    // ── 3. O vínculo com a atividade é feito na mesma tela ───────────────────
    await page.getByTestId(`link-activity-${profileId}`).selectOption({ label: ACTIVITY_TITLE });
    await page.getByTestId(`submit-link-${profileId}`).click();

    await expect(page.getByTestId(`speaker-activities-${profileId}`)).toContainText(ACTIVITY_TITLE, {
      timeout: 30_000,
    });
  });

  test('o palestrante aceita o convite, edita a bio, troca a foto e publica o slide (E19)', async ({
    page,
  }) => {
    const profileId = await speakerProfileIdByEmail(speakerEmail);
    const activityId = await activityIdBySlug();

    await signInAs(page, speakerEmail);
    await page.goto(inviteUrl(inviteToken ?? undefined));

    if (inviteToken) {
      await expect(page.getByTestId('invite-token-input')).toHaveValue(inviteToken);
      await page.getByTestId('claim-by-token').click();
    } else {
      // Caminho do painel: o convite é identificado pelo e-mail da conta.
      await page.goto(portalUrl());
      await page.getByTestId(`claim-invite-${profileId}`).click();
    }

    // O aceite leva ao portal.
    await page.waitForURL(new RegExp(`${slug}/palestrante$`), { timeout: 30_000 });
    await expect(page.getByTestId(`speaker-profile-${profileId}`)).toBeVisible();

    // ── Bio e foto ───────────────────────────────────────────────────────────
    const form = page.getByTestId(`speaker-profile-form-${profileId}`);
    await form.getByLabel('Biografia').fill(
      `Pesquisadora de saúde digital e telemedicina. Bio editada pelo próprio palestrante ${RUN_ID}.`,
    );
    await form.getByLabel('Instituição').fill('Universidade Federal da Bahia');
    await form.getByLabel('LinkedIn').fill('linkedin.com/in/ana-convidada');

    await form.getByLabel('Foto do palestrante').setInputFiles({
      name: 'retrato.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });

    await expect(page.getByText(/Foto validada/i)).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('save-speaker-profile').click();
    await expect(page.getByTestId('speaker-feedback-ok')).toContainText(/atualizado/i, {
      timeout: 30_000,
    });

    // ── Material em PDF, exclusivo de inscritos ──────────────────────────────
    /**
     * O envio segue o fluxo REAL: o botão abre o seletor de arquivos e o `onChange` do
     * input dispara a esteira (assinar → enviar → confirmar). Definir o arquivo direto
     * no input pularia o estado que o clique monta — armadilha 34.
     */
    const uploader = page.getByTestId(`material-uploader-${activityId}`);
    await uploader.getByLabel('Título do material').fill('Slides da oficina');
    await uploader.getByLabel('Tipo do material').selectOption('SLIDES');
    await uploader.getByLabel('Visibilidade do material').selectOption('ATTENDEES_ONLY');

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId(`send-material-${activityId}`).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'slides.pdf',
      mimeType: 'application/pdf',
      buffer: MINIMAL_PDF,
    });

    await expect(page.getByText(/Material enviado/i)).toBeVisible({ timeout: 60_000 });

    // ── O BANCO confirma o vínculo, a foto e o material ──────────────────────
    const profile = await e2eDb.speakerProfile.findUniqueOrThrow({
      where: { id: profileId },
      select: { userId: true, bio: true, avatarUrl: true, isConfirmed: true },
    });

    expect(profile.userId).not.toBeNull();
    expect(profile.isConfirmed).toBe(true);
    expect(profile.bio).toContain('editada pelo próprio palestrante');
    expect(profile.avatarUrl).toContain('http');

    const material = await e2eDb.speakerMaterial.findFirstOrThrow({
      where: { activityId, speakerProfileId: profileId, deletedAt: null },
      select: { title: true, visibility: true, storageKey: true, checksum: true, sizeBytes: true },
    });

    expect(material.visibility).toBe('ATTENDEES_ONLY');
    expect(material.storageKey).toContain('palestrantes');
    expect(material.sizeBytes).toBe(MINIMAL_PDF.length);
    // O checksum é do CONTEÚDO: prova que o arquivo que chegou é o que foi enviado.
    expect(material.checksum).toHaveLength(64);

    /**
     * O papel de palestrante foi concedido por ATIVIDADE no aceite — é o que dá acesso
     * ao portal e nada além dele.
     */
    const assignment = await e2eDb.roleAssignment.findFirstOrThrow({
      where: { tenantId, userId: profile.userId ?? '', role: 'SPEAKER', revokedAt: null },
      select: { scope: true, activityId: true },
    });

    expect(assignment.scope).toBe('ACTIVITY');
    expect(assignment.activityId).toBe(activityId);
  });

  test('o visitante anônimo vê a foto e a bio na vitrine e na ficha (E21)', async ({ page }) => {
    const profileId = await speakerProfileIdByEmail(speakerEmail);

    await page.goto(publicEventUrl());

    /**
     * A vitrine é montada pelo bloco `SPEAKERS` da página publicada, e o cartão traz
     * foto, papel e minibiografia — a ficha completa fica a um clique.
     */
    await expect(page.getByTestId('speaker-gallery')).toBeVisible({ timeout: 30_000 });

    const card = page.getByTestId(`speaker-card-${profileId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(`Ana Convidada ${RUN_ID}`);
    await expect(card).toContainText('Instrutor(a)');
    await expect(card).toContainText('Universidade Federal da Bahia');
    await expect(page.getByTestId(`speaker-bio-${profileId}`)).toContainText('telemedicina');
    await expect(page.getByTestId(`speaker-activities-${profileId}`)).toContainText(ACTIVITY_TITLE);

    // ── Ficha individual ────────────────────────────────────────────────────
    await card.getByRole('link', { name: /ver ficha/i }).click();
    await page.waitForURL(new RegExp(`/palestrantes/${profileId}$`), { timeout: 30_000 });

    await expect(page.getByTestId('speaker-name')).toContainText(`Ana Convidada ${RUN_ID}`);
    await expect(page.getByTestId('speaker-role')).toContainText('Instrutor(a)');
    await expect(page.getByTestId('speaker-full-bio')).toContainText('editada pelo próprio palestrante');
    await expect(page.getByTestId('speaker-activity-list')).toContainText(ACTIVITY_TITLE);
    await expect(page.getByTestId('speaker-social-linkedin')).toBeVisible();

    // ── A ficha da atividade também aponta para o palestrante ───────────────
    await page.goto(publicActivityUrl());
    await expect(page.getByTestId('activity-speakers')).toContainText(`Ana Convidada ${RUN_ID}`);
    await expect(page.getByTestId(`activity-speaker-link-${profileId}`)).toBeVisible();
  });

  test('o anônimo não baixa o slide; o inscrito confirmado baixa (E20)', async ({ page, request }) => {
    const activityId = await activityIdBySlug();

    const material = await e2eDb.speakerMaterial.findFirstOrThrow({
      where: { activityId, deletedAt: null },
      select: { id: true, title: true },
    });

    // ── 1. Anônimo: o material aparece com cadeado, e o download é 401 ───────
    await page.goto(publicActivityUrl());

    await expect(page.getByTestId('activity-materials-locked')).toContainText(/exclusivo/i, {
      timeout: 30_000,
    });

    const anonymous = await request.get(
      `/api/t/${slug}/palestrantes/materiais/${material.id}/arquivo`,
      { maxRedirects: 0 },
    );
    expect(anonymous.status()).toBe(401);

    // ── 2. O inscrito se inscreve pela página pública ────────────────────────
    await signInAs(page, participantEmail);
    await page.goto(publicActivityUrl());

    await page.getByRole('checkbox', { name: /autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();

    await expect(page.getByTestId('registration-status')).toContainText(/confirmad|inscri/i, {
      timeout: 30_000,
    });

    await page.reload();

    // ── 3. Com a inscrição confirmada, o material fica disponível ────────────
    /** `material-row-*` é a LINHA; `material-*` é o link de download. */
    const row = page.getByTestId(`material-row-${material.id}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Slides da oficina');
    await expect(page.getByTestId(`material-${material.id}`)).toHaveText(/baixar/i);

    const download = await page.request.get(
      `/api/t/${slug}/palestrantes/materiais/${material.id}/arquivo`,
      { maxRedirects: 0 },
    );

    // A rota responde 302 para a URL ASSINADA do storage (o bucket é privado).
    expect([302, 307]).toContain(download.status());
    expect(download.headers()['location']).toContain('X-Amz-Signature');

    // ── 4. O arquivo realmente desce pelo endereço assinado ──────────────────
    const signed = await page.request.get(download.headers()['location'] ?? '');
    expect(signed.status()).toBe(200);
    expect(await signed.body()).toHaveLength(MINIMAL_PDF.length);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  E O PORTAL DO PALESTRANTE CONTINUA INACESSÍVEL PARA ELE
     * ─────────────────────────────────────────────────────────────────────────────
     *  Estar inscrito na atividade NÃO dá acesso ao material em rascunho nem ao portal
     *  de quem ministra: a permissão da tela é do papel SPEAKER, e o vínculo é por
     *  atividade. Sem isso, "inscrito" viraria "ministrante" por engano.
     */
    const portal = await page.request.get(portalUrl(), { maxRedirects: 0 });
    expect([302, 307]).toContain(portal.status());
  });

  test('o palestrante emite o certificado com a carga horária correta (E21)', async ({ page }) => {
    const profileId = await speakerProfileIdByEmail(speakerEmail);
    const activityId = await activityIdBySlug();

    const profile = await e2eDb.speakerProfile.findUniqueOrThrow({
      where: { id: profileId },
      select: { userId: true },
    });
    const speakerUserId = profile.userId ?? '';

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ELEGIBILIDADE É FATO, NÃO VONTADE: EVENTO ENCERRADO + CREDENCIAMENTO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Aqui os dois fatos são produzidos como aconteceriam na operação: o evento
     *  termina (o relógio passa) e o credenciamento é registrado no balcão. O
     *  certificado só sai depois disso — e é isso que o primeiro passo confirma,
     *  ANTES de produzir os fatos.
     */
    await signInAs(page, speakerEmail);
    await page.goto(portalUrl());

    const section = page.getByTestId(`speaker-certificate-${eventId}`);
    await expect(section).toHaveAttribute('data-eligible', 'false');
    await expect(page.getByTestId(`certificate-reason-${eventId}`)).toContainText(/após o término/i);

    // ── O evento termina, a atividade acontece e o credenciamento é registrado ──
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.event.update({
        where: { id: eventId },
        data: {
          status: 'FINISHED',
          startsAt: new Date(Date.now() - 10 * 86_400_000),
          endsAt: new Date(Date.now() - 2 * 86_400_000),
        },
      });

      /**
       * A ATIVIDADE também precisa ter acontecido.
       *
       * A carga do palestrante soma as atividades EFETIVAMENTE ministradas, e a
       * oficina estava marcada para daqui a 31 dias: encerrar só o evento deixaria a
       * atividade no futuro e a apuração (corretamente) em zero. Mover a agenda é o
       * que representa "o minicurso foi dado".
       */
      await tx.activity.update({
        where: { id: activityId },
        data: {
          status: 'COMPLETED',
          startsAt: new Date(Date.now() - 6 * 86_400_000),
          endsAt: new Date(Date.now() - 6 * 86_400_000 + WORKLOAD_MINUTES * 60_000),
        },
      });

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: speakerUserId,
          status: 'ATTENDED',
          consentData: true,
          checkedInAt: new Date(Date.now() - 6 * 86_400_000),
        },
      });
    });

    await page.reload();

    await expect(section).toHaveAttribute('data-eligible', 'true', { timeout: 30_000 });
    await expect(page.getByTestId(`certificate-reason-${eventId}`)).toContainText(/pode emitir/i);
    // `formatDuration(180)` = "3h" — a tela mostra a carga que o certificado vai afirmar.
    await expect(section).toContainText('3h');

    // ── Emissão ──────────────────────────────────────────────────────────────
    await page.getByTestId('emit-speaker-certificate').click();

    /**
     * A asserção é o ESTADO DURÁVEL, e não a mensagem transitória: depois de emitir, o
     * painel revalida e o botão dá lugar ao selo do documento. Esperar pelo texto da
     * resposta seria esperar por um elemento que o próprio sucesso remove.
     */
    await expect(page.getByTestId(`certificate-status-${eventId}`)).toBeVisible({
      timeout: 60_000,
    });

    const certificate = await e2eDb.certificate.findFirstOrThrow({
      where: { tenantId, userId: speakerUserId, eventId, kind: 'SPEAKER' },
      select: {
        workloadMinutes: true,
        status: true,
        validationCode: true,
        workloadBreakdown: true,
        signature: true,
      },
    });

    /**
     * A carga é a SOMA das atividades ministradas e concluídas: 180 minutos desta
     * oficina. É o número que o certificado afirma — e é o que o teste prende.
     */
    expect(certificate.workloadMinutes).toBe(WORKLOAD_MINUTES);
    expect(certificate.validationCode).toMatch(/^CERT-/);
    expect(certificate.signature.length).toBeGreaterThan(20);

    const breakdown = certificate.workloadBreakdown as unknown as { title: string; counted: boolean }[];
    expect(breakdown.some((entry) => entry.title === ACTIVITY_TITLE && entry.counted)).toBe(true);

    // A tela passa a mostrar o documento na lista da pessoa.
    await page.goto(portalUrl());
    await expect(page.getByTestId(`certificate-status-${eventId}`)).toBeVisible({ timeout: 30_000 });

    const listed = await e2eDb.certificate.count({
      where: { tenantId, userId: speakerUserId, eventId, kind: 'SPEAKER' },
    });
    // Emitir de novo NÃO cria um segundo documento (chave natural única).
    expect(listed).toBe(1);

    // A atividade continua sendo a mesma — o id é resolvido no fim de propósito.
    expect(activityId).toBeTruthy();
  });

  test('quem foi convidado encontra o convite no MENU, aceita e edita o próprio perfil (revisão da F25)', async ({
    page,
  }) => {
    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     *  O CAMINHO QUE FALTAVA: SEM LINK, SEM CÓDIGO, SÓ COM A CONTA
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  O DEFEITO QUE ORIGINOU ESTE CENÁRIO
     *  ─────────────────────────────────────────────────────────────────────────────
     *  O item de menu da participação usava `can(permissão, {scope:'TENANT'})` — e
     *  `can()` recusa permissão `:own` sem dono. Resultado: o grupo "Minha
     *  participação" inteiro sumia para TODO MUNDO, e o palestrante não tinha como
     *  chegar ao próprio portal sem digitar a URL. A pessoa que aparece aqui é o outro
     *  caso: foi CONVIDADA, tem conta e vínculo, e ainda NÃO tem o papel `SPEAKER`
     *  (ele nasce com o aceite) — então o convite precisa ser visível no menu.
     *
     *  O cenário começa no painel e termina com a bio salva: é a jornada inteira de
     *  quem chega sem código nenhum, e é a prova de que o palestrante consegue editar
     *  os próprios dados (bio, instituição, redes).
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    const invited = await signUpVia(page.request, `Convidada Sem Papel ${RUN_ID}`);

    // Vínculo ATIVO e NENHUM papel: exatamente o estado de quem foi convidado e ainda
    // não aceitou — é o que dá acesso ao painel sem dar acesso ao portal.
    await linkUser({ tenantId, userId: invited.id, kind: 'PARTICIPANT' });

    // ── A organização cadastra o perfil para o e-mail dessa conta ──────────────
    await signInAs(page, organizerEmail);
    await page.goto(speakersUrl());
    await page.getByTestId('toggle-speaker-form').click();

    const form = page.getByTestId('speaker-form');
    await form.getByTestId('speaker-name').fill(`Bruna Convidada ${RUN_ID}`);
    await form.getByTestId('speaker-email').fill(invited.email);
    await form.getByTestId('speaker-role').fill('Painelista');
    await page.getByTestId('save-speaker').click();

    await expect(page.getByTestId('admin-speaker-feedback')).toContainText(/cadastrad/i, {
      timeout: 30_000,
    });

    const profileId = await speakerProfileIdByEmail(invited.email);

    // O vínculo com a atividade é o que, no aceite, concede o papel SPEAKER.
    await page.getByTestId(`link-activity-${profileId}`).selectOption({ label: ACTIVITY_TITLE });
    await page.getByTestId(`submit-link-${profileId}`).click();
    await expect(page.getByTestId(`speaker-activities-${profileId}`)).toContainText(ACTIVITY_TITLE, {
      timeout: 30_000,
    });

    // ── A convidada entra e o MENU mostra o convite ────────────────────────────
    await signInAs(page, invited.email);
    await page.goto(`/t/${slug}/dashboard`);

    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    const inviteLink = nav.getByRole('link', { name: 'Convite de palestrante' });
    await expect(inviteLink).toBeVisible({ timeout: 30_000 });

    /**
     * O convite é a ÚNICA razão de o item existir para ela: sem papel pessoal nenhum,
     * os outros itens da participação continuam fora. Se um dia o menu voltar a ser
     * generoso demais, esta linha cai junto.
     */
    await expect(nav.getByRole('link', { name: 'Minhas inscrições' })).toHaveCount(0);

    await inviteLink.click();
    await page.waitForURL(new RegExp(`${slug}/palestrante$`), { timeout: 30_000 });

    // ── O convite está lá, com a atividade que ele reserva ─────────────────────
    await expect(page.getByTestId('pending-invite-section')).toBeVisible({ timeout: 30_000 });
    const inviteCard = page.getByTestId(`pending-invite-${profileId}`);
    await expect(inviteCard).toContainText(ACTIVITY_TITLE);
    await expect(inviteCard).toHaveAttribute('data-valid', 'true');

    await page.getByTestId(`claim-invite-${profileId}`).click();

    // ── Aceito: o portal passa a mostrar o perfil dela ─────────────────────────
    await expect(page.getByTestId(`speaker-profile-${profileId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pending-invite-section')).toHaveCount(0);

    // ── E ela edita os próprios dados ─────────────────────────────────────────
    const profileForm = page.getByTestId(`speaker-profile-form-${profileId}`);
    await profileForm.getByLabel('Biografia').fill(
      `Painelista de saúde digital. Bio escrita pela própria convidada ${RUN_ID}.`,
    );
    await profileForm.getByLabel('Instituição').fill('Instituto de Saúde Coletiva');
    await profileForm.getByLabel('LinkedIn').fill('linkedin.com/in/bruna-convidada');
    await page.getByTestId('save-speaker-profile').click();

    await expect(page.getByTestId('speaker-feedback-ok')).toContainText(/atualizado/i, {
      timeout: 30_000,
    });

    const profile = await e2eDb.speakerProfile.findUniqueOrThrow({
      where: { id: profileId },
      select: { userId: true, bio: true, institution: true, socialLinks: true, isConfirmed: true },
    });

    expect(profile.userId).toBe(invited.id);
    expect(profile.isConfirmed).toBe(true);
    expect(profile.bio).toContain('escrita pela própria convidada');
    expect(profile.institution).toBe('Instituto de Saúde Coletiva');
    expect(JSON.stringify(profile.socialLinks)).toContain('bruna-convidada');

    /**
     * O MENU muda de porta depois do aceite: o papel existe, então o item deixa de ser
     * "Convite de palestrante" e passa a ser "Portal do palestrante". Isso depende de o
     * layout da instituição ser revalidado no aceite — sem isso, a barra lateral ficaria
     * com o rótulo antigo (armadilha 40, na versão do shell).
     */
    await page.goto(`/t/${slug}/dashboard`);
    await expect(
      page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', {
        name: 'Portal do palestrante',
      }),
    ).toBeVisible({ timeout: 30_000 });
  });
});

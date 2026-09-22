/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Chamadas de propostas (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. a organização CRIA uma chamada pela tela e a PUBLICA — e o endereço público
 *      aparece no painel;
 *   2. a chamada publicada aparece sozinha no bloco da página pública do evento (o
 *      organizador escolhe ONDE o bloco fica; o conteúdo é o dado real);
 *   3. uma pessoa de FORA abre o formulário, envia a proposta e recebe um PROTOCOLO;
 *   4. a organização encontra a proposta DENTRO da chamada e chega ao painel do comitê
 *      por ali — o caminho que existe justamente porque proposta de minicurso não tem
 *      trilha e não apareceria na lista por trilha;
 *   5. o PROTOCOLO DE ACEITE cria a atividade com a carga horária DECLARADA, convida o
 *      proponente e enfileira o e-mail do convite.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CENÁRIO MONTA A PRÓPRIA FIXTURE (armadilha 62)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Instituição, evento, página e contas nascem aqui — o Playwright reinicia o worker
 *  depois de uma falha e o `RUN_ID` muda, então depender de dado de outro arquivo
 *  mediria o vazio.
 *
 *  A página pública é montada por ESCRITA DIRETA, e isso é deliberado: o editor de
 *  blocos é território das FASES 17/23, com cobertura própria (`landing-page.spec.ts`).
 *  O que este arquivo mede é o bloco novo LENDO a chamada publicada — a ponte entre o
 *  painel e a página.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'chamadas-f33';
const EVENT_SLUG = `evento-f33-${RUN_ID}`;
const CALL_SLUG = `minicursos-f33-${RUN_ID}`;
const CALL_TITLE = `Chamada de minicursos ${RUN_ID}`;
const PROPOSAL_TITLE = `Minicurso de Dados Abertos ${RUN_ID}`;
const WORKLOAD_MINUTES = 240;

/** O resumo precisa passar do mínimo do domínio (150 caracteres). */
const PROPOSAL_ABSTRACT =
  'Um minicurso prático de análise de dados com ferramentas abertas: leitura de planilhas ' +
  'públicas, limpeza, gráficos e publicação do resultado. A turma monta um painel com dados ' +
  'reais de educação do próprio município, do arquivo bruto à conclusão.';

let tenantId: string;
let eventId: string;
let organizerEmail: string;
let visitorEmail: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f33.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Data no formato do `<input type="datetime-local">`. */
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
      name: `Instituição das Chamadas ${RUN_ID}`,
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
          title: `Seminário de Extensão ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          registrationClosesAt: new Date(Date.now() + 25 * 86_400_000),
        },
      });

      // Página publicada com o bloco de chamadas — ver o cabeçalho do arquivo.
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
          type: 'CALL_FOR_PROPOSALS',
          content: { title: 'Chamadas abertas' },
          displayOrder: 10,
          isVisible: true,
        },
      });
    });

    const organizer = await signUpVia(api, `Organizadora das Chamadas ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });

    const visitor = await signUpVia(api, `Proponente de Fora ${RUN_ID}`);
    visitorEmail = visitor.email;
  } finally {
    await api.dispose();
  }
});

const callsUrl = () => `/t/${slug}/administracao/eventos/${eventId}/chamadas`;
const publicEventUrl = () => `/t/${slug}/eventos/${EVENT_SLUG}`;
const publicCallUrl = () => `/t/${slug}/eventos/${EVENT_SLUG}/chamada/${CALL_SLUG}`;

/** O id da chamada pelo slug — o E2E não guarda id em memória (o banco é a memória). */
async function callIdBySlug(): Promise<string> {
  const call = await e2eDb.callForProposals.findFirstOrThrow({
    where: { eventId, slug: CALL_SLUG },
    select: { id: true },
  });

  return call.id;
}

test.describe('chamadas de propostas', () => {
  test('a organização cria e publica a chamada (E18)', async ({ page }) => {
    await signInAs(page, organizerEmail);

    // ── O caminho até o painel começa na tela do EVENTO ───────────────────────
    await page.goto(`/t/${slug}/administracao/eventos/${eventId}`);
    await page.getByTestId('calls-link').click();

    await expect(page.getByTestId('calls-panel')).toBeVisible();
    await expect(page.getByTestId('calls-empty')).toBeVisible();

    // ── Criar a chamada ───────────────────────────────────────────────────────
    await page.getByTestId('create-call-section').locator('summary').click();

    const form = page.getByTestId('create-call');
    await form.getByLabel('Tipo de proposta').selectOption('MINICOURSE');
    await form.getByLabel('Identificador na URL').fill(CALL_SLUG);
    await form.getByLabel('Título da chamada').fill(CALL_TITLE);
    await form.getByLabel('Resumo').fill('Quatro horas de mão na massa, com turma reduzida.');
    /**
     * A janela abre ONTEM, e não hoje: a hora digitada é interpretada no FUSO DO EVENTO
     * (America/Bahia, o mesmo do runner) — e "hoje às 8h", numa execução que roda às 7h,
     * deixa a chamada AGENDADA, não aberta. O cenário mede a chamada aberta.
     */
    await form.getByLabel('Abre em').fill(localInput(-1, 8));
    await form.getByLabel('Encerra em').fill(localInput(20, 23));
    await form.getByTestId('admin-submit').click();

    await expect(form.getByTestId('create-call-feedback')).toContainText(/criad/i, {
      timeout: 30_000,
    });

    /**
     * O rascunho NÃO está no ar: a chamada nasce despublicada, e o painel diz isso.
     * Criar e publicar são atos separados de propósito — quem está escrevendo o texto
     * precisa poder salvar sem abrir a chamada.
     */
    const row = page.locator(`[data-testid="call-row-${await callIdBySlug()}"]`);
    await expect(row).toHaveAttribute('data-call-state', 'DRAFT');

    await row.getByRole('button', { name: 'Publicar' }).click();
    await expect(row).toHaveAttribute('data-call-state', 'OPEN', { timeout: 30_000 });
    await expect(row).toContainText('Aberta');

    // O endereço público aparece no painel: é o link que a organização divulga.
    await expect(row.getByTestId('call-public-link-' + (await callIdBySlug()))).toContainText(
      `/chamada/${CALL_SLUG}`,
    );
  });

  test('o bloco da página pública mostra a chamada aberta e leva ao formulário', async ({ page }) => {
    await page.goto(publicEventUrl());

    const calls = page.getByTestId('event-calls');
    await expect(calls).toBeVisible({ timeout: 30_000 });
    await expect(calls).toContainText(CALL_TITLE);

    // O cartão da chamada traz o prazo CALCULADO pelo servidor, não texto do organizador.
    await expect(calls).toContainText('Minicurso');

    await calls.getByRole('link', { name: /Enviar proposta/ }).click();

    await expect(page).toHaveURL(new RegExp(`/chamada/${CALL_SLUG}$`));
    await expect(page.getByTestId('call-title')).toHaveText(CALL_TITLE);

    /**
     * O visitante ANÔNIMO lê a chamada e não encontra o formulário: a página diz que é
     * preciso entrar (ou criar conta) e leva de volta para esta chamada. É a fronteira
     * pública × autenticada — o formulário só existe para quem tem sessão.
     */
    await expect(page.getByTestId('call-login-required')).toBeVisible();
    await expect(page.getByTestId('call-signup-link')).toBeVisible();
    await expect(page.getByTestId('proposal-form')).toHaveCount(0);
  });

  test('a pessoa de fora envia a proposta e recebe o protocolo (E18)', async ({ page }) => {
    await signInAs(page, visitorEmail);

    await page.goto(publicCallUrl());

    const form = page.getByTestId('proposal-form');
    await expect(form).toBeVisible();

    await form.getByLabel('Título').fill(PROPOSAL_TITLE);
    await form.getByLabel('Resumo').fill(PROPOSAL_ABSTRACT);
    await form.getByLabel('Palavras-chave').fill('dados abertos, planilhas, educação');
    await form.getByTestId('proposal-workloadMinutes').fill(String(WORKLOAD_MINUTES));
    await form.getByTestId('proposal-targetAudience').fill('Servidores públicos e estudantes');
    await page.getByTestId('proposal-submit').click();

    const received = page.getByTestId('proposal-received');
    await expect(received).toBeVisible({ timeout: 30_000 });
    await expect(received.getByTestId('proposal-protocol')).toHaveText(/^\d{4}-[A-Z0-9]{4}$/);

    /**
     * A proposta é uma SUBMISSION: ela passa a existir para o comitê, com os campos do
     * tipo gravados e o vínculo de participante criado pela própria proposta.
     */
    const submission = await e2eDb.submission.findFirstOrThrow({
      where: { eventId, title: PROPOSAL_TITLE },
      select: { id: true, status: true, callId: true, proposalData: true, trackId: true },
    });

    expect(submission.status).toBe('SUBMITTED');
    expect(submission.callId).toBe(await callIdBySlug());
    expect(submission.trackId).toBeNull();
    expect(submission.proposalData).toMatchObject({ workloadMinutes: WORKLOAD_MINUTES });

    const membership = await e2eDb.userTenantProfile.findFirst({
      where: { tenantId, userId: (await e2eDb.user.findFirstOrThrow({ where: { email: visitorEmail } })).id },
      select: { kind: true, status: true },
    });

    expect(membership?.status).toBe('ACTIVE');
    expect(membership?.kind).toBe('PARTICIPANT');
  });

  test('a organização aceita a proposta: cria a atividade e envia o convite (E18)', async ({ page }) => {
    await signInAs(page, organizerEmail);

    /**
     * O caminho começa no PAINEL DA CHAMADA, e não na lista do comitê: proposta de
     * minicurso não tem trilha, então a lista por trilha não é um caminho para ela.
     */
    await page.goto(callsUrl());

    const section = page.getByTestId(`call-proposals-${await callIdBySlug()}`);
    await section.locator('summary').click();

    await expect(section).toContainText(PROPOSAL_TITLE);
    await section.getByRole('link', { name: /Analisar e aceitar/ }).click();

    /**
     * O painel do comitê é onde a decisão acontece. O protocolo de aceite aparece
     * ABAIXO dele, e só para proposta que veio de chamada.
     */
    const acceptance = page.getByTestId('acceptance-form');
    await expect(acceptance).toBeVisible({ timeout: 30_000 });

    // Tipo e carga vêm da proposta; a agenda é da organização.
    await expect(acceptance.locator('#activityType')).toHaveValue('MINI_COURSE');
    await expect(acceptance).toContainText(`${WORKLOAD_MINUTES} min`);

    await acceptance.getByTestId('acceptance-starts-at').fill(localInput(31, 9));
    await acceptance.getByTestId('acceptance-ends-at').fill(localInput(31, 13));
    await page.getByTestId('acceptance-submit').click();

    /**
     * O retorno do aceite é visível de UMA das duas formas, e as duas dizem o que
     * aconteceu: o bloco de sucesso do formulário (quando o cliente mantém o estado) ou o
     * aviso de "já decidida" (quando a página é re-renderizada pelo servidor com o status
     * novo). O que não pode existir é o silêncio — o defeito que a primeira versão tinha,
     * em que o painel desaparecia sem confirmação nenhuma (armadilha 76).
     */
    const recorded = page.getByTestId(/^acceptance-(recorded|decided)$/);
    await expect(recorded).toBeVisible({ timeout: 30_000 });
    await expect(recorded).toContainText(/aceita/i);

    // Quando o bloco de sucesso é o que aparece, ele diz o que foi criado e enviado.
    if (await page.getByTestId('acceptance-recorded').isVisible()) {
      await expect(page.getByTestId('acceptance-recorded')).toContainText(/Atividade criada/i);
      await expect(page.getByTestId('acceptance-recorded')).toContainText(
        /Convite de palestrante enviado/i,
      );
      await expect(page.getByTestId('acceptance-invite-token')).toContainText(
        '/palestrante/convite?codigo=',
      );
    }

    // ── O que ficou gravado ──────────────────────────────────────────────────
    const submission = await e2eDb.submission.findFirstOrThrow({
      where: { eventId, title: PROPOSAL_TITLE },
      select: { id: true, status: true, decisionById: true },
    });

    // A decisão é a do motor do comitê (FASE 16) — não uma escrita paralela.
    expect(submission.status).toBe('ACCEPTED');
    expect(submission.decisionById).toBeTruthy();

    const activity = await e2eDb.activity.findFirstOrThrow({
      where: { eventId, title: { contains: PROPOSAL_TITLE } },
      select: { id: true, type: true, workloadMinutes: true, requiresRegistration: true },
    });

    expect(activity.type).toBe('MINI_COURSE');
    expect(activity.workloadMinutes).toBe(WORKLOAD_MINUTES);

    // O convite saiu pelo outbox (a dívida E25 foi quitada nesta fase).
    const email = await e2eDb.emailMessage.findFirst({
      where: { tenantId, template: 'SPEAKER_INVITATION' },
      orderBy: { createdAt: 'desc' },
      select: { to: true, payload: true },
    });

    expect(email?.to).toBe(visitorEmail);
    expect(String((email?.payload as Record<string, unknown>)?.inviteUrl)).toContain(
      '/palestrante/convite?codigo=',
    );

    // ── E a atividade aparece na programação do painel ───────────────────────
    await page.goto(`/t/${slug}/administracao/eventos/${eventId}`);
    await expect(page.getByTestId('activity-list')).toContainText(PROPOSAL_TITLE, {
      timeout: 30_000,
    });
  });
});

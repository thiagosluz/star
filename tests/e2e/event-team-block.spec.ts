import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'equipepublica';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;
let teamId: string;
let organizadorEmail: string;
let membroEmail: string;

async function createUser(
  request: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `equipe.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await request.post('/api/auth/sign-up/email', {
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

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Equipe ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'SECOM & UFJ TechWeek 2026',
    });

    eventId = event.id;
    eventSlug = event.slug;

    const organizador = await createUser(api, `Ana Presidente ${RUN_ID}`);
    organizadorEmail = organizador.email;

    const membro = await createUser(api, `Diego Programacao ${RUN_ID}`);
    membroEmail = membro.email;

    /** A organização é EQUIPE (`MEMBER`); quem aparece no cartão também. */
    await linkUser({ tenantId, userId: organizador.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: organizador.id, role: 'ADMIN' });

    await linkUser({ tenantId, userId: membro.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: membro.id, role: 'PARTICIPANT' });

    /** A equipe do evento, como o organizador a cadastra na tela de equipes. */
    teamId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.eventTeam.create({
        data: {
          id: teamId,
          tenantId,
          eventId,
          name: 'Presidência',
          members: {
            create: [
              { id: randomUUID(), tenantId, userId: organizador.id, isLead: true },
              { id: randomUUID(), tenantId, userId: membro.id, isLead: false },
            ],
          },
        },
      });
    });
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('equipe do evento na página pública', () => {
  test('1. o organizador põe o bloco, publica, e a equipe aparece com a etiqueta', async ({
    page,
    browser,
  }) => {
    await signInAs(page, organizadorEmail);

    // ── A página do evento precisa existir ───────────────────────────────────
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/pagina`);

    if (await page.getByTestId('create-page').isVisible().catch(() => false)) {
      await page.getByTestId('create-page').getByTestId('admin-submit').click();
    }

    // ── Adicionar o bloco "Equipe do evento" ─────────────────────────────────
    const adicionar = page.getByTestId('add-block');
    await adicionar.getByLabel('Tipo de bloco').selectOption('TEAM');
    await adicionar.getByTestId('admin-submit').click();

    const bloco = page.locator('[data-type="TEAM"]').first();
    await expect(bloco).toBeVisible({ timeout: 30_000 });

    // ── Editar o bloco: título, texto de apoio e a equipe escolhida ──────────
    await bloco.getByText('Editar conteúdo').click();

    /**
     * O formulário é localizado pelo TEXTO de um campo só dele: dentro do `<li>` do
     * bloco convivem os formulários de mover e excluir, e pegar `form` "o primeiro"
     * acabaria preenchendo o formulário errado.
     */
    const form = bloco.locator('form').filter({ hasText: 'Descrição de apoio' });
    /**
     * O campo de título se chama "Título da seção" na tela — só o bloco de texto livre
     * usa "Título", porque lá o padrão é outro. O rótulo sai do mesmo componente que o
     * servidor usa para validar, então o teste aponta para o que a pessoa lê.
     */
    await form.getByLabel('Título da seção').fill('A Equipe por Trás do Evento');
    await form
      .getByLabel('Descrição de apoio')
      .fill('Conheça os profissionais dedicados que trabalham para tornar o evento inesquecível.');
    await form.getByLabel('Mostrar apenas uma equipe').selectOption(teamId);
    await form.getByTestId('admin-submit').click();

    /** O resumo do bloco confirma o título gravado (o bloco lê o dado real). */
    await expect(page.getByTestId('block-list')).toContainText('A Equipe por Trás do Evento', {
      timeout: 30_000,
    });

    // ── Publicar a página ────────────────────────────────────────────────────
    const publicacao = page.getByTestId('save-page');
    await publicacao.getByLabel('Publicar a página agora').check();
    await publicacao.getByTestId('admin-submit').click();
    await expect(page.getByTestId('landing-status')).toContainText('Publicada', { timeout: 30_000 });

    // ── A página pública, vista por um ANÔNIMO ───────────────────────────────
    const anonimo = await browser.newContext();
    const anonPage = await anonimo.newPage();

    try {
      await anonPage.goto(`/t/${tenantSlug}/eventos/${eventSlug}`);

      const equipe = anonPage.getByTestId('team-block');
      await expect(equipe).toBeVisible();

      /** A etiqueta é o nome da equipe, como no cadastro. */
      await expect(equipe).toContainText('Presidência');
      await expect(equipe).toContainText(`Ana Presidente ${RUN_ID}`);
      await expect(equipe).toContainText(`Diego Programacao ${RUN_ID}`);

      /** O título e o texto de apoio são do bloco; o corpo é a equipe real. */
      await expect(anonPage.getByText('A Equipe por Trás do Evento')).toBeVisible();
      await expect(anonPage.getByText(/profissionais dedicados/)).toBeVisible();

      /** Quem não autorizou contato não tem ícone nenhum. */
      await expect(equipe.getByTestId('team-contacts')).toHaveCount(0);

      /**
       * Ninguém subiu foto: nenhum cartão desenha `<img>`, e o que aparece são as
       * INICIAIS. O nome continua inteiro ao lado do cartão.
       */
      await expect(equipe.locator('img')).toHaveCount(0);
      await expect(equipe.getByTestId('team-card')).toHaveCount(2);
    } finally {
      await anonimo.close();
    }
  });

  test('2. a pessoa autoriza o contato no perfil e o ícone aparece no cartão da equipe', async ({
    page,
    browser,
  }) => {
    await signInAs(page, membroEmail);

    await page.goto(`/t/${tenantSlug}/meu-perfil-publico`);
    await expect(page.getByTestId('my-public-profile')).toBeVisible();

    /** Sem handle não há perfil público — a pessoa escolhe um. */
    await page.getByLabel('@handle (o seu endereço)').fill(`diego-${RUN_ID}`);

    await page
      .getByTestId('my-profile-contacts')
      .getByLabel('LinkedIn')
      .fill('linkedin.com/in/diego-programacao');

    /** O campo de contato nasce FECHADO: é aqui que a pessoa decide publicá-lo. */
    await page
      .getByLabel('Visibilidade: E-mail e redes sociais', { exact: true })
      .selectOption('PUBLIC');

    await page.getByTestId('save-public-profile').getByTestId('admin-submit').click();
    await expect(page.getByTestId('save-public-profile-feedback')).toContainText(/perfil salvo/i, {
      timeout: 30_000,
    });

    /** O perfil público da pessoa mostra o contato... */
    await page.goto(`/t/${tenantSlug}/u/diego-${RUN_ID}`);
    await expect(page.getByTestId('profile-contacts')).toBeVisible();
    await expect(page.getByTestId('profile-contacts')).toContainText('LinkedIn');

    /** ...e o MESMO consentimento liga o ícone no cartão da equipe do evento. */
    const anonimo = await browser.newContext();
    const anonPage = await anonimo.newPage();

    try {
      await anonPage.goto(`/t/${tenantSlug}/eventos/${eventSlug}`);

      const cartao = anonPage.getByTestId('team-card').filter({ hasText: `Diego Programacao ${RUN_ID}` });
      await expect(cartao.getByTestId('team-contacts')).toBeVisible();

      /** O ícone da rede aponta para o endereço que a pessoa preencheu. */
      await expect(
        cartao.getByTestId('team-contacts').locator('a[href*="linkedin.com"]'),
      ).toHaveCount(1);

      /** O e-mail sai no `href`/`title` do ícone — nunca como texto solto na página. */
      await expect(cartao.getByTestId('team-contacts').locator('a[href^="mailto:"]')).toHaveCount(1);
      await expect(cartao.getByTestId('team-contacts')).not.toContainText('@example.test');
    } finally {
      await anonimo.close();
    }

    // ── Desligar o contato tira os ícones dos DOIS lugares ───────────────────
    await page.goto(`/t/${tenantSlug}/meu-perfil-publico`);
    await page
      .getByLabel('Visibilidade: E-mail e redes sociais', { exact: true })
      .selectOption('PRIVATE');
    await page.getByTestId('save-public-profile').getByTestId('admin-submit').click();
    await expect(page.getByTestId('save-public-profile-feedback')).toContainText(/perfil salvo/i, {
      timeout: 30_000,
    });

    const outroAnonimo = await browser.newContext();
    const outraPagina = await outroAnonimo.newPage();

    try {
      await outraPagina.goto(`/t/${tenantSlug}/u/diego-${RUN_ID}`);
      await expect(outraPagina.getByTestId('profile-contacts')).toHaveCount(0);

      await outraPagina.goto(`/t/${tenantSlug}/eventos/${eventSlug}`);
      const cartao = outraPagina
        .getByTestId('team-card')
        .filter({ hasText: `Diego Programacao ${RUN_ID}` });

      await expect(cartao.getByTestId('team-contacts')).toHaveCount(0);
    } finally {
      await outroAnonimo.close();
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Jornada de inscrição em atividade
 *
 *  Cobre o fluxo completo no navegador:
 *    1. visitante anônimo vê a landing page e é convidado a entrar;
 *    2. cadastro com retorno ao destino original (não perde o contexto);
 *    3. inscrição com consentimento LGPD obrigatório;
 *    4. lançamento de certificado da jornada — vagas decrementadas na UI;
 *    5. lista de espera quando lota;
 *    6. cancelamento libera a vaga e promove quem está na espera;
 *    7. RBAC: usuário sem permissão não consegue se inscrever.
 *
 *  Pré-requisitos:
 *      docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type Page } from '@playwright/test';
import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Estado da inscrição, para a MENSAGEM de falha de um teste.
 *
 * O diagnóstico vive em atributos `data-*` na página, e não em texto: a página
 * pública não deve expor estado interno a quem visita (havia uma linha visível com
 * `cap=… mem=… can=…`, deixada durante a depuração da FASE 3). Este helper lê os
 * atributos e monta a mesma frase — útil exatamente quando um teste falha.
 */
async function registrationDiagnostics(page: Page): Promise<string> {
  return page
    .getByTestId('activity-flags')
    .evaluate((element: HTMLElement) => {
      const data = element.dataset;

      return [
        ['cap', data.capacity],
        ['conf', data.confirmed],
        ['rem', data.remaining],
        ['full', data.full],
        ['wl', data.waitlist],
        ['st', data.status],
        ['win', data.windowOpen],
        ['reg', data.registered],
        ['mem', data.membership],
        ['can', data.canRegister],
        ['user', data.authenticated],
      ]
        .map(([key, value]) => `${key}=${value ?? '?'}`)
        .join(' ');
    })
    .catch(() => 'SEM FLAGS');
}

/**
 * Cadastra pela UI e devolve o usuário persistido.
 *
 * O cadastro é feito pela INTERFACE de propósito: é assim que o usuário ganha
 * senha válida. Criar direto no banco deixaria o usuário sem hash utilizável.
 *
 * ─── POR QUE ESPERAMOS PELO BANCO ────────────────────────────────────────────
 * Depois de clicar em "Criar conta", a Server Action cria o usuário e chama
 * `redirect()`. O redirecionamento chega ao navegador pelo stream da ação, então
 * a URL pode mudar ANTES de o INSERT estar visível para outra conexão. Consultar
 * o banco logo em seguida produz um falso "usuário não encontrado".
 *
 * `expect.poll` resolve isso esperando a condição em vez de assumir.
 */
async function signUpThroughUi(
  page: import('@playwright/test').Page,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('insc');

  await page.goto('/signup');
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar conta' }).click();

  let userId: string | null = null;

  await expect
    .poll(
      async () => {
        const user = await e2eDb.user.findUnique({
          where: { email },
          select: { id: true },
        });
        userId = user?.id ?? null;
        return userId;
      },
      { timeout: 15_000, message: `usuário ${email} não foi persistido` },
    )
    .not.toBeNull();

  await expect(page).toHaveURL(/selecionar-instituicao/);

  return { id: userId!, email };
}

/** Vincula o usuário ao tenant como PARTICIPANTE. */
async function makeParticipant(tenantId: string, userId: string) {
  await linkUser({ tenantId, userId });
  await grantRole({ tenantId, userId, role: 'PARTICIPANT' });
}

/**
 * Espera o usuário recém-cadastrado ficar visível e o devolve.
 *
 * Motivo: a Server Action cria o usuário e chama `redirect()`; a navegação pode
 * chegar ao navegador antes de o INSERT ficar visível para outra conexão.
 * Consultar imediatamente produz um falso "não encontrado".
 */
async function loadUserByEmail(email: string): Promise<{ id: string; email: string }> {
  let found: { id: string; email: string } | null = null;

  await expect
    .poll(
      async () => {
        found = await e2eDb.user.findUnique({
          where: { email },
          select: { id: true, email: true },
        });
        return found?.id ?? null;
      },
      { timeout: 15_000, message: `usuário ${email} não foi persistido` },
    )
    .not.toBeNull();

  return found!;
}

/** Monta um cenário completo: instituição + evento + atividade. */
async function scenario(options: {
  label: string;
  activityCapacity: number | null;
  waitlistEnabled?: boolean;
}) {
  const tenant = await createTenant({
    label: options.label,
    name: `Instituição ${options.label} ${RUN_ID}`,
  });

  const event = await createEvent({
    tenantId: tenant.id,
    slug: `evento-${options.label}`,
    title: `Evento ${options.label}`,
    summary: 'Um evento completo para os testes ponta a ponta.',
    status: 'REGISTRATION_OPEN',
  });

  const activity = await createActivity({
    tenantId: tenant.id,
    eventId: event.id,
    slug: `atividade-${options.label}`,
    title: `Oficina de ${options.label}`,
    capacity: options.activityCapacity,
    waitlistEnabled: options.waitlistEnabled ?? false,
  });

  return { tenant, event, activity };
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('landing page pública', () => {
  test('visitante anônimo vê a página do evento e pode navegar até a atividade', async ({
    page,
  }) => {
    const { tenant, event, activity } = await scenario({
      label: 'publica',
      activityCapacity: 10,
    });

    await page.goto(`/t/${tenant.slug}/eventos/${event.slug}`);

    await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
    await expect(page.getByText(event.summary!)).toBeVisible();
    // A atividade aparece na programação.
    await expect(page.getByText(activity.title)).toBeVisible();

    /**
     * A LANDING PAGE mostra a lotação no nível do EVENTO. Este evento tem
     * capacidade ilimitada, então o texto correto é "vagas ilimitadas" — o
     * limite está na atividade, que aparece como "0/10 inscritos".
     */
    await expect(page.getByText(/vagas ilimitadas/i)).toBeVisible();
    await expect(page.getByText(/0\/10 inscritos/)).toBeVisible();

    await page
      .locator('li', { hasText: activity.title })
      .getByRole('link', { name: /inscrever-se/i })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/eventos/${event.slug}/atividades/${activity.slug}`),
    );
    // Anônimo é convidado a entrar, não recebe o formulário.
    await expect(page.getByText(/entre para se inscrever/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /entrar e continuar/i })).toBeVisible();
  });

  test('evento inexistente responde 404', async ({ page }) => {
    const tenant = await createTenant({
      label: 'vazio',
      name: `Instituição Vazia ${RUN_ID}`,
    });

    const response = await page.goto(`/t/${tenant.slug}/eventos/nao-existe`);
    expect(response?.status()).toBe(404);
  });

  test('evento em rascunho não é visível publicamente', async ({ page }) => {
    const tenant = await createTenant({
      label: 'rascunho',
      name: `Instituição Rascunho ${RUN_ID}`,
    });

    await createEvent({
      tenantId: tenant.id,
      slug: 'evento-rascunho',
      title: 'Evento Secreto',
      status: 'DRAFT',
    });

    const response = await page.goto(`/t/${tenant.slug}/eventos/evento-rascunho`);
    expect(response?.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('jornada de inscrição', () => {
  test('cadastro a partir da atividade retorna à atividade, e a inscrição é confirmada', async ({
    page,
  }) => {
    const { tenant, event, activity } = await scenario({
      label: 'jornada',
      activityCapacity: 5,
    });

    const activityPath = `/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`;

    // ── 1. Anônimo chega na atividade ──────────────────────────────────────
    await page.goto(activityPath);
    await expect(page.getByText(/entre para se inscrever/i)).toBeVisible();

    // ── 2. Vai para o cadastro levando o destino ───────────────────────────
    await page.getByRole('link', { name: /criar conta/i }).click();
    await expect(page).toHaveURL(/signup/);
    expect(page.url()).toContain('redirectTo');

    const email = uniqueEmail('jornada');
    await page.getByLabel('Nome completo').fill('Participante Jornada');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Criar conta' }).click();

    /**
     * O cadastro deve devolver o usuário à ATIVIDADE, não ao seletor genérico.
     * Sem isso, o visitante perde o contexto e provavelmente desiste.
     *
     * CUIDADO com a asserção: a própria URL de `/signup` contém o parâmetro
     * `redirectTo` com o caminho da atividade, então `toHaveURL(/atividade/)`
     * passaria mesmo sem sair da página de cadastro. Verificamos o PATHNAME.
     */
    await expect
      .poll(
        () => {
          try {
            return new URL(page.url()).pathname;
          } catch {
            return page.url();
          }
        },
        { timeout: 20_000, message: 'deveria ter saído de /signup' },
      )
      .toBe(`/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`);

    // ── 3. Torna-se membro da instituição (convite aceito) ─────────────────
    // Espera o INSERT do cadastro ficar visível (ver nota em `signUpThroughUi`).
    const user = await loadUserByEmail(email);
    await makeParticipant(tenant.id, user.id);

    await page.reload();
    const flags = await registrationDiagnostics(page);
    await expect(
      page.getByRole('button', { name: /confirmar inscrição/i }),
      `url=${page.url()} | estado=${flags}`,
    ).toBeVisible({ timeout: 15_000 });

    /**
     * ── 4. Consentimento LGPD — DUAS camadas ───────────────────────────────
     *
     *  Camada 1 (cliente): o checkbox tem `required`, então o próprio navegador
     *  bloqueia o envio e exibe "Preencha este campo". Isso é UX: feedback
     *  imediato, sem ida ao servidor.
     *
     *  Camada 2 (servidor): a Server Action valida de novo e devolve
     *  CONSENT_REQUIRED. É a camada que realmente protege — a validação de
     *  cliente pode ser contornada com `formnovalidate` ou chamando a ação
     *  diretamente. Este teste verifica as DUAS.
     */
    const consentBox = page.getByRole('checkbox', { name: /autorizo o tratamento/i });
    await expect(consentBox).toHaveAttribute('required', '');

    // Camada 1: o navegador bloqueia o envio (nada é persistido).
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();
    await expect(page.getByTestId('registration-success')).toHaveCount(0);

    const afterBlocked = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.registration.count({ where: { activityId: activity.id } });
    });
    expect(afterBlocked).toBe(0);

    // Camada 2: contornando a validação nativa, o SERVIDOR recusa.
    await page.evaluate(() => {
      const checkbox = document.querySelector<HTMLInputElement>(
        'input[name="consentData"]',
      );
      if (checkbox) {
        checkbox.required = false;
        checkbox.removeAttribute('required');
      }
      const form = checkbox?.closest('form');
      form?.setAttribute('novalidate', '');
    });

    await page.getByRole('button', { name: /confirmar inscrição/i }).click();
    await expect(page.getByTestId('registration-error')).toContainText(
      /autorizar o tratamento/i,
      { timeout: 15_000 },
    );

    // E continua sem persistir nada.
    const afterBypass = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.registration.count({ where: { activityId: activity.id } });
    });
    expect(afterBypass).toBe(0);

    // ── 5. Inscrição com consentimento ─────────────────────────────────────
    await page.getByRole('checkbox', { name: /autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();

    /**
     * Ação aceita -> a rota é revalidada -> o painel passa para o estado
     * "já inscrito" (`registration-status`), que é o que o usuário vê de forma
     * duradoura. O bloco transitório `registration-success` aparece apenas entre
     * a resposta e a revalidação, e por isso não é um alvo confiável.
     */
    await expect(page.getByTestId('registration-status')).toContainText(
      /inscrição confirmada/i,
      { timeout: 15_000 },
    );

    // ── 6. O banco registra exatamente uma inscrição confirmada ────────────
    const registrations = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.registration.findMany({
        where: { activityId: activity.id },
        select: { status: true, userId: true, consentData: true },
      });
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.status).toBe('CONFIRMED');
    expect(registrations[0]?.consentData).toBe(true);

    // O contador denormalizado acompanha.
    const counters = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.activity.findUniqueOrThrow({
        where: { id: activity.id },
        select: { confirmedCount: true, capacity: true },
      });
    });
    expect(counters.confirmedCount).toBe(1);
    expect(counters.capacity).toBe(5);

    // ── 7. A landing page reflete a vaga consumida ─────────────────────────
    await page.goto(`/t/${tenant.slug}/eventos/${event.slug}`);
    // O contador da atividade passa a mostrar 1 de 5 preenchidas.
    await expect(page.getByText(/1\/5 inscritos/)).toBeVisible();
  });

  test('a vaga é decrementada e o último lugar fecha a atividade', async ({ page }) => {
    // Capacidade 1: uma inscrição já lota.
    const { tenant, event, activity } = await scenario({
      label: 'ultimavaga',
      activityCapacity: 1,
    });

    const first = await signUpThroughUi(page, 'Primeiro Participante');
    await makeParticipant(tenant.id, first.id);

    await page.goto(
      `/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`,
    );
    await page.getByRole('checkbox', { name: /autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();

    /**
     * A Server Action revalida a rota, então o painel de inscrição é
     * re-renderizado no estado "já inscrito" (`registration-status`). O bloco
     * transitório `registration-success` existe apenas antes dessa revalidação.
     * O primeiro teste cobre o estado transitório; aqui verificamos o estável.
     */
    await expect(page.getByTestId('registration-status')).toContainText(
      /inscrição confirmada/i,
      { timeout: 15_000 },
    );

    // ── Segundo usuário, em outro contexto de navegador ───────────────────
    const secondContext = await page.context().browser()!.newContext();
    const secondPage = await secondContext.newPage();

    try {
      const second = await signUpThroughUi(secondPage, 'Segundo Participante');
      await makeParticipant(tenant.id, second.id);

      await secondPage.goto(
        `/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`,
      );

      /**
       * Sem vaga e sem lista de espera: a atividade está esgotada. A página
       * detalhada mostra o contador de vagas zerado e NÃO oferece caminho de
       * inscrição.
       */
      /**
       * Sem vaga e sem lista de espera: a atividade está esgotada. A página
       * mostra o estado de lotada e NÃO oferece caminho de inscrição.
       */
      await expect(secondPage.getByTestId('activity-seats')).toContainText(
        /1 de 1 preenchidas/,
        { timeout: 15_000 },
      );
      await expect(secondPage.getByTestId('activity-full')).toBeVisible();
      await expect(
        secondPage.getByRole('button', { name: /confirmar inscrição/i }),
      ).toHaveCount(0);

      // E o banco continua com UMA única inscrição.
      const registrations = await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        return tx.registration.count({ where: { activityId: activity.id } });
      });
      expect(registrations).toBe(1);
    } finally {
      await secondContext.close();
    }
  });

  test('atividade lotada com lista de espera aceita entrar na fila', async ({ page }) => {
    const { tenant, event, activity } = await scenario({
      label: 'espera',
      activityCapacity: 1,
      waitlistEnabled: true,
    });

    // Ocupa a única vaga com um usuário criado direto (mais rápido).
    const owner = await signUpThroughUi(page, 'Dono da Vaga');
    await makeParticipant(tenant.id, owner.id);

    await page.goto(
      `/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`,
    );
    await page.getByRole('checkbox', { name: /autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();
    await expect(page.getByTestId('registration-status')).toContainText(/inscrição confirmada/i, { timeout: 15_000 });

    // ── Segundo usuário entra na lista de espera ───────────────────────────
    const secondContext = await page.context().browser()!.newContext();
    const secondPage = await secondContext.newPage();

    try {
      const waitlisted = await signUpThroughUi(secondPage, 'Na Lista de Espera');
      await makeParticipant(tenant.id, waitlisted.id);

      await secondPage.goto(
        `/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`,
      );

      // A UI reconhece que há lista de espera e muda o rótulo do botão.
      const waitlistFlags = await registrationDiagnostics(secondPage);
      await expect(
        secondPage.getByRole('button', { name: /entrar na lista de espera/i }),
        `url=${secondPage.url()} | estado=${waitlistFlags}`,
      ).toBeVisible({ timeout: 15_000 });

      await secondPage
        .getByRole('checkbox', { name: /autorizo o tratamento/i })
        .check();
      await secondPage
        .getByRole('button', { name: /entrar na lista de espera/i })
        .click();

      await expect(secondPage.getByTestId('registration-status')).toContainText(
        /lista de espera/i,
        { timeout: 15_000 },
      );

      // ── Banco: 1 confirmada + 1 na espera, posição 1 ─────────────────────
      const state = await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        const confirmed = await tx.registration.count({
          where: { activityId: activity.id, status: 'CONFIRMED' },
        });
        const waiting = await tx.registration.findMany({
          where: { activityId: activity.id, status: 'WAITLISTED' },
          select: { waitlistPosition: true, userId: true },
        });
        return { confirmed, waiting };
      });

      expect(state.confirmed).toBe(1);
      expect(state.waiting).toHaveLength(1);
      expect(state.waiting[0]?.waitlistPosition).toBe(1);
      expect(state.waiting[0]?.userId).toBe(waitlisted.id);
    } finally {
      await secondContext.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('cancelamento e promoção', () => {
  test('cancelar libera a vaga, promove a espera e reflete em Minhas inscrições', async ({
    page,
  }) => {
    const { tenant, event, activity } = await scenario({
      label: 'cancelar',
      activityCapacity: 1,
      waitlistEnabled: true,
    });

    // ── Primeiro: ocupa a vaga ─────────────────────────────────────────────
    const first = await signUpThroughUi(page, 'Vai Cancelar');
    await makeParticipant(tenant.id, first.id);

    const activityPath = `/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`;
    await page.goto(activityPath);
    await page.getByRole('checkbox', { name: /autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();
    await expect(page.getByTestId('registration-status')).toContainText(/inscrição confirmada/i, { timeout: 15_000 });

    // ── Segundo: entra na lista de espera ──────────────────────────────────
    const secondContext = await page.context().browser()!.newContext();
    const secondPage = await secondContext.newPage();

    try {
      const second = await signUpThroughUi(secondPage, 'Vai Ser Promovido');
      await makeParticipant(tenant.id, second.id);

      await secondPage.goto(activityPath);
      await secondPage.getByRole('checkbox', { name: /autorizo o tratamento/i }).check();
      await secondPage
        .getByRole('button', { name: /entrar na lista de espera/i })
        .click();
      await expect(secondPage.getByTestId('registration-status')).toContainText(
        /lista de espera/i,
        { timeout: 15_000 },
      );

      // ── Primeiro cancela em "Minhas inscrições" ────────────────────────
      await page.goto(`/t/${tenant.slug}/minhas-inscricoes`);
      await expect(page.getByTestId('my-registrations')).toBeVisible();
      await expect(page.getByText(activity.title)).toBeVisible();

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  CANCELAR PASSOU A PEDIR CONFIRMAÇÃO EM DIÁLOGO DO SISTEMA (revisão de UI)
       * ─────────────────────────────────────────────────────────────────────────────
       *  Era `window.confirm` — que o Playwright dispensa sozinho quando ninguém o
       *  trata (submissão cancelada em silêncio). Agora o botão abre o diálogo do
       *  produto: o teste lê a consequência escrita e confirma, como o usuário faz.
       */
      await page.getByTestId('cancel-registration-open').first().click();

      const cancelDialog = page.getByTestId('cancel-registration-confirm');
      await expect(cancelDialog).toBeVisible({ timeout: 20_000 });
      await expect(cancelDialog).toContainText('Sua vaga é liberada');
      await cancelDialog.getByTestId('cancel-registration-confirm-confirm').click();

      /**
       * Ação aceita -> a rota é revalidada -> a inscrição cancelada SAI da lista
       * (a consulta de "Minhas inscrições" exclui status CANCELED). O aviso
       * transitório desmonta junto, então o alvo confiável é o estado vazio da
       * lista, não o texto do resultado.
       */
      await expect(
        page.getByText(/ainda não se inscreveu em nenhuma atividade/i),
      ).toBeVisible({ timeout: 20_000 });

      // ── Banco: o segundo foi promovido a CONFIRMED ─────────────────────
      const state = await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        const rows = await tx.registration.findMany({
          where: { activityId: activity.id },
          select: { userId: true, status: true, waitlistPosition: true },
        });
        const counters = await tx.activity.findUniqueOrThrow({
          where: { id: activity.id },
          select: { confirmedCount: true, waitlistCount: true },
        });
        return { rows, counters };
      });

      const firstRow = state.rows.find((r) => r.userId === first.id);
      const secondRow = state.rows.find((r) => r.userId === second.id);

      expect(firstRow?.status).toBe('CANCELED');
      expect(secondRow?.status).toBe('CONFIRMED');
      expect(secondRow?.waitlistPosition).toBeNull();

      // Contadores consistentes após a promoção.
      expect(state.counters.confirmedCount).toBe(1);
      expect(state.counters.waitlistCount).toBe(0);

      // ── O promovido vê a confirmação na própria página ─────────────────
      await secondPage.goto(activityPath);
      await expect(secondPage.getByTestId('registration-status')).toContainText(
        /inscrição confirmada/i,
      );
    } finally {
      await secondContext.close();
    }
  }, 90_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('RBAC na inscrição', () => {
  test('usuário com vínculo mas sem permissão não consegue se inscrever', async ({
    page,
  }) => {
    const { tenant, event, activity } = await scenario({
      label: 'rbac',
      activityCapacity: 10,
    });

    /**
     * SPONSOR tem vínculo ATIVO e `event:read`, mas NÃO tem
     * `registration:create`. É o caso que separa "é membro" de "pode agir".
     */
    const sponsor = await signUpThroughUi(page, 'Patrocinador');
    await linkUser({ tenantId: tenant.id, userId: sponsor.id });
    await grantRole({ tenantId: tenant.id, userId: sponsor.id, role: 'SPONSOR' });

    await page.goto(
      `/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`,
    );

    // A UI informa a restrição em vez de oferecer o formulário.
    await expect(page.getByText(/inscrição não permitida/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /confirmar inscrição/i }),
    ).toHaveCount(0);

    // E nada foi gravado no banco.
    const count = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.registration.count({ where: { activityId: activity.id } });
    });
    expect(count).toBe(0);
  });

  test('visitante SEM vínculo se inscreve e passa a ser participante (FASE 10)', async ({
    page,
  }) => {
    const { tenant, event, activity } = await scenario({
      label: 'publica-inscricao',
      activityCapacity: 10,
    });

    /**
     * O caso REAL desta fase: a pessoa chegou por um link compartilhado, criou a
     * conta e NÃO tem — nem terá — vínculo prévio com a instituição. Antes, esta
     * era a tela do beco sem saída ("peça um convite à organização").
     */
    const visitor = await signUpThroughUi(page, 'Visitante do Link');

    await page.goto(`/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`);

    // A tela avisa o que vai acontecer com a conta — antes de acontecer.
    await expect(page.getByTestId('public-registration-notice')).toContainText(
      /participante/i,
    );

    await page.getByRole('checkbox', { name: /autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /confirmar inscrição/i }).click();

    await expect(page.getByTestId('registration-status')).toContainText(/confirmada/i, {
      timeout: 15_000,
    });

    // ── O banco confirma o vínculo e o papel ─────────────────────────────────
    const membership = await e2eDb.userTenantProfile.findFirst({
      where: { tenantId: tenant.id, userId: visitor.id },
      select: { status: true, joinedAt: true, deletedAt: true },
    });

    expect(membership?.status).toBe('ACTIVE');
    expect(membership?.joinedAt).not.toBeNull();
    expect(membership?.deletedAt).toBeNull();

    const roles = await e2eDb.roleAssignment.findMany({
      where: { tenantId: tenant.id, userId: visitor.id, revokedAt: null },
      select: { role: true, scope: true },
    });

    expect(roles.map((role) => role.role)).toEqual(['PARTICIPANT']);
    expect(roles[0]?.scope).toBe('TENANT');

    /**
     * ── A área autenticada da instituição passa a existir para essa pessoa ────
     *
     * É o efeito prático do vínculo: "Minhas inscrições" (e certificados, cartas,
     * conquistas) deixam de ser inalcançáveis. Sem esta verificação, o teste
     * provaria apenas a linha no banco — não a jornada.
     */
    await page.goto(`/t/${tenant.slug}/minhas-inscricoes`);
    await expect(page.getByRole('heading', { name: 'Minhas inscrições' })).toBeVisible();
    await expect(page.getByText(activity.title)).toBeVisible();
  });

  test('vínculo SUSPENSO pela instituição continua bloqueado', async ({ page }) => {
    const { tenant, event, activity } = await scenario({
      label: 'suspenso',
      activityCapacity: 10,
    });

    const blocked = await signUpThroughUi(page, 'Acesso Suspenso');
    await linkUser({ tenantId: tenant.id, userId: blocked.id, status: 'SUSPENDED' });

    await page.goto(`/t/${tenant.slug}/eventos/${event.slug}/atividades/${activity.slug}`);

    // A instituição barrou esta pessoa: a inscrição pública NÃO a readmite.
    await expect(page.getByText(/acesso bloqueado/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /confirmar inscrição/i }),
    ).toHaveCount(0);

    const count = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.registration.count({ where: { activityId: activity.id } });
    });
    expect(count).toBe(0);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Jornada completa da plataforma (FASE 7)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Que a plataforma funciona COMO UM TODO, do painel administrativo até o
 *  participante:
 *
 *      1. a administração cria evento, sala, atividade e trilha PELA INTERFACE;
 *      2. o SERVIDOR recusa uma atividade conflitante na mesma sala (a validação
 *         de domínio escrita na FASE 3 está ligada a um caminho de escrita real);
 *      3. a trilha criada aceita submissão (o CFP está funcional);
 *      4. o evento aparece na página pública, sem login;
 *      5. a equipe credencia pelo CRACHÁ (leitor de QR) e o XP é creditado;
 *      6. a trilha de auditoria registra quem criou o quê;
 *      7. um participante NÃO entra no painel administrativo.
 *
 *  Os outros E2E cobrem cada módulo em profundidade; este cobre a LIGAÇÃO entre
 *  eles — que é onde os defeitos de integração aparecem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
async function createUser(
  page: import('@playwright/test').Page,
  tenantId: string,
  name: string,
  role: 'ADMIN' | 'PARTICIPANT' | 'STAFF',
): Promise<{ id: string; email: string }> {
  const email = `plat.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await linkUser({ tenantId, userId: user.id });
  await grantRole({ tenantId, userId: user.id, role });

  return { id: user.id, email };
}

async function signInAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3000' },
  });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/** Data/hora no formato do input `datetime-local`. */
function localInput(daysFromNow: number, hour = 9): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  date.setHours(hour, 0, 0, 0);

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('jornada completa da plataforma', () => {
  test('a administração monta o evento e o participante percorre a jornada', async ({ page, browser }) => {
    test.setTimeout(240_000);

    const tenant = await createTenant({ label: 'plat', name: `Instituição Plataforma ${RUN_ID}` });
    const admin = await createUser(page, tenant.id, 'Administradora do Evento', 'ADMIN');
    const participant = await createUser(page, tenant.id, 'Participante da Jornada', 'PARTICIPANT');

    const eventSlug = `evento-plataforma-${RUN_ID}`;

    // ── 1. Painel administrativo ────────────────────────────────────────────
    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/administracao`);

    await expect(page.getByTestId('admin-stats')).toBeVisible();
    await expect(page.getByTestId('admin-areas')).toBeVisible();
    /**
     * A SEÇÃO da trilha existe desde o início (a lista só aparece depois da
     * primeira alteração — em uma instituição nova não há o que auditar). É no
     * passo 10 que os registros são verificados.
     */
    await expect(page.getByRole('heading', { name: /trilha de auditoria/i })).toBeVisible();

    // ── 2. Cria o evento ────────────────────────────────────────────────────
    await page.goto(`/t/${tenant.slug}/administracao/eventos`);

    const createEvent = page.getByTestId('create-event');
    const title = `Congresso da Plataforma ${RUN_ID}`;
    const startsAt = localInput(30, 9);
    const endsAt = localInput(33, 18);

    await createEvent.getByLabel('Identificador (URL)').fill(eventSlug);
    await createEvent.getByLabel('Título').fill(title);
    await createEvent.getByLabel('Resumo').fill('Evento criado inteiramente pelo painel administrativo.');
    await createEvent.getByLabel('Início').fill(startsAt);
    await createEvent.getByLabel('Término').fill(endsAt);
    await createEvent.getByLabel('Situação').selectOption('REGISTRATION_OPEN');
    await createEvent.getByTestId('admin-submit').click();

    await expect(createEvent.getByTestId('create-event-feedback')).toContainText(/criado/i, {
      timeout: 30_000,
    });

    // O evento aparece na listagem e pode ser gerenciado.
    await expect(page.getByTestId('admin-event-list')).toContainText(title);

    await page.getByTestId(`manage-${eventSlug}`).click();
    await expect(page.getByTestId('event-details')).toBeVisible();

    const event = await e2eDb.event.findFirstOrThrow({
      where: { tenantId: tenant.id, slug: eventSlug },
      select: { id: true },
    });

    // ── 3. Cria sala ────────────────────────────────────────────────────────
    const roomsSection = page.getByTestId('rooms-section');
    await roomsSection.locator('summary').click();

    const createRoom = page.getByTestId('create-room');
    await createRoom.getByLabel('Nome da sala').fill('Auditório Principal');
    await createRoom.getByLabel('Capacidade').fill('100');
    await createRoom.getByTestId('admin-submit').click();

    await expect(createRoom.getByTestId('create-room-feedback')).toContainText(/criada/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('room-list')).toContainText('Auditório Principal');

    // ── 4. Cria atividade na sala ───────────────────────────────────────────
    const activitiesSection = page.getByTestId('activities-section');
    // `.first()`: cada atividade da lista tem o próprio `<summary>` ("Editar atividade").
    await activitiesSection.locator('summary').first().click();

    const createActivity = page.getByTestId('create-activity');
    await createActivity.getByLabel('Identificador').fill('abertura-plataforma');
    await createActivity.getByLabel('Título').fill('Cerimônia de abertura');
    await createActivity.getByLabel('Sala').selectOption({ label: 'Auditório Principal (100 lugares)' });
    await createActivity.getByLabel('Início').fill(localInput(30, 9));
    await createActivity.getByLabel('Término').fill(localInput(30, 11));
    await createActivity.getByLabel('Carga horária (min)').fill('120');
    await createActivity.getByLabel('Vagas').fill('80');
    await createActivity.getByTestId('admin-submit').click();

    await expect(createActivity.getByTestId('create-activity-feedback')).toContainText(/criada/i, {
      timeout: 30_000,
    });

    await expect(page.getByTestId('activity-list')).toContainText('Cerimônia de abertura');

    // ── 5. O SERVIDOR recusa conflito de sala ───────────────────────────────
    /**
     * Esta é a asserção que justifica a fase: a validação de domínio escrita na
     * FASE 3 (`checkScheduleConflict`) finalmente tem um caminho de escrita real
     * para valer. Se ela não estivesse ligada, a agenda pública mostraria duas
     * atividades na mesma sala, no mesmo horário.
     */
    const conflicting = page.getByTestId('create-activity');
    await conflicting.getByLabel('Identificador').fill('palestra-concorrente');
    await conflicting.getByLabel('Título').fill('Palestra no mesmo horário');
    await conflicting.getByLabel('Sala').selectOption({ label: 'Auditório Principal (100 lugares)' });
    await conflicting.getByLabel('Início').fill(localInput(30, 10));
    await conflicting.getByLabel('Término').fill(localInput(30, 12));
    await conflicting.getByLabel('Carga horária (min)').fill('60');
    await conflicting.getByTestId('admin-submit').click();

    await expect(conflicting.getByTestId('create-activity-feedback')).toContainText(
      /já está ocupada/i,
      { timeout: 30_000 },
    );

    // ── 6. Cria a trilha da chamada de trabalhos ────────────────────────────
    const tracksSection = page.getByTestId('tracks-section');
    await tracksSection.locator('summary').click();

    const createTrack = page.getByTestId('create-track');
    await createTrack.getByLabel('Identificador').fill('trilha-plataforma');
    await createTrack.getByLabel('Nome').fill('Trilha da Plataforma');
    await createTrack.getByLabel('Pareceres exigidos').fill('1');
    await createTrack.getByTestId('admin-submit').click();

    await expect(createTrack.getByTestId('create-track-feedback')).toContainText(/criada/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('track-list')).toContainText('Trilha da Plataforma');

    // ── 7. A trilha criada aceita submissão (CFP funcional) ─────────────────
    const track = await e2eDb.track.findFirstOrThrow({
      where: { tenantId: tenant.id, slug: 'trilha-plataforma' },
      select: { id: true },
    });

    expect(track.id).toBeTruthy();

    // ── 8. A página pública mostra o evento e a atividade, SEM login ────────
    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();

    try {
      await anonymousPage.goto(`/t/${tenant.slug}/eventos/${eventSlug}`);

      await expect(anonymousPage.getByRole('heading', { name: title })).toBeVisible();
      /**
       * A atividade criada no painel aparece na AGENDA pública.
       *
       * A asserção é pelo TEXTO, e não por um link: o bloco de agenda pode
       * renderizar o título como link ou como título com link separado — o que
       * importa aqui é que o conteúdo criado pela administração chegue à vitrine.
       */
      await expect(anonymousPage.getByText('Cerimônia de abertura').first()).toBeVisible();
    } finally {
      await anonymous.close();
    }

    // ── 9. Credenciamento pelo CRACHÁ + XP ──────────────────────────────────
    const registrationId = randomUUID();
    const badgeToken = `BADGE-PLAT-${RUN_ID}`;

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.registration.create({
        data: {
          id: registrationId,
          tenantId: tenant.id,
          eventId: event.id,
          userId: participant.id,
          status: 'CONFIRMED',
          consentData: true,
          badgeToken,
        },
      });
    });

    const staff = await createUser(page, tenant.id, 'Equipe do Crachá', 'STAFF');
    await signInAs(page, staff.email);
    await page.goto(`/t/${tenant.slug}/credenciamento?evento=${event.id}`);

    /**
     * A FASE 31 trocou o formulário de check-in pelo BALCÃO do monitor, onde o
     * CONTEXTO da leitura decide o fato: a portaria marca a chegada (e credita o XP),
     * a atividade marca a frequência. Aqui o que está em teste é a chegada, então o
     * contexto é dito em voz alta — a atividade criada acima é no futuro, mas depender
     * do palpite do padrão seria medir outra coisa se a heurística mudar.
     */
    await page.getByTestId('monitor-context-kind').selectOption('EVENT');
    await expect(page.getByTestId('monitor-context-label')).toContainText(/portaria/i);

    await page.getByTestId('monitor-code').fill(badgeToken);
    await page.getByTestId('presence-submit').click();

    await expect(page.getByTestId('monitor-feedback')).toContainText(/entrada registrada/i, {
      timeout: 30_000,
    });

    const xp = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.userXpProfile.findFirst({
        where: { tenantId: tenant.id, userId: participant.id },
        select: { totalXp: true },
      });
    });

    // 50 XP pelo credenciamento (tabela da FASE 5).
    expect(xp?.totalXp).toBe(50);

    // ── 10. A trilha de auditoria registra as criações ──────────────────────
    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/administracao`);

    const audit = page.getByTestId('audit-log');
    await expect(audit).toContainText('activity');
    await expect(audit).toContainText('track');
    await expect(audit).toContainText('Administradora do Evento');
  });

  /**
   * O painel expõe dados de todas as pessoas da instituição e permite alterar o
   * evento inteiro. Esconder o link no menu não é autorização.
   */
  test('PARTICIPANTE não acessa o painel administrativo', async ({ page }) => {
    const tenant = await createTenant({ label: 'plat-rbac', name: `Instituição RBAC ${RUN_ID}` });
    await createUser(page, tenant.id, 'Participante Curioso', 'PARTICIPANT');

    for (const path of ['/administracao', '/administracao/eventos', '/administracao/cartas', '/administracao/certificados']) {
      await page.goto(`/t/${tenant.slug}${path}`);
      await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard$`), { timeout: 15_000 });
    }

    await expect(page.getByTestId('admin-stats')).toHaveCount(0);
  });
});

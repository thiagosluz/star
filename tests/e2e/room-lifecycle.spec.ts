/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Ciclo de vida da SALA e o teto das vagas (revisão da FASE 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a sala é criada SEM capacidade (o campo vazio significa "sem limite"),
 *         depois EDITADA e EXCLUÍDA pela tela — o ciclo inteiro sem SQL;
 *      2. o servidor RECUSA criar uma atividade com mais vagas do que a sala
 *         comporta, e a recusa nomeia os dois números;
 *      3. a sala EM USO recusa a exclusão, dizendo quantas atividades a usam —
 *         a FK é `ON DELETE SET NULL`, então sem a guarda a sala sumiria da
 *         programação em silêncio;
 *      4. atividade ABERTA numa sala menor que o público do evento AVISA na tela
 *         (o sistema não pode negar acesso em silêncio, e o organizador precisa
 *         saber antes do dia).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const ORIGIN = { origin: 'http://localhost:3000' };

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Cria a conta pela API e entra com ela (o cadastro pela tela tem cenário próprio). */
async function signUpAndSignIn(
  page: import('@playwright/test').Page,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `sala.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: ORIGIN,
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { id: user.id, email };
}

/**
 * Instituição + evento + organizadora logada, com o navegador já na tela do evento.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O EVENTO NASCE COM INÍCIO ARREDONDADO AO MINUTO (lição 18/47)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O formulário de atividade vem preenchido com o início do EVENTO e usa
 *  `<input type="datetime-local">`, que tem precisão de MINUTO. Um evento criado com
 *  segundos e milissegundos faria o valor do campo cair ANTES da abertura — e o
 *  servidor recusaria com "a atividade precisa acontecer dentro do período do
 *  evento", uma mensagem que não tem nada a ver com o que o teste mede. Arredondando
 *  o início do evento ao minuto, o padrão do formulário é exatamente o início válido.
 *
 * O rótulo é ÚNICO por cenário (armadilha 17): dois testes com o mesmo rótulo colidem
 * no `tenants_slug_key` e o segundo falha por um motivo que não é o dele.
 */
async function openEventPage(
  page: import('@playwright/test').Page,
  label: string,
): Promise<{ tenantId: string; eventId: string; eventSlug: string; slug: string }> {
  const tenant = await createTenant({ label, name: `Instituição ${label} ${RUN_ID}` });

  const owner = await signUpAndSignIn(page, `Organizadora ${label}`);
  await linkUser({ tenantId: tenant.id, userId: owner.id });
  await grantRole({ tenantId: tenant.id, userId: owner.id, role: 'OWNER' });

  const startsAt = new Date(Math.floor((Date.now() + 30 * 86_400_000) / 60_000) * 60_000);

  const event = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

    return tx.event.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        slug: `evento-${label}`,
        title: `Evento ${label}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        timezone: 'America/Bahia',
        city: 'Salvador',
        state: 'BA',
        capacity: 100,
        confirmedCount: 0,
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
      },
    });
  });

  await page.goto(`/t/${tenant.slug}/administracao/eventos/${event.id}`);
  await expect(page.getByTestId('rooms-section')).toBeVisible();

  return { tenantId: tenant.id, eventId: event.id, eventSlug: event.slug, slug: tenant.slug };
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('sala: criar, editar e excluir', () => {
  test('o ciclo inteiro pela tela, com o campo de capacidade em branco', async ({ page }) => {
    const { tenantId, eventId } = await openEventPage(page, 'salas-ciclo');

    const rooms = page.getByTestId('rooms-section');
    await rooms.locator('summary').first().click();

    /**
     * ── 1. Cria SEM capacidade ────────────────────────────────────────────────
     * O campo vazio é a afirmação "esta sala não declara limite" — e a lista precisa
     * dizer isso, e não "0 lugares".
     */
    const createRoom = page.getByTestId('create-room');
    await createRoom.getByLabel('Nome da sala').fill('Sala sem número');
    await createRoom.getByTestId('admin-submit').click();
    await expect(createRoom.getByTestId('create-room-feedback')).toContainText(/criada/i, {
      timeout: 20_000,
    });

    const roomList = page.getByTestId('room-list');
    await expect(roomList).toContainText('Sala sem número');
    await expect(roomList).toContainText('sem limite');

    const room = await e2eDb.room.findFirstOrThrow({
      where: { eventId, name: 'Sala sem número' },
      select: { id: true, capacity: true, tenantId: true },
    });

    // O banco confirma o significado: ausência de limite é NULL, não zero.
    expect(room.capacity).toBeNull();
    expect(room.tenantId).toBe(tenantId);
    await expect(page.getByTestId(`room-capacity-${room.id}`)).toHaveText('sem limite');

    // ── 2. EDITA nome e capacidade ───────────────────────────────────────────
    await page.getByTestId(`edit-room-${room.id}`).click();

    const editForm = page.getByTestId(`room-form-${room.id}`);
    await editForm.getByLabel('Nome da sala').fill('Auditório Principal');
    await editForm.getByLabel('Capacidade').fill('120');
    await editForm.getByTestId('admin-submit').click();

    await expect(editForm.getByTestId(`room-form-${room.id}-feedback`)).toContainText(/atualizada/i, {
      timeout: 20_000,
    });

    await expect(page.getByTestId(`room-row-${room.id}`)).toContainText('Auditório Principal');
    await expect(page.getByTestId(`room-capacity-${room.id}`)).toHaveText('120 lugares');

    // ── 3. EXCLUI pelo diálogo do sistema ────────────────────────────────────
    await page.getByTestId(`delete-room-${room.id}-open`).click();
    await page.getByTestId(`delete-room-${room.id}-confirm-confirm`).click();

    // A linha sai da lista: o sinal durável é o efeito, não o texto de sucesso.
    await expect(page.getByTestId(`room-row-${room.id}`)).toHaveCount(0, { timeout: 20_000 });

    const gone = await e2eDb.room.findFirst({ where: { id: room.id } });
    expect(gone).toBeNull();
  });

  test('a lista volta ao estado de "nenhuma sala" depois de excluir a única sala', async ({ page }) => {
    const { eventId } = await openEventPage(page, 'salas-vazia');

    const rooms = page.getByTestId('rooms-section');
    await rooms.locator('summary').first().click();

    const createRoom = page.getByTestId('create-room');
    await createRoom.getByLabel('Nome da sala').fill('Sala única');
    await createRoom.getByLabel('Capacidade').fill('30');
    await createRoom.getByTestId('admin-submit').click();
    await expect(createRoom.getByTestId('create-room-feedback')).toContainText(/criada/i, {
      timeout: 20_000,
    });

    const room = await e2eDb.room.findFirstOrThrow({
      where: { eventId, name: 'Sala única' },
      select: { id: true },
    });

    await page.getByTestId(`delete-room-${room.id}-open`).click();
    await page.getByTestId(`delete-room-${room.id}-confirm-confirm`).click();

    await expect(page.getByTestId('room-list')).toHaveCount(0, { timeout: 20_000 });
    await expect(rooms).toContainText('Nenhuma sala cadastrada');
  });
});

test.describe('a sala limita a atividade', () => {
  test('vagas acima da sala são recusadas, e a sala em uso não pode ser excluída', async ({ page }) => {
    const { eventId } = await openEventPage(page, 'salas-limite');

    const rooms = page.getByTestId('rooms-section');
    await rooms.locator('summary').first().click();

    const createRoom = page.getByTestId('create-room');
    await createRoom.getByLabel('Nome da sala').fill('Sala Pequena');
    await createRoom.getByLabel('Capacidade').fill('40');
    await createRoom.getByTestId('admin-submit').click();
    await expect(createRoom.getByTestId('create-room-feedback')).toContainText(/criada/i, {
      timeout: 20_000,
    });

    const room = await e2eDb.room.findFirstOrThrow({
      where: { eventId, name: 'Sala Pequena' },
      select: { id: true },
    });

    // ── 1. Atividade com MAIS vagas do que a sala ────────────────────────────
    const activities = page.getByTestId('activities-section');
    await activities.locator('summary').first().click();

    const createActivity = page.getByTestId('create-activity');
    await createActivity.getByLabel('Identificador').fill('oficina-grande');
    await createActivity.getByLabel('Título').fill('Oficina Grande');
    await createActivity.getByLabel('Sala').selectOption(room.id);
    await createActivity.getByLabel('Vagas').fill('80');
    await createActivity.getByTestId('admin-submit').click();

    const refusal = createActivity.getByTestId('create-activity-feedback');
    await expect(refusal).toContainText(/excede a capacidade da sala/i, { timeout: 20_000 });
    await expect(refusal).toContainText('80');
    await expect(refusal).toContainText('40');

    // Nada foi gravado: a recusa do servidor não deixa atividade pela metade.
    expect(await e2eDb.activity.count({ where: { eventId, slug: 'oficina-grande' } })).toBe(0);

    /**
     * ── 2. Corrigir o cadastro recomeça de uma TELA LIMPA ────────────────────
     *
     * O React 19 reinicia o formulário depois da action — inclusive quando ela
     * devolve ERRO (armadilha 5). Reescrever `Vagas` por cima de um formulário que
     * está sendo reiniciado é corrida: o valor que a action recebe pode ser o
     * ANTIGO (foi o que aconteceu aqui: o segundo envio levou 80 outra vez). A
     * recarga devolve o formulário ao estado inicial e o teste passa a medir o que
     * quer medir — o cadastro corrigido, com a sala já em uso.
     */
    await page.reload();

    const activitiesAgain = page.getByTestId('activities-section');
    await activitiesAgain.locator('summary').first().click();

    const createValid = page.getByTestId('create-activity');
    await createValid.getByLabel('Identificador').fill('oficina-grande');
    await createValid.getByLabel('Título').fill('Oficina Grande');
    await createValid.getByLabel('Sala').selectOption(room.id);
    await createValid.getByLabel('Vagas').fill('30');
    await createValid.getByTestId('admin-submit').click();
    await expect(createValid.getByTestId('create-activity-feedback')).toContainText(/criada/i, {
      timeout: 20_000,
    });

    const activity = await e2eDb.activity.findFirstOrThrow({
      where: { eventId, slug: 'oficina-grande' },
      select: { id: true },
    });

    /**
     * A recarga fechou os `<details>` (a página volta do servidor sem o estado de
     * abertura do navegador), então a seção de salas precisa ser reaberta antes de
     * clicar em qualquer coisa dentro dela — o Playwright não clica no que não está
     * visível.
     */
    await page.getByTestId('rooms-section').locator('summary').first().click();

    await page.getByTestId(`delete-room-${room.id}-open`).click();
    await page.getByTestId(`delete-room-${room.id}-confirm-confirm`).click();

    await expect(page.getByTestId(`delete-room-${room.id}-feedback`)).toContainText(
      /em uso por 1 atividade\(s\)/i,
      { timeout: 20_000 },
    );

    // A sala continua no cadastro — a guarda preservou o dado.
    await expect(page.getByTestId(`room-row-${room.id}`)).toBeVisible();

    // ── 3. A tela mostra as VAGAS REAIS, com a origem do número menor ────────
    const activityRow = page.getByTestId(`activity-row-${activity.id}`);
    await expect(activityRow).toContainText('30 vaga(s)');
  });
});

test.describe('atividade aberta numa sala pequena', () => {
  test('o painel avisa que o público do evento não cabe no espaço', async ({ page }) => {
    const { tenantId, eventId } = await openEventPage(page, 'salas-aberta');

    /**
     * Duas inscrições NO EVENTO (`activityId` nulo) — é o que o contador do painel
     * soma para decidir se o público cabe na sala. Criadas direto no banco porque o
     * cenário mede o AVISO da tela, não a jornada de inscrição (que tem spec própria).
     */
    const room = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      return tx.room.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          name: 'Sala Apertada',
          capacity: 1,
        },
      });
    });

    for (let index = 0; index < 2; index += 1) {
      const personId = randomUUID();

      await e2eDb.user.create({
        data: {
          id: personId,
          name: `Inscrito ${index} ${RUN_ID}`,
          email: `sala.inscrito.${RUN_ID}.${personId.slice(0, 6)}@example.test`,
        },
      });

      await e2eDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

        await tx.registration.create({
          data: {
            id: randomUUID(),
            tenantId,
            eventId,
            activityId: null,
            userId: personId,
            status: 'CONFIRMED',
            origin: 'INDIVIDUAL',
            consentAt: new Date(),
          },
        });
      });
    }

    const activityId = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 30 * 86_400_000);
      const row = await tx.activity.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: 'abertura-na-sala-apertada',
          title: 'Abertura na Sala Apertada',
          type: 'LECTURE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          workloadMinutes: 60,
          capacity: null,
          confirmedCount: 0,
          waitlistCount: 0,
          roomId: room.id,
          requiresRegistration: false,
        },
      });

      return row.id;
    });

    await page.reload();

    const activities = page.getByTestId('activities-section');
    await activities.locator('summary').first().click();

    const warning = page.getByTestId(`activity-room-overflow-${activityId}`);
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('A sala comporta 1 lugares');
    await expect(warning).toContainText('2 inscrito(s)');
  });
});

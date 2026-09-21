/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Sorteios de ponta a ponta (FASE 16) + operação de palco (FASE 22)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA NO PALCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. G7 — a contagem de elegíveis se atualiza sozinha quando alguém entra
 *         pelo credenciamento (sem recarregar a página);
 *      2. G1 — a apuração entrega TITULARES e SUPLENTES, em seções distintas;
 *      3. G4 — a prova do commit-reveal aparece com o resultado (compromisso e
 *         semente) e o sorteio se declara verificável;
 *      4. G2 — a entrega do prêmio é registrada e passa a aparecer na lista;
 *      5. G5 — o resultado publicado aparece na página pública do evento, com o
 *         nome mascarado de quem não tem perfil público.
 *
 *  A FASE 22 acrescentou, no fim do arquivo, o que a OPERAÇÃO pede:
 *      6. G8  — desfazer uma entrega registrada por engano, com o motivo na trilha;
 *      7. G9  — achar um sorteio no histórico por situação e período;
 *      8. G11 — o endereço próprio do resultado publicado (e o 404 do resto);
 *      9. G13 — a prévia ao vivo chega por SSE, e a tela diz por qual transporte;
 *     10. G10 — premiar N revisores, com o corte do ranking dito ANTES do clique.
 *
 *  A ordem importa (a publicação depende da apuração, e os cenários da FASE 22
 *  dependem do sorteio já apurado) e o arquivo roda com um worker: cada cenário usa
 *  o estado deixado pelo anterior, como na vida real.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'sorteio-ponta';
const EVENT_SLUG = `evento-f16-${RUN_ID}`;

let tenantId: string;
let eventId: string;
let activityId: string;
let adminEmail: string;
/** Dois presentes: o sorteio pede 1 titular + 1 suplente. */
let firstPersonId: string;
let secondPersonId: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f16.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Presença direta no banco: o que interessa aqui é a tela reagir a ela. */
async function addAttendance(userId: string, minutes: number): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId,
        userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: new Date(),
        checkedOutAt: new Date(Date.now() + minutes * 60_000),
        minutesAttended: minutes,
      },
    });
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição Sorteio Ponta ${RUN_ID}`,
    });

    tenantId = tenant.id;
    eventId = randomUUID();
    activityId = randomUUID();

    const day = new Date('2026-09-17T13:00:00.000Z');

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso Ponta a Ponta ${RUN_ID}`,
          status: 'IN_PROGRESS',
          modality: 'IN_PERSON',
          startsAt: day,
          endsAt: new Date(day.getTime() + 2 * 86_400_000),
          timezone: 'America/Bahia',
          capacity: null,
          confirmedCount: 0,
        },
      });

      await tx.activity.create({
        data: {
          id: activityId,
          tenantId,
          eventId,
          slug: 'atividade-f16',
          title: 'Atividade F16',
          type: 'LECTURE',
          status: 'COMPLETED',
          modality: 'IN_PERSON',
          startsAt: day,
          endsAt: new Date(day.getTime() + 3_600_000),
          workloadMinutes: 60,
          requiresAttendance: true,
        },
      });
    });

    /**
     * As PESSOAS nascem aqui, e não no primeiro teste: os cenários seguintes
     * dependem do estado durável (banco), nunca de uma variável que outro teste
     * preencheu — lição da FASE 14, quando o quarto cenário recebeu `undefined`.
     */
    const admin = await signUpVia(api, `Admin Sorteio ${RUN_ID}`);
    adminEmail = admin.email;
    await linkUser({ tenantId, userId: admin.id });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });

    const first = await signUpVia(api, `Presente Um ${RUN_ID}`);
    firstPersonId = first.id;
    await linkUser({ tenantId, userId: first.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: first.id, role: 'PARTICIPANT' });

    const second = await signUpVia(api, `Presente Dois ${RUN_ID}`);
    secondPersonId = second.id;
    await linkUser({ tenantId, userId: second.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: second.id, role: 'PARTICIPANT' });
  } finally {
    await api.dispose();
  }
});

test.describe('sorteios de ponta a ponta', () => {
  test('a contagem de elegíveis se atualiza sozinha com o credenciamento (G7)', async ({ page }) => {
    await signInAs(page, adminEmail);

    const response = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`);
    expect(response?.status()).toBe(200);

    const live = page.getByTestId('raffle-live');
    await expect(live).toBeVisible();

    // Sem ninguém credenciado: zero elegíveis (a amostragem chega em segundos).
    await expect(live).toHaveAttribute('data-eligible', '0', { timeout: 15_000 });

    // Alguém entra pela catraca: a tela deve refletir SEM recarregar.
    await addAttendance(firstPersonId, 60);
    await expect(live).toHaveAttribute('data-eligible', '1', { timeout: 20_000 });
    await expect(live).toContainText('1 elegível(is) agora');

    // Uma segunda pessoa entra: o sorteio seguinte terá titular E suplente.
    await addAttendance(secondPersonId, 30);
    await expect(live).toHaveAttribute('data-eligible', '2', { timeout: 20_000 });
  });

  test('a apuração entrega titulares e suplentes, com a prova da semente (G1, G4)', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`);

    const form = page.getByTestId('raffle-form');
    await form.getByLabel('Título do sorteio').fill(`Sorteio F16 ${RUN_ID}`);
    await form.getByLabel('Quantos vencedores').fill('1');
    await form.getByTestId('raffle-alternates').fill('1');
    await form.getByTestId('raffle-weighted').check();
    await form.getByTestId('raffle-public').check();

    // Confere antes de sortear (o passo que evita anunciar lista errada).
    await page.getByTestId('preview-raffle').click();
    await expect(page.getByTestId('raffle-preview')).toContainText(/elegível/i, { timeout: 20_000 });

    await page.getByTestId('draw-raffle').click();

    const result = page.getByTestId('raffle-result');
    await expect(result).toContainText(/titular/i, { timeout: 30_000 });
    await expect(result).toContainText(/suplente/i);

    // A prova do commit-reveal acompanha o resultado.
    const proof = page.getByTestId('raffle-seed-proof');
    await expect(proof).toBeVisible();
    await expect(proof).toContainText(/verificável/i);
    await expect(proof).toContainText(/compromisso/i);
    await expect(proof).toContainText(/semente revelada/i);

    // O banco confirma a apuração com as duas posições.
    const raffle = await e2eDb.raffle.findFirstOrThrow({
      where: { tenantId, eventId },
      select: { id: true, status: true, seedCommitment: true, seedRevealed: true },
    });

    expect(raffle.status).toBe('DRAWN');
    expect(raffle.seedCommitment).not.toBeNull();
    expect(raffle.seedRevealed).not.toBeNull();

    const positions = await e2eDb.raffleWinner.findMany({
      where: { raffleId: raffle.id },
      orderBy: { position: 'asc' },
      select: { position: true, kind: true },
    });

    expect(positions.map((entry) => entry.kind)).toEqual(['WINNER', 'ALTERNATE']);
  });

  test('a entrega do prêmio é registrada e o resultado é publicado (G2, G5)', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`);

    const history = page.getByTestId('raffle-history');
    await expect(history).toBeVisible();

    // ── Entrega do prêmio ao TITULAR ────────────────────────────────────────
    const winnerRow = page.locator('[data-testid^="position-"][data-kind="WINNER"]').first();
    await expect(winnerRow).toBeVisible();

    const deliverButton = winnerRow.locator('[data-testid^="deliver-"]');
    await deliverButton.click();

    const confirmButton = winnerRow.locator('[data-testid^="confirm-delivery-"]');
    await confirmButton.click();

    await expect(page.locator('[data-testid^="delivery-feedback-"]').first()).toContainText(
      /Entrega registrada/i,
      { timeout: 20_000 },
    );

    // A linha passa a mostrar a entrega (recibo visível para o próximo plantão).
    await expect(page.locator('[data-testid^="position-"][data-delivered="true"]').first()).toBeVisible();

    // ── Publicação do resultado ─────────────────────────────────────────────
    const toggle = page.locator('[data-testid^="toggle-public-"]').first();
    await expect(toggle).toContainText(/Despublicar|Publicar/);

    if ((await toggle.textContent())?.includes('Publicar')) {
      await toggle.click();
      await expect(page.locator('[data-testid^="visibility-feedback-"]').first()).toContainText(
        /publicado/i,
        { timeout: 20_000 },
      );
    }

    const stored = await e2eDb.raffle.findFirstOrThrow({
      where: { tenantId, eventId },
      select: { isPublic: true },
    });

    expect(stored.isPublic).toBe(true);

    // ── Página pública (sem sessão) mostra o resultado ──────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

    const publicPage = await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}`);
    expect(publicPage?.status()).toBe(200);

    const section = page.getByTestId('public-raffle-results');
    await expect(section).toBeVisible();
    await expect(section).toContainText(`Sorteio F16 ${RUN_ID}`);
    await expect(page.locator('[data-testid^="public-winner-"]').first()).toBeVisible();
  });

  test('a seção de reconhecimento do comitê existe no evento (F1)', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}`);

    const section = page.getByTestId('reviewer-award-section');
    await expect(section).toBeVisible();

    await section.locator('summary').click();
    // Sem pareceres concluídos e sem carta do gatilho: o painel explica, não some.
    await expect(section).toContainText(/Reconhecimento do comitê|parecer/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('operação de palco (FASE 22)', () => {
  test('G13 — a prévia ao vivo chega por SSE, e a tela diz por qual transporte', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`);

    const live = page.getByTestId('raffle-live');
    await expect(live).toBeVisible();

    /**
     * O `EventSource` do navegador é quem decide: se o fluxo abrir, o atributo diz
     * `sse`. O caminho de volta (polling) tem o próprio valor — o teste prende qual
     * dos dois está em uso em vez de assumir.
     */
    await expect(live).toHaveAttribute('data-transport', 'sse', { timeout: 20_000 });
    await expect(live).toContainText(/ao vivo às/);
  });

  test('G8 — desfazer a entrega exige motivo e preserva as duas pontas na trilha', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`);

    const delivered = page.locator('[data-testid^="position-"][data-delivered="true"]').first();
    await expect(delivered).toBeVisible();

    const positionId = await delivered.getAttribute('data-testid');
    const id = positionId!.replace('position-', '');

    // ── Abre o formulário de reversão ───────────────────────────────────────
    await delivered.locator('[data-testid^="reverse-delivery-"]').click();

    const reasonField = delivered.locator('input[name="reason"]');
    await expect(reasonField).toBeVisible();

    /**
     * O campo é `required` com `minLength`: o navegador recusa o envio vazio, e o
     * domínio recusa de novo no servidor. Aqui preenchemos de propósito o que o
     * operador escreveria no balcão.
     */
    await reasonField.fill('entreguei para o homônimo, não para o ganhador');
    await delivered.locator('[data-testid^="confirm-reversal-"]').click();

    await expect(page.locator('[data-testid^="reversal-feedback-"]').first()).toContainText(
      /desfeita/i,
      { timeout: 20_000 },
    );

    // ── O efeito no DADO: a posição volta a "não entregue" ──────────────────
    await expect(
      page.locator(`[data-testid="position-${id}"][data-delivered="false"]`),
    ).toBeVisible({ timeout: 20_000 });

    const stored = await e2eDb.raffleWinner.findFirstOrThrow({
      where: { id },
      select: { deliveredAt: true, deliveredById: true, deliveryNote: true },
    });

    expect(stored.deliveredAt).toBeNull();
    expect(stored.deliveredById).toBeNull();
    expect(stored.deliveryNote).toBeNull();

    /** A POSIÇÃO continua existindo: desfez-se o recibo, não o sorteio. */
    const stillThere = await e2eDb.raffleWinner.findFirst({ where: { id }, select: { position: true } });
    expect(stillThere?.position).toBeGreaterThan(0);

    // ── E o MOTIVO ficou na trilha ──────────────────────────────────────────
    const audit = await e2eDb.auditLog.findMany({
      where: { tenantId, entityType: 'rafflePrize', entityId: id },
      select: { changes: true },
    });

    const comMotivo = audit.find((entry) =>
      JSON.stringify(entry.changes ?? {}).includes('motivoDaReversao'),
    );

    expect(comMotivo).toBeDefined();
    expect(JSON.stringify(comMotivo?.changes)).toContain('homônimo');
  });

  test('G9 — o histórico é filtrável por situação e período', async ({ page }) => {
    /**
     * Dois sorteios criados direto no banco (um cancelado, um rascunho) para o filtro
     * ter o que separar. O sorteio apurado e publicado já existe desde os cenários
     * anteriores — o estado durável é o banco.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      for (const [title, status] of [
        [`Cancelado F22 ${RUN_ID}`, 'CANCELED'],
        [`Rascunho F22 ${RUN_ID}`, 'DRAFT'],
      ] as const) {
        const id = randomUUID();

        await tx.raffle.create({
          data: {
            id,
            tenantId,
            eventId,
            title,
            scope: 'EVENT',
            minAttendanceMinutes: 0,
            winnersCount: 1,
            alternatesCount: 0,
            weightByMinutes: false,
            isPublic: false,
            allowPriorEventWinners: true,
            status,
            createdById: (
              await e2eDb.user.findFirstOrThrow({ where: { email: adminEmail }, select: { id: true } })
            ).id,
          },
        });
      }
    });

    await signInAs(page, adminEmail);

    const pagePath = `/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}/sorteios`;
    await page.goto(pagePath);

    const history = page.getByTestId('raffle-history');
    await expect(history).toContainText(`Cancelado F22 ${RUN_ID}`);

    // ── Filtro por situação ─────────────────────────────────────────────────
    await page.getByTestId('raffle-filter-status').selectOption('DRAWN');
    await page.getByTestId('raffle-filter-apply').click();

    await expect(page.getByTestId('raffle-filter-summary')).toContainText(/Apurado/i);
    await expect(page.getByTestId('raffle-history')).not.toContainText(`Cancelado F22 ${RUN_ID}`);
    await expect(page.getByTestId('raffle-history')).toContainText(`Sorteio F16 ${RUN_ID}`);

    // O filtro vive no ENDEREÇO: recarregar mantém o recorte.
    await page.reload();
    await expect(page.getByTestId('raffle-filter-summary')).toContainText(/Apurado/i);

    // ── Filtro por período que não alcança nada ─────────────────────────────
    await page.goto(`${pagePath}?de=2030-01-01&ate=2030-01-02`);

    await expect(page.getByTestId('raffles-empty')).toContainText(/Nenhum sorteio para este filtro/i);

    // ── Período invertido é RECUSADO, e a tela explica ──────────────────────
    await page.goto(`${pagePath}?de=2030-01-05&ate=2030-01-01`);

    await expect(page.getByTestId('raffle-filter-error')).toContainText(/posterior/i);
  });

  test('G11 — o resultado publicado tem endereço próprio, e o resto responde 404', async ({ page }) => {
    /**
     * O sorteio NÃO publicado nasce aqui. Os cenários anteriores só produzem o
     * apurado E publicado — e o 404 do "não publicado" ficava sem sujeito: o teste
     * reprovou com `undefined` justamente porque não havia o que testar (o defeito
     * que ele existe para pegar).
     */
    const fechadoId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.raffle.create({
        data: {
          id: fechadoId,
          tenantId,
          eventId,
          title: `Fechado F22 ${RUN_ID}`,
          scope: 'EVENT',
          minAttendanceMinutes: 0,
          winnersCount: 1,
          alternatesCount: 0,
          weightByMinutes: false,
          isPublic: false,
          allowPriorEventWinners: true,
          status: 'DRAWN',
          createdById: (
            await e2eDb.user.findFirstOrThrow({ where: { email: adminEmail }, select: { id: true } })
          ).id,
        },
      });
    });

    const raffles = await e2eDb.raffle.findMany({
      where: { tenantId, eventId },
      select: { id: true, title: true, isPublic: true, status: true },
    });

    const publicado = raffles.find(
      (raffle) => raffle.isPublic && raffle.status === 'DRAWN' && raffle.id !== fechadoId,
    )!;

    expect(publicado).toBeDefined();

    // ── Sem sessão: a página do resultado é pública ─────────────────────────
    await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

    const publicPage = await page.goto(
      `/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}/sorteios/${publicado.id}`,
    );

    expect(publicPage?.status()).toBe(200);
    await expect(page.getByTestId('raffle-result-title')).toContainText(`Sorteio F16 ${RUN_ID}`);
    await expect(page.getByTestId('raffle-result-winners').locator('li').first()).toBeVisible();

    /** A prova da semente viaja com o resultado — publicar só o nome é promessa. */
    const proof = page.getByTestId('raffle-result-proof');
    await expect(proof).toContainText(/compromisso/i);
    await expect(proof).toContainText(/semente revelada/i);

    /** O nome sai MASCARADO (ninguém consentiu em ter o nome publicado). */
    await expect(page.locator('[data-testid^="raffle-result-winner-"][data-masked="true"]').first()).toBeVisible();

    // ── Sorteio NÃO publicado: 404 (não "existe, mas não está publicado") ───
    const notFound = await page.goto(
      `/t/${TENANT_LABEL}-${RUN_ID}/eventos/${EVENT_SLUG}/sorteios/${fechadoId}`,
    );

    expect(notFound?.status()).toBe(404);
  });

  test('G10 — o painel deixa escolher QUANTOS premiar, e diz o corte ANTES do clique', async ({ page }) => {
    /**
     * O ranking é criado aqui: o evento deste arquivo é de SORTEIO e não tem comitê
     * avaliando — sem pareceres, o painel só sabe dizer que não há ninguém, e o que
     * este cenário precisa ver anunciado é o CORTE. São 3 pareceres SUBMETIDOS do
     * mesmo revisor, que é o piso padrão (`MIN_REVIEWS_FOR_TOP`).
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      for (let index = 1; index <= 3; index += 1) {
        const submissionId = randomUUID();

        await tx.submission.create({
          data: {
            id: submissionId,
            tenantId,
            eventId,
            protocol: `F22-${RUN_ID}-${index}`,
            title: `Submissão F22 ${index} ${RUN_ID}`,
            abstract: 'Submissão criada pelo cenário do revisor destaque.',
            status: 'SUBMITTED',
            submittedById: firstPersonId,
            submittedAt: new Date(),
          },
        });

        await tx.review.create({
          data: {
            id: randomUUID(),
            tenantId,
            submissionId,
            reviewerId: firstPersonId,
            status: 'SUBMITTED',
            submittedAt: new Date(),
          },
        });
      }
    });

    await signInAs(page, adminEmail);

    await page.goto(`/t/${TENANT_LABEL}-${RUN_ID}/administracao/eventos/${eventId}`);

    const section = page.getByTestId('reviewer-award-section');
    await section.locator('summary').click();

    await expect(page.getByTestId('reviewer-ranking').locator('li').first()).toBeVisible();

    const field = page.getByTestId('reviewer-award-top');
    await expect(field).toBeVisible();
    await expect(field).toHaveValue('1');

    // O teto vem do domínio: 10 é o máximo que a tela aceita.
    await expect(field).toHaveAttribute('max', '10');

    /**
     * A tela antecipa o corte em vez de prometer o que a action vai reduzir: pedindo
     * 5 com 1 pessoa no ranking, ela diz quantas serão premiadas de fato.
     */
    await field.fill('5');
    await expect(page.getByTestId('reviewer-award-capped')).toContainText(/ranking tem 1/i);
    await expect(section).toContainText(/serão premiados 1/i);
  });
});

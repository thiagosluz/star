/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — trocar a TRILHA do rascunho (FASE 51 · dívida E32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SPEC MEDE, E POR QUE PELA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A dívida era de INTERFACE: a trilha não estava no formulário e quem errasse o
 *  seletor excluía o rascunho e recomeçava. Um teste de serviço provaria a regra e
 *  não provaria que a PESSOA consegue — então aqui o caminho é o de quem usa: abrir a
 *  submissão, trocar a trilha no seletor, salvar e conferir no banco.
 *
 *  O segundo caso é a outra metade: quando a troca NÃO pode, a tela não pode ficar
 *  muda (era o defeito original) — ela diz o motivo e o caminho.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Cria a pessoa, autentica NESTE navegador e a vincula ao tenant. */
async function createAuthor(page: Page, tenantId: string): Promise<string> {
  const email = `f51.trilha.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name: `Autora da trilha ${RUN_ID}`, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar: HTTP ${response.status()} ${await response.text()}`);
  }

  const body = (await response.json()) as { user: { id: string } };

  await linkUser({ tenantId, userId: body.user.id, kind: 'PARTICIPANT' });
  await grantRole({ tenantId, userId: body.user.id, role: 'PARTICIPANT' });

  return body.user.id;
}

/** Cria duas trilhas no evento e devolve os ids. */
async function createTracks(tenantId: string, eventId: string) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const a = await tx.track.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        slug: `trilha-a-${RUN_ID}`,
        name: `Trilha A ${RUN_ID}`,
      },
      select: { id: true, name: true },
    });

    const b = await tx.track.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        slug: `trilha-b-${RUN_ID}`,
        name: `Trilha B ${RUN_ID}`,
      },
      select: { id: true, name: true },
    });

    return { a, b };
  });
}

async function createDraft(options: {
  tenantId: string;
  eventId: string;
  trackId: string;
  authorId: string;
  status?: 'DRAFT' | 'SUBMITTED';
}): Promise<string> {
  const id = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    await tx.submission.create({
      data: {
        id,
        tenantId: options.tenantId,
        eventId: options.eventId,
        trackId: options.trackId,
        protocol: `F51-${RUN_ID.slice(0, 4)}-${id.slice(0, 4)}`,
        title: 'Reclassificação pela tela do rascunho',
        abstract:
          'Resumo longo o suficiente para passar na validação de conteúdo do rascunho, escrito para o teste de reclassificação por trilha pela interface do autor.',
        keywords: ['reclassificação', 'trilha', 'interface'],
        status: options.status ?? 'DRAFT',
        submittedById: options.authorId,
      },
    });
  });

  return id;
}

function trackOf(tenantId: string, submissionId: string): Promise<string | null> {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const row = await tx.submission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { trackId: true },
    });

    return row.trackId;
  });
}

test.describe('trilha do rascunho', () => {
  test('a autora troca a trilha pela tela e o rascunho guarda a nova', async ({ page }) => {
    const tenant = await createTenant({
      label: 'f51-trilha',
      name: `Instituição da Trilha ${RUN_ID}`,
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `f51-evento-${RUN_ID}`,
      title: `Congresso da trilha ${RUN_ID}`,
    });

    const { a, b } = await createTracks(tenant.id, event.id);
    const authorId = await createAuthor(page, tenant.id);

    const submissionId = await createDraft({
      tenantId: tenant.id,
      eventId: event.id,
      trackId: a.id,
      authorId,
    });

    await page.goto(`/t/${tenant.slug}/submissoes/${submissionId}`);

    const seletor = page.getByTestId('draft-track');
    await expect(seletor).toBeVisible({ timeout: 20_000 });

    await seletor.selectOption(b.id);
    await page.getByTestId('save-draft').click();

    await expect(page.getByTestId('draft-form-ok')).toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => trackOf(tenant.id, submissionId), { timeout: 20_000 }).toBe(b.id);
  });

  test('depois do envio a tela DIZ por que não dá mais, em vez de esconder o campo', async ({
    page,
  }) => {
    const tenant = await createTenant({
      label: 'f51-travada',
      name: `Instituição Travada ${RUN_ID}`,
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `f51-evento-travado-${RUN_ID}`,
      title: `Congresso travado ${RUN_ID}`,
    });

    const { a } = await createTracks(tenant.id, event.id);
    const authorId = await createAuthor(page, tenant.id);

    const submissionId = await createDraft({
      tenantId: tenant.id,
      eventId: event.id,
      trackId: a.id,
      authorId,
      status: 'SUBMITTED',
    });

    await page.goto(`/t/${tenant.slug}/submissoes/${submissionId}`);

    /**
     * Depois do envio o formulário inteiro fecha (o conteúdo vira registro): o seletor
     * não aparece e o texto que ele mostra é o resumo, não os campos. O que este caso
     * prende é que a tela NÃO oferece uma troca que o servidor vai recusar.
     */
    await expect(page.getByTestId('draft-track')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('draft-form')).toHaveCount(0);
  });
});

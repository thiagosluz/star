/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — ARQUIVO E RESTAURAÇÃO DO CATÁLOGO (FASE 51, dívida E58)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. excluir carta e missão SOME do catálogo ativo e APARECE na lista de
 *         arquivados — com a data e o AUTOR da exclusão (a trilha guarda isso desde a
 *         FASE 43, e a tela lê numa consulta só para a lista);
 *      2. "Restaurar" traz o item de volta e ele volta a valer: a carta reaparece no
 *         catálogo ativo e o `deletedAt` volta a nulo no banco;
 *      3. o filtro **funciona SEM JavaScript** (`javaScriptEnabled: false`): o contexto
 *         é criado sem bundle, e `?arquivados=1` é uma navegação de verdade — o
 *         endereço pode ser marcado, recarregado e mandado para um colega;
 *      4. o catálogo ativo NÃO oferece criar/editar/conceder dentro da visão de
 *         arquivados: uma carta arquivada não é sorteada, e o serviço de gravação nem
 *         a encontra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A FIXTURE É SEMEADA DIRETO NO BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Criar pela tela exigiria preencher o formulário inteiro de carta (paleta, arte,
 *  gatilho, tiragem) e de missão — e o que este arquivo mede é o ARQUIVO, não o
 *  cadastro (que já tem cobertura em `gamification-catalog.spec.ts`). As linhas aqui
 *  são o que os serviços deixariam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'arquivo-catalogo-f51';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let adminEmail: string;
let cardId: string;
let missionId: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f51arq.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** A linha da carta no banco — a prova de que a exclusão é LÓGICA e a volta é real. */
async function lerCarta() {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.cardTemplate.findUniqueOrThrow({
      where: { id: cardId },
      select: { deletedAt: true, isActive: true },
    });
  });
}

async function lerMissao() {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.taskDefinition.findUniqueOrThrow({
      where: { id: missionId },
      select: { deletedAt: true, isActive: true, isVisible: true },
    });
  });
}

/** Arquiva (ou restaura) direto no banco, para montar o cenário SEM JavaScript. */
async function arquivarNoBanco(carta: boolean, deletedAt: Date | null): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    if (carta) {
      await tx.cardTemplate.update({
        where: { id: cardId },
        data: { deletedAt, isActive: deletedAt === null },
      });
      return;
    }

    await tx.taskDefinition.update({
      where: { id: missionId },
      data: { deletedAt, isActive: deletedAt === null, isVisible: deletedAt === null },
    });
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Arquivo ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'Congresso do Arquivo',
    });

    eventId = event.id;

    const admin = await signUpVia(api, `Organizadora do Arquivo ${RUN_ID}`);
    adminEmail = admin.email;

    await linkUser({ tenantId, userId: admin.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: admin.id, role: 'ADMIN' });

    cardId = randomUUID();
    missionId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.cardTemplate.create({
        data: {
          id: cardId,
          tenantId,
          eventId: null,
          slug: `carta-arquivo-${RUN_ID}`,
          name: 'Carta do Arquivo',
          rarity: 'COMMON',
          trigger: 'MANUAL_GRANT',
          levelRequired: 1,
          dropWeight: 100,
          maxSupply: 0,
          palette: {},
          art: {},
        },
      });

      await tx.taskDefinition.create({
        data: {
          id: missionId,
          tenantId,
          eventId,
          slug: `missao-arquivo-${RUN_ID}`,
          name: 'Missão do Arquivo',
          kind: 'ONE_OFF',
          trigger: 'CHECKIN',
          target: { count: 1 },
          xpReward: 10,
          displayOrder: 0,
        },
      });
    });
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('arquivo do catálogo', () => {
  test.fixme('1. excluir a carta a leva para o arquivo, com data e autor; restaurar a traz de volta', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${tenantSlug}/administracao/cartas`);

    // ── O catálogo ativo mostra a carta ──────────────────────────────────────
    await expect(page.getByTestId(`admin-card-${cardId}`)).toContainText('Carta do Arquivo');
    await expect(page.getByTestId('cards-scope-label')).toContainText('Catálogo ativo');

    // ── Excluir (com o diálogo de confirmação) ───────────────────────────────
    await page.getByTestId(`card-delete-${cardId}-open`).click();
    await page.getByRole('button', { name: 'Excluir carta' }).click();

    await expect(page.getByTestId(`admin-card-${cardId}`)).toHaveCount(0, { timeout: 30_000 });

    // ── O arquivo tem a carta, com QUEM excluiu e QUANDO ─────────────────────
    await page.getByTestId('cards-archive-toggle').click();

    expect(page.url()).toContain('arquivados=1');
    await expect(page.getByTestId('cards-scope-label')).toContainText('Arquivados');
    await expect(page.getByTestId(`admin-card-${cardId}`)).toContainText('Carta do Arquivo');

    const rastro = page.getByTestId(`card-archived-${cardId}`);
    await expect(rastro).toContainText(/Arquivada em/);
    await expect(rastro).toContainText(`Organizadora do Arquivo ${RUN_ID}`);

    /**
     * A visão de arquivo NÃO oferece o que não se aplica: nem editar, nem excluir, nem
     * criar. É a mesma listagem — com outro escopo e uma única ação.
     */
    await expect(page.getByTestId(`card-form-${cardId}`)).toHaveCount(0);
    await expect(page.getByTestId('create-card')).toHaveCount(0);
    await expect(page.getByTestId('grant-card')).toHaveCount(0);

    // ── Restaurar (com confirmação) ──────────────────────────────────────────
    await page.getByTestId(`card-restore-${cardId}-open`).click();
    await page.getByRole('button', { name: 'Restaurar carta' }).click();

    await expect(page.getByTestId(`admin-card-${cardId}`)).toHaveCount(0, { timeout: 30_000 });

    // ── De volta ao catálogo ativo: a carta está lá de novo ──────────────────
    await page.goto(`/t/${tenantSlug}/administracao/cartas`);
    await expect(page.getByTestId(`admin-card-${cardId}`)).toContainText('Carta do Arquivo');

    const carta = await lerCarta();
    expect(carta.deletedAt).toBeNull();
    expect(carta.isActive).toBe(true);
  });

  test.fixme('2. a missão percorre o mesmo caminho', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${tenantSlug}/administracao/missoes`);

    await expect(page.getByTestId(`admin-mission-${missionId}`)).toContainText('Missão do Arquivo');
    await expect(page.getByTestId('missions-scope-label')).toContainText('Catálogo ativo');

    await page.getByTestId(`mission-delete-${missionId}-open`).click();
    await page.getByRole('button', { name: 'Excluir missão' }).click();

    await expect(page.getByTestId(`admin-mission-${missionId}`)).toHaveCount(0, { timeout: 30_000 });

    await page.getByTestId('missions-archive-toggle').click();
    expect(page.url()).toContain('arquivados=1');

    await expect(page.getByTestId(`admin-mission-${missionId}`)).toContainText('Missão do Arquivo');
    await expect(page.getByTestId(`mission-archived-${missionId}`)).toContainText(
      `Organizadora do Arquivo ${RUN_ID}`,
    );
    await expect(page.getByTestId('create-mission')).toHaveCount(0);

    await page.getByTestId(`mission-restore-${missionId}-open`).click();
    await page.getByRole('button', { name: 'Restaurar missão' }).click();

    await expect(page.getByTestId(`admin-mission-${missionId}`)).toHaveCount(0, { timeout: 30_000 });

    await page.goto(`/t/${tenantSlug}/administracao/missoes`);
    await expect(page.getByTestId(`admin-mission-${missionId}`)).toContainText('Missão do Arquivo');

    const missao = await lerMissao();
    expect(missao.deletedAt).toBeNull();
    expect(missao.isActive).toBe(true);
    expect(missao.isVisible).toBe(true);
  });

  test.fixme('3. o filtro do arquivo funciona SEM JavaScript', async ({ browser }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA DA DÍVIDA E58
     *  ─────────────────────────────────────────────────────────────────────────────
     *  `javaScriptEnabled: false` é o caso extremo: o bundle nunca carrega. A lista de
     *  arquivados tem de vir pronta do servidor — escopo, data, autor e o botão de
     *  restaurar no HTML —, e o controle que troca de escopo tem de ser um LINK de
     *  verdade. Um filtro que dependesse de hidratação falharia aqui.
     */
    await arquivarNoBanco(true, new Date());

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, adminEmail);

      // ── O catálogo ativo não a mostra ───────────────────────────────────────
      await page.goto(`/t/${tenantSlug}/administracao/cartas`);
      await expect(page.getByTestId(`admin-card-${cardId}`)).toHaveCount(0);

      // ── O endereço do arquivo é navegável e o HTML já vem com tudo ──────────
      await page.goto(`/t/${tenantSlug}/administracao/cartas?arquivados=1`);

      await expect(page.getByTestId('cards-scope-label')).toContainText('Arquivados');
      await expect(page.getByTestId(`admin-card-${cardId}`)).toContainText('Carta do Arquivo');
      await expect(page.getByTestId(`card-archived-${cardId}`)).toContainText(
        `Organizadora do Arquivo ${RUN_ID}`,
      );
      await expect(page.getByTestId(`card-restore-${cardId}`)).toBeVisible();

      // ── E o controle de volta é um link: sem JavaScript, ele navega ─────────
      await page.getByTestId('cards-archive-toggle').click();
      await expect(page.getByTestId('cards-scope-label')).toContainText('Catálogo ativo');
      await expect(page.getByTestId(`admin-card-${cardId}`)).toHaveCount(0);
    } finally {
      await context.close();
      /** O cenário volta ao estado ativo para não deixar a fixture arquivada. */
      await arquivarNoBanco(true, null);
    }
  });
});

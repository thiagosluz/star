/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Rotinas automáticas no painel de governança (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE CENÁRIO PROVA (e por que não basta o teste de integração)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O teste de integração prova a REGRA da reserva e do registro. Aqui a pergunta é
 *  outra: **a cadeia inteira funciona com a tela no meio?** — o operador clica
 *  "executar agora", a ação enfileira na fila de verdade, o WORKER (container
 *  separado) pega o job, grava `job_runs` com o gatilho MANUAL e a tela passa a
 *  mostrar a execução. Se qualquer elo estiver quebrado (permissão, Redis, worker
 *  sem credencial de plataforma), a integração continuaria verde e isto falharia.
 *
 *  A rotina escolhida é a das PARTIÇÕES da auditoria: é idempotente (criar partição
 *  que já existe é no-op) e não mexe em dado de pessoa nenhuma — o cenário pode
 *  rodar quantas vezes for preciso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, e2eDb, grantPlatformRole } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

const operatorEmail = `f36.rotinas.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;
const commonEmail = `f36.comum.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;

/**
 * As rotinas do catálogo — a tela precisa mostrar TODAS, sem lista própria.
 *
 * A lista é escrita aqui de propósito (e não lida do `JOB_CATALOG`): se a tela passar a
 * montar a própria lista a partir do domínio, um erro de digitação no catálogo não
 * apareceria. A contrapartida é esta linha a mais sempre que uma rotina nasce — a
 * FASE 38 acrescentou `demand-due`.
 */
const JOB_KEYS = [
  'review-deadlines',
  'attendance-sweep',
  'registration-confirmation-sweep',
  'demand-due',
  'file-scan',
  'audit-partitions',
] as const;

async function signUp(api: APIRequestContext, name: string, email: string): Promise<string> {
  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  return user.id;
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/**
 * Execuções MANUAIS concluídas da rotina das partições, direto do banco.
 *
 * É a contagem que transforma "existe uma execução" em "o clique produziu uma
 * execução" — a diferença entre um teste que prova e um teste que passa.
 */
function manualRuns(): Promise<number> {
  return e2eDb.jobRun.count({
    where: { job: 'audit-partitions', status: 'OK', trigger: 'MANUAL' },
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const operatorId = await signUp(api, `Operadora de Rotinas ${RUN_ID}`, operatorEmail);
    await signUp(api, `Pessoa Comum ${RUN_ID}`, commonEmail);

    /**
     * A concessão de plataforma nasce no BANCO: a primeira nunca sai da própria UI
     * (a mesma decisão do E2E da FASE 9).
     */
    await grantPlatformRole({ userId: operatorId });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('rotinas automáticas', () => {
  test('1. a tela não existe para quem não é da plataforma', async ({ page }) => {
    await signInAs(page, commonEmail);

    const response = await page.goto('/superadmin/rotinas');

    /** 404, e não 403: um 403 confirmaria que o painel existe. */
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('platform-jobs')).toHaveCount(0);
  });

  test('2. o operador vê as seis rotinas, com cadência, saúde e histórico', async ({ page }) => {
    await signInAs(page, operatorEmail);

    const response = await page.goto('/superadmin/rotinas');
    expect(response?.status()).toBe(200);

    await expect(page.getByTestId('platform-jobs')).toBeVisible();
    await expect(page.getByTestId('jobs-total')).toContainText(String(JOB_KEYS.length));

    /**
     * O catálogo é a fonte da lista: se uma rotina nova entrar no domínio e a tela
     * não mostrar, este laço falha — o que é exatamente o defeito que se quer evitar
     * (uma rotina que roda e ninguém sabe que existe).
     */
    for (const key of JOB_KEYS) {
      await expect(page.getByTestId(`job-card-${key}`)).toBeVisible();
      await expect(page.getByTestId(`job-health-${key}`)).toBeVisible();
    }

    // A cadência aparece em português, e não como expressão cron crua.
    await expect(page.getByTestId('job-card-audit-partitions')).toContainText('todo dia às 3h');

    // O item do menu do painel leva para a tela.
    await page.goto('/superadmin/metricas');
    await page.getByRole('link', { name: 'Rotinas' }).click();
    await expect(page.getByTestId('platform-jobs')).toBeVisible();
  });

  test('3. "executar agora" enfileira, o worker roda e a execução aparece no histórico', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    /** Quantas execuções MANUAIS já existem — o cenário exige que ESTA some uma. */
    const before = await manualRuns();

    await signInAs(page, operatorEmail);
    await page.goto('/superadmin/rotinas');

    const card = page.getByTestId('job-card-audit-partitions');

    await card.getByTestId('run-job-submit-audit-partitions').click();

    /**
     * A resposta diz a VERDADE: o pedido foi entregue ao worker. A execução ainda não
     * aconteceu — quem a executa é outro processo (o container do worker), e o
     * registro só existe depois que ele termina.
     */
    await expect(card.getByTestId('run-job-feedback-audit-partitions')).toContainText(
      /pedida ao worker/i,
      { timeout: 30_000 },
    );

    /**
     * ─── A PROVA É A DIFERENÇA, E NÃO A EXISTÊNCIA ──────────────────────────────
     *  O banco é a fonte: uma execução MANUAL nova. Contar "existe alguma?" passaria
     *  com o registro de uma execução anterior — um teste que fica verde sem que o
     *  clique tenha feito nada, que é pior que um teste vermelho.
     *
     *  O laço espera porque o registro nasce no WORKER: a tela não tem como saber
     *  quando ele terminou (armadilha 78 — "ainda não chegou" não é "não aconteceu").
     */
    await expect
      .poll(manualRuns, {
        message: 'o clique precisa produzir UMA execução manual nova e concluída',
        timeout: 90_000,
        intervals: [1_000, 2_000, 3_000, 5_000],
      })
      .toBeGreaterThan(before);

    /** E a tela mostra o que o banco já sabe. */
    await page.goto('/superadmin/rotinas');

    const row = page
      .locator('[data-job="audit-partitions"][data-trigger="MANUAL"][data-status="OK"]')
      .first();

    await expect(row).toBeVisible();
    await expect(row).toContainText('pelo painel');

    /** O cartão passa a mostrar a última execução da rotina, com o gatilho dela. */
    await expect(page.getByTestId('job-last-audit-partitions')).toContainText(/pelo painel/i);
  });

  test('4. a ação é auditada como pedido de governança', async ({ page }) => {
    await signInAs(page, operatorEmail);
    await page.goto('/superadmin/rotinas');

    const operator = await e2eDb.user.findUniqueOrThrow({
      where: { email: operatorEmail },
      select: { id: true },
    });

    const entry = await e2eDb.auditLog.findFirst({
      where: { tenantId: null, userId: operator.id, entityType: 'job_schedule' },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, action: true, changes: true },
    });

    /**
     * A trilha guarda quem PEDIU — mesmo que o worker esteja fora do ar. É o ato de
     * governança, e ele não depende do resultado da execução.
     *
     * A rotina é identificada pela CHAVE dentro de `changes`: `entityId` é uma coluna
     * `uuid`, e a chave da rotina (`audit-partitions`) não é um. Este teste existe
     * porque a primeira versão passava a chave ali — e a trilha sumia em silêncio,
     * já que `recordAudit` nunca lança.
     */
    expect(entry, 'o pedido de execução precisa estar na trilha de plataforma').not.toBeNull();
    expect(entry?.action).toBe('UPDATE');
    expect(entry?.entityId).toBeNull();
    expect(entry?.changes).toMatchObject({ chave: { to: 'audit-partitions' } });
  });
});

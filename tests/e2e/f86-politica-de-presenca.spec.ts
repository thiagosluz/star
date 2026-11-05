/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O ORGANIZADOR ESCOLHE A REGRA DE PRESENÇA (FASE 86 · fatia 5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, E POR QUE NENHUM OUTRO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A política vive em `Event.settings.certificatePolicy` e a emissão a lê — mas
 *  até esta fatia não havia TELA: o organizador não tinha como escolher a régua, e
 *  o E2E não tinha como provar que a simulação da F85 reflete uma mudança de
 *  regra. Os dois casos cobrem o caminho inteiro:
 *
 *    1. o organizador (ADMIN, com `event:manage`) abre a tela do evento, vê a
 *       política em vigor (75 % / 30 min), muda para 90 %, salva, VOLTA à tela e
 *       vê 90 % — e os QUATRO contadores da simulação mudam (2 elegíveis → 1;
 *       2 descartes → 4; 4 certificados → 2). O `settings` preserva a chave de
 *       outra fase gravada antes do gesto;
 *    2. quem tem `certificate:issue` e NÃO tem `event:manage` (CHAIR) LÊ a regra e
 *       não recebe o formulário — a tela explica por quê, em vez de esconder.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FIXTURE MEDE A FRONTEIRA, NÃO O MEIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma pessoa com 100 % (60/60), uma com 80 % (48/60) — que passa nos 75 % e falha
 *  nos 90 % — e uma com 10/60. É a pessoa de 80 % que faz o contador mudar quando
 *  a régua sobe; sem ela, os números ficariam iguais e o caso passaria medindo
 *  nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  signOut,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function criarPessoa(
  page: import('@playwright/test').Page,
  input: {
    tenantId: string;
    name: string;
    role: 'ADMIN' | 'CHAIR' | 'PARTICIPANT';
  },
): Promise<{ id: string; email: string; name: string }> {
  const email = `f86.politica.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name: input.name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${input.name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  await linkUser({
    tenantId: input.tenantId,
    userId: user.id,
    kind: input.role === 'PARTICIPANT' ? 'PARTICIPANT' : 'MEMBER',
  });
  await grantRole({ tenantId: input.tenantId, userId: user.id, role: input.role });

  return { id: user.id, email, name: input.name };
}

async function signInAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  await signOut(page);

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/** Presença completa: inscrição `ATTENDED` + minutos registrados no minicurso. */
async function gravarPresenca(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  userId: string;
  minutes: number;
}): Promise<void> {
  const start = new Date(Date.now() - 3 * 3_600_000);

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    const registrationId = randomUUID();

    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'ATTENDED',
        consentData: true,
        checkedInAt: start,
        badgeToken: `BADGE-${registrationId.slice(0, 12)}`,
      },
    });

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        registrationId,
        userId: input.userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: start,
        checkedOutAt: new Date(start.getTime() + input.minutes * 60_000),
        minutesAttended: input.minutes,
      },
    });
  });
}

/** Lê o `settings` gravado do evento — a prova durável do gesto. */
async function lerSettings(tenantId: string, eventId: string): Promise<Record<string, unknown>> {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const row = await tx.event.findFirstOrThrow({
      where: { id: eventId, tenantId },
      select: { settings: true },
    });

    return (row.settings ?? {}) as Record<string, unknown>;
  });
}

test.describe('a política de presença na tela do evento', () => {
  test('1. o organizador muda a regra, salva, volta e vê — e a simulação muda junto', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = await createTenant({
      label: 'f86-politica',
      name: `Instituição da Política ${RUN_ID}`,
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-politica-${RUN_ID}`,
      title: `Congresso da Política ${RUN_ID}`,
    });

    /**
     * Uma chave de OUTRA fase, gravada antes do gesto. Se a Server Action
     * substituísse o `settings` inteiro, ela sumiria — e o defeito passaria
     * despercebido no dia do evento.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.event.update({
        where: { id: event.id },
        data: {
          settings: {
            chaveDeOutraFase: { intacta: true },
          } as unknown as object,
        },
      });
    });

    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `minicurso-politica-${RUN_ID}`,
      title: `Minicurso da Política ${RUN_ID}`,
      workloadMinutes: 60,
      type: 'MINI_COURSE',
    });

    const integral = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Pessoa Integral ${RUN_ID}`,
      role: 'PARTICIPANT',
    });
    const oitenta = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Pessoa Oitenta ${RUN_ID}`,
      role: 'PARTICIPANT',
    });
    const abaixo = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Pessoa Abaixo ${RUN_ID}`,
      role: 'PARTICIPANT',
    });

    await gravarPresenca({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: integral.id,
      minutes: 60,
    });
    // 48 de 60 = 80 %: passa nos 75 % padrão e falha nos 90 % que o organizador vai gravar.
    await gravarPresenca({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: oitenta.id,
      minutes: 48,
    });
    await gravarPresenca({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: abaixo.id,
      minutes: 10,
    });

    const admin = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Organizadora da Política ${RUN_ID}`,
      role: 'ADMIN',
    });

    await signInAs(page, admin.email);

    await page.goto(`/t/${tenant.slug}/administracao/eventos/${event.id}/certificados`);

    /**
     * ─── A POLÍTICA EM VIGOR, ANTES DO GESTO ──────────────────────────────────
     *  Sem configuração, a tela lê o PADRÃO: 75 % e 30 min. E os contadores
     *  mostram 3 pessoas no escopo, 2 elegíveis (a de 80 % passa), 2 descartes
     *  (a de 10 min × 2 tipos) e 4 certificados a emitir.
     */
    const policySection = page.getByTestId('certificate-policy');
    await expect(policySection).toBeVisible();
    await expect(page.getByTestId('certificate-policy-current')).toHaveAttribute(
      'data-min-ratio',
      '0.75',
    );
    await expect(page.getByTestId('certificate-policy-current')).toContainText('75 % da carga');
    await expect(page.getByTestId('certificate-policy-current')).toContainText('30 min');
    await expect(page.getByTestId('certificate-policy-form')).toBeVisible();
    await expect(page.getByTestId('certificate-policy-readonly')).toHaveCount(0);

    await expect(page.getByTestId('issue-scope')).toHaveAttribute('data-value', '3');
    await expect(page.getByTestId('issue-eligible')).toHaveAttribute('data-value', '2');
    await expect(page.getByTestId('issue-discarded-count')).toHaveAttribute('data-value', '2');
    await expect(page.getByTestId('issue-certificates')).toHaveAttribute('data-value', '4');

    // ─── O GESTO: 90 % e 30 min ────────────────────────────────────────────────
    await page.getByTestId('certificate-policy-min-ratio').fill('90');
    await page.getByTestId('certificate-policy-min-minutes').fill('30');
    await page.getByTestId('certificate-policy-save').click();

    await expect(page.getByTestId('certificate-policy-feedback')).toContainText(
      'Política de presença salva',
      { timeout: 30_000 },
    );

    /**
     * ─── VOLTA À TELA: o que está gravado, não o que o formulário lembra ──────
     *  O `reload` é o gesto do organizador no dia seguinte. A tela tem de mostrar
     *  90 % lendo do BANCO — se a política só existisse no estado do formulário, o
     *  caso passaria aqui e falharia na vida real.
     */
    await page.reload();

    await expect(page.getByTestId('certificate-policy-current')).toHaveAttribute(
      'data-min-ratio',
      '0.9',
    );
    await expect(page.getByTestId('certificate-policy-current')).toContainText('90 % da carga');

    /**
     * ─── A SIMULAÇÃO REFLETE A NOVA RÉGUA ─────────────────────────────────────
     *  A pessoa de 80 % deixa de ser elegível: elegíveis 2 → 1, descartes 2 → 4
     *  (ela e a de 10 min, × 2 tipos) e certificados a emitir 4 → 2. O escopo
     *  continua 3 — ninguém saiu da população, só mudou de veredito.
     */
    await expect(page.getByTestId('issue-scope')).toHaveAttribute('data-value', '3');
    await expect(page.getByTestId('issue-eligible')).toHaveAttribute('data-value', '1');
    await expect(page.getByTestId('issue-discarded-count')).toHaveAttribute('data-value', '4');
    await expect(page.getByTestId('issue-certificates')).toHaveAttribute('data-value', '2');

    // O motivo do descarte é o do DOMÍNIO, e cita a régua nova.
    await page.getByTestId('issue-discarded-summary').click();
    const descartados = page.getByTestId('issue-discarded-list');
    await expect(descartados).toContainText(oitenta.name);
    await expect(descartados).toContainText('90 %');

    // ─── A PROVA DURÁVEL: a política gravada e as OUTRAS chaves preservadas ────
    const settings = await lerSettings(tenant.id, event.id);

    expect(settings.certificatePolicy).toEqual({
      minRatio: 0.9,
      minMinutes: 30,
      requireCheckOut: true,
      aggregateBy: 'ACTIVITY',
    });
    expect(settings.chaveDeOutraFase).toEqual({ intacta: true });
  });

  test('2. quem só lê a regra (CHAIR) vê a política e NÃO recebe o formulário', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant = await createTenant({
      label: 'f86-politica-leitura',
      name: `Instituição da Leitura ${RUN_ID}`,
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-leitura-${RUN_ID}`,
      title: `Congresso da Leitura ${RUN_ID}`,
    });

    /**
     * O CHAIR tem `certificate:issue` (abre esta tela) e NÃO tem `event:manage`
     * (não edita a regra). É a combinação que separa LER de MUDAR — e a única que
     * prova que o formulário depende da permissão certa, e não da permissão da
     * página.
     */
    const chair = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Coordenadora Científica ${RUN_ID}`,
      role: 'CHAIR',
    });

    await signInAs(page, chair.email);

    const response = await page.goto(
      `/t/${tenant.slug}/administracao/eventos/${event.id}/certificados`,
    );

    expect(response?.status()).toBe(200);

    // A LEITURA está lá: a política em vigor, com o padrão do evento sem configuração.
    await expect(page.getByTestId('certificate-policy')).toBeVisible();
    await expect(page.getByTestId('certificate-policy-current')).toContainText('75 % da carga');
    await expect(page.getByTestId('certificate-policy-form')).toHaveCount(0);

    // E a tela diz POR QUE não há formulário — esconder em silêncio vira chamado.
    await expect(page.getByTestId('certificate-policy-readonly')).toBeVisible();
    await expect(page.getByTestId('certificate-policy-readonly')).toContainText('event:manage');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Exportação com prazo e trilha de identidade (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS JORNADAS QUE O HUMANO PEDIU
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **Exportar** o diretório de participantes: o pedido nasce com prazo de 24 h,
 *       o arquivo baixa com MARCA D'ÁGUA (autor no topo e em cada linha) e a
 *       exportação aparece na lista da tela, com o botão de revogar;
 *    2. **Revogar** corta o download na hora — o mesmo endereço passa a responder 410;
 *    3. **A trilha de identidade**: quem troca a senha vê o fato na própria área de
 *       conta, e o SuperAdmin vê o MESMO fato na tela de auditoria da plataforma.
 *
 *  O que só o navegador de verdade prova: que o pedido é um POST com volta para a
 *  tela, que o download é um GET autenticado por SESSÃO (não por link assinado) e que
 *  o arquivo que sai tem a marca — não a intenção de ter.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const NEW_PASSWORD = 'senha-nova-f49-2026';

let tenantId: string;
let tenantSlug: string;
let adminEmail: string;
let adminId: string;
let participantEmail: string;
let superAdminEmail: string;

const ADMIN_NAME = 'Administradora da Exportação';

async function signUpVia(api: Page['request'], name: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f49');
  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);

  const body = (await response.json()) as { user: { id: string } };
  const stored = await e2eDb.user.findUniqueOrThrow({ where: { id: body.user.id }, select: { email: true } });

  return { id: body.user.id, email: stored.email };
}

async function signInAs(page: Page, email: string, password = PASSWORD) {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  return page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password },
  });
}

test.beforeAll(async ({ request }) => {
  const tenant = await createTenant({
    label: 'f49',
    name: `Instituição Exportação ${RUN_ID}`,
  });
  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const event = await e2eDb.event.create({
    data: {
      tenantId,
      slug: `f49-evento-${RUN_ID}`,
      title: 'Congresso da Exportação',
      status: 'PUBLISHED',
      modality: 'IN_PERSON',
      startsAt: new Date('2026-09-01T12:00:00Z'),
      endsAt: new Date('2026-09-03T21:00:00Z'),
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });

  const admin = await signUpVia(request, ADMIN_NAME);
  adminId = admin.id;
  adminEmail = admin.email;
  await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
  await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });

  const participant = await signUpVia(request, 'Participante da Exportação');
  participantEmail = participant.email;
  await linkUser({ userId: participant.id, tenantId, kind: 'PARTICIPANT' });

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        tenantId,
        eventId: event.id,
        activityId: null,
        userId: participant.id,
        status: 'CONFIRMED',
      },
    });
  });

  /** O SuperAdmin é quem lê a trilha de identidade (a conta é global). */
  const platform = await signUpVia(request, 'SuperAdmin da Auditoria');
  superAdminEmail = platform.email;
  await grantPlatformRole({ userId: platform.id });
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('exportação com prazo e marca d\'água', () => {
  test('o pedido, o arquivo marcado e a revogação que corta na hora', async ({ page }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${tenantSlug}/participantes`);

    const notice = page.getByTestId('export-participants-notice');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText('24 horas');
    await expect(notice).toContainText('em cada linha');

    await page.getByTestId('export-participants-create').click();

    const ready = page.getByTestId('export-participants-ready');
    await expect(ready).toBeVisible({ timeout: 20_000 });

    const href = await page.getByTestId('export-participants-download').getAttribute('href');
    expect(href).toBeTruthy();

    // ── O ARQUIVO ────────────────────────────────────────────────────────────
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()['x-exportacao-horas']).toBe('24');

    const body = await response.text();
    expect(body).toContain('# Exportado por:');
    expect(body).toContain(ADMIN_NAME);
    expect(body).toContain('válido até');

    const dataLine = body
      .split('\r\n')
      .find((line) => line.includes(participantEmail) && !line.startsWith('#'));

    expect(dataLine, 'a linha do participante tem de estar no arquivo').toBeDefined();
    expect(dataLine).toContain(ADMIN_NAME);
    expect(dataLine).toContain('válido até');

    // ── A LISTA DE EXPORTAÇÕES RECENTES ──────────────────────────────────────
    const list = page.getByTestId('export-participants-recent');
    await expect(list).toBeVisible();
    await expect(list).toContainText('válida por');

    // ── REVOGAR CORTA NA HORA ────────────────────────────────────────────────
    const revoke = page.locator('[data-testid^="export-participants-revoke-"]').first();
    await revoke.click();

    await expect(page.getByTestId('export-participants-ready')).toBeHidden({ timeout: 20_000 });

    await expect
      .poll(async () => (await page.request.get(href!)).status(), { timeout: 20_000 })
      .toBe(410);

    const revokedBody = await (await page.request.get(href!)).json();
    expect(JSON.stringify(revokedBody)).toContain('revogada');
  });

  test('sem sessão o download não acontece (não é link assinado)', async ({ page, browser }) => {
    await signInAs(page, adminEmail);
    await page.goto(`/t/${tenantSlug}/participantes`);
    await page.getByTestId('export-participants-create').click();

    const href = await page
      .getByTestId('export-participants-download')
      .getAttribute('href', { timeout: 20_000 });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  UM NAVEGADOR SEM COOKIE NENHUM — E NÃO "A MESMA PÁGINA DESLOGADA"
     * ─────────────────────────────────────────────────────────────────────────────
     *  A primeira versão deste teste saía da conta com `sign-out` e reusava a mesma
     *  requisição: o download voltava **200**, porque o contexto do Playwright
     *  continuava com a sessão. Um contexto NOVO é a única prova honesta de que o
     *  endereço, sozinho, não baixa nada — que é a propriedade em teste.
     */
    const anonimo = await browser.newContext();
    const response = await anonimo.request.get(href!);

    expect(response.status()).toBe(401);
    await anonimo.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('trilha de identidade', () => {
  test('quem troca a senha vê o fato na conta, e o SuperAdmin vê o mesmo fato na auditoria', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);
    await page.goto('/conta');

    /**
     * A lista só existe DEPOIS do primeiro fato de segurança — quem nunca mexeu na
     * conta vê o estado vazio (`account-security-empty`). Por isso não há asserção
     * antes da troca de senha: ela seria sobre a fixture, não sobre o produto.
     *
     * ─────────────────────────────────────────────────────────────────────────────
     *  A TROCA É PELA TELA, E É ISSO QUE O TESTE PRENDE
     * ─────────────────────────────────────────────────────────────────────────────
     *  Se o registro do fato não estivesse ligado no ponto que conhece o ato, a senha
     *  mudaria e a trilha ficaria vazia — o produto "funcionaria" com a auditoria em
     *  branco, que é o defeito que a dívida E67 descrevia.
     */
    await page.getByTestId('account-current-password').fill(PASSWORD);
    await page.getByTestId('account-new-password').fill(NEW_PASSWORD);
    await page.getByTestId('account-confirm-password').fill(NEW_PASSWORD);
    await page.getByTestId('save-account-password').click();

    await expect(page.getByTestId('account-password-feedback-ok')).toContainText(/outras sessões/i, {
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByTestId('account-security-list')).toContainText('Senha alterada', {
      timeout: 20_000,
    });

    // ── O SuperAdmin lê a MESMA trilha, na tela de plataforma ────────────────
    await signInAs(page, superAdminEmail);
    await page.goto('/superadmin/auditoria');

    await expect(page.getByTestId('identity-audit-list')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('identity-filter-event').selectOption('PASSWORD_CHANGED');
    await page.getByTestId('identity-filter-apply').click();

    await expect(page.getByTestId('identity-audit-list')).toContainText('Senha alterada', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('identity-audit-list')).toContainText(ADMIN_NAME);

    /** A tela NÃO mostra segredo: o detalhe do fato é estado, não credencial. */
    const body = await page.getByTestId('identity-audit-list').innerText();
    expect(body).not.toContain(NEW_PASSWORD);
    expect(body).not.toContain(PASSWORD);

    /**
     * E o BANCO também não. A asserção fica NESTA jornada porque as fixtures
     * (`tenantId`, `adminId`) são por WORKER do Playwright: um teste separado olharia
     * outra conta, criada por outro worker, que nunca trocou senha.
     */
    const registros = await e2eDb.identityAuditLog.findMany({
      where: { userId: adminId },
      select: { event: true, details: true },
    });

    expect(registros.some((row) => row.event === 'PASSWORD_CHANGED')).toBe(true);

    const serialized = JSON.stringify(registros);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain(PASSWORD);
  });

  test('a área de conta mostra o histórico SÓ da própria pessoa', async ({ page }) => {
    await signInAs(page, participantEmail);
    await page.goto('/conta');

    const list = page.getByTestId('account-security-list');

    /**
     * A participante nunca trocou nada: ou não há histórico, ou o que existe é dela.
     * O que NÃO pode acontecer é o fato da administradora aparecer aqui.
     */
    const visible = await list.isVisible().catch(() => false);

    if (visible) {
      await expect(list).not.toContainText(PASSWORD);
      await expect(list).not.toContainText(ADMIN_NAME);
    } else {
      await expect(page.getByTestId('account-security-empty')).toBeVisible();
    }
  });
});
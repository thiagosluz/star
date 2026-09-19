/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Comunicação (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PROVA NO NAVEGADOR (E NÃO NO BANCO)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. A instituição CONVIDA pela tela de equipe e vê o link do convite UMA vez
 *     (o banco guarda só o hash — sem o painel, o código se perde).
 *  2. A caixa de saída mostra a mensagem que a plataforma registrou, com o aviso
 *     de que o envio real está desligado no ambiente de teste.
 *  3. Quem foi convidado entra com a conta DAQUELE endereço, aceita e passa a ser
 *     membro — o vínculo nasce do aceite, não do convite.
 *  4. Cancelar um convite pendente passa pelo DIÁLOGO DO SISTEMA e o estado muda.
 *  5. O aviso de e-mail não confirmado aparece no shell e o reenvio responde.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import {
  RUN_ID,
  cleanupRun,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

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
  email: string,
): Promise<string> {
  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: ORIGIN,
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return user.id;
}

/** Entra com uma conta existente, saindo da anterior (armadilha 9). */
async function signIn(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: ORIGIN });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: ORIGIN,
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao entrar como ${email}: HTTP ${response.status()}`);
}

test.describe('convite de equipe, caixa de saída e verificação de e-mail', () => {
  test('convida, o convidado aceita e passa a ser membro da equipe', async ({ page }) => {
    const tenant = await createTenant({
      label: 'comunicacao',
      name: `Instituição Comunicação ${RUN_ID}`,
    });

    const adminEmail = uniqueEmail('admin-comunicacao');
    const adminId = await signUpAndSignIn(page, 'Administradora', adminEmail);
    await linkUser({ tenantId: tenant.id, userId: adminId });
    await grantRole({ tenantId: tenant.id, userId: adminId, role: 'ADMIN' });

    const invitedEmail = uniqueEmail('convidada');

    await page.goto(`/t/${tenant.slug}/administracao/equipe`);
    await expect(page.getByTestId('invite-member-form')).toBeVisible();

    // ── Convite ──────────────────────────────────────────────────────────────
    await page.getByLabel('E-mail da pessoa').fill(invitedEmail);
    await page.getByLabel('Papel na instituição').selectOption('STAFF');
    await page.getByLabel('Recado (opcional)').fill('Bem-vinda ao credenciamento!');
    await page.getByTestId('invite-member-submit').click();

    await expect(page.getByTestId('invite-member-success')).toBeVisible();

    const inviteUrl = await page.getByTestId('invite-member-link').inputValue();
    expect(inviteUrl).toContain(`/t/${tenant.slug}/convite?codigo=`);

    // O convite aparece na lista, pendente.
    const row = page.locator('[data-invitation-id]').filter({ hasText: invitedEmail });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Convite pendente');

    // ── Caixa de saída ───────────────────────────────────────────────────────
    await page.goto(`/t/${tenant.slug}/administracao/comunicacao`);
    await expect(page.getByTestId('communication-page')).toBeVisible();
    await expect(page.getByTestId('communication-driver-notice')).toBeVisible();

    const messages = page.getByTestId('communication-messages');
    await expect(messages).toContainText('Convite de equipe');

    // O endereço aparece MASCARADO: é dado pessoal, e o domínio já identifica.
    await expect(messages).toContainText(invitedEmail.split('@')[1]);

    // ── Aceite, com a conta do endereço convidado ────────────────────────────
    await signUpAndSignIn(page, 'Convidada', invitedEmail);

    await page.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByTestId('invitation-details')).toBeVisible();
    await expect(page.getByTestId('invitation-email')).toHaveText(invitedEmail);
    await expect(page.getByTestId('invitation-role')).toHaveText('Equipe de operação');

    await page.getByTestId('accept-invitation-submit').click();

    // O aceite leva ao painel da instituição — o vínculo passou a existir.
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard`));

    // ── A equipe agora tem a nova pessoa ─────────────────────────────────────
    await signIn(page, adminEmail);
    await page.goto(`/t/${tenant.slug}/administracao/equipe`);

    await expect(page.getByTestId('team-members')).toContainText('Convidada');
    await expect(page.getByTestId('team-members')).toContainText(invitedEmail);

    // E o convite saiu de pendente.
    const acceptedRow = page.locator('[data-invitation-id]').filter({ hasText: invitedEmail });
    await expect(acceptedRow).toContainText('Convite aceito');
  });

  test('cancelar um convite pendente usa o diálogo do sistema', async ({ page }) => {
    const tenant = await createTenant({
      label: 'comunicacao-cancelar',
      name: `Instituição Cancelamento ${RUN_ID}`,
    });

    const adminEmail = uniqueEmail('admin-cancelamento');
    const adminId = await signUpAndSignIn(page, 'Administrador', adminEmail);
    await linkUser({ tenantId: tenant.id, userId: adminId });
    await grantRole({ tenantId: tenant.id, userId: adminId, role: 'ADMIN' });

    const invitedEmail = uniqueEmail('cancelada');

    await page.goto(`/t/${tenant.slug}/administracao/equipe`);
    await page.getByLabel('E-mail da pessoa').fill(invitedEmail);
    await page.getByTestId('invite-member-submit').click();
    await expect(page.getByTestId('invite-member-success')).toBeVisible();

    const row = page.locator('[data-invitation-id]').filter({ hasText: invitedEmail });
    await row.getByRole('button', { name: 'Cancelar convite' }).click();

    // O diálogo do sistema pergunta antes; o botão que executa NOMEIA a ação.
    await page.getByTestId(/revoke-invitation-.*-confirm-confirm/).click();

    await expect(row).toContainText('Convite cancelado');
  });

  test('o shell avisa que o e-mail não está confirmado e permite reenviar', async ({ page }) => {
    const tenant = await createTenant({
      label: 'comunicacao-verificacao',
      name: `Instituição Verificação ${RUN_ID}`,
    });

    const email = uniqueEmail('naoverificada');
    const userId = await signUpAndSignIn(page, 'Pessoa Não Verificada', email);
    await linkUser({ tenantId: tenant.id, userId });
    await grantRole({ tenantId: tenant.id, userId, role: 'STAFF' });

    await page.goto(`/t/${tenant.slug}/dashboard`);

    const notice = page.getByTestId('verification-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(email);

    await page.getByTestId('resend-verification-submit').click();

    // A confirmação de que o envio foi registrado — e o aviso sai de cena.
    await expect(notice).toContainText('Confirmação enviada');

    // A mensagem existe no outbox da PLATAFORMA (sem instituição).
    const stored = await e2eDb.emailMessage.findFirst({
      where: { to: email, template: 'EMAIL_VERIFICATION' },
      orderBy: { createdAt: 'desc' },
      select: { tenantId: true, status: true },
    });

    expect(stored).toBeTruthy();
    expect(stored?.tenantId).toBeNull();
    expect(['QUEUED', 'SENT']).toContain(stored?.status);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Escopo de equipe no credenciamento (FASE 12, item I7)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE TESTE FECHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela de credenciamento exigia permissão de escopo INSTITUIÇÃO. O próprio seed
 *  de demonstração concede `STAFF` por EVENTO (a equipe do dia, com validade) — e o
 *  resultado era a plataforma recusar o padrão que ela mesma recomenda: a pessoa
 *  era redirecionada ao painel ao abrir a tela.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELE PROVA, ALÉM DO ACESSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Que o escopo estreito NÃO virou acesso largo: a equipe do evento A credencia o
 *  evento A e **não enxerga** o evento B da mesma instituição. Aceitar o escopo de
 *  evento na guarda sem filtrar a listagem seria trocar um defeito por outro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import {
  RUN_ID,
  cleanupRun,
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

async function signUpAndSignIn(
  page: import('@playwright/test').Page,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('equipe');
  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });
  const signIn = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!signIn.ok()) throw new Error(`Falha ao autenticar ${name}: HTTP ${signIn.status()}`);

  return { id: user.id, email };
}

test.describe('equipe com escopo de evento', () => {
  test('acessa o credenciamento e enxerga APENAS o evento em que é equipe', async ({ page }) => {
    const tenant = await createTenant({
      label: 'equipe-evento',
      name: `Instituição Equipe ${RUN_ID}`,
    });

    const ownEvent = await createEvent({
      tenantId: tenant.id,
      slug: `evento-equipe-${RUN_ID}`,
      title: `Congresso da Equipe ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    // Criado de propósito: é o evento que a equipe NÃO deve enxergar.
    await createEvent({
      tenantId: tenant.id,
      slug: `evento-alheio-${RUN_ID}`,
      title: `Evento Sem Equipe ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    const staff = await signUpAndSignIn(page, 'Equipe do Dia');

    await linkUser({ tenantId: tenant.id, userId: staff.id });
    await grantRole({
      tenantId: tenant.id,
      userId: staff.id,
      role: 'STAFF',
      scope: 'EVENT',
      eventId: ownEvent.id,
    });

    const response = await page.goto(`/t/${tenant.slug}/credenciamento`);

    // Antes da FASE 12 isto era 307 para o painel.
    expect(response?.status()).toBe(200);

    const eventSelect = page.getByLabel('Evento');
    await expect(eventSelect).toBeVisible();
    await expect(eventSelect).toContainText(`Congresso da Equipe ${RUN_ID}`);

    // O evento do colega NÃO aparece: escopo estreito não vira acesso largo.
    await expect(eventSelect).not.toContainText(`Evento Sem Equipe ${RUN_ID}`);
    await expect(page.getByText(`Evento Sem Equipe ${RUN_ID}`)).toHaveCount(0);
  });

  test('a equipe do dia continua sem acesso ao painel administrativo', async ({ page }) => {
    const tenant = await createTenant({
      label: 'equipe-admin',
      name: `Instituição Sem Admin ${RUN_ID}`,
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-admin-${RUN_ID}`,
      title: `Evento Administrativo ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });

    const staff = await signUpAndSignIn(page, 'Equipe Sem Administração');

    await linkUser({ tenantId: tenant.id, userId: staff.id });
    await grantRole({
      tenantId: tenant.id,
      userId: staff.id,
      role: 'STAFF',
      scope: 'EVENT',
      eventId: event.id,
    });

    /**
     * `STAFF` não administra. A asserção é sobre a URL FINAL, e não sobre o status:
     * `page.goto` segue o redirecionamento, então a resposta que chega já é a do
     * painel (200). Foi o que este teste aprendeu na primeira execução — esperar
     * `307` aqui reprova um comportamento correto.
     */
    await page.goto(`/t/${tenant.slug}/administracao`);

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard`));
    await expect(page.getByTestId('admin-stats')).toHaveCount(0);
  });
});

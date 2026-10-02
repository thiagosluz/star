import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { RUN_ID, createTenant, e2eDb, grantRole, linkUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 59 — o item "Área do patrocinador" no menu (DEFEITO relatado)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O relato veio do uso: uma pessoa **REVIEWER** e outra **OWNER** viam "Área do
 *  patrocinador" na barra lateral, e a própria página respondia *"Você não está
 *  vinculado a nenhum patrocinador desta instituição."*
 *
 *  A causa era `sponsor:read` decidindo o item — permissão que está no pacote mínimo de
 *  quem participa (é ela que deixa a PÁGINA abrir para mostrar o convite). O item passou
 *  a depender do VÍNCULO (`sponsor_users` ativo), e este cenário prende os dois lados no
 *  NAVEGADOR: sem vínculo o item não existe; com vínculo ele existe como ÁREA.
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f59-patrocinador-${RUN_ID}`;

let tenantId: string;
let tenantSlug: string;
let revisor: { id: string; email: string };
let patrocinador: { id: string; email: string };

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f59.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da barra ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    revisor = await signUpVia(api, 'Revisor sem vínculo');
    patrocinador = await signUpVia(api, 'Pessoa do patrocínio');

    /** A pessoa do relato: vínculo ativo + papel REVIEWER, e nenhum patrocínio. */
    await linkUser({ tenantId, userId: revisor.id });
    await grantRole({ tenantId, userId: revisor.id, role: 'REVIEWER' });

    /** A outra ponta: MEMBER comum, que VAI ser vinculada a um patrocinador. */
    await linkUser({ tenantId, userId: patrocinador.id });
    await grantRole({ tenantId, userId: patrocinador.id, role: 'PARTICIPANT' });

    const sponsor = await e2eDb.sponsor.create({
      data: {
        id: randomUUID(),
        tenantId,
        name: `Patrocinador ${RUN_ID}`,
        slug: `patrocinador-${RUN_ID}`,
      },
      select: { id: true },
    });

    await e2eDb.sponsorUser.create({
      data: {
        id: randomUUID(),
        tenantId,
        sponsorId: sponsor.id,
        userId: patrocinador.id,
        status: 'ACTIVE',
        acceptedAt: new Date(),
      },
    });
  } finally {
    await api.dispose();
  }
});

test('1. quem NÃO tem vínculo não vê o item — nem o revisor, nem o dono', async ({ page }) => {
  await signInAs(page, revisor.email);
  await page.goto(`/t/${tenantSlug}/dashboard`);

  const navegacao = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(navegacao).toBeVisible({ timeout: 30_000 });

  /** O relato: o item aparecia aqui, e a página dizia que não havia vínculo. */
  await expect(navegacao.getByText('Área do patrocinador')).toHaveCount(0);
  await expect(navegacao.getByText('Convite de patrocinador')).toHaveCount(0);

  /**
   * E a PÁGINA continua alcançável (é a porta do convite) — o que mudou foi o MENU, não
   * o acesso. Sem isso, o teste passaria por esconder a área em vez de corrigir o menu.
   */
  await page.goto(`/t/${tenantSlug}/patrocinador`);
  await expect(page.getByText(/não está vinculado a nenhum patrocinador/i)).toBeVisible({
    timeout: 30_000,
  });
});

test('2. quem TEM vínculo vê o item, como ÁREA', async ({ page }) => {
  await signInAs(page, patrocinador.email);
  await page.goto(`/t/${tenantSlug}/dashboard`);

  const navegacao = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(navegacao.getByText('Área do patrocinador')).toBeVisible({ timeout: 30_000 });
  await expect(navegacao.getByText('Convite de patrocinador')).toHaveCount(0);
});

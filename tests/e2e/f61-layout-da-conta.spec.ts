import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { RUN_ID, createTenant, e2eDb, grantRole, linkUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 61 — o bloco de conta NÃO PODE ESTOURAR A BARRA (defeito relatado)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O relato veio com imagem: depois de o controle de tema entrar no bloco de conta, o
 *  botão de SAIR apareceu cortado na borda da barra lateral. A causa é a armadilha
 *  clássica do flexbox: o seletor de instituição é um `<details>` (item flex) e, sem
 *  `min-w-0`, não encolhe abaixo do próprio conteúdo — a linha empurra os dois botões
 *  para fora em vez de truncar o nome.
 *
 *  O projeto declara a dívida **H6** ("regressão visual com `toHaveScreenshot`") e não
 *  tem esse tipo de prova. Este arquivo é a versão BARATA dela para o caso relatado:
 *  mede a GEOMETRIA — o botão de sair tem de terminar DENTRO da barra, e os dois
 *  controles têm de continuar visíveis — nos três estados em que o bloco aparece
 *  (barra inteira, barra recolhida e gaveta do celular).
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f61-conta-${RUN_ID}`;

let tenantSlug: string;
let email: string;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const endereco = `f61.conta.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email: endereco, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email: endereco }, select: { id: true } });
  return { id: user.id, email: endereco };
}

async function signInAs(page: import('@playwright/test').Page, endereco: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email: endereco, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${endereco}: HTTP ${response.status()}`);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do bloco de conta ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    const pessoa = await signUpVia(api, 'Dona da Conta Com Um Nome Bem Comprido');

    email = pessoa.email;
    await linkUser({ tenantId: tenant.id, userId: pessoa.id });
    await grantRole({ tenantId: tenant.id, userId: pessoa.id, role: 'OWNER' });
  } finally {
    await api.dispose();
  }
});

/** A régua: o botão de sair termina DENTRO da caixa que o contém. */
async function esperaCaber(
  page: import('@playwright/test').Page,
  container: import('@playwright/test').Locator,
  tela: string,
): Promise<void> {
  const caixa = await container.boundingBox();
  const sair = await container.getByTestId('sign-out').boundingBox();
  const tema = await container.getByTestId('account-theme-menu').boundingBox();

  expect(caixa, `${tela}: container sem caixa`).not.toBeNull();
  expect(sair, `${tela}: botão de sair sem caixa`).not.toBeNull();
  expect(tema, `${tela}: controle de tema sem caixa`).not.toBeNull();

  const limite = caixa!.x + caixa!.width;

  expect(
    sair!.x + sair!.width,
    `${tela}: o botão de sair passa da borda (relato da FASE 61)`,
  ).toBeLessThanOrEqual(limite + 0.5);

  expect(tema!.x + tema!.width, `${tela}: o controle de tema passa da borda`).toBeLessThanOrEqual(
    limite + 0.5,
  );
}

test('1. na barra inteira, os três controles cabem', async ({ page }) => {
  await signInAs(page, email);
  await page.goto(`/t/${tenantSlug}/dashboard`);

  const barra = page.locator('aside[data-nav]');
  await expect(barra).toHaveAttribute('data-nav', 'full');
  await expect(barra.getByTestId('sign-out')).toBeVisible();

  await esperaCaber(page, barra, 'barra inteira');
});

test('2. na barra RECOLHIDA os dois botões continuam dentro', async ({ page, baseURL }) => {
  await signInAs(page, email);

  await page.context().addCookies([
    { name: 'ef_nav', value: 'rail', url: baseURL ?? 'http://localhost:3000' },
  ]);

  await page.goto(`/t/${tenantSlug}/dashboard`);

  const barra = page.locator('aside[data-nav]');
  await expect(barra).toHaveAttribute('data-nav', 'rail');

  await esperaCaber(page, barra, 'barra recolhida');
});

test('3. na gaveta do celular os dois botões continuam dentro', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, email);
  await page.goto(`/t/${tenantSlug}/dashboard`);

  await page.getByTestId('open-navigation').click();

  const gaveta = page.getByTestId('mobile-navigation');
  await expect(gaveta).toBeVisible();

  /**
   * A gaveta desliza em 200 ms (`transition-transform`), e `toBeVisible` NÃO espera a
   * animação: medir na hora pega a caixa no meio do caminho e acusa uma borda que não
   * existe. O `poll` repete a MEDIÇÃO até a geometria assentar — que é o que o olho do
   * usuário vê.
   */
  await expect
    .poll(
      async () => {
        const caixa = await gaveta.boundingBox();
        const sair = await gaveta.getByTestId('sign-out').boundingBox();
        const tema = await gaveta.getByTestId('account-theme-menu').boundingBox();

        if (!caixa || !sair || !tema) return Number.POSITIVE_INFINITY;

        const limite = caixa.x + caixa.width;
        return Math.max(sair.x + sair.width - limite, tema.x + tema.width - limite);
      },
      { message: 'gaveta do celular: os controles passam da borda' },
    )
    .toBeLessThanOrEqual(0.5);
});

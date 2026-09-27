/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Carta colecionável premium e compartilhamento (FASE 48)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PROVA, DE PONTA A PONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. o álbum mostra a carta com brilho, e a página da carta gira de verdade
 *         (o giro é medido na variável CSS que o navegador aplica);
 *      2. virar mostra o VERSO, reiniciar volta e a luz do palco acende;
 *      3. o link público abre para quem NÃO tem sessão e mostra SÓ a carta;
 *      4. a imagem de prévia que o link anuncia existe e é PNG (o `next/og`
 *         desenha a carta — sem isso o link vira tarja cinza no WhatsApp);
 *      5. revogar corta o acesso na hora;
 *      6. SEM JavaScript a carta e a ficha continuam na página (o efeito é enfeite).
 *
 *  Roda contra o container de produção: Proxy, Server Action, RLS e a rota de
 *  imagem exercitados como o participante (e o rastreador de rede social) usam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const CARD_NAME = 'Guardião do Método';
const CARD_SLUG = 'guardiao-do-metodo';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function createUser(
  page: import('@playwright/test').Page,
  tenantId: string,
  name: string,
  options: { publicHandle?: string; audiences?: Record<string, string> } = {},
): Promise<{ id: string; email: string }> {
  const email = `premium.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  await linkUser({ tenantId, userId: user.id });
  await grantRole({ tenantId, userId: user.id, role: 'PARTICIPANT' });

  if (options.publicHandle || options.audiences) {
    await e2eDb.user.update({
      where: { id: user.id },
      data: {
        publicHandle: options.publicHandle ?? null,
        profileAudiences: (options.audiences ?? {}) as object,
      },
    });
  }

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

/** Carta com apresentação premium + a carta no álbum da pessoa. */
async function givePremiumCard(tenantId: string, userId: string): Promise<void> {
  const templateId = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.cardTemplate.create({
      data: {
        id: templateId,
        tenantId,
        slug: CARD_SLUG,
        name: CARD_NAME,
        description: 'Concedida por concluir um parecer.',
        lore: 'O trabalho invisível que sustenta a ciência',
        rarity: 'LEGENDARY',
        trigger: 'REVIEW_COMPLETED',
        palette: { primary: '#7c3aed', secondary: '#3b0764', glow: '#c084fc', text: '#faf5ff' },
        art: { holo: true, sheen: 80, tilt: 70, particle: 'sparkle' },
      },
    });

    await tx.userCard.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId,
        cardTemplateId: templateId,
        quantity: 2,
        source: 'REVIEW_COMPLETED',
        grantedAt: new Date('2026-03-12T15:00:00Z'),
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('carta premium e compartilhamento', () => {
  test('1. o álbum gira, o verso mostra a ficha e o link público mostra só a carta', async ({
    page,
    browser,
  }) => {
    const tenant = await createTenant({
      label: 'cartapremium',
      name: `Instituição cartapremium ${RUN_ID}`,
    });
    const participant = await createUser(page, tenant.id, 'Ana Premium');
    await givePremiumCard(tenant.id, participant.id);

    await signInAs(page, participant.email);
    // ── 1. O álbum mostra a carta e leva para a página dela ──────────────────
    await page.goto(`/t/${tenant.slug}/cartas`);

    await expect(page.getByTestId('owned-cards')).toContainText(CARD_NAME);

    const stage = page.getByTestId(`album-card-${CARD_NAME}`);
    await expect(stage).toBeVisible();
    await expect(stage).toHaveAttribute('data-holo', 'on');

    await page.getByTestId(`album-card-link-${CARD_SLUG}`).click();

    // ── 2. A página da carta: palco, giro medido e ficha ────────────────────
    await expect(page.getByTestId('card-title')).toHaveText(CARD_NAME);

    const holo = page.getByTestId(`holo-card-${CARD_NAME}`);
    await expect(holo).toBeVisible();
    await expect(holo).toHaveAttribute('data-holo', 'on');

    const box = await holo.boundingBox();
    if (!box) throw new Error('palco da carta sem medida');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    /**
     * O giro é lido na VARIÁVEL CSS que o componente escreve — é o mesmo valor que
     * o navegador usa no `transform`. Assertar "tem classe de efeito" passaria
     * mesmo com o cálculo quebrado.
     */
    const tiltY = await holo.evaluate((el) => el.style.getPropertyValue('--ef-holo-tilt-y'));
    expect(Number.parseFloat(tiltY)).toBeGreaterThan(5);

    // ── 3. Virar mostra o verso; reiniciar volta ────────────────────────────
    await page.getByTestId('card-flip').click();
    await expect(holo).toHaveAttribute('data-flipped', 'on');
    await expect(page.getByTestId(`card-back-${CARD_NAME}`)).toContainText('Você concluiu um parecer');

    await page.getByTestId('card-reset').click();
    await expect(holo).toHaveAttribute('data-flipped', 'off');

    // ── 4. A luz do palco acende ────────────────────────────────────────────
    await page.getByTestId('card-light').click();
    await expect(holo).toHaveClass(/ef-holo-stage-lit/);

    // A ficha em texto está na página (não depende do efeito).
    await expect(page.getByTestId('card-sheet')).toContainText('Você concluiu um parecer');
    await expect(page.getByTestId('card-sheet')).toContainText('12/03/2026');

    // ── 5. O link público ───────────────────────────────────────────────────
    await expect(page.getByTestId('share-panel')).toContainText('Ana Premium');

    await page.getByTestId('share-create').click();

    const shareUrl = page.getByTestId('share-url');
    await expect(shareUrl).toHaveValue(/\/carta\/[A-Za-z0-9_-]{16,}$/, { timeout: 20_000 });

    const url = await shareUrl.inputValue();
    const token = url.split('/').pop() ?? '';
    const publicPath = `/t/${tenant.slug}/carta/${token}`;

    // ── 6. Quem abrir vê SÓ a carta (contexto novo, sem sessão) ─────────────
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();

    try {
      const response = await visitor.goto(publicPath);
      expect(response?.status()).toBe(200);

      await expect(visitor.getByTestId('shared-card-title')).toHaveText(CARD_NAME);
      await expect(visitor.getByTestId('shared-card-owner')).toContainText('Ana Premium');

      const content = (await visitor.content()).toLowerCase();
      expect(content).not.toContain(participant.email.toLowerCase());
      expect(content).not.toContain('/u/'); // o perfil não é atalho a partir da carta

      /**
       * ── A IMAGEM DA PRÉVIA ────────────────────────────────────────────────
       *  O `og:image` é lido do HTML e BAIXADO: é a única forma de provar que a
       *  rota do `next/og` existe, responde e devolve PNG — o que decide se o link
       *  aparece com a carta ou com uma tarja cinza no grupo.
       */
      const ogImage = await visitor.locator('meta[property="og:image"]').first().getAttribute('content');
      expect(ogImage).toBeTruthy();

      const image = await visitor.request.get(ogImage ?? '');
      expect(image.status()).toBe(200);
      expect(image.headers()['content-type']).toContain('image/png');
      expect((await image.body()).byteLength).toBeGreaterThan(5_000);
    } finally {
      await anonymous.close();
    }

    // ── 7. Revogar corta o acesso ───────────────────────────────────────────
    await page.getByTestId('share-revoke').click();

    /**
     * O sinal de que a revogação FOI APLICADA é o painel voltar ao estado "criar
     * link". Esperar o botão ficar desabilitado não prova nada: ele nasce
     * desabilitado enquanto a action está em voo, e o teste seguiria antes de o
     * servidor gravar a revogação.
     */
    await expect(page.getByTestId('share-create')).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(async () => (await page.request.get(publicPath)).status(), { timeout: 20_000 })
      .toBe(404);
  });

  test('2. SEM JavaScript a carta e a ficha continuam na página', async ({ page, browser }) => {
    const tenant = await createTenant({
      label: 'cartasemjs',
      name: `Instituição cartasemjs ${RUN_ID}`,
    });
    const participant = await createUser(page, tenant.id, 'Bruno Sem JS');
    await givePremiumCard(tenant.id, participant.id);

    const context = await browser.newContext({ javaScriptEnabled: false });
    const noJs = await context.newPage();

    try {
      await signInAs(noJs, participant.email);

      await noJs.goto(`/t/${tenant.slug}/cartas`);
      await expect(noJs.getByTestId('owned-cards')).toContainText(CARD_NAME);

      await noJs.goto(`/t/${tenant.slug}/cartas/${CARD_SLUG}`);

      // A carta (estática) e a ficha completa estão no HTML entregue pelo servidor.
      await expect(noJs.getByTestId('card-title')).toHaveText(CARD_NAME);
      await expect(noJs.getByTestId('card-sheet')).toContainText('Você concluiu um parecer');
      await expect(noJs.getByTestId('card-sheet')).toContainText('Variante');
      await expect(noJs.getByTestId('card-sheet')).toContainText('Cópias');

      /** Criar o link é um POST de formulário: funciona sem o bundle carregar. */
      await noJs.getByTestId('share-create').click();
      await expect(noJs.getByTestId('share-url')).toHaveValue(/\/carta\/[A-Za-z0-9_-]{16,}$/, {
        timeout: 20_000,
      });
    } finally {
      await context.close();
    }
  });

  test('3. nome privado vira @handle no link, e o nome de cadastro não vaza', async ({
    page,
    browser,
  }) => {
    const handle = `privado${RUN_ID}`.toLowerCase();
    const tenant = await createTenant({
      label: 'cartaprivada',
      name: `Instituição cartaprivada ${RUN_ID}`,
    });
    const participant = await createUser(page, tenant.id, 'Carla Nome Privado', {
      publicHandle: handle,
      audiences: { displayName: 'PRIVATE' },
    });
    await givePremiumCard(tenant.id, participant.id);

    await signInAs(page, participant.email);
    await page.goto(`/t/${tenant.slug}/cartas/${CARD_SLUG}`);

    // A tela AVISA o que o link vai mostrar, antes de criar.
    await expect(page.getByTestId('share-preview-of-name')).toContainText(`@${handle}`);

    await page.getByTestId('share-create').click();
    await expect(page.getByTestId('share-url')).toHaveValue(/\/carta\/[A-Za-z0-9_-]{16,}$/, {
      timeout: 20_000,
    });

    const url = await page.getByTestId('share-url').inputValue();
    const token = url.split('/').pop() ?? '';

    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();

    try {
      await visitor.goto(`/t/${tenant.slug}/carta/${token}`);

      await expect(visitor.getByTestId('shared-card-owner')).toContainText(`@${handle}`);
      expect((await visitor.content()).toLowerCase()).not.toContain('carla nome privado');
    } finally {
      await anonymous.close();
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — ORDEM MANUAL DAS EQUIPES NA VITRINE (FASE 51, dívida E63)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. sem ordem definida, a vitrine pública mostra as equipes em ordem alfabética
 *         — o comportamento que já existia e que a fase NÃO podia mudar para quem não
 *         pediu nada;
 *      2. as setas da tela de equipes mudam a ordem, e a PÁGINA PÚBLICA obedece: a
 *         mesma lista para o organizador e para o visitante;
 *      3. as setas **funcionam SEM JavaScript** (`javaScriptEnabled: false`): o clique é
 *         um POST nativo do formulário, como no resto das ações em linha desta base
 *         (dívida E50), e a ordem vive no BANCO (10, 20, 30…), não no navegador.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PÁGINA PÚBLICA PRECISA SER MONTADA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O bloco "Equipe do evento" é opt-in desde a FASE 45: sem ele, a página do evento não
 *  mostra equipe nenhuma — e o teste do E63 mede exatamente o que o VISITANTE vê. O
 *  caminho é o mesmo do organizador (criar página, adicionar o bloco, publicar), como em
 *  `event-team-block.spec.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'ordem-equipes-f51';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;
let organizadoraEmail: string;

let apoioId: string;
let programacaoId: string;

/** Os nomes das pessoas, na ordem em que os cartões aparecem na vitrine. */
const NOMES = {
  carla: `Carla Nunes ${RUN_ID}`,
  diego: `Diego Prado ${RUN_ID}`,
  ana: `Ana Souza ${RUN_ID}`,
  bruno: `Bruno Lima ${RUN_ID}`,
};

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f51ordem.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Cria a pessoa e o vínculo ATIVO com a instituição (só vínculo ativo entra em equipe). */
async function criarMembro(name: string): Promise<string> {
  const id = randomUUID();

  await e2eDb.user.create({
    data: { id, name, email: `f51membro.${RUN_ID}.${id.slice(0, 8)}@example.test`, emailVerified: true },
  });

  await linkUser({ tenantId, userId: id, kind: 'MEMBER' });

  return id;
}

/** As ordens gravadas, por id de equipe. */
async function ordensGravadas(): Promise<Map<string, number>> {
  const rows = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.eventTeam.findMany({
      where: { tenantId, eventId },
      select: { id: true, displayOrder: true },
    });
  });

  return new Map(rows.map((row) => [row.id, row.displayOrder]));
}

/** Os nomes nos cartões da vitrine pública, na ordem em que o visitante os lê. */
async function nomesDaVitrine(page: import('@playwright/test').Page): Promise<string[]> {
  return page.getByTestId('team-card').allInnerTexts();
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Ordem ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'Congresso da Ordem',
    });

    eventId = event.id;
    eventSlug = event.slug;

    const organizadora = await signUpVia(api, `Organizadora da Ordem ${RUN_ID}`);
    organizadoraEmail = organizadora.email;

    await linkUser({ tenantId, userId: organizadora.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: organizadora.id, role: 'ADMIN' });

    const carla = await criarMembro(NOMES.carla);
    const diego = await criarMembro(NOMES.diego);
    const ana = await criarMembro(NOMES.ana);
    const bruno = await criarMembro(NOMES.bruno);

    apoioId = randomUUID();
    programacaoId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      /** Nenhuma equipe nasce ordenada: `displayOrder` fica em 0 ("sem opinião"). */
      await tx.eventTeam.create({
        data: {
          id: apoioId,
          tenantId,
          eventId,
          name: 'Apoio',
          members: { create: [{ id: randomUUID(), tenantId, userId: carla }] },
        },
      });

      await tx.eventTeam.create({
        data: {
          id: programacaoId,
          tenantId,
          eventId,
          name: 'Programação',
          members: { create: [{ id: randomUUID(), tenantId, userId: diego, isLead: true }] },
        },
      });

      await tx.eventTeam.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          name: 'Presidência',
          members: {
            create: [
              { id: randomUUID(), tenantId, userId: ana, isLead: true },
              { id: randomUUID(), tenantId, userId: bruno },
            ],
          },
        },
      });
    });
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('ordem das equipes na vitrine', () => {
  test('1. sem ordem definida, a vitrine segue alfabética (e o bloco é montado)', async ({
    page,
    browser,
  }) => {
    await signInAs(page, organizadoraEmail);

    // ── A página do evento precisa existir ───────────────────────────────────
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/pagina`);

    if (await page.getByTestId('create-page').isVisible().catch(() => false)) {
      await page.getByTestId('create-page').getByTestId('admin-submit').click();
    }

    // ── O bloco "Equipe do evento" (todas as equipes — o padrão do seletor) ──
    const adicionar = page.getByTestId('add-block');
    await adicionar.getByLabel('Tipo de bloco').selectOption('TEAM');
    await adicionar.getByTestId('admin-submit').click();

    await expect(page.locator('[data-type="TEAM"]').first()).toBeVisible({ timeout: 30_000 });

    // ── Publicar ─────────────────────────────────────────────────────────────
    const publicacao = page.getByTestId('save-page');
    await publicacao.getByLabel('Publicar a página agora').check();
    await publicacao.getByTestId('admin-submit').click();
    await expect(page.getByTestId('landing-status')).toContainText('Publicada', { timeout: 30_000 });

    // ── A vitrine, vista por um ANÔNIMO ──────────────────────────────────────
    const anonimo = await browser.newContext();
    const anonPage = await anonimo.newPage();

    try {
      await anonPage.goto(`/t/${tenantSlug}/eventos/${eventSlug}`);

      await expect(anonPage.getByTestId('team-block')).toBeVisible();

      /** Alfabética: Apoio → Presidência (líder primeiro) → Programação. */
      await expect
        .poll(async () => (await nomesDaVitrine(anonPage)).length, { timeout: 30_000 })
        .toBe(4);

      const nomes = await nomesDaVitrine(anonPage);
      expect(nomes[0]).toContain(NOMES.carla);
      expect(nomes[1]).toContain(NOMES.ana);
      expect(nomes[2]).toContain(NOMES.bruno);
      expect(nomes[3]).toContain(NOMES.diego);

      /** Nada foi ordenado ainda: as três equipes continuam em zero. */
      const ordens = await ordensGravadas();
      expect([...ordens.values()]).toEqual([0, 0, 0]);
    } finally {
      await anonimo.close();
    }

    /** A tela de administração mostra a MESMA sequência que a vitrine. */
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/equipes`);
    await expect(page.getByTestId('teams-list').locator('li')).toHaveCount(3);

    const naTela = await page.getByTestId('teams-list').locator('li h2').allInnerTexts();
    expect(naTela).toEqual(['Apoio', 'Presidência', 'Programação']);
  });

  test('2. SEM JavaScript, a seta muda a ordem e a vitrine obedece', async ({ browser }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA DA DÍVIDA E63
     *  ─────────────────────────────────────────────────────────────────────────────
     *  `javaScriptEnabled: false` é o caso extremo: o bundle nunca carrega e o clique na
     *  seta é a submissão NATIVA do formulário. Se a reordenação dependesse de
     *  hidratação, este teste não passaria — e é o que a dívida pedia para uma tela de
     *  operação.
     */
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, organizadoraEmail);
      await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/equipes`);

      /** "Programação" é a terceira (Apoio, Presidência, Programação). */
      await page.getByTestId(`team-up-${programacaoId}`).getByTestId('inline-submit').click();
      await page.waitForLoadState('domcontentloaded');

      /**
       * A reescrita é em BLOCO (10, 20, 30…): gravar só a equipe movida deixaria um
       * empate com a vizinha, e o empate cairia no alfabeto — o clique não mudaria nada
       * e a tela diria "ordem salva".
       */
      await expect
        .poll(async () => (await ordensGravadas()).get(programacaoId), { timeout: 30_000 })
        .toBe(20);

      const ordens = await ordensGravadas();
      expect(ordens.get(apoioId)).toBe(10);
      expect([...ordens.values()].sort((a, b) => a - b)).toEqual([10, 20, 30]);

      /** A tela do organizador já mostra a ordem nova. */
      const naTela = await page.getByTestId('teams-list').locator('li h2').allInnerTexts();
      expect(naTela).toEqual(['Apoio', 'Programação', 'Presidência']);

      /** E a VITRINE pública — o que o visitante lê — obedece à mesma lista. */
      await page.goto(`/t/${tenantSlug}/eventos/${eventSlug}`);

      await expect(page.getByTestId('team-block')).toBeVisible();

      const nomes = await nomesDaVitrine(page);
      expect(nomes[0]).toContain(NOMES.carla);
      expect(nomes[1]).toContain(NOMES.diego);
      expect(nomes[2]).toContain(NOMES.ana);
      expect(nomes[3]).toContain(NOMES.bruno);
    } finally {
      await context.close();
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Rubrica com número livre de critérios (FASE 39)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. o organizador cria a trilha com CINCO critérios pela tela (não mais três), e a
 *      chave técnica de cada um nasce do rótulo;
 *   2. **sem JavaScript** ele também consegue: as linhas até o teto estão no
 *      formulário, e as vazias são descartadas — nenhum controle morto na tela;
 *   3. a trilha, que só podia ser CRIADA, agora é EDITÁVEL, e o formulário abre com a
 *      rubrica gravada (é o que permite corrigir um erro sem criar outra trilha);
 *   4. com um parecer já enviado, a rubrica aparece CONGELADA com a contagem — em vez
 *      de campos que o servidor recusaria.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FIXTURE DO PARECER É UM `create` DIRETO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que o cenário 4 mede é a TELA lendo a contagem; a linha em `Review` só precisa
 *  existir com o `submissionId` certo. O caminho que a cria de verdade (envio de
 *  parecer, com upload real) tem cobertura em `peer-review.test.ts`, e repeti-lo aqui
 *  custaria um harness de storage para medir uma contagem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'rubrica-livre-f39';
const EVENT_SLUG = `evento-f39-${RUN_ID}`;
const TRACK_SLUG = `trilha-livre-${RUN_ID}`;
const TRACK_SLUG_NO_JS = `trilha-sem-js-${RUN_ID}`;

const FIVE_LABELS = ['Originalidade', 'Método', 'Clareza', 'Impacto', 'Viabilidade'];

let tenantId: string;
let eventId: string;
let organizerEmail: string;
let reviewerId: string;

const slug = `${TENANT_LABEL}-${RUN_ID}`;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f39.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** A rubrica gravada na trilha, pelo slug — `null` enquanto a trilha não existe. */
async function findStoredRubric(trackSlug: string) {
  const track = await e2eDb.track.findFirst({
    where: { eventId, slug: trackSlug },
    select: { id: true, reviewRubric: true },
  });

  if (!track) return null;

  return {
    id: track.id,
    rubric: track.reviewRubric as { key: string; label: string; weight: number; maxScore: number }[],
  };
}

async function storedRubric(trackSlug: string) {
  const found = await findStoredRubric(trackSlug);
  if (!found) throw new Error(`A trilha ${trackSlug} não foi criada.`);

  return found;
}

/**
 * Envia o formulário do painel e espera o EFEITO, clicando de novo se o clique se
 * perdeu na hidratação.
 *
 * É a armadilha **88** (documentada na FASE 37): o botão está no HTML, mas quem envia é
 * o cliente — e um clique antes de o bundle carregar não vira requisição nenhuma. Quem
 * opera clica outra vez; o teste faz o mesmo, em vez de medir o tempo de carregamento.
 */
async function submitUntil(
  page: import('@playwright/test').Page,
  formTestId: string,
  effect: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    const botao = page.getByTestId(formTestId).getByTestId('admin-submit');
    if ((await botao.count()) > 0) await botao.click();

    await effect();
  }).toPass({ timeout: 60_000 });
}

/** Abre a seção "Chamada de trabalhos" e o formulário de criação. */
async function openTracksSection(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('tracks-section').locator('summary').first().click();
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Rubrica Livre ${RUN_ID}`,
    });
    tenantId = tenant.id;
    eventId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 30 * 86_400_000);

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Congresso da Rubrica Livre ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
          timezone: 'America/Bahia',
          cfpOpensAt: new Date(Date.now() - 86_400_000),
          cfpClosesAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });
    });

    const organizer = await signUpVia(api, `Organizador da Rubrica ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    await grantRole({ tenantId, userId: organizer.id, role: 'ADMIN' });

    const reviewer = await signUpVia(api, `Revisor da Rubrica ${RUN_ID}`);
    reviewerId = reviewer.id;
  } finally {
    await api.dispose();
  }
});

const eventPanelUrl = () => `/t/${slug}/administracao/eventos/${eventId}`;

test.describe('rubrica com número livre de critérios', () => {
  test('1. a trilha nasce com CINCO critérios, e a chave vem do rótulo', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(eventPanelUrl());
    await openTracksSection(page);

    const form = page.getByTestId('create-track');
    await form.getByLabel('Identificador').fill(TRACK_SLUG);
    await form.getByLabel('Nome').fill('Trilha de cinco critérios');

    /** Três linhas nascem desenhadas; as outras duas vêm do botão. */
    for (let index = 0; index < FIVE_LABELS.length; index += 1) {
      if (index >= 3) {
        await page.getByTestId('track-rubric-add').click();
      }

      await page.getByTestId(`track-rubric-label-${index}`).fill(FIVE_LABELS[index]!);
      await page.getByTestId(`track-rubric-weight-${index}`).fill(index === 0 ? '3' : '1');
      await page.getByTestId(`track-rubric-max-${index}`).fill('10');
    }

    await expect(page.getByTestId('track-rubric-weight-sum')).toContainText('soma dos pesos: 7');

    await submitUntil(page, 'create-track', async () => {
      expect((await findStoredRubric(TRACK_SLUG))?.rubric.length).toBe(5);
    });

    const { rubric } = await storedRubric(TRACK_SLUG);

    expect(rubric.map((criterion) => criterion.label)).toEqual(FIVE_LABELS);
    expect(rubric.map((criterion) => criterion.key)).toEqual([
      'originalidade',
      'metodo',
      'clareza',
      'impacto',
      'viabilidade',
    ]);
    expect(rubric.map((criterion) => criterion.weight)).toEqual([3, 1, 1, 1, 1]);
  });

  test('2. SEM JavaScript o organizador declara os cinco critérios pelas linhas do teto', async ({
    browser,
  }) => {
    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     *  O CAMINHO SEM JAVASCRIPT, INTEIRO
     *  ─────────────────────────────────────────────────────────────────────────────
     *  Com o script desligado, o editor:
     *    • NÃO mostra "acrescentar"/"remover" (botão que não faz nada é pior que botão
     *      ausente — os controles são revelados só depois da hidratação, e a soma dos
     *      pesos junto);
     *    • oferece as linhas até o TETO, dentro do `<noscript>`, e o formulário do
     *      painel é enviado pelo caminho nativo;
     *    • e as linhas que ficarem vazias são descartadas pelo domínio — foi assim que
     *      este cenário nasceu: a primeira execução preencheu só a quinta linha e a
     *      trilha nasceu com UM critério, exatamente o preenchido.
     */
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);
      await page.goto(eventPanelUrl());
      await openTracksSection(page);

      const form = page.getByTestId('create-track');
      await form.getByLabel('Identificador').fill(TRACK_SLUG_NO_JS);
      await form.getByLabel('Nome').fill('Trilha sem JavaScript');

      /** Nenhum controle que dependa de JavaScript aparece. */
      await expect(page.getByTestId('track-rubric-add')).toHaveCount(0);
      await expect(page.getByTestId('track-rubric-weight-sum')).toHaveCount(0);

      /**
       * As linhas até o TETO estão no formulário de criação — doze rótulos, doze pesos.
       *
       * A busca é pelo NOME do campo, dentro do formulário, e não pelo rótulo acessível:
       * cada trilha da lista também tem um editor, e "rótulo do critério 1" existe em
       * todos eles (armadilha 81). Aqui o que se mede é a QUANTIDADE de linhas que o
       * formulário oferece sem JavaScript, e o nome do campo responde isso direto.
       */
      const labels = form.locator('input[name="rubricLabel"]');
      const weights = form.locator('input[name="rubricWeight"]');

      await expect(labels).toHaveCount(12);
      await expect(weights).toHaveCount(12);

      for (let index = 0; index < FIVE_LABELS.length; index += 1) {
        await labels.nth(index).fill(FIVE_LABELS[index]!);
        await weights.nth(index).fill(index === 0 ? '3' : '1');
      }

      await form.getByTestId('admin-submit').click({ timeout: 10_000 });

      await expect
        .poll(async () => (await findStoredRubric(TRACK_SLUG_NO_JS))?.rubric.length, {
          timeout: 30_000,
        })
        .toBe(5);

      const { rubric } = await storedRubric(TRACK_SLUG_NO_JS);

      expect(rubric.map((criterion) => criterion.label)).toEqual(FIVE_LABELS);
      expect(rubric.map((criterion) => criterion.key)).toEqual([
        'originalidade',
        'metodo',
        'clareza',
        'impacto',
        'viabilidade',
      ]);
    } finally {
      await context.close();
    }
  });

  test('3. a trilha é EDITÁVEL e o formulário abre com a rubrica gravada', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(eventPanelUrl());
    await openTracksSection(page);

    const { id } = await storedRubric(TRACK_SLUG);

    await page.getByTestId(`track-edit-${id}`).locator('summary').click();

    const form = page.getByTestId(`edit-track-${id}`);
    await expect(form.getByLabel('Nome')).toHaveValue('Trilha de cinco critérios');
    await expect(page.getByTestId(`track-rubric-${id}-label-4`)).toHaveValue('Viabilidade');

    /** Salvar sem tocar na rubrica mantém os cinco critérios e as chaves. */
    await form.getByLabel('Pareceres exigidos').fill('2');

    await submitUntil(page, `edit-track-${id}`, async () => {
      const track = await e2eDb.track.findUniqueOrThrow({
        where: { id },
        select: { requiredReviews: true },
      });

      expect(track.requiredReviews).toBe(2);
    });

    expect((await storedRubric(TRACK_SLUG)).rubric.map((criterion) => criterion.key)).toEqual([
      'originalidade',
      'metodo',
      'clareza',
      'impacto',
      'viabilidade',
    ]);
  });

  test('4. com um parecer enviado, a rubrica aparece CONGELADA com a contagem', async ({ page }) => {
    const { id } = await storedRubric(TRACK_SLUG);
    const submissionId = randomUUID();

    /** Fixture: uma submissão na trilha e UM parecer nela (ver o cabeçalho do arquivo). */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.submission.create({
        data: {
          id: submissionId,
          tenantId,
          eventId,
          trackId: id,
          protocol: `F39${RUN_ID.slice(0, 4).toUpperCase()}`,
          title: 'Proposta para congelar a rubrica',
          abstract:
            'Resumo suficientemente longo para o teste de congelamento da rubrica, escrito apenas para que a submissão exista com um parecer ligado a ela.',
          keywords: ['rubrica', 'congelamento', 'critérios'],
          submittedById: reviewerId,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });

      await tx.review.create({
        data: {
          tenantId,
          submissionId,
          reviewerId,
          status: 'SUBMITTED',
          scores: { originalidade: 8, metodo: 7, clareza: 9, impacto: 6, viabilidade: 8 },
          submittedAt: new Date(),
        },
      });
    });

    await signInAs(page, organizerEmail);
    await page.goto(eventPanelUrl());
    await openTracksSection(page);
    await page.getByTestId(`track-edit-${id}`).locator('summary').click();

    const editor = page.getByTestId(`track-rubric-${id}`);

    await expect(editor).toHaveAttribute('data-rubric-frozen', 'true');
    await expect(editor).toContainText('congelada por 1 parecer');
    await expect(editor.getByTestId(`track-rubric-${id}-frozen-list`)).toContainText('Viabilidade');

    /** E não há campo de edição de critério: a tela não oferece o que o servidor recusa. */
    await expect(editor.getByTestId(`track-rubric-${id}-label-4`)).toHaveCount(0);
  });
});

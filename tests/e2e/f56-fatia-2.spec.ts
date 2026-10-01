import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { RUN_ID, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { createSubmission } from '../../src/lib/review/submission-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FATIA 2 DO MUTIRÃO DA JORNADA (dívidas E31 e E2)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Dois fatos que a pessoa encontra pelo navegador:
 *
 *    1. **Retirar o próprio trabalho** — quem enviou na chamada errada sai do páreo
 *       sozinho, com o protocolo guardado, em vez de depender de um pedido à comissão;
 *    2. **A lista pública de eventos pagina** — a página vive na URL, e o endereço da
 *       segunda página funciona sem JavaScript.
 *
 *  O trabalho é criado pelo SERVIÇO (`createSubmission`) e o estado ENVIADO é forjado no
 *  clicando no formulário: o que este cenário mede é a RETIRADA, e montar a submissão
 *  pela tela custaria uma dúzia de passos que já têm teste próprio.
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f56-fatia2-${RUN_ID}`;
const EVENT_SLUG = `eventos-paginados-${RUN_ID}`;

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let trackId: string;
let author: { id: string; email: string };

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f56f2.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
      name: `Instituição da Fatia 2 ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    /**
     * TREZE eventos publicados: com a página de 12, é o menor número que produz uma
     * segunda página. Criar menos deixaria o teste passar sem paginar nada.
     */
    for (let index = 1; index <= 13; index += 1) {
      await createEvent({
        tenantId,
        slug: `${EVENT_SLUG}-${index}`,
        title: `Evento paginado ${index} ${RUN_ID}`,
        status: 'REGISTRATION_OPEN',
        capacity: 50,
      });
    }

    const event = await createEvent({
      tenantId,
      slug: `evento-do-trabalho-${RUN_ID}`,
      title: `Evento do trabalho ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      capacity: 50,
    });

    eventId = event.id;
    /**
     * A TRILHA é obrigatória para submeter (o domínio recusa sem ela: "Selecione a
     * trilha temática") — e sem trilha não há submissão para retirar. O limite por autor
     * fica alto porque o cenário cria trabalhos para exercitar caminhos diferentes.
     */
    trackId = randomUUID();
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.track.create({
        data: {
          id: trackId,
          tenantId,
          eventId,
          slug: `trilha-f56-${RUN_ID}`,
          name: 'Trilha da fatia 2',
          requiresBlindReview: false,
          requiredReviews: 2,
          maxSubmissionsPerAuthor: 50,
        },
      });
    });

    author = await signUpVia(api, 'Autora da Fatia 2');
    /**
     * `kind: PARTICIPANT` — é o vínculo do PÚBLICO, e é dele que vem o pacote mínimo
     * de permissões (criar, ler e EDITAR a própria submissão). Com o default (`MEMBER`)
     * sem papel, a retirada era recusada com "Permissão negada: submission:update:own" —
     * que foi como o E2E descobriu que a fixture não representava uma pessoa real.
     */
    await linkUser({ tenantId, userId: author.id, kind: 'PARTICIPANT' });

    /**
     * O PAPEL é o que concede permissão: o vínculo diz que a pessoa pertence à
     * instituição, e `PARTICIPANT` é o papel do público — o pacote mínimo (criar, ler e
     * editar a própria submissão). Sem ele, a retirada é recusada com "Permissão negada",
     * que foi como o E2E mostrou que a fixture não representava uma pessoa real.
     */
    await grantRole({ tenantId, userId: author.id, role: 'PARTICIPANT' });
  } finally {
    await api.dispose();
  }
});

test('1. o autor retira o próprio trabalho pela tela, e o protocolo continua registrado', async ({
  page,
}) => {
  // ── O trabalho enviado, criado pelo serviço (o caminho da tela tem teste próprio) ──
  const created = await createSubmission({
    tenantId,
    eventId,
    trackId,
    userId: author.id,
    title: `Trabalho retirado ${RUN_ID}`,
    abstract:
      /**
       * O resumo tem de passar do MÍNIMO do domínio (150 caracteres) e as palavras-chave
       * são TRÊS — o mínimo é 3. Um fixture curto demais faz o serviço recusar com
       * 'Revise os dados da submissão', que foi o primeiro erro deste teste.
       */
      'Este trabalho existe para provar que o autor consegue retirar o próprio envio sem depender da comissão do evento: ele sai do páreo, o protocolo continua registrado e o motivo fica na trilha da comissão.',
    keywords: ['retirada', 'autoria', 'jornada'],
  });

  expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
  if (!created.ok) return;

    /**
     * O trabalho entra no páreo com o estado forjado no banco: ENVIAR exige arquivo (regra
     * da FASE 4) e tem spec próprio. O que este cenário mede é a RETIRADA pela tela.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.submission.update({
        where: { id: created.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
    });


  // ── Pela tela: a pessoa vê o próprio trabalho e retira ─────────────────────
  await signInAs(page, author.email);
  await page.goto(`/t/${tenantSlug}/submissoes/${created.id}`);

  await expect(page.getByTestId('submission-status')).toContainText(/enviada/i);

  await page.getByTestId('withdraw-submission').click();
  await expect(page.getByTestId('withdraw-submission-confirm')).toBeVisible();
  await page.getByTestId('withdraw-submission-confirm-confirm').click();

  /** A página revalida e passa a mostrar o estado novo — a pessoa FICA no trabalho. */
  await expect(page.getByTestId('submission-status')).toContainText(/retirada/i, {
    timeout: 30_000,
  });

  /** E o banco confirma: o trabalho existe, com o protocolo e o estado `WITHDRAWN`. */
  const row = await e2eDb.submission.findUniqueOrThrow({
    where: { id: created.id },
    select: { status: true, protocol: true },
  });

  expect(row.status).toBe('WITHDRAWN');
  expect(row.protocol).toBe(created.protocol);

  /** Depois de retirado, o botão não é mais oferecido — retirar duas vezes não existe. */
  await expect(page.getByTestId('withdraw-submission')).toHaveCount(0);
});

test('2. a lista pública de eventos pagina, e o endereço da segunda página funciona', async ({
  page,
}) => {
  await page.goto(`/t/${tenantSlug}/eventos`);

  const paginacao = page.getByTestId('events-pagination');
  await expect(paginacao).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('events-page-info')).toContainText(/página 1 de \d+/);

  /** A primeira página traz 12 cartões — o teto padrão —, e não os 14 do tenant. */
  const cartoes = page.locator('ul > li');
  await expect(cartoes).toHaveCount(12);

  /** E o endereço da próxima página é um LINK: nada de JavaScript para andar. */
  await page.getByTestId('events-next').click();
  await expect(page).toHaveURL(new RegExp(`/eventos\\?pagina=2$`));
  await expect(page.getByTestId('events-page-info')).toContainText(/página 2 de/);

  /** A página 2 é uma lista MENOR e sem repetir o que a primeira já mostrou. */
  const restantes = await cartoes.count();
  expect(restantes).toBeGreaterThan(0);
  expect(restantes).toBeLessThan(12);

  /** "Anteriores" volta para a primeira — a navegação funciona nos dois sentidos. */
  await page.getByTestId('events-prev').click();
  await expect(page).toHaveURL(new RegExp(`/eventos$`));
  await expect(page.getByTestId('events-page-info')).toContainText(/página 1 de/);
});

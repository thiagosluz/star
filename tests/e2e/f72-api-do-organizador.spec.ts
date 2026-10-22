/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A TELA DO ORGANIZADOR DA API DO EVENTO (FASE 72 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, E POR QUE ELE É A AMARRAÇÃO DA FASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As fatias 1 e 2 entregaram a projeção e as rotas; a fatia 3 entrega a tela. Uma
 *  tela bonita que não produz a chave certa seria indistinguível de uma que produz,
 *  se o teste só olhasse para a tela. Por isso a jornada AQUI atravessa as duas
 *  pontas:
 *
 *      1. a área existe na raiz do evento e o cartão leva à tela;
 *      2. SEM chave, a tela diz que a API responde 401 — e não promete prévia;
 *      3. gerar mostra a chave UMA vez, com o aviso, e a chave gerada é usada
 *         contra a API REAL (Playwright `request` + `Authorization: Bearer`) e
 *         recebe **200**;
 *      4. `/palestrantes` responde **404** antes de ligar a seção e **200** depois —
 *         a prova de que o interruptor da tela é o mesmo que a rota consulta;
 *      5. revogar responde **401** na requisição seguinte;
 *      6. o evento em RASCUNHO responde **404** com a chave válida — o mesmo código
 *         de inexistente;
 *      7. **tudo funciona SEM JavaScript** (`javaScriptEnabled: false`): gerar,
 *         mostrar, ligar seção e revogar são `<form>` POST de verdade.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CADA CASO TEM O PRÓPRIO EVENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As fixtures são quatro eventos na MESMA instituição, e cada caso usa o seu. É a
 *  regra da casa (F62/I3): um caso que só passa depois do anterior esconde o
 *  defeito em vez de mostrá-lo. O `beforeAll` cria os quatro; nenhum caso depende
 *  do estado que outro deixou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';
import {
  readEventApiConfig,
  type EventApiStoredConfig,
} from '../../src/domain/api/event-api-key-rules';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f72-api';

let tenantId: string;
let tenantSlug: string;
let adminEmail: string;

/** O evento do cartão e do estado "sem chave" — nenhum caso o muta. */
let eventoDaAreaId: string;
let eventoDaAreaSlug: string;
/** A jornada completa (gerar → usar → ligar → revogar). */
let eventoDaJornadaId: string;
let eventoDaJornadaSlug: string;
/** A jornada SEM JavaScript. */
let eventoSemJsId: string;
let eventoSemJsSlug: string;
/** O evento em RASCUNHO: a API tem de responder 404 mesmo com chave válida. */
let eventoRascunhoId: string;
let eventoRascunhoSlug: string;

function urlDaTela(eventId: string): string {
  return `/t/${tenantSlug}/administracao/eventos/${eventId}/api`;
}

function urlDaApi(eventSlug: string, sufixo = ''): string {
  return `/api/v1/t/${tenantSlug}/eventos/${eventSlug}${sufixo}`;
}

/**
 * A configuração gravada, lida com contexto de instituição (a tabela está sob RLS).
 *
 * É a prova de BANCO: a tela pode dizer "seção ligada" e ainda não ter gravado; o
 * que vale é o JSON que a rota vai ler.
 */
async function configuracaoGravada(eventId: string): Promise<EventApiStoredConfig | null> {
  const row = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.event.findUnique({ where: { id: eventId }, select: { settings: true } });
  });

  return readEventApiConfig(row?.settings).config;
}

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f72api.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/**
 * Gera a chave pela TELA e devolve o valor que ela mostrou.
 *
 * O clique é no botão do `<form>`; a espera é pelo NÓ com a chave — não pelo
 * clique. A chave só existe na resposta da ação, então vê-la é a prova de que a
 * action rodou e de que o cofre selou.
 */
async function gerarChave(page: Page): Promise<string> {
  await page.getByTestId('event-api-create-submit').click();

  const noDaChave = page.getByTestId('event-api-new-key');
  await expect(noDaChave).toBeVisible({ timeout: 30_000 });

  const chave = (await noDaChave.textContent())?.trim() ?? '';
  expect(chave).toMatch(/^[A-Za-z0-9_-]{32}$/);

  return chave;
}

/** Autoriza o cabeçalho da API — a mesma forma que o site externo usa. */
function autorizacao(chave: string): Record<string, string> {
  return { authorization: `Bearer ${chave}` };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da API ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const admin = await signUpVia(api, `Organizadora da API ${RUN_ID}`);
    adminEmail = admin.email;

    await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });

    const daArea = await createEvent({
      tenantId,
      slug: `api-area-${RUN_ID}`,
      title: 'Congresso da API',
      status: 'REGISTRATION_OPEN',
    });
    eventoDaAreaId = daArea.id;
    eventoDaAreaSlug = daArea.slug;

    const daJornada = await createEvent({
      tenantId,
      slug: `api-jornada-${RUN_ID}`,
      title: 'Mostra de integração',
      status: 'REGISTRATION_OPEN',
    });
    eventoDaJornadaId = daJornada.id;
    eventoDaJornadaSlug = daJornada.slug;

    const semJs = await createEvent({
      tenantId,
      slug: `api-sem-js-${RUN_ID}`,
      title: 'Encontro sem JavaScript',
      status: 'REGISTRATION_OPEN',
    });
    eventoSemJsId = semJs.id;
    eventoSemJsSlug = semJs.slug;

    const rascunho = await createEvent({
      tenantId,
      slug: `api-rascunho-${RUN_ID}`,
      title: 'Evento ainda em rascunho',
      status: 'DRAFT',
    });
    eventoRascunhoId = rascunho.id;
    eventoRascunhoSlug = rascunho.slug;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('a tela do organizador para a API do evento', () => {
  test('1. o cartão está na raiz e, sem chave, a tela diz que a API responde 401', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    /**
     * O selo do cartão é o ZERO da área: "nenhuma chave" aparece (e não some), porque
     * dizer que falta gerar é a informação. Ver a catraca da F54.
     */
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventoDaAreaId}`);
    const cartao = page.getByTestId('event-area-api');
    await expect(cartao).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('event-area-metric-api')).toHaveText('nenhuma chave');

    await cartao.click();
    await expect(page).toHaveURL(new RegExp(`/eventos/${eventoDaAreaId}/api$`));
    await expect(page.getByTestId('event-api-page')).toBeVisible();

    // ── O ESTADO HONESTO ────────────────────────────────────────────────────
    await expect(page.getByTestId('event-api-key-state-title')).toHaveText('Sem chave');
    await expect(page.getByTestId('event-api-key-state-body')).toContainText('401');

    // ── O ESTADO DE PUBLICAÇÃO ──────────────────────────────────────────────
    await expect(page.getByTestId('event-api-publication-title')).toHaveText('O evento está no ar');

    /**
     * ─────────────────────────────────────────────────────────────────────────
     *  AS SEÇÕES NASCEM DESLIGADAS — e a tela diz isso, e diz o que acontece
     * ─────────────────────────────────────────────────────────────────────────
     *  A frase é requisito da fase: expor é decisão explícita, e desligada a seção
     *  responde 404 como se não existisse. O evento e a programação são declarados
     *  NÃO interruptáveis.
     */
    await expect(page.getByTestId('event-api-sections-born-off')).toContainText('DESLIGADAS');
    await expect(page.getByTestId('event-api-sections-born-off')).toContainText('404');
    await expect(page.getByTestId('event-api-fixed-resources')).toContainText('NÃO têm interruptor');
    await expect(page.getByTestId('event-api-fixed-resources')).toContainText(
      'evento e a programação',
    );

    // ── SEM CHAVE NÃO HÁ PRÉVIA: a própria tela diz por quê ─────────────────
    await expect(page.getByTestId('event-api-preview-note')).toContainText('401');

    // ── O ENDEREÇO É O REAL, COM O SLUG DO EVENTO (nunca `<slug>`) ──────────
    const endereco = page.getByTestId('event-api-resource-path-evento');
    await expect(endereco).toHaveText(`/api/v1/t/${tenantSlug}/eventos/${eventoDaAreaSlug}`);
    await expect(endereco).not.toContainText('<');
    await expect(page.getByTestId('event-api-resource-method-evento')).toHaveText('GET');

    // ── A DOCUMENTAÇÃO MORA NA MESMA TELA ───────────────────────────────────
    await expect(page.getByTestId('event-api-limits')).toContainText('120 requisições por minuto');
    await expect(page.getByTestId('event-api-limits')).toContainText('Authorization: Bearer');
    await expect(page.getByTestId('event-api-limits')).toContainText('ETag');
    await expect(page.getByTestId('event-api-limits')).toContainText('CORS');
    await expect(page.getByTestId('event-api-limits')).toContainText('304');
    await expect(page.getByTestId('event-api-never')).toContainText('CPF');
    await expect(page.getByTestId('event-api-fields-evento')).toContainText('registrationOpen');
  });

  /**
   * ═════════════════════════════════════════════════════════════════════════════
   *  A JORNADA QUE AMARRA A TELA AO QUE O MUNDO EXTERNO VÊ
   * ═════════════════════════════════════════════════════════════════════════════
   */
  test('2. gerar, usar a chave contra a API real (200), ligar a seção (404 → 200) e revogar (401)', async ({
    page,
    request,
  }) => {
    await signInAs(page, adminEmail);
    await page.goto(urlDaTela(eventoDaJornadaId));

    await expect(page.getByTestId('event-api-key-state-title')).toHaveText('Sem chave');

    // ── GERAR: a chave aparece UMA vez, com o aviso ──────────────────────────
    const chave = await gerarChave(page);

    const aviso = page.getByTestId('event-api-new-key-notice');
    await expect(aviso).toContainText('única vez');
    await expect(aviso).toContainText('não será mostrada de novo');
    await expect(aviso).toContainText('Mostrar chave');
    await expect(aviso).toContainText('cifrada');

    /**
     * O aviso de CREDENCIAL é requisito da fase e fica na mesma tela: a chave não vai
     * para repositório nem para página pública, e quem a tem lê o que as seções
     * expõem. O E2E prende as três ideias, não só a presença do bloco.
     */
    const credencial = page.getByTestId('event-api-credential-warning');
    await expect(credencial).toContainText('credencial');
    await expect(credencial).toContainText('repositório');
    await expect(credencial).toContainText('página pública');
    await expect(credencial).toContainText('revogar');

    // ── O ESTADO VIROU "ATIVA", COM A DATA DE CRIAÇÃO ────────────────────────
    await expect(page.getByTestId('event-api-key-state-title')).toHaveText('Chave ativa', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('event-api-key-state-body')).toContainText('Criada em');

    /**
     * O SELO DO CARTÃO ACOMPANHA O ESTADO — é a mesma leitura que a raiz faz. Com a
     * chave ativa, "1 chave ativa"; depois de revogar (no fim do caso), "chave
     * revogada".
     */
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventoDaJornadaId}`);
    await expect(page.getByTestId('event-area-metric-api')).toHaveText('1 chave ativa', {
      timeout: 30_000,
    });

    await page.goto(urlDaTela(eventoDaJornadaId));

    /**
     * ─────────────────────────────────────────────────────────────────────────
     *  A CHAVE CONTRA A API REAL — o que o site do cliente recebe
     * ─────────────────────────────────────────────────────────────────────────
     *  `request` do Playwright faz a chamada HTTP de verdade, com o cabeçalho que a
     *  documentação manda: não é um atalho pelo banco nem pela página.
     */
    const evento = await request.get(urlDaApi(eventoDaJornadaSlug), {
      headers: autorizacao(chave),
    });

    expect(evento.status()).toBe(200);

    const corpoEvento = (await evento.json()) as {
      data: { slug: string; title: string };
      meta: { etag: string };
    };

    expect(corpoEvento.data.slug).toBe(eventoDaJornadaSlug);
    expect(corpoEvento.data.title).toBe('Mostra de integração');
    expect(corpoEvento.meta.etag.length).toBeGreaterThan(2);

    /**
     * A PRÉVIA DA TELA É A MESMA RESPOSTA: o recurso `evento` mostra HTTP 200 e o
     * corpo com o slug real. Se a prévia usasse um caminho privilegiado, ela poderia
     * discordar da rota — este teste veria a discordância.
     */
    await expect(page.getByTestId('event-api-preview-status-evento')).toHaveText('HTTP 200');
    await expect(page.getByTestId('event-api-preview-evento')).toContainText(eventoDaJornadaSlug);
    /** O corpo da prévia é o ENVELOPE da API — não um exemplo montado pela tela. */
    await expect(page.getByTestId('event-api-preview-evento')).toContainText('"data"');
    await expect(page.getByTestId('event-api-preview-evento')).toContainText('"meta"');
    await expect(page.getByTestId('event-api-preview-evento')).toContainText('"etag"');

    // ── A SEÇÃO DESLIGADA RESPONDE 404 ANTES DO INTERRUPTOR ──────────────────
    const antes = await request.get(urlDaApi(eventoDaJornadaSlug, '/palestrantes'), {
      headers: autorizacao(chave),
    });

    expect(antes.status()).toBe(404);
    await expect(page.getByTestId('event-api-preview-status-palestrantes')).toHaveText('HTTP 404');
    await expect(page.getByTestId('event-api-resource-off-palestrantes')).toContainText(
      'como se não existisse',
    );

    // ── REABRIR NÃO MOSTRA A CHAVE DE NOVO POR ACIDENTE ─────────────────────
    await page.reload();
    await expect(page.getByTestId('event-api-key-state-title')).toHaveText('Chave ativa', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('event-api-new-key')).toHaveCount(0);
    await expect(page.getByTestId('event-api-reveal-submit')).toBeVisible();

    // ── MAS "MOSTRAR" EXISTE DE PROPÓSITO: o selo é re-exibível ─────────────
    await page.getByTestId('event-api-reveal-submit').click();

    const revelada = page.getByTestId('event-api-revealed-key');
    await expect(revelada).toBeVisible({ timeout: 30_000 });
    await expect(revelada).toHaveText(chave);

    // ── LIGAR A SEÇÃO DE PALESTRANTES ───────────────────────────────────────
    await page.getByTestId('event-api-section-palestrantes').check();
    await page.getByTestId('event-api-sections-submit').click();

    /** O que vale é o FATO gravado — a tela pode revalidar antes do banco. */
    await expect
      .poll(async () => (await configuracaoGravada(eventoDaJornadaId))?.secoes.palestrantes, {
        timeout: 30_000,
      })
      .toBe(true);

    await expect(page.getByTestId('event-api-preview-status-palestrantes')).toHaveText('HTTP 200', {
      timeout: 30_000,
    });

    const depois = await request.get(urlDaApi(eventoDaJornadaSlug, '/palestrantes'), {
      headers: autorizacao(chave),
    });

    expect(depois.status()).toBe(200);

    // ── REVOGAR: a confirmação nativa e o corte imediato ────────────────────
    await page.getByTestId('event-api-revoke').locator('summary').click();
    await expect(page.getByTestId('event-api-revoke')).toContainText('imediato');
    await expect(page.getByTestId('event-api-revoke')).toContainText('Não há como desfazer');

    await page.getByTestId('event-api-revoke-submit').click();

    await expect(page.getByTestId('event-api-key-state-title')).toHaveText('Chave revogada', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('event-api-key-state-body')).toContainText('Revogada em');

    await expect
      .poll(async () => (await configuracaoGravada(eventoDaJornadaId))?.revogadaEm, {
        timeout: 30_000,
      })
      .not.toBeNull();

    const revogada = await request.get(urlDaApi(eventoDaJornadaSlug), {
      headers: autorizacao(chave),
    });

    expect(revogada.status()).toBe(401);
    expect((await revogada.json()) as { code: string }).toMatchObject({ code: 'INVALID_API_KEY' });

    /** E o selo do cartão passa a dizer o estado novo — a terceira frase da régua. */
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventoDaJornadaId}`);
    await expect(page.getByTestId('event-area-metric-api')).toHaveText('chave revogada', {
      timeout: 30_000,
    });
  });

  test('3. SEM JavaScript: gerar, mostrar, ligar a seção e revogar continuam funcionando', async ({
    browser,
    request,
  }) => {
    const contexto = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();

    try {
      await signInAs(page, adminEmail);
      await page.goto(urlDaTela(eventoSemJsId));

      /**
       * O POST do formulário é o gesto; o nó com a chave é a espera. Sem hidratação
       * não existe `onClick` para interceptar: ou o formulário é de verdade, ou a
       * chave não aparece.
       */
      const chave = await gerarChave(page);

      await expect(page.getByTestId('event-api-key-state-title')).toHaveText('Chave ativa', {
        timeout: 30_000,
      });

      // ── MOSTRAR, SEM JAVASCRIPT ────────────────────────────────────────────
      await page.getByTestId('event-api-reveal-submit').click();
      await expect(page.getByTestId('event-api-revealed-key')).toHaveText(chave, {
        timeout: 30_000,
      });

      // ── LIGAR A SEÇÃO, SEM JAVASCRIPT ──────────────────────────────────────
      await page.getByTestId('event-api-section-palestrantes').check();
      await page.getByTestId('event-api-sections-submit').click();

      await expect
        .poll(async () => (await configuracaoGravada(eventoSemJsId))?.secoes.palestrantes, {
          timeout: 30_000,
        })
        .toBe(true);

      const ligada = await request.get(urlDaApi(eventoSemJsSlug, '/palestrantes'), {
        headers: autorizacao(chave),
      });
      expect(ligada.status()).toBe(200);

      // ── REVOGAR, SEM JAVASCRIPT ────────────────────────────────────────────
      await page.getByTestId('event-api-revoke').locator('summary').click();
      await page.getByTestId('event-api-revoke-submit').click();

      await expect
        .poll(async () => (await configuracaoGravada(eventoSemJsId))?.revogadaEm, {
          timeout: 30_000,
        })
        .not.toBeNull();

      const revogada = await request.get(urlDaApi(eventoSemJsSlug), {
        headers: autorizacao(chave),
      });
      expect(revogada.status()).toBe(401);
    } finally {
      await contexto.close();
    }
  });

  test('4. evento em rascunho: a tela avisa e a API responde 404 com a chave válida', async ({
    page,
    request,
  }) => {
    await signInAs(page, adminEmail);
    await page.goto(urlDaTela(eventoRascunhoId));

    /**
     * O aviso de rascunho é dito com o código e com o MOTIVO: 404 é o mesmo código
     * de inexistente, de propósito — distinguir os dois revelaria o rascunho.
     */
    await expect(page.getByTestId('event-api-publication-title')).toHaveText(
      'O evento está em rascunho',
    );
    await expect(page.getByTestId('event-api-publication-body')).toContainText('404');
    await expect(page.getByTestId('event-api-publication-body')).toContainText('inexistente');
    await expect(page.getByTestId('event-api-publication-body')).toContainText('de propósito');

    /** A tela funciona no rascunho: a chave é gerada e a prévia mostra o 404 real. */
    const chave = await gerarChave(page);

    await expect(page.getByTestId('event-api-preview-status-evento')).toHaveText('HTTP 404', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('event-api-preview-evento')).toContainText('NOT_FOUND');

    const resposta = await request.get(urlDaApi(eventoRascunhoSlug), {
      headers: autorizacao(chave),
    });

    expect(resposta.status()).toBe(404);
    expect((await resposta.json()) as { code: string }).toMatchObject({ code: 'NOT_FOUND' });
  });
});

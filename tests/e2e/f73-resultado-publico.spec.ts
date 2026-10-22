/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O RESULTADO DA CHAMADA NA PÁGINA PÚBLICA (FASE 73 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. o organizador PUBLICA pela tela (o caminho da fatia 3) e um visitante SEM
 *      SESSÃO abre a página da chamada e lê a seção: estado, data, texto, lista e
 *      próximos passos;
 *   2. a landing (que lê a chamada na renderização, ADR-168) ganha o selo
 *      "Resultado publicado" e o link para a página — SEM repetir o documento;
 *   3. o HTML que o visitante recebe NÃO contém a avaliação: a fixture grava nota,
 *      parecer, revisor e e-mail na submissão publicada, cada um com um marcador
 *      único, e a página é varrida por eles;
 *   4. salvar RASCUNHO pela tela DESPUBLICA: a seção desaparece do HTML (não fica
 *      escondida) e o selo sai da landing;
 *   5. despublicar a CHAMADA tira a página do ar: 404, como antes da fase.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CADA CASO TEM A PRÓPIA CHAMADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A jornada usa uma chamada; o rascunho, outra; o 404, uma terceira. Nenhum caso
 *  depende do estado que o anterior deixou (regra da casa, F62/I3) — e é por isso que
 *  o rascunho do caso 2 não esconde a seção do caso 1.
 *
 *  O que as fatias 1–3 já provaram SEM navegador não se repete aqui: as transições, a
 *  projeção e a lista fechada estão em `tests/unit/f73-*` e
 *  `tests/integration/f73-*`. Este arquivo mede a JORNADA e o HTML entregue.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  trackTestUser,
} from './helpers';
import { saveCall, setCallPublished } from '../../src/lib/proposals/call-service';
import { applyCallResultAction } from '../../src/lib/proposals/call-result-service';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f73-publico';

const EVENT_SLUG = `evento-f73-publico-${RUN_ID}`;

const TEXTO = 'A lista dos trabalhos aprovados está abaixo. Ainda pode haver ajuste.';
const PROXIMOS_PASSOS = 'Envie a versão final até 10 de novembro pelo formulário da chamada.';
const TEXTO_RASCUNHO = 'Rascunho em preparação — este texto NÃO pode aparecer no público.';

const TITULO_DA_JORNADA = `Chamada da jornada pública ${RUN_ID}`;
const TITULO_DO_RASCUNHO = `Chamada do rascunho público ${RUN_ID}`;
const TITULO_DA_DESPUBLICADA = `Chamada despublicada ${RUN_ID}`;

const TITULO_DA_SUBMISSAO = `Saúde pública e território ${RUN_ID}`;
const NOME_DA_AUTORA = 'Ana Souza';
/** A autora está OCULTA: o nome completo dela ainda sai na lista (exceção declarada). */
const EMAIL_DA_AUTORA = `autora.f73publico.${RUN_ID}@example.test`;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  OS MARCADORES DO QUE NUNCA SAI
 * ─────────────────────────────────────────────────────────────────────────────
 *  Cada um é gravado pela fixture em um campo que a leitura pública não consulta.
 *  A varredura do HTML é por eles — não por palavras genéricas ("nota", "parecer"),
 *  que apareceriam em texto legítimo e ensinariam a ignorar o teste.
 */
const NOTA = 9.75;
const PARECER = `PARECER-INTERNO-MARCADOR-${RUN_ID}`;
const NOME_DA_REVISORA = `Revisora Secreta ${RUN_ID}`;
const EMAIL_DA_REVISORA = `revisora.${RUN_ID}@example.test`;
const RESUMO_DO_AUTOR = `RESUMO-MARCADOR-${RUN_ID}`;
const OBSERVACAO_DA_DECISAO = `OBSERVACAO-INTERNA-MARCADOR-${RUN_ID}`;

const MARCADORES_PROIBIDOS = [
  PARECER,
  NOME_DA_REVISORA,
  EMAIL_DA_REVISORA,
  RESUMO_DO_AUTOR,
  OBSERVACAO_DA_DECISAO,
  String(NOTA),
];

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let adminId: string;
let adminEmail: string;

/** A chamada da jornada completa (o organizador publica pelo navegador). */
let chamadaDaJornadaId: string;
const CHAMADA_DA_JORNADA = `f73-jornada-publica-${RUN_ID}`;
/** A chamada do rascunho: já nasce com resultado publicado, e o caso o despublica. */
let chamadaDoRascunhoId: string;
const CHAMADA_DO_RASCUNHO = `f73-rascunho-publico-${RUN_ID}`;
/** A chamada que o caso 3 despublica. */
let chamadaDespublicadaId: string;
const CHAMADA_DESPUBLICADA = `f73-despublicada-publica-${RUN_ID}`;

function urlDaTelaDeChamadas(): string {
  return `/t/${tenantSlug}/administracao/eventos/${eventId}/chamadas`;
}

function urlDoEvento(): string {
  return `/t/${tenantSlug}/eventos/${EVENT_SLUG}`;
}

function urlDaChamadaPublica(callSlug: string): string {
  return `/t/${tenantSlug}/eventos/${EVENT_SLUG}/chamada/${callSlug}`;
}

async function signUpVia(api: APIRequestContext, name: string): Promise<{ id: string; email: string }> {
  const email = `f73publico.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Uma pessoa com o nome que a lista publica — e, opcionalmente, OCULTA (E79). */
async function criarAutora(nome: string, oculta: boolean): Promise<string> {
  const id = randomUUID();

  await e2eDb.user.create({
    data: {
      id,
      name: nome,
      email: oculta ? EMAIL_DA_AUTORA : `autora.f73publico.${RUN_ID}.${id.slice(0, 6)}@example.test`,
      publicProfileHiddenAt: oculta ? new Date() : null,
    },
  });

  trackTestUser(id);

  return id;
}

/**
 * A revisora: o nome e o e-mail dela ficam na conta, e NENHUM dos dois pode aparecer
 * na página pública — nem no parecer, nem como revisor da submissão.
 */
async function criarRevisora(): Promise<string> {
  const id = randomUUID();

  await e2eDb.user.create({
    data: {
      id,
      name: NOME_DA_REVISORA,
      email: EMAIL_DA_REVISORA,
    },
  });

  trackTestUser(id);

  return id;
}

/**
 * Uma submissão da chamada, com a AVALIAÇÃO INTEIRA gravada.
 *
 * O que esta fatia mede é a PÁGINA; a submissão pública e o protocolo de aceite têm
 * spec próprio (FASE 33). O dado criado é o que a leitura lê (protocolo, título,
 * autoria e situação) MAIS a avaliação que ela não pode ver — nota, parecer,
 * observação da decisão e revisor, cada um com o seu marcador.
 */
async function criarSubmissaoAvaliada(input: {
  id: string;
  callId: string;
  protocol: string;
  titulo: string;
  authorId: string;
  reviewerId: string;
  avaliada: boolean;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.submission.create({
      data: {
        id: input.id,
        tenantId,
        eventId,
        callId: input.callId,
        protocol: input.protocol,
        title: input.titulo,
        abstract: RESUMO_DO_AUTOR,
        keywords: ['resultado', 'publico', 'e2e'],
        status: 'ACCEPTED',
        submittedById: input.authorId,
        submittedAt: new Date(),
        ...(input.avaliada
          ? {
              finalScore: NOTA,
              decisionNotes: OBSERVACAO_DA_DECISAO,
              decisionById: input.reviewerId,
              decisionAt: new Date(),
            }
          : {}),
      },
    });

    await tx.submissionAuthor.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId: input.id,
        userId: input.authorId,
        authorOrder: 1,
        isCorresponding: true,
      },
    });

    if (input.avaliada) {
      await tx.review.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId: input.id,
          reviewerId: input.reviewerId,
          status: 'SUBMITTED',
          weightedScore: NOTA,
          confidentialComments: PARECER,
          feedbackToAuthor: PARECER,
          submittedAt: new Date(),
        },
      });
    }
  });
}

/** Publica o resultado pelo SERVIÇO real (o caminho da fatia 2), sem abrir a tela. */
async function publicarResultado(callId: string, submissionId: string): Promise<void> {
  const publicado = await applyCallResultAction({
    tenantId,
    callId,
    acao: 'PUBLICAR_PARCIAL',
    conteudo: { texto: TEXTO, proximosPassos: PROXIMOS_PASSOS, publicados: [submissionId] },
    actorId: adminId,
  });

  if (!publicado.ok) {
    throw new Error(`Falha ao publicar o resultado da fixture: ${publicado.message}`);
  }
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Resultado Público ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: `Evento do Resultado Público ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      usesCall: true,
    });

    eventId = event.id;

    /**
     * A PÁGINA PUBLICADA COM O BLOCO DE CHAMADAS.
     *
     * Sem o bloco, a landing cai na composição padrão e o selo do resultado não tem
     * onde aparecer — o caso mediria o vazio. A escrita é direta porque o editor de
     * blocos é território das FASES 17/23, com cobertura própria: aqui o assunto é o
     * bloco LENDO a chamada publicada (ADR-168).
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const pageId = randomUUID();

      await tx.eventPage.create({
        data: {
          id: pageId,
          tenantId,
          eventId,
          slug: 'principal',
          title: 'Página principal',
          isHome: true,
          isPublished: true,
        },
      });

      await tx.pageBlock.create({
        data: {
          id: randomUUID(),
          tenantId,
          pageId,
          type: 'CALL_FOR_PROPOSALS',
          content: { title: 'Chamadas abertas' },
          displayOrder: 10,
          isVisible: true,
        },
      });
    });

    const admin = await signUpVia(api, `Organizadora do Resultado Público ${RUN_ID}`);
    adminId = admin.id;
    adminEmail = admin.email;

    await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });

    const autora = await criarAutora(NOME_DA_AUTORA, true);
    const revisora = await criarRevisora();

    /** As três chamadas nascem pelo SERVIÇO real e são publicadas — o caminho da tela. */
    const chamadas = [
      { slug: CHAMADA_DA_JORNADA, title: TITULO_DA_JORNADA },
      { slug: CHAMADA_DO_RASCUNHO, title: TITULO_DO_RASCUNHO },
      { slug: CHAMADA_DESPUBLICADA, title: TITULO_DA_DESPUBLICADA },
    ] as const;

    const idsPorSlug = new Map<string, string>();

    for (const chamada of chamadas) {
      const criada = await saveCall({
        tenantId,
        eventId,
        actorId: admin.id,
        kind: 'PAPER',
        slug: chamada.slug,
        title: chamada.title,
        opensAt: new Date(Date.now() - 86_400_000),
        closesAt: new Date(Date.now() + 20 * 86_400_000),
        maxSubmissionsPerAuthor: 0,
      });

      if (!criada.ok) throw new Error(`Falha ao criar a chamada: ${criada.message}`);

      const publicada = await setCallPublished({
        tenantId,
        eventId,
        callId: criada.callId,
        actorId: admin.id,
        isPublished: true,
      });

      if (!publicada.ok) throw new Error(`Falha ao publicar a chamada: ${publicada.message}`);

      idsPorSlug.set(chamada.slug, criada.callId);
    }

    /** O `slug` é a chave da fixture; o `id` sai dela ou a fixture está quebrada. */
    function idDaChamada(slug: string): string {
      const id = idsPorSlug.get(slug);
      if (!id) throw new Error(`fixture: a chamada "${slug}" não foi criada`);

      return id;
    }

    chamadaDaJornadaId = idDaChamada(CHAMADA_DA_JORNADA);
    chamadaDoRascunhoId = idDaChamada(CHAMADA_DO_RASCUNHO);
    chamadaDespublicadaId = idDaChamada(CHAMADA_DESPUBLICADA);

    /** A submissão da jornada tem a AVALIAÇÃO INTEIRA gravada — é ela que não pode sair. */
    await criarSubmissaoAvaliada({
      id: randomUUID(),
      callId: chamadaDaJornadaId,
      protocol: 'F73PU-A',
      titulo: TITULO_DA_SUBMISSAO,
      authorId: autora,
      reviewerId: revisora,
      avaliada: true,
    });

    /** As outras duas: resultado publicado pelo serviço, para os casos 2 e 3. */
    for (const [callId, protocolo, titulo] of [
      [chamadaDoRascunhoId, 'F73PU-B', `Trabalho do rascunho ${RUN_ID}`],
      [chamadaDespublicadaId, 'F73PU-C', `Trabalho da chamada despublicada ${RUN_ID}`],
    ] as const) {
      const submissionId = randomUUID();

      await criarSubmissaoAvaliada({
        id: submissionId,
        callId,
        protocol: protocolo,
        titulo,
        authorId: autora,
        reviewerId: revisora,
        avaliada: false,
      });

      await publicarResultado(callId, submissionId);
    }
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
test('1. o organizador publica e o visitante lê o resultado — sem a avaliação no HTML', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  await signInAs(page, adminEmail);
  await page.goto(urlDaTelaDeChamadas());

  const painel = page.getByTestId(`call-result-${chamadaDaJornadaId}`);
  await expect(painel).toBeVisible();
  await expect(painel).toHaveAttribute('data-result-state', 'SEM_RESULTADO');

  /** A submissão ACEITA já vem marcada — a lista nasce da decisão e é escolhida. */
  await painel.getByTestId(`call-result-text-${chamadaDaJornadaId}`).fill(TEXTO);
  await painel.getByTestId(`call-result-next-steps-${chamadaDaJornadaId}`).fill(PROXIMOS_PASSOS);

  await painel
    .getByTestId(`call-result-action-PUBLICAR_PARCIAL-${chamadaDaJornadaId}`)
    .click();

  await expect(painel).toHaveAttribute('data-result-state', 'PARCIAL', { timeout: 30_000 });

  // ── A LANDING: o selo e o caminho, sem repetir o documento ───────────────────
  await page.goto(urlDoEvento());

  const cartaoDaChamada = page
    .getByTestId('event-calls')
    .locator('li')
    .filter({ hasText: TITULO_DA_JORNADA });

  await expect(cartaoDaChamada).toBeVisible({ timeout: 30_000 });
  await expect(cartaoDaChamada.getByTestId('call-result-published')).toBeVisible();
  await expect(cartaoDaChamada.getByTestId('call-result-published')).toContainText(
    'Resultado publicado',
  );

  const linkDoResultado = cartaoDaChamada.getByTestId(
    `call-result-published-link-${chamadaDaJornadaId}`,
  );

  await expect(linkDoResultado).toHaveAttribute('href', urlDaChamadaPublica(CHAMADA_DA_JORNADA));

  /** O selo é uma MARCA e um caminho: o texto do resultado não é repetido na landing. */
  await expect(cartaoDaChamada).not.toContainText(TEXTO);
  await expect(cartaoDaChamada).not.toContainText(PROXIMOS_PASSOS);

  // ── A PÁGINA DA CHAMADA, aberta por um visitante SEM SESSÃO ──────────────────
  const visitante = await browser.newContext();
  const publica = await visitante.newPage();

  try {
    await publica.goto(urlDaChamadaPublica(CHAMADA_DA_JORNADA));

    const secao = publica.getByTestId('call-result-section');
    await expect(secao).toBeVisible({ timeout: 30_000 });

    /** A etiqueta do estado e a data da publicação. */
    await expect(secao).toContainText('Resultado parcial');
    await expect(secao).toContainText('Publicado em');

    /** O texto, a lista (protocolo · título · tipo · autores) e os próximos passos. */
    await expect(secao).toContainText(TEXTO);
    await expect(secao.getByTestId('call-result-public-item')).toHaveCount(1);
    await expect(secao).toContainText(TITULO_DA_SUBMISSAO);
    await expect(secao).toContainText('Trabalho científico (artigo)');
    await expect(secao).toContainText('F73PU-A');
    /** A EXCEÇÃO DECLARADA: o nome COMPLETO de quem se oculta no perfil público. */
    await expect(secao).toContainText(NOME_DA_AUTORA);
    await expect(secao).toContainText(PROXIMOS_PASSOS);

    /**
     * ── O QUE NUNCA SAI ────────────────────────────────────────────────────────
     * A submissão publicada TEM nota, parecer, revisor e e-mail gravados (a fixture),
     * e o HTML entregue ao visitante anônimo é varrido por cada marcador. Se algum
     * aparecer, a superfície está publicando avaliação.
     */
    const html = await publica.content();

    for (const marcador of MARCADORES_PROIBIDOS) {
      expect(html, `o marcador "${marcador}" vazou no HTML público`).not.toContain(marcador);
    }

    /** E a varredura não está medindo uma página vazia: o documento está lá. */
    expect(html).toContain(TEXTO);
    expect(html).toContain(TITULO_DA_SUBMISSAO);
  } finally {
    await visitante.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test('2. salvar rascunho esconde a seção do público — e o selo da landing', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  const visitante = await browser.newContext();
  const publica = await visitante.newPage();

  try {
    // ── ANTES: a seção existe (o resultado foi publicado pela fixture) ──────────
    await publica.goto(urlDaChamadaPublica(CHAMADA_DO_RASCUNHO));

    const secao = publica.getByTestId('call-result-section');
    await expect(secao).toBeVisible({ timeout: 30_000 });
    await expect(secao).toContainText(TEXTO);

    // ── O ORGANIZADOR SALVA RASCUNHO PELA TELA (o caminho da fatia 3) ───────────
    await signInAs(page, adminEmail);
    await page.goto(urlDaTelaDeChamadas());

    const painel = page.getByTestId(`call-result-${chamadaDoRascunhoId}`);
    await expect(painel).toHaveAttribute('data-result-state', 'PARCIAL');

    await painel.getByTestId(`call-result-text-${chamadaDoRascunhoId}`).fill(TEXTO_RASCUNHO);
    await painel
      .getByTestId(`call-result-action-SALVAR_RASCUNHO-${chamadaDoRascunhoId}`)
      .click();

    await expect(painel).toHaveAttribute('data-result-state', 'RASCUNHO', { timeout: 30_000 });

    // ── DEPOIS: a seção DESAPARECE — não fica escondida ────────────────────────
    await publica.reload();

    await expect(publica.getByTestId('call-result-section')).toHaveCount(0);
    await expect(publica.getByRole('heading', { name: 'Resultado', exact: true })).toHaveCount(0);

    const html = await publica.content();

    /** Nem o texto que estava no ar, nem o rascunho novo. */
    expect(html).not.toContain(TEXTO);
    expect(html).not.toContain(TEXTO_RASCUNHO);

    /** A chamada continua pública (o rascunho é do RESULTADO, não da chamada). */
    expect(html).toContain(TITULO_DO_RASCUNHO);

    // ── E a landing perde o selo: o cartão continua, a marca sai ───────────────
    await publica.goto(urlDoEvento());

    const cartao = publica
      .getByTestId('event-calls')
      .locator('li')
      .filter({ hasText: TITULO_DO_RASCUNHO });

    await expect(cartao).toBeVisible({ timeout: 30_000 });
    await expect(cartao.getByTestId('call-result-published')).toHaveCount(0);
  } finally {
    await visitante.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test('3. despublicar a chamada tira a página do ar (404, como hoje)', async ({ page }) => {
  test.setTimeout(120_000);

  const antes = await page.goto(urlDaChamadaPublica(CHAMADA_DESPUBLICADA));
  expect(antes?.status()).toBe(200);
  await expect(page.getByTestId('call-result-section')).toBeVisible();

  const despublicada = await setCallPublished({
    tenantId,
    eventId,
    callId: chamadaDespublicadaId,
    actorId: adminId,
    isPublished: false,
  });

  expect(despublicada.ok, despublicada.ok ? 'ok' : despublicada.message).toBe(true);

  const depois = await page.goto(urlDaChamadaPublica(CHAMADA_DESPUBLICADA));

  expect(depois?.status()).toBe(404);
  await expect(page.getByTestId('call-result-section')).toHaveCount(0);

  /** E o HTML não guarda o resultado de antes da despublicação. */
  const html = await page.content();
  expect(html).not.toContain(TEXTO);
});

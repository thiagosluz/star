/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O RESULTADO DA CHAMADA NA TELA DO ORGANIZADOR (FASE 73 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA (e o que ele NÃO repete das fatias 1 e 2)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As fatias 1 e 2 já provaram, sem navegador, as transições, a projeção pública e a
 *  recusa do final travado (a action). O que só o navegador mostra é a JORNADA:
 *
 *    1. o cartão existe na página de chamadas, diz em que estado o resultado está e
 *       mostra os gestos que a tabela legal permite — nem um a mais;
 *    2. o organizador escreve, ESCOLHE a lista (inclusive um trabalho ainda em
 *       avaliação) e publica o parcial: a PRÉVIA passa a mostrar o texto e os dois
 *       trabalhos, com o nome COMPLETO da autoria;
 *    3. publicar o final TRAVA: o estado diz "travado" e os botões de salvar/publicar
 *       SAEM da tela (a lista legal passa a ser só REABRIR);
 *    4. reabrir (pela confirmação nativa `<details>`, que anuncia que o final deixa de
 *       ser final e que o ato fica na trilha) devolve a edição, e o texto revisado
 *       volta ao ar;
 *    5. salvar um rascunho DESPUBLICA: a prévia vira o vazio honesto — rascunho não
 *       vaza;
 *    6. tudo isso funciona SEM JavaScript (`javaScriptEnabled: false`): o segundo
 *       caso escreve, marca e PUBLICA de verdade, e o estado é conferido no BANCO.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RECUSA DO POST ILEGAL NÃO ESTÁ AQUI, E NÃO É UMA LACUNA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem clica num botão que não existe não chega à action — e o POST forjado é o caso
 *  da action, não da tela. Ele já está preso em
 *  `tests/integration/f73-resultado-da-chamada.test.ts` ("o FINAL trava — e a recusa
 *  não toca no banco"): salvar rascunho, publicar parcial e publicar final a partir de
 *  FINAL são recusados com `TRANSICAO_ILEGAL`, a mensagem do domínio e o banco
 *  byte a byte. Repetir isso aqui seria medir a mesma coisa por um caminho pior.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CADA CASO TEM A PRÓPRIA CHAMADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A jornada usa uma chamada; o caso sem JavaScript usa OUTRA. Nenhum caso depende do
 *  estado que o anterior deixou (regra da casa, F62/I3) — e a jornada ainda termina em
 *  RASCUNHO de propósito, para provar que o rascunho não vaza.
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
import { readCallResult, type CallResult } from '../../src/domain/proposals/call-result-rules';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f73-resultado';

const TEXTO_PARCIAL = 'A lista dos trabalhos aprovados está abaixo. Ainda pode haver ajuste.';
const PROXIMOS_PASSOS = 'Envie a versão final até 10 de novembro pelo formulário da chamada.';
const TEXTO_REVISADO = 'Resultado parcial revisado: a lista foi conferida e está completa.';
const TEXTO_RASCUNHO = 'Rascunho em preparação — este texto NÃO pode aparecer no público.';

const TITULO_ACEITO = `Saúde pública e território ${RUN_ID}`;
const TITULO_EM_AVALIACAO = `Educação e cidade ${RUN_ID}`;
const NOME_DA_AUTORA = 'Ana Souza';
/** A autora está OCULTA no perfil público: o nome completo dela ainda sai na lista (exceção). */
const NOME_DA_AUTORA_NO_JS = 'Carla Nunes';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let adminEmail: string;

/** A chamada da jornada completa. */
let callId: string;
/** A chamada do caso sem JavaScript — isolada de propósito. */
let callSemJsId: string;

let subAceita: string;
let subEmAvaliacao: string;
let subSemJs: string;

function urlDaTela(): string {
  return `/t/${tenantSlug}/administracao/eventos/${eventId}/chamadas`;
}

function cartao(callId: string): string {
  return `call-result-${callId}`;
}

/**
 * O resultado GRAVADO, lido com contexto de instituição (a tabela está sob RLS) e
 * interpretado pelo LEITOR DO DOMÍNIO — a prova é o estado que a página pública leria.
 */
async function resultadoGravado(callId: string): Promise<CallResult> {
  const row = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.callForProposals.findUniqueOrThrow({
      where: { id: callId },
      select: { result: true },
    });
  });

  return readCallResult(row.result).resultado;
}

async function signUpVia(api: APIRequestContext, name: string): Promise<{ id: string; email: string }> {
  const email = `f73resultado.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
 * Uma pessoa com o nome que a lista vai publicar — e, opcionalmente, OCULTA no perfil
 * público. A ocultação é o que torna a exceção declarada da FASE 73 observável na
 * tela: o nome completo dela tem de sair na prévia da lista de aprovados.
 */
async function criarAutora(nome: string, oculta: boolean): Promise<string> {
  const id = randomUUID();

  await e2eDb.user.create({
    data: {
      id,
      name: nome,
      email: `f73autora.${RUN_ID}.${id.slice(0, 8)}@example.test`,
      publicProfileHiddenAt: oculta ? new Date() : null,
    },
  });

  trackTestUser(id);

  return id;
}

/**
 * Uma submissão da chamada, por escrita direta.
 *
 * O que esta fatia mede é a TELA; o caminho público de submissão e o protocolo de
 * aceite têm specs próprios (FASE 33). O dado criado é o mínimo que o serviço lê:
 * protocolo, título, situação e autoria.
 */
async function criarSubmissao(input: {
  id: string;
  callId: string;
  protocol: string;
  titulo: string;
  status: 'ACCEPTED' | 'UNDER_REVIEW';
  authorId: string;
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
        abstract:
          'Resumo criado para a jornada do resultado da chamada: a tela do organizador precisa de um trabalho real para publicar.',
        keywords: ['resultado', 'chamada', 'e2e'],
        status: input.status,
        submittedById: input.authorId,
        submittedAt: new Date(),
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
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Resultado ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `f73-resultado-${RUN_ID}`,
      title: `Evento do Resultado ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      usesCall: true,
    });

    eventId = event.id;

    const admin = await signUpVia(api, `Organizadora do Resultado ${RUN_ID}`);
    adminEmail = admin.email;

    await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });

    /**
     * As duas chamadas nascem pelo SERVIÇO REAL (`saveCall` + `setCallPublished`): é o
     * caminho da tela, e é ele que garante que a chamada existe com todas as colunas
     * que o painel lê. Escrever a linha à mão mediria uma configuração que o produto
     * não produz.
     */
    const chamadaDaJornada = await saveCall({
      tenantId,
      eventId,
      actorId: admin.id,
      kind: 'PAPER',
      slug: `f73-jornada-${RUN_ID}`,
      title: `Chamada da jornada ${RUN_ID}`,
      opensAt: new Date(Date.now() - 86_400_000),
      closesAt: new Date(Date.now() + 20 * 86_400_000),
      maxSubmissionsPerAuthor: 0,
    });

    if (!chamadaDaJornada.ok) {
      throw new Error(`Falha ao criar a chamada da jornada: ${chamadaDaJornada.message}`);
    }

    callId = chamadaDaJornada.callId;

    const chamadaSemJs = await saveCall({
      tenantId,
      eventId,
      actorId: admin.id,
      kind: 'PAPER',
      slug: `f73-sem-js-${RUN_ID}`,
      title: `Chamada sem JavaScript ${RUN_ID}`,
      opensAt: new Date(Date.now() - 86_400_000),
      closesAt: new Date(Date.now() + 20 * 86_400_000),
      maxSubmissionsPerAuthor: 0,
    });

    if (!chamadaSemJs.ok) {
      throw new Error(`Falha ao criar a chamada sem JS: ${chamadaSemJs.message}`);
    }

    callSemJsId = chamadaSemJs.callId;

    for (const id of [callId, callSemJsId]) {
      const publicada = await setCallPublished({
        tenantId,
        eventId,
        callId: id,
        actorId: admin.id,
        isPublished: true,
      });

      if (!publicada.ok) throw new Error(`Falha ao publicar a chamada: ${publicada.message}`);
    }

    /** A autora OCULTA: a lista de aprovados publica o nome completo dela (exceção). */
    const autoraOculta = await criarAutora(NOME_DA_AUTORA, true);
    const autoraSemJs = await criarAutora(NOME_DA_AUTORA_NO_JS, false);

    subAceita = randomUUID();
    subEmAvaliacao = randomUUID();
    subSemJs = randomUUID();

    await criarSubmissao({
      id: subAceita,
      callId,
      protocol: 'F73-A',
      titulo: TITULO_ACEITO,
      status: 'ACCEPTED',
      authorId: autoraOculta,
    });

    await criarSubmissao({
      id: subEmAvaliacao,
      callId,
      protocol: 'F73-B',
      titulo: TITULO_EM_AVALIACAO,
      status: 'UNDER_REVIEW',
      authorId: autoraOculta,
    });

    await criarSubmissao({
      id: subSemJs,
      callId: callSemJsId,
      protocol: 'F73-SJ',
      titulo: `Trabalho do caso sem JavaScript ${RUN_ID}`,
      status: 'ACCEPTED',
      authorId: autoraSemJs,
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test('1. a jornada: publicar parcial → prévia com texto e lista → final travado → reabrir → editar → rascunho não vaza', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await signInAs(page, adminEmail);
  await page.goto(urlDaTela());

  const painel = page.getByTestId(cartao(callId));
  await expect(painel).toBeVisible();

  const acao = (nome: 'SALVAR_RASCUNHO' | 'PUBLICAR_PARCIAL' | 'PUBLICAR_FINAL' | 'REABRIR') =>
    painel.getByTestId(`call-result-action-${nome}-${callId}`);

  // ── 1. SEM RESULTADO: só os gestos que a tabela legal permite ────────────────
  await expect(painel).toHaveAttribute('data-result-state', 'SEM_RESULTADO');
  await expect(painel.getByTestId(`call-result-state-${callId}`)).toContainText(
    'ainda não teve resultado',
  );
  await expect(painel.getByTestId(`call-result-published-${callId}`)).toContainText(
    'Ainda não publicado',
  );

  /**
   * A tela NÃO inventa legalidade: de SEM_RESULTADO o final não é legal (o resultado
   * final vem depois de o resultado existir), então o botão não existe no DOM. E a
   * lista da prévia ainda está vazia.
   */
  await expect(acao('SALVAR_RASCUNHO')).toBeVisible();
  await expect(acao('PUBLICAR_PARCIAL')).toBeVisible();
  await expect(acao('PUBLICAR_FINAL')).toHaveCount(0);
  await expect(acao('REABRIR')).toHaveCount(0);

  await expect(painel.getByTestId(`call-result-preview-empty-${callId}`)).toBeVisible();

  // ── 2. A ESCOLHA: as aceitas vêm marcadas, e o organizador escolhe mais ─────
  const caixaAceita = painel
    .getByTestId(`call-result-option-${subAceita}`)
    .getByRole('checkbox');
  const caixaEmAvaliacao = painel
    .getByTestId(`call-result-option-${subEmAvaliacao}`)
    .getByRole('checkbox');

  await expect(caixaAceita).toBeChecked();
  await expect(caixaEmAvaliacao).not.toBeChecked();

  /** A decisão do comitê aparece ao lado — e a tela lê o mapa do DOMÍNIO. */
  await expect(painel.getByTestId(`call-result-option-${subAceita}`)).toContainText('Aceita');
  await expect(painel.getByTestId(`call-result-option-${subEmAvaliacao}`)).toContainText(
    'Em avaliação',
  );

  /** Publicar um trabalho EM AVALIAÇÃO é escolha do organizador (decisão 1 do humano). */
  await caixaEmAvaliacao.check();

  await painel.getByTestId(`call-result-text-${callId}`).fill(TEXTO_PARCIAL);
  await painel.getByTestId(`call-result-next-steps-${callId}`).fill(PROXIMOS_PASSOS);

  await expect(painel).toContainText('Ao publicar, o texto e a lista vão ao ar');

  // ── 3. PUBLICAR PARCIAL: a prévia passa a mostrar o documento REAL ──────────
  await acao('PUBLICAR_PARCIAL').click();

  await expect(painel).toHaveAttribute('data-result-state', 'PARCIAL', { timeout: 30_000 });
  await expect(painel.getByTestId(`call-result-feedback-${callId}`)).toContainText(
    'Resultado parcial publicado',
  );

  const previa = painel.getByTestId(`call-result-preview-${callId}`);
  await expect(previa.getByTestId('call-result-public-view')).toBeVisible();
  await expect(previa).toContainText(TEXTO_PARCIAL);
  await expect(previa).toContainText(PROXIMOS_PASSOS);
  await expect(previa).toContainText(TITULO_ACEITO);
  await expect(previa).toContainText(TITULO_EM_AVALIACAO);

  /**
   * A lista publicada tem DOIS itens — as duas submissões ESCOLHIDAS —, e a autoria sai
   * com o nome COMPLETO, inclusive de quem se oculta no perfil público (a exceção
   * declarada da FASE 73, decisão 2 do humano).
   */
  await expect(previa.getByTestId('call-result-public-item')).toHaveCount(2);
  await expect(previa).toContainText(NOME_DA_AUTORA);

  /** Os dois itens agora estão no ar: o selo "já publicada" aparece nos dois. */
  await expect(painel.getByText('já publicada')).toHaveCount(2);

  await expect(painel.getByTestId(`call-result-published-${callId}`)).toContainText(
    'Publicado em',
  );

  // ── 4. PUBLICAR FINAL: trava, e os gestos de edição SAEM da tela ────────────
  await acao('PUBLICAR_FINAL').click();

  await expect(painel).toHaveAttribute('data-result-state', 'FINAL', { timeout: 30_000 });
  await expect(painel.getByTestId(`call-result-locked-${callId}`)).toBeVisible();
  await expect(painel.getByTestId(`call-result-state-${callId}`)).toContainText('travado');

  await expect(acao('SALVAR_RASCUNHO')).toHaveCount(0);
  await expect(acao('PUBLICAR_PARCIAL')).toHaveCount(0);
  await expect(acao('PUBLICAR_FINAL')).toHaveCount(0);
  await expect(painel.getByTestId(`call-result-locked-note-${callId}`)).toBeVisible();

  /** O conteúdo está travado de verdade: o campo é de leitura, e o público segue vendo. */
  await expect(painel.getByTestId(`call-result-text-${callId}`)).toHaveAttribute('readonly', '');
  await expect(
    painel.getByTestId(`call-result-option-${subAceita}`).getByRole('checkbox'),
  ).toBeDisabled();
  await expect(previa).toContainText(TEXTO_PARCIAL);

  // ── 5. REABRIR: a confirmação nativa diz a consequência ANTES do clique ─────
  const reabrir = painel.getByTestId(`call-result-reopen-${callId}`);
  await reabrir.locator('summary').click();

  await expect(reabrir).toContainText('deixa de ser final');
  await expect(reabrir).toContainText('trilha');

  await acao('REABRIR').click();

  await expect(painel).toHaveAttribute('data-result-state', 'PARCIAL', { timeout: 30_000 });
  await expect(painel.getByTestId(`call-result-feedback-${callId}`)).toContainText('reaberto');

  /** A edição voltou: os três gestos estão de novo na tela, e o campo é editável. */
  await expect(acao('SALVAR_RASCUNHO')).toBeVisible();
  await expect(acao('PUBLICAR_PARCIAL')).toBeVisible();
  await expect(painel.getByTestId(`call-result-text-${callId}`)).not.toHaveAttribute(
    'readonly',
    '',
  );

  /**
   * E a LISTA não foi apagada pelo reabrir: caixa desabilitada não é enviada pelo
   * formulário, então os ids publicados viajam em campos ocultos. Se eles faltassem,
   * a prévia voltaria com 0 itens — e o reabrir teria despublicado os trabalhos.
   */
  await expect(previa.getByTestId('call-result-public-item')).toHaveCount(2);

  // ── 6. EDITAR DEPOIS DE REABRIR: o texto revisado vai ao ar ─────────────────
  await painel.getByTestId(`call-result-text-${callId}`).fill(TEXTO_REVISADO);
  await acao('PUBLICAR_PARCIAL').click();

  await expect(painel).toHaveAttribute('data-result-state', 'PARCIAL', { timeout: 30_000 });
  await expect(previa).toContainText(TEXTO_REVISADO);

  // ── 7. SALVAR RASCUNHO DESPUBLICA: rascunho não vaza ────────────────────────
  await painel.getByTestId(`call-result-text-${callId}`).fill(TEXTO_RASCUNHO);
  await acao('SALVAR_RASCUNHO').click();

  await expect(painel).toHaveAttribute('data-result-state', 'RASCUNHO', { timeout: 30_000 });
  await expect(painel.getByTestId(`call-result-preview-empty-${callId}`)).toBeVisible();
  await expect(previa.getByTestId('call-result-public-view')).toHaveCount(0);
  await expect(painel.getByTestId(`call-result-state-${callId}`)).toContainText(
    'Ninguém fora da organização',
  );

  /** E o banco confirma o que a tela diz: RASCUNHO, com o texto guardado e sem data. */
  const gravado = await resultadoGravado(callId);
  expect(gravado.estado).toBe('RASCUNHO');
  expect(gravado.texto).toBe(TEXTO_RASCUNHO);
  expect(gravado.publicadoEm).toBeUndefined();
});

test('2. SEM JavaScript: escrever, escolher e PUBLICAR de verdade', async ({ browser }) => {
  test.setTimeout(120_000);

  const contexto = await browser.newContext({ javaScriptEnabled: false });
  const page = await contexto.newPage();

  try {
    await signInAs(page, adminEmail);
    await page.goto(urlDaTela());

    const painel = page.getByTestId(cartao(callSemJsId));
    await expect(painel).toBeVisible();
    await expect(painel).toHaveAttribute('data-result-state', 'SEM_RESULTADO');

    const caixa = painel.getByTestId(`call-result-option-${subSemJs}`).getByRole('checkbox');
    await expect(caixa).toBeChecked();

    await painel.getByTestId(`call-result-text-${callSemJsId}`).fill(TEXTO_PARCIAL);
    await painel.getByTestId(`call-result-next-steps-${callSemJsId}`).fill(PROXIMOS_PASSOS);

    /**
     * O POST nativo do formulário é o gesto: sem hidratação não existe `onClick` para
     * interceptar, e o `formAction` do botão tem de ser um endpoint de verdade. Se
     * dependesse do bundle, nada aconteceria aqui — e é o caso do organizador no
     * pavilhão, com a rede do evento (a mesma régua da FASE 70/FASE 72).
     */
    await painel.getByTestId(`call-result-action-PUBLICAR_PARCIAL-${callSemJsId}`).click();
    await page.waitForLoadState('load');

    await expect
      .poll(async () => (await resultadoGravado(callSemJsId)).estado, { timeout: 30_000 })
      .toBe('PARCIAL');

    const gravado = await resultadoGravado(callSemJsId);
    expect(gravado.texto).toBe(TEXTO_PARCIAL);
    expect(gravado.proximosPassos).toBe(PROXIMOS_PASSOS);
    expect([...gravado.publicados]).toEqual([subSemJs]);

    /**
     * E a página que voltou do POST já é a nova: o estado e a prévia foram
     * renderizados no SERVIDOR, sem uma linha de JavaScript ter rodado.
     */
    await expect(painel).toHaveAttribute('data-result-state', 'PARCIAL');
    await expect(painel.getByTestId(`call-result-preview-${callSemJsId}`)).toContainText(
      TEXTO_PARCIAL,
    );
    await expect(painel.getByTestId(`call-result-preview-${callSemJsId}`)).toContainText(
      NOME_DA_AUTORA_NO_JS,
    );
  } finally {
    await contexto.close();
  }
});

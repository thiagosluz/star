/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A PROPOSTA CIENTÍFICA: A RECUSA COM SAÍDA E O QUE A CHAMADA EXIGE
 *  (FASE 74 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. a página da chamada de ARTIGO diz, em "O que esta chamada pede", que o envio
 *      exige o PDF ANONIMIZADO — e que o identificado é recomendação. Antes, essa
 *      lista só falava dos campos do formulário, e a exigência só aparecia depois,
 *      na recusa;
 *   2. o autor preenche a proposta pela página pública, o servidor recusa por falta
 *      do arquivo e a action o leva DIRETO à página do RASCUNHO que já foi gravado
 *      (`/submissoes/<id>?rascunho=1`), com o aviso que explica a chegada;
 *   3. ali estão os bloqueios da régua (a recusa cega entre eles), o anexo e o
 *      envio — o trabalho escrito não se perde e o caminho não tem tela intermediária;
 *   4. tentar de novo NÃO cria um segundo rascunho: o caminho é retomado, e a lista
 *      "Minhas submissões" continua com um só;
 *   5. SEM JavaScript, o POST nativo do formulário chega ao MESMO lugar: o redirect
 *      é do servidor, não do bundle.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FIXTURE É DESTE ARQUIVO (armadilha 62)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Instituição, evento, trilha e chamada nascem aqui. A chamada é criada por
 *  ESCRITA DIRETA porque o que esta spec mede é a PONTA PÚBLICA (o formulário, a
 *  recusa e a área do autor) — o painel de chamadas tem cobertura própria em
 *  `call-for-proposals.spec.ts` e em `f73-*`. O `requiresBlindReview` é explícito:
 *  o caso é a chamada cega (o padrão de PAPER, gravado como DADO).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createTenant, e2eDb } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'proposta-f74';
const slug = `${TENANT_LABEL}-${RUN_ID}`;
const EVENT_SLUG = `evento-f74-${RUN_ID}`;
const CALL_SLUG = `artigos-f74-${RUN_ID}`;
const CALL_TITLE = `Artigos completos ${RUN_ID}`;
const PROPOSAL_TITLE = `Território e saúde coletiva ${RUN_ID}`;
/** O caso sem JavaScript é OUTRA pessoa: nenhum teste depende do rascunho do outro. */
const PROPOSAL_TITLE_NO_JS = `Território e saúde coletiva sem JavaScript ${RUN_ID}`;

/** O resumo precisa passar do mínimo do domínio (150 caracteres). */
const PROPOSAL_ABSTRACT =
  'Um estudo sobre território e saúde coletiva: como a desigualdade de acesso se ' +
  'desenha no mapa da cidade e o que a atenção básica consegue fazer com os dados ' +
  'que já registra. O texto detalha o método, a amostra e os resultados esperados.';

let tenantId: string;
let eventId: string;
let trackId: string;
let callId: string;
let authorEmail: string;
let authorNoJsEmail: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f74.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Proposta Científica ${RUN_ID}`,
    });
    tenantId = tenant.id;
    eventId = randomUUID();
    trackId = randomUUID();
    callId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 30 * 86_400_000);

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: EVENT_SLUG,
          title: `Simpósio de Saúde Coletiva ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          registrationClosesAt: new Date(Date.now() + 25 * 86_400_000),
        },
      });

      await tx.track.create({
        data: {
          id: trackId,
          tenantId,
          eventId,
          slug: `trilha-f74-${RUN_ID}`,
          name: 'Saúde e território',
          requiresBlindReview: true,
          requiredReviews: 2,
        },
      });

      /**
       * A CHAMADA ABRE ONTEM E FECHA DAQUI A 20 DIAS: o estado é calculado na
       * leitura, e a janela precisa estar aberta no instante do clique.
       */
      await tx.callForProposals.create({
        data: {
          id: callId,
          tenantId,
          eventId,
          kind: 'PAPER',
          slug: CALL_SLUG,
          title: CALL_TITLE,
          summary: 'Artigos completos para o simpósio.',
          opensAt: new Date(Date.now() - 86_400_000),
          closesAt: new Date(Date.now() + 20 * 86_400_000),
          isPublished: true,
          /** O caso da fase: PAPER cega — o envio exige o anexo anonimizado. */
          requiresBlindReview: true,
          trackId,
        },
      });
    });

    const author = await signUpVia(api, `Autora da Proposta ${RUN_ID}`);
    authorEmail = author.email;

    const authorNoJs = await signUpVia(api, `Autora sem JavaScript ${RUN_ID}`);
    authorNoJsEmail = authorNoJs.email;
  } finally {
    await api.dispose();
  }
});

const publicCallUrl = () => `/t/${slug}/eventos/${EVENT_SLUG}/chamada/${CALL_SLUG}`;

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('a chamada de artigo e a recusa com saída', () => {
  test('a página diz, ANTES do envio, que o PDF anonimizado é exigido', async ({ page }) => {
    await page.goto(publicCallUrl());

    /**
     * A lista é a MESMA do servidor (`submissionArtifactRequirements`): o teste lê
     * o texto que a pessoa lê, e não uma regra reimplementada aqui.
     */
    const exigencias = page.getByTestId('call-requirements');
    await expect(exigencias).toBeVisible({ timeout: 30_000 });

    const anonimizado = page.getByTestId('call-requirement-BLIND_PDF');
    await expect(anonimizado).toContainText(/anonimizado/i);
    await expect(anonimizado).toHaveAttribute('data-requirement', 'REQUIRED');

    /**
     * O IDENTIFICADO é recomendação — e a etiqueta diz por quê: é ele que vai para
     * a publicação. A distinção é o que separa "sem isto não envia" de "sem isto
     * não publica", e é ela que a tela precisava contar.
     */
    const identificado = page.getByTestId('call-requirement-IDENTIFIED_PDF');
    await expect(identificado).toContainText(/identificação dos autores/i);
    await expect(identificado).toContainText(/publicação/i);
    await expect(identificado).toHaveAttribute('data-requirement', 'RECOMMENDED');

    /**
     * ── O CAMINHO DO ARQUIVO, DITO ANTES DO ENVIO (FASE 74 · fatia 4) ─────────
     *
     *  A decisão da fatia foi NÃO duplicar a esteira de upload na página pública: o
     *  anexo e o envio acontecem na área do autor, onde eles já existem inteiros. O
     *  que a página pública ganhou foi a PROMESSA do caminho, antes de a pessoa
     *  escrever 3.000 caracteres e descobrir a recusa — e é isso que este teste lê,
     *  no lugar onde ela lê.
     */
    const avisoDoAnexo = page.getByTestId('proposal-attachment-notice');
    await expect(avisoDoAnexo).toBeVisible();
    await expect(avisoDoAnexo).toContainText(/exige um arquivo/i);
    await expect(avisoDoAnexo).toContainText(/rascunho fica salvo/i);
    await expect(avisoDoAnexo).toContainText(/sua área/i);
  });

  test('o autor envia e a recusa o leva DIRETO ao rascunho, com o aviso e o anexo', async ({
    page,
  }) => {
    await signInAs(page, authorEmail);

    await page.goto(publicCallUrl());

    const form = page.getByTestId('proposal-form');
    await expect(form).toBeVisible({ timeout: 30_000 });

    await form.getByLabel('Título').fill(PROPOSAL_TITLE);
    await form.getByLabel('Resumo').fill(PROPOSAL_ABSTRACT);
    await form.getByLabel('Palavras-chave').fill('território, saúde coletiva, atenção básica');
    await page.getByTestId('proposal-submit').click();

    /**
     * ── A TENTATIVA TERMINA NA PÁGINA DO RASCUNHO (ajuste da fatia 2) ─────────
     *
     *  Não existe mais a caixa de erro com o link "Continuar na área do autor": a
     *  action redireciona para o rascunho que o serviço acabou de gravar, e o
     *  `?rascunho=1` é o marcador de que a chegada veio de uma recusa. O teste
     *  espera a NAVEGAÇÃO antes de consultar o banco — o POST da server action é
     *  assíncrono, e ler o banco no instante do clique mediria a corrida, não o
     *  comportamento. O id exato é conferido logo abaixo.
     */
    await expect(page).toHaveURL(
      new RegExp(`/t/${slug}/submissoes/[0-9a-f-]+\\?rascunho=1$`),
      { timeout: 30_000 },
    );

    const rascunho = await e2eDb.submission.findFirstOrThrow({
      where: { tenantId, eventId, callId, title: PROPOSAL_TITLE },
      select: { id: true, status: true, submittedAt: true },
    });

    expect(rascunho.status).toBe('DRAFT');
    expect(rascunho.submittedAt).toBeNull();

    await expect(page).toHaveURL(
      new RegExp(`/t/${slug}/submissoes/${rascunho.id}\\?rascunho=1$`),
    );

    const aviso = page.getByTestId('draft-arrival-notice');
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveText(
      'Seu rascunho foi salvo. Anexe o arquivo e envie para avaliação.',
    );

    /**
     * O `?rascunho=1` FICA na URL depois do reload (decisão registrada na página):
     * ele descreve o fato, não um evento de uso único. Recarregar a tela mantém o
     * aviso e os bloqueios, e é isso que a linha abaixo mede.
     */
    await page.reload();
    await expect(page.getByTestId('draft-arrival-notice')).toBeVisible();

    await expect(page.getByTestId('submission-status')).toHaveText('Rascunho');
    await expect(page.getByRole('heading', { name: PROPOSAL_TITLE })).toBeVisible();

    /**
     * A TELA DO RASCUNHO CONTA A VERDADE: o bloqueio que a página mostra é o mesmo
     * que o serviço cobra (a lista sai da régua de prontidão), e a recusa cega está
     * entre eles.
     */
    const bloqueios = page.getByTestId('submit-blockers');
    await expect(bloqueios).toContainText(/revisão cega/i);

    /** E o caminho do anexo está ali: o uploader da versão cega, pronto para anexar. */
    const arquivos = page.getByTestId('submission-files');
    await expect(arquivos).toBeVisible();
    await expect(arquivos).toContainText(/Versão cega \(sem identificação\)/);
    await expect(arquivos.getByRole('button', { name: 'Anexar arquivo' })).toHaveCount(2);

    // ── A SEGUNDA TENTATIVA NÃO CRIA OUTRO RASCUNHO ────────────────────────────
    await page.goto(publicCallUrl());

    const segundoFormulario = page.getByTestId('proposal-form');
    await expect(segundoFormulario).toBeVisible({ timeout: 30_000 });

    await segundoFormulario.getByLabel('Título').fill(PROPOSAL_TITLE);
    await segundoFormulario.getByLabel('Resumo').fill(PROPOSAL_ABSTRACT);
    await segundoFormulario.getByLabel('Palavras-chave').fill('território, saúde coletiva, atenção básica');
    await page.getByTestId('proposal-submit').click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${slug}/submissoes/${rascunho.id}\\?rascunho=1$`),
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('draft-arrival-notice')).toBeVisible();

    const total = await e2eDb.submission.count({
      where: { tenantId, eventId, callId, deletedAt: null },
    });

    expect(total).toBe(1);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  SEM JAVASCRIPT — O POST NATIVO CHEGA AO MESMO LUGAR
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   *  O redirect é do SERVIDOR: a action responde com a navegação, e o formulário do
   *  React 19 sem hidratação é um `<form>` HTML de verdade. Se o caminho dependesse
   *  de `useRouter`, o clique não faria nada aqui — é por isso que o caso existe.
   */
  test.describe('sem JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('o POST nativo chega ao rascunho, com o aviso e os bloqueios', async ({ page }) => {
      test.setTimeout(120_000);

      await signInAs(page, authorNoJsEmail);
      await page.goto(publicCallUrl());

      const form = page.getByTestId('proposal-form');
      await expect(form).toBeVisible({ timeout: 30_000 });

      await form.getByLabel('Título').fill(PROPOSAL_TITLE_NO_JS);
      await form.getByLabel('Resumo').fill(PROPOSAL_ABSTRACT);
      await form.getByLabel('Palavras-chave').fill('território, saúde coletiva, atenção básica');
      await page.getByTestId('proposal-submit').click();
      await page.waitForLoadState('load');

      await expect(page).toHaveURL(
        new RegExp(`/t/${slug}/submissoes/[0-9a-f-]+\\?rascunho=1$`),
        { timeout: 30_000 },
      );

      const rascunho = await e2eDb.submission.findFirstOrThrow({
        where: { tenantId, eventId, callId, title: PROPOSAL_TITLE_NO_JS },
        select: { id: true, status: true, submittedAt: true },
      });

      expect(rascunho.status).toBe('DRAFT');
      expect(rascunho.submittedAt).toBeNull();

      await expect(page).toHaveURL(
        new RegExp(`/t/${slug}/submissoes/${rascunho.id}\\?rascunho=1$`),
        { timeout: 30_000 },
      );

      await expect(page.getByTestId('draft-arrival-notice')).toBeVisible();
      await expect(page.getByTestId('submit-blockers')).toContainText(/revisão cega/i);
      await expect(page.getByTestId('submission-files')).toContainText(
        /Versão cega \(sem identificação\)/,
      );
    });
  });
});

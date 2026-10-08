/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O FORMULÁRIO NA MÃO DO PARTICIPANTE (FASE 70 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM SE INSCREVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. os campos que o organizador declarou aparecem na tela de inscrição,
 *         DEPOIS dos fixos, com rótulo de verdade, ajuda e a FINALIDADE declarada;
 *      2. campo obrigatório em branco é RECUSADO com a mensagem do DOMÍNIO (com o
 *         rótulo), nada é gravado — e o que a pessoa digitou nos outros campos VOLTA
 *         para a tela (a lição da E54);
 *      3. o que passa vira DADO em `registrations.formResponses`, ao lado do CPF;
 *      4. **tudo isso funciona SEM JavaScript** (`javaScriptEnabled: false`): o
 *         formulário é um `<form>` de verdade e o POST acontece com o bundle desligado;
 *      5. a pessoa APAGA as respostas sem cancelar a inscrição, pela tela de "Minhas
 *         inscrições" — e a vaga, o status e o CPF continuam onde estavam.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não monta o formulário: quem o monta é o organizador, e isso tem spec própria
 *  (`f70-formulario-do-organizador.spec.ts`). Aqui a configuração é FIXTURE — escrita
 *  em `Event.settings` no `beforeAll` —, porque o sujeito é o outro lado da tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createActivity, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { withTenant } from '../../src/lib/db/tenant-client';
import { registerForActivity, registerForEvent } from '../../src/lib/events/registration-service';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f70-participante';
const EVENT_SLUG = `evento-participante-${RUN_ID}`;
/** A oficina COM inscrição própria: é por ela que a pessoa entra sem ver o formulário. */
const ACTIVITY_SLUG = `oficina-participante-${RUN_ID}`;

const CPF_VALIDO = '529.982.247-25';

let tenantId: string;
let tenantSlug: string;
let eventId: string;

function urlDaInscricao(): string {
  return `/t/${tenantSlug}/eventos/${EVENT_SLUG}/inscricao`;
}

/** A linha do EVENTO da pessoa — o depósito que a inscrição e a eliminação mexem. */
async function linhaDoEvento(userId: string) {
  return withTenant(tenantId, (tx) =>
    tx.registration.findFirst({
      where: { eventId, userId, activityId: null, deletedAt: null },
      select: {
        id: true,
        status: true,
        formResponses: true,
        accessibilityNotes: true,
        consentData: true,
      },
    }),
  );
}

/** Cria uma conta pela API, vincula como participante e devolve o usuário. */
async function novaPessoa(
  page: Page,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f70part.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  await linkUser({ userId: user.id, tenantId, kind: 'PARTICIPANT' });
  await grantRole({ userId: user.id, tenantId, role: 'PARTICIPANT' });

  /**
   * O login é EXPLÍCITO, e não herdado do cadastro: o vínculo e o papel acabaram de
   * ser criados, e a sessão precisa carregá-los para a tela oferecer a inscrição — a
   * mesma ordem que o E2E da jornada usa.
   */
  const signIn = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!signIn.ok()) {
    throw new Error(`Falha ao autenticar ${email}: HTTP ${signIn.status()}`);
  }

  return { id: user.id, email };
}

test.beforeAll(async () => {
  const tenant = await createTenant({
    label: TENANT_LABEL,
    name: `Instituição do Participante ${RUN_ID}`,
  });

  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const event = await createEvent({
    tenantId,
    slug: EVENT_SLUG,
    title: `Congresso do Participante ${RUN_ID}`,
    status: 'REGISTRATION_OPEN',
    capacity: 50,
  });

  eventId = event.id;

  /**
   * O FORMULÁRIO É FIXTURE, e é gravado como o serviço do organizador o gravaria:
   * dois campos declarados — o obrigatório de texto curto (o caso que RECUSA) e o
   * longo com finalidade (o caso que a LGPD manda justificar).
   */
  await withTenant(tenantId, (tx) =>
    tx.event.update({
      where: { id: eventId },
      data: {
        settings: {
          registrationForm: [
            {
              key: 'instituicao',
              label: 'Instituição de origem',
              type: 'SHORT_TEXT',
              required: true,
              help: 'Onde você estuda ou trabalha hoje.',
            },
            {
              key: 'observacoes',
              label: 'Observações para a organização',
              type: 'LONG_TEXT',
              required: false,
              purpose: 'Registrar pedidos que não cabem nas outras perguntas.',
            },
          ],
        },
      },
    }),
  );

  /**
   * A OFICINA com inscrição PRÓPRIA — a porta por onde a pessoa entra e NÃO vê o
   * formulário do evento. É o cenário da lacuna que o fecho da FASE 70 consertou: a
   * inscrição no evento nasce junto (fatia 2), e a porta "Completar meus dados" é a
   * única onde as perguntas do organizador aparecem para quem veio por aqui.
   */
  await createActivity({
    tenantId,
    eventId,
    slug: ACTIVITY_SLUG,
    title: `Oficina do participante ${RUN_ID}`,
    capacity: 10,
    requiresRegistration: true,
  });
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('o formulário declarado na tela de inscrição', () => {
  test('1. renderiza os campos, RECUSA o obrigatório com a mensagem do domínio e não apaga o digitado', async ({
    page,
  }) => {
    const pessoa = await novaPessoa(page, `Pessoa Um ${RUN_ID}`);

    await page.goto(urlDaInscricao());

    const instituicao = page.getByTestId('event-declared-field-instituicao');
    const observacoes = page.getByTestId('event-declared-field-observacoes');

    await expect(instituicao).toBeVisible({ timeout: 30_000 });

    /** O rótulo é o do organizador, com a ajuda e a finalidade declaradas ao lado. */
    await expect(page.getByText('Instituição de origem')).toBeVisible();
    await expect(page.getByText('Onde você estuda ou trabalha hoje.')).toBeVisible();
    await expect(page.getByText('Registrar pedidos que não cabem nas outras perguntas.')).toBeVisible();
    await expect(instituicao).toHaveAttribute('required', '');

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  CAMADA 1 × CAMADA 2, COMO NO CONSENTIMENTO (a mesma régua da jornada)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O `required` do HTML é UX; quem DECIDE é o domínio, na Server Action. Para
     *  medir a camada 2 é preciso contornar a 1 — e é o que este teste faz, do mesmo
     *  jeito que o E2E da jornada faz com o consentimento: sem JavaScript nenhum
     *  `formnovalidate` faria isso, e é por isso que ele é usado aqui.
     */
    await observacoes.fill('Chego às 9h e preciso de mesa perto da tomada.');

    await page.evaluate(() => {
      const form = document.querySelector('form[data-testid="event-registration-form"]');
      form?.setAttribute('novalidate', '');
    });

    await page.getByRole('checkbox', { name: /Autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /Confirmar inscrição no evento/i }).click();

    /** A mensagem é a do DOMÍNIO, com o RÓTULO do campo — nada inventado na tela. */
    await expect(page.getByTestId('event-registration-error')).toContainText(
      'Preencha "Instituição de origem".',
      { timeout: 30_000 },
    );

    /** E nada foi gravado: a recusa do obrigatório é a inscrição inteira. */
    expect(await linhaDoEvento(pessoa.id)).toBeNull();

    /**
     * O QUE A PESSOA DIGITOU CONTINUA NA TELA (lição da E54). Sem os `values`, a
     * recusa chegaria com as observações em branco — e a pessoa redigitaria tudo para
     * preencher um campo que ela nem tocou.
     */
    await expect(observacoes).toHaveValue('Chego às 9h e preciso de mesa perto da tomada.');

    // ── Agora COM o obrigatório: a inscrição passa, e o banco é a prova ─────────
    await page.getByTestId('event-registration-cpf').fill(CPF_VALIDO);
    await instituicao.fill('UFBA');
    await page.getByRole('checkbox', { name: /Autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /Confirmar inscrição no evento/i }).click();

    await expect
      .poll(async () => (await linhaDoEvento(pessoa.id)) !== null, { timeout: 30_000 })
      .toBe(true);

    const linha = await linhaDoEvento(pessoa.id);

    expect(linha?.status).toBe('CONFIRMED');
    expect(linha?.formResponses).toMatchObject({
      instituicao: 'UFBA',
      observacoes: 'Chego às 9h e preciso de mesa perto da tomada.',
      cpf: '52998224725',
    });
  });

  test('2. SEM JavaScript o campo declarado é gravado do mesmo jeito', async ({ browser }) => {
    const contexto = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();

    try {
      const pessoa = await novaPessoa(page, `Pessoa Dois ${RUN_ID}`);

      await page.goto(urlDaInscricao());

      const instituicao = page.getByTestId('event-declared-field-instituicao');
      await expect(instituicao).toBeVisible({ timeout: 30_000 });

      /**
       * Com o bundle desligado não existe hidratação: o envio é um POST de formulário
       * de verdade. O `<select>` do Sim/Não e o `required` do HTML são nativos — e é
       * por isso que o formulário do participante não pode depender de JavaScript.
       */
      await instituicao.fill('IFBA');
      await page.getByTestId('event-declared-field-observacoes').fill('Vou de ônibus.');
      await page.getByTestId('event-registration-cpf').fill(CPF_VALIDO);
      await page.getByRole('checkbox', { name: /Autorizo o tratamento/i }).check();
      await page.getByRole('button', { name: /Confirmar inscrição no evento/i }).click();

      /**
       * A ESPERA É NO BANCO, e não na tela: o gesto não é a prova, o fato gravado é
       * (a lição da E50/E54).
       */
      await expect
        .poll(
          async () => {
            const linha = await linhaDoEvento(pessoa.id);
            return linha?.formResponses ?? null;
          },
          { timeout: 30_000 },
        )
        .toMatchObject({ instituicao: 'IFBA', observacoes: 'Vou de ônibus.' });
    } finally {
      await contexto.close();
    }
  });
});

test.describe('a porta de completar de quem veio pela ATIVIDADE', () => {
  test('4. vê e responde as perguntas do organizador — e a segunda passada não apaga o que já havia', async ({
    page,
  }) => {
    const pessoa = await novaPessoa(page, `Pessoa Quatro ${RUN_ID}`);

    /**
     * A ENTRADA É PELA ATIVIDADE, pelo SERVIÇO real: é o caminho que a fatia 2 consertou
     * e que tem spec própria (`f70-atividade-materializa-evento.test.ts`). Aqui ele é
     * FIXTURE — o sujeito deste caso é a porta de completar, do outro lado.
     */
    const entrada = await registerForActivity({
      tenantId,
      eventSlug: EVENT_SLUG,
      activitySlug: ACTIVITY_SLUG,
      userId: pessoa.id,
      consentData: true,
      consentImage: false,
      accessibilityNotes: 'Preciso de rampa de acesso',
    });

    expect(entrada.ok, entrada.ok ? 'ok' : entrada.message).toBe(true);

    /**
     * A linha do evento nasceu com o depósito VAZIO — é o defeito de origem: quem veio
     * pela oficina não respondeu nada do formulário do evento porque nunca o viu.
     */
    expect((await linhaDoEvento(pessoa.id))?.formResponses).toEqual({});

    await page.goto(urlDaInscricao());

    /** Já inscrito: a página mostra o estado, e é nele que a porta vive. */
    await expect(page.getByTestId('event-registration-status')).toBeVisible({ timeout: 30_000 });

    const porta = page.getByTestId('event-registration-data-form');

    await expect(porta).toBeVisible();

    /** O resumo DIZ que as perguntas do evento estão ali — a vitrine da porta. */
    await expect(porta.locator('summary')).toContainText('as perguntas do evento');

    /** O `<details>` abre por clique nativo: a porta funciona sem JavaScript. */
    await porta.locator('summary').click();

    /** AS PERGUNTAS DO ORGANIZADOR ESTÃO AQUI — era exatamente o que faltava. */
    const declarados = page.getByTestId('event-registration-data-declared-fields');

    await expect(declarados).toBeVisible();
    await expect(declarados).toContainText('Perguntas do evento');

    const instituicao = page.getByTestId('event-declared-field-instituicao');

    await expect(instituicao).toBeVisible();
    await expect(page.getByTestId('event-declared-field-observacoes')).toBeVisible();
    await expect(instituicao).toHaveAttribute('required', '');

    /** Primeira passada: o obrigatório, o opcional e o CPF. */
    await instituicao.fill('UFBA');
    await page.getByTestId('event-declared-field-observacoes').fill('Chego às 9h.');
    await page.getByTestId('event-registration-data-cpf').fill(CPF_VALIDO);
    await page.getByRole('checkbox', { name: /Autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /Salvar meus dados/i }).click();

    await expect(page.getByTestId('event-registration-data-success')).toBeVisible({
      timeout: 30_000,
    });

    /** O FATO no banco — o gesto não é a prova. */
    expect((await linhaDoEvento(pessoa.id))?.formResponses).toMatchObject({
      instituicao: 'UFBA',
      observacoes: 'Chego às 9h.',
      cpf: '52998224725',
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A SEGUNDA PASSADA — E A PROVA DA MESCLA
     * ─────────────────────────────────────────────────────────────────────────────
     *  A porta volta a abrir com o que está gravado (nada de campo em branco sobre
     *  resposta que existe), a pessoa troca o obrigatório e DEIXA O OPCIONAL EM BRANCO.
     *  O opcional não entra no aceito, o serviço MESCLA, e a resposta antiga sobrevive.
     *  Se fosse sobrescrita, a pessoa perderia em silêncio o que escreveu antes.
     */
    await page.reload();
    await expect(page.getByTestId('event-registration-status')).toBeVisible({ timeout: 30_000 });

    const portaDeNovo = page.getByTestId('event-registration-data-form');

    await portaDeNovo.locator('summary').click();

    /** O que já foi respondido APARECE — a tela não finge que o campo está vazio. */
    await expect(page.getByTestId('event-declared-field-instituicao')).toHaveValue('UFBA');
    await expect(page.getByTestId('event-declared-field-observacoes')).toHaveValue('Chego às 9h.');
    await expect(page.getByTestId('event-registration-data-cpf')).toHaveValue('52998224725');

    await page.getByTestId('event-declared-field-instituicao').fill('IFBA');
    await page.getByTestId('event-declared-field-observacoes').fill('');
    await page.getByRole('checkbox', { name: /Autorizo o tratamento/i }).check();
    await page.getByRole('button', { name: /Salvar meus dados/i }).click();

    await expect(page.getByTestId('event-registration-data-success')).toBeVisible({
      timeout: 30_000,
    });

    const depois = await linhaDoEvento(pessoa.id);

    /** O obrigatório mudou; o opcional que NÃO foi respondido de novo continua lá. */
    expect(depois?.formResponses).toMatchObject({
      instituicao: 'IFBA',
      observacoes: 'Chego às 9h.',
      cpf: '52998224725',
    });

    /** E a inscrição é a MESMA: completar dados não cria inscrição nem consome vaga. */
    expect(depois?.status).toBe('CONFIRMED');
  });
});

test.describe('a eliminação das respostas', () => {
  test('3. a pessoa apaga as respostas SEM cancelar a inscrição — e sem JavaScript', async ({
    browser,
  }) => {
    const contexto = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();

    try {
      const pessoa = await novaPessoa(page, `Pessoa Três ${RUN_ID}`);

      /**
       * A INSCRIÇÃO é fixture pelo SERVIÇO real (o caminho da tela já está provado nos
       * casos 1 e 2): o sujeito aqui é a ELIMINAÇÃO, e ela precisa de um depósito cheio
       * — respostas declaradas, CPF e a nota de acessibilidade.
       */
      const inscricao = await registerForEvent({
        tenantId,
        eventSlug: EVENT_SLUG,
        userId: pessoa.id,
        consentData: true,
        consentImage: true,
        accessibilityNotes: 'Preciso de rampa de acesso',
        formResponses: {
          instituicao: 'UFBA',
          observacoes: 'Sem glúten, por favor.',
          cpf: '52998224725',
        },
      });

      expect(inscricao.ok, inscricao.ok ? 'ok' : inscricao.message).toBe(true);

      await page.goto(`/t/${tenantSlug}/minhas-inscricoes`);

      /** O caminho é VISÍVEL, na linha da inscrição no evento — e não um endereço oculto. */
      const controle = page.getByTestId('erase-form-responses');
      await expect(controle).toBeVisible({ timeout: 30_000 });

      /** O `<details>` abre por clique NATIVO: funciona com o bundle desligado. */
      await controle.locator('summary').click();

      /** A tela diz o que SAI e o que FICA antes do clique — é a decisão do humano. */
      await expect(controle).toContainText('Sai:');
      await expect(controle).toContainText('Fica:');
      await expect(controle).toContainText('CPF');

      await controle.getByRole('button', { name: /Apagar as minhas respostas/i }).click();

      /** O fato durável: o depósito fica só com o CPF. */
      await expect
        .poll(
          async () => {
            const linha = await linhaDoEvento(pessoa.id);
            return linha?.formResponses ?? null;
          },
          { timeout: 30_000 },
        )
        .toEqual({ cpf: '52998224725' });

      const depois = await linhaDoEvento(pessoa.id);

      /** A INSCRIÇÃO continua viva: a vaga e o histórico não foram tocados. */
      expect(depois?.status).toBe('CONFIRMED');
      expect(depois?.consentData).toBe(true);
      /** E a nota de acessibilidade saiu junto — é dado pessoal da mesma família. */
      expect(depois?.accessibilityNotes).toBeNull();

      /** O controle SAI da tela: não há mais o que apagar, e a tela não mente. */
      await page.reload();
      await expect(page.getByTestId('my-registrations')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('erase-form-responses')).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });
});

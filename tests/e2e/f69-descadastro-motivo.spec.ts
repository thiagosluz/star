/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O MOTIVO DO DESCADASTRO (FASE 69 · dívida E88)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA SPEC É NOVA, E NÃO UM CASO A MAIS NA f67
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A `tests/e2e/f67-descadastro.spec.ts` conta UMA história seriada (a pessoa sai,
 *  some do segmento, recebe o transacional e volta) sobre uma instituição de duas
 *  pessoas — e ela continua valendo como está: a saída pelo rodapé do e-mail
 *  REALMENTE gerado, sem motivo nenhum, é o caso que prova que a pergunta nova não
 *  passou a atrapalhar. Mexer nela para caber o motivo misturaria duas histórias
 *  (o rodapé do e-mail e a pergunta da página) no mesmo estado compartilhado, e é
 *  a dependência que o E71 já cobrou desta casa uma vez.
 *
 *  Então esta spec nasce com fixture PRÓPRIA e SEIS pessoas na MESMA atividade:
 *  cinco saem, cada uma por um caminho diferente, e a sexta NÃO sai — é ela quem
 *  mantém o segmento com alguém para receber, na hora em que a equipe lê os motivos
 *  (uma tela em que todo mundo saiu mostraria "ninguém" e metade do que se quer
 *  medir).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • **quem escolhe um motivo sai, e o motivo fica no banco** (o caminho feliz);
 *    • **quem não escolhe nada sai igual** — a pergunta é opcional de verdade, e o
 *      banco guarda "saiu sem dizer" em vez de recusar o formulário;
 *    • **"Prefiro não dizer" é uma ESCOLHA, e não um motivo**: se a ação não
 *      passasse a escolha pela regra do domínio, essa frase seria gravada na coluna
 *      `reason` — e o teste prende os dois lados (a saída E o vazio);
 *    • **valor que a tela nunca ofereceu não suja a coluna nem bloqueia a saída**:
 *      o rádio forjado no DOM é o que um POST montado à mão enviaria;
 *    • **o motivo viaja no MESMO `POST` da saída** — mesmo formulário, nenhum
 *      campo obrigatório, nenhum segundo passo;
 *    • **a equipe LÊ o motivo**: a linha agregada da tela de comunicação, montada a
 *      partir das saídas de caminhos diferentes (frase escolhida, texto escrito e
 *      três saídas sem motivo).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ENDEREÇO É DERIVADO, E NÃO GARIMPADO DO OUTBOX
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O token é determinístico por (instituição, pessoa), então o endereço pode ser
 *  montado a qualquer momento — e a f67 já prova, no caso 1 dela, que o endereço
 *  que o disparo escreve no rodapé é ESTE. Repetir o disparo inteiro aqui só
 *  tornaria a spec mais lenta e mais frágil sem provar nada de novo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';
import { unsubscribeUrlFor } from '../../src/lib/communication/unsubscribe-service';
import {
  UNSUBSCRIBE_REASON_DECLINE,
  UNSUBSCRIBE_REASON_FIELD,
  UNSUBSCRIBE_REASON_NOTE_FIELD,
} from '../../src/domain/communication/unsubscribe-reason-rules';

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f69-motivo-${RUN_ID}`;
const ATIVIDADE_TITULO = 'Oficina do motivo';

/**
 * Os nomes são o roteiro: cada pessoa sai por um caminho diferente, e o que a
 * linha agregada diz no fim depende de qual caminho cada uma usou.
 */
const NOME_COM_MOTIVO = 'Quitéria Com Motivo';
const NOME_SEM_MOTIVO = 'Sandro Sem Motivo';
const NOME_RECUSA = 'Rita Prefere Não Dizer';
const NOME_FORJADO = 'Fábio Valor Forjado';
const NOME_ESCREVE = 'Elza Escreve o Motivo';
const NOME_QUE_FICA = 'Fátima Continua';

const MOTIVO_ESCOLHIDO = 'Recebo mensagens demais';
const MOTIVO_ESCRITO = 'Mudei de instituição';

interface Pessoa {
  id: string;
  email: string;
}

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let activityId: string;
let organizadora: Pessoa;
let comMotivo: Pessoa;
let semMotivo: Pessoa;
let recusa: Pessoa;
let forjado: Pessoa;
let escreve: Pessoa;
let fica: Pessoa;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<Pessoa> {
  const email = `f69m.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
 * A inscrição CONFIRMADA na atividade — é ela que põe a pessoa no segmento.
 *
 * `CONFIRMED` (e não `PENDING`) porque a vaga retida não tem nada a ver com esta
 * dívida: o que se mede aqui é o MOTIVO de quem saiu, e uma inscrição retida
 * traria para dentro da fixture os avisos da F34 sem necessidade.
 */
async function inscrever(userId: string): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId,
        userId,
        status: 'CONFIRMED',
      },
    });
  });
}

/** O endereço de descadastro da pessoa — derivado pelo serviço, como o e-mail faz. */
function enderecoDe(userId: string): string {
  const url = unsubscribeUrlFor({ tenantSlug, tenantId, userId });

  if (!url) throw new Error('Não foi possível derivar o endereço de descadastro.');

  return url;
}

/** A linha vigente de descadastro, ou `null` se a pessoa não saiu. */
async function saidaDe(userId: string) {
  return e2eDb.communicationUnsubscribe.findFirst({
    where: { tenantId, userId },
    select: { reason: true, channel: true, unsubscribedAt: true },
  });
}

/** Abre a página de descadastro SEM sessão — é assim que a pessoa chega do e-mail. */
async function abrirSemSessao(page: Page, userId: string): Promise<Page> {
  const anonima = await page.context().browser()?.newContext({
    baseURL: page.context().baseURL ?? undefined,
  });

  if (!anonima) throw new Error('Não foi possível abrir um contexto anônimo.');

  const semSessao = await anonima.newPage();
  await semSessao.goto(enderecoDe(userId));

  await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
    'data-out',
    'false',
  );

  return semSessao;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Motivo ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'Congresso do Motivo',
    });

    eventId = event.id;

    const activity = await createActivity({
      tenantId,
      eventId,
      slug: `oficina-${RUN_ID}`,
      title: ATIVIDADE_TITULO,
      capacity: 30,
    });

    activityId = activity.id;

    organizadora = await signUpVia(api, `Organizadora F69M ${RUN_ID}`);
    comMotivo = await signUpVia(api, NOME_COM_MOTIVO);
    semMotivo = await signUpVia(api, NOME_SEM_MOTIVO);
    recusa = await signUpVia(api, NOME_RECUSA);
    forjado = await signUpVia(api, NOME_FORJADO);
    escreve = await signUpVia(api, NOME_ESCREVE);
    fica = await signUpVia(api, NOME_QUE_FICA);

    await linkUser({ tenantId, userId: organizadora.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: organizadora.id, role: 'ADMIN' });

    for (const pessoa of [comMotivo, semMotivo, recusa, forjado, escreve, fica]) {
      /** O vínculo ATIVO é o que faz o token resolver na página (`resolveUnsubscribeUser`). */
      await linkUser({ tenantId, userId: pessoa.id, kind: 'PARTICIPANT' });
      await grantRole({ tenantId, userId: pessoa.id, role: 'PARTICIPANT' });
      await inscrever(pessoa.id);
    }
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A HISTÓRIA É UMA SÓ, EM ORDEM
 * ─────────────────────────────────────────────────────────────────────────────
 *  As quatro saídas acontecem primeiro e a leitura da equipe vem depois — ela mede
 *  o resultado das outras quatro. Em série isso é declarado, e o modo `serial`
 *  PARA a suíte no primeiro erro: a leitura nunca roda sobre uma história que não
 *  aconteceu (a lição da f67, que já pagou por quatro `test()` soltos).
 */
test.describe.configure({ mode: 'serial' });

test.describe('o motivo do descadastro', () => {
  test('1. quem escolhe um motivo sai, e o motivo fica gravado', async ({ page }) => {
    const semSessao = await abrirSemSessao(page, comMotivo.id);

    try {
      const form = semSessao.getByTestId('unsubscribe-form');

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  ESTRUTURAL: O MOTIVO ESTÁ NO MESMO FORMULÁRIO DA SAÍDA (e nada é obrigatório)
       * ─────────────────────────────────────────────────────────────────────────────
       *  É a tradução em asserção da regra "a saída é UM ato": as cinco opções e o
       *  botão de sair vivem no mesmo `<form>`, então o navegador envia os dois
       *  fatos na mesma requisição — não existe um "salvar o motivo" separado que
       *  pudesse atrasar (ou impedir) a saída. E nenhum rádio é `required`: a
       *  pergunta não tem como segurar o envio.
       */
      await expect(form.getByRole('radio')).toHaveCount(5);
      await expect(form.locator(`input[name="${UNSUBSCRIBE_REASON_FIELD}"][required]`)).toHaveCount(0);
      await expect(form.locator(`input[name="${UNSUBSCRIBE_REASON_NOTE_FIELD}"]`)).toHaveCount(1);
      await expect(form.getByTestId('unsubscribe-confirm-submit')).toBeVisible();

      await semSessao.getByRole('radio', { name: MOTIVO_ESCOLHIDO }).check();
      await form.getByTestId('unsubscribe-confirm-submit').click();

      await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
        'data-out',
        'true',
      );

      const saida = await saidaDe(comMotivo.id);

      expect(saida?.reason).toBe(MOTIVO_ESCOLHIDO);
      expect(saida?.channel).toBe('LINK');
      expect(saida?.unsubscribedAt).not.toBeNull();
    } finally {
      await semSessao.context().close();
    }
  });

  test('2. quem não escolhe nada sai igual — e o banco diz que saiu sem dizer', async ({ page }) => {
    const semSessao = await abrirSemSessao(page, semMotivo.id);

    try {
      /** O caminho mais curto possível: abrir o endereço e clicar em sair. */
      await semSessao.getByTestId('unsubscribe-confirm-submit').click();

      await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
        'data-out',
        'true',
      );

      const saida = await saidaDe(semMotivo.id);

      expect(saida?.unsubscribedAt).not.toBeNull();
      expect(saida?.reason).toBeNull();
    } finally {
      await semSessao.context().close();
    }
  });

  test('3. "prefiro não dizer" é escolha, e NÃO vira motivo gravado', async ({ page }) => {
    const semSessao = await abrirSemSessao(page, recusa.id);

    try {
      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  ESTE CASO PRENDE A REGRA DO DOMÍNIO DENTRO DA AÇÃO
       * ─────────────────────────────────────────────────────────────────────────────
       *  A opção existe na tela e vale `null`. Se a ação gravasse o que o formulário
       *  manda (em vez de passar pela regra pura), a coluna receberia "Prefiro não
       *  dizer" — uma frase que não é motivo de nada — e a leitura da equipe contaria
       *  isso como uma razão declarada. A asserção do vazio é, portanto, a prova de
       *  que a escolha passa pelo domínio.
       */
      await semSessao.getByRole('radio', { name: UNSUBSCRIBE_REASON_DECLINE }).check();
      await semSessao.getByTestId('unsubscribe-confirm-submit').click();

      await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
        'data-out',
        'true',
      );

      const saida = await saidaDe(recusa.id);

      expect(saida?.unsubscribedAt).not.toBeNull();
      expect(saida?.reason).toBeNull();
    } finally {
      await semSessao.context().close();
    }
  });

  test('4. valor que a tela nunca ofereceu não suja a coluna nem bloqueia a saída', async ({
    page,
  }) => {
    const semSessao = await abrirSemSessao(page, forjado.id);

    try {
      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  O RÁDIO FORJADO É O POST MONTADO À MÃO
       * ─────────────────────────────────────────────────────────────────────────────
       *  A pergunta é uma cortesia, e a ação é um endpoint HTTP: alguém pode mandar
       *  um valor que a tela não oferece — um código, um texto qualquer — junto com o
       *  pedido de saída. O que este caso prende é a resposta das duas metades: a
       *  saída ACONTECE (a regra não recusa nada) e a coluna fica VAZIA (o valor
       *  desconhecido não é gravado como se fosse motivo). O campo de texto também
       *  vai preenchido, para provar que ele sozinho não entra: sem uma opção válida
       *  não há motivo declarado.
       */
      await semSessao.getByTestId('unsubscribe-form').evaluate((form, nomeDoCampo) => {
        const linha = document.createElement('input');

        linha.type = 'radio';
        linha.name = nomeDoCampo;
        linha.value = 'TOO_MANY_MESSAGES';
        linha.id = 'motivo-forjado';

        form.appendChild(linha);
        linha.checked = true;
      }, UNSUBSCRIBE_REASON_FIELD);

      await semSessao
        .locator(`input[name="${UNSUBSCRIBE_REASON_NOTE_FIELD}"]`)
        .fill('Texto solto, sem opção escolhida.');
      await semSessao.getByTestId('unsubscribe-confirm-submit').click();

      await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
        'data-out',
        'true',
      );

      const saida = await saidaDe(forjado.id);

      expect(saida?.unsubscribedAt).not.toBeNull();
      expect(saida?.reason).toBeNull();
    } finally {
      await semSessao.context().close();
    }
  });

  test('5. o motivo escrito em "Outro motivo" é o que fica gravado', async ({ page }) => {
    const semSessao = await abrirSemSessao(page, escreve.id);

    try {
      /**
       * "Outro motivo" é a única opção com texto livre, e o que se grava é o TEXTO
       * (a frase "Outro motivo" diria apenas que a lista não previu — e a lista não
       * prever é justamente o caso em que a informação importa). Esta pessoa sai
       * aqui, e é ela quem entra na frase agregada do caso 6 com o motivo escrito.
       */
      await semSessao.getByRole('radio', { name: 'Outro motivo' }).check();
      await semSessao.getByTestId('unsubscribe-reason-note').fill(MOTIVO_ESCRITO);
      await semSessao.getByTestId('unsubscribe-confirm-submit').click();

      await expect(semSessao.getByTestId('unsubscribe-state-value')).toHaveAttribute(
        'data-out',
        'true',
      );

      const saida = await saidaDe(escreve.id);

      expect(saida?.reason).toBe(MOTIVO_ESCRITO);
    } finally {
      await semSessao.context().close();
    }
  });

  test('6. a equipe lê POR QUE as pessoas saíram na tela de comunicação', async ({ page }) => {
    await signInAs(page, organizadora.email);

    const query = new URLSearchParams({
      aba: 'segmentos',
      segmento: '1',
      evento: eventId,
      c0: 'inscrito-na-atividade',
      p0_atividade: activityId,
    });

    await page.goto(`/t/${tenantSlug}/administracao/comunicacao?${query.toString()}`);

    /**
     * A contagem é do banco e o "N de M" diz de onde ela veio: seis pessoas casam
     * com o segmento (estão inscritas na atividade) e cinco saíram — a que fica é a
     * única que ainda vai receber.
     */
    await expect(page.getByTestId('segment-count')).toHaveText('1');
    await expect(page.getByTestId('segment-unsubscribed')).toContainText('5 de 6 saíram do canal');

    /**
     * A FRASE AGREGADA, INTEIRA — e ela é o resultado de QUATRO caminhos diferentes:
     * uma opção escolhida, um texto escrito, e três saídas sem motivo (a de quem não
     * escolheu nada, a de quem preferiu não dizer e a de quem mandou um valor
     * forjado). O empate de contagem é desempatado pelo texto, e a ordem faz parte do
     * contrato da frase.
     */
    await expect(page.getByTestId('segment-unsubscribe-reasons')).toHaveText(
      'Motivos de quem saiu: 1 por “Mudei de instituição”, 1 por “Recebo mensagens demais” e 3 sem motivo informado.',
    );

    /** E o nome de ninguém aparece ali: a linha é sobre MOTIVO, não sobre pessoa. */
    const conteudo = await page.getByTestId('segment-unsubscribe-reasons').textContent();

    for (const pessoa of [comMotivo, semMotivo, recusa, forjado, escreve, fica]) {
      expect(conteudo).not.toContain(pessoa.email);
      expect(conteudo).not.toContain(pessoa.id);
    }
  });
});

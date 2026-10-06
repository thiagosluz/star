/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — IDENTIDADE VISUAL DO CRACHÁ (FASE 51, dívida E42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   1. a emissão em MASSA aceita uma categoria e a lista passa a MOSTRAR a faixa —
 *      emitir 40 crachás de equipe é um clique, e é o caso da secretaria;
 *   2. o filtro por categoria isola quem tem aquela faixa, e quem não tem crachá
 *      fica de fora (a categoria mora no crachá);
 *   3. trocar a categoria de UM crachá pela lista NÃO troca o código — o crachá que
 *      está na mão da pessoa continua valendo no balcão;
 *   4. o PAPEL obedece: a folha A4, a etiqueta adesiva e o ZPL saem com a faixa da
 *      categoria de cada um e com a COR DO TEMA do evento — conferido nos BYTES do
 *      arquivo, não no `href` da tela;
 *   5. o crachá online (`/meu-cracha`) mostra o rótulo da categoria e a cor do
 *      evento: a tela e o papel dizem a MESMA coisa sobre a mesma pessoa;
 *   6. a escolha da LENTE no balcão persiste, e o seletor só aparece quando há mais
 *      de uma câmera — o navegador do teste é aberto com DUAS lentes falsas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CONFERÊNCIA É DO ARQUIVO QUE SAI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os cenários 4 baixam o PDF e o ZPL que a tela aponta e procuram, no CONTEÚDO, o
 *  operador de cor da categoria e da cor do tema. Afirmar a presença de um
 *  `data-category` na lista provaria só a montagem do HTML; o que a recepção leva
 *  para a porta é o arquivo, e é ele que o teste lê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { credentialCategoryColor, pdfFillOperator } from '../../src/domain/events/credential-categories';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'identidade-cracha-f51';

/** A cor do tema do EVENTO — é ela que precisa aparecer no PDF. */
const EVENT_PRIMARY = '#b45309';
/** As cores das categorias, pela paleta do DOMÍNIO — não copiadas à mão aqui. */
const STAFF_COLOR = credentialCategoryColor('STAFF');
const VIP_COLOR = credentialCategoryColor('VIP');
const PARTICIPANT_COLOR = credentialCategoryColor('PARTICIPANT');

let tenantId: string;
let slug: string;
let eventId: string;
let eventSlug: string;
let organizerEmail: string;
let participantEmail: string;
let participantId: string;
let participantName: string;
let staffId: string;
let staffName: string;

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f51cracha.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** O crachá gravado da pessoa — o banco é a memória do E2E. */
async function credentialOf(userId: string) {
  return e2eDb.eventCredential.findFirst({
    where: { tenantId, eventId, userId },
    select: { id: true, code: true, category: true },
  });
}

/**
 * Clica no botão de teste até o efeito acontecer.
 *
 * A primeira submissão pode se perder na hidratação (a página acabou de carregar e o
 * `form` ainda não tem handler) — o mesmo cuidado dos outros E2E desta base.
 */
async function clickUntil(
  page: import('@playwright/test').Page,
  testId: string,
  effect: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    const botao = page.getByTestId(testId);

    if ((await botao.count()) > 0) await botao.click();

    await effect();
  }).toPass({ timeout: 60_000 });
}

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A TROCA DE CATEGORIA ATÉ A TELA MOSTRAR O FATO (FASE 69 · dívida E83)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O cenário 3 troca a categoria de UM crachá e confere, depois de recarregar, que a
   *  tela mostra a etiqueta nova. A sequência era: `escolherCategoriaAte` (o select,
   *  com o próprio laço), `clickUntil` (o clique de salvar, com o laço do banco), e
   *  então **um** `reload` com a asserção se repetindo — a mesma forma que o ADR-327
   *  corrigiu no `Alt+↑` do quadro de demandas: o GESTO acontecendo uma vez e só a
   *  espera se repetindo.
   *
   *  Aqui o que se repete é a SEQUÊNCIA INTEIRA (escolher → salvar → recarregar →
   *  conferir a tela), e o motivo é o mecanismo medido: o `select` é controlado pelo
   *  React, e um `selectOption` que chega antes da hidratação deixa o DOM com o valor
   *  novo e o ESTADO com o antigo — o laço do select sai satisfeito, o POST leva a
   *  categoria velha e a etapa seguinte fica presa num valor que ninguém escolheu.
   *  Repetir o conjunto conserta a corrida; nenhuma asserção foi afrouxada (as mesmas
   *  comparações, e a do banco continua sendo a primeira).
   *
   *  Repetir é seguro porque cada passo é idempotente: escolher de novo a mesma
   *  categoria, salvar de novo a mesma categoria (o código do crachá não muda — é o
   *  que o cenário prova) e recarregar uma página que o servidor desenha do banco.
   */
  async function trocarCategoriaAte(
    page: import('@playwright/test').Page,
    userId: string,
    categoria: string,
    rotuloNaTela: string,
  ): Promise<void> {
    const select = page.getByTestId(`badge-category-select-${userId}`);
    const salvar = page.getByTestId(`badge-category-save-${userId}`);
    const celula = page.getByTestId(`badge-category-${userId}`);

    await expect(async () => {
      await select.selectOption(categoria);
      await expect(select).toHaveValue(categoria);

      if ((await salvar.count()) > 0) await salvar.click();

      /** O BANCO primeiro: é ele que diz que o servidor recebeu a categoria pedida. */
      await expect
        .poll(async () => (await credentialOf(userId))?.category, { timeout: 10_000 })
        .toBe(categoria);

      /** E depois a TELA, que é onde a pessoa lê a etiqueta. */
      await page.reload();
      await expect(celula).toContainText(rotuloNaTela);
    }).toPass({ timeout: 60_000 });
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  MARCAR ATÉ O REACT ASSUMIR (FASE 52 · dívida I1)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A caixa é um controle do React, e o formulário monta os `userIds` a partir do
   *  ESTADO (`[...selected]`) — não do DOM. Um clique que acontece ANTES da hidratação
   *  marca a caixa na tela e **não entra no estado**: o formulário é enviado vazio, a
   *  action responde "nenhum participante" e nada é gravado. O `toBeChecked` sozinho
   *  não percebe, porque a caixa está marcada na hora em que ele olha (o React não
   *  re-renderiza, então não há nada para desmarcá-la).
   *
   *  A prova de que o React assumiu é o **input escondido** daquela pessoa existir no
   *  formulário. Enquanto ele não existir, o laço clica de novo — e na segunda vez a
   *  página já está hidratada.
   */
  async function marcarAte(page: import('@playwright/test').Page, testId: string): Promise<void> {
    const userId = testId.replace('badge-select-', '');
    const escondido = page.locator(
      `[data-testid="badge-emit-form"] input[name="userIds"][value="${userId}"]`,
    );

    await expect(async () => {
      const caixa = page.getByTestId(testId);

      /**
       * O CAMINHO CRUEL: a caixa pode estar MARCADA no DOM e VAZIA no estado (o clique
       * caiu antes da hidratação, e o React não re-renderiza, então nada a desmarca).
       * Clicar "só se estiver desmarcada" trava para sempre. Aqui a marca é sempre
       * refeita: desmarca e marca — quando a página já está hidratada, o estado recebe.
       */
      if ((await escondido.count()) === 0) {
        if (await caixa.isChecked()) await caixa.click();

        await caixa.click();
      }

      await expect(caixa).toBeChecked();
      await expect(escondido).toHaveCount(1);
    }).toPass({ timeout: 45_000 });
  }

  /**
   * O seletor de categoria também é CONTROLADO: um `selectOption` antes da hidratação é
   * revertido pelo React (o valor volta ao padrão e o lote sai com a categoria errada).
   */
  async function escolherCategoriaAte(
    page: import('@playwright/test').Page,
    testId: string,
    valor: string,
  ): Promise<void> {
    await expect(async () => {
      await page.getByTestId(testId).selectOption(valor);
      await expect(page.getByTestId(testId)).toHaveValue(valor);
    }).toPass({ timeout: 30_000 });
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  CADA CASO PREPARA O PRÓPRIO ESTADO (FASE 52 · dívida I1)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Os cenários desta suíte encadeavam: quem trocava a categoria de um crachá contava
   *  com a emissão feita pelo cenário ANTERIOR. Rodar um caso sozinho — o que se faz ao
   *  depurar — dava "crachá inexistente", e a falha apontava para o lugar errado. É a
   *  mesma família da dependência de ordem que a FASE 50 quitou no credenciamento.
   */
  async function limparCrachas(userIds: readonly string[]): Promise<void> {
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.eventCredential.deleteMany({ where: { eventId, userId: { in: [...userIds] } } });
    });
  }

  /** Emite o crachá pela TELA — o caminho real, com a categoria pedida. */
  async function emitirPelaTela(
    page: import('@playwright/test').Page,
    userId: string,
    categoria: string,
  ): Promise<void> {
    await page.goto(badgesUrl());
    await marcarAte(page, `badge-select-${userId}`);
    await escolherCategoriaAte(page, 'badge-emit-category', categoria);
    await clickUntil(page, 'badge-emit', async () => {
      expect(await credentialOf(userId)).toBeTruthy();
    });
  }

const badgesUrl = () => `/t/${slug}/credenciamento/crachas?evento=${eventId}`;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  LENTES FALSAS, SEM CÂMERA DE VERDADE (FASE 60 · dívida I1)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O seletor de lente do balcão só existe quando `enumerateDevices` devolve mais de
 *  uma câmera — e a máquina que roda a suíte (ou a que roda em CI) pode ter zero,
 *  uma ou três. Depender do hardware faria o cenário medir o computador, não o
 *  produto.
 *
 *  Aqui a lista é INJETADA no documento antes de qualquer script da página:
 *
 *    • `enumerateDevices` mente a lista pedida (com rótulo, como depois da permissão);
 *    • `getUserMedia` devolve um `MediaStream` DE VERDADE, capturado de um `<canvas>`
 *      — o `video` do componente toca, `readyState` sobe e a leitura começa. As
 *      restrições (deviceId/facingMode) são ignoradas de propósito: quem decide a
 *      lente é a lista, que é o que o produto lê.
 *
 *  É a mesma técnica que o próprio Playwright recomenda, e nenhuma câmera real é
 *  aberta — o que, num notebook com webcam, seria efeito colateral do teste.
 */
async function comLentesFalsas(
  context: import('@playwright/test').BrowserContext,
  lentes: readonly string[],
): Promise<void> {
  await context.addInitScript((ids: string[]) => {
    const media = navigator.mediaDevices;

    media.enumerateDevices = async () =>
      ids.map((deviceId, index) => ({
        deviceId,
        groupId: 'grupo-e2e',
        kind: 'videoinput',
        label: `Lente falsa ${index + 1}`,
        toJSON: () => ({}),
      })) as unknown as MediaDeviceInfo[];

    media.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height);

      return canvas.captureStream(5);
    };
  }, [...lentes]);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Identidade ${RUN_ID}`,
    });

    tenantId = tenant.id;
    slug = tenant.slug;
    eventId = randomUUID();
    eventSlug = `congresso-identidade-${RUN_ID}`;

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const startsAt = new Date(Date.now() + 20 * 86_400_000);

      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          slug: eventSlug,
          title: `Congresso da Identidade ${RUN_ID}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
          timezone: 'America/Bahia',
          city: 'Salvador',
          state: 'BA',
          capacity: null,
          confirmedCount: 0,
          registrationOpensAt: new Date(Date.now() - 86_400_000),
          registrationClosesAt: new Date(Date.now() + 18 * 86_400_000),
          /**
           * O evento tem TEMA PRÓPRIO: é o que prova que a cor escolhida pelo
           * organizador chega ao papel — e não só a identidade da plataforma.
           */
          theme: { primaryColor: EVENT_PRIMARY },
        },
      });
    });

    const organizer = await signUpVia(api, `Organizadora da Identidade ${RUN_ID}`);
    organizerEmail = organizer.email;
    await linkUser({ tenantId, userId: organizer.id });
    /** ORGANIZER tem `attendance:manage` e `sponsor:manage` no escopo da instituição. */
    await grantRole({ tenantId, userId: organizer.id, role: 'ORGANIZER' });

    participantName = `Participante da Identidade ${RUN_ID}`;
    const participant = await signUpVia(api, participantName);
    participantEmail = participant.email;
    participantId = participant.id;

    staffName = `Equipe da Identidade ${RUN_ID}`;
    const staff = await signUpVia(api, staffName);
    staffId = staff.id;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O VÍNCULO (E O PAPEL) DO PARTICIPANTE, COMO NA INSCRIÇÃO PÚBLICA (F60 · I1)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Quem se inscreve por fora vira PARTICIPANTE da instituição — e `applyParticipantLink`
     *  (FASE 10/14) grava as DUAS coisas: o vínculo `kind = PARTICIPANT` **e** a
     *  concessão do papel `PARTICIPANT`, que é de onde saem as permissões pessoais
     *  (`registration:read:own` está em `PARTICIPANT_PERMISSIONS`).
     *
     *  A fixture antiga criava a pessoa com a inscrição e nada disso, e o cenário 5
     *  caía no painel: "Permissões efetivas: 0". O dado do cenário não era o dado da
     *  vida real.
     */
    await linkUser({ tenantId, userId: participantId, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: participantId, role: 'PARTICIPANT' });

    /** As duas inscrições no EVENTO (o crachá é da pessoa no evento). */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      for (const userId of [participantId, staffId]) {
        await tx.registration.create({
          data: {
            id: randomUUID(),
            tenantId,
            eventId,
            activityId: null,
            userId,
            status: 'CONFIRMED',
          },
        });
      }
    });
  } finally {
    await api.dispose();
  }
});

test.describe('identidade visual do crachá', () => {
  test('1. a emissão em massa aceita a categoria e a lista mostra a faixa', async ({ page }) => {
    await signInAs(page, organizerEmail);
    await page.goto(badgesUrl());

    /** ── A EQUIPE: marcar a pessoa e emitir como "Equipe" ─────────────────── */
    await marcarAte(page, `badge-select-${staffId}`);

    await escolherCategoriaAte(page, 'badge-emit-category', 'STAFF');

    await clickUntil(page, 'badge-emit', async () => {
      const credential = await credentialOf(staffId);
      expect(credential?.category).toBe('STAFF');
    });

    /** ── O PARTICIPANTE: emitir com o padrão (a primeira opção do seletor) ── */
    await page.reload();

    await marcarAte(page, `badge-select-${participantId}`);

    await clickUntil(page, 'badge-emit', async () => {
      const credential = await credentialOf(participantId);
      expect(credential?.category).toBe('PARTICIPANT');
    });

    /** A lista mostra o RÓTULO em português de cada um. */
    await page.reload();
    await expect(page.getByTestId(`badge-category-${staffId}`)).toContainText('Equipe');
    await expect(page.getByTestId(`badge-category-${participantId}`)).toContainText('Participante');

    /** E a categoria gravada é a que o domínio conhece. */
    await expect
      .poll(async () => (await credentialOf(staffId))?.category, { timeout: 30_000 })
      .toBe('STAFF');
  });

  test('2. o filtro por categoria isola a faixa', async ({ page }) => {
    await signInAs(page, organizerEmail);

    await page.goto(`${badgesUrl()}&categoria=STAFF`);
    await page.getByTestId('badge-filter-apply').click();

    await expect(page.getByTestId(`badge-row-${staffId}`)).toBeVisible({ timeout: 30_000 });
    /** Quem é PARTICIPANTE sai da lista filtrada por Equipe. */
    await expect(page.getByTestId(`badge-row-${participantId}`)).toHaveCount(0);

    await page.goto(`${badgesUrl()}&categoria=PARTICIPANT`);
    await page.getByTestId('badge-filter-apply').click();

    await expect(page.getByTestId(`badge-row-${participantId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`badge-row-${staffId}`)).toHaveCount(0);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  OS CINCO CENÁRIOS QUE A FASE 52 DEIXOU EM `test.fixme` — FECHADOS (FASE 60 · I1)
   * ═══════════════════════════════════════════════════════════════════════════════
   *  Cada um tinha uma causa PRÓPRIA, e três delas não eram o que o bilhete dizia:
   *
   *   3. **a troca de categoria de UM crachá já funcionava.** O bilhete dizia que o
   *      `select` da linha era controlado e que o `selectOption` seria revertido antes
   *      da hidratação — mas ele nasce com `defaultValue` (não controlado), e o
   *      `clickUntil` já repetia o clique até o banco mudar. Rodou e passou: a linha
   *      saiu do `fixme` sem uma linha de código.
   *   4. **o 400 era do TESTE, não da rota.** O cenário lia o `href` da própria tela
   *      sem ter emitido crachá nenhum quando rodava sozinho: o lote chegava vazio e a
   *      rota respondia, honestamente, `NO_ELIGIBLE` → 400. No arquivo inteiro ele
   *      passava dessa linha e morria adiante, em `sheetText.subarray` — `toString()`
   *      devolve STRING, e string não tem `subarray` (era `Buffer`). Duas causas
   *      empilhadas: o `slice` correto e o LOTE DO PRÓPRIO CENÁRIO, emitido aqui.
   *   5. **o crachá online precisava do VÍNCULO.** A pessoa do cenário existia só com
   *      inscrição, e `/meu-cracha` é aberto por posse DENTRO da instituição
   *      (`REGISTRATION_READ_OWN` sobre o vínculo). A inscrição pública da FASE 10 cria
   *      esse vínculo; a fixture passou a fazer o mesmo (`kind: 'PARTICIPANT'`).
   *   6 e 7. **o seletor de lente nunca teve lente nenhuma.** `browser.newContext({
   *      args })` é argumento de LANÇAMENTO do navegador e ali era ignorado: sem
   *      `--use-fake-device-for-media-stream`, `getUserMedia` não abria nada e o
   *      cenário morria em `data-active=false`. As lentes agora são falsas por
   *      `addInitScript` — `enumerateDevices` mente a lista e `getUserMedia` devolve um
   *      fluxo real de um `<canvas>`, sem tocar em câmera de verdade.
   *
   *  Nenhuma asserção foi afrouxada e nenhum tempo limite foi inflado: onde o cenário
   *  precisava de dado, o dado passou a nascer dentro dele.
   */
  test('3. trocar a categoria de UM crachá não troca o código', async ({ page }) => {
    await signInAs(page, organizerEmail);

    await limparCrachas([participantId]);
    await emitirPelaTela(page, participantId, 'PARTICIPANT');

    const before = await credentialOf(participantId);
    expect(before?.code).toBeTruthy();

    await page.goto(badgesUrl());

    /**
     * Escolher, salvar e CONFERIR A TELA num laço só (E83) — o porquê está em
     * `trocarCategoriaAte`: o select é controlado e o `reload` sozinho não tinha
     * como se defender de um valor que o React reverteu.
     */
    await trocarCategoriaAte(page, participantId, 'VIP', 'Autoridade');

    const after = await credentialOf(participantId);

    /** O CÓDIGO é o mesmo: o crachá que está na mão da pessoa continua valendo. */
    expect(after?.code).toBe(before?.code);
  });

  test('4. o papel obedece: a cor do TEMA e a faixa de CADA categoria', async ({ page }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O LOTE MISTO NASCE AQUI (FASE 60 · dívida I1 — a lição da E71)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Este cenário lia o `href` da tela confiando nos crachás que os cenários 1 e 3
     *  tinham emitido. Rodando sozinho — o que se faz ao depurar — o lote chegava
     *  VAZIO e a rota respondia `NO_ELIGIBLE` (400), que foi lido como defeito da rota
     *  de impressão. Não era: era o cenário consumindo o dado do vizinho.
     *
     *  Agora ele emite o próprio lote: a equipe como STAFF e a autoridade como VIP. A
     *  primeira coluna da asserção é o PARTICIPANTE **não** aparecer — nenhum dos dois
     *  é participante, e é isso que prova que a faixa é POR CRACHÁ, e não do lote.
     */
    await signInAs(page, organizerEmail);

    await limparCrachas([staffId, participantId]);
    await emitirPelaTela(page, staffId, 'STAFF');
    await emitirPelaTela(page, participantId, 'VIP');

    await page.goto(badgesUrl());

    await expect(page.getByTestId('badge-print-options')).toBeVisible({ timeout: 30_000 });

    // ── A folha A4 ───────────────────────────────────────────────────────────
    const sheetHref = await page.getByTestId('badge-print').getAttribute('href');
    expect(sheetHref).toBeTruthy();

    const sheet = await page.request.get(sheetHref!);
    expect(sheet.status()).toBe(200);
    expect(sheet.headers()['content-type']).toContain('application/pdf');

    /** `toString()` devolve STRING: conferir o cabeçalho é `slice`, não `subarray`. */
    const sheetText = (await sheet.body()).toString('latin1');
    expect(sheetText.slice(0, 5)).toBe('%PDF-');

    /** A COR DO EVENTO no código do crachá. */
    expect(sheetText).toContain(pdfFillOperator(EVENT_PRIMARY));
    /** A FAIXA da equipe e a da autoridade. */
    expect(sheetText).toContain(pdfFillOperator(STAFF_COLOR));
    expect(sheetText).toContain(pdfFillOperator(VIP_COLOR));
    /** E o PARTICIPANTE não está no lote misto: a faixa dele não aparece. */
    expect(sheetText).not.toContain(pdfFillOperator(PARTICIPANT_COLOR));

    // ── A etiqueta adesiva e o ZPL, pelo endereço que a tela aponta ──────────
    await page.getByTestId('badge-print-options').locator('summary').click();

    const labelsHref = await page.getByTestId('badge-print-labels').getAttribute('href');
    const zplHref = await page.getByTestId('badge-print-zpl').getAttribute('href');

    const labels = await page.request.get(labelsHref!);
    expect(labels.status()).toBe(200);

    const labelsText = (await labels.body()).toString('latin1');
    expect(labelsText).toContain(pdfFillOperator(EVENT_PRIMARY));
    expect(labelsText).toContain(pdfFillOperator(STAFF_COLOR));

    const zpl = await page.request.get(zplHref!);
    expect(zpl.status()).toBe(200);

    const zplText = await zpl.text();
    /** A barra da categoria no rolo: a largura da etiqueta (100 mm a 203 dpi = 799). */
    expect(zplText).toContain('^FO0,0^GB799,');
    expect(zplText).toContain('^XA');
  });

  test('5. o crachá online do participante mostra a categoria e a cor do evento', async ({ page }) => {
    /**
     * O crachá deste cenário é emitido AQUI, como "Autoridade" — a tela é aberta por
     * posse e precisa que exista algo para mostrar. Depender da troca feita no cenário
     * 3 faria o caso passar ou falhar conforme a ordem (a lição da dívida E71).
     */
    await signInAs(page, organizerEmail);
    await limparCrachas([participantId]);
    await emitirPelaTela(page, participantId, 'VIP');

    await signInAs(page, participantEmail);
    await page.goto(`/t/${slug}/meu-cracha?evento=${eventId}`);

    await expect(page.getByTestId('own-badge')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('own-badge-category')).toContainText('Autoridade');
    /** A cor do evento é a barra do cartão — e o token vem do servidor. */
    await expect(page.getByTestId('own-badge-event-bar')).toHaveClass(/bg-theme-primary/);

    const credential = await credentialOf(participantId);
    await expect(page.getByTestId('own-badge-code')).toContainText(credential!.code);
  });

  test('6. a lente escolhida no balcão persiste, e o seletor só aparece com duas câmeras', async ({
    browser,
  }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTE CENÁRIO PRECISA DE UM CONTEXTO PRÓPRIO (FASE 60 · dívida I1)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O leitor usa `enumerateDevices`/`getUserMedia`, que são APIs do NAVEGADOR — não
     *  há teste de unidade possível sem `jsdom` (ver o comentário do componente). Aqui
     *  o contexto é aberto com DUAS lentes FALSAS e permissão de câmera concedida.
     *
     *  A primeira versão deste cenário passava `args:
     *  ['--use-fake-device-for-media-stream', …]` para o `browser.newContext` — e ali
     *  eles são IGNORADOS, porque argumento de linha de comando é do LANÇAMENTO do
     *  navegador. Sem a mídia falsa, `getUserMedia` não abria nada: o cenário morria em
     *  `data-active=false`, 30 s por tentativa. A lente falsa passou a ser injetada no
     *  documento (`addInitScript`), que é onde o produto a consulta.
     *
     *  A persistência é lida pelo `localStorage`: a escolha vive por EVENTO, e é o que
     *  impede o operador de reescolher a cada leitura.
     */
    const context = await browser.newContext({ permissions: ['camera'] });
    await comLentesFalsas(context, ['lente-frontal', 'lente-traseira']);

    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);
      await page.goto(`/t/${slug}/credenciamento?evento=${eventId}`);

      await expect(page.getByTestId('qr-camera')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('qr-camera-start').click();

      /** A lente abre: o stream liga e o vídeo aparece. */
      await expect(page.getByTestId('qr-camera')).toHaveAttribute('data-active', 'true', {
        timeout: 30_000,
      });

      const select = page.getByTestId('qr-camera-device');

      /** Com MAIS DE UMA câmera, o seletor existe. */
      await expect(select).toBeVisible();

      const options = await select.locator('option').all();
      expect(options.length).toBe(3);

      /** A segunda opção é uma lente concreta (a primeira é "padrão do navegador"). */
      const deviceId = await options[1]!.getAttribute('value');
      expect(deviceId).toBe('lente-frontal');

      await select.selectOption(deviceId!);

      /** A escolha fica GUARDADA, por evento — é o que a próxima leitura lê. */
      await expect
        .poll(
          async () =>
            page.evaluate(
              (key) => window.localStorage.getItem(key),
              `eventflow_camera_device_${eventId}`,
            ),
          { timeout: 30_000 },
        )
        .toBe(deviceId);

      /** E a leitura continua funcionando depois da troca. */
      await expect(page.getByTestId('qr-camera')).toHaveAttribute('data-active', 'true', {
        timeout: 30_000,
      });
      await expect(page.getByTestId('qr-camera-error')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('7. com UMA câmera, o seletor de lente NÃO aparece', async ({ browser }) => {
    /**
     * Opção inútil polui: num dispositivo com uma lente só, o `select` de uma opção é
     * um toque a mais no meio da fila que não muda nada. O contexto aqui recebe UMA
     * lente falsa — a lista é conhecida, então a asserção é direta (antes ela era um
     * `if` sobre o que o navegador da máquina tivesse plugado, que passava nos dois
     * lados sem provar nada).
     */
    const context = await browser.newContext({ permissions: ['camera'] });
    await comLentesFalsas(context, ['unica-lente']);

    const page = await context.newPage();

    try {
      await signInAs(page, organizerEmail);
      await page.goto(`/t/${slug}/credenciamento?evento=${eventId}`);

      await expect(page.getByTestId('qr-camera')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('qr-camera-start').click();
      await expect(page.getByTestId('qr-camera')).toHaveAttribute('data-active', 'true', {
        timeout: 30_000,
      });

      await expect(page.getByTestId('qr-camera-device')).toHaveCount(0);
      await expect(page.getByTestId('qr-camera-error')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

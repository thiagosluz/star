/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O FORMULÁRIO QUE O ORGANIZADOR MONTA (FASE 70 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM ORGANIZA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a área existe onde as outras configurações do evento existem — a raiz do
 *         evento tem o cartão, e o cartão leva à tela;
 *      2. o AVISO do texto livre está na tela, com a lista de chaves que não saem em
 *         superfície de terceiro vinda do DOMÍNIO (`THIRD_PARTY_FORBIDDEN_FORM_KEYS`);
 *      3. acrescentar dois campos funciona, e o texto longo SEM finalidade é
 *         RECUSADO com a mensagem do domínio — e salvar de novo, com a finalidade,
 *         passa: a recusa não é beco sem saída;
 *      4. reabrir a tela mostra o que foi salvo — e o banco prova que virou DADO em
 *         `Event.settings`, não estado de navegador;
 *      5. as setas ↑/↓ mudam a ordem em que o participante vê os campos;
 *      6. remover tira o campo do formulário e o banco confirma;
 *      7. **tudo isso funciona SEM JavaScript** (`javaScriptEnabled: false`): cada
 *         gesto é um `<form>` de verdade, e o POST acontece com o bundle desligado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não escreve no formulário do PARTICIPANTE: renderizar os campos declarados na
 *  inscrição é a fatia 4. Aqui se prova a CONFIGURAÇÃO — o que o organizador monta e
 *  o que fica gravado no evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f70-formulario';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let adminEmail: string;

/** O campo como ele é LIDO do banco — a prova de que virou dado do evento. */
interface CampoGravado {
  key: string;
  label: string;
  type: string;
  required: boolean;
  purpose?: string;
  maxLength?: number;
}

function urlDoFormulario(): string {
  return `/t/${tenantSlug}/administracao/eventos/${eventId}/formulario`;
}

function urlDoEvento(): string {
  return `/t/${tenantSlug}/administracao/eventos/${eventId}`;
}

/**
 * Os campos gravados em `Event.settings.registrationForm`.
 *
 * Lido com contexto de instituição dentro da transação, como os outros helpers: a
 * tabela está sob RLS, e a conexão administrativa também precisa do contexto.
 */
async function camposGravados(): Promise<CampoGravado[]> {
  const row = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.event.findUnique({ where: { id: eventId }, select: { settings: true } });
  });

  const settings = row?.settings;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return [];

  const raw = (settings as Record<string, unknown>).registrationForm;
  return Array.isArray(raw) ? (raw as CampoGravado[]) : [];
}

/** Abre o `<details>` do campo novo — clique NATIVO, que não precisa de JavaScript. */
async function abrirNovoCampo(page: Page): Promise<void> {
  const details = page.getByTestId('new-field');
  await expect(details).toBeVisible({ timeout: 20_000 });

  const aberto = await details.evaluate((node) => node.hasAttribute('open'));
  if (!aberto) await details.locator('summary').click();
}

/** As chaves dos campos, na ordem em que a TELA os mostra. */
async function ordemDosCampos(page: Page): Promise<string[]> {
  const ids = await page
    .getByTestId('registration-form-fields')
    .locator('li')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''));

  return ids.map((id) => id.replace('registration-field-', ''));
}

/**
 * A última entrada da TRILHA para o formulário deste evento.
 *
 * A configuração do formulário é uma alteração do EVENTO, e é assim que ela entra na
 * auditoria — como as outras configurações (`saveEvent`, o quadro de demandas). O
 * registro guarda a LISTA em resumo ("de" e "para"), não os campos inteiros: uma
 * trilha que copia o conteúdo para outra tabela é problema de privacidade, não de
 * auditoria.
 */
async function ultimaTrilha(): Promise<{ from: unknown; to: unknown } | null> {
  const entry = await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.auditLog.findFirst({
      where: { tenantId, entityType: 'event', entityId: eventId, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
      select: { changes: true },
    });
  });

  const changes = entry?.changes as
    | Record<string, { from: unknown; to: unknown }>
    | null
    | undefined;

  return changes?.registrationForm ?? null;
}

/** Preenche e envia o formulário de campo novo. */
async function enviarNovoCampo(
  page: Page,
  input: {
    label: string;
    key: string;
    type?: string;
    purpose?: string;
    maxLength?: string;
  },
): Promise<void> {
  await abrirNovoCampo(page);

  await page.getByTestId('new-field-label').fill(input.label);
  await page.getByTestId('new-field-key').fill(input.key);

  if (input.type) await page.getByTestId('new-field-type').selectOption(input.type);
  if (input.maxLength !== undefined) await page.getByTestId('new-field-maxLength').fill(input.maxLength);

  /** `fill('')` porque os campos são NÃO controlados: o valor anterior continua lá. */
  await page.getByTestId('new-field-purpose').fill(input.purpose ?? '');

  await page.getByTestId('new-field-form').getByTestId('admin-submit').click();
}

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f70form.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Formulário ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'Congresso do Formulário',
    });

    eventId = event.id;

    const admin = await signUpVia(api, `Organizadora do Formulário ${RUN_ID}`);
    adminEmail = admin.email;

    await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('a tela do formulário do organizador', () => {
  test('1. a área está na raiz do evento, o cartão leva à tela e o aviso do texto livre está lá', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    /** A configuração do evento mora na grade de áreas — como as outras (FASE 55). */
    await page.goto(urlDoEvento());
    const cartao = page.getByTestId('event-area-formulario');
    await expect(cartao).toBeVisible({ timeout: 30_000 });

    await cartao.click();
    await expect(page).toHaveURL(/\/formulario$/);
    await expect(page.getByTestId('registration-form-page')).toBeVisible();

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O AVISO (requisito da fase, não enfeite)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Ele precisa dizer as TRÊS coisas: que o organizador responde pelo que pede,
     *  que o sistema não OFERECE campo de dado sensível, e que dado sensível não deve
     *  ser pedido em texto livre. E precisa citar a lista de chaves que o DOMÍNIO
     *  mantém fora das superfícies de terceiro — se a lista mudar lá, o texto da tela
     *  muda junto.
     */
    const aviso = page.getByTestId('free-text-notice');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('não oferece');
    await expect(aviso).toContainText('não peça dado sensível em texto livre');
    await expect(aviso).toContainText('CPF ou documento');
    await expect(aviso).toContainText('accessibilityNotes');
    await expect(aviso).toContainText('cpf');
  });

  test('2. a jornada inteira: dois campos, a recusa do domínio, o salvo, a ordem e a remoção', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);
    await page.goto(urlDoFormulario());

    /** O evento nasceu sem formulário: quem se inscreve responde o de sempre. */
    await expect(page.getByTestId('registration-form-empty')).toBeVisible();

    // ── PRIMEIRO CAMPO: texto curto, obrigatório ───────────────────────────────
    await enviarNovoCampo(page, {
      label: 'Instituição de origem',
      key: 'instituicao',
      type: 'SHORT_TEXT',
    });

    await expect(page.getByTestId('registration-field-instituicao')).toBeVisible({
      timeout: 20_000,
    });

    /** ── E A ALTERAÇÃO ENTROU NA TRILHA, COMO AS OUTRAS CONFIGURAÇÕES ───────── */
    await expect
      .poll(async () => {
        const registro = await ultimaTrilha();
        return registro ? [registro.from, registro.to] : null;
      })
      .toEqual(['nenhum campo declarado', '1 campo: instituicao']);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  SEGUNDO CAMPO: TEXTO LONGO SEM FINALIDADE — A RECUSA DO DOMÍNIO
     * ─────────────────────────────────────────────────────────────────────────────
     *  O texto longo é o único campo em que cabe qualquer coisa, e é ele que a LGPD
     *  manda justificar. A tela não inventa a frase: a mensagem é a do validador,
     *  com o nome do domínio para o problema ("Texto longo sem finalidade declarada").
     */
    await enviarNovoCampo(page, {
      label: 'Observações',
      key: 'observacoes',
      type: 'LONG_TEXT',
    });

    const recusa = page.getByTestId('new-field-form-feedback');
    await expect(recusa).toContainText('Texto longo sem finalidade declarada', {
      timeout: 20_000,
    });
    await expect(recusa).toContainText('observacoes');

    /** Nada foi gravado: a configuração só muda quando a lista inteira é aceita. */
    await expect
      .poll(async () => (await camposGravados()).map((campo) => campo.key))
      .toEqual(['instituicao']);

    // ── A MESMA TELA, COM A FINALIDADE DECLARADA: AGORA PASSA ─────────────────
    await enviarNovoCampo(page, {
      label: 'Observações',
      key: 'observacoes',
      type: 'LONG_TEXT',
      purpose: 'Registrar pedidos de acessibilidade que não cabem nas outras perguntas.',
    });

    await expect(page.getByTestId('registration-field-observacoes')).toBeVisible({
      timeout: 20_000,
    });

    // ── REABRIR MOSTRA O QUE FOI SALVO, E O BANCO É A PROVA ───────────────────
    await page.reload();

    const instituicao = page.getByTestId('registration-field-instituicao');
    const observacoes = page.getByTestId('registration-field-observacoes');

    await expect(instituicao).toBeVisible({ timeout: 20_000 });
    await expect(instituicao).toContainText('Instituição de origem');
    await expect(instituicao).toContainText('Texto curto');
    await expect(observacoes).toContainText('Observações');
    await expect(observacoes).toContainText('Texto longo');
    await expect(observacoes).toContainText('Registrar pedidos de acessibilidade');

    const gravados = await camposGravados();
    expect(gravados.map((campo) => campo.key)).toEqual(['instituicao', 'observacoes']);
    expect(gravados[1]?.type).toBe('LONG_TEXT');
    expect(gravados[1]?.purpose).toBe(
      'Registrar pedidos de acessibilidade que não cabem nas outras perguntas.',
    );

    // ── A ORDEM: A SETA SOBE O SEGUNDO CAMPO ─────────────────────────────────
    expect(await ordemDosCampos(page)).toEqual(['instituicao', 'observacoes']);

    await page.getByTestId('field-up-observacoes').getByTestId('inline-submit').click();

    await expect
      .poll(async () => (await camposGravados()).map((campo) => campo.key))
      .toEqual(['observacoes', 'instituicao']);

    /** A tela obedece à ordem gravada — a mesma que o participante vai ver. */
    await expect.poll(async () => ordemDosCampos(page)).toEqual(['observacoes', 'instituicao']);

    // ── REMOVER ───────────────────────────────────────────────────────────────
    await page.getByTestId('field-remove-instituicao').getByTestId('inline-submit').click();

    await expect(page.getByTestId('registration-field-instituicao')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByTestId('registration-field-observacoes')).toBeVisible();

    await expect
      .poll(async () => (await camposGravados()).map((campo) => campo.key))
      .toEqual(['observacoes']);
  });

  test('3. SEM JavaScript o campo novo é gravado do mesmo jeito', async ({ browser }) => {
    const contexto = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();

    try {
      await signInAs(page, adminEmail);
      await page.goto(urlDoFormulario());

      /**
       * O `<details>` abre por clique NATIVO do navegador, e o envio é um POST de
       * formulário de verdade: com o bundle desligado não existe hidratação para
       * interceptar o clique (a lição da E50), e é isso que a espera no BANCO mede —
       * o gesto não é a prova; o fato gravado é.
       */
      await enviarNovoCampo(page, {
        label: 'Turma',
        key: 'turma',
        type: 'SHORT_TEXT',
        maxLength: '60',
      });

      await expect
        .poll(async () => (await camposGravados()).some((campo) => campo.key === 'turma'), {
          timeout: 30_000,
        })
        .toBe(true);

      const turma = (await camposGravados()).find((campo) => campo.key === 'turma');
      expect(turma?.label).toBe('Turma');
      expect(turma?.maxLength).toBe(60);

      /** E a página que voltou do POST já mostra o campo que ela mesma gravou. */
      await expect(page.getByTestId('registration-field-turma')).toBeVisible({ timeout: 20_000 });

      /**
       * ─────────────────────────────────────────────────────────────────────────
       *  UM SEGUNDO CAMPO, PARA A ORDEM TER O QUE ORDENAR
       * ─────────────────────────────────────────────────────────────────────────
       *  Este caso não depende do que outro caso deixou: ele cria os DOIS campos que
       *  vai comparar (a regra da casa — um caso que só passa depois do anterior
       *  esconde o defeito em vez de mostrá-lo).
       */
      await enviarNovoCampo(page, { label: 'Sala', key: 'sala', type: 'SHORT_TEXT' });

      await expect
        .poll(async () => (await camposGravados()).some((campo) => campo.key === 'sala'), {
          timeout: 30_000,
        })
        .toBe(true);

      const antes = (await camposGravados()).map((campo) => campo.key);
      expect(antes.indexOf('turma')).toBeLessThan(antes.indexOf('sala'));

      /**
       * ─────────────────────────────────────────────────────────────────────────
       *  A SETA TAMBÉM VIRA POST SEM JAVASCRIPT
       * ─────────────────────────────────────────────────────────────────────────
       *  Subir/descer é o gesto que o humano escolheu para a ordem (como na FASE 51),
       *  e ele é um `<form>` — não um `onClick`. A prova é a MESMA de antes: o que
       *  vale é a ordem GRAVADA, não o clique.
       */
      await page.getByTestId('field-up-sala').getByTestId('inline-submit').click();

      await expect
        .poll(
          async () => {
            const chaves = (await camposGravados()).map((campo) => campo.key);
            return chaves.indexOf('sala') < chaves.indexOf('turma');
          },
          { timeout: 30_000 },
        )
        .toBe(true);
    } finally {
      await contexto.close();
    }
  });
});

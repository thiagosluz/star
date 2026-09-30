/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Conferência de certificados em lote (FASE 51, dívida E7)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM CONTRATA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. a tela é PÚBLICA: um visitante sem sessão nenhuma confere uma lista de códigos
 *         e vê, por linha, a situação, quem recebeu, o evento, a emissão e o motivo de
 *         não valer;
 *      2. ela funciona **SEM JavaScript** (`javaScriptEnabled: false`): colar a lista e
 *         clicar em "Conferir" é a submissão NATIVA do `<form method="get">`;
 *      3. a ordem da tabela é a ordem digitada;
 *      4. acima do teto a consulta é RECUSADA com mensagem clara — e sem tabela;
 *      5. código repetido é conferido uma vez, e item sem código é ignorado;
 *      6. um documento REVOGADO aparece inválido, com o motivo da revogação (o último
 *         cenário revoga o de verdade, de propósito — ver a nota de ordem lá).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CENÁRIO DEPENDE DO WORKER — E ISSO É O MESMO QUE A F6 JÁ EXIGIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A conferência só diz "válido" para documento com `status = ISSUED`, e quem gera o
 *  PDF é o worker (`docker compose --profile app up -d --build web worker`). O preparo
 *  EMITE o certificado pelo fluxo real (a participante pede na tela de certificados) e
 *  espera o status virar `ISSUED` — exatamente como `certification.spec.ts`, que já
 *  depende do worker para baixar o PDF. Sem o worker no ar, a espera estoura com a
 *  mensagem do status atual, em vez de passar medindo outra coisa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createActivity, createEvent, createTenant, e2eDb, grantRole, linkUser } from './helpers';
import { VALIDATION_ALPHABET } from '../../src/domain/certificates/certificate-rules';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'lote-f51';
const EVENT_SLUG = `evento-lote-${RUN_ID}`;
const ACTIVITY_SLUG = `minicurso-lote-${RUN_ID}`;
const INEXISTENTE = 'CERT-22222222';
const MALFORMADO = 'CERT-ABC';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventTitle: string;
let activityId: string;
let participantId: string;
let participantName: string;
let participantEmail: string;
let validCode: string;

/** Código de formato VÁLIDO a partir de um índice — para o cenário do teto. */
function codeAt(index: number): string {
  let remaining = index;
  let body = '';

  for (let position = 0; position < 8; position += 1) {
    body = VALIDATION_ALPHABET[remaining % VALIDATION_ALPHABET.length] + body;
    remaining = Math.floor(remaining / VALIDATION_ALPHABET.length);
  }

  return `CERT-${body}`;
}

/** Lê o certificado da participante com o contexto de instituição aplicado (RLS). */
async function readCertificate(): Promise<{ validationCode: string; status: string }> {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.certificate.findFirstOrThrow({
      where: { tenantId, userId: participantId, kind: 'MINI_COURSE' },
      select: { validationCode: true, status: true },
    });
  });
}

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f51.lote.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({ label: TENANT_LABEL, name: `Instituição Conferência ${RUN_ID}` });
    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: `Congresso de Conferência ${RUN_ID}`,
    });
    eventId = event.id;
    eventTitle = event.title;

    const activity = await createActivity({
      tenantId,
      eventId,
      slug: ACTIVITY_SLUG,
      title: `Minicurso de Conferência ${RUN_ID}`,
      workloadMinutes: 60,
    });
    activityId = activity.id;

    participantName = `Participante Conferida ${RUN_ID}`;
    const participant = await signUpVia(api, participantName);
    participantId = participant.id;
    participantEmail = participant.email;

    await linkUser({ tenantId, userId: participantId, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: participantId, role: 'PARTICIPANT' });

    /**
     * Presença completa, gravada direto: o que o certificado de minicurso exige é o
     * FATO (inscrição + frequência suficiente), e a digitação do balcão já é coberta
     * por `certification.spec.ts`. Aqui o objetivo é ter o documento emitido para
     * conferir a tela em lote.
     */
    const start = new Date(Date.now() - 3 * 3_600_000);

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.activity.update({ where: { id: activityId }, data: { type: 'MINI_COURSE' } });

      const registrationId = randomUUID();

      await tx.registration.create({
        data: {
          id: registrationId,
          tenantId,
          eventId,
          activityId,
          userId: participantId,
          status: 'ATTENDED',
          consentData: true,
          checkedInAt: start,
          badgeToken: `BADGE-${registrationId.slice(0, 12)}`,
        },
      });

      await tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId,
          registrationId,
          userId: participantId,
          status: 'PRESENT',
          source: 'MANUAL_STAFF',
          checkedInAt: start,
          // 60 de 60 minutos: acima dos 75 % que a elegibilidade do minicurso exige.
          checkedOutAt: new Date(start.getTime() + 60 * 60_000),
          minutesAttended: 60,
        },
      });
    });

    // ── A participante EMITE o certificado pelo fluxo real ────────────────────
    const context = await browser.newContext();

    try {
      const page = await context.newPage();

      await page.request.post('/api/auth/sign-in/email', {
        headers: { origin: 'http://localhost:3000' },
        data: { email: participantEmail, password: PASSWORD },
      });

      await page.goto(`/t/${tenantSlug}/certificados`);
      await page.getByLabel('Evento').selectOption(eventId);
      await page.getByLabel('Tipo de certificado').selectOption('MINI_COURSE');
      await page.getByTestId('request-certificate').click();

      await expect(page.getByTestId('certificate-feedback')).toContainText(
        /emitido|processamento/i,
        { timeout: 30_000 },
      );
    } finally {
      await context.close();
    }

    /**
     * Espera o documento ficar `ISSUED`. A mensagem de falha diz o status encontrado,
     * porque "QUEUED" aqui significa uma coisa só: o worker não está no ar.
     */
    await expect
      .poll(async () => (await readCertificate()).status, {
        message: 'o worker precisa gerar o certificado (docker compose --profile app up -d web worker)',
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
      })
      .toBe('ISSUED');

    validCode = (await readCertificate()).validationCode;
    expect(validCode).toMatch(/^CERT-[23456789ABCDEFGHJKMNPQRTUVWXY]{8}$/);
  } finally {
    await api.dispose();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('conferência de certificados em lote', () => {
  test('1. um visitante SEM sessão confere a lista SEM JavaScript, na ordem digitada', async ({
    browser,
  }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA DA DÍVIDA E7
     * ─────────────────────────────────────────────────────────────────────────────
     *  Contexto novo, sem cookie nenhum (nem participante, nem equipe) e com
     *  `javaScriptEnabled: false`: é a contratação conferindo uma pilha de documentos,
     *  que é o caso que a dívida descreve. Se a tela exigisse login ou hidratação, este
     *  teste não passaria.
     */
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await page.goto('/validar/lote');

      await expect(page.getByTestId('batch-form')).toBeVisible();
      await expect(page.getByTestId('batch-scope-notice')).toHaveCount(0);

      await page.getByTestId('batch-codes').fill([validCode, INEXISTENTE, MALFORMADO].join('\n'));
      await page.getByTestId('batch-submit').click();

      // A lista viaja na URL: é `<form method="get">`, e não estado de cliente.
      await expect(page).toHaveURL(/codigos=/);

      const linhas = page.locator('[data-testid^="batch-row-"]');
      await expect(linhas).toHaveCount(3);

      // (1) O documento real: válido, com quem recebeu, o evento e a emissão.
      const primeira = page.getByTestId('batch-row-0');
      await expect(primeira).toHaveAttribute('data-code', validCode);
      await expect(primeira).toHaveAttribute('data-valid', 'true');
      await expect(page.getByTestId('batch-verdict-0')).toContainText('válido');
      await expect(primeira).toContainText(participantName);
      await expect(primeira).toContainText(eventTitle);
      await expect(primeira).toContainText(/\d{2}\/\d{2}\/\d{4}/);

      // (2) Código inexistente: inválido, sem nome nem evento inventados.
      const segunda = page.getByTestId('batch-row-1');
      await expect(segunda).toHaveAttribute('data-code', INEXISTENTE);
      await expect(segunda).toHaveAttribute('data-status', 'NOT_FOUND');
      await expect(segunda).toHaveAttribute('data-valid', 'false');
      await expect(segunda).toContainText('não encontrado');
      await expect(segunda).toContainText('—');

      // (3) Código malformado: inválido, com o motivo do formato.
      const terceira = page.getByTestId('batch-row-2');
      await expect(terceira).toHaveAttribute('data-code', MALFORMADO);
      await expect(terceira).toHaveAttribute('data-valid', 'false');
      await expect(terceira).toContainText('formato inválido');

      // O resumo conta as duas pontas.
      await expect(page.getByTestId('batch-summary')).toContainText('3 código(s) conferido(s)');
      await expect(page.getByTestId('batch-summary')).toContainText('1 válido(s)');
      await expect(page.getByTestId('batch-summary')).toContainText('2 com problema');

      // O que a conferência NÃO prova está escrito na tela.
      await expect(page.getByTestId('batch-scope-notice')).toContainText('não');
      await expect(page.getByTestId('batch-scope-notice')).toContainText('varre o evento');
      await expect(page.getByTestId('batch-scope-notice')).toContainText('completa');
    } finally {
      await context.close();
    }
  });

  test('2. acima do teto a lista é recusada, e nada é conferido', async ({ page }) => {
    const muitos = Array.from({ length: 51 }, (_, index) => codeAt(index)).join('\n');

    await page.goto('/validar/lote');
    await page.getByTestId('batch-codes').fill(muitos);
    await page.getByTestId('batch-submit').click();

    const recusa = page.getByTestId('batch-refused');
    await expect(recusa).toBeVisible();
    await expect(recusa).toHaveAttribute('data-code', 'TOO_MANY');
    await expect(recusa).toContainText('51 códigos');
    await expect(recusa).toContainText('no máximo 50');
    await expect(recusa).toContainText('Nada foi conferido');

    // Recusa é recusa: nenhuma tabela, nenhum resumo.
    await expect(page.getByTestId('batch-table')).toHaveCount(0);
    await expect(page.getByTestId('batch-summary')).toHaveCount(0);
  });

  test('3. repetido é conferido uma vez e item sem código é ignorado', async ({ page }) => {
    const semPrefixo = validCode.replace('CERT-', '').toLowerCase();

    await page.goto('/validar/lote');
    await page.getByTestId('batch-codes').fill(`-\n${validCode}\n()\n${semPrefixo}\n`);
    await page.getByTestId('batch-submit').click();

    await expect(page.locator('[data-testid^="batch-row-"]')).toHaveCount(1);
    await expect(page.getByTestId('batch-row-0')).toHaveAttribute('data-code', validCode);
    await expect(page.getByTestId('batch-row-0')).toHaveAttribute('data-valid', 'true');

    await expect(page.getByTestId('batch-duplicates')).toContainText(validCode);
    await expect(page.getByTestId('batch-ignored')).toContainText('2 item(ns)');
  });

  test('4. lista vazia pede o código, sem resultado inventado', async ({ page }) => {
    await page.goto('/validar/lote');
    await page.getByTestId('batch-submit').click();

    await expect(page.getByTestId('batch-refused')).toHaveAttribute('data-code', 'EMPTY');
    await expect(page.getByTestId('batch-refused')).toContainText('pelo menos um código');
    await expect(page.getByTestId('batch-table')).toHaveCount(0);
  });

  test('5. documento REVOGADO aparece inválido, com o motivo (e este é o ÚLTIMO cenário)', async ({
    page,
  }) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  ESTE CENÁRIO MUTA O DOCUMENTO — POR ISSO É O ÚLTIMO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Revogar de verdade é ato da equipe (a tela não é desta fase); o que a fase precisa
     *  provar é que a CONFERÊNCIA lê o estado atual e mostra o motivo. A revogação é
     *  gravada direto no banco (o mesmo efeito da ação da equipe) e vem por último para
     *  não estragar os cenários que contam com o documento válido — a mesma ordem
     *  dependente e documentada de `media-and-window.spec.ts`.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.certificate.updateMany({
        where: { tenantId, userId: participantId, kind: 'MINI_COURSE' },
        data: {
          revokedAt: new Date(),
          revokedReason: 'Presença não comprovada em auditoria interna.',
        },
      });
    });

    await page.goto('/validar/lote');
    await page.getByTestId('batch-codes').fill(validCode);
    await page.getByTestId('batch-submit').click();

    const linha = page.getByTestId('batch-row-0');
    await expect(linha).toHaveAttribute('data-status', 'REVOKED');
    await expect(linha).toHaveAttribute('data-valid', 'false');
    await expect(page.getByTestId('batch-verdict-0')).toContainText('inválido');
    await expect(linha).toContainText('Presença não comprovada');
    await expect(page.getByTestId('batch-summary')).toContainText('0 válido(s)');
  });
});

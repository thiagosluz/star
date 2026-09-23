/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Lote de certificados em ZIP (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CAMINHO QUE ESTE CENÁRIO PERCORRE
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. o participante pede o certificado na tela;
 *      2. o WORKER gera o PDF e o guarda no bucket (fila de verdade);
 *      3. a equipe filtra o evento na tela de certificados e BAIXA O LOTE;
 *      4. o arquivo que chega é um ZIP legível, com o PDF lá dentro e o nome que a
 *         instituição espera (`<código>-<nome>.pdf`).
 *
 *  O passo 3 é o que só o navegador prova: a rota é autorizada por
 *  `certificate:issue`, o `Content-Disposition` faz o arquivo BAIXAR em vez de abrir
 *  na aba, e o corpo é montado em fluxo sobre objetos que existem no storage. Um
 *  teste de integração cobriria cada peça e nenhuma da costura.
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

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

async function createUser(
  page: Page,
  tenantId: string,
  name: string,
  role: 'ADMIN' | 'PARTICIPANT',
): Promise<{ id: string; email: string }> {
  const email = `f36.lote.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  await linkUser({ tenantId, userId: user.id });
  await grantRole({ tenantId, userId: user.id, role });

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

/** Lê as entradas de um ZIP — o mesmo leitor dos testes unitários, em miniatura. */
function readZipEntries(zip: Buffer): { name: string; content: Buffer }[] {
  const entries: { name: string; content: Buffer }[] = [];
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  const total = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);

  for (let index = 0; index < total; index += 1) {
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;

    entries.push({ name, content: zip.subarray(start, start + compressedSize) });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

test.describe('lote de certificados em ZIP', () => {
  test('a equipe baixa o lote do evento com o PDF gerado pelo worker', async ({ page }) => {
    test.setTimeout(240_000);

    const tenant = await createTenant({ label: 'lotezip', name: `Instituição do Lote ${RUN_ID}` });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-lote-${RUN_ID}`,
      title: `Congresso do Lote ${RUN_ID}`,
    });

    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `oficina-lote-${RUN_ID}`,
      title: `Oficina do Lote ${RUN_ID}`,
      capacity: 30,
      workloadMinutes: 120,
    });

    const participant = await createUser(page, tenant.id, 'Participante do Lote', 'PARTICIPANT');
    const admin = await createUser(page, tenant.id, 'Administradora do Lote', 'ADMIN');

    /**
     * ── A INSCRIÇÃO CREDENCIADA (fixture) ───────────────────────────────────────
     * O certificado de participação se apoia em "esta pessoa esteve no evento", e
     * esse fato vive em `registration.checkedInAt` — é onde a portaria o grava desde
     * a FASE 31 (ADR-149: a chegada marca a INSCRIÇÃO, onde vivem o XP e a fila).
     *
     * Montar isso no banco é deliberado: o que este cenário mede é o LOTE. Passar
     * pelo balcão de credenciamento mediria a FASE 31 de novo, mais devagar.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          eventId: event.id,
          activityId: activity.id,
          userId: participant.id,
          status: 'CONFIRMED',
          consentData: true,
          badgeToken: `BADGE-${randomUUID().slice(0, 12)}`,
          checkedInAt: new Date(),
        },
      });
    });

    await signInAs(page, participant.email);
    await page.goto(`/t/${tenant.slug}/certificados`);

    await page.getByLabel('Evento').selectOption(event.id);
    await page.getByLabel('Tipo de certificado').selectOption('PARTICIPATION');
    await page.getByTestId('request-certificate').click();

    await expect(page.getByTestId('certificate-feedback')).toContainText(/emitido|processamento/i, {
      timeout: 30_000,
    });

    const certificate = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      return tx.certificate.findFirstOrThrow({
        where: { tenantId: tenant.id, userId: participant.id },
        orderBy: { createdAt: 'desc' },
        select: { validationCode: true, status: true, storageKey: true },
      });
    });

    /** ── O WORKER GERA O PDF ──────────────────────────────────────────────────── */
    await expect
      .poll(
        async () => {
          const row = await e2eDb.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

            return tx.certificate.findUniqueOrThrow({
              where: { validationCode: certificate.validationCode },
              select: { status: true, storageKey: true },
            });
          });

          return row.status === 'ISSUED' && row.storageKey ? 1 : 0;
        },
        {
          message: 'o worker precisa gerar o PDF do certificado',
          timeout: 120_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toBe(1);

    /** ── A EQUIPE VÊ O BOTÃO DO LOTE, COM O EVENTO ESCOLHIDO ──────────────────── */
    await signInAs(page, admin.email);
    await page.goto(`/t/${tenant.slug}/administracao/certificados?evento=${event.id}`);

    const zipLink = page.getByTestId('download-certificate-zip');
    await expect(zipLink).toBeVisible();

    /**
     * Sem evento escolhido a tela não oferece o botão — ela diz o que fazer. O lote é
     * por EVENTO: um ZIP da instituição inteira não é o que a instituição entrega.
     */
    await page.goto(`/t/${tenant.slug}/administracao/certificados`);
    await expect(page.getByTestId('zip-hint')).toBeVisible();
    await expect(page.getByTestId('download-certificate-zip')).toHaveCount(0);

    /** ── O DOWNLOAD ───────────────────────────────────────────────────────────── */
    const response = await page.request.get(
      `/api/t/${tenant.slug}/certificados/zip?evento=${event.id}`,
    );

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('zip');
    expect(response.headers()['content-disposition']).toContain('attachment');
    expect(response.headers()['content-disposition']).toContain(
      `certificados-evento-lote-${RUN_ID}-`,
    );

    const zip = Buffer.from(await response.body());

    expect(zip.subarray(0, 2).toString('utf8')).toBe('PK');

    const entries = readZipEntries(zip);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe(
      `${certificate.validationCode}-participante-do-lote.pdf`,
    );
    /** O conteúdo é o PDF que o worker gerou — não um arquivo vazio ou um erro. */
    expect(entries[0]!.content.subarray(0, 5).toString('utf8')).toBe('%PDF-');

    /** ── O LOTE É AUDITADO ────────────────────────────────────────────────────── */
    const audit = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      return tx.auditLog.findFirst({
        where: { tenantId: tenant.id, entityType: 'certificate_batch', entityId: event.id },
        orderBy: { createdAt: 'desc' },
        select: { action: true, userId: true, changes: true },
      });
    });

    expect(audit?.action).toBe('EXPORT');
    expect(audit?.userId).toBe(admin.id);
  });

  test('a equipe sem permissão de emissão não baixa o lote', async ({ page }) => {
    const tenant = await createTenant({ label: 'lotezip-negado', name: `Instituição Negada ${RUN_ID}` });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-negado-${RUN_ID}`,
      title: `Evento Negado ${RUN_ID}`,
    });

    const participant = await createUser(page, tenant.id, 'Participante Negado', 'PARTICIPANT');

    await signInAs(page, participant.email);

    const response = await page.request.get(
      `/api/t/${tenant.slug}/certificados/zip?evento=${event.id}`,
    );

    /** Sem `certificate:issue` a rota recusa ANTES de montar qualquer coisa. */
    expect(response.status()).toBe(403);
    expect(await response.text()).toContain('certificate:issue');
  });

  test('evento sem certificado emitido explica o que falta, em vez de baixar vazio', async ({ page }) => {
    const tenant = await createTenant({ label: 'lotezip-vazio', name: `Instituição Vazia ${RUN_ID}` });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-vazio-${RUN_ID}`,
      title: `Evento Vazio ${RUN_ID}`,
    });

    const admin = await createUser(page, tenant.id, 'Administradora Vazia', 'ADMIN');

    await signInAs(page, admin.email);

    const response = await page.request.get(
      `/api/t/${tenant.slug}/certificados/zip?evento=${event.id}`,
    );

    expect(response.status()).toBe(409);
    expect(await response.text()).toContain('não tem certificados emitidos');
  });
});

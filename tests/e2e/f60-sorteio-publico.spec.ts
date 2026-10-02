/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O SORTEIO PÚBLICO E A OCULTAÇÃO DO PERFIL (FASE 60 · dívida E79)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE CENÁRIO PROVA, DE PONTA A PONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. o sorteio foi APURADO e PUBLICADO pelos serviços reais (`createRaffle` +
 *         `drawRaffle`) com duas pessoas que autorizam o nome no resultado
 *         (`User.isPublicProfile`) — o estado exato do defeito;
 *      2. as páginas públicas citam as duas: o resultado e o telão mostram o nome
 *         INTEIRO, com posição e prêmio;
 *      3. a moderação da plataforma decide OCULTAR pelo SERVIÇO REAL
 *         (`src/lib/platform/profile-moderation.ts`), não pela tela;
 *      4. a página do resultado passa a mostrar o nome ABREVIADO de quem foi oculto
 *         (`Ana Oculta` → `Ana O.`) — e continua mostrando a POSIÇÃO, o PRÊMIO e a
 *         CONTAGEM: a lista não perde ganhador;
 *      5. o COLEGA não oculto segue com o nome inteiro (a régua é da pessoa, não um
 *         blecaute da página), no telão e na auditoria também;
 *      6. nada na página denuncia a moderação: o rótulo é o NEUTRO do próprio sorteio
 *         (a lição do link da carta, `card-share-service.ts`).
 *
 *  A ORDEM importa e o arquivo roda em série: cada cenário depende do anterior, e o
 *  estado durável é o BANCO (a apuração e a decisão de moderação).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O SORTEIO NASCE PELOS SERVIÇOS, E NÃO PELA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A jornada da tela de sorteios (criar, conferir o universo, apurar) tem spec
 *  próprio (`raffle.spec.ts`). O que este arquivo precisa é do ESTADO: um sorteio
 *  apurado e publicado, com duas pessoas que autorizam o nome. Montá-lo pelos
 *  serviços reais garante que os nomes venham do banco pelo mesmo caminho da
 *  produção — um fixture que já nascesse mascarado não reproduziria o defeito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
} from './helpers';
import { decideReport } from '../../src/lib/platform/profile-moderation';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';
import { createRaffle, drawRaffle } from '../../src/lib/raffles/raffle-service';

const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f60-sorteio-${RUN_ID}`;

const NOME_PESSOA = 'Ana Oculta';
/** A máscara da FASE 16 (`maskName`): o mesmo rótulo de quem não autoriza o nome. */
const NOME_PESSOA_MASCARADO = 'Ana O.';
const NOME_COLEGA = 'Bruno Visivel';

const HANDLE = `srt-${RUN_ID}`;
const PREMIO = 'Notebook da abertura';
const DIA = new Date('2026-09-17T13:00:00.000Z');
const NOTA = 'O perfil publica dado de terceiro sem autorizacao; medida confirmada na analise.';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;

let pessoa: { id: string; email: string };
let colegaId: string;
let moderadorId: string;

let raffleId: string;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f60sorteio.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

/** Presença real: é dela que a elegibilidade do sorteio nasce. */
async function addAttendance(userId: string, minutes: number): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: null,
        userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: DIA,
        checkedOutAt: new Date(DIA.getTime() + minutes * 60_000),
        minutesAttended: minutes,
      },
    });
  });
}

test.describe.configure({ mode: 'serial' });

// ═══════════════════════════════════════════════════════════════════════════════
test.beforeAll(async ({ playwright, baseURL }) => {
  /** Cadastros, vínculos, apuração real e a releitura da página pública: folga no relógio. */
  test.setTimeout(180_000);

  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Sorteio Público ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `evento-${TENANT_LABEL}`,
      title: 'Congresso do Sorteio Público',
    });

    eventId = event.id;
    eventSlug = event.slug;

    pessoa = await signUpVia(api, NOME_PESSOA);
    const colega = await signUpVia(api, NOME_COLEGA);
    const organizadora = await signUpVia(api, `Organizadora do Sorteio ${RUN_ID}`);
    const moderador = await signUpVia(api, `Moderador do Sorteio ${RUN_ID}`);

    colegaId = colega.id;
    moderadorId = moderador.id;

    await grantPlatformRole({ userId: moderador.id });

    for (const userId of [pessoa.id, colega.id, organizadora.id]) {
      await linkUser({ tenantId, userId, kind: 'MEMBER' });
      await grantRole({
        tenantId,
        userId,
        role: userId === organizadora.id ? 'ADMIN' : 'PARTICIPANT',
      });
    }

    /**
     * O estado do DEFEITO, gravado direto no banco: consentimento antigo LIGADO
     * (`isPublicProfile`) e `@handle` publicado. O caminho de publicação do perfil
     * pela tela tem spec próprio (`public-profile.spec.ts`), e aqui o que interessa é
     * o efeito da ocultação sobre uma pessoa que JÁ aparecia com o nome inteiro.
     */
    await e2eDb.user.update({
      where: { id: pessoa.id },
      data: { publicHandle: HANDLE, isPublicProfile: true },
    });

    await e2eDb.user.update({
      where: { id: colega.id },
      data: { isPublicProfile: true },
    });

    await addAttendance(pessoa.id, 240);
    await addAttendance(colega.id, 200);

    /** Dois elegíveis, dois vencedores: as duas pessoas do contraste ganham. */
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId: organizadora.id,
      title: `Sorteio de brindes da abertura ${RUN_ID}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 2,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: true,
      allowPriorEventWinners: true,
      prizeTitle: PREMIO,
    });

    if (!created.ok) throw new Error(`criação do sorteio falhou: ${created.message}`);

    raffleId = created.raffleId;

    const drawn = await drawRaffle({ tenantId, raffleId, actorId: organizadora.id });
    if (!drawn.ok) throw new Error(`apuração do sorteio falhou: ${drawn.message}`);
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  if (tenantId) {
    const reports = await e2eDb.profileReport.findMany({
      where: { tenantId },
      select: { id: true },
    });

    /** A trilha da decisão é de PLATAFORMA (sem tenant) e não cai com a exclusão. */
    await e2eDb.auditLog.deleteMany({
      where: { entityType: 'profile_report', entityId: { in: reports.map((row) => row.id) } },
    });
  }

  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
test('1. o resultado e o telão citam quem ganhou, com posição e prêmio', async ({
  browser,
  baseURL,
}) => {
  /** Duas rotas públicas na primeira visita (o `dev` compila a página na hora). */
  test.setTimeout(120_000);

  const anonimo = await browser.newContext({ baseURL });
  const visitante = await anonimo.newPage();

  try {
    // ── A página pública do resultado ─────────────────────────────────────────
    await visitante.goto(`/t/${tenantSlug}/eventos/${eventSlug}/sorteios/${raffleId}`);

    const lista = visitante.getByTestId('raffle-result-winners');
    await expect(lista).toBeVisible({ timeout: 30_000 });
    await expect(lista).toContainText(NOME_PESSOA);
    await expect(lista).toContainText(NOME_COLEGA);

    /** Posição e prêmio são o que o balcão e a auditoria usam: estão no ar desde já. */
    await expect(visitante.getByTestId('raffle-result-winner-1')).toContainText('1º');
    await expect(visitante.getByTestId('raffle-result-winner-2')).toContainText('2º');
    await expect(visitante.getByTestId('raffle-result-round-1')).toContainText(PREMIO);

    /** Ninguém está mascarado ainda: as duas pessoas autorizam o nome. */
    expect(await visitante.locator('[data-testid^="raffle-result-winner-"][data-masked="true"]').count()).toBe(0);

    // ── O telão do palco ──────────────────────────────────────────────────────
    await visitante.goto(`/t/${tenantSlug}/eventos/${eventSlug}/sorteios/${raffleId}/palco`);

    const telao = visitante.getByTestId('stage-winners');
    await expect(telao).toContainText(NOME_PESSOA, { timeout: 30_000 });
    await expect(telao).toContainText(NOME_COLEGA);
  } finally {
    await anonimo.close();
  }
});

test('2. a moderação oculta o perfil pelo serviço real da plataforma', async () => {
  const reported = await reportPublicProfile({
    tenantId,
    reporterUserId: colegaId,
    username: HANDLE,
    category: 'PRIVACY',
    details: 'O perfil publica o telefone de uma terceira pessoa, sem autorização dela.',
  });

  expect(reported.ok, reported.ok ? 'ok' : reported.message).toBe(true);
  if (!reported.ok) return;

  const decidida = await decideReport({
    reportId: reported.reportId,
    action: 'HIDE',
    note: NOTA,
    actorId: moderadorId,
  });

  expect(decidida.ok, decidida.ok ? 'ok' : decidida.message).toBe(true);
  if (!decidida.ok) return;

  expect(decidida.hiddenProfile).toBe(true);

  /** O efeito é lido do BANCO: ocultar NÃO apaga, e o consentimento antigo continua lá. */
  const pessoaNoBanco = await e2eDb.user.findUniqueOrThrow({
    where: { id: pessoa.id },
    select: { publicProfileHiddenAt: true, publicHandle: true, isPublicProfile: true },
  });

  expect(pessoaNoBanco.publicProfileHiddenAt).not.toBeNull();
  expect(pessoaNoBanco.publicHandle).toBe(HANDLE);
  expect(pessoaNoBanco.isPublicProfile).toBe(true);
});

test('3. a página do resultado mascara — sem perder posição, prêmio nem ganhador', async ({
  browser,
  baseURL,
}) => {
  const anonimo = await browser.newContext({ baseURL });
  const visitante = await anonimo.newPage();

  try {
    await visitante.goto(`/t/${tenantSlug}/eventos/${eventSlug}/sorteios/${raffleId}`);

    const lista = visitante.getByTestId('raffle-result-winners');
    await expect(lista).toBeVisible({ timeout: 30_000 });

    /** Mascarado, e não removido: a LISTA continua com duas pessoas. */
    await expect(lista).toContainText(NOME_PESSOA_MASCARADO);
    await expect(lista).not.toContainText(NOME_PESSOA);

    /** O colega NÃO oculto segue inteiro: a régua é da pessoa. */
    await expect(lista).toContainText(NOME_COLEGA);

    /** A posição continua visível, nas duas linhas. */
    await expect(visitante.getByTestId('raffle-result-winner-1')).toContainText('1º');
    await expect(visitante.getByTestId('raffle-result-winner-2')).toContainText('2º');

    /** E o PRÊMIO também: o que sai é a identidade, não o resultado. */
    await expect(visitante.getByTestId('raffle-result-round-1')).toContainText(PREMIO);

    /** Uma linha mascarada (a ocultada) e uma inteira (o colega). */
    expect(
      await visitante.locator('[data-testid^="raffle-result-winner-"][data-masked="true"]').count(),
    ).toBe(1);
    expect(
      await visitante.locator('[data-testid^="raffle-result-winner-"][data-masked="false"]').count(),
    ).toBe(1);

    /** Nem no HTML servido — e nada que denuncie a moderação a quem só abre a página. */
    const html = await visitante.content();
    expect(html).not.toContain(NOME_PESSOA);
    expect(html).not.toContain(HANDLE);
    expect(html).not.toMatch(/por decis[ãa]o da modera/i);
  } finally {
    await anonimo.close();
  }
});

test('4. o telão e a auditoria usam a MESMA régua', async ({ browser, baseURL }) => {
  /** Duas rotas públicas; a auditoria compila a página na primeira visita. */
  test.setTimeout(120_000);

  const anonimo = await browser.newContext({ baseURL });
  const visitante = await anonimo.newPage();

  try {
    // ── O telão ───────────────────────────────────────────────────────────────
    await visitante.goto(`/t/${tenantSlug}/eventos/${eventSlug}/sorteios/${raffleId}/palco`);

    const telao = visitante.getByTestId('stage-winners');
    await expect(telao).toContainText(NOME_PESSOA_MASCARADO, { timeout: 30_000 });
    await expect(telao).toContainText(NOME_COLEGA);
    await expect(telao).not.toContainText(NOME_PESSOA);

    // ── A auditoria, que precisa CONTINUAR conferindo a apuração ──────────────
    await visitante.goto(`/t/${tenantSlug}/eventos/${eventSlug}/sorteios/${raffleId}/auditoria`);

    const listaPublicada = visitante.getByTestId('audit-pool-1');
    await expect(listaPublicada).toBeVisible({ timeout: 30_000 });
    await expect(listaPublicada).toContainText(NOME_PESSOA_MASCARADO);
    await expect(listaPublicada).toContainText(NOME_COLEGA);
    await expect(listaPublicada).not.toContainText(NOME_PESSOA);

    /** O resultado gravado da rodada, na auditoria, também abrevia. */
    const resultadoGravado = visitante.getByTestId('audit-winners-1');
    await expect(resultadoGravado).toContainText(NOME_PESSOA_MASCARADO);
    await expect(resultadoGravado).not.toContainText(NOME_PESSOA);

    /** A prova da semente continua publicada: mascarar não tirou a conferência do ar. */
    await expect(visitante.getByTestId('audit-round-1')).toBeVisible();
    await expect(visitante.getByTestId('audit-commitment-1')).toBeVisible();

    const html = await visitante.content();
    expect(html).not.toContain(NOME_PESSOA);
    expect(html).not.toContain(HANDLE);
  } finally {
    await anonimo.close();
  }
});

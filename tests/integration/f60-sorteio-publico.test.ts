/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — O SORTEIO PÚBLICO E A OCULTAÇÃO DO PERFIL
 *  (FASE 60 · dívida E79)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, E O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O sorteio apurado e publicado lia `user { name, isPublicProfile }` AO VIVO e
 *  resolvia o nome pelo consentimento ANTIGO. Quem a moderação da plataforma ocultou
 *  (F56 · E62) E tinha aquele consentimento ligado continuava com o nome COMPLETO em
 *  TRÊS páginas abertas a qualquer visitante — o resultado do sorteio, o telão do
 *  palco e a auditoria —, além da seção de resultados da página do evento. Estes
 *  testes percorrem as QUATRO leituras do serviço real, com o efeito gravado pelo
 *  serviço real de moderação:
 *
 *    • antes da decisão, as quatro citam a pessoa (a régua não é um blecaute);
 *    • depois da decisão, as quatro deixam de publicar o nome — e o COLEGA não
 *      oculto continua com o nome inteiro, porque a régua é da PESSOA;
 *    • a POSIÇÃO, o PRÊMIO e a CONTAGEM permanecem: a lista não perde ganhador;
 *    • a AUDITORIA continua conferindo a apuração — o hash do resultado, o hash da
 *      lista e a reprodução posição a posição são os MESMOS de antes da decisão,
 *      porque o documento assinado é `{ index, code, minutes }` e nunca carregou nome.
 *
 *  O cenário é montado pelos SERVIÇOS REAIS de sorteio (`createRaffle` +
 *  `drawRaffle`) e de perfil (`savePublicProfile`, que é quem grava o
 *  `isPublicProfile`), para que o defeito seja reproduzido no caminho que a produção
 *  usa — e não num fixture que já nasce mascarado.
 *
 *  A ORDEM dos cenários É o teste: mostrar (antes) → decidir → mascarar (depois). Ela
 *  depende do estado durável no banco, e não de variável preenchida por outro teste.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { savePublicProfile } from '../../src/lib/profile/public-profile-service';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';
import { decideReport } from '../../src/lib/platform/profile-moderation';
import {
  auditPoolDocument,
  createRaffle,
  drawRaffle,
  getPublicRaffleResult,
  getRaffleAudit,
  getRaffleStageView,
  listPublicRaffleResults,
} from '../../src/lib/raffles/raffle-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

const TENANT_SLUG = `f60-sorteio-${RUN}`;
const EVENT_SLUG = `evento-sorteio-${RUN}`;
const HANDLE_ANA = `ana-srt-${RUN}`;
const HANDLE_BRUNO = `bruno-srt-${RUN}`;

/** Nomes SEM o sufixo da execução: a máscara da FASE 16 (`Ana Souza` → `Ana S.`) é o contrato. */
const NOME_ANA = 'Ana Souza';
const NOME_BRUNO = 'Bruno Lima';
const NOME_ANA_MASCARADO = 'Ana S.';
const PREMIO = 'Notebook da abertura';
const NOTA = 'O perfil publica dado de terceiro sem autorizacao; medida confirmada na analise.';

const dia = new Date('2026-09-17T13:00:00.000Z');

let tenantId: string;
let eventId: string;

let ana: string;
let bruno: string;
let denunciante: string;
let moderador: string;
let actorId: string;

let raffleId: string;
let reportId: string;

/** A prova da apuração ANTES da decisão — é o que tem de continuar idêntico depois. */
let provaAntes: {
  resultHash: string | null;
  poolHash: string | null;
  poolDocument: string;
  positions: number[];
  confirmed: boolean;
};

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(input: {
  name: string;
  platformRole?: boolean;
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.name,
      email: `f60sorteio.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: id,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  if (input.platformRole) {
    await adminPrisma.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        userId: id,
        role: 'SUPERADMIN',
        scope: 'PLATFORM',
        reason: 'Moderador do teste de integração da FASE 60',
      },
    });
  }

  return id;
}

/**
 * O perfil público pelo SERVIÇO REAL, com o nome autorizado no resultado.
 *
 * `publicNameInResults: true` é o consentimento ANTIGO (`User.isPublicProfile`) — o
 * único que a regra do sorteio consultava. Sem ele ligado, o cenário não reproduziria
 * o defeito (a pessoa já apareceria mascarada por falta de consentimento).
 */
async function saveProfile(userId: string, username: string): Promise<void> {
  const result = await savePublicProfile({
    tenantId,
    userId,
    username,
    headline: null,
    bio: null,
    interests: [],
    siteUrl: null,
    orcidId: null,
    lattesId: null,
    contacts: {},
    audiences: { displayName: 'PUBLIC' },
    indexable: false,
    listedInDirectory: false,
    publicNameInResults: true,
    publicEventIds: [],
  });

  expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
}

/** Presença real: é dela que a elegibilidade do sorteio nasce. */
async function addAttendance(userId: string, minutes: number): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: null,
        userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: dia,
        checkedOutAt: new Date(dia.getTime() + minutes * 60_000),
        minutesAttended: minutes,
      },
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do Sorteio Público ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: 'Congresso do Sorteio Público',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: dia,
        endsAt: new Date(dia.getTime() + 86_400_000),
        timezone: TIME_ZONE,
        capacity: null,
        confirmedCount: 0,
      },
    }),
  );

  actorId = await createUser({ name: `Operadora do Sorteio ${RUN}` });
  ana = await createUser({ name: NOME_ANA });
  bruno = await createUser({ name: NOME_BRUNO });
  denunciante = await createUser({ name: `Quem Denuncia ${RUN}` });
  moderador = await createUser({ name: `Moderador da Plataforma ${RUN}`, platformRole: true });

  await saveProfile(ana, HANDLE_ANA);
  await saveProfile(bruno, HANDLE_BRUNO);

  await addAttendance(ana, 240);
  await addAttendance(bruno, 200);

  /**
   * A apuração pelo SERVIÇO REAL: dois elegíveis e dois vencedores, então as duas
   * pessoas do contraste ganham — uma será ocultada e a outra é o controle.
   */
  const created = await createRaffle({
    tenantId,
    eventId,
    actorId,
    title: `Sorteio de brindes da abertura ${RUN}`,
    scope: 'EVENT',
    minAttendanceMinutes: 0,
    winnersCount: 2,
    alternatesCount: 0,
    weightByMinutes: false,
    isPublic: true,
    allowPriorEventWinners: true,
    prizeTitle: PREMIO,
  });

  expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
  if (!created.ok) throw new Error(created.message);

  raffleId = created.raffleId;

  const drawn = await drawRaffle({ tenantId, raffleId, actorId });
  expect(drawn.ok, drawn.ok ? 'ok' : drawn.message).toBe(true);
  if (!drawn.ok) throw new Error(drawn.message);
});

afterAll(async () => {
  if (reportId) {
    /** A trilha da decisão é de PLATAFORMA (sem tenant) e não cai com a exclusão. */
    await adminPrisma.auditLog.deleteMany({
      where: { entityType: 'profile_report', entityId: reportId },
    });
  }

  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('antes da decisão, as quatro leituras públicas citam quem ganhou', () => {
  it('a seção do evento publica os dois nomes inteiros', async () => {
    const results = await listPublicRaffleResults(tenantId, eventId);

    expect(results).toHaveLength(1);

    const nomes = results[0]!.winners.map((winner) => winner.name);

    expect(nomes).toContain(NOME_ANA);
    expect(nomes).toContain(NOME_BRUNO);
    expect(results[0]!.winners.every((winner) => winner.masked === false)).toBe(true);
  });

  it('a página do sorteio mostra os nomes, a POSIÇÃO e o PRÊMIO', async () => {
    const result = await getPublicRaffleResult(tenantId, eventId, raffleId);
    expect(result).not.toBeNull();

    expect(result!.winners.map((winner) => winner.position)).toEqual([1, 2]);
    expect(result!.winners.map((winner) => winner.name)).toEqual(
      expect.arrayContaining([NOME_ANA, NOME_BRUNO]),
    );
    expect(result!.rounds[0]!.prizeTitle).toBe(PREMIO);
  });

  it('o telão cita quem ganhou e rola os nomes da lista publicada', async () => {
    const stage = await getRaffleStageView({ tenantId, eventId, raffleId });
    expect(stage).not.toBeNull();

    const nomes = stage!.winners.map((winner) => winner.name);
    expect(nomes).toContain(NOME_ANA);
    expect(nomes).toContain(NOME_BRUNO);
    expect(stage!.currentRound?.rollNames).toEqual(
      expect.arrayContaining([NOME_ANA, NOME_BRUNO]),
    );
  });

  it('a auditoria cita quem ganhou, confere a apuração e guarda a prova', async () => {
    const audit = await getRaffleAudit({ tenantId, eventId, raffleId });
    expect(audit).not.toBeNull();

    const round = audit!.rounds[0]!;

    expect(round.reproduction.possible).toBe(true);
    expect(round.reproduction.confirmed).toBe(true);
    expect(round.poolRows.map((row) => row.name)).toEqual(
      expect.arrayContaining([NOME_ANA, NOME_BRUNO]),
    );
    expect(round.winners.map((winner) => winner.name)).toEqual(
      expect.arrayContaining([NOME_ANA, NOME_BRUNO]),
    );

    /** A prova que a decisão de moderação NÃO pode invalidar. */
    provaAntes = {
      resultHash: round.resultHash,
      poolHash: round.poolHash,
      poolDocument: auditPoolDocument(round.pool),
      positions: round.winners.map((winner) => winner.position),
      confirmed: round.reproduction.confirmed,
    };

    expect(provaAntes.resultHash).toMatch(/^[a-f0-9]{64}$/);
    expect(provaAntes.poolHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a decisão da moderação (serviço real da plataforma)', () => {
  it('a denúncia entra na fila e o OCULTAR grava o efeito no perfil', async () => {
    const reported = await reportPublicProfile({
      tenantId,
      reporterUserId: denunciante,
      username: HANDLE_ANA,
      category: 'PRIVACY',
      details: 'O perfil publica o telefone de uma terceira pessoa, sem autorização dela.',
    });

    expect(reported.ok, reported.ok ? 'ok' : reported.message).toBe(true);
    if (!reported.ok) return;

    reportId = reported.reportId;

    const decided = await decideReport({
      reportId,
      action: 'HIDE',
      note: NOTA,
      actorId: moderador,
    });

    expect(decided.ok, decided.ok ? 'ok' : decided.message).toBe(true);
    if (!decided.ok) return;

    expect(decided.hiddenProfile).toBe(true);

    /**
     * O efeito é lido do BANCO: a decisão é sobre a PESSOA, e ocultar não apaga — o
     * `@handle` continua reservado e o consentimento antigo continua gravado (é
     * justamente por ele existir que o defeito aparecia).
     */
    const pessoa = await adminPrisma.user.findUniqueOrThrow({
      where: { id: ana },
      select: { publicProfileHiddenAt: true, publicHandle: true, isPublicProfile: true },
    });

    expect(pessoa.publicProfileHiddenAt).not.toBeNull();
    expect(pessoa.publicHandle).toBe(HANDLE_ANA);
    expect(pessoa.isPublicProfile).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('depois da decisão, o resultado do sorteio mascara — e não some com ninguém', () => {
  it('a página do sorteio abreviada: posição, prêmio e contagem permanecem', async () => {
    const result = await getPublicRaffleResult(tenantId, eventId, raffleId);
    expect(result).not.toBeNull();

    /** Ninguém sai da lista: a posição e a contagem são o que o balcão e a auditoria usam. */
    expect(result!.winners).toHaveLength(2);
    expect(result!.winners.map((winner) => winner.position)).toEqual([1, 2]);
    expect(result!.rounds[0]!.prizeTitle).toBe(PREMIO);

    const ocultada = result!.winners.find((winner) => winner.name === NOME_ANA_MASCARADO);
    const colega = result!.winners.find((winner) => winner.name === NOME_BRUNO);

    expect(ocultada?.masked).toBe(true);
    /** O colega NÃO oculto continua inteiro: a régua é da pessoa, não um blecaute. */
    expect(colega?.masked).toBe(false);

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(NOME_ANA);
    expect(serialized).not.toContain(HANDLE_ANA);
    /** Nada denuncia a moderação: o rótulo é o NEUTRO do próprio sorteio. */
    expect(serialized).not.toMatch(/modera|ocult|denunci/i);
  });

  it('a seção do evento usa a MESMA régua', async () => {
    const results = await listPublicRaffleResults(tenantId, eventId);

    expect(results[0]!.winners).toHaveLength(2);
    expect(results[0]!.winners.map((winner) => winner.name)).toEqual(
      expect.arrayContaining([NOME_ANA_MASCARADO, NOME_BRUNO]),
    );
    expect(JSON.stringify(results)).not.toContain(NOME_ANA);
  });

  it('o telão abrevia quem foi ocultado e mantém o colega no ar', async () => {
    const stage = await getRaffleStageView({ tenantId, eventId, raffleId });
    expect(stage).not.toBeNull();

    const nomes = stage!.winners.map((winner) => winner.name);

    expect(nomes).toContain(NOME_ANA_MASCARADO);
    expect(nomes).toContain(NOME_BRUNO);
    expect(JSON.stringify(stage)).not.toContain(NOME_ANA);
  });

  it('a auditoria continua CONFERINDO: a prova da apuração não muda', async () => {
    const audit = await getRaffleAudit({ tenantId, eventId, raffleId });
    expect(audit).not.toBeNull();

    const round = audit!.rounds[0]!;

    /**
     * O documento assinado é `{ index, code, minutes }` — o nome nunca entrou em hash
     * nenhum. Se a máscara tivesse mexido na lista, a conferência acusaria divergência
     * e a apuração publicada deixaria de ser verificável.
     */
    expect(round.resultHash).toBe(provaAntes.resultHash);
    expect(round.poolHash).toBe(provaAntes.poolHash);
    expect(auditPoolDocument(round.pool)).toBe(provaAntes.poolDocument);
    expect(round.winners.map((winner) => winner.position)).toEqual(provaAntes.positions);
    expect(round.reproduction.confirmed).toBe(provaAntes.confirmed);
    expect(round.reproduction.diverged).toBe(0);
    expect(round.poolRows).toHaveLength(2);

    const linhaDaOcultada = round.poolRows.find((row) => row.name === NOME_ANA_MASCARADO);
    const linhaDoColega = round.poolRows.find((row) => row.name === NOME_BRUNO);

    expect(linhaDaOcultada?.masked).toBe(true);
    expect(linhaDoColega?.masked).toBe(false);

    /** O código público de cada linha continua ligando a lista ao resultado. */
    const codigos = new Set(round.poolRows.map((row) => row.code));
    expect(round.winners.every((winner) => winner.code !== null && codigos.has(winner.code))).toBe(
      true,
    );

    expect(JSON.stringify(audit)).not.toContain(NOME_ANA);
  });
});

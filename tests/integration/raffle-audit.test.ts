/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — palco e auditoria do sorteio (FASE 29)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio puro
 *  não alcança:
 *    • a apuração GRAVA a lista publicada (ordem, códigos e minutos) e o hash dela;
 *    • o payload do resultado passa a assinar a lista (versão 3), e a reconstrução
 *      do hash continua conferindo;
 *    • a auditoria reproduz o resultado gravado posição a posição — e ACUSA quando a
 *      lista é adulterada;
 *    • apuração anterior a esta fase não inventa lista: a página diz por quê;
 *    • o palco mostra o compromisso ANTES da apuração (o elo que faltava entre a
 *      tela de operação e a página pública);
 *    • o recorte do ao vivo vem do SORTEIO, não da URL.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listAuditLog } from '../../src/lib/admin/audit';
import {
  createRaffle,
  drawRaffle,
  getRaffleAudit,
  getRaffleLiveState,
  getRaffleStageView,
} from '../../src/lib/raffles/raffle-service';
import { poolHash } from '../../src/domain/raffles/pool-rules';
import { buildResultPayload, hashResult } from '../../src/domain/raffles/raffle-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let eventId: string;
let activityId: string;
let actorId: string;
const presentIds: string[] = [];

const day = new Date('2026-09-17T13:00:00.000Z');

async function createUser(name: string, publicProfile = false): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name,
      email: `f29.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      isPublicProfile: publicProfile,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

/** Sorteio apurado com N pessoas presentes. */
async function drawnRaffle(input: {
  title: string;
  winnersCount?: number;
  alternatesCount?: number;
  weightByMinutes?: boolean;
  isPublic?: boolean;
}): Promise<string> {
  const created = await createRaffle({
    tenantId,
    eventId,
    actorId,
    title: input.title,
    scope: 'EVENT',
    minAttendanceMinutes: 0,
    winnersCount: input.winnersCount ?? 1,
    alternatesCount: input.alternatesCount ?? 0,
    weightByMinutes: input.weightByMinutes ?? false,
    isPublic: input.isPublic ?? false,
    allowPriorEventWinners: true,
  });

  if (!created.ok) throw new Error(`criação falhou: ${created.message}`);

  const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });
  if (!drawn.ok) throw new Error(`apuração falhou: ${drawn.message}`);

  return created.raffleId;
}

/**
 * A rodada apurada do sorteio.
 *
 * Desde a FASE 30 a prova vive na RODADA (compromisso, lista, resultado) e as colunas
 * equivalentes em `raffles` são legado congelado — ler a raffle aqui daria `null` num
 * sorteio novo, e o teste passaria a medir o campo errado.
 */
async function storedRound(raffleId: string) {
  return withTenant(tenantId, (tx) =>
    tx.raffleRound.findFirstOrThrow({
      where: { raffleId },
      orderBy: { roundNumber: 'desc' },
      select: {
        id: true,
        roundNumber: true,
        poolSnapshot: true,
        poolHash: true,
        resultVersion: true,
        resultHash: true,
        seedCommitment: true,
        seedRevealed: true,
        seedKeyVersion: true,
        eligibleCount: true,
        winnersCount: true,
        alternatesCount: true,
      },
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  activityId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f29-${RUN}`,
      name: `Instituição Auditoria ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-f29',
        title: 'Congresso F29',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-09-17T12:00:00.000Z'),
        endsAt: new Date('2026-09-18T23:00:00.000Z'),
        timezone: TIME_ZONE,
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: 'atividade-f29',
        title: 'Atividade F29',
        type: 'LECTURE',
        status: 'COMPLETED',
        modality: 'IN_PERSON',
        startsAt: day,
        endsAt: new Date(day.getTime() + 3_600_000),
        workloadMinutes: 60,
      },
    });
  });

  actorId = await createUser('Operadora da auditoria');

  // Quatro presentes com minutos DIFERENTES: o sorteio ponderado tem o que pesar.
  const minutes = [90, 60, 30, 15];

  for (let index = 0; index < minutes.length; index += 1) {
    const userId = await createUser(`Presente Auditoria ${index}`, index === 0);
    presentIds.push(userId);

    await withTenant(tenantId, (tx) =>
      tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId,
          userId,
          status: 'PRESENT',
          source: 'MANUAL_STAFF',
          checkedInAt: day,
          checkedOutAt: new Date(day.getTime() + minutes[index]! * 60_000),
          minutesAttended: minutes[index]!,
        },
      }),
    );
  }
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a apuração grava a lista publicada', () => {
  it('grava a lista na ordem do sorteio, com código, minutos e o hash dela', async () => {
    const raffleId = await drawnRaffle({ title: `Lista F29 ${RUN}`, winnersCount: 2, alternatesCount: 1 });
    const stored = await storedRound(raffleId);

    const snapshot = stored.poolSnapshot as unknown as {
      index: number;
      code: string;
      minutes: number;
    }[];

    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot).toHaveLength(presentIds.length);

    // A ordem é a do sorteio: índices 1..N, sem buraco e sem repetição.
    expect(snapshot.map((entry) => entry.index)).toEqual([1, 2, 3, 4]);
    expect(snapshot.every((entry) => entry.code.startsWith('P-'))).toBe(true);

    // Os minutos somados são os do credenciamento (90/60/30/15).
    expect([...snapshot.map((entry) => entry.minutes)].sort((a, b) => b - a)).toEqual([90, 60, 30, 15]);

    // O hash gravado é o do DOCUMENTO canônico — é o que a página publica.
    expect(stored.poolHash).toBe(poolHash(snapshot.map(({ index, code, minutes }) => ({ index, code, minutes }))));
    // A prova é da RODADA, e a versão do documento declara o momento (FASE 30).
    expect(stored.roundNumber).toBe(1);
    expect(stored.resultVersion).toBe(4);
  });

  it('o hash do resultado assina a lista e a RODADA (versão 4) — e continua conferindo', async () => {
    const raffleId = await drawnRaffle({ title: `Assinatura F29 ${RUN}`, winnersCount: 1 });
    const stored = await storedRound(raffleId);

    const row = await withTenant(tenantId, (tx) =>
      tx.raffle.findUniqueOrThrow({
        where: { id: raffleId },
        select: {
          id: true,
          tenantId: true,
          eventId: true,
          scope: true,
          activityId: true,
          referenceDate: true,
          minAttendanceMinutes: true,
          winnersCount: true,
          alternatesCount: true,
          weightByMinutes: true,
          allowPriorEventWinners: true,
          eligibleCount: true,
          drawnAt: true,
          winners: {
            orderBy: { position: 'asc' },
            select: { position: true, userId: true, attendanceMinutes: true, kind: true },
          },
        },
      }),
    );

    const payload = buildResultPayload({
      validationVersion: 4,
      raffleId: row.id,
      tenantId: row.tenantId,
      eventId: row.eventId,
      roundNumber: stored.roundNumber,
      scope: row.scope as 'EVENT',
      activityId: row.activityId,
      referenceDate: row.referenceDate
        ? new Date(row.referenceDate).toISOString().slice(0, 10)
        : null,
      minAttendanceMinutes: row.minAttendanceMinutes,
      winnersCount: stored.winnersCount,
      allowPriorEventWinners: row.allowPriorEventWinners,
      alternatesCount: stored.alternatesCount,
      weightByMinutes: row.weightByMinutes,
      poolHash: stored.poolHash,
      poolCount: (stored.poolSnapshot as unknown as unknown[]).length,
      eligibleCount: stored.eligibleCount,
      drawnAt: row.drawnAt!.toISOString(),
      winners: row.winners.map((winner) => ({
        position: winner.position,
        userId: winner.userId,
        minutes: winner.attendanceMinutes,
        kind: winner.kind as 'WINNER' | 'ALTERNATE',
      })),
    });

    expect(hashResult(payload)).toBe(stored.resultHash);
  });

  it('a trilha registra o hash e o tamanho da lista no ato da apuração', async () => {
    const raffleId = await drawnRaffle({ title: `Trilha F29 ${RUN}`, winnersCount: 1 });
    const round = await storedRound(raffleId);

    const entries = await listAuditLog(tenantId, { limit: 20 });
    // A apuração é da RODADA desde a FASE 30: é ali que a prova fica.
    const entry = entries.find(
      (row) => row.entityType === 'raffleRound' && row.entityId === round.id && row.changes.poolHash,
    );

    expect(entry).toBeDefined();
    expect(String(entry?.changes.poolHash?.to)).toHaveLength(64);
    expect(Number(entry?.changes.poolCount?.to)).toBe(presentIds.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a auditoria reproduz o resultado — e acusa quando não reproduz', () => {
  it('reproduz o resultado gravado, posição a posição', async () => {
    const raffleId = await drawnRaffle({
      title: `Reprodução F29 ${RUN}`,
      winnersCount: 2,
      alternatesCount: 1,
      weightByMinutes: true,
    });

    const audit = await getRaffleAudit({ tenantId, eventId, raffleId });
    expect(audit).not.toBeNull();

    const round = audit!.rounds[0]!;

    expect(round.pool).toHaveLength(presentIds.length);
    expect(round.poolCount).toBe(presentIds.length);
    expect(round.reproduction.possible).toBe(true);
    expect(round.reproduction.confirmed).toBe(true);
    expect(round.reproduction.diverged).toBe(0);
    expect(round.reproduction.matched).toBe(round.winners.length);
    expect(round.duplicatedCodes).toEqual([]);
  });

  it('liga cada linha da lista à posição do resultado pelo CÓDIGO', async () => {
    const raffleId = await drawnRaffle({ title: `Ligação F29 ${RUN}`, winnersCount: 2 });
    const audit = await getRaffleAudit({ tenantId, eventId, raffleId });

    const round = audit!.rounds[0]!;
    const codesDaLista = new Set(round.poolRows.map((row) => row.code));

    for (const winner of round.winners) {
      expect(winner.code).not.toBeNull();
      expect(codesDaLista.has(winner.code!)).toBe(true);
    }

    // E os códigos das posições são distintos entre si (ninguém ganha duas vezes).
    expect(new Set(round.winners.map((winner) => winner.code)).size).toBe(round.winners.length);
  });

  it('ACUSA divergência quando a lista gravada é adulterada', async () => {
    const raffleId = await drawnRaffle({ title: `Adulteração F29 ${RUN}`, winnersCount: 2 });
    const antes = await getRaffleAudit({ tenantId, eventId, raffleId });
    expect(antes!.rounds[0]!.reproduction.confirmed).toBe(true);

    const round = await storedRound(raffleId);
    const snapshot = round.poolSnapshot as unknown as {
      index: number;
      code: string;
      minutes: number;
    }[];

    /**
     * A adulteração troca o CÓDIGO de todas as linhas (mantendo índices e minutos).
     *
     * Mexer só em duas linhas deixaria o teste dependente de QUAIS posições aquela
     * semente escolheu — com sorteio uniforme, trocar os minutos das duas primeiras
     * nem sempre muda o resultado. Trocando todos os códigos, a divergência é certa,
     * seja qual for a semente: a lista publicada deixou de ser a lista que gerou o
     * resultado gravado.
     */
    const adulterada = snapshot.map((entry) => ({
      ...entry,
      code: entry.code.replace('P-', 'P-0'),
    }));

    // A lista vive na RODADA desde a FASE 30 — é ela que precisa ser adulterada.
    await withTenant(tenantId, (tx) =>
      tx.raffleRound.update({
        where: { id: round.id },
        data: { poolSnapshot: adulterada as unknown as object },
      }),
    );

    const depois = await getRaffleAudit({ tenantId, eventId, raffleId });
    const depoisRound = depois!.rounds[0]!;

    expect(depoisRound.reproduction.confirmed).toBe(false);
    expect(depoisRound.reproduction.diverged).toBeGreaterThan(0);
    expect(depoisRound.reproduction.positions.some((entry) => entry.reason === 'DIFFERENT_CODE')).toBe(
      true,
    );

    /**
     * E o hash do documento muda junto: é ele que a página confere no navegador
     * antes mesmo de reproduzir — a adulteração aparece por dois caminhos.
     */
    expect(poolHash(depoisRound.pool!)).not.toBe(depoisRound.poolHash);
  });

  it('sorteio apurado ANTES desta fase não inventa lista: a auditoria explica', async () => {
    const raffleId = await drawnRaffle({ title: `Legado F29 ${RUN}`, winnersCount: 1 });
    const round = await storedRound(raffleId);

    // Simula o estado de uma apuração da FASE 22: sem lista, sem hash de lista.
    await withTenant(tenantId, (tx) =>
      tx.raffleRound.update({
        where: { id: round.id },
        data: { poolSnapshot: null, poolHash: null, resultVersion: 2 },
      }),
    );

    const audit = await getRaffleAudit({ tenantId, eventId, raffleId });
    const legada = audit!.rounds[0]!;

    expect(legada.pool).toBeNull();
    expect(legada.poolCount).toBe(0);
    expect(legada.reproduction.possible).toBe(false);
    expect(legada.reproduction.reason).toMatch(/antes de a lista/i);
    expect(legada.winners.every((winner) => winner.code === null)).toBe(true);
  });

  it('não publica nome de quem não autorizou o perfil público', async () => {
    const raffleId = await drawnRaffle({ title: `Privacidade F29 ${RUN}`, winnersCount: 4 });
    const audit = await getRaffleAudit({ tenantId, eventId, raffleId });
    const round = audit!.rounds[0]!;

    const publica = round.poolRows.find((row) => row.name.startsWith('Presente Auditoria 0'));
    const mascarada = round.poolRows.find((row) => row.name.includes('Presente A.'));

    // A primeira pessoa foi criada com perfil público; as outras não.
    expect(publica?.masked).toBe(false);
    expect(mascarada?.masked).toBe(true);
    expect(round.poolRows.filter((row) => row.masked).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o palco mostra o compromisso ANTES da apuração', () => {
  it('em rascunho: estado AGUARDANDO, compromisso visível e nenhum ganhador', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Palco F29 ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: false,
      allowPriorEventWinners: true,
    });

    if (!created.ok) throw new Error('criação falhou');

    const stage = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });

    expect(stage).not.toBeNull();
    expect(stage!.state).toBe('AGUARDANDO');
    expect(stage!.seedCommitment).not.toBeNull();
    expect(stage!.winners).toEqual([]);
    expect(stage!.drawnAt).toBeNull();

    // Apurar muda o estado do MESMO endereço — é o que o telão detecta sozinho.
    const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });
    expect(drawn.ok).toBe(true);

    const depois = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });

    expect(depois!.state).toBe('REVELADO');
    expect(depois!.winners).toHaveLength(1);
    expect(depois!.drawnAt).not.toBeNull();
  });

  it('sorteio cancelado tem estado próprio (o telão avisa em vez de esperar)', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Cancelado F29 ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: false,
      allowPriorEventWinners: true,
    });

    if (!created.ok) throw new Error('criação falhou');

    await withTenant(tenantId, (tx) =>
      tx.raffle.update({ where: { id: created.raffleId }, data: { status: 'CANCELED' } }),
    );

    const stage = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });
    expect(stage!.state).toBe('CANCELADO');
  });

  it('o ao vivo devolve o recorte do SORTEIO, não o da URL', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Recorte F29 ${RUN}`,
      scope: 'ACTIVITY',
      activityId,
      minAttendanceMinutes: 45,
      winnersCount: 3,
      alternatesCount: 2,
      weightByMinutes: true,
      isPublic: false,
      allowPriorEventWinners: false,
    });

    if (!created.ok) throw new Error('criação falhou');

    const state = await getRaffleLiveState({ tenantId, eventId, raffleId: created.raffleId });

    expect(state).not.toBeNull();
    expect(state!.config).toMatchObject({
      scope: 'ACTIVITY',
      activityId,
      minAttendanceMinutes: 45,
      winnersCount: 3,
      alternatesCount: 2,
      weightByMinutes: true,
      allowPriorEventWinners: false,
    });
    expect(state!.status).toBe('DRAFT');
    expect(state!.poolHash).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o documento publicado é o que o hash assina', () => {
  it('o artefato de auditoria reconstrói o mesmo hash do banco', async () => {
    const raffleId = await drawnRaffle({ title: `Documento F29 ${RUN}`, winnersCount: 1 });
    const stored = await storedRound(raffleId);
    const snapshot = stored.poolSnapshot as unknown as {
      index: number;
      code: string;
      minutes: number;
    }[];

    const canonico = snapshot.map(({ index, code, minutes }) => ({ index, code, minutes }));

    expect(poolHash(canonico)).toBe(stored.poolHash);
  });
});

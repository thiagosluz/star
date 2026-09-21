/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — motor de sorteios
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio
 *  puro não alcança:
 *    • a elegibilidade lida da tabela `attendances` (quem não compareceu não entra);
 *    • a trava pessimista: dois disparos simultâneos → UMA apuração;
 *    • os índices únicos como garantia final da antiduplicação;
 *    • o hash do resultado conferível ponto a ponto;
 *    • a trilha de auditoria com os vencedores e o hash.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  cancelRaffle,
  createRaffle,
  drawRaffle,
  listRaffles,
  previewEligibility,
} from '../../src/lib/raffles/raffle-service';
import { listAuditLog } from '../../src/lib/admin/audit';
import { buildResultPayload, hashResult, verifyResult } from '../../src/domain/raffles/raffle-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let activityAId: string;
let activityBId: string;
let actorId: string;

/** Participantes: um presente completo, um presente sem check-out, um ausente. */
let presentId: string;
let shortPresenceId: string;
let absentId: string;
let otherDayId: string;

const dayOne = new Date('2026-09-17T13:00:00.000Z');
const dayTwo = new Date('2026-09-18T13:00:00.000Z');

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name, email: `raffle.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });
  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return id;
}

async function addAttendance(input: {
  userId: string;
  activityId: string | null;
  checkedInAt: Date;
  minutes: number;
  status?: 'PRESENT' | 'ABSENT' | 'PARTIAL';
  checkedOut?: boolean;
}): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.attendance.create({
      data: {
        id,
        tenantId,
        eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: input.status ?? 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: input.checkedInAt,
        checkedOutAt: input.checkedOut === false ? null : new Date(input.checkedInAt.getTime() + input.minutes * 60_000),
        minutesAttended: input.minutes,
      },
    }),
  );

  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();
  activityAId = randomUUID();
  activityBId = randomUUID();

  for (const [id, slug, name] of [
    [tenantId, `raffle-${RUN}`, `Instituição Sorteios ${RUN}`],
    [otherTenantId, `raffle-outro-${RUN}`, `Outra Instituição ${RUN}`],
  ] as const) {
    await adminPrisma.tenant.create({
      data: { id, slug, name, status: 'ACTIVE', plan: 'PROFESSIONAL', timezone: 'America/Bahia' },
    });
  }

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-sorteio',
        title: 'Congresso dos Sorteios',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-09-17T12:00:00.000Z'),
        endsAt: new Date('2026-09-19T23:00:00.000Z'),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.activity.createMany({
      data: [
        {
          id: activityAId,
          tenantId,
          eventId,
          slug: 'minicurso-a',
          title: 'Minicurso A',
          type: 'MINI_COURSE',
          status: 'COMPLETED',
          modality: 'IN_PERSON',
          startsAt: dayOne,
          endsAt: new Date(dayOne.getTime() + 4 * 3_600_000),
          workloadMinutes: 240,
        },
        {
          id: activityBId,
          tenantId,
          eventId,
          slug: 'palestra-b',
          title: 'Palestra B',
          type: 'LECTURE',
          status: 'COMPLETED',
          modality: 'IN_PERSON',
          startsAt: dayTwo,
          endsAt: new Date(dayTwo.getTime() + 3_600_000),
          workloadMinutes: 60,
        },
      ],
    });
  });

  actorId = await createUser('Organizadora dos Sorteios');
  presentId = await createUser('Presente Completо');
  shortPresenceId = await createUser('Presença Curta');
  absentId = await createUser('Ausente');
  otherDayId = await createUser('Presente do Segundo Dia');

  // Dia 1 — presença completa no minicurso A.
  await addAttendance({ userId: presentId, activityId: activityAId, checkedInAt: dayOne, minutes: 240 });
  // Dia 1 — presença curta (30 min no minicurso A).
  await addAttendance({ userId: shortPresenceId, activityId: activityAId, checkedInAt: dayOne, minutes: 30 });
  // Dia 1 — compareceu mas não houve check-out (minutos medidos = 0).
  await addAttendance({
    userId: shortPresenceId,
    activityId: activityAId,
    checkedInAt: new Date(dayOne.getTime() + 3_600_000),
    minutes: 0,
    checkedOut: false,
  });
  // Dia 1 — presença marcada como AUSENTE (não comprova nada).
  await addAttendance({
    userId: absentId,
    activityId: activityAId,
    checkedInAt: dayOne,
    minutes: 120,
    status: 'ABSENT',
  });
  // Dia 2 — presença na palestra B.
  await addAttendance({ userId: otherDayId, activityId: activityBId, checkedInAt: dayTwo, minutes: 60 });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('elegibilidade a partir da presença real', () => {
  it('escopo EVENT considera quem tem presença válida e ignora ausentes', async () => {
    const preview = await previewEligibility({
      tenantId,
      eventId,
      config: {
        scope: 'EVENT',
        referenceDate: null,
        activityId: null,
        minAttendanceMinutes: 0,
        winnersCount: 1,
        allowPriorEventWinners: true,
      },
    });

    expect(preview.ok, preview.ok ? 'ok' : preview.message).toBe(true);
    if (!preview.ok) return;

    const ids = preview.preview.eligible.map((entry) => entry.userId);

    expect(ids).toContain(presentId);
    expect(ids).toContain(otherDayId);
    expect(ids).not.toContain(absentId);
    expect(preview.preview.rejected.find((entry) => entry.userId === absentId)?.reason).toMatch(/ausente/i);
  });

  it('o piso de minutos exclui quem cumpriu pouco, com o motivo', async () => {
    const preview = await previewEligibility({
      tenantId,
      eventId,
      config: {
        scope: 'ACTIVITY',
        referenceDate: null,
        activityId: activityAId,
        minAttendanceMinutes: 120,
        winnersCount: 1,
        allowPriorEventWinners: true,
      },
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.preview.eligible.map((entry) => entry.userId)).toEqual([presentId]);
    expect(
      preview.preview.rejected.find((entry) => entry.userId === shortPresenceId)?.reason,
    ).toMatch(/abaixo do piso/i);
  });

  it('piso ZERO inclui quem compareceu sem check-out registrado', async () => {
    const preview = await previewEligibility({
      tenantId,
      eventId,
      config: {
        scope: 'ACTIVITY',
        referenceDate: null,
        activityId: activityAId,
        minAttendanceMinutes: 0,
        winnersCount: 1,
        allowPriorEventWinners: true,
      },
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    // `shortPresenceId` tem 30 min em uma presença e 0 em outra: com piso zero, entra.
    expect(preview.preview.eligible.map((entry) => entry.userId)).toContain(shortPresenceId);
  });

  it('escopo DAY recorta pelo dia local da atividade', async () => {
    const preview = await previewEligibility({
      tenantId,
      eventId,
      config: {
        scope: 'DAY',
        // 2026-09-17T12:00Z = dia 17 em Salvador (UTC−3).
        referenceDate: new Date('2026-09-17T12:00:00.000Z'),
        activityId: null,
        minAttendanceMinutes: 0,
        winnersCount: 1,
        allowPriorEventWinners: true,
      },
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const ids = preview.preview.eligible.map((entry) => entry.userId);

    expect(ids).toContain(presentId);
    // A presença do dia 18 fica de fora.
    expect(ids).not.toContain(otherDayId);
    expect(
      preview.preview.rejected.find((entry) => entry.userId === otherDayId)?.reason,
    ).toMatch(/2026-09-18/);
  });

  it('a prévia informa quantas presenças foram inspecionadas', async () => {
    const preview = await previewEligibility({
      tenantId,
      eventId,
      config: {
        scope: 'EVENT',
        referenceDate: null,
        activityId: null,
        minAttendanceMinutes: 0,
        winnersCount: 1,
        allowPriorEventWinners: true,
      },
    });

    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.preview.inspectedAttendances).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('apuração', () => {
  it('sorteia, grava vencedores e congela o resultado', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Sorteio principal',
      scope: 'ACTIVITY',
      activityId: activityAId,
      minAttendanceMinutes: 120,
      winnersCount: 1,
      allowPriorEventWinners: true,
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const drawn = await drawRaffle({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      now: new Date('2026-09-19T20:00:00.000Z'),
      randomInt: () => 0,
    });

    expect(drawn.ok, drawn.ok ? 'ok' : drawn.message).toBe(true);
    if (!drawn.ok) return;

    // Só o presente com 240 min cumpre o piso de 120.
    expect(drawn.eligibleCount).toBe(1);
    expect(drawn.winners).toHaveLength(1);
    expect(drawn.winners[0]?.userId).toBe(presentId);
    expect(drawn.winners[0]?.minutes).toBe(240);
    expect(drawn.resultHash).toMatch(/^[a-f0-9]{64}$/);

    const row = await withTenant(tenantId, (tx) =>
      tx.raffle.findUniqueOrThrow({
        where: { id: created.raffleId },
        select: {
          status: true,
          drawnAt: true,
          eligibleCount: true,
          inspectedAttendances: true,
          resultHash: true,
          drawVersion: true,
          winners: { select: { position: true, userId: true, attendanceMinutes: true } },
        },
      }),
    );

    expect(row.status).toBe('DRAWN');
    expect(row.drawnAt?.toISOString()).toBe('2026-09-19T20:00:00.000Z');
    expect(row.drawVersion).toBe(2); // 1 da criação + 1 da apuração
    expect(row.winners).toHaveLength(1);
    expect(row.winners[0]?.position).toBe(1);
  });

  it('o hash gravado confere com o resultado persistido (auditoria)', async () => {
    const list = await listRaffles(tenantId, eventId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const raffle = list.raffles.find((entry) => entry.status === 'DRAWN');
    expect(raffle).toBeDefined();
    if (!raffle || !raffle.resultHash) return;

    const recomputed = hashResult(
      buildResultPayload({
        /**
         * A VERSÃO vem do que está gravado na RODADA (FASE 16, ampliada nas FASES 29 e
         * 30): o payload ganhou suplentes e peso por minutos (v2), a lista publicada
         * (v3) e o número da rodada (v4) — reconstruir na versão errada acusaria
         * "resultado adulterado" em uma apuração íntegra.
         */
        validationVersion:
          raffle.resultVersion === 4
            ? 4
            : raffle.resultVersion === 3
              ? 3
              : raffle.resultVersion === 2
                ? 2
                : 1,
        roundNumber: raffle.rounds[raffle.rounds.length - 1]?.roundNumber ?? 1,
        raffleId: raffle.id,
        tenantId,
        eventId,
        scope: raffle.scope,
        activityId: raffle.activityId,
        referenceDate: raffle.referenceDay,
        minAttendanceMinutes: raffle.minAttendanceMinutes,
        winnersCount: raffle.winnersCount,
        alternatesCount: raffle.alternatesCount,
        weightByMinutes: raffle.weightByMinutes,
        allowPriorEventWinners: raffle.allowPriorEventWinners,
        // Na versão 3 a LISTA assinada é a lista de elegíveis: em número, é o
        // `eligibleCount` gravado na mesma apuração.
        poolHash: raffle.poolHash,
        poolCount: raffle.eligibleCount,
        eligibleCount: raffle.eligibleCount,
        drawnAt: raffle.drawnAt!.toISOString(),
        winners: raffle.winners.map((winner) => ({
          position: winner.position,
          userId: winner.userId,
          minutes: winner.minutes,
          kind: winner.kind,
        })),
      }),
    );

    expect(recomputed).toBe(raffle.resultHash);

    // E a reconferência formal também aprova.
    expect(
      verifyResult(
        {
          validationVersion:
            raffle.resultVersion === 4
              ? 4
              : raffle.resultVersion === 3
                ? 3
                : raffle.resultVersion === 2
                  ? 2
                  : 1,
          roundNumber: raffle.rounds[raffle.rounds.length - 1]?.roundNumber ?? 1,
          raffleId: raffle.id,
          tenantId,
          eventId,
          scope: raffle.scope,
          activityId: raffle.activityId,
          referenceDate: raffle.referenceDay,
          minAttendanceMinutes: raffle.minAttendanceMinutes,
          winnersCount: raffle.winnersCount,
          alternatesCount: raffle.alternatesCount,
          weightByMinutes: raffle.weightByMinutes,
          allowPriorEventWinners: raffle.allowPriorEventWinners,
          poolHash: raffle.poolHash,
          poolCount: raffle.eligibleCount,
          eligibleCount: raffle.eligibleCount,
          drawnAt: raffle.drawnAt!.toISOString(),
          winners: raffle.winners.map((winner) => ({
            position: winner.position,
            userId: winner.userId,
            minutes: winner.minutes,
            kind: winner.kind,
          })),
        },
        raffle.resultHash,
      ),
    ).toBe(true);
  });

  it('RECUSA apurar duas vezes o mesmo sorteio', async () => {
    const list = await listRaffles(tenantId, eventId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const drawn = list.raffles.find((entry) => entry.status === 'DRAWN');
    if (!drawn) return;

    const again = await drawRaffle({ tenantId, raffleId: drawn.id, actorId });

    expect(again.ok).toBe(false);
    if (!again.ok) {
      /**
       * Desde a FASE 30 não existe "o sorteio já foi apurado": existe "não há rodada
       * preparada". A rodada 1 foi apurada, e apurar de novo exige PREPARAR a próxima
       * — que é o que a mensagem diz, em vez de um "já foi apurado" que a operação
       * leria como "não dá mais para sortear neste evento".
       */
      expect(again.code).toBe('NO_PENDING_ROUND');
      expect(again.message).toMatch(/prepara/i);
    }

    // Nenhum vencedor novo foi gravado.
    const count = await withTenant(tenantId, (tx) =>
      tx.raffleWinner.count({ where: { raffleId: drawn.id } }),
    );
    expect(count).toBe(drawn.winners.length);
  });

  it('DOIS DISPAROS SIMULTÂNEOS resultam em UMA apuração', async () => {
    /**
     * O cenário real: dois organizadores clicando "sortear" ao mesmo tempo, ou um
     * duplo clique no palco. A trava `SELECT ... FOR UPDATE` serializa as
     * transações; a segunda encontra `DRAWN` e é recusada.
     */
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Sorteio concorrente',
      scope: 'ACTIVITY',
      activityId: activityAId,
      minAttendanceMinutes: 0,
      winnersCount: 2,
      allowPriorEventWinners: true,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [first, second] = await Promise.all([
      drawRaffle({ tenantId, raffleId: created.raffleId, actorId }),
      drawRaffle({ tenantId, raffleId: created.raffleId, actorId }),
    ]);

    const successes = [first, second].filter((result) => result.ok);
    const failures = [first, second].filter((result) => !result.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    // A segunda encontra a rodada já apurada e é recusada SEM sortear (FASE 30: a
    // apuração é da RODADA, então o motivo é "prepare a próxima").
    if (!failures[0]!.ok) expect(failures[0]!.code).toBe('NO_PENDING_ROUND');

    const winners = await withTenant(tenantId, (tx) =>
      tx.raffleWinner.findMany({
        where: { raffleId: created.raffleId },
        select: { userId: true, position: true },
        orderBy: { position: 'asc' },
      }),
    );

    // Uma apuração, com posições 1..n sem repetição.
    expect(new Set(winners.map((winner) => winner.position)).size).toBe(winners.length);
    expect(new Set(winners.map((winner) => winner.userId)).size).toBe(winners.length);
  });

  it('NÃO repete o mesmo participante em um sorteio com várias vagas', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Sorteio de várias vagas',
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 10,
      allowPriorEventWinners: true,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });

    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;

    const ids = drawn.winners.map((winner) => winner.userId);

    expect(new Set(ids).size).toBe(ids.length);
    // Entrega o que existe, sem inventar concorrente.
    expect(drawn.winners.length).toBe(drawn.eligibleCount);
    expect(drawn.shortfall).toBe(10 - drawn.eligibleCount);
  });

  it('BLOQUEIA a apuração sem elegíveis (quórum zero)', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Sorteio sem elegíveis',
      scope: 'ACTIVITY',
      activityId: activityAId,
      minAttendanceMinutes: 600,
      winnersCount: 1,
      allowPriorEventWinners: true,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });

    expect(drawn.ok).toBe(false);
    if (!drawn.ok) {
      expect(drawn.code).toBe('NO_ELIGIBLE');
      expect(drawn.message).toMatch(/credenciamento/i);
    }

    // O sorteio continua configurado, aguardando — não some.
    const row = await withTenant(tenantId, (tx) =>
      tx.raffle.findUniqueOrThrow({
        where: { id: created.raffleId },
        select: { status: true, drawnAt: true },
      }),
    );

    expect(row.status).toBe('DRAFT');
    expect(row.drawnAt).toBeNull();
  });

  it('EXCLUI ganhadores de sorteios anteriores do mesmo evento', async () => {
    const first = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Primeiro sorteio',
      scope: 'ACTIVITY',
      activityId: activityAId,
      minAttendanceMinutes: 0,
      winnersCount: 10,
      allowPriorEventWinners: true,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const firstDraw = await drawRaffle({
      tenantId,
      raffleId: first.raffleId,
      actorId,
      randomInt: () => 0,
    });

    expect(firstDraw.ok, firstDraw.ok ? 'ok' : firstDraw.message).toBe(true);
    if (!firstDraw.ok) return;
    expect(firstDraw.winners.length).toBeGreaterThanOrEqual(1);

    const winnerIds = firstDraw.winners.map((winner) => winner.userId);

    // Segundo sorteio do MESMO evento, sem permitir ganhadores anteriores.
    const second = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Segundo sorteio',
      scope: 'ACTIVITY',
      activityId: activityAId,
      minAttendanceMinutes: 0,
      winnersCount: 1,
      allowPriorEventWinners: false,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const preview = await previewEligibility({
      tenantId,
      eventId,
      config: {
        scope: 'ACTIVITY',
        referenceDate: null,
        activityId: activityAId,
        minAttendanceMinutes: 0,
        winnersCount: 1,
        allowPriorEventWinners: false,
      },
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    for (const winnerId of winnerIds) {
      expect(preview.preview.eligible.map((entry) => entry.userId)).not.toContain(winnerId);
      expect(preview.preview.rejected.find((entry) => entry.userId === winnerId)?.reason).toMatch(
        /já foi sorteado/i,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cancelamento e auditoria', () => {
  it('cancela um sorteio não apurado, com motivo', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Sorteio a cancelar',
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      allowPriorEventWinners: true,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const canceled = await cancelRaffle({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      reason: 'Sorteio duplicado por engano na mesma cerimônia.',
    });

    expect(canceled.ok).toBe(true);

    const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });
    expect(drawn.ok).toBe(false);
    if (!drawn.ok) expect(drawn.code).toBe('CANCELED');
  });

  it('NÃO cancela um sorteio já apurado (o resultado é público)', async () => {
    const list = await listRaffles(tenantId, eventId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const drawn = list.raffles.find((entry) => entry.status === 'DRAWN');
    if (!drawn) return;

    const result = await cancelRaffle({
      tenantId,
      raffleId: drawn.id,
      actorId,
      reason: 'Tentativa de cancelar depois do anúncio.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/público/i);
  });

  it('a trilha de auditoria registra a criação, a rodada e a apuração', async () => {
    /**
     * Cenário PRÓPRIO (armadilha 62): depender do que as provas anteriores deixaram
     * faria este teste medir a trilha de outro sorteio — ou de nenhum —, porque a
     * listagem é limitada às últimas entradas da instituição.
     */
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Trilha do sorteio ${randomUUID().slice(0, 6)}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      prizeTitle: 'Caneca do evento',
      allowPriorEventWinners: true,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const round = await withTenant(tenantId, (tx) =>
      tx.raffleRound.findFirstOrThrow({
        where: { raffleId: created.raffleId },
        select: { id: true },
      }),
    );

    const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });
    expect(drawn.ok).toBe(true);

    const audit = await listAuditLog(tenantId, { limit: 50 });

    /**
     * ── A APURAÇÃO É DA RODADA (FASE 30) ────────────────────────────────────────
     * O hash do resultado, a lista publicada e o compromisso vivem no registro da
     * RODADA (`entityType: raffleRound`); o registro do sorteio guarda a transição de
     * estado. Procurar o hash no registro do sorteio não acharia nada — e era o que
     * este teste fazia antes das rodadas.
     */
    const roundEntries = audit.filter(
      (entry) => entry.entityType === 'raffleRound' && entry.entityId === round.id,
    );

    const prepared = roundEntries.find((entry) => entry.action === 'CREATE');
    expect(prepared).toBeDefined();
    expect(JSON.stringify(prepared?.changes)).toMatch(/seedCommitment/);

    const drawnEntry = roundEntries.find(
      (entry) => entry.action === 'UPDATE' && entry.changes.resultHash,
    );

    expect(drawnEntry).toBeDefined();
    expect(String(drawnEntry!.changes.resultHash?.to)).toHaveLength(64);

    // A criação do SORTEIO continua na trilha, com os campos de negócio.
    const creation = audit.find(
      (entry) =>
        entry.entityType === 'raffle' && entry.entityId === created.raffleId && entry.action === 'CREATE',
    );

    expect(creation?.actorName).toBe('Organizadora dos Sorteios');
    expect(Object.keys(creation?.changes ?? {})).toContain('winnersCount');

    /**
     * O registro da apuração descreve o MOMENTO: quem ganhou, em que posições, com que
     * lista e com que semente. É o que permite responder "por que fulano ganhou?"
     * meses depois sem varrer o banco.
     */
    expect(String(drawnEntry!.changes.winners?.to)).toMatch(/1º/);
    expect(String(drawnEntry!.changes.poolHash?.to)).toHaveLength(64);
    expect(String(drawnEntry!.changes.seedRevealed?.to).length).toBeGreaterThan(0);
    expect(Number(drawnEntry!.changes.roundNumber?.to)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isolamento entre instituições', () => {
  it('os sorteios de outra instituição não aparecem', async () => {
    const mine = await listRaffles(tenantId, eventId);
    const theirs = await listRaffles(otherTenantId, eventId);

    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) return;

    expect(mine.raffles.length).toBeGreaterThan(0);
    expect(theirs.raffles).toHaveLength(0);
  });

  it('apurar sorteio de outro tenant devolve NOT_FOUND', async () => {
    const list = await listRaffles(tenantId, eventId);
    expect(list.ok).toBe(true);
    if (!list.ok || list.raffles.length === 0) return;

    const result = await drawRaffle({
      tenantId: otherTenantId,
      raffleId: list.raffles[0]!.id,
      actorId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('a prévia de outra instituição não enxerga as presenças', async () => {
    const preview = await previewEligibility({
      tenantId: otherTenantId,
      eventId,
      config: {
        scope: 'EVENT',
        referenceDate: null,
        activityId: null,
        minAttendanceMinutes: 0,
        winnersCount: 1,
        allowPriorEventWinners: true,
      },
    });

    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.preview.eligible).toHaveLength(0);
      expect(preview.preview.inspectedAttendances).toBe(0);
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — serviços de gamificação
 *
 *  Cobre o que o motor de recompensas sozinho não cobre: credenciamento real com
 *  cálculo de carga horária, resgate de missão, álbum, destaque de carta, ranking
 *  e ajuste administrativo — todos contra o banco de verdade, sob RLS.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { checkIn, checkOut, listCheckinQueue } from '../../src/lib/events/attendance-service';
import { getAlbum, setCardPinned } from '../../src/lib/gamification/card-service';
import { claimMission, listMissions } from '../../src/lib/gamification/task-service';
import { adjustXp, getLeaderboard, getXpProfile, listXpHistory } from '../../src/lib/gamification/xp-service';
import { xpToReachLevel } from '../../src/domain/gamification/xp-rules';

const RUN = randomUUID().slice(0, 8);
let tenantId: string;
let eventId: string;
let miniCourseId: string;
let lectureId: string;
let participantId: string;
let staffId: string;
let registrationId: string;
let lectureRegistrationId: string;
let missionId: string;
let rewardCardId: string;

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name, email: `gamisrv.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });
  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  miniCourseId = randomUUID();
  lectureId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `gamisrv-${RUN}`,
      name: `Instituição Serviços ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
  });

  const startsAt = new Date(Date.now() - 3_600_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-servicos',
        title: 'Evento de Serviços',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.activity.createMany({
      data: [
        {
          id: miniCourseId,
          tenantId,
          eventId,
          slug: 'minicurso-servicos',
          title: 'Minicurso de Serviços',
          type: 'MINI_COURSE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
          workloadMinutes: 240,
        },
        {
          id: lectureId,
          tenantId,
          eventId,
          slug: 'palestra-servicos',
          title: 'Palestra de Serviços',
          type: 'LECTURE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          workloadMinutes: 60,
        },
      ],
    });
  });

  participantId = await createUser('Participante Serviços');
  staffId = await createUser('Equipe Credenciamento');

  registrationId = randomUUID();
  lectureRegistrationId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.registration.createMany({
      data: [
        {
          id: registrationId,
          tenantId,
          eventId,
          activityId: miniCourseId,
          userId: participantId,
          status: 'CONFIRMED',
          consentData: true,
          badgeToken: `BADGE-${RUN}-1`,
        },
        {
          id: lectureRegistrationId,
          tenantId,
          eventId,
          activityId: lectureId,
          userId: participantId,
          status: 'CONFIRMED',
          consentData: true,
          badgeToken: `BADGE-${RUN}-2`,
        },
      ],
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

beforeEach(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.xpTransaction.deleteMany({ where: { tenantId } });
    await tx.userTaskProgress.deleteMany({ where: { tenantId } });
    await tx.userCard.deleteMany({ where: { tenantId } });
    await tx.userXpProfile.deleteMany({ where: { tenantId } });
    await tx.attendance.deleteMany({ where: { tenantId } });
    await tx.cardTemplate.deleteMany({ where: { tenantId } });
    await tx.taskDefinition.deleteMany({ where: { tenantId } });

    await tx.registration.updateMany({
      where: { tenantId },
      data: { checkedInAt: null, checkedInById: null, status: 'CONFIRMED' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('credenciamento', () => {
  it('registra entrada, atualiza a inscrição e credita XP com carta', async () => {
    await withTenant(tenantId, (tx) =>
      tx.cardTemplate.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: 'cracha-servicos',
          name: 'Crachá',
          rarity: 'COMMON',
          trigger: 'CHECKIN',
        },
      }),
    );

    const result = await checkIn({ tenantId, registrationId, staffUserId: staffId });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.alreadyCheckedIn).toBe(false);
    expect(result.reward?.xpAwarded).toBe(50);
    expect(result.reward?.cards).toHaveLength(1);

    const registration = await withTenant(tenantId, (tx) =>
      tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
        select: { status: true, checkedInAt: true, checkedInById: true },
      }),
    );

    expect(registration.status).toBe('ATTENDED');
    expect(registration.checkedInAt).not.toBeNull();
    expect(registration.checkedInById).toBe(staffId);

    const attendance = await withTenant(tenantId, (tx) =>
      tx.attendance.findMany({
        where: { tenantId, registrationId },
        select: { source: true, activityId: true, validatedById: true },
      }),
    );

    expect(attendance).toHaveLength(1);
    expect(attendance[0]?.source).toBe('MANUAL_STAFF');
    expect(attendance[0]?.activityId).toBe(miniCourseId);
    expect(attendance[0]?.validatedById).toBe(staffId);
  });

  it('NÃO credita duas vezes ao repetir o check-in', async () => {
    await checkIn({ tenantId, registrationId, staffUserId: staffId });
    const second = await checkIn({ tenantId, registrationId, staffUserId: staffId });

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.alreadyCheckedIn).toBe(true);

    const [attendanceCount, xpCount] = await Promise.all([
      withTenant(tenantId, (tx) => tx.attendance.count({ where: { tenantId, registrationId } })),
      withTenant(tenantId, (tx) => tx.xpTransaction.count({ where: { tenantId } })),
    ]);

    expect(attendanceCount).toBe(1);
    expect(xpCount).toBe(1);
  });

  it('recusa credenciamento de inscrição não confirmada', async () => {
    const cancelledId = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.registration.create({
        data: {
          id: cancelledId,
          tenantId,
          eventId,
          activityId: miniCourseId,
          userId: staffId,
          status: 'CANCELED',
        },
      }),
    );

    const result = await checkIn({ tenantId, registrationId: cancelledId, staffUserId: staffId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_CONFIRMED');
  });

  it('recusa check-out sem entrada registrada', async () => {
    const result = await checkOut({ tenantId, registrationId, staffUserId: staffId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_CHECKED_IN');
  });

  it('conta a carga horária real e credita presença + conclusão de minicurso', async () => {
    const start = new Date('2026-09-17T13:00:00.000Z');
    await checkIn({ tenantId, registrationId, staffUserId: staffId, now: start });

    // 200 minutos depois: acima de 75% de 240 (180).
    const result = await checkOut({
      tenantId,
      registrationId,
      staffUserId: staffId,
      now: new Date(start.getTime() + 200 * 60_000),
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.minutesAttended).toBe(200);
    expect(result.countedForXp).toBe(true);
    expect(result.rewards.map((reward) => reward.xpAwarded)).toEqual([40, 150]);

    const attendance = await withTenant(tenantId, (tx) =>
      tx.attendance.findFirstOrThrow({
        where: { tenantId, registrationId },
        select: { minutesAttended: true, checkedOutAt: true },
      }),
    );

    expect(attendance.minutesAttended).toBe(200);
    expect(attendance.checkedOutAt).not.toBeNull();
  });

  it('presença insuficiente NÃO vale XP (mas fica registrada)', async () => {
    const start = new Date('2026-09-17T13:00:00.000Z');
    await checkIn({ tenantId, registrationId, staffUserId: staffId, now: start });

    const result = await checkOut({
      tenantId,
      registrationId,
      staffUserId: staffId,
      now: new Date(start.getTime() + 20 * 60_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.minutesAttended).toBe(20);
    expect(result.countedForXp).toBe(false);
    expect(result.rewards).toHaveLength(0);

    // A presença é fato e permanece; só a recompensa é que não vem.
    const attendance = await withTenant(tenantId, (tx) =>
      tx.attendance.count({ where: { tenantId, registrationId } }),
    );
    expect(attendance).toBe(1);

    // Só o XP do check-in (50), sem os de presença.
    const total = await withTenant(tenantId, (tx) =>
      tx.xpTransaction.aggregate({ where: { tenantId }, _sum: { amount: true } }),
    );
    expect(total._sum.amount).toBe(50);
  });

  it('lista a fila de credenciamento por nome e crachá', async () => {
    const byName = await listCheckinQueue(tenantId, eventId, { query: 'Participante Serviços' });
    expect(byName.ok).toBe(true);
    if (byName.ok) expect(byName.entries.length).toBeGreaterThanOrEqual(2);

    const byBadge = await listCheckinQueue(tenantId, eventId, { query: `BADGE-${RUN}-1` });
    expect(byBadge.ok).toBe(true);
    if (byBadge.ok) {
      expect(byBadge.entries).toHaveLength(1);
      expect(byBadge.entries[0]?.registrationId).toBe(registrationId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('missões', () => {
  beforeEach(async () => {
    rewardCardId = randomUUID();
    missionId = randomUUID();

    await withTenant(tenantId, async (tx) => {
      await tx.cardTemplate.create({
        data: {
          id: rewardCardId,
          tenantId,
          eventId,
          slug: 'premio-da-missao',
          name: 'Prêmio da Missão',
          rarity: 'RARE',
          trigger: 'MANUAL_GRANT',
        },
      });

      await tx.taskDefinition.create({
        data: {
          id: missionId,
          tenantId,
          eventId,
          slug: 'credencie-se',
          name: 'Credencie-se',
          kind: 'ONE_OFF',
          trigger: 'CHECKIN',
          target: { count: 1 },
          xpReward: 100,
          rewardCardTemplateId: rewardCardId,
        },
      });
    });
  });

  it('mostra a missão e libera o resgate ao completar', async () => {
    const before = await listMissions(tenantId, participantId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.missions[0]).toMatchObject({ progress: 0, claimable: false });

    await checkIn({ tenantId, registrationId, staffUserId: staffId });

    const after = await listMissions(tenantId, participantId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.missions[0]).toMatchObject({ progress: 1, target: 1, claimable: true, status: 'COMPLETED' });
  });

  it('resgata XP e carta, e não permite resgatar de novo', async () => {
    await checkIn({ tenantId, registrationId, staffUserId: staffId });

    const claim = await claimMission({
      tenantId,
      userId: participantId,
      taskDefinitionId: missionId,
    });

    expect(claim.ok, claim.ok ? 'ok' : claim.message).toBe(true);
    if (!claim.ok) return;

    expect(claim.xpAwarded).toBe(100);
    expect(claim.cards.map((card) => card.slug)).toContain('premio-da-missao');
    expect(claim.alreadyClaimed).toBe(false);

    // 50 do check-in + 100 da missão.
    const profile = await getXpProfile(tenantId, participantId);
    expect(profile.ok).toBe(true);
    if (profile.ok) expect(profile.profile.progress.totalXp).toBe(150);

    const second = await claimMission({
      tenantId,
      userId: participantId,
      taskDefinitionId: missionId,
    });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('NOT_CLAIMABLE');

    const total = await withTenant(tenantId, (tx) =>
      tx.xpTransaction.aggregate({ where: { tenantId }, _sum: { amount: true } }),
    );
    // Sem crédito duplicado.
    expect(total._sum.amount).toBe(150);
  });

  it('recusa resgate de missão ainda não concluída', async () => {
    const result = await claimMission({
      tenantId,
      userId: participantId,
      taskDefinitionId: missionId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_CLAIMABLE');
  });

  it('missão DIÁRIA usa a chave do dia local', async () => {
    const dailyId = randomUUID();
    await withTenant(tenantId, (tx) =>
      tx.taskDefinition.create({
        data: {
          id: dailyId,
          tenantId,
          eventId,
          slug: 'diaria',
          name: 'Diária',
          kind: 'DAILY',
          trigger: 'CHECKIN',
          target: { count: 1 },
          xpReward: 20,
        },
      }),
    );

    await checkIn({ tenantId, registrationId, staffUserId: staffId });

    const rows = await withTenant(tenantId, (tx) =>
      tx.userTaskProgress.findMany({
        where: { tenantId, userId: participantId, taskDefinitionId: dailyId },
        select: { periodKey: true },
      }),
    );

    expect(rows).toHaveLength(1);
    // 2026-09-17T13:00Z é 2026-09-17 em Salvador (UTC−3) — quando o teste roda em
    // outra data, a chave apenas acompanha o dia; o que se prova aqui é o FORMATO
    // e a não-nulidade.
    expect(rows[0]?.periodKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('álbum e destaque', () => {
  async function seedCards(count: number): Promise<string[]> {
    const userCards: string[] = [];

    /**
     * O PERFIL é criado UMA vez, fora do laço: `(tenantId, userId)` é único, e
     * criar dentro do laço estourava na segunda carta.
     */
    await withTenant(tenantId, (tx) =>
      tx.userXpProfile.create({
        data: {
          id: randomUUID(),
          tenantId,
          userId: participantId,
          totalXp: 300,
          cardsCollected: count,
        },
      }),
    );

    for (let index = 0; index < count; index += 1) {
      const templateId = randomUUID();
      const userCardId = randomUUID();

      await withTenant(tenantId, async (tx) => {
        await tx.cardTemplate.create({
          data: {
            id: templateId,
            tenantId,
            eventId,
            slug: `carta-${index}`,
            name: `Carta ${index}`,
            rarity: index % 2 === 0 ? 'COMMON' : 'EPIC',
            trigger: 'MANUAL_GRANT',
          },
        });

        await tx.userCard.create({
          data: {
            id: userCardId,
            tenantId,
            userId: participantId,
            cardTemplateId: templateId,
            eventId,
            source: 'MANUAL_GRANT',
          },
        });
      });

      userCards.push(userCardId);
    }

    return userCards;
  }

  it('monta o álbum com obtidas, faltantes e resumo por raridade', async () => {
    await seedCards(2);

    // Uma terceira carta no catálogo, que a pessoa NÃO tem.
    await withTenant(tenantId, (tx) =>
      tx.cardTemplate.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: 'carta-ausente',
          name: 'Carta Ausente',
          rarity: 'MYTHIC',
          trigger: 'MANUAL_GRANT',
        },
      }),
    );

    const album = await getAlbum(tenantId, participantId);
    expect(album.ok).toBe(true);
    if (!album.ok) return;

    expect(album.cards).toHaveLength(3);
    expect(album.summary.owned).toBe(2);
    expect(album.summary.total).toBe(3);
    expect(album.summary.byRarity.COMMON).toEqual({ owned: 1, total: 1 });
    expect(album.summary.byRarity.MYTHIC).toEqual({ owned: 0, total: 1 });
  });

  it('destaca até três cartas e recusa a quarta', async () => {
    const userCards = await seedCards(4);

    for (const userCardId of userCards.slice(0, 3)) {
      const result = await setCardPinned({
        tenantId,
        userId: participantId,
        userCardId,
        isPinned: true,
      });
      expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    }

    const fourth = await setCardPinned({
      tenantId,
      userId: participantId,
      userCardId: userCards[3]!,
      isPinned: true,
    });

    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.code).toBe('PIN_LIMIT');
  });

  it('não destaca carta de outra pessoa', async () => {
    const [userCardId] = await seedCards(1);

    const result = await setCardPinned({
      tenantId,
      userId: staffId,
      userCardId: userCardId!,
      isPinned: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_OWNED');
  });

  it('desafixar libera espaço para outra carta', async () => {
    const userCards = await seedCards(3);

    for (const userCardId of userCards) {
      await setCardPinned({ tenantId, userId: participantId, userCardId, isPinned: true });
    }

    const unpin = await setCardPinned({
      tenantId,
      userId: participantId,
      userCardId: userCards[0]!,
      isPinned: false,
    });

    expect(unpin.ok).toBe(true);
    if (unpin.ok) expect(unpin.pinnedCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('perfil, ranking e ajuste', () => {
  it('ordena o ranking por XP e marca o usuário atual', async () => {
    await adjustXp({ tenantId, userId: participantId, amount: 400, reason: 'Carga histórica de teste', actorId: staffId });
    await adjustXp({ tenantId, userId: staffId, amount: 900, reason: 'Carga histórica de teste', actorId: staffId });

    const board = await getLeaderboard(tenantId, { currentUserId: participantId });
    expect(board.ok).toBe(true);
    if (!board.ok) return;

    expect(board.entries[0]?.userId).toBe(staffId);
    expect(board.entries[0]?.position).toBe(1);
    expect(board.entries[1]?.userId).toBe(participantId);
    expect(board.entries[1]?.isCurrentUser).toBe(true);
    expect(board.entries[1]?.totalXp).toBe(400);
  });

  it('calcula a posição no perfil', async () => {
    await adjustXp({ tenantId, userId: staffId, amount: 900, reason: 'Carga histórica de teste', actorId: staffId });
    await adjustXp({ tenantId, userId: participantId, amount: 400, reason: 'Carga histórica de teste', actorId: staffId });

    const profile = await getXpProfile(tenantId, participantId);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    expect(profile.profile.rank).toBe(2);
    expect(profile.profile.rankedCount).toBe(2);
    // 400 XP está entre o piso do nível 3 (250) e o do nível 4 (450).
    expect(profile.profile.progress.level).toBe(3);
    expect(profile.profile.progress.xpIntoLevel).toBe(150);
  });

  it('estorno administrativo derruba o nível', async () => {
    await adjustXp({
      tenantId,
      userId: participantId,
      amount: xpToReachLevel(4),
      reason: 'Crédito inicial de teste',
      actorId: staffId,
    });

    const before = await getXpProfile(tenantId, participantId);
    expect(before.ok && before.profile.progress.level).toBe(4);

    await adjustXp({
      tenantId,
      userId: participantId,
      amount: -xpToReachLevel(4),
      reason: 'Estorno por auditoria',
      actorId: staffId,
    });

    const after = await getXpProfile(tenantId, participantId);
    expect(after.ok && after.profile.progress.level).toBe(1);
    expect(after.ok && after.profile.progress.totalXp).toBe(0);
  });

  it('registra o extrato com saldo após cada lançamento', async () => {
    await adjustXp({ tenantId, userId: participantId, amount: 250, reason: 'Primeiro crédito de teste', actorId: staffId });
    await adjustXp({ tenantId, userId: participantId, amount: -50, reason: 'Estorno parcial de teste', actorId: staffId });

    const history = await listXpHistory(tenantId, participantId);
    expect(history.ok).toBe(true);
    if (!history.ok) return;

    expect(history.entries).toHaveLength(2);
    // Mais recente primeiro.
    expect(history.entries[0]?.amount).toBe(-50);
    expect(history.entries[0]?.balanceAfter).toBe(200);
    expect(history.entries[1]?.amount).toBe(250);
    expect(history.entries[1]?.balanceAfter).toBe(250);
  });

  it('perfil de quem nunca pontuou não inventa XP', async () => {
    const profile = await getXpProfile(tenantId, participantId);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    expect(profile.profile.progress.totalXp).toBe(0);
    expect(profile.profile.progress.level).toBe(1);
    expect(profile.profile.rank).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isolamento entre instituições', () => {
  it('o ranking não vaza participante de outra instituição', async () => {
    await adjustXp({ tenantId, userId: participantId, amount: 300, reason: 'Crédito de teste', actorId: staffId });

    const otherTenantId = randomUUID();
    const outsiderId = randomUUID();

    await adminPrisma.tenant.create({
      data: {
        id: otherTenantId,
        slug: `gamisrv-outro-${RUN}`,
        name: `Outra Instituição ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
      },
    });

    await adminPrisma.user.create({
      data: { id: outsiderId, name: 'Forasteiro', email: `outsider.${RUN}@exemplo.test` },
    });

    await withTenant(otherTenantId, (tx) =>
      tx.userXpProfile.create({
        data: { id: randomUUID(), tenantId: otherTenantId, userId: outsiderId, totalXp: 99_999, level: 50 },
      }),
    );

    try {
      const board = await getLeaderboard(tenantId, {});
      expect(board.ok).toBe(true);
      if (!board.ok) return;

      expect(board.entries.every((entry) => entry.userId !== outsiderId)).toBe(true);
      expect(board.entries[0]?.totalXp).toBe(300);
    } finally {
      await adminPrisma.tenant.delete({ where: { id: otherTenantId } });
      await adminPrisma.user.delete({ where: { id: outsiderId } });
    }
  });
});

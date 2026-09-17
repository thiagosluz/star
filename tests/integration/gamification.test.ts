/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — motor de recompensas
 *
 *  Roda contra o banco REAL, com RLS e a role de runtime. É aqui que se prova o
 *  que um teste unitário não alcança:
 *
 *    • o SQL cru da tiragem de cartas (reserva condicional + ON CONFLICT);
 *    • a idempotência sob o índice único de verdade;
 *    • o crédito atômico no perfil (increment resolvido pelo banco);
 *    • o índice único de progresso de missão com `periodKey` não nulo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  awardForEvent,
  rewardKeys,
  type RewardEventInput,
} from '../../src/lib/gamification/reward-engine';
import { sequenceRandom } from '../../src/lib/gamification/random';
import { PRESTIGE_COST_XP, xpToReachLevel } from '../../src/domain/gamification/xp-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let activityId: string;
let userId: string;
let otherUserId: string;

// Cartas do cenário, criadas por teste conforme a necessidade.
let checkinCardId: string;
let thresholdCardId: string;

/**
 * Sorteio determinístico: sempre a raridade mais provável e a primeira carta.
 *
 * É uma FÁBRICA, não um valor compartilhado: uma sequência única reutilizada por
 * todos os testes se esgota e passa a devolver `0` — que força FOIL. O teste de
 * duplicata passava isolado e falhava na suíte completa por causa disso.
 * Aleatoriedade de teste precisa nascer nova em cada uso.
 */
function deterministicRandom(): () => number {
  return sequenceRandom([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
}

/** Sorteio que FORÇA foil (todo número abaixo da chance de qualquer raridade). */
function foilRandom(): () => number {
  return sequenceRandom([0.5, 0.5, 0.0, 0.5, 0.5, 0.0, 0.5, 0.5]);
}

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: {
      id,
      name,
      email: `gami.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });
  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return id;
}

async function createCard(input: {
  slug: string;
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';
  trigger:
    | 'CHECKIN'
    | 'LEVEL_UP'
    | 'XP_THRESHOLD'
    | 'STREAK'
    | 'ACTIVITY_COMPLETION'
    | 'MINI_COURSE_COMPLETION';
  maxSupply?: number;
  levelRequired?: number;
  triggerCondition?: Record<string, unknown>;
}): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.cardTemplate.create({
      data: {
        id,
        tenantId,
        eventId: null,
        slug: input.slug,
        name: input.slug,
        rarity: input.rarity,
        trigger: input.trigger,
        maxSupply: input.maxSupply ?? 0,
        levelRequired: input.levelRequired ?? 1,
        triggerCondition: input.triggerCondition ?? {},
        palette: { primary: '#123456' },
        art: {},
      },
    }),
  );

  return id;
}

async function createMission(input: {
  slug: string;
  trigger: 'CHECKIN' | 'ACTIVITY_ATTENDANCE' | 'SUBMISSION_SUBMITTED';
  count: number;
  xpReward?: number;
  kind?: 'ONE_OFF' | 'DAILY' | 'WEEKLY' | 'EVENT_LONG' | 'ACHIEVEMENT';
  activityType?: string;
}): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.taskDefinition.create({
      data: {
        id,
        tenantId,
        eventId,
        slug: input.slug,
        name: input.slug,
        kind: input.kind ?? 'ONE_OFF',
        trigger: input.trigger,
        target: { count: input.count, ...(input.activityType ? { activityType: input.activityType } : {}) },
        xpReward: input.xpReward ?? 0,
      },
    }),
  );

  return id;
}

/** Check-in simples, com chave de idempotência própria por registro. */
async function checkin(targetUserId = userId, overrides: Partial<RewardEventInput> = {}) {
  return awardForEvent({
    tenantId,
    userId: targetUserId,
    source: 'CHECKIN',
    idempotencyKey: rewardKeys.checkin(tenantId, randomUUID()),
    eventId,
    activityId,
    random: deterministicRandom(),
    ...overrides,
  });
}

async function readProfile(targetUserId = userId) {
  return withTenant(tenantId, (tx) =>
    tx.userXpProfile.findUnique({
      where: { tenantId_userId: { tenantId, userId: targetUserId } },
      select: {
        totalXp: true,
        seasonXp: true,
        seasonKey: true,
        level: true,
        prestigeLevel: true,
        currentStreak: true,
        longestStreak: true,
        cardsCollected: true,
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
      slug: `gami-${RUN}`,
      name: `Instituição Gamificação ${RUN}`,
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
        slug: 'evento-gami',
        title: 'Evento de Gamificação',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: 'minicurso-gami',
        title: 'Minicurso de Gamificação',
        type: 'MINI_COURSE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        workloadMinutes: 240,
      },
    });
  });

  userId = await createUser('Participante Gami');
  otherUserId = await createUser('Outro Participante');
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

beforeEach(async () => {
  // Cada teste começa com o cenário limpo: sem cartas, missões, XP ou perfis.
  await withTenant(tenantId, async (tx) => {
    await tx.xpTransaction.deleteMany({ where: { tenantId } });
    await tx.userTaskProgress.deleteMany({ where: { tenantId } });
    await tx.userCard.deleteMany({ where: { tenantId } });
    await tx.userXpProfile.deleteMany({ where: { tenantId } });
    await tx.cardTemplate.deleteMany({ where: { tenantId } });
    await tx.taskDefinition.deleteMany({ where: { tenantId } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('crédito de XP', () => {
  it('cria o perfil, lança no livro-razão e grava o saldo', async () => {
    const result = await checkin();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.duplicate).toBe(false);
    expect(result.xpAwarded).toBe(50); // XP_SOURCES.CHECKIN
    expect(result.totalXp).toBe(50);
    expect(result.levelBefore).toBe(1);
    expect(result.levelAfter).toBe(1);

    const profile = await readProfile();
    expect(profile?.totalXp).toBe(50);
    expect(profile?.seasonXp).toBe(50);
    expect(profile?.seasonKey).toMatch(/^\d{4}-Q[1-4]$/);
    expect(profile?.currentStreak).toBe(1);

    const ledger = await withTenant(tenantId, (tx) =>
      tx.xpTransaction.findMany({
        where: { tenantId, userId },
        select: { amount: true, source: true, balanceAfter: true, reason: true },
      }),
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.amount).toBe(50);
    expect(ledger[0]?.source).toBe('CHECKIN');
    // Saldo APÓS o lançamento: auditoria contábil.
    expect(ledger[0]?.balanceAfter).toBe(50);
    expect(ledger[0]?.reason).toContain('CHECKIN');
  });

  it('NÃO credita duas vezes com a mesma chave de idempotência', async () => {
    const key = rewardKeys.checkin(tenantId, 'registro-fixo');

    const first = await awardForEvent({
      tenantId,
      userId,
      source: 'CHECKIN',
      idempotencyKey: key,
      eventId,
      random: deterministicRandom(),
    });

    const second = await awardForEvent({
      tenantId,
      userId,
      source: 'CHECKIN',
      idempotencyKey: key,
      eventId,
      random: deterministicRandom(),
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.xpAwarded).toBe(0);

    const profile = await readProfile();
    expect(profile?.totalXp).toBe(50);

    const count = await withTenant(tenantId, (tx) =>
      tx.xpTransaction.count({ where: { tenantId, userId } }),
    );
    expect(count).toBe(1);
  });

  it('idempotência é POR CHAVE: fatos diferentes creditam separado', async () => {
    await checkin();
    await checkin();

    const profile = await readProfile();
    expect(profile?.totalXp).toBe(100);

    const count = await withTenant(tenantId, (tx) =>
      tx.xpTransaction.count({ where: { tenantId, userId } }),
    );
    expect(count).toBe(2);
  });

  it('sobe de nível ao cruzar o limiar e reporta a transição', async () => {
    // 250 XP = exatamente o necessário para estar no nível 3.
    const result = await awardForEvent({
      tenantId,
      userId,
      source: 'ADMIN_ADJUSTMENT',
      amount: xpToReachLevel(3),
      reason: 'Importação de dados históricos',
      idempotencyKey: rewardKeys.manual(tenantId, userId),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.levelBefore).toBe(1);
    expect(result.levelAfter).toBe(3);
    expect(result.leveledUp).toBe(true);

    const profile = await readProfile();
    expect(profile?.level).toBe(3);
  });

  it('PREstígio é derivado do saldo e sobrevive a ajuste negativo', async () => {
    await awardForEvent({
      tenantId,
      userId,
      source: 'ADMIN_ADJUSTMENT',
      amount: PRESTIGE_COST_XP,
      idempotencyKey: rewardKeys.manual(tenantId, userId),
    });

    let profile = await readProfile();
    expect(profile?.prestigeLevel).toBe(1);
    expect(profile?.level).toBe(1);

    // Um estorno derruba o prestígio: fraude descoberta depois tem consequência.
    await awardForEvent({
      tenantId,
      userId,
      source: 'ADMIN_ADJUSTMENT',
      amount: -PRESTIGE_COST_XP,
      reason: 'Estorno por fraude comprovada',
      idempotencyKey: rewardKeys.manual(tenantId, userId),
    });

    profile = await readProfile();
    expect(profile?.totalXp).toBe(0);
    expect(profile?.prestigeLevel).toBe(0);
    expect(profile?.level).toBe(1);
  });

  it('recusa ajuste administrativo sem valor explícito', async () => {
    const result = await awardForEvent({
      tenantId,
      userId,
      source: 'ADMIN_ADJUSTMENT',
      idempotencyKey: rewardKeys.manual(tenantId, userId),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_AMOUNT');
  });

  it('recusa valor absurdo (erro de unidade)', async () => {
    const result = await awardForEvent({
      tenantId,
      userId,
      source: 'BONUS',
      amount: 10_000_000,
      idempotencyKey: rewardKeys.manual(tenantId, userId),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_AMOUNT');
  });

  it('o bônus de ofensiva é creditado uma vez por dia', async () => {
    // Terceiro dia consecutivo → bônus de 30 XP.
    const day = 86_400_000;
    const now = Date.now();

    for (const offset of [2, 1, 0]) {
      await awardForEvent({
        tenantId,
        userId,
        source: 'CHECKIN',
        idempotencyKey: rewardKeys.checkin(tenantId, `streak-${offset}`),
        occurredAt: new Date(now - offset * day),
        random: deterministicRandom(),
      });
    }

    const profile = await readProfile();
    expect(profile?.currentStreak).toBe(3);
    expect(profile?.longestStreak).toBe(3);
    // 3 check-ins (150) + bônus de 30 no terceiro dia.
    expect(profile?.totalXp).toBe(180);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cartas', () => {
  it('concede a carta do gatilho, reserva a tiragem e conta no álbum', async () => {
    checkinCardId = await createCard({ slug: 'cracha-pioneiro', rarity: 'COMMON', trigger: 'CHECKIN' });

    const result = await checkin();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.slug).toBe('cracha-pioneiro');
    expect(result.cards[0]?.isNew).toBe(true);
    expect(result.cards[0]?.quantity).toBe(1);

    const template = await withTenant(tenantId, (tx) =>
      tx.cardTemplate.findUniqueOrThrow({
        where: { id: checkinCardId },
        select: { mintedCount: true },
      }),
    );
    expect(template.mintedCount).toBe(1);

    const profile = await readProfile();
    expect(profile?.cardsCollected).toBe(1);
  });

  it('a segunda cópia vira duplicata (quantity) e NÃO cria outra linha', async () => {
    await createCard({ slug: 'cracha-pioneiro', rarity: 'COMMON', trigger: 'CHECKIN' });

    await checkin();
    const second = await checkin();

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    console.log(
      'DEBUG cartas:',
      JSON.stringify(
        await withTenant(tenantId, (tx) =>
          tx.userCard.findMany({
            where: { tenantId, userId },
            select: { cardTemplateId: true, isFoil: true, quantity: true },
          }),
        ),
      ),
      'segunda:',
      JSON.stringify(second.cards),
    );

    expect(second.cards[0]?.isNew).toBe(false);
    expect(second.cards[0]?.quantity).toBe(2);

    const cards = await withTenant(tenantId, (tx) =>
      tx.userCard.findMany({ where: { tenantId, userId }, select: { quantity: true } }),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.quantity).toBe(2);

    // Cartas distintas no álbum continuam sendo 1.
    const profile = await readProfile();
    expect(profile?.cardsCollected).toBe(1);
  });

  it('a variante FOIL é uma linha própria no álbum', async () => {
    /**
     * `isFoil` faz parte da chave única: a versão holográfica da mesma carta é um
     * item SEPARADO na coleção. Se fosse a mesma linha, o participante que tirou
     * a foil veria apenas "quantity 2" e não teria como saber que completou a
     * variante rara.
     */
    await createCard({ slug: 'cracha-foil', rarity: 'COMMON', trigger: 'CHECKIN' });

    const normal = await awardForEvent({
      tenantId,
      userId,
      source: 'CHECKIN',
      idempotencyKey: rewardKeys.checkin(tenantId, 'foil-normal'),
      eventId,
      activityId,
      random: deterministicRandom(),
    });

    const foil = await awardForEvent({
      tenantId,
      userId,
      source: 'CHECKIN',
      idempotencyKey: rewardKeys.checkin(tenantId, 'foil-holo'),
      eventId,
      activityId,
      random: foilRandom(),
    });

    expect(normal.ok && foil.ok).toBe(true);
    if (!normal.ok || !foil.ok) return;

    expect(normal.cards[0]?.isFoil).toBe(false);
    expect(foil.cards[0]?.isFoil).toBe(true);
    expect(foil.cards[0]?.isNew).toBe(true);

    const rows = await withTenant(tenantId, (tx) =>
      tx.userCard.findMany({
        where: { tenantId, userId },
        select: { isFoil: true, quantity: true },
        orderBy: { isFoil: 'asc' },
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.isFoil)).toEqual([false, true]);
    // Duas variantes distintas contam como duas cartas no perfil.
    const profile = await readProfile();
    expect(profile?.cardsCollected).toBe(2);
  });

  it('RESPEITA a tiragem limitada sob tentativas repetidas', async () => {
    await createCard({
      slug: 'edicao-limitada',
      rarity: 'LEGENDARY',
      trigger: 'CHECKIN',
      maxSupply: 2,
    });

    const first = await checkin();
    const second = await checkin();
    const third = await checkin();

    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;

    expect(first.cards).toHaveLength(1);
    expect(second.cards).toHaveLength(1);
    // Terceira tentativa: tiragem esgotada. Nenhuma carta, e o XP continua sendo
    // creditado — a escassez da carta não pode punir o participante.
    expect(third.cards).toHaveLength(0);
    expect(third.xpAwarded).toBe(50);

    const template = await withTenant(tenantId, (tx) =>
      tx.cardTemplate.findFirstOrThrow({
        where: { tenantId, slug: 'edicao-limitada' },
        select: { mintedCount: true, maxSupply: true },
      }),
    );
    expect(template.mintedCount).toBe(2);
    expect(template.maxSupply).toBe(2);
  });

  it('não entrega carta acima do nível exigido', async () => {
    await createCard({
      slug: 'selo-de-mestre',
      rarity: 'MYTHIC',
      trigger: 'CHECKIN',
      levelRequired: 20,
    });

    const result = await checkin();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards).toHaveLength(0);

    const cards = await withTenant(tenantId, (tx) =>
      tx.userCard.count({ where: { tenantId, userId } }),
    );
    expect(cards).toBe(0);
  });

  it('carta de subida de nível é concedida ao cruzar o limiar', async () => {
    await createCard({
      slug: 'medalha-de-nivel',
      rarity: 'RARE',
      trigger: 'LEVEL_UP',
      triggerCondition: { level: 3 },
    });

    const result = await awardForEvent({
      tenantId,
      userId,
      source: 'ADMIN_ADJUSTMENT',
      amount: xpToReachLevel(3),
      idempotencyKey: rewardKeys.manual(tenantId, userId),
      random: deterministicRandom(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards.map((card) => card.slug)).toContain('medalha-de-nivel');
  });

  it('carta de LIMIAR de XP só sai ao CRUZAR o limiar (não farma)', async () => {
    thresholdCardId = await createCard({
      slug: 'chave-de-prata',
      rarity: 'EPIC',
      trigger: 'XP_THRESHOLD',
      triggerCondition: { threshold: 120 },
    });

    // 50 → 100 → 150: o limiar de 120 é cruzado no TERCEIRO check-in.
    const first = await checkin();
    const second = await checkin();
    const third = await checkin();

    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;

    expect(first.cards).toHaveLength(0);
    expect(second.cards).toHaveLength(0);
    expect(third.cards.map((card) => card.slug)).toContain('chave-de-prata');

    // Quarto check-in (já acima do limiar): NÃO concede de novo.
    const fourth = await checkin();
    expect(fourth.ok).toBe(true);
    if (!fourth.ok) return;
    expect(fourth.cards).toHaveLength(0);

    const cards = await withTenant(tenantId, (tx) =>
      tx.userCard.count({ where: { tenantId, userId, cardTemplateId: thresholdCardId } }),
    );
    expect(cards).toBe(1);
  });

  it('carta de outro evento não é distribuída neste evento', async () => {
    const otherEventId = randomUUID();
    const cardId = randomUUID();

    await withTenant(tenantId, async (tx) => {
      await tx.event.create({
        data: {
          id: otherEventId,
          tenantId,
          slug: `outro-evento-${RUN}`,
          title: 'Outro evento',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 86_400_000),
          capacity: null,
          confirmedCount: 0,
        },
      });

      await tx.cardTemplate.create({
        data: {
          id: cardId,
          tenantId,
          eventId: otherEventId,
          slug: 'exclusiva-do-outro-evento',
          name: 'Exclusiva',
          rarity: 'COMMON',
          trigger: 'CHECKIN',
        },
      });
    });

    const result = await checkin();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('missões', () => {
  it('avança o progresso, completa no alvo e usa chave de período NÃO nula', async () => {
    const missionId = await createMission({
      slug: 'presenca-tripla',
      trigger: 'CHECKIN',
      count: 3,
      xpReward: 120,
    });

    const first = await checkin();
    const second = await checkin();
    const third = await checkin();

    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;

    expect(first.missions[0]).toMatchObject({ progress: 1, status: 'IN_PROGRESS', completed: false });
    expect(second.missions[0]).toMatchObject({ progress: 2, status: 'IN_PROGRESS' });
    expect(third.missions[0]).toMatchObject({ progress: 3, status: 'COMPLETED', completed: true });

    const rows = await withTenant(tenantId, (tx) =>
      tx.userTaskProgress.findMany({
        where: { tenantId, userId, taskDefinitionId: missionId },
        select: { periodKey: true, progress: true, status: true },
      }),
    );

    // UMA linha, com chave não nula: `null` não colidiria no índice único.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.periodKey).toBe('once');
    expect(rows[0]?.status).toBe('COMPLETED');

    // O XP da missão NÃO é creditado automaticamente: depende do resgate.
    const profile = await readProfile();
    expect(profile?.totalXp).toBe(150);
  });

  it('missão com filtro de tipo de atividade ignora fatos de outro tipo', async () => {
    await createMission({
      slug: 'maratona-de-minicursos',
      trigger: 'ACTIVITY_ATTENDANCE',
      count: 1,
      activityType: 'MINI_COURSE',
    });

    const wrongType = await awardForEvent({
      tenantId,
      userId,
      source: 'ACTIVITY_ATTENDANCE',
      idempotencyKey: rewardKeys.attendance(tenantId, 'registro-palestra'),
      eventId,
      activityType: 'LECTURE',
      random: deterministicRandom(),
    });

    expect(wrongType.ok).toBe(true);
    if (!wrongType.ok) return;
    expect(wrongType.missions).toHaveLength(0);

    const rightType = await awardForEvent({
      tenantId,
      userId,
      source: 'ACTIVITY_ATTENDANCE',
      idempotencyKey: rewardKeys.attendance(tenantId, 'registro-minicurso'),
      eventId,
      activityId,
      activityType: 'MINI_COURSE',
      random: deterministicRandom(),
    });

    expect(rightType.ok).toBe(true);
    if (!rightType.ok) return;
    expect(rightType.missions[0]).toMatchObject({ slug: 'maratona-de-minicursos', completed: true });
  });

  it('missão alcança apenas o participante do fato', async () => {
    await createMission({ slug: 'presenca-tripla', trigger: 'CHECKIN', count: 1 });

    await checkin(otherUserId);

    const mine = await withTenant(tenantId, (tx) =>
      tx.userTaskProgress.count({ where: { tenantId, userId } }),
    );
    const theirs = await withTenant(tenantId, (tx) =>
      tx.userTaskProgress.count({ where: { tenantId, userId: otherUserId } }),
    );

    expect(mine).toBe(0);
    expect(theirs).toBe(1);
  });
});

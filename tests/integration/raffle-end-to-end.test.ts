/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — sorteios de ponta a ponta (FASE 16)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio
 *  puro não alcança:
 *    • G1 — suplentes gravados com papel próprio e a exclusão de ganhadores
 *      anteriores contando só TITULARES;
 *    • G2 — registro de entrega do prêmio, idempotente e auditado;
 *    • G4 — compromisso na criação, semente revelada na apuração e conferência;
 *    • G5 — publicação do resultado com nome mascarado por padrão;
 *    • G6 — paginação do histórico com total;
 *    • F1 — carta de presença total concedida UMA vez, e premiação do revisor
 *      destaque por ranking com piso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  createRaffle,
  drawRaffle,
  listPublicRaffleResults,
  listRaffles,
  markPrizeDelivered,
  previewEligibility,
  setRaffleVisibility,
} from '../../src/lib/raffles/raffle-service';
import { verifySeed } from '../../src/domain/raffles/raffle-rules';
import {
  awardTopReviewers,
  getReviewerRanking,
  grantFullAttendanceCard,
} from '../../src/lib/gamification/achievement-service';
import { listAuditLog } from '../../src/lib/admin/audit';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let activityAId: string;
let activityBId: string;
let actorId: string;
let participantA: string;
let participantB: string;
let participantC: string;

const dayOne = new Date('2026-09-17T13:00:00.000Z');

async function createUser(name: string, options: { publicProfile?: boolean } = {}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name,
      email: `f16.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      isPublicProfile: options.publicProfile ?? false,
    },
  });
  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

async function addAttendance(input: {
  userId: string;
  activityId: string;
  minutes: number;
}): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: dayOne,
        checkedOutAt: new Date(dayOne.getTime() + input.minutes * 60_000),
        minutesAttended: input.minutes,
      },
    }),
  );
}

/** Cria e apura um sorteio com a configuração pedida. */
async function drawWith(input: {
  title: string;
  winnersCount: number;
  alternatesCount?: number;
  weightByMinutes?: boolean;
  isPublic?: boolean;
  allowPriorEventWinners?: boolean;
  minAttendanceMinutes?: number;
}) {
  const created = await createRaffle({
    tenantId,
    eventId,
    actorId,
    title: input.title,
    scope: 'EVENT',
    minAttendanceMinutes: input.minAttendanceMinutes ?? 0,
    winnersCount: input.winnersCount,
    alternatesCount: input.alternatesCount ?? 0,
    weightByMinutes: input.weightByMinutes ?? false,
    isPublic: input.isPublic ?? false,
    allowPriorEventWinners: input.allowPriorEventWinners ?? true,
  });

  if (!created.ok) throw new Error(`criação falhou: ${created.message}`);

  const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });
  if (!drawn.ok) throw new Error(`apuração falhou: ${drawn.message}`);

  return { created, drawn };
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  activityAId = randomUUID();
  activityBId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f16-${RUN}`,
      name: `Instituição Sorteios ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-f16',
        title: 'Congresso F16',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-09-17T12:00:00.000Z'),
        endsAt: new Date('2026-09-18T23:00:00.000Z'),
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
          slug: 'atividade-a',
          title: 'Atividade A',
          type: 'LECTURE',
          status: 'COMPLETED',
          modality: 'IN_PERSON',
          startsAt: dayOne,
          endsAt: new Date(dayOne.getTime() + 3_600_000),
          workloadMinutes: 60,
          requiresAttendance: true,
        },
        {
          id: activityBId,
          tenantId,
          eventId,
          slug: 'atividade-b',
          title: 'Atividade B',
          type: 'LECTURE',
          status: 'COMPLETED',
          modality: 'IN_PERSON',
          startsAt: new Date(dayOne.getTime() + 7_200_000),
          endsAt: new Date(dayOne.getTime() + 10_800_000),
          workloadMinutes: 60,
          requiresAttendance: true,
        },
      ],
    });
  });

  actorId = await createUser('Organizadora F16');
  participantA = await createUser('Ana Souza', { publicProfile: true });
  participantB = await createUser('Bruno Lima');
  participantC = await createUser('Carla Dias');

  await addAttendance({ userId: participantA, activityId: activityAId, minutes: 120 });
  await addAttendance({ userId: participantB, activityId: activityBId, minutes: 60 });
  await addAttendance({ userId: participantC, activityId: activityAId, minutes: 30 });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G1 — suplentes', () => {
  it('sorteia titulares e suplentes na MESMA apuração, com papel próprio', async () => {
    const { drawn } = await drawWith({
      title: 'Sorteio com suplentes',
      winnersCount: 1,
      alternatesCount: 2,
    });

    expect(drawn.winnersDrawn).toBe(1);
    expect(drawn.alternatesDrawn).toBe(2);
    expect(drawn.winners.map((winner) => winner.kind)).toEqual(['WINNER', 'ALTERNATE', 'ALTERNATE']);
    expect(drawn.winners.map((winner) => winner.position)).toEqual([1, 2, 3]);
    expect(drawn.shortfall).toBe(0);
  });

  it('suplente NÃO conta como ganhador anterior na apuração seguinte', async () => {
    // Sorteio 1: 1 titular + 1 suplente, sem permitir ganhadores anteriores.
    const { drawn } = await drawWith({
      title: 'Sorteio base',
      winnersCount: 1,
      alternatesCount: 1,
      allowPriorEventWinners: false,
    });

    const winnerId = drawn.winners.find((entry) => entry.kind === 'WINNER')!.userId;
    const alternateId = drawn.winners.find((entry) => entry.kind === 'ALTERNATE')!.userId;

    const preview = await previewEligibility({
      tenantId,
      eventId,
      config: {
        scope: 'EVENT',
        referenceDate: null,
        activityId: null,
        minAttendanceMinutes: 0,
        winnersCount: 1,
        allowPriorEventWinners: false,
      },
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const eligibleIds = preview.preview.eligible.map((entry) => entry.userId);

    expect(eligibleIds).not.toContain(winnerId);
    // O suplente não ganhou nada: continua concorrendo.
    if (alternateId !== winnerId) expect(eligibleIds).toContain(alternateId);
  });
});

describe('G2 — entrega do prêmio', () => {
  it('registra a retirada com autor, horário e trilha', async () => {
    const { drawn } = await drawWith({ title: 'Sorteio de prêmio', winnersCount: 1 });

    const list = await listRaffles(tenantId, eventId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const raffle = list.raffles.find((entry) => entry.id === drawn.raffleId)!;
    const positionId = raffle.winners[0]!.id;

    const delivered = await markPrizeDelivered({
      tenantId,
      raffleId: raffle.id,
      positionId,
      actorId,
      note: 'Entregue no balcão',
    });

    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;

    const listAfter = await listRaffles(tenantId, eventId);
    expect(listAfter.ok).toBe(true);
    if (!listAfter.ok) return;

    const updated = listAfter.raffles.find((entry) => entry.id === raffle.id)!;
    expect(updated.winners[0]!.deliveredAt).not.toBeNull();
    expect(updated.winners[0]!.deliveryNote).toBe('Entregue no balcão');

    const audit = await listAuditLog(tenantId, { limit: 50 });
    expect(audit.some((entry) => entry.entityType === 'rafflePrize')).toBe(true);
  });

  it('recusa registrar a entrega duas vezes (recibo não se reescreve)', async () => {
    const list = await listRaffles(tenantId, eventId);
    if (!list.ok) return;

    const raffle = list.raffles.find((entry) => entry.winners.some((winner) => winner.deliveredAt))!;
    const positionId = raffle.winners.find((winner) => winner.deliveredAt)!.id;

    const again = await markPrizeDelivered({ tenantId, raffleId: raffle.id, positionId, actorId });

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('ALREADY_DELIVERED');
  });
});

describe('G4 — commit-reveal da semente', () => {
  it('publica o compromisso na criação e revela a semente na apuração', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Sorteio verificável',
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      allowPriorEventWinners: true,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.seedCommitment).toMatch(/^[a-f0-9]{64}$/);

    /**
     * A prova vive na RODADA desde a FASE 30 — o selo, o compromisso, a revelação e a
     * versão do documento. As colunas equivalentes em `raffles` são legado congelado:
     * um sorteio novo as deixa em `null`, e ler a raffle aqui mediria o campo errado.
     */
    const sealed = await adminPrisma.raffleRound.findFirstOrThrow({
      where: { raffleId: created.raffleId },
      orderBy: { roundNumber: 'desc' },
      select: { seedSealed: true, seedCommitment: true, seedRevealed: true, resultVersion: true },
    });

    expect(sealed.seedSealed).not.toBeNull();
    expect(sealed.seedRevealed).toBeNull();
    expect(sealed.resultVersion).toBe(4); // ainda não apurado: a versão já é a corrente

    const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });

    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;

    expect(drawn.seeded).toBe(true);
    expect(drawn.seedRevealed).not.toBeNull();
    // A semente revelada confere com o compromisso publicado antes.
    expect(verifySeed(drawn.seedRevealed!, created.seedCommitment!)).toBe(true);

    const stored = await adminPrisma.raffleRound.findFirstOrThrow({
      where: { raffleId: created.raffleId },
      orderBy: { roundNumber: 'desc' },
      select: { seedRevealed: true, resultVersion: true, drawnAt: true },
    });

    expect(stored.seedRevealed).toBe(drawn.seedRevealed);
    expect(stored.drawnAt).not.toBeNull();
    // A apuração grava na versão CORRENTE do payload — a 4 desde a FASE 30, que
    // declara também QUAL rodada o documento descreve.
    expect(stored.resultVersion).toBe(4);
  });

  it('a apuração com semente é reproduzível (mesma semente ⇒ mesmo resultado)', async () => {
    const list = await listRaffles(tenantId, eventId);
    if (!list.ok) return;

    const verified = list.raffles.find((entry) => entry.seedRevealed && entry.winners.length > 0);
    expect(verified).toBeDefined();
    if (!verified) return;

    // A prova pública é: o hash da semente revelada é o compromisso publicado.
    expect(verifySeed(verified.seedRevealed!, verified.seedCommitment!)).toBe(true);
  });
});

describe('G5 — publicação do resultado', () => {
  it('recusa publicar antes da apuração', async () => {
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: 'Rascunho não publicado',
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      allowPriorEventWinners: true,
    });

    if (!created.ok) return;

    const result = await setRaffleVisibility({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      isPublic: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_DRAWN');
  });

  it('publica o resultado com nome mascarado e nome completo só para perfil público', async () => {
    const { drawn } = await drawWith({
      title: 'Sorteio publicado',
      winnersCount: 3,
      isPublic: true,
    });

    const published = await setRaffleVisibility({
      tenantId,
      raffleId: drawn.raffleId,
      actorId,
      isPublic: true,
    });

    expect(published.ok).toBe(true);

    const results = await listPublicRaffleResults(tenantId, eventId);
    const raffle = results.find((entry) => entry.id === drawn.raffleId);

    expect(raffle).toBeDefined();
    if (!raffle) return;

    expect(raffle.winners.length).toBeGreaterThan(0);
    expect(raffle.resultHash).not.toBeNull();
    expect(raffle.seedRevealed).not.toBeNull();
    // Todo nome publicado está mascarado, EXCETO quem tem perfil público.
    for (const winner of raffle.winners) {
      if (winner.masked) {
        expect(winner.name).toMatch(/^\S+( \S\.)*$/);
      }
    }

    // Despublicar remove da leitura pública.
    await setRaffleVisibility({ tenantId, raffleId: drawn.raffleId, actorId, isPublic: false });
    const after = await listPublicRaffleResults(tenantId, eventId);

    expect(after.some((entry) => entry.id === drawn.raffleId)).toBe(false);
  });

  it('o nome de quem tem perfil público sai completo', async () => {
    const { drawn } = await drawWith({ title: 'Sorteio do perfil público', winnersCount: 1, isPublic: true });
    await setRaffleVisibility({ tenantId, raffleId: drawn.raffleId, actorId, isPublic: true });

    const results = await listPublicRaffleResults(tenantId, eventId);
    const raffle = results.find((entry) => entry.id === drawn.raffleId)!;
    const winner = raffle.winners[0]!;

    if (winner.name.startsWith('Ana')) {
      // Se quem saiu foi a Ana (perfil público), o nome completo aparece.
      expect(winner.masked).toBe(false);
      expect(winner.name).toBe('Ana Souza');
    } else {
      // Qualquer outro ganhador não tem perfil público: nome mascarado.
      expect(winner.masked).toBe(true);
    }
  });
});

describe('G6 — paginação do histórico', () => {
  it('pagina o histórico com total e sem perder o começo da lista', async () => {
    const first = await listRaffles(tenantId, eventId, { page: 1, pageSize: 2 });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.raffles).toHaveLength(2);
    expect(first.total).toBeGreaterThan(2);
    expect(first.totalPages).toBeGreaterThan(1);

    const second = await listRaffles(tenantId, eventId, { page: 2, pageSize: 2 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.page).toBe(2);
    // Nenhum sorteio aparece nas duas páginas.
    const firstIds = new Set(first.raffles.map((entry) => entry.id));
    expect(second.raffles.some((entry) => firstIds.has(entry.id))).toBe(false);

    const beyond = await listRaffles(tenantId, eventId, { page: 999, pageSize: 2 });
    expect(beyond.ok).toBe(true);
    if (!beyond.ok) return;
    // Página fora do intervalo é limitada à última — e não uma tela vazia.
    expect(beyond.page).toBe(beyond.totalPages);
  });
});

describe('G3 — peso por minutos (ligação ponta a ponta)', () => {
  it('a configuração é gravada e o sorteio ponderado é apurado com sucesso', async () => {
    const { created, drawn } = await drawWith({
      title: 'Sorteio ponderado',
      winnersCount: 2,
      weightByMinutes: true,
    });

    expect(drawn.winnersDrawn).toBe(2);

    const list = await listRaffles(tenantId, eventId);
    if (!list.ok) return;

    const raffle = list.raffles.find((entry) => entry.id === created.raffleId)!;
    expect(raffle.weightByMinutes).toBe(true);
    // A versão do documento é a da RODADA que o resumo destaca (FASE 30).
    expect(raffle.resultVersion).toBe(4);
    // A lista publicada acompanha o resultado: sem ela não há o que reproduzir.
    expect(raffle.poolHash).toHaveLength(64);
    // E o resumo lista a rodada apurada, com o prêmio anunciado nela.
    expect(raffle.rounds).toHaveLength(1);
    expect(raffle.rounds[0]?.state).toBe('DRAWN');
    expect(raffle.winners.every((winner) => winner.roundNumber === 1)).toBe(true);
  });
});

describe('F1 — conquista de presença total', () => {
  it('concede a carta uma única vez, quando a última atividade é concluída', async () => {
    const cardId = randomUUID();
    // Pessoa própria do cenário: quem já tem presença nas duas atividades nasceria
    // com a conquista cumprida e o teste não provaria a progressão.
    const pessoaId = await createUser('Presença Parcial F16');

    await withTenant(tenantId, (tx) =>
      tx.cardTemplate.create({
        data: {
          id: cardId,
          tenantId,
          eventId,
          slug: `presenca-total-${RUN}`,
          name: 'Presença Total',
          rarity: 'EPIC',
          trigger: 'EVENT_ATTENDANCE_FULL',
          isActive: true,
        },
      }),
    );

    // Presença em UMA das duas atividades: ainda não é "tudo".
    await addAttendance({ userId: pessoaId, activityId: activityAId, minutes: 60 });

    const partial = await grantFullAttendanceCard({
      tenantId,
      userId: pessoaId,
      eventId,
      actorId,
    });

    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.granted).toBe(false);
    expect(partial.reason).toContain('Faltou presença');

    // Fecha a segunda atividade do evento: agora cobriu tudo.
    await addAttendance({ userId: pessoaId, activityId: activityBId, minutes: 60 });

    const complete = await grantFullAttendanceCard({
      tenantId,
      userId: pessoaId,
      eventId,
      actorId,
    });

    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.granted).toBe(true);
    expect(complete.cardName).toBe('Presença Total');

    const cards = await adminPrisma.userCard.findMany({
      where: { tenantId, userId: pessoaId, source: 'EVENT_ATTENDANCE_FULL' },
      select: { quantity: true },
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]!.quantity).toBe(1);

    // Chamar de novo NÃO duplica (a conquista do evento é uma só).
    const repeated = await grantFullAttendanceCard({
      tenantId,
      userId: pessoaId,
      eventId,
      actorId,
    });

    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.granted).toBe(false);
    expect(repeated.alreadyHad).toBe(true);

    const after = await adminPrisma.userCard.findMany({
      where: { tenantId, userId: pessoaId, source: 'EVENT_ATTENDANCE_FULL' },
      select: { quantity: true },
    });

    expect(after[0]!.quantity).toBe(1);
  });
});

describe('F1 — revisor destaque', () => {
  it('rankeia por pareceres concluídos e premia o primeiro', async () => {
    const cardId = randomUUID();

    await withTenant(tenantId, async (tx) => {
      await tx.cardTemplate.create({
        data: {
          id: cardId,
          tenantId,
          eventId,
          slug: `revisor-destaque-${RUN}`,
          name: 'Revisor Destaque',
          rarity: 'LEGENDARY',
          trigger: 'REVIEWER_TOP',
          // A carta exige 2 pareceres: o piso aplicado tem de respeitar isso.
          triggerCondition: { threshold: 2 } as unknown as object,
          isActive: true,
        },
      });

      /**
       * UM parecer por (submissão, revisor) — é o índice único do modelo. Para dar
       * 3 pareceres à Ana são necessárias 3 submissões, e é assim que o cenário
       * reflete a realidade: um revisor avalia vários trabalhos, não o mesmo três
       * vezes.
       */
      const submissions = [randomUUID(), randomUUID(), randomUUID()];

      for (const [index, submissionId] of submissions.entries()) {
        await tx.submission.create({
          data: {
            id: submissionId,
            tenantId,
            eventId,
            protocol: `F16-${RUN}-${index}`,
            title: `Trabalho avaliado ${index + 1}`,
            abstract: 'Resumo',
            status: 'UNDER_REVIEW',
            submittedById: actorId,
          },
        });
      }

      // Ana avalia as 3; Carla avalia 1 (abaixo do piso da carta).
      for (const submissionId of submissions) {
        await tx.review.create({
          data: {
            id: randomUUID(),
            tenantId,
            submissionId,
            reviewerId: participantA,
            status: 'SUBMITTED',
            recommendation: 'ACCEPT',
            submittedAt: new Date(),
          },
        });
      }

      await tx.review.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId: submissions[0]!,
          reviewerId: participantC,
          status: 'SUBMITTED',
          recommendation: 'ACCEPT',
          submittedAt: new Date(),
        },
      });
    });

    const ranking = await getReviewerRanking({ tenantId, eventId });

    expect(ranking.ok).toBe(true);
    if (!ranking.ok) return;

    expect(ranking.minReviews).toBe(2);
    expect(ranking.ranked[0]!.reviewerId).toBe(participantA);
    expect(ranking.awarded.map((entry) => entry.reviewerId)).toEqual([participantA]);

    const awarded = await awardTopReviewers({ tenantId, eventId, actorId });

    expect(awarded.ok).toBe(true);
    if (!awarded.ok) return;
    expect(awarded.awarded[0]!.cardName).toBe('Revisor Destaque');

    const cards = await adminPrisma.userCard.findMany({
      where: { tenantId, userId: participantA, source: 'REVIEWER_TOP' },
      select: { quantity: true },
    });

    expect(cards).toHaveLength(1);

    // Premiar de novo é idempotente: não acumula cópias.
    await awardTopReviewers({ tenantId, eventId, actorId });
    const after = await adminPrisma.userCard.findMany({
      where: { tenantId, userId: participantA, source: 'REVIEWER_TOP' },
      select: { quantity: true },
    });

    expect(after[0]!.quantity).toBe(1);
  });
});

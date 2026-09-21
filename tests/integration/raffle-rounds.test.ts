/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — sorteio ao vivo em RODADAS (FASE 30)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio puro
 *  não alcança:
 *    • a rodada 1 nasce com o sorteio, com compromisso próprio e a semente selada;
 *    • cada rodada tem a SUA semente — revelar a primeira não entrega a segunda;
 *    • as POSIÇÕES continuam entre as rodadas (a entrega do prêmio é por posição);
 *    • quem ganhou uma rodada NÃO aparece na lista da seguinte;
 *    • a auditoria confere rodada a rodada, cada uma com o seu resultado assinado;
 *    • o telão anuncia a rodada preparada e revela a apurada — a assinatura do ao
 *      vivo muda por RODADA, não pelo status do sorteio (que fica `DRAWN`);
 *    • o prêmio e o patrocinador são anúncio: ficam na rodada e NÃO entram no hash.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  cancelRaffle,
  createRaffle,
  drawRound,
  getRaffleAudit,
  getRaffleLiveState,
  getRaffleStageView,
  listRaffles,
  prepareRound,
} from '../../src/lib/raffles/raffle-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const day = new Date('2026-09-21T13:00:00.000Z');

let tenantId: string;
let eventId: string;
let actorId: string;
let sponsorId: string;
const presentIds: string[] = [];

async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f30.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

/** Um sorteio com a rodada 1 preparada (o caminho de "Criar para o palco"). */
async function createPrepared(input: {
  title: string;
  prizeTitle?: string;
  sponsorId?: string | null;
  winnersCount?: number;
}) {
  const created = await createRaffle({
    tenantId,
    eventId,
    actorId,
    title: input.title,
    scope: 'EVENT',
    minAttendanceMinutes: 0,
    winnersCount: input.winnersCount ?? 1,
    alternatesCount: 0,
    weightByMinutes: false,
    isPublic: false,
    allowPriorEventWinners: true,
    prizeTitle: input.prizeTitle ?? null,
    sponsorId: input.sponsorId ?? null,
  });

  if (!created.ok) throw new Error(`criação falhou: ${created.message}`);

  return created;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f30-${RUN}`,
      name: `Instituição Rodadas ${RUN}`,
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
        slug: 'evento-f30',
        title: 'Congresso F30',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-09-21T12:00:00.000Z'),
        endsAt: new Date('2026-09-22T23:00:00.000Z'),
        timezone: TIME_ZONE,
        capacity: null,
        confirmedCount: 0,
      },
    });

    const sponsor = await tx.sponsor.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        name: `Loja Parceira ${RUN}`,
        slug: `loja-${RUN}`,
        description: 'Patrocinadora do primeiro brinde',
        isActive: true,
        displayOrder: 0,
      },
      select: { id: true },
    });

    sponsorId = sponsor.id;
  });

  actorId = await createUser('Organizadora das Rodadas');

  // Seis presentes: dá para uma rodada de 2 titulares e outra de 2 sem repetir gente.
  for (let index = 0; index < 6; index += 1) {
    const userId = await createUser(`Presente Rodada ${index}`);
    presentIds.push(userId);

    await withTenant(tenantId, (tx) =>
      tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId,
          status: 'PRESENT',
          source: 'MANUAL_STAFF',
          checkedInAt: day,
          checkedOutAt: new Date(day.getTime() + 60 * 60_000),
          minutesAttended: 60,
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
describe('a rodada 1 nasce com o sorteio', () => {
  it('cria a rodada preparada, com compromisso próprio, prêmio e patrocinador', async () => {
    const created = await createPrepared({
      title: `Estreia F30 ${RUN}`,
      prizeTitle: 'Fone bluetooth',
      sponsorId,
    });

    const round = await withTenant(tenantId, (tx) =>
      tx.raffleRound.findFirstOrThrow({
        where: { raffleId: created.raffleId },
        select: {
          id: true,
          roundNumber: true,
          prizeTitle: true,
          sponsorId: true,
          seedCommitment: true,
          seedSealed: true,
          seedRevealed: true,
          resultVersion: true,
          drawnAt: true,
          winnersCount: true,
        },
      }),
    );

    expect(created.roundId).toBe(round.id);
    expect(created.seedCommitment).toBe(round.seedCommitment);
    expect(round.roundNumber).toBe(1);
    expect(round.prizeTitle).toBe('Fone bluetooth');
    expect(round.sponsorId).toBe(sponsorId);
    expect(round.seedCommitment).toMatch(/^[a-f0-9]{64}$/);
    expect(round.seedSealed).not.toBeNull();
    expect(round.seedRevealed).toBeNull();
    expect(round.drawnAt).toBeNull();
    expect(round.resultVersion).toBe(4);

    /**
     * As colunas de semente do SORTEIO ficam CONGELADAS (legado): um sorteio novo não
     * escreve nelas. Se voltassem a ser escritas, existiriam duas fontes de verdade —
     * e a rodada 2 sobrescreveria o que a auditoria lê da rodada 1.
     */
    const raffle = await withTenant(tenantId, (tx) =>
      tx.raffle.findUniqueOrThrow({
        where: { id: created.raffleId },
        select: { seedCommitment: true, seedSealed: true, poolSnapshot: true, resultHash: true },
      }),
    );

    expect(raffle.seedCommitment).toBeNull();
    expect(raffle.seedSealed).toBeNull();
    expect(raffle.poolSnapshot).toBeNull();
    expect(raffle.resultHash).toBeNull();
  });

  it('a trilha registra a criação da RODADA com o compromisso (procedência da prova)', async () => {
    const created = await createPrepared({ title: `Procedência F30 ${RUN}`, prizeTitle: 'Caneca' });

    const entry = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { entityType: 'raffleRound', entityId: created.roundId, action: 'CREATE' },
        select: { changes: true, userId: true },
      }),
    );

    expect(entry).not.toBeNull();
    expect(JSON.stringify(entry?.changes)).toMatch(/seedCommitment/);
    expect(entry?.userId).toBe(actorId);
  });
});

describe('preparar a próxima rodada', () => {
  it('recusa preparar enquanto a rodada anterior não foi apurada', async () => {
    const created = await createPrepared({ title: `Ordem F30 ${RUN}` });

    const again = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      prizeTitle: 'Segundo brinde',
    });

    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('PENDING_ROUND');
      expect(again.message).toContain('rodada 1');
    }
  });

  it('depois de apurada, cria a rodada 2 com semente NOVA e o prêmio anunciado', async () => {
    const created = await createPrepared({ title: `Segunda F30 ${RUN}`, prizeTitle: 'Primeiro brinde' });

    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    expect(first.ok).toBe(true);

    const second = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      prizeTitle: 'Vale-presente',
      prizeDescription: 'Uma unidade, no balcão',
      sponsorId,
      winnersCount: 2,
    });

    if (!second.ok) throw new Error(second.message);

    expect(second.roundNumber).toBe(2);
    // Semente NOVA: revelar a da rodada 1 não pode entregar a da rodada 2.
    expect(second.seedCommitment).not.toBe(first.ok ? first.seedCommitment : null);

    const round = await withTenant(tenantId, (tx) =>
      tx.raffleRound.findUniqueOrThrow({
        where: { id: second.roundId },
        select: {
          roundNumber: true,
          prizeTitle: true,
          prizeDescription: true,
          sponsorId: true,
          winnersCount: true,
          seedRevealed: true,
        },
      }),
    );

    expect(round.roundNumber).toBe(2);
    expect(round.prizeTitle).toBe('Vale-presente');
    expect(round.prizeDescription).toBe('Uma unidade, no balcão');
    expect(round.sponsorId).toBe(sponsorId);
    expect(round.winnersCount).toBe(2);
    expect(round.seedRevealed).toBeNull();
  });

  it('recusa patrocinador de outro evento', async () => {
    const created = await createPrepared({ title: `Patrocínio F30 ${RUN}` });
    await drawRound({ tenantId, raffleId: created.raffleId, actorId });

    const result = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      sponsorId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('recusa preparar rodada em sorteio cancelado', async () => {
    const created = await createPrepared({ title: `Cancelado F30 ${RUN}` });

    await cancelRaffle({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      reason: 'Sorteio cancelado para o teste de guarda.',
    });

    const result = await prepareRound({ tenantId, raffleId: created.raffleId, actorId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CANCELED');
  });
});

describe('apurar em momentos separados', () => {
  it('as posições CONTINUAM entre as rodadas e ninguém ganha duas vezes', async () => {
    const created = await createPrepared({
      title: `Dois momentos F30 ${RUN}`,
      prizeTitle: 'Primeiro brinde',
      winnersCount: 2,
    });

    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!first.ok) throw new Error(first.message);

    expect(first.roundNumber).toBe(1);
    expect(first.firstPosition).toBe(1);
    expect(first.winners.map((winner) => winner.position)).toEqual([1, 2]);

    const prepared = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      prizeTitle: 'Segundo brinde',
      winnersCount: 2,
    });

    if (!prepared.ok) throw new Error(prepared.message);

    const second = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!second.ok) throw new Error(second.message);

    expect(second.roundNumber).toBe(2);
    // A segunda rodada NÃO recomeça em 1º: a entrega do prêmio é por POSIÇÃO no sorteio.
    expect(second.firstPosition).toBe(3);
    expect(second.winners.map((winner) => winner.position)).toEqual([3, 4]);

    const idsPrimeira = first.winners.map((winner) => winner.userId);
    const idsSegunda = second.winners.map((winner) => winner.userId);

    // Ninguém que ganhou o primeiro brinde leva o segundo.
    expect(idsSegunda.some((id) => idsPrimeira.includes(id))).toBe(false);
    expect(second.eligibleCount).toBe(presentIds.length - idsPrimeira.length);
  });

  it('o documento assinado de cada rodada é diferente e declara o momento', async () => {
    const created = await createPrepared({ title: `Documentos F30 ${RUN}` });
    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!first.ok) throw new Error(first.message);

    const prepared = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      prizeTitle: 'Segundo',
    });
    if (!prepared.ok) throw new Error(prepared.message);

    const second = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!second.ok) throw new Error(second.message);

    expect(second.resultHash).not.toBe(first.resultHash);
    // O sorteio continua `DRAWN`: o que muda a cada momento é a RODADA.
    expect(second.roundNumber).toBe(2);
    expect(second.eligibleCount).toBe(presentIds.length - 1);
  });

  it('BLOQUEIA a rodada quando todos os elegíveis já ganharam', async () => {
    const created = await createPrepared({
      title: `Sem elegíveis F30 ${RUN}`,
      winnersCount: presentIds.length,
    });

    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!first.ok) throw new Error(first.message);

    const prepared = await prepareRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!prepared.ok) throw new Error(prepared.message);

    const second = await drawRound({ tenantId, raffleId: created.raffleId, actorId });

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('NO_ELIGIBLE');
      // A rodada continua preparada, aguardando — nada foi gravado.
      const round = await withTenant(tenantId, (tx) =>
        tx.raffleRound.findUniqueOrThrow({
          where: { id: prepared.roundId },
          select: { drawnAt: true, seedRevealed: true },
        }),
      );
      expect(round.drawnAt).toBeNull();
      expect(round.seedRevealed).toBeNull();
    }
  });
});

describe('a auditoria confere RODADA a RODADA', () => {
  it('cada rodada tem o seu compromisso, a sua lista e a sua reprodução', async () => {
    const created = await createPrepared({
      title: `Auditoria F30 ${RUN}`,
      prizeTitle: 'Primeiro brinde',
      sponsorId,
    });

    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!first.ok) throw new Error(first.message);

    const prepared = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      prizeTitle: 'Segundo brinde',
    });
    if (!prepared.ok) throw new Error(prepared.message);

    const second = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!second.ok) throw new Error(second.message);

    const audit = await getRaffleAudit({ tenantId, eventId, raffleId: created.raffleId });
    expect(audit).not.toBeNull();
    expect(audit!.rounds).toHaveLength(2);

    const [primeira, segunda] = audit!.rounds;

    expect(primeira!.roundNumber).toBe(1);
    expect(segunda!.roundNumber).toBe(2);
    expect(primeira!.prizeTitle).toBe('Primeiro brinde');
    expect(segunda!.prizeTitle).toBe('Segundo brinde');
    expect(primeira!.sponsorName).toContain('Loja Parceira');

    for (const round of audit!.rounds) {
      expect(round.reproduction.possible).toBe(true);
      expect(round.reproduction.confirmed).toBe(true);
      expect(round.resultVersion).toBe(4);
      expect(round.poolCount).toBeGreaterThan(0);
      // A procedência do compromisso: data e autor vêm do registro CREATE da rodada.
      expect(round.commitmentRecordedAt).not.toBeNull();
      expect(round.commitmentRecordedBy).toBe('Organizadora das Rodadas');
    }

    // As sementes são DIFERENTES: revelar uma não entrega a outra.
    expect(primeira!.seedRevealed).not.toBe(segunda!.seedRevealed);
    expect(primeira!.resultHash).not.toBe(segunda!.resultHash);

    // E cada ganhador pertence à sua rodada.
    expect(primeira!.winners.map((winner) => winner.position)).toEqual([1]);
    expect(segunda!.winners.map((winner) => winner.position)).toEqual([2]);
  });
});

describe('o telão acompanha a RODADA', () => {
  it('anuncia a rodada preparada e traz as anteriores como já sorteadas', async () => {
    const created = await createPrepared({
      title: `Palco F30 ${RUN}`,
      prizeTitle: 'Primeiro brinde',
      winnersCount: 1,
    });

    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!first.ok) throw new Error(first.message);

    const prepared = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      prizeTitle: 'Segundo brinde',
      sponsorId,
    });
    if (!prepared.ok) throw new Error(prepared.message);

    const stage = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });

    expect(stage).not.toBeNull();
    /**
     * O sorteio está `DRAWN` no banco (a rodada 1 foi apurada) — e mesmo assim a parede
     * anuncia o PRÓXIMO prêmio. Ler o status do sorteio faria o telão exibir o
     * resultado anterior enquanto a rodada 2 espera.
     */
    expect(stage!.state).toBe('AGUARDANDO');
    expect(stage!.currentRound?.roundNumber).toBe(2);
    expect(stage!.currentRound?.prizeTitle).toBe('Segundo brinde');
    expect(stage!.currentRound?.seedCommitment).toBe(prepared.seedCommitment);
    // Rodada pendente não tem lista publicada: a roleta NÃO tem nomes reais para passar.
    expect(stage!.currentRound?.rollNames).toEqual([]);
    expect(stage!.previousRounds).toHaveLength(1);
    expect(stage!.previousRounds[0]!.roundNumber).toBe(1);
    expect(stage!.previousRounds[0]!.winners).toHaveLength(1);
  });

  it('depois da apuração, revela a rodada com os nomes da lista publicada', async () => {
    const created = await createPrepared({ title: `Palco revelado F30 ${RUN}`, winnersCount: 1 });
    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!first.ok) throw new Error(first.message);

    const prepared = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      prizeTitle: 'Segundo brinde',
    });
    if (!prepared.ok) throw new Error(prepared.message);

    const second = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!second.ok) throw new Error(second.message);

    const stage = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });

    expect(stage!.state).toBe('REVELADO');
    expect(stage!.currentRound?.roundNumber).toBe(2);
    expect(stage!.currentRound?.resultHash).toBe(second.resultHash);
    expect(stage!.currentRound?.winners).toHaveLength(1);
    // A roleta usa a LISTA PUBLICADA daquela rodada — gente que concorreu de verdade.
    expect(stage!.currentRound!.rollNames.length).toBeGreaterThan(0);
    expect(stage!.currentRound!.rollNames).toContain(stage!.currentRound!.winners[0]!.name);
    expect(stage!.previousRounds.map((round) => round.roundNumber)).toEqual([1]);
  });

  it('a assinatura do ao vivo muda por RODADA (o status do sorteio não basta)', async () => {
    const created = await createPrepared({ title: `Ao vivo F30 ${RUN}` });

    const antes = await getRaffleLiveState({ tenantId, eventId, raffleId: created.raffleId });
    expect(antes!.status).toBe('DRAFT');
    expect(antes!.pendingRound?.roundNumber).toBe(1);
    expect(antes!.lastDrawnRound).toBeNull();

    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!first.ok) throw new Error(first.message);

    const depois = await getRaffleLiveState({ tenantId, eventId, raffleId: created.raffleId });
    expect(depois!.status).toBe('DRAWN');
    expect(depois!.pendingRound).toBeNull();
    expect(depois!.lastDrawnRound?.roundNumber).toBe(1);

    const prepared = await prepareRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!prepared.ok) throw new Error(prepared.message);

    const comPendente = await getRaffleLiveState({ tenantId, eventId, raffleId: created.raffleId });

    /**
     * Aqui está o defeito que a assinatura por rodada fecha: o status continua `DRAWN`,
     * então um fluxo que só olhasse o status pararia de amostrar e a parede nunca
     * saberia da rodada 2.
     */
    expect(comPendente!.status).toBe('DRAWN');
    expect(comPendente!.pendingRound?.roundNumber).toBe(2);
    expect(comPendente!.lastDrawnRound?.roundNumber).toBe(1);
  });
});

describe('o resumo do histórico expõe as rodadas', () => {
  it('lista as rodadas, e cada posição aponta para a sua', async () => {
    const created = await createPrepared({ title: `Resumo F30 ${RUN}`, winnersCount: 1 });
    const first = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!first.ok) throw new Error(first.message);

    const prepared = await prepareRound({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      prizeTitle: 'Segundo brinde',
    });
    if (!prepared.ok) throw new Error(prepared.message);

    const second = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!second.ok) throw new Error(second.message);

    const list = await listRaffles(tenantId, eventId, { pageSize: 50 });
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const raffle = list.raffles.find((entry) => entry.id === created.raffleId);
    expect(raffle).toBeDefined();

    expect(raffle!.rounds).toHaveLength(2);
    expect(raffle!.rounds.map((round) => round.state)).toEqual(['DRAWN', 'DRAWN']);
    expect(raffle!.rounds[1]!.prizeTitle).toBe('Segundo brinde');
    expect(raffle!.rounds.every((round) => round.resultHash !== null)).toBe(true);

    // O cabeçalho usa a ÚLTIMA rodada apurada: é o número que o público viu por último.
    expect(raffle!.resultHash).toBe(second.resultHash);
    expect(raffle!.resultVersion).toBe(4);

    // Cada posição sabe de que rodada veio — é o que a entrega do prêmio usa.
    expect(raffle!.winners.map((winner) => winner.roundNumber)).toEqual([1, 2]);
    expect(raffle!.winners.map((winner) => winner.position)).toEqual([1, 2]);
  });
});

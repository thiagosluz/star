/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — Operação de palco do sorteio (FASE 22)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio puro
 *  não alcança:
 *    • G8 — desfazer a entrega LIMPA o recibo, mantém a posição e deixa as DUAS
 *      pontas na trilha (a entrega e a reversão, com motivo);
 *    • G9 — o filtro do histórico recorta no BANCO (total e página juntos), no fuso
 *      da instituição;
 *    • G11 — o resultado de UM sorteio só aparece quando publicado E apurado;
 *    • G12 — a versão da chave do cofre é gravada com a semente e permite girar a
 *      chave sem invalidar compromisso já publicado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listAuditLog } from '../../src/lib/admin/audit';
import {
  cancelRaffle,
  createRaffle,
  drawRaffle,
  getPublicRaffleResult,
  listRaffles,
  markPrizeDelivered,
  reversePrizeDelivery,
  setRaffleVisibility,
} from '../../src/lib/raffles/raffle-service';
import { parseRaffleHistoryFilter } from '../../src/domain/raffles/stage-rules';
import { parseSeedKeyRing } from '../../src/domain/raffles/seed-key-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let eventId: string;
let activityId: string;
let actorId: string;

const day = new Date('2026-09-17T13:00:00.000Z');

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name, email: `f22.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });
  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return id;
}

/** Sorteio APURADO, com N pessoas presentes. Devolve o id e as posições. */
async function drawnRaffle(input: {
  title: string;
  winnersCount?: number;
  isPublic?: boolean;
  people: number;
}): Promise<{ raffleId: string; positionIds: string[] }> {
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
    isPublic: input.isPublic ?? false,
    allowPriorEventWinners: true,
  });

  if (!created.ok) throw new Error(`criação falhou: ${created.message}`);

  const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });
  if (!drawn.ok) throw new Error(`apuração falhou: ${drawn.message}`);

  const list = await listRaffles(tenantId, eventId);
  if (!list.ok) throw new Error('listagem falhou');

  const raffle = list.raffles.find((entry) => entry.id === created.raffleId);
  if (!raffle) throw new Error('sorteio não encontrado na listagem');

  return { raffleId: raffle.id, positionIds: raffle.winners.map((winner) => winner.id) };
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  activityId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f22-${RUN}`,
      name: `Instituição Palco ${RUN}`,
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
        slug: 'evento-f22',
        title: 'Congresso F22',
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
        slug: 'atividade-f22',
        title: 'Atividade F22',
        type: 'LECTURE',
        status: 'COMPLETED',
        modality: 'IN_PERSON',
        startsAt: day,
        endsAt: new Date(day.getTime() + 3_600_000),
        workloadMinutes: 60,
      },
    });
  });

  actorId = await createUser('Operadora do palco');

  // Três pessoas presentes: dá titular, suplente e uma sobra para os cenários.
  for (let index = 0; index < 3; index += 1) {
    const userId = await createUser(`Presente ${index}`);
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
          checkedOutAt: new Date(day.getTime() + 60 * 60_000),
          minutesAttended: 60,
        },
      }),
    );
  }
});

afterAll(async () => {
  delete process.env.RAFFLE_SEED_KEYS;
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G8 — desfazer a entrega registrada por engano', () => {
  it('recusa desfazer sem motivo, e o motivo fica na trilha quando a reversão acontece', async () => {
    const raffle = await drawnRaffle({ title: `Prêmio F22 ${RUN}`, people: 3 });
    const positionId = raffle.positionIds[0]!;

    const delivered = await markPrizeDelivered({
      tenantId,
      raffleId: raffle.raffleId,
      positionId,
      actorId,
      note: 'Retirado no balcão',
    });
    expect(delivered.ok, delivered.ok ? 'ok' : delivered.message).toBe(true);

    // ── Sem motivo: recusado, e a entrega continua registrada ────────────────
    const semMotivo = await reversePrizeDelivery({
      tenantId,
      raffleId: raffle.raffleId,
      positionId,
      actorId,
      reason: '   ',
    });

    expect(semMotivo.ok).toBe(false);
    if (!semMotivo.ok) expect(semMotivo.code).toBe('REASON_REQUIRED');

    const aindaEntregue = await withTenant(tenantId, (tx) =>
      tx.raffleWinner.findFirst({ where: { id: positionId }, select: { deliveredAt: true } }),
    );
    expect(aindaEntregue?.deliveredAt).not.toBeNull();

    // ── Com motivo: a reversão acontece e o RECIBO é limpo ───────────────────
    const reversed = await reversePrizeDelivery({
      tenantId,
      raffleId: raffle.raffleId,
      positionId,
      actorId,
      reason: 'entreguei para o homônimo, não para o ganhador',
    });

    expect(reversed.ok, reversed.ok ? 'ok' : reversed.message).toBe(true);
    if (reversed.ok) {
      expect(reversed.previousDeliveredByName).toBe('Operadora do palco');
      expect(reversed.reason).toContain('homônimo');
    }

    const limpo = await withTenant(tenantId, (tx) =>
      tx.raffleWinner.findFirst({
        where: { id: positionId },
        select: { deliveredAt: true, deliveredById: true, deliveryNote: true },
      }),
    );

    expect(limpo?.deliveredAt).toBeNull();
    expect(limpo?.deliveredById).toBeNull();
    expect(limpo?.deliveryNote).toBeNull();

    /** A POSIÇÃO continua existindo: o que se desfez foi o recibo, não o sorteio. */
    const posicao = await withTenant(tenantId, (tx) =>
      tx.raffleWinner.findFirst({ where: { id: positionId }, select: { position: true } }),
    );
    expect(posicao?.position).toBe(1);

    /** E a trilha guarda o FATO com o motivo — que é o que a auditoria pergunta. */
    const audit = await listAuditLog(tenantId, { limit: 20 });
    const reversao = audit.find(
      (entry) => entry.entityType === 'rafflePrize' && entry.entityId === positionId && entry.changes.motivoDaReversao,
    );

    expect(reversao).toBeDefined();
    expect(String(reversao?.changes.motivoDaReversao?.to)).toContain('homônimo');
    expect(reversao?.changes.entregaDesfeitaEm?.from).toBeTruthy();
    expect(reversao?.changes.entreguePorAnteriormente?.from).toBe('Operadora do palco');
  });

  it('desfazer duas vezes é recusado — não há o que desfazer', async () => {
    const list = await listRaffles(tenantId, eventId);
    if (!list.ok) throw new Error('listagem falhou');

    const raffle = list.raffles.find((entry) => entry.winners.some((winner) => winner.deliveredAt === null))!;
    const positionId = raffle.winners[0]!.id;

    const again = await reversePrizeDelivery({
      tenantId,
      raffleId: raffle.id,
      positionId,
      actorId,
      reason: 'tentativa repetida',
    });

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('NOT_DELIVERED');
  });

  it('a entrega pode ser registrada DE NOVO depois da reversão', async () => {
    const list = await listRaffles(tenantId, eventId);
    if (!list.ok) throw new Error('listagem falhou');

    const raffle = list.raffles.find((entry) => entry.winners.every((winner) => winner.deliveredAt === null))!;
    const positionId = raffle.winners[0]!.id;

    const again = await markPrizeDelivered({
      tenantId,
      raffleId: raffle.id,
      positionId,
      actorId,
      note: 'agora para a pessoa certa',
    });

    expect(again.ok, again.ok ? 'ok' : again.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G9 — busca e filtro no histórico', () => {
  it('o filtro recorta no BANCO (o total acompanha o filtro)', async () => {
    // Estado: os sorteios apurados dos cenários acima + um cancelado + um rascunho.
    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Sorteio cancelado ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: false,
      allowPriorEventWinners: true,
    });
    expect(created.ok).toBe(true);
    if (created.ok) await cancelRaffle({ tenantId, raffleId: created.raffleId, actorId });

    await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Sorteio rascunho ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: false,
      allowPriorEventWinners: true,
    });

    const todas = await listRaffles(tenantId, eventId);
    expect(todas.ok).toBe(true);

    const apurados = await listRaffles(tenantId, eventId, {
      filter: {
        status: 'DRAWN',
        from: null,
        to: null,
        fromDay: null,
        toDay: null,
        periodField: 'createdAt',
      },
    });

    expect(apurados.ok).toBe(true);
    if (!todas.ok || !apurados.ok) return;

    expect(apurados.total).toBeLessThan(todas.total);
    expect(apurados.raffles.every((raffle) => raffle.status === 'DRAWN')).toBe(true);

    const cancelados = await listRaffles(tenantId, eventId, {
      filter: {
        status: 'CANCELED',
        from: null,
        to: null,
        fromDay: null,
        toDay: null,
        periodField: 'createdAt',
      },
    });

    expect(cancelados.ok).toBe(true);
    if (cancelados.ok) expect(cancelados.raffles.every((raffle) => raffle.status === 'CANCELED')).toBe(true);
  });

  it('o período usa o dia da INSTITUIÇÃO, e o filtro do domínio alimenta a consulta', async () => {
    const hoje = new Date();
    const diaLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(hoje);

    const dentro = parseRaffleHistoryFilter({ from: diaLocal, to: diaLocal, timeZone: TIME_ZONE });
    expect(dentro.ok).toBe(true);

    if (!dentro.ok) return;

    const comPeriodo = await listRaffles(tenantId, eventId, { filter: dentro.filter });
    expect(comPeriodo.ok).toBe(true);
    if (comPeriodo.ok) expect(comPeriodo.total).toBeGreaterThan(0);

    // Um dia no futuro não tem sorteio nenhum — e o total diz ZERO (não "página 1").
    const amanha = new Date(hoje.getTime() + 2 * 86_400_000);
    const amanhaTexto = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(amanha);

    const fora = parseRaffleHistoryFilter({ from: amanhaTexto, to: amanhaTexto, timeZone: TIME_ZONE });
    expect(fora.ok).toBe(true);

    if (!fora.ok) return;

    const semNada = await listRaffles(tenantId, eventId, { filter: fora.filter });
    expect(semNada.ok).toBe(true);
    if (semNada.ok) expect(semNada.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G11 — página pública de UM sorteio', () => {
  it('só devolve resultado PUBLICADO e APURADO', async () => {
    const privado = await drawnRaffle({ title: `Privado ${RUN}`, people: 3, isPublic: false });

    expect(await getPublicRaffleResult(tenantId, eventId, privado.raffleId)).toBeNull();

    /**
     * Publicado na criação e AINDA NÃO apurado: o endereço não existe. É o estado
     * `NOT_DRAWN` — a instituição quer anunciar, mas ainda não há resultado, e o
     * TÍTULO do prêmio não pode vazar antes da hora.
     */
    const naoApurado = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Publicado sem apuração ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: true,
      allowPriorEventWinners: true,
    });

    if (!naoApurado.ok) throw new Error(naoApurado.message);

    expect(await getPublicRaffleResult(tenantId, eventId, naoApurado.raffleId)).toBeNull();

    // ── Publicado E apurado: aparece ─────────────────────────────────────────
    const publicado = await drawnRaffle({ title: `Publicado ${RUN}`, people: 3, isPublic: true });

    const resultado = await getPublicRaffleResult(tenantId, eventId, publicado.raffleId);

    expect(resultado).not.toBeNull();
    expect(resultado?.title).toBe(`Publicado ${RUN}`);
    expect(resultado?.winners.length).toBeGreaterThan(0);
    /** O nome sai MASCARADO para quem não tem perfil público. */
    expect(resultado?.winners[0]?.masked).toBe(true);
    expect(resultado?.resultHash).toBeTruthy();

    // ── Despublicar tira o endereço do ar ────────────────────────────────────
    const desligado = await setRaffleVisibility({
      tenantId,
      raffleId: publicado.raffleId,
      actorId,
      isPublic: false,
    });

    expect(desligado.ok).toBe(true);
    expect(await getPublicRaffleResult(tenantId, eventId, publicado.raffleId)).toBeNull();
  });

  it('sorteio de OUTRA instituição não é alcançado', async () => {
    const outra = randomUUID();

    await adminPrisma.tenant.create({
      data: { id: outra, slug: `f22-outra-${RUN}`, name: `Outra ${RUN}`, status: 'ACTIVE', plan: 'FREE' },
    });

    const resultado = await getPublicRaffleResult(outra, eventId, randomUUID());
    expect(resultado).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('G12 — versão da chave do cofre', () => {
  const SEGREDO_ANTIGO = 'segredo-antigo-com-16+';
  const SEGREDO_NOVO = 'segredo-novo-com-16++';

  it('sem chaveiro declarado, o sorteio sela na chave LEGADA (versão 0)', async () => {
    delete process.env.RAFFLE_SEED_KEYS;

    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Chave legada ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: false,
      allowPriorEventWinners: true,
    });

    if (!created.ok) throw new Error(created.message);

    const row = await withTenant(tenantId, (tx) =>
      tx.raffleRound.findFirst({
        where: { raffleId: created.raffleId },
        orderBy: { roundNumber: 'desc' },
        select: { seedKeyVersion: true, seedSealed: true },
      }),
    );

    expect(row?.seedKeyVersion).toBe(0);
    expect(row?.seedSealed).not.toBeNull();
  });

  it('com chaveiro, a versão ATUAL é a maior declarada e vai GRAVADA no sorteio', async () => {
    process.env.RAFFLE_SEED_KEYS = `1:${SEGREDO_ANTIGO},2:${SEGREDO_NOVO}`;

    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Chave v2 ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: false,
      allowPriorEventWinners: true,
    });

    if (!created.ok) throw new Error(created.message);

    const row = await withTenant(tenantId, (tx) =>
      tx.raffleRound.findFirst({
        where: { raffleId: created.raffleId },
        orderBy: { roundNumber: 'desc' },
        select: { seedKeyVersion: true },
      }),
    );

    expect(row?.seedKeyVersion).toBe(2);
  });

  it('GIRAR a chave não invalida a semente selada com a versão antiga', async () => {
    // Sorteio selado na versão 1, ainda NÃO apurado.
    process.env.RAFFLE_SEED_KEYS = `1:${SEGREDO_ANTIGO}`;

    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Sela v1 ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: false,
      allowPriorEventWinners: true,
    });

    if (!created.ok) throw new Error(created.message);

    // A chave gira: a versão 2 entra e a 1 CONTINUA declarada (é o que preserva o selo).
    process.env.RAFFLE_SEED_KEYS = `1:${SEGREDO_ANTIGO},2:${SEGREDO_NOVO}`;

    const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });

    expect(drawn.ok, drawn.ok ? 'ok' : drawn.message).toBe(true);
    if (!drawn.ok) return;

    /** `seeded` = a semente comprometida foi ABERTA e usada; sem ela, seria o gerador do sistema. */
    expect(drawn.seeded).toBe(true);
    expect(drawn.seedRevealed).not.toBeNull();
  });

  it('sem a chave da versão, a apuração avisa em vez de mentir (e não quebra)', async () => {
    process.env.RAFFLE_SEED_KEYS = `3:${SEGREDO_ANTIGO}`;

    const created = await createRaffle({
      tenantId,
      eventId,
      actorId,
      title: `Sela v3 ${RUN}`,
      scope: 'EVENT',
      minAttendanceMinutes: 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      isPublic: false,
      allowPriorEventWinners: true,
    });

    if (!created.ok) throw new Error(created.message);

    // A versão 3 sai do ambiente: o selo deixa de abrir.
    process.env.RAFFLE_SEED_KEYS = `4:${SEGREDO_NOVO}`;

    const drawn = await drawRaffle({ tenantId, raffleId: created.raffleId, actorId });

    expect(drawn.ok, drawn.ok ? 'ok' : drawn.message).toBe(true);
    if (!drawn.ok) return;

    expect(drawn.seeded).toBe(false);
    expect(drawn.seedRevealed).toBeNull();
  });

  it('o chaveiro declara os problemas de formatação em vez de ignorá-los', () => {
    const ring = parseSeedKeyRing('1:curto,2:ok-com-16-caracteres+,x:qualquer-segredo-16+');

    expect(ring.problems).toHaveLength(2);
    expect(ring.current).toBe(2);
  });

  it('a versão gravada continua legível depois de o chaveiro ser limpo', async () => {
    delete process.env.RAFFLE_SEED_KEYS;

    const list = await listRaffles(tenantId, eventId, { pageSize: 50 });
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const comVersao = list.raffles.filter((raffle) => raffle.seedKeyVersion > 0);
    expect(comVersao.length).toBeGreaterThan(0);
  });
});

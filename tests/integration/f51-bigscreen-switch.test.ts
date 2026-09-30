/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — o interruptor do telão (FASE 51 · dívida E37)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. A dívida é esta: o palco
 *  responde desde a CRIAÇÃO do sorteio e anuncia o título do prêmio, para que o
 *  organizador teste o endereço antes do evento e projete o mesmo link no dia — e não
 *  havia como negar o acesso até a instituição decidir ligar o telão.
 *
 *  O que se prova aqui:
 *
 *    • DESLIGADO, a leitura do palco não traz título, prêmio, elegíveis nem ganhadores
 *      — o objeto devolvido tem DUAS chaves, e é isso que impede o vazamento de virar
 *      descuido de tela;
 *    • a mesma leitura diz que o telão está desligado (e não que o endereço errou);
 *    • LIGADO, o comportamento é o de sempre (o prêmio da rodada anunciada aparece);
 *    • a virada entra na trilha com autor e hora, nas duas direções;
 *    • sorteio antigo, sem a coluna tocada, continua LIGADO (o default não mudou nada).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  createRaffle,
  drawRound,
  getRaffleLiveState,
  getRaffleStageView,
  setBigscreenVisibility,
} from '../../src/lib/raffles/raffle-service';
import { isBigscreenVisible } from '../../src/domain/raffles/stage-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const day = new Date('2026-09-21T13:00:00.000Z');

let tenantId: string;
let eventId: string;
let actorId: string;

async function createPresent(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name: `${name} ${RUN}`, email: `f51.telao.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  await withTenant(tenantId, (tx) =>
    tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        userId: id,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: day,
        checkedOutAt: new Date(day.getTime() + 60 * 60_000),
        minutesAttended: 60,
      },
    }),
  );

  return id;
}

/** Um sorteio com a rodada 1 preparada — o caminho de "Criar para o palco". */
async function createPrepared(input: { title: string; prizeTitle: string }) {
  const created = await createRaffle({
    tenantId,
    eventId,
    actorId,
    title: input.title,
    scope: 'EVENT',
    minAttendanceMinutes: 0,
    winnersCount: 1,
    alternatesCount: 0,
    weightByMinutes: false,
    isPublic: false,
    allowPriorEventWinners: true,
    prizeTitle: input.prizeTitle,
    sponsorId: null,
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
      slug: `f51-telao-${RUN}`,
      name: `Instituição Telão ${RUN}`,
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
        slug: 'evento-f51',
        title: 'Congresso F51',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-09-21T12:00:00.000Z'),
        endsAt: new Date('2026-09-22T23:00:00.000Z'),
        timezone: TIME_ZONE,
        capacity: null,
        confirmedCount: 0,
      },
    }),
  );

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizadora do Palco', email: `f51.telao.ator.${RUN}@exemplo.test` },
  });

  // A lista publicada da rodada sai destes presentes: são eles que NÃO podem vazar
  // com o telão desligado.
  for (let index = 0; index < 4; index += 1) {
    await createPresent(`Presente Sigiloso ${index}`);
  }
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a leitura do padrão (a coluna nasce LIGADA)', () => {
  it('sorteio criado sem tocar no interruptor continua no ar', async () => {
    const created = await createPrepared({ title: `Padrão F51 ${RUN}`, prizeTitle: 'Fone bluetooth' });

    const linha = await withTenant(tenantId, (tx) =>
      tx.raffle.findUniqueOrThrow({
        where: { id: created.raffleId },
        select: { bigscreenVisible: true },
      }),
    );

    expect(linha.bigscreenVisible).toBe(true);

    const stage = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });

    expect(stage).not.toBeNull();
    expect(stage!.bigscreenVisible).toBe(true);
    if (!stage || !stage.bigscreenVisible) return;
    expect(stage.title).toBe(`Padrão F51 ${RUN}`);
    expect(stage.currentRound?.prizeTitle).toBe('Fone bluetooth');
  });

  it('um valor que a plataforma não entende NÃO desliga o telão', async () => {
    /**
     * Desligar é ato explícito de alguém — e é ele que fica na trilha. Se `null` (ou
     * lixo de migração) desligasse, a parede cairia no meio da abertura do evento por
     * causa de um dado que ninguém pediu.
     */
    expect(isBigscreenVisible(true)).toBe(true);
    expect(isBigscreenVisible(null)).toBe(true);
    expect(isBigscreenVisible(undefined)).toBe(true);
    expect(isBigscreenVisible('sim')).toBe(true);
    expect(isBigscreenVisible(false)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('telão DESLIGADO', () => {
  it('a leitura do palco não traz prêmio, elegíveis nem ganhadores — só o aviso', async () => {
    const created = await createPrepared({
      title: `Segredo F51 ${RUN}`,
      prizeTitle: 'Notebook Dell',
    });

    const virada = await setBigscreenVisibility({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      visible: false,
    });
    expect(virada.ok, virada.ok ? 'ok' : virada.message).toBe(true);

    const stage = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });

    expect(stage).not.toBeNull();
    expect(stage!.bigscreenVisible).toBe(false);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA DE QUE NADA VAZOU É O FORMATO, NÃO A AUSÊNCIA DE UM CAMPO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Afirmar `stage.title === null` deixaria a porta aberta para um campo novo
     *  esquecido no dia seguinte. O objeto tem DUAS chaves — e a lista é comparada
     *  inteira, de propósito.
     */
    expect(Object.keys(stage!).sort()).toEqual(['bigscreenVisible', 'raffleId']);

    const serializado = JSON.stringify(stage);
    expect(serializado).not.toContain('Notebook Dell');
    expect(serializado).not.toContain('Segredo F51');
    expect(serializado).not.toContain('Presente Sigiloso');
    expect(serializado).not.toContain('sigiloso');
  });

  it('a página sabe que está DESLIGADO — e não que o endereço está errado', async () => {
    const created = await createPrepared({ title: `Aviso F51 ${RUN}`, prizeTitle: 'Caneca' });

    await setBigscreenVisibility({ tenantId, raffleId: created.raffleId, actorId, visible: false });

    const stage = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });
    expect(stage?.bigscreenVisible).toBe(false);
    expect(stage?.raffleId).toBe(created.raffleId);

    /**
     * A distinção que a dívida exige: endereço ERRADO continua sendo `null` (404),
     * endereço certo com o telão desligado é um objeto. Sem isso o organizador não
     * teria como saber se errou o link ou se foi ele mesmo que desligou.
     */
    const inexistente = await getRaffleStageView({
      tenantId,
      eventId,
      raffleId: randomUUID(),
    });
    expect(inexistente).toBe(null);

    const outroEvento = await getRaffleStageView({
      tenantId,
      eventId: randomUUID(),
      raffleId: created.raffleId,
    });
    expect(outroEvento).toBe(null);
  });

  it('desligado DEPOIS da apuração, nem o resultado nem os ganhadores vazam', async () => {
    const created = await createPrepared({ title: `Apurado F51 ${RUN}`, prizeTitle: 'Tablet' });

    const apurado = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!apurado.ok) throw new Error(apurado.message);

    // Antes de desligar, o palco mostra o resultado: é o comportamento conhecido.
    const ligado = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });
    expect(ligado!.bigscreenVisible).toBe(true);
    if (!ligado || !ligado.bigscreenVisible) return;
    expect(ligado.currentRound?.winners).toHaveLength(1);
    expect(ligado.currentRound?.rollNames.length).toBeGreaterThan(0);

    await setBigscreenVisibility({ tenantId, raffleId: created.raffleId, actorId, visible: false });

    const desligado = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });
    expect(Object.keys(desligado!).sort()).toEqual(['bigscreenVisible', 'raffleId']);
    expect(JSON.stringify(desligado)).not.toContain('Tablet');
    expect(JSON.stringify(desligado)).not.toContain('Presente Sigiloso');
  });

  it('a rota pública do ao vivo também para de entregar o prêmio e a contagem', async () => {
    /**
     * A rota `/ao-vivo` é outra porta para o mesmo palco. Se ela continuasse devolvendo
     * a rodada anunciada (com o título do prêmio), o interruptor seria desfeito por
     * baixo — bastava ler o JSON.
     */
    const created = await createPrepared({
      title: `Ao vivo F51 ${RUN}`,
      prizeTitle: 'Bicicleta aro 29',
    });

    const antes = await getRaffleLiveState({ tenantId, eventId, raffleId: created.raffleId });
    expect(antes!.bigscreenVisible).toBe(true);
    expect(antes!.pendingRound?.prizeTitle).toBe('Bicicleta aro 29');

    await setBigscreenVisibility({ tenantId, raffleId: created.raffleId, actorId, visible: false });

    const depois = await getRaffleLiveState({ tenantId, eventId, raffleId: created.raffleId });

    expect(depois!.bigscreenVisible).toBe(false);
    expect(depois!.pendingRound).toBe(null);
    expect(depois!.lastDrawnRound).toBe(null);
    expect(depois!.resultHash).toBe(null);
    expect(JSON.stringify(depois)).not.toContain('Bicicleta');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('telão LIGADO de novo', () => {
  it('volta exatamente ao comportamento de antes — prêmio, elegíveis e roleta', async () => {
    const created = await createPrepared({
      title: `Volta F51 ${RUN}`,
      prizeTitle: 'Caixa de som',
    });

    await setBigscreenVisibility({ tenantId, raffleId: created.raffleId, actorId, visible: false });
    const desligado = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });
    expect(desligado!.bigscreenVisible).toBe(false);

    const ligado = await setBigscreenVisibility({
      tenantId,
      raffleId: created.raffleId,
      actorId,
      visible: true,
    });
    expect(ligado.ok, ligado.ok ? 'ok' : ligado.message).toBe(true);

    const stage = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });
    expect(stage!.bigscreenVisible).toBe(true);
    if (!stage || !stage.bigscreenVisible) return;

    expect(stage.title).toBe(`Volta F51 ${RUN}`);
    expect(stage.state).toBe('AGUARDANDO');
    expect(stage.currentRound?.roundNumber).toBe(1);
    expect(stage.currentRound?.prizeTitle).toBe('Caixa de som');
    expect(stage.currentRound?.seedCommitment).toMatch(/^[a-f0-9]{64}$/);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA DE QUE O INTERRUPTOR NÃO CONSUMIU NADA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Não basta o prêmio reaparecer: a rodada tem de continuar APURÁVEL, com a lista
     *  publicada e os nomes da roleta. Se o desligado tivesse descartado a rodada (ou
     *  a lista), o telão voltaria vazio e a apuração falharia depois de ligar.
     */
    const apurado = await drawRound({ tenantId, raffleId: created.raffleId, actorId });
    if (!apurado.ok) throw new Error(apurado.message);

    const revelado = await getRaffleStageView({ tenantId, eventId, raffleId: created.raffleId });
    if (!revelado || !revelado.bigscreenVisible) throw new Error('palco não voltou ao ar');

    expect(revelado.state).toBe('REVELADO');
    expect(revelado.currentRound?.winners).toHaveLength(1);
    expect(revelado.currentRound!.rollNames.length).toBeGreaterThan(0);
    expect(revelado.currentRound!.rollNames).toContain(revelado.currentRound!.winners[0]!.name);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a virada entra na trilha', () => {
  it('guarda QUEM ligou/desligou e QUANDO, nas duas direções', async () => {
    const created = await createPrepared({ title: `Trilha F51 ${RUN}`, prizeTitle: 'Fone' });

    await setBigscreenVisibility({ tenantId, raffleId: created.raffleId, actorId, visible: false });
    await setBigscreenVisibility({ tenantId, raffleId: created.raffleId, actorId, visible: true });

    const registros = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId, entityType: 'raffle', entityId: created.raffleId, action: 'UPDATE' },
        orderBy: { createdAt: 'asc' },
        select: { changes: true, userId: true, createdAt: true },
      }),
    );

    expect(registros).toHaveLength(2);

    const [desligou, ligou] = registros;

    // Quem declarou é o ator da sessão — não um texto do formulário.
    expect(desligou!.userId).toBe(actorId);
    expect(desligou!.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(desligou!.changes)).toContain('bigscreenVisible');

    expect(ligou!.changes).toEqual({ bigscreenVisible: { from: false, to: true } });
    expect(ligou!.userId).toBe(actorId);
  });

  it('sorteio inexistente é recusado sem tocar em nada', async () => {
    const result = await setBigscreenVisibility({
      tenantId,
      raffleId: randomUUID(),
      actorId,
      visible: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { createDemand, loadDemandBoard } from '../../src/lib/events/demand-service';
import { toTimelineDemands } from '../../src/lib/events/demand-timeline';
import {
  addDaysToDayKey,
  dueAtFromDay,
  localDayKey,
} from '../../src/domain/events/demand-rules';
import {
  calendarMonth,
  ganttLayout,
  monthKeyOf,
  timelineWindow,
} from '../../src/domain/events/demand-timeline-rules';
import { zonedWallTimeToInstant } from '../../src/domain/events/scheduling-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let eventId: string;
let organizerId: string;

const now = new Date();

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS TRÊS VISTAS DAS DEMANDAS (FASE 57) — integração com banco real
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PRENDE, E O QUE ELE NÃO REPETE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O desenho (coluna da barra, dias do mês, ordem) já está preso no teste de domínio
 *  (`tests/unit/demand-timeline-rules.test.ts`). O que SÓ o banco pode provar é a
 *  PASSAGEM: o que a tela lê do quadro é o que as vistas desenham, com as datas que
 *  estão gravadas — inclusive a `createdAt`, que o cartão passou a carregar para o Gantt
 *  saber onde a barra começa quando não há `startAt`.
 *
 *  Se este elo quebrar, o domínio continua verde e a tela mostra o gráfico errado: é
 *  exatamente o defeito que nenhum dos dois lados pega sozinho.
 */
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f57.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  return id;
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f57-${RUN}`,
      name: `Instituição da linha do tempo ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  organizerId = await createUser('Organizadora F57');

  await adminPrisma.userTenantProfile.create({
    data: {
      tenantId,
      userId: organizerId,
      kind: 'MEMBER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });

  const startsAt = new Date(now.getTime() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f57-${RUN}`,
        title: 'Congresso da linha do tempo',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f57.${RUN}` } } });
});

describe('o quadro alimenta as três vistas', () => {
  it('o mapeamento entrega as datas gravadas, a situação e a `createdAt` do cartão', async () => {
    const hoje = localDayKey(now, TIME_ZONE);
    const inicio = addDaysToDayKey(hoje, 1);
    const prazo = addDaysToDayKey(hoje, 5);
    const inicioEmInstante = zonedWallTimeToInstant(`${inicio}T09:00`, TIME_ZONE);

    if (!inicioEmInstante) throw new Error('não montou o instante do início');

    /** Com início e prazo declarados: a barra é um PERÍODO dentro da janela. */
    const comInicio = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Montar o credenciamento',
      startAt: inicioEmInstante,
      dueAt: dueAtFromDay(prazo, TIME_ZONE),
    });
    if (!comInicio.ok) throw new Error(comInicio.message);

    /** Sem início: a barra começa na CRIAÇÃO, e a vista marca isso como estimado. */
    const semInicio = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Fechar o contrato do som',
      dueAt: dueAtFromDay(addDaysToDayKey(hoje, 3), TIME_ZONE),
    });
    if (!semInicio.ok) throw new Error(semInicio.message);

    /** Sem prazo: o Gantt não tem onde desenhá-la — ela vai para a faixa "sem data". */
    const semPrazo = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Escolher a arte do banner',
    });
    if (!semPrazo.ok) throw new Error(semPrazo.message);

    /** ── A leitura é UMA, e é a mesma que o Kanban usa ─────────────────────────── */
    const result = await loadDemandBoard({ tenantId, eventId, now });
    if (!result.ok) throw new Error(result.message);

    const { board } = result;
    const demands = toTimelineDemands(board.columns, now, board.timeZone);

    expect(demands).toHaveLength(3);

    const a = demands.find((demand) => demand.id === comInicio.demandId)!;
    const b = demands.find((demand) => demand.id === semInicio.demandId)!;
    const c = demands.find((demand) => demand.id === semPrazo.demandId)!;

    /** As datas são as GRAVADAS, lidas no fuso do evento. */
    expect(localDayKey(a.startAt!, TIME_ZONE)).toBe(inicio);
    expect(localDayKey(a.dueAt!, TIME_ZONE)).toBe(prazo);
    expect(b.startAt).toBeNull();
    expect(b.dueAt).not.toBeNull();
    expect(c.dueAt).toBeNull();

    /** A `createdAt` viaja no cartão: é dela que a barra sem início parte. */
    expect(a.createdAt).toBeInstanceOf(Date);

    /**
     * A situação que as vistas desenham é a MESMA que o cartão do Kanban mostra — a
     * pergunta "esta demanda está atrasada?" não pode ter duas respostas na mesma tela.
     */
    const cards = board.columns.flatMap((column) => column.cards);

    for (const demand of demands) {
      const card = cards.find((item) => item.id === demand.id)!;
      expect(demand.situation).toBe(card.situation);
      expect(demand.situationLabel).toBe(card.situationLabel);
    }

    expect(a.situation).toBe('OPEN');

    /** ── E o que o DOMÍNIO desenha a partir daí ────────────────────────────────── */
    const window = timelineWindow({
      anchorKey: inicio,
    });
    const layout = ganttLayout({ demands, window, timeZone: board.timeZone });

    const rowA = layout.rows.find((row) => row.id === a.id)!;
    const rowB = layout.rows.find((row) => row.id === b.id)!;

    expect(rowA.estimatedStart).toBe(false);
    /** Do dia do início ao dia do prazo, inclusive: 1º a 5º dia depois de hoje. */
    expect(rowA.spanColumns).toBe(5);
    expect(rowA.clippedStart).toBe(false);
    expect(rowA.clippedEnd).toBe(false);

    expect(rowB.estimatedStart).toBe(true);
    expect(rowB.startKey).toBe(hoje);

    /** Sem prazo, ela não entra no eixo: cai na faixa "sem data". */
    expect(layout.undated.map((demand) => demand.id)).toEqual([c.id]);
    expect(layout.rows.map((row) => row.id)).not.toContain(c.id);

    /** ── O calendário põe cada uma no dia do PRAZO ─────────────────────────────── */
    const month = calendarMonth({
      monthKey: monthKeyOf(prazo),
      demands,
      timeZone: board.timeZone,
      now,
    });

    const celula = month.weeks
      .flat()
      .find((cell) => cell.demands.some((demand) => demand.id === a.id))!;

    expect(celula.dayKey).toBe(prazo);
    expect(month.undated.map((demand) => demand.id)).toEqual([c.id]);
  });
});

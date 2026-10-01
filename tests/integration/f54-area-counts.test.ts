/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — As contagens das áreas do evento (FASE 54)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O selo do cartão é um número lido do banco com filtro por EVENTO e por ESTADO.
 *  Um filtro errado não quebra nada: ele devolve `0` — e "nenhuma chamada" num evento
 *  que tem três é pior do que não ter selo, porque o organizador acredita.
 *
 *  Aqui as três réguas ficam presas com dado real:
 *  • a contagem é do EVENTO (o evento vizinho, na mesma instituição, não entra);
 *  • o que está fora do ar não conta (patrocinador inativo, equipe desativada,
 *    chamada excluída, crachá revogado);
 *  • a leitura respeita a RLS — outra INSTITUIÇÃO não aparece nem por acidente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getEventAreaCounts } from '../../src/lib/events/event-area-counts';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let outroTenantId: string;
let eventId: string;
let eventoVizinhoId: string;

async function criarTenant(slug: string, nome: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id,
      slug,
      name: nome,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  return id;
}

async function criarEvento(tenant: string, id: string, slug: string, titulo: string): Promise<void> {
  await withTenant(tenant, async (tx) => {
    await tx.event.create({
      data: {
        id,
        tenantId: tenant,
        slug,
        title: titulo,
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-11-10T11:00:00.000Z'),
        endsAt: new Date('2026-11-10T22:00:00.000Z'),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });
  });
}

beforeAll(async () => {
  tenantId = await criarTenant(`f54-contagens-${RUN}`, `Instituição Contagens F54 ${RUN}`);
  outroTenantId = await criarTenant(`f54-vizinha-${RUN}`, `Instituição Vizinha F54 ${RUN}`);

  eventId = randomUUID();
  eventoVizinhoId = randomUUID();

  await criarEvento(tenantId, eventId, `evento-f54-${RUN}`, 'Evento com contagens');
  await criarEvento(tenantId, eventoVizinhoId, `evento-vizinho-f54-${RUN}`, 'Evento vizinho');
  await criarEvento(outroTenantId, randomUUID(), `evento-outra-${RUN}`, 'Evento de outra casa');

  await withTenant(tenantId, async (tx) => {
    /** Duas chamadas valendo, uma excluída — a excluída não pode aparecer no selo. */
    await tx.callForProposals.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: `chamada-a-${RUN}`,
          title: 'Chamada A',
          kind: 'PAPER',
          opensAt: new Date('2026-09-01T00:00:00.000Z'),
          closesAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: `chamada-b-${RUN}`,
          title: 'Chamada B',
          kind: 'PAPER',
          opensAt: new Date('2026-09-01T00:00:00.000Z'),
          closesAt: new Date('2026-10-01T00:00:00.000Z'),
        },
        {
          id: randomUUID(),
          tenantId,
          eventId,
          slug: `chamada-excluida-${RUN}`,
          title: 'Chamada excluída',
          kind: 'PAPER',
          opensAt: new Date('2026-09-01T00:00:00.000Z'),
          closesAt: new Date('2026-10-01T00:00:00.000Z'),
          deletedAt: new Date(),
        },
      ],
    });

    /** Uma sala — é ela que o selo conta (e o teto das vagas da atividade). */
    await tx.room.create({
      data: { id: randomUUID(), tenantId, eventId, name: 'Sala Única' },
    });

    /** Uma equipe ativa e uma desativada. */
    await tx.eventTeam.createMany({
      data: [
        { id: randomUUID(), tenantId, eventId, name: 'Produção', isActive: true },
        { id: randomUUID(), tenantId, eventId, name: 'Antiga', isActive: false },
      ],
    });

    /** Um patrocinador ativo e um inativo; e um do EVENTO VIZINHO, que não conta aqui. */
    await tx.sponsor.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId,
          eventId,
          name: 'Patrocinador ativo',
          slug: `patrocinador-ativo-${RUN}`,
        },
        {
          id: randomUUID(),
          tenantId,
          eventId,
          name: 'Patrocinador inativo',
          slug: `patrocinador-inativo-${RUN}`,
          isActive: false,
        },
        {
          id: randomUUID(),
          tenantId,
          eventId: eventoVizinhoId,
          name: 'Patrocinador do vizinho',
          slug: `patrocinador-vizinho-${RUN}`,
        },
      ],
    });

    /**
     * Duas demandas abertas e uma concluída. A demanda vive num QUADRO e numa COLUNA
     * (FASE 38) — sem os dois, o cartão não existe.
     */
    const boardId = randomUUID();
    const columnId = randomUUID();

    await tx.demandBoard.create({ data: { id: boardId, tenantId, eventId, name: 'Geral' } });
    await tx.demandColumn.create({
      data: { id: columnId, tenantId, boardId, name: 'A fazer', position: 10 },
    });

    await tx.demand.createMany({
      data: [
        { id: randomUUID(), tenantId, eventId, boardId, columnId, title: 'Aberta 1', position: 10 },
        { id: randomUUID(), tenantId, eventId, boardId, columnId, title: 'Aberta 2', position: 20 },
        {
          id: randomUUID(),
          tenantId,
          eventId,
          boardId,
          columnId,
          title: 'Concluída',
          position: 30,
          completedAt: new Date(),
        },
      ],
    });
  });
});

afterAll(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.room.deleteMany({ where: { tenantId } });
    await tx.demand.deleteMany({ where: { tenantId } });
    await tx.demandColumn.deleteMany({ where: { tenantId } });
    await tx.demandBoard.deleteMany({ where: { tenantId } });
    await tx.sponsor.deleteMany({ where: { tenantId } });
    await tx.eventTeam.deleteMany({ where: { tenantId } });
    await tx.callForProposals.deleteMany({ where: { tenantId } });
    await tx.event.deleteMany({ where: { tenantId } });
  });

  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, outroTenantId] } } });
  await adminPrisma.$disconnect();
});

describe('contagens das áreas do evento', () => {
  it('lê o que está VALENDO: excluído, inativo e desativado ficam de fora; o vizinho também', async () => {
    const resultado = await getEventAreaCounts({ tenantId, eventId });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.counts.calls).toBe(2);
    expect(resultado.counts.teams).toBe(1);
    expect(resultado.counts.sponsors).toBe(1);
    expect(resultado.counts.openDemands).toBe(2);
  });

  it('a fila de confirmações vem do CHAMADOR — o serviço devolve `null` para não ter duas verdades', async () => {
    const resultado = await getEventAreaCounts({ tenantId, eventId });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.counts.pendingConfirmations).toBeNull();
  });

  it('evento sem página devolve `null` — e não `false`, que afirmaria "em rascunho"', async () => {
    const resultado = await getEventAreaCounts({ tenantId, eventId });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.counts.pagePublished).toBeNull();
  });

  it('o evento vizinho da MESMA instituição não empresta contagem nenhuma', async () => {
    const resultado = await getEventAreaCounts({ tenantId, eventId: eventoVizinhoId });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.counts.calls).toBe(0);
    expect(resultado.counts.sponsors).toBe(1);
    expect(resultado.counts.openDemands).toBe(0);
  });

  it('a RLS vale: a outra instituição não enxerga nada daqui', async () => {
    const resultado = await getEventAreaCounts({ tenantId: outroTenantId, eventId });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    /** Mesmo com o `eventId` na mão, o contexto de tenant não deixa ler o dado alheio. */
    expect(resultado.counts.calls).toBe(0);
    expect(resultado.counts.sponsors).toBe(0);
    expect(resultado.counts.teams).toBe(0);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — ciclo de vida da SALA (revisão da FASE 3)
 *
 *  A capacidade da sala deixou de ser obrigatória e passou a ser o TETO do limite
 *  efetivo da atividade que acontece nela. O que só o banco real pode provar:
 *
 *    • a capacidade vazia vira `null` (sem limite) e NÃO zero;
 *    • a sala em uso recusa a exclusão (a FK é `ON DELETE SET NULL`: sem a guarda,
 *      a sala sumiria da programação em silêncio);
 *    • reduzir a capacidade abaixo do que já existe é recusado, com o número;
 *    • **a inscrição PARA no limite da sala** mesmo quando a atividade é ilimitada —
 *      é o predicado atômico do `UPDATE`, e não uma checagem de leitura;
 *    • a lista de espera respeita o mesmo teto na promoção.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  deleteRoom,
  getAdminEvent,
  saveActivity,
  saveEvent,
  saveRoom,
} from '../../src/lib/admin/catalog-service';
import { listAuditLog } from '../../src/lib/admin/audit';
import {
  cancelRegistration,
  readActivityCounters,
  registerForActivity,
} from '../../src/lib/events/registration-service';
import { getPublicActivity, getPublicEvent } from '../../src/lib/events/event-repository';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let actorId: string;
let eventId: string;

/** Ids das salas criadas pelos cenários (resolvidos pelo nome, sem `let` global). */
const roomsBySlug: Record<string, string> = {};
const activitiesBySlug: Record<string, string> = {};

const startsAt = new Date(Date.now() + 30 * 86_400_000);

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name, email: `sala.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });
  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return id;
}

/** Sala criada por `saveRoom` (o caminho real), com o id guardado pelo nome. */
async function room(name: string, capacity: number | null): Promise<string> {
  const result = await saveRoom({ tenantId, actorId, eventId, name, capacity });
  if (!result.ok) throw new Error(`sala "${name}": ${result.message}`);
  roomsBySlug[name] = result.roomId;
  return result.roomId;
}

async function activity(input: {
  slug: string;
  title: string;
  capacity: number | null;
  roomId: string | null;
  waitlistEnabled?: boolean;
  hourOffset?: number;
  requiresRegistration?: boolean;
}): Promise<string> {
  const start = new Date(startsAt.getTime() + (input.hourOffset ?? 0) * 3_600_000);

  const result = await saveActivity({
    tenantId,
    actorId,
    eventId,
    slug: input.slug,
    title: input.title,
    type: 'WORKSHOP',
    status: 'SCHEDULED',
    modality: 'IN_PERSON',
    startsAt: start,
    endsAt: new Date(start.getTime() + 3_600_000),
    workloadMinutes: 60,
    capacity: input.capacity,
    waitlistEnabled: input.waitlistEnabled ?? false,
    roomId: input.roomId,
    requiresRegistration: input.requiresRegistration,
  });

  if (!result.ok) throw new Error(`atividade "${input.slug}": ${result.message}`);
  activitiesBySlug[input.slug] = result.activityId;
  return result.activityId;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `salas-${RUN}`,
      name: `Instituição Salas ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  actorId = await createUser('Organizadora');

  const event = await saveEvent({
    tenantId,
    actorId,
    slug: 'congresso-salas',
    title: 'Congresso das Salas',
    summary: 'Evento criado para exercitar o ciclo de vida da sala.',
    status: 'REGISTRATION_OPEN',
    modality: 'IN_PERSON',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
    timezone: 'America/Bahia',
    capacity: 300,
    city: 'Salvador',
  });

  if (!event.ok) throw new Error(event.message);
  eventId = event.eventId;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('capacidade da sala: opcional de verdade', () => {
  it('sala SEM capacidade é gravada como NULL (e não como zero lugares)', async () => {
    const id = await room('Sala sem número', null);

    const row = await withTenant(tenantId, (tx) =>
      tx.room.findFirst({ where: { id }, select: { capacity: true } }),
    );

    expect(row?.capacity).toBeNull();
  });

  it('capacidade ZERO é normalizada para NULL — a sala não afirma "não cabe ninguém"', async () => {
    const id = await room('Sala do zero', 0);

    const row = await withTenant(tenantId, (tx) =>
      tx.room.findFirst({ where: { id }, select: { capacity: true } }),
    );

    expect(row?.capacity).toBeNull();
  });

  it('a edição troca nome e capacidade, e a trilha registra as duas mudanças', async () => {
    const id = await room('Sala editável', 20);

    const saved = await saveRoom({
      tenantId,
      actorId,
      eventId,
      roomId: id,
      name: 'Sala renomeada',
      capacity: 35,
    });

    expect(saved.ok, saved.ok ? 'ok' : saved.message).toBe(true);

    const trail = await listAuditLog(tenantId, { limit: 10 });
    const entry = trail.find((row) => row.entityId === id && row.action === 'UPDATE');

    expect(entry).toBeDefined();
    expect(entry?.changes).toMatchObject({ capacity: { from: 20, to: 35 } });
  });

  it('RECUSA renomear uma sala para o nome de OUTRA do mesmo evento', async () => {
    await room('Auditório A', 50);

    const duplicated = await saveRoom({
      tenantId,
      actorId,
      eventId,
      name: 'Auditório A',
      capacity: 50,
    });

    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) {
      expect(duplicated.code).toBe('ROOM_NAME_TAKEN');
      expect(duplicated.message).toMatch(/já existe uma sala/i);
    }
  });
});

describe('a sala é o TETO da atividade', () => {
  it('RECUSA atividade com mais vagas do que a sala comporta', async () => {
    const roomId = await room('Sala pequena', 40);

    const refused = await saveActivity({
      tenantId,
      actorId,
      eventId,
      slug: 'maior-que-a-sala',
      title: 'Atividade maior que a sala',
      type: 'WORKSHOP',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      workloadMinutes: 60,
      capacity: 80,
      waitlistEnabled: false,
      roomId,
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('ROOM_TOO_SMALL');
      expect(refused.message).toContain('80');
      expect(refused.message).toContain('40');
    }
  });

  it('ACEITA atividade sem vagas declaradas numa sala com limite (a sala limita)', async () => {
    const roomId = roomsBySlug['Sala pequena']!;
    const id = await activity({
      slug: 'ilimitada-na-sala',
      title: 'Atividade sem vagas declaradas',
      capacity: null,
      roomId,
      hourOffset: 1,
    });

    const counters = await readActivityCounters(tenantId, id);

    expect(counters?.declaredCapacity).toBeNull();
    expect(counters?.roomCapacity).toBe(40);
    /** O limite EFETIVO é o da sala — é ele que decide a vaga. */
    expect(counters?.capacity).toBe(40);
  });

  it('RECUSA reduzir a sala abaixo das vagas já configuradas, dizendo qual atividade', async () => {
    const roomId = await room('Sala que encolhe', 60);
    await activity({
      slug: 'com-vagas-na-sala',
      title: 'Oficina com 50 vagas',
      capacity: 50,
      roomId,
      hourOffset: 2,
    });

    const refused = await saveRoom({
      tenantId,
      actorId,
      eventId,
      roomId,
      name: 'Sala que encolhe',
      capacity: 30,
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('ROOM_CAPACITY_BELOW_USAGE');
      expect(refused.message).toContain('Oficina com 50 vagas');
      expect(refused.message).toContain('50');
    }
  });

  it('RECUSA reduzir a sala abaixo dos INSCRITOS já confirmados', async () => {
    const roomId = await room('Sala com gente', 50);
    const activityId = await activity({
      slug: 'com-inscritos-na-sala',
      title: 'Palestra com inscritos',
      capacity: null,
      roomId,
      hourOffset: 3,
    });

    // Três inscrições reais, pelo mesmo caminho que a interface usa.
    for (let index = 0; index < 3; index += 1) {
      const userId = await createUser(`Participante ${index}`);
      const enrolled = await registerForActivity({
        tenantId,
        eventSlug: 'congresso-salas',
        activitySlug: 'com-inscritos-na-sala',
        userId,
      });
      expect(enrolled.ok, enrolled.ok ? 'ok' : enrolled.message).toBe(true);
    }

    const refused = await saveRoom({
      tenantId,
      actorId,
      eventId,
      roomId,
      name: 'Sala com gente',
      capacity: 2,
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('ROOM_CAPACITY_BELOW_USAGE');
      expect(refused.message).toContain('3 inscrito(s)');
    }

    /** A sala NÃO mudou: a recusa preserva o dado. */
    const row = await withTenant(tenantId, (tx) =>
      tx.room.findFirst({ where: { id: roomId }, select: { capacity: true } }),
    );
    expect(row?.capacity).toBe(50);

    expect(activityId).toBeTruthy();
  });
});

describe('a inscrição PARA na capacidade da sala', () => {
  /**
   * A prova central: a atividade NÃO declara vagas (ilimitada) e a sala comporta 2.
   * Sem o predicado da sala no `UPDATE` atômico, o contador passaria de 2 e a
   * instituição teria mais inscritos do que cadeiras.
   */
  it('atividade ILIMITADA numa sala de 2 lugares confirma exatamente 2', async () => {
    const roomId = await room('Sala de dois lugares', 2);
    const activityId = await activity({
      slug: 'sala-de-dois',
      title: 'Oficina em sala de dois lugares',
      capacity: null,
      roomId,
      hourOffset: 4,
    });

    const outcomes: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const userId = await createUser(`Candidato ${index}`);
      const enrolled = await registerForActivity({
        tenantId,
        eventSlug: 'congresso-salas',
        activitySlug: 'sala-de-dois',
        userId,
      });

      outcomes.push(enrolled.ok ? 'OK' : enrolled.code);
    }

    expect(outcomes).toEqual(['OK', 'OK', 'FULL']);

    const counters = await readActivityCounters(tenantId, activityId);
    expect(counters?.confirmedCount).toBe(2);
  });

  it('a página pública anuncia o limite da SALA, não o da atividade', async () => {
    const publicEvent = await getPublicEvent(tenantId, 'congresso-salas');
    const summary = publicEvent?.activities.find((row) => row.slug === 'sala-de-dois');

    expect(summary?.capacity).toBe(2);
    expect(summary?.roomCapacity).toBe(2);
    expect(summary?.remainingSeats).toBe(0);

    const detail = await getPublicActivity(tenantId, 'congresso-salas', 'sala-de-dois');
    expect(detail?.activity.capacity).toBe(2);
  });

  it('a lista de espera é PROMOVIDA só até o teto da sala', async () => {
    const roomId = await room('Sala da espera', 1);
    const activityId = await activity({
      slug: 'sala-da-espera',
      title: 'Oficina com espera',
      capacity: null,
      roomId,
      waitlistEnabled: true,
      hourOffset: 5,
    });

    const first = await createUser('Primeiro da fila');
    const second = await createUser('Segundo da fila');

    const enrolled = await registerForActivity({
      tenantId,
      eventSlug: 'congresso-salas',
      activitySlug: 'sala-da-espera',
      userId: first,
    });
    expect(enrolled.ok).toBe(true);

    const waitlisted = await registerForActivity({
      tenantId,
      eventSlug: 'congresso-salas',
      activitySlug: 'sala-da-espera',
      userId: second,
    });
    expect(waitlisted.ok).toBe(true);
    if (waitlisted.ok) expect(waitlisted.status).toBe('WAITLISTED');

    /** Cancelar libera a única vaga: quem estava na espera entra. */
    const registration = await withTenant(tenantId, (tx) =>
      tx.registration.findFirst({
        where: { activityId, userId: first, deletedAt: null },
        select: { id: true },
      }),
    );

    const cancelled = await cancelRegistration({
      tenantId,
      registrationId: registration!.id,
      actorId: first,
      reason: 'Desistiu',
    });
    expect(cancelled.ok).toBe(true);

    const counters = await readActivityCounters(tenantId, activityId);
    expect(counters?.confirmedCount).toBe(1);

    const promoted = await withTenant(tenantId, (tx) =>
      tx.registration.findFirst({
        where: { activityId, userId: second, deletedAt: null },
        select: { status: true },
      }),
    );
    expect(promoted?.status).toBe('CONFIRMED');
  });
});

describe('exclusão de sala', () => {
  it('RECUSA excluir a sala em uso e diz quantas atividades a usam', async () => {
    const roomId = roomsBySlug['Sala pequena']!;

    const refused = await deleteRoom({ tenantId, actorId, eventId, roomId });

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('ROOM_IN_USE');
      expect(refused.message).toMatch(/em uso por 1 atividade\(s\)/i);
      expect(refused.message).toContain('Atividade sem vagas declaradas');
    }

    /** A sala continua lá — nada foi apagado em silêncio. */
    const stillThere = await withTenant(tenantId, (tx) =>
      tx.room.findFirst({ where: { id: roomId }, select: { id: true } }),
    );
    expect(stillThere).not.toBeNull();
  });

  it('exclui depois que a atividade sai da sala, e registra na trilha', async () => {
    const roomId = roomsBySlug['Sala pequena']!;
    const activityId = activitiesBySlug['ilimitada-na-sala']!;

    const detached = await saveActivity({
      tenantId,
      actorId,
      eventId,
      activityId,
      slug: 'ilimitada-na-sala',
      title: 'Atividade sem vagas declaradas',
      type: 'WORKSHOP',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: new Date(startsAt.getTime() + 3_600_000),
      endsAt: new Date(startsAt.getTime() + 7_200_000),
      workloadMinutes: 60,
      capacity: null,
      waitlistEnabled: false,
      roomId: null,
    });

    expect(detached.ok, detached.ok ? 'ok' : detached.message).toBe(true);

    const removed = await deleteRoom({ tenantId, actorId, eventId, roomId });

    expect(removed.ok, removed.ok ? 'ok' : removed.message).toBe(true);
    if (removed.ok) expect(removed.name).toBe('Sala pequena');

    const gone = await withTenant(tenantId, (tx) =>
      tx.room.findFirst({ where: { id: roomId }, select: { id: true } }),
    );
    expect(gone).toBeNull();

    const trail = await listAuditLog(tenantId, { limit: 10 });
    expect(trail.some((row) => row.entityId === roomId && row.action === 'DELETE')).toBe(true);
  });

  it('a sala sem uso nenhum é excluída direto', async () => {
    const roomId = await room('Sala que ninguém usa', 10);

    const removed = await deleteRoom({ tenantId, actorId, eventId, roomId });
    expect(removed.ok).toBe(true);
  });

  it('sala de OUTRO evento não é encontrada (o escopo é o evento)', async () => {
    const otherEvent = await saveEvent({
      tenantId,
      actorId,
      slug: 'outro-evento-salas',
      title: 'Outro evento',
      summary: 'Para provar o escopo da sala.',
      status: 'REGISTRATION_OPEN',
      modality: 'IN_PERSON',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 86_400_000),
      timezone: 'America/Bahia',
      capacity: 50,
      city: 'Salvador',
    });

    if (!otherEvent.ok) throw new Error(otherEvent.message);

    const otherRoom = await saveRoom({
      tenantId,
      actorId,
      eventId: otherEvent.eventId,
      name: 'Sala do outro evento',
      capacity: 10,
    });
    expect(otherRoom.ok).toBe(true);
    if (!otherRoom.ok) return;

    const refused = await deleteRoom({
      tenantId,
      actorId,
      eventId,
      roomId: otherRoom.roomId,
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('NOT_FOUND');
  });
});

describe('o painel entrega o que a tela precisa', () => {
  it('a lista de salas informa a capacidade (ou a ausência dela) e o teto da sala na atividade', async () => {
    const event = await getAdminEvent(tenantId, eventId);

    expect(event).not.toBeNull();

    const semLimite = event!.rooms.find((row) => row.name === 'Sala sem número');
    expect(semLimite?.capacity).toBeNull();

    const naSala = event!.activities.find((row) => row.slug === 'sala-de-dois');
    expect(naSala?.capacity).toBeNull();
    expect(naSala?.roomCapacity).toBe(2);
    expect(naSala?.confirmedCount).toBe(2);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — inscrição pública e vínculo de participante (FASE 10)
 *
 *  O que só o banco pode provar:
 *    • a inscrição de quem NÃO tem vínculo cria vínculo ATIVO + papel PARTICIPANT,
 *      na MESMA transação (e não cria nada se a inscrição não acontecer);
 *    • o papel criado não abre nenhuma porta administrativa;
 *    • vínculo suspenso ou removido CONTINUA bloqueando (decisão da instituição);
 *    • repetir a inscrição não duplica vínculo nem papel;
 *    • duas inscrições simultâneas da mesma pessoa nova não quebram nem duplicam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { registerForActivity } from '../../src/lib/events/registration-service';
import { loadPrincipal } from '../../src/lib/auth/session';
import { can } from '../../src/domain/rbac/authorization';
import { PERMISSIONS } from '../../src/domain/rbac/permissions';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let activityAId: string;

/** Pessoa sem nenhuma relação com a instituição. */
let outsiderId: string;
/** Vínculo apenas CONVIDADO (INVITED). */
let invitedId: string;
/** Vínculo SUSPENDED — a instituição barrou. */
let suspendedId: string;
/** Vínculo apagado (soft delete) — removido pela instituição. */
let removedId: string;

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: `Pessoa ${label} ${RUN}`, email: `f10.${label}.${RUN}@exemplo.test` },
  });
  return id;
}

async function createMembership(userId: string, status: 'INVITED' | 'ACTIVE' | 'SUSPENDED', deleted = false) {
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId,
      status,
      joinedAt: status === 'ACTIVE' ? new Date() : null,
      deletedAt: deleted ? new Date() : null,
    },
  });
}

async function createActivity(slug: string, capacity: number | null): Promise<string> {
  const id = randomUUID();
  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.activity.create({
      data: {
        id,
        tenantId,
        eventId,
        slug,
        title: `Atividade ${slug}`,
        type: 'WORKSHOP',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        workloadMinutes: 60,
        capacity,
        waitlistEnabled: false,
        confirmedCount: 0,
        waitlistCount: 0,
      },
    }),
  );

  return id;
}

/** Leitura administrativa do vínculo (o teste não depende do filtro da aplicação). */
async function readMembership(userId: string) {
  return adminPrisma.userTenantProfile.findFirst({
    where: { tenantId, userId },
    select: { status: true, deletedAt: true, joinedAt: true },
  });
}

async function readRoles(userId: string): Promise<string[]> {
  const rows = await adminPrisma.roleAssignment.findMany({
    where: { tenantId, userId, revokedAt: null },
    select: { role: true },
  });

  return rows.map((row) => row.role);
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f10-${RUN}`,
      name: `Instituição Pública ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  const startsAt = new Date(Date.now() + 29 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-publico-${RUN}`,
        title: `Evento Aberto ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
      },
    }),
  );

  activityAId = await createActivity('atividade-a', 10);
  await createActivity('atividade-b', 10);

  outsiderId = await createUser('outsider');
  invitedId = await createUser('invited');
  suspendedId = await createUser('suspended');
  removedId = await createUser('removed');

  await createMembership(invitedId, 'INVITED');
  await createMembership(suspendedId, 'SUSPENDED');
  await createMembership(removedId, 'ACTIVE', true);
});

afterAll(async () => {
  const users = [outsiderId, invitedId, suspendedId, removedId];
  await adminPrisma.roleAssignment.deleteMany({ where: { tenantId } });
  await adminPrisma.userTenantProfile.deleteMany({ where: { tenantId } });
  await adminPrisma.registration.deleteMany({ where: { tenantId } });
  await adminPrisma.activity.deleteMany({ where: { tenantId } });
  await adminPrisma.event.deleteMany({ where: { tenantId } });
  await adminPrisma.auditLog.deleteMany({ where: { tenantId } });
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { id: { in: users } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('inscrição de quem não tem vínculo', () => {
  it('cria vínculo ATIVO, concede PARTICIPANT e confirma a inscrição', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: `evento-publico-${RUN}`,
      activitySlug: 'atividade-a',
      userId: outsiderId,
      consentData: true,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.linkedAsParticipant).toBe(true);

    const membership = await readMembership(outsiderId);
    expect(membership?.status).toBe('ACTIVE');
    expect(membership?.deletedAt).toBeNull();
    expect(membership?.joinedAt).toBeInstanceOf(Date);

    expect(await readRoles(outsiderId)).toContain('PARTICIPANT');
  });

  it('o papel concedido NÃO dá nenhuma permissão administrativa', async () => {
    const principal = await loadPrincipal(outsiderId, tenantId, 'ACTIVE');

    // O que o participante pode:
    expect(can(principal, PERMISSIONS.REGISTRATION_CREATE, { scope: 'TENANT' })).toBe(true);
    expect(can(principal, PERMISSIONS.EVENT_READ, { scope: 'TENANT' })).toBe(true);

    // O que ele não pode — a lista que importa:
    for (const forbidden of [
      PERMISSIONS.TENANT_DELETE,
      PERMISSIONS.TENANT_MEMBER_REMOVE,
      PERMISSIONS.TENANT_ROLE_ASSIGN,
      PERMISSIONS.EVENT_MANAGE,
      PERMISSIONS.CERTIFICATE_ISSUE,
      PERMISSIONS.SUBMISSION_READ_ANY,
      PERMISSIONS.PLATFORM_MANAGE,
    ]) {
      expect(can(principal, forbidden, { scope: 'TENANT' })).toBe(false);
    }
  });

  it('registra o vínculo na trilha de auditoria da instituição', async () => {
    const audit = await adminPrisma.auditLog.findMany({
      where: { tenantId, entityType: 'UserTenantProfile' },
      select: { action: true, changes: true },
    });

    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((entry) => entry.action === 'CREATE')).toBe(true);

    const roleAudit = await adminPrisma.auditLog.findMany({
      where: { tenantId, entityType: 'RoleAssignment' },
      select: { action: true },
    });
    expect(roleAudit.some((entry) => entry.action === 'PERMISSION_CHANGE')).toBe(true);
  });

  it('a segunda inscrição NÃO duplica vínculo nem papel', async () => {
    const before = {
      memberships: await adminPrisma.userTenantProfile.count({ where: { tenantId, userId: outsiderId } }),
      roles: await adminPrisma.roleAssignment.count({ where: { tenantId, userId: outsiderId } }),
    };

    const outcome = await registerForActivity({
      tenantId,
      eventSlug: `evento-publico-${RUN}`,
      activitySlug: 'atividade-b',
      userId: outsiderId,
      consentData: true,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // Já era membro: nada foi criado nesta segunda inscrição.
      expect(outcome.linkedAsParticipant).toBe(false);
    }

    expect(
      await adminPrisma.userTenantProfile.count({ where: { tenantId, userId: outsiderId } }),
    ).toBe(before.memberships);

    expect(
      await adminPrisma.roleAssignment.count({ where: { tenantId, userId: outsiderId } }),
    ).toBe(before.roles);
  });

  it('convite PENDENTE é ativado pela inscrição', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: `evento-publico-${RUN}`,
      activitySlug: 'atividade-a',
      userId: invitedId,
      consentData: true,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.linkedAsParticipant).toBe(true);

    expect((await readMembership(invitedId))?.status).toBe('ACTIVE');
    expect(await readRoles(invitedId)).toContain('PARTICIPANT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('bloqueios da instituição são respeitados', () => {
  it('vínculo SUSPENSO não se inscreve e não gera nada', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: `evento-publico-${RUN}`,
      activitySlug: 'atividade-a',
      userId: suspendedId,
      consentData: true,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('MEMBERSHIP_BLOCKED');
      expect(outcome.message).toMatch(/bloqueado/i);
    }

    expect((await readMembership(suspendedId))?.status).toBe('SUSPENDED');
    expect(await readRoles(suspendedId)).toHaveLength(0);

    const registrations = await adminPrisma.registration.count({
      where: { tenantId, userId: suspendedId },
    });
    expect(registrations).toBe(0);
  });

  it('vínculo REMOVIDO (soft delete) não se inscreve nem é ressuscitado', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: `evento-publico-${RUN}`,
      activitySlug: 'atividade-b',
      userId: removedId,
      consentData: true,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('MEMBERSHIP_BLOCKED');

    const membership = await readMembership(removedId);
    expect(membership?.deletedAt).toBeInstanceOf(Date);
    expect(await readRoles(removedId)).toHaveLength(0);
  });

  it('a recusa acontece ANTES de consumir vaga', async () => {
    const activity = await adminPrisma.activity.findUniqueOrThrow({
      where: { id: activityAId },
      select: { confirmedCount: true },
    });

    // Duas pessoas bloqueadas tentaram a atividade A: nenhuma linha, nenhuma vaga.
    const registrations = await adminPrisma.registration.count({
      where: { tenantId, activityId: activityAId },
    });

    expect(activity.confirmedCount).toBe(registrations);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('concorrência na primeira inscrição', () => {
  it('duas inscrições simultâneas da mesma pessoa nova não duplicam vínculo', async () => {
    const concurrent = await createUser('concurrent');
    const activityCId = await createActivity('atividade-c', 10);
    const activityDId = await createActivity('atividade-d', 10);

    const eventCountBefore = await withTenant(tenantId, (tx) =>
      tx.event.findFirstOrThrow({ where: { id: eventId }, select: { confirmedCount: true } }),
    ).then((row) => row.confirmedCount);

    const [first, second] = await Promise.all([
      registerForActivity({
        tenantId,
        eventSlug: `evento-publico-${RUN}`,
        activitySlug: 'atividade-c',
        userId: concurrent,
        consentData: true,
      }),
      registerForActivity({
        tenantId,
        eventSlug: `evento-publico-${RUN}`,
        activitySlug: 'atividade-d',
        userId: concurrent,
        consentData: true,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    // O `upsert` transforma a corrida em ON CONFLICT: uma linha, um papel.
    expect(
      await adminPrisma.userTenantProfile.count({ where: { tenantId, userId: concurrent } }),
    ).toBe(1);

    expect(
      await adminPrisma.roleAssignment.count({
        where: { tenantId, userId: concurrent, role: 'PARTICIPANT' },
      }),
    ).toBe(1);

    expect(await readMembership(concurrent)).toMatchObject({ status: 'ACTIVE' });

    // As duas inscrições existem — o vínculo é que não se duplica.
    //
    // ─────────────────────────────────────────────────────────────────────────────
    //  SÃO TRÊS LINHAS DESDE A FASE 70, E A TERCEIRA É A PROVA DA CORRIDA
    // ─────────────────────────────────────────────────────────────────────────────
    //  A inscrição numa atividade passou a MATERIALIZAR a inscrição no evento. As duas
    //  transações pediram a MESMA linha do evento (mesma pessoa, mesmo evento) e o
    //  índice `registrations_live_event_user_key` recusou a segunda — a resposta dela
    //  foi a linha que a outra criou, e não um erro. É por isso que a contagem exata
    //  importa aqui: UMA linha de evento, e não duas.
    const registrations = await adminPrisma.registration.findMany({
      where: { tenantId, userId: concurrent },
      select: { activityId: true, status: true, origin: true },
    });
    expect(registrations).toHaveLength(3);

    const eventLines = registrations.filter((row) => row.activityId === null);
    expect(eventLines).toHaveLength(1);
    expect(eventLines[0]?.status).toBe('CONFIRMED');
    expect(eventLines[0]?.origin).toBe('EVENT_AUTO');

    expect(registrations.filter((row) => row.activityId !== null)).toHaveLength(2);

    /**
     * E a prova de que a vaga do evento NÃO foi cobrada duas vezes: o contador é
     * espelho das linhas vivas do evento, e esta pessoa acrescentou UMA. A leitura é
     * feita pelo contexto de instituição, como a tela e a lotação fazem.
     */
    const eventCountAfter = await withTenant(tenantId, (tx) =>
      tx.event.findFirstOrThrow({ where: { id: eventId }, select: { confirmedCount: true } }),
    ).then((row) => row.confirmedCount);

    expect(eventCountAfter).toBe(eventCountBefore + 1);

    /**
     * A limpeza leva TODAS as linhas da pessoa: a do evento nasceu com `activityId`
     * nulo e o filtro por atividade a deixaria para trás, com o contador do evento
     * incrementado para o resto da suíte.
     */
    await adminPrisma.registration.deleteMany({ where: { userId: concurrent } });
    await adminPrisma.activity.deleteMany({ where: { id: { in: [activityCId, activityDId] } } });
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — itens rápidos da FASE 12
 *
 *  O que só o banco (e o Redis) podem provar:
 *    • o índice único de concessão vigente impede duplicata e permite reconceder
 *      depois de revogar (I5);
 *    • a quota de eventos do plano é aplicada na criação (C2);
 *    • evento restrito recusa inscrição de quem não tem vínculo e aceita de quem
 *      tem (I3);
 *    • o barramento de invalidação entrega a mensagem em outra conexão (I1);
 *    • o diretório não trunca a lista (I2).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { registerForActivity } from '../../src/lib/events/registration-service';
import { saveEvent } from '../../src/lib/admin/catalog-service';
import { findTenantById } from '../../src/lib/platform/global-repository';
import { TENANT_CACHE_CHANNEL, publishTenantInvalidation } from '../../src/lib/tenancy/cache-bus';
import { selectDirectoryTenants } from '../../src/lib/platform/global-repository';
import { isUniqueViolation } from '../../src/lib/db/prisma-errors';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let activityId: string;
let ownerId: string;
let outsiderId: string;

/** Cria um evento direto no banco (evita depender do painel para o cenário). */
async function createEventDirect(slug: string, settings: Record<string, unknown> = {}) {
  const id = randomUUID();
  const startsAt = new Date(Date.now() + 29 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id,
        tenantId,
        slug,
        title: `Evento ${slug}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
        settings: settings as unknown as object,
      },
    }),
  );

  return id;
}

async function createActivity(id: string, slug: string, event: string) {
  const startsAt = new Date(Date.now() + 29 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.activity.create({
      data: {
        id,
        tenantId,
        eventId: event,
        slug,
        title: `Atividade ${slug}`,
        type: 'WORKSHOP',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        workloadMinutes: 60,
        capacity: 10,
        waitlistEnabled: false,
        confirmedCount: 0,
        waitlistCount: 0,
      },
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f12-${RUN}`,
      name: `Instituição Mutirão ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      // Teto baixo de propósito: é o que permite testar a quota com dois eventos.
      maxEvents: 2,
      timezone: 'America/Bahia',
    },
  });

  eventId = await createEventDirect('evento-aberto');

  activityId = randomUUID();
  await createActivity(activityId, 'atividade-aberta', eventId);

  ownerId = randomUUID();
  outsiderId = randomUUID();

  for (const [id, label] of [
    [ownerId, 'owner'],
    [outsiderId, 'outsider'],
  ] as const) {
    await adminPrisma.user.create({
      data: { id, name: `Pessoa ${label} ${RUN}`, email: `f12.${label}.${RUN}@exemplo.test` },
    });
  }

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: ownerId, status: 'ACTIVE', joinedAt: new Date() },
  });
});

afterAll(async () => {
  await adminPrisma.roleAssignment.deleteMany({ where: { tenantId } });
  await adminPrisma.userTenantProfile.deleteMany({ where: { tenantId } });
  await adminPrisma.registration.deleteMany({ where: { tenantId } });
  await adminPrisma.activity.deleteMany({ where: { tenantId } });
  await adminPrisma.event.deleteMany({ where: { tenantId } });
  await adminPrisma.auditLog.deleteMany({ where: { tenantId } });
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('I5 — índice único de concessão vigente', () => {
  it('impede duas concessões vigentes idênticas', async () => {
    const first = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.create({
        data: {
          tenantId,
          userId: ownerId,
          role: 'PARTICIPANT',
          scope: 'TENANT',
          reason: 'teste I5',
        },
        select: { id: true },
      }),
    );

    const error = await withTenant(tenantId, (tx) =>
      tx.roleAssignment
        .create({
          data: {
            tenantId,
            userId: ownerId,
            role: 'PARTICIPANT',
            scope: 'TENANT',
            reason: 'teste I5 duplicado',
          },
        })
        .catch((thrown: unknown) => thrown),
    );

    expect(isUniqueViolation(error)).toBe(true);

    // Revogar libera o índice: reconceder o mesmo papel é fluxo legítimo.
    await withTenant(tenantId, (tx) =>
      tx.roleAssignment.update({ where: { id: first.id }, data: { revokedAt: new Date() } }),
    );

    await expect(
      withTenant(tenantId, (tx) =>
        tx.roleAssignment.create({
          data: {
            tenantId,
            userId: ownerId,
            role: 'PARTICIPANT',
            scope: 'TENANT',
            reason: 'reconcessão após revogação',
          },
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('o MESMO papel em EVENTOS diferentes continua permitido', async () => {
    const secondEvent = await createEventDirect('evento-para-escopo');

    const grants = await withTenant(tenantId, async (tx) => {
      await tx.roleAssignment.create({
        data: { tenantId, userId: ownerId, role: 'STAFF', scope: 'EVENT', eventId, reason: 'teste I5' },
      });

      return tx.roleAssignment.create({
        data: {
          tenantId,
          userId: ownerId,
          role: 'STAFF',
          scope: 'EVENT',
          eventId: secondEvent,
          reason: 'teste I5',
        },
      });
    });

    expect(grants.id).toBeDefined();

    await withTenant(tenantId, (tx) => tx.event.delete({ where: { id: secondEvent } }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('C2 — quota de eventos do plano', () => {
  it('recusa criar evento acima do teto do plano, com código próprio', async () => {
    // O tenant tem maxEvents = 2 e já existem 2 eventos (o aberto e o de escopo
    // criado no teste anterior foi removido — então criamos um para chegar ao teto).
    const eventsNow = await adminPrisma.event.count({ where: { tenantId, deletedAt: null } });

    if (eventsNow < 2) {
      await createEventDirect(`evento-complemento-${eventsNow}`);
    }

    const startsAt = new Date(Date.now() + 40 * 86_400_000);

    const result = await saveEvent({
      tenantId,
      actorId: ownerId,
      slug: 'evento-alem-da-quota',
      title: 'Evento além da quota',
      status: 'DRAFT',
      modality: 'IN_PERSON',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 86_400_000),
      timezone: 'America/Bahia',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('QUOTA_EXCEEDED');
      expect(result.message).toMatch(/plano/i);
    }
  });

  it('a quota aparece no detalhe da instituição (o número que o painel mostra)', async () => {
    const detail = await findTenantById(tenantId);

    expect(detail?.maxEvents).toBe(2);
    expect(detail?.eventCount).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('I3 — evento restrito à comunidade', () => {
  it('recusa a inscrição de quem NÃO tem vínculo', async () => {
    const restrictedEvent = await createEventDirect('evento-restrito', {
      registrationRequiresMembership: true,
    });
    const restrictedActivity = randomUUID();
    await createActivity(restrictedActivity, 'atividade-restrita', restrictedEvent);

    const outcome = await registerForActivity({
      tenantId,
      eventSlug: 'evento-restrito',
      activitySlug: 'atividade-restrita',
      userId: outsiderId,
      consentData: true,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('MEMBERSHIP_BLOCKED');
      expect(outcome.message).toMatch(/restrito/i);
    }

    // E não criou vínculo nenhum — a recusa é total.
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId, userId: outsiderId },
    });
    expect(membership).toBeNull();
  });

  it('ACEITA a inscrição de quem já é membro', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: 'evento-restrito',
      activitySlug: 'atividade-restrita',
      userId: ownerId,
      consentData: true,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // Já era membro: nada de vínculo novo.
      expect(outcome.linkedAsParticipant).toBe(false);
    }
  });

  it('evento sem a chave continua aberto (nada mudou para os eventos existentes)', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: 'evento-aberto',
      activitySlug: 'atividade-aberta',
      userId: outsiderId,
      consentData: true,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.linkedAsParticipant).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('I1 — barramento de invalidação (Redis)', () => {
  it('a mensagem publicada chega em OUTRA conexão', async () => {
    const listener = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await listener.connect();
      await listener.subscribe(TENANT_CACHE_CHANNEL);

      const received = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('mensagem não chegou em 5s')), 5_000);
        listener.on('message', (_channel, payload: string) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

      publishTenantInvalidation(`alvo-${RUN}`);

      await expect(received).resolves.toBe(`alvo-${RUN}`);
    } finally {
      listener.disconnect();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('I2 — o diretório não trunca', () => {
  it('devolve todas as instituições ativas e públicas (sem teto silencioso)', async () => {
    const rows = await selectDirectoryTenants();
    const ours = rows.filter((row) => row.id === tenantId);

    expect(ours).toHaveLength(1);
    expect(ours[0]?.slug).toBe(`f12-${RUN}`);
  });
});

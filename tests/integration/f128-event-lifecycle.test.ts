import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  archiveEvent,
  cloneEventBasicData,
  deleteEventSecurely,
} from '@/lib/admin/event-lifecycle-service';
import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let quotaTenantId: string;
let actorId: string;
let sourceEventId: string;
let quotaEventId: string;

beforeAll(async () => {
  tenantId = randomUUID();
  quotaTenantId = randomUUID();
  actorId = randomUUID();
  sourceEventId = randomUUID();
  quotaEventId = randomUUID();

  await adminPrisma.user.create({
    data: {
      id: actorId,
      email: `f128-lifecycle-${RUN}@koveno.test`,
      name: 'Organizador Ciclo de Vida F128',
      emailVerified: true,
    },
  });

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f128-acervo-${RUN}`,
        name: `Instituição F128 ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        maxEvents: 5,
        timezone: 'America/Bahia',
      },
      {
        id: quotaTenantId,
        slug: `f128-quota-${RUN}`,
        name: `Instituição Quota F128 ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        maxEvents: 1,
        timezone: 'America/Bahia',
      },
    ],
  });

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: sourceEventId,
        tenantId,
        slug: `evento-matriz-${RUN}`,
        title: 'Encontro Anual de Tecnologia',
        subtitle: 'Edição 2026',
        summary: 'Resumo institucional do evento',
        description: 'Descrição completa preservada na clonagem.',
        status: 'PUBLISHED',
        modality: 'HYBRID',
        category: 'TECNOLOGIA',
        startsAt: new Date('2026-10-10T12:00:00.000Z'),
        endsAt: new Date('2026-10-12T20:00:00.000Z'),
        timezone: 'America/Bahia',
        venueName: 'Auditório Reitoria',
        city: 'Salvador',
        state: 'BA',
        country: 'BR',
        capacity: 120,
        confirmedCount: 45,
        waitlistCount: 3,
        primaryColor: '#4F46E5',
        settings: {
          registrationRequiresMembership: true,
          registrationForm: { fields: ['cpf'] },
          api: { keyHash: 'nao-deve-clonar', prefix: 'kvn_live' },
        },
        createdById: actorId,
      },
    });

    await tx.track.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: sourceEventId,
        name: 'Trilha Original',
        slug: `trilha-orig-${RUN}`,
      },
    });
  });

  await withTenant(quotaTenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: quotaEventId,
        tenantId: quotaTenantId,
        slug: `evento-quota-${RUN}`,
        title: 'Evento Único do Plano',
        status: 'DRAFT',
        modality: 'ONLINE',
        startsAt: new Date('2026-11-01T12:00:00.000Z'),
        endsAt: new Date('2026-11-01T16:00:00.000Z'),
        timezone: 'America/Bahia',
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({
    where: { id: { in: [tenantId, quotaTenantId] } },
  });
  await adminPrisma.user.deleteMany({
    where: { id: actorId },
  });
});

describe('FASE 128 — serviço de ciclo de vida de eventos (RLS + auditoria)', () => {
  it('clona apenas dados básicos em DRAFT, descarta settings.api e respeita quota do plano', async () => {
    const cloned = await cloneEventBasicData({
      tenantId,
      actorId,
      sourceEventId,
      title: 'Encontro Anual de Tecnologia 2027',
      slug: `evento-clonado-${RUN}`,
      startsAt: new Date('2027-10-10T12:00:00.000Z'),
      endsAt: new Date('2027-10-12T20:00:00.000Z'),
    });

    expect(cloned.ok).toBe(true);
    if (!cloned.ok) return;

    await withTenant(tenantId, async (tx) => {
      const saved = await tx.event.findUniqueOrThrow({
        where: { id: cloned.eventId },
        include: { tracks: true, activities: true },
      });

      expect(saved.status).toBe('DRAFT');
      expect(saved.modality).toBe('HYBRID');
      expect(saved.venueName).toBe('Auditório Reitoria');
      expect(saved.city).toBe('Salvador');
      expect(saved.capacity).toBe(120);
      expect(saved.confirmedCount).toBe(0);
      expect(saved.waitlistCount).toBe(0);
      expect(saved.tracks).toHaveLength(0);
      expect(saved.activities).toHaveLength(0);

      const settings = (saved.settings ?? {}) as Record<string, unknown>;
      expect(settings.registrationRequiresMembership).toBe(true);
      expect(settings.api).toBeUndefined();
    });

    const quotaBlocked = await cloneEventBasicData({
      tenantId: quotaTenantId,
      actorId,
      sourceEventId: quotaEventId,
      title: 'Segundo Evento Bloqueado',
      slug: `bloqueado-quota-${RUN}`,
      startsAt: new Date('2027-01-10T12:00:00.000Z'),
      endsAt: new Date('2027-01-10T18:00:00.000Z'),
    });

    expect(quotaBlocked.ok).toBe(false);
    if (!quotaBlocked.ok) {
      expect(quotaBlocked.code).toBe('QUOTA_EXCEEDED');
    }
  });

  it('arquiva evento preservando estado anterior e permite restaurar para rascunho', async () => {
    const target = await cloneEventBasicData({
      tenantId,
      actorId,
      sourceEventId,
      title: 'Evento Para Arquivar',
      slug: `para-arquivar-${RUN}`,
      startsAt: new Date('2027-03-01T12:00:00.000Z'),
      endsAt: new Date('2027-03-02T18:00:00.000Z'),
    });
    expect(target.ok).toBe(true);
    if (!target.ok) return;

    const archived = await archiveEvent({
      tenantId,
      actorId,
      eventId: target.eventId,
      archive: true,
    });
    expect(archived).toEqual({
      ok: true,
      eventId: target.eventId,
      slug: target.slug,
      status: 'ARCHIVED',
    });

    const doubleArchive = await archiveEvent({
      tenantId,
      actorId,
      eventId: target.eventId,
      archive: true,
    });
    expect(doubleArchive.ok).toBe(false);

    const restored = await archiveEvent({
      tenantId,
      actorId,
      eventId: target.eventId,
      archive: false,
    });
    expect(restored).toEqual({
      ok: true,
      eventId: target.eventId,
      slug: target.slug,
      status: 'DRAFT',
    });
  });

  it('recusa exclusão sem EXCLUIR/senha correta e, ao confirmar, faz soft-delete liberando o slug', async () => {
    const disposableSlug = `descartavel-${RUN}`;
    const created = await cloneEventBasicData({
      tenantId,
      actorId,
      sourceEventId,
      title: 'Evento Descartável',
      slug: disposableSlug,
      startsAt: new Date('2027-05-01T12:00:00.000Z'),
      endsAt: new Date('2027-05-01T18:00:00.000Z'),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const badWord = await deleteEventSecurely({
      tenantId,
      actorId,
      eventId: created.eventId,
      confirmationWord: 'DELETAR',
      currentPassword: 'ok',
      verifyPassword: async () => true,
    });
    expect(badWord).toMatchObject({ ok: false, code: 'INVALID_CONFIRMATION_WORD' });

    const badPass = await deleteEventSecurely({
      tenantId,
      actorId,
      eventId: created.eventId,
      confirmationWord: 'EXCLUIR',
      currentPassword: 'errada',
      verifyPassword: async () => false,
    });
    expect(badPass).toMatchObject({ ok: false, code: 'INVALID_PASSWORD' });

    const deleted = await deleteEventSecurely({
      tenantId,
      actorId,
      eventId: created.eventId,
      confirmationWord: 'excluir',
      currentPassword: 'correta',
      verifyPassword: async () => true,
    });
    expect(deleted).toEqual({
      ok: true,
      eventId: created.eventId,
      previousSlug: disposableSlug,
    });

    await withTenant(tenantId, async (tx) => {
      const removedRow = await tx.event.findUniqueOrThrow({
        where: { id: created.eventId },
        select: { deletedAt: true, status: true, slug: true },
      });
      expect(removedRow.deletedAt).not.toBeNull();
      expect(removedRow.status).toBe('ARCHIVED');
      expect(removedRow.slug).not.toBe(disposableSlug);

      const deleteAudit = await tx.auditLog.findFirst({
        where: {
          tenantId,
          action: 'DELETE',
          entityType: 'event',
          entityId: created.eventId,
        },
      });
      expect(deleteAudit).not.toBeNull();
    });

    const reusedSlug = await cloneEventBasicData({
      tenantId,
      actorId,
      sourceEventId,
      title: 'Evento Que Reutilizou Slug',
      slug: disposableSlug,
      startsAt: new Date('2027-06-01T12:00:00.000Z'),
      endsAt: new Date('2027-06-01T18:00:00.000Z'),
    });
    expect(reusedSlug.ok).toBe(true);
  });
});

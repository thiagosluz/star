import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cloneInstitutionalTemplateToEvent,
  getCertificateTemplate,
  saveCertificateTemplate,
} from '@/lib/certificates/certificate-template-service';
import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let actorId: string;
let eventId: string;
let institutionalTemplateId: string;

beforeAll(async () => {
  tenantId = randomUUID();
  actorId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.user.create({
    data: {
      id: actorId,
      email: `f132-cert-${RUN}@koveno.test`,
      name: 'Organizador F132',
      emailVerified: true,
    },
  });

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f132-cert-${RUN}`,
      name: `Instituição F132 ${RUN}`,
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
        slug: `evento-f132-${RUN}`,
        title: 'Congresso F132',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-12-01T12:00:00.000Z'),
        endsAt: new Date('2026-12-02T18:00:00.000Z'),
        timezone: 'America/Bahia',
      },
    });
  });

  const saved = await saveCertificateTemplate({
    tenantId,
    actorId,
    name: 'Padrão Institucional F132',
    eventId: null,
    kind: 'PARTICIPATION',
    presetId: 'classico-institucional',
  });
  if (!saved.ok) {
    throw new Error(`Falha ao criar modelo padrão: ${saved.message}`);
  }
  institutionalTemplateId = saved.templateId;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { id: actorId } });
});

describe('FASE 132 — clonagem de modelo institucional para evento (RLS)', () => {
  it('clona o modelo padrão para o evento preservando layout e recusa duplicata do mesmo tipo', async () => {
    const cloned = await cloneInstitutionalTemplateToEvent({
      tenantId,
      actorId,
      sourceTemplateId: institutionalTemplateId,
      targetEventId: eventId,
    });

    expect(cloned.ok).toBe(true);
    if (!cloned.ok) return;

    const loaded = await getCertificateTemplate(tenantId, cloned.templateId, { eventId });
    expect(loaded).not.toBeNull();
    expect(loaded?.eventId).toBe(eventId);
    expect(loaded?.kind).toBe('PARTICIPATION');
    expect(loaded?.name).toBe('Padrão Institucional F132 (Evento)');
    expect(loaded?.layout.elements.length).toBeGreaterThan(0);

    // Segunda clonagem para o mesmo evento + mesmo tipo respeita unicidade
    const duplicate = await cloneInstitutionalTemplateToEvent({
      tenantId,
      actorId,
      sourceTemplateId: institutionalTemplateId,
      targetEventId: eventId,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.code).toBe('INVALID_INPUT');
    }
  });
});

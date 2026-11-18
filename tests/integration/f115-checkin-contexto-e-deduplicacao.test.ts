import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  checkIn,
  checkOut,
  listCheckinQueue,
} from '../../src/lib/events/attendance-service';

const RUN = randomUUID().slice(0, 8);
const SLUG = `f115-ctx-${RUN}`;

let tenantId: string;
let staffId: string;
let brunoId: string;
let anaId: string;
let eventId: string;
let ceremonyId: string;
let rustCourseId: string;
let brunoRustRegId: string;
let anaEventRegId: string;

describe('FASE 115 — Deduplicação por participante e registro manual em Portaria × Atividade', () => {
  beforeAll(async () => {
    tenantId = randomUUID();
    staffId = randomUUID();
    brunoId = randomUUID();
    anaId = randomUUID();
    eventId = randomUUID();
    ceremonyId = randomUUID();
    rustCourseId = randomUUID();
    brunoRustRegId = randomUUID();
    anaEventRegId = randomUUID();

    await adminPrisma.tenant.create({
      data: {
        id: tenantId,
        name: `Instituição F115 ${RUN}`,
        slug: SLUG,
        status: 'ACTIVE',
      },
    });

    await adminPrisma.user.createMany({
      data: [
        { id: staffId, name: 'Equipe F115', email: `staff.${RUN}@f115.test`, emailVerified: true },
        { id: brunoId, name: 'Bruno Souza', email: `bruno.${RUN}@f115.test`, emailVerified: true },
        { id: anaId, name: 'Ana Oliveira', email: `ana.${RUN}@f115.test`, emailVerified: true },
      ],
    });

    const startsAt = new Date(Date.now() - 3_600_000);
    const endsAt = new Date(Date.now() + 86_400_000);

    await withTenant(tenantId, async (tx) => {
      await tx.event.create({
        data: {
          id: eventId,
          tenantId,
          title: `Congresso F115 ${RUN}`,
          slug: `congresso-f115-${RUN}`,
          status: 'IN_PROGRESS',
          modality: 'IN_PERSON',
          startsAt,
          endsAt,
        },
      });

      await tx.activity.createMany({
        data: [
          {
            id: ceremonyId,
            tenantId,
            eventId,
            title: 'Cerimônia de abertura e conferência magna',
            slug: `cerimonia-${RUN}`,
            type: 'LECTURE',
            status: 'SCHEDULED',
            modality: 'IN_PERSON',
            startsAt,
            endsAt,
            workloadMinutes: 90,
            checkInEnabled: true,
            requiresRegistration: false,
          },
          {
            id: rustCourseId,
            tenantId,
            eventId,
            title: 'Minicurso: Programação em Rust',
            slug: `rust-${RUN}`,
            type: 'MINI_COURSE',
            status: 'SCHEDULED',
            modality: 'IN_PERSON',
            startsAt,
            endsAt,
            workloadMinutes: 240,
            checkInEnabled: true,
            requiresRegistration: true,
          },
        ],
      });

      // Ana tem inscrição no evento + inscrição no minicurso (2 linhas no banco).
      // Bruno tem inscrição de minicurso já atendida anteriormente (como no seed ufba-demo).
      const past = new Date(Date.now() - 2 * 3_600_000);
      await tx.registration.createMany({
        data: [
          {
            id: anaEventRegId,
            tenantId,
            eventId,
            activityId: null,
            userId: anaId,
            status: 'CONFIRMED',
          },
          {
            id: randomUUID(),
            tenantId,
            eventId,
            activityId: rustCourseId,
            userId: anaId,
            status: 'CONFIRMED',
          },
          {
            id: brunoRustRegId,
            tenantId,
            eventId,
            activityId: rustCourseId,
            userId: brunoId,
            status: 'ATTENDED',
            checkedInAt: past,
            checkedInById: staffId,
          },
        ],
      });

      await tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: rustCourseId,
          registrationId: brunoRustRegId,
          userId: brunoId,
          status: 'PRESENT',
          source: 'MANUAL_STAFF',
          checkedInAt: past,
          checkedOutAt: new Date(past.getTime() + 240 * 60_000),
          minutesAttended: 240,
          validatedById: staffId,
        },
      });
    });
  });

  afterAll(async () => {
    await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
    await adminPrisma.user.deleteMany({ where: { id: { in: [staffId, brunoId, anaId] } } });
  });

  it('deduplicateByUser consolida 1 linha por pessoa em ordem alfabética (Ana, Bruno)', async () => {
    const queue = await listCheckinQueue(tenantId, eventId, { deduplicateByUser: true });
    expect(queue.ok).toBe(true);
    if (!queue.ok) return;

    expect(queue.total).toBe(2);
    expect(queue.entries.map((e) => e.userName)).toEqual(['Ana Oliveira', 'Bruno Souza']);

    const ana = queue.entries[0]!;
    expect(ana.registrationId).toBe(anaEventRegId);
    expect(ana.hasEventRegistration).toBe(true);
    expect(ana.registeredActivityIds).toEqual([rustCourseId]);

    const bruno = queue.entries[1]!;
    expect(bruno.isInside).toBe(false);
  });

  it('credencia Bruno na Portaria (EVENT) mesmo com inscrição de minicurso já atendida no passado', async () => {
    const portariaIn = await checkIn({
      tenantId,
      registrationId: brunoRustRegId,
      staffUserId: staffId,
      contextKind: 'EVENT',
    });
    expect(portariaIn.ok).toBe(true);
    if (!portariaIn.ok) return;
    expect(portariaIn.alreadyCheckedIn).toBe(false);

    const queueDuringPortaria = await listCheckinQueue(tenantId, eventId, {
      deduplicateByUser: true,
    });
    expect(queueDuringPortaria.ok).toBe(true);
    if (queueDuringPortaria.ok) {
      const bruno = queueDuringPortaria.entries.find((e) => e.userId === brunoId);
      expect(bruno?.openSessionsByContext?.EVENT).toBeInstanceOf(Date);
      expect(bruno?.openSessionsByContext?.[ceremonyId]).toBeUndefined();
    }

    const portariaOut = await checkOut({
      tenantId,
      registrationId: brunoRustRegId,
      staffUserId: staffId,
      contextKind: 'EVENT',
    });
    expect(portariaOut.ok).toBe(true);
  });

  it('credencia e registra saída de Bruno na Cerimônia de Abertura (atividade aberta sem inscrição própria)', async () => {
    const tIn = new Date(Date.now() - 35 * 60_000);
    const ceremonyIn = await checkIn({
      tenantId,
      registrationId: brunoRustRegId,
      staffUserId: staffId,
      contextKind: 'ACTIVITY',
      targetActivityId: ceremonyId,
      now: tIn,
    });
    expect(ceremonyIn.ok).toBe(true);
    if (!ceremonyIn.ok) return;
    expect(ceremonyIn.alreadyCheckedIn).toBe(false);
    expect(ceremonyIn.contextTitle).toBe('Cerimônia de abertura e conferência magna');
    expect(ceremonyIn.warning).toBeNull();

    const queueInCeremony = await listCheckinQueue(tenantId, eventId, {
      deduplicateByUser: true,
    });
    expect(queueInCeremony.ok).toBe(true);
    if (queueInCeremony.ok) {
      const bruno = queueInCeremony.entries.find((e) => e.userId === brunoId);
      expect(bruno?.openSessionsByContext?.[ceremonyId]).toBeInstanceOf(Date);
      expect(bruno?.openSessionsByContext?.EVENT).toBeUndefined();
    }

    const ceremonyOut = await checkOut({
      tenantId,
      registrationId: brunoRustRegId,
      staffUserId: staffId,
      contextKind: 'ACTIVITY',
      targetActivityId: ceremonyId,
      now: new Date(),
    });
    expect(ceremonyOut.ok).toBe(true);
    if (ceremonyOut.ok) {
      expect(ceremonyOut.minutesAttended).toBeGreaterThanOrEqual(34);
    }
  });
});

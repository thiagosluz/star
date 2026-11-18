/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Autocredenciamento, Antifraude e RLS (FASE 113)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  deleteSelfCheckinPoint,
  getPublicSelfCheckinPoint,
  getSelfCheckinConsoleData,
  regenerateSelfCheckinPoint,
  saveEventSelfCheckinPolicy,
  submitSelfCheckin,
  upsertSelfCheckinPoint,
} from '../../src/lib/events/self-checkin-service';
import { currentTotpWindow } from '../../src/lib/events/self-checkin-totp';

const RUN = randomUUID().slice(0, 8);
const SLUG_A = `f113-a-${RUN}`;
const SLUG_B = `f113-b-${RUN}`;

let tenantAId: string;
let tenantBId: string;
let staffId: string;
let userId: string;
let eventId: string;
let activity1Id: string;
let activity2Id: string;
let regEventId: string;
let regAct1Id: string;
let regAct2Id: string;

beforeAll(async () => {
  tenantAId = randomUUID();
  tenantBId = randomUUID();
  staffId = randomUUID();
  userId = randomUUID();
  eventId = randomUUID();
  activity1Id = randomUUID();
  activity2Id = randomUUID();
  regEventId = randomUUID();
  regAct1Id = randomUUID();
  regAct2Id = randomUUID();

  await adminPrisma.user.createMany({
    data: [
      { id: staffId, email: `staff-f113-${RUN}@teste.local`, name: 'Organizador F113', emailVerified: true },
      { id: userId, email: `part-f113-${RUN}@teste.local`, name: 'Participante F113', emailVerified: true },
    ],
  });

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantAId,
        slug: SLUG_A,
        name: 'Instituto Alfa F113',
        status: 'ACTIVE',
        isPublic: true,
        plan: 'PROFESSIONAL',
        timezone: 'America/Bahia',
      },
      {
        id: tenantBId,
        slug: SLUG_B,
        name: 'Instituto Beta F113',
        status: 'ACTIVE',
        isPublic: true,
        plan: 'FREE',
        timezone: 'America/Bahia',
      },
    ],
  });

  const start = new Date('2026-11-17T10:00:00Z');
  const end = new Date('2026-11-18T22:00:00Z');

  await withTenant(tenantAId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId: tenantAId,
        slug: `evento-f113-${RUN}`,
        title: 'Simpósio de Segurança F113',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: start,
        endsAt: end,
        timezone: 'America/Bahia',
        settings: { registrationRequiresMembership: true },
      },
    });

    await tx.activity.createMany({
      data: [
        {
          id: activity1Id,
          tenantId: tenantAId,
          eventId,
          slug: `act1-${RUN}`,
          title: 'Oficina 1 — Criptografia',
          type: 'WORKSHOP',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: start,
          endsAt: end,
          workloadMinutes: 60,
          checkInEnabled: true,
          requiresAttendance: true,
          requiresRegistration: true,
        },
        {
          id: activity2Id,
          tenantId: tenantAId,
          eventId,
          slug: `act2-${RUN}`,
          title: 'Oficina 2 — Redes',
          type: 'WORKSHOP',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: start,
          endsAt: end,
          workloadMinutes: 60,
          checkInEnabled: true,
          requiresAttendance: true,
          requiresRegistration: true,
        },
      ],
    });

    await tx.registration.createMany({
      data: [
        { id: regEventId, tenantId: tenantAId, eventId, activityId: null, userId, status: 'CONFIRMED' },
        { id: regAct1Id, tenantId: tenantAId, eventId, activityId: activity1Id, userId, status: 'CONFIRMED' },
        { id: regAct2Id, tenantId: tenantAId, eventId, activityId: activity2Id, userId, status: 'CONFIRMED' },
      ],
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await adminPrisma.user.deleteMany({ where: { id: { in: [staffId, userId] } } });
});

describe('FASE 113 — Autocredenciamento com Geofence, PIN, TOTP, Anti-Ubiquidade e RLS', () => {
  it('salva política antifraude preservando chaves anteriores em Event.settings', async () => {
    const missingCoords = await saveEventSelfCheckinPolicy({
      tenantId: tenantAId,
      eventId,
      actorId: staffId,
      latitude: null,
      longitude: null,
      policy: { enabled: true, requireGeo: true },
    });
    expect(missingCoords.ok).toBe(false);
    if (!missingCoords.ok) expect(missingCoords.code).toBe('EVENT_LOCATION_MISSING');

    const saved = await saveEventSelfCheckinPolicy({
      tenantId: tenantAId,
      eventId,
      actorId: staffId,
      latitude: -12.9999,
      longitude: -38.5108,
      policy: {
        enabled: true,
        requireGeo: true,
        geoRadiusMeters: 180,
        maxAccuracyMeters: 250,
        requireEventArrivalBeforeActivity: true,
        blockConcurrentActivity: true,
        allowUnregistered: false,
        checkoutCooldownMinutes: 2,
      },
    });
    expect(saved.ok).toBe(true);

    const row = await withTenant(tenantAId, (tx) =>
      tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { settings: true } }),
    );
    expect((row.settings as Record<string, unknown>).registrationRequiresMembership).toBe(true);
  });

  it('isola self_checkin_points por RLS e revoga o token anterior na regeneração', async () => {
    const portaria = await upsertSelfCheckinPoint({
      tenantId: tenantAId,
      eventId,
      activityId: null,
      actorId: staffId,
      isActive: true,
      pinRequired: true,
    });
    expect(portaria.ok).toBe(true);
    if (!portaria.ok) return;

    // Tenant B não enxerga ponto do Tenant A.
    const crossRead = await getPublicSelfCheckinPoint({
      tenantId: tenantBId,
      token: portaria.point.token,
      userId,
    });
    expect(crossRead).toBeNull();

    // Leitura pública no Tenant A nunca expõe PIN nem totpSecret.
    const pub = await getPublicSelfCheckinPoint({
      tenantId: tenantAId,
      token: portaria.point.token,
      userId,
    });
    expect(pub).not.toBeNull();
    expect(pub?.pinRequired).toBe(true);
    expect(JSON.stringify(pub)).not.toContain(portaria.point.pinCode!);

    // Regenera QR: token antigo é recusado como revogado.
    const regen = await regenerateSelfCheckinPoint({
      tenantId: tenantAId,
      pointId: portaria.point.id,
      actorId: staffId,
    });
    expect(regen.ok).toBe(true);
    if (!regen.ok) return;
    expect(regen.point.token).not.toBe(portaria.point.token);

    const oldAttempt = await submitSelfCheckin({
      tenantId: tenantAId,
      token: portaria.point.token,
      userId,
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 15,
      pinCode: portaria.point.pinCode,
    });
    expect(oldAttempt.ok).toBe(false);
    if (!oldAttempt.ok) expect(oldAttempt.code).toBe('POINT_REVOKED');
  });

  it('aplica todas as camadas antifraude (PIN, GPS, chegada prévia, anti-ubiquidade e cooldown) e mascara IP', async () => {
    const consoleData = await getSelfCheckinConsoleData(tenantAId, eventId);
    const portariaToken = consoleData?.portariaPoint?.token ?? '';
    const portariaPin = consoleData?.portariaPoint?.pinCode ?? '';

    const act1Point = await upsertSelfCheckinPoint({
      tenantId: tenantAId,
      eventId,
      activityId: activity1Id,
      actorId: staffId,
      isActive: true,
      pinRequired: false,
      totpEnabled: true,
    });
    const act2Point = await upsertSelfCheckinPoint({
      tenantId: tenantAId,
      eventId,
      activityId: activity2Id,
      actorId: staffId,
      isActive: true,
      pinRequired: false,
      totpEnabled: false,
    });
    expect(act1Point.ok && act2Point.ok).toBe(true);
    if (!act1Point.ok || !act2Point.ok) return;

    const t0 = new Date('2026-11-17T14:00:00Z');

    // 1. Tenta atividade sem passar pela portaria (requireEventArrivalBeforeActivity = true).
    const noArrival = await submitSelfCheckin({
      tenantId: tenantAId,
      token: act2Point.point.token,
      userId,
      mode: 'IN',
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 20,
      now: t0,
    });
    expect(noArrival.ok).toBe(false);
    if (!noArrival.ok) expect(noArrival.code).toBe('EVENT_ARRIVAL_REQUIRED');

    // 2. Portaria: PIN errado → INVALID_PIN.
    const badPin = await submitSelfCheckin({
      tenantId: tenantAId,
      token: portariaToken,
      userId,
      mode: 'IN',
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 20,
      pinCode: '0000',
      now: t0,
    });
    expect(badPin.ok).toBe(false);
    if (!badPin.ok) expect(badPin.code).toBe('INVALID_PIN');

    // 3. Portaria: fora do raio GPS → OUT_OF_GEOFENCE.
    const farGps = await submitSelfCheckin({
      tenantId: tenantAId,
      token: portariaToken,
      userId,
      mode: 'IN',
      latitude: -13.02,
      longitude: -38.5108,
      accuracyMeters: 15,
      pinCode: portariaPin,
      now: t0,
    });
    expect(farGps.ok).toBe(false);
    if (!farGps.ok) expect(farGps.code).toBe('OUT_OF_GEOFENCE');

    // 4. Portaria: dentro do raio + PIN certo + IPv4 → sucesso com SELF_DECLARED e IP /24!
    const arrived = await submitSelfCheckin({
      tenantId: tenantAId,
      token: portariaToken,
      userId,
      mode: 'IN',
      latitude: -12.99995,
      longitude: -38.51085,
      accuracyMeters: 12,
      pinCode: portariaPin,
      ipAddress: '203.0.113.42',
      userAgent: 'Vitest-Mobile-UA',
      now: t0,
    });
    expect(arrived.ok).toBe(true);

    const arrivalAttendance = await withTenant(tenantAId, (tx) =>
      tx.attendance.findFirstOrThrow({
        where: { eventId, userId, activityId: null },
        select: { source: true, ipAddress: true, latitude: true, longitude: true },
      }),
    );
    expect(arrivalAttendance.source).toBe('SELF_DECLARED');
    expect(arrivalAttendance.ipAddress).toBe('203.0.113.0');
    expect(Number(arrivalAttendance.latitude)).toBeCloseTo(-12.99995, 4);

    // 5. Atividade 1 com código TOTP inválido vs válido.
    const act1Row = await withTenant(tenantAId, (tx) =>
      tx.selfCheckinPoint.findUniqueOrThrow({
        where: { id: act1Point.point.id },
        select: { totpSecret: true },
      }),
    );
    const totpCode = currentTotpWindow(act1Row.totpSecret!, t0).code;

    const act1BadTotp = await submitSelfCheckin({
      tenantId: tenantAId,
      token: act1Point.point.token,
      userId,
      mode: 'IN',
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 10,
      pinCode: '999999',
      now: t0,
    });
    expect(act1BadTotp.ok).toBe(false);
    if (!act1BadTotp.ok) expect(act1BadTotp.code).toBe('INVALID_PIN');

    const act1In = await submitSelfCheckin({
      tenantId: tenantAId,
      token: act1Point.point.token,
      userId,
      mode: 'IN',
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 10,
      pinCode: totpCode,
      now: t0,
    });
    expect(act1In.ok).toBe(true);

    // 6. Tenta entrar na Atividade 2 enquanto Atividade 1 está aberta → CONCURRENT_ACTIVITY_OPEN!
    const ubiquityBlocked = await submitSelfCheckin({
      tenantId: tenantAId,
      token: act2Point.point.token,
      userId,
      mode: 'IN',
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 10,
      now: t0,
    });
    expect(ubiquityBlocked.ok).toBe(false);
    if (!ubiquityBlocked.ok) expect(ubiquityBlocked.code).toBe('CONCURRENT_ACTIVITY_OPEN');

    // 7. Cooldown de saída antes de 2 minutos → COOLDOWN_ACTIVE.
    const earlyOut = await submitSelfCheckin({
      tenantId: tenantAId,
      token: act1Point.point.token,
      userId,
      mode: 'OUT',
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 10,
      pinCode: totpCode,
      now: new Date(t0.getTime() + 30_000),
    });
    expect(earlyOut.ok).toBe(false);
    if (!earlyOut.ok) expect(earlyOut.code).toBe('COOLDOWN_ACTIVE');

    // 8. Após 50 min, registra saída em Atividade 1 e desbloqueia Atividade 2!
    const tOut = new Date(t0.getTime() + 50 * 60_000);
    const outTotp = currentTotpWindow(act1Row.totpSecret!, tOut).code;
    const act1Out = await submitSelfCheckin({
      tenantId: tenantAId,
      token: act1Point.point.token,
      userId,
      mode: 'OUT',
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 10,
      pinCode: outTotp,
      now: tOut,
    });
    expect(act1Out.ok).toBe(true);
    if (act1Out.ok) {
      expect(act1Out.action).toBe('CHECKED_OUT');
      expect(act1Out.minutes).toBe(50);
    }

    const act2In = await submitSelfCheckin({
      tenantId: tenantAId,
      token: act2Point.point.token,
      userId,
      mode: 'IN',
      latitude: -12.9999,
      longitude: -38.5108,
      accuracyMeters: 10,
      now: tOut,
    });
    expect(act2In.ok).toBe(true);
  });

  it('exclui QR Code ativo devolvendo o ponto ao estado inicial, revogando o link e permitindo gerar novamente', async () => {
    const before = await getSelfCheckinConsoleData(tenantAId, eventId);
    const activePoint = before?.activities.find((a) => a.activityId === activity2Id)?.point;
    expect(activePoint).toBeTruthy();
    if (!activePoint) return;

    const deleted = await deleteSelfCheckinPoint({
      tenantId: tenantAId,
      pointId: activePoint.id,
      actorId: staffId,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.token).toBe(activePoint.token);

    // Painel volta ao estado inicial (point === null) mantendo as presenças já registradas.
    const after = await getSelfCheckinConsoleData(tenantAId, eventId);
    const clearedRow = after?.activities.find((a) => a.activityId === activity2Id);
    expect(clearedRow?.point).toBeNull();
    expect(clearedRow?.selfDeclaredCount).toBeGreaterThanOrEqual(1);

    // Link antigo passa a recusar leitura como revogado.
    const pubOld = await getPublicSelfCheckinPoint({
      tenantId: tenantAId,
      token: activePoint.token,
      userId,
    });
    expect(pubOld?.revokedAt).not.toBeNull();

    // Índice parcial liberado: permite gerar um novo QR Code limpo para a mesma atividade.
    const recreated = await upsertSelfCheckinPoint({
      tenantId: tenantAId,
      eventId,
      activityId: activity2Id,
      actorId: staffId,
      isActive: true,
    });
    expect(recreated.ok).toBe(true);
    if (recreated.ok) {
      expect(recreated.point.token).not.toBe(activePoint.token);
    }
  });
});

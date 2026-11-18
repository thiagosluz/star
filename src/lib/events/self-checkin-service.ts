/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Autocredenciamento e autocheck-in por QR Code (FASE 113)
 *
 *  Orquestra a criação/rotação de pontos de QR Code (Portaria do evento e
 *  Atividades), a política antifraude do evento (geolocalização, PIN presencial,
 *  TOTP de telão e anti-ubiquidade) e o registro transacional de presença sob RLS
 *  reutilizando `checkIn`/`checkOut` da FASE 7/31.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomInt, randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { maskIpAddress } from '@/domain/privacy/ip-privacy-rules';
import { canRecordAttendance, sessionMinutes } from '@/domain/events/attendance-rules';
import { resolveTheme } from '@/domain/events/landing-page';
import { checkIn, checkOut } from '@/lib/events/attendance-service';
import {
  DEFAULT_SELF_CHECKIN_POLICY,
  evaluateAntiUbiquity,
  evaluateCheckoutCooldown,
  evaluateGeofenceCheck,
  generateRoomPin,
  generateSelfCheckinToken,
  isValidCoordinate,
  normalizeSelfCheckinPolicy,
  normalizeSelfCheckinToken,
  parseSelfCheckinPolicy,
  type GeoPoint,
  type SelfCheckinPolicy,
} from '@/domain/events/self-checkin-rules';
import {
  currentTotpWindow,
  generateTotpSecret,
  safeComparePin,
  verifyTotpCode,
} from '@/lib/events/self-checkin-totp';
import { logger } from '@/lib/observability/logger';

export type SelfCheckinErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'POINT_REVOKED'
  | 'POINT_INACTIVE'
  | 'SELF_CHECKIN_DISABLED'
  | 'CHECKIN_DISABLED'
  | 'WINDOW_NOT_OPEN'
  | 'WINDOW_CLOSED'
  | 'ACTIVITY_CANCELED'
  | 'REGISTRATION_REQUIRED'
  | 'EVENT_ARRIVAL_REQUIRED'
  | 'INVALID_PIN'
  | 'EVENT_LOCATION_MISSING'
  | 'GEO_REQUIRED'
  | 'GEO_INVALID'
  | 'GEO_ACCURACY_LOW'
  | 'OUT_OF_GEOFENCE'
  | 'CONCURRENT_ACTIVITY_OPEN'
  | 'COOLDOWN_ACTIVE'
  | 'NOT_CONFIRMED'
  | 'INTERNAL';

export type SelfCheckinResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      code: SelfCheckinErrorCode;
      message: string;
      details?: readonly string[];
    };

export interface SelfCheckinPointSummary {
  id: string;
  eventId: string;
  activityId: string | null;
  token: string;
  isActive: boolean;
  pinRequired: boolean;
  pinCode: string | null;
  totpEnabled: boolean;
  totpCode: string | null;
  totpRemainingSeconds: number | null;
  selfDeclaredCount: number;
  createdAt: Date;
}

export interface SelfCheckinActivityRow {
  activityId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  roomName: string | null;
  modality: string;
  checkInEnabled: boolean;
  requiresRegistration: boolean;
  point: SelfCheckinPointSummary | null;
  selfDeclaredCount: number;
}

export interface SelfCheckinConsoleData {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  venueName: string | null;
  city: string | null;
  state: string | null;
  modality: string;
  latitude: number | null;
  longitude: number | null;
  policy: SelfCheckinPolicy;
  portariaPoint: SelfCheckinPointSummary | null;
  portariaSelfDeclaredCount: number;
  activities: SelfCheckinActivityRow[];
}

export interface SelfCheckinPresentation {
  pointId: string;
  tenantSlug: string;
  tenantName: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  venueName: string | null;
  activityId: string | null;
  activityTitle: string | null;
  roomName: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  token: string;
  isActive: boolean;
  revokedAt: Date | null;
  pinRequired: boolean;
  pinCode: string | null;
  totpEnabled: boolean;
  totpWindow: { code: string; remainingSeconds: number; periodSeconds: number } | null;
  policy: SelfCheckinPolicy;
  hasEventCoordinates: boolean;
  primaryColor: string | null;
}

export interface PublicSelfCheckinView {
  pointId: string;
  token: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  venueName: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  activityId: string | null;
  activityTitle: string | null;
  roomName: string | null;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  revokedAt: Date | null;
  pinRequired: boolean;
  totpEnabled: boolean;
  policy: {
    enabled: boolean;
    requireGeo: boolean;
    geoRadiusMeters: number;
    maxAccuracyMeters: number;
    requireEventArrivalBeforeActivity: boolean;
    blockConcurrentActivity: boolean;
    allowUnregistered: boolean;
    checkoutCooldownMinutes: number;
  };
  hasEventCoordinates: boolean;
  windowStatus: { ok: boolean; reason: string | null };
  participantStatus: {
    registered: boolean;
    registrationStatus: string | null;
    requiresRegistration: boolean;
    hasArrivedAtEvent: boolean;
    openSession: { attendanceId: string; checkedInAt: Date } | null;
    closedMinutes: number;
    concurrentOpenActivityTitle: string | null;
  } | null;
}

export interface SelfCheckinSubmitOutcome {
  action: 'CHECKED_IN' | 'CHECKED_OUT' | 'ALREADY_INSIDE' | 'NOT_INSIDE';
  attendanceId: string | null;
  minutes: number | null;
  distanceMeters: number | null;
  rewarded: boolean;
  xpAwarded: number;
  warnings: string[];
  message: string;
}

function toNumericCoord(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function extractEventCoords(event: {
  latitude: unknown;
  longitude: unknown;
}): GeoPoint | null {
  const latitude = toNumericCoord(event.latitude);
  const longitude = toNumericCoord(event.longitude);
  if (latitude === null || longitude === null || !isValidCoordinate(latitude, longitude)) {
    return null;
  }
  return { latitude, longitude };
}

async function uniqueSelfCheckinToken(tx: TxClient): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const token = generateSelfCheckinToken((max) => randomInt(max));
    const exists = await tx.selfCheckinPoint.findUnique({
      where: { token },
      select: { id: true },
    });
    if (!exists) return token;
  }
  throw new Error('Não foi possível gerar um token único para o ponto de autocredenciamento.');
}

function mapPointSummary(
  row: {
    id: string;
    eventId: string;
    activityId: string | null;
    token: string;
    isActive: boolean;
    pinRequired: boolean;
    pinCode: string | null;
    totpEnabled: boolean;
    totpSecret: string | null;
    createdAt: Date;
  },
  selfDeclaredCount: number,
  now: Date,
): SelfCheckinPointSummary {
  const totp = row.totpEnabled && row.totpSecret ? currentTotpWindow(row.totpSecret, now) : null;
  return {
    id: row.id,
    eventId: row.eventId,
    activityId: row.activityId,
    token: row.token,
    isActive: row.isActive,
    pinRequired: row.pinRequired,
    pinCode: row.pinCode,
    totpEnabled: row.totpEnabled,
    totpCode: totp?.code ?? null,
    totpRemainingSeconds: totp?.remainingSeconds ?? null,
    selfDeclaredCount,
    createdAt: row.createdAt,
  };
}

export interface SelfCheckinPreloadedActivity {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  modality: string;
  checkInEnabled: boolean;
  requiresRegistration: boolean;
  room: { name: string } | null;
}

export interface SelfCheckinStatusSummary {
  enabled: boolean;
  activePointsCount: number;
  hasCoordinates: boolean;
}

/**
 * Resumo leve do autocredenciamento para exibição em abas e cartões sem listar todas as atividades.
 */
export async function getSelfCheckinStatusSummary(
  tenantId: string,
  eventId: string,
  existingTx?: TxClient,
): Promise<SelfCheckinStatusSummary> {
  const run = async (tx: TxClient) => {
    const [event, activePointsCount] = await Promise.all([
      tx.event.findFirst({
        where: { id: eventId, tenantId, deletedAt: null },
        select: { latitude: true, longitude: true, settings: true },
      }),
      tx.selfCheckinPoint.count({
        where: { tenantId, eventId, revokedAt: null, isActive: true },
      }),
    ]);

    if (!event) {
      return { enabled: false, activePointsCount: 0, hasCoordinates: false };
    }

    const policy = parseSelfCheckinPolicy(event.settings);
    return {
      enabled: policy.enabled,
      activePointsCount,
      hasCoordinates: extractEventCoords(event) !== null,
    };
  };

  return existingTx ? run(existingTx) : withTenant(tenantId, run);
}

export async function getSelfCheckinConsoleData(
  tenantId: string,
  eventId: string,
  now: Date = new Date(),
  options?: {
    tx?: TxClient;
    activities?: readonly SelfCheckinPreloadedActivity[];
  },
): Promise<SelfCheckinConsoleData | null> {
  const run = async (tx: TxClient): Promise<SelfCheckinConsoleData | null> => {
    const event = await tx.event.findFirst({
      where: { id: eventId, tenantId, deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        venueName: true,
        city: true,
        state: true,
        modality: true,
        latitude: true,
        longitude: true,
        settings: true,
      },
    });

    if (!event) return null;

    const [points, activities, selfAttendances] = await Promise.all([
      tx.selfCheckinPoint.findMany({
        where: { tenantId, eventId, revokedAt: null },
        select: {
          id: true,
          eventId: true,
          activityId: true,
          token: true,
          isActive: true,
          pinRequired: true,
          pinCode: true,
          totpEnabled: true,
          totpSecret: true,
          createdAt: true,
        },
      }),
      options?.activities
        ? Promise.resolve(options.activities)
        : tx.activity.findMany({
            where: { tenantId, eventId, deletedAt: null, status: { not: 'CANCELED' } },
            orderBy: { startsAt: 'asc' },
            take: 200,
            select: {
              id: true,
              title: true,
              startsAt: true,
              endsAt: true,
              modality: true,
              checkInEnabled: true,
              requiresRegistration: true,
              room: { select: { name: true } },
            },
          }),
      tx.attendance.groupBy({
        by: ['activityId'],
        where: { tenantId, eventId, source: 'SELF_DECLARED' },
        _count: { _all: true },
      }),
    ]);

    const countByActivity = new Map<string | null, number>();
    for (const row of selfAttendances) {
      countByActivity.set(row.activityId ?? null, row._count._all);
    }

    const portariaRow = points.find((p) => p.activityId === null) ?? null;
    const portariaCount = countByActivity.get(null) ?? 0;
    const pointByActivity = new Map(
      points.filter((p) => p.activityId !== null).map((p) => [p.activityId!, p]),
    );

    return {
      eventId: event.id,
      eventTitle: event.title,
      eventSlug: event.slug,
      venueName: event.venueName,
      city: event.city,
      state: event.state,
      modality: event.modality,
      latitude: toNumericCoord(event.latitude),
      longitude: toNumericCoord(event.longitude),
      policy: parseSelfCheckinPolicy(event.settings),
      portariaPoint: portariaRow ? mapPointSummary(portariaRow, portariaCount, now) : null,
      portariaSelfDeclaredCount: portariaCount,
      activities: activities.map((act) => {
        const pt = pointByActivity.get(act.id) ?? null;
        const count = countByActivity.get(act.id) ?? 0;
        return {
          activityId: act.id,
          title: act.title,
          startsAt: act.startsAt,
          endsAt: act.endsAt,
          roomName: act.room?.name ?? null,
          modality: act.modality,
          checkInEnabled: act.checkInEnabled,
          requiresRegistration: act.requiresRegistration,
          point: pt ? mapPointSummary(pt, count, now) : null,
          selfDeclaredCount: count,
        };
      }),
    };
  };

  return options?.tx ? run(options.tx) : withTenant(tenantId, run);
}

export async function saveEventSelfCheckinPolicy(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  latitude: number | null;
  longitude: number | null;
  policy: Partial<SelfCheckinPolicy>;
}): Promise<SelfCheckinResult<{ policy: SelfCheckinPolicy }>> {
  const normalizedPolicy = normalizeSelfCheckinPolicy(input.policy);

  const hasLat = input.latitude !== null;
  const hasLng = input.longitude !== null;
  if (hasLat !== hasLng) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe latitude e longitude juntas, ou deixe ambas em branco.',
    };
  }

  if (hasLat && !isValidCoordinate(input.latitude, input.longitude)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Coordenadas inválidas. Latitude deve estar entre -90 e 90 e longitude entre -180 e 180.',
    };
  }

  if (normalizedPolicy.requireGeo && !hasLat) {
    return {
      ok: false,
      code: 'EVENT_LOCATION_MISSING',
      message: 'Para exigir geolocalização (GPS), defina a latitude e a longitude do evento.',
    };
  }

  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, settings: true, latitude: true, longitude: true },
      });

      if (!event) return null;

      const previousSettings =
        event.settings && typeof event.settings === 'object' && !Array.isArray(event.settings)
          ? (event.settings as Record<string, unknown>)
          : {};

      const nextSettings = {
        ...previousSettings,
        selfCheckin: normalizedPolicy,
      };

      await tx.event.update({
        where: { id: event.id },
        data: {
          latitude: input.latitude,
          longitude: input.longitude,
          settings: nextSettings as unknown as object,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'selfCheckinPolicy',
          entityId: event.id,
          changes: {
            enabled: { from: parseSelfCheckinPolicy(event.settings).enabled, to: normalizedPolicy.enabled },
            requireGeo: { from: parseSelfCheckinPolicy(event.settings).requireGeo, to: normalizedPolicy.requireGeo },
            geoRadiusMeters: {
              from: parseSelfCheckinPolicy(event.settings).geoRadiusMeters,
              to: normalizedPolicy.geoRadiusMeters,
            },
          },
        },
        tx,
      );

      return normalizedPolicy;
    });

    if (!outcome) {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    return { ok: true, policy: outcome };
  } catch (error) {
    logger.error(`[self-checkin] falha ao salvar política: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar a política de autocredenciamento.' };
  }
}

export async function upsertSelfCheckinPoint(input: {
  tenantId: string;
  eventId: string;
  activityId: string | null;
  actorId: string;
  isActive?: boolean;
  pinRequired?: boolean;
  rotatePin?: boolean;
  totpEnabled?: boolean;
}): Promise<SelfCheckinResult<{ point: SelfCheckinPointSummary }>> {
  try {
    const now = new Date();
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, settings: true },
      });

      if (!event) return { error: 'EVENT_NOT_FOUND' as const };

      if (input.activityId) {
        const activity = await tx.activity.findFirst({
          where: { id: input.activityId, tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
          select: { id: true },
        });
        if (!activity) return { error: 'ACTIVITY_NOT_FOUND' as const };
      }

      const existing = await tx.selfCheckinPoint.findFirst({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          activityId: input.activityId,
          revokedAt: null,
        },
        select: {
          id: true,
          eventId: true,
          activityId: true,
          token: true,
          isActive: true,
          pinRequired: true,
          pinCode: true,
          totpEnabled: true,
          totpSecret: true,
          createdAt: true,
        },
      });

      // Ao gerar o primeiro QR, liga automaticamente `selfCheckin.enabled` no evento se ainda estava desligado,
      // para evitar o defeito silencioso de gerar um cartaz que nasce recusado pela política global.
      const prevPolicy = parseSelfCheckinPolicy(event.settings);
      if (!prevPolicy.enabled && (input.isActive ?? true)) {
        const prevSettings =
          event.settings && typeof event.settings === 'object' && !Array.isArray(event.settings)
            ? (event.settings as Record<string, unknown>)
            : {};
        await tx.event.update({
          where: { id: event.id },
          data: {
            settings: {
              ...prevSettings,
              selfCheckin: { ...prevPolicy, enabled: true },
            } as unknown as object,
          },
        });
      }

      if (!existing) {
        const token = await uniqueSelfCheckinToken(tx);
        const pinRequired = input.pinRequired ?? false;
        const totpEnabled = input.totpEnabled ?? false;
        const pinCode = generateRoomPin((max) => randomInt(max));
        const totpSecret = generateTotpSecret();

        const created = await tx.selfCheckinPoint.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            eventId: input.eventId,
            activityId: input.activityId,
            token,
            isActive: input.isActive ?? true,
            pinRequired,
            pinCode,
            totpEnabled,
            totpSecret,
            createdById: input.actorId,
          },
          select: {
            id: true,
            eventId: true,
            activityId: true,
            token: true,
            isActive: true,
            pinRequired: true,
            pinCode: true,
            totpEnabled: true,
            totpSecret: true,
            createdAt: true,
          },
        });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'CREATE',
            entityType: 'selfCheckinPoint',
            entityId: created.id,
            changes: {
              eventId: { from: null, to: input.eventId },
              activityId: { from: null, to: input.activityId },
              token: { from: null, to: created.token },
              pinRequired: { from: null, to: created.pinRequired },
              totpEnabled: { from: null, to: created.totpEnabled },
            },
          },
          tx,
        );

        return { row: created };
      }

      const nextIsActive = input.isActive ?? existing.isActive;
      const nextPinRequired = input.pinRequired ?? existing.pinRequired;
      const nextTotpEnabled = input.totpEnabled ?? existing.totpEnabled;
      const nextPinCode =
        input.rotatePin || !existing.pinCode
          ? generateRoomPin((max) => randomInt(max))
          : existing.pinCode;
      const nextTotpSecret = existing.totpSecret ?? generateTotpSecret();

      const updated = await tx.selfCheckinPoint.update({
        where: { id: existing.id },
        data: {
          isActive: nextIsActive,
          pinRequired: nextPinRequired,
          pinCode: nextPinCode,
          totpEnabled: nextTotpEnabled,
          totpSecret: nextTotpSecret,
        },
        select: {
          id: true,
          eventId: true,
          activityId: true,
          token: true,
          isActive: true,
          pinRequired: true,
          pinCode: true,
          totpEnabled: true,
          totpSecret: true,
          createdAt: true,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'selfCheckinPoint',
          entityId: updated.id,
          changes: {
            isActive: { from: existing.isActive, to: updated.isActive },
            pinRequired: { from: existing.pinRequired, to: updated.pinRequired },
            totpEnabled: { from: existing.totpEnabled, to: updated.totpEnabled },
            pinRotated: { from: false, to: Boolean(input.rotatePin) },
          },
        },
        tx,
      );

      return { row: updated };
    });

    if ('error' in outcome) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message:
          outcome.error === 'EVENT_NOT_FOUND' ? 'Evento não encontrado.' : 'Atividade não encontrada neste evento.',
      };
    }

    return { ok: true, point: mapPointSummary(outcome.row, 0, now) };
  } catch (error) {
    logger.error(`[self-checkin] falha ao configurar ponto: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar o ponto de autocredenciamento.' };
  }
}

export async function regenerateSelfCheckinPoint(input: {
  tenantId: string;
  pointId: string;
  actorId: string;
}): Promise<SelfCheckinResult<{ point: SelfCheckinPointSummary }>> {
  try {
    const now = new Date();
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const current = await tx.selfCheckinPoint.findFirst({
        where: { id: input.pointId, tenantId: input.tenantId, revokedAt: null },
        select: {
          id: true,
          eventId: true,
          activityId: true,
          token: true,
          isActive: true,
          pinRequired: true,
          totpEnabled: true,
        },
      });

      if (!current) return null;

      await tx.selfCheckinPoint.update({
        where: { id: current.id },
        data: { revokedAt: now, revokedById: input.actorId, isActive: false },
      });

      const nextToken = await uniqueSelfCheckinToken(tx);
      const created = await tx.selfCheckinPoint.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          eventId: current.eventId,
          activityId: current.activityId,
          token: nextToken,
          isActive: true,
          pinRequired: current.pinRequired,
          pinCode: generateRoomPin((max) => randomInt(max)),
          totpEnabled: current.totpEnabled,
          totpSecret: generateTotpSecret(),
          createdById: input.actorId,
        },
        select: {
          id: true,
          eventId: true,
          activityId: true,
          token: true,
          isActive: true,
          pinRequired: true,
          pinCode: true,
          totpEnabled: true,
          totpSecret: true,
          createdAt: true,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'selfCheckinPoint',
          entityId: created.id,
          changes: {
            revokedPointId: { from: current.id, to: created.id },
            token: { from: current.token, to: created.token },
          },
        },
        tx,
      );

      return created;
    });

    if (!outcome) {
      return { ok: false, code: 'NOT_FOUND', message: 'Ponto de autocredenciamento não encontrado.' };
    }

    return { ok: true, point: mapPointSummary(outcome, 0, now) };
  } catch (error) {
    logger.error(`[self-checkin] falha ao regenerar QR: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível regenerar o QR Code.' };
  }
}

/**
 * Revoga e limpa o ponto de autocredenciamento ativo para que a portaria ou atividade volte
 * ao estado inicial ("QR não gerado"), preservando presenças já registradas e trilha auditável.
 */
export async function deleteSelfCheckinPoint(input: {
  tenantId: string;
  pointId: string;
  actorId: string;
}): Promise<
  SelfCheckinResult<{
    pointId: string;
    token: string;
    eventId: string;
    activityId: string | null;
  }>
> {
  try {
    const now = new Date();
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const current = await tx.selfCheckinPoint.findFirst({
        where: { id: input.pointId, tenantId: input.tenantId, revokedAt: null },
        select: {
          id: true,
          eventId: true,
          activityId: true,
          token: true,
        },
      });

      if (!current) return null;

      await tx.selfCheckinPoint.update({
        where: { id: current.id },
        data: { revokedAt: now, revokedById: input.actorId, isActive: false },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'selfCheckinPoint',
          entityId: current.id,
          changes: {
            eventId: { from: current.eventId, to: null },
            activityId: { from: current.activityId, to: null },
            token: { from: current.token, to: null },
          },
        },
        tx,
      );

      return current;
    });

    if (!outcome) {
      return { ok: false, code: 'NOT_FOUND', message: 'Ponto de autocredenciamento não encontrado.' };
    }

    return {
      ok: true,
      pointId: outcome.id,
      token: outcome.token,
      eventId: outcome.eventId,
      activityId: outcome.activityId,
    };
  } catch (error) {
    logger.error(`[self-checkin] falha ao excluir QR: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível excluir o QR Code.' };
  }
}

export async function getSelfCheckinPointPresentation(input: {
  tenantId: string;
  pointId: string;
  now?: Date;
}): Promise<SelfCheckinPresentation | null> {
  const now = input.now ?? new Date();
  return withTenant(input.tenantId, async (tx) => {
    const point = await tx.selfCheckinPoint.findFirst({
      where: { id: input.pointId, tenantId: input.tenantId },
      select: {
        id: true,
        token: true,
        isActive: true,
        revokedAt: true,
        pinRequired: true,
        pinCode: true,
        totpEnabled: true,
        totpSecret: true,
        tenant: { select: { slug: true, name: true } },
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            venueName: true,
            startsAt: true,
            endsAt: true,
            timezone: true,
            latitude: true,
            longitude: true,
            settings: true,
            theme: true,
            deletedAt: true,
          },
        },
        activity: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            deletedAt: true,
            room: { select: { name: true } },
          },
        },
      },
    });

    if (!point || point.event.deletedAt || point.activity?.deletedAt) return null;

    const policy = parseSelfCheckinPolicy(point.event.settings);
    const coords = extractEventCoords(point.event);

    return {
      pointId: point.id,
      tenantSlug: point.tenant.slug,
      tenantName: point.tenant.name,
      eventId: point.event.id,
      eventTitle: point.event.title,
      eventSlug: point.event.slug,
      venueName: point.event.venueName,
      activityId: point.activity?.id ?? null,
      activityTitle: point.activity?.title ?? null,
      roomName: point.activity?.room?.name ?? null,
      startsAt: point.activity?.startsAt ?? point.event.startsAt,
      endsAt: point.activity?.endsAt ?? point.event.endsAt,
      timezone: point.event.timezone,
      token: point.token,
      isActive: point.isActive,
      revokedAt: point.revokedAt,
      pinRequired: point.pinRequired,
      pinCode: point.pinCode,
      totpEnabled: point.totpEnabled,
      totpWindow:
        point.totpEnabled && point.totpSecret ? currentTotpWindow(point.totpSecret, now) : null,
      policy,
      hasEventCoordinates: coords !== null,
      primaryColor: resolveTheme(point.event.theme).theme.primaryColor ?? null,
    };
  });
}

export async function getPublicSelfCheckinPoint(input: {
  tenantId: string;
  token: string;
  userId: string | null;
  now?: Date;
}): Promise<PublicSelfCheckinView | null> {
  const normalizedToken = normalizeSelfCheckinToken(input.token);
  if (!normalizedToken) return null;

  const now = input.now ?? new Date();

  return withTenant(input.tenantId, async (tx) => {
    const point = await tx.selfCheckinPoint.findFirst({
      where: { tenantId: input.tenantId, token: normalizedToken },
      select: {
        id: true,
        token: true,
        eventId: true,
        activityId: true,
        isActive: true,
        revokedAt: true,
        pinRequired: true,
        totpEnabled: true,
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            venueName: true,
            city: true,
            state: true,
            startsAt: true,
            endsAt: true,
            timezone: true,
            latitude: true,
            longitude: true,
            settings: true,
            deletedAt: true,
          },
        },
        activity: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            status: true,
            checkInEnabled: true,
            checkInOpensAt: true,
            checkInClosesAt: true,
            requiresRegistration: true,
            deletedAt: true,
            room: { select: { name: true } },
          },
        },
      },
    });

    if (!point || point.event.deletedAt || point.activity?.deletedAt) return null;

    const policy = parseSelfCheckinPolicy(point.event.settings);
    const coords = extractEventCoords(point.event);

    let windowStatus: { ok: boolean; reason: string | null } = { ok: true, reason: null };
    if (point.revokedAt) {
      windowStatus = { ok: false, reason: 'Este QR Code foi revogado pela organização.' };
    } else if (!policy.enabled || !point.isActive) {
      windowStatus = { ok: false, reason: 'O autocredenciamento para este ponto está pausado no momento.' };
    } else if (point.activity) {
      const decision = canRecordAttendance({ activity: point.activity, now });
      if (!decision.ok) {
        windowStatus = { ok: false, reason: decision.message };
      }
    }

    let participantStatus: PublicSelfCheckinView['participantStatus'] = null;
    if (input.userId) {
      const [registrations, attendances] = await Promise.all([
        tx.registration.findMany({
          where: {
            tenantId: input.tenantId,
            eventId: point.eventId,
            userId: input.userId,
            deletedAt: null,
            status: { not: 'CANCELED' },
          },
          select: { activityId: true, status: true },
        }),
        tx.attendance.findMany({
          where: {
            tenantId: input.tenantId,
            eventId: point.eventId,
            userId: input.userId,
          },
          orderBy: { checkedInAt: 'desc' },
          select: {
            id: true,
            activityId: true,
            checkedInAt: true,
            checkedOutAt: true,
            minutesAttended: true,
            activity: { select: { title: true } },
          },
        }),
      ]);

      const contextActivityId = point.activityId ?? null;
      const directReg = registrations.find((r) => r.activityId === contextActivityId) ?? null;
      const eventReg = registrations.find((r) => r.activityId === null) ?? null;
      const effectiveReg =
        directReg ??
        (point.activity && !point.activity.requiresRegistration ? eventReg : null) ??
        (contextActivityId === null ? registrations[0] ?? null : null);

      const registered = Boolean(
        effectiveReg && (effectiveReg.status === 'CONFIRMED' || effectiveReg.status === 'ATTENDED'),
      );

      const contextSessions = attendances.filter((a) => a.activityId === contextActivityId);
      const openHere = contextSessions.find((a) => a.checkedOutAt === null) ?? null;
      const hasArrivedAtEvent = attendances.some((a) => a.activityId === null);
      const concurrentOpen =
        contextActivityId !== null
          ? attendances.find(
              (a) => a.activityId !== null && a.activityId !== contextActivityId && a.checkedOutAt === null,
            ) ?? null
          : null;

      participantStatus = {
        registered,
        registrationStatus: effectiveReg?.status ?? null,
        requiresRegistration: point.activity ? point.activity.requiresRegistration : true,
        hasArrivedAtEvent,
        openSession: openHere ? { attendanceId: openHere.id, checkedInAt: openHere.checkedInAt } : null,
        closedMinutes: contextSessions
          .filter((a) => a.checkedOutAt !== null)
          .reduce((sum, a) => sum + Math.max(0, a.minutesAttended ?? 0), 0),
        concurrentOpenActivityTitle: concurrentOpen?.activity?.title ?? null,
      };
    }

    return {
      pointId: point.id,
      token: point.token,
      eventId: point.eventId,
      eventTitle: point.event.title,
      eventSlug: point.event.slug,
      venueName: point.event.venueName,
      city: point.event.city,
      state: point.event.state,
      timezone: point.event.timezone,
      activityId: point.activityId,
      activityTitle: point.activity?.title ?? null,
      roomName: point.activity?.room?.name ?? null,
      startsAt: point.activity?.startsAt ?? point.event.startsAt,
      endsAt: point.activity?.endsAt ?? point.event.endsAt,
      isActive: point.isActive,
      revokedAt: point.revokedAt,
      pinRequired: point.pinRequired,
      totpEnabled: point.totpEnabled,
      policy: {
        enabled: policy.enabled,
        requireGeo: policy.requireGeo,
        geoRadiusMeters: policy.geoRadiusMeters,
        maxAccuracyMeters: policy.maxAccuracyMeters,
        requireEventArrivalBeforeActivity: policy.requireEventArrivalBeforeActivity,
        blockConcurrentActivity: policy.blockConcurrentActivity,
        allowUnregistered: policy.allowUnregistered,
        checkoutCooldownMinutes: policy.checkoutCooldownMinutes,
      },
      hasEventCoordinates: coords !== null,
      windowStatus,
      participantStatus,
    };
  });
}

export async function submitSelfCheckin(input: {
  tenantId: string;
  token: string;
  userId: string;
  mode?: 'IN' | 'OUT' | 'TOGGLE';
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  pinCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<SelfCheckinResult<SelfCheckinSubmitOutcome>> {
  const normalizedToken = normalizeSelfCheckinToken(input.token);
  if (!normalizedToken) {
    return { ok: false, code: 'NOT_FOUND', message: 'Código de ponto de presença inválido.' };
  }

  const now = input.now ?? new Date();
  const mode = input.mode ?? 'TOGGLE';
  const warnings: string[] = [];

  try {
    const context = await withTenant(input.tenantId, async (tx) => {
      const point = await tx.selfCheckinPoint.findFirst({
        where: { tenantId: input.tenantId, token: normalizedToken },
        select: {
          id: true,
          eventId: true,
          activityId: true,
          isActive: true,
          revokedAt: true,
          pinRequired: true,
          pinCode: true,
          totpEnabled: true,
          totpSecret: true,
          event: {
            select: {
              id: true,
              title: true,
              latitude: true,
              longitude: true,
              settings: true,
              deletedAt: true,
            },
          },
          activity: {
            select: {
              id: true,
              title: true,
              status: true,
              endsAt: true,
              checkInEnabled: true,
              checkInOpensAt: true,
              checkInClosesAt: true,
              requiresRegistration: true,
              deletedAt: true,
            },
          },
        },
      });

      if (!point || point.event.deletedAt || point.activity?.deletedAt) {
        return { error: 'NOT_FOUND' as const };
      }

      const [registrations, attendances] = await Promise.all([
        tx.registration.findMany({
          where: {
            tenantId: input.tenantId,
            eventId: point.eventId,
            userId: input.userId,
            deletedAt: null,
            status: { not: 'CANCELED' },
          },
          orderBy: [{ createdAt: 'desc' }],
          select: { id: true, activityId: true, status: true, checkedInAt: true },
        }),
        tx.attendance.findMany({
          where: {
            tenantId: input.tenantId,
            eventId: point.eventId,
            userId: input.userId,
          },
          orderBy: { checkedInAt: 'desc' },
          select: {
            id: true,
            activityId: true,
            checkedInAt: true,
            checkedOutAt: true,
            activity: { select: { title: true, endsAt: true } },
          },
        }),
      ]);

      return { point, registrations, attendances };
    });

    if ('error' in context) {
      return { ok: false, code: 'NOT_FOUND', message: 'Ponto de autocredenciamento não encontrado.' };
    }

    const { point, registrations, attendances } = context;
    const policy = parseSelfCheckinPolicy(point.event.settings);

    if (point.revokedAt) {
      return {
        ok: false,
        code: 'POINT_REVOKED',
        message: 'Este QR Code foi revogado. Solicite o cartaz atualizado à organização.',
      };
    }

    if (!policy.enabled) {
      return {
        ok: false,
        code: 'SELF_CHECKIN_DISABLED',
        message: 'O autocredenciamento está desativado para este evento.',
      };
    }

    if (!point.isActive) {
      return {
        ok: false,
        code: 'POINT_INACTIVE',
        message: 'Este QR Code está temporariamente pausado pela organização.',
      };
    }

    if (point.activity) {
      const windowDecision = canRecordAttendance({ activity: point.activity, now });
      if (!windowDecision.ok) {
        return {
          ok: false,
          code: windowDecision.code,
          message: windowDecision.message,
        };
      }
    }

    // Camada 1: Verificação de PIN presencial ou código rotativo (TOTP) do telão.
    if (point.pinRequired || point.totpEnabled) {
      const totpOk = point.totpEnabled && verifyTotpCode(point.totpSecret, input.pinCode, now);
      const staticPinOk = point.pinRequired && safeComparePin(point.pinCode, input.pinCode);

      if (!totpOk && !staticPinOk) {
        return {
          ok: false,
          code: 'INVALID_PIN',
          message:
            point.totpEnabled && !point.pinRequired
              ? 'Código do telão inválido ou expirado. Confira os 6 dígitos exibidos na sala.'
              : 'Código de sala (PIN) inválido. Confirme o número anunciado na sala.',
        };
      }
    }

    // Camada 2: Geofencing (Haversine + filtro de precisão do GPS).
    const eventCoords = extractEventCoords(point.event);
    const participantCoords =
      typeof input.latitude === 'number' && typeof input.longitude === 'number'
        ? { latitude: input.latitude, longitude: input.longitude }
        : null;

    const geoCheck = evaluateGeofenceCheck({
      policy,
      eventCoords,
      participantCoords,
      accuracyMeters: input.accuracyMeters ?? null,
    });

    if (!geoCheck.ok) {
      return {
        ok: false,
        code: geoCheck.code,
        message: geoCheck.message,
      };
    }

    // Camada 3: Inscrição confirmada + pré-requisito opcional de chegada na portaria.
    const activityId = point.activityId ?? null;
    const directReg = registrations.find((r) => r.activityId === activityId) ?? null;
    const eventReg = registrations.find((r) => r.activityId === null) ?? null;
    const targetRegistration =
      directReg ??
      (point.activity && !point.activity.requiresRegistration ? eventReg : null) ??
      (activityId === null ? registrations[0] ?? null : null);

    const hasConfirmedReg = Boolean(
      targetRegistration &&
        (targetRegistration.status === 'CONFIRMED' || targetRegistration.status === 'ATTENDED'),
    );

    if (!hasConfirmedReg) {
      if (!policy.allowUnregistered) {
        return {
          ok: false,
          code: targetRegistration ? 'NOT_CONFIRMED' : 'REGISTRATION_REQUIRED',
          message: targetRegistration
            ? `Sua inscrição está como ${targetRegistration.status} e ainda não está confirmada.`
            : activityId
              ? 'É necessário ter inscrição confirmada nesta atividade para registrar autocheck-in.'
              : 'É necessário ter inscrição confirmada no evento para fazer autocredenciamento.',
        };
      }
      warnings.push(
        activityId
          ? 'Autocheck-in registrado sem inscrição prévia nesta atividade (modo aberto).'
          : 'Autocredenciamento registrado sem inscrição prévia no evento.',
      );
    }

    if (activityId !== null && policy.requireEventArrivalBeforeActivity) {
      const hasArrived = attendances.some((a) => a.activityId === null);
      if (!hasArrived) {
        return {
          ok: false,
          code: 'EVENT_ARRIVAL_REQUIRED',
          message:
            'Faça primeiro o credenciamento na portaria do evento antes de registrar presença nas atividades.',
        };
      }
    }

    const openSession =
      attendances.find((a) => a.activityId === activityId && a.checkedOutAt === null) ?? null;
    const wantsOut = mode === 'OUT' || (mode === 'TOGGLE' && openSession !== null);
    const maskedIp = maskIpAddress(input.ipAddress);

    if (wantsOut) {
      if (!openSession) {
        return {
          ok: true,
          action: 'NOT_INSIDE',
          attendanceId: null,
          minutes: null,
          distanceMeters: geoCheck.distanceMeters,
          rewarded: false,
          xpAwarded: 0,
          warnings: ['Não há entrada em aberto neste contexto para encerrar.'],
          message: 'Você ainda não registrou entrada neste ponto.',
        };
      }

      const cooldown = evaluateCheckoutCooldown({
        checkedInAt: openSession.checkedInAt,
        now,
        cooldownMinutes: policy.checkoutCooldownMinutes,
      });

      if (!cooldown.allowed) {
        return {
          ok: false,
          code: 'COOLDOWN_ACTIVE',
          message: `Sua entrada acabou de ser registrada. Aguarde ${cooldown.waitSeconds} s antes de registrar a saída.`,
        };
      }

      if (targetRegistration && activityId !== null && directReg) {
        const closed = await checkOut({
          tenantId: input.tenantId,
          registrationId: directReg.id,
          staffUserId: input.userId,
          now,
        });

        if (!closed.ok) {
          return {
            ok: false,
            code: closed.code as SelfCheckinErrorCode,
            message: closed.message,
          };
        }

        const xpAwarded = closed.rewards.reduce((sum, reward) => sum + (reward.xpAwarded ?? 0), 0);

        return {
          ok: true,
          action: 'CHECKED_OUT',
          attendanceId: openSession.id,
          minutes: closed.minutesAttended,
          distanceMeters: geoCheck.distanceMeters,
          rewarded: xpAwarded > 0 || closed.fullAttendance !== null,
          xpAwarded,
          warnings,
          message: `Saída registrada · ${closed.minutesAttended} minuto(s) computados.`,
        };
      }

      const minutes = sessionMinutes({
        checkedInAt: openSession.checkedInAt,
        closedAt: now,
        activityEndsAt: point.activity?.endsAt ?? null,
      });

      await withTenant(input.tenantId, (tx) =>
        tx.attendance.update({
          where: { id: openSession.id },
          data: { checkedOutAt: now, minutesAttended: minutes },
        }),
      );

      return {
        ok: true,
        action: 'CHECKED_OUT',
        attendanceId: openSession.id,
        minutes,
        distanceMeters: geoCheck.distanceMeters,
        rewarded: false,
        xpAwarded: 0,
        warnings,
        message: `Saída registrada · ${minutes} minuto(s) computados.`,
      };
    }

    // ── Entrada ────────────────────────────────────────────────────────────────
    if (openSession) {
      return {
        ok: true,
        action: 'ALREADY_INSIDE',
        attendanceId: openSession.id,
        minutes: null,
        distanceMeters: geoCheck.distanceMeters,
        rewarded: false,
        xpAwarded: 0,
        warnings: [
          `Sua entrada já foi registrada às ${openSession.checkedInAt.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}.`,
        ],
        message: 'Sua entrada já está registrada neste ponto.',
      };
    }

    // Camada 4: Trava Anti-Ubiquidade (impede duas atividades simultâneas abertas).
    const openOtherActivities = attendances
      .filter((a) => a.activityId !== null && a.checkedOutAt === null)
      .map((a) => ({ activityId: a.activityId!, title: a.activity?.title ?? 'Atividade' }));

    const ubiquity = evaluateAntiUbiquity({
      blockConcurrentActivity: policy.blockConcurrentActivity,
      targetActivityId: activityId,
      openActivities: openOtherActivities,
    });

    if (!ubiquity.ok) {
      return {
        ok: false,
        code: ubiquity.code,
        message: ubiquity.message,
      };
    }

    const auditNoteParts = ['Autocheck-in via QR'];
    if (geoCheck.distanceMeters !== null) {
      auditNoteParts.push(`distância ${geoCheck.distanceMeters}m`);
    }
    if (point.pinRequired || point.totpEnabled) {
      auditNoteParts.push('código verificado');
    }
    const auditNote = auditNoteParts.join(' · ');

    if (targetRegistration && targetRegistration.checkedInAt === null && (activityId === null || directReg)) {
      const checked = await checkIn({
        tenantId: input.tenantId,
        registrationId: targetRegistration.id,
        staffUserId: input.userId,
        now,
        ipAddress: maskedIp,
        userAgent: input.userAgent ?? null,
        qrNonce: `self:${point.id}:${Math.floor(now.getTime() / 60_000)}`,
        source: 'SELF_DECLARED',
        latitude: participantCoords?.latitude ?? null,
        longitude: participantCoords?.longitude ?? null,
        notes: auditNote,
      });

      if (!checked.ok) {
        return {
          ok: false,
          code: checked.code as SelfCheckinErrorCode,
          message: checked.message,
        };
      }

      const xpAwarded = checked.reward?.xpAwarded ?? 0;

      return {
        ok: true,
        action: checked.alreadyCheckedIn ? 'ALREADY_INSIDE' : 'CHECKED_IN',
        attendanceId: checked.attendanceId || null,
        minutes: null,
        distanceMeters: geoCheck.distanceMeters,
        rewarded: xpAwarded > 0,
        xpAwarded,
        warnings,
        message: checked.alreadyCheckedIn
          ? 'Sua entrada já havia sido registrada anteriormente.'
          : xpAwarded > 0
            ? `Presença confirmada! +${xpAwarded} XP creditado.`
            : 'Presença confirmada com sucesso.',
      };
    }

    let attendanceId: string | null = null;
    let alreadyInside = false;

    try {
      attendanceId = await withTenant(input.tenantId, async (tx) => {
        const created = await tx.attendance.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            eventId: point.eventId,
            activityId,
            registrationId: targetRegistration?.id ?? null,
            userId: input.userId,
            status: 'PRESENT',
            source: 'SELF_DECLARED',
            checkedInAt: now,
            validatedById: null,
            latitude: participantCoords?.latitude ?? null,
            longitude: participantCoords?.longitude ?? null,
            ipAddress: maskedIp,
            userAgent: input.userAgent?.slice(0, 500) ?? null,
            qrNonce: `self:${point.id}:${Math.floor(now.getTime() / 60_000)}`,
            minutesAttended: 0,
            notes: auditNote,
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      alreadyInside = true;

      const existingOpen = await withTenant(input.tenantId, (tx) =>
        tx.attendance.findFirst({
          where: {
            tenantId: input.tenantId,
            eventId: point.eventId,
            activityId,
            userId: input.userId,
            checkedOutAt: null,
          },
          orderBy: { checkedInAt: 'desc' },
          select: { id: true },
        }),
      );
      attendanceId = existingOpen?.id ?? null;
    }

    return {
      ok: true,
      action: alreadyInside ? 'ALREADY_INSIDE' : 'CHECKED_IN',
      attendanceId,
      minutes: null,
      distanceMeters: geoCheck.distanceMeters,
      rewarded: false,
      xpAwarded: 0,
      warnings,
      message: alreadyInside ? 'Sua entrada já está registrada neste ponto.' : 'Presença confirmada com sucesso.',
    };
  } catch (error) {
    logger.error(`[self-checkin] falha ao registrar autocheck-in: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível registrar seu autocheck-in neste momento.',
    };
  }
}

/** Garante padrão neutro disponível para criação inicial de formulário sem erro de import. */
export const EMPTY_SELF_CHECKIN_POLICY: SelfCheckinPolicy = { ...DEFAULT_SELF_CHECKIN_POLICY };

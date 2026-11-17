'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Autocredenciamento e Autocheck-in por QR Code (FASE 113)
 *
 *  A autorização usa `guardAction` diretamente em cada ação:
 *    • Configuração da política antifraude e regeneração de QR → `attendance:manage`
 *      em escopo `TENANT` ou `EVENT`;
 *    • Geração/ativação e ajuste de PIN/Telão → `registration:checkin` em escopo
 *      `TENANT` ou `EVENT`;
 *    • Envio do autocheck-in pelo participante → `tenant:read` (qualquer membro
 *      ativo da instituição; a exigência de inscrição, janela, geofence, PIN e
 *      anti-ubiquidade é aplicada transacionalmente em `submitSelfCheckin`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction, type ActionGuardState } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  regenerateSelfCheckinPoint,
  saveEventSelfCheckinPolicy,
  submitSelfCheckin,
  upsertSelfCheckinPoint,
} from '@/lib/events/self-checkin-service';

export type SelfCheckinActionState = ActionGuardState;

function parseOptionalCoord(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function parseBool(formData: FormData, key: string): boolean {
  return formData.get(key) === 'true' || formData.get(key) === 'on' || formData.get(key) === '1';
}

export async function saveSelfCheckinPolicyAction(
  _prev: SelfCheckinActionState | null,
  formData: FormData,
): Promise<SelfCheckinActionState> {
  const tenantSlug = String(formData.get('tenantSlug') ?? '').trim();
  const eventId = String(formData.get('eventId') ?? '').trim();

  if (!tenantSlug || !z.string().uuid().safeParse(eventId).success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Evento ou instituição inválidos.' };
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });

  if (!auth.ok) return auth.state;

  const latitude = parseOptionalCoord(formData.get('latitude'));
  const longitude = parseOptionalCoord(formData.get('longitude'));

  if ((latitude !== null && Number.isNaN(latitude)) || (longitude !== null && Number.isNaN(longitude))) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Latitude ou longitude em formato inválido.' };
  }

  const geoRadiusMeters = Number(formData.get('geoRadiusMeters') ?? 200);
  const maxAccuracyMeters = Number(formData.get('maxAccuracyMeters') ?? 300);
  const checkoutCooldownMinutes = Number(formData.get('checkoutCooldownMinutes') ?? 2);

  const result = await saveEventSelfCheckinPolicy({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    latitude,
    longitude,
    policy: {
      enabled: parseBool(formData, 'enabled'),
      requireGeo: parseBool(formData, 'requireGeo'),
      geoRadiusMeters: Number.isFinite(geoRadiusMeters) ? geoRadiusMeters : 200,
      maxAccuracyMeters: Number.isFinite(maxAccuracyMeters) ? maxAccuracyMeters : 300,
      requireEventArrivalBeforeActivity: parseBool(formData, 'requireEventArrivalBeforeActivity'),
      blockConcurrentActivity: parseBool(formData, 'blockConcurrentActivity'),
      allowUnregistered: parseBool(formData, 'allowUnregistered'),
      checkoutCooldownMinutes: Number.isFinite(checkoutCooldownMinutes) ? checkoutCooldownMinutes : 2,
    },
  });

  revalidatePath(tenantPath(tenantSlug, '/credenciamento'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: 'Política de segurança do autocredenciamento salva.',
    data: { policy: result.policy },
  };
}

export async function upsertSelfCheckinPointAction(
  _prev: SelfCheckinActionState | null,
  formData: FormData,
): Promise<SelfCheckinActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      activityId: z.string().uuid().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      activityId: (formData.get('activityId') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para o ponto de presença.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId: parsed.data.eventId,
  });

  if (!auth.ok) return auth.state;

  const isActiveRaw = formData.get('isActive');
  const pinRequiredRaw = formData.get('pinRequired');
  const totpEnabledRaw = formData.get('totpEnabled');

  const result = await upsertSelfCheckinPoint({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    activityId: parsed.data.activityId ?? null,
    actorId: auth.userId,
    isActive: isActiveRaw === null ? undefined : isActiveRaw === 'true' || isActiveRaw === 'on',
    pinRequired: pinRequiredRaw === null ? undefined : pinRequiredRaw === 'true' || pinRequiredRaw === 'on',
    rotatePin: formData.get('rotatePin') === 'true',
    totpEnabled: totpEnabledRaw === null ? undefined : totpEnabledRaw === 'true' || totpEnabledRaw === 'on',
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: 'Ponto de autocredenciamento atualizado.',
    data: {
      pointId: result.point.id,
      token: result.point.token,
      pinCode: result.point.pinCode,
    },
  };
}

export async function regenerateSelfCheckinPointAction(
  _prev: SelfCheckinActionState | null,
  formData: FormData,
): Promise<SelfCheckinActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      pointId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      pointId: formData.get('pointId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Ponto inválido para regeneração.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId: parsed.data.eventId,
  });

  if (!auth.ok) return auth.state;

  const result = await regenerateSelfCheckinPoint({
    tenantId: auth.tenantId,
    pointId: parsed.data.pointId,
    actorId: auth.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: `Novo QR gerado (${result.point.token}). Os cartazes anteriores foram revogados.`,
    data: { pointId: result.point.id, token: result.point.token },
  };
}

export async function submitSelfCheckinAction(
  _prev: SelfCheckinActionState | null,
  formData: FormData,
): Promise<SelfCheckinActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      token: z.string().trim().min(4).max(32),
      mode: z.enum(['IN', 'OUT', 'TOGGLE']).default('TOGGLE'),
      pinCode: z.string().trim().max(12).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      token: formData.get('token'),
      mode: formData.get('mode') ?? 'TOGGLE',
      pinCode: (formData.get('pinCode') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para registrar presença.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_READ,
  });

  if (!auth.ok) return auth.state;

  const latitude = parseOptionalCoord(formData.get('latitude'));
  const longitude = parseOptionalCoord(formData.get('longitude'));
  const accuracyMeters = parseOptionalCoord(formData.get('accuracyMeters'));

  if (
    (latitude !== null && Number.isNaN(latitude)) ||
    (longitude !== null && Number.isNaN(longitude)) ||
    (accuracyMeters !== null && Number.isNaN(accuracyMeters))
  ) {
    return { ok: false, code: 'GEO_INVALID', message: 'Coordenadas de localização inválidas.' };
  }

  const headerList = await headers();
  const result = await submitSelfCheckin({
    tenantId: auth.tenantId,
    token: parsed.data.token,
    userId: auth.userId,
    mode: parsed.data.mode,
    pinCode: parsed.data.pinCode ?? null,
    latitude,
    longitude,
    accuracyMeters,
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/presenca/${parsed.data.token}`));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/minhas-inscricoes'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento'));

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      details: result.details,
    };
  }

  return {
    ok: true,
    message: result.message,
    details: result.warnings,
    data: {
      action: result.action,
      attendanceId: result.attendanceId,
      minutes: result.minutes,
      distanceMeters: result.distanceMeters,
      rewarded: result.rewarded,
      xpAwarded: result.xpAwarded,
    },
  };
}

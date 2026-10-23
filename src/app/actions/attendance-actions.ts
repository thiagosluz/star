'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Credenciamento
 *
 *  O check-in é operado pela EQUIPE (`registration:checkin`), nunca pelo próprio
 *  participante: auto-credenciamento transformaria presença em declaração e a
 *  gamificação inteira perderia sentido.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { checkIn, checkOut } from '@/lib/events/attendance-service';

export interface AttendanceActionState {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}

const schema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  registrationId: z.string().uuid(),
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A PERMISSÃO DEIXOU DE ENTRAR COMO `string`
 * ─────────────────────────────────────────────────────────────────────────────
 *  A guarda local recebia `permission: string` e a convertia com `as never` no
 *  `can()` — o tipo existia para ser contornado, e quem passasse uma permissão
 *  inexistente (um typo) compilaria e só descobriria no teste. Com `guardAction` o
 *  parâmetro é `ActionPermission`, então o typo não compila.
 *
 *  O comportamento não muda: `NotAuthorized`/`INVALID` continuam com o MESMO código
 *  e a MESMA mensagem, presos pelo caso 20 de `f75-guardas-caracterizacao`.
 */

export async function checkInAction(
  _prev: AttendanceActionState | null,
  formData: FormData,
): Promise<AttendanceActionState> {
  const parsed = schema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    registrationId: formData.get('registrationId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para credenciamento.' };
  }

  const auth = await guardAction<AttendanceActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
  });
  if (!auth.ok) return auth.state;

  const headerList = await headers();

  const result = await checkIn({
    tenantId: auth.tenantId,
    registrationId: parsed.data.registrationId,
    staffUserId: auth.userId,
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  if (result.alreadyCheckedIn) {
    return { ok: true, message: 'Este participante já estava credenciado.', data: { already: true } };
  }

  const xp = result.reward?.xpAwarded ?? 0;

  return {
    ok: true,
    message: xp > 0 ? `Entrada registrada. +${xp} XP para o participante.` : 'Entrada registrada.',
    data: {
      attendanceId: result.attendanceId,
      xpAwarded: xp,
      cards: result.reward?.cards ?? [],
      missions: result.reward?.missions ?? [],
    },
  };
}

export async function checkOutAction(
  _prev: AttendanceActionState | null,
  formData: FormData,
): Promise<AttendanceActionState> {
  const parsed = schema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    registrationId: formData.get('registrationId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para a saída.' };
  }

  const auth = await guardAction<AttendanceActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CHECKOUT,
  });
  if (!auth.ok) return auth.state;

  const result = await checkOut({
    tenantId: auth.tenantId,
    registrationId: parsed.data.registrationId,
    staffUserId: auth.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  const xp = result.rewards.reduce((sum, reward) => sum + reward.xpAwarded, 0);

  return {
    ok: true,
    message: result.countedForXp
      ? `Saída registrada: ${result.minutesAttended} min de presença. +${xp} XP.`
      : `Saída registrada: ${result.minutesAttended} min. Presença insuficiente para pontuar (mínimo de 75% da carga).`,
    data: {
      minutesAttended: result.minutesAttended,
      countedForXp: result.countedForXp,
      xpAwarded: xp,
      cards: result.rewards.flatMap((reward) => reward.cards),
    },
  };
}

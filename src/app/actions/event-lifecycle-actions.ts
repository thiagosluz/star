'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SERVER ACTIONS — Ciclo de Vida no Acervo de Eventos (FASE 128)
 *
 *  Portas de entrada de interface para:
 *    • `archiveEventAction`: arquivar (`ARCHIVED`) ou restaurar (`DRAFT`);
 *    • `cloneEventAction`: duplicar dados estruturais básicos em `DRAFT`;
 *    • `deleteEventAction`: excluir logicamente com palavra `"EXCLUIR"` + senha.
 *
 *  Regra F75: todas chamam `guardAction` diretamente no corpo da action exportada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  archiveEvent,
  cloneEventBasicData,
  deleteEventSecurely,
} from '@/lib/admin/event-lifecycle-service';
import { auth } from '@/lib/auth/auth';
import { guardAction, type ActionGuardState } from '@/lib/auth/guard-action';
import { invalidatePublicEventCacheBySlug } from '@/lib/cache/public-read-cache';
import { PUBLIC_TENANTS_TAG } from '@/lib/platform/directory-service';

export interface EventLifecycleActionState extends ActionGuardState {
  createdEventId?: string;
  createdEventSlug?: string;
}

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const archiveEventSchema = z.object({
  tenantSlug: z.string().min(1),
  eventId: z.string().uuid('Identificador de evento inválido.'),
  archive: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

const cloneEventSchema = z.object({
  tenantSlug: z.string().min(1),
  sourceEventId: z.string().uuid('Evento de origem inválido.'),
  title: z
    .string()
    .trim()
    .min(4, 'O título do novo evento deve ter ao menos 4 caracteres.')
    .max(200, 'O título pode ter no máximo 200 caracteres.'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'O identificador URL deve ter ao menos 3 caracteres.')
    .max(63, 'O identificador URL pode ter no máximo 63 caracteres.')
    .regex(SLUG_REGEX, 'Use apenas letras minúsculas, números e hífens no identificador URL.'),
  startsAt: z.string().min(1, 'Informe a data e hora de início.'),
  endsAt: z.string().min(1, 'Informe a data e hora de término.'),
});

const deleteEventSchema = z.object({
  tenantSlug: z.string().min(1),
  eventId: z.string().uuid('Identificador de evento inválido.'),
  confirmationWord: z.string().default(''),
  currentPassword: z.string().default(''),
});

function parseDateTimeInput(raw: string): Date | null {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function archiveEventAction(
  _prevState: EventLifecycleActionState | null,
  formData: FormData,
): Promise<EventLifecycleActionState> {
  const parsed = archiveEventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    archive: formData.get('archive'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos para alterar arquivamento.',
    };
  }

  const { tenantSlug, eventId, archive } = parsed.data;

  const guard = await guardAction<EventLifecycleActionState>({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });
  if (!guard.ok) return guard.state;

  const result = await archiveEvent({
    tenantId: guard.tenantId,
    actorId: guard.userId,
    eventId,
    archive,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  await invalidatePublicEventCacheBySlug({
    tenantSlug,
    eventSlug: result.slug,
    includeDirectory: true,
  });
  revalidateTag(PUBLIC_TENANTS_TAG, 'max');
  revalidatePath(tenantPath(tenantSlug, '/administracao/eventos'));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));
  revalidatePath(tenantPath(tenantSlug, '/administracao'));

  return {
    ok: true,
    message: archive
      ? 'Evento arquivado. Os registros foram preservados e podem ser restaurados.'
      : 'Evento restaurado como rascunho.',
  };
}

export async function cloneEventAction(
  _prevState: EventLifecycleActionState | null,
  formData: FormData,
): Promise<EventLifecycleActionState> {
  const parsed = cloneEventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    sourceEventId: formData.get('sourceEventId'),
    title: formData.get('title'),
    slug: formData.get('slug'),
    startsAt: formData.get('startsAt'),
    endsAt: formData.get('endsAt'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos para clonar o evento.',
    };
  }

  const { tenantSlug, sourceEventId, title, slug } = parsed.data;
  const startsAt = parseDateTimeInput(parsed.data.startsAt);
  const endsAt = parseDateTimeInput(parsed.data.endsAt);

  if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'A data de término deve ser posterior à data de início.',
    };
  }

  const guard = await guardAction<EventLifecycleActionState>({
    tenantSlug,
    permission: PERMISSIONS.EVENT_CREATE,
  });
  if (!guard.ok) return guard.state;

  const result = await cloneEventBasicData({
    tenantId: guard.tenantId,
    actorId: guard.userId,
    sourceEventId,
    title,
    slug,
    startsAt,
    endsAt,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  await invalidatePublicEventCacheBySlug({
    tenantSlug,
    eventSlug: result.slug,
    includeDirectory: true,
  });
  revalidateTag(PUBLIC_TENANTS_TAG, 'max');
  revalidatePath(tenantPath(tenantSlug, '/administracao/eventos'));
  revalidatePath(tenantPath(tenantSlug, '/administracao'));

  return {
    ok: true,
    message: `Evento "${result.title}" clonado como rascunho.`,
    createdEventId: result.eventId,
    createdEventSlug: result.slug,
  };
}

export async function deleteEventAction(
  _prevState: EventLifecycleActionState | null,
  formData: FormData,
): Promise<EventLifecycleActionState> {
  const parsed = deleteEventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    confirmationWord: formData.get('confirmationWord') ?? '',
    currentPassword: formData.get('currentPassword') ?? '',
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos para exclusão do evento.',
    };
  }

  const { tenantSlug, eventId, confirmationWord, currentPassword } = parsed.data;

  const guard = await guardAction<EventLifecycleActionState>({
    tenantSlug,
    permission: PERMISSIONS.EVENT_DELETE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });
  if (!guard.ok) return guard.state;

  const requestHeaders = await headers();

  const result = await deleteEventSecurely({
    tenantId: guard.tenantId,
    actorId: guard.userId,
    eventId,
    confirmationWord,
    currentPassword,
    verifyPassword: async (password) => {
      try {
        const verified = await auth.api.verifyPassword({
          body: { password },
          headers: requestHeaders,
        });
        return Boolean(verified?.status);
      } catch {
        return false;
      }
    },
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  await invalidatePublicEventCacheBySlug({
    tenantSlug,
    eventSlug: result.previousSlug,
    includeDirectory: true,
  });
  revalidateTag(PUBLIC_TENANTS_TAG, 'max');
  revalidatePath(tenantPath(tenantSlug, '/administracao/eventos'));
  revalidatePath(tenantPath(tenantSlug, '/administracao'));

  return {
    ok: true,
    message: 'Evento excluído do acervo com segurança.',
  };
}

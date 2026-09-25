'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardSelfServiceAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { PUBLIC_PROFILE_FIELDS, PROFILE_AUDIENCES } from '@/domain/profile/public-profile-rules';
import { savePublicProfile } from '@/lib/profile/public-profile-service';
import type { AdminActionState } from '@/app/actions/admin-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SERVER ACTIONS — Perfil público (FASE 44)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA É `:own` E A ESCRITA É SEMPRE NA PRÓPRIA LINHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `PROFILE_MANAGE_OWN` é conferida com o `ownerId` da sessão, e o serviço grava no
 *  `userId` que veio do contexto — nunca de um campo do formulário. Não existe
 *  action que edite o perfil de OUTRA pessoa: a instituição não administra a
 *  vitrine de ninguém (a ficha 360 lê, e só).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface PublicProfileActionState extends AdminActionState {
  username?: string;
}

const audienceSchema = z.enum(PROFILE_AUDIENCES);

/**
 * A matriz vem do formulário como N campos (`audience_<campo>`).
 *
 * Campo ausente cai no padrão do domínio (`parseProfileAudiences`), o que mantém o
 * formulário tolerante a uma tela que ainda não conheça um campo novo.
 */
function readAudiences(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};

  for (const field of PUBLIC_PROFILE_FIELDS) {
    const value = formData.get(`audience_${field}`);
    if (typeof value === 'string' && audienceSchema.safeParse(value).success) {
      raw[field] = value;
    }
  }

  return raw;
}

export async function savePublicProfileAction(
  _prev: PublicProfileActionState | null,
  formData: FormData,
): Promise<PublicProfileActionState> {
  const tenantSlug = String(formData.get('tenantSlug') ?? '');

  const guard = await guardSelfServiceAction({
    tenantSlug,
    permission: PERMISSIONS.PROFILE_MANAGE_OWN,
  });

  if (!guard.ok) {
    return {
      ok: false,
      code: guard.reason,
      message:
        guard.reason === 'NOT_AUTHENTICATED'
          ? 'Entre para editar o seu perfil.'
          : 'Você não tem acesso a esta instituição.',
    };
  }

  const interests = String(formData.get('interests') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const publicEventIds = formData
    .getAll('publicEventIds')
    .map((value) => String(value))
    .filter((value) => z.string().uuid().safeParse(value).success);

  const result = await savePublicProfile({
    tenantId: guard.tenantId,
    userId: guard.userId,
    username: String(formData.get('username') ?? ''),
    headline: (formData.get('headline') as string | null) ?? null,
    bio: (formData.get('bio') as string | null) ?? null,
    interests,
    siteUrl: (formData.get('siteUrl') as string | null) ?? null,
    orcidId: (formData.get('orcidId') as string | null) ?? null,
    lattesId: (formData.get('lattesId') as string | null) ?? null,
    audiences: readAudiences(formData),
    indexable: formData.get('indexable') === 'on',
    listedInDirectory: formData.get('listedInDirectory') === 'on',
    publicNameInResults: formData.get('publicNameInResults') === 'on',
    publicEventIds,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidatePath(tenantPath(tenantSlug, '/meu-perfil-publico'));
  revalidatePath(tenantPath(tenantSlug, `/u/${result.username}`));

  return {
    ok: true,
    username: result.username,
    message: result.handleChanged
      ? `Perfil salvo. O seu endereço agora é /u/${result.username}.`
      : 'Perfil salvo.',
  };
}

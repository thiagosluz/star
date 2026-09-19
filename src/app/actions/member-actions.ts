'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Ciclo de vida do membro (FASE 21, item C5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS PERMISSÕES DIFERENTES, E ISSO É PROPOSITAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Trocar PAPÉIS exige `tenant:role:assign` — que o RBAC dá ao OWNER e nega ao
 *  ADMIN desde a FASE 2 (junto com exclusão de instituição e cobrança). Remover
 *  GENTE exige `tenant:member:remove`, que o ADMIN tem. Não é descuido: promover
 *  alguém a ADMIN é mudar quem manda; tirar o acesso de quem saiu é operação do dia.
 *
 *  A tela esconde o que a pessoa não pode fazer, e as duas ações reconferem a
 *  permissão AQUI — esconder botão não é autorização (uma Server Action é um
 *  endpoint HTTP).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { removeMember, updateMemberRoles } from '@/lib/admin/member-service';

export interface MemberActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
}

type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

async function guard(input: {
  tenantSlug: string;
  permission: Permission;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: MemberActionState }
> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' } };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: 'Você não tem vínculo ativo com esta instituição.' },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, input.permission, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: `Permissão negada: ${input.permission}.` },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

/** Papéis chegam como caixas de seleção repetidas — uma lista, nunca uma string. */
function readRoles(formData: FormData): string[] {
  return formData
    .getAll('roles')
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

export async function updateMemberRolesAction(
  _prev: MemberActionState | null,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      userId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      userId: formData.get('userId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Membro inválido.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_ROLE_ASSIGN,
  });

  if (!access.ok) return access.state;

  const result = await updateMemberRoles({
    tenantId: access.tenantId,
    actorId: access.userId,
    userId: parsed.data.userId,
    roles: readRoles(formData),
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  if (result.unchanged) {
    return { ok: true, message: 'Os papéis já eram exatamente estes.' };
  }

  const parts: string[] = [];

  if (result.granted.length > 0) parts.push(`concedido: ${result.granted.join(', ')}`);
  if (result.revoked.length > 0) parts.push(`retirado: ${result.revoked.join(', ')}`);

  return { ok: true, message: `Papéis atualizados — ${parts.join(' · ')}.` };
}

export async function removeMemberAction(
  _prev: MemberActionState | null,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      userId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      userId: formData.get('userId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Membro inválido.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_REMOVE,
  });

  if (!access.ok) return access.state;

  const result = await removeMember({
    tenantId: access.tenantId,
    actorId: access.userId,
    userId: parsed.data.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));
  // A vaga liberada muda o contador de quota: o painel mostra o mesmo número.
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao'), 'layout');

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message:
      `${result.name} não tem mais acesso à instituição.` +
      (result.revokedRoles.length > 0
        ? ` Papéis revogados: ${result.revokedRoles.join(', ')}.`
        : ''),
  };
}

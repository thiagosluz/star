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

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { removeMember, updateMemberRoles } from '@/lib/admin/member-service';
import { demoteMemberToParticipant } from '@/lib/admin/member-demotion';

export interface MemberActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
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

  const access = await guardAction<MemberActionState>({
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

  const access = await guardAction<MemberActionState>({
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

/**
 * Converte o acesso de EQUIPE em PARTICIPANTE (FASE 50 · dívida C7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A MESMA PERMISSÃO DA REMOÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Converter tira o acesso de organização — é a mesma decisão de "tirar o acesso",
 *  feita com um destino melhor. Exigir `tenant:role:assign` (do OWNER) aqui seria
 *  manter no ADMIN o poder de remover e negar o de remover SEM perder a área de
 *  participante, que é a opção menos destrutiva das duas.
 */
export async function demoteMemberAction(
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

  const access = await guardAction<MemberActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_REMOVE,
  });

  if (!access.ok) return access.state;

  const result = await demoteMemberToParticipant({
    tenantId: access.tenantId,
    actorId: access.userId,
    userId: parsed.data.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));
  /** A vaga da equipe é liberada: o painel mostra o mesmo número. */
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao'), 'layout');

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message:
      `${result.name} saiu da equipe e continua como participante — as inscrições, ` +
      `os certificados e as cartas seguem acessíveis.` +
      (result.revokedRoles.length > 0
        ? ` Papéis revogados: ${result.revokedRoles.join(', ')}.`
        : ''),
  };
}
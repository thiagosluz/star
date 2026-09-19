'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Comunicação (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA É AQUI, NÃO NO BOTÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Convite, reenvio, cancelamento e reentrega de e-mail passam por
 *  `tenant:member:invite` / `communication:read` verificadas NA AÇÃO: esconder o
 *  botão é conveniência; a barreira é esta, porque uma Server Action é um endpoint
 *  HTTP.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ÚNICA EXCEÇÃO: ACEITAR O CONVITE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `acceptInvitationAction` NÃO pede permissão — quem aceita ainda não tem nenhuma.
 *  A autorização dela é outra: o CÓDIGO (que só existe no e-mail) e o endereço da
 *  conta logada precisam bater com o convite. Sem os dois, a resposta é recusa; é o
 *  mesmo desenho do aceite do convite de palestrante (ADR-115), com a diferença de
 *  que aqui a posse do endereço é o único fator, porque não há painel de onde partir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth } from '@/lib/auth/auth';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  acceptInvitation,
  inviteMember,
  reissueInvitation,
  revokeInvitation,
} from '@/lib/communication/invitation-service';
import { retryEmailMessage } from '@/lib/communication/email-service';

export interface CommunicationActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

async function guard(input: {
  tenantSlug: string;
  permission: Permission;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: CommunicationActionState }
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
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Você não tem vínculo ativo com esta instituição.',
      },
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

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Convite de equipe
// ───────────────────────────────────────────────────────────────────────────────
const inviteSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  email: z.string().trim().min(5).max(320),
  role: z.string().trim().min(2).max(40),
  message: z.string().trim().max(400).optional(),
});

export async function inviteMemberAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = inviteSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    email: formData.get('email'),
    role: formData.get('role'),
    message: nullable(formData.get('message')) ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Revise os dados do convite.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  if (!access.ok) return access.state;

  const result = await inviteMember({
    tenantId: access.tenantId,
    actorId: access.userId,
    email: parsed.data.email,
    role: parsed.data.role,
    message: parsed.data.message ?? null,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * O link é devolvido UMA vez: o banco guarda só o hash. A tela mostra o endereço
   * para quem quiser entregar por outro canal (e avisa que não será exibido de novo).
   */
  return {
    ok: true,
    message: result.emailQueued
      ? `Convite registrado e enviado para ${result.email}.`
      : `Convite registrado para ${result.email}. O envio por e-mail falhou — use o link abaixo.`,
    data: {
      invitationId: result.invitationId,
      email: result.email,
      inviteUrl: result.inviteUrl,
      emailQueued: result.emailQueued,
    },
  };
}

export async function reissueInvitationAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      invitationId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      invitationId: formData.get('invitationId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Convite inválido.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  if (!access.ok) return access.state;

  const result = await reissueInvitation({
    tenantId: access.tenantId,
    actorId: access.userId,
    invitationId: parsed.data.invitationId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message: `Convite novo gerado para ${result.email}. O código anterior deixou de valer.`,
    data: {
      invitationId: result.invitationId,
      email: result.email,
      inviteUrl: result.inviteUrl,
      emailQueued: result.emailQueued,
      reissued: true,
    },
  };
}

export async function revokeInvitationAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      invitationId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      invitationId: formData.get('invitationId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Convite inválido.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  if (!access.ok) return access.state;

  const result = await revokeInvitation({
    tenantId: access.tenantId,
    actorId: access.userId,
    invitationId: parsed.data.invitationId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return { ok: true, message: `Convite de ${result.email} cancelado.` };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Aceite (sem permissão: o código é a autorização)
// ───────────────────────────────────────────────────────────────────────────────
export async function acceptInvitationAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      token: z.string().trim().min(10).max(200),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      token: formData.get('token'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Convite inválido ou incompleto.' };
  }

  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      ok: false,
      code: 'NOT_AUTHENTICATED',
      message: 'Entre na sua conta (ou crie uma com o e-mail convidado) para aceitar o convite.',
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: parsed.data.tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  const result = await acceptInvitation({
    tenantId: tenant.id,
    token: parsed.data.token,
    userId: user.id,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * O vínculo e o papel são NOVOS: o menu, a lista de instituições e o painel
   * precisam ser reconstruídos. Revalidar o layout do tenant cobre todas as telas
   * dele de uma vez (armadilha 40).
   */
  revalidatePath(tenantPath(parsed.data.tenantSlug), 'layout');

  redirect(tenantPath(parsed.data.tenantSlug, '/dashboard'));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Caixa de saída
// ───────────────────────────────────────────────────────────────────────────────
export async function retryEmailAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      emailMessageId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      emailMessageId: formData.get('emailMessageId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Mensagem inválida.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.COMMUNICATION_READ,
  });

  if (!access.ok) return access.state;

  const result = await retryEmailMessage({
    tenantId: access.tenantId,
    emailMessageId: parsed.data.emailMessageId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/comunicacao'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: result.queued
      ? 'Mensagem reenfileirada. A entrega acontece em instantes.'
      : 'Mensagem reenviada agora.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Verificação de e-mail (A5)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Reenvia a confirmação de endereço para a PRÓPRIA conta.
 *
 * Não recebe e-mail do formulário: quem pede é quem está logado, e aceitar um
 * endereço de fora transformaria esta ação num gerador de spam. O `callbackURL`
 * leva a pessoa de volta a uma página que explica o que aconteceu.
 */
export async function resendVerificationEmailAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const redirectTo = nullable(formData.get('redirectTo')) ?? '/selecionar-instituicao';

  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' };
  }

  /**
   * A sessão carrega `emailVerified` desde a FASE 15 — o dado já vinha do Better
   * Auth. A checagem evita mandar e-mail novo para quem já confirmou o endereço.
   */
  if (user.emailVerified) {
    return { ok: true, message: 'Este endereço já está confirmado.' };
  }

  try {
    await auth.api.sendVerificationEmail({
      body: { email: user.email, callbackURL: '/verificacao' },
    });
  } catch {
    // O Better Auth pode recusar por limite de taxa; a mensagem não promete sucesso.
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Não foi possível enviar agora. Tente novamente em alguns minutos.',
    };
  }

  if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
    revalidatePath(redirectTo);
  }

  return {
    ok: true,
    message: `Enviamos um novo link de confirmação para ${user.email}. O link vale por 24 horas.`,
  };
}

'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO EXPOSTOS AO BROWSER — Inscrições
 *
 *  Toda ação aqui:
 *    1. exige sessão autenticada;
 *    2. exige vínculo ATIVO com a instituição do contexto;
 *    3. **exige a permissão RBAC** correspondente, verificada no servidor;
 *    4. delega ao serviço de aplicação (que roda sob RLS e com controle de
 *       lotação atômico).
 *
 *  O passo 3 é o que impede que esconder um botão na UI seja a única proteção.
 *  A UI filtra por conveniência; a autorização real acontece aqui.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { guardSelfServiceAction } from '@/lib/auth/guard-action';
import { adminPrisma } from '@/lib/db/admin-client';
import {
  cancelRegistration,
  registerForActivity,
  registerForEvent,
  type RegistrationOutcome,
} from '@/lib/events/registration-service';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';

export interface RegistrationActionState {
  ok: boolean;
  code?: string;
  message?: string;
  /** Posição na lista de espera, quando o desfecho foi WAITLISTED. */
  waitlistPosition?: number | null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Guarda de autorização
// ───────────────────────────────────────────────────────────────────────────────
interface GuardResult {
  userId: string;
  tenantId: string;
  principal: Principal;
}

/**
 * Carrega o principal e verifica a permissão exigida.
 *
 * Devolve `null` (e o chamador redireciona ao login) quando não há sessão ou
 * vínculo ativo. Lança quando há sessão mas falta permissão — um erro de
 * autorização precisa ser visível, não silencioso.
 */
async function guard(
  tenantSlug: string,
  permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
  options: { ownership?: { ownerId: string }; allowAnonymous?: boolean } = {},
): Promise<GuardResult | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  // Resolve o tenant pelo slug do contexto ativo. A consulta é global
  // (`tenants` não tem RLS por tenantId) e o slug vem da URL, não do cliente.
  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });
  if (!tenant) return null;

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') return null;

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  const allowed = can(
    principal,
    permission,
    { scope: 'TENANT' },
    options.ownership,
  );

  if (!allowed) {
    throw new Error(
      `Permissão negada: ${permission}. Fale com a organização do evento.`,
    );
  }

  return { userId: user.id, tenantId: tenant.id, principal };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Inscrição
// ───────────────────────────────────────────────────────────────────────────────
const registerSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  activitySlug: z.string().trim().min(1).max(140),
  consentImage: z.coerce.boolean().optional().default(false),
  consentData: z.coerce.boolean().optional().default(false),
  accessibilityNotes: z.string().trim().max(600).optional(),
});

export async function registerForActivityAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const raw = {
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    activitySlug: formData.get('activitySlug'),
    consentImage: formData.get('consentImage') === 'on',
    consentData: formData.get('consentData') === 'on',
    accessibilityNotes: (formData.get('accessibilityNotes') as string) || undefined,
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do formulário inválidos.' };
  }

  const data = parsed.data;

  /**
   * A guarda da AÇÃO PÚBLICA vive em `@/lib/auth/guard-action` desde a FASE 33: a
   * proposta de chamada (call for proposals) faz exatamente a mesma pergunta —
   * "esta conta, com ou sem vínculo, pode se inscrever/propor nesta instituição
   * aberta?" — e duas cópias da mesma autorização divergem na primeira manutenção
   * (armadilha 55). A cópia local saiu daqui.
   */
  const context = await guardSelfServiceAction({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CREATE,
  });

  // Sem sessão: manda para o login preservando o destino exato.
  if (!context.ok) {
    if (context.reason === 'FORBIDDEN') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message:
          'Seu perfil não tem permissão para se inscrever em atividades nesta instituição.',
      };
    }

    const target = tenantPath(
      data.tenantSlug,
      `/eventos/${data.eventSlug}/atividades/${data.activitySlug}`,
    );
    redirect(`/login?redirectTo=${encodeURIComponent(target)}`);
  }

  // LGPD: o consentimento de tratamento de dados é obrigatório para inscrever.
  if (!data.consentData) {
    return {
      ok: false,
      code: 'CONSENT_REQUIRED',
      message: 'É necessário autorizar o tratamento dos seus dados para se inscrever.',
    };
  }

  const outcome: RegistrationOutcome = await registerForActivity({
    tenantId: context.tenantId,
    eventSlug: data.eventSlug,
    activitySlug: data.activitySlug,
    userId: context.userId,
    consentImage: data.consentImage,
    consentData: data.consentData,
    accessibilityNotes: data.accessibilityNotes ?? null,
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  // A página precisa refletir o novo contador de vagas.
  revalidatePath(
    tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`),
    'page',
  );
  revalidatePath(
    tenantPath(
      data.tenantSlug,
      `/eventos/${data.eventSlug}/atividades/${data.activitySlug}`,
    ),
    'page',
  );

  return {
    ok: true,
    code: outcome.status,
    waitlistPosition: outcome.waitlistPosition,
    message:
      outcome.status === 'CONFIRMED'
        ? outcome.linkedAsParticipant
          ? 'Inscrição confirmada! Sua conta passou a ser participante desta instituição.'
          : 'Inscrição confirmada!'
        : `Você entrou na lista de espera (posição ${outcome.waitlistPosition}).`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Inscrição no EVENTO (revisão da FASE 3)
// ───────────────────────────────────────────────────────────────────────────────
const registerForEventSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  consentImage: z.coerce.boolean().optional().default(false),
  consentData: z.coerce.boolean().optional().default(false),
  accessibilityNotes: z.string().trim().max(600).optional(),
});

/**
 * Inscreve a pessoa no evento — e, com isso, em todas as atividades ABERTAS.
 *
 * A ação é a mesma porta da inscrição por atividade (o guarda de vínculo é
 * compartilhado), mas o destino é o evento: quem se inscreve aqui passa a ver a
 * programação liberada, e a mensagem diz o que aconteceu de automático — a pessoa
 * precisa saber em que ela acabou de ser inscrita.
 */
export async function registerForEventAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const parsed = registerForEventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    consentImage: formData.get('consentImage') === 'on',
    consentData: formData.get('consentData') === 'on',
    accessibilityNotes: (formData.get('accessibilityNotes') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do formulário inválidos.' };
  }

  const data = parsed.data;

  /**
   * A guarda da AÇÃO PÚBLICA vive em `@/lib/auth/guard-action` desde a FASE 33: a
   * proposta de chamada (call for proposals) faz exatamente a mesma pergunta —
   * "esta conta, com ou sem vínculo, pode se inscrever/propor nesta instituição
   * aberta?" — e duas cópias da mesma autorização divergem na primeira manutenção
   * (armadilha 55). A cópia local saiu daqui.
   */
  const context = await guardSelfServiceAction({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CREATE,
  });

  if (!context.ok) {
    if (context.reason === 'FORBIDDEN') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message:
          'Seu perfil não tem permissão para se inscrever nesta instituição.',
      };
    }

    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`),
      )}`,
    );
  }

  if (!data.consentData) {
    return {
      ok: false,
      code: 'CONSENT_REQUIRED',
      message: 'É necessário autorizar o tratamento dos seus dados para se inscrever.',
    };
  }

  const outcome = await registerForEvent({
    tenantId: context.tenantId,
    eventSlug: data.eventSlug,
    userId: context.userId,
    consentImage: data.consentImage,
    consentData: data.consentData,
    accessibilityNotes: data.accessibilityNotes ?? null,
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  // A programação inteira muda de estado para esta pessoa: as atividades abertas
  // passam a ter a inscrição dela, e a página do evento mostra o crachá.
  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'layout');
  revalidatePath(tenantPath(data.tenantSlug, '/minhas-inscricoes'), 'page');

  const automatic =
    outcome.enrolledActivities > 0
      ? ` Você também foi inscrito automaticamente em ${outcome.enrolledActivities} atividade(s) aberta(s) a todos os participantes: ${outcome.titles.join(', ')}.`
      : '';

  return {
    ok: true,
    code: 'CONFIRMED',
    message: `Inscrição no evento confirmada!${automatic}${
      outcome.linkedAsParticipant
        ? ' Sua conta passou a ser participante desta instituição.'
        : ''
    }`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cancelamento
// ───────────────────────────────────────────────────────────────────────────────
const cancelSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  registrationId: z.string().uuid('Inscrição inválida.'),
  activitySlug: z.string().trim().max(140).optional(),
});

export async function cancelRegistrationAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const parsed = cancelSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    registrationId: formData.get('registrationId'),
    activitySlug: (formData.get('activitySlug') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const data = parsed.data;

  /**
   * Cancelamento é uma permissão `:own`, e `can()` NEGA quando a posse não é
   * informada (fail-closed, por design). Por isso passamos `ownership`
   * explicitamente.
   *
   * Isso não é uma brecha: o "dono" aqui é o próprio usuário autenticado, cujo
   * id vem da SESSÃO — nunca do formulário. O cliente não pode declarar posse
   * da inscrição de outra pessoa porque o id de dono não é dado de entrada. E o
   * serviço de aplicação ainda filtra por `userId` na consulta.
   *
   * Este erro (chamar `can()` sem `ownership`) fazia o cancelamento falhar
   * SEMPRE, com "Permissão negada". Descoberto pelo E2E de cancelamento.
   */
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`),
      )}`,
    );
  }

  const context = await guard(
    data.tenantSlug,
    PERMISSIONS.REGISTRATION_CANCEL_OWN,
    { ownership: { ownerId: user.id } },
  );

  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`),
      )}`,
    );
  }

  const outcome = await cancelRegistration({
    tenantId: context.tenantId,
    registrationId: data.registrationId,
    userId: context.userId,
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'page');
  revalidatePath(tenantPath(data.tenantSlug, '/minhas-inscricoes'), 'page');

  return {
    ok: true,
    code: 'CANCELED',
    message: outcome.promoted
      ? 'Inscrição cancelada. A próxima pessoa da lista de espera foi confirmada.'
      : 'Inscrição cancelada.',
  };
}

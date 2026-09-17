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
import { adminPrisma } from '@/lib/db/admin-client';
import {
  cancelRegistration,
  registerForActivity,
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

/**
 * Contexto para INSCRIÇÃO PRÓPRIA em evento público (FASE 10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DOIS CAMINHOS, E POR QUE ELES NÃO SE MISTURAM
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. PESSOA DE FORA (sem vínculo com a instituição). A inscrição é pública: basta
 *     estar autenticado. O vínculo de participante é criado pelo próprio serviço,
 *     na mesma transação da inscrição — e as regras de bloqueio (vínculo suspenso
 *     ou removido) são aplicadas lá, onde o estado é lido sob RLS.
 *
 *  2. MEMBRO (vínculo ATIVO). Continua valendo `registration:create`: um
 *     patrocinador com vínculo e sem essa permissão NÃO se inscreve. Isto é
 *     deliberado — a FASE 10 abriu a porta para quem está fora, não reescreveu as
 *     regras de quem está dentro.
 *
 *  Devolve o contexto ou a resposta de erro já pronta, para que a ação não precise
 *  repetir a lógica em cada ramo.
 */
async function guardSelfRegistration(tenantSlug: string): Promise<
  | { ok: true; userId: string; tenantId: string; viaPublicLink: boolean }
  | { ok: false; reason: 'NOT_AUTHENTICATED' | 'TENANT_NOT_FOUND' | 'FORBIDDEN' }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, reason: 'NOT_AUTHENTICATED' };

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });
  if (!tenant) return { ok: false, reason: 'TENANT_NOT_FOUND' };

  /**
   * O vínculo é lido SEM filtrar `deletedAt`: quem foi removido precisa receber
   * "acesso bloqueado" (mensagem do serviço), e não o silêncio de um vínculo
   * inexistente. Um filtro aqui transformaria um bloqueio em "não encontrado".
   */
  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id },
    select: { status: true, deletedAt: true },
  });

  if (membership?.status === 'ACTIVE' && membership.deletedAt === null) {
    const principal = await loadPrincipal(user.id, tenant.id, 'ACTIVE');

    const allowed = can(principal, PERMISSIONS.REGISTRATION_CREATE, { scope: 'TENANT' });

    if (!allowed) return { ok: false, reason: 'FORBIDDEN' };

    return { ok: true, userId: user.id, tenantId: tenant.id, viaPublicLink: false };
  }

  // Sem vínculo ativo: a inscrição pública decide (inclusive os bloqueios).
  return { ok: true, userId: user.id, tenantId: tenant.id, viaPublicLink: true };
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

  const context = await guardSelfRegistration(data.tenantSlug);

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

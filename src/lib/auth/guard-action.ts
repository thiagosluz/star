/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Guarda compartilhada das Server Actions
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO EXISTE (FASE 31)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada arquivo de actions tinha a SUA cópia da mesma guarda: sessão, instituição por
 *  slug, vínculo ativo e permissão. Cópia de regra é regra que diverge (armadilha 55) —
 *  e a autorização é o pior lugar para uma cópia divergir.
 *
 *  O ESCOPO é o que muda de caso para caso, e é por isso que ele entra por parâmetro:
 *
 *    • `TENANT` — quem tem o papel na instituição inteira (o caso mais comum);
 *    • `EVENT` — quem tem o papel só naquele evento (a equipe do dia, FASE 12/I7).
 *      Quem chega por aqui precisa dizer QUAL evento, e a permissão é conferida
 *      contra ele — não basta "tem em algum evento".
 *
 *  `loadPrincipal` é quem resolve as concessões: a guarda não inventa permissão.
 *  A RLS continua sendo a última linha; isto é a PRIMEIRA (invariante nº 3).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import type { PERMISSIONS } from '@/domain/rbac/permissions';

export type ActionPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface ActionGuardState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

export type GuardedAction<TState extends ActionGuardState> =
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: TState };

/**
 * Autoriza uma Server Action.
 *
 * A ordem das checagens é contrato: sessão → instituição → vínculo → permissão.
 * Inverter deixaria uma pessoa sem vínculo receber "permissão negada" (uma mensagem
 * sobre a coisa errada) e um slug inexistente virar "sessão expirada".
 */
export async function guardAction<TState extends ActionGuardState = ActionGuardState>(input: {
  tenantSlug: string;
  permission: ActionPermission;
  /** Escopos aceitos. O padrão é `TENANT` (o papel vale na instituição inteira). */
  allowedScopes?: readonly ('TENANT' | 'EVENT' | 'ACTIVITY' | 'PLATFORM')[];
  /** Evento da operação, quando o escopo de EVENTO autoriza. */
  eventId?: string | null;
}): Promise<GuardedAction<TState>> {
  const fail = (code: string, message: string): GuardedAction<TState> =>
    ({ ok: false, state: { ok: false, code, message } as TState });

  const user = await getAuthenticatedUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'Sessão expirada. Entre novamente.');

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true },
  });

  if (!tenant) return fail('NOT_FOUND', 'Instituição não encontrada.');

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return fail('FORBIDDEN', 'Você não tem vínculo ativo com esta instituição.');
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);
  const scopes = input.allowedScopes ?? ['TENANT'];

  const authorized = scopes.some((scope) =>
    scope === 'EVENT'
      ? can(principal, input.permission, { scope: 'EVENT', eventId: input.eventId ?? undefined })
      : can(principal, input.permission, { scope }),
  );

  if (!authorized) {
    return fail('FORBIDDEN', `Permissão negada: ${input.permission}.`);
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

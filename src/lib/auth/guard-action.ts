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

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  PERMISSÃO `:own` NA ACTION: O DONO É SEMPRE QUEM ESTÁ NA SESSÃO (FASE 32)
   * ─────────────────────────────────────────────────────────────────────────────
   *  `can()` recusa uma permissão `:own` sem `ownerId` (fail-closed, invariante nº 4).
   *  A guarda de PÁGINA já resolvia isso (`requirePagePermission` passa
   *  `ownerId: context.user.id`); esta guarda não passava, e o efeito era silencioso:
   *  a action recusava com "permissão negada" para a PRÓPRIA pessoa.
   *
   *  Numa action, o alvo de uma permissão `:own` é a pessoa autenticada — o dono do
   *  RECURSO continua sendo conferido depois, no serviço, com o id vindo do BANCO
   *  (é o que separa "pode usar a própria caixa" de "pode usar a caixa de qualquer
   *  um"). Sem esta linha, metade da lição da FASE 25 voltava pela porta dos fundos.
   */
  const ownership = input.permission.endsWith(':own') ? { ownerId: user.id } : undefined;

  const authorized = scopes.some((scope) =>
    scope === 'EVENT'
      ? can(
          principal,
          input.permission,
          { scope: 'EVENT', eventId: input.eventId ?? undefined },
          ownership,
        )
      : can(principal, input.permission, { scope }, ownership),
  );

  if (!authorized) {
    return fail('FORBIDDEN', `Permissão negada: ${input.permission}.`);
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Guarda de AÇÃO PÚBLICA AUTENTICADA (inscrição, proposta…)
// ───────────────────────────────────────────────────────────────────────────────
export type SelfServiceGuard =
  | {
      ok: true;
      userId: string;
      tenantId: string;
      /** Sem vínculo ativo: quem decide o resto é o serviço, sob RLS. */
      viaPublicLink: boolean;
    }
  | { ok: false; reason: 'NOT_AUTHENTICATED' | 'TENANT_NOT_FOUND' | 'FORBIDDEN' };

/**
 * Autoriza quem chegou por uma PÁGINA PÚBLICA — com ou sem vínculo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A `guardAction` NÃO SERVE AQUI (FASE 33)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A `guardAction` exige vínculo ativo. Mas quem acabou de criar conta para se
 *  inscrever num evento aberto **não tem vínculo nenhum** — é justamente o vínculo
 *  que a inscrição vai criar. Usar a guarda comum ali recusaria o caso normal com
 *  "você não tem vínculo ativo com esta instituição": uma mensagem sobre a coisa
 *  errada, no momento em que a pessoa está entrando.
 *
 *  A regra tem dois ramos:
 *
 *    1. **VÍNCULO ATIVO** — vale a permissão pedida. Um patrocinador com vínculo e sem
 *       `registration:create` NÃO se inscreve: abrir a porta para quem está fora não
 *       reescreveu as regras de quem está dentro (decisão da FASE 10);
 *    2. **SEM VÍNCULO ATIVO** — passa, e o SERVIÇO aplica os bloqueios (vínculo
 *       suspenso ou removido) sob RLS, na transação do próprio fato.
 *
 *  Isto mora aqui, e não numa cópia por arquivo de action, porque a inscrição pública
 *  (FASE 10) e a proposta de chamada (FASE 33) fazem exatamente a mesma pergunta — e
 *  duas cópias da mesma autorização divergem na primeira manutenção (armadilha 55).
 */
export async function guardSelfServiceAction(input: {
  tenantSlug: string;
  permission: ActionPermission;
}): Promise<SelfServiceGuard> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, reason: 'NOT_AUTHENTICATED' };

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
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
    const ownership = input.permission.endsWith(':own') ? { ownerId: user.id } : undefined;

    if (!can(principal, input.permission, { scope: 'TENANT' }, ownership)) {
      return { ok: false, reason: 'FORBIDDEN' };
    }

    return { ok: true, userId: user.id, tenantId: tenant.id, viaPublicLink: false };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, viaPublicLink: true };
}

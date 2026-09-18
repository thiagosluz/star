/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Motor de autorização
 *
 *  Responde a uma única pergunta: **este usuário pode fazer esta ação, neste
 *  escopo, agora?**
 *
 *  Toda a lógica é pura: recebe um `Principal` já carregado e decide. Não toca
 *  em banco. Isso torna cada regra testável em milissegundos e impede que a
 *  regra de negócio se misture com a camada de transporte do framework.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  type Permission,
  type RoleKey,
  type RoleScope,
  permissionsForRole,
  scopeCovers,
} from './permissions';

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Uma concessão de papel ativa.
 *
 * `scope` define ONDE o papel vale. Os campos `eventId`/`activityId` são o alvo:
 *  - scope TENANT   -> ambos null
 *  - scope EVENT    -> eventId preenchido
 *  - scope ACTIVITY -> activityId preenchido (eventId pode vir junto)
 */
export interface RoleAssignment {
  role: RoleKey;
  scope: RoleScope;
  eventId?: string | null;
  activityId?: string | null;
  /** Vigência. `null` = sem expiração. */
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}

/**
 * Identidade autorizável.
 *
 * O acúmulo de papéis acontece aqui: `assignments` pode conter vários papéis
 * simultâneos (Participante no evento A, Palestrante no evento B, Revisor no
 * evento C) — inclusive mais de um no mesmo alvo.
 *
 * `tenantId` é **nulo** para um principal de PLATAFORMA (FASE 9): papéis de
 * plataforma não pertencem a instituição alguma. O campo deixa de ser obrigatório
 * exatamente para que essa distinção exista no TIPO — um papel de plataforma não
 * pode ser confundido com um papel de tenant por engano de construção.
 */
export interface Principal {
  userId: string;
  tenantId: string | null;
  /** Status do vínculo (`UserTenantProfile.status`). */
  membershipStatus: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  assignments: readonly RoleAssignment[];
}

/**
 * Principal de plataforma.
 *
 * Açúcar sintático sobre `Principal` com `tenantId: null`, deixando explícito em
 * quem carrega o SuperAdmin que ele NÃO está operando dentro de uma instituição.
 */
export type PlatformPrincipal = Principal & { tenantId: null };

/** Onde a permissão está sendo exercida. */
export interface AuthorizationScope {
  scope: RoleScope;
  eventId?: string | null;
  activityId?: string | null;
}

/** Classificação de posse, para as permissões `:own`. */
export interface Ownership {
  ownerId: string;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Utilidades internas
// ───────────────────────────────────────────────────────────────────────────────

/** A concessão está vigente na data informada? */
export function isAssignmentActive(
  assignment: RoleAssignment,
  now: Date = new Date(),
): boolean {
  if (assignment.revokedAt) return false;
  if (assignment.expiresAt && assignment.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

/**
 * A concessão cobre o escopo solicitado?
 *
 * Além da hierarquia de escopo (TENANT ⊃ EVENT ⊃ ACTIVITY), é preciso conferir
 * o ALVO: um papel de ORGANIZER no evento X não pode autorizar ações no evento Y.
 */
export function assignmentCoversScope(
  assignment: RoleAssignment,
  target: AuthorizationScope,
): boolean {
  if (!scopeCovers(assignment.scope, target.scope)) return false;

  switch (assignment.scope) {
    case 'PLATFORM':
      /**
       * Papel de plataforma não tem alvo: vale no escopo de plataforma e em mais
       * nada (`scopeCovers` já recusou qualquer escopo de instituição antes de
       * chegar aqui).
       *
       * A ausência deste `case` fazia a concessão de SuperAdmin cair no `default`
       * e ser negada — o escopo novo existia no tipo e na hierarquia, mas a
       * atribuição não autorizava nada.
       */
      return true;

    case 'TENANT':
      // Cobre tudo dentro do tenant.
      return true;

    case 'EVENT':
      // Vale no próprio evento e nas atividades contidas nele.
      if (!assignment.eventId) return false;
      if (target.eventId && assignment.eventId !== target.eventId) return false;
      // Alvo no nível de atividade: só se a atividade pertencer a este evento.
      // A pertinência é validada pela camada de aplicação (que tem o dado);
      // aqui exigimos ao menos que o alvo declare o evento.
      if (target.scope === 'ACTIVITY') {
        return target.eventId === assignment.eventId;
      }
      return true;

    case 'ACTIVITY':
      // Vale apenas na atividade exata.
      if (!assignment.activityId) return false;
      return assignment.activityId === target.activityId;

    default:
      return false;
  }
}

/** Permissões efetivas do principal, considerando apenas concessões vigentes. */
export function effectivePermissions(
  principal: Principal,
  now: Date = new Date(),
): ReadonlySet<Permission> {
  const result = new Set<Permission>();
  for (const assignment of principal.assignments) {
    if (!isAssignmentActive(assignment, now)) continue;
    for (const permission of permissionsForRole(assignment.role)) {
      result.add(permission);
    }
  }
  return result;
}

/** Papéis vigentes do principal. */
export function activeRoles(
  principal: Principal,
  now: Date = new Date(),
): readonly RoleKey[] {
  const roles = new Set<RoleKey>();
  for (const assignment of principal.assignments) {
    if (isAssignmentActive(assignment, now)) roles.add(assignment.role);
  }
  return [...roles];
}

/**
 * O vínculo permite operar o tenant?
 *
 * INVITED e SUSPENDED não autorizam nada: são estados de transição. Isso é
 * fail-closed — um convite não aceito não concede acesso.
 */
export function isMembershipOperational(principal: Principal): boolean {
  return principal.membershipStatus === 'ACTIVE';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Erros de domínio
// ───────────────────────────────────────────────────────────────────────────────
export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_AUTHENTICATED' | 'NOT_A_MEMBER' | 'FORBIDDEN' | 'TENANT_MISMATCH',
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Motor
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Decide se o principal pode exercer `permission` no escopo informado.
 *
 * @param ownership Quando a permissão é `:own`, o dono do recurso. Obrigatório
 *                  nesse caso — sem ele, a checagem falha (fail-closed).
 */
export function can(
  principal: Principal | null | undefined,
  permission: Permission,
  target: AuthorizationScope,
  ownership?: Ownership,
  now: Date = new Date(),
): boolean {
  if (!principal) return false;
  if (!isMembershipOperational(principal)) return false;

  // Uma permissão `:own` exige que saibamos de quem é o recurso. Sem essa
  // informação não há como afirmar a posse, então negamos.
  const requiresOwnership = permission.endsWith(':own');
  if (requiresOwnership) {
    if (!ownership?.ownerId) return false;
    // O usuário precisa ter ao menos uma concessão vigente neste escopo, e ser
    // o dono do recurso.
    if (ownership.ownerId !== principal.userId) return false;
  }

  for (const assignment of principal.assignments) {
    if (!isAssignmentActive(assignment, now)) continue;
    if (!assignmentCoversScope(assignment, target)) continue;

    const granted = permissionsForRole(assignment.role);
    if (granted.includes(permission)) return true;
  }

  return false;
}

/**
 * Igual a `can`, mas lança `AuthorizationError` em vez de retornar `false`.
 * Use nos pontos de entrada (Server Actions, Route Handlers) onde negar acesso
 * deve abortar a operação com erro explícito.
 */
export function requirePermission(
  principal: Principal | null | undefined,
  permission: Permission,
  target: AuthorizationScope,
  ownership?: Ownership,
  now: Date = new Date(),
): void {
  if (!principal) {
    throw new AuthorizationError('Autenticação necessária.', 'NOT_AUTHENTICATED');
  }
  if (!isMembershipOperational(principal)) {
    throw new AuthorizationError(
      'Seu vínculo com esta instituição não está ativo.',
      'NOT_A_MEMBER',
    );
  }
  if (!can(principal, permission, target, ownership, now)) {
    throw new AuthorizationError(
      `Permissão negada: ${permission} em escopo ${target.scope}.`,
      'FORBIDDEN',
    );
  }
}

/**
 * O principal tem esta permissão em ALGUM escopo vigente?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO SUBSTITUI `can()` (FASE 25)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `can()` responde "pode, NESTE alvo". Existe um caso em que não há UM alvo: a
 *  porta de um painel PESSOAL — o palestrante que abre `/palestrante` e vê as
 *  atividades que ministra. Ali o conjunto de alvos é definido pela POSSE (os
 *  vínculos dele), não pelo escopo da concessão: o papel pode ter vindo no escopo
 *  `ACTIVITY` (uma atividade específica) ou `EVENT`, e exigir `TENANT` recusaria
 *  exatamente o padrão que a plataforma recomenda.
 *
 *  Esta função é a primeira peneira ("você é palestrante em algum lugar?"). Quem
 *  passa por ela NÃO ganha acesso a nada: cada consulta do painel filtra por
 *  `userId`, e cada ESCRITA chama `can()` com o alvo exato e o `ownerId` da linha.
 *  Portal aberto por permissão ampla e dado filtrado por posse é a combinação que
 *  mantém a regra verificável.
 */
export function holdsPermission(
  principal: Principal | null | undefined,
  permission: Permission,
  now: Date = new Date(),
): boolean {
  if (!principal) return false;
  if (!isMembershipOperational(principal)) return false;

  for (const assignment of principal.assignments) {
    if (!isAssignmentActive(assignment, now)) continue;
    if (permissionsForRole(assignment.role).includes(permission)) return true;
  }

  return false;
}

/**
 * Verifica se o principal pertence ao tenant informado.
 *
 * Barreira barata que deve rodar ANTES de qualquer consulta: se o usuário não é
 * membro, não há razão para sequer abrir transação contra o banco.
 */
export function assertSameTenant(principal: Principal, tenantId: string): void {
  if (principal.tenantId !== tenantId) {
    throw new AuthorizationError(
      'O contexto ativo não corresponde ao recurso solicitado.',
      'TENANT_MISMATCH',
    );
  }
}

/** O principal tem ALGUM papel privilegiado (organização) neste tenant? */
export function isPrivileged(principal: Principal, now: Date = new Date()): boolean {
  const privileged = new Set<RoleKey>(['OWNER', 'ADMIN', 'ORGANIZER']);
  return activeRoles(principal, now).some((role) => privileged.has(role));
}

/**
 * Resumo legível dos papéis do principal — usado na UI de troca de contexto.
 */
export interface RoleSummary {
  role: RoleKey;
  scope: RoleScope;
  eventId: string | null;
  activityId: string | null;
}

export function summarizeRoles(
  principal: Principal,
  now: Date = new Date(),
): readonly RoleSummary[] {
  return principal.assignments
    .filter((a) => isAssignmentActive(a, now))
    .map((a) => ({
      role: a.role,
      scope: a.scope,
      eventId: a.eventId ?? null,
      activityId: a.activityId ?? null,
    }));
}

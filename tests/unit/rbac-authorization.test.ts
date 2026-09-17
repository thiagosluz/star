/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — autorização e RBAC
 *
 *  Domínio puro: nenhum banco, nenhum servidor. Cada regra é verificada em
 *  milissegundos, o que torna barato cobrir os casos de borda que realmente
 *  importam (escopo errado, concessão expirada, papel acumulado, posse).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  type Principal,
  type RoleAssignment,
  AuthorizationError,
  activeRoles,
  assertSameTenant,
  can,
  effectivePermissions,
  isAssignmentActive,
  requirePermission,
  summarizeRoles,
} from '../../src/domain/rbac/authorization';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_KEYS,
  TENANT_ONLY_ROLES,
  isPermission,
  permissionsForRole,
  roleAllowedInScope,
  scopeCovers,
} from '../../src/domain/rbac/permissions';

// ───────────────────────────────────────────────────────────────────────────────
//  Construtores auxiliares
// ───────────────────────────────────────────────────────────────────────────────
const TENANT = 'tenant-1';
const USER = 'user-1';
const OTHER_USER = 'user-2';
const EVENT_A = 'event-a';
const EVENT_B = 'event-b';
const ACTIVITY_A1 = 'activity-a1';
const ACTIVITY_B1 = 'activity-b1';

function principal(
  assignments: RoleAssignment[],
  overrides: Partial<Principal> = {},
): Principal {
  return {
    userId: USER,
    tenantId: TENANT,
    membershipStatus: 'ACTIVE',
    assignments,
    ...overrides,
  };
}

const tenantScope = { scope: 'TENANT' as const };
const eventAScope = { scope: 'EVENT' as const, eventId: EVENT_A };
const activityA1Scope = {
  scope: 'ACTIVITY' as const,
  eventId: EVENT_A,
  activityId: ACTIVITY_A1,
};

// ═══════════════════════════════════════════════════════════════════════════════
describe('catálogo de permissões', () => {
  it('não contém duplicatas', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('reconhece apenas permissões declaradas', () => {
    expect(isPermission(PERMISSIONS.EVENT_READ)).toBe(true);
    expect(isPermission('event:destroy-everything')).toBe(false);
    expect(isPermission('')).toBe(false);
  });

  it('todo papel tem um conjunto de permissões definido', () => {
    for (const role of ROLE_KEYS) {
      expect(Array.isArray(permissionsForRole(role))).toBe(true);
    }
  });

  it('OWNER tem todas as permissões e ADMIN tem um subconjunto próprio', () => {
    expect(permissionsForRole('OWNER')).toHaveLength(ALL_PERMISSIONS.length);
    expect(permissionsForRole('ADMIN').length).toBeLessThan(ALL_PERMISSIONS.length);
    expect(permissionsForRole('ADMIN')).not.toContain(PERMISSIONS.TENANT_DELETE);
  });

  it('nenhum papel comum recebe permissões destrutivas do tenant', () => {
    for (const role of ROLE_KEYS) {
      if (role === 'OWNER' || role === 'ADMIN') continue;
      expect(permissionsForRole(role)).not.toContain(PERMISSIONS.TENANT_DELETE);
      expect(permissionsForRole(role)).not.toContain(PERMISSIONS.TENANT_MEMBER_REMOVE);
    }
  });

  it('REVIEWER não pode ler pareceres alheios (só :own)', () => {
    const reviewerPermissions = permissionsForRole('REVIEWER');
    expect(reviewerPermissions).toContain(PERMISSIONS.REVIEW_READ_OWN);
    expect(reviewerPermissions).not.toContain(PERMISSIONS.REVIEW_READ_ANY);
    expect(reviewerPermissions).not.toContain(PERMISSIONS.REVIEW_SUBMIT_OWN.replace(':own', ':any'));
  });

  it('PARTICIPANT não tem acesso a decisão nem a gestão de papéis', () => {
    const participant = permissionsForRole('PARTICIPANT');
    expect(participant).not.toContain(PERMISSIONS.SUBMISSION_DECIDE);
    expect(participant).not.toContain(PERMISSIONS.TENANT_ROLE_ASSIGN);
    expect(participant).not.toContain(PERMISSIONS.REGISTRATION_READ_ANY);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('hierarquia de escopo', () => {
  it('TENANT cobre EVENT e ACTIVITY', () => {
    expect(scopeCovers('TENANT', 'EVENT')).toBe(true);
    expect(scopeCovers('TENANT', 'ACTIVITY')).toBe(true);
  });

  it('EVENT cobre ACTIVITY mas não TENANT', () => {
    expect(scopeCovers('EVENT', 'ACTIVITY')).toBe(true);
    expect(scopeCovers('EVENT', 'TENANT')).toBe(false);
  });

  it('ACTIVITY não cobre escopos mais amplos', () => {
    expect(scopeCovers('ACTIVITY', 'EVENT')).toBe(false);
    expect(scopeCovers('ACTIVITY', 'TENANT')).toBe(false);
  });

  it('papéis administrativos só podem ser concedidos no escopo de tenant', () => {
    for (const role of TENANT_ONLY_ROLES) {
      expect(roleAllowedInScope(role, 'TENANT')).toBe(true);
      expect(roleAllowedInScope(role, 'EVENT')).toBe(false);
      expect(roleAllowedInScope(role, 'ACTIVITY')).toBe(false);
    }
  });

  it('papéis operacionais podem ser concedidos em qualquer escopo', () => {
    for (const role of ['REVIEWER', 'SPEAKER', 'STAFF', 'PARTICIPANT'] as const) {
      expect(roleAllowedInScope(role, 'TENANT')).toBe(true);
      expect(roleAllowedInScope(role, 'EVENT')).toBe(true);
      expect(roleAllowedInScope(role, 'ACTIVITY')).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('vigência das concessões', () => {
  it('concessão sem expiração e não revogada está ativa', () => {
    expect(isAssignmentActive({ role: 'STAFF', scope: 'TENANT' })).toBe(true);
  });

  it('concessão revogada está inativa mesmo sem data de expiração', () => {
    expect(
      isAssignmentActive({ role: 'STAFF', scope: 'TENANT', revokedAt: new Date() }),
    ).toBe(false);
  });

  it('concessão expirada está inativa', () => {
    const past = new Date(Date.now() - 1000);
    expect(
      isAssignmentActive({ role: 'STAFF', scope: 'TENANT', expiresAt: past }),
    ).toBe(false);
  });

  it('concessão com expiração futura está ativa', () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(
      isAssignmentActive({ role: 'STAFF', scope: 'TENANT', expiresAt: future }),
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('acúmulo de papéis', () => {
  it('um usuário pode acumular papéis em alvos diferentes', () => {
    // Participante no evento A, Palestrante no evento B, Revisor no evento A.
    const p = principal([
      { role: 'PARTICIPANT', scope: 'EVENT', eventId: EVENT_A },
      { role: 'SPEAKER', scope: 'EVENT', eventId: EVENT_B },
      { role: 'REVIEWER', scope: 'EVENT', eventId: EVENT_A },
    ]);

    expect(new Set(activeRoles(p))).toEqual(
      new Set(['PARTICIPANT', 'SPEAKER', 'REVIEWER']),
    );
  });

  it('acumula permissões de todos os papéis', () => {
    const p = principal([
      { role: 'SPEAKER', scope: 'EVENT', eventId: EVENT_A },
      { role: 'REVIEWER', scope: 'EVENT', eventId: EVENT_A },
    ]);

    const permissions = effectivePermissions(p);
    expect(permissions.has(PERMISSIONS.REVIEW_SUBMIT_OWN)).toBe(true);
    expect(permissions.has(PERMISSIONS.SUBMISSION_CREATE)).toBe(true);
  });

  it('papel de ORGANIZER e SPEAKER no mesmo evento coexistem', () => {
    const p = principal([
      { role: 'ORGANIZER', scope: 'EVENT', eventId: EVENT_A },
      { role: 'SPEAKER', scope: 'EVENT', eventId: EVENT_A },
    ]);

    expect(can(p, PERMISSIONS.ACTIVITY_CREATE, eventAScope)).toBe(true);
    expect(can(p, PERMISSIONS.SUBMISSION_CREATE, eventAScope)).toBe(true);
  });

  it('permissões de papéis expirados não contam', () => {
    const p = principal([
      {
        role: 'ORGANIZER',
        scope: 'TENANT',
        expiresAt: new Date(Date.now() - 1000),
      },
    ]);

    expect(can(p, PERMISSIONS.EVENT_CREATE, tenantScope)).toBe(false);
    expect(activeRoles(p)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('can() — decisão de acesso', () => {
  it('nega quando não há principal', () => {
    expect(can(null, PERMISSIONS.EVENT_READ, tenantScope)).toBe(false);
    expect(can(undefined, PERMISSIONS.EVENT_READ, tenantScope)).toBe(false);
  });

  it('nega vínculo que não está ACTIVE (fail-closed)', () => {
    for (const status of ['INVITED', 'SUSPENDED', 'REMOVED'] as const) {
      const p = principal([{ role: 'OWNER', scope: 'TENANT' }], {
        membershipStatus: status,
      });
      expect(can(p, PERMISSIONS.EVENT_READ, tenantScope)).toBe(false);
    }
  });

  it('permite ao OWNER qualquer permissão no escopo de tenant', () => {
    const p = principal([{ role: 'OWNER', scope: 'TENANT' }]);
    for (const permission of ALL_PERMISSIONS) {
      // Permissões `:own` ainda exigem posse; testamos sem para as demais.
      if (permission.endsWith(':own')) continue;
      expect(can(p, permission, tenantScope)).toBe(true);
    }
  });

  it('um papel por evento NÃO autoriza ações em outro evento', () => {
    const p = principal([{ role: 'ORGANIZER', scope: 'EVENT', eventId: EVENT_A }]);

    expect(can(p, PERMISSIONS.ACTIVITY_CREATE, eventAScope)).toBe(true);
    expect(
      can(p, PERMISSIONS.ACTIVITY_CREATE, { scope: 'EVENT', eventId: EVENT_B }),
    ).toBe(false);
  });

  it('um papel por evento NÃO autoriza ações no escopo do tenant', () => {
    const p = principal([{ role: 'ORGANIZER', scope: 'EVENT', eventId: EVENT_A }]);
    expect(can(p, PERMISSIONS.EVENT_CREATE, tenantScope)).toBe(false);
  });

  it('um papel por atividade vale só naquela atividade', () => {
    const p = principal([
      { role: 'STAFF', scope: 'ACTIVITY', eventId: EVENT_A, activityId: ACTIVITY_A1 },
    ]);

    expect(can(p, PERMISSIONS.REGISTRATION_CHECKIN, activityA1Scope)).toBe(true);
    expect(
      can(p, PERMISSIONS.REGISTRATION_CHECKIN, {
        scope: 'ACTIVITY',
        eventId: EVENT_A,
        activityId: 'activity-a2',
      }),
    ).toBe(false);
  });

  it('um papel por atividade não vaza para atividade de outro evento', () => {
    const p = principal([
      { role: 'STAFF', scope: 'ACTIVITY', eventId: EVENT_A, activityId: ACTIVITY_A1 },
    ]);

    expect(
      can(p, PERMISSIONS.REGISTRATION_CHECKIN, {
        scope: 'ACTIVITY',
        eventId: EVENT_B,
        activityId: ACTIVITY_B1,
      }),
    ).toBe(false);
  });

  it('concessão de evento sem eventId não autoriza nada (dado inconsistente)', () => {
    const p = principal([{ role: 'ORGANIZER', scope: 'EVENT', eventId: null }]);
    expect(can(p, PERMISSIONS.ACTIVITY_READ, eventAScope)).toBe(false);
  });

  it('concessão de atividade sem activityId não autoriza nada', () => {
    const p = principal([
      { role: 'STAFF', scope: 'ACTIVITY', eventId: EVENT_A, activityId: null },
    ]);
    expect(can(p, PERMISSIONS.REGISTRATION_CHECKIN, activityA1Scope)).toBe(false);
  });

  it('nega permissão que o papel não possui, mesmo no escopo certo', () => {
    const p = principal([{ role: 'PARTICIPANT', scope: 'TENANT' }]);
    expect(can(p, PERMISSIONS.SUBMISSION_DECIDE, tenantScope)).toBe(false);
    expect(can(p, PERMISSIONS.TENANT_MEMBER_INVITE, tenantScope)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('permissões :own — exigem posse explícita', () => {
  it('permite quando o usuário é o dono do recurso', () => {
    const p = principal([{ role: 'PARTICIPANT', scope: 'TENANT' }]);
    expect(
      can(p, PERMISSIONS.SUBMISSION_READ_OWN, tenantScope, { ownerId: USER }),
    ).toBe(true);
  });

  it('nega quando o recurso é de outra pessoa', () => {
    const p = principal([{ role: 'OWNER', scope: 'TENANT' }]);
    expect(
      can(p, PERMISSIONS.SUBMISSION_READ_OWN, tenantScope, { ownerId: OTHER_USER }),
    ).toBe(false);
  });

  it('nega quando a posse não foi informada (fail-closed)', () => {
    const p = principal([{ role: 'OWNER', scope: 'TENANT' }]);
    expect(can(p, PERMISSIONS.SUBMISSION_READ_OWN, tenantScope)).toBe(false);
  });

  it('não confunde permissões :any com :own', () => {
    const p = principal([{ role: 'STAFF', scope: 'TENANT' }]);
    // STAFF tem :any sobre inscrições e não precisa de posse.
    expect(can(p, PERMISSIONS.REGISTRATION_READ_ANY, tenantScope)).toBe(true);
    // Mas não tem :own — a permissão sequer está no conjunto.
    expect(can(p, PERMISSIONS.SUBMISSION_READ_OWN, tenantScope, { ownerId: USER })).toBe(
      false,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('requirePermission() — variante que lança', () => {
  it('lança NOT_AUTHENTICATED sem principal', () => {
    expect(() =>
      requirePermission(null, PERMISSIONS.EVENT_READ, tenantScope),
    ).toThrowError(AuthorizationError);

    try {
      requirePermission(null, PERMISSIONS.EVENT_READ, tenantScope);
    } catch (error) {
      expect((error as AuthorizationError).code).toBe('NOT_AUTHENTICATED');
    }
  });

  it('lança NOT_A_MEMBER com vínculo inativo', () => {
    const p = principal([{ role: 'OWNER', scope: 'TENANT' }], {
      membershipStatus: 'SUSPENDED',
    });

    try {
      requirePermission(p, PERMISSIONS.EVENT_READ, tenantScope);
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect((error as AuthorizationError).code).toBe('NOT_A_MEMBER');
    }
  });

  it('lança FORBIDDEN quando a permissão falta', () => {
    const p = principal([{ role: 'PARTICIPANT', scope: 'TENANT' }]);

    try {
      requirePermission(p, PERMISSIONS.SUBMISSION_DECIDE, tenantScope);
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect((error as AuthorizationError).code).toBe('FORBIDDEN');
    }
  });

  it('não lança quando autorizado', () => {
    const p = principal([{ role: 'ORGANIZER', scope: 'TENANT' }]);
    expect(() =>
      requirePermission(p, PERMISSIONS.EVENT_CREATE, tenantScope),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isolamento entre tenants na camada de autorização', () => {
  it('assertSameTenant rejeita tenant divergente', () => {
    const p = principal([{ role: 'OWNER', scope: 'TENANT' }]);

    expect(() => assertSameTenant(p, TENANT)).not.toThrow();

    try {
      assertSameTenant(p, 'tenant-2');
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect((error as AuthorizationError).code).toBe('TENANT_MISMATCH');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('summarizeRoles()', () => {
  it('ignora concessões inativas', () => {
    const p = principal([
      { role: 'STAFF', scope: 'TENANT' },
      { role: 'REVIEWER', scope: 'TENANT', revokedAt: new Date() },
    ]);

    const summary = summarizeRoles(p);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.role).toBe('STAFF');
  });

  it('preserva o escopo e o alvo de cada concessão', () => {
    const p = principal([
      { role: 'REVIEWER', scope: 'EVENT', eventId: EVENT_A },
      { role: 'STAFF', scope: 'ACTIVITY', eventId: EVENT_A, activityId: ACTIVITY_A1 },
    ]);

    const summary = summarizeRoles(p);
    expect(summary).toContainEqual({
      role: 'REVIEWER',
      scope: 'EVENT',
      eventId: EVENT_A,
      activityId: null,
    });
    expect(summary).toContainEqual({
      role: 'STAFF',
      scope: 'ACTIVITY',
      eventId: EVENT_A,
      activityId: ACTIVITY_A1,
    });
  });
});

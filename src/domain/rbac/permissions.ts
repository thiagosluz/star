/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Catálogo de permissões (RBAC)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PRINCÍPIOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. Este arquivo NÃO importa nada do Next.js, do Prisma ou do React. É domínio
 *     puro e, por isso, testável sem banco e sem servidor.
 *
 *  2. Permissões são strings tipadas no formato `recurso:ação:escopo`. O
 *     terceiro segmento declara **sobre o que** a ação incide:
 *
 *         :any      qualquer registro dentro do escopo do papel
 *         :own      apenas registros dos quais o usuário é dono/autor
 *         (ausente) ação global, não vinculada a um registro
 *
 *     Sem essa distinção, `review:read:any` concedido a um revisor deixaria ele
 *     ler os pareceres de todos os colegas. Com ela, REVIEWER recebe
 *     `review:read:own` e a checagem de propriedade é obrigatória.
 *
 *  3. LISTA BRANCA, não lista negra. Toda permissão existente está declarada
 *     aqui. Conceder algo que não existe é impossível.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Catálogo
// ───────────────────────────────────────────────────────────────────────────────
export const PERMISSIONS = {
  // ── Plataforma / Tenant ─────────────────────────────────────────────────────
  TENANT_READ: 'tenant:read',
  TENANT_UPDATE: 'tenant:update',
  TENANT_DELETE: 'tenant:delete',
  TENANT_BILLING_MANAGE: 'tenant:billing:manage',
  TENANT_MEMBER_INVITE: 'tenant:member:invite',
  TENANT_MEMBER_REMOVE: 'tenant:member:remove',
  TENANT_ROLE_ASSIGN: 'tenant:role:assign',
  TENANT_ANALYTICS_READ: 'tenant:analytics:read',
  TENANT_AUDIT_READ: 'tenant:audit:read',

  // ── Eventos ─────────────────────────────────────────────────────────────────
  EVENT_CREATE: 'event:create',
  EVENT_READ: 'event:read',
  EVENT_UPDATE: 'event:update',
  EVENT_DELETE: 'event:delete',
  EVENT_PUBLISH: 'event:publish',
  /**
   * Administração operacional do evento — FASE 8.
   *
   * Distinta de `event:update` (editar cadastro): `event:manage` cobre ações que
   * AFETAM PESSOAS e produzem resultado auditável — hoje, executar sorteios.
   * Separar as duas permite conceder "cuida do evento" sem conceder "pode
   * sortear".
   */
  EVENT_MANAGE: 'event:manage',

  // ── Atividades ──────────────────────────────────────────────────────────────
  ACTIVITY_CREATE: 'activity:create',
  ACTIVITY_READ: 'activity:read',
  ACTIVITY_UPDATE: 'activity:update',
  ACTIVITY_DELETE: 'activity:delete',

  // ── Inscrições ──────────────────────────────────────────────────────────────
  REGISTRATION_CREATE: 'registration:create',
  REGISTRATION_READ_ANY: 'registration:read:any',
  REGISTRATION_READ_OWN: 'registration:read:own',
  REGISTRATION_UPDATE_ANY: 'registration:update:any',
  REGISTRATION_CANCEL_OWN: 'registration:cancel:own',
  REGISTRATION_CHECKIN: 'registration:checkin',
  REGISTRATION_CHECKOUT: 'registration:checkout',

  // ── Presença ────────────────────────────────────────────────────────────────
  ATTENDANCE_READ: 'attendance:read',
  ATTENDANCE_MANAGE: 'attendance:manage',

  // ── Submissões / Peer review ────────────────────────────────────────────────
  TRACK_MANAGE: 'track:manage',
  SUBMISSION_CREATE: 'submission:create',
  SUBMISSION_READ_ANY: 'submission:read:any',
  SUBMISSION_READ_OWN: 'submission:read:own',
  SUBMISSION_READ_REVIEWABLE: 'submission:read:reviewable',
  SUBMISSION_UPDATE_OWN: 'submission:update:own',
  SUBMISSION_DECIDE: 'submission:decide',
  SUBMISSION_ASSIGN_REVIEWER: 'submission:assign-reviewer',
  REVIEW_SUBMIT_OWN: 'review:submit:own',
  REVIEW_READ_ANY: 'review:read:any',
  REVIEW_READ_OWN: 'review:read:own',
  CONFLICT_MANAGE: 'conflict:manage',

  // ── Gamificação ─────────────────────────────────────────────────────────────
  CARD_TEMPLATE_MANAGE: 'card-template:manage',
  CARD_GRANT: 'card:grant',
  CARD_READ_OWN: 'card:read:own',
  TASK_MANAGE: 'task:manage',
  XP_READ_OWN: 'xp:read:own',
  XP_ADJUST: 'xp:adjust',

  // ── Certificados ────────────────────────────────────────────────────────────
  CERTIFICATE_ISSUE: 'certificate:issue',
  CERTIFICATE_READ_ANY: 'certificate:read:any',
  CERTIFICATE_READ_OWN: 'certificate:read:own',
  CERTIFICATE_REVOKE: 'certificate:revoke',

  // ── Patrocinadores ──────────────────────────────────────────────────────────
  SPONSOR_MANAGE: 'sponsor:manage',
  SPONSOR_READ: 'sponsor:read',

  // ── Conteúdo / Landing page ─────────────────────────────────────────────────
  PAGE_MANAGE: 'page:manage',

  // ── Plataforma (FASE 9) ─────────────────────────────────────────────────────
  /**
   * Governança global: provisionar instituições, definir planos e quotas,
   * suspender tráfego e ler métricas consolidadas.
   *
   * Existe em um escopo PRÓPRIO (`PLATFORM`) e nunca é concedida a papéis de
   * tenant: quem administra uma instituição não administra a plataforma, e quem
   * administra a plataforma não entra no conteúdo das instituições.
   */
  PLATFORM_MANAGE: 'platform:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Todas as permissões válidas, para validação e testes. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(PERMISSIONS),
);

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/** Type guard: a string é uma permissão conhecida? */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escopos
// ───────────────────────────────────────────────────────────────────────────────
export const ROLE_SCOPES = ['PLATFORM', 'TENANT', 'EVENT', 'ACTIVITY'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

/**
 * Hierarquia de escopos: um papel concedido em um escopo mais amplo vale nos
 * escopos mais estreitos contidos nele.
 *
 *   TENANT (3) ⊃ EVENT (2) ⊃ ACTIVITY (1)
 *
 * Exemplo: quem é ORGANIZER no tenant também organiza qualquer evento dele.
 * O contrário NÃO vale: um papel concedido em um evento não vaza para o tenant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  PLATFORM EXISTE, MAS NÃO COBRE OS DEMAIS ESCOPOS
 * ─────────────────────────────────────────────────────────────────────────────
 *  O papel de plataforma governa INSTITUIÇÕES (criar, suspender, medir) e NÃO
 *  concede poder DENTRO delas: um SuperAdmin não vira ADMIN de todos os tenants.
 *
 *  Para agir em uma instituição, a pessoa precisa de vínculo e papel ali. É o que
 *  mantém a fronteira de RLS com significado — e o que impede que uma conta de
 *  suporte comprometida seja uma chave-mestra de todo o conteúdo hospedado.
 */
export const SCOPE_RANK: Record<RoleScope, number> = {
  PLATFORM: 4,
  TENANT: 3,
  EVENT: 2,
  ACTIVITY: 1,
};

/** O escopo `granted` cobre o escopo `required`? */
export function scopeCovers(granted: RoleScope, required: RoleScope): boolean {
  /**
   * A plataforma é um mundo à parte: cobre a si mesma e nada mais. A comparação
   * por nota seria perigosa aqui justamente porque `PLATFORM` tem a maior nota —
   * ela diria que o SuperAdmin cobre `TENANT`, que é exatamente o que não pode.
   */
  if (granted === 'PLATFORM' || required === 'PLATFORM') {
    return granted === 'PLATFORM' && required === 'PLATFORM';
  }

  return SCOPE_RANK[granted] >= SCOPE_RANK[required];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Papéis
// ───────────────────────────────────────────────────────────────────────────────
export const ROLE_KEYS = [
  /**
   * Papel de PLATAFORMA (FASE 9): governa instituições, não conteúdo.
   *
   * Fica no mesmo enum dos papéis de tenant porque a concessão usa a mesma tabela
   * — mas vive em outro escopo (`PLATFORM`), e `scopeCovers` garante que ele não
   * vaze para dentro das instituições.
   */
  'SUPERADMIN',
  'OWNER',
  'ADMIN',
  'ORGANIZER',
  'FINANCE',
  'REVIEWER',
  'CHAIR',
  'SPEAKER',
  'STAFF',
  'PARTICIPANT',
  'SPONSOR',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

/** Papéis que só fazem sentido no escopo de tenant (não por evento/atividade). */
export const TENANT_ONLY_ROLES: readonly RoleKey[] = Object.freeze(['OWNER', 'ADMIN']);

/**
 * Papéis que, mesmo no escopo EVENT/ACTIVITY, enxergam a organização inteira.
 * Usado para decidir se o usuário pode trocar de contexto livremente.
 */
export const PRIVILEGED_ROLES: readonly RoleKey[] = Object.freeze([
  'OWNER',
  'ADMIN',
  'ORGANIZER',
]);

/** Permissões de organização (operam o evento inteiro, não só o próprio dado). */
const ORGANIZER_PERMISSIONS: Permission[] = [
  PERMISSIONS.TENANT_READ,
  PERMISSIONS.TENANT_ANALYTICS_READ,
  PERMISSIONS.EVENT_CREATE,
  PERMISSIONS.EVENT_READ,
  PERMISSIONS.EVENT_UPDATE,
  PERMISSIONS.EVENT_DELETE,
  PERMISSIONS.EVENT_PUBLISH,
  /**
   * `event:manage` — sortear participantes é ato de organização, com efeito
   * público e auditável. Fica com quem responde pelo evento, não com quem apenas
   * coordena a trilha científica (CHAIR).
   */
  PERMISSIONS.EVENT_MANAGE,
  PERMISSIONS.ACTIVITY_CREATE,
  PERMISSIONS.ACTIVITY_READ,
  PERMISSIONS.ACTIVITY_UPDATE,
  PERMISSIONS.ACTIVITY_DELETE,
  PERMISSIONS.REGISTRATION_READ_ANY,
  PERMISSIONS.REGISTRATION_UPDATE_ANY,
  PERMISSIONS.REGISTRATION_CHECKIN,
  PERMISSIONS.REGISTRATION_CHECKOUT,
  PERMISSIONS.ATTENDANCE_READ,
  PERMISSIONS.ATTENDANCE_MANAGE,
  PERMISSIONS.TRACK_MANAGE,
  PERMISSIONS.SUBMISSION_READ_ANY,
  PERMISSIONS.SUBMISSION_DECIDE,
  PERMISSIONS.SUBMISSION_ASSIGN_REVIEWER,
  PERMISSIONS.REVIEW_READ_ANY,
  PERMISSIONS.CONFLICT_MANAGE,
  PERMISSIONS.CARD_TEMPLATE_MANAGE,
  PERMISSIONS.CARD_GRANT,
  PERMISSIONS.TASK_MANAGE,
  PERMISSIONS.XP_ADJUST,
  PERMISSIONS.CERTIFICATE_ISSUE,
  PERMISSIONS.CERTIFICATE_READ_ANY,
  PERMISSIONS.CERTIFICATE_REVOKE,
  PERMISSIONS.SPONSOR_MANAGE,
  PERMISSIONS.SPONSOR_READ,
  PERMISSIONS.PAGE_MANAGE,
];

/** Permissões de quem participa (todo usuário tem, no mínimo, estas). */
const PARTICIPANT_PERMISSIONS: Permission[] = [
  PERMISSIONS.TENANT_READ,
  PERMISSIONS.EVENT_READ,
  PERMISSIONS.ACTIVITY_READ,
  PERMISSIONS.REGISTRATION_CREATE,
  PERMISSIONS.REGISTRATION_READ_OWN,
  PERMISSIONS.REGISTRATION_CANCEL_OWN,
  PERMISSIONS.SUBMISSION_CREATE,
  PERMISSIONS.SUBMISSION_READ_OWN,
  PERMISSIONS.SUBMISSION_UPDATE_OWN,
  PERMISSIONS.CARD_READ_OWN,
  PERMISSIONS.XP_READ_OWN,
  PERMISSIONS.CERTIFICATE_READ_OWN,
  PERMISSIONS.SPONSOR_READ,
];

/**
 * Mapa papel → permissões.
 *
 * `OWNER` recebe todas as permissões existentes EXCETO as de participante que
 * não lhe fazem sentido — na prática, todas. É derivado do catálogo para que
 * uma permissão nova não seja esquecida.
 */
/**
 * Permissões que valem DENTRO de uma instituição.
 *
 * A separação existe por causa de `OWNER: ALL_PERMISSIONS`: ao acrescentar
 * `platform:manage` ao catálogo, listá-la para os papéis de tenant daria a TODO
 * dono de instituição uma permissão de plataforma — inofensiva hoje (o `can()`
 * exige escopo `PLATFORM`), mas um vazamento à espera de quem consultar a
 * permissão sem olhar o escopo.
 *
 * A defesa é em profundidade: permissão de plataforma só consta em papel de
 * plataforma, E o escopo precisa bater.
 */
export const TENANT_PERMISSIONS: readonly Permission[] = Object.freeze(
  ALL_PERMISSIONS.filter((permission) => permission !== PERMISSIONS.PLATFORM_MANAGE),
);

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  /**
   * SuperAdmin da plataforma: UMA permissão, em UM escopo.
   *
   * Não herda nada de tenant — o que ele pode fazer é criar, medir, suspender e
   * reativar instituições.
   */
  SUPERADMIN: [PERMISSIONS.PLATFORM_MANAGE],

  OWNER: TENANT_PERMISSIONS,

  // ADMIN é o OWNER sem os poderes destrutivos/financeiros do tenant.
  ADMIN: TENANT_PERMISSIONS.filter(
    (p) =>
      p !== PERMISSIONS.TENANT_DELETE &&
      p !== PERMISSIONS.TENANT_BILLING_MANAGE &&
      p !== PERMISSIONS.TENANT_ROLE_ASSIGN,
  ),

  ORGANIZER: ORGANIZER_PERMISSIONS,

  // CHAIR coordena a trilha científica: decide, mas não opera o evento.
  CHAIR: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.TRACK_MANAGE,
    PERMISSIONS.SUBMISSION_READ_ANY,
    PERMISSIONS.SUBMISSION_DECIDE,
    PERMISSIONS.SUBMISSION_ASSIGN_REVIEWER,
    PERMISSIONS.REVIEW_READ_ANY,
    PERMISSIONS.CONFLICT_MANAGE,
    PERMISSIONS.REGISTRATION_READ_ANY,
    PERMISSIONS.CERTIFICATE_ISSUE,
    PERMISSIONS.CERTIFICATE_READ_ANY,
    PERMISSIONS.SPONSOR_READ,
    ...PARTICIPANT_PERMISSIONS,
  ],

  // REVIEWER só lê o que lhe foi atribuído — daí :reviewable.
  REVIEWER: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.SUBMISSION_READ_REVIEWABLE,
    PERMISSIONS.REVIEW_SUBMIT_OWN,
    PERMISSIONS.REVIEW_READ_OWN,
    PERMISSIONS.SPONSOR_READ,
  ],

  // FINANCE cuida do comercial: patrocínios e relatórios.
  FINANCE: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.TENANT_BILLING_MANAGE,
    PERMISSIONS.TENANT_ANALYTICS_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.SPONSOR_MANAGE,
    PERMISSIONS.SPONSOR_READ,
    PERMISSIONS.REGISTRATION_READ_ANY,
  ],

  // SPEAKER apresenta: gerencia o próprio material e a própria presença.
  SPEAKER: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.SUBMISSION_CREATE,
    PERMISSIONS.SUBMISSION_READ_OWN,
    PERMISSIONS.SUBMISSION_UPDATE_OWN,
    PERMISSIONS.REGISTRATION_READ_OWN,
    PERMISSIONS.CERTIFICATE_READ_OWN,
    PERMISSIONS.CARD_READ_OWN,
    PERMISSIONS.XP_READ_OWN,
    PERMISSIONS.SPONSOR_READ,
  ],

  // STAFF opera credenciamento no dia do evento.
  STAFF: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.REGISTRATION_READ_ANY,
    PERMISSIONS.REGISTRATION_CHECKIN,
    PERMISSIONS.REGISTRATION_CHECKOUT,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.CERTIFICATE_READ_ANY,
    PERMISSIONS.SPONSOR_READ,
  ],

  PARTICIPANT: PARTICIPANT_PERMISSIONS,

  // SPONSOR tem acesso mínimo: enxerga o evento em que patrocina.
  SPONSOR: [
    PERMISSIONS.TENANT_READ,
    PERMISSIONS.EVENT_READ,
    PERMISSIONS.SPONSOR_READ,
  ],
};

/** Permissões efetivas de um papel. */
export function permissionsForRole(role: RoleKey): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Este papel pode ser concedido no escopo informado? */
export function roleAllowedInScope(role: RoleKey, scope: RoleScope): boolean {
  if (TENANT_ONLY_ROLES.includes(role)) return scope === 'TENANT';
  return true;
}

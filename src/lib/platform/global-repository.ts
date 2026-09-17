/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INFRAESTRUTURA — Repositório global (fora da RLS)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE É O ÚNICO MÓDULO QUE LÊ DADOS DE VÁRIAS INSTITUIÇÕES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele existe porque duas necessidades da FASE 9 são, por natureza, globais:
 *
 *    1. GOVERNANÇA — provisionar, medir e suspender instituições. Não há contexto
 *       de tenant em que essa operação caiba: ela é sobre os tenants.
 *    2. DIRETÓRIO PÚBLICO — contar eventos abertos de todas as instituições. Com
 *       contexto de uma instituição, o `COUNT` das outras seria zero.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO ISSO NÃO VIROU UM BURACO DE ISOLAMENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • A conexão usada é a ADMINISTRATIVA (`adminPrisma`), que é a role dona do
 *    schema. Ela **não** é usada por nenhum outro caminho da aplicação: o runtime
 *    continua na role `eventflow_app`, sujeita a RLS, com o contexto por transação.
 *  • Toda consulta daqui declara os campos que devolve, e nenhum deles é dado
 *    pessoal de participante: o diretório expõe o que a instituição escolheu
 *    publicar, e as métricas são CONTAGENS.
 *  • A autorização não vem desta camada: quem chama já passou por
 *    `requirePlatformPermission`. Aqui só se lê o que a governança precisa.
 *
 *  O contrato de RLS (`db:verify` + `db:verify:isolation`) continua valendo para a
 *  role de RUNTIME — que é a que executa o tráfego das instituições.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { countOpenEvents, type TenantPlan, type TenantStatus } from '@/domain/platform/platform-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Instituições
// ───────────────────────────────────────────────────────────────────────────────
export interface TenantAdminRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  customDomain: string | null;
  isPublic: boolean;
  description: string | null;
  /**
   * Campos do perfil público.
   *
   * Vêm na mesma projeção porque o formulário do painel precisa dos valores
   * ATUAIS: sem eles, salvar a descrição gravaria `null` por cima do logotipo e do
   * site — um campo em branco que apaga dado de outro campo é o tipo de defeito que
   * só aparece depois, na vitrine de alguém.
   */
  logoUrl: string | null;
  websiteUrl: string | null;
  maxEvents: number;
  maxMembers: number;
  createdAt: Date;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  /** Contadores denormalizados por consulta agregada (nunca N+1). */
  eventCount: number;
  memberCount: number;
  certificateCount: number;
  lastActivityAt: Date | null;
}

export interface ListTenantsOptions {
  status?: TenantStatus | 'ALL';
  query?: string;
  limit?: number;
}

/**
 * Lista instituições com contadores agregados.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  COMO OS CONTADORES SÃO OBTIDOS SEM N+1
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quatro consultas agregadas (`groupBy`) para os contadores, não uma por
 *  instituição: com 200 tenants, o caminho ingênuo faria 800 consultas. Os
 *  contadores são juntados em memória por `tenantId`.
 */
export async function listTenants(options: ListTenantsOptions = {}): Promise<TenantAdminRow[]> {
  const query = options.query?.trim();

  const tenants = await adminPrisma.tenant.findMany({
    where: {
      ...(options.status && options.status !== 'ALL' ? { status: options.status } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { slug: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(Math.max(1, options.limit ?? 100), 500),
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      plan: true,
      customDomain: true,
      isPublic: true,
      description: true,
      logoUrl: true,
      websiteUrl: true,
      maxEvents: true,
      maxMembers: true,
      createdAt: true,
      suspendedAt: true,
      suspensionReason: true,
    },
  });

  return attachCounters(tenants);
}

/** Instituição pelo id, com os contadores — mesmo formato da listagem. */
export async function findTenantById(tenantId: string): Promise<TenantAdminRow | null> {
  const tenant = await adminPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      plan: true,
      customDomain: true,
      isPublic: true,
      description: true,
      logoUrl: true,
      websiteUrl: true,
      maxEvents: true,
      maxMembers: true,
      createdAt: true,
      suspendedAt: true,
      suspensionReason: true,
    },
  });

  if (!tenant) return null;

  const [row] = await attachCounters([tenant]);
  return row ?? null;
}

type TenantProjection = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  customDomain: string | null;
  isPublic: boolean;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  maxEvents: number;
  maxMembers: number;
  createdAt: Date;
  suspendedAt: Date | null;
  suspensionReason: string | null;
};

/**
 * Junta os contadores às instituições já lidas.
 *
 * Existe porque `listTenants` e `findTenantById` precisam do MESMO formato de
 * linha: sem isso, o detalhe da instituição mostraria números diferentes dos da
 * listagem, e a divergência apareceria só na tela.
 */
async function attachCounters(tenants: TenantProjection[]): Promise<TenantAdminRow[]> {
  const ids = tenants.map((tenant) => tenant.id);
  if (ids.length === 0) return [];

  const [events, members, certificates, lastActivity] = await Promise.all([
    adminPrisma.event.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    adminPrisma.userTenantProfile.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: ids }, status: 'ACTIVE', deletedAt: null },
      _count: { _all: true },
    }),
    adminPrisma.certificate.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: ids }, status: 'ISSUED' },
      _count: { _all: true },
    }),
    adminPrisma.attendance.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: ids } },
      _max: { checkedInAt: true },
    }),
  ]);

  const eventCounts = new Map(events.map((row) => [row.tenantId, row._count._all]));
  const memberCounts = new Map(members.map((row) => [row.tenantId, row._count._all]));
  const certificateCounts = new Map(certificates.map((row) => [row.tenantId, row._count._all]));
  const activityDates = new Map(lastActivity.map((row) => [row.tenantId, row._max.checkedInAt]));

  return tenants.map((tenant) => ({
    ...tenant,
    eventCount: eventCounts.get(tenant.id) ?? 0,
    memberCount: memberCounts.get(tenant.id) ?? 0,
    certificateCount: certificateCounts.get(tenant.id) ?? 0,
    lastActivityAt: activityDates.get(tenant.id) ?? null,
  }));
}

/** Slug disponível? (`true` = já existe) */
export async function isSlugTakenGlobally(slug: string): Promise<boolean> {
  const found = await adminPrisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return Boolean(found);
}

/**
 * O mínimo para a página de bloqueio: nome, estado e motivo.
 *
 * Deliberadamente NÃO reutiliza `findTenantById`: aquela função carrega contadores
 * e membros, e a página de bloqueio é servida a quem não tem acesso a nada. Um
 * caminho enxuto aqui é também um caminho que não pode vazar contagem por engano.
 */
export async function findTenantNotice(slug: string): Promise<{
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  suspensionReason: string | null;
} | null> {
  return adminPrisma.tenant.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: { id: true, slug: true, name: true, status: true, suspensionReason: true },
  });
}

/** Domínio personalizado já usado? */
export async function isDomainTaken(customDomain: string): Promise<boolean> {
  const found = await adminPrisma.tenant.findUnique({
    where: { customDomain },
    select: { id: true },
  });
  return Boolean(found);
}

/** Usuário pelo e-mail (identidade global — a mesma pessoa em várias instituições). */
export async function findUserByEmail(
  email: string,
): Promise<{ id: string; name: string; email: string } | null> {
  return adminPrisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, email: true },
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Métricas da plataforma
// ───────────────────────────────────────────────────────────────────────────────
export interface PlatformMetrics {
  tenants: { total: number; active: number; suspended: number; pending: number; public: number };
  users: number;
  memberships: number;
  events: { total: number; open: number; ongoing: number };
  registrations: number;
  submissions: number;
  certificates: number;
  xpTransactions: number;
  generatedAt: Date;
}

/**
 * Métricas consolidadas da plataforma.
 *
 * São CONTAGENS, agregadas no banco. Nenhuma linha de dado pessoal sai daqui — um
 * painel de governança não precisa saber quem são as pessoas, só quantas são.
 */
export async function getPlatformMetrics(now: Date = new Date()): Promise<PlatformMetrics> {
  const [
    total,
    active,
    suspended,
    pending,
    isPublic,
    users,
    memberships,
    events,
    openEvents,
    ongoingEvents,
    registrations,
    submissions,
    certificates,
    xpTransactions,
  ] = await Promise.all([
    adminPrisma.tenant.count(),
    adminPrisma.tenant.count({ where: { status: 'ACTIVE' } }),
    adminPrisma.tenant.count({ where: { status: 'SUSPENDED' } }),
    adminPrisma.tenant.count({ where: { status: 'PENDING' } }),
    adminPrisma.tenant.count({ where: { isPublic: true, status: 'ACTIVE' } }),
    adminPrisma.user.count(),
    adminPrisma.userTenantProfile.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    adminPrisma.event.count({ where: { deletedAt: null } }),
    adminPrisma.event.count({
      where: { deletedAt: null, status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] }, startsAt: { gte: now } },
    }),
    adminPrisma.event.count({
      where: { deletedAt: null, status: 'IN_PROGRESS', endsAt: { gte: now } },
    }),
    adminPrisma.registration.count({ where: { deletedAt: null, status: { in: ['CONFIRMED', 'ATTENDED'] } } }),
    adminPrisma.submission.count({ where: { deletedAt: null } }),
    adminPrisma.certificate.count({ where: { status: 'ISSUED' } }),
    adminPrisma.xpTransaction.count(),
  ]);

  return {
    tenants: { total, active, suspended, pending, public: isPublic },
    users,
    memberships,
    events: { total: events, open: openEvents, ongoing: ongoingEvents },
    registrations,
    submissions,
    certificates,
    xpTransactions,
    generatedAt: now,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Diretório público (leitura agregada, sem contexto de instituição)
// ───────────────────────────────────────────────────────────────────────────────
export interface DirectoryTenantRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  customDomain: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  isPublic: boolean;
}

/**
 * Instituições que a vitrine pode mostrar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ESTA CONSULTA NUNCA VEM DO CACHE — E ISSO É UMA DECISÃO DE CORREÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `status` e `isPublic` decidem se a instituição aparece. Se viessem de um cache
 *  de cinco minutos, uma suspensão levaria até cinco minutos para sumir da
 *  vitrine — e uma suspensão que demora a valer não é uma suspensão.
 *
 *  O que é CARO (contar eventos abertos de todas as instituições) é que fica em
 *  cache, e ele é invalidado quando um evento é publicado ou uma instituição muda.
 *  A separação é a mesma de sempre: o dado que decide o acesso é lido na hora; o
 *  dado que enfeita pode esperar.
 *
 *  `description`, `logoUrl` e `websiteUrl` são campos que a própria instituição
 *  escolheu publicar.
 */
export async function selectDirectoryTenants(): Promise<DirectoryTenantRow[]> {
  return adminPrisma.tenant.findMany({
    where: { status: 'ACTIVE', isPublic: true, deletedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      logoUrl: true,
      websiteUrl: true,
      customDomain: true,
      plan: true,
      status: true,
      isPublic: true,
    },
  });
}

/**
 * Eventos abertos por instituição — a consulta que a vitrine cacheia.
 *
 * UMA consulta para todas as instituições: com 200 instituições, o caminho ingênuo
 * faria 200. O agrupamento é feito em memória por `countOpenEvents` (domínio puro,
 * testado sem banco).
 */
export async function selectOpenEventCounts(
  now: Date = new Date(),
): Promise<Record<string, { openEventCount: number; nextEventStartsAt: Date | null }>> {
  const openEvents = await adminPrisma.event.findMany({
    where: {
      deletedAt: null,
      status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] },
      startsAt: { gte: now },
    },
    select: { tenantId: true, startsAt: true, status: true },
    take: 5_000,
  });

  const counts = countOpenEvents(openEvents, now);

  return Object.fromEntries(counts.entries());
}

// ───────────────────────────────────────────────────────────────────────────────
//  Auditoria de plataforma
// ───────────────────────────────────────────────────────────────────────────────
export interface PlatformAuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, unknown>;
  actorName: string | null;
  createdAt: Date;
}

/** Membros de uma instituição, com os papéis vigentes. */
export interface TenantMemberRow {
  userId: string;
  name: string;
  email: string;
  membershipStatus: string;
  joinedAt: Date | null;
  lastAccessAt: Date | null;
  roles: { role: string; scope: string; expiresAt: Date | null }[];
}

/**
 * Membros de uma instituição com seus papéis.
 *
 * DUAS consultas, não uma por membro: a lista de vínculos e a de concessões
 * vigentes, juntadas em memória. É o mesmo cuidado do diretório — a alternativa
 * (buscar os papéis dentro do `map`) é o N+1 clássico, e ele só aparece quando a
 * instituição cresce.
 */
export async function listTenantMembers(tenantId: string): Promise<TenantMemberRow[]> {
  const [memberships, assignments] = await Promise.all([
    adminPrisma.userTenantProfile.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 500,
      select: {
        userId: true,
        status: true,
        joinedAt: true,
        lastAccessAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    adminPrisma.roleAssignment.findMany({
      where: {
        tenantId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { userId: true, role: true, scope: true, expiresAt: true },
    }),
  ]);

  const byUser = new Map<string, TenantMemberRow['roles']>();
  for (const assignment of assignments) {
    const list = byUser.get(assignment.userId) ?? [];
    list.push({ role: assignment.role, scope: assignment.scope, expiresAt: assignment.expiresAt });
    byUser.set(assignment.userId, list);
  }

  return memberships.map((membership) => ({
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    membershipStatus: membership.status,
    joinedAt: membership.joinedAt,
    lastAccessAt: membership.lastAccessAt,
    roles: byUser.get(membership.userId) ?? [],
  }));
}

/**
 * Últimas ações de PLATAFORMA (`tenant_id` nulo).
 *
 * A gravação passa por `recordAudit` (uma única sanitização, um único lugar que
 * documenta o que nunca entra na trilha). A LEITURA precisa vir daqui: a policy
 * de RLS compara `tenant_id` com o contexto da transação, e nenhuma transação de
 * instituição enxerga as linhas nulas — inclusive as de plataforma.
 */
export async function listPlatformAudit(
  options: { limit?: number; entityId?: string } = {},
): Promise<PlatformAuditEntry[]> {
  try {
    const rows = await adminPrisma.auditLog.findMany({
      where: {
        tenantId: null,
        ...(options.entityId ? { entityId: options.entityId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(1, options.limit ?? 30), 200),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        changes: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      changes: (row.changes as Record<string, unknown>) ?? {},
      actorName: row.user?.name ?? null,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    console.error(`[platform] falha ao listar auditoria: ${errorMessage(error)}`);
    return [];
  }
}

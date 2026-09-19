/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Contexto de sessão
 *
 *  Junta as três peças: quem é o usuário (Better Auth), em qual instituição ele
 *  está operando (cookie de contexto) e o que ele pode fazer (RBAC).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE É "CONTEXTO ATIVO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um usuário pode pertencer a várias instituições. A cada requisição é preciso
 *  decidir em qual delas ele está operando. Esse "onde" é o contexto ativo.
 *
 *  Ele é guardado em um COOKIE ASSINADO (`ef_tenant`), e não no banco, por dois
 *  motivos:
 *
 *    1. SEGURANÇA. O contexto é revalidado a cada requisição contra os vínculos
 *       reais do usuário. Se ele for removido da instituição, o acesso cessa
 *       imediatamente — não há janela em que um valor antigo gravado no banco
 *       continue valendo.
 *
 *    2. DESEMPENHO. Trocar de contexto é trocar um cookie. Nenhuma escrita no
 *       banco, nenhuma sessão recriada, nenhum logout. É o que atende ao
 *       requisito de "context switching dinâmico sem perda de sessão".
 *
 *  A assinatura HMAC impede que o usuário escolha um tenant ao qual não pertence
 *  — e mesmo que ele contorne a assinatura, a revalidação de vínculo barra.
 *  São duas camadas independentes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';
import type { PlatformPrincipal, Principal, RoleAssignment } from '@/domain/rbac/authorization';

/** Nome do cookie que carrega a instituição ativa. */
export const ACTIVE_TENANT_COOKIE = 'ef_tenant';

// ───────────────────────────────────────────────────────────────────────────────
//  Assinatura do cookie
// ───────────────────────────────────────────────────────────────────────────────
function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) {
    throw new Error(
      'BETTER_AUTH_SECRET não definida: impossível assinar o cookie de contexto.',
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Comparação em tempo constante, para não vazar informação pelo tempo de resposta. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function serializeActiveTenant(slug: string): string {
  const payload = slug;
  return `${payload}.${sign(payload)}`;
}

/** Lê o slug do cookie, validando a assinatura. Retorna null se adulterado. */
export function parseActiveTenant(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const separatorIndex = raw.lastIndexOf('.');
  if (separatorIndex <= 0) return null;

  const payload = raw.slice(0, separatorIndex);
  const signature = raw.slice(separatorIndex + 1);

  if (!safeEqual(sign(payload), signature)) return null;

  return payload.length > 0 ? payload : null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos
// ───────────────────────────────────────────────────────────────────────────────
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  publicHandle: string | null;
  /**
   * Endereço confirmado (FASE 15).
   *
   * Vem na própria sessão do Better Auth — não custa consulta. É o que permite ao
   * shell avisar quem ainda não confirmou sem uma ida ao banco por render.
   */
  emailVerified: boolean;
}

/** Uma instituição à qual o usuário tem acesso, com os papéis que ali exerce. */
export interface TenantMembership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantLogoUrl: string | null;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  roles: readonly string[];
  isPrivileged: boolean;
}

/** Sessão completa resolvida para a requisição. */
export interface RequestContext {
  user: AuthenticatedUser;
  /** Todas as instituições acessíveis — alimenta o seletor de contexto. */
  memberships: readonly TenantMembership[];
  /** Instituição ativa, se houver e se o usuário tiver acesso. */
  activeTenant: TenantMembership | null;
  /** Principal RBAC da instituição ativa (null se não houver contexto). */
  principal: Principal | null;
  sessionId: string;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Vínculos do usuário
// ───────────────────────────────────────────────────────────────────────────────
const PRIVILEGED = new Set(['OWNER', 'ADMIN', 'ORGANIZER']);

/**
 * Carrega todos os vínculos ativos do usuário, com os papéis de cada um.
 *
 * Esta consulta atravessa tenants por natureza ("a quais instituições pertenço?"),
 * então roda com a conexão admin. Ela é estritamente limitada ao `userId` da
 * sessão autenticada — nunca aceita um id vindo do cliente.
 */
export async function loadMemberships(userId: string): Promise<TenantMembership[]> {
  const profiles = await adminPrisma.userTenantProfile.findMany({
    where: {
      userId,
      status: { in: ['ACTIVE', 'INVITED'] },
      deletedAt: null,
      tenant: { deletedAt: null, status: { in: ['ACTIVE', 'PENDING'] } },
    },
    select: {
      status: true,
      tenantId: true,
      tenant: {
        select: { slug: true, name: true, logoUrl: true },
      },
      user: {
        select: {
          roleAssignments: {
            where: { revokedAt: null },
            select: { role: true, tenantId: true, expiresAt: true },
          },
        },
      },
    },
    orderBy: { tenant: { name: 'asc' } },
  });

  const now = Date.now();

  return profiles.map((profile) => {
    const roles = [
      ...new Set(
        profile.user.roleAssignments
          .filter((a) => a.tenantId === profile.tenantId)
          .filter((a) => !a.expiresAt || a.expiresAt.getTime() > now)
          .map((a) => a.role),
      ),
    ];

    return {
      tenantId: profile.tenantId,
      tenantSlug: profile.tenant.slug,
      tenantName: profile.tenant.name,
      tenantLogoUrl: profile.tenant.logoUrl,
      status: profile.status,
      roles,
      isPrivileged: roles.some((r) => PRIVILEGED.has(r)),
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Principal RBAC
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Monta o `Principal` da instituição ativa.
 *
 * As concessões são lidas DENTRO do contexto de tenant (`withTenant`), então a
 * RLS já garante que nenhuma linha de outra instituição entre aqui. É a mesma
 * proteção usada por qualquer consulta de domínio — não há caminho especial.
 */
export async function loadPrincipal(
  userId: string,
  tenantId: string,
  membershipStatus: Principal['membershipStatus'],
): Promise<Principal> {
  const assignments = await withTenant(tenantId, async (tx) =>
    tx.roleAssignment.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        role: true,
        scope: true,
        eventId: true,
        activityId: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  );

  const mapped: RoleAssignment[] = assignments.map((a) => ({
    role: a.role,
    scope: a.scope,
    eventId: a.eventId,
    activityId: a.activityId,
    expiresAt: a.expiresAt,
    revokedAt: a.revokedAt,
  }));

  return {
    userId,
    tenantId,
    membershipStatus,
    assignments: mapped,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Principal de PLATAFORMA (FASE 9)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Carrega o principal de plataforma de um usuário.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA LEITURA USA A CONEXÃO ADMINISTRATIVA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Papéis de plataforma têm `tenantId = NULL` e a policy de RLS compara a coluna
 *  com o contexto da transação — ou seja, essas linhas são INVISÍVEIS para a role
 *  de runtime, em qualquer contexto. Isso é deliberado: a governança da plataforma
 *  não pertence a instituição alguma, então não deve ser alcançável por uma
 *  consulta "de dentro" de um tenant.
 *
 *  Diferente dos outros usos de `adminPrisma` (CLI/seed), aqui a leitura é feita em
 *  nome de uma REQUISIÇÃO de usuário — por isso a consulta é estritamente escopada
 *  por `userId` e `scope = PLATFORM`, e devolve apenas o necessário para autorizar.
 *
 *  Um usuário sem concessão de plataforma recebe `assignments: []` e o `can()`
 *  nega tudo (fail-closed).
 */
export async function loadPlatformPrincipal(userId: string): Promise<PlatformPrincipal> {
  const assignments = await adminPrisma.roleAssignment.findMany({
    where: {
      userId,
      scope: 'PLATFORM',
      tenantId: null,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      role: true,
      scope: true,
      eventId: true,
      activityId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  return {
    userId,
    tenantId: null,
    // Não existe "vínculo" de plataforma a validar: quem tem a concessão vigente
    // está operacional. O campo existe para reaproveitar `isMembershipOperational`.
    membershipStatus: 'ACTIVE',
    assignments: assignments.map((assignment) => ({
      role: assignment.role,
      scope: assignment.scope,
      eventId: assignment.eventId,
      activityId: assignment.activityId,
      expiresAt: assignment.expiresAt,
      revokedAt: assignment.revokedAt,
    })),
  };
}

/**
 * Principal de plataforma da requisição atual (ou `null` sem sessão).
 *
 * Não usa `cache()` do React de propósito: este módulo também roda no worker, fora
 * do Next.js — a mesma razão documentada no cliente de banco.
 */
export async function getPlatformContext(): Promise<{
  user: AuthenticatedUser;
  principal: PlatformPrincipal;
} | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  return { user, principal: await loadPlatformPrincipal(user.id) };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Contexto da requisição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Resolve o contexto completo da requisição.
 *
 * Devolve `null` quando não há sessão autenticada. Quando há sessão mas o cookie
 * de contexto aponta para uma instituição à qual o usuário não pertence, o
 * `activeTenant` vem `null` — o chamador decide se redireciona ou mostra um
 * seletor. Nunca lançamos aqui: ausência de contexto é um estado normal para
 * páginas públicas.
 */
export async function getRequestContext(): Promise<RequestContext | null> {
  const session = await auth.api.getSession({ headers: await authHeaders() });
  if (!session?.user) return null;

  const user: AuthenticatedUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
    publicHandle:
      (session.user as { publicHandle?: string | null }).publicHandle ?? null,
    emailVerified: session.user.emailVerified ?? false,
  };

  const memberships = await loadMemberships(user.id);

  const cookieStore = await cookies();
  const desiredSlug = parseActiveTenant(cookieStore.get(ACTIVE_TENANT_COOKIE)?.value);

  // Só aceitamos o contexto se o vínculo existir E estiver ATIVO. Um convite
  // pendente não concede contexto operacional (fail-closed).
  const activeTenant =
    (desiredSlug
      ? memberships.find((m) => m.tenantSlug === desiredSlug && m.status === 'ACTIVE')
      : undefined) ??
    // Sem cookie válido: usa o primeiro vínculo ativo como padrão.
    memberships.find((m) => m.status === 'ACTIVE') ??
    null;

  const principal = activeTenant
    ? await loadPrincipal(user.id, activeTenant.tenantId, activeTenant.status)
    : null;

  return {
    user,
    memberships,
    activeTenant,
    principal,
    sessionId: session.session.id,
  };
}

/** Cabeçalhos da requisição atual, para o Better Auth. */
async function authHeaders(): Promise<Headers> {
  const { headers } = await import('next/headers');
  return headers();
}

/**
 * Variante leve: só o usuário autenticado, sem carregar vínculos.
 * Use em rotas que não dependem de tenancy (perfil global, logout).
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({ headers: await authHeaders() });
  if (!session?.user) return null;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
    publicHandle:
      (session.user as { publicHandle?: string | null }).publicHandle ?? null,
    emailVerified: session.user.emailVerified ?? false,
  };
}

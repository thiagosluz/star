/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Equipe da instituição (leitura sob RLS)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA LEITURA NÃO USA A CONEXÃO ADMINISTRATIVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O painel de governança lista membros de QUALQUER instituição, então roda com
 *  `adminPrisma` (`src/lib/platform/**`, a exceção documentada). Aqui é o oposto:
 *  quem pergunta é a própria instituição, sobre os próprios vínculos. Rodar sob
 *  `withTenant` faz a policy de RLS ser a garantia de que uma consulta errada não
 *  vaza equipe de outra instituição — e o resultado é o mesmo, porque a leitura já
 *  é escopada por `tenantId`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA RESOLVE (item I4 do levantamento)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Desde a FASE 10, quem se inscreve em evento aberto ganha vínculo ATIVO — correto
 *  para dar acesso, mas o vínculo era indistinguível do vínculo de equipe. A
 *  instituição via "membros" onde havia público. Aqui a separação é explícita:
 *  EQUIPE (com papéis e situação) e PARTICIPANTES (contagem), mais o uso da quota
 *  `maxMembers`, que é sobre a equipe e não sobre o público.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  evaluateQuotaUsage,
  type QuotaUsage,
} from '@/domain/platform/platform-rules';
import {
  TENANT_MEMBER_ROLES,
  evaluateMemberRemoval,
  evaluateRoleChange,
  tenantScopedRoles,
  type MemberLifecycleRefusal,
} from '@/domain/tenancy/membership-rules';
import { recordAudit } from '@/lib/admin/audit';
import { withTenant, type TxClient } from '@/lib/db/tenant-client';

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  /** `ACTIVE` (acesso liberado) ou `INVITED` (convite pendente, já ocupa vaga). */
  status: string;
  joinedAt: Date | null;
  lastAccessAt: Date | null;
  roles: { role: string; scope: string; expiresAt: Date | null }[];
  /**
   * Papéis de escopo da INSTITUIÇÃO, que a tela de equipe edita (FASE 21).
   *
   * Separados de `roles` de propósito: papel de EVENTO ou de ATIVIDADE pertence à
   * tela daquele alvo, e mostrá-lo no editor de equipe convidaria a apagá-lo daqui.
   */
  tenantRoles: string[];
  /**
   * Inscrições em eventos desta instituição (FASE 21).
   *
   * Serve para AVISAR antes de remover: o vínculo é UMA linha por (instituição,
   * pessoa), então remover a equipe tira também o acesso de participante — quem
   * organiza precisa saber que a pessoa deixa de ver as próprias inscrições.
   */
  registrationCount: number;
}

export interface TeamOverview {
  members: TeamMember[];
  /** Vínculos de equipe que ocupam vaga no plano (ativos + convidados). */
  memberCount: number;
  activeMembers: number;
  invitedMembers: number;
  /** Público de eventos: NÃO ocupa vaga (ver `membership-rules.ts`). */
  participantCount: number;
  maxMembers: number | null;
  quota: QuotaUsage;
}

/**
 * Equipe, público e uso da quota — em uma leitura por assunto.
 *
 * TRÊS consultas (vínculos, concessões e contagem de participantes) em vez de uma
 * por membro: é o mesmo cuidado do diretório e da lista da plataforma. Os papéis
 * são juntados em memória por `userId`.
 */
export async function getTeamOverview(tenantId: string): Promise<TeamOverview> {
  return withTenant(tenantId, async (tx) => {
    const now = new Date();

    const [profiles, assignments, tenant] = await Promise.all([
      tx.userTenantProfile.findMany({
        where: { tenantId, kind: 'MEMBER', deletedAt: null },
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
      tx.roleAssignment.findMany({
        where: {
          tenantId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { userId: true, role: true, scope: true, expiresAt: true },
      }),
      // A policy de `tenants` permite a leitura (a resolução de slug → id acontece
      // antes de existir contexto); aqui só a quota interessa.
      tx.tenant.findUnique({ where: { id: tenantId }, select: { maxMembers: true } }),
    ]);

    const participants = await tx.userTenantProfile.count({
      where: { tenantId, kind: 'PARTICIPANT', deletedAt: null },
    });

    /**
     * Inscrições por pessoa, em UMA consulta agrupada (não uma por membro): o número
     * alimenta o aviso da remoção, e é a diferença entre "sai da equipe" e "sai da
     * equipe E perde a área de participante".
     */
    const registrationsByUser = await tx.registration.groupBy({
      by: ['userId'],
      where: { tenantId, userId: { in: profiles.map((profile) => profile.userId) } },
      _count: { _all: true },
    });

    const registrationCounts = new Map(
      registrationsByUser.map((entry) => [entry.userId, entry._count._all]),
    );

    const rolesByUser = new Map<string, TeamMember['roles']>();

    for (const assignment of assignments) {
      const list = rolesByUser.get(assignment.userId) ?? [];
      list.push({ role: assignment.role, scope: assignment.scope, expiresAt: assignment.expiresAt });
      rolesByUser.set(assignment.userId, list);
    }

    const members: TeamMember[] = profiles.map((profile) => {
      const roles = rolesByUser.get(profile.userId) ?? [];

      return {
        userId: profile.userId,
        name: profile.user.name,
        email: profile.user.email,
        status: profile.status,
        joinedAt: profile.joinedAt,
        lastAccessAt: profile.lastAccessAt,
        roles,
        tenantRoles: roles.filter((entry) => entry.scope === 'TENANT').map((entry) => entry.role),
        registrationCount: registrationCounts.get(profile.userId) ?? 0,
      };
    });

    const activeMembers = members.filter((member) => member.status === 'ACTIVE').length;
    const invitedMembers = members.filter((member) => member.status === 'INVITED').length;
    const maxMembers = tenant?.maxMembers ?? null;

    return {
      members,
      // O critério da CONTAGEM é o da quota (ativos + convidados), não o da
      // exibição: um convite pendente já reserva lugar no plano.
      memberCount: activeMembers + invitedMembers,
      activeMembers,
      invitedMembers,
      participantCount: participants,
      maxMembers,
      quota: evaluateQuotaUsage(activeMembers + invitedMembers, maxMembers),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CICLO DE VIDA DO MEMBRO (FASE 21, item C5)
// ═══════════════════════════════════════════════════════════════════════════════
export type MemberMutationCode =
  | MemberLifecycleRefusal
  | 'NOT_FOUND'
  | 'UNCHANGED'
  | 'INTERNAL';

export type MemberMutationResult<TPayload = object> =
  | ({ ok: true } & TPayload)
  | { ok: false; code: MemberMutationCode; message: string; details?: readonly string[] };

export interface MemberContext {
  status: string;
  name: string;
  email: string;
  /** Concessões vigentes (papel + escopo), como o banco as guarda. */
  assignments: { role: string; scope: string }[];
  /** Só as de escopo da instituição — o que o editor de equipe mostra e edita. */
  tenantRoles: string[];
  /** Quantos vínculos ATIVOS da instituição têm `OWNER` vigente. */
  activeOwnerCount: number;
}

/**
 * O que a decisão precisa saber sobre o alvo — lido DENTRO da transação da mutação.
 *
 * Ler antes (na página, por exemplo) e agir depois abriria a janela em que o alvo
 * ganha ou perde o papel de proprietário entre a tela e o clique — a mesma classe de
 * corrida que a atribuição de revisor resolve relendo o conflito no commit.
 */
async function loadMemberContext(
  tx: TxClient,
  tenantId: string,
  userId: string,
): Promise<MemberContext | null> {
  const profile = await tx.userTenantProfile.findFirst({
    where: { tenantId, userId, kind: 'MEMBER', deletedAt: null },
    select: { status: true, user: { select: { name: true, email: true } } },
  });

  if (!profile) return null;

  const now = new Date();

  const [memberRoles, liveOwners] = await Promise.all([
    tx.roleAssignment.findMany({
      where: {
        tenantId,
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { role: true, scope: true },
    }),
    /**
     * Proprietários ativos: a concessão viva de `OWNER` só conta se o VÍNCULO
     * correspondente estiver ativo — um dono suspenso não administra nada, e contá-lo
     * aqui deixaria a instituição sem ninguém capaz de agir.
     */
    tx.roleAssignment.findMany({
      where: {
        tenantId,
        role: 'OWNER',
        scope: 'TENANT',
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        user: { memberships: { some: { tenantId, kind: 'MEMBER', status: 'ACTIVE', deletedAt: null } } },
      },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);

  return {
    status: profile.status,
    name: profile.user.name,
    email: profile.user.email,
    assignments: memberRoles.map((entry) => ({ role: entry.role, scope: entry.scope })),
    tenantRoles: tenantScopedRoles(memberRoles),
    activeOwnerCount: liveOwners.length,
  };
}

export interface MemberRolesResult {
  granted: readonly string[];
  revoked: readonly string[];
  tenantRoles: readonly string[];
  /** `true` quando o conjunto enviado é igual ao vigente (nada foi escrito). */
  unchanged: boolean;
}

/**
 * Troca os papéis de escopo da INSTITUIÇÃO de um membro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O CONJUNTO É SUBSTITUÍDO, E A REVOGAÇÃO NUNCA APAGA A LINHA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Conceder o que falta e revogar o que sobra (o plano vem do domínio) mantém o
 *  histórico: quem perdeu o papel aparece com `revokedAt`, e a trilha de auditoria
 *  diz quem tirou. `DELETE` apagaria a prova de que a pessoa já teve acesso — que é
 *  exatamente o que uma investigação procura.
 *
 *  Papel de EVENTO ou ATIVIDADE não é tocado aqui (a consulta filtra `scope`): quem
 *  é `STAFF` do dia continua sendo, mesmo que a equipe reescreva os papéis de
 *  instituição.
 */
export async function updateMemberRoles(input: {
  tenantId: string;
  actorId: string;
  userId: string;
  roles: readonly string[];
}): Promise<MemberMutationResult<MemberRolesResult>> {
  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const context = await loadMemberContext(tx, input.tenantId, input.userId);

      if (!context) return { kind: 'NOT_FOUND' as const };

      const verdict = evaluateRoleChange({
        current: context.assignments,
        desired: input.roles,
        activeOwnerCount: context.activeOwnerCount,
      });

      if (!verdict.allowed) {
        return { kind: 'REFUSED' as const, code: verdict.code, message: verdict.message };
      }

      const { grant, revoke, finalRoles } = verdict.plan;
      const now = new Date();

      if (revoke.length > 0) {
        await tx.roleAssignment.updateMany({
          where: {
            tenantId: input.tenantId,
            userId: input.userId,
            scope: 'TENANT',
            role: { in: revoke },
            revokedAt: null,
          },
          data: { revokedAt: now, reason: `Papel retirado por ${input.actorId}` },
        });
      }

      if (grant.length > 0) {
        await tx.roleAssignment.createMany({
          data: grant.map((role) => ({
            tenantId: input.tenantId,
            userId: input.userId,
            role,
            scope: 'TENANT' as const,
            grantedById: input.actorId,
            reason: 'Papel concedido pela tela de equipe',
          })),
        });
      }

      return { kind: 'OK' as const, grant, revoke, finalRoles, context };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Vínculo de equipe não encontrado.' };
    }

    if (outcome.kind === 'REFUSED') {
      return { ok: false, code: outcome.code, message: outcome.message };
    }

    const changed = outcome.grant.length > 0 || outcome.revoke.length > 0;

    if (changed) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'PERMISSION_CHANGE',
        entityType: 'UserTenantProfile',
        entityId: input.userId,
        changes: {
          roles: {
            from: outcome.context.tenantRoles.join(', ') || '—',
            to: outcome.finalRoles.join(', ') || '—',
          },
        },
      });
    }

    return {
      ok: true,
      granted: outcome.grant,
      revoked: outcome.revoke,
      tenantRoles: outcome.finalRoles,
      unchanged: !changed,
    };
  } catch (error) {
    console.error(
      `[members] falha ao trocar papéis: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar os papéis.' };
  }
}

/**
 * Remove um membro da equipe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  REMOÇÃO LÓGICA, COM OS PAPÉIS REVOGADOS
 * ─────────────────────────────────────────────────────────────────────────────
 *  O vínculo vira `REMOVED` + `deletedAt` (sai da lista e LIBERA a vaga da quota) e
 *  todas as concessões vigentes da instituição são revogadas — inclusive as de
 *  EVENTO e ATIVIDADE, porque quem perdeu o acesso não pode continuar credenciando
 *  um dia de evento. As linhas ficam no banco: a trilha guarda quem fez o quê, e
 *  readmitir é um convite novo.
 *
 *  As duas travas (não remover a si mesmo, não remover o último proprietário) vêm do
 *  domínio, com a contagem de proprietários lida na MESMA transação.
 */
export async function removeMember(input: {
  tenantId: string;
  actorId: string;
  userId: string;
}): Promise<MemberMutationResult<{ name: string; revokedRoles: readonly string[] }>> {
  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const context = await loadMemberContext(tx, input.tenantId, input.userId);

      if (!context) return { kind: 'NOT_FOUND' as const };

      const verdict = evaluateMemberRemoval({
        actorUserId: input.actorId,
        targetUserId: input.userId,
        targetStatus: context.status,
        targetRoles: context.tenantRoles,
        activeOwnerCount: context.activeOwnerCount,
      });

      if (!verdict.allowed) {
        return { kind: 'REFUSED' as const, code: verdict.code, message: verdict.message };
      }

      const now = new Date();

      const live = await tx.roleAssignment.findMany({
        where: { tenantId: input.tenantId, userId: input.userId, revokedAt: null },
        select: { id: true, role: true, scope: true },
      });

      if (live.length > 0) {
        await tx.roleAssignment.updateMany({
          where: { tenantId: input.tenantId, userId: input.userId, revokedAt: null },
          data: { revokedAt: now, reason: `Acesso removido da equipe por ${input.actorId}` },
        });
      }

      await tx.userTenantProfile.updateMany({
        where: { tenantId: input.tenantId, userId: input.userId },
        data: { status: 'REMOVED', deletedAt: now },
      });

      return { kind: 'OK' as const, context, live };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Vínculo de equipe não encontrado.' };
    }

    if (outcome.kind === 'REFUSED') {
      return { ok: false, code: outcome.code, message: outcome.message };
    }

    const revokedRoles = outcome.live.map((entry) =>
      entry.scope === 'TENANT' ? entry.role : `${entry.role} (${entry.scope})`,
    );

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'DELETE',
      entityType: 'UserTenantProfile',
      entityId: input.userId,
      changes: {
        status: { from: outcome.context.status, to: 'REMOVED' },
        roles: { from: outcome.context.tenantRoles.join(', ') || '—', to: '—' },
      },
    });

    return { ok: true, name: outcome.context.name, revokedRoles };
  } catch (error) {
    console.error(
      `[members] falha ao remover membro: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível remover o acesso.' };
  }
}

/** Papéis que o editor da tela de equipe oferece (escopo da instituição). */
export function assignableTenantRoles(): readonly string[] {
  return TENANT_MEMBER_ROLES;
}

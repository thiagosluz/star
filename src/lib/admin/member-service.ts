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
import { withTenant } from '@/lib/db/tenant-client';

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  /** `ACTIVE` (acesso liberado) ou `INVITED` (convite pendente, já ocupa vaga). */
  status: string;
  joinedAt: Date | null;
  lastAccessAt: Date | null;
  roles: { role: string; scope: string; expiresAt: Date | null }[];
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

    const rolesByUser = new Map<string, TeamMember['roles']>();

    for (const assignment of assignments) {
      const list = rolesByUser.get(assignment.userId) ?? [];
      list.push({ role: assignment.role, scope: assignment.scope, expiresAt: assignment.expiresAt });
      rolesByUser.set(assignment.userId, list);
    }

    const members: TeamMember[] = profiles.map((profile) => ({
      userId: profile.userId,
      name: profile.user.name,
      email: profile.user.email,
      status: profile.status,
      joinedAt: profile.joinedAt,
      lastAccessAt: profile.lastAccessAt,
      roles: rolesByUser.get(profile.userId) ?? [],
    }));

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

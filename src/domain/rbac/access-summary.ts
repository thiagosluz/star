/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — o resumo de um VÍNCULO para a pessoa (FASE 84 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA REGRA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A seção "Seus acessos" de `/conta` responde três perguntas por instituição: em
 *  qual casa eu entro, com qual PAPEL, e quantas PERMISSÕES isso soma. As duas
 *  últimas são as que o painel mostrava em UUID e em lista crua — e é essa
 *  tradução (chave → rótulo; papéis → permissões efetivas) que precisa de prova
 *  sem banco.
 *
 *  A página passa a só desenhar o resultado. Assim, "nunca mostrar a chave crua" e
 *  "o número é o das permissões EFETIVAS" deixam de ser disciplinas de quem edita
 *  JSX e passam a ser propriedades testáveis.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS DECISÕES QUE PARECEM DETALHE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. **Chave fora do catálogo é DESCARTADA**, e não exibida. Um papel que não
 *     existe não tem rótulo em português nem pacote de permissões; mostrá-lo
 *     cru seria exatamente a ilegibilidade que a fase veio remover. Se um dia
 *     houver papel legado no banco, o lugar de tratá-lo é uma migração — não a
 *     tela da pessoa.
 *  2. **A ordem é alfabética pelo RÓTULO**, e não a ordem de chegada do banco. A
 *     lista de papéis de um vínculo vem de um `Set` montado na consulta; sem uma
 *     ordenação declarada, a mesma pessoa veria "Revisor(a) · Coordenação" hoje e
 *     "Coordenação · Revisor(a)" amanhã. Quem lê procura pelo nome em português.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  isRoleKey,
  permissionsForRole,
  roleLabel,
  type Permission,
  type RoleKey,
} from '@/domain/rbac/permissions';

/** Um papel do vínculo, já traduzido para o que a tela mostra. */
export interface MembershipRoleSummary {
  /** A chave do catálogo — para `data-testid` e depuração, NUNCA para o texto. */
  readonly key: RoleKey;
  /** O rótulo em português (`roleLabel`). */
  readonly label: string;
}

/** O que a seção "Seus acessos" precisa saber de um vínculo. */
export interface MembershipAccessSummary {
  /** Os papéis vigentes, ordenados pelo rótulo. Vazio = vínculo sem papel. */
  readonly roles: readonly MembershipRoleSummary[];
  /**
   * Quantas permissões EFETIVAS o conjunto de papéis concede nesta instituição.
   *
   * É a UNIÃO dos pacotes (a mesma conta que o painel fazia): dois papéis que
   * compartilham `tenant:read` somam uma permissão, não duas.
   */
  readonly permissionCount: number;
}

/**
 * Resume os papéis de UM vínculo.
 *
 * Recebe as chaves cruas porque é assim que `loadMemberships` as entrega — a
 * tradução para `RoleKey` acontece aqui, uma vez, com a guarda do catálogo.
 */
export function summarizeMembershipAccess(
  roles: readonly string[],
): MembershipAccessSummary {
  const known = [...new Set(roles)].filter(isRoleKey);
  const sorted = [...known].sort((a, b) =>
    roleLabel(a).localeCompare(roleLabel(b), 'pt-BR'),
  );

  const permissions = new Set<Permission>();
  for (const role of sorted) {
    for (const permission of permissionsForRole(role)) {
      permissions.add(permission);
    }
  }

  return {
    roles: sorted.map((role) => ({ key: role, label: roleLabel(role) })),
    permissionCount: permissions.size,
  };
}

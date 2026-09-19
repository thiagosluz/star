/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Vínculo com a instituição: MEMBRO ou PARTICIPANTE
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EXISTE UMA DISTINÇÃO QUE O BANCO NÃO FAZIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição pública (FASE 10) criou um vínculo ATIVO para quem se inscreve em
 *  evento aberto — decisão correta para dar acesso de participante sem cadastro
 *  manual. O efeito colateral apareceu depois, em dois lugares:
 *
 *    • a lista de "quem responde pela instituição" do painel de governança passou a
 *      mostrar centenas de inscritos anônimos no meio da equipe;
 *    • a quota `maxMembers` do plano, que nunca foi aplicada, ficou impossível de
 *      aplicar: contar vínculos passou a significar "contar o público do evento".
 *
 *  São duas relações DIFERENTES com a mesma instituição, e o modelo não as
 *  distinguia. A distinção é do domínio (não do RBAC): um membro da equipe pode
 *  não ter papel nenhum ainda (convite aceito, papel a caminho) e continua sendo
 *  membro; um participante tem o papel `PARTICIPANT` e continua sendo participante.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA QUE DECIDE O TIPO QUANDO O DADO VEM DE FORA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `classifyMembershipKind` é a regra usada pela migração de backfill: o vínculo
 *  cujo ÚNICO papel vigente é `PARTICIPANT` nasceu de uma inscrição pública. Ela é
 *  uma APROXIMAÇÃO — o dado histórico não guarda a origem — e está aqui, em código
 *  testado, em vez de escondida no SQL da migração.
 *
 *  Tudo neste arquivo é PURO: não importa Prisma nem Next.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { ROLE_KEYS, roleAllowedInScope, type RoleKey, type RoleScope } from '@/domain/rbac/permissions';

export type MembershipKind = 'MEMBER' | 'PARTICIPANT';

export const MEMBERSHIP_KINDS: readonly MembershipKind[] = ['MEMBER', 'PARTICIPANT'];
export const MEMBERSHIP_KIND_LABELS: Readonly<Record<MembershipKind, string>> = {
  MEMBER: 'Membro',
  PARTICIPANT: 'Participante',
};

/** Rótulo da seção que lista cada tipo (usado nas telas de equipe). */
export const MEMBERSHIP_KIND_SECTIONS: Readonly<Record<MembershipKind, string>> = {
  MEMBER: 'Equipe da instituição',
  PARTICIPANT: 'Participantes de eventos',
};

/**
 * O vínculo consome quota do plano?
 *
 * Participante NÃO consome: a quota `maxMembers` é sobre a equipe que administra a
 * instituição. Se ela contasse inscritos, um evento de 300 pessoas estouraria o
 * plano sozinho — e a plataforma estaria cobrando por público, não por acesso.
 */
export function countsTowardMemberQuota(kind: MembershipKind): boolean {
  return kind === 'MEMBER';
}

/** O vínculo aparece na lista de membros (e nos contadores de "quem responde")? */
export function isMemberKind(kind: MembershipKind): boolean {
  return kind === 'MEMBER';
}

/**
 * Classifica um vínculo a partir dos papéis vigentes.
 *
 * `roles` são as chaves de papel vigentes do usuário NESTA instituição, já
 * filtradas por vigência (`revokedAt` nulo e `expiresAt` no futuro) pelo chamador.
 *
 * Vínculo sem papel nenhum é MEMBRO: convite aceito cujo papel ainda não foi
 * concedido é equipe, não público — tratá-lo como participante o esconderia da
 * lista justamente de quem precisa terminar de configurá-lo.
 */
export function classifyMembershipKind(roles: readonly string[]): MembershipKind {
  if (roles.length === 0) return 'MEMBER';

  return roles.every((role) => role === 'PARTICIPANT') ? 'PARTICIPANT' : 'MEMBER';
}

/**
 * Tipo do vínculo depois de uma inscrição pública.
 *
 * A inscrição CRIA como participante e **nunca rebaixa**: um membro da equipe que
 * se inscreve em um evento aberto continua membro (e continua contando na quota).
 * A regra fica no domínio — e não no `upsert` do serviço — porque a assimetria com
 * o caminho da plataforma precisa ser explícita:
 *
 *    • inscrição pública:  cria PARTICIPANT, nunca promove, nunca rebaixa;
 *    • vínculo da equipe (plataforma): sempre MEMBER, promovendo quem era
 *      participante.
 *
 * Sem isso, a ordem dos acontecimentos mudaria o resultado: quem se inscrevesse
 * antes de ser convidado para a equipe apareceria no público, e quem fosse
 * convidado antes apareceria na equipe.
 */
export function kindAfterPublicRegistration(current: MembershipKind | null): MembershipKind {
  return current ?? 'PARTICIPANT';
}

// ───────────────────────────────────────────────────────────────────────────────
//  CICLO DE VIDA DO MEMBRO — trocar papéis e remover (FASE 21, item C5)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Papéis que a tela de equipe gerencia: os de escopo da INSTITUIÇÃO, excluindo os
 * que não são de equipe.
 *
 *  • `SUPERADMIN` é papel de PLATAFORMA — `roleAllowedInScope` sozinho não o barra
 *    (ele não está em `TENANT_ONLY_ROLES`), então a exclusão é explícita;
 *  • `PARTICIPANT` é o PÚBLICO do evento, não a equipe: o vínculo de quem entra por
 *    convite nasce `MEMBER`, e poder marcar "Participante" no editor criaria um
 *    membro da equipe com papel de participante — a confusão que a FASE 14 separou
 *    (mesma exclusão da lista de papéis convidáveis, na FASE 15);
 *  • papel de EVENTO ou ATIVIDADE pertence à tela daquele alvo: quem concede
 *    `REVIEWER` para uma trilha ou `STAFF` para um dia não faz isso daqui.
 */
export const TENANT_MEMBER_ROLES: readonly RoleKey[] = Object.freeze(
  ROLE_KEYS.filter(
    (role) =>
      role !== 'SUPERADMIN' &&
      role !== 'PARTICIPANT' &&
      roleAllowedInScope(role, 'TENANT' as RoleScope),
  ),
);

export function isTenantMemberRole(role: string): role is RoleKey {
  return TENANT_MEMBER_ROLES.includes(role as RoleKey);
}

/** O papel que exige cuidado: perder o último deixa a instituição sem proprietário. */
export const OWNER_ROLE: RoleKey = 'OWNER';

export function hasOwnerRole(roles: readonly string[]): boolean {
  return roles.includes(OWNER_ROLE);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Remover um membro
// ───────────────────────────────────────────────────────────────────────────────
export type MemberLifecycleRefusal =
  | 'NOT_A_MEMBER'
  | 'SELF'
  | 'LAST_OWNER'
  | 'INVALID_ROLE'
  | 'ROLE_SCOPE';

export interface MemberLifecycleFailure {
  allowed: false;
  code: MemberLifecycleRefusal;
  message: string;
}

/**
 * Resultado de uma operação do ciclo de vida do membro: `allowed: true` com o que a
 * operação decidiu (o plano da troca de papéis, por exemplo) ou a recusa com o
 * motivo escrito. Espelha o `{ ok, code, message }` do resto do sistema — aqui o
 * campo se chama `allowed` porque o que se responde é "pode seguir?".
 */
export type MemberLifecycleVerdict<TPayload = object> =
  | ({ allowed: true } & TPayload)
  | MemberLifecycleFailure;

/**
 * Pode remover este vínculo da equipe?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM DAS RECUSAS É A DAS PERGUNTAS QUE A PESSOA FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *  "não é membro" antes de "é você mesmo": quem clica em remover numa linha que já
 *  saiu precisa saber disso, e não receber um aviso sobre si. Depois vêm as duas
 *  travas de segurança, nesta ordem: ninguém se remove (a pessoa se trancaria fora)
 *  e ninguém remove o ÚLTIMO proprietário — uma instituição sem dono não tem quem
 *  a administre, e o caminho de volta seria SQL.
 *
 *  Remover é REMOÇÃO LÓGICA (o vínculo vira `REMOVED` e as concessões são
 *  revogadas): o histórico de quem fez o quê continua legível na trilha, e readmitir
 *  é um convite novo.
 */
export function evaluateMemberRemoval(input: {
  actorUserId: string;
  targetUserId: string;
  targetStatus: string;
  targetRoles: readonly string[];
  /** Quantos vínculos ATIVOS da instituição têm `OWNER` vigente. */
  activeOwnerCount: number;
}): MemberLifecycleVerdict {
  if (input.targetStatus !== 'ACTIVE' && input.targetStatus !== 'INVITED') {
    return {
      allowed: false,
      code: 'NOT_A_MEMBER',
      message: 'Este vínculo não está mais ativo nesta instituição.',
    };
  }

  if (input.actorUserId === input.targetUserId) {
    return {
      allowed: false,
      code: 'SELF',
      message:
        'Você não pode remover o próprio acesso. Peça a outra pessoa com papel de proprietário ou administrador.',
    };
  }

  if (hasOwnerRole(input.targetRoles) && input.activeOwnerCount <= 1) {
    return {
      allowed: false,
      code: 'LAST_OWNER',
      message:
        'Este é o único vínculo de proprietário ativo da instituição. Promova outra pessoa a proprietário antes de remover este acesso.',
    };
  }

  return { allowed: true };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Trocar papéis
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Concessão vigente, como o banco a guarda: papel + escopo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PLANO RECEBE O ESCOPO, E NÃO SÓ O NOME DO PAPEL (armadilha 52)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão de `planRoleChange` recebia `string[]` de nomes. O teste
 *  unitário reprovou o caso real: `REVIEWER` concedido por EVENTO tem o MESMO nome do
 *  papel de instituição, e um chamador que esquecesse de filtrar o escopo revogaria a
 *  avaliação de uma trilha ao reescrever a equipe — sem erro nenhum, porque para o
 *  domínio eram só dois nomes iguais. Com o escopo na entrada, a chamada perigosa não
 *  é expressável: o que não é `scope = 'TENANT'` fica fora do plano por construção.
 */
export interface RoleRef {
  role: string;
  scope: string;
}

export interface RoleChangePlan {
  /** Papéis a conceder (estão em `desired` e não entre os vigentes de instituição). */
  grant: RoleKey[];
  /** Papéis a revogar (`revokedAt`, nunca `DELETE`): o histórico de acesso fica. */
  revoke: RoleKey[];
  /** Conjunto final, ordenado como o catálogo — é o que a tela mostra. */
  finalRoles: RoleKey[];
}

/** Papéis de escopo da INSTITUIÇÃO entre as concessões vigentes. */
export function tenantScopedRoles(assignments: readonly RoleRef[]): RoleKey[] {
  return assignments
    .filter((entry) => entry.scope === 'TENANT' && isTenantMemberRole(entry.role))
    .map((entry) => entry.role as RoleKey);
}

/**
 * Plano da troca de papéis: o que conceder e o que revogar.
 *
 * Recalcular o conjunto INTEIRO (em vez de olhar caso a caso na tela) é o que
 * permite ao teste prever o resultado, e ao serviço aplicar a mesma conta que o
 * domínio fez — inclusive quando alguém manda o mesmo papel duas vezes, ou manda um
 * papel que já existe (o plano fica vazio, e nada é escrito).
 */
export function planRoleChange(
  current: readonly RoleRef[],
  desired: readonly string[],
): RoleChangePlan {
  const currentRoles = tenantScopedRoles(current);
  const currentSet = new Set(currentRoles);
  const desiredSet = new Set(desired.filter(isTenantMemberRole));

  const grant = TENANT_MEMBER_ROLES.filter((role) => desiredSet.has(role) && !currentSet.has(role));
  const revoke = TENANT_MEMBER_ROLES.filter((role) => currentSet.has(role) && !desiredSet.has(role));

  return { grant: [...grant], revoke: [...revoke], finalRoles: [...desiredSet] };
}

/** A escolha é válida? (papel existente e de escopo da instituição) */
export function validateRoleSelection(
  desired: readonly string[],
): { ok: true; roles: RoleKey[] } | { ok: false; code: MemberLifecycleRefusal; message: string } {
  const invalid = desired.find((role) => !ROLE_KEYS.includes(role as RoleKey));

  if (invalid) {
    return {
      ok: false,
      code: 'INVALID_ROLE',
      message: `O papel "${invalid}" não existe.`,
    };
  }

  const scoped = desired.find((role) => !isTenantMemberRole(role));

  if (scoped) {
    return {
      ok: false,
      code: 'ROLE_SCOPE',
      message: `O papel "${scoped}" não é um papel de equipe da instituição.`,
    };
  }

  return { ok: true, roles: [...new Set(desired as RoleKey[])] };
}

/**
 * A troca de papéis pode acontecer? Devolve o PLANO quando pode.
 *
 * A única trava de segurança é o último proprietário: rebaixar a si mesmo é
 * legítimo (quem é dono pode deixar de ser), desde que sobre outro. Revogar o
 * próprio `ADMIN` também é — a pessoa continua com os outros papéis que tiver.
 */
export function evaluateRoleChange(input: {
  current: readonly RoleRef[];
  desired: readonly string[];
  activeOwnerCount: number;
}): MemberLifecycleVerdict<{ plan: RoleChangePlan }> {
  const selection = validateRoleSelection(input.desired);

  if (!selection.ok) return { allowed: false, code: selection.code, message: selection.message };

  const plan = planRoleChange(input.current, selection.roles);

  const losesOwner =
    plan.revoke.includes(OWNER_ROLE) && hasOwnerRole(tenantScopedRoles(input.current));

  if (losesOwner && input.activeOwnerCount <= 1) {
    return {
      allowed: false,
      code: 'LAST_OWNER',
      message:
        'Este é o único vínculo de proprietário ativo da instituição. Promova outra pessoa a proprietário antes de retirar este papel.',
    };
  }

  return { allowed: true, plan };
}

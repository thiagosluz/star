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

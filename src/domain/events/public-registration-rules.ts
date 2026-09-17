/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Inscrição pública e vínculo automático de participante
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 9, inscrever-se exigia vínculo ATIVO com a instituição — regra
 *  herdada da FASE 2/3, quando a plataforma era pensada para comunidades fechadas
 *  e a instituição vinculava cada pessoa antes. Só que o produto publica eventos
 *  ABERTOS: quem descobre o evento por um link não tem (nem deveria precisar de)
 *  vínculo nenhum com a instituição para reservar uma vaga.
 *
 *  O beco sem saída era explícito: "Sem vínculo com a instituição. Peça um convite
 *  à organização do evento." — ou seja, a pessoa precisava pedir a alguém de dentro
 *  que a cadastrasse, para então se inscrever sozinha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem se inscreve em atividade de evento público passa a ser PARTICIPANTE da
 *  instituição — o vínculo nasce do próprio ato de se inscrever, e não de um
 *  convite. A instituição continua decidindo quem NÃO entra: vínculo suspenso ou
 *  removido é bloqueio, e é respeitado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA REGRA NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • NÃO concede papel administrativo. O papel criado é `PARTICIPANT`, e nada mais:
 *    quem se inscreve sozinho não administra a instituição que o recebeu.
 *  • NÃO rebaixa nem altera quem já é membro. Vínculo ativo fica como está — um
 *    patrocinador com vínculo e sem `registration:create` continua sem poder se
 *    inscrever (a fronteira entre "é membro" e "pode agir" permanece).
 *  • NÃO ressuscita vínculo removido pela instituição. "Removido" e "suspenso" são
 *    decisões dela, e uma inscrição pública não as desfaz.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Status de vínculo — espelha o enum `MembershipStatus` sem importar o ORM. */
export type MembershipStatusName = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

/** O que fazer com o vínculo ao concluir uma inscrição pública. */
export type ParticipantLinkAction =
  /** Já é membro ativo: nada a fazer. */
  | 'ALREADY_MEMBER'
  /** Convite pendente: a inscrição é o aceite tácito. */
  | 'ACTIVATE'
  /** Primeira vez: cria o vínculo como participante. */
  | 'CREATE'
  /** A instituição bloqueou esta pessoa: a inscrição é recusada. */
  | 'BLOCKED';

export interface ParticipantLinkDecision {
  action: ParticipantLinkAction;
  /** Mensagem para o usuário quando `action = BLOCKED`; nula nos demais. */
  message: string | null;
}

/** Papel concedido a quem chega pela inscrição pública. */
export const PUBLIC_REGISTRATION_ROLE = 'PARTICIPANT' as const;

/**
 * Situações de evento em que a inscrição pública é legítima.
 *
 * É a MESMA lista que o repositório público usa para decidir o que é visível
 * (`event-repository.ts`): se a página do evento não aparece para um visitante, a
 * inscrição também não pode ser aberta por ali. Duas listas diferentes seriam uma
 * inconsistência esperando para acontecer.
 */
export const PUBLIC_EVENT_STATUSES: readonly string[] = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
];

export function isPublicEventStatus(status: string): boolean {
  return PUBLIC_EVENT_STATUSES.includes(status);
}

/**
 * Decide o que fazer com o vínculo.
 *
 * A ordem das verificações é a ordem da prioridade: primeiro o bloqueio (decisão
 * da instituição), depois quem já é membro, depois o convite pendente, e só então
 * a criação. Inverter qualquer par produziria um efeito estranho — por exemplo,
 * "ativar" um vínculo suspenso, que é justamente o que a instituição quis impedir.
 */
export function evaluateParticipantLink(input: {
  membershipStatus: MembershipStatusName | null;
  /** Vínculo apagado (soft delete) é tratado como removido. */
  deleted?: boolean;
  eventIsPublic: boolean;
}): ParticipantLinkDecision {
  if (input.membershipStatus === 'SUSPENDED' || input.membershipStatus === 'REMOVED' || input.deleted) {
    return {
      action: 'BLOCKED',
      message:
        'Seu acesso a esta instituição está bloqueado. Fale com a organização do evento.',
    };
  }

  if (input.membershipStatus === 'ACTIVE') {
    return { action: 'ALREADY_MEMBER', message: null };
  }

  if (input.membershipStatus === 'INVITED') {
    return { action: 'ACTIVATE', message: null };
  }

  if (!input.eventIsPublic) {
    return {
      action: 'BLOCKED',
      message: 'Este evento é restrito à comunidade da instituição.',
    };
  }

  return { action: 'CREATE', message: null };
}

/**
 * Concede o papel de participante?
 *
 * Só para quem ainda não tem papel NENHUM na instituição. Quem já tem papel
 * (patrocinador, revisor, equipe) não recebe `PARTICIPANT` de brinde: acrescentar
 * um papel aqui mudaria, de lado, o resultado de uma permissão que a instituição
 * deliberadamente não deu.
 */
export function shouldGrantParticipantRole(existingRoles: readonly string[]): boolean {
  return existingRoles.length === 0;
}

/** Aviso exibido no formulário quando a inscrição vai criar o vínculo. */
export function publicRegistrationNotice(tenantName: string): string {
  return (
    `Ao confirmar, sua conta será vinculada como participante de ${tenantName} ` +
    'para que você acompanhe sua inscrição, seus certificados e suas conquistas.'
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  REGRAS DO CONVITE DE EQUIPE — puras, sem banco e sem Next
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ESTADO DO CONVITE É DERIVADO, NÃO SÓ ARMAZENADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A coluna `status` guarda o que a instituição FEZ (pendente, aceito, revogado).
 *  "Vencido" não é uma ação: é a passagem do tempo. Guardar `EXPIRED` exigiria um
 *  agendador para virar a chave — e um convite vencido que ninguém marcou como tal
 *  continuaria aceitável. Por isso o estado é calculado na leitura, com o MESMO
 *  relógio injetado, e o banco nunca decide sozinho (mesmo desenho da janela de
 *  exibição da página pública, ADR-109).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { ROLE_KEYS, type RoleKey, type RoleScope, roleAllowedInScope } from '@/domain/rbac/permissions';
import { normalizeEmailAddress } from './email-rules';

/** Validade do convite. Curto o bastante para não virar credencial esquecida. */
export const INVITATION_TTL_DAYS = 7;

export const INVITATION_STATES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];

export const INVITATION_STATE_LABELS: Record<InvitationState, string> = {
  PENDING: 'Convite pendente',
  ACCEPTED: 'Convite aceito',
  REVOKED: 'Convite cancelado',
  EXPIRED: 'Convite vencido',
};

export function invitationStateLabel(state: string): string {
  return INVITATION_STATE_LABELS[state as InvitationState] ?? state;
}

export interface InvitationRecord {
  status: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/** Estado efetivo: o armazenado, exceto que "pendente + prazo vencido" é VENCIDO. */
export function invitationState(invitation: InvitationRecord, now: Date): InvitationState {
  if (invitation.acceptedAt || invitation.status === 'ACCEPTED') return 'ACCEPTED';
  if (invitation.revokedAt || invitation.status === 'REVOKED') return 'REVOKED';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'PENDING';
}

export function isInvitationLive(invitation: InvitationRecord, now: Date): boolean {
  return invitationState(invitation, now) === 'PENDING';
}

export type InvitationRefusal =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_ACCEPTED'
  | 'WRONG_EMAIL'
  | 'ALREADY_MEMBER';

export type AcceptVerdict =
  | { ok: true }
  | { ok: false; code: InvitationRefusal; message: string };

/**
 * Pode aceitar? A ordem das recusas importa para a mensagem que a pessoa lê.
 *
 * O endereço é a prova de posse: o convite foi enviado para um e-mail, e aceitar
 * com OUTRA conta entregaria o acesso a quem recebeu o link encaminhado. É o mesmo
 * princípio do convite de palestrante (token prova o link, e-mail da conta prova
 * quem é — ADR-115) e a razão pela qual este convite NÃO abre para qualquer conta
 * logada.
 */
export function evaluateAcceptance(input: {
  invitation: InvitationRecord & { email: string };
  now: Date;
  userEmail: string;
  /** Já existe vínculo ATIVO desta pessoa com a instituição? */
  alreadyMember: boolean;
}): AcceptVerdict {
  const state = invitationState(input.invitation, input.now);

  if (state === 'REVOKED') {
    return {
      ok: false,
      code: 'REVOKED',
      message: 'Este convite foi cancelado pela instituição. Peça um novo a quem convidou.',
    };
  }

  if (state === 'ACCEPTED') {
    return {
      ok: false,
      code: 'ALREADY_ACCEPTED',
      message: 'Este convite já foi aceito. Se o acesso não aparece, fale com a instituição.',
    };
  }

  if (state === 'EXPIRED') {
    return {
      ok: false,
      code: 'EXPIRED',
      message: 'Este convite venceu. Peça um novo à instituição — o link tem prazo de validade.',
    };
  }

  if (normalizeEmailAddress(input.userEmail) !== normalizeEmailAddress(input.invitation.email)) {
    return {
      ok: false,
      code: 'WRONG_EMAIL',
      message:
        'Este convite foi enviado para outro endereço. Entre com a conta daquele e-mail para aceitar.',
    };
  }

  if (input.alreadyMember) {
    return {
      ok: false,
      code: 'ALREADY_MEMBER',
      message: 'Sua conta já tem vínculo ativo com esta instituição.',
    };
  }

  return { ok: true };
}

/**
 * Papéis que podem ser CONVIDADOS por e-mail.
 *
 * Fora da lista, e cada exclusão tem motivo:
 *  • `SUPERADMIN` — papel de plataforma, nunca concedido por instituição;
 *  • `OWNER` — a propriedade da instituição se TRANSFERE, não se convida: quem
 *    aceitasse um convite de OWNER poderia remover quem convidou;
 *  • `PARTICIPANT` — é o público do evento, não a equipe. Quem entra por convite
 *    nasce `MEMBER` (e consome quota do plano); permitir este papel criaria um
 *    vínculo de equipe com papel de participante, que é a confusão que a FASE 14
 *    separou.
 */
export function invitableRoles(): readonly RoleKey[] {
  return ROLE_KEYS.filter(
    (role) =>
      role !== 'SUPERADMIN' &&
      role !== 'OWNER' &&
      role !== 'PARTICIPANT' &&
      roleAllowedInScope(role, 'TENANT' as RoleScope),
  );
}

export function isInvitableRole(role: string): role is RoleKey {
  return invitableRoles().includes(role as RoleKey);
}

/** Momento de vencimento de um convite criado agora. */
export function invitationExpiry(now: Date, days: number = INVITATION_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1_000);
}

/** Texto do que acontece ao aceitar — usado na tela e no e-mail. */
export function invitationConsequence(role: string): string {
  switch (role) {
    case 'ADMIN':
      return 'acesso administrativo completo da instituição, exceto exclusão e cobrança';
    case 'ORGANIZER':
      return 'criação e operação de eventos, incluindo a programação e o credenciamento';
    case 'CHAIR':
      return 'coordenação científica: trilhas, distribuição de avaliações e decisões';
    case 'REVIEWER':
      return 'avaliação dos trabalhos atribuídos a você';
    case 'FINANCE':
      return 'patrocínios e relatórios financeiros da instituição';
    case 'SPEAKER':
      return 'gestão do próprio perfil de palestrante e dos materiais';
    case 'STAFF':
      return 'credenciamento e operação do dia do evento';
    case 'SPONSOR':
      return 'acompanhamento do patrocínio';
    default:
      return 'participação nos eventos da instituição';
  }
}

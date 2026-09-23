/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O texto da decisão da proposta (FASE 36, dívida E47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO É O RÓTULO DO PAINEL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela mostra um ESTADO em uma ou duas palavras ("Aceita", "Revisão solicitada"):
 *  é um chip ao lado de um título, lido de relance. O e-mail precisa fazer outra
 *  coisa — dizer O QUE ACONTECEU e O QUE FAZER AGORA, para alguém que talvez nem
 *  lembre que propôs. São dois artefatos diferentes, e é por isso que aqui existe
 *  `outcome` e não só `label`.
 *
 *  O que este módulo garante é que o texto da decisão nasça em UM lugar: o
 *  `recordDecision` avisa por aqui, e um segundo caminho de decisão que venha a
 *  existir usa a mesma tabela. Sem isso, "recusada" na tela e "em análise" no e-mail
 *  seriam a mesma decisão contada de duas formas.
 *
 *  Puro: sem Prisma, sem Next, sem rede — testável com um literal.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** As três decisões que fecham a avaliação de uma proposta. Espelha `RecordDecisionInput['decision']`. */
export const PROPOSAL_DECISIONS = ['ACCEPTED', 'REJECTED', 'REVISION_REQUESTED'] as const;

export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number];

export function isProposalDecision(value: unknown): value is ProposalDecision {
  return typeof value === 'string' && (PROPOSAL_DECISIONS as readonly string[]).includes(value);
}

export interface DecisionNoticeText {
  /** Como a decisão é nomeada, com inicial maiúscula (entra em assunto e título). */
  label: string;
  /** O que a decisão significa e o próximo passo de quem propôs. */
  outcome: string;
}

export const DECISION_NOTICE_TEXT: Record<ProposalDecision, DecisionNoticeText> = {
  ACCEPTED: {
    label: 'Aceita',
    outcome:
      'A proposta faz parte da programação. A organização entra em contato com os detalhes de data, horário e formato — e o convite para publicar materiais chega pelo portal do palestrante, quando houver.',
  },
  REJECTED: {
    label: 'Recusada',
    outcome:
      'A proposta não foi selecionada para esta chamada. A decisão vale para esta edição; outras chamadas do evento e dos próximos podem ser uma nova oportunidade.',
  },
  REVISION_REQUESTED: {
    label: 'Ajustes solicitados',
    outcome:
      'O comitê pediu ajustes antes de decidir. Abra a proposta, faça as alterações indicadas no parecer e envie de novo — o prazo da chamada continua valendo.',
  },
};

export function decisionNoticeText(decision: ProposalDecision): DecisionNoticeText {
  return DECISION_NOTICE_TEXT[decision];
}

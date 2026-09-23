/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — O aviso de decisão ao proponente (FASE 36, dívida E47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DÍVIDA QUE ESTE MÓDULO QUITA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 33 fez a proposta ter PROTOCOLO: quem propõe recebe o comprovante do envio
 *  e tem por onde perguntar depois. A resposta, porém, morria no painel do comitê —
 *  o proponente descobria o resultado abrindo "Minhas submissões" por acaso. Numa
 *  chamada com pedido de ajustes, o prazo corria contra quem não sabia que precisava
 *  mexer em alguma coisa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SÓ A PROPOSTA DE CHAMADA É AVISADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O aviso é disparado pelo `recordDecision` e só sai quando a submissão tem
 *  `callId` — ou seja, quando ela nasceu de uma CHAMADA. O artigo submetido pelo
 *  caminho antigo (a janela de submissão do evento, sem chamada) continua como
 *  estava: quem o submeteu é autor do trabalho científico e acompanha a avaliação na
 *  tela de submissões, e mudar isso mexeria no fluxo acadêmico que as fases 4 e 33
 *  fecharam. É um limite declarado, não um esquecimento (ver `docs/fase-36-*.md`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MENSAGEM É O FATO; O E-MAIL É CONSEQUÊNCIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O aviso nasce na caixa de entrada do proponente e o e-mail é enfileirado com a
 *  MESMA `dedupeKey` (`deliverNotice`, em `@/lib/communication/notice-service`) — a
 *  regra da FASE 32. Nada aqui lança (invariante 8): a decisão JÁ está registrada, e
 *  uma falha de e-mail não pode desfazê-la.
 *
 *  A `dedupeKey` carrega a DECISÃO, não só a proposta: pedir ajustes e depois aceitar
 *  são dois fatos, e os dois precisam chegar. Repetir a MESMA decisão, não.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { deliverNotice, noticeFailure, type NoticeOutcome } from '@/lib/communication/notice-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  decisionNoticeText,
  isProposalDecision,
  type ProposalDecision,
} from '@/domain/review/decision-notice-rules';

interface NoticeContext {
  tenantSlug: string;
  eventId: string;
  eventTitle: string;
  callTitle: string;
  proposalTitle: string;
  protocol: string;
  /** O que o comitê escreveu ao decidir — o autor já lê isto na tela da proposta. */
  decisionNotes: string | null;
  recipientName: string;
  recipientEmail: string;
  recipientUserId: string;
}

/**
 * Lê tudo o que o aviso precisa em UMA transação com o contexto da instituição.
 *
 * A chamada é o que autoriza o aviso: `callId` nulo encerra aqui, antes de qualquer
 * leitura de pessoa.
 */
async function loadNoticeContext(
  tenantId: string,
  submissionId: string,
): Promise<{ context: NoticeContext | null; reason: string | null }> {
  return withTenant(tenantId, async (tx) => {
    const submission = await tx.submission.findFirst({
      where: { id: submissionId, tenantId, deletedAt: null },
      select: {
        callId: true,
        protocol: true,
        title: true,
        eventId: true,
        decisionNotes: true,
        author: { select: { id: true, name: true, email: true } },
        event: { select: { title: true } },
        call: { select: { title: true } },
      },
    });

    if (!submission) {
      return { context: null, reason: 'Proposta não encontrada.' };
    }

    if (!submission.callId || !submission.call) {
      return { context: null, reason: 'Submissão sem chamada de propostas: não há decisão a avisar.' };
    }

    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { slug: true },
    });

    return {
      context: {
        tenantSlug: tenant.slug,
        eventId: submission.eventId,
        eventTitle: submission.event.title,
        callTitle: submission.call.title,
        proposalTitle: submission.title,
        protocol: submission.protocol,
        decisionNotes: submission.decisionNotes,
        recipientName: submission.author.name,
        recipientEmail: submission.author.email,
        recipientUserId: submission.author.id,
      },
      reason: null,
    };
  });
}

/**
 * Avisa o proponente da decisão.
 *
 * Devolve o resultado em vez de lançar: quem chama (`recordDecision`) já gravou a
 * decisão e só registra no log o que falhou aqui.
 */
export async function notifyProposalDecided(input: {
  tenantId: string;
  submissionId: string;
  decision: string;
}): Promise<NoticeOutcome> {
  if (!isProposalDecision(input.decision)) {
    return noticeFailure(`Decisão desconhecida: ${input.decision}.`);
  }

  const decision: ProposalDecision = input.decision;

  const { context, reason } = await loadNoticeContext(input.tenantId, input.submissionId);

  if (!context) return noticeFailure(reason ?? 'Não foi possível carregar a proposta.');

  const text = decisionNoticeText(decision);
  const proposalsUrl = tenantPath(context.tenantSlug, '/submissoes');

  /**
   * O PARECER VAI NO AVISO — e é a diferença entre um aviso útil e um aviso que só
   * dá trabalho. "Ajustes solicitados" sem dizer o que ajustar obriga a pessoa a
   * abrir a plataforma para descobrir se precisa mexer em algo; e o texto já é
   * visível a ela na tela da proposta (`decisionNotes`), então não há nada a proteger.
   * O corte em 800 caracteres existe porque a caixa de entrada guarda 2000: um
   * parecer longo não pode empurrar o link para fora da mensagem.
   */
  const notes = context.decisionNotes?.trim() ? context.decisionNotes.trim().slice(0, 800) : null;

  return deliverNotice({
    tenantId: input.tenantId,
    userId: context.recipientUserId,
    eventId: context.eventId,
    recipientEmail: context.recipientEmail,
    dedupeKey: `proposal-decided-${input.submissionId}-${decision}`,
    subject: `${text.label}: ${context.proposalTitle}`,
    body: [
      `A chamada "${context.callTitle}" (${context.eventTitle}) avaliou a sua proposta "${context.proposalTitle}".`,
      `Situação: ${text.label}.`,
      text.outcome,
      ...(notes ? [`Parecer do comitê: ${notes}`] : []),
      `Protocolo: ${context.protocol}.`,
      `Veja a proposta: ${proposalsUrl}`,
    ].join('\n\n'),
    template: 'PROPOSAL_DECIDED',
    payload: {
      recipientName: context.recipientName,
      eventTitle: context.eventTitle,
      callTitle: context.callTitle,
      proposalTitle: context.proposalTitle,
      protocol: context.protocol,
      decisionLabel: text.label,
      outcome: text.outcome,
      notes,
      proposalsUrl,
    },
  });
}

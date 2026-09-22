/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Submissão pública de propostas (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CAMINHO: DA PÁGINA PÚBLICA ATÉ A MESA DO COMITÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. a pessoa abre a chamada na página pública do evento;
 *    2. preenche o formulário (os campos dependem do TIPO da chamada);
 *    3. a proposta vira uma `Submission` — a MESMA entidade que o artigo, com o
 *       mesmo motor de avaliação, o mesmo protocolo e a mesma trilha de auditoria;
 *    4. o e-mail de confirmação leva o protocolo, que é o que ela tem em mãos depois.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NADA AQUI REIMPLEMENTA A SUBMISSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este serviço NÃO grava `Submission` à mão: chama `createSubmission` e
 *  `submitSubmission` (FASE 4), que já carregam a validação de conteúdo, o limite por
 *  autor, o protocolo único, o snapshot de autoria e a auditoria. O que ele acrescenta
 *  é o que é PRÓPRIO da chamada: validar os campos do tipo antes de criar, garantir o
 *  vínculo de participante de quem chegou de fora, e avisar por e-mail.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM: VÍNCULO → PROPOSTA → E-MAIL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O vínculo de participante é aplicado ANTES de criar a proposta — e é a MESMA
 *  regra da inscrição pública (`linkParticipantIfEligible`, F10). Se a proposta for
 *  recusada depois (prazo vencido, limite atingido), o vínculo permanece: a pessoa
 *  criou conta e se apresentou à instituição, e isso não é um erro a desfazer.
 *
 *  O e-mail sai DEPOIS do commit e não derruba nada: a proposta já está gravada, e
 *  falha de provedor vira aviso no retorno (invariante nº 8).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { linkParticipantIfEligible } from '@/lib/events/registration-service';
import { createSubmission, submitSubmission } from '@/lib/review/submission-service';
import { isOpenToPublicEvent } from '@/domain/events/public-registration-rules';
import { queueEmail } from '@/lib/communication/email-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  PROPOSAL_KIND_LABELS,
  validateProposalData,
  type ProposalKind,
} from '@/domain/proposals/call-rules';

export type ProposalErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'MEMBERSHIP_BLOCKED'
  | 'CALL_NOT_PUBLISHED'
  | 'CALL_NOT_OPEN'
  | 'CALL_CLOSED'
  | 'AUTHOR_LIMIT_REACHED'
  | 'NOT_READY'
  /**
   * Recusas do PROTOCOLO DE ACEITE (FASE 33), que vêm do domínio
   * (`planAcceptance`): criar atividade sem agenda e convidar quem não tem e-mail
   * são problemas diferentes, com correções diferentes.
   */
  | 'MISSING_SCHEDULE'
  | 'INVALID_SCHEDULE'
  | 'MISSING_EMAIL'
  | 'INTERNAL';

export type ProposalResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: ProposalErrorCode; message: string; details?: readonly string[] };

/** Traduz a recusa do motor de submissão para o vocabulário da chamada. */
function mapSubmissionError(code: string, message: string, details?: readonly string[]): ProposalResult<never> {
  const known: ProposalErrorCode[] = [
    'CALL_NOT_PUBLISHED',
    'CALL_NOT_OPEN',
    'CALL_CLOSED',
    'AUTHOR_LIMIT_REACHED',
    'NOT_READY',
    'INVALID_INPUT',
  ];

  const mapped = known.find((candidate) => candidate === code);

  return {
    ok: false,
    code: mapped ?? 'INVALID_INPUT',
    message,
    ...(details && details.length > 0 ? { details } : {}),
  };
}

export interface SubmitProposalInput {
  tenantId: string;
  eventId: string;
  callId: string;
  userId: string;
  title: string;
  abstract: string;
  keywords: readonly string[];
  language?: string;
  /** Campos do formulário, crus: a validação por tipo decide o que entra. */
  data: Record<string, unknown>;
  /** Para o e-mail de confirmação (nome do evento e da instituição). */
  tenantSlug: string;
}

/**
 * Envia uma proposta pela chamada pública.
 *
 * Tudo o que o proponente vê de volta é o PROTOCOLO — é com ele que a organização
 * acha a proposta, e é ele que chega por e-mail.
 */
export async function submitProposal(
  input: SubmitProposalInput,
): Promise<
  ProposalResult<{
    submissionId: string;
    protocol: string;
    linkedAsParticipant: boolean;
    /** `true` quando o e-mail de confirmação entrou na fila. */
    confirmationQueued: boolean;
  }>
> {
  try {
    const call = await withTenant(input.tenantId, async (tx) => {
      const [row, event] = await Promise.all([
        tx.callForProposals.findFirst({
          where: { id: input.callId, tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
          select: { id: true, kind: true, title: true },
        }),
        tx.event.findFirst({
          where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
          select: { title: true, status: true, settings: true },
        }),
      ]);

      return { row, event };
    });

    if (!call.row || !call.event) {
      return { ok: false, code: 'NOT_FOUND', message: 'Chamada não encontrada neste evento.' };
    }

    const kind = call.row.kind as ProposalKind;

    /**
     * OS CAMPOS DO TIPO SÃO VALIDADOS ANTES DE QUALQUER ESCRITA.
     *
     * É o que evita o pior resultado possível: criar a conta, o vínculo e a
     * submissão, e só então descobrir que faltava a carga horária — deixando um
     * rascunho inválido e uma pessoa que acha que enviou.
     */
    const validated = validateProposalData({ kind, data: input.data });

    if (!validated.ok) {
      return { ok: false, code: 'INVALID_INPUT', message: validated.message, details: [validated.field] };
    }

    /**
     * O VÍNCULO DE PARTICIPANTE — a mesma regra da inscrição pública.
     *
     * Quem cria conta pelo formulário da chamada passa a ser participante da
     * instituição (é o que a FASE 10 faz com quem se inscreve), e a decisão é da
     * regra compartilhada: instituição suspensa ou vínculo bloqueado recusam a
     * proposta aqui, antes de qualquer gravação.
     */
    const link = await withTenant(input.tenantId, (tx) =>
      linkParticipantIfEligible(tx, {
        tenantId: input.tenantId,
        userId: input.userId,
        eventIsPublic: isOpenToPublicEvent({
          eventStatus: call.event!.status,
          settings: call.event!.settings,
        }),
      }),
    );

    if (link.blocked) {
      return {
        ok: false,
        code: 'MEMBERSHIP_BLOCKED',
        message: link.message ?? 'Sua conta não pode participar desta instituição.',
      };
    }

    // ── A proposta é uma SUBMISSION: o motor da FASE 4 faz o resto ─────────────
    const created = await createSubmission({
      tenantId: input.tenantId,
      eventId: input.eventId,
      userId: input.userId,
      callId: call.row.id,
      proposalData: validated.data,
      trackId: null,
      title: input.title,
      abstract: input.abstract,
      keywords: input.keywords,
      language: input.language ?? 'pt-BR',
    });

    if (!created.ok) {
      return mapSubmissionError(created.code, created.message, created.details);
    }

    const submitted = await submitSubmission({
      tenantId: input.tenantId,
      submissionId: created.id,
      userId: input.userId,
    });

    if (!submitted.ok) {
      return mapSubmissionError(submitted.code, submitted.message, submitted.details);
    }

    /**
     * O E-MAIL DE CONFIRMAÇÃO — com o protocolo, que é o que a pessoa guarda.
     * Não bloqueia nada: a proposta está gravada, e o retorno diz se o e-mail saiu.
     */
    const person = await withTenant(input.tenantId, (tx) =>
      tx.user.findUnique({ where: { id: input.userId }, select: { name: true, email: true } }),
    );

    const confirmation = person
      ? await queueEmail({
          tenantId: input.tenantId,
          to: person.email,
          toUserId: input.userId,
          template: 'PROPOSAL_RECEIVED',
          brandName: call.event.title,
          dedupeKey: `proposal-received-${created.id}`,
          createdById: input.userId,
          payload: {
            recipientName: person.name,
            eventTitle: call.event.title,
            callTitle: call.row.title,
            callKindLabel: PROPOSAL_KIND_LABELS[kind],
            proposalTitle: input.title.trim(),
            protocol: created.protocol,
            proposalsUrl: tenantPath(input.tenantSlug, '/submissoes'),
          },
        })
      : { ok: false as const, code: 'INVALID_RECIPIENT' as const, message: 'Proponente sem e-mail.' };

    return {
      ok: true,
      submissionId: created.id,
      protocol: created.protocol,
      linkedAsParticipant: link.linked,
      confirmationQueued: confirmation.ok,
    };
  } catch (error) {
    console.error(`[proposals] falha ao enviar a proposta: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível enviar a proposta.' };
  }
}

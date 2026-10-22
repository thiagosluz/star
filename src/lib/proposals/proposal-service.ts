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
import {
  createSubmission,
  submitSubmission,
  updateSubmissionDraft,
} from '@/lib/review/submission-service';
import { isOpenToPublicEvent, readEventRegistrationPolicy } from '@/domain/events/public-registration-rules';
import { queueEmail } from '@/lib/communication/email-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  PROPOSAL_KIND_LABELS,
  canSubmitToCall,
  validateProposalData,
  type ProposalKind,
} from '@/domain/proposals/call-rules';
import { NOT_SENT_SUBMISSION_STATUSES } from '@/domain/proposals/proposal-receipt-rules';

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
   * FASE 74 · fatia 4 — o teto de rascunhos COM arquivo desta pessoa nesta chamada.
   * Vem do serviço de submissão (`canStartAnotherDraftWithFile`) e chega aqui como
   * qualquer outra recusa do motor: com a mensagem do domínio e o caminho escrito.
   */
  | 'DRAFT_FILE_LIMIT_REACHED'
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
  | {
      ok: false;
      code: ProposalErrorCode;
      message: string;
      details?: readonly string[];
      /**
       * O RASCUNHO que ficou da tentativa, quando a recusa é `NOT_READY` (FASE 74).
       *
       * É o que transforma o beco em caminho: a proposta foi criada e o envio recusou
       * por falta de um arquivo — a pessoa precisa do id para CONTINUAR na área do
       * autor (anexar o PDF) em vez de reescrever tudo. Só a recusa de prontidão o
       * devolve: nas outras não existe rascunho para continuar.
       */
      submissionId?: string;
    };

/** Traduz a recusa do motor de submissão para o vocabulário da chamada. */
function mapSubmissionError(code: string, message: string, details?: readonly string[]): ProposalResult<never> {
  const known: ProposalErrorCode[] = [
    'CALL_NOT_PUBLISHED',
    'CALL_NOT_OPEN',
    'CALL_CLOSED',
    'AUTHOR_LIMIT_REACHED',
    'DRAFT_FILE_LIMIT_REACHED',
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
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A TENTATIVA QUE FALHOU NÃO VIRA UM SEGUNDO RASCUNHO (FASE 74 · fatia 2)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O envio criava o rascunho e só então recusava por falta do `BLIND_PDF`. Quem
 *  tentasse de novo — depois de corrigir o resumo, por exemplo — ganhava um SEGUNDO
 *  rascunho, e o primeiro ficava no banco como lixo. Com limite por autor, a pessoa
 *  se trancava fora tentando (a fatia 3 tirou o rascunho da conta — ver
 *  `proposal-receipt-rules`; esta função continua sendo o que impede o lixo).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE "SEM ARQUIVO NENHUM" É O CRITÉRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Para uma chamada, o formulário público é o ÚNICO lugar que cria rascunho: o
 *  caminho por trilha (`/submissoes/nova`) recusa evento com chamada publicada
 *  desde a FASE 68. Logo, um rascunho desta pessoa nesta chamada é o resto de uma
 *  tentativa anterior.
 *
 *  Mas só quando ele está VAZIO de artefatos. Um rascunho COM arquivo é trabalho em
 *  andamento, e o arquivo é de um trabalho específico: reaproveitá-lo para outra
 *  proposta anexaria o PDF de um trabalho ao texto de outro — e a prontidão passaria,
 *  porque o `BLIND_PDF` que existe é de outra coisa. Vazio, não há nada a perder: o
 *  texto é o que a pessoa acabou de mandar de novo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE CAMINHO **NÃO** FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele não cria submissão, então as portas do `createSubmission` (janela da chamada
 *  e limite por autor) não rodam sozinhas: a janela é conferida aqui, com a MESMA
 *  regra de domínio (`canSubmitToCall`).
 */
async function findReusableDraft(input: {
  tenantId: string;
  eventId: string;
  callId: string;
  userId: string;
}): Promise<{ id: string; protocol: string } | null> {
  return withTenant(input.tenantId, (tx) =>
    tx.submission.findFirst({
      where: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        callId: input.callId,
        submittedById: input.userId,
        status: 'DRAFT',
        deletedAt: null,
        files: { none: { deletedAt: null } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, protocol: true },
    }),
  );
}

/**
 * Envia uma proposta pela chamada pública.
 *
 * Tudo o que o proponente vê de volta é o PROTOCOLO — é com ele que a organização
 * acha a proposta, e é ele que chega por e-mail.
 *
 * Quando o ENVIO recusa por prontidão (`NOT_READY`), o rascunho volta junto com a
 * recusa: mesmo com o caminho de anexo decidido na FASE 74, o formulário público NÃO
 * recebe upload — a proposta é COMPLETADA na área do autor, e o id é a porta para
 * ela. Sem esse id, a pessoa que escreveu 3.000 caracteres leria "anexe a versão
 * cega" e teria de reescrever tudo para chegar ao mesmo lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O TETO DE RASCUNHOS COM ARQUIVO MORA ONDE OS RASCUNHOS NASCEM (FASE 74 · fatia 4)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Como o rascunho com arquivo não é reusado, quem não envia acumula um por trabalho
 *  começado. O teto (`proposal-draft-rules`) é aplicado pelo `createSubmission`, no
 *  caminho `!reusable` — a retomada do rascunho VAZIO continua passando, porque é o
 *  mesmo trabalho e não um novo.
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
          /**
           * A JANELA e o LIMITE vêm junto porque o rascunho reaproveitado pula o
           * `createSubmission` — e é aqui que a regra de domínio da chamada é
           * aplicada nesse caminho (ver `findReusableDraft`).
           */
          select: {
            id: true,
            kind: true,
            title: true,
            isPublished: true,
            opensAt: true,
            closesAt: true,
            maxSubmissionsPerAuthor: true,
          },
        }),
        tx.event.findFirst({
          where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
          /**
           * O NOME DA INSTITUIÇÃO entra na recusa de evento restrito (FASE 70): a
           * mensagem que a pessoa lê diz de QUEM é a comunidade que ela precisa.
           */
          select: { title: true, status: true, settings: true, tenant: { select: { name: true } } },
        }),
      ]);

      return { row, event };
    });

    if (!call.row || !call.event) {
      return { ok: false, code: 'NOT_FOUND', message: 'Chamada não encontrada neste evento.' };
    }

    const kind = call.row.kind as ProposalKind;
    /**
     * O id em uma `const`: dentro do callback do `withTenant` o TypeScript não
     * preserva o estreitamento de `call.row` (ele poderia mudar entre a leitura e a
     * consulta), e a alternativa seria um `!` — que esconderia justamente o caso
     * "a chamada sumiu" que o guarda acima trata.
     */
    const callId = call.row.id;

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
        /**
         * ─────────────────────────────────────────────────────────────────────────
         *  O EVENTO RESTRITO TAMBÉM RECUSA A PROPOSTA (FASE 70)
         * ─────────────────────────────────────────────────────────────────────────
         *  A restrição à comunidade era conferida só na tela da inscrição, e a
         *  chamada de propostas é a OUTRA porta pública do mesmo evento — sem esta
         *  chave, quem não tem vínculo enviaria um trabalho para um evento que não
         *  deixaria nem entrar.
         */
        requiresMembership: readEventRegistrationPolicy(call.event!.settings).requiresMembership,
        tenantName: call.event!.tenant.name,
      }),
    );

    if (link.blocked) {
      return {
        ok: false,
        code: 'MEMBERSHIP_BLOCKED',
        message: link.message ?? 'Sua conta não pode participar desta instituição.',
      };
    }

    /**
     * ── O RASCUNHO DA TENTATIVA ANTERIOR É RETOMADO (FASE 74) ────────────────
     * Ver `findReusableDraft`: vazio de artefatos, ele é o resto de um envio que
     * recusou — reaproveitá-lo é o que impede uma tentativa por rascunho órfão.
     */
    const reusable = await findReusableDraft({
      tenantId: input.tenantId,
      eventId: input.eventId,
      callId: call.row.id,
      userId: input.userId,
    });

    let submissionId: string;
    let protocol: string;

    if (reusable) {
      /**
       * A JANELA DA CHAMADA É CONFERIDA AQUI: retomar um rascunho não passa pelo
       * `createSubmission`, e sem esta linha um rascunho velho entraria depois do
       * prazo.
       *
       * ── O LIMITE TAMBÉM VALE AQUI (FASE 74 · fatias 3 e 6) ───────────────────
       * A primeira versão passava `authorSubmissions: 0` declarando que "retomar a
       * própria tentativa não consome cota nova". Isso era verdade só enquanto não
       * existia cota consumida: com o limite cheio e um rascunho vazio esquecido, a
       * retomada virava uma proposta ALÉM do limite — o furo pelo lado oposto do
       * defeito que a fatia fecha. Então conta-se a verdade: as propostas recebidas
       * do autor nesta chamada, pela MESMA régua do painel e do `createSubmission`
       * (o que foi ENVIADO — só o rascunho fica de fora).
       */
      const authorSubmissions = await withTenant(input.tenantId, (tx) =>
        tx.submission.count({
          where: {
            tenantId: input.tenantId,
            callId,
            submittedById: input.userId,
            deletedAt: null,
            status: { notIn: [...NOT_SENT_SUBMISSION_STATUSES] },
          },
        }),
      );

      const retomada = canSubmitToCall({
        call: {
          isPublished: call.row.isPublished,
          opensAt: call.row.opensAt,
          closesAt: call.row.closesAt,
          now: new Date(),
          maxSubmissionsPerAuthor: call.row.maxSubmissionsPerAuthor,
          title: call.row.title,
        },
        authorSubmissions,
      });

      if (!retomada.ok) {
        return { ok: false, code: retomada.code, message: retomada.message };
      }

      /**
       * O CONTEÚDO É O QUE A PESSOA ACABOU DE MANDAR — inclusive os campos do TIPO.
       *
       * A edição do rascunho passa pelo serviço da FASE 4 (`updateSubmissionDraft`):
       * ele valida o conteúdo, confere a POSSE e grava a auditoria. Os campos do tipo
       * (`proposalData`) não fazem parte dele — são da CHAMADA, e por isso são
       * gravados aqui, na mesma camada que os gravou na criação.
       */
      const updated = await updateSubmissionDraft({
        tenantId: input.tenantId,
        submissionId: reusable.id,
        userId: input.userId,
        title: input.title,
        abstract: input.abstract,
        keywords: input.keywords,
        language: input.language ?? 'pt-BR',
      });

      if (!updated.ok) {
        return mapSubmissionError(updated.code, updated.message, updated.details);
      }

      await withTenant(input.tenantId, (tx) =>
        tx.submission.update({
          where: { id: reusable.id },
          data: { proposalData: validated.data },
        }),
      );

      submissionId = reusable.id;
      protocol = reusable.protocol;
    } else {
      // ── A proposta é uma SUBMISSION: o motor da FASE 4 faz o resto ───────────
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

      submissionId = created.id;
      protocol = created.protocol;
    }

    const submitted = await submitSubmission({
      tenantId: input.tenantId,
      submissionId,
      userId: input.userId,
    });

    if (!submitted.ok) {
      const refusal = mapSubmissionError(submitted.code, submitted.message, submitted.details);

      /**
       * ── A RECUSA DE PRONTIDÃO ENTREGA O CAMINHO (FASE 74) ─────────────────
       * O rascunho ESTÁ GRAVADO: o que falta é um arquivo, e o formulário público
       * não tem onde anexar. Sem o id, a pessoa lê a recusa e não tem para onde ir;
       * com ele, a tela oferece "Continuar na área do autor" e o trabalho escrito
       * não se perde. As outras recusas não devolvem id porque não há rascunho
       * para continuar (e devolver um id que não serve seria outra mentira).
       */
      if (refusal.code === 'NOT_READY') {
        return { ...refusal, submissionId };
      }

      return refusal;
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
          dedupeKey: `proposal-received-${submissionId}`,
          createdById: input.userId,
          payload: {
            recipientName: person.name,
            eventTitle: call.event.title,
            callTitle: call.row.title,
            callKindLabel: PROPOSAL_KIND_LABELS[kind],
            proposalTitle: input.title.trim(),
            protocol,
            proposalsUrl: tenantPath(input.tenantSlug, '/submissoes'),
          },
        })
      : { ok: false as const, code: 'INVALID_RECIPIENT' as const, message: 'Proponente sem e-mail.' };

    return {
      ok: true,
      submissionId,
      protocol,
      linkedAsParticipant: link.linked,
      confirmationQueued: confirmation.ok,
    };
  } catch (error) {
    console.error(`[proposals] falha ao enviar a proposta: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível enviar a proposta.' };
  }
}

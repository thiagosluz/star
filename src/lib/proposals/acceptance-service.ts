/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Protocolo de aceite (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ACONTECE QUANDO O ORGANIZADOR ACEITA UMA PROPOSTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Aceitar é UM ato — a decisão do comitê —, e depois dele o organizador ESCOLHE o
 *  que fazer com o que aceitou (decisão do humano nesta fase):
 *
 *    • **criar a atividade** na programação, com título, resumo, tipo e carga
 *      horária vindos da proposta (e a agenda que ELE informa, porque o formulário
 *      não pede horário — quem monta a grade é a organização);
 *    • **convidar o proponente** como palestrante, gerando o convite e ENVIANDO o
 *      e-mail com o link.
 *
 *  Nenhuma das duas é automática, e nenhuma é obrigatória: uma proposta aceita pode
 *  entrar na grade depois, quando a sala for definida, e o convite pode esperar o
 *  programa fechar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO NÃO É REIMPLEMENTADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem registra o aceite é `recordDecision` (FASE 16), com o mesmo quórum, a mesma
 *  trilha e o mesmo crédito de XP do aceite de artigo. Este serviço só ACRESCENTA os
 *  passos seguintes — se ele gravasse o status à mão, existiriam duas regras de
 *  decisão no sistema (armadilha 55), e a segunda não teria quórum.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A ATIVIDADE NÃO É CRIADA "VAZIA" PARA DEPOIS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `saveActivity` (FASE 3) valida conflito de sala e lotação — e exige agenda. Criar
 *  a atividade com data inventada só para "depois ajustar" colocaria uma linha falsa
 *  na programação pública, e o organizador teria de descobri-la e corrigi-la. Sem
 *  agenda, a atividade simplesmente não é criada (e a tela diz que falta informar).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { saveActivity } from '@/lib/admin/catalog-service';
import { saveSpeakerProfile, linkSpeakerToActivity } from '@/lib/speakers/speaker-service';
import { recordDecision } from '@/lib/review/review-service';
import { queueEmail } from '@/lib/communication/email-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import {
  PROPOSAL_KIND_ACTIVITY_TYPE,
  PROPOSAL_KIND_LABELS,
  activityTitleFromProposal,
  planAcceptance,
  proposedWorkload,
  type ProposalKind,
} from '@/domain/proposals/call-rules';
import type { ProposalResult } from '@/lib/proposals/proposal-service';

/** Convite do palestrante válido por 14 dias — o mesmo prazo do cadastro manual. */
const INVITE_VALID_DAYS = 14;
/** Teto do resumo que vira descrição da atividade: o texto vai para a página pública. */
const ACTIVITY_DESCRIPTION_MAX = 1_200;

export interface AcceptProposalInput {
  tenantId: string;
  tenantSlug: string;
  submissionId: string;
  actorId: string;
  notes?: string | null;
  /** Agenda informada pela organização. `null` = não criar a atividade. */
  createActivity: {
    activityType: string;
    startsAt: Date;
    endsAt: Date;
    roomId?: string | null;
    capacity?: number | null;
    requiresRegistration?: boolean;
  } | null;
  /** Convidar o proponente como palestrante (gera convite e envia e-mail). */
  inviteSpeaker: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AcceptanceOutcome {
  status: string;
  finalScore: number | null;
  activityId: string | null;
  speakerProfileId: string | null;
  /** Token em claro — devolvido UMA vez, para o organizador copiar o link se quiser. */
  inviteToken: string | null;
  inviteSent: boolean;
  warnings: readonly string[];
}

export async function acceptProposal(input: AcceptProposalInput): Promise<ProposalResult<AcceptanceOutcome>> {
  try {
    /**
     * ── 1. O que existe por trás desta proposta ────────────────────────────────
     * A chamada (para saber o TIPO), o evento (fuso e nome) e o proponente (nome e
     * e-mail, que vêm do autor de ordem 1 — é dele que sai o convite).
     */
    const context = await withTenant(input.tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          title: true,
          abstract: true,
          status: true,
          call: { select: { id: true, kind: true, title: true } },
          event: { select: { id: true, title: true, slug: true, timezone: true } },
          authors: {
            orderBy: { authorOrder: 'asc' },
            take: 1,
            select: {
              userId: true,
              guestName: true,
              guestEmail: true,
              guestInstitution: true,
              institution: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });

      return submission;
    });

    if (!context) {
      return { ok: false, code: 'NOT_FOUND', message: 'Proposta não encontrada.' };
    }

    if (!context.call) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message:
          'Esta submissão não veio de uma chamada: o aceite com criação de atividade e convite é do fluxo das chamadas.',
      };
    }

    const kind = context.call.kind as ProposalKind;
    const author = context.authors[0];
    const speakerName = author?.user?.name ?? author?.guestName ?? null;
    const speakerEmail = author?.user?.email ?? author?.guestEmail ?? null;
    const speakerUserId = author?.user?.id ?? author?.userId ?? null;

    /**
     * ── 2. O plano do aceite é validado ANTES de decidir ──────────────────────
     * `planAcceptance` (domínio) recusa criar atividade sem agenda e convidar sem
     * e-mail. Validar depois de registrar a decisão deixaria a proposta aceita e o
     * organizador sem entender por que a atividade não nasceu.
     */
    const plan = planAcceptance({
      createActivity: input.createActivity !== null,
      inviteSpeaker: input.inviteSpeaker,
      activityType: input.createActivity?.activityType ?? null,
      startsAt: input.createActivity?.startsAt ?? null,
      endsAt: input.createActivity?.endsAt ?? null,
      speakerName,
      speakerEmail,
    });

    if (!plan.ok) {
      /**
       * O código do DOMÍNIO sobe inteiro (`MISSING_SCHEDULE`, `INVALID_SCHEDULE`,
       * `MISSING_EMAIL`). Achatar tudo em `INVALID_INPUT` faria a tela — e o teste —
       * perderem a diferença entre "falta a agenda" e "esta pessoa não tem e-mail":
       * duas correções diferentes, com a mesma mensagem de erro.
       */
      return { ok: false, code: plan.code, message: plan.message };
    }

    // ── 3. A decisão é do MOTOR DE AVALIAÇÃO (com o quórum dele) ───────────────
    const decision = await recordDecision({
      tenantId: input.tenantId,
      submissionId: input.submissionId,
      decidedById: input.actorId,
      decision: 'ACCEPTED',
      notes: input.notes ?? 'Aceite com preparação de programação (FASE 33).',
      overrideQuorum: true,
    });

    if (!decision.ok) {
      return { ok: false, code: 'INVALID_INPUT', message: decision.message, details: decision.details };
    }

    const warnings: string[] = [];

    // ── 4. Criar a atividade na programação ───────────────────────────────────
    let activityId: string | null = null;

    if (input.createActivity) {
      const proposalData = await withTenant(input.tenantId, (tx) =>
        tx.submission
          .findUniqueOrThrow({ where: { id: input.submissionId }, select: { proposalData: true } })
          .then((row) => (row.proposalData as Record<string, string | number>) ?? {}),
      );

      const workload = proposedWorkload(kind, proposalData);
      const slugBase = activityTitleFromProposal(context.title);

      const created = await saveActivity({
        tenantId: input.tenantId,
        actorId: input.actorId,
        eventId: context.event.id,
        slug: await uniqueActivitySlug(input.tenantId, context.event.id, slugBase),
        title: activityTitleFromProposal(context.title),
        description: context.abstract.slice(0, ACTIVITY_DESCRIPTION_MAX),
        type: input.createActivity.activityType as 'OTHER',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt: input.createActivity.startsAt,
        endsAt: input.createActivity.endsAt,
        workloadMinutes: workload,
        roomId: input.createActivity.roomId ?? null,
        capacity: input.createActivity.capacity ?? null,
        waitlistEnabled: false,
        requiresRegistration: input.createActivity.requiresRegistration ?? true,
      });

      if (!created.ok) {
        /**
         * A decisão JÁ foi registrada e não se desfaz: a proposta está aceita, e o
         * que falhou foi a montagem da grade (conflito de sala, por exemplo). O
         * organizador recebe o motivo e cria a atividade pela tela de programação —
         * recusar o aceite inteiro por causa da agenda seria pior.
         */
        warnings.push(`A proposta foi aceita, mas a atividade não foi criada: ${created.message}`);
      } else {
        activityId = created.activityId;
      }
    }

    // ── 5. Convidar o proponente como palestrante ─────────────────────────────
    let speakerProfileId: string | null = null;
    let inviteToken: string | null = null;
    let inviteSent = false;

    if (input.inviteSpeaker && speakerName && speakerEmail) {
      const profile = await saveSpeakerProfile({
        tenantId: input.tenantId,
        actorId: input.actorId,
        name: speakerName,
        email: speakerEmail,
        institution: author?.institution ?? author?.guestInstitution ?? null,
        bio: typeof context.abstract === 'string' ? context.abstract.slice(0, 600) : null,
        isPublic: false,
      });

      if (!profile.ok) {
        warnings.push(`O convite não foi gerado: ${profile.message}`);
      } else {
        speakerProfileId = profile.speakerProfileId;
        inviteToken = profile.inviteToken;

        // Sem atividade não há vínculo a criar — o convite fica pendente e o
        // vínculo acontece na tela de palestrantes, quando a atividade existir.
        if (activityId) {
          const linked = await linkSpeakerToActivity({
            tenantId: input.tenantId,
            actorId: input.actorId,
            activityId,
            speakerProfileId: profile.speakerProfileId,
            roleTitle: PROPOSAL_KIND_LABELS[kind],
            workloadMinutes: null,
          });

          if (!linked.ok) warnings.push(`O palestrante não foi vinculado à atividade: ${linked.message}`);
        } else {
          warnings.push(
            'O convite foi gerado, mas o palestrante ainda não está vinculado a uma atividade — crie a atividade e vincule na tela de palestrantes.',
          );
        }

        /**
         * ── O E-MAIL DO CONVITE (quita a dívida E25) ───────────────────────────
         * Até esta fase o convite existia como TOKEN e nunca era enviado: o
         * organizador precisava copiar o link e mandar por fora. O template
         * `SPEAKER_INVITATION` fecha isso, e o link leva ao portal.
         */
        if (inviteToken) {
          const expiresAt = new Date(Date.now() + INVITE_VALID_DAYS * 86_400_000);
          const inviteUrl = new URL(
            tenantPath(input.tenantSlug, '/palestrante/convite'),
            process.env.APP_URL ?? 'http://localhost:3000',
          );
          inviteUrl.searchParams.set('codigo', inviteToken);

          const queued = await queueEmail({
            tenantId: input.tenantId,
            to: speakerEmail,
            toUserId: speakerUserId,
            template: 'SPEAKER_INVITATION',
            brandName: context.event.title,
            dedupeKey: `speaker-invitation-${profile.speakerProfileId}-${expiresAt.toISOString().slice(0, 10)}`,
            createdById: input.actorId,
            payload: {
              recipientName: speakerName,
              eventTitle: context.event.title,
              activityTitle: activityId ? activityTitleFromProposal(context.title) : null,
              roleLabel: PROPOSAL_KIND_LABELS[kind],
              inviteUrl: inviteUrl.toString(),
              expiresInDays: INVITE_VALID_DAYS,
              startsAtLabel: input.createActivity
                ? formatZonedDateTime(input.createActivity.startsAt, context.event.timezone)
                : null,
            },
          });

          inviteSent = queued.ok;
          if (!queued.ok) warnings.push(`O convite foi gerado, mas o e-mail não saiu: ${queued.message}`);
        }
      }
    }

    await withTenant(input.tenantId, (tx) =>
      recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'proposalAcceptance',
          entityId: input.submissionId,
          changes: {
            chamada: { from: null, to: context.call!.title },
            atividade: { from: null, to: activityId ?? 'não criada' },
            convite: { from: null, to: speakerProfileId ? (inviteSent ? 'enviado' : 'gerado') : 'não solicitado' },
          },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      ),
    );

    return {
      ok: true,
      status: decision.status,
      finalScore: decision.finalScore,
      activityId,
      speakerProfileId,
      inviteToken,
      inviteSent,
      warnings,
    };
  } catch (error) {
    console.error(`[proposals] falha no aceite da proposta: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível registrar o aceite.' };
  }
}

/**
 * O que o painel precisa saber ANTES de aceitar (FASE 33).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É UMA LEITURA PRÓPRIA, E NÃO CAMPOS DO PAINEL DO COMITÊ
 * ─────────────────────────────────────────────────────────────────────────────
 *  A submissão de ARTIGO e a proposta de CHAMADA compartilham a mesma tabela e o
 *  mesmo painel de comitê. O que só a proposta tem é a chamada por trás dela — e é
 *  dela que saem o tipo da atividade, a carga horária que o proponente declarou e o
 *  título sugerido. Devolver `null` para a submissão sem chamada é o que permite ao
 *  painel dizer "este protocolo não veio de uma chamada de propostas" em vez de
 *  oferecer um aceite que criaria uma atividade sem tipo.
 */
export interface AcceptanceContext {
  kind: ProposalKind;
  kindLabel: string;
  callTitle: string;
  /** Tipo de atividade sugerido pelo tipo da proposta (o organizador pode trocar). */
  activityType: string;
  /** Carga horária declarada na proposta, quando ela pediu uma. */
  workloadMinutes: number;
  /** Carga horária dos campos do tipo, para o formulário não perguntar de novo. */
  proposedTitle: string;
  authorName: string | null;
  authorEmail: string | null;
  eventId: string;
  eventSlug: string;
  eventTimeZone: string;
  /**
   * Situação ATUAL da proposta e quando a decisão foi registrada (nulo = ainda sem
   * decisão). O painel precisa disso para, depois do aceite, continuar dizendo o que
   * aconteceu em vez de simplesmente desaparecer (armadilha 76).
   */
  status: string;
  decidedAt: Date | null;
}

export async function getAcceptanceContext(input: {
  tenantId: string;
  submissionId: string;
}): Promise<ProposalResult<{ context: AcceptanceContext | null }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, tenantId: input.tenantId, deletedAt: null },
        select: {
          title: true,
          proposalData: true,
          status: true,
          decisionAt: true,
          call: { select: { kind: true, title: true } },
          event: { select: { id: true, slug: true, timezone: true } },
          authors: {
            orderBy: { authorOrder: 'asc' },
            take: 1,
            select: {
              guestName: true,
              guestEmail: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      });

      if (!submission) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Proposta não encontrada.' };
      }

      // Sem chamada não há protocolo de aceite: é uma submissão de artigo comum.
      if (!submission.call) return { ok: true as const, context: null };

      const kind = submission.call.kind as ProposalKind;
      const author = submission.authors[0];
      const data = (submission.proposalData ?? {}) as Record<string, string | number>;

      return {
        ok: true as const,
        context: {
          kind,
          kindLabel: PROPOSAL_KIND_LABELS[kind],
          callTitle: submission.call.title,
          activityType: PROPOSAL_KIND_ACTIVITY_TYPE[kind],
          workloadMinutes: proposedWorkload(kind, data),
          proposedTitle: activityTitleFromProposal(submission.title),
          authorName: author?.user?.name ?? author?.guestName ?? null,
          authorEmail: author?.user?.email ?? author?.guestEmail ?? null,
          eventId: submission.event.id,
          eventSlug: submission.event.slug,
          eventTimeZone: submission.event.timezone,
          status: submission.status,
          decidedAt: submission.decisionAt,
        },
      };
    });
  } catch (error) {
    console.error(`[proposals] falha ao carregar o contexto do aceite: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar a proposta.' };
  }
}

/**
 * Slug único para a atividade criada a partir da proposta.
 *
 * A atividade tem `@@unique([eventId, slug])`: duas propostas com o mesmo título
 * (acontece — "Minicurso de Rust" em duas edições do evento, ou dois proponentes com
 * a mesma ideia) colidiriam. O sufixo numérico é a resposta, e ele é calculado AQUI,
 * antes de chamar `saveActivity`, porque o serviço de atividade não inventa slug.
 */
async function uniqueActivitySlug(tenantId: string, eventId: string, title: string): Promise<string> {
  const base =
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'atividade';

  return withTenant(tenantId, async (tx) => {
    const existing = await tx.activity.findMany({
      where: { tenantId, eventId, slug: { startsWith: base }, deletedAt: null },
      select: { slug: true },
    });

    if (!existing.some((row) => row.slug === base)) return base;

    for (let attempt = 2; attempt < 50; attempt += 1) {
      const candidate = `${base}-${attempt}`;
      if (!existing.some((row) => row.slug === candidate)) return candidate;
    }

    return `${base}-${Date.now().toString(36)}`;
  });
}

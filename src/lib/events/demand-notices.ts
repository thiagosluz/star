/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Avisos das demandas internas (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM MÓDULO SÓ DELES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os quatro avisos nascem em três lugares diferentes: a ATRIBUIÇÃO (criar demanda
 *  e editar responsáveis), o COMENTÁRIO com menção e a VARREDURA de prazos. Se cada
 *  um montasse o próprio texto, o e-mail e a mensagem da caixa de entrada diriam
 *  coisas diferentes sobre a mesma demanda — e o defeito apareceria no dia do
 *  evento, com gente achando que não era com ela.
 *
 *  Mesma regra da FASE 32/34: **a mensagem é o FATO e o e-mail é consequência**. O
 *  aviso nasce em `participant_messages` (a caixa de entrada) e o e-mail entra no
 *  outbox com a MESMA `dedupeKey` — a repetição do job não duplica a comunicação, e
 *  o aviso chega mesmo com o provedor fora.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CHAVE DO AVISO CARREGA O FATO, NÃO O MOMENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada aviso deriva a `dedupeKey` da LINHA que o originou: a atribuição usa o
 *  instante da própria linha de responsável (re-atribuir depois gera linha nova, e
 *  portanto aviso novo); a menção usa o id da menção; os avisos de prazo usam o DIA
 *  local do evento (um aviso por dia, não um por passada da rotina, que roda de hora
 *  em hora).
 *
 *  NADA AQUI LANÇA (invariante 8): falha de e-mail não desfaz um cartão movido.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { deliverNotice, noticeFailure, type NoticeOutcome } from '@/lib/communication/notice-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { daysLate, dueDayLabel, localDayKey, priorityLabel } from '@/domain/events/demand-rules';

/**
 * O contrato do aviso vem do módulo compartilhado (`notice-service`) e é
 * REEXPORTADO aqui porque este arquivo é o import de quem chama os avisos das
 * demandas — duas definições da mesma forma divergiriam.
 */
export type { NoticeOutcome };

const FAILED = noticeFailure;

interface DemandNoticeContext {
  demandId: string;
  demandTitle: string;
  priorityLabel: string;
  dueAt: Date | null;
  teamName: string | null;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  timeZone: string;
  demandUrl: string;
}

async function loadDemandContext(
  tenantId: string,
  demandId: string,
): Promise<DemandNoticeContext | null> {
  return withTenant(tenantId, async (tx) => {
    const demand = await tx.demand.findFirst({
      where: { id: demandId, tenantId },
      select: {
        id: true,
        title: true,
        priority: true,
        dueAt: true,
        team: { select: { name: true } },
        event: { select: { id: true, title: true, slug: true, timezone: true } },
        tenant: { select: { slug: true } },
      },
    });

    if (!demand) return null;

    return {
      demandId: demand.id,
      demandTitle: demand.title,
      priorityLabel: priorityLabel(demand.priority),
      dueAt: demand.dueAt,
      teamName: demand.team?.name ?? null,
      eventId: demand.event.id,
      eventTitle: demand.event.title,
      eventSlug: demand.event.slug,
      timeZone: demand.event.timezone,
      demandUrl: tenantPath(
        demand.tenant.slug,
        `/administracao/eventos/${demand.event.id}/demandas/${demand.id}`,
      ),
    };
  });
}

interface Recipient {
  id: string;
  name: string;
  email: string;
}

async function loadRecipient(tenantId: string, userId: string): Promise<Recipient | null> {
  return withTenant(tenantId, async (tx) =>
    tx.user.findFirst({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    }),
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  1. Você ficou responsável
// ───────────────────────────────────────────────────────────────────────────────
export async function notifyDemandAssigned(input: {
  tenantId: string;
  demandId: string;
  userId: string;
  actorId: string;
}): Promise<NoticeOutcome> {
  try {
    const context = await loadDemandContext(input.tenantId, input.demandId);
    if (!context) return FAILED('Demanda não encontrada para avisar.');

    const recipient = await loadRecipient(input.tenantId, input.userId);
    if (!recipient) return FAILED('Responsável sem conta para avisar.');

    const assignedAt = await withTenant(input.tenantId, async (tx) => {
      const row = await tx.demandAssignee.findFirst({
        where: { tenantId: input.tenantId, demandId: input.demandId, userId: input.userId },
        select: { createdAt: true },
      });

      const actor = await tx.user.findFirst({
        where: { id: input.actorId },
        select: { name: true },
      });

      return { createdAt: row?.createdAt ?? new Date(), actorName: actor?.name ?? null };
    });

    const dueAtLabel = dueDayLabel(context.dueAt, context.timeZone);

    return deliverNotice({
      tenantId: input.tenantId,
      userId: recipient.id,
      eventId: context.eventId,
      recipientEmail: recipient.email,
      /** O instante da PRÓPRIA linha de responsável: reatribuir gera outro aviso. */
      dedupeKey: `demand-assigned-${input.demandId}-${input.userId}-${assignedAt.createdAt.getTime()}`,
      subject: `Você ficou com: ${context.demandTitle}`,
      body: [
        `Você ficou responsável por "${context.demandTitle}" (${context.eventTitle}).`,
        `Prioridade: ${context.priorityLabel}`,
        ...(context.teamName ? [`Equipe: ${context.teamName}`] : []),
        `Prazo: ${dueAtLabel ?? 'sem prazo'}`,
        ...(assignedAt.actorName ? [`Atribuída por: ${assignedAt.actorName}`] : []),
        `Abra a demanda: ${context.demandUrl}`,
      ].join('\n\n'),
      template: 'DEMAND_ASSIGNED',
      payload: {
        recipientName: recipient.name,
        demandTitle: context.demandTitle,
        eventTitle: context.eventTitle,
        teamName: context.teamName,
        priorityLabel: context.priorityLabel,
        dueAtLabel,
        assignedByName: assignedAt.actorName,
        demandUrl: context.demandUrl,
      },
    });
  } catch (error) {
    console.error(`[demandas] falha ao avisar atribuição: ${errorMessage(error)}`);
    return FAILED(errorMessage(error));
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  2. Você foi mencionado num comentário
// ───────────────────────────────────────────────────────────────────────────────
export async function notifyDemandMention(input: {
  tenantId: string;
  commentId: string;
  userId: string;
  actorId: string;
}): Promise<NoticeOutcome> {
  try {
    const comment = await withTenant(input.tenantId, async (tx) =>
      tx.demandComment.findFirst({
        where: { id: input.commentId, tenantId: input.tenantId },
        select: {
          id: true,
          body: true,
          demandId: true,
          author: { select: { name: true } },
        },
      }),
    );

    if (!comment) return FAILED('Comentário não encontrado para avisar.');

    const context = await loadDemandContext(input.tenantId, comment.demandId);
    if (!context) return FAILED('Demanda não encontrada para avisar.');

    const recipient = await loadRecipient(input.tenantId, input.userId);
    if (!recipient) return FAILED('Mencionado sem conta para avisar.');

    /**
     * Marca a menção como avisada. É registro, não trava: quem impede o segundo
     * e-mail é a `dedupeKey` do outbox (única), e uma falha aqui não pode impedir o
     * aviso de sair.
     */
    await withTenant(input.tenantId, async (tx) => {
      await tx.demandMention.updateMany({
        where: { tenantId: input.tenantId, commentId: comment.id, userId: input.userId },
        data: { notifiedAt: new Date() },
      });
    });

    return deliverNotice({
      tenantId: input.tenantId,
      userId: recipient.id,
      eventId: context.eventId,
      recipientEmail: recipient.email,
      /** O id da menção: a mesma menção nunca vira dois avisos. */
      dedupeKey: `demand-mention-${comment.id}-${input.userId}`,
      subject: `${comment.author.name} mencionou você em: ${context.demandTitle}`,
      body: [
        `${comment.author.name} mencionou você na demanda "${context.demandTitle}" (${context.eventTitle}).`,
        `${comment.author.name} escreveu: ${comment.body}`,
        `Responda no quadro: ${context.demandUrl}`,
      ].join('\n\n'),
      template: 'DEMAND_MENTION',
      payload: {
        recipientName: recipient.name,
        demandTitle: context.demandTitle,
        eventTitle: context.eventTitle,
        authorName: comment.author.name,
        comment: comment.body.slice(0, 300),
        demandUrl: context.demandUrl,
      },
    });
  } catch (error) {
    console.error(`[demandas] falha ao avisar menção: ${errorMessage(error)}`);
    return FAILED(errorMessage(error));
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  3 e 4. O prazo chegando e o prazo vencido
// ───────────────────────────────────────────────────────────────────────────────
export async function notifyDemandDueSoon(input: {
  tenantId: string;
  demandId: string;
  userId: string;
  dayKey: string;
}): Promise<NoticeOutcome> {
  try {
    const context = await loadDemandContext(input.tenantId, input.demandId);
    if (!context?.dueAt) return FAILED('Demanda sem prazo para avisar.');

    const recipient = await loadRecipient(input.tenantId, input.userId);
    if (!recipient) return FAILED('Responsável sem conta para avisar.');

    const dueAtLabel = dueDayLabel(context.dueAt, context.timeZone) ?? '';

    return deliverNotice({
      tenantId: input.tenantId,
      userId: recipient.id,
      eventId: context.eventId,
      recipientEmail: recipient.email,
      /** Um aviso por dia e por pessoa: a rotina roda de hora em hora. */
      dedupeKey: `demand-due-soon-${input.demandId}-${input.userId}-${input.dayKey}`,
      subject: `Prazo amanhã: ${context.demandTitle}`,
      body: [
        `A demanda "${context.demandTitle}" (${context.eventTitle}) vence em ${dueAtLabel}.`,
        `Abra a demanda: ${context.demandUrl}`,
      ].join('\n\n'),
      template: 'DEMAND_DUE_SOON',
      payload: {
        recipientName: recipient.name,
        demandTitle: context.demandTitle,
        eventTitle: context.eventTitle,
        dueAtLabel,
        demandUrl: context.demandUrl,
      },
    });
  } catch (error) {
    console.error(`[demandas] falha ao avisar prazo próximo: ${errorMessage(error)}`);
    return FAILED(errorMessage(error));
  }
}

export async function notifyDemandOverdue(input: {
  tenantId: string;
  demandId: string;
  userId: string;
  dayKey: string;
}): Promise<NoticeOutcome> {
  try {
    const context = await loadDemandContext(input.tenantId, input.demandId);
    if (!context?.dueAt) return FAILED('Demanda sem prazo para avisar.');

    const recipient = await loadRecipient(input.tenantId, input.userId);
    if (!recipient) return FAILED('Responsável sem conta para avisar.');

    const late = daysLate({ dueAt: context.dueAt, completedAt: null }, new Date(), context.timeZone);
    const dueAtLabel = dueDayLabel(context.dueAt, context.timeZone) ?? '';

    return deliverNotice({
      tenantId: input.tenantId,
      userId: recipient.id,
      eventId: context.eventId,
      recipientEmail: recipient.email,
      dedupeKey: `demand-overdue-${input.demandId}-${input.userId}-${input.dayKey}`,
      subject: `Demanda atrasada: ${context.demandTitle}`,
      body: [
        `A demanda "${context.demandTitle}" (${context.eventTitle}) venceu em ${dueAtLabel} e continua aberta.`,
        `Resolva ou comente o que está travando: ${context.demandUrl}`,
      ].join('\n\n'),
      template: 'DEMAND_OVERDUE',
      payload: {
        recipientName: recipient.name,
        demandTitle: context.demandTitle,
        eventTitle: context.eventTitle,
        dueAtLabel,
        daysLate: Math.max(late, 1),
        demandUrl: context.demandUrl,
      },
    });
  } catch (error) {
    console.error(`[demandas] falha ao avisar atraso: ${errorMessage(error)}`);
    return FAILED(errorMessage(error));
  }
}

/** O dia local do evento — a chave dos avisos de prazo. */
export function noticeDayKey(now: Date, timeZone: string): string {
  return localDayKey(now, timeZone);
}

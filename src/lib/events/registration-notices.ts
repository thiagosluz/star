/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Avisos da confirmação de vaga (FASE 34)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM MÓDULO SÓ SEUS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cinco avisos nascem em três lugares diferentes: a INSCRIÇÃO (retém a vaga), a
 *  varredura de LEMBRETE e a varredura de VENCIMENTO (que também avisa quem entrou
 *  pela lista de espera). Se cada um montasse o próprio texto, o e-mail do prazo e a
 *  mensagem da caixa de entrada diriam coisas diferentes sobre a mesma vaga — e o
 *  defeito só apareceria no dia do evento, com gente na fila errada.
 *
 *  Ele é separado de `registration-service` e de `confirmation-service` de propósito:
 *  os dois precisam avisar, e um módulo de avisos que importasse qualquer um deles
 *  fecharia um ciclo de importação (`registration` → avisos → `registration`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MENSAGEM É O FATO; O E-MAIL É CONSEQUÊNCIA (mesma regra da FASE 32)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O aviso nasce em `participant_messages` — a caixa de entrada da pessoa, dentro da
 *  plataforma — e o e-mail é ENFILEIRADO no outbox com a MESMA `dedupeKey`. Assim o
 *  aviso chega mesmo com o provedor de e-mail fora, e o reenvio do job não duplica.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NADA AQUI LANÇA (INVARIANTE 8)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Estes avisos são disparados DEPOIS do commit de quem os provocou (a inscrição, a
 *  confirmação, a varredura) e falham em silêncio: uma falha de e-mail não pode
 *  desfazer uma vaga confirmada nem impedir a liberação de uma vencida.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { queueEmail } from '@/lib/communication/email-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  confirmationDeadlineLabel,
  parseConfirmationRequirements,
  requirementLabel,
} from '@/domain/events/confirmation-rules';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import type { EmailPayloads, EmailTemplateKey } from '@/domain/communication/email-templates';

export interface NoticeOutcome {
  ok: boolean;
  /** `true` quando o e-mail entrou na fila (o aviso já está na caixa de entrada). */
  emailQueued: boolean;
  /** Preenchido quando algo falhou — o chamador loga, não trata. */
  message: string | null;
}

const FAILED = (message: string): NoticeOutcome => ({ ok: false, emailQueued: false, message });

/**
 * O que os cinco avisos precisam saber, lido uma vez.
 *
 * A leitura roda no CONTEXTO DA INSTITUIÇÃO (`withTenant`): o aviso é sobre uma vaga
 * de um evento dela, e nem a pessoa nem o evento podem ser lidos fora dele.
 */
interface NoticeContext {
  tenantSlug: string;
  registrationId: string;
  eventId: string;
  eventTitle: string;
  eventTimeZone: string;
  activityTitle: string;
  activityStartsAt: Date;
  recipientName: string;
  recipientEmail: string;
  /** O destinatário — a caixa de entrada é dele. */
  userId: string;
  dueAt: Date | null;
  requirements: string[];
  place: string | null;
  instructions: string | null;
}

async function loadNoticeContext(
  tenantId: string,
  registrationId: string,
): Promise<NoticeContext | null> {
  return withTenant(tenantId, async (tx) => {
    const registration = await tx.registration.findFirst({
      where: { id: registrationId, tenantId, deletedAt: null },
      select: {
        confirmationDueAt: true,
        eventId: true,
        user: { select: { id: true, name: true, email: true } },
        event: { select: { title: true, timezone: true } },
        activity: {
          select: {
            title: true,
            startsAt: true,
            confirmationRequirements: true,
            confirmationPlace: true,
            confirmationInstructions: true,
          },
        },
      },
    });

    if (!registration?.activity) return null;

    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { slug: true },
    });

    return {
      tenantSlug: tenant.slug,
      registrationId,
      eventId: registration.eventId,
      eventTitle: registration.event.title,
      eventTimeZone: registration.event.timezone,
      activityTitle: registration.activity.title,
      activityStartsAt: registration.activity.startsAt,
      recipientName: registration.user.name,
      recipientEmail: registration.user.email,
      userId: registration.user.id,
      dueAt: registration.confirmationDueAt,
      requirements: parseConfirmationRequirements(
        registration.activity.confirmationRequirements,
      ).map(requirementLabel),
      place: registration.activity.confirmationPlace,
      instructions: registration.activity.confirmationInstructions,
    } satisfies NoticeContext;
  });
}

/**
 * Grava o aviso na caixa de entrada e enfileira o e-mail.
 *
 * `skipDuplicates` na `dedupeKey` é o que torna os cinco avisos idempotentes: a
 * varredura roda de hora em hora e a promoção da lista de espera pode ser tentada
 * duas vezes sob concorrência. Repetir o mesmo FATO não vira duas mensagens — a
 * mesma regra da FASE 15.
 */
async function deliverNotice<K extends EmailTemplateKey>(input: {
  tenantId: string;
  userId: string;
  eventId: string;
  recipientEmail: string;
  dedupeKey: string;
  subject: string;
  body: string;
  template: K;
  payload: EmailPayloads[K];
}): Promise<NoticeOutcome> {
  try {
    const context = await withTenant(input.tenantId, async (tx) => {
      await tx.participantMessage.createMany({
        data: [
          {
            tenantId: input.tenantId,
            userId: input.userId,
            eventId: input.eventId,
            subject: input.subject.slice(0, 140),
            body: input.body.slice(0, 2000),
            dedupeKey: input.dedupeKey,
            /**
             * `sentById` NULO: não há pessoa que enviou — o aviso é do SISTEMA, no
             * prazo que a organização escolheu. Atribuí-lo a alguém seria inventar
             * autoria; a tela da caixa de entrada mostra "automático" para nulo.
             */
            sentById: null,
            sentAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });

      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.tenantId },
        select: { name: true },
      });

      return tenant.name;
    });

    const queued = await queueEmail({
      tenantId: input.tenantId,
      to: input.recipientEmail,
      toUserId: input.userId,
      template: input.template,
      brandName: context,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
    });

    return {
      ok: true,
      emailQueued: queued.ok,
      message: queued.ok ? null : queued.message,
    };
  } catch (error) {
    console.error(`[confirmacao] falha ao avisar (${input.dedupeKey}): ${errorMessage(error)}`);

    return FAILED(errorMessage(error));
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  1. A vaga foi retida — confirme até o prazo
// ───────────────────────────────────────────────────────────────────────────────
export async function notifyConfirmationRequired(input: {
  tenantId: string;
  registrationId: string;
}): Promise<NoticeOutcome> {
  const context = await loadNoticeContext(input.tenantId, input.registrationId);

  if (!context?.dueAt) return FAILED('Inscrição sem prazo de confirmação.');

  const deadlineLabel = confirmationDeadlineLabel(context.dueAt, context.eventTimeZone);
  const registrationsUrl = tenantPath(context.tenantSlug, '/minhas-inscricoes');
  const requirements = context.requirements.map((item) => `- ${item}`).join('\n');

  return deliverNotice({
    tenantId: input.tenantId,
    userId: context.userId,
    eventId: context.eventId,
    recipientEmail: context.recipientEmail,
    dedupeKey: `registration-pending-${input.registrationId}`,
    subject: `Confirme sua vaga em ${context.activityTitle}`,
    body: [
      `Sua vaga em "${context.activityTitle}" (${context.eventTitle}) está reservada, mas ainda NÃO confirmada.`,
      `Confirme até ${deadlineLabel}.`,
      ...(context.place ? [`Onde confirmar: ${context.place}.`] : []),
      ...(requirements ? [`O que é preciso:\n${requirements}`] : []),
      'Se a confirmação não acontecer até o prazo, a vaga é liberada automaticamente.',
      `Suas inscrições: ${registrationsUrl}`,
    ].join('\n\n'),
    template: 'REGISTRATION_PENDING',
    payload: {
      recipientName: context.recipientName,
      eventTitle: context.eventTitle,
      activityTitle: context.activityTitle,
      deadlineLabel,
      requirements: context.requirements,
      place: context.place,
      instructions: context.instructions,
      registrationsUrl,
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  2. Falta pouco para o prazo
// ───────────────────────────────────────────────────────────────────────────────
export async function notifyConfirmationDueSoon(input: {
  tenantId: string;
  registrationId: string;
  countdownLabel: string;
}): Promise<NoticeOutcome> {
  const context = await loadNoticeContext(input.tenantId, input.registrationId);

  if (!context?.dueAt) return FAILED('Inscrição sem prazo de confirmação.');

  const deadlineLabel = confirmationDeadlineLabel(context.dueAt, context.eventTimeZone);
  const registrationsUrl = tenantPath(context.tenantSlug, '/minhas-inscricoes');
  const requirements = context.requirements.map((item) => `- ${item}`).join('\n');

  return deliverNotice({
    tenantId: input.tenantId,
    userId: context.userId,
    eventId: context.eventId,
    recipientEmail: context.recipientEmail,
    dedupeKey: `registration-due-soon-${input.registrationId}`,
    subject: `${input.countdownLabel} para confirmar sua vaga em ${context.activityTitle}`,
    body: [
      `${input.countdownLabel} para confirmar sua vaga em "${context.activityTitle}" (${context.eventTitle}).`,
      `O prazo termina em ${deadlineLabel}.`,
      ...(context.place ? [`Onde confirmar: ${context.place}.`] : []),
      ...(requirements ? [`O que é preciso:\n${requirements}`] : []),
      'Depois do prazo a vaga é liberada automaticamente.',
      `Suas inscrições: ${registrationsUrl}`,
    ].join('\n\n'),
    template: 'REGISTRATION_DUE_SOON',
    payload: {
      recipientName: context.recipientName,
      eventTitle: context.eventTitle,
      activityTitle: context.activityTitle,
      deadlineLabel,
      countdownLabel: input.countdownLabel,
      requirements: context.requirements,
      place: context.place,
      registrationsUrl,
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  3. A equipe confirmou
// ───────────────────────────────────────────────────────────────────────────────
export async function notifyRegistrationConfirmed(input: {
  tenantId: string;
  registrationId: string;
}): Promise<NoticeOutcome> {
  const context = await loadNoticeContext(input.tenantId, input.registrationId);

  if (!context) return FAILED('Inscrição sem atividade.');

  const registrationsUrl = tenantPath(context.tenantSlug, '/minhas-inscricoes');
  const startsAtLabel = formatZonedDateTime(context.activityStartsAt, context.eventTimeZone);

  return deliverNotice({
    tenantId: input.tenantId,
    userId: context.userId,
    eventId: context.eventId,
    recipientEmail: context.recipientEmail,
    dedupeKey: `registration-confirmed-${input.registrationId}`,
    subject: `Vaga confirmada: ${context.activityTitle}`,
    body: [
      `A organização confirmou a sua vaga em "${context.activityTitle}" (${context.eventTitle}).`,
      `Data e horário: ${startsAtLabel}.`,
      'Guarde este aviso como comprovante da confirmação.',
      `Suas inscrições: ${registrationsUrl}`,
    ].join('\n\n'),
    template: 'REGISTRATION_CONFIRMED',
    payload: {
      recipientName: context.recipientName,
      eventTitle: context.eventTitle,
      activityTitle: context.activityTitle,
      deadlineLabel: context.dueAt
        ? confirmationDeadlineLabel(context.dueAt, context.eventTimeZone)
        : null,
      startsAtLabel,
      registrationsUrl,
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  4. O prazo venceu e a vaga foi liberada
// ───────────────────────────────────────────────────────────────────────────────
export async function notifyRegistrationReleased(input: {
  tenantId: string;
  registrationId: string;
}): Promise<NoticeOutcome> {
  const context = await loadNoticeContext(input.tenantId, input.registrationId);

  if (!context) return FAILED('Inscrição sem atividade.');

  const deadlineLabel = context.dueAt
    ? confirmationDeadlineLabel(context.dueAt, context.eventTimeZone)
    : 'o prazo definido';
  const registrationsUrl = tenantPath(context.tenantSlug, '/minhas-inscricoes');

  return deliverNotice({
    tenantId: input.tenantId,
    userId: context.userId,
    eventId: context.eventId,
    recipientEmail: context.recipientEmail,
    dedupeKey: `registration-released-${input.registrationId}`,
    subject: `Sua vaga em ${context.activityTitle} foi liberada`,
    body: [
      `A confirmação da sua vaga em "${context.activityTitle}" (${context.eventTitle}) não foi registrada até ${deadlineLabel}.`,
      'Por isso a vaga foi liberada automaticamente para quem estava na lista de espera — foi o prazo que a organização definiu para todo mundo.',
      'Se ainda houver vagas, você pode se inscrever de novo pela página do evento.',
      `Suas inscrições: ${registrationsUrl}`,
    ].join('\n\n'),
    template: 'REGISTRATION_RELEASED',
    payload: {
      recipientName: context.recipientName,
      eventTitle: context.eventTitle,
      activityTitle: context.activityTitle,
      deadlineLabel,
      registrationsUrl,
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  5. Quem esperava foi promovido
// ───────────────────────────────────────────────────────────────────────────────
export async function notifyWaitlistPromoted(input: {
  tenantId: string;
  registrationId: string;
}): Promise<NoticeOutcome> {
  const context = await loadNoticeContext(input.tenantId, input.registrationId);

  if (!context) return FAILED('Inscrição sem atividade.');

  const startsAtLabel = formatZonedDateTime(context.activityStartsAt, context.eventTimeZone);
  const registrationsUrl = tenantPath(context.tenantSlug, '/minhas-inscricoes');

  return deliverNotice({
    tenantId: input.tenantId,
    userId: context.userId,
    eventId: context.eventId,
    recipientEmail: context.recipientEmail,
    dedupeKey: `waitlist-promoted-${input.registrationId}`,
    subject: `Você entrou: ${context.activityTitle}`,
    body: [
      `Abriu uma vaga em "${context.activityTitle}" (${context.eventTitle}) e você era o próximo da lista de espera.`,
      `Data e horário: ${startsAtLabel}.`,
      'A sua inscrição já está confirmada — não é preciso fazer nada.',
      `Suas inscrições: ${registrationsUrl}`,
    ].join('\n\n'),
    template: 'WAITLIST_PROMOTED',
    payload: {
      recipientName: context.recipientName,
      eventTitle: context.eventTitle,
      activityTitle: context.activityTitle,
      startsAtLabel,
      registrationsUrl,
    },
  });
}

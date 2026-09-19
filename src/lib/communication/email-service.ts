/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SERVIÇO DE E-MAIL — outbox + entrega
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O OUTBOX É O REGISTRO, E ELE NASCE ANTES DO ENVIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ordem é sempre: RENDERIZA → GRAVA (QUEUED) → ENFILEIRA → entrega. Isso resolve
 *  três perguntas de uma vez:
 *
 *    • "o que saiu?" — a linha guarda o HTML que foi enviado, não o template atual;
 *    • "e se o Redis cair?" — o chamador entrega na hora, e a linha continua sendo
 *      a prova de que a mensagem existiu;
 *    • "e se o gatilho rodar duas vezes?" — `dedupeKey` tem índice único no banco,
 *      então o mesmo fato não gera duas mensagens nem com dois cliques.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE SERVIÇO NUNCA LANÇA PARA O CHAMADOR DE NEGÓCIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele DEVOLVE falha. Quem dispara e-mail a partir de outro fluxo (conceder carta,
 *  emitir certificado, atribuir avaliação) trata o resultado como aviso, nunca como
 *  impedimento: comunicação é efeito colateral do fato acadêmico, não pré-requisito
 *  dele (invariante nº 8, a mesma regra da gamificação).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { logger } from '@/lib/observability/logger';
import { incCounter } from '@/lib/observability/metrics';
import {
  createPlatformEmail,
  findPlatformEmail,
  updatePlatformEmail,
} from '@/lib/platform/platform-mail';
import {
  isPlausibleEmailAddress,
  normalizeEmailAddress,
} from '@/domain/communication/email-rules';
import {
  renderEmail,
  type EmailPayloads,
  type EmailTemplateKey,
} from '@/domain/communication/email-templates';
import { sendEmail } from './mailer';
import { enqueueEmailDelivery } from './email-queue';

export type EmailServiceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: EmailFailureCode; message: string };

export type EmailFailureCode =
  | 'INVALID_RECIPIENT'
  | 'NOT_FOUND'
  | 'ALREADY_SENT'
  | 'PERSISTENCE'
  | 'INTERNAL';

function toFailure(scope: string, error: unknown): { ok: false; code: EmailFailureCode; message: string } {
  logger.error(`email: falha em ${scope}`, {
    error: error instanceof Error ? error.message : String(error),
  });

  return { ok: false, code: 'INTERNAL', message: 'Não foi possível preparar a mensagem.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Enfileiramento
// ───────────────────────────────────────────────────────────────────────────────
export interface QueueEmailInput<K extends EmailTemplateKey> {
  /** NULO = mensagem de plataforma (sem instituição no contexto). */
  tenantId: string | null;
  to: string;
  toUserId?: string | null;
  template: K;
  payload: EmailPayloads[K];
  /** Assinatura no topo do e-mail: a instituição, ou "EventFlow". */
  brandName: string;
  dedupeKey?: string | null;
  createdById?: string | null;
  /**
   * Entrega imediata quando a fila não está disponível (padrão `true`). Só o
   * chamador que JÁ está em contexto de fila (o worker) desliga isso.
   */
  deliverInlineWhenQueueDown?: boolean;
}

export interface QueueEmailOutput {
  emailMessageId: string | null;
  /** `true` quando o BullMQ aceitou o job; `false` quando a entrega foi imediata. */
  queued: boolean;
  delivered: boolean;
  /** `true` quando o `dedupeKey` já existia: o fato já tinha sido comunicado. */
  duplicate: boolean;
}

/**
 * Renderiza, grava e enfileira. Devolve o id da mensagem (nulo quando era
 * duplicata) — o chamador costuma ignorar o resultado, mas o teste e o operador
 * precisam dele.
 */
export async function queueEmail<K extends EmailTemplateKey>(
  input: QueueEmailInput<K>,
): Promise<EmailServiceResult<QueueEmailOutput>> {
  try {
    const to = normalizeEmailAddress(input.to);

    if (!isPlausibleEmailAddress(to)) {
      incCounter('email_skipped_invalid_recipient_total');
      return {
        ok: false,
        code: 'INVALID_RECIPIENT',
        message: 'Endereço de e-mail inválido para envio.',
      };
    }

    const rendered = renderEmail(input.template, input.payload, { brandName: input.brandName });
    const dedupeKey = input.dedupeKey ?? null;

    const emailMessageId = input.tenantId
      ? await insertTenantEmail({
          tenantId: input.tenantId,
          to,
          toUserId: input.toUserId ?? null,
          template: input.template,
          subject: rendered.subject,
          payload: input.payload as unknown as Record<string, unknown>,
          html: rendered.html,
          text: rendered.text,
          dedupeKey,
          createdById: input.createdById ?? null,
        })
      : await createPlatformEmail({
          to,
          toUserId: input.toUserId ?? null,
          template: input.template,
          subject: rendered.subject,
          payload: input.payload as unknown as Record<string, unknown>,
          html: rendered.html,
          text: rendered.text,
          dedupeKey,
        });

    /**
     * O índice único de `dedupeKey` é a garantia FINAL contra mensagem repetida: se
     * dois processos tentarem ao mesmo tempo, um insere e o outro cai aqui. Não é
     * erro — é a resposta "esse fato já foi comunicado".
     */
    const queued = await enqueueEmailDelivery({ emailMessageId, tenantId: input.tenantId });

    if (queued) return { ok: true, emailMessageId, queued: true, delivered: false, duplicate: false };

    if (input.deliverInlineWhenQueueDown === false) {
      return { ok: true, emailMessageId, queued: false, delivered: false, duplicate: false };
    }

    const delivery = await deliverEmail({ emailMessageId, tenantId: input.tenantId });

    return {
      ok: true,
      emailMessageId,
      queued: false,
      delivered: delivery.ok,
      duplicate: false,
    };
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error) === 'email_messages_dedupeKey_key') {
      incCounter('email_deduplicated_total');
      return { ok: true, emailMessageId: null, queued: false, delivered: false, duplicate: true };
    }

    return toFailure('queueEmail', error);
  }
}

interface InsertTenantEmailInput {
  tenantId: string;
  to: string;
  toUserId: string | null;
  template: string;
  subject: string;
  payload: Record<string, unknown>;
  html: string;
  text: string;
  dedupeKey: string | null;
  createdById: string | null;
}

async function insertTenantEmail(input: InsertTenantEmailInput): Promise<string> {
  const id = crypto.randomUUID();

  await withTenant(input.tenantId, (tx) =>
    tx.emailMessage.create({
      data: {
        id,
        tenantId: input.tenantId,
        to: input.to,
        toUserId: input.toUserId,
        template: input.template,
        subject: input.subject,
        payload: input.payload as unknown as object,
        html: input.html,
        text: input.text,
        status: 'QUEUED',
        dedupeKey: input.dedupeKey,
        createdById: input.createdById,
      },
      select: { id: true },
    }),
  );

  return id;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Entrega
// ───────────────────────────────────────────────────────────────────────────────
export interface DeliverEmailOutput {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  driver: string | null;
  providerId: string | null;
  retryable: boolean;
}

/**
 * Resultado da entrega. `RETRYABLE` é um código PRÓPRIO: significa "não saiu agora,
 * mas o motivo é transitório" — é o que o worker usa para decidir entre registrar a
 * falha e devolver o job para a fila com backoff.
 */
export type DeliverEmailResult =
  | ({ ok: true } & DeliverEmailOutput)
  | { ok: false; code: EmailFailureCode | 'RETRYABLE'; message: string; retryable: boolean };

/**
 * Entrega uma mensagem já registrada. Chamada pelo worker (e pelo caminho inline).
 *
 * O retorno diz se vale retentar; quem decide sobre a nova tentativa é o worker,
 * porque só ele tem o backoff do BullMQ.
 */
export async function deliverEmail(input: {
  emailMessageId: string;
  tenantId: string | null;
}): Promise<DeliverEmailResult> {
  try {
    const message = input.tenantId
      ? await loadTenantEmail(input.tenantId, input.emailMessageId)
      : await findPlatformEmail(input.emailMessageId);

    if (!message) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Mensagem não encontrada no outbox.',
        retryable: false,
      };
    }

    /**
     * Idempotência da entrega: mensagem já enviada não é reenviada por um job
     * duplicado. `FAILED` pode ser retentado (é o que o botão "reenviar" faz).
     */
    if (message.status === 'SENT' || message.status === 'SKIPPED') {
      return {
        ok: true,
        status: message.status === 'SENT' ? 'SENT' : 'SKIPPED',
        driver: null,
        providerId: null,
        retryable: false,
      };
    }

    const attempts = message.attempts + 1;
    const delivery = await sendEmail({
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      idempotencyKey: `email:${message.id}`,
    });

    if (delivery.ok) {
      await persistDelivery(input, {
        status: 'SENT',
        driver: delivery.driver,
        providerId: delivery.providerId,
        error: null,
        sentAt: new Date(),
        attempts,
      });

      incCounter('email_sent_total');
      return {
        ok: true,
        status: 'SENT',
        driver: delivery.driver,
        providerId: delivery.providerId,
        retryable: false,
      };
    }

    /**
     * Falha retentável fica em `QUEUED` de propósito: marcar como `FAILED` faria o
     * outbox dizer que desistiu quando o BullMQ ainda vai tentar de novo. O motivo
     * fica gravado desde já, para quem estiver olhando a tela agora.
     */
    await persistDelivery(input, {
      status: delivery.retryable ? 'QUEUED' : 'FAILED',
      driver: delivery.driver,
      providerId: null,
      error: delivery.message,
      sentAt: null,
      attempts,
    });

    incCounter(delivery.retryable ? 'email_delivery_retry_total' : 'email_delivery_failed_total');

    return {
      ok: false,
      code: delivery.retryable ? 'RETRYABLE' : 'INTERNAL',
      message: delivery.message,
      retryable: delivery.retryable,
    };
  } catch (error) {
    const failure = toFailure('deliverEmail', error);
    return { ...failure, retryable: false };
  }
}

async function loadTenantEmail(tenantId: string, id: string) {
  return withTenant(tenantId, (tx) =>
    tx.emailMessage.findFirst({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        to: true,
        subject: true,
        html: true,
        text: true,
        status: true,
        attempts: true,
      },
    }),
  );
}

async function persistDelivery(
  input: { emailMessageId: string; tenantId: string | null },
  data: {
    status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
    driver: string | null;
    providerId: string | null;
    error: string | null;
    sentAt: Date | null;
    attempts: number;
  },
): Promise<void> {
  if (!input.tenantId) {
    await updatePlatformEmail(input.emailMessageId, data);
    return;
  }

  await withTenant(input.tenantId, (tx) =>
    tx.emailMessage.update({ where: { id: input.emailMessageId }, data }),
  );
}

/**
 * Reenfileira uma mensagem que falhou (botão "tentar de novo" da caixa de saída).
 * O contador de tentativas NÃO é zerado: quantas vezes já se tentou é informação.
 */
export async function retryEmailMessage(input: {
  tenantId: string;
  emailMessageId: string;
}): Promise<EmailServiceResult<{ queued: boolean }>> {
  try {
    const updated = await withTenant(input.tenantId, (tx) =>
      tx.emailMessage.updateMany({
        where: { id: input.emailMessageId, status: { in: ['FAILED', 'QUEUED'] } },
        data: { status: 'QUEUED', error: null },
      }),
    );

    if (updated.count === 0) {
      return {
        ok: false,
        code: 'ALREADY_SENT',
        message: 'Só é possível reenviar mensagens que falharam ou ainda estão na fila.',
      };
    }

    const queued = await enqueueEmailDelivery({
      emailMessageId: input.emailMessageId,
      tenantId: input.tenantId,
    });

    if (!queued) {
      await deliverEmail({ emailMessageId: input.emailMessageId, tenantId: input.tenantId });
    }

    return { ok: true, queued };
  } catch (error) {
    return toFailure('retryEmailMessage', error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura (caixa de saída da instituição)
// ───────────────────────────────────────────────────────────────────────────────
export interface EmailOutboxRow {
  id: string;
  to: string;
  subject: string;
  template: string;
  status: string;
  driver: string | null;
  error: string | null;
  attempts: number;
  sentAt: Date | null;
  createdAt: Date;
}

export interface EmailOutboxSummary {
  queued: number;
  sent: number;
  failed: number;
}

/**
 * Lista a caixa de saída da instituição.
 *
 * A leitura é sob RLS: a instituição vê as PRÓPRIAS mensagens, e as de plataforma
 * (tenantId nulo) ficam invisíveis — o que é correto, porque são de outra natureza.
 */
export async function listEmailMessages(input: {
  tenantId: string;
  status?: string | null;
  limit?: number;
}): Promise<{ rows: EmailOutboxRow[]; summary: EmailOutboxSummary }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const statusFilter =
    input.status && ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'].includes(input.status)
      ? (input.status as 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED')
      : null;

  return withTenant(input.tenantId, async (tx) => {
    const [rows, grouped] = await Promise.all([
      tx.emailMessage.findMany({
        where: statusFilter ? { status: statusFilter } : {},
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          to: true,
          subject: true,
          template: true,
          status: true,
          driver: true,
          error: true,
          attempts: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      tx.emailMessage.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const summary: EmailOutboxSummary = { queued: 0, sent: 0, failed: 0 };

    for (const entry of grouped) {
      const count = entry._count._all;
      if (entry.status === 'QUEUED') summary.queued = count;
      if (entry.status === 'SENT') summary.sent = count;
      if (entry.status === 'FAILED') summary.failed = count;
    }

    return { rows, summary };
  });
}

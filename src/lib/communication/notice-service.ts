/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Aviso para uma pessoa: caixa de entrada + e-mail (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU UM MÓDULO COMPARTILHADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 32 (recado do participante) e a FASE 34 (confirmação de vaga) chegaram à
 *  MESMA regra por caminhos diferentes: **a mensagem é o FATO e o e-mail é
 *  consequência**. O aviso nasce em `participant_messages` e o e-mail é enfileirado
 *  no outbox com a MESMA `dedupeKey` — assim a pessoa é avisada mesmo com o provedor
 *  de e-mail fora, e repetir o job não duplica a comunicação.
 *
 *  A FASE 34 tinha a própria cópia dessa rotina dentro de `registration-notices.ts`.
 *  Quando a FASE 36 precisou avisar o PROPONENTE da decisão, a escolha era copiar de
 *  novo (duas cópias da mesma regra, que divergem na primeira manutenção —
 *  armadilha 55) ou extrair. Está extraído: quem quiser avisar alguém usa isto, e a
 *  ordem "grava o fato, enfileira a consequência" existe em um lugar só.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NADA AQUI LANÇA (INVARIANTE 8)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todo aviso nasce DEPOIS do commit de quem o provocou (a inscrição, a decisão, a
 *  varredura) e falha em silêncio, com o motivo devolvido para quem chamou apenas
 *  registrar no log. Uma falha de e-mail não pode desfazer uma vaga confirmada nem
 *  esconder uma decisão já registrada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { queueEmail } from '@/lib/communication/email-service';
import type { EmailPayloads, EmailTemplateKey } from '@/domain/communication/email-templates';

export interface NoticeOutcome {
  ok: boolean;
  /** `true` quando o e-mail entrou na fila (o aviso já está na caixa de entrada). */
  emailQueued: boolean;
  /** Preenchido quando algo falhou — o chamador loga, não trata. */
  message: string | null;
}

/** Recusa sem tentar: o chamador não tem o que fazer além de logar. */
export function noticeFailure(message: string): NoticeOutcome {
  return { ok: false, emailQueued: false, message };
}

/**
 * Grava o aviso na caixa de entrada da pessoa e enfileira o e-mail.
 *
 * `skipDuplicates` sobre a `dedupeKey` (única) é o que torna os avisos idempotentes:
 * a varredura roda de hora em hora, a promoção da lista de espera pode ser tentada
 * duas vezes sob concorrência, e o job de e-mail é retentado pelo BullMQ. Repetir o
 * mesmo FATO não vira duas mensagens — a regra da FASE 15.
 *
 * `sentById` fica NULO: não há pessoa que enviou — o aviso é do SISTEMA. Atribuí-lo a
 * alguém seria inventar autoria, e a caixa de entrada mostra "automático" para nulo.
 */
export async function deliverNotice<K extends EmailTemplateKey>(input: {
  tenantId: string;
  userId: string;
  /** Instituição do fato. Nulo no aviso que não pertence a evento nenhum. */
  eventId: string;
  recipientEmail: string;
  dedupeKey: string;
  subject: string;
  body: string;
  template: K;
  payload: EmailPayloads[K];
}): Promise<NoticeOutcome> {
  try {
    const brandName = await withTenant(input.tenantId, async (tx) => {
      await tx.participantMessage.createMany({
        data: [
          {
            tenantId: input.tenantId,
            userId: input.userId,
            eventId: input.eventId,
            subject: input.subject.slice(0, 140),
            body: input.body.slice(0, 2000),
            dedupeKey: input.dedupeKey,
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
      brandName,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
    });

    return { ok: true, emailQueued: queued.ok, message: queued.ok ? null : queued.message };
  } catch (error) {
    console.error(`[aviso] falha ao avisar (${input.dedupeKey}): ${errorMessage(error)}`);

    return noticeFailure(errorMessage(error));
  }
}

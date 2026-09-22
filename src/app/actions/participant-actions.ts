'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Central do participante (FASE 32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTAS AÇÕES FAZEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • `sendParticipantMessageAction` — o recado da instituição para uma ou várias
 *    pessoas (e-mail pelo outbox + mensagem na caixa de entrada delas);
 *  • `markMessageReadAction` — o participante abre o próprio recado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS PORTAS TÊM PERMISSÕES DIFERENTES, E ISSO É O DESENHO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem ENVIA precisa de `participant:message` no escopo da INSTITUIÇÃO (a decisão da
 *  fase: a equipe do dia não fala em nome da instituição para a base inteira).
 *
 *  Quem LÊ o próprio recado não precisa de permissão de instituição nenhuma: a porta é
 *  a POSSE, conferida com o `userId` da SESSÃO contra o `userId` da mensagem — a mesma
 *  decisão do portal do palestrante (FASE 25). Por isso a caixa de entrada usa
 *  `registration:read:own`, que todo participante já tem, e o serviço recebe o
 *  `userId` do banco, nunca do formulário.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { guardAction, type ActionGuardState } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { markMessageRead, sendParticipantMessage } from '@/lib/participants/message-service';

export type ParticipantActionState = ActionGuardState;

const messageSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  userIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos um destinatário.'),
  subject: z.string().trim().min(3).max(140),
  body: z.string().trim().min(3).max(2000),
  eventId: z.string().uuid().optional(),
});

export async function sendParticipantMessageAction(
  _prev: ParticipantActionState | null,
  formData: FormData,
): Promise<ParticipantActionState> {
  const parsed = messageSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    userIds: formData.getAll('userIds').filter((value): value is string => typeof value === 'string' && value.length > 0),
    subject: formData.get('subject'),
    body: formData.get('body'),
    eventId: (formData.get('eventId') as string) || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message:
        parsed.error.issues[0]?.message ??
        'Escreva o assunto e a mensagem antes de enviar.',
    };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.PARTICIPANT_MESSAGE,
  });

  if (!auth.ok) return auth.state;

  /**
   * IP e agente do pedido entram na trilha: quem falou em nome da instituição com a
   * base inteira é informação que precisa sobreviver à sessão (mesmo padrão do
   * credenciamento, FASE 12).
   */
  const headerList = await headers();

  const result = await sendParticipantMessage({
    tenantId: auth.tenantId,
    tenantSlug: parsed.data.tenantSlug,
    actorId: auth.userId,
    userIds: parsed.data.userIds,
    subject: parsed.data.subject,
    body: parsed.data.body,
    eventId: parsed.data.eventId ?? null,
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/participantes'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/comunicacao'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  /**
   * O RESULTADO DIZ O QUE ACONTECEU COM O E-MAIL, e não só "enviado".
   *
   * O recado está gravado para todo mundo (a caixa de entrada é nossa), e o e-mail
   * pode ter falhado para alguns. Esconder isso faria a instituição acreditar que
   * falou com 200 pessoas quando falou com 190.
   */
  const parts = [`${result.sent} recado(s) enviado(s)`];

  if (result.queued > 0) parts.push(`${result.queued} e-mail(s) na fila`);
  if (result.failed > 0) parts.push(`${result.failed} e-mail(s) recusado(s) — o recado está na plataforma`);
  if (result.skipped > 0) parts.push(`${result.skipped} ficaram fora do lote`);

  return {
    ok: true,
    message: `${parts.join(' · ')}.`,
    data: {
      batchId: result.batchId,
      sent: result.sent,
      queued: result.queued,
      failed: result.failed,
      skipped: result.skipped,
      truncated: result.truncated,
      failures: result.recipients
        .filter((row) => !row.queued)
        .map((row) => `${row.name}: ${row.emailError ?? 'falha no envio'}`),
    },
  };
}

const readSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  messageId: z.string().uuid(),
});

export async function markMessageReadAction(
  _prev: ParticipantActionState | null,
  formData: FormData,
): Promise<ParticipantActionState> {
  const parsed = readSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    messageId: formData.get('messageId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Mensagem inválida.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_READ_OWN,
  });

  if (!auth.ok) return auth.state;

  const result = await markMessageRead({
    tenantId: auth.tenantId,
    /** A posse vem da SESSÃO: marcar a mensagem de outra pessoa é impossível aqui. */
    userId: auth.userId,
    messageId: parsed.data.messageId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/minhas-mensagens'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: result.marked ? 'Mensagem marcada como lida.' : 'Esta mensagem não é sua (ou já estava lida).',
  };
}

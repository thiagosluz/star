/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Recados ao participante (FASE 32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MENSAGEM É O FATO; O E-MAIL SAI DEPOIS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O recado nasce em `participant_messages` (a caixa de entrada do participante) e
 *  o e-mail é ENFILEIRADO a partir dele, pelo outbox da FASE 15. A ordem importa:
 *
 *    • a comunicação interna não depende do provedor externo. Endereço inválido,
 *      fila fora do ar ou domínio não verificado (o caso do Resend hoje) fazem o
 *      e-mail falhar — e a pessoa continua vendo o recado na plataforma;
 *    • o `dedupeKey` do outbox é derivado do ID DA MENSAGEM (`messageDedupeKey`),
 *      então o reenvio do job é idempotente e dois recados com o mesmo assunto no
 *      mesmo dia continuam sendo dois fatos (a lição do `dedupeKey` da FASE 15:
 *      a chave carrega o FATO, não o momento).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NADA AQUI LANÇA (INVARIANTE 8)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Falha de e-mail é registrada e devolvida como número, nunca como exceção: quem
 *  clica em "Enviar" precisa saber quantos saíram e quantos não — e a mensagem
 *  gravada não pode ser desfeita por causa do provedor.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ENVIO EM MASSA TEM TETO E DESTINATÁRIOS VERIFICADOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O lote é limitado (`MESSAGE_BATCH_LIMIT`) e cada destinatário é conferido contra
 *  a UNIÃO que define "participante da instituição" — um `userId` de fora não recebe
 *  nada e nem descobre que a instituição existe. O que passa do teto é REPORTADO
 *  (`truncated`), não silenciado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { queueEmail } from '@/lib/communication/email-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  MESSAGE_BATCH_LIMIT,
  messageDedupeKey,
  validateMessage,
} from '@/domain/participants/participant-rules';
import {
  MAX_MESSAGE_BODY_LENGTH,
  lastParticipantReplyAt,
  replyBodyProblem,
  replySubjectFor,
  threadRootFor,
} from '@/domain/communication/message-thread-rules';
import type { ParticipantResult } from '@/lib/participants/participant-service';

/** A união que define quem é participante da instituição (mesma do diretório). */
const RECIPIENT_UNION_SQL = `
  SELECT p."userId" AS "userId"
    FROM user_tenant_profiles p
   WHERE p."tenantId" = $1::uuid
     AND p."deletedAt" IS NULL
     AND p.status <> 'REMOVED'
  UNION
  SELECT r."userId" AS "userId"
    FROM registrations r
   WHERE r."tenantId" = $1::uuid
     AND r."deletedAt" IS NULL
`;

export interface SentMessageSummary {
  messageId: string;
  userId: string;
  name: string;
  email: string;
  /** `true` quando o e-mail entrou na fila (o recado já está na caixa de entrada). */
  queued: boolean;
  /** Motivo da falha de e-mail, quando houve (o recado continua gravado). */
  emailError: string | null;
}

export interface SendMessageOutcome {
  batchId: string;
  subject: string;
  sent: number;
  queued: number;
  failed: number;
  /** Quantos destinatários ficaram FORA do lote por causa do teto. */
  skipped: number;
  /** `true` quando o pedido alcançou mais gente do que o lote permite. */
  truncated: boolean;
  recipients: readonly SentMessageSummary[];
}

/**
 * Envia um recado para uma lista de pessoas.
 *
 * O `tenantSlug` entra só para montar o link da caixa de entrada no e-mail (o
 * endereço que a pessoa abre). Nada de autorização aqui: quem autoriza é a Server
 * Action (`participant:message`), antes de chamar.
 */
export async function sendParticipantMessage(input: {
  tenantId: string;
  tenantSlug: string;
  actorId: string;
  userIds: readonly string[];
  subject: unknown;
  body: unknown;
  eventId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ParticipantResult<SendMessageOutcome>> {
  const draft = validateMessage({ subject: input.subject, body: input.body });

  if (!draft.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: draft.message };
  }

  if (input.userIds.length === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Escolha ao menos um destinatário.' };
  }

  const requested = [...new Set(input.userIds)];
  const batchId = randomUUID();

  try {
    const prepared = await withTenant(input.tenantId, async (tx) => {
      const [tenant, actor, valid] = await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: input.tenantId },
          select: { name: true },
        }),
        tx.user.findUnique({ where: { id: input.actorId }, select: { name: true } }),
        tx.$queryRawUnsafe<{ userId: string }[]>(
          `SELECT "userId" FROM (${RECIPIENT_UNION_SQL}) AS people WHERE "userId" = ANY($2::uuid[])`,
          input.tenantId,
          requested,
        ),
      ]);

      const allowed = valid.map((row) => row.userId);
      const accepted = allowed.slice(0, MESSAGE_BATCH_LIMIT);

      if (accepted.length === 0) {
        return { empty: true as const };
      }

      const people = await tx.user.findMany({
        where: { id: { in: accepted } },
        select: { id: true, name: true, email: true },
      });

      const event = input.eventId
        ? await tx.event.findFirst({
            where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
            select: { title: true },
          })
        : null;

      /**
       * Os IDs nascem AQUI (e não no banco) porque a `dedupeKey` de cada mensagem
       * depende dele: sem o id antes do `createMany`, seria preciso gravar e depois
       * voltar para atualizar a chave — duas escritas para um fato.
       */
      const rows = people.map((person) => {
        const id = randomUUID();

        return {
          id,
          tenantId: input.tenantId,
          userId: person.id,
          eventId: input.eventId ?? null,
          subject: draft.subject,
          body: draft.body,
          dedupeKey: messageDedupeKey({ tenantId: input.tenantId, userId: person.id, messageId: id }),
          batchId,
          sentById: input.actorId,
          sentAt: new Date(),
        };
      });

      await tx.participantMessage.createMany({ data: rows });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'participant_message',
          entityId: batchId,
          changes: {
            lote: { from: null, to: `${rows.length} recado(s)` },
            assunto: { from: null, to: draft.subject },
            ...(event ? { evento: { from: null, to: event.title } } : {}),
          },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      return {
        empty: false as const,
        tenantName: tenant.name,
        actorName: actor?.name ?? null,
        eventTitle: event?.title ?? null,
        rows,
        people,
        skipped: allowed.length - accepted.length,
        truncated: allowed.length > MESSAGE_BATCH_LIMIT,
      };
    });

    if (prepared.empty) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Nenhum dos destinatários escolhidos participa desta instituição.',
      };
    }

    const inboxUrl = `${tenantPath(input.tenantSlug, '/minhas-mensagens')}`;
    const recipients: SentMessageSummary[] = [];

    /**
     * O e-mail sai DEPOIS do commit, uma pessoa por vez, e a falha de uma não impede
     * a próxima: o recado já está gravado para todas — o que pode variar é a entrega.
     */
    for (const row of prepared.rows) {
      const person = prepared.people.find((candidate) => candidate.id === row.userId);
      if (!person) continue;

      const queued = await queueEmail({
        tenantId: input.tenantId,
        to: person.email,
        toUserId: person.id,
        template: 'PARTICIPANT_MESSAGE',
        brandName: prepared.tenantName,
        dedupeKey: row.dedupeKey,
        createdById: input.actorId,
        payload: {
          recipientName: person.name,
          tenantName: prepared.tenantName,
          subject: draft.subject,
          body: draft.body,
          eventTitle: prepared.eventTitle,
          senderName: prepared.actorName,
          inboxUrl,
        },
      });

      recipients.push({
        messageId: row.id,
        userId: person.id,
        name: person.name,
        email: person.email,
        queued: queued.ok,
        emailError: queued.ok ? null : queued.message,
      });
    }

    return {
      ok: true,
      batchId,
      subject: draft.subject,
      sent: prepared.rows.length,
      queued: recipients.filter((row) => row.queued).length,
      failed: recipients.filter((row) => !row.queued).length,
      skipped: prepared.skipped,
      truncated: prepared.truncated,
      recipients,
    };
  } catch (error) {
    console.error(`[participants] falha ao enviar recado: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível enviar o recado.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  A caixa de entrada do participante
// ───────────────────────────────────────────────────────────────────────────────
export interface InboxReply {
  id: string;
  body: string;
  sentAt: Date;
  /** Nome de quem respondeu — a própria pessoa, no caso da caixa de entrada. */
  authorName: string;
}

export interface InboxMessage {
  id: string;
  subject: string;
  body: string;
  sentAt: Date;
  readAt: Date | null;
  eventTitle: string | null;
  sentByName: string | null;
  /**
   * As RESPOSTAS da pessoa (FASE 56 · dívida E45), em ordem. É o que torna a caixa de
   * entrada uma conversa: sem elas, quem respondeu não vê o que escreveu.
   */
  replies: InboxReply[];
}

/**
 * As mensagens de UMA pessoa.
 *
 * A posse é o filtro: `userId` vem da sessão (nunca do formulário) e a consulta é
 * por ele. É a mesma decisão do portal do palestrante (FASE 25): a permissão abre a
 * porta, e a posse decide o que está atrás dela.
 */
export async function listOwnMessages(input: {
  tenantId: string;
  userId: string;
  limit?: number;
}): Promise<ParticipantResult<{ entries: InboxMessage[]; unread: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const [rows, unread] = await Promise.all([
        tx.participantMessage.findMany({
          /**
           * Só os RECADOS na lista principal: as respostas da própria pessoa aparecem
           * DENTRO da conversa (`replies`). Sem o `parentId: null`, a resposta recém
           * escrita viraria uma segunda linha na caixa de entrada, com o mesmo assunto.
           */
          where: { tenantId: input.tenantId, userId: input.userId, parentId: null },
          orderBy: [{ sentAt: 'desc' }],
          take: Math.min(Math.max(1, input.limit ?? 50), 100),
          select: {
            id: true,
            subject: true,
            body: true,
            sentAt: true,
            readAt: true,
            event: { select: { title: true } },
            sentBy: { select: { name: true } },
            replies: {
              where: { tenantId: input.tenantId, userId: input.userId, direction: 'INBOUND' },
              orderBy: { sentAt: 'asc' },
              select: { id: true, body: true, sentAt: true, sentBy: { select: { name: true } } },
            },
          },
        }),
        /**
         * O NÃO LIDO conta só o que a instituição mandou: a resposta da pessoa nasce com
         * `readAt` nulo (é a EQUIPE que ainda não leu), e contá-la aqui faria o próprio
         * autor da resposta ver "1 não lida" na sua caixa de entrada.
         */
        tx.participantMessage.count({
          where: {
            tenantId: input.tenantId,
            userId: input.userId,
            parentId: null,
            readAt: null,
          },
        }),
      ]);

      return {
        ok: true as const,
        entries: rows.map((row) => ({
          id: row.id,
          subject: row.subject,
          body: row.body,
          sentAt: row.sentAt,
          readAt: row.readAt,
          eventTitle: row.event?.title ?? null,
          sentByName: row.sentBy?.name ?? null,
          replies: row.replies.map((reply) => ({
            id: reply.id,
            body: reply.body,
            sentAt: reply.sentAt,
            authorName: reply.sentBy?.name ?? 'Você',
          })),
        })),
        unread,
      };
    });
  } catch (error) {
    console.error(`[participants] falha ao carregar a caixa de entrada: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar as suas mensagens.' };
  }
}

/**
 * Marca como LIDA — e só a própria.
 *
 * O `updateMany` com `userId` no filtro é a decisão de concorrência e de segurança em
 * uma linha só: marcar a mensagem de outra pessoa devolve `count = 0`, e `0` é a
 * resposta de negócio ("não é sua"), não um erro do sistema.
 */
export async function markMessageRead(input: {
  tenantId: string;
  userId: string;
  messageId: string;
}): Promise<ParticipantResult<{ marked: boolean }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const result = await tx.participantMessage.updateMany({
        where: { id: input.messageId, tenantId: input.tenantId, userId: input.userId, readAt: null },
        data: { readAt: new Date() },
      });

      return { ok: true as const, marked: result.count > 0 };
    });
  } catch (error) {
    console.error(`[participants] falha ao marcar a mensagem como lida: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível marcar a mensagem como lida.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  A RESPOSTA DA PESSOA (FASE 56 · dívida E45)
// ───────────────────────────────────────────────────────────────────────────────
export interface ConversationSummary {
  messageId: string;
  subject: string;
  sentAt: Date;
  sentByName: string | null;
  /** Quantas vezes a pessoa respondeu. Zero = a instituição falou e não ouviu. */
  replyCount: number;
  lastReplyAt: Date | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PESSOA RESPONDE O RECADO (FASE 56 · dívida E45)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO HÁ PERMISSÃO NOVA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Responder é ato de POSSE, e só: o `userId` vem da sessão e a consulta é por ele. A
 *  pessoa responde o que RECEBEU — não há permissão de RBAC que faça sentido conceder
 *  ("responder os próprios recados" é o que qualquer conta pode fazer na própria caixa
 *  de entrada). É a mesma régua do `markMessageRead`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RESPOSTA APONTA PARA A RAIZ, E O ASSUNTO GANHA `Re:` UMA VEZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `threadRootFor` decide o pai (a raiz, mesmo respondendo a uma resposta) e
 *  `replySubjectFor` cuida do prefixo. As duas regras são do DOMÍNIO porque a ficha da
 *  instituição lê a mesma conversa por outro caminho.
 *
 *  O `dedupeKey` carrega a raiz E um id novo: repetir o clique cria OUTRA resposta
 *  (dois fatos), e o mesmo `POST` reenviado pelo navegador não vira duas — o índice
 *  único da coluna é quem decide.
 */
export async function replyToParticipantMessage(input: {
  tenantId: string;
  userId: string;
  messageId: string;
  body: string;
  ipAddress?: string | null;
}): Promise<ParticipantResult<{ replyId: string; sentAt: Date }>> {
  const problem = replyBodyProblem(input.body);

  if (problem) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message:
        problem === 'EMPTY'
          ? 'Escreva a sua resposta antes de enviar.'
          : `A resposta passa do limite de ${MAX_MESSAGE_BODY_LENGTH} caracteres.`,
    };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const message = await tx.participantMessage.findFirst({
        where: { id: input.messageId, tenantId: input.tenantId, userId: input.userId },
        select: { id: true, parentId: true, subject: true, eventId: true },
      });

      /** Não é da caixa de entrada desta pessoa (ou não existe) — a resposta é a mesma. */
      if (!message) {
        return {
          ok: false as const,
          code: 'NOT_FOUND',
          message: 'Recado não encontrado na sua caixa de entrada.',
        };
      }

      const rootId = threadRootFor(message);

      const reply = await tx.participantMessage.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          eventId: message.eventId,
          subject: replySubjectFor(message.subject),
          body: input.body.trim(),
          direction: 'INBOUND',
          parentId: rootId,
          /** Quem escreveu é a própria pessoa — a equipe lê `sentBy` para saber quem falou. */
          sentById: input.userId,
          dedupeKey: `reply:${rootId}:${randomUUID()}`,
        },
        select: { id: true, sentAt: true },
      });

      await recordAudit({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'CREATE',
        entityType: 'participant_message',
        entityId: reply.id,
        changes: {
          direcao: { from: null, to: 'INBOUND' },
          conversa: { from: null, to: rootId },
        },
        ipAddress: input.ipAddress ?? null,
      });

      return { ok: true as const, replyId: reply.id, sentAt: reply.sentAt };
    });
  } catch (error) {
    console.error(`[participants] falha ao responder o recado: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível enviar a sua resposta. Tente de novo em instantes.',
    };
  }
}

/**
 * As conversas de UMA pessoa, com o indicador de resposta — a leitura da FICHA (E45).
 *
 * A permissão de quem organiza é conferida na PÁGINA (`participant:message`), como em
 * todo o resto: aqui a consulta é do vínculo, e a RLS garante que ela não atravessa a
 * instituição.
 */
export async function listParticipantConversations(input: {
  tenantId: string;
  userId: string;
  limit?: number;
}): Promise<ParticipantResult<{ conversations: ConversationSummary[] }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const rows = await tx.participantMessage.findMany({
        where: { tenantId: input.tenantId, userId: input.userId, parentId: null },
        orderBy: { sentAt: 'desc' },
        take: Math.min(Math.max(1, input.limit ?? 20), 50),
        select: {
          id: true,
          subject: true,
          sentAt: true,
          sentBy: { select: { name: true } },
          replies: {
            where: { direction: 'INBOUND' },
            orderBy: { sentAt: 'asc' },
            select: { id: true, direction: true, parentId: true, sentAt: true },
          },
        },
      });

      return {
        ok: true as const,
        conversations: rows.map((row) => ({
          messageId: row.id,
          subject: row.subject,
          sentAt: row.sentAt,
          sentByName: row.sentBy?.name ?? null,
          replyCount: row.replies.length,
          lastReplyAt: lastParticipantReplyAt(row.replies),
        })),
      };
    });
  } catch (error) {
    console.error(`[participants] falha ao carregar as conversas: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível carregar as conversas desta pessoa.',
    };
  }
}

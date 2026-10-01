/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — A resposta do recado (FASE 56 · dívida E45)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A régua da conversa é pura e tem teste próprio. Aqui se prova o que depende do
 *  schema e da RLS:
 *
 *    • a resposta nasce `INBOUND`, apontando para o RECADO RAIZ, e é auditada;
 *    • ela NÃO vira uma segunda linha na caixa de entrada nem infla o "não lida" da
 *      própria pessoa que respondeu (era o risco de reaproveitar `readAt`);
 *    • responder a uma resposta mantém a conversa PLANA;
 *    • a ficha da instituição mostra "respondeu" com a data da última resposta;
 *    • responder o recado de OUTRA pessoa é `NOT_FOUND` — a posse é conferida no banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  listOwnMessages,
  listParticipantConversations,
  replyToParticipantMessage,
  sendParticipantMessage,
} from '../../src/lib/participants/message-service';
import { getParticipantProfile } from '../../src/lib/participants/participant-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let tenantSlug: string;
let staffId: string;
let pessoaId: string;
let outraPessoaId: string;
let messageId: string;

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  const email = `f56e45.${RUN}.${label.toLowerCase()}@example.test`;

  await adminPrisma.user.create({ data: { id, name: `Pessoa ${label} ${RUN}`, email } });

  return id;
}

beforeAll(async () => {
  tenantId = randomUUID();
  tenantSlug = `f56-e45-${RUN}`;

  await adminPrisma.tenant.create({
    data: { id: tenantId, slug: tenantSlug, name: `Instituição da conversa ${RUN}` },
  });

  staffId = await createUser('Equipe');
  pessoaId = await createUser('Participante');
  outraPessoaId = await createUser('Outra');

  for (const userId of [staffId, pessoaId, outraPessoaId]) {
    await withTenant(tenantId, (tx) =>
      tx.userTenantProfile.create({
        data: {
          id: randomUUID(),
          tenantId,
          userId,
          status: 'ACTIVE',
          kind: 'PARTICIPANT',
          joinedAt: new Date(),
        },
      }),
    );
  }

  /** A instituição manda o recado — o fato que a pessoa vai responder. */
  const sent = await sendParticipantMessage({
    tenantId,
    tenantSlug,
    actorId: staffId,
    userIds: [pessoaId],
    subject: 'Sobre o seu credenciamento',
    body: 'Você retirou o crachá? Precisamos confirmar a sua presença na portaria.',
  });

  if (!sent.ok) throw new Error(`Falha ao enviar o recado: ${sent.message}`);

  const enviados = await withTenant(tenantId, (tx) =>
    tx.participantMessage.findMany({
      where: { tenantId, userId: pessoaId, parentId: null },
      select: { id: true },
    }),
  );

  messageId = enviados[0]?.id ?? '';
  if (!messageId) throw new Error('O recado não foi gravado.');
}, 120_000);

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `.${RUN}.` } } });
});

describe('a pessoa responde o recado (E45)', () => {
  let firstReplyId = '';

  it('a resposta nasce INBOUND, na raiz da conversa, e é auditada', async () => {
    const result = await replyToParticipantMessage({
      tenantId,
      userId: pessoaId,
      messageId,
      body: 'Retirei sim, na terça de manhã. Obrigada!',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    firstReplyId = result.replyId;

    const row = await withTenant(tenantId, (tx) =>
      tx.participantMessage.findUniqueOrThrow({
        where: { id: result.replyId },
        select: {
          direction: true,
          parentId: true,
          userId: true,
          sentById: true,
          subject: true,
          body: true,
          readAt: true,
        },
      }),
    );

    expect(row.direction).toBe('INBOUND');
    expect(row.parentId).toBe(messageId);
    expect(row.userId).toBe(pessoaId);
    expect(row.sentById).toBe(pessoaId);
    expect(row.subject).toBe('Re: Sobre o seu credenciamento');
    expect(row.body).toBe('Retirei sim, na terça de manhã. Obrigada!');
    /** `readAt` é da EQUIPE: a resposta nasce não lida para quem organiza. */
    expect(row.readAt).toBeNull();

    const trilha = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { entityType: 'participant_message', entityId: result.replyId, action: 'CREATE' },
        select: { changes: true },
      }),
    );

    expect(trilha).toHaveLength(1);
    expect(JSON.stringify(trilha[0]?.changes)).toContain('INBOUND');
  }, 60_000);

  it('a caixa de entrada mostra a conversa — e a resposta NÃO infla o "não lida" da própria pessoa', async () => {
    const inbox = await listOwnMessages({ tenantId, userId: pessoaId });

    expect(inbox.ok).toBe(true);
    if (!inbox.ok) return;

    /** Uma linha só: a resposta vive DENTRO do recado. */
    expect(inbox.entries).toHaveLength(1);

    const entry = inbox.entries[0];
    expect(entry?.id).toBe(messageId);
    expect(entry?.replies).toHaveLength(1);
    expect(entry?.replies[0]?.body).toContain('Retirei sim');

    /**
     * O recado da instituição continua sendo o ÚNICO não lido — a resposta da pessoa
     * não pode aparecer para ela mesma como mensagem pendente.
     */
    expect(inbox.unread).toBe(1);
  }, 60_000);

  it('responder a resposta mantém a conversa PLANA (o pai continua sendo a raiz)', async () => {
    const result = await replyToParticipantMessage({
      tenantId,
      userId: pessoaId,
      messageId: firstReplyId,
      body: 'Ah, e chego às 13h30 para ajudar na montagem.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await withTenant(tenantId, (tx) =>
      tx.participantMessage.findUniqueOrThrow({
        where: { id: result.replyId },
        select: { parentId: true, subject: true },
      }),
    );

    expect(row.parentId).toBe(messageId);
    /** `Re:` uma vez só, mesmo respondendo a uma resposta. */
    expect(row.subject).toBe('Re: Sobre o seu credenciamento');
  }, 60_000);

  it('a ficha da instituição diz que a pessoa RESPONDEU, com a data da última resposta', async () => {
    const conversas = await listParticipantConversations({ tenantId, userId: pessoaId });

    expect(conversas.ok).toBe(true);
    if (!conversas.ok) return;

    const conversa = conversas.conversations.find((item) => item.messageId === messageId);

    expect(conversa?.replyCount).toBe(2);
    expect(conversa?.lastReplyAt).toBeInstanceOf(Date);

    /** E a ficha carrega o mesmo número (uma régua só para as duas telas). */
    const ficha = await getParticipantProfile({ tenantId, userId: pessoaId, actorId: staffId });

    expect(ficha.ok).toBe(true);
    if (!ficha.ok) return;

    const recado = ficha.profile.messages.find((item) => item.id === messageId);
    expect(recado?.replyCount).toBe(2);
    expect(recado?.lastReplyAt).toBeInstanceOf(Date);
  }, 60_000);

  it('responder o recado de OUTRA pessoa é recusado — a posse é conferida no banco', async () => {
    /** O recado é da `pessoaId`; quem tenta responder é a `outraPessoaId`. */
    const result = await replyToParticipantMessage({
      tenantId,
      userId: outraPessoaId,
      messageId,
      body: 'Não deveria conseguir escrever isto.',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');

    /** E nada foi gravado em nome de ninguém. */
    const total = await withTenant(tenantId, (tx) =>
      tx.participantMessage.count({ where: { tenantId, parentId: messageId } }),
    );

    expect(total).toBe(2);
  }, 60_000);

  it('resposta vazia é recusada com o motivo, antes de tocar no banco', async () => {
    const result = await replyToParticipantMessage({
      tenantId,
      userId: pessoaId,
      messageId,
      body: '   ',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.message).toMatch(/escreva/i);
  }, 60_000);
});

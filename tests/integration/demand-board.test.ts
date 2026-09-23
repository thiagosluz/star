import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  addDemandComment,
  createDemand,
  createEventTeam,
  deleteEventTeam,
  loadDemandBoard,
  loadDemandDetail,
  moveDemand,
  runDemandDueSweep,
  setDemandAssignees,
  setEventTeamMembers,
  updateDemandColumn,
} from '../../src/lib/events/demand-service';
import { dueAtFromDay } from '../../src/domain/events/demand-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let organizerId: string;
let anaId: string;
let brunoId: string;
let participanteId: string;

const eventSlug = `evento-demandas-${RUN}`;
const now = new Date();
const eventStartsAt = new Date(now.getTime() + 30 * 86_400_000);

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  QUADRO DE DEMANDAS INTERNAS (FASE 38) — integração com banco real
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o quadro nasce na primeira leitura, com as cinco colunas padrão, e nascer duas
 *    vezes não duplica nada (a idempotência é do `@@unique([eventId])`);
 *  • a ordem dos cartões é reescrita em bloco de 10 em 10, e mover é ESCRITA
 *    CONDICIONAL: dois cliques com a mesma coluna de origem produzem um movimento só;
 *  • a COLUNA decide a conclusão (`isDone`), gravando e limpando `completedAt`;
 *  • só vínculo `MEMBER` ATIVO é atribuído, entra em equipe ou é mencionado;
 *  • a menção é LINHA (não texto procurado) e o aviso sai uma vez por menção;
 *  • o líder distribui apenas dentro da equipe que lidera (a posse é conferida no
 *    serviço), e a equipe com demanda aberta recusa a exclusão;
 *  • a varredura de prazos avisa uma vez por dia e por pessoa, no fuso do evento;
 *  • a RLS responde "não existe" para o quadro da instituição vizinha.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f38.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  return id;
}

async function linkMember(userId: string, kind: 'MEMBER' | 'PARTICIPANT', status = 'ACTIVE') {
  await adminPrisma.userTenantProfile.create({
    data: { tenantId, userId, kind, status: status as 'ACTIVE', joinedAt: new Date() },
  });
}

async function boardOf(tenant = tenantId) {
  const result = await loadDemandBoard({ tenantId: tenant, eventId });

  if (!result.ok) throw new Error(`Falha ao ler o quadro: ${result.message}`);

  return result.board;
}

async function cardsOf(columnId: string) {
  return withTenant(tenantId, (tx) =>
    tx.demand.findMany({
      where: { columnId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, position: true, completedAt: true },
    }),
  );
}

async function timelineOf(demandId: string) {
  return withTenant(tenantId, (tx) =>
    tx.demandEvent.findMany({
      where: { demandId },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, fromValue: true, toValue: true },
    }),
  );
}

async function messagesOf(prefix: string) {
  return withTenant(tenantId, (tx) =>
    tx.participantMessage.findMany({
      where: { dedupeKey: { startsWith: prefix } },
      select: { dedupeKey: true, userId: true, subject: true },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f38-${RUN}`,
        name: `Instituição das Demandas ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f38-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  organizerId = await createUser('Organizador F38');
  anaId = await createUser('Ana da Logística');
  brunoId = await createUser('Bruno do Som');
  participanteId = await createUser('Participante Curioso');

  await linkMember(organizerId, 'MEMBER');
  await linkMember(anaId, 'MEMBER');
  await linkMember(brunoId, 'MEMBER');
  await linkMember(participanteId, 'PARTICIPANT');

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: eventSlug,
        title: 'Congresso das demandas',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt: eventStartsAt,
        endsAt: new Date(eventStartsAt.getTime() + 2 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f38.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o quadro nasce na primeira leitura', () => {
  it('cria um quadro com as cinco colunas padrão, e ler de novo não duplica', async () => {
    const first = await boardOf();
    const second = await boardOf();

    expect(first.boardId).toBe(second.boardId);
    expect(first.columns.map((column) => column.name)).toEqual([
      'A fazer',
      'Em andamento',
      'Em revisão',
      'Bloqueado',
      'Concluído',
    ]);
    expect(second.columns).toHaveLength(5);

    const boards = await withTenant(tenantId, (tx) => tx.demandBoard.count({ where: { eventId } }));
    expect(boards).toBe(1);
  });

  it('a última coluna é a de conclusão, e é a única', async () => {
    const board = await boardOf();
    const done = board.columns.filter((column) => column.isDone);

    expect(done).toHaveLength(1);
    expect(done[0]!.name).toBe('Concluído');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('criar demanda', () => {
  it('entra na primeira coluna, no fim da ordem, com a prioridade e o responsável', async () => {
    const board = await boardOf();
    const first = board.columns[0]!;

    const created = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Montar os crachás',
      priority: 'URGENT',
      assigneeIds: [anaId],
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cards = await cardsOf(first.id);
    expect(cards.map((card) => card.title)).toEqual(['Montar os crachás']);
    expect(cards[0]!.position).toBe(10);

    const detail = await loadDemandDetail({ tenantId, demandId: created.demandId });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;

    expect(detail.detail.card.priorityLabel).toBe('Urgente');
    expect(detail.detail.card.assignees.map((person) => person.id)).toEqual([anaId]);
    expect(detail.detail.timeline.map((entry) => entry.kind)).toContain('CREATED');

    /** O aviso de atribuição nasce FORA da transação, com a chave do fato. */
    const messages = await messagesOf(`demand-assigned-${created.demandId}`);
    expect(messages.map((message) => message.userId)).toEqual([anaId]);
  });

  it('título vazio é recusado', async () => {
    const result = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: '   ',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TITLE_REQUIRED');
  });

  it('participante NÃO pode ser responsável — só a equipe ativa da instituição', async () => {
    const result = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda com participante',
      assigneeIds: [participanteId],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_A_MEMBER');
  });

  it('equipe de outro evento é recusada', async () => {
    const otherEventId = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.event.create({
        data: {
          id: otherEventId,
          tenantId,
          slug: `outro-${RUN}`,
          title: 'Outro evento',
          status: 'DRAFT',
          modality: 'IN_PERSON',
          timezone: TIME_ZONE,
          startsAt: eventStartsAt,
          endsAt: new Date(eventStartsAt.getTime() + 86_400_000),
        },
      }),
    );

    const team = await createEventTeam({
      tenantId,
      eventId: otherEventId,
      actorId: organizerId,
      name: `Equipe de fora ${RUN}`,
    });

    expect(team.ok).toBe(true);
    if (!team.ok) return;

    const result = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda com equipe de fora',
      teamId: team.teamId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TEAM_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('mover o cartão', () => {
  it('a ordem da coluna é reescrita em bloco de 10 em 10', async () => {
    const board = await boardOf();
    const [todo, doing] = [board.columns[0]!, board.columns[1]!];

    await createDemand({ tenantId, eventId, actorId: organizerId, title: 'Segunda demanda' });
    await createDemand({ tenantId, eventId, actorId: organizerId, title: 'Terceira demanda' });

    const cards = await cardsOf(todo.id);
    expect(cards.map((card) => card.position)).toEqual([10, 20, 30]);

    const moved = await moveDemand({
      tenantId,
      demandId: cards[2]!.id,
      actorId: anaId,
      fromColumnId: todo.id,
      toColumnId: doing.id,
    });

    expect(moved.ok).toBe(true);
    expect((await cardsOf(todo.id)).map((card) => card.position)).toEqual([10, 20]);
    expect((await cardsOf(doing.id)).map((card) => card.title)).toEqual(['Terceira demanda']);
  });

  it('quem move com a coluna de origem ERRADA recebe ALREADY_MOVED', async () => {
    const board = await boardOf();
    const [todo, doing, review] = [board.columns[0]!, board.columns[1]!, board.columns[2]!];

    const created = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Corrida de movimento',
    });
    if (!created.ok) throw new Error('não criou');

    /** Duas telas com o MESMO quadro na mão: as duas viram "A fazer" = origem. */
    const first = await moveDemand({
      tenantId,
      demandId: created.demandId,
      actorId: anaId,
      fromColumnId: todo.id,
      toColumnId: doing.id,
    });

    const second = await moveDemand({
      tenantId,
      demandId: created.demandId,
      actorId: brunoId,
      fromColumnId: todo.id,
      toColumnId: review.id,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('ALREADY_MOVED');

    const card = await withTenant(tenantId, (tx) =>
      tx.demand.findUniqueOrThrow({ where: { id: created.demandId }, select: { columnId: true } }),
    );
    expect(card.columnId).toBe(doing.id);
    expect(review.cards).toEqual([]);
  });

  it('a COLUNA decide a conclusão: entrar carimba, sair limpa, e a linha do tempo registra', async () => {
    const board = await boardOf();
    const [todo, done, review] = [board.columns[0]!, board.columns[4]!, board.columns[2]!];

    const created = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda que conclui',
    });
    if (!created.ok) throw new Error('não criou');

    const completed = await moveDemand({
      tenantId,
      demandId: created.demandId,
      actorId: anaId,
      fromColumnId: todo.id,
      toColumnId: done.id,
    });

    expect(completed.ok).toBe(true);

    const afterComplete = await withTenant(tenantId, (tx) =>
      tx.demand.findUniqueOrThrow({
        where: { id: created.demandId },
        select: { completedAt: true },
      }),
    );
    expect(afterComplete.completedAt).not.toBeNull();

    const reopened = await moveDemand({
      tenantId,
      demandId: created.demandId,
      actorId: anaId,
      fromColumnId: done.id,
      toColumnId: review.id,
    });

    expect(reopened.ok).toBe(true);

    const afterReopen = await withTenant(tenantId, (tx) =>
      tx.demand.findUniqueOrThrow({
        where: { id: created.demandId },
        select: { completedAt: true },
      }),
    );
    expect(afterReopen.completedAt).toBeNull();

    const kinds = (await timelineOf(created.demandId)).map((entry) => entry.kind);
    expect(kinds).toEqual(['CREATED', 'COMPLETED', 'REOPENED']);
  });

  it('a coluna de conclusão exige que exista OUTRA antes de deixar de concluir', async () => {
    const board = await boardOf();
    const done = board.columns.find((column) => column.isDone)!;

    const result = await updateDemandColumn({
      tenantId,
      columnId: done.id,
      actorId: organizerId,
      isDone: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DONE_COLUMN_REQUIRED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('comentários e menções', () => {
  it('a menção é LINHA, e o texto não vira menção', async () => {
    const created = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda com conversa',
    });
    if (!created.ok) throw new Error('não criou');

    const comment = await addDemandComment({
      tenantId,
      demandId: created.demandId,
      actorId: organizerId,
      /** O `@Ana` no TEXTO não menciona ninguém: quem menciona é a lista de ids. */
      body: '@Ana da Logística, isso é com você',
      mentionIds: [],
    });

    expect(comment.ok).toBe(true);

    const detail = await loadDemandDetail({ tenantId, demandId: created.demandId });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.detail.comments).toHaveLength(1);
    expect(detail.detail.comments[0]!.mentions).toEqual([]);
  });

  it('menciona quem é da equipe, ignora o autor e quem não é membro, e avisa UMA vez', async () => {
    const created = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda mencionada',
    });
    if (!created.ok) throw new Error('não criou');

    const comment = await addDemandComment({
      tenantId,
      demandId: created.demandId,
      actorId: organizerId,
      body: 'Preciso de ajuda aqui',
      mentionIds: [anaId, anaId, participanteId, organizerId],
    });

    expect(comment.ok).toBe(true);
    if (!comment.ok) return;

    const detail = await loadDemandDetail({ tenantId, demandId: created.demandId });
    if (!detail.ok) throw new Error('não leu');

    expect(detail.detail.comments[0]!.mentions.map((person) => person.id)).toEqual([anaId]);

    const messages = await messagesOf(`demand-mention-${comment.commentId}`);
    expect(messages.map((message) => message.userId)).toEqual([anaId]);

    const mention = await withTenant(tenantId, (tx) =>
      tx.demandMention.findFirstOrThrow({
        where: { commentId: comment.commentId },
        select: { notifiedAt: true },
      }),
    );
    expect(mention.notifiedAt).not.toBeNull();
  });

  it('comentário vazio é recusado', async () => {
    const created = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda sem comentário',
    });
    if (!created.ok) throw new Error('não criou');

    const result = await addDemandComment({
      tenantId,
      demandId: created.demandId,
      actorId: organizerId,
      body: '   ',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('COMMENT_REQUIRED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('equipes do evento', () => {
  it('o líder é UM: definir outro troca, não soma', async () => {
    const team = await createEventTeam({
      tenantId,
      eventId,
      actorId: organizerId,
      name: `Logística ${RUN}`,
      memberIds: [anaId, brunoId],
      leadId: anaId,
    });

    expect(team.ok).toBe(true);
    if (!team.ok) return;

    const swapped = await setEventTeamMembers({
      tenantId,
      teamId: team.teamId,
      actorId: organizerId,
      memberIds: [anaId, brunoId],
      leadId: brunoId,
    });

    expect(swapped.ok).toBe(true);

    const leads = await withTenant(tenantId, (tx) =>
      tx.eventTeamMember.findMany({
        where: { teamId: team.teamId, isLead: true },
        select: { userId: true },
      }),
    );

    expect(leads.map((row) => row.userId)).toEqual([brunoId]);
  });

  it('equipe com demanda ABERTA recusa a exclusão', async () => {
    const team = await createEventTeam({
      tenantId,
      eventId,
      actorId: organizerId,
      name: `Som ${RUN}`,
    });
    if (!team.ok) throw new Error('não criou equipe');

    const demand = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda da equipe do som',
      teamId: team.teamId,
    });
    if (!demand.ok) throw new Error('não criou demanda');

    const refused = await deleteEventTeam({ tenantId, teamId: team.teamId, actorId: organizerId });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('TEAM_IN_USE');
  });

  it('o líder NÃO distribui fora da equipe que lidera', async () => {
    const team = await createEventTeam({
      tenantId,
      eventId,
      actorId: organizerId,
      name: `Portaria ${RUN}`,
      memberIds: [anaId, brunoId],
      leadId: anaId,
    });
    if (!team.ok) throw new Error('não criou equipe');

    const demand = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda sem equipe para o líder',
    });
    if (!demand.ok) throw new Error('não criou demanda');

    /** A demanda não é da equipe dele: o caminho estreito recusa. */
    const refused = await setDemandAssignees({
      tenantId,
      demandId: demand.demandId,
      actorId: anaId,
      userIds: [brunoId],
      leadOnly: true,
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('NOT_LEADER');

    /** Dentro da própria equipe, ele distribui. */
    const own = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda da portaria',
      teamId: team.teamId,
    });
    if (!own.ok) throw new Error('não criou demanda');

    const allowed = await setDemandAssignees({
      tenantId,
      demandId: own.demandId,
      actorId: anaId,
      userIds: [brunoId],
      leadOnly: true,
    });

    expect(allowed.ok).toBe(true);
  });

  it('quem coordena distribui fora da equipe e o aviso sai para quem entrou', async () => {
    const demand = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda coordenada',
    });
    if (!demand.ok) throw new Error('não criou');

    const assigned = await setDemandAssignees({
      tenantId,
      demandId: demand.demandId,
      actorId: organizerId,
      userIds: [brunoId],
    });

    expect(assigned.ok).toBe(true);
    expect(assigned.ok && assigned.notices.filter((notice) => notice.ok)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a varredura de prazos', () => {
  it('avisa quem vence amanhã e quem já venceu, uma vez por dia e por pessoa', async () => {
    const board = await boardOf();
    const first = board.columns[0]!;

    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const tomorrow = new Date(Date.parse(`${todayKey}T00:00:00.000Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const yesterday = new Date(Date.parse(`${todayKey}T00:00:00.000Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);

    const dueSoon = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Vence amanhã',
      columnId: first.id,
      dueAt: dueAtFromDay(tomorrow, TIME_ZONE),
      assigneeIds: [anaId],
    });
    if (!dueSoon.ok) throw new Error('não criou');

    const overdue = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Venceu ontem',
      columnId: first.id,
      dueAt: dueAtFromDay(yesterday, TIME_ZONE),
      assigneeIds: [brunoId],
    });
    if (!overdue.ok) throw new Error('não criou');

    /** Sem prazo: não há o que avisar. */
    const noDue = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Sem prazo nenhum',
      columnId: first.id,
      assigneeIds: [anaId],
    });
    if (!noDue.ok) throw new Error('não criou');

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE O CONTADOR GLOBAL É `>=` E A ASSERÇÃO FORTE É POR DEMANDA
     * ─────────────────────────────────────────────────────────────────────────────
     *  A varredura é CROSS-TENANT por desenho (o worker não tem instituição), e este
     *  banco é o MESMO do seed e do E2E: exigir `dueSoon === 1` faria o teste medir o
     *  que outra suíte deixou gravado — a armadilha 85. O que prova o comportamento é
     *  a mensagem da MINHA demanda, com a chave do dia local, e ela é exata.
     */
    const sweep = await runDemandDueSweep({ now });
    expect(sweep.dueSoon).toBeGreaterThanOrEqual(1);
    expect(sweep.overdue).toBeGreaterThanOrEqual(1);

    expect((await messagesOf(`demand-due-soon-${dueSoon.demandId}`)).map((m) => m.userId)).toEqual([
      anaId,
    ]);
    expect((await messagesOf(`demand-overdue-${overdue.demandId}`)).map((m) => m.userId)).toEqual([
      brunoId,
    ]);
    expect(await messagesOf(`demand-due-soon-${noDue.demandId}`)).toEqual([]);

    /** A segunda passada no MESMO dia não repete o aviso (a chave carrega o dia). */
    await runDemandDueSweep({ now });
    expect((await messagesOf(`demand-due-soon-${dueSoon.demandId}`)).length).toBe(1);
  });

  it('demanda concluída não recebe aviso de atraso', async () => {
    const board = await boardOf();
    const [first, done] = [board.columns[0]!, board.columns[4]!];
    const yesterday = new Date(now.getTime() - 86_400_000);

    const created = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Atrasada mas resolvida',
      columnId: first.id,
      dueAt: dueAtFromDay(yesterday.toISOString().slice(0, 10), TIME_ZONE),
      assigneeIds: [anaId],
    });
    if (!created.ok) throw new Error('não criou');

    await moveDemand({
      tenantId,
      demandId: created.demandId,
      actorId: anaId,
      fromColumnId: first.id,
      toColumnId: done.id,
    });

    await runDemandDueSweep({ now });
    expect(await messagesOf(`demand-overdue-${created.demandId}`)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isolamento entre instituições', () => {
  it('a instituição vizinha não enxerga o quadro nem a demanda', async () => {
    const board = await boardOf();

    const created = await createDemand({
      tenantId,
      eventId,
      actorId: organizerId,
      title: 'Demanda privada',
      columnId: board.columns[0]!.id,
    });
    if (!created.ok) throw new Error('não criou');

    const neighborBoard = await loadDemandBoard({ tenantId: otherTenantId, eventId });
    expect(neighborBoard.ok).toBe(false);

    const neighborDetail = await loadDemandDetail({
      tenantId: otherTenantId,
      demandId: created.demandId,
    });
    expect(neighborDetail.ok).toBe(false);
    if (neighborDetail.ok) return;
    expect(neighborDetail.code).toBe('NOT_FOUND');

    const visible = await withTenant(otherTenantId, (tx) => tx.demand.count());
    expect(visible).toBe(0);
  });
});

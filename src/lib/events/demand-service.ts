/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Quadro de demandas internas do evento (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS QUATRO TRABALHOS DESTE SERVIÇO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **Ler o quadro** — colunas, cartões, equipes e o resumo por equipe/pessoa.
 *       O quadro nasce na primeira leitura (`ensureDemandBoard`), de forma
 *       IDEMPOTENTE: o `@@unique([eventId])` do quadro e o `skipDuplicates` das
 *       colunas fazem dois pedidos simultâneos produzirem um quadro só.
 *    2. **Mover o cartão** — é o ato central, e o único que precisa de proteção
 *       contra corrida: `updateMany` CONDICIONAL pelo `columnId` que a tela viu
 *       (invariante nº 5). Zero linhas = "outra pessoa já moveu", que é resposta de
 *       negócio, não erro. A ordem dentro da coluna é reescrita em bloco de 10 em
 *       10 (como os blocos de página da F17).
 *    3. **Concluir** — quem decide é a COLUNA (`isDone`), e o serviço grava
 *       `completedAt`. Sair de uma coluna de conclusão LIMPA a data: a demanda
 *       reaberta volta a ser trabalho em aberto, e manter o carimbo antigo faria o
 *       resumo contar como entregue o que voltou para a mesa.
 *    4. **Conversar e avisar** — comentários com menção (a menção é LINHA, não
 *       texto procurado) e os cinco avisos da fase, sempre FORA da transação e
 *       nunca lançando (invariante nº 8): uma falha de e-mail não pode desfazer um
 *       cartão movido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM PODE SER ATRIBUÍDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Só vínculo `MEMBER` **ATIVO** da instituição. Não é preciosismo: participante de
 *  evento e palestrante convidado têm vínculo `PARTICIPANT`, e transformá-los em
 *  força de trabalho por acidente faria a lista de responsáveis encher de gente que
 *  não trabalha na organização — além de consumir a quota de equipe da instituição.
 *  A checagem é feita UMA vez, no serviço, e vale para atribuição, equipe e menção.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant, systemClient, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  DEFAULT_DEMAND_COLUMNS,
  DEMAND_DUE_SOON_DAYS,
  DEMAND_POSITION_STEP,
  addDaysToDayKey,
  boardSummary,
  demandEventLabel,
  demandSituation,
  dueStatusLabel,
  firstColumn,
  leadsTeam,
  localDayKey,
  normalizeColumnName,
  normalizeDemandComment,
  normalizeDemandDescription,
  normalizeDemandPriority,
  normalizeDemandTitle,
  normalizeMentionIds,
  planReorder,
  positionBetween,
  priorityLabel,
  DEMAND_SITUATION_LABELS,
  type DemandSummary,
} from '@/domain/events/demand-rules';
import {
  notifyDemandAssigned,
  notifyDemandDueSoon,
  notifyDemandMention,
  notifyDemandOverdue,
  type NoticeOutcome,
} from '@/lib/events/demand-notices';

// ───────────────────────────────────────────────────────────────────────────────
//  Contratos
// ───────────────────────────────────────────────────────────────────────────────
export type DemandErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'TITLE_REQUIRED'
  | 'COMMENT_REQUIRED'
  | 'COLUMN_NOT_FOUND'
  | 'ALREADY_MOVED'
  | 'TEAM_NOT_FOUND'
  | 'TEAM_IN_USE'
  | 'TEAM_NAME_TAKEN'
  | 'COLUMN_NAME_TAKEN'
  | 'LAST_COLUMN'
  | 'DONE_COLUMN_REQUIRED'
  | 'NOT_A_MEMBER'
  | 'NOT_LEADER'
  | 'INTERNAL';

export type DemandFailure = { ok: false; code: DemandErrorCode; message: string };

function fail(code: DemandErrorCode, message: string): DemandFailure {
  return { ok: false, code, message };
}

export interface DemandPerson {
  id: string;
  name: string;
  email: string;
}

export interface DemandCard {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: string;
  priorityLabel: string;
  position: number;
  startAt: Date | null;
  dueAt: Date | null;
  dueLabel: string | null;
  completedAt: Date | null;
  teamId: string | null;
  teamName: string | null;
  assignees: { id: string; name: string }[];
  commentCount: number;
  situation: keyof typeof DEMAND_SITUATION_LABELS;
  situationLabel: string;
  isLate: boolean;
}

export interface DemandColumnView {
  id: string;
  name: string;
  isDone: boolean;
  position: number;
  cards: DemandCard[];
}

export interface DemandTeamView {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  leadId: string | null;
  leadName: string | null;
  members: { id: string; name: string; isLead: boolean }[];
  openDemands: number;
}

export interface DemandBoardView {
  boardId: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  timeZone: string;
  columns: DemandColumnView[];
  teams: DemandTeamView[];
  people: DemandPerson[];
  summary: DemandSummary;
}

export interface DemandTimelineEntry {
  id: string;
  kind: string;
  label: string;
  fromValue: string | null;
  toValue: string | null;
  actorName: string | null;
  createdAt: Date;
}

export interface DemandCommentView {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
  mentions: { id: string; name: string }[];
}

export interface DemandDetail {
  card: DemandCard;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  timeZone: string;
  createdByName: string | null;
  createdAt: Date;
  timeline: DemandTimelineEntry[];
  comments: DemandCommentView[];
  people: DemandPerson[];
  teams: DemandTeamView[];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leituras de apoio
// ───────────────────────────────────────────────────────────────────────────────
interface EventContext {
  id: string;
  title: string;
  slug: string;
  timezone: string;
}

async function loadEvent(tx: TxClient, tenantId: string, eventId: string): Promise<EventContext | null> {
  return tx.event.findFirst({
    where: { id: eventId, tenantId, deletedAt: null },
    select: { id: true, title: true, slug: true, timezone: true },
  });
}

/**
 * Quem pode ser responsável: vínculo `MEMBER` ATIVO da instituição.
 *
 * A lista é a MESMA para atribuir, montar equipe e mencionar — uma segunda
 * definição de "quem trabalha aqui" divergiria da primeira na primeira manutenção
 * (armadilha 55).
 */
async function activeMembers(tx: TxClient, tenantId: string): Promise<DemandPerson[]> {
  const rows = await tx.userTenantProfile.findMany({
    where: { tenantId, kind: 'MEMBER', status: 'ACTIVE', deletedAt: null },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: 'asc' } },
  });

  return rows.map((row) => ({
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
  }));
}

async function activeMemberIds(tx: TxClient, tenantId: string): Promise<Set<string>> {
  const members = await activeMembers(tx, tenantId);
  return new Set(members.map((member) => member.id));
}

/**
 * O quadro do evento, criando-o na primeira visita.
 *
 * ─── POR QUE A CRIAÇÃO É PREGUIÇOSA ───────────────────────────────────────────
 *  Criar o quadro junto com o evento obrigaria a migrar todos os eventos que já
 *  existem e a manter o gancho em todo caminho que cria evento. Preguiçoso, a área
 *  nova não toca em nada do que já funcionava — e é idempotente por construção.
 *
 *  A corrida real é entre duas abas abertas ao mesmo tempo: o `upsert` do quadro
 *  pode perder para o índice único (P2002), e nesse caso a resposta certa é LER o
 *  que a outra gravou, não falhar.
 */
export async function ensureDemandBoard(
  tx: TxClient,
  tenantId: string,
  eventId: string,
): Promise<{ boardId: string; columns: { id: string; name: string; isDone: boolean; position: number }[] }> {
  let board: { id: string };

  try {
    board = await tx.demandBoard.upsert({
      where: { eventId },
      create: { tenantId, eventId },
      update: {},
      select: { id: true },
    });
  } catch {
    board = await tx.demandBoard.findUniqueOrThrow({
      where: { eventId },
      select: { id: true },
    });
  }

  await tx.demandColumn.createMany({
    data: DEFAULT_DEMAND_COLUMNS.map((column, index) => ({
      tenantId,
      boardId: board.id,
      name: column.name,
      isDone: column.isDone,
      position: (index + 1) * DEMAND_POSITION_STEP,
    })),
    skipDuplicates: true,
  });

  const columns = await tx.demandColumn.findMany({
    where: { boardId: board.id },
    select: { id: true, name: true, isDone: true, position: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });

  return { boardId: board.id, columns };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura do quadro
// ───────────────────────────────────────────────────────────────────────────────
export interface BoardFilters {
  assigneeId?: string | null;
  teamId?: string | null;
  /** `'OPEN' | 'OVERDUE' | 'DUE_TODAY' | 'DONE'` — filtro de situação. */
  situation?: string | null;
  search?: string | null;
}

export async function loadDemandBoard(input: {
  tenantId: string;
  eventId: string;
  filters?: BoardFilters;
  now?: Date;
}): Promise<{ ok: true; board: DemandBoardView } | DemandFailure> {
  const { tenantId, eventId } = input;
  const now = input.now ?? new Date();

  try {
    return await withTenant(tenantId, async (tx) => {
      const event = await loadEvent(tx, tenantId, eventId);
      if (!event) return fail('NOT_FOUND', 'Evento não encontrado.');

      const { boardId, columns } = await ensureDemandBoard(tx, tenantId, eventId);

      const demands = await tx.demand.findMany({
        where: { tenantId, boardId },
        select: {
          id: true,
          columnId: true,
          title: true,
          description: true,
          priority: true,
          position: true,
          startAt: true,
          dueAt: true,
          completedAt: true,
          teamId: true,
          team: { select: { name: true } },
          assignees: { select: { user: { select: { id: true, name: true } } } },
          _count: { select: { comments: true } },
        },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });

      const cards: DemandCard[] = demands.map((demand) => {
        const situation = demandSituation(demand, now, event.timezone);

        return {
          id: demand.id,
          columnId: demand.columnId,
          title: demand.title,
          description: demand.description,
          priority: demand.priority,
          priorityLabel: priorityLabel(demand.priority),
          position: demand.position,
          startAt: demand.startAt,
          dueAt: demand.dueAt,
          dueLabel: dueStatusLabel(demand, now, event.timezone),
          completedAt: demand.completedAt,
          teamId: demand.teamId,
          teamName: demand.team?.name ?? null,
          assignees: demand.assignees.map((assignee) => assignee.user),
          commentCount: demand._count.comments,
          situation,
          situationLabel: DEMAND_SITUATION_LABELS[situation],
          isLate: situation === 'OVERDUE',
        };
      });

      const filtered = filterCards(cards, input.filters ?? {});

      const summary = boardSummary(
        cards.map((card) => ({
          id: card.id,
          dueAt: card.dueAt,
          completedAt: card.completedAt,
          teamId: card.teamId,
          assigneeIds: card.assignees.map((assignee) => assignee.id),
        })),
        now,
        event.timezone,
      );

      return {
        ok: true as const,
        board: {
          boardId,
          eventId: event.id,
          eventTitle: event.title,
          eventSlug: event.slug,
          timeZone: event.timezone,
          columns: columns.map((column) => ({
            ...column,
            cards: filtered.filter((card) => card.columnId === column.id),
          })),
          teams: await loadTeams(tx, tenantId, eventId),
          people: await activeMembers(tx, tenantId),
          summary,
        },
      };
    });
  } catch (error) {
    console.error(`[demandas] falha ao ler o quadro: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível carregar o quadro de demandas.');
  }
}

function filterCards(cards: readonly DemandCard[], filters: BoardFilters): DemandCard[] {
  const search = filters.search?.trim().toLowerCase() ?? '';

  return cards.filter((card) => {
    if (filters.assigneeId && !card.assignees.some((a) => a.id === filters.assigneeId)) return false;
    if (filters.teamId && card.teamId !== filters.teamId) return false;
    if (filters.situation && card.situation !== filters.situation) return false;
    if (search) {
      const haystack = `${card.title} ${card.description ?? ''} ${card.assignees
        .map((a) => a.name)
        .join(' ')}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

async function loadTeams(
  tx: TxClient,
  tenantId: string,
  eventId: string,
): Promise<DemandTeamView[]> {
  const teams = await tx.eventTeam.findMany({
    where: { tenantId, eventId },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      members: {
        select: { isLead: true, user: { select: { id: true, name: true } } },
        orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
      },
      demands: { select: { completedAt: true } },
    },
    orderBy: { name: 'asc' },
  });

  return teams.map((team) => {
    const lead = team.members.find((member) => member.isLead);

    return {
      id: team.id,
      name: team.name,
      description: team.description,
      isActive: team.isActive,
      leadId: lead?.user.id ?? null,
      leadName: lead?.user.name ?? null,
      members: team.members.map((member) => ({
        id: member.user.id,
        name: member.user.name,
        isLead: member.isLead,
      })),
      openDemands: team.demands.filter((demand) => demand.completedAt === null).length,
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ficha da demanda
// ───────────────────────────────────────────────────────────────────────────────
export async function loadDemandDetail(input: {
  tenantId: string;
  demandId: string;
  now?: Date;
}): Promise<{ ok: true; detail: DemandDetail } | DemandFailure> {
  const { tenantId, demandId } = input;
  const now = input.now ?? new Date();

  try {
    return await withTenant(tenantId, async (tx) => {
      const demand = await tx.demand.findFirst({
        where: { id: demandId, tenantId },
        select: {
          id: true,
          columnId: true,
          title: true,
          description: true,
          priority: true,
          position: true,
          startAt: true,
          dueAt: true,
          completedAt: true,
          teamId: true,
          createdAt: true,
          eventId: true,
          team: { select: { name: true } },
          createdBy: { select: { name: true } },
          assignees: { select: { user: { select: { id: true, name: true } } } },
          _count: { select: { comments: true } },
          event: { select: { title: true, slug: true, timezone: true } },
        },
      });

      if (!demand) return fail('NOT_FOUND', 'Demanda não encontrada.');

      const situation = demandSituation(demand, now, demand.event.timezone);

      const card: DemandCard = {
        id: demand.id,
        columnId: demand.columnId,
        title: demand.title,
        description: demand.description,
        priority: demand.priority,
        priorityLabel: priorityLabel(demand.priority),
        position: demand.position,
        startAt: demand.startAt,
        dueAt: demand.dueAt,
        dueLabel: dueStatusLabel(demand, now, demand.event.timezone),
        completedAt: demand.completedAt,
        teamId: demand.teamId,
        teamName: demand.team?.name ?? null,
        assignees: demand.assignees.map((assignee) => assignee.user),
        commentCount: demand._count.comments,
        situation,
        situationLabel: DEMAND_SITUATION_LABELS[situation],
        isLate: situation === 'OVERDUE',
      };

      const [timeline, comments] = await Promise.all([
        tx.demandEvent.findMany({
          where: { tenantId, demandId },
          select: {
            id: true,
            kind: true,
            fromValue: true,
            toValue: true,
            createdAt: true,
            actor: { select: { name: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 60,
        }),
        tx.demandComment.findMany({
          where: { tenantId, demandId },
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: { select: { id: true, name: true } },
            mentions: { select: { user: { select: { id: true, name: true } } } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 200,
        }),
      ]);

      return {
        ok: true as const,
        detail: {
          card,
          eventId: demand.eventId,
          eventTitle: demand.event.title,
          eventSlug: demand.event.slug,
          timeZone: demand.event.timezone,
          createdByName: demand.createdBy?.name ?? null,
          createdAt: demand.createdAt,
          timeline: timeline.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            label: demandEventLabel(entry.kind),
            fromValue: entry.fromValue,
            toValue: entry.toValue,
            actorName: entry.actor?.name ?? null,
            createdAt: entry.createdAt,
          })),
          comments: comments.map((comment) => ({
            id: comment.id,
            body: comment.body,
            authorId: comment.author.id,
            authorName: comment.author.name,
            createdAt: comment.createdAt,
            mentions: comment.mentions.map((mention) => mention.user),
          })),
          people: await activeMembers(tx, tenantId),
          teams: await loadTeams(tx, tenantId, demand.eventId),
        },
      };
    });
  } catch (error) {
    console.error(`[demandas] falha ao ler a demanda: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível carregar a demanda.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita: linha do tempo e trilha
// ───────────────────────────────────────────────────────────────────────────────
async function recordTimeline(
  tx: TxClient,
  input: {
    tenantId: string;
    demandId: string;
    actorId: string | null;
    kind: string;
    fromValue?: string | null;
    toValue?: string | null;
  },
): Promise<void> {
  await tx.demandEvent.create({
    data: {
      tenantId: input.tenantId,
      demandId: input.demandId,
      actorId: input.actorId,
      kind: input.kind,
      fromValue: input.fromValue?.slice(0, 200) ?? null,
      toValue: input.toValue?.slice(0, 200) ?? null,
    },
  });
}

async function audit(
  tx: TxClient,
  input: {
    tenantId: string;
    actorId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    demandId: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  },
): Promise<void> {
  await recordAudit(
    {
      tenantId: input.tenantId,
      userId: input.actorId,
      action: input.action,
      entityType: 'Demand',
      entityId: input.demandId,
      changes: input.changes,
    },
    tx,
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita: criar demanda
// ───────────────────────────────────────────────────────────────────────────────
export interface CreateDemandInput {
  tenantId: string;
  eventId: string;
  actorId: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  columnId?: string | null;
  teamId?: string | null;
  startAt?: Date | null;
  dueAt?: Date | null;
  assigneeIds?: readonly string[];
}

export async function createDemand(
  input: CreateDemandInput,
): Promise<{ ok: true; demandId: string; notices: NoticeOutcome[] } | DemandFailure> {
  const title = normalizeDemandTitle(input.title);
  if (!title) return fail('TITLE_REQUIRED', 'Dê um título à demanda.');

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const event = await loadEvent(tx, input.tenantId, input.eventId);
      if (!event) return fail('NOT_FOUND', 'Evento não encontrado.');

      const { boardId, columns } = await ensureDemandBoard(tx, input.tenantId, input.eventId);

      const column = input.columnId
        ? columns.find((candidate) => candidate.id === input.columnId)
        : firstColumn(columns);

      if (!column) return fail('COLUMN_NOT_FOUND', 'A coluna escolhida não existe neste quadro.');

      const teamId = await resolveTeamId(tx, input.tenantId, input.eventId, input.teamId ?? null);
      if (teamId === false) return fail('TEAM_NOT_FOUND', 'A equipe escolhida não é deste evento.');

      const members = await activeMemberIds(tx, input.tenantId);
      const assigneeIds = [...new Set(input.assigneeIds ?? [])].filter((id) => members.has(id));

      if ((input.assigneeIds ?? []).length > 0 && assigneeIds.length !== new Set(input.assigneeIds).size) {
        return fail('NOT_A_MEMBER', 'Só a equipe ativa da instituição pode ser responsável.');
      }

      const last = await tx.demand.findFirst({
        where: { tenantId: input.tenantId, boardId, columnId: column.id, completedAt: null },
        select: { position: true },
        orderBy: { position: 'desc' },
      });

      const demand = await tx.demand.create({
        data: {
          tenantId: input.tenantId,
          boardId,
          eventId: input.eventId,
          columnId: column.id,
          teamId: teamId ?? null,
          position: (last?.position ?? 0) + DEMAND_POSITION_STEP,
          title,
          description: normalizeDemandDescription(input.description ?? null),
          priority: normalizeDemandPriority(input.priority),
          startAt: input.startAt ?? null,
          dueAt: input.dueAt ?? null,
          /** Nasce concluída se a coluna escolhida for de conclusão. */
          completedAt: column.isDone ? new Date() : null,
          createdById: input.actorId,
        },
        select: { id: true, completedAt: true },
      });

      if (assigneeIds.length > 0) {
        await tx.demandAssignee.createMany({
          data: assigneeIds.map((userId) => ({
            tenantId: input.tenantId,
            demandId: demand.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      await recordTimeline(tx, {
        tenantId: input.tenantId,
        demandId: demand.id,
        actorId: input.actorId,
        kind: 'CREATED',
        toValue: title,
      });

      await audit(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'CREATE',
        demandId: demand.id,
        changes: { title: { from: null, to: title }, column: { from: null, to: column.name } },
      });

      return { ok: true as const, demandId: demand.id, assigneeIds, event, title };
    });

    if (!result.ok) return result;

    /**
     * Os avisos saem DEPOIS do commit, um por pessoa nova. Falha aqui não desfaz a
     * demanda — e o `dedupeKey` de cada um carrega o FATO (a linha da atribuição),
     * então repetir não duplica o e-mail.
     */
    const notices: NoticeOutcome[] = [];
    for (const userId of result.assigneeIds) {
      notices.push(
        await notifyDemandAssigned({
          tenantId: input.tenantId,
          demandId: result.demandId,
          userId,
          actorId: input.actorId,
        }),
      );
    }

    return { ok: true, demandId: result.demandId, notices };
  } catch (error) {
    console.error(`[demandas] falha ao criar demanda: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível criar a demanda.');
  }
}

/** `false` = a equipe informada não é deste evento (o chamador decide a mensagem). */
async function resolveTeamId(
  tx: TxClient,
  tenantId: string,
  eventId: string,
  teamId: string | null,
): Promise<string | null | false> {
  if (!teamId) return null;

  const team = await tx.eventTeam.findFirst({
    where: { id: teamId, tenantId, eventId },
    select: { id: true },
  });

  return team ? team.id : false;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita: editar demanda
// ───────────────────────────────────────────────────────────────────────────────
export interface UpdateDemandInput {
  tenantId: string;
  demandId: string;
  actorId: string;
  title?: string | null;
  description?: string | null;
  priority?: string | null;
  teamId?: string | null;
  startAt?: Date | null;
  dueAt?: Date | null;
}

export async function updateDemand(input: UpdateDemandInput): Promise<{ ok: true } | DemandFailure> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const demand = await tx.demand.findFirst({
        where: { id: input.demandId, tenantId: input.tenantId },
        select: {
          id: true,
          eventId: true,
          title: true,
          description: true,
          priority: true,
          teamId: true,
          startAt: true,
          dueAt: true,
          team: { select: { name: true } },
        },
      });

      if (!demand) return fail('NOT_FOUND', 'Demanda não encontrada.');

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const data: Record<string, unknown> = {};

      if (input.title !== undefined) {
        const title = normalizeDemandTitle(input.title);
        if (!title) return fail('TITLE_REQUIRED', 'Dê um título à demanda.');
        if (title !== demand.title) {
          changes['title'] = { from: demand.title, to: title };
          data['title'] = title;
        }
      }

      if (input.description !== undefined) {
        const description = normalizeDemandDescription(input.description);
        if (description !== demand.description) {
          changes['description'] = { from: demand.description, to: description };
          data['description'] = description;
        }
      }

      if (input.priority !== undefined) {
        const priority = normalizeDemandPriority(input.priority);
        if (priority !== demand.priority) {
          changes['priority'] = { from: demand.priority, to: priority };
          data['priority'] = priority;
        }
      }

      if (input.startAt !== undefined && input.startAt?.getTime() !== demand.startAt?.getTime()) {
        changes['startAt'] = { from: demand.startAt, to: input.startAt };
        data['startAt'] = input.startAt;
      }

      if (input.dueAt !== undefined && input.dueAt?.getTime() !== demand.dueAt?.getTime()) {
        changes['dueAt'] = { from: demand.dueAt, to: input.dueAt };
        data['dueAt'] = input.dueAt;
      }

      if (input.teamId !== undefined) {
        const teamId = await resolveTeamId(tx, input.tenantId, demand.eventId, input.teamId);
        if (teamId === false) return fail('TEAM_NOT_FOUND', 'A equipe escolhida não é deste evento.');

        if (teamId !== demand.teamId) {
          changes['team'] = { from: demand.team?.name ?? null, to: null };
          data['teamId'] = teamId;

          const team = teamId
            ? await tx.eventTeam.findUnique({ where: { id: teamId }, select: { name: true } })
            : null;
          changes['team'] = { from: demand.team?.name ?? null, to: team?.name ?? null };
        }
      }

      if (Object.keys(data).length === 0) return { ok: true as const };

      await tx.demand.update({ where: { id: demand.id }, data });

      await recordTimeline(tx, {
        tenantId: input.tenantId,
        demandId: demand.id,
        actorId: input.actorId,
        kind: 'UPDATED',
        fromValue: Object.keys(changes).join(', ').slice(0, 200) || null,
        toValue: null,
      });

      await audit(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'UPDATE',
        demandId: demand.id,
        changes,
      });

      return { ok: true as const };
    });
  } catch (error) {
    console.error(`[demandas] falha ao editar demanda: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível salvar a demanda.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita: mover (o ato central do quadro)
// ───────────────────────────────────────────────────────────────────────────────
export interface MoveDemandInput {
  tenantId: string;
  demandId: string;
  actorId: string;
  /** A coluna em que a tela VIU o cartão — é o que detecta a corrida. */
  fromColumnId: string;
  toColumnId: string;
  /** Índice de destino dentro da coluna, já sem o cartão movido. */
  toIndex?: number;
}

/**
 * Move o cartão de coluna, na posição pedida.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A CORRIDA É DECIDIDA PELO BANCO (invariante nº 5)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Dois monitores com o quadro aberto: um arrasta "Montar os crachás" para
 *  "Em andamento", o outro (ainda vendo o cartão em "A fazer") arrasta o MESMO
 *  cartão para "Bloqueado". O `updateMany` condicional pelo `columnId` de origem
 *  deixa o primeiro vencer e o segundo receber `ALREADY_MOVED` — em vez de os dois
 *  gravarem e a posição final ser a de quem o banco atendeu por último.
 *
 *  `completedAt` acompanha a COLUNA de destino: entrar numa coluna `isDone` carimba
 *  a conclusão, e sair dela limpa o carimbo.
 */
export async function moveDemand(
  input: MoveDemandInput,
): Promise<{ ok: true; completed: boolean } | DemandFailure> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const demand = await tx.demand.findFirst({
        where: { id: input.demandId, tenantId: input.tenantId },
        select: { id: true, boardId: true, columnId: true, completedAt: true, title: true },
      });

      if (!demand) return fail('NOT_FOUND', 'Demanda não encontrada.');

      const target = await tx.demandColumn.findFirst({
        where: { id: input.toColumnId, tenantId: input.tenantId },
        select: { id: true, name: true, isDone: true },
      });

      if (!target) return fail('COLUMN_NOT_FOUND', 'A coluna de destino não existe.');

      const origin = await tx.demandColumn.findFirst({
        where: { id: demand.columnId, tenantId: input.tenantId },
        select: { id: true, name: true },
      });

      /**
       * Posição de destino: entre as vizinhas da coluna alvo.
       *
       * Quando não há folga entre elas (duas posições consecutivas), o plano é
       * reescrever a coluna inteira — é o que `positionBetween` devolve `null` para
       * dizer.
       */
      const siblings = await tx.demand.findMany({
        where: {
          tenantId: input.tenantId,
          boardId: demand.boardId,
          columnId: target.id,
          id: { not: demand.id },
        },
        select: { id: true, position: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });

      const index = Math.max(0, Math.min(input.toIndex ?? siblings.length, siblings.length));
      const before = index === 0 ? null : (siblings[index - 1]?.position ?? null);
      const after = index >= siblings.length ? null : (siblings[index]?.position ?? null);

      const midpoint = positionBetween(before, after);
      const sameColumn = demand.columnId === target.id;

      const completedAt = target.isDone ? (demand.completedAt ?? new Date()) : null;

      /**
       * O `updateMany` condicional é a trava. `sameColumn` compara com o que a TELA
       * viu (`fromColumnId`) e não com o que o banco acabou de ler: se outra pessoa
       * moveu entre a leitura e a escrita, a atualização não casa.
       */
      const claimed = await tx.demand.updateMany({
        where: { id: demand.id, tenantId: input.tenantId, columnId: input.fromColumnId },
        data: {
          columnId: target.id,
          position: midpoint ?? 0,
          completedAt,
        },
      });

      if (claimed.count === 0) {
        return fail('ALREADY_MOVED', 'Alguém moveu esta demanda antes de você. Recarregue o quadro.');
      }

      /** Sem folga: reescreve a coluna de destino inteira, com o cartão no lugar. */
      if (midpoint === null) {
        const ordered = [...siblings];
        ordered.splice(index, 0, { id: demand.id, position: 0 });

        for (const row of planReorder(ordered.map((row) => row.id))) {
          await tx.demand.update({ where: { id: row.id }, data: { position: row.position } });
        }
      }

      /** A coluna de ORIGEM também é reindexada: buraco em 10, 20, 30 não dói, mas
       *  a folga acabando em toda movimentação dói — é ela que evita reescrever. */
      if (!sameColumn && origin) {
        const originRows = await tx.demand.findMany({
          where: { tenantId: input.tenantId, boardId: demand.boardId, columnId: origin.id },
          select: { id: true },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
        });

        const plan = planReorder(originRows.map((row) => row.id));

        for (const row of plan) {
          await tx.demand.update({ where: { id: row.id }, data: { position: row.position } });
        }
      }

      const kind = target.isDone && !demand.completedAt ? 'COMPLETED' : !target.isDone && demand.completedAt ? 'REOPENED' : 'MOVED';

      await recordTimeline(tx, {
        tenantId: input.tenantId,
        demandId: demand.id,
        actorId: input.actorId,
        kind,
        fromValue: origin?.name ?? null,
        toValue: target.name,
      });

      await audit(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'UPDATE',
        demandId: demand.id,
        changes: { column: { from: origin?.name ?? null, to: target.name } },
      });

      return { ok: true as const, completed: target.isDone };
    });
  } catch (error) {
    console.error(`[demandas] falha ao mover demanda: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível mover a demanda.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita: atribuir pessoas
// ───────────────────────────────────────────────────────────────────────────────
export async function setDemandAssignees(input: {
  tenantId: string;
  demandId: string;
  actorId: string;
  userIds: readonly string[];
  teamId?: string | null;
  /**
   * Caminho ESTREITO (`demand:assign:own-team`): quem age só distribui dentro da
   * equipe que LIDERA. A posse é conferida aqui, no dado — o RBAC não sabe o que é
   * "minha equipe", ele só sabe que o papel pode tentar.
   */
  leadOnly?: boolean;
}): Promise<{ ok: true; notices: NoticeOutcome[] } | DemandFailure> {
  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const demand = await tx.demand.findFirst({
        where: { id: input.demandId, tenantId: input.tenantId },
        select: {
          id: true,
          eventId: true,
          teamId: true,
          assignees: { select: { userId: true } },
        },
      });

      if (!demand) return fail('NOT_FOUND', 'Demanda não encontrada.');

      if (input.leadOnly) {
        const leading = await tx.eventTeamMember.findMany({
          where: { tenantId: input.tenantId, userId: input.actorId, isLead: true },
          select: { teamId: true },
        });

        const teamId = input.teamId !== undefined ? input.teamId : demand.teamId;

        if (!leadsTeam(teamId, leading.map((row) => row.teamId))) {
          return fail(
            'NOT_LEADER',
            'Você só distribui demandas dentro da equipe que lidera.',
          );
        }

        /**
         * E só entre os MEMBROS dela: o líder não recruta gente de fora da própria
         * equipe — quem faz isso é quem coordena o evento.
         */
        const teamMembers = await tx.eventTeamMember.findMany({
          where: { tenantId: input.tenantId, teamId: teamId!, userId: { in: [...input.userIds] } },
          select: { userId: true },
        });

        const allowed = new Set(teamMembers.map((row) => row.userId));

        if (input.userIds.some((id) => id.length > 0 && !allowed.has(id))) {
          return fail('NOT_LEADER', 'Só os membros da sua equipe podem ficar com a demanda.');
        }
      }

      const members = await activeMemberIds(tx, input.tenantId);
      const wanted = [...new Set(input.userIds)].filter((id) => id.length > 0);

      if (wanted.some((id) => !members.has(id))) {
        return fail('NOT_A_MEMBER', 'Só a equipe ativa da instituição pode ser responsável.');
      }

      if (input.teamId !== undefined) {
        const teamId = await resolveTeamId(tx, input.tenantId, demand.eventId, input.teamId);
        if (teamId === false) return fail('TEAM_NOT_FOUND', 'A equipe escolhida não é deste evento.');

        if (teamId !== demand.teamId) {
          await tx.demand.update({ where: { id: demand.id }, data: { teamId: teamId ?? null } });
          await recordTimeline(tx, {
            tenantId: input.tenantId,
            demandId: demand.id,
            actorId: input.actorId,
            kind: 'TEAM_CHANGED',
            toValue: teamId ?? 'sem equipe',
          });
        }
      }

      const current = new Set(demand.assignees.map((assignee) => assignee.userId));
      const added = wanted.filter((id) => !current.has(id));
      const removed = [...current].filter((id) => !wanted.includes(id));

      /** Substituição por inteiro: trocar duas pessoas de lugar linha a linha
       *  esbarraria no índice único `(demandId, userId)` — o mesmo motivo da
       *  autoria de submissão (FASE 17). */
      if (removed.length > 0) {
        await tx.demandAssignee.deleteMany({
          where: { tenantId: input.tenantId, demandId: demand.id, userId: { in: removed } },
        });
      }

      if (added.length > 0) {
        await tx.demandAssignee.createMany({
          data: added.map((userId) => ({
            tenantId: input.tenantId,
            demandId: demand.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      if (added.length > 0 || removed.length > 0) {
        const names = await tx.user.findMany({
          where: { id: { in: [...added, ...removed] } },
          select: { id: true, name: true },
        });
        const nameOf = (id: string): string => names.find((row) => row.id === id)?.name ?? id;

        await recordTimeline(tx, {
          tenantId: input.tenantId,
          demandId: demand.id,
          actorId: input.actorId,
          kind: added.length > 0 ? 'ASSIGNED' : 'UNASSIGNED',
          fromValue: removed.length > 0 ? removed.map(nameOf).join(', ') : null,
          toValue: added.length > 0 ? added.map(nameOf).join(', ') : null,
        });

        await audit(tx, {
          tenantId: input.tenantId,
          actorId: input.actorId,
          action: 'UPDATE',
          demandId: demand.id,
          changes: {
            assignees: {
              from: [...current].map(nameOf),
              to: wanted.map(nameOf),
            },
          },
        });
      }

      return { ok: true as const, added };
    });

    if (!result.ok) return result;

    const notices: NoticeOutcome[] = [];
    for (const userId of result.added) {
      notices.push(
        await notifyDemandAssigned({
          tenantId: input.tenantId,
          demandId: input.demandId,
          userId,
          actorId: input.actorId,
        }),
      );
    }

    return { ok: true, notices };
  } catch (error) {
    console.error(`[demandas] falha ao atribuir demanda: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível salvar os responsáveis.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita: comentar (com menção)
// ───────────────────────────────────────────────────────────────────────────────
export async function addDemandComment(input: {
  tenantId: string;
  demandId: string;
  actorId: string;
  body: string;
  mentionIds?: readonly string[];
}): Promise<{ ok: true; commentId: string; notices: NoticeOutcome[] } | DemandFailure> {
  const body = normalizeDemandComment(input.body);
  if (!body) return fail('COMMENT_REQUIRED', 'Escreva o comentário.');

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const demand = await tx.demand.findFirst({
        where: { id: input.demandId, tenantId: input.tenantId },
        select: { id: true, title: true },
      });

      if (!demand) return fail('NOT_FOUND', 'Demanda não encontrada.');

      const members = await activeMemberIds(tx, input.tenantId);
      const mentions = normalizeMentionIds(input.mentionIds ?? [], members, input.actorId);

      const comment = await tx.demandComment.create({
        data: {
          tenantId: input.tenantId,
          demandId: demand.id,
          authorId: input.actorId,
          body,
        },
        select: { id: true },
      });

      if (mentions.length > 0) {
        await tx.demandMention.createMany({
          data: mentions.map((userId) => ({
            tenantId: input.tenantId,
            commentId: comment.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      await recordTimeline(tx, {
        tenantId: input.tenantId,
        demandId: demand.id,
        actorId: input.actorId,
        kind: 'COMMENTED',
        toValue: body.slice(0, 200),
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'DemandComment',
          entityId: comment.id,
          changes: { demand: { from: null, to: demand.title } },
        },
        tx,
      );

      return { ok: true as const, commentId: comment.id, mentions };
    });

    if (!result.ok) return result;

    const notices: NoticeOutcome[] = [];
    for (const userId of result.mentions) {
      notices.push(
        await notifyDemandMention({
          tenantId: input.tenantId,
          commentId: result.commentId,
          userId,
          actorId: input.actorId,
        }),
      );
    }

    return { ok: true, commentId: result.commentId, notices };
  } catch (error) {
    console.error(`[demandas] falha ao comentar: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível salvar o comentário.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita: excluir demanda
// ───────────────────────────────────────────────────────────────────────────────
export async function deleteDemand(input: {
  tenantId: string;
  demandId: string;
  actorId: string;
}): Promise<{ ok: true } | DemandFailure> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const demand = await tx.demand.findFirst({
        where: { id: input.demandId, tenantId: input.tenantId },
        select: { id: true, title: true, boardId: true, columnId: true },
      });

      if (!demand) return fail('NOT_FOUND', 'Demanda não encontrada.');

      await tx.demand.delete({ where: { id: demand.id } });

      /** A trilha guarda o FATO: a linha do cartão sai com ele (cascade), e é a
       *  auditoria que responde "quem apagou o quê" depois. */
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'Demand',
          entityId: demand.id,
          changes: { title: { from: demand.title, to: null } },
        },
        tx,
      );

      const remaining = await tx.demand.findMany({
        where: { tenantId: input.tenantId, boardId: demand.boardId, columnId: demand.columnId },
        select: { id: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });

      for (const row of planReorder(remaining.map((row) => row.id))) {
        await tx.demand.update({ where: { id: row.id }, data: { position: row.position } });
      }

      return { ok: true as const };
    });
  } catch (error) {
    console.error(`[demandas] falha ao excluir demanda: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível excluir a demanda.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Colunas
// ───────────────────────────────────────────────────────────────────────────────
export async function createDemandColumn(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  name: string;
  isDone?: boolean;
}): Promise<{ ok: true; columnId: string } | DemandFailure> {
  const name = normalizeColumnName(input.name);
  if (!name) return fail('INVALID_INPUT', 'Dê um nome à coluna.');

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const { boardId } = await ensureDemandBoard(tx, input.tenantId, input.eventId);

      const existing = await tx.demandColumn.findFirst({
        where: { boardId, name },
        select: { id: true },
      });

      if (existing) return fail('COLUMN_NAME_TAKEN', `Já existe uma coluna chamada "${name}".`);

      const last = await tx.demandColumn.findFirst({
        where: { boardId },
        select: { position: true },
        orderBy: { position: 'desc' },
      });

      const column = await tx.demandColumn.create({
        data: {
          tenantId: input.tenantId,
          boardId,
          name,
          isDone: input.isDone ?? false,
          position: (last?.position ?? 0) + DEMAND_POSITION_STEP,
        },
        select: { id: true },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'DemandColumn',
          entityId: column.id,
          changes: { name: { from: null, to: name } },
        },
        tx,
      );

      return { ok: true as const, columnId: column.id };
    });
  } catch (error) {
    console.error(`[demandas] falha ao criar coluna: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível criar a coluna.');
  }
}

export async function updateDemandColumn(input: {
  tenantId: string;
  columnId: string;
  actorId: string;
  name?: string | null;
  isDone?: boolean;
}): Promise<{ ok: true } | DemandFailure> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const column = await tx.demandColumn.findFirst({
        where: { id: input.columnId, tenantId: input.tenantId },
        select: { id: true, boardId: true, name: true, isDone: true },
      });

      if (!column) return fail('NOT_FOUND', 'Coluna não encontrada.');

      const data: Record<string, unknown> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (input.name !== undefined) {
        const name = normalizeColumnName(input.name);
        if (!name) return fail('INVALID_INPUT', 'Dê um nome à coluna.');

        if (name !== column.name) {
          const taken = await tx.demandColumn.findFirst({
            where: { boardId: column.boardId, name, id: { not: column.id } },
            select: { id: true },
          });
          if (taken) return fail('COLUMN_NAME_TAKEN', `Já existe uma coluna chamada "${name}".`);

          data['name'] = name;
          changes['name'] = { from: column.name, to: name };
        }
      }

      if (input.isDone !== undefined && input.isDone !== column.isDone) {
        /** Desmarcar a ÚLTIMA coluna de conclusão deixaria o quadro sem lugar para
         *  concluir — e `completedAt` nunca mais seria gravado. */
        if (!input.isDone) {
          const others = await tx.demandColumn.count({
            where: { boardId: column.boardId, isDone: true, id: { not: column.id } },
          });
          if (others === 0) {
            return fail(
              'DONE_COLUMN_REQUIRED',
              'O quadro precisa de uma coluna de conclusão: marque outra antes de desmarcar esta.',
            );
          }
        }

        data['isDone'] = input.isDone;
        changes['isDone'] = { from: column.isDone, to: input.isDone };
      }

      if (Object.keys(data).length === 0) return { ok: true as const };

      await tx.demandColumn.update({ where: { id: column.id }, data });
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'DemandColumn',
          entityId: column.id,
          changes,
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    console.error(`[demandas] falha ao editar coluna: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível salvar a coluna.');
  }
}

export async function deleteDemandColumn(input: {
  tenantId: string;
  columnId: string;
  actorId: string;
}): Promise<{ ok: true } | DemandFailure> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const column = await tx.demandColumn.findFirst({
        where: { id: input.columnId, tenantId: input.tenantId },
        select: { id: true, boardId: true, name: true, isDone: true },
      });

      if (!column) return fail('NOT_FOUND', 'Coluna não encontrada.');

      const total = await tx.demandColumn.count({ where: { boardId: column.boardId } });
      if (total <= 1) {
        return fail('LAST_COLUMN', 'O quadro precisa de ao menos uma coluna.');
      }

      /** Apagar a coluna de conclusão apagaria o significado de "terminado". */
      if (column.isDone) {
        return fail(
          'DONE_COLUMN_REQUIRED',
          'Esta é a coluna de conclusão: marque outra antes de excluí-la.',
        );
      }

      const cards = await tx.demand.count({ where: { columnId: column.id } });
      if (cards > 0) {
        return fail(
          'TEAM_IN_USE',
          `Esta coluna tem ${cards} demanda(s). Mova os cartões antes de excluí-la.`,
        );
      }

      await tx.demandColumn.delete({ where: { id: column.id } });
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'DemandColumn',
          entityId: column.id,
          changes: { name: { from: column.name, to: null } },
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    console.error(`[demandas] falha ao excluir coluna: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível excluir a coluna.');
  }
}

export async function reorderDemandColumns(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  columnIds: readonly string[];
}): Promise<{ ok: true } | DemandFailure> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const { boardId, columns } = await ensureDemandBoard(tx, input.tenantId, input.eventId);

      const known = new Set(columns.map((column) => column.id));
      const ordered = input.columnIds.filter((id) => known.has(id));

      if (ordered.length !== columns.length) {
        return fail('INVALID_INPUT', 'A ordem enviada não corresponde às colunas do quadro.');
      }

      for (const row of ordered.map((id, index) => ({ id, position: (index + 1) * DEMAND_POSITION_STEP }))) {
        await tx.demandColumn.update({ where: { id: row.id }, data: { position: row.position } });
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'DemandColumn',
          entityId: boardId,
          changes: { order: { from: null, to: ordered.join(',') } },
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    console.error(`[demandas] falha ao reordenar colunas: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível reordenar as colunas.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Equipes do evento
// ───────────────────────────────────────────────────────────────────────────────
export async function createEventTeam(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  name: string;
  description?: string | null;
  memberIds?: readonly string[];
  leadId?: string | null;
}): Promise<{ ok: true; teamId: string } | DemandFailure> {
  const name = normalizeColumnName(input.name);
  if (!name) return fail('INVALID_INPUT', 'Dê um nome à equipe.');

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await loadEvent(tx, input.tenantId, input.eventId);
      if (!event) return fail('NOT_FOUND', 'Evento não encontrado.');

      const taken = await tx.eventTeam.findFirst({
        where: { tenantId: input.tenantId, eventId: input.eventId, name },
        select: { id: true },
      });
      if (taken) return fail('TEAM_NAME_TAKEN', `Já existe uma equipe chamada "${name}".`);

      const members = await activeMemberIds(tx, input.tenantId);
      const wanted = [...new Set([...(input.memberIds ?? []), ...(input.leadId ? [input.leadId] : [])])];

      if (wanted.some((id) => !members.has(id))) {
        return fail('NOT_A_MEMBER', 'Só a equipe ativa da instituição entra numa equipe de evento.');
      }

      const team = await tx.eventTeam.create({
        data: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          name,
          description: normalizeDemandDescription(input.description ?? null)?.slice(0, 300) ?? null,
        },
        select: { id: true },
      });

      if (wanted.length > 0) {
        await tx.eventTeamMember.createMany({
          data: wanted.map((userId) => ({
            tenantId: input.tenantId,
            teamId: team.id,
            userId,
            isLead: userId === input.leadId,
          })),
          skipDuplicates: true,
        });
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'EventTeam',
          entityId: team.id,
          changes: { name: { from: null, to: name } },
        },
        tx,
      );

      return { ok: true as const, teamId: team.id };
    });
  } catch (error) {
    console.error(`[demandas] falha ao criar equipe: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível criar a equipe.');
  }
}

/**
 * Substitui os membros da equipe e define o líder.
 *
 * ─── POR QUE O LÍDER É GRAVADO EM DUAS ETAPAS ─────────────────────────────────
 *  O índice único parcial (`WHERE "isLead"`) garante UM líder por equipe. Trocar o
 *  líder é: limpar o antigo e marcar o novo. Na ordem inversa, o segundo `UPDATE`
 *  bateria no índice enquanto o antigo ainda estivesse marcado — dentro da mesma
 *  transação, o banco não vê "o resultado final", vê cada comando.
 */
export async function setEventTeamMembers(input: {
  tenantId: string;
  teamId: string;
  actorId: string;
  memberIds: readonly string[];
  leadId?: string | null;
}): Promise<{ ok: true } | DemandFailure> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const team = await tx.eventTeam.findFirst({
        where: { id: input.teamId, tenantId: input.tenantId },
        select: { id: true, eventId: true, name: true },
      });

      if (!team) return fail('NOT_FOUND', 'Equipe não encontrada.');

      const members = await activeMemberIds(tx, input.tenantId);
      const wanted = [...new Set(input.memberIds.filter((id) => id.length > 0))];
      const leadId = input.leadId && wanted.includes(input.leadId) ? input.leadId : null;

      if (wanted.some((id) => !members.has(id))) {
        return fail('NOT_A_MEMBER', 'Só a equipe ativa da instituição entra numa equipe de evento.');
      }

      await tx.eventTeamMember.deleteMany({
        where: { tenantId: input.tenantId, teamId: team.id, userId: { notIn: wanted } },
      });

      await tx.eventTeamMember.updateMany({
        where: { tenantId: input.tenantId, teamId: team.id },
        data: { isLead: false },
      });

      if (wanted.length > 0) {
        await tx.eventTeamMember.createMany({
          data: wanted.map((userId) => ({
            tenantId: input.tenantId,
            teamId: team.id,
            userId,
            isLead: false,
          })),
          skipDuplicates: true,
        });
      }

      if (leadId) {
        await tx.eventTeamMember.updateMany({
          where: { tenantId: input.tenantId, teamId: team.id, userId: leadId },
          data: { isLead: true },
        });
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'EventTeam',
          entityId: team.id,
          changes: { members: { from: null, to: wanted.length } },
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    console.error(`[demandas] falha ao salvar a equipe: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível salvar a equipe.');
  }
}

export async function deleteEventTeam(input: {
  tenantId: string;
  teamId: string;
  actorId: string;
}): Promise<{ ok: true } | DemandFailure> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const team = await tx.eventTeam.findFirst({
        where: { id: input.teamId, tenantId: input.tenantId },
        select: { id: true, name: true },
      });

      if (!team) return fail('NOT_FOUND', 'Equipe não encontrada.');

      /** Equipe com demanda aberta recusa a exclusão — a mesma guarda da sala em
       *  uso (F3 revisão): a FK é `SET NULL`, e sem a guarda as demandas
       *  perderiam o responsável em silêncio. */
      const open = await tx.demand.count({
        where: { tenantId: input.tenantId, teamId: team.id, completedAt: null },
      });

      if (open > 0) {
        return fail(
          'TEAM_IN_USE',
          `Esta equipe tem ${open} demanda(s) em aberto. Conclua ou transfira antes de excluí-la.`,
        );
      }

      await tx.eventTeam.delete({ where: { id: team.id } });
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'EventTeam',
          entityId: team.id,
          changes: { name: { from: team.name, to: null } },
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    console.error(`[demandas] falha ao excluir equipe: ${errorMessage(error)}`);
    return fail('INTERNAL', 'Não foi possível excluir a equipe.');
  }
}

/**
 * De quais equipes esta pessoa é líder — a POSSE que autoriza
 * `demand:assign:own-team`.
 */
export async function leadingTeamIds(input: {
  tenantId: string;
  userId: string;
}): Promise<string[]> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const rows = await tx.eventTeamMember.findMany({
        where: { tenantId: input.tenantId, userId: input.userId, isLead: true },
        select: { teamId: true },
      });

      return rows.map((row) => row.teamId);
    });
  } catch (error) {
    console.error(`[demandas] falha ao ler a liderança: ${errorMessage(error)}`);
    return [];
  }
}

/** A ordem das colunas do quadro, do primeiro para o último. */
export async function loadColumnOrder(input: {
  tenantId: string;
  eventId: string;
}): Promise<{ id: string; name: string }[]> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const { columns } = await ensureDemandBoard(tx, input.tenantId, input.eventId);
      return columns.map((column) => ({ id: column.id, name: column.name }));
    });
  } catch (error) {
    console.error(`[demandas] falha ao ler as colunas: ${errorMessage(error)}`);
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Rotina: prazos das demandas
// ───────────────────────────────────────────────────────────────────────────────
export interface DemandDueSweepResult {
  tenants: number;
  /** Avisos de "vence amanhã" que saíram. */
  dueSoon: number;
  /** Avisos de atraso que saíram. */
  overdue: number;
  /** Avisos que não saíram (o fato já está gravado e nada foi desfeito). */
  failures: number;
}

/** Teto por instituição em uma passada — a rotina roda de hora em hora. */
const DEMAND_DUE_BATCH = 500;

/**
 * Varre os prazos das demandas em todas as instituições.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  CROSS-TENANT COMO AS OUTRAS VARREDURAS (F15, F31, F34)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O worker não tem instituição: ele lista os tenants ativos pelo `systemClient` e
 *  abre UMA transação por instituição com `withTenant`. Nenhuma linha é lida fora do
 *  contexto de tenant — o agendador não vira porta lateral.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM É AVISADO, E POR QUE A EQUIPE NÃO RECEBE CÓPIA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quem responde pela demanda são as PESSOAS atribuídas. Sem ninguém atribuído, o
 *  aviso vai para o LÍDER da equipe — porque uma demanda sem dono é exatamente o que
 *  o coordenador precisa saber, e avisar a equipe inteira encheria a caixa de todo
 *  mundo com o que é de um. Sem responsável e sem equipe, não há a quem avisar: a
 *  demanda aparece no resumo do quadro como "sem responsável".
 *
 *  A idempotência é do AVISO, não da varredura: a `dedupeKey` carrega o dia local do
 *  evento, então rodar de hora em hora (ou duas instâncias ao mesmo tempo) produz um
 *  aviso por dia — e a passada seguinte continua podendo acontecer.
 */
export async function runDemandDueSweep(
  input: { now?: Date } = {},
): Promise<DemandDueSweepResult> {
  const now = input.now ?? new Date();
  const result: DemandDueSweepResult = { tenants: 0, dueSoon: 0, overdue: 0, failures: 0 };

  try {
    const tenants = await systemClient().tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    for (const tenant of tenants) {
      result.tenants += 1;

      const pending = await withTenant(tenant.id, async (tx) => {
        const demands = await tx.demand.findMany({
          where: {
            tenantId: tenant.id,
            completedAt: null,
            dueAt: { not: null },
            /** Sem prazo não há o que avisar; sem data no passado distante a
             *  varredura não varre o histórico inteiro. */
            event: { deletedAt: null },
          },
          orderBy: { dueAt: 'asc' },
          take: DEMAND_DUE_BATCH,
          select: {
            id: true,
            dueAt: true,
            event: { select: { timezone: true } },
            assignees: { select: { userId: true } },
            team: { select: { members: { where: { isLead: true }, select: { userId: true } } } },
          },
        });

        const warnings: { demandId: string; userId: string; kind: 'DUE_SOON' | 'OVERDUE'; dayKey: string }[] = [];

        for (const demand of demands) {
          if (!demand.dueAt) continue;

          const timeZone = demand.event.timezone;
          const todayKey = localDayKey(now, timeZone);
          const dueKey = localDayKey(demand.dueAt, timeZone);

          const kind =
            dueKey < todayKey
              ? ('OVERDUE' as const)
              : dueKey === addDaysToDayKey(todayKey, DEMAND_DUE_SOON_DAYS)
                ? ('DUE_SOON' as const)
                : null;

          if (!kind) continue;

          const direct = demand.assignees.map((assignee) => assignee.userId);
          const recipients =
            direct.length > 0
              ? direct
              : demand.team?.members.map((member) => member.userId) ?? [];

          for (const userId of new Set(recipients)) {
            warnings.push({ demandId: demand.id, userId, kind, dayKey: todayKey });
          }
        }

        return warnings;
      });

      for (const warning of pending) {
        const outcome =
          warning.kind === 'DUE_SOON'
            ? await notifyDemandDueSoon({
                tenantId: tenant.id,
                demandId: warning.demandId,
                userId: warning.userId,
                dayKey: warning.dayKey,
              })
            : await notifyDemandOverdue({
                tenantId: tenant.id,
                demandId: warning.demandId,
                userId: warning.userId,
                dayKey: warning.dayKey,
              });

        if (!outcome.ok) {
          result.failures += 1;
        } else if (warning.kind === 'DUE_SOON') {
          result.dueSoon += 1;
        } else {
          result.overdue += 1;
        }
      }
    }
  } catch (error) {
    console.error(`[demandas] falha na varredura de prazos: ${errorMessage(error)}`);
  }

  return result;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Confirmação de vaga com prazo (FASE 34)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS TRÊS TRABALHOS DESTE SERVIÇO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **Confirmar** — a equipe registra que recebeu o pagamento, a doação ou o
 *       item, e a vaga deixa de estar em risco. É uma transição `PENDING →
 *       CONFIRMED` decidida por um `updateMany` CONDICIONAL: duas pessoas clicando
 *       no balcão produzem um efeito só (invariante nº 5). Confirmar NÃO mexe em
 *       contador nenhum — a vaga já estava reservada desde a inscrição; o que muda é
 *       o que ela significa.
 *    2. **Liberar o que venceu** — a varredura cancela as inscrições pendentes cujo
 *       prazo passou, devolve a vaga da atividade, devolve o lugar no evento e
 *       promove o próximo da lista de espera, tudo na MESMA transação (é a mesma
 *       esteira do cancelamento da FASE 3, e por isso ela é reusada em vez de
 *       reimplementada).
 *    3. **Lembrar** — quem está perto do prazo recebe aviso enquanto ainda dá tempo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VARREDURA É CROSS-TENANT, E ISSO É SEGURO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mesma decisão da varredura de presenças (FASE 31) e da de prazos de parecer
 *  (FASE 15): o worker não tem instituição, então lista os tenants ativos pelo
 *  `systemClient` e abre **uma transação por instituição** com `withTenant`. Nenhuma
 *  linha é lida fora do contexto de tenant — o agendador não vira porta lateral.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { systemClient, withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  EXPIRY_CANCEL_REASON,
  canConfirmRegistration,
  confirmationCountdown,
  confirmationDeadlineLabel,
  confirmationStateOf,
  parseConfirmationRequirements,
  requirementLabel,
  shouldSendConfirmationReminder,
  type ConfirmationPolicy,
  type ConfirmationState,
} from '@/domain/events/confirmation-rules';
import { promoteNextFromWaitlist } from '@/lib/events/registration-service';
import {
  canAutoConfirm,
  itemsProgress,
  itemsSummary,
  normalizeItemStatus,
  type ConfirmationItem,
} from '@/domain/events/confirmation-item-rules';
import {
  notifyConfirmationDueSoon,
  notifyRegistrationConfirmed,
  notifyRegistrationReleased,
  notifyWaitlistPromoted,
} from '@/lib/events/registration-notices';

// ───────────────────────────────────────────────────────────────────────────────
//  Confirmar (equipe)
// ───────────────────────────────────────────────────────────────────────────────
export type ConfirmationErrorCode =
  | 'NOT_FOUND'
  | 'NOT_REQUIRED'
  | 'ALREADY_CONFIRMED'
  | 'RELEASED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'ACTIVITY_CANCELED'
  | 'INTERNAL';

export type ConfirmOutcome =
  | {
      ok: true;
      registrationId: string;
      activityTitle: string;
      /** O nome de quem está na fila — a tela devolve a confirmação com o nome, não com o id. */
      personName: string;
      confirmedAt: Date;
      /** `true` quando o e-mail de recibo entrou na fila. */
      emailQueued: boolean;
    }
  | { ok: false; code: ConfirmationErrorCode; message: string };

export interface ConfirmInput {
  tenantId: string;
  registrationId: string;
  /** Quem confirma: a equipe. Vem da sessão, nunca do formulário. */
  actorId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function confirmRegistration(input: ConfirmInput): Promise<ConfirmOutcome> {
  const { tenantId, registrationId, actorId } = input;

  try {
    const prepared = await withTenant(tenantId, async (tx) => {
      const registration = await tx.registration.findFirst({
        where: { id: registrationId, tenantId, deletedAt: null },
        select: {
          id: true,
          status: true,
          confirmationDueAt: true,
          cancelReason: true,
          userId: true,
          eventId: true,
          user: { select: { name: true } },
          activity: {
            select: {
              id: true,
              title: true,
              status: true,
              confirmationPolicy: true,
            },
          },
        },
      });

      if (!registration) {
        return {
          kind: 'refusal' as const,
          code: 'NOT_FOUND' as const,
          message: 'Inscrição não encontrada.',
        };
      }

      if (!registration.activity) {
        return {
          kind: 'refusal' as const,
          code: 'NOT_REQUIRED' as const,
          message: 'Esta inscrição é do evento: não há vaga de atividade a confirmar.',
        };
      }

      /**
       * A checagem de LEITURA existe para dar mensagem boa (já confirmada, prazo
       * vencido, atividade cancelada). A decisão de verdade é o `updateMany`
       * condicional abaixo: se alguém confirmar entre a leitura e a escrita, ele
       * afeta 0 linhas e a resposta é "já confirmado".
       */
      const check = canConfirmRegistration({
        policy: registration.activity.confirmationPolicy as ConfirmationPolicy,
        status: registration.status,
        dueAt: registration.confirmationDueAt,
        now: new Date(),
        cancelReason: registration.cancelReason,
        activityCanceled: registration.activity.status === 'CANCELED',
      });

      if (!check.ok) {
        return { kind: 'refusal' as const, code: check.code as ConfirmationErrorCode, message: check.message };
      }

      const confirmedAt = new Date();

      const claimed = await tx.registration.updateMany({
        where: { id: registration.id, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          confirmedAt,
          confirmedById: actorId,
        },
      });

      if (claimed.count === 0) {
        return {
          kind: 'refusal' as const,
          code: 'ALREADY_CONFIRMED' as const,
          message: 'Esta vaga já foi confirmada por outra pessoa.',
        };
      }

      await recordAudit(
        {
          tenantId,
          userId: actorId,
          action: 'UPDATE',
          entityType: 'Registration',
          entityId: registration.id,
          changes: {
            situacao: { from: 'PENDING', to: 'CONFIRMED' },
            confirmadoPor: { from: null, to: 'equipe' },
          },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      return {
        kind: 'confirmed' as const,
        registrationId: registration.id,
        activityTitle: registration.activity.title,
        personName: registration.user.name,
        confirmedAt,
      };
    });

    if (prepared.kind === 'refusal') {
      return { ok: false, code: prepared.code, message: prepared.message };
    }

    /**
     * O RECIBO sai depois do commit: a vaga está confirmada, e o e-mail é
     * consequência. Falha de provedor não desfaz confirmação (invariante 8).
     */
    const notice = await notifyRegistrationConfirmed({
      tenantId,
      registrationId: prepared.registrationId,
    });

    return {
      ok: true,
      registrationId: prepared.registrationId,
      activityTitle: prepared.activityTitle,
      personName: prepared.personName,
      confirmedAt: prepared.confirmedAt,
      emailQueued: notice.emailQueued,
    };
  } catch (error) {
    console.error(`[confirmacao] falha ao confirmar a vaga: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível confirmar a vaga.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Confirmar item por item (FASE 37 — dívida E48)
// ───────────────────────────────────────────────────────────────────────────────
export type ItemErrorCode = 'NOT_FOUND' | 'ALREADY_RESOLVED' | 'INVALID_INPUT' | 'INTERNAL';

export type ItemOutcome =
  | {
      ok: true;
      registrationId: string;
      itemId: string;
      label: string;
      status: 'PENDING' | 'RECEIVED' | 'WAIVED';
      /** Resumo do checklist DEPOIS da marcação ("2 de 3 itens"). */
      summary: string;
      /** `true` quando esta marcação fechou o checklist e a vaga se confirmou sozinha. */
      autoConfirmed: boolean;
      /** Mensagem do que ainda falta, quando não fechou. */
      missingMessage: string | null;
    }
  | { ok: false; code: ItemErrorCode; message: string };

/**
 * Resolve UM item do checklist (recebido ou dispensado) e, se for o último obrigatório
 * que faltava, **confirma a vaga**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONFIRMAÇÃO AUTOMÁTICA CHAMA `confirmRegistration`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Porque a vaga é UMA: o caminho que a confirma (transição condicional, trilha, recibo
 *  ao participante, promoção da lista de espera quando for o caso) já existe e está
 *  testado. Reimplementar aqui "só a parte do update" daria duas confirmações no
 *  sistema — e a segunda esqueceria o aviso ou a trilha (armadilha 55).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM IMPORTA: MARCA PRIMEIRO, CONFIRMA DEPOIS
 * ─────────────────────────────────────────────────────────────────────────────
 *  A marcação do item é gravada e SÓ ENTÃO o checklist é lido de novo para decidir a
 *  confirmação. Decidir antes de gravar deixaria a vaga confirmada com o item ainda em
 *  aberto se a gravação falhasse.
 *
 *  A escrita do item é CONDICIONAL (`status = 'PENDING'`), como toda transição deste
 *  projeto: dois cliques no balcão produzem um efeito só (invariante nº 5).
 */
export interface ResolveItemInput {
  tenantId: string;
  registrationId: string;
  itemId: string;
  /** Recebido ou dispensado pela organização. */
  status: 'RECEIVED' | 'WAIVED';
  actorId: string;
  note?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function resolveConfirmationItem(input: ResolveItemInput): Promise<ItemOutcome> {
  const { tenantId, registrationId, itemId, status, actorId } = input;

  try {
    const resolved = await withTenant(tenantId, async (tx) => {
      const item = await tx.registrationConfirmationItem.findFirst({
        where: { id: itemId, registrationId, tenantId },
        select: { id: true, position: true, label: true, status: true, required: true },
      });

      if (!item) return { kind: 'refusal' as const, code: 'NOT_FOUND' as const, message: 'Item não encontrado.' };

      const claimed = await tx.registrationConfirmationItem.updateMany({
        where: { id: item.id, status: 'PENDING' },
        data: {
          status,
          resolvedAt: new Date(),
          resolvedById: actorId,
          resolutionNote: input.note?.trim() ? input.note.trim().slice(0, 300) : null,
        },
      });

      if (claimed.count === 0) {
        return {
          kind: 'refusal' as const,
          code: 'ALREADY_RESOLVED' as const,
          message: `"${item.label}" já foi resolvido por outra pessoa do balcão.`,
        };
      }

      await recordAudit(
        {
          tenantId,
          userId: actorId,
          action: 'UPDATE',
          entityType: 'RegistrationConfirmationItem',
          entityId: item.id,
          changes: {
            exigencia: { from: item.label, to: item.label },
            situacao: { from: 'PENDING', to: status },
            obrigatoria: { from: null, to: item.required ? 'sim' : 'não' },
          },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      const items = await tx.registrationConfirmationItem.findMany({
        where: { registrationId, tenantId },
        orderBy: { position: 'asc' },
        select: { position: true, kind: true, label: true, note: true, required: true, status: true },
      });

      const normalized: ConfirmationItem[] = items.map((row) => ({
        position: row.position,
        kind: row.kind,
        label: row.label,
        note: row.note,
        required: row.required,
        status: normalizeItemStatus(row.status),
      }));

      return {
        kind: 'resolved' as const,
        itemId: item.id,
        label: item.label,
        summary: itemsSummary(normalized),
        progress: itemsProgress(normalized),
        autoCheck: canAutoConfirm(normalized),
      };
    });

    if (resolved.kind === 'refusal') {
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    /**
     * O checklist fechou? Então a vaga se confirma — pelo caminho de sempre. Se a
     * inscrição já tiver sido confirmada (ou liberada por prazo) nesse meio-tempo, a
     * recusa de `confirmRegistration` NÃO é erro para quem acabou de marcar o item: o
     * item está gravado, e o que aconteceu com a vaga é outro fato.
     */
    let autoConfirmed = false;

    if (resolved.autoCheck.ok) {
      const confirmation = await confirmRegistration({
        tenantId,
        registrationId,
        actorId,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      });

      autoConfirmed = confirmation.ok;

      if (!confirmation.ok && confirmation.code !== 'ALREADY_CONFIRMED') {
        console.error(
          `[confirmacao] checklist completo, mas a vaga não confirmou (${registrationId}): ${confirmation.message}`,
        );
      }
    }

    return {
      ok: true,
      registrationId,
      itemId: resolved.itemId,
      label: resolved.label,
      status,
      summary: resolved.summary,
      autoConfirmed,
      missingMessage: resolved.autoCheck.ok ? null : resolved.autoCheck.message,
    };
  } catch (error) {
    console.error(`[confirmacao] falha ao resolver o item: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível registrar o item.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  A fila de confirmações (equipe)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O item como a TELA precisa dele: a regra pura (`ConfirmationItem`) mais o `id` que a
 * ação usa para marcar. O domínio não conhece id — quem persiste é esta camada.
 */
export interface ConfirmationQueueItem extends ConfirmationItem {
  id: string;
}

export interface ConfirmationQueueRow {
  registrationId: string;
  userId: string;
  personName: string;
  /** Mascarado na lista, como no diretório de participantes (FASE 32). */
  emailMasked: string;
  /** "25/09/2026, 23:59" no fuso do evento. */
  deadlineLabel: string | null;
  /** "faltam 2 dias" / "prazo vencido". */
  countdown: string;
  state: ConfirmationState;
  /** O checklist do que a pessoa precisa trazer — é o que o balcão confere. */
  requirements: string[];
  /**
   * O checklist DESTA inscrição, com o veredito de cada item (FASE 37). Vazio quando a
   * inscrição é anterior à fase e não tem exigências, ou quando a atividade não declara
   * nenhuma — nos dois casos a confirmação continua sendo ato da equipe.
   */
  items: ConfirmationQueueItem[];
  /** "2 de 3 itens" — o resumo que o balcão lê de relance. */
  itemsSummary: string;
  place: string | null;
  registeredAt: Date;
  confirmedAt: Date | null;
  /** Nome de quem confirmou, quando já confirmada. */
  confirmedByName: string | null;
}

export interface ConfirmationQueueActivity {
  id: string;
  title: string;
  startsAt: Date;
  /** Existe para o DESEMPATE da ordem da fila — não é exibido na tela. */
  createdAt: Date;
  windowDays: number | null;
  place: string | null;
  pending: number;
  confirmed: number;
  /** O prazo mais curto entre as pendentes — é ele que ordena a fila. `null` sem pendentes. */
  earliestDueAt: Date | null;
}

export interface ConfirmationQueue {
  eventTitle: string;
  eventTimeZone: string;
  activities: ConfirmationQueueActivity[];
  selected: {
    activityId: string;
    title: string;
    requirements: string[];
    place: string | null;
    instructions: string | null;
    windowDays: number | null;
  } | null;
  pending: ConfirmationQueueRow[];
  confirmed: ConfirmationQueueRow[];
}

/**
 * Mascara o e-mail mantendo-o reconhecível.
 *
 * Mesma decisão do diretório de participantes (FASE 32): a lista mostra o suficiente
 * para a equipe conferir quem está na frente dela, e não a agenda inteira da pessoa.
 * A busca continua funcionando pelo endereço completo — quem procura já sabe o que
 * procura.
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '—';

  const visible = local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export interface ListConfirmationQueueInput {
  tenantId: string;
  eventId: string;
  /** Atividade em foco. Sem ela, a fila mostra a primeira que exige confirmação. */
  activityId?: string | null;
  search?: string | null;
  limit?: number;
}

const QUEUE_LIMIT = 200;

/**
 * A fila de confirmações de um evento.
 *
 * É a PRIMEIRA lista de inscritos que o painel tem: até aqui a Programação mostrava
 * só contagens ("12 inscritos"), e não havia onde olhar quem são. A confirmável
 * precisou dela porque o balcão precisa de nome, prazo e checklist na mesma linha —
 * e porque quem perde a vaga por prazo precisa ser encontrado antes disso.
 */
export async function listConfirmationQueue(
  input: ListConfirmationQueueInput,
): Promise<{ ok: true; queue: ConfirmationQueue } | { ok: false; code: 'NOT_FOUND'; message: string }> {
  const limit = Math.min(input.limit ?? QUEUE_LIMIT, QUEUE_LIMIT);
  const search = input.search?.trim() ?? '';

  const queue = await withTenant(input.tenantId, async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
      select: { id: true, title: true, timezone: true },
    });

    if (!event) return null;

    const activities = await tx.activity.findMany({
      where: {
        eventId: event.id,
        tenantId: input.tenantId,
        deletedAt: null,
        confirmationPolicy: 'REQUIRED',
      },
      /**
       * ─── DESEMPATE DETERMINÍSTICO ───────────────────────────────────────────────
       *
       *  `ORDER BY startsAt` sozinho NÃO define ordem: duas atividades que começam no
       *  mesmo horário (o caso comum de uma programação montada em bloco) voltam do
       *  Postgres em ordem arbitrária — e é `activities[0]` que a tela seleciona quando
       *  ninguém escolheu uma atividade. Sem o desempate, a fila abria numa atividade
       *  diferente a cada consulta (armadilha 96). `createdAt` e `id` fecham a ordem:
       *  a atividade mais antiga primeiro, e o id como último critério.
       */
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        startsAt: true,
        createdAt: true,
        confirmationWindowDays: true,
        confirmationPlace: true,
        confirmationRequirements: true,
        confirmationInstructions: true,
      },
    });

    if (activities.length === 0) {
      return {
        eventTitle: event.title,
        eventTimeZone: event.timezone,
        activities: [],
        selected: null,
        pending: [],
        confirmed: [],
      } satisfies ConfirmationQueue;
    }

    const counts = await tx.registration.groupBy({
      by: ['activityId', 'status'],
      where: {
        tenantId: input.tenantId,
        activityId: { in: activities.map((activity) => activity.id) },
        status: { in: ['PENDING', 'CONFIRMED', 'ATTENDED', 'NO_SHOW'] },
        deletedAt: null,
      },
      _count: { _all: true },
      /** O prazo mais urgente de cada atividade: é ele que ordena a FILA. */
      _min: { confirmationDueAt: true },
    });

    const countOf = (activityId: string, statuses: readonly string[]): number =>
      counts
        .filter((row) => row.activityId === activityId && statuses.includes(row.status))
        .reduce((total, row) => total + row._count._all, 0);

    const earliestDueOf = (activityId: string): Date | null => {
      const dueDates = counts
        .filter(
          (row) =>
            row.activityId === activityId &&
            row.status === 'PENDING' &&
            row._min.confirmationDueAt !== null,
        )
        .map((row) => row._min.confirmationDueAt!.getTime());

      return dueDates.length > 0 ? new Date(Math.min(...dueDates)) : null;
    };

    const activityRows: ConfirmationQueueActivity[] = activities
      .map((activity) => ({
        id: activity.id,
        title: activity.title,
        startsAt: activity.startsAt,
        createdAt: activity.createdAt,
        windowDays: activity.confirmationWindowDays,
        place: activity.confirmationPlace,
        pending: countOf(activity.id, ['PENDING']),
        confirmed: countOf(activity.id, ['CONFIRMED', 'ATTENDED', 'NO_SHOW']),
        earliestDueAt: earliestDueOf(activity.id),
      }))
      /**
       * ── A ORDEM É A DA FILA, NÃO A DA AGENDA ─────────────────────────────────
       *
       *  Quem abre esta tela vem TRABALHAR. Ordenar só por data de início faria a
       *  primeira atividade do evento — muitas vezes sem ninguém esperando — ser a
       *  selecionada, e o organizador leria "Ninguém aguardando confirmação" enquanto
       *  uma vaga vencia na atividade seguinte. Quem tem pendente vem primeiro, e o
       *  critério entre eles é o prazo mais curto: a fila é uma fila de TEMPO.
       *
       *  O comparador REPETE o desempate do banco (início → criação → id): a ordem
       *  final não pode depender de qual das duas fontes foi consultada primeiro.
       */
      .sort((a, b) => {
        if (a.pending > 0 && b.pending === 0) return -1;
        if (b.pending > 0 && a.pending === 0) return 1;

        if (a.pending > 0 && b.pending > 0) {
          const dueA = a.earliestDueAt?.getTime() ?? Number.POSITIVE_INFINITY;
          const dueB = b.earliestDueAt?.getTime() ?? Number.POSITIVE_INFINITY;

          if (dueA !== dueB) return dueA - dueB;
        }

        if (a.startsAt.getTime() !== b.startsAt.getTime()) {
          return a.startsAt.getTime() - b.startsAt.getTime();
        }

        if (a.createdAt.getTime() !== b.createdAt.getTime()) {
          return a.createdAt.getTime() - b.createdAt.getTime();
        }

        return a.id.localeCompare(b.id);
      });

    const selected =
      activities.find((activity) => activity.id === input.activityId) ??
      activities.find((activity) => activity.id === activityRows[0]?.id)!;

    /**
     * A busca é por NOME ou E-MAIL, e roda no banco: a lista pode ter centenas de
     * pendentes num evento grande, e filtrar no navegador obrigaria a carregar todos
     * para mostrar cinco.
     */
    const searchWhere = search
      ? {
          user: {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          },
        }
      : {};

    const [pendingRows, confirmedRows] = await Promise.all([
      tx.registration.findMany({
        where: {
          tenantId: input.tenantId,
          activityId: selected.id,
          status: 'PENDING',
          deletedAt: null,
          ...searchWhere,
        },
        orderBy: [{ confirmationDueAt: 'asc' }, { createdAt: 'asc' }],
        take: limit,
        select: {
          id: true,
          confirmationDueAt: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      tx.registration.findMany({
        where: {
          tenantId: input.tenantId,
          activityId: selected.id,
          status: { in: ['CONFIRMED', 'ATTENDED', 'NO_SHOW'] },
          deletedAt: null,
          ...searchWhere,
        },
        orderBy: { confirmedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          confirmationDueAt: true,
          createdAt: true,
          confirmedAt: true,
          user: { select: { id: true, name: true, email: true } },
          confirmedBy: { select: { name: true } },
        },
      }),
    ]);

    const requirements = parseConfirmationRequirements(selected.confirmationRequirements).map(
      requirementLabel,
    );

    /**
     * ─── O CHECKLIST DE CADA INSCRIÇÃO (FASE 37) ────────────────────────────────
     *
     *  Uma consulta para todas as linhas da fila (e não uma por inscrição): a lista pode
     *  ter dezenas de pendentes, e o balcão não pode esperar N idas ao banco para
     *  desenhar a tela.
     */
    const listedIds = [...pendingRows.map((row) => row.id), ...confirmedRows.map((row) => row.id)];

    const itemRows =
      listedIds.length === 0
        ? []
        : await tx.registrationConfirmationItem.findMany({
            where: { tenantId: input.tenantId, registrationId: { in: listedIds } },
            orderBy: [{ registrationId: 'asc' }, { position: 'asc' }],
            select: {
              id: true,
              registrationId: true,
              position: true,
              kind: true,
              label: true,
              note: true,
              required: true,
              status: true,
            },
          });

    const itemsByRegistration = new Map<string, ConfirmationQueueItem[]>();

    for (const row of itemRows) {
      const list = itemsByRegistration.get(row.registrationId) ?? [];

      list.push({
        id: row.id,
        position: row.position,
        kind: row.kind,
        label: row.label,
        note: row.note,
        required: row.required,
        status: normalizeItemStatus(row.status),
      });

      itemsByRegistration.set(row.registrationId, list);
    }

    const now = new Date();

    const toRow = (
      row: {
        id: string;
        confirmationDueAt: Date | null;
        createdAt: Date;
        confirmedAt?: Date | null;
        user: { id: string; name: string; email: string };
        confirmedBy?: { name: string } | null;
      },
      status: 'PENDING' | 'CONFIRMED',
    ): ConfirmationQueueRow => {
      const items = itemsByRegistration.get(row.id) ?? [];

      return {
        registrationId: row.id,
        userId: row.user.id,
        personName: row.user.name,
        emailMasked: maskEmail(row.user.email),
        deadlineLabel: row.confirmationDueAt
          ? confirmationDeadlineLabel(row.confirmationDueAt, event.timezone)
          : null,
        countdown: row.confirmationDueAt ? confirmationCountdown(row.confirmationDueAt, now) : '—',
        state: confirmationStateOf({
          policy: 'REQUIRED',
          status,
          dueAt: row.confirmationDueAt,
          now,
        }),
        requirements,
        /**
         * O checklist DESTA inscrição (FASE 37) — com o item já resolvido e o que falta.
         * A lista de `requirements` acima continua sendo o MODELO da atividade: ela serve
         * para a tela mostrar o que a atividade pede hoje; os itens são o que a pessoa
         * foi cobrada no dia em que se inscreveu.
         */
        items,
        itemsSummary: itemsSummary(items),
        place: selected.confirmationPlace,
        registeredAt: row.createdAt,
        confirmedAt: row.confirmedAt ?? null,
        confirmedByName: row.confirmedBy?.name ?? null,
      };
    };

    return {
      eventTitle: event.title,
      eventTimeZone: event.timezone,
      activities: activityRows,
      selected: {
        activityId: selected.id,
        title: selected.title,
        requirements,
        place: selected.confirmationPlace,
        instructions: selected.confirmationInstructions,
        windowDays: selected.confirmationWindowDays,
      },
      pending: pendingRows.map((row) => toRow(row, 'PENDING')),
      confirmed: confirmedRows.map((row) => toRow(row, 'CONFIRMED')),
    } satisfies ConfirmationQueue;
  });

  if (!queue) {
    return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
  }

  return { ok: true, queue };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A varredura do prazo vencido
// ───────────────────────────────────────────────────────────────────────────────
export interface ExpirySweepResult {
  tenants: number;
  /** Inscrições canceladas por prazo vencido. */
  released: number;
  /** Quantos foram promovidos da lista de espera ao liberar as vagas. */
  promoted: number;
  /** Avisos que não saíram (o fato já está gravado). */
  noticeFailures: number;
}

/** Teto por instituição em uma passada — a varredura é periódica. */
const EXPIRY_BATCH = 500;

/**
 * Libera as vagas cujo prazo de confirmação venceu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  IDEMPOTÊNCIA PELA CHAVE DO FATO (invariante nº 6)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O cancelamento é um `updateMany` condicional por `status = 'PENDING'`: rodar a
 *  varredura duas vezes (ou duas instâncias do worker ao mesmo tempo) libera a vaga
 *  UMA vez. É a mesma proteção que o `drawnAt IS NULL` dá à apuração do sorteio —
 *  sem ela, uma passada repetida devolveria duas vagas para uma inscrição só, e a
 *  atividade passaria a aceitar mais gente do que cabe.
 *
 *  A liberação é a MESMA do cancelamento: decrementa o contador da atividade,
 *  decrementa o lugar no evento, promove o primeiro da lista de espera e reindexa as
 *  posições — tudo na mesma transação, porque uma vaga devolvida pela metade seria
 *  uma vaga que ninguém consegue ocupar.
 */
export async function runConfirmationExpirySweep(
  input: { now?: Date } = {},
): Promise<ExpirySweepResult> {
  const now = input.now ?? new Date();
  const result: ExpirySweepResult = { tenants: 0, released: 0, promoted: 0, noticeFailures: 0 };

  try {
    const tenants = await systemClient().tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    for (const tenant of tenants) {
      result.tenants += 1;

      const partial = await withTenant(tenant.id, async (tx) => {
        const expired = await tx.registration.findMany({
          where: {
            tenantId: tenant.id,
            status: 'PENDING',
            deletedAt: null,
            confirmationDueAt: { not: null, lt: now },
            /** Atividade cancelada não libera vaga: não há vaga a liberar. */
            activity: { status: { not: 'CANCELED' } },
          },
          orderBy: { confirmationDueAt: 'asc' },
          take: EXPIRY_BATCH,
          select: { id: true, activityId: true, eventId: true },
        });

        const released: string[] = [];
        const promoted: string[] = [];

        for (const row of expired) {
          const claimed = await tx.registration.updateMany({
            where: { id: row.id, status: 'PENDING' },
            data: {
              status: 'CANCELED',
              canceledAt: now,
              cancelReason: EXPIRY_CANCEL_REASON,
            },
          });

          if (claimed.count === 0) continue;

          released.push(row.id);

          if (!row.activityId) continue;

          await releaseSeatForExpiry(tx, {
            tenantId: tenant.id,
            eventId: row.eventId,
            activityId: row.activityId,
          });

          const next = await promoteNextFromWaitlist(tx, row.activityId);
          if (next) promoted.push(next.registrationId);
        }

        return { released, promoted };
      });

      result.released += partial.released.length;
      result.promoted += partial.promoted.length;

      /**
       * Os avisos saem DEPOIS do commit, um a um: quem perdeu a vaga e quem entrou
       * por causa disso. A varredura não falha por causa de e-mail (invariante 8) —
       * o fato já está no banco, e as chaves de dedupe fazem o reenvio ser inofensivo.
       */
      for (const registrationId of partial.released) {
        const notice = await notifyRegistrationReleased({ tenantId: tenant.id, registrationId });
        if (!notice.ok) result.noticeFailures += 1;
      }

      for (const registrationId of partial.promoted) {
        const notice = await notifyWaitlistPromoted({ tenantId: tenant.id, registrationId });
        if (!notice.ok) result.noticeFailures += 1;
      }
    }

    return result;
  } catch (error) {
    console.error(`[confirmacao] falha na varredura de prazos: ${errorMessage(error)}`);

    return result;
  }
}

/**
 * Devolve a vaga ocupada por uma inscrição que venceu.
 *
 * Espelha EXATAMENTE o que `cancelRegistration` faz ao liberar vaga — inclusive o
 * `GREATEST(..., 0)`, que impede um contador negativo por dado inconsistente. Se os
 * dois caminhos divergirem, a atividade passa a mentir sobre a própria lotação: um
 * caminho que só decrementa a atividade deixa o evento contando a mais, e o
 * contrário libera vaga no evento sem liberar na atividade.
 */
async function releaseSeatForExpiry(
  tx: TxClient,
  input: { tenantId: string; eventId: string; activityId: string },
): Promise<void> {
  await tx.$executeRaw`
    UPDATE events
       SET "confirmedCount" = GREATEST("confirmedCount" - 1, 0)
     WHERE id = ${input.eventId}::uuid
  `;

  await tx.$executeRaw`
    UPDATE activities
       SET "confirmedCount" = GREATEST("confirmedCount" - 1, 0)
     WHERE id = ${input.activityId}::uuid
  `;
}

// ───────────────────────────────────────────────────────────────────────────────
//  O lembrete
// ───────────────────────────────────────────────────────────────────────────────
export interface ReminderScanResult {
  tenants: number;
  /** Lembretes enviados nesta passada. */
  reminded: number;
  /** Já avisados antes (o carimbo existe) — o número que prova a idempotência. */
  alreadyReminded: number;
  failures: number;
}

/**
 * Avisa quem está perto do prazo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CARIMBO VEM DEPOIS DO ENVIO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `confirmationReminderAt` é a chave de idempotência do lembrete. Marcar ANTES de
 *  enviar perderia o aviso para sempre se o processo caísse no meio; enviar antes de
 *  marcar só repetiria a TENTATIVA — e a repetição não produz segunda mensagem,
 *  porque a `dedupeKey` (`registration-due-soon-<id>`) é única no outbox e na caixa
 *  de entrada. Entre perder o aviso e repetir a tentativa, repetir é o barato.
 */
export async function runConfirmationReminderScan(
  input: { now?: Date } = {},
): Promise<ReminderScanResult> {
  const now = input.now ?? new Date();
  const result: ReminderScanResult = { tenants: 0, reminded: 0, alreadyReminded: 0, failures: 0 };

  try {
    const tenants = await systemClient().tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    for (const tenant of tenants) {
      result.tenants += 1;

      const candidates = await withTenant(tenant.id, (tx) =>
        tx.registration.findMany({
          where: {
            tenantId: tenant.id,
            status: 'PENDING',
            deletedAt: null,
            confirmationDueAt: { not: null, gt: now },
            activity: { status: { not: 'CANCELED' } },
          },
          orderBy: { confirmationDueAt: 'asc' },
          take: EXPIRY_BATCH,
          select: { id: true, confirmationDueAt: true, confirmationReminderAt: true },
        }),
      );

      for (const row of candidates) {
        const should = shouldSendConfirmationReminder({
          dueAt: row.confirmationDueAt,
          now,
          alreadyReminded: row.confirmationReminderAt !== null,
        });

        if (!should) {
          if (row.confirmationReminderAt !== null) result.alreadyReminded += 1;
          continue;
        }

        const notice = await notifyConfirmationDueSoon({
          tenantId: tenant.id,
          registrationId: row.id,
          countdownLabel: confirmationCountdown(row.confirmationDueAt!, now),
        });

        if (!notice.ok) {
          result.failures += 1;
          continue;
        }

        /**
         * O carimbo é CONDICIONAL ao estado que decidiu o aviso: se a pessoa
         * confirmou entre a leitura e agora, a linha não é mais `PENDING` e o
         * carimbo não é gravado — o que evita marcar como lembrado um fato que já
         * mudou de estado.
         */
        await withTenant(tenant.id, (tx) =>
          tx.registration.updateMany({
            where: { id: row.id, status: 'PENDING' },
            data: { confirmationReminderAt: now },
          }),
        );

        result.reminded += 1;
      }
    }

    return result;
  } catch (error) {
    console.error(`[confirmacao] falha na varredura de lembretes: ${errorMessage(error)}`);

    return result;
  }
}

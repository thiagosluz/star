/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Catálogo do painel administrativo
 *
 *  Eventos, atividades, salas e trilhas: o que a instituição precisa manter para
 *  que o resto da plataforma tenha conteúdo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS VALIDAÇÕES QUE JÁ EXISTIAM E NÃO ESTAVAM LIGADAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `checkScheduleConflict` e `evaluateRoomFit` foram escritos e testados na FASE 3,
 *  mas nunca chamados — não havia UI de criação de atividade para exercitá-los. É
 *  aqui que eles passam a valer: duas atividades na mesma sala, no mesmo horário,
 *  são recusadas no servidor (não no formulário).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TODA MUTAÇÃO PASSA PELA TRILHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada alteração grava `AuditLog` NA MESMA TRANSAÇÃO. Se a alteração falhar, a
 *  trilha não registra um fato que não aconteceu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { canDeleteActivity, defaultRequiresRegistration } from '@/domain/events/activity-rules';
import {
  parseConfirmationRequirements,
  validateConfirmationPolicy,
  type ConfirmationPolicy,
  type ConfirmationRequirement,
} from '@/domain/events/confirmation-rules';
import { syncOpenActivityEnrollments } from '@/lib/events/registration-service';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { diffFields, recordAudit } from '@/lib/admin/audit';
import { resolveTheme } from '@/domain/events/landing-page';
import { evaluateEventQuota } from '@/domain/platform/platform-rules';
import { readEventRegistrationPolicy } from '@/domain/events/public-registration-rules';
import {
  checkScheduleConflict,
  evaluateRoomCapacityChange,
  evaluateRoomFit,
  evaluateRoomRemoval,
  normalizeRoomCapacity,
  type RoomUsage,
} from '@/domain/events/event-rules';
import { parseRubric, type RubricCriterion } from '@/domain/review/review-rules';
import { assertRubricShapeFree } from '@/lib/review/rubric-guard';
import { parseTaskTarget } from '@/domain/gamification/task-rules';

export type AdminErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'SLUG_TAKEN'
  | 'ROOM_CONFLICT'
  | 'ROOM_TOO_SMALL'
  /** O nome da sala já existe neste evento (revisão da FASE 3, edição de sala). */
  | 'ROOM_NAME_TAKEN'
  /** A sala está em uso por atividades — excluir apagaria a referência em silêncio. */
  | 'ROOM_IN_USE'
  /** A capacidade nova da sala ficaria abaixo de atividade já configurada/ocupada. */
  | 'ROOM_CAPACITY_BELOW_USAGE'
  /** O plano da instituição atingiu o limite de eventos (FASE 12, item C2). */
  | 'QUOTA_EXCEEDED'
  /**
   * Desligar a confirmação de vaga deixaria inscrições pendentes sem saída (FASE 34):
   * elas seguram vaga, não têm mais prazo e ninguém pode confirmá-las.
   */
  | 'INVALID_PENDING_CONFIRMATIONS'
  /**
   * A FORMA da rubrica não pode mudar: já existe parecer enviado, e a nota de quem
   * avaliou deixaria de ser calculável (FASE 39 — `src/lib/review/rubric-guard.ts`).
   */
  | 'RUBRIC_FROZEN'
  | 'INTERNAL';

export type AdminResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AdminErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Eventos
// ───────────────────────────────────────────────────────────────────────────────
export interface EventInput {
  tenantId: string;
  actorId: string;
  eventId?: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  description?: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELED' | 'ARCHIVED';
  modality: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  capacity?: number | null;
  venueName?: string | null;
  city?: string | null;
  state?: string | null;
  primaryColor?: string | null;
  theme?: unknown;
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  cfpOpensAt?: Date | null;
  cfpClosesAt?: Date | null;
  /**
   * Restringe a inscrição à comunidade da instituição (FASE 12, item I3).
   *
   * Ausente/falso = inscrição aberta a quem tiver conta, que é o padrão desde a
   * FASE 10. A chave é gravada em `Event.settings`, preservando as demais.
   */
  registrationRequiresMembership?: boolean;
}

/**
 * Cria ou atualiza um evento.
 *
 * O tema passa por `resolveTheme` — o MESMO validador da landing page. Aplicar a
 * allowlist aqui também significa que nenhum caminho de escrita consegue gravar um
 * tema que a renderização pública vá recusar depois.
 */
export async function saveEvent(input: EventInput): Promise<AdminResult<{ eventId: string; created: boolean }>> {
  try {
    const resolved = resolveTheme(input.theme ?? {});
    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT',
        message: 'O término do evento precisa ser depois do início.',
      };
    }

    return await withTenant(input.tenantId, async (tx) => {
      const data = {
        slug: input.slug,
        title: input.title,
        subtitle: input.subtitle ?? null,
        summary: input.summary ?? null,
        description: input.description ?? null,
        status: input.status,
        modality: input.modality,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: input.timezone,
        capacity: input.capacity ?? null,
        venueName: input.venueName ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        primaryColor: input.primaryColor ?? resolved.theme.primaryColor,
        theme: resolved.theme as unknown as object,
        registrationOpensAt: input.registrationOpensAt ?? null,
        registrationClosesAt: input.registrationClosesAt ?? null,
        cfpOpensAt: input.cfpOpensAt ?? null,
        cfpClosesAt: input.cfpClosesAt ?? null,
      };

      if (input.eventId) {
        const before = await tx.event.findFirst({
          where: { id: input.eventId, deletedAt: null },
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            startsAt: true,
            endsAt: true,
            capacity: true,
            settings: true,
          },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
        }

        /**
         * `settings` é um campo livre (JSON) e pode ter chaves de outras fases.
         * A gravação faz MERGE, não substituição: escrever só a chave nova apagaria
         * configurações que não são desta tela — o mesmo cuidado que a FASE 9 tomou
         * ao incluir o perfil público na projeção do painel.
         */
        const previousSettings =
          before.settings && typeof before.settings === 'object' && !Array.isArray(before.settings)
            ? (before.settings as Record<string, unknown>)
            : {};

        await tx.event.update({
          where: { id: before.id },
          data: {
            ...data,
            settings: {
              ...previousSettings,
              registrationRequiresMembership: input.registrationRequiresMembership === true,
            } as unknown as object,
          },
        });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'event',
            entityId: before.id,
            changes: diffFields(before, data, ['title', 'slug', 'status', 'startsAt', 'endsAt', 'capacity']),
          },
          tx,
        );

        return { ok: true as const, eventId: before.id, created: false };
      }

      const id = randomUUID();

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  QUOTA DE EVENTOS (item C2 da FASE 12)
       * ─────────────────────────────────────────────────────────────────────────────
       *  A checagem é aqui — no único caminho que CRIA evento — e roda DENTRO da
       *  transação com contexto de instituição. A tabela `tenants` é global e tem
       *  policy de leitura para a role de runtime (`tenant_resolution_read`), então a
       *  quota é lida sem a conexão administrativa.
       *
       *  Contagem e criação na mesma transação: sem isso, duas criações simultâneas
       *  passariam as duas pela verificação e a quota estouraria por dois.
       */
      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { maxEvents: true },
      });

      const currentCount = await tx.event.count({
        where: { tenantId: input.tenantId, deletedAt: null },
      });

      const quota = evaluateEventQuota({
        currentCount,
        maxEvents: tenant?.maxEvents ?? null,
      });

      if (!quota.allowed) {
        return {
          ok: false as const,
          code: 'QUOTA_EXCEEDED' as const,
          message: quota.message ?? 'A quota de eventos do plano foi atingida.',
        };
      }

      await tx.event.create({
        data: {
          id,
          tenantId: input.tenantId,
          confirmedCount: 0,
          ...data,
          settings: {
            registrationRequiresMembership: input.registrationRequiresMembership === true,
          } as unknown as object,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'event',
          entityId: id,
          changes: { title: { from: null, to: input.title }, slug: { from: null, to: input.slug } },
        },
        tx,
      );

      return { ok: true as const, eventId: id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('slug')) {
      return {
        ok: false as const,
        code: 'SLUG_TAKEN',
        message: 'Já existe um evento com este identificador na instituição.',
      };
    }

    console.error(`[admin] falha ao salvar evento: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível salvar o evento.' };
  }
}

export interface AdminEventRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  confirmedCount: number;
  activityCount: number;
  trackCount: number;
  roomCount: number;
  registrationCount: number;
}

export async function listAdminEvents(tenantId: string): Promise<AdminEventRow[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { startsAt: 'desc' },
      take: 100,
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        confirmedCount: true,
        _count: { select: { activities: true, tracks: true, rooms: true, registrations: true } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
    confirmedCount: row.confirmedCount,
    activityCount: row._count.activities,
    trackCount: row._count.tracks,
    roomCount: row._count.rooms,
    registrationCount: row._count.registrations,
  }));
}

export interface AdminEventDetail extends AdminEventRow {
  subtitle: string | null;
  summary: string | null;
  description: string | null;
  modality: string;
  timezone: string;
  venueName: string | null;
  city: string | null;
  state: string | null;
  primaryColor: string | null;
  theme: unknown;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  cfpOpensAt: Date | null;
  cfpClosesAt: Date | null;
  /** A inscrição está restrita à comunidade? (FASE 12, item I3) */
  registrationRequiresMembership: boolean;
  rooms: { id: string; name: string; capacity: number | null }[];
  activities: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    type: string;
    status: string;
    modality: string;
    startsAt: Date;
    endsAt: Date;
    workloadMinutes: number;
    capacity: number | null;
    /** Teto da SALA (`null` = a sala não declara limite). */
    roomCapacity: number | null;
    /** Ocupação real (contador denormalizado da reserva de vaga). */
    confirmedCount: number;
    waitlistEnabled: boolean;
    roomId: string | null;
    roomName: string | null;
    isFeatured: boolean;
    checkInEnabled: boolean;
    /** `false` = aberta a todos os inscritos no evento (revisão da FASE 3). */
    requiresRegistration: boolean;
    /** Inscrições vivas — o que a exclusão encontra pela frente. */
    registrationCount: number;
    /**
     * Confirmação de vaga (FASE 34). A tela precisa dos quatro para reabrir o
     * formulário com o que está gravado — um formulário que esquece a política
     * desligaria a confirmação na primeira edição de título.
     */
    confirmationPolicy: ConfirmationPolicy;
    confirmationWindowDays: number | null;
    confirmationRequirements: ConfirmationRequirement[];
    confirmationPlace: string | null;
    confirmationInstructions: string | null;
    /** Quantas inscrições aguardam confirmação — o que impede desligar a política. */
    pendingConfirmations: number;
  }[];
  tracks: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    color: string | null;
    maxSubmissionsPerAuthor: number;
    requiresBlindReview: boolean;
    requiredReviews: number;
    acceptanceThreshold: number;
    rejectThreshold: number;
    isActive: boolean;
    submissionCount: number;
    /**
     * A rubrica como está gravada (FASE 39) — vazia significa "usa a padrão". A tela de
     * edição precisa dela para mostrar o que está em vigor e para mandar a FORMA de
     * volta intacta quando a rubrica estiver congelada.
     */
    reviewRubric: readonly RubricCriterion[];
  }[];
}

export async function getAdminEvent(tenantId: string, eventId: string): Promise<AdminEventDetail | null> {
  const event = await withTenant(tenantId, (tx) =>
    tx.event.findFirst({
      where: { id: eventId, tenantId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        summary: true,
        description: true,
        status: true,
        modality: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        capacity: true,
        confirmedCount: true,
        venueName: true,
        city: true,
        state: true,
        primaryColor: true,
        theme: true,
        registrationOpensAt: true,
        registrationClosesAt: true,
        cfpOpensAt: true,
        cfpClosesAt: true,
        settings: true,
        rooms: { orderBy: { name: 'asc' }, select: { id: true, name: true, capacity: true } },
        activities: {
          // Excluída (`deletedAt`) sai da programação do organizador — a exclusão é
          // lógica justamente para o dado sobreviver, mas não para continuar na tela.
          where: { deletedAt: null },
          orderBy: { startsAt: 'asc' },
          select: {
            id: true,
            slug: true,
            title: true,
            description: true,
            type: true,
            status: true,
            modality: true,
            startsAt: true,
            endsAt: true,
            workloadMinutes: true,
            capacity: true,
            confirmedCount: true,
            waitlistEnabled: true,
            roomId: true,
            isFeatured: true,
            checkInEnabled: true,
            requiresRegistration: true,
            /** Confirmação de vaga (FASE 34) — a tela reabre o formulário com isto. */
            confirmationPolicy: true,
            confirmationWindowDays: true,
            confirmationRequirements: true,
            confirmationPlace: true,
            confirmationInstructions: true,
            room: { select: { name: true, capacity: true } },
            _count: {
              select: {
                registrations: {
                  where: {
                    deletedAt: null,
                    status: { in: ['PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED'] },
                  },
                },
              },
            },
          },
        },
        tracks: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            color: true,
            maxSubmissionsPerAuthor: true,
            requiresBlindReview: true,
            requiredReviews: true,
            acceptanceThreshold: true,
            rejectThreshold: true,
            isActive: true,
            reviewRubric: true,
            _count: { select: { submissions: true } },
          },
        },
        _count: { select: { activities: true, tracks: true, rooms: true, registrations: true } },
      },
    }),
  );

  if (!event) return null;

  /**
   * As pendentes de confirmação, por atividade (FASE 34) — uma consulta para todas.
   */
  const pendingRows = await withTenant(tenantId, (tx) =>
    tx.registration.groupBy({
      by: ['activityId'],
      where: {
        tenantId,
        eventId,
        status: 'PENDING',
        deletedAt: null,
        activityId: { not: null },
      },
      _count: { _all: true },
    }),
  );

  const pendingByActivity = new Map(
    pendingRows.map((row) => [row.activityId ?? '', row._count._all]),
  );

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    summary: event.summary,
    description: event.description,
    status: event.status,
    modality: event.modality,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    capacity: event.capacity,
    confirmedCount: event.confirmedCount,
    venueName: event.venueName,
    city: event.city,
    state: event.state,
    primaryColor: event.primaryColor,
    theme: event.theme,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    cfpOpensAt: event.cfpOpensAt,
    cfpClosesAt: event.cfpClosesAt,
    registrationRequiresMembership: readEventRegistrationPolicy(event.settings).requiresMembership,
    activityCount: event._count.activities,
    trackCount: event._count.tracks,
    roomCount: event._count.rooms,
    registrationCount: event._count.registrations,
    rooms: event.rooms,
    activities: event.activities.map((activity) => ({
      id: activity.id,
      slug: activity.slug,
      title: activity.title,
      description: activity.description,
      type: activity.type,
      status: activity.status,
      modality: activity.modality,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      workloadMinutes: activity.workloadMinutes,
      /**
       * `capacity` é a lotação DECLARADA e `roomCapacity` é o teto da sala: os dois
       * viajam separados até a tela, porque a tela precisa explicar POR QUE as vagas
       * efetivas são menores do que o organizador digitou (revisão da FASE 3). O
       * número efetivo sai da função do domínio, não de uma conta local.
       */
      capacity: activity.capacity,
      roomCapacity: activity.room?.capacity ?? null,
      confirmedCount: activity.confirmedCount,
      waitlistEnabled: activity.waitlistEnabled,
      roomId: activity.roomId,
      roomName: activity.room?.name ?? null,
      isFeatured: activity.isFeatured,
      checkInEnabled: activity.checkInEnabled,
      requiresRegistration: activity.requiresRegistration,
      registrationCount: activity._count.registrations,
      confirmationPolicy: activity.confirmationPolicy,
      confirmationWindowDays: activity.confirmationWindowDays,
      confirmationRequirements: parseConfirmationRequirements(activity.confirmationRequirements),
      confirmationPlace: activity.confirmationPlace,
      confirmationInstructions: activity.confirmationInstructions,
      /**
       * Quantas inscrições aguardam confirmação. Vem de uma consulta própria porque
       * `_count` do Prisma conta UMA vez por relação: pedir "inscrições vivas" e
       * "pendentes" no mesmo select obrigaria a dois relacionamentos, e o modelo não
       * tem. Uma `groupBy` para as atividades do evento resolve com uma ida ao banco.
       *
       * A tela usa o número para explicar por que a política não pode ser desligada
       * agora — e o serviço recalcula dentro da transação, porque a janela entre
       * desenhar e salvar é exatamente onde alguém confirma ou se inscreve.
       */
      pendingConfirmations: pendingByActivity.get(activity.id) ?? 0,
    })),
    tracks: event.tracks.map((track) => ({
      id: track.id,
      slug: track.slug,
      name: track.name,
      description: track.description,
      color: track.color,
      maxSubmissionsPerAuthor: track.maxSubmissionsPerAuthor,
      requiresBlindReview: track.requiresBlindReview,
      requiredReviews: track.requiredReviews,
      acceptanceThreshold: Number(track.acceptanceThreshold),
      rejectThreshold: Number(track.rejectThreshold),
      isActive: track.isActive,
      submissionCount: track._count.submissions,
      /** O JSON cru passa por `parseRubric` aqui: a tela recebe critérios, não `JsonValue`. */
      reviewRubric: parseRubric(track.reviewRubric).rubric,
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Salas
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O que as atividades VIVAS ocupam de uma sala.
 *
 * A leitura é feita na MESMA transação da escrita: a capacidade da sala é o teto
 * do limite efetivo das atividades, então decidir com uma lista lida antes (a tela
 * foi aberta há um minuto) deixaria passar a redução que o próprio sistema acabou
 * de tornar inválida — a mesma janela que a checagem de conflito de horário evita.
 */
async function readRoomUsage(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  eventId: string,
  roomId: string,
): Promise<RoomUsage[]> {
  const rows = await tx.activity.findMany({
    where: { eventId, roomId, deletedAt: null },
    orderBy: { startsAt: 'asc' },
    select: { title: true, capacity: true, confirmedCount: true },
  });

  return rows.map((row) => ({
    title: row.title,
    capacity: row.capacity,
    confirmedCount: row.confirmedCount,
  }));
}

/**
 * Cria ou atualiza uma sala.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A CAPACIDADE É OPCIONAL, E ISSO MUDA A REGRA — NÃO SÓ O CAMPO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Vazio = a sala não declara limite (a lotação da atividade manda). Com limite, a
 *  sala passa a ser o TETO do limite efetivo da atividade que acontece nela, então
 *  reduzir a capacidade de uma sala em uso é recusado quando deixaria uma atividade
 *  configurada com mais vagas do que a sala comporta, ou gente já inscrita sem
 *  lugar (`evaluateRoomCapacityChange`, revisão da FASE 3).
 *
 *  Editar uma sala para o nome de OUTRA do mesmo evento esbarra no índice único
 *  `(eventId, name)` — caminho que só existe porque agora dá para editar. Sem o
 *  tratamento abaixo, o organizador recebia "Não foi possível salvar a sala."
 */
export async function saveRoom(input: {
  tenantId: string;
  actorId: string;
  eventId: string;
  roomId?: string;
  name: string;
  /** `null`/ausente/≤ 0 = sala SEM LIMITE definido. */
  capacity: number | null;
}): Promise<AdminResult<{ roomId: string; created: boolean }>> {
  try {
    const capacity = normalizeRoomCapacity(input.capacity);

    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, deletedAt: null },
        select: { id: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      if (input.roomId) {
        const before = await tx.room.findFirst({
          where: { id: input.roomId, eventId: input.eventId },
          select: { id: true, name: true, capacity: true },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sala não encontrada.' };
        }

        const change = evaluateRoomCapacityChange({
          nextCapacity: capacity,
          usage: await readRoomUsage(tx, input.eventId, before.id),
        });

        if (!change.allowed) {
          return { ok: false as const, code: change.code, message: change.message };
        }

        await tx.room.update({
          where: { id: before.id },
          data: { name: input.name, capacity: change.normalizedCapacity },
        });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'room',
            entityId: before.id,
            changes: diffFields(
              before,
              { name: input.name, capacity: change.normalizedCapacity },
              ['name', 'capacity'],
            ),
          },
          tx,
        );

        return { ok: true as const, roomId: before.id, created: false };
      }

      const id = randomUUID();

      await tx.room.create({
        data: { id, tenantId: input.tenantId, eventId: input.eventId, name: input.name, capacity },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'room',
          entityId: id,
          changes: { name: { from: null, to: input.name }, capacity: { from: null, to: capacity } },
        },
        tx,
      );

      return { ok: true as const, roomId: id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('name')) {
      return {
        ok: false as const,
        code: 'ROOM_NAME_TAKEN',
        message: 'Já existe uma sala com este nome neste evento.',
      };
    }

    console.error(`[admin] falha ao salvar sala: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível salvar a sala.' };
  }
}

/**
 * Exclui uma sala que não está sendo usada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  EXCLUSÃO FÍSICA, E SÓ QUANDO NADA APONTA PARA ELA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Ao contrário da atividade (que tem histórico de gente inscrita e por isso é
 *  exclusão lógica), a sala não é referenciada por nada além da atividade — e a
 *  atividade já recusou, aqui, quando existe. Não há rastro a preservar: o que
 *  havia era um cadastro errado, e a trilha de auditoria guarda o fato.
 *
 *  `activities."roomId"` é `ON DELETE SET NULL`, então excluir sem esta guarda não
 *  falharia: a sala sumiria da programação em silêncio. É exatamente o que a recusa
 *  evita (`evaluateRoomRemoval`).
 */
export async function deleteRoom(input: {
  tenantId: string;
  actorId: string;
  eventId: string;
  roomId: string;
}): Promise<AdminResult<{ name: string; activities: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const room = await tx.room.findFirst({
        where: { id: input.roomId, eventId: input.eventId },
        select: { id: true, name: true, capacity: true },
      });

      if (!room) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sala não encontrada.' };
      }

      const usage = await readRoomUsage(tx, input.eventId, room.id);
      const removal = evaluateRoomRemoval({ usage });

      if (!removal.allowed) {
        return { ok: false as const, code: removal.code, message: removal.message };
      }

      /**
       * Atividades JÁ EXCLUÍDAS (logicamente) não bloqueiam a exclusão da sala: elas
       * saíram da programação e ninguém as lê. O vínculo delas passa a nulo pela
       * própria FK — mudança em registro que já estava fora de circulação.
       */
      await tx.room.delete({ where: { id: room.id } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'room',
          entityId: room.id,
          changes: { name: { from: room.name, to: null }, capacity: { from: room.capacity, to: null } },
        },
        tx,
      );

      return { ok: true as const, name: room.name, activities: 0 };
    });
  } catch (error) {
    console.error(`[admin] falha ao excluir sala: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível excluir a sala.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Atividades
// ───────────────────────────────────────────────────────────────────────────────
export interface ActivityInput {
  tenantId: string;
  actorId: string;
  eventId: string;
  activityId?: string;
  slug: string;
  title: string;
  description?: string | null;
  type:
    | 'LECTURE'
    | 'MINI_COURSE'
    | 'WORKSHOP'
    | 'ROUND_TABLE'
    | 'HACKATHON'
    | 'POSTER_SESSION'
    | 'ORAL_PRESENTATION'
    | 'CULTURAL'
    | 'OTHER';
  status: 'DRAFT' | 'SCHEDULED' | 'FULL' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
  modality: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
  startsAt: Date;
  endsAt: Date;
  workloadMinutes: number;
  capacity?: number | null;
  waitlistEnabled: boolean;
  roomId?: string | null;
  isFeatured?: boolean;
  checkInEnabled?: boolean;
  /**
   * A atividade exige inscrição individual? Ausente = padrão do tipo
   * (`defaultRequiresRegistration`). `false` = aberta: recebe automaticamente quem
   * se inscreveu no evento e não aplica vagas/lista de espera.
   */
  requiresRegistration?: boolean;
  /**
   * ─── Confirmação de vaga com prazo (FASE 34) ─────────────────────────────────
   * A escolha do organizador. Ausente = `AUTO`, isto é, a vaga é confirmada no ato
   * da inscrição — o comportamento de tudo o que existia antes desta fase.
   */
  confirmationPolicy?: 'AUTO' | 'REQUIRED';
  /** Prazo em DIAS, contado da inscrição de cada pessoa. Obrigatório em `REQUIRED`. */
  confirmationWindowDays?: number | null;
  /** `[{ kind, label, note }]` — validado e normalizado pelo domínio. */
  confirmationRequirements?: unknown;
  /** Onde confirmar (secretaria, balcão). */
  confirmationPlace?: string | null;
  confirmationInstructions?: string | null;
}

/**
 * Cria ou atualiza uma atividade, validando AGENDA e SALA.
 *
 * As duas checagens usam os validadores de domínio da FASE 3:
 *   • `evaluateRoomFit`     — a sala comporta a lotação prevista?
 *   • `checkScheduleConflict` — a sala já está ocupada nesse intervalo?
 *
 * A verificação roda no SERVIDOR e considera as atividades já gravadas: o
 * formulário pode ter sido aberto antes de outra pessoa criar a atividade
 * conflitante — a janela entre abrir e salvar é exatamente onde o conflito nasce.
 */
export async function saveActivity(input: ActivityInput): Promise<
  AdminResult<{ activityId: string; created: boolean; autoEnrolled: number }>
> {
  try {
    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT',
        message: 'O término da atividade precisa ser depois do início.',
      };
    }

    const saved = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, deletedAt: null },
        select: { id: true, startsAt: true, endsAt: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      /**
       * A atividade fora da janela do evento é recusada: um minicurso marcado
       * para depois do encerramento apareceria na agenda pública em um dia em que
       * não há evento — e o participante não teria como saber qual está certo.
       */
      if (input.startsAt.getTime() < event.startsAt.getTime() || input.endsAt.getTime() > event.endsAt.getTime()) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: 'A atividade precisa acontecer dentro do período do evento.',
        };
      }

      if (input.roomId) {
        const room = await tx.room.findFirst({
          where: { id: input.roomId, eventId: input.eventId },
          select: { id: true, name: true, capacity: true },
        });

        if (!room) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sala não encontrada neste evento.' };
        }

        const fit = evaluateRoomFit(input.capacity ?? null, room.capacity);

        if (!fit.fits) {
          return {
            ok: false as const,
            code: 'ROOM_TOO_SMALL' as const,
            message:
              fit.message ??
              `A sala "${room.name}" comporta ${room.capacity} pessoas — menos que a lotação prevista.`,
          };
        }

        const siblings = await tx.activity.findMany({
          where: {
            eventId: input.eventId,
            roomId: input.roomId,
            deletedAt: null,
            status: { notIn: ['CANCELED'] },
            ...(input.activityId ? { id: { not: input.activityId } } : {}),
          },
          select: { id: true, title: true, roomId: true, startsAt: true, endsAt: true },
        });

        /**
         * `id` do candidato: na edição é o id real (para a checagem não conflitar
         * consigo mesma); na criação, um valor simbólico que não existe na lista.
         */
        const conflict = checkScheduleConflict({
          candidate: {
            id: input.activityId ?? 'nova-atividade',
            roomId: input.roomId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
          existing: siblings,
        });

        if (conflict.hasConflict) {
          const clashing = conflict.roomConflicts[0];
          return {
            ok: false as const,
            code: 'ROOM_CONFLICT' as const,
            message: `A sala "${room.name}" já está ocupada nesse horário${
              clashing?.title ? ` por "${clashing.title}"` : ''
            }.`,
          };
        }
      }

      const requiresRegistrationValue =
        input.requiresRegistration ?? defaultRequiresRegistration(input.type);

      /**
       * ── A POLÍTICA DE CONFIRMAÇÃO PASSA PELO DOMÍNIO (FASE 34) ─────────────────
       *
       * `validateConfirmationPolicy` normaliza (descarta os campos de confirmação
       * quando a política é `AUTO`) e recusa o que não tem como ser obedecido:
       * exigir confirmação sem dizer o QUE nem ONDE.
       */
      const confirmation = validateConfirmationPolicy({
        policy: input.confirmationPolicy,
        windowDays: input.confirmationWindowDays,
        requirements: input.confirmationRequirements,
        place: input.confirmationPlace,
        instructions: input.confirmationInstructions,
      });

      if (!confirmation.ok) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: confirmation.message,
          details: confirmation.details,
        };
      }

      /**
       * Atividade ABERTA (`requiresRegistration = false`) não pode exigir confirmação
       * de vaga: quem entra nela vem da inscrição no EVENTO, e não há formulário por
       * atividade onde reservar uma vaga para depois confirmar. Aceitar a combinação
       * produziria uma atividade que ANUNCIA prazo de confirmação e nunca tem
       * inscrição pendente nenhuma.
       */
      if (confirmation.policy === 'REQUIRED' && !requiresRegistrationValue) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message:
            'Atividade aberta a todos os inscritos não tem inscrição individual — não há vaga própria para confirmar. Desligue "exige confirmação" ou marque a atividade como de inscrição individual.',
        };
      }

      const data = {
        slug: input.slug,
        title: input.title,
        description: input.description ?? null,
        type: input.type,
        status: input.status,
        modality: input.modality,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        workloadMinutes: input.workloadMinutes,
        capacity: input.capacity ?? null,
        waitlistEnabled: input.waitlistEnabled,
        roomId: input.roomId ?? null,
        isFeatured: input.isFeatured ?? false,
        checkInEnabled: input.checkInEnabled ?? true,
        /**
         * O padrão vem do TIPO quando a tela não decide (`defaultRequiresRegistration`):
         * palestra e mesa-redonda nascem abertas, minicurso e oficina nascem com
         * inscrição própria. É conveniência, não imposição — o valor explícito vence.
         */
        requiresRegistration: requiresRegistrationValue,
        /** Confirmação de vaga: normalizada pelo domínio logo acima. */
        confirmationPolicy: confirmation.policy,
        confirmationWindowDays: confirmation.windowDays,
        confirmationRequirements: confirmation.requirements as unknown as object,
        confirmationPlace: confirmation.place,
        confirmationInstructions: confirmation.instructions,
      };

      if (input.activityId) {
        const before = await tx.activity.findFirst({
          where: { id: input.activityId, eventId: input.eventId, deletedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            startsAt: true,
            endsAt: true,
            capacity: true,
            roomId: true,
            workloadMinutes: true,
            confirmationPolicy: true,
          },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Atividade não encontrada.' };
        }

        /**
         * ── DESLIGAR A CONFIRMAÇÃO COM GENTE ESPERANDO (FASE 34) ────────────────
         *
         * Quem está `PENDING` só sai desse estado por confirmação da equipe ou por
         * prazo vencido — e nenhum dos dois existe numa atividade `AUTO`. Desligar a
         * confirmação com pendentes deixaria essas inscrições paradas para sempre:
         * segurando vaga, sem prazo, e sem ninguém que possa confirmá-las. A recusa
         * diz QUANTAS são e manda resolver antes (confirmar ou cancelar).
         */
        if (before.confirmationPolicy === 'REQUIRED' && confirmation.policy === 'AUTO') {
          const pending = await tx.registration.count({
            where: { activityId: before.id, deletedAt: null, status: 'PENDING' },
          });

          if (pending > 0) {
            return {
              ok: false as const,
              code: 'INVALID_PENDING_CONFIRMATIONS' as const,
              message: `Há ${pending} inscrição(ões) aguardando confirmação nesta atividade. Confirme ou cancele antes de desligar a confirmação de vaga.`,
            };
          }
        }

        /**
         * Reduzir a lotação ABAIXO do que já está confirmado deixaria a atividade
         * com mais inscritos do que lugares — e o contador denormalizado passaria a
         * mentir para todos os cálculos de vaga. A recusa diz o número.
         */
        const confirmed = await tx.registration.count({
          where: {
            activityId: before.id,
            deletedAt: null,
            status: { in: ['PENDING', 'CONFIRMED', 'ATTENDED'] },
          },
        });

        if (data.capacity !== null && data.capacity < confirmed) {
          return {
            ok: false as const,
            code: 'INVALID_INPUT' as const,
            message: `A lotação não pode ficar abaixo das ${confirmed} inscrição(ões) já ativas nesta atividade.`,
          };
        }

        await tx.activity.update({ where: { id: before.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'activity',
            entityId: before.id,
            changes: diffFields(before, data, [
              'title',
              'status',
              'startsAt',
              'endsAt',
              'capacity',
              'roomId',
              'workloadMinutes',
              'confirmationPolicy',
            ]),
          },
          tx,
        );

        return { ok: true as const, activityId: before.id, created: false, openActivity: !data.requiresRegistration };
      }

      const id = randomUUID();

      await tx.activity.create({
        data: { id, tenantId: input.tenantId, eventId: input.eventId, confirmedCount: 0, waitlistCount: 0, ...data },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'activity',
          entityId: id,
          changes: {
            title: { from: null, to: input.title },
            startsAt: { from: null, to: input.startsAt },
            capacity: { from: null, to: input.capacity ?? null },
            confirmacao: { from: null, to: confirmation.policy },
          },
        },
        tx,
      );

      return { ok: true as const, activityId: id, created: true, openActivity: !data.requiresRegistration };
    });

    if (!saved.ok) return saved;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ATIVIDADE ABERTA PRECISA ALCANÇAR QUEM JÁ ESTAVA NO EVENTO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A inscrição automática é MATERIALIZADA no ato da inscrição no evento — e por
     *  isso precisa de uma segunda hora: quando a atividade aberta nasce (ou passa a
     *  ser aberta) DEPOIS de já haver gente inscrita no evento. Sem esta chamada,
     *  "aberta a todos os inscritos" seria falso para os primeiros.
     *
     *  Fora da transação de propósito: `syncOpenActivityEnrollments` abre a própria
     *  transação e, de dentro de outra ainda aberta, não enxergaria a atividade
     *  recém-criada (armadilha 41).
     */
    const autoEnrolled = saved.openActivity
      ? await syncOpenActivityEnrollments({
          tenantId: input.tenantId,
          eventId: input.eventId,
          activityId: saved.activityId,
          actorId: input.actorId,
        })
      : 0;

    return {
      ok: true as const,
      activityId: saved.activityId,
      created: saved.created,
      autoEnrolled,
    };
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('slug')) {
      return {
        ok: false as const,
        code: 'SLUG_TAKEN',
        message: 'Já existe uma atividade com este identificador neste evento.',
      };
    }

    console.error(`[admin] falha ao salvar atividade: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível salvar a atividade.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exclusão de atividade (revisão da FASE 3)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Exclui uma atividade que não chegou a existir na prática.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  EXCLUSÃO LÓGICA, E SÓ QUANDO NÃO HÁ GENTE ENVOLVIDA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A regra vive no domínio (`canDeleteActivity`) e recusa quando há inscrição viva
 *  ou presença registrada — com a contagem na mensagem e o caminho alternativo
 *  (cancelar). A exclusão lógica (`deletedAt`) tira a atividade da agenda e das
 *  telas sem tocar em nada que a referencie; o fato vai para a trilha.
 *
 *  Cadastrou errado e ainda não publicou? Exclui. Já tem 40 inscritos? Cancela —
 *  e todo mundo é avisado de que não acontece.
 */
export async function deleteActivity(input: {
  tenantId: string;
  actorId: string;
  eventId: string;
  activityId: string;
}): Promise<AdminResult<{ title: string; registrations: number; attendances: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const activity = await tx.activity.findFirst({
        where: { id: input.activityId, eventId: input.eventId, deletedAt: null },
        select: { id: true, title: true, startsAt: true },
      });

      if (!activity) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Atividade não encontrada.',
        };
      }

      const [liveRegistrations, attendances] = await Promise.all([
        tx.registration.count({
          where: {
            activityId: activity.id,
            deletedAt: null,
            status: { in: ['PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED'] },
          },
        }),
        tx.attendance.count({ where: { activityId: activity.id } }),
      ]);

      const verdict = canDeleteActivity({
        title: activity.title,
        liveRegistrations,
        attendances,
      });

      if (!verdict.allowed) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: verdict.message,
          details: [verdict.reason],
        };
      }

      await tx.activity.update({
        where: { id: activity.id },
        data: { deletedAt: new Date() },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'activity',
          entityId: activity.id,
          changes: {
            titulo: { from: activity.title, to: null },
            inicio: { from: activity.startsAt, to: null },
            inscricoes: { from: 0, to: 0 },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        title: activity.title,
        registrations: liveRegistrations,
        attendances,
      };
    });
  } catch (error) {
    console.error(`[admin] falha ao excluir atividade: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível excluir a atividade.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Trilhas (chamada de trabalhos)
// ───────────────────────────────────────────────────────────────────────────────
export interface TrackInput {
  tenantId: string;
  actorId: string;
  eventId: string;
  trackId?: string;
  slug: string;
  name: string;
  description?: string | null;
  color?: string | null;
  maxSubmissionsPerAuthor: number;
  requiresBlindReview: boolean;
  rubric: unknown;
  requiredReviews: number;
  acceptanceThreshold: number;
  rejectThreshold: number;
  isActive: boolean;
}

/**
 * Cria ou atualiza uma trilha.
 *
 * A rubrica passa por `parseRubric`: uma rubrica inválida gravada aqui quebraria o
 * cálculo da nota ponderada no momento do parecer — e o revisor descobriria isso
 * depois de escrever a avaliação. Melhor recusar na configuração.
 */
export async function saveTrack(input: TrackInput): Promise<AdminResult<{ trackId: string; created: boolean; rubricWarning: string | null }>> {
  try {
    if (input.rejectThreshold >= input.acceptanceThreshold) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT',
        message: 'O limiar de rejeição precisa ser menor que o de aceite.',
      };
    }

    const { rubric, usedDefault, errors } = parseRubric(input.rubric);

    /**
     * ─────────────────────────────────────────────────────────────────────────
     *  RUBRICA INVÁLIDA É RECUSADA — NÃO SUBSTITUÍDA PELA PADRÃO
     * ─────────────────────────────────────────────────────────────────────────
     *  `parseRubric` devolve a rubrica padrão em dois casos MUITO diferentes:
     *
     *    • nada foi informado (sem erros)  → aplicar a padrão é o esperado;
     *    • algo inválido foi informado     → substituir em silêncio faria o
     *      organizador acreditar que a rubrica dele foi salva, quando o sistema
     *      gravou OUTRA. Ele só descobriria ao ver os pareceres calculados por
     *      critérios que não definiu.
     *
     *  Erro presente significa que o organizador tentou definir algo e errou — e a
     *  resposta precisa dizer o que está errado.
     */
    if (errors.length > 0) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT',
        message: 'Rubrica inválida — corrija os critérios informados.',
        details: errors.map((entry) => entry.message),
      };
    }

    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, deletedAt: null },
        select: { id: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      const data = {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        maxSubmissionsPerAuthor: input.maxSubmissionsPerAuthor,
        requiresBlindReview: input.requiresBlindReview,
        reviewRubric: rubric as unknown as object,
        requiredReviews: input.requiredReviews,
        acceptanceThreshold: input.acceptanceThreshold,
        rejectThreshold: input.rejectThreshold,
        isActive: input.isActive,
      };

      if (input.trackId) {
        const before = await tx.track.findFirst({
          where: { id: input.trackId, eventId: input.eventId, deletedAt: null },
          select: {
            id: true,
            name: true,
            requiredReviews: true,
            isActive: true,
            /** A rubrica em vigor — o `before` da comparação de FORMA (FASE 39). */
            reviewRubric: true,
          },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Trilha não encontrada.' };
        }

        /**
         * ─────────────────────────────────────────────────────────────────────
         *  A FORMA DA RUBRICA CONGELA A PARTIR DO PRIMEIRO PARECER (FASE 39)
         * ─────────────────────────────────────────────────────────────────────
         *  Acrescentar critério zeraria a nota de todo parecer já enviado (o cálculo
         *  devolve `null` com um critério sem nota) e remover renormalizaria os pesos
         *  em silêncio. A guarda compara a rubrica que o organizador mandou com a que
         *  está EM VIGOR (o JSON gravado ou a padrão, se a trilha não tem própria) e
         *  recusa dizendo quantos pareceres existem.
         */
        const freeze = await assertRubricShapeFree(tx, {
          tenantId: input.tenantId,
          trackId: before.id,
          stored: before.reviewRubric,
          submitted: rubric,
        });

        if (!freeze.ok) {
          return { ok: false as const, code: 'RUBRIC_FROZEN' as const, message: freeze.message };
        }

        await tx.track.update({ where: { id: before.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'track',
            entityId: before.id,
            changes: diffFields(before, data, ['name', 'requiredReviews', 'isActive']),
          },
          tx,
        );

        return {
          ok: true as const,
          trackId: before.id,
          created: false,
          rubricWarning: usedDefault ? 'Nenhuma rubrica informada: foi aplicada a rubrica padrão.' : null,
        };
      }

      const id = randomUUID();

      await tx.track.create({ data: { id, tenantId: input.tenantId, eventId: input.eventId, ...data } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'track',
          entityId: id,
          changes: { name: { from: null, to: input.name }, requiredReviews: { from: null, to: input.requiredReviews } },
        },
        tx,
      );

      return { ok: true as const, trackId: id, created: true, rubricWarning: null };
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('slug')) {
      return {
        ok: false as const,
        code: 'SLUG_TAKEN',
        message: 'Já existe uma trilha com este identificador neste evento.',
      };
    }

    console.error(`[admin] falha ao salvar trilha: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível salvar a trilha.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resumo do painel
// ───────────────────────────────────────────────────────────────────────────────
export interface AdminOverview {
  events: number;
  publishedEvents: number;
  activities: number;
  registrations: number;
  attendees: number;
  submissions: number;
  certificates: number;
  cards: number;
  missions: number;
  /** Equipe: vínculos `kind = MEMBER` que ocupam vaga na quota do plano (FASE 14). */
  members: number;
  /** Público de eventos: `kind = PARTICIPANT`, não consome quota. */
  participants: number;
}

export async function getAdminOverview(tenantId: string): Promise<AdminOverview> {
  return withTenant(tenantId, async (tx) => {
    const [
      events,
      publishedEvents,
      activities,
      registrations,
      attendees,
      submissions,
      certificates,
      cards,
      missions,
      members,
      participants,
    ] = await Promise.all([
      tx.event.count({ where: { tenantId, deletedAt: null } }),
      tx.event.count({ where: { tenantId, deletedAt: null, status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] } } }),
      tx.activity.count({ where: { tenantId, deletedAt: null } }),
      tx.registration.count({ where: { tenantId, deletedAt: null, status: { in: ['CONFIRMED', 'ATTENDED'] } } }),
      tx.registration.count({ where: { tenantId, status: 'ATTENDED' } }),
      tx.submission.count({ where: { tenantId, deletedAt: null } }),
      tx.certificate.count({ where: { tenantId } }),
      tx.cardTemplate.count({ where: { tenantId, deletedAt: null } }),
      tx.taskDefinition.count({ where: { tenantId, deletedAt: null } }),
      // Mesmo critério da quota do plano: equipe ativa ou convidada (um convite
      // pendente já reserva lugar).
      tx.userTenantProfile.count({
        where: {
          tenantId,
          kind: 'MEMBER',
          status: { in: ['ACTIVE', 'INVITED'] },
          deletedAt: null,
        },
      }),
      tx.userTenantProfile.count({ where: { tenantId, kind: 'PARTICIPANT', deletedAt: null } }),
    ]);

    return {
      events,
      publishedEvents,
      activities,
      registrations,
      attendees,
      submissions,
      certificates,
      cards,
      missions,
      members,
      participants,
    };
  });
}

/** Valida uma missão antes de gravar (metas são JSON livre). */
export function validateMissionTarget(raw: unknown): { errors: string[] } {
  return { errors: parseTaskTarget(raw).errors };
}

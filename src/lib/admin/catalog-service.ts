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
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { diffFields, recordAudit } from '@/lib/admin/audit';
import { resolveTheme } from '@/domain/events/landing-page';
import { evaluateEventQuota } from '@/domain/platform/platform-rules';
import { readEventRegistrationPolicy } from '@/domain/events/public-registration-rules';
import { checkScheduleConflict, evaluateRoomFit } from '@/domain/events/event-rules';
import { parseRubric } from '@/domain/review/review-rules';
import { parseTaskTarget } from '@/domain/gamification/task-rules';

export type AdminErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'SLUG_TAKEN'
  | 'ROOM_CONFLICT'
  | 'ROOM_TOO_SMALL'
  /** O plano da instituição atingiu o limite de eventos (FASE 12, item C2). */
  | 'QUOTA_EXCEEDED'
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
  rooms: { id: string; name: string; capacity: number }[];
  activities: {
    id: string;
    slug: string;
    title: string;
    type: string;
    status: string;
    startsAt: Date;
    endsAt: Date;
    workloadMinutes: number;
    capacity: number | null;
    waitlistEnabled: boolean;
    roomId: string | null;
    roomName: string | null;
  }[];
  tracks: {
    id: string;
    slug: string;
    name: string;
    requiredReviews: number;
    acceptanceThreshold: number;
    rejectThreshold: number;
    isActive: boolean;
    submissionCount: number;
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
          orderBy: { startsAt: 'asc' },
          select: {
            id: true,
            slug: true,
            title: true,
            type: true,
            status: true,
            startsAt: true,
            endsAt: true,
            workloadMinutes: true,
            capacity: true,
            waitlistEnabled: true,
            roomId: true,
            room: { select: { name: true } },
          },
        },
        tracks: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            slug: true,
            name: true,
            requiredReviews: true,
            acceptanceThreshold: true,
            rejectThreshold: true,
            isActive: true,
            _count: { select: { submissions: true } },
          },
        },
        _count: { select: { activities: true, tracks: true, rooms: true, registrations: true } },
      },
    }),
  );

  if (!event) return null;

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
      type: activity.type,
      status: activity.status,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      workloadMinutes: activity.workloadMinutes,
      capacity: activity.capacity,
      waitlistEnabled: activity.waitlistEnabled,
      roomId: activity.roomId,
      roomName: activity.room?.name ?? null,
    })),
    tracks: event.tracks.map((track) => ({
      id: track.id,
      slug: track.slug,
      name: track.name,
      requiredReviews: track.requiredReviews,
      acceptanceThreshold: Number(track.acceptanceThreshold),
      rejectThreshold: Number(track.rejectThreshold),
      isActive: track.isActive,
      submissionCount: track._count.submissions,
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Salas
// ───────────────────────────────────────────────────────────────────────────────
export async function saveRoom(input: {
  tenantId: string;
  actorId: string;
  eventId: string;
  roomId?: string;
  name: string;
  capacity: number;
}): Promise<AdminResult<{ roomId: string; created: boolean }>> {
  try {
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
          where: { id: input.roomId },
          select: { id: true, name: true, capacity: true },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sala não encontrada.' };
        }

        await tx.room.update({
          where: { id: before.id },
          data: { name: input.name, capacity: input.capacity },
        });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'room',
            entityId: before.id,
            changes: diffFields(before, { name: input.name, capacity: input.capacity }, ['name', 'capacity']),
          },
          tx,
        );

        return { ok: true as const, roomId: before.id, created: false };
      }

      const id = randomUUID();

      await tx.room.create({
        data: { id, tenantId: input.tenantId, eventId: input.eventId, name: input.name, capacity: input.capacity },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'room',
          entityId: id,
          changes: { name: { from: null, to: input.name }, capacity: { from: null, to: input.capacity } },
        },
        tx,
      );

      return { ok: true as const, roomId: id, created: true };
    });
  } catch (error) {
    console.error(`[admin] falha ao salvar sala: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível salvar a sala.' };
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
export async function saveActivity(input: ActivityInput): Promise<AdminResult<{ activityId: string; created: boolean }>> {
  try {
    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT',
        message: 'O término da atividade precisa ser depois do início.',
      };
    }

    return await withTenant(input.tenantId, async (tx) => {
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
          code: 'INVALID_INPUT',
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
            code: 'ROOM_TOO_SMALL',
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
            code: 'ROOM_CONFLICT',
            message: `A sala "${room.name}" já está ocupada nesse horário${
              clashing?.title ? ` por "${clashing.title}"` : ''
            }.`,
          };
        }
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
          },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Atividade não encontrada.' };
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
            ]),
          },
          tx,
        );

        return { ok: true as const, activityId: before.id, created: false };
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
          },
        },
        tx,
      );

      return { ok: true as const, activityId: id, created: true };
    });
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
          select: { id: true, name: true, requiredReviews: true, isActive: true },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Trilha não encontrada.' };
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
    };
  });
}

/** Valida uma missão antes de gravar (metas são JSON livre). */
export function validateMissionTarget(raw: unknown): { errors: string[] } {
  return { errors: parseTaskTarget(raw).errors };
}

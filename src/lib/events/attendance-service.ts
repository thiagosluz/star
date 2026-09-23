/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Credenciamento (check-in / check-out)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CREDENCIAMENTO ENTROU NESTA FASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem presença não existe gatilho de gamificação para o PARTICIPANTE: submissão
 *  e parecer pertencem a autores e revisores, que são minoria. O check-in é o
 *  fato que move o participante comum — e é o que a FASE 3 deixou apenas
 *  modelado (`Attendance`, `checkInEnabled`, `badgeToken`).
 *
 *  A tela de credenciamento completa (busca por QR, credenciais de staff,
 *  indicadores) entra na FASE 7. O que existe aqui é o NÚCLEO: registrar presença
 *  de forma idempotente e auditável e, como consequência, distribuir XP, cartas e
 *  progresso de missão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CARGA HORÁRIA É REAL, NÃO PRESUMIDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `minutesAttended` é calculado entre check-in e check-out. A presença só vale
 *  para XP quando atinge 75 % da carga da atividade — é o mesmo limiar que a
 *  FASE 6 usará para emitir certificado. Sem esse piso, bastaria "bipar" a
 *  entrada para receber recompensa e a gamificação premiaria o comparecimento
 *  simbólico.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { sessionMinutes } from '@/domain/events/attendance-rules';
import { grantFullAttendanceCard } from '@/lib/gamification/achievement-service';
import {
  awardForEvent,
  rewardKeys,
  type RewardOutcome,
} from '@/lib/gamification/reward-engine';

/** Estados de inscrição relevantes para o credenciamento. */
type RegistrationStatusValue = 'CONFIRMED' | 'ATTENDED';

export type AttendanceErrorCode =
  | 'NOT_FOUND'
  | 'NOT_CONFIRMED'
  | 'ALREADY_CHECKED_IN'
  | 'NOT_CHECKED_IN'
  | 'WINDOW_CLOSED'
  | 'INTERNAL';

export type AttendanceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AttendanceErrorCode; message: string };

/**
 * Fração mínima da carga horária para a presença valer recompensa.
 *
 * Mesma constante que a FASE 6 usará na emissão de certificado — manter uma só
 * definição evita o cenário absurdo de "ganhou XP mas não tem direito ao
 * certificado" (ou o inverso).
 */
export const MIN_ATTENDANCE_RATIO = 0.75;

/** Piso em minutos quando a atividade não declara carga horária. */
export const MIN_ATTENDANCE_MINUTES = 30;

// ───────────────────────────────────────────────────────────────────────────────
//  Fila de credenciamento
// ───────────────────────────────────────────────────────────────────────────────
export interface CheckinQueueEntry {
  registrationId: string;
  userId: string;
  userName: string;
  userEmail: string;
  activityTitle: string | null;
  registrationStatus: string;
  badgeToken: string | null;
  checkedInAt: Date | null;
  /** Já tem entrada registrada e aguarda a saída. */
  isInside: boolean;
}

/**
 * Lista de inscritos do evento para o credenciamento.
 *
 * A busca é por NOME, e-mail ou token do crachá — os três jeitos de identificar
 * alguém no balcão. Um limite alto com filtro no banco evita trazer o evento
 * inteiro para a memória.
 */
export async function listCheckinQueue(
  tenantId: string,
  eventId: string,
  options: { query?: string; limit?: number } = {},
): Promise<AttendanceResult<{ entries: CheckinQueueEntry[]; total: number }>> {
  try {
    const query = options.query?.trim();
    const limit = Math.min(Math.max(1, options.limit ?? 50), 200);

    const data = await withTenant(tenantId, async (tx) => {
      /**
       * `mode: 'insensitive'` só existe no conector PostgreSQL; a anotação
       * `as const` no array de status é necessária porque o Prisma tipa `in`
       * como array MUTÁVEL e um literal `readonly` não é atribuível.
       */
      const where = {
        tenantId,
        eventId,
        deletedAt: null,
        status: { in: ['CONFIRMED', 'ATTENDED'] as RegistrationStatusValue[] },
        ...(query
          ? {
              OR: [
                { badgeToken: { contains: query, mode: 'insensitive' as const } },
                { user: { is: { name: { contains: query, mode: 'insensitive' as const } } } },
                { user: { is: { email: { contains: query, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        tx.registration.findMany({
          where,
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
          take: limit,
          select: {
            id: true,
            userId: true,
            status: true,
            badgeToken: true,
            checkedInAt: true,
            activity: { select: { title: true } },
            user: { select: { name: true, email: true } },
            /**
             * A ÚLTIMA presença decide se a pessoa está dentro.
             *
             * `registration.checkedInAt` NÃO serve para isso: ele marca que houve
             * entrada e nunca é limpo na saída — quem usasse esse campo veria o
             * participante "dentro" para sempre, e o botão continuaria oferecendo
             * saída mesmo depois de registrada (defeito encontrado pelo E2E).
             */
            attendances: {
              orderBy: { checkedInAt: 'desc' },
              take: 1,
              select: { checkedInAt: true, checkedOutAt: true },
            },
          },
        }),
        tx.registration.count({ where }),
      ]);

      return { rows, total };
    });

    return {
      ok: true as const,
      total: data.total,
      entries: data.rows.map((row) => {
        const lastAttendance = row.attendances[0] ?? null;
        const isInside = Boolean(lastAttendance && !lastAttendance.checkedOutAt);

        return {
          registrationId: row.id,
          userId: row.userId,
          userName: row.user?.name ?? 'Participante',
          userEmail: row.user?.email ?? '',
          activityTitle: row.activity?.title ?? null,
          registrationStatus: row.status,
          badgeToken: row.badgeToken,
          checkedInAt: isInside ? (lastAttendance?.checkedInAt ?? row.checkedInAt) : row.checkedInAt,
          isInside,
        };
      }),
    };
  } catch (error) {
    console.error(`[attendance] falha ao listar fila: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar a lista.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Check-in
// ───────────────────────────────────────────────────────────────────────────────
export interface CheckinOutcome {
  attendanceId: string;
  registrationId: string;
  alreadyCheckedIn: boolean;
  checkedInAt: Date;
  reward: RewardOutcome | null;
}

/**
 * Registra a entrada do participante.
 *
 * Idempotência em duas camadas:
 *   • `registration.checkedInAt` já preenchido → devolve o estado atual;
 *   • chave de XP `checkin:<tenant>:<registration>` → repetir não credita.
 *
 * A presença é registrada MESMO que a recompensa falhe: o fato do mundo (a
 * pessoa está no evento) não depende do sistema de pontos.
 */
export async function checkIn(input: {
  tenantId: string;
  registrationId: string;
  staffUserId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  qrNonce?: string | null;
}): Promise<AttendanceResult<CheckinOutcome>> {
  try {
    const now = input.now ?? new Date();

    const located = await withTenant(input.tenantId, async (tx) => {
      const registration = await tx.registration.findFirst({
        where: { id: input.registrationId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          userId: true,
          eventId: true,
          activityId: true,
          status: true,
          checkedInAt: true,
          activity: { select: { type: true, title: true } },
        },
      });

      return registration;
    });

    if (!located) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Inscrição não encontrada.' };
    }

    if (located.status !== 'CONFIRMED' && located.status !== 'ATTENDED') {
      return {
        ok: false as const,
        code: 'NOT_CONFIRMED',
        message: 'Esta inscrição não está confirmada — não há presença a registrar.',
      };
    }

    if (located.checkedInAt) {
      return {
        ok: true as const,
        attendanceId: '',
        registrationId: located.id,
        alreadyCheckedIn: true,
        checkedInAt: located.checkedInAt,
        reward: null,
      };
    }

    // ── Registro transacional da presença ───────────────────────────────────
    const attendanceId = await withTenant(input.tenantId, async (tx) => {
      /**
       * `updateMany` com `checkedInAt: null` na condição: se dois leitores de QR
       * dispararem juntos, apenas UM grava. O outro recebe 0 linhas e devolve
       * "já credenciado" — sem presença duplicada.
       */
      const updated = await tx.registration.updateMany({
        where: { id: located.id, checkedInAt: null },
        data: { checkedInAt: now, checkedInById: input.staffUserId, status: 'ATTENDED' },
      });

      if (updated.count === 0) return null;

      const attendance = await tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          eventId: located.eventId,
          activityId: located.activityId,
          registrationId: located.id,
          userId: located.userId,
          status: 'PRESENT',
          source: 'MANUAL_STAFF',
          checkedInAt: now,
          validatedById: input.staffUserId,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          qrNonce: input.qrNonce ?? null,
        },
        select: { id: true },
      });

      return attendance.id;
    });

    if (!attendanceId) {
      return {
        ok: true as const,
        attendanceId: '',
        registrationId: located.id,
        alreadyCheckedIn: true,
        checkedInAt: now,
        reward: null,
      };
    }

    // ── Recompensa (não-fatal) ──────────────────────────────────────────────
    const reward = await awardForEvent({
      tenantId: input.tenantId,
      userId: located.userId,
      source: 'CHECKIN',
      idempotencyKey: rewardKeys.checkin(input.tenantId, located.id),
      reason: located.activity?.title
        ? `Credenciamento — ${located.activity.title}`
        : 'Credenciamento no evento',
      eventId: located.eventId,
      activityId: located.activityId,
      activityType: located.activity?.type ?? null,
      registrationId: located.id,
      createdById: input.staffUserId,
      occurredAt: now,
    });

    return {
      ok: true as const,
      attendanceId,
      registrationId: located.id,
      alreadyCheckedIn: false,
      checkedInAt: now,
      reward: reward.ok ? reward : null,
    };
  } catch (error) {
    console.error(`[attendance] falha no check-in: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível registrar a entrada.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Check-in por crachá (leitor de QR Code)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Credencia pelo TOKEN do crachá, em vez do id da inscrição.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE TOKEN, E NÃO LEITURA DE CÂMERA NO NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────────
 *  O QR Code do crachá carrega `badgeToken`. No balcão, o equipamento real é um
 *  LEITOR USB, que se comporta como teclado: lê o código e "digita" o conteúdo no
 *  campo focado. Aceitar o token por formulário atende esse fluxo sem exigir
 *  câmera, permissão de vídeo e uma API de decodificação que varia por navegador —
 *  e funciona igual em um tablet sem câmera traseira.
 *
 *  O token é único globalmente (`Registration.badgeToken`), então a busca não
 *  precisa de contexto adicional além do tenant — e a RLS garante que um crachá de
 *  outra instituição não seja encontrado aqui.
 */
export async function checkInByBadgeToken(input: {
  tenantId: string;
  badgeToken: string;
  staffUserId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AttendanceResult<CheckinOutcome & { registrationId: string }>> {
  const token = input.badgeToken.trim();

  if (token.length === 0) {
    return { ok: false as const, code: 'NOT_FOUND', message: 'Informe o código do crachá.' };
  }

  try {
    const registration = await withTenant(input.tenantId, (tx) =>
      tx.registration.findFirst({
        where: { tenantId: input.tenantId, badgeToken: token, deletedAt: null },
        select: { id: true },
      }),
    );

    if (!registration) {
      return {
        ok: false as const,
        code: 'NOT_FOUND',
        message: 'Crachá não encontrado nesta instituição. Confira o código ou faça a busca por nome.',
      };
    }

    const result = await checkIn({
      tenantId: input.tenantId,
      registrationId: registration.id,
      staffUserId: input.staffUserId,
      now: input.now,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    if (!result.ok) return result;

    return { ...result, registrationId: registration.id };
  } catch (error) {
    console.error(`[attendance] falha no check-in por crachá: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL',
      message: 'Não foi possível registrar a entrada pelo crachá.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Check-out
// ───────────────────────────────────────────────────────────────────────────────
export interface CheckoutOutcome {
  attendanceId: string;
  minutesAttended: number;
  /** A presença atingiu o mínimo para valer recompensa? */
  countedForXp: boolean;
  activityType: string | null;
  rewards: RewardOutcome[];
  /**
   * Conquista de presença em TODAS as atividades (FASE 16). `null` quando não foi
   * concedida nesta saída; presente quando esta foi a última atividade que faltava.
   */
  fullAttendance: AchievementOutcome | null;
}

/** Conquista concedida no check-out (carta de presença total do evento). */
export interface AchievementOutcome {
  granted: true;
  cardName: string | null;
  /** Quantas atividades o evento exigia — o "tudo" que foi cumprido. */
  requiredCount: number;
}

/**
 * Registra a saída e calcula a carga horária efetivamente cumprida.
 *
 * Três recompensas possíveis, todas idempotentes por chave própria:
 *   1. `ACTIVITY_ATTENDANCE` quando a fração mínima foi atingida;
 *   2. `MINI_COURSE_COMPLETION` quando é minicurso e a fração foi atingida;
 *   3. carta de `EVENT_ATTENDANCE_FULL` quando o participante cobriu TODAS as
 *      atividades do evento (essa não credita XP — é conquista, não pontuação).
 */
export async function checkOut(input: {
  tenantId: string;
  registrationId: string;
  staffUserId: string;
  now?: Date;
}): Promise<AttendanceResult<CheckoutOutcome>> {
  try {
    const now = input.now ?? new Date();

    const located = await withTenant(input.tenantId, async (tx) => {
      const registration = await tx.registration.findFirst({
        where: { id: input.registrationId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          userId: true,
          eventId: true,
          activityId: true,
          checkedInAt: true,
          activity: { select: { type: true, workloadMinutes: true, endsAt: true } },
        },
      });

      if (!registration) return null;

      const attendance = await tx.attendance.findFirst({
        where: {
          tenantId: input.tenantId,
          registrationId: registration.id,
          checkedOutAt: null,
        },
        orderBy: { checkedInAt: 'desc' },
        select: { id: true, checkedInAt: true },
      });

      return { registration, attendance };
    });

    if (!located) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Inscrição não encontrada.' };
    }

    if (!located.attendance) {
      return {
        ok: false as const,
        code: 'NOT_CHECKED_IN',
        message: 'Não há entrada registrada para esta inscrição.',
      };
    }

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  OS MINUTOS TÊM TETO NO FIM DA ATIVIDADE (FASE 31)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A regra era "agora − entrada", e ela premiava o esquecimento: quem entrava na
     *  oficina de 60 min e não registrava saída saía com 180 minutos — que é a conta
     *  que PESA no sorteio (chance proporcional ao tempo), que compõe a carga do
     *  certificado e que decide a carta de presença total. A regra agora é uma só, no
     *  domínio, e vale para o balcão, para o crachá e para o fechamento automático.
     */
    const minutes = sessionMinutes({
      checkedInAt: located.attendance.checkedInAt,
      closedAt: now,
      activityEndsAt: located.registration.activity?.endsAt ?? null,
    });

    await withTenant(input.tenantId, (tx) =>
      tx.attendance.update({
        where: { id: located.attendance!.id },
        data: { checkedOutAt: now, minutesAttended: minutes },
      }),
    );

    const workload = located.registration.activity?.workloadMinutes ?? 0;
    const threshold = Math.max(
      MIN_ATTENDANCE_MINUTES,
      Math.round(workload * MIN_ATTENDANCE_RATIO),
    );
    const countedForXp = minutes >= threshold;

    const activityType = located.registration.activity?.type ?? null;
    const rewards: RewardOutcome[] = [];

    if (countedForXp) {
      const attendanceReward = await awardForEvent({
        tenantId: input.tenantId,
        userId: located.registration.userId,
        source: 'ACTIVITY_ATTENDANCE',
        idempotencyKey: rewardKeys.attendance(input.tenantId, located.registration.id),
        reason: `Presença de ${minutes} min em atividade`,
        eventId: located.registration.eventId,
        activityId: located.registration.activityId,
        activityType,
        minutes,
        registrationId: located.registration.id,
        createdById: input.staffUserId,
        occurredAt: now,
      });

      if (attendanceReward.ok) rewards.push(attendanceReward);

      if (activityType === 'MINI_COURSE') {
        const courseReward = await awardForEvent({
          tenantId: input.tenantId,
          userId: located.registration.userId,
          source: 'MINI_COURSE_COMPLETION',
          idempotencyKey: rewardKeys.miniCourse(input.tenantId, located.registration.id),
          reason: `Minicurso concluído (${minutes} min de ${workload || '—'} min)`,
          eventId: located.registration.eventId,
          activityId: located.registration.activityId,
          activityType,
          minutes,
          registrationId: located.registration.id,
          createdById: input.staffUserId,
          occurredAt: now,
        });

        if (courseReward.ok) rewards.push(courseReward);
      }
    }

    /**
     * ───────────────────────────────────────────────────────────────────────────
     *  CONQUISTA DE PRESENÇA TOTAL (FASE 16, item F1)
     * ───────────────────────────────────────────────────────────────────────────
     *  O gatilho `EVENT_ATTENDANCE_FULL` existia no catálogo e nunca disparava. Ele
     *  é avaliado AQUI, depois de a saída estar gravada, porque é o único momento em
     *  que se sabe que esta atividade terminou para esta pessoa.
     *
     *  Fica fora do `if (countedForXp)`: a conquista é sobre ter estado em TODAS as
     *  atividades, não sobre ter cumprido a fração mínima de uma. E o resultado dela
     *  NÃO entra em `rewards` — `rewards` é o que credita XP, e esta carta não move
     *  saldo (ver `achievement-service.ts`).
     *
     *  Falhar aqui não pode desfazer a saída: a conquista é avaliada em silêncio e o
     *  erro vira log (invariante nº 8 — a recompensa nunca derruba o fluxo).
     */
    let fullAttendance: AchievementOutcome | null = null;

    try {
      const outcome = await grantFullAttendanceCard({
        tenantId: input.tenantId,
        userId: located.registration.userId,
        eventId: located.registration.eventId,
        actorId: input.staffUserId,
        now,
      });

      if (outcome.ok && outcome.granted) {
        fullAttendance = {
          granted: true,
          cardName: outcome.cardName,
          requiredCount: outcome.requiredCount,
        };
      }
    } catch (error) {
      console.error(`[attendance] conquista de presença total falhou (não-fatal): ${errorMessage(error)}`);
    }

    return {
      ok: true as const,
      attendanceId: located.attendance.id,
      minutesAttended: minutes,
      countedForXp,
      activityType,
      rewards,
      fullAttendance,
    };
  } catch (error) {
    console.error(`[attendance] falha no check-out: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível registrar a saída.' };
  }
}

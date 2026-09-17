/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Inscrições
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO A SUPERLOTAÇÃO É IMPEDIDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A vaga é reservada por um UPDATE CONDICIONAL ATÔMICO sobre o contador
 *  denormalizado. Nada de "ler, comparar, inserir" — esse padrão perde para
 *  concorrência e é o defeito clássico de sistemas de inscrição.
 *
 *      1. INSERT da inscrição (com o userId único por atividade)
 *      2. UPDATE activities SET confirmedCount = confirmedCount + 1
 *          WHERE id = $1 AND (capacity IS NULL OR confirmedCount < capacity)
 *      3. rowCount === 0  ->  não havia vaga: ROLLBACK e tentar lista de espera
 *
 *  O PostgreSQL serializa UPDATEs na mesma linha: a segunda transação concorrente
 *  bloqueia, reavalia o predicado com o contador já atualizado e afeta 0 linhas.
 *  O resultado é determinístico, sem lock explícito e sem retry loop.
 *
 *  A prova está em `tests/integration/registration-concurrency.test.ts`:
 *  20 tentativas simultâneas em uma atividade com 5 vagas resultam em exatamente
 *  5 confirmadas e 15 rejeitadas — nunca 6.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import {
  type RegistrationStatus,
  canTransitionRegistration,
  cancelAffectsWaitlist,
  cancelReleasesSeat,
  decideRegistration,
  remainingSeats,
  type RegistrationDecision,
} from '@/domain/events/registration-rules';
import {
  evaluateRegistrationWindow,
  type ActivityStatus,
  type EventStatus,
} from '@/domain/events/event-rules';
import { invalidateTenantCache } from '@/lib/tenancy/tenant-resolver';
import {
  isTransientDbError,
  isUniqueViolation,
  violatedIndexName,
} from '@/lib/db/prisma-errors';

// ───────────────────────────────────────────────────────────────────────────────
//  Erros de aplicação
// ───────────────────────────────────────────────────────────────────────────────
export type RegistrationErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'ACTIVITY_NOT_FOUND'
  | 'TENANT_NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  | 'WINDOW_CLOSED'
  | 'DUPLICATE'
  | 'FULL'
  | 'FULL_NO_WAITLIST'
  | 'ALREADY_WAITLISTED'
  | 'ACTIVITY_CANCELED'
  | 'ACTIVITY_NOT_OPEN'
  | 'INVALID_TRANSITION'
  | 'NOT_REGISTERED'
  /** Conflito transitório do banco: a operação merece nova tentativa. */
  | 'CONFLICT'
  | 'SERIALIZATION_FAILURE'
  | 'INTERNAL';

export class RegistrationError extends Error {
  constructor(
    readonly code: RegistrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RegistrationError';
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resultado
// ───────────────────────────────────────────────────────────────────────────────
export type RegistrationOutcome =
  | {
      ok: true;
      status: Extract<RegistrationStatus, 'CONFIRMED' | 'WAITLISTED'>;
      registrationId: string;
      /** Posição na lista de espera, quando aplicável. */
      waitlistPosition: number | null;
      /** Vagas restantes após a operação. `null` = ilimitado. */
      remainingSeats: number | null;
    }
  | {
      ok: false;
      code: RegistrationErrorCode;
      message: string;
    };

// ───────────────────────────────────────────────────────────────────────────────
//  Contexto da atividade (para validação de janela)
// ───────────────────────────────────────────────────────────────────────────────
interface ActivityContext {
  id: string;
  slug: string;
  title: string;
  status: ActivityStatus;
  capacity: number | null;
  confirmedCount: number;
  waitlistEnabled: boolean;
  waitlistCount: number;
  startsAt: Date;
  endsAt: Date;
  eventId: string;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Inscrição
// ───────────────────────────────────────────────────────────────────────────────
export interface RegisterInput {
  tenantId: string;
  eventSlug: string;
  activitySlug: string;
  userId: string;
  /** Consentimentos LGPD coletados no formulário. */
  consentImage?: boolean;
  consentData?: boolean;
  accessibilityNotes?: string | null;
  formResponses?: Record<string, unknown>;
  /**
   * Ignora a checagem de janela. Usado APENAS pelo credenciamento presencial
   * (FASE 7), onde o staff inscreve alguém no balcão depois do início.
   */
  ignoreWindow?: boolean;
}

/**
 * Inscreve um usuário em uma atividade, com controle de lotação.
 *
 * A operação inteira roda em UMA transação com o contexto de tenant aplicado,
 * portanto todas as consultas e escritas já estão sob RLS.
 *
 * ─── RETRY EM CONFLITO DE ESCRITA ────────────────────────────────────────────
 * Sob contenção alta, o PostgreSQL pode abortar uma transação com erro de
 * serialização/deadlock (SQLSTATE 40001) ou o pool pode estourar o timeout de
 * aquisição. Nenhum dos dois é um erro de negócio: significam "tente de novo".
 *
 * O retry é seguro porque a operação é IDEMPOTENTE por natureza — o índice
 * único parcial impede inscrição duplicada, e a reserva de vaga só ocorre uma
 * vez por transação bem-sucedida. Reexecutar não corrompe estado.
 */
export async function registerForActivity(
  input: RegisterInput,
): Promise<RegistrationOutcome> {
  const MAX_ATTEMPTS = 4;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const outcome = await attemptRegistration(input);

    // Só repete em conflito transitório; erro de negócio é resposta final.
    if (outcome.ok || !isTransientFailure(outcome.code)) return outcome;

    // Backoff com jitter para desincronizar as tentativas concorrentes.
    const backoff = Math.min(15 * 2 ** attempt, 200);
    await new Promise((resolve) => setTimeout(resolve, backoff + Math.random() * backoff));
  }

  return {
    ok: false,
    code: 'INTERNAL',
    message:
      'Muita gente tentando se inscrever ao mesmo tempo. Tente novamente em instantes.',
  };
}

/** Uma tentativa de inscrição. Isolada para permitir o retry acima. */
async function attemptRegistration(
  input: RegisterInput,
): Promise<RegistrationOutcome> {
  const { tenantId, eventSlug, activitySlug, userId } = input;

  try {
    return await withTenant(
      tenantId,
      async (tx) => {
        // ── Resolve evento e atividade ---------------------------------------
        const event = await tx.event.findFirst({
          where: { slug: eventSlug, deletedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            startsAt: true,
            endsAt: true,
            capacity: true,
            confirmedCount: true,
            registrationOpensAt: true,
            registrationClosesAt: true,
          },
        });

        if (!event) {
          throw new RegistrationError('EVENT_NOT_FOUND', 'Evento não encontrado.');
        }

        const activity = await tx.activity.findFirst({
          where: { eventId: event.id, slug: activitySlug, deletedAt: null },
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            capacity: true,
            confirmedCount: true,
            waitlistEnabled: true,
            waitlistCount: true,
            startsAt: true,
            endsAt: true,
            eventId: true,
          },
        });

        if (!activity) {
          throw new RegistrationError(
            'ACTIVITY_NOT_FOUND',
            'Atividade não encontrada.',
          );
        }

        // ── Janela de inscrição ----------------------------------------------
        if (!input.ignoreWindow) {
          const window = evaluateRegistrationWindow({
            now: new Date(),
            eventStartsAt: event.startsAt,
            eventEndsAt: event.endsAt,
            eventStatus: event.status as EventStatus,
            registrationOpensAt: event.registrationOpensAt,
            registrationClosesAt: event.registrationClosesAt,
            activity: {
              startsAt: activity.startsAt,
              endsAt: activity.endsAt,
              status: activity.status as ActivityStatus,
            },
          });

          if (!window.open) {
            throw new RegistrationError('WINDOW_CLOSED', window.message);
          }
        }

        // ── Inscrição existente? ---------------------------------------------
        // O @@unique([activityId, userId]) é a garantia final; esta checagem
        // existe para devolver uma mensagem boa em vez de erro de constraint.
        const existing = await tx.registration.findFirst({
          where: { activityId: activity.id, userId, deletedAt: null },
          select: { id: true, status: true },
        });

        if (existing) {
          const decision = decideRegistration({
            capacity: activity.capacity,
            confirmedCount: activity.confirmedCount,
            waitlistEnabled: activity.waitlistEnabled,
            waitlistCount: activity.waitlistCount,
            alreadyRegistered: existing.status === 'CONFIRMED' || existing.status === 'PENDING',
            alreadyWaitlisted: existing.status === 'WAITLISTED',
            activityStatus: activity.status as ActivityStatus,
          });

          throw new RegistrationError(
            decision.outcome === 'REJECTED' ? decision.reason : 'DUPLICATE',
            decision.outcome === 'REJECTED'
              ? decision.message
              : 'Você já está inscrito nesta atividade.',
          );
        }

        // ── Tenta reservar vaga (caminho atômico) ----------------------------
        const attempt = await tryReserveSeat(tx, input, activity, event.id, userId);

        if (attempt.status === 'REJECTED') {
          throw new RegistrationError(attempt.reason, attempt.message);
        }

        // Reserva confirmada: o contador do evento acompanha o da atividade.
        // A vaga no evento é o TOTAL de inscrições confirmadas, não a soma das
        // atividades — por isso usamos um predicado próprio, sem contador de
        // atividade envolvido.
        if (attempt.status === 'CONFIRMED') {
          const reservedEventSeat = await reserveEventSeat(tx, event.id);
          if (!reservedEventSeat) {
            // Evento lotado embora a atividade tivesse vaga.
            throw new RegistrationError(
              'FULL',
              'A lotação total do evento foi atingida.',
            );
          }
        }

        return {
          ok: true as const,
          status: attempt.status,
          registrationId: attempt.registrationId,
          waitlistPosition: attempt.waitlistPosition,
          remainingSeats: attempt.remainingAfter,
        };
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    return toOutcome(error);
  }
}

/**
 * Executa a reserva. Chamada DUAS vezes em cenários diferentes:
 *   1. tentando vaga confirmada;
 *   2. caindo para a lista de espera quando não há vaga.
 *
 * A ordem importa: só tentamos a lista de espera quando o UPDATE condicional
 * devolve 0 linhas, ou seja, quando o banco confirma que não há vaga.
 */
async function tryReserveSeat(
  tx: TxClient,
  input: RegisterInput,
  activity: ActivityContext,
  eventId: string,
  userId: string,
): Promise<
  | {
      status: 'CONFIRMED' | 'WAITLISTED';
      registrationId: string;
      waitlistPosition: number | null;
      remainingAfter: number | null;
    }
  | { status: 'REJECTED'; reason: RegistrationErrorCode; message: string }
> {
  const baseData = {
    tenantId: input.tenantId,
    eventId,
    activityId: activity.id,
    userId,
    consentImage: input.consentImage ?? false,
    consentData: input.consentData ?? false,
    consentAt: new Date(),
    accessibilityNotes: input.accessibilityNotes ?? null,
    formResponses: (input.formResponses ?? {}) as object,
  };

  /**
   * ── 1. Tenta RESERVAR A VAGA antes de criar a inscrição ────────────────────
   *
   * A ordem importa. Se criássemos a inscrição primeiro e depois descobríssemos
   * que não há vaga, teríamos que apagá-la — e a linha apagada deixa rastro no
   * índice único parcial `registrations_live_activity_user_key`, fazendo o
   * INSERT seguinte na lista de espera colidir consigo mesmo.
   *
   * Reservando primeiro, a única escrita no caminho de espera é o INSERT da
   * própria lista de espera: sem ida e volta, sem colisão artificial.
   */
  const reserved = await tx.$executeRaw`
    UPDATE activities
       SET "confirmedCount" = "confirmedCount" + 1
     WHERE id = ${activity.id}::uuid
       AND ("capacity" IS NULL OR "confirmedCount" < "capacity")
  `;

  if (reserved === 1) {
    const registration = await tx.registration.create({
      data: { ...baseData, status: 'CONFIRMED' },
      select: { id: true },
    });

    return {
      status: 'CONFIRMED',
      registrationId: registration.id,
      waitlistPosition: null,
      remainingAfter: remainingSeats(activity.capacity, activity.confirmedCount + 1),
    };
  }

  // ── 2. Sem vaga: lista de espera ──────────────────────────────────────────
  if (!activity.waitlistEnabled) {
    return {
      status: 'REJECTED',
      reason: 'FULL',
      message: 'A atividade está lotada.',
    };
  }

  /**
   * A posição é calculada como `MAX(posição) + 1`. Requisições simultâneas podem
   * ler o mesmo máximo — um TOCTOU clássico. O índice único parcial
   * `registrations_waitlist_position_key` faz o banco rejeitar as perdedoras, e
   * aqui recalculamos a posição a partir do estado já consolidado.
   *
   * Sem isso, a fila ficaria com posições duplicadas e a ordem FIFO (que decide
   * quem é promovido quando uma vaga abre) seria arbitrária.
   *
   * Por que espera crescente entre tentativas: com N escritores disputando, sem
   * backoff todos recalculam no mesmo instante e voltam a colidir. O jitter
   * (aleatoriedade) evita que as tentativas se sincronizem em "manada".
   */
  const POSITION_ATTEMPTS = 12;
  let lastError: unknown;

  for (let attempt = 0; attempt < POSITION_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      // Backoff exponencial com jitter: 2ms, 4ms, 8ms... até ~250ms.
      const backoff = Math.min(2 ** attempt, 250);
      const jitter = Math.random() * backoff;
      await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
    }

    const currentMax = await tx.registration.aggregate({
      where: { activityId: activity.id, status: 'WAITLISTED' },
      _max: { waitlistPosition: true },
    });

    const nextPosition = (currentMax._max.waitlistPosition ?? 0) + 1;

    /**
     * SAVEPOINT: no PostgreSQL, um erro dentro de uma transação a ABORTA — todas
     * as instruções seguintes falham com "current transaction is aborted".
     * Sem o savepoint, a segunda tentativa do laço falharia sempre, mesmo que a
     * posição já estivesse livre.
     */
    await tx.$executeRawUnsafe('SAVEPOINT waitlist_pos');

    try {
      const waitlisted = await tx.registration.create({
        data: { ...baseData, status: 'WAITLISTED', waitlistPosition: nextPosition },
        select: { id: true, waitlistPosition: true },
      });

      await tx.$executeRaw`
        UPDATE activities
           SET "waitlistCount" = "waitlistCount" + 1
         WHERE id = ${activity.id}::uuid
      `;

      await tx.$executeRawUnsafe('RELEASE SAVEPOINT waitlist_pos');

      return {
        status: 'WAITLISTED',
        registrationId: waitlisted.id,
        waitlistPosition: waitlisted.waitlistPosition,
        remainingAfter: remainingSeats(activity.capacity, activity.confirmedCount),
      };
    } catch (error) {
      lastError = error;

      const conflict = classifyUniqueConflict(error);

      if (conflict === 'already-registered') {
        // Outra requisição do mesmo usuário ocupou a fila: não há o que refazer.
        throw new RegistrationError(
          'DUPLICATE',
          'Você já está inscrito nesta atividade.',
        );
      }

      if (conflict !== 'retry-position') throw error;

      // Desfaz apenas o INSERT que falhou, mantendo a transação utilizável.
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT waitlist_pos');
    }
  }

  /**
   * Esgotamos as tentativas. Ocorre apenas sob contenção extrema na mesma
   * atividade. Falhar aqui é melhor que gravar uma posição inconsistente —
   * e como estamos em transação, nada foi persistido.
   */
  logUnexpected('tryReserveSeat.waitlistPosition', lastError);
  return {
    status: 'REJECTED',
    reason: 'INTERNAL',
    message: 'Não foi possível entrar na lista de espera agora. Tente novamente.',
  };
}

/** Reserva uma vaga no evento. Retorna `false` quando o evento está lotado. */
async function reserveEventSeat(tx: TxClient, eventId: string): Promise<boolean> {
  const affected = await tx.$executeRaw`
    UPDATE events
       SET "confirmedCount" = "confirmedCount" + 1
     WHERE id = ${eventId}::uuid
       AND ("capacity" IS NULL OR "confirmedCount" < "capacity")
  `;
  return affected === 1;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cancelamento
// ───────────────────────────────────────────────────────────────────────────────
export interface CancelInput {
  tenantId: string;
  registrationId: string;
  userId: string;
  reason?: string | null;
}

export type CancelOutcome =
  | {
      ok: true;
      /** Alguém da lista de espera foi promovido? */
      promoted: { registrationId: string } | null;
    }
  | { ok: false; code: RegistrationErrorCode; message: string };

/**
 * Cancela uma inscrição e promove o próximo da lista de espera.
 *
 * O contador é decrementado APENAS quando a inscrição ocupava vaga
 * (`CONFIRMED`/`PENDING`). Cancelar algo já cancelado não pode inflar a lotação
 * disponível — isso permitiria superlotação por cancelamentos repetidos.
 */
export async function cancelRegistration(input: CancelInput): Promise<CancelOutcome> {
  const { tenantId, registrationId, userId, reason } = input;

  try {
    return await withTenant(
      tenantId,
      async (tx) => {
        const registration = await tx.registration.findFirst({
          where: { id: registrationId, userId, deletedAt: null },
          select: {
            id: true,
            status: true,
            activityId: true,
            eventId: true,
          },
        });

        if (!registration) {
          throw new RegistrationError(
            'NOT_REGISTERED',
            'Inscrição não encontrada.',
          );
        }

        const from = registration.status as RegistrationStatus;
        if (!canTransitionRegistration(from, 'CANCELED')) {
          throw new RegistrationError(
            'INVALID_TRANSITION',
            from === 'CANCELED'
              ? 'Esta inscrição já foi cancelada.'
              : 'Esta inscrição não pode mais ser cancelada.',
          );
        }

        await tx.registration.update({
          where: { id: registration.id },
          data: {
            status: 'CANCELED',
            canceledAt: new Date(),
            cancelReason: reason ?? null,
          },
        });

        // ── Decrementa o contador do evento, se ocupava vaga ────────────────
        if (cancelReleasesSeat(from)) {
          await tx.$executeRaw`
            UPDATE events
               SET "confirmedCount" = GREATEST("confirmedCount" - 1, 0)
             WHERE id = ${registration.eventId}::uuid
          `;
        }

        // Cancelou uma posição da lista de espera: só reindexa as posições.
        if (cancelAffectsWaitlist(from)) {
          await tx.$executeRaw`
            UPDATE activities
               SET "waitlistCount" = GREATEST("waitlistCount" - 1, 0)
             WHERE id = ${registration.activityId}::uuid
          `;
          await reindexWaitlist(tx, registration.activityId);
          return { ok: true as const, promoted: null };
        }

        if (!registration.activityId) {
          return { ok: true as const, promoted: null };
        }

        // ── Liberou vaga na atividade + promove o próximo ───────────────────
        await tx.$executeRaw`
          UPDATE activities
             SET "confirmedCount" = GREATEST("confirmedCount" - 1, 0)
           WHERE id = ${registration.activityId}::uuid
        `;

        const promoted = await promoteNextFromWaitlist(tx, registration.activityId);
        return { ok: true as const, promoted };
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    return toCancelOutcome(error);
  }
}

/**
 * Promove o primeiro da lista de espera, se a vaga realmente puder ser ocupada.
 *
 * Mesmo padrão do fluxo principal: o UPDATE condicional decide. Se outra
 * transação consumiu a vaga nesse meio-tempo, `reserved` é 0 e ninguém é
 * promovido — a inscrição permanece na espera.
 */
async function promoteNextFromWaitlist(
  tx: TxClient,
  activityId: string,
): Promise<{ registrationId: string } | null> {
  const next = await tx.registration.findFirst({
    where: { activityId, status: 'WAITLISTED', deletedAt: null },
    orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, userId: true },
  });

  if (!next) return null;

  const reserved = await tx.$executeRaw`
    UPDATE activities
       SET "confirmedCount" = "confirmedCount" + 1
     WHERE id = ${activityId}::uuid
       AND ("capacity" IS NULL OR "confirmedCount" < "capacity")
  `;

  if (reserved !== 1) return null;

  await tx.registration.update({
    where: { id: next.id },
    data: { status: 'CONFIRMED', waitlistPosition: null },
  });

  await tx.$executeRaw`
    UPDATE activities
       SET "waitlistCount" = GREATEST("waitlistCount" - 1, 0)
     WHERE id = ${activityId}::uuid
  `;

  await reindexWaitlist(tx, activityId);

  return { registrationId: next.id };
}

/** Reindexa as posições da lista de espera para 1..n, sem buracos. */
async function reindexWaitlist(
  tx: TxClient,
  activityId: string | null,
): Promise<void> {
  if (!activityId) return;

  // `ROW_NUMBER()` em um UPDATE mantém as posições contíguas após promoções —
  // sem isso, a posição exibida ao participante ficaria cheia de buracos.
  await tx.$executeRaw`
    UPDATE registrations r
       SET "waitlistPosition" = ordered.new_position
      FROM (
        SELECT id, ROW_NUMBER() OVER (
                 ORDER BY "waitlistPosition" ASC NULLS LAST, "createdAt" ASC
               ) AS new_position
          FROM registrations
         WHERE "activityId" = ${activityId}::uuid
           AND status = 'WAITLISTED'
           AND "deletedAt" IS NULL
      ) AS ordered
     WHERE r.id = ordered.id
  `;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Consulta da própria inscrição
// ───────────────────────────────────────────────────────────────────────────────
export interface MyRegistration {
  id: string;
  status: RegistrationStatus;
  waitlistPosition: number | null;
  createdAt: Date;
  activityId: string;
  activityTitle: string;
  activitySlug: string;
  activityStartsAt: Date;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
}

/** Inscrições do usuário autenticado nesta instituição. */
export async function listMyRegistrations(
  tenantId: string,
  userId: string,
): Promise<MyRegistration[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.registration.findMany({
      where: { userId, deletedAt: null, status: { not: 'CANCELED' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        waitlistPosition: true,
        createdAt: true,
        activityId: true,
        eventId: true,
        activity: { select: { title: true, slug: true, startsAt: true } },
        event: { select: { title: true, slug: true } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    status: row.status as RegistrationStatus,
    waitlistPosition: row.waitlistPosition,
    createdAt: row.createdAt,
    activityId: row.activityId ?? '',
    activityTitle: row.activity?.title ?? 'Atividade removida',
    activitySlug: row.activity?.slug ?? '',
    activityStartsAt: row.activity?.startsAt ?? row.createdAt,
    eventId: row.eventId,
    eventTitle: row.event.title,
    eventSlug: row.event.slug,
  }));
}

/** Inscrição do usuário em UMA atividade, se existir. */
export async function findMyRegistrationFor(
  tenantId: string,
  userId: string,
  activityId: string,
): Promise<{ id: string; status: RegistrationStatus; waitlistPosition: number | null } | null> {
  const row = await withTenant(tenantId, (tx) =>
    tx.registration.findFirst({
      where: { userId, activityId, deletedAt: null },
      select: { id: true, status: true, waitlistPosition: true },
    }),
  );

  if (!row) return null;
  return {
    id: row.id,
    status: row.status as RegistrationStatus,
    waitlistPosition: row.waitlistPosition,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Conversão de erro
// ───────────────────────────────────────────────────────────────────────────────
function toOutcome(error: unknown): RegistrationOutcome {
  if (error instanceof RegistrationError) {
    return { ok: false, code: error.code, message: error.message };
  }

  // Corrida no índice único: outra requisição do mesmo usuário venceu.
  if (isUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE',
      message: 'Você já está inscrito nesta atividade.',
    };
  }

  /**
   * Conflito transitório (deadlock / serialização / estouro de tempo da
   * transação). Não é falha de negócio nem bug: é contenção. Devolvemos um
   * código que o retry reconhece.
   *
   * Não logamos: sob carga concorrente isso é rotina e poluiria o log.
   */
  if (isTransientDbError(error)) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'Conflito temporário ao processar a inscrição. Tente novamente.',
    };
  }

  logUnexpected('registerForActivity', error);
  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Não foi possível concluir a inscrição. Tente novamente.',
  };
}

function toCancelOutcome(error: unknown): CancelOutcome {
  if (error instanceof RegistrationError) {
    return { ok: false, code: error.code, message: error.message };
  }
  logUnexpected('cancelRegistration', error);
  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Não foi possível cancelar a inscrição. Tente novamente.',
  };
}

/**
 * O erro é uma colisão que vale a pena reprocessar?
 *
 * Duas colisões são esperadas quando há disputa pela lista de espera:
 *
 *   • `registrations_waitlist_position_key` — outra transação pegou a posição
 *     que havíamos calculado. Recalcular resolve.
 *
 *   • `registrations_live_activity_user_key` — outra requisição do MESMO usuário
 *     acabou de entrar na fila. Aqui não há o que recalcular: a inscrição já
 *     existe, então devolvemos "já inscrito" em vez de tentar de novo.
 *
 * Qualquer outra violação (inclusive posse não reconhecida) propaga.
 *
 * `isUniqueViolation` e `violatedIndexName` vêm de `@/lib/db/prisma-errors` —
 * a leitura do formato do driver adapter mora em um lugar só.
 */
function classifyUniqueConflict(
  error: unknown,
): 'retry-position' | 'already-registered' | 'unrelated' {
  if (!isUniqueViolation(error)) return 'unrelated';

  const index = violatedIndexName(error);

  if (index === 'registrations_waitlist_position_key') return 'retry-position';
  if (index === 'registrations_live_activity_user_key') return 'already-registered';

  return 'unrelated';
}

function logUnexpected(operation: string, error: unknown): void {
  console.error(
    `[registration] falha inesperada em ${operation}:`,
    error instanceof Error ? error.message : error,
  );
}

/**
 * A falha é transitória (vale tentar de novo)?
 *
 *   • `SERIALIZATION_FAILURE` — marcado explicitamente pela aplicação quando o
 *     banco devolve morte por deadlock/serialização (SQLSTATE 40001).
 *   • `P2034` — o Prisma sinaliza conflito de escrita/deadlock neste código.
 *   • `P2028` / mensagem de timeout de transação — a transação não terminou a
 *     tempo por causa da disputa, não por excesso de trabalho.
 */
function isTransientFailure(code: RegistrationErrorCode | undefined): boolean {
  return code === 'SERIALIZATION_FAILURE' || code === 'CONFLICT';
}

/** Exposto para os testes de integração medirem o estado real. */
export async function readActivityCounters(
  tenantId: string,
  activityId: string,
): Promise<{ confirmedCount: number; waitlistCount: number; capacity: number | null } | null> {
  const row = await withTenant(tenantId, (tx) =>
    tx.activity.findFirst({
      where: { id: activityId },
      select: { confirmedCount: true, waitlistCount: true, capacity: true },
    }),
  );
  return row ?? null;
}

export { invalidateTenantCache, type RegistrationDecision };

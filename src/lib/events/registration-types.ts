import {
  isTransientDbError,
  isUniqueViolation,
  violatedIndexName,
} from '@/lib/db/prisma-errors';
import { logger } from '@/lib/observability/logger';
import type { ActivityStatus } from '@/domain/events/event-rules';
import type { RegistrationDecision, RegistrationStatus } from '@/domain/events/registration-rules';
import type { ConfirmationPolicy } from '@/domain/events/confirmation-rules';
import type { ParticipantLinkDecision } from '@/domain/events/public-registration-rules';

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
  /** Atividade aberta a todos os inscritos: a inscrição é a do EVENTO. */
  | 'ACTIVITY_OPEN'
  /** A instituição suspendeu ou removeu o vínculo desta pessoa. */
  | 'MEMBERSHIP_BLOCKED'
  /**
   * O evento é restrito à comunidade e esta pessoa não tem vínculo ATIVO (FASE 70).
   *
   * Código próprio, e não `MEMBERSHIP_BLOCKED`: "você foi bloqueado" e "este evento
   * pede vínculo" mandam a pessoa fazer coisas diferentes — uma fala com a
   * organização, a outra pede o vínculo. Juntar as duas esconderia o caminho.
   */
  | 'MEMBERSHIP_REQUIRED'
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
//  Resultado e entradas
// ───────────────────────────────────────────────────────────────────────────────
export type RegistrationOutcome =
  | {
      ok: true;
      /**
       * `PENDING` = a vaga está RETIDA aguardando a confirmação da equipe (FASE 34).
       * A tela usa isto para dizer "confirme até <data>" em vez de "inscrição
       * confirmada" — prometer o que ainda depende do balcão seria mentira.
       */
      status: Extract<RegistrationStatus, 'PENDING' | 'CONFIRMED' | 'WAITLISTED'>;
      registrationId: string;
      /** Posição na lista de espera, quando aplicável. */
      waitlistPosition: number | null;
      /** Vagas restantes após a operação. `null` = ilimitado. */
      remainingSeats: number | null;
      /** Quando o prazo de confirmação vence. Nulo nas atividades automáticas. */
      confirmationDueAt: Date | null;
      /**
       * O prazo já formatado NO FUSO DO EVENTO (FASE 34).
       *
       * Vem pronto do serviço porque o processo roda em UTC no container: formatar na
       * tela com o fuso do processo mostraria "até 26/09, 02:59" onde o e-mail diz
       * "até 25/09, 23:59" — duas respostas para a mesma pergunta, e a da tela seria a
       * errada (armadilha 38).
       */
      confirmationDueLabel: string | null;
      /**
       * `true` quando esta inscrição CRIOU o vínculo de participante (inscrição
       * pública). A UI usa para explicar à pessoa que ela passou a ser participante
       * da instituição — e que aquilo foi consequência do que ela pediu.
       */
      linkedAsParticipant: boolean;
    }
  | {
      ok: false;
      code: RegistrationErrorCode;
      message: string;
    };

export interface ActivityContext {
  id: string;
  slug: string;
  title: string;
  status: ActivityStatus;
  /**
   * LIMITE EFETIVO da atividade (revisão da FASE 3): o menor entre a lotação que
   * ela declara e a capacidade da SALA onde acontece (`effectiveActivityCapacity`).
   */
  capacity: number | null;
  confirmedCount: number;
  waitlistEnabled: boolean;
  waitlistCount: number;
  startsAt: Date;
  endsAt: Date;
  eventId: string;
  confirmationPolicy: ConfirmationPolicy;
  confirmationWindowDays: number | null;
  confirmationRequirements: unknown;
}

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

export interface RegisterForEventInput {
  tenantId: string;
  eventSlug: string;
  userId: string;
  consentImage?: boolean;
  consentData?: boolean;
  accessibilityNotes?: string | null;
  formResponses?: Record<string, unknown>;
  /** Ignora a checagem de janela (credenciamento presencial). */
  ignoreWindow?: boolean;
}

export type RegisterForEventOutcome =
  | {
      ok: true;
      registrationId: string;
      waitlisted: boolean;
      waitlistPosition: number | null;
      enrolledActivities: number;
      titles: readonly string[];
      linkedAsParticipant: boolean;
    }
  | { ok: false; code: RegistrationErrorCode; message: string };

export interface EventAdmissionContext {
  id: string;
  title: string;
  capacity: number | null;
  settings: unknown;
  tenantName: string;
}

export type EventAdmissionCore =
  | {
      registrationId: string;
      waitlisted: boolean;
      waitlistPosition: number | null;
      inserted: boolean;
    }
  | null;

export interface EnsureEventRegistrationInput {
  tenantId: string;
  userId: string;
  /** O evento já lido pela transação da ATIVIDADE — sem consulta nova. */
  event: EventAdmissionContext;
  linkDecision: ParticipantLinkDecision;
  consentImage: boolean;
  consentData: boolean;
  accessibilityNotes: string | null;
  formResponses: object;
}

export interface UpdateEventRegistrationInput {
  tenantId: string;
  userId: string;
  eventSlug: string;
  consentImage: boolean;
  consentData: boolean;
  accessibilityNotes: string | null;
  /** Respostas NOVAS — mescladas sobre as existentes, sem apagar o que já havia. */
  formResponses?: Record<string, unknown>;
}

export type UpdateEventRegistrationOutcome =
  | { ok: true; registrationId: string; status: RegistrationStatus }
  | { ok: false; code: RegistrationErrorCode; message: string };

export interface CancelInput {
  tenantId: string;
  registrationId: string;
  userId: string;
  reason?: string | null;
}

export type CancelOutcome =
  | {
      ok: true;
      promoted: { registrationId: string }[];
    }
  | { ok: false; code: RegistrationErrorCode; message: string };

export interface AcceptPromotionInput {
  tenantId: string;
  registrationId: string;
  userId: string;
}

export type AcceptPromotionOutcome =
  | { ok: true; registrationId: string }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_REQUIRED' | 'EXPIRED' | 'ALREADY_SETTLED' | 'INTERNAL'; message: string };

export type { RegistrationDecision };

// ───────────────────────────────────────────────────────────────────────────────
//  Conversão e classificação de erro
// ───────────────────────────────────────────────────────────────────────────────
export function toOutcome(error: unknown): RegistrationOutcome {
  if (error instanceof RegistrationError) {
    return { ok: false, code: error.code, message: error.message };
  }

  if (isUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE',
      message: 'Você já está inscrito nesta atividade.',
    };
  }

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

export function toEventOutcome(error: unknown): RegisterForEventOutcome {
  if (error instanceof RegistrationError) {
    return { ok: false, code: error.code, message: error.message };
  }

  logUnexpected('registerForEvent', error);
  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Não foi possível concluir a inscrição. Tente novamente.',
  };
}

export function toCancelOutcome(error: unknown): CancelOutcome {
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

export function classifyUniqueConflict(
  error: unknown,
): 'retry-position' | 'already-registered' | 'already-in-event' | 'unrelated' {
  if (!isUniqueViolation(error)) return 'unrelated';

  const index = violatedIndexName(error);

  if (index === 'registrations_waitlist_position_key') return 'retry-position';
  if (index === 'registrations_live_activity_user_key') return 'already-registered';
  if (index === 'registrations_live_event_user_key') return 'already-in-event';

  return 'unrelated';
}

export function logUnexpected(operation: string, error: unknown): void {
  logger.error(`[registration] falha inesperada em ${operation}:`, {
    error: error instanceof Error ? error.message : error,
  });
}

export function isTransientFailure(code: RegistrationErrorCode | undefined): boolean {
  return code === 'SERIALIZATION_FAILURE' || code === 'CONFLICT';
}

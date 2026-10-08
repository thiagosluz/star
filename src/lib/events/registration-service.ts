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
  canAcceptPromotion,
  registrationIsLive,
  cancelAffectsWaitlist,
  cancelReleasesSeat,
  decideRegistration,
  eventHasWaitlist,
  promotionDeadline,
  remainingSeats,
  RESERVE_ACTIVITY_SEAT_SQL,
  RESERVE_EVENT_SEAT_SQL,
  RESERVE_OPEN_ACTIVITY_SEAT_SQL,
  type RegistrationDecision,
} from '@/domain/events/registration-rules';
import {
  effectiveActivityCapacity,
  evaluateRegistrationWindow,
  type ActivityStatus,
  type EventStatus,
} from '@/domain/events/event-rules';
import { acceptsAutoEnrollment } from '@/domain/events/activity-rules';
import {
  confirmationCountdown,
  confirmationDeadlineLabel,
  confirmationDueAt,
  confirmationStateOf,
  parseConfirmationRequirements,
  requirementLabel,
  type ConfirmationPolicy,
  type ConfirmationState,
} from '@/domain/events/confirmation-rules';
import {
  itemsSummary,
  itemStatusLabel,
  normalizeItemStatus,
  snapshotRequirements,
  type ConfirmationItemStatus,
} from '@/domain/events/confirmation-item-rules';
import {
  notifyConfirmationRequired,
  notifyWaitlistPromoted,
} from '@/lib/events/registration-notices';
import {
  PUBLIC_REGISTRATION_ROLE,
  evaluateParticipantLink,
  isOpenToPublicEvent,
  readEventRegistrationPolicy,
  shouldGrantParticipantRole,
  type MembershipStatusName,
  type ParticipantLinkDecision,
} from '@/domain/events/public-registration-rules';
import { recordAudit } from '@/lib/admin/audit';
import {
  erasePersonalFormResponses,
  readRegistrationForm,
  type RegistrationFormField,
} from '@/domain/events/registration-form-spec-rules';
import { rewardRegistrationConfirmedById } from '@/lib/gamification/hooks';
import { revertRegistrationReward } from '@/lib/gamification/xp-reversal';
import {
  kindAfterPublicRegistration,
  type MembershipKind as MembershipKindName,
} from '@/domain/tenancy/membership-rules';
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
//  Resultado
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

// ───────────────────────────────────────────────────────────────────────────────
//  Contexto da atividade (para validação de janela)
// ───────────────────────────────────────────────────────────────────────────────
interface ActivityContext {
  id: string;
  slug: string;
  title: string;
  status: ActivityStatus;
  /**
   * LIMITE EFETIVO da atividade (revisão da FASE 3): o menor entre a lotação que
   * ela declara e a capacidade da SALA onde acontece (`effectiveActivityCapacity`).
   *
   * `null` = ilimitada de verdade (nem a atividade nem a sala declaram limite);
   * `0` = esgotada. Quem monta este contexto já aplicou o teto da sala, então todo
   * consumidor daqui para baixo — mensagem de lotação, vagas restantes, decisão de
   * lista de espera — fala do número real, e não do que foi digitado na tela.
   */
  capacity: number | null;
  confirmedCount: number;
  waitlistEnabled: boolean;
  waitlistCount: number;
  startsAt: Date;
  endsAt: Date;
  eventId: string;
  /**
   * Como a vaga desta atividade é confirmada (FASE 34). `REQUIRED` faz a inscrição
   * nascer `PENDING`, RETENDO a vaga até a equipe confirmar — é a diferença entre
   * "reservei" e "é meu".
   */
  confirmationPolicy: ConfirmationPolicy;
  /** Prazo em dias, contado da inscrição de cada pessoa. Nulo quando `AUTO`. */
  confirmationWindowDays: number | null;
  /**
   * A LISTA de exigências da atividade (JSON, FASE 34) — lida aqui para virar o
   * SNAPSHOT da inscrição (FASE 37): o que a pessoa foi cobrada é um fato do dia em que
   * ela se inscreveu, e editar a atividade depois não pode reescrevê-lo.
   */
  confirmationRequirements: unknown;
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
    if (outcome.ok || !isTransientFailure(outcome.code)) {
      /**
       * ── A VAGA ESTÁ RETIDA: AVISE ENQUANTO HÁ TEMPO (FASE 34) ────────────────
       *
       * O aviso sai aqui, no SERVIÇO, e não em cada tela: a inscrição nasce em mais
       * de um caminho (página pública, balcão do credenciamento), e um caminho novo
       * que esquecesse de avisar produziria uma vaga liberada sem ninguém nunca ter
       * sido avisado de que precisava confirmar (o defeito da armadilha 65).
       *
       * Fora da transação e sem lançar (invariante 8): a inscrição está gravada, e a
       * falha do provedor de e-mail não pode desfazê-la. O retorno diz se saiu.
       */
      if (outcome.ok && outcome.status === 'PENDING') {
        const notice = await notifyConfirmationRequired({
          tenantId: input.tenantId,
          registrationId: outcome.registrationId,
        });

        if (!notice.ok) {
          console.error(
            `[inscricoes] aviso de confirmação não saiu: ${notice.message ?? 'motivo desconhecido'}`,
          );
        }
      }

      /**
       * ── INSCRIÇÃO CONFIRMADA NA ATIVIDADE (FASE 43) ──────────────────────────
       *
       *  Só a vaga GARANTIDA credita: `WAITLISTED` espera a promoção e `PENDING`
       *  espera o balcão — nos dois casos o crédito sai do caminho que confirmar a
       *  vaga (promoção/confirmação), com a MESMA chave de idempotência (a inscrição).
       *  Creditá-los aqui pagaria por uma vaga que pode nunca existir.
       */
      if (outcome.ok && outcome.status === 'CONFIRMED') {
        await rewardRegistrationConfirmedById({
          tenantId: input.tenantId,
          registrationId: outcome.registrationId,
        });
      }

      return outcome;
    }

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
            settings: true,
            /** O prazo de confirmação é calculado no FUSO DO EVENTO (FASE 34). */
            timezone: true,
            /**
             * O NOME da instituição entra na recusa de evento restrito (FASE 70) — a
             * mensagem diz de QUAL comunidade a pessoa precisa participar.
             */
            tenant: { select: { name: true } },
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
            requiresRegistration: true,
            /** Confirmação de vaga (FASE 34) e o snapshot das exigências (FASE 37). */
            confirmationPolicy: true,
            confirmationWindowDays: true,
            confirmationRequirements: true,
            /** O teto da sala entra no limite efetivo (revisão da FASE 3). */
            room: { select: { capacity: true } },
          },
        });

        if (!activity) {
          throw new RegistrationError(
            'ACTIVITY_NOT_FOUND',
            'Atividade não encontrada.',
          );
        }

        /**
         * ─────────────────────────────────────────────────────────────────────────
         *  ATIVIDADE ABERTA NÃO TEM INSCRIÇÃO PRÓPRIA (revisão da FASE 3)
         * ─────────────────────────────────────────────────────────────────────────
         *  Quem quer participar de uma atividade aberta se inscreve no EVENTO — e a
         *  inscrição no evento já a inscreveu nela. Aceitar um segundo caminho
         *  criaria duas portas para o mesmo lugar: uma delas sem controle de lotação
         *  e sem a inscrição do evento, que é justamente o que dá acesso à
         *  programação. A recusa diz para onde ir.
         */
        if (!activity.requiresRegistration) {
          throw new RegistrationError(
            'ACTIVITY_OPEN',
            'Esta atividade é aberta a todos os inscritos no evento — não há inscrição individual. Inscreva-se no evento para participar.',
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

        // ── Vínculo do participante ------------------------------------------
        /**
         * Lido ANTES de reservar a vaga, por dois motivos:
         *   1. quem está bloqueado pela instituição recebe a recusa sem consumir
         *      vaga nem criar linha de inscrição;
         *   2. a decisão é tomada uma única vez, e aplicada depois — aplicar o
         *      vínculo só depois de a inscrição existir mantém a atomicidade: se a
         *      reserva falhar, ninguém vira participante de lugar nenhum.
         */
        const linkDecision = await decideParticipantLink(tx, {
          tenantId,
          userId,
          eventIsPublic: isOpenToPublicEvent({ eventStatus: event.status, settings: event.settings }),
          requiresMembership: readEventRegistrationPolicy(event.settings).requiresMembership,
          tenantName: event.tenant.name,
        });

        if (linkDecision.action === 'BLOCKED') {
          throw new RegistrationError(
            /**
             * O evento restrito tem código PRÓPRIO (FASE 70): a pessoa precisa saber
             * que o caminho é pedir o vínculo, e não que a conta dela foi barrada.
             */
            readEventRegistrationPolicy(event.settings).requiresMembership
              ? 'MEMBERSHIP_REQUIRED'
              : 'MEMBERSHIP_BLOCKED',
            linkDecision.message ?? 'Inscrição não permitida para esta conta.',
          );
        }

        /**
         * ─────────────────────────────────────────────────────────────────────────
         *  O LIMITE EFETIVO DA ATIVIDADE (revisão da FASE 3)
         * ─────────────────────────────────────────────────────────────────────────
         *  Calculado UMA vez, aqui, e usado nas três decisões desta tentativa: a
         *  mensagem de duplicidade, a reserva atômica e o que sobra depois. A sala
         *  é um teto, então "80 vagas numa sala de 40" são 40 vagas de verdade.
         */
        const effectiveCapacity = effectiveActivityCapacity(
          activity.capacity,
          activity.room?.capacity ?? null,
        );

        // ── Inscrição existente? ---------------------------------------------
        // O @@unique([activityId, userId]) é a garantia final; esta checagem
        // existe para devolver uma mensagem boa em vez de erro de constraint.
        const existing = await tx.registration.findFirst({
          where: { activityId: activity.id, userId, deletedAt: null },
          select: { id: true, status: true },
        });

        /**
         * Só uma inscrição VIVA bloqueia (FASE 50): CANCELED e NO_SHOW são histórico, e
         * quem tem histórico pode voltar — a linha nova é que ocupa a vaga (o índice
         * único parcial do banco é quem garante uma viva por vez).
         */
        if (existing && registrationIsLive(existing.status as RegistrationStatus)) {
          const decision = decideRegistration({
            capacity: effectiveCapacity,
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
        const attempt = await tryReserveSeat(
          tx,
          input,
          {
            id: activity.id,
            slug: activity.slug,
            title: activity.title,
            status: activity.status as ActivityStatus,
            capacity: effectiveCapacity,
            confirmedCount: activity.confirmedCount,
            waitlistEnabled: activity.waitlistEnabled,
            waitlistCount: activity.waitlistCount,
            startsAt: activity.startsAt,
            endsAt: activity.endsAt,
            eventId: activity.eventId,
            confirmationPolicy: activity.confirmationPolicy,
            confirmationWindowDays: activity.confirmationWindowDays,
            confirmationRequirements: activity.confirmationRequirements,
          },
          event.id,
          userId,
          event.timezone,
        );

        if (attempt.status === 'REJECTED') {
          throw new RegistrationError(attempt.reason, attempt.message);
        }

        /**
         * ── A INSCRIÇÃO NA ATIVIDADE MATERIALIZA A INSCRIÇÃO NO EVENTO (FASE 70) ─
         *
         *  Aqui ficava a reserva do lugar no EVENTO — feita na linha da ATIVIDADE.
         *  O efeito medido era um buraco: quem só entrou numa oficina não tinha
         *  inscrição no evento, e ainda assim podia emitir o certificado de
         *  participação do evento (sem CPF, porque o CPF só é lido da linha do
         *  evento), enquanto o painel contava linhas misturando os dois.
         *
         *  Agora a reserva mudou de dono: a vaga do evento é da LINHA DO EVENTO, e é
         *  `ensureEventRegistration` quem a reserva — uma vez por pessoa por evento.
         *  Manter as duas cobraria DUAS vagas por pessoa (o invariante é uma).
         *
         *  O evento lotado NÃO recusa a atividade: a pessoa entra na FILA do evento e
         *  a atividade segue. Recusar aqui seria dizer que a oficina está cheia quando
         *  o que está cheio é o evento.
         */
        const eventRegistration = await ensureEventRegistration(tx, {
          tenantId,
          userId,
          event: {
            id: event.id,
            title: event.title,
            capacity: event.capacity,
            settings: event.settings,
            tenantName: event.tenant.name,
          },
          linkDecision,
          consentImage: input.consentImage ?? false,
          consentData: input.consentData ?? false,
          accessibilityNotes: input.accessibilityNotes ?? null,
          formResponses: (input.formResponses ?? {}) as object,
        });

        if (eventRegistration.created) {
          /**
           * A TRILHA registra o que a ATIVIDADE provocou de novo. Sem esta linha, a
           * inscrição no evento apareceria do nada para quem audita: a pessoa só
           * pediu a oficina.
           */
          await recordAudit(
            {
              tenantId,
              userId,
              action: 'CREATE',
              entityType: 'registration',
              entityId: eventRegistration.registrationId,
              changes: {
                evento: { from: null, to: event.title },
                tipo: {
                  from: null,
                  to: eventRegistration.waitlisted
                    ? 'fila do evento (aberta pela inscrição em atividade)'
                    : 'inscrição no evento (aberta pela inscrição em atividade)',
                },
              },
            },
            tx,
          );
        }

        const linkedAsParticipant = await applyParticipantLink(tx, {
          tenantId,
          userId,
          decision: linkDecision,
        });

        return {
          ok: true as const,
          status: attempt.status,
          registrationId: attempt.registrationId,
          waitlistPosition: attempt.waitlistPosition,
          remainingSeats: attempt.remainingAfter,
          linkedAsParticipant,
          confirmationDueAt: attempt.confirmationDueAt,
          confirmationDueLabel: attempt.confirmationDueAt
            ? confirmationDeadlineLabel(attempt.confirmationDueAt, event.timezone)
            : null,
        };
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    return toOutcome(error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Vínculo do participante (inscrição pública)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Dá vínculo de participante a quem chegou por um caminho PÚBLICO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É EXPORTADO (FASE 33)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição pública (FASE 10) e a submissão de proposta pela chamada (FASE 33)
 *  fazem a MESMA pergunta: "esta pessoa, que acabou de criar conta, pode passar a
 *  participar desta instituição pública?". A resposta é uma regra só
 *  (`evaluateParticipantLink` + `kindAfterPublicRegistration`, em
 *  `src/domain/tenancy/membership-rules.ts`) — e uma segunda cópia dela faria a
 *  proposta aceitar quem a inscrição recusa, ou o contrário, sem ninguém notar
 *  (armadilha 55).
 *
 *  Roda na transação do CHAMADOR, de propósito: o vínculo nasce junto com o fato que
 *  o justificou (a inscrição ou a proposta), e não numa transação paralela que
 *  poderia sobreviver a uma falha.
 */
export async function linkParticipantIfEligible(
  tx: TxClient,
  input: {
    tenantId: string;
    userId: string;
    eventIsPublic: boolean;
    /**
     * O evento é restrito à comunidade (FASE 70). Sem esta chave o caminho da PROPOSTA
     * (F33) aceitaria quem a inscrição recusa, e a chamada de um evento fechado seria
     * uma porta lateral para o vínculo que a instituição não quis dar.
     */
    requiresMembership: boolean;
    tenantName: string;
  },
): Promise<{ linked: boolean; blocked: boolean; message: string | null }> {
  const decision = await decideParticipantLink(tx, input);

  if (decision.action === 'BLOCKED') {
    return { linked: false, blocked: true, message: decision.message ?? null };
  }

  const linked = await applyParticipantLink(tx, {
    tenantId: input.tenantId,
    userId: input.userId,
    decision,
  });

  return { linked, blocked: false, message: null };
}

/**
 * Descobre o que fazer com o vínculo de quem está se inscrevendo.
 *
 * Roda sob RLS, dentro da transação da inscrição: os dois vínculos possíveis
 * (`user_tenant_profiles` e `role_assignments`) têm `tenantId`, então a policy
 * cobre a leitura e a escrita. Não há nada aqui que precise da conexão
 * administrativa — o que é uma boa notícia: a regra que amplia acesso é executada
 * com o MESMO nível de privilégio do resto do fluxo.
 */
async function decideParticipantLink(
  tx: TxClient,
  input: {
    tenantId: string;
    userId: string;
    eventIsPublic: boolean;
    /**
     * O evento é restrito à comunidade? (FASE 12, conferido no SERVIDOR na FASE 70)
     *
     * Quem responde é `readEventRegistrationPolicy(settings)`, sobre o MESMO evento
     * que a transação já leu — sem consulta nova e sem chance de a tela e o serviço
     * lerem coisas diferentes.
     */
    requiresMembership: boolean;
    /** Nome da instituição para a mensagem da recusa. */
    tenantName: string;
  },
): Promise<ParticipantLinkDecision> {  const membership = await tx.userTenantProfile.findFirst({
    where: { tenantId: input.tenantId, userId: input.userId },
    select: { status: true, deletedAt: true },
  });

  return evaluateParticipantLink({
    membershipStatus: (membership?.status ?? null) as MembershipStatusName | null,
    // Vínculo apagado (soft delete) é "removido" para todos os efeitos.
    deleted: Boolean(membership?.deletedAt),
    eventIsPublic: input.eventIsPublic,
    requiresMembership: input.requiresMembership,
    tenantName: input.tenantName,
  });
}

/**
 * Aplica a decisão, criando ou ativando o vínculo — e devolvendo `true` quando o
 * vínculo nasceu aqui.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `upsert` E NÃO `create`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Duas inscrições simultâneas da MESMA pessoa nova (duas abas abertas, por
 *  exemplo) leriam "sem vínculo" ao mesmo tempo e tentariam criar a mesma linha. O
 *  `upsert` transforma a corrida em `ON CONFLICT DO UPDATE`, que o PostgreSQL
 *  resolve sem erro — e o efeito é o mesmo nos dois casos.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PAPEL SÓ É CONCEDIDO A QUEM NÃO TEM PAPEL NENHUM
 * ─────────────────────────────────────────────────────────────────────────────
 *  Um membro que já tem papel (patrocinador, revisor, equipe) não recebe
 *  `PARTICIPANT` de brinde: o acúmulo de papéis ampliaria permissões que a
 *  instituição não concedeu. A inscrição de quem já é membro continua dependendo
 *  de `registration:create` — verificado na Server Action.
 *
 *  A concessão é auditada como `PERMISSION_CHANGE`, porque é o que ela é.
 */
async function applyParticipantLink(
  tx: TxClient,
  input: { tenantId: string; userId: string; decision: ParticipantLinkDecision },
): Promise<boolean> {
  if (input.decision.action === 'ALREADY_MEMBER' || input.decision.action === 'BLOCKED') {
    return false;
  }

  const now = new Date();
  const activated = input.decision.action === 'ACTIVATE';

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A INSCRIÇÃO CRIA PARTICIPANTE E NUNCA REBAIXA MEMBRO (FASE 14)
   * ─────────────────────────────────────────────────────────────────────────────
   *  `kindAfterPublicRegistration` é o que impede a ordem dos acontecimentos de
   *  mudar o resultado: quem se inscreve antes de entrar para a equipe fica
   *  PARTICIPANT (e é promovido depois, se for vinculado pela plataforma), e quem
   *  já é da equipe e se inscreve continua MEMBER — inclusive contando na quota do
   *  plano. `currentKind` só é lido aqui para a decisão; o `update` abaixo não toca
   *  em `kind`.
   */
  const existing = await tx.userTenantProfile.findUnique({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
    select: { kind: true },
  });

  const kind = kindAfterPublicRegistration(
    (existing?.kind as MembershipKindName | undefined) ?? null,
  );

  await tx.userTenantProfile.upsert({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
    create: {
      tenantId: input.tenantId,
      userId: input.userId,
      status: 'ACTIVE',
      kind,
      joinedAt: now,
      invitedAt: null,
      invitedById: null,
    },
    update: { status: 'ACTIVE', deletedAt: null, joinedAt: now },
    select: { id: true },
  });

  const roles = await tx.roleAssignment.findMany({
    where: { tenantId: input.tenantId, userId: input.userId, revokedAt: null },
    select: { role: true },
  });

  if (shouldGrantParticipantRole(roles.map((role) => role.role))) {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A CORRIDA AQUI É ESPERADA — E NÃO PODE DERRUBAR A INSCRIÇÃO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A FASE 12 criou o índice único de concessão vigente
     *  (`role_assignments_live_unique`). Duas inscrições simultâneas da mesma pessoa
     *  nova passam pelo `findMany` acima enxergando "sem papel" e tentam conceder
     *  PARTICIPANT ao mesmo tempo; a segunda recebe violação de unicidade.
     *
     *  Isso NÃO é erro de negócio: o papel que ela queria conceder já existe. Deixar
     *  a exceção subir abortaria a transação inteira e a pessoa perderia a VAGA, por
     *  causa de um papel que já está lá. A concessão é idempotente por natureza —
     *  então o conflito é absorvido aqui, e só aqui.
     */
    try {
      await tx.roleAssignment.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          role: PUBLIC_REGISTRATION_ROLE,
          scope: 'TENANT',
          reason: 'Inscrição em atividade de evento público',
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'PERMISSION_CHANGE',
          entityType: 'RoleAssignment',
          changes: { role: { from: null, to: PUBLIC_REGISTRATION_ROLE } },
        },
        tx,
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  await recordAudit(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      action: activated ? 'UPDATE' : 'CREATE',
      entityType: 'UserTenantProfile',
      changes: {
        status: { from: activated ? 'INVITED' : null, to: 'ACTIVE' },
        origem: { from: null, to: 'inscrição pública' },
      },
    },
    tx,
  );

  return true;
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
  /** Fuso do EVENTO: é nele que o prazo de confirmação vence (FASE 34). */
  timeZone: string,
): Promise<
  | {
      status: 'PENDING' | 'CONFIRMED' | 'WAITLISTED';
      registrationId: string;
      waitlistPosition: number | null;
      remainingAfter: number | null;
      /** Quando o prazo de confirmação vence. Nulo nas atividades automáticas. */
      confirmationDueAt: Date | null;
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
   * ── 0. Confirmação de vaga: o prazo nasce COM a inscrição (FASE 34) ────────
   *
   *  Calculado aqui, uma vez, para que o mesmo instante valha para o que a pessoa vê
   *  na tela, para o que o e-mail diz e para o que a varredura vai comparar depois.
   *  Recalcular depois, a partir de "agora", daria um prazo que se move sozinho.
   */
  const requiresConfirmation =
    activity.confirmationPolicy === 'REQUIRED' && activity.confirmationWindowDays !== null;

  const dueAt = requiresConfirmation
    ? confirmationDueAt({
        registeredAt: new Date(),
        windowDays: activity.confirmationWindowDays!,
        timeZone,
        /**
         * O TETO é o início da ATIVIDADE (dívida E49): o prazo pode encurtar, nunca
         * passar do momento em que a vaga deixa de servir para alguém.
         */
        notAfter: activity.startsAt,
      })
    : null;

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
  const reserved = await tx.$executeRawUnsafe(RESERVE_ACTIVITY_SEAT_SQL, activity.id);

  if (reserved === 1) {
    /**
     * ── A vaga está RESERVADA; o que muda é o que ela significa (FASE 34) ──────
     *
     * `AUTO` nasce `CONFIRMED` (o comportamento de sempre). `REQUIRED` nasce
     * `PENDING` — e `PENDING` OCUPA VAGA: o contador que o UPDATE acima incrementou é
     * o mesmo que a listagem pública usa para dizer "lotada". É isso que dá sentido ao
     * prazo: a vaga fica presa com quem se inscreveu, e a liberação automática é o que
     * a devolve. Se `PENDING` não contasse, o prazo não devolveria nada — só
     * cancelaria uma linha.
     */
    const registration = await tx.registration.create({
      data: {
        ...baseData,
        status: requiresConfirmation ? 'PENDING' : 'CONFIRMED',
        confirmationDueAt: dueAt,
      },
      select: { id: true },
    });

    /**
     * ── O CHECKLIST NASCE COM A INSCRIÇÃO (FASE 37) ────────────────────────────
     *
     *  As exigências da atividade viram LINHAS desta inscrição, com o estado em aberto.
     *  É o snapshot do que a pessoa foi cobrada — e é o que permite ao balcão marcar
     *  item por item e a vaga se confirmar sozinha quando não faltar nenhum obrigatório.
     *
     *  Só nasce com a inscrição RETIDA: numa atividade de confirmação automática não há
     *  o que conferir no balcão (a vaga já é da pessoa), e criar checklist ali seria
     *  pedir uma conferência que ninguém vai fazer.
     */
    if (requiresConfirmation) {
      const items = snapshotRequirements(
        parseConfirmationRequirements(activity.confirmationRequirements),
      );

      if (items.length > 0) {
        await tx.registrationConfirmationItem.createMany({
          data: items.map((item) => ({
            tenantId: input.tenantId,
            registrationId: registration.id,
            position: item.position,
            kind: item.kind,
            label: item.label,
            note: item.note,
            required: item.required,
            status: 'PENDING',
          })),
        });
      }
    }

    return {
      status: requiresConfirmation ? 'PENDING' : 'CONFIRMED',
      registrationId: registration.id,
      waitlistPosition: null,
      remainingAfter: remainingSeats(activity.capacity, activity.confirmedCount + 1),
      confirmationDueAt: dueAt,
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
        /**
         * Quem espera vaga não tem prazo para confirmar: não há vaga retida. Quando a
         * promoção chegar, a linha vira `CONFIRMED` direto (decisão da promoção,
         * FASE 3) — cobrar confirmação de quem acabou de ser chamado seria criar uma
         * segunda forma de perder a vaga.
         */
        confirmationDueAt: null,
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
  const affected = await tx.$executeRawUnsafe(RESERVE_EVENT_SEAT_SQL, eventId);
  return affected === 1;
}

/**
 * Devolve um lugar no evento (FASE 70).
 *
 * Existe como função, e não como SQL solto em cada ponto, porque o contador do evento
 * é o par do `reserveEventSeat` acima: quem RESERVA e quem DEVOLVE têm de mexer no
 * MESMO contador e sob a MESMA condição — e havia quatro cópias do `UPDATE` espalhadas
 * pelo serviço, cada uma com a sua leitura de quando o lugar saía.
 *
 * `GREATEST(..., 0)` impede contador negativo por dado inconsistente; as linhas
 * afetadas não interessam ao chamador (devolver lugar que não existia é inofensivo, e
 * falhar aqui deixaria o evento travado).
 */
async function openEventSeat(tx: TxClient, eventId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE events
       SET "confirmedCount" = GREATEST("confirmedCount" - 1, 0)
     WHERE id = ${eventId}::uuid
  `;
}

/**
 * Põe a inscrição do evento na FILA (dívida E33), com a posição do fim.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A POSIÇÃO É UMA CORRIDA, E O BANCO É QUEM DECIDE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Duas pessoas entrando na fila ao mesmo tempo leem o MESMO máximo e tentam gravar a
 *  MESMA posição. O índice único parcial de posição recusa a segunda — e é isso que
 *  queremos: um `SAVEPOINT` desfaz só a tentativa perdedora (sem derrubar a transação,
 *  que já leu o evento, decidiu o vínculo de participante e escreveu auditoria) e o
 *  laço relê o máximo e tenta de novo. É o mesmo desenho da fila da ATIVIDADE: mudar o
 *  escopo da fila não muda a natureza da corrida.
 */
async function enqueueEventRegistration(
  tx: TxClient,
  input: {
    tenantId: string;
    eventId: string;
    userId: string;
    consentImage: boolean;
    consentData: boolean;
    accessibilityNotes: string | null;
    formResponses: object;
  },
): Promise<{ id: string; position: number }> {
  const MAX_POSITION_ATTEMPTS = 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_POSITION_ATTEMPTS; attempt += 1) {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A CORRIDA DA MESMA PESSOA TEM DE VIRAR IDEMPOTÊNCIA, NÃO ERRO (FASE 70)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Duas requisições simultâneas da MESMA pessoa (as duas atividades dela num
     *  clique duplo) chegam aqui com o evento lotado e nenhuma linha do evento visível
     *  para as duas. Sem esta releitura, as duas tentariam inserir e o índice
     *  `registrations_live_event_user_key` recusaria a segunda — com erro de banco para
     *  quem só queria se inscrever. A releitura dentro do laço (e ANTES do INSERT)
     *  devolve a fila que a outra transação acabou de criar.
     */
    const alreadyQueued = await tx.registration.findFirst({
      where: { eventId: input.eventId, activityId: null, userId: input.userId, deletedAt: null },
      select: { id: true, status: true, waitlistPosition: true },
    });

    if (alreadyQueued && alreadyQueued.status !== 'CANCELED') {
      return { id: alreadyQueued.id, position: alreadyQueued.waitlistPosition ?? 0 };
    }

    await tx.$executeRawUnsafe('SAVEPOINT event_waitlist_pos');

    try {
      /**
       * O escopo é `activityId: null` — é o que separa a fila do EVENTO da fila de uma
       * atividade. Sem esse filtro, a posição sairia do máximo das duas filas juntas.
       */
      const currentMax = await tx.registration.aggregate({
        where: { eventId: input.eventId, activityId: null, status: 'WAITLISTED' },
        _max: { waitlistPosition: true },
      });

      const position = (currentMax._max.waitlistPosition ?? 0) + 1;

      const queued = await tx.registration.create({
        data: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          activityId: null,
          userId: input.userId,
          origin: 'INDIVIDUAL',
          status: 'WAITLISTED',
          waitlistPosition: position,
          consentImage: input.consentImage,
          consentData: input.consentData,
          consentAt: new Date(),
          accessibilityNotes: input.accessibilityNotes,
          formResponses: input.formResponses,
        },
        select: { id: true, waitlistPosition: true },
      });

      await tx.$executeRawUnsafe('RELEASE SAVEPOINT event_waitlist_pos');

      return { id: queued.id, position: queued.waitlistPosition ?? position };
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT event_waitlist_pos');
      lastError = error;
      if (classifyUniqueConflict(error) !== 'retry-position') break;
    }
  }

  logUnexpected('enqueueEventRegistration', lastError);

  throw new RegistrationError(
    'INTERNAL',
    'Não foi possível entrar na fila do evento agora. Tente novamente.',
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Inscrição no EVENTO (revisão da FASE 3)
// ───────────────────────────────────────────────────────────────────────────────
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
      /**
       * `true` quando o evento estava lotado e a pessoa entrou na FILA (E33): ela não
       * ocupa vaga, não foi inscrita nas atividades abertas e será promovida — com
       * prazo para confirmar (E1) — quando uma vaga for devolvida.
       */
      waitlisted: boolean;
      /** Posição na fila do evento, quando `waitlisted`. */
      waitlistPosition: number | null;
      /** Quantas atividades abertas receberam a inscrição automaticamente. */
      enrolledActivities: number;
      titles: readonly string[];
      linkedAsParticipant: boolean;
    }
  | { ok: false; code: RegistrationErrorCode; message: string };

/**
 * Inscreve a pessoa no EVENTO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DUAS COISAS ACONTECEM AQUI, E A ORDEM DELAS IMPORTA
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. A **inscrição do evento** nasce: uma linha de `registrations` com
 *     `activityId` NULO, que é o crachá da pessoa no evento (consentimentos,
 *     acessibilidade, credenciamento). Ela reserva vaga na LOTAÇÃO DO EVENTO, com
 *     o mesmo UPDATE condicional atômico das atividades — a vaga do evento não é
 *     a soma das atividades, e por isso tem predicado próprio.
 *
 *  2. Em seguida, a pessoa é inscrita **automaticamente** em cada atividade ABERTA
 *     (`requiresRegistration = false`) que ainda não a tenha: a linha nasce com
 *     `origin = EVENT_AUTO`, para o sistema saber que ela veio daqui — é o que
 *     permite cancelar a inscrição do evento levando junto só o que ela criou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE MATERIALIZAR A LINHA, EM VEZ DE DEDUZIR "TODOS PODEM ENTRAR"
 * ─────────────────────────────────────────────────────────────────────────────
 *  Deduzir seria menos dado — e obrigaria TODA leitura a saber que uma atividade
 *  aberta tem, como público, os inscritos do evento: a lista de presença, o
 *  credenciamento, a apuração de carga horária, o certificado e a exportação. Uma
 *  regra a mais repetida em cada consulta é uma regra a mais para esquecer em uma
 *  delas. Materializando, a atividade aberta tem inscritos de verdade, e o resto do
 *  sistema não precisa saber que ela é diferente.
 */
export async function registerForEvent(
  input: RegisterForEventInput,
): Promise<RegisterForEventOutcome> {
  const MAX_ATTEMPTS = 4;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const outcome = await attemptEventRegistration(input);

    if (outcome.ok || !isTransientFailure(outcome.code)) {
      /**
       * ── A INSCRIÇÃO CONFIRMADA MOVE A GAMIFICAÇÃO (FASE 43) ──────────────────
       *
       *  DEPOIS do commit e sem poder falhar (invariante 8): a vaga está reservada, e
       *  um erro ao creditar XP não pode desfazer a inscrição de ninguém. O gancho
       *  relê o estado no banco e só credita se a linha estiver `CONFIRMED` — as
       *  linhas `EVENT_AUTO` das atividades abertas nascem aqui também, e elas NÃO
       *  são ato do participante (por isso não passam por aqui).
       */
      if (outcome.ok) {
        await rewardRegistrationConfirmedById({
          tenantId: input.tenantId,
          registrationId: outcome.registrationId,
        });
      }

      return outcome;
    }

    const backoff = Math.min(15 * 2 ** attempt, 200);
    await new Promise((resolve) => setTimeout(resolve, backoff + Math.random() * backoff));
  }

  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Muita gente tentando se inscrever ao mesmo tempo. Tente novamente em instantes.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O CAMINHO COMUM DA INSCRIÇÃO NO EVENTO (FASE 70)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O evento, resolvido, como as duas portas o entregam ao caminho comum.
 *
 * `tenantName` entra porque a recusa de evento restrito é uma frase com o nome da
 * instituição — e quem já leu o evento tem esse nome à mão, sem consulta nova.
 */
interface EventAdmissionContext {
  id: string;
  title: string;
  capacity: number | null;
  settings: unknown;
  tenantName: string;
}

/**
 * O essencial de uma admissão no evento, comum às duas portas.
 *
 * `null` é resposta de NEGÓCIO, e não erro: significa "o evento está lotado e não há
 * fila" — quem chama a porta do EVENTO traduz isso em `FULL` (a pessoa não entrou), e
 * quem chama a porta da ATIVIDADE segue em frente (a oficina tem vaga; o evento não é
 * problema dela). Lançar aqui obrigaria a porta da atividade a distinguir "erro de
 * verdade" de "lotação do evento" por conta própria.
 *
 * `inserted` diz se a LINHA NASCEU nesta chamada: `false` é a corrida perdida para
 * outra requisição da mesma pessoa, e quem escreve trilha precisa saber a diferença
 * (registrar duas vezes o mesmo fato é ruído na auditoria).
 *
 * Não há ramo de erro no tipo: o caminho comum LANÇA `RegistrationError` para o que é
 * recusa (vínculo, duplicidade) e quem o chama traduz no seu próprio formato.
 */
type EventAdmissionCore =
  | {
      registrationId: string;
      waitlisted: boolean;
      waitlistPosition: number | null;
      inserted: boolean;
    }
  | null;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O CAMINHO COMUM DA INSCRIÇÃO NO EVENTO — extraído para ser REUSADO (FASE 70)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO FOI EXTRAÍDO, E NÃO COPIADO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição numa atividade passou a MATERIALIZAR a inscrição no evento. Escrever
 *  um segundo caminho que "faz quase o mesmo" criaria duas respostas para as mesmas
 *  perguntas — vínculo do participante, evento restrito, evento lotado (fila),
 *  duplicidade, consentimentos — e a segunda cópia é a que fica desatualizada
 *  (armadilha 55). As duas portas passam por AQUI.
 *
 *  A ordem das checagens é a da prioridade, e ela é a mesma de antes:
 *
 *    1. VÍNCULO — quem a instituição suspendeu ou removeu é recusado ANTES de
 *       qualquer escrita, e quem chegou a um evento restrito sem vínculo também;
 *    2. DUPLICIDADE — quem já tem inscrição viva no evento não ganha outra (o índice
 *       único parcial `registrations_live_event_user_key` é a garantia final);
 *    3. VAGA — o `UPDATE` condicional decide. Sem vaga e com lotação, a FILA; sem
 *       vaga e sem lotação, a recusa.
 *
 *  O QUE O CHAMADOR FAZ DEPOIS DA RESERVA é a única diferença entre as portas: a
 *  inscrição no evento inscreve a pessoa nas atividades ABERTAS (e quem entra pela
 *  atividade não deve ganhar isso de brinde — ela já escolheu a dela). Por isso o
 *  pós-reserva é um CALLBACK, e não uma cópia da função inteira.
 */
async function admitToEventRegistration(
  tx: TxClient,
  input: {
    tenantId: string;
    userId: string;
    event: EventAdmissionContext;
    linkDecision: ParticipantLinkDecision;
    /** A ORIGEM da linha do evento: quem a cria automaticamente declara `EVENT_AUTO`. */
    origin: 'INDIVIDUAL' | 'EVENT_AUTO';
    /** Roda DEPOIS de a linha existir e a vaga estar reservada. */
    onSeatReserved: (registrationId: string) => Promise<void>;
    consentImage: boolean;
    consentData: boolean;
    accessibilityNotes: string | null;
    formResponses: object;
  },
): Promise<EventAdmissionCore> {
  const { tenantId, userId, event } = input;

  if (input.linkDecision.action === 'BLOCKED') {
    throw new RegistrationError(
      /**
       * O evento restrito tem código PRÓPRIO (FASE 70): "peça o seu vínculo" e "sua
       * conta foi bloqueada" mandam a pessoa fazer coisas diferentes.
       */
      readEventRegistrationPolicy(event.settings).requiresMembership
        ? 'MEMBERSHIP_REQUIRED'
        : 'MEMBERSHIP_BLOCKED',
      input.linkDecision.message ?? 'Inscrição não permitida para esta conta.',
    );
  }

  const existing = await tx.registration.findFirst({
    where: { eventId: event.id, activityId: null, userId, deletedAt: null },
    select: { id: true, status: true },
  });

  if (existing && existing.status !== 'CANCELED') {
    throw new RegistrationError('DUPLICATE', 'Você já está inscrito neste evento.');
  }

  const reserved = await reserveEventSeat(tx, event.id);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  SEM VAGA NO EVENTO: A PESSOA ENTRA NA FILA (dívida E33)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A reserva é o `UPDATE` condicional, e ele continua sendo quem decide — esta
   *  leitura só escolhe entre ENFILEIRAR e RECUSAR. Com lotação, a fila é o caminho:
   *  a pessoa existe no evento (a linha nasce `WAITLISTED`, com posição), a
   *  instituição sabe quem espera e a vaga de quem desistir tem para onde ir.
   *
   *  O que a fila NÃO faz, e é deliberado: inscrever nas atividades abertas. Quem
   *  espera não tem lugar no evento, e criar as linhas `EVENT_AUTO` daria presença a
   *  quem não entrou — a promoção é que as cria, no mesmo passo em que reserva a vaga
   *  (`promoteNextFromEventWaitlist`).
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  E A ATIVIDADE NÃO É RECUSADA POR CAUSA DISSO (FASE 70)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Esta função devolve a resposta, e o chamador da ATIVIDADE segue em frente com
   *  ela: quem não coube no evento espera na fila DELE e participa da oficina. Antes,
   *  o evento lotado lançava `FULL` daqui e a oficina — que tinha vaga — era recusada.
   */
  if (!reserved && !eventHasWaitlist(event.capacity)) return null;

  if (!reserved) {
    const queued = await enqueueEventRegistration(tx, {
      tenantId,
      eventId: event.id,
      userId,
      consentImage: input.consentImage,
      consentData: input.consentData,
      accessibilityNotes: input.accessibilityNotes,
      formResponses: input.formResponses,
    });

    return {
      registrationId: queued.id,
      waitlisted: true,
      waitlistPosition: queued.position,
      inserted: true,
    };
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O INSERT EM SAVEPOINT: A CORRIDA DA MESMA PESSOA NÃO PODE VIRAR ERRO (FASE 70)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Duas requisições simultâneas da MESMA pessoa (duas abas, dois caminhos: inscrever
   *  na atividade A e na atividade B) chegam aqui com a linha do evento ainda
   *  inexistente nas duas leituras. O índice único parcial
   *  `registrations_live_event_user_key` recusa a segunda — corretamente —, e o
   *  resultado não pode ser um erro de banco na cara de quem pediu: a resposta certa é
   *  a MESMA linha, porque o fato é idempotente por `(eventId, userId)`.
   *
   *  O SAVEPOINT é obrigatório: no PostgreSQL um erro ABORTA a transação inteira, e a
   *  releitura seguinte falharia com "current transaction is aborted" (é a mesma
   *  armadilha que a fila da atividade documenta em `tryReserveSeat`). Sem o savepoint,
   *  este caminho não teria como se recuperar da própria corrida.
   */
  await tx.$executeRawUnsafe('SAVEPOINT event_line');

  let registration: { id: string };

  try {
    registration = await tx.registration.create({
      data: {
        tenantId,
        eventId: event.id,
        activityId: null,
        userId,
        /**
         * A ORIGEM é DADO do chamador (FASE 70): `INDIVIDUAL` quando a pessoa pediu o
         * evento, `EVENT_AUTO` quando foi a inscrição numa ATIVIDADE que a materializou.
         * A distinção decide o que o cancelamento da inscrição no evento leva junto.
         */
        origin: input.origin,
        status: 'CONFIRMED',
        consentImage: input.consentImage,
        consentData: input.consentData,
        consentAt: new Date(),
        accessibilityNotes: input.accessibilityNotes,
        formResponses: input.formResponses,
      },
      select: { id: true },
    });

    await tx.$executeRawUnsafe('RELEASE SAVEPOINT event_line');
  } catch (error) {
    if (classifyUniqueConflict(error) !== 'already-in-event') throw error;

    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT event_line');

    const winner = await tx.registration.findFirst({
      where: { eventId: event.id, activityId: null, userId, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!winner) throw error;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A VAGA RESERVADA VOLTA: A LINHA NÃO NASCEU AQUI (FASE 70)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A reserva aconteceu ANTES deste `INSERT` — e quem perdeu a corrida reservou um
     *  lugar que não vai ocupar. Sem devolvê-lo, `events.confirmedCount` ficaria um
     *  acima das linhas vivas a cada clique duplo, e o contador é o que decide se o
     *  evento está lotado: o evento passaria a recusar gente que caberia.
     */
    await openEventSeat(tx, event.id);

    return {
      registrationId: winner.id,
      waitlisted: winner.status === 'WAITLISTED',
      waitlistPosition: null,
      /** A linha nasceu na OUTRA transação: esta não escreveu nada. */
      inserted: false,
    };
  }

  await input.onSeatReserved(registration.id);

  return {
    registrationId: registration.id,
    waitlisted: false,
    waitlistPosition: null,
    inserted: true,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A INSCRIÇÃO NA ATIVIDADE MATERIALIZA A INSCRIÇÃO NO EVENTO (FASE 70)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO CONSERTA (medido: 3 de 3 inscrições em atividade sem a linha
 *  do evento no banco de desenvolvimento)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quem entrava numa oficina ficava sem inscrição no evento — e o evento não tinha
 *  como saber disso: o certificado de participação saía sem CPF (o CPF só é lido da
 *  linha do evento), o painel contava linhas misturando os dois níveis e o crachá
 *  aceitava a pessoa por uma régua que o resto do sistema não seguia.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELA **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *  • NÃO inscreve nas atividades ABERTAS. Quem escolheu uma oficina não ganha as
 *    outras de brinde; quem quer o evento inteiro se inscreve nele (a outra porta,
 *    `registerForEvent`, é quem faz isso).
 *  • NÃO falha quando o evento está lotado: a linha nasce na FILA (`WAITLISTED`) e a
 *    atividade segue confirmada. Recusar a oficina por lotação do evento seria
 *    recusar a coisa errada.
 *  • NÃO cobra uma segunda vaga: a reserva do lugar no evento passa a ser FEITA AQUI,
 *    e a inscrição na atividade deixou de reservá-la (`attemptRegistration`). O
 *    invariante é UMA reserva por pessoa por evento.
 *  • NÃO copia o CPF (não existe): o formulário da atividade não tem o campo, então a
 *    linha nasce com `formResponses` HERDADO (vazio) e a pessoa completa depois em
 *    `/inscricao`, que passa a oferecer "completar meus dados".
 *
 *  É IDEMPOTENTE por `(eventId, userId)`: quem já tem a linha do evento (inclusive
 *  porque se inscreveu no evento antes) sai daqui sem escrever nada, e o índice
 *  único parcial `registrations_live_event_user_key` é a garantia final sob
 *  concorrência.
 */
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

export async function ensureEventRegistration(
  tx: TxClient,
  input: EnsureEventRegistrationInput,
): Promise<{ created: boolean; registrationId: string | null; waitlisted: boolean }> {
  const existing = await tx.registration.findFirst({
    where: { eventId: input.event.id, activityId: null, userId: input.userId, deletedAt: null },
    select: { id: true, status: true },
  });

  if (existing && existing.status !== 'CANCELED') {
    /** Já tem a linha do evento: nada a escrever, nada a reservar de novo. */
    return { created: false, registrationId: existing.id, waitlisted: false };
  }

  const admission = await admitToEventRegistration(tx, {
    tenantId: input.tenantId,
    userId: input.userId,
    event: input.event,
    linkDecision: input.linkDecision,
    /**
     * A LINHA NASCE `EVENT_AUTO`: quem a criou foi a inscrição numa ATIVIDADE, e é
     * isso que o cancelamento da inscrição no evento precisa saber para levar junto
     * só o que ele mesmo criou.
     */
    origin: 'EVENT_AUTO',
    /**
     * NÃO inscreve nas atividades abertas: quem escolheu uma oficina não ganha as
     * outras de brinde. O que a vaga já reservada pede é apenas o registro na trilha,
     * feito pelo chamador.
     */
    onSeatReserved: async () => {},
    consentImage: input.consentImage,
    consentData: input.consentData,
    accessibilityNotes: input.accessibilityNotes,
    formResponses: input.formResponses,
  }).catch(async (error: unknown) => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A OUTRA METADE DA CORRIDA: A LINHA VENCEU ANTES DA LEITURA (FASE 70)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Há DUAS ordens possíveis para duas transações da mesma pessoa, e cada uma
     *  chega por um caminho diferente:
     *
     *   • **as duas leem "sem linha" e uma insere enquanto a outra insere** — o
     *     índice único parcial recusa a segunda, e quem trata isso é o `SAVEPOINT
     *     event_line` lá dentro (`admitToEventRegistration`);
     *   • **a primeira JÁ COMITOU quando a segunda relê** — a releitura enxerga a
     *     linha e cai no `DUPLICATE` do guarda de duplicidade. Nada de banco
     *     aconteceu: é a mesma pessoa, a mesma linha, e a resposta certa é a MESMA
     *     que o caminho de cima dá — "já existe, não escrevo nada".
     *
     *  Sem este `catch`, o segundo clique (a segunda oficina dela, em duas abas)
     *  recebia **"Você já está inscrito neste evento"** e a inscrição na ATIVIDADE
     *  era desfeita junto — a mensagem falava do evento para quem pediu a oficina, e
     *  a pessoa ficava sem a vaga que existia. Medido: o caso
     *  `public-registration.test.ts` ("duas inscrições simultâneas da mesma pessoa
     *  nova") reprovava **3 de 9 execuções isoladas** antes deste conserto.
     *
     *  O `DUPLICATE` continua sendo a resposta do caminho do EVENTO
     *  (`registerForEvent`), onde pedir de novo é o erro que ele nomeia. Aqui ele é
     *  idempotência — e é por isso que a conversão é feita NESTA função, e não dentro
     *  de `admitToEventRegistration`: a régua é de quem chamou.
     */
    if (!(error instanceof RegistrationError) || error.code !== 'DUPLICATE') throw error;

    const winner = await tx.registration.findFirst({
      where: { eventId: input.event.id, activityId: null, userId: input.userId, deletedAt: null },
      select: { id: true, status: true },
    });

    /** Fail-closed: sem a linha que justificaria a conversão, o erro é o erro. */
    if (!winner) throw error;

    return {
      registrationId: winner.id,
      waitlisted: winner.status === 'WAITLISTED',
      waitlistPosition: null,
      /** A linha não nasceu aqui: esta transação não escreveu nada. */
      inserted: false,
    };
  });

  /**
   * Evento lotado e SEM FILA: não há vaga para reservar e não há onde esperar. A
   * resposta é "não criei a linha" — e a ATIVIDADE segue, que é o invariante desta
   * fase ("evento lotado não recusa a atividade").
   */
  if (!admission) {
    return { created: false, registrationId: null, waitlisted: false };
  }

  /**
   * `created` é "a LINHA DESTA CHAMADA" — quem correu contra outra transação da mesma
   * pessoa recebeu a linha existente e NÃO escreveu nada (`inserted: false`), e a
   * trilha não pode registrar um fato que não aconteceu aqui.
   */
  return {
    created: admission.inserted,
    registrationId: admission.registrationId,
    waitlisted: admission.waitlisted,
  };
}
async function attemptEventRegistration(
  input: RegisterForEventInput,
): Promise<RegisterForEventOutcome> {
  const { tenantId, eventSlug, userId } = input;

  try {
    return await withTenant(
      tenantId,
      async (tx) => {
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
            settings: true,
            /** O nome entra na recusa de evento restrito (FASE 70). */
            tenant: { select: { name: true } },
          },
        });

        if (!event) {
          throw new RegistrationError('EVENT_NOT_FOUND', 'Evento não encontrado.');
        }

        if (!input.ignoreWindow) {
          const window = evaluateRegistrationWindow({
            now: new Date(),
            eventStartsAt: event.startsAt,
            eventEndsAt: event.endsAt,
            eventStatus: event.status as EventStatus,
            registrationOpensAt: event.registrationOpensAt,
            registrationClosesAt: event.registrationClosesAt,
          });

          if (!window.open) {
            throw new RegistrationError('WINDOW_CLOSED', window.message);
          }
        }

        const linkDecision = await decideParticipantLink(tx, {
          tenantId,
          userId,
          eventIsPublic: isOpenToPublicEvent({
            eventStatus: event.status,
            settings: event.settings,
          }),
          requiresMembership: readEventRegistrationPolicy(event.settings).requiresMembership,
          tenantName: event.tenant.name,
        });

        const consentImage = input.consentImage ?? false;
        const consentData = input.consentData ?? false;
        const accessibilityNotes = input.accessibilityNotes ?? null;
        const formResponses = (input.formResponses ?? {}) as object;

        /**
         * A ORDEM DO PÓS-RESERVA é a que sempre foi: as atividades ABERTAS recebem a
         * inscrição antes de a vaga virar `CONFIRMED` na resposta. Quem espera não
         * entra nelas — o callback só é chamado quando a vaga é reservada.
         */
        let enrolledTitles: string[] = [];

        const admission = await admitToEventRegistration(tx, {
          tenantId,
          userId,
          event: {
            id: event.id,
            title: event.title,
            capacity: event.capacity,
            settings: event.settings,
            tenantName: event.tenant.name,
          },
          linkDecision,
          origin: 'INDIVIDUAL',
          onSeatReserved: async (registrationId) => {
            /**
             * ─────────────────────────────────────────────────────────────────────
             *  A VAGA JÁ ESTÁ RESERVADA E A LINHA JÁ EXISTE: falta o que a inscrição
             *  no evento PROVOCA de automático (as atividades abertas).
             * ─────────────────────────────────────────────────────────────────────
             *  Roda DEPOIS do `INSERT` de propósito: é o `registrationId` que o
             *  `syncOpenActivityEnrollments` documenta como contexto, e criar a linha
             *  antes da reserva é o padrão que a armadilha 22 descreve como errado —
             *  uma linha que sobra quando a vaga não vem.
             */
            const enrolled = await enrollEventRegistrationInOpenActivities(tx, {
              tenantId,
              eventId: event.id,
              userId,
              registrationId,
              consentImage,
              consentData,
              accessibilityNotes,
            });

            enrolledTitles = [...enrolled.titles];
          },
          consentImage,
          consentData,
          accessibilityNotes,
          formResponses,
        });

        /**
         * Evento lotado e sem fila: a porta do EVENTO recusa, porque o lugar no
         * evento é exatamente o que a pessoa pediu. (A porta da ATIVIDADE trata o
         * mesmo `null` de outro jeito: a oficina segue.)
         */
        if (!admission) {
          throw new RegistrationError('FULL', 'A lotação total do evento foi atingida.');
        }

        const linkedAsParticipant = await applyParticipantLink(tx, {
          tenantId,
          userId,
          decision: linkDecision,
        });

        await recordAudit(
          {
            tenantId,
            userId,
            action: 'CREATE',
            entityType: 'registration',
            entityId: admission.registrationId,
            changes: {
              evento: { from: null, to: event.title },
              tipo: { from: null, to: admission.waitlisted ? 'fila do evento' : 'inscrição no evento' },
              ...(admission.waitlisted
                ? { posicao: { from: null, to: admission.waitlistPosition } }
                : {
                    atividadesAutomaticas: {
                      from: null,
                      to: enrolledTitles.join(', ') || 'nenhuma atividade aberta',
                    },
                  }),
            },
          },
          tx,
        );

        return {
          ok: true as const,
          waitlisted: admission.waitlisted,
          waitlistPosition: admission.waitlistPosition,
          registrationId: admission.registrationId,
          enrolledActivities: enrolledTitles.length,
          titles: enrolledTitles,
          linkedAsParticipant,
        };
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    return toEventOutcome(error);
  }
}

/**
 * Inscreve UMA pessoa (já inscrita no evento) em todas as atividades abertas.
 *
 * É a peça que roda em dois momentos diferentes, de propósito:
 *   • no ato da inscrição no evento;
 *   • quando a instituição CRIA uma atividade aberta ou a torna aberta depois —
 *     sem esta segunda hora, quem já estava no evento ficaria de fora de uma
 *     atividade publicada mais tarde, e a promessa "aberta a todos os inscritos"
 *     seria falsa para os primeiros.
 *
 * `skipExisting` é a regra de ouro: quem JÁ tem inscrição viva na atividade (por
 * escolha própria, inclusive) não ganha uma segunda linha — o índice único parcial
 * recusaria, e a mensagem que chega ao organizador seria um erro de banco.
 */
async function enrollEventRegistrationInOpenActivities(
  tx: TxClient,
  input: {
    tenantId: string;
    eventId: string;
    userId: string;
    registrationId: string;
    consentImage: boolean;
    consentData: boolean;
    accessibilityNotes: string | null;
  },
): Promise<{ titles: string[] }> {
  const activities = await tx.activity.findMany({
    where: { eventId: input.eventId, deletedAt: null, requiresRegistration: false },
    select: { id: true, title: true, status: true },
  });

  const targets = activities.filter((activity) =>
    acceptsAutoEnrollment({
      requiresRegistration: false,
      status: activity.status as ActivityStatus,
    }),
  );

  if (targets.length === 0) return { titles: [] };

  const existing = await tx.registration.findMany({
    where: {
      activityId: { in: targets.map((activity) => activity.id) },
      userId: input.userId,
      deletedAt: null,
      status: { in: ['PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED'] },
    },
    select: { activityId: true },
  });

  const alreadyEnrolled = new Set(existing.map((row) => row.activityId));
  const titles: string[] = [];

  for (const activity of targets) {
    if (alreadyEnrolled.has(activity.id)) continue;

    await tx.registration.create({
      data: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: activity.id,
        userId: input.userId,
        origin: 'EVENT_AUTO',
        status: 'CONFIRMED',
        consentImage: input.consentImage,
        consentData: input.consentData,
        consentAt: new Date(),
        accessibilityNotes: input.accessibilityNotes,
      },
    });

    /**
     * O contador da atividade acompanha, mesmo sem controle de vaga: ele é o que
     * a lista de presença e o painel mostram. Atividade ABERTA não tem predicado de
     * capacidade — quem está no evento entra (`RESERVE_OPEN_ACTIVITY_SEAT_SQL`).
     */
    await tx.$executeRawUnsafe(RESERVE_OPEN_ACTIVITY_SEAT_SQL, activity.id);

    titles.push(activity.title);
  }

  return { titles };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Completar os dados da inscrição no evento (FASE 70)
// ───────────────────────────────────────────────────────────────────────────────
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  COMPLETAR OS DADOS DA INSCRIÇÃO NO EVENTO (FASE 70)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA FUNÇÃO PRECISA EXISTIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição numa atividade passou a MATERIALIZAR a linha do evento — e essa linha
 *  nasce com `formResponses` HERDADO (vazio), porque o formulário da atividade não
 *  coleta CPF. Sem uma porta para completar, quem veio pela oficina ficaria para
 *  sempre com um certificado sem CPF e sem lugar para informá-lo: `registerForEvent`
 *  recusa quem já tem inscrição viva (`DUPLICATE`), e recusar é o certo — não faz
 *  sentido "inscrever de novo" quem já está inscrito.
 *
 *  O que a pessoa precisa é ATUALIZAR a própria inscrição, e é isso que esta função
 *  faz: a MESMA linha, com os dados de contato e o CPF que faltavam.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS REGRAS DELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. **Só a PRÓPRIA inscrição** (`userId` da sessão, casado no `where`) e só no
 *     evento do slug — posse conferida no banco, não na tela;
 *  2. **Mescla, não substitui**: `formResponses` é um depósito com outras chaves (e
 *     com as chaves que a fase do formulário personalizável trouxer), então gravar o
 *     objeto novo inteiro apagaria respostas que já existiam;
 *  3. **Não mexe em vaga nem em status**: lugar, fila e confirmação são de outros
 *     fatos. Completar dados não é se inscrever nem confirmar nada.
 *
 *  A JANELA não é conferida aqui, de propósito: quem está inscrito precisa poder
 *  corrigir o próprio CPF depois de as inscrições fecharem — é justamente quando o
 *  certificado está sendo pedido.
 */
export async function updateEventRegistrationData(
  input: UpdateEventRegistrationInput,
): Promise<UpdateEventRegistrationOutcome> {
  const { tenantId, userId, eventSlug } = input;

  try {
    return await withTenant(tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { slug: eventSlug, deletedAt: null },
        select: { id: true, title: true },
      });

      if (!event) {
        throw new RegistrationError('EVENT_NOT_FOUND', 'Evento não encontrado.');
      }

      const registration = await tx.registration.findFirst({
        where: { eventId: event.id, userId, activityId: null, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, formResponses: true },
      });

      if (!registration || !registrationIsLive(registration.status as RegistrationStatus)) {
        throw new RegistrationError(
          'NOT_REGISTERED',
          'Você não tem inscrição ativa neste evento — inscreva-se para completar seus dados.',
        );
      }

      /**
       * A MESCLA é feita AQUI, com a leitura da própria transação: ler e gravar em
       * passos separados perderia a resposta que outra aba tivesse acabado de salvar.
       */
      const existing =
        registration.formResponses && typeof registration.formResponses === 'object'
          ? (registration.formResponses as Record<string, unknown>)
          : {};

      const merged = { ...existing, ...(input.formResponses ?? {}) };

      await tx.registration.update({
        where: { id: registration.id },
        data: {
          consentImage: input.consentImage,
          consentData: input.consentData,
          consentAt: new Date(),
          accessibilityNotes: input.accessibilityNotes,
          formResponses: merged as object,
        },
      });

      /**
       * A TRILHA guarda QUAIS CAMPOS mudaram — e não os valores: CPF e necessidade de
       * acessibilidade são dado pessoal, e a trilha é lida por mais gente do que a
       * inscrição (a mesma régua do `sanitizeChanges`).
       */
      const changedFields = [
        ...Object.keys(input.formResponses ?? {}).filter(
          (key) => JSON.stringify(existing[key]) !== JSON.stringify(merged[key]),
        ),
        ...(input.accessibilityNotes !== null &&
        input.accessibilityNotes !== (existing.accessibilityNotes ?? null)
          ? ['acessibilidade']
          : []),
      ];

      await recordAudit(
        {
          tenantId,
          userId,
          action: 'UPDATE',
          entityType: 'registration',
          entityId: registration.id,
          changes: {
            evento: { from: null, to: event.title },
            dados: {
              from: null,
              to: changedFields.length > 0 ? changedFields.join(', ') : 'sem alteração',
            },
          },
        },
        tx,
      );

      return { ok: true as const, registrationId: registration.id, status: registration.status as RegistrationStatus };
    });
  } catch (error) {
    if (error instanceof RegistrationError) {
      return { ok: false, code: error.code, message: error.message };
    }

    logUnexpected('updateEventRegistrationData', error);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível salvar seus dados agora. Tente novamente.',
    };
  }
}

/**
 * Sincroniza as inscrições automáticas de UMA atividade aberta.
 *
 * Chamada quando a atividade nasce aberta ou passa a ser aberta: percorre as
 * inscrições VIVAS do evento e inscreve quem ainda não está. Devolve quantas
 * linhas criou — número que a tela da organização mostra, porque "atividade
 * aberta" com 40 pessoas já inscritas no evento precisa dizer que 40 entraram.
 */
export async function syncOpenActivityEnrollments(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  actorId: string;
}): Promise<number> {
  return withTenant(input.tenantId, async (tx) => {
    const activity = await tx.activity.findFirst({
      where: { id: input.activityId, eventId: input.eventId, deletedAt: null },
      select: { id: true, title: true, status: true, requiresRegistration: true },
    });

    if (
      !activity ||
      !acceptsAutoEnrollment({
        requiresRegistration: activity.requiresRegistration,
        status: activity.status as ActivityStatus,
      })
    ) {
      return 0;
    }

    const eventRegistrations = await tx.registration.findMany({
      where: {
        eventId: input.eventId,
        activityId: null,
        deletedAt: null,
        status: { in: ['PENDING', 'CONFIRMED', 'ATTENDED'] },
      },
      select: {
        userId: true,
        consentImage: true,
        consentData: true,
        accessibilityNotes: true,
      },
    });

    if (eventRegistrations.length === 0) return 0;

    const alreadyEnrolled = await tx.registration.findMany({
      where: {
        activityId: activity.id,
        userId: { in: eventRegistrations.map((row) => row.userId) },
        deletedAt: null,
        status: { in: ['PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED'] },
      },
      select: { userId: true },
    });

    const enrolled = new Set(alreadyEnrolled.map((row) => row.userId));
    let created = 0;

    for (const registration of eventRegistrations) {
      if (enrolled.has(registration.userId)) continue;

      await tx.registration.create({
        data: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          activityId: activity.id,
          userId: registration.userId,
          origin: 'EVENT_AUTO',
          status: 'CONFIRMED',
          consentImage: registration.consentImage,
          consentData: registration.consentData,
          consentAt: new Date(),
          accessibilityNotes: registration.accessibilityNotes,
        },
      });

      await tx.$executeRawUnsafe(RESERVE_OPEN_ACTIVITY_SEAT_SQL, activity.id);

      created += 1;
    }

    if (created > 0) {
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'activity',
          entityId: activity.id,
          changes: {
            atividadeAberta: {
              from: null,
              to: `${created} inscrição(ões) do evento incluída(s) automaticamente`,
            },
          },
        },
        tx,
      );
    }

    return created;
  });
}

function toEventOutcome(error: unknown): RegisterForEventOutcome {
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
      /**
       * Quem foi chamado da fila nesta operação — a da ATIVIDADE liberada e/ou a do
       * EVENTO. É LISTA, e não um único: cancelar a inscrição do evento devolve o lugar
       * no evento E a vaga de cada atividade aberta que ela criou, e cada vaga devolvida
       * tem a sua fila (dívida E33). Um campo singular obrigaria a escolher qual fila
       * atender — e a outra ficaria com vaga livre e gente esperando.
       */
      promoted: { registrationId: string }[];
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

  /** Guardados para o estorno do XP, que acontece DEPOIS do commit. */
  let fromStatus: RegistrationStatus = 'PENDING';
  let canceledEventId: string | null = null;
  let canceledActivityId: string | null = null;

  try {
    const outcome = await withTenant(
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
        fromStatus = from;
        canceledEventId = registration.eventId;
        canceledActivityId = registration.activityId;

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

        /**
         * ── O CONTADOR DO EVENTO É DA LINHA DO EVENTO (FASE 70) ─────────────────
         *
         *  `events.confirmedCount` espelha as inscrições VIVAS no evento, e a reserva
         *  mudou de dono: quem reserva o lugar é a linha do EVENTO, não a da
         *  atividade. Decrementar aqui ao cancelar uma ATIVIDADE tiraria do evento um
         *  lugar que continua ocupado — ele passaria a aceitar mais gente do que cabe.
         *
         *  O `activityId` é o discriminador, e não um detalhe: as duas linhas vivem na
         *  mesma tabela e só o nulo é a inscrição do evento.
         */
        if (cancelReleasesSeat(from) && registration.activityId === null) {
          await openEventSeat(tx, registration.eventId);
        }

        // Cancelou uma posição da lista de espera: só reindexa as posições.
        if (cancelAffectsWaitlist(from)) {
          /**
           * A fila do EVENTO não tem contador próprio (`waitlistCount` é da atividade):
           * o que existe é a posição de cada linha. O `if` não é estilo — `"activityId"
           * = NULL` no SQL não casa com nada, então decrementar a atividade aqui seria
           * uma escrita que não escreve, e a fila do evento ficaria sem reindexação.
           */
          if (registration.activityId) {
            await tx.$executeRaw`
              UPDATE activities
                 SET "waitlistCount" = GREATEST("waitlistCount" - 1, 0)
               WHERE id = ${registration.activityId}::uuid
            `;
            await reindexWaitlist(tx, { activityId: registration.activityId });
          } else {
            await reindexWaitlist(tx, { eventId: registration.eventId });
          }

          return { ok: true as const, promoted: [] };
        }

        if (!registration.activityId) {
          /**
           * ─────────────────────────────────────────────────────────────────────
           *  CANCELAR A INSCRIÇÃO DO EVENTO LEVA JUNTO O QUE ELA CRIOU
           * ─────────────────────────────────────────────────────────────────────
           *  As linhas `EVENT_AUTO` existem PORQUE a inscrição do evento existe.
           *  Mantê-las depois do cancelamento deixaria a pessoa inscrita em
           *  atividades que ela só conhecia pela inscrição do evento — e o
           *  organizador veria presença de gente que já não está no evento.
           *
           *  O que NÃO é tocado: as inscrições que a própria pessoa escolheu
           *  (`INDIVIDUAL`), inclusive num minicurso. Desfazer escolha alheia a
           *  partir de outro pedido seria o tipo de efeito colateral que assusta
           *  quem usa.
           *
           *  ─────────────────────────────────────────────────────────────────────
           *  E AS VAGAS QUE O CANCELAMENTO DEVOLVE SÃO OFERECIDAS (dívida E33)
           * ─────────────────────────────────────────────────────────────────────
           *  Cada linha `EVENT_AUTO` cancelada devolve a vaga da SUA atividade, e a
           *  inscrição do evento devolve o lugar no evento. Devolver sem oferecer é a
           *  mesma perda de antes, um nível abaixo: a fila existe e ninguém a chama.
           *
           *  FASE 70: a promoção da ATIVIDADE não reserva mais lugar no evento (a
           *  reserva é da linha do evento), então cada vaga liberada aqui é consumida
           *  só pela fila da própria atividade.
           */
          const promoted: { registrationId: string }[] = [];

          const automatic = await tx.registration.findMany({
            where: {
              eventId: registration.eventId,
              userId,
              activityId: { not: null },
              origin: 'EVENT_AUTO',
              deletedAt: null,
              status: { in: ['PENDING', 'CONFIRMED', 'ATTENDED'] },
            },
            select: { id: true, activityId: true },
          });

          for (const row of automatic) {
            await tx.registration.update({
              where: { id: row.id },
              data: {
                status: 'CANCELED',
                canceledAt: new Date(),
                cancelReason: reason ?? 'Inscrição no evento cancelada',
              },
            });

            await tx.$executeRaw`
              UPDATE activities
                 SET "confirmedCount" = GREATEST("confirmedCount" - 1, 0)
               WHERE id = ${row.activityId}::uuid
            `;

            if (row.activityId) {
              const nextInActivity = await promoteNextFromWaitlist(tx, row.activityId);
              if (nextInActivity) promoted.push(nextInActivity);
            }
          }

          const nextInEvent = await promoteNextFromEventWaitlist(tx, registration.eventId);
          if (nextInEvent) promoted.push(nextInEvent);

          return { ok: true as const, promoted };
        }

        // ── Liberou vaga na atividade + promove o próximo ───────────────────
        await tx.$executeRaw`
          UPDATE activities
             SET "confirmedCount" = GREATEST("confirmedCount" - 1, 0)
           WHERE id = ${registration.activityId}::uuid
        `;

        const promotedNext = await promoteNextFromWaitlist(tx, registration.activityId);

        /**
         * ─────────────────────────────────────────────────────────────────────────
         *  CANCELAR A ATIVIDADE **NÃO** DEVOLVE LUGAR NO EVENTO (FASE 70)
         * ─────────────────────────────────────────────────────────────────────────
         *  Aqui havia a promoção da fila do EVENTO, porque a inscrição na atividade
         *  reservava o lugar no evento. A reserva mudou de dono: agora quem a tem é a
         *  linha do EVENTO, que continua viva — o lugar NÃO acabou de ser devolvido, e
         *  promover alguém consumiria uma vaga que ninguém liberou (o evento passaria
         *  a aceitar mais gente do que cabe).
         *
         *  O que acontece com a linha do evento é uma decisão declarada, e não
         *  esquecimento: ela FICA. A pessoa cancelou a oficina, não a participação no
         *  evento — e é a inscrição no evento que dá acesso às demais atividades.
         */
        return {
          ok: true as const,
          promoted: promotedNext ? [promotedNext] : [],
        };
      },
      { timeout: 15_000 },
    );

    /**
     * ── QUEM SAIU DA ESPERA É AVISADO (FASE 34) ───────────────────────────────
     *
     * A promoção é automática desde a FASE 3 e era SILENCIOSA: a pessoa descobria
     * entrando na plataforma por acaso — e às vezes descobria tarde. O aviso sai
     * DEPOIS do commit (invariante 8): falha de e-mail não desfaz a promoção.
     */
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  CANCELAR DEVOLVE O XP DA VAGA (FASE 50 · dívida E59)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Depois do commit, e só quando a vaga realmente sai: quem estava na lista de
     *  espera nunca recebeu os 30 XP, então não há o que devolver (o estorno não acha
     *  crédito e não faz nada). Como todo gancho de recompensa, falhar aqui NÃO desfaz o
     *  cancelamento — o XP é consequência, não condição.
     */
    if (outcome.ok && cancelReleasesSeat(fromStatus)) {
      await revertRegistrationReward({
        tenantId,
        userId,
        registrationId,
        eventId: canceledEventId,
        activityId: canceledActivityId,
      });
    }

    if (outcome.ok && outcome.promoted.length > 0) {
      for (const promotion of outcome.promoted) {
        const notice = await notifyWaitlistPromoted({
          tenantId,
          registrationId: promotion.registrationId,
        });

        if (!notice.ok) {
          console.error(`[inscricoes] aviso de promoção não saiu: ${notice.message ?? 'motivo desconhecido'}`);
        }

        /**
         * Quem sai da espera e retém a vaga recebe o crédito de "inscrição confirmada"
         * (FASE 43) — ele pediu a vaga antes, e a hora é agora. Com o prazo da dívida E1
         * a promoção nasce `PENDING`, e o crédito só se efetiva quando a vaga vira
         * `CONFIRMED` (o gancho relê o estado no banco): quem for promovido e não
         * confirmar não ganha XP por uma vaga que não chegou a ter. A chave é a
         * inscrição, então não existe crédito duplo.
         */
        await rewardRegistrationConfirmedById({
          tenantId,
          registrationId: promotion.registrationId,
        });
      }
    }

    return outcome;
  } catch (error) {
    return toCancelOutcome(error);
  }
}

/**
 * Promove o primeiro da lista de espera de uma ATIVIDADE.
 *
 * Mesmo padrão do fluxo principal: o UPDATE condicional decide. Se outra
 * transação consumiu a vaga nesse meio-tempo, `reserved` é 0 e ninguém é
 * promovido — a inscrição permanece na espera.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A PROMOÇÃO DA ATIVIDADE DEIXOU DE RESERVAR LUGAR NO EVENTO (FASE 70)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aqui havia a reserva do lugar no EVENTO (de um defeito real da FASE 34: o
 *  contador do evento ficava um abaixo do real a cada vaga devolvida e reocupada).
 *  O defeito era real porque, naquele desenho, TODA inscrição confirmada de
 *  atividade ocupava também um lugar no evento — e era `attemptRegistration` que o
 *  reservava.
 *
 *  A reserva mudou de dono: desde esta fase quem ocupa o lugar no evento é a LINHA
 *  DO EVENTO, criada por `ensureEventRegistration` (idempotente por pessoa). Manter a
 *  reserva aqui cobraria DOIS lugares pela mesma pessoa — o invariante é UM.
 *
 *  É por isso que o evento lotado deixou de impedir a promoção da atividade: quem
 *  não couber no evento entra na FILA do evento (ou fica sem a linha, quando o evento
 *  não tem lotação), e a vaga da OFICINA — que é o que esta fila disputa — segue
 *  normalmente. Antes, `reservedEventSeat === false` devolvia `null` e a vaga da
 *  oficina ficava parada por causa de uma lotação que não é a dela.
 */
export async function promoteNextFromWaitlist(
  tx: TxClient,
  activityId: string,
): Promise<{ registrationId: string } | null> {
  const next = await tx.registration.findFirst({
    where: { activityId, status: 'WAITLISTED', deletedAt: null },
    orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, userId: true, tenantId: true },
  });

  if (!next) return null;

  const activity = await tx.activity.findFirst({
    where: { id: activityId },
    select: { eventId: true, confirmationRequirements: true },
  });

  if (!activity) return null;

  const reserved = await tx.$executeRawUnsafe(RESERVE_ACTIVITY_SEAT_SQL, activityId);

  if (reserved !== 1) return null;

  /**
   * ── A PROMOÇÃO RETÉM A VAGA COM PRAZO (dívida E1) ──────────────────────────
   *
   *  Antes daqui a vaga virava `CONFIRMED` no mesmo instante. Quem era chamado e não
   *  respondia (ou já não queria) ficava com ela — e a fila inteira atrás dele esperava
   *  por quem não vinha. Agora a promoção grava `PENDING` com `confirmationDueAt` em
   *  `PROMOTION_WINDOW_HOURS`: a vaga CONTINUA retida (é o que `PENDING` significa desde
   *  a FASE 34, ADR-171), mas vence sozinha — e a varredura que já existe libera a vaga
   *  e chama esta função de novo para o próximo da fila (ADR-175/178).
   */
  await tx.registration.update({
    where: { id: next.id },
    data: {
      status: 'PENDING',
      waitlistPosition: null,
      confirmationDueAt: promotionDeadline(new Date()),
    },
  });

  await tx.$executeRaw`
    UPDATE activities
       SET "waitlistCount" = GREATEST("waitlistCount" - 1, 0)
     WHERE id = ${activityId}::uuid
  `;

  /**
   * ── QUEM É PROMOVIDO TAMBÉM RECEBE O CHECKLIST (FASE 37) ───────────────────
   *
   *  A vaga está RETIDA por ele (é o que `PENDING` significa) — e o que a atividade
   *  cobra continua sendo cobrado. Sem o snapshot aqui, o balcão não teria onde marcar
   *  "recebeu a doação" para quem entrou pela lista de espera: a única pessoa do evento
   *  sem checklist seria justamente a última a ser chamada (armadilha 65 — todo caminho
   *  que cria inscrição tem de criar o checklist).
   *
   *  A confirmação automática não se aplica: quem foi PROMOVIDO precisa confirmar por
   *  escolha (tem `PROMOTION_WINDOW_HOURS` para isso) — marcar o último item de um
   *  checklist de exigências não é o mesmo ato, e a FASE 34 já trata os dois separados.
   *
   *  `skipDuplicates` porque o índice único `(registrationId, position)` é a garantia: uma
   *  promoção que rodar duas vezes (varredura e botão do painel) não duplica o checklist.
   */
  const snapshot = snapshotRequirements(
    parseConfirmationRequirements(activity.confirmationRequirements),
  );

  if (snapshot.length > 0) {
    await tx.registrationConfirmationItem.createMany({
      data: snapshot.map((item) => ({
        tenantId: next.tenantId,
        registrationId: next.id,
        position: item.position,
        kind: item.kind,
        label: item.label,
        note: item.note,
        required: item.required,
        status: 'PENDING',
      })),
      skipDuplicates: true,
    });
  }

  await reindexWaitlist(tx, { activityId });

  return { registrationId: next.id };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PROMOVE O PRÓXIMO DA FILA DO **EVENTO** (dívida E33)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Irmã de `promoteNextFromWaitlist`, e a diferença está no que ela precisa fazer a
 *  mais: quem esperava vaga no EVENTO **não tinha lugar nenhum** — nem no evento, nem
 *  nas atividades abertas. Então a promoção faz três coisas, nesta ordem:
 *
 *    1. reserva o lugar no evento (o `UPDATE` condicional decide; sem vaga, ninguém é
 *       promovido e nada foi tocado);
 *    2. vira a linha para `PENDING` com o prazo de `PROMOTION_WINDOW_HOURS` (E1) — a
 *       vaga fica RETIDA com quem foi chamado, e vence sozinha se ele não responder;
 *    3. inscreve a pessoa nas atividades ABERTAS, que é o que a inscrição no evento
 *       faria — quem esperava não recebeu essas linhas no ato (de propósito).
 *
 *  A ordem importa: as atividades abertas usam `RESERVE_OPEN_ACTIVITY_SEAT_SQL` (não há
 *  predicado de vaga ali — a atividade aberta não recusa), então nada depois do passo 1
 *  pode falhar por lotação e deixar o lugar do evento consumido.
 */
export async function promoteNextFromEventWaitlist(
  tx: TxClient,
  eventId: string,
): Promise<{ registrationId: string } | null> {
  const next = await tx.registration.findFirst({
    where: { eventId, activityId: null, status: 'WAITLISTED', deletedAt: null },
    orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, userId: true, tenantId: true, consentImage: true, consentData: true, accessibilityNotes: true },
  });

  if (!next) return null;

  const reserved = await reserveEventSeat(tx, eventId);

  if (!reserved) return null;

  await tx.registration.update({
    where: { id: next.id },
    data: {
      status: 'PENDING',
      waitlistPosition: null,
      confirmationDueAt: promotionDeadline(new Date()),
    },
  });

  await enrollEventRegistrationInOpenActivities(tx, {
    tenantId: next.tenantId,
    eventId,
    userId: next.userId,
    registrationId: next.id,
    consentImage: next.consentImage,
    consentData: next.consentData,
    accessibilityNotes: next.accessibilityNotes,
  });

  await reindexWaitlist(tx, { eventId });

  return { registrationId: next.id };
}

/**
 * Reindexa as posições da lista de espera para 1..n, sem buracos.
 *
 * Duas filas usam isto: a da ATIVIDADE (escopo por `activityId`) e a do EVENTO (escopo
 * por `eventId` + `activityId IS NULL`). O escopo é um PARÂMETRO, e não um `if` sobre o
 * nulo: a assinatura antiga recebia `string | null` e voltava cedo no nulo, de modo que
 * a fila do evento ficaria sem reindexação em silêncio — posições com buracos na tela.
 */
async function reindexWaitlist(
  tx: TxClient,
  scope: { activityId: string } | { eventId: string },
): Promise<void> {
  // `ROW_NUMBER()` em um UPDATE mantém as posições contíguas após promoções —
  // sem isso, a posição exibida ao participante ficaria cheia de buracos.
  if ('activityId' in scope) {
    await tx.$executeRaw`
      UPDATE registrations r
         SET "waitlistPosition" = ordered.new_position
        FROM (
          SELECT id, ROW_NUMBER() OVER (
                   ORDER BY "waitlistPosition" ASC NULLS LAST, "createdAt" ASC
                 ) AS new_position
            FROM registrations
           WHERE "activityId" = ${scope.activityId}::uuid
             AND status = 'WAITLISTED'
             AND "deletedAt" IS NULL
        ) AS ordered
       WHERE r.id = ordered.id
    `;

    return;
  }

  await tx.$executeRaw`
    UPDATE registrations r
       SET "waitlistPosition" = ordered.new_position
      FROM (
        SELECT id, ROW_NUMBER() OVER (
                 ORDER BY "waitlistPosition" ASC NULLS LAST, "createdAt" ASC
               ) AS new_position
          FROM registrations
         WHERE "eventId" = ${scope.eventId}::uuid
           AND "activityId" IS NULL
           AND status = 'WAITLISTED'
           AND "deletedAt" IS NULL
      ) AS ordered
     WHERE r.id = ordered.id
  `;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Consulta da própria inscrição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Um item do checklist de confirmação, como o PARTICIPANTE o vê (FASE 37).
 *
 * O participante lê o rótulo e o estado; quem marca é a equipe — o checklist aqui é
 * informação, não formulário.
 */
export interface MyConfirmationItem {
  id: string;
  position: number;
  label: string;
  note: string | null;
  required: boolean;
  status: ConfirmationItemStatus;
  /** "A receber" / "Recebido" / "Dispensado pela organização". */
  statusLabel: string;
}

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
  /** `true` = a inscrição do EVENTO (sem atividade), não de uma atividade. */
  isEventRegistration: boolean;
  /** `true` = criada pela inscrição no evento (atividade aberta). */
  isAutomatic: boolean;
  /**
   * `true` quando há resposta pessoal a apagar (FASE 70): campo declarado preenchido
   * ou nota de acessibilidade. O CPF sozinho NÃO conta — ele fica.
   */
  hasErasableResponses: boolean;
  /**
   * ─── A VAGA OFERTADA PELA FILA (dívida E1) ──────────────────────────────────
   * Existe quando a pessoa foi CHAMADA da lista de espera e a decisão é DELA: a vaga
   * está retida em nome dela até `dueAt`, e o botão de aceitar vive na tela.
   *
   * `null` quando não há oferta a aceitar — inclusive quando a atividade exige
   * conferência da equipe: aí quem confirma é o time, pela fila de confirmações, e
   * quem fala disso é o campo `confirmation` (FASE 34). Os dois campos são coisas
   * diferentes de propósito: um é a decisão da PESSOA, o outro é a conferência da
   * EQUIPE, e misturá-los faria a tela pedir a quem não pode decidir.
   */
  promotion: { dueAt: Date; deadlineLabel: string } | null;
  /**
   * ─── Confirmação de vaga (FASE 34) ──────────────────────────────────────────
   * O que a pessoa precisa saber na lista: se a vaga está RETIDA devendo
   * confirmação, até quando, o que levar e onde ir. A tela não tem botão de
   * confirmar — quem confirma é a equipe —, então o aviso é INSTRUÇÃO, e não ação.
   */
  confirmation: {
    state: ConfirmationState;
    /** "25/09/2026, 23:59" no fuso do evento. */
    deadlineLabel: string | null;
    /** "faltam 2 dias" / "vence em menos de uma hora". */
    countdown: string | null;
    /** O checklist do que levar/apresentar. */
    requirements: string[];
    /**
     * O checklist ITEM A ITEM desta inscrição (FASE 37) — o que a equipe marca no
     * balcão e o que a vaga precisa ver satisfeito para se confirmar sozinha.
     *
     * Vem SEPARADO de `requirements` de propósito: `requirements` é a configuração
     * ATUAL da atividade, e isto é o snapshot do que foi cobrado de quem se inscreveu.
     * O organizador que editar a atividade amanhã muda o segundo e não o primeiro — e
     * quem já está na fila continua devendo o que foi combinado com ele.
     */
    items: MyConfirmationItem[];
    /** "2 de 3 itens" — o mesmo resumo que a equipe vê na fila. */
    itemsSummary: string;
    place: string | null;
    confirmedAt: Date | null;
  } | null;
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
        origin: true,
        confirmationDueAt: true,
        confirmedAt: true,
        cancelReason: true,
        /**
         * Os dois campos que decidem se há o que APAGAR (FASE 70 · fatia 4). Entram na
         * MESMA consulta da lista de propósito: a tela precisa do fato para desenhar (ou
         * não) o controle de eliminação, e uma segunda ida ao banco por linha seria N+1
         * numa tela que abre a cada visita.
         */
        formResponses: true,
        accessibilityNotes: true,
        activity: {
          select: {
            title: true,
            slug: true,
            startsAt: true,
            confirmationPolicy: true,
            confirmationRequirements: true,
            confirmationPlace: true,
          },
        },
        event: { select: { title: true, slug: true, timezone: true } },
        /**
         * O checklist da PRÓPRIA inscrição (FASE 37). Uma consulta só para todas as
         * inscrições da lista: o Prisma resolve a relação por `IN`, e pedir os itens
         * dentro do `map` faria N+1 numa tela que abre a cada visita.
         */
        confirmationItems: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            position: true,
            label: true,
            note: true,
            required: true,
            status: true,
          },
        },
      },
    }),
  );

  const now = new Date();

  return rows.map((row) => ({
    id: row.id,
    status: row.status as RegistrationStatus,
    waitlistPosition: row.waitlistPosition,
    createdAt: row.createdAt,
    /**
     * `activityId` vazio identifica a inscrição DO EVENTO (revisão da FASE 3): é
     * ela que dá acesso às atividades abertas, e a tela a apresenta como
     * "Inscrição no evento", não como uma atividade sem nome.
     */
    activityId: row.activityId ?? '',
    activityTitle: row.activity?.title ?? (row.activityId ? 'Atividade removida' : 'Inscrição no evento'),
    activitySlug: row.activity?.slug ?? '',
    activityStartsAt: row.activity?.startsAt ?? row.createdAt,
    eventId: row.eventId,
    eventTitle: row.event.title,
    eventSlug: row.event.slug,
    isEventRegistration: row.activityId === null,
    isAutomatic: row.origin === 'EVENT_AUTO',
    /**
     * ─── HÁ O QUE APAGAR? (FASE 70 · fatia 4) ───────────────────────────────────
     *
     * A tela de "Minhas inscrições" é o caminho visível para ELIMINAR as respostas do
     * formulário. O controle só aparece quando há o que eliminar: oferecer "apague as
     * suas respostas" a quem nunca respondeu nada é um beco sem saída — a pessoa clica,
     * o servidor responde "nada a apagar" e ela fica sem saber se o sistema falhou.
     *
     * A régua é a do DOMÍNIO (`erasePersonalFormResponses`), e não uma cópia: o que
     * sobra depois da eliminação é exatamente o que NÃO conta como resposta pessoal
     * (o CPF, que é obrigação do evento). Contar à mão aqui daria uma tela que oferece
     * o botão para sempre, ou que o esconde de quem tem o que apagar.
     */
    hasErasableResponses:
      erasePersonalFormResponses(row.formResponses).removedKeys.length > 0 ||
      row.accessibilityNotes !== null,
    /**
     * A confirmação só existe quando a atividade pede confirmação E há vaga retida
     * (ou confirmada) a mostrar. Numa atividade automática, ou na inscrição do
     * evento, o campo é `null` — e a tela não fala de prazo nenhum. Preencher com
     * "previsto para 23:59" numa atividade que não confirma seria inventar uma
     * obrigação que ninguém pediu.
     */
    /**
     * A oferta da fila (dívida E1) — a régua do aceite é do DOMÍNIO, e não um `if` da
     * tela: quem pode aceitar, quando o prazo venceu e onde quem confirma é a equipe
     * estão em `canAcceptPromotion`, testado sem banco nem navegador.
     */
    promotion: canAcceptPromotion({
      status: row.status as RegistrationStatus,
      dueAt: row.confirmationDueAt,
      policy: (row.activity?.confirmationPolicy as 'AUTOMATIC' | 'REQUIRED' | undefined) ?? null,
      now,
    }).ok
      ? {
          dueAt: row.confirmationDueAt as Date,
          /** "25/09/2026, 23:59" no fuso do evento — a MESMA régua do prazo da F34. */
          deadlineLabel: confirmationDeadlineLabel(
            row.confirmationDueAt as Date,
            row.event.timezone,
          ),
        }
      : null,
    confirmation: row.activity
      ? (() => {
          const policy = row.activity.confirmationPolicy as ConfirmationPolicy;
          const state = confirmationStateOf({
            policy,
            status: row.status as RegistrationStatus,
            dueAt: row.confirmationDueAt,
            now,
            cancelReason: row.cancelReason,
          });

          if (policy !== 'REQUIRED') return null;
          if (state === 'NOT_REQUIRED') return null;

          const items: MyConfirmationItem[] = row.confirmationItems.map((item) => {
            const status = normalizeItemStatus(item.status);

            return {
              id: item.id,
              position: item.position,
              label: item.label,
              note: item.note,
              required: item.required,
              status,
              statusLabel: itemStatusLabel(status),
            };
          });

          return {
            state,
            deadlineLabel: row.confirmationDueAt
              ? confirmationDeadlineLabel(row.confirmationDueAt, row.event.timezone)
              : null,
            countdown: row.confirmationDueAt
              ? confirmationCountdown(row.confirmationDueAt, now)
              : null,
            requirements: parseConfirmationRequirements(
              row.activity.confirmationRequirements,
            ).map(requirementLabel),
            items,
            itemsSummary: itemsSummary(items),
            place: row.activity.confirmationPlace,
            confirmedAt: row.confirmedAt,
          };
        })()
      : null,
  }));
}

/** Inscrição do usuário no EVENTO, se existir. */
export async function findMyEventRegistration(
  tenantId: string,
  userId: string,
  eventId: string,
): Promise<{
  id: string;
  status: RegistrationStatus;
  waitlistPosition: number | null;
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS RESPOSTAS GRAVADAS VÊM JUNTO (FASE 70)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A porta "Completar meus dados" precisa MOSTRAR o que a pessoa já respondeu. Sem
   *  isso, ela abriria um formulário em branco sobre respostas que existem — e a pessoa
   *  (ou a organização, que lê a tela) não teria como saber que o dado está lá. É a
   *  mesma leitura que já é feita: uma coluna a mais na projeção, e não uma consulta.
   */
  formResponses: Record<string, unknown>;
  /**
   * A nota de acessibilidade — uma COLUNA, e não resposta de campo declarado.
   *
   * Ela vem junto pelo mesmo motivo das respostas: o formulário de "completar" a
   * reenvia, e um campo em branco faria a nota gravada ser SOBRESCRITA por vazio a cada
   * passada por ali. Mostrar o valor é o que faz o reenvio ser inofensivo.
   */
  accessibilityNotes: string | null;
} | null> {
  const row = await withTenant(tenantId, (tx) =>
    tx.registration.findFirst({
      where: { userId, eventId, activityId: null, deletedAt: null },
      select: {
        id: true,
        status: true,
        waitlistPosition: true,
        formResponses: true,
        accessibilityNotes: true,
      },
    }),
  );

  if (!row) return null;

  return {
    id: row.id,
    status: row.status as RegistrationStatus,
    /**
     * A posição na FILA DO EVENTO (dívida E33): a tela pública precisa dela para dizer
     * onde a pessoa está — sem o número, "você está na lista de espera" não responde a
     * única pergunta que a pessoa tem.
     */
    waitlistPosition: row.waitlistPosition,
    /**
     * Depósito de respostas: `null`, texto ou lista viram objeto VAZIO, e não erro — o
     * leitor tolerante é o mesmo de todo o resto do formulário, e uma tela de inscrição
     * não pode cair porque uma coluna Json antiga está num formato inesperado.
     */
    formResponses:
      row.formResponses !== null &&
      typeof row.formResponses === 'object' &&
      !Array.isArray(row.formResponses)
        ? (row.formResponses as Record<string, unknown>)
        : {},
    accessibilityNotes: row.accessibilityNotes,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OS CAMPOS QUE O ORGANIZADOR DECLAROU (FASE 70 · fatia 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A ACTION LÊ ISTO, E NÃO O QUE A TELA MANDOU
 * ─────────────────────────────────────────────────────────────────────────────
 *  `validateFormResponses` precisa da ESPECIFICAÇÃO para decidir o que entra das
 *  respostas — e a especificação é do EVENTO, não do `<form>`. Aceitá-la como campo
 *  do formulário deixaria qualquer pessoa declarar o próprio spec no POST e gravar
 *  `{ cpf: ... }` (ou qualquer chave) como resposta de campo declarado: a validação
 *  passaria a ser uma formalidade que o cliente cumpre consigo mesmo.
 *
 *  A leitura passa pelo leitor TOLERANTE do domínio, o MESMO que a página do
 *  participante usa: a tela e o servidor não podem discordar sobre quais campos
 *  existem. Configuração torta devolve lista vazia — e vazia significa "o formulário
 *  de sempre", que é o que a pessoa vê e o que ela responde.
 */
export async function readEventRegistrationFields(input: {
  tenantId: string;
  eventSlug: string;
}): Promise<readonly RegistrationFormField[]> {
  return withTenant(input.tenantId, async (tx) => {
    const event = await tx.event.findFirst({
      where: { slug: input.eventSlug, deletedAt: null },
      select: { settings: true },
    });

    if (!event) return [];

    return readRegistrationForm(event.settings).fields;
  });
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
 *   • `registrations_live_event_user_key` (FASE 70) — a mesma pessoa ganhou a linha do
 *     EVENTO em outra transação (as duas atividades dela, num clique duplo). É a
 *     resposta idempotente do caminho que materializa a inscrição no evento: a linha
 *     que existe é a resposta, e não um erro.
 *
 * Qualquer outra violação (inclusive posse não reconhecida) propaga.
 *
 * `isUniqueViolation` e `violatedIndexName` vêm de `@/lib/db/prisma-errors` —
 * a leitura do formato do driver adapter mora em um lugar só.
 */
function classifyUniqueConflict(
  error: unknown,
): 'retry-position' | 'already-registered' | 'already-in-event' | 'unrelated' {
  if (!isUniqueViolation(error)) return 'unrelated';

  const index = violatedIndexName(error);

  if (index === 'registrations_waitlist_position_key') return 'retry-position';
  if (index === 'registrations_live_activity_user_key') return 'already-registered';
  if (index === 'registrations_live_event_user_key') return 'already-in-event';

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

/**
 * Exposto para os testes de integração medirem o estado real.
 *
 * `capacity` é o LIMITE EFETIVO (o teto da sala já aplicado) e `declaredCapacity` é
 * o que a atividade declara — os dois juntos, porque um teste que só visse o
 * declarado não conseguiria distinguir "80 vagas" de "80 vagas numa sala de 40".
 */
export async function readActivityCounters(
  tenantId: string,
  activityId: string,
): Promise<{
  confirmedCount: number;
  waitlistCount: number;
  capacity: number | null;
  declaredCapacity: number | null;
  roomCapacity: number | null;
} | null> {
  const row = await withTenant(tenantId, (tx) =>
    tx.activity.findFirst({
      where: { id: activityId },
      select: {
        confirmedCount: true,
        waitlistCount: true,
        capacity: true,
        room: { select: { capacity: true } },
      },
    }),
  );

  if (!row) return null;

  return {
    confirmedCount: row.confirmedCount,
    waitlistCount: row.waitlistCount,
    capacity: effectiveActivityCapacity(row.capacity, row.room?.capacity ?? null),
    declaredCapacity: row.capacity,
    roomCapacity: row.room?.capacity ?? null,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  QUEM ESPERA VAGA NO EVENTO (dívida E33)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A fila existe no banco desde que a reserva falha — mas dívida que não se vê não
 *  existe para quem organiza: antes desta leitura, a instituição só descobria a
 *  procura por fora (telefone, e-mail) e refazia à mão o que o sistema já sabia.
 *
 *  A lista sai na ORDEM DA FILA (`waitlistPosition`), que é a ordem em que as
 *  promoções acontecem. Ordenar por data de entrada daria uma fila bonita e uma
 *  posição mentirosa, porque quem entrou depois de uma reindexação tem data maior e
 *  posição menor.
 */
export interface AcceptPromotionInput {
  tenantId: string;
  registrationId: string;
  userId: string;
}

export type AcceptPromotionOutcome =
  | { ok: true; registrationId: string }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_REQUIRED' | 'EXPIRED' | 'ALREADY_SETTLED' | 'INTERNAL'; message: string };

/**
 * Aceita a vaga ofertada pela fila (dívida E1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A POSSE É DO DONO DA INSCRIÇÃO, E A ESCRITA É CONDICIONAL
 * ─────────────────────────────────────────────────────────────────────────────
 *  `userId` entra no `where` do `updateMany`: aceitar a vaga de outra pessoa não é uma
 *  permissão que se confere antes — é uma linha que não existe (invariante 4). E o
 *  `status: 'PENDING'` no mesmo `where` é o que faz dois cliques (ou o clique que
 *  chega depois de a vaga vencer) produzirem UM efeito: o segundo afeta 0 linhas.
 *
 *  O prazo é conferido no DOMÍNIO antes (mensagem boa) e na ESCRITA depois (verdade):
 *  a varredura pode ter liberado a vaga entre a leitura e o clique.
 */
export async function acceptPromotion(
  input: AcceptPromotionInput,
): Promise<AcceptPromotionOutcome> {
  const outcome = await withTenant(input.tenantId, async (tx) => {
    const row = await tx.registration.findFirst({
      where: { id: input.registrationId, userId: input.userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        confirmationDueAt: true,
        activity: { select: { confirmationPolicy: true } },
      },
    });

    if (!row) {
      return {
        ok: false as const,
        code: 'NOT_FOUND' as const,
        message: 'Inscrição não encontrada.',
      };
    }

    const check = canAcceptPromotion({
      status: row.status as RegistrationStatus,
      dueAt: row.confirmationDueAt,
      policy: (row.activity?.confirmationPolicy as 'AUTOMATIC' | 'REQUIRED' | undefined) ?? null,
      now: new Date(),
    });

    if (!check.ok) {
      const code =
        check.reason === 'EXPIRED'
          ? ('EXPIRED' as const)
          : check.reason === 'ALREADY_SETTLED'
            ? ('ALREADY_SETTLED' as const)
            : ('NOT_REQUIRED' as const);

      return { ok: false as const, code, message: check.message };
    }

    const claimed = await tx.registration.updateMany({
      where: { id: row.id, userId: input.userId, status: 'PENDING' },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmationDueAt: null },
    });

    if (claimed.count === 0) {
      return {
        ok: false as const,
        code: 'ALREADY_SETTLED' as const,
        message: 'Esta vaga já foi resolvida — não há oferta a aceitar.',
      };
    }

    await recordAudit(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'UPDATE',
        entityType: 'registration',
        entityId: row.id,
        changes: { vaga: { from: 'oferta da fila (48 h)', to: 'aceita pelo participante' } },
      },
      tx,
    );

    return { ok: true as const, registrationId: row.id };
  });

  if (outcome.ok) {
    /**
     * O crédito de "inscrição confirmada" (FASE 43) é consequência, não condição: o
     * gancho relê o estado no banco e só credita `CONFIRMED` — que é o estado agora.
     * Falhar aqui não desfaz o aceite (invariante 8).
     */
    await rewardRegistrationConfirmedById({
      tenantId: input.tenantId,
      registrationId: outcome.registrationId,
    });
  }

  return outcome;
}

export interface EventWaitlistEntry {
  registrationId: string;
  position: number;
  personName: string;
  waitingSince: Date;
}

export async function listEventWaitlist(input: {
  tenantId: string;
  eventId: string;
}): Promise<EventWaitlistEntry[]> {
  return withTenant(input.tenantId, async (tx) => {
    const rows = await tx.registration.findMany({
      where: {
        eventId: input.eventId,
        activityId: null,
        status: 'WAITLISTED',
        deletedAt: null,
      },
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        waitlistPosition: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });

    return rows.map((row, index) => ({
      registrationId: row.id,
      position: row.waitlistPosition ?? index + 1,
      personName: row.user.name,
      waitingSince: row.createdAt,
    }));
  });
}

export { invalidateTenantCache, type RegistrationDecision };

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Lotação, lista de espera e cancelamento
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA CENTRAL: SUPERLOTAÇÃO SOB CONCORRÊNCIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O padrão ingênuo é:
 *
 *      1. SELECT count(*) FROM registrations WHERE activityId = X   -- 49
 *      2. comparar com capacity (50) -> cabe
 *      3. INSERT
 *
 *  Duas requisições simultâneas leem 49, ambas concluem que cabe, ambas
 *  inserem — e a atividade termina com 51 inscritos. É o bug clássico de
 *  check-then-act, e o teste de carga sempre encontra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SOLUÇÃO: CONTADOR DENORMALIZADO + UPDATE CONDICIONAL ATÔMICO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `activities.confirmedCount` é mantido por este módulo. A reserva de vaga é
 *  UMA instrução:
 *
 *      UPDATE activities
 *         SET "confirmedCount" = "confirmedCount" + 1
 *       WHERE id = $1
 *         AND ("capacity" IS NULL OR "confirmedCount" < "capacity")
 *
 *  O PostgreSQL serializa UPDATEs concorrentes na MESMA linha: a segunda
 *  transação bloqueia, reavalia o predicado já com o contador atualizado e
 *  afeta 0 linhas. Zero linhas = "não havia vaga" — sem race condition, sem
 *  `SELECT FOR UPDATE`, sem lock explícito.
 *
 *  Por isso a decisão de "cabe ou não" NÃO é tomada em JavaScript para o
 *  caminho de escrita: ela é o próprio predicado do UPDATE. As funções puras
 *  deste arquivo decidem o que fazer DEPOIS (aceitar, ir para espera, recusar)
 *  e são usadas para validação, UI e testes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Semântica de capacidade
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Capacidade é `Int?`:
 *   null  -> ILIMITADA
 *   0     -> ESGOTADA (nenhuma vaga)
 *   n > 0 -> n vagas no total
 *
 * A distinção entre `null` e `0` é deliberada e testada: tratar 0 como
 * "ilimitado" liberaria inscrições em uma atividade configurada como lotada.
 */
export function isUnlimitedCapacity(capacity: number | null | undefined): boolean {
  return capacity === null || capacity === undefined;
}

/** Vagas restantes. `null` quando ilimitada. Nunca negativo. */
export function remainingSeats(
  capacity: number | null | undefined,
  confirmedCount: number,
): number | null {
  if (isUnlimitedCapacity(capacity)) return null;
  return Math.max(0, (capacity as number) - confirmedCount);
}

export function hasAvailableSeat(
  capacity: number | null | undefined,
  confirmedCount: number,
): boolean {
  if (isUnlimitedCapacity(capacity)) return true;
  return confirmedCount < (capacity as number);
}

/** Ocupação em 0..1. `null` quando ilimitada (não há denominador). */
export function occupancyRatio(
  capacity: number | null | undefined,
  confirmedCount: number,
): number | null {
  if (isUnlimitedCapacity(capacity)) return null;
  const cap = capacity as number;
  if (cap <= 0) return 1;
  return Math.min(1, confirmedCount / cap);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Decisão de inscrição
// ───────────────────────────────────────────────────────────────────────────────
export type RegistrationDecision =
  | { outcome: 'CONFIRMED'; remainingAfter: number | null }
  | { outcome: 'WAITLISTED'; position: number }
  | { outcome: 'REJECTED'; reason: RegistrationRejectionReason; message: string };

export type RegistrationRejectionReason =
  | 'FULL_NO_WAITLIST'
  | 'DUPLICATE'
  | 'ALREADY_WAITLISTED'
  | 'ACTIVITY_CANCELED'
  | 'ACTIVITY_NOT_OPEN';

export interface RegistrationDecisionInput {
  /** `null` = ilimitada; `0` = esgotada. */
  capacity: number | null | undefined;
  /** Valor atual do contador denormalizado. */
  confirmedCount: number;
  waitlistEnabled: boolean;
  /** Quantidade de pessoas já na lista de espera. */
  waitlistCount: number;
  /** Limite da lista de espera. `null` = ilimitada. */
  waitlistCapacity?: number | null;
  /** Já existe inscrição ativa deste usuário? */
  alreadyRegistered: boolean;
  /** Já está na lista de espera? */
  alreadyWaitlisted?: boolean;
  activityStatus: 'DRAFT' | 'SCHEDULED' | 'FULL' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
}

/**
 * Decide o desfecho de uma tentativa de inscrição, dado o estado atual.
 *
 * IMPORTANTE: esta função é usada para (a) a checagem de leitura que dá
 * feedback imediato na UI e (b) os testes. O caminho de ESCRITA não confia nela
 * — ele usa o UPDATE condicional, cujo resultado em 0 linhas é a verdade
 * definitiva. Aqui pode haver corrida; lá, não.
 */
export function decideRegistration(
  input: RegistrationDecisionInput,
): RegistrationDecision {
  const {
    capacity,
    confirmedCount,
    waitlistEnabled,
    waitlistCount,
    waitlistCapacity = null,
    alreadyRegistered,
    alreadyWaitlisted = false,
    activityStatus,
  } = input;

  if (activityStatus === 'CANCELED') {
    return {
      outcome: 'REJECTED',
      reason: 'ACTIVITY_CANCELED',
      message: 'Esta atividade foi cancelada.',
    };
  }

  // Atividades em rascunho/interrompidas/concluídas não aceitam inscrição.
  if (activityStatus !== 'SCHEDULED' && activityStatus !== 'FULL') {
    return {
      outcome: 'REJECTED',
      reason: 'ACTIVITY_NOT_OPEN',
      message: 'Esta atividade não está com inscrições abertas.',
    };
  }

  if (alreadyRegistered) {
    return {
      outcome: 'REJECTED',
      reason: 'DUPLICATE',
      message: 'Você já está inscrito nesta atividade.',
    };
  }

  if (alreadyWaitlisted) {
    return {
      outcome: 'REJECTED',
      reason: 'ALREADY_WAITLISTED',
      message: 'Você já está na lista de espera desta atividade.',
    };
  }

  if (hasAvailableSeat(capacity, confirmedCount)) {
    return {
      outcome: 'CONFIRMED',
      // Vagas restantes DEPOIS de consumir uma.
      remainingAfter: remainingSeats(capacity, confirmedCount + 1),
    };
  }

  // Sem vaga: tenta a lista de espera, se habilitada e com espaço.
  if (waitlistEnabled) {
    const waitlistFull =
      waitlistCapacity !== null && waitlistCapacity > 0 && waitlistCount >= waitlistCapacity;

    if (!waitlistFull) {
      return { outcome: 'WAITLISTED', position: waitlistCount + 1 };
    }
  }

  return {
    outcome: 'REJECTED',
    reason: 'FULL_NO_WAITLIST',
    message: waitlistEnabled
      ? 'A atividade está lotada e a lista de espera também.'
      : 'A atividade está lotada.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Promoção da lista de espera
// ───────────────────────────────────────────────────────────────────────────────
export type WaitlistPromotion =
  | { promote: false; reason: 'NO_WAITLIST' | 'NO_SEAT' }
  | { promote: true; nextPosition: number };

/**
 * Ao liberar uma vaga, quem deve ser promovido?
 *
 * Ordem: FIFO pela posição na lista de espera. É a política mais previsível e a
 * que os participantes esperam. `waitlistPosition` é reindexado após cada
 * promoção para que as posições exibidas continuem fazendo sentido.
 */
export function nextWaitlistPromotion(
  input: {
    capacity: number | null | undefined;
    confirmedCount: number;
    waitlist: readonly { id: string; waitlistPosition: number | null }[];
  },
): WaitlistPromotion {
  const { capacity, confirmedCount, waitlist } = input;

  if (waitlist.length === 0) return { promote: false, reason: 'NO_WAITLIST' };
  if (!hasAvailableSeat(capacity, confirmedCount)) {
    return { promote: false, reason: 'NO_SEAT' };
  }

  const ordered = [...waitlist].sort(
    (a, b) => (a.waitlistPosition ?? Number.MAX_SAFE_INTEGER) - (b.waitlistPosition ?? Number.MAX_SAFE_INTEGER),
  );

  return { promote: true, nextPosition: ordered[0]!.waitlistPosition ?? 1 };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Transições de status permitidas
// ───────────────────────────────────────────────────────────────────────────────
export type RegistrationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'WAITLISTED'
  | 'CANCELED'
  | 'ATTENDED'
  | 'NO_SHOW';

/**
 * Transições válidas de status de inscrição.
 *
 * Modelar isso explicitamente impede o bug de "desfazer" uma presença já
 * registrada (ATTENDED -> CONFIRMED), que corromperia o cálculo de carga
 * horária do certificado.
 */
const ALLOWED_TRANSITIONS: Record<RegistrationStatus, readonly RegistrationStatus[]> = {
  PENDING: ['CONFIRMED', 'WAITLISTED', 'CANCELED'],
  CONFIRMED: ['CANCELED', 'ATTENDED', 'NO_SHOW'],
  WAITLISTED: ['CONFIRMED', 'CANCELED'],
  CANCELED: [], // estado terminal: cancelar é definitivo
  ATTENDED: [], // estado terminal: presença consumada
  NO_SHOW: [],
};

export function canTransitionRegistration(
  from: RegistrationStatus,
  to: RegistrationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Cancelar libera vaga?
 *
 * Só libera se a inscrição estava de fato ocupando vaga. Cancelar algo que já
 * estava CANCELED não pode decrementar o contador — isso inflaria a lotação
 * disponível e permitiria superlotação por cancelamentos repetidos.
 */
export function cancelReleasesSeat(status: RegistrationStatus): boolean {
  return status === 'CONFIRMED' || status === 'PENDING';
}

/** Cancelar reordena a lista de espera? (só se estava esperando) */
export function cancelAffectsWaitlist(status: RegistrationStatus): boolean {
  return status === 'WAITLISTED';
}

// ───────────────────────────────────────────────────────────────────────────────
//  SQL dos contadores — a fronteira transacional
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Predicado de disponibilidade de vaga, para usar no `WHERE` de um UPDATE.
 *
 * Mantido aqui (e não escrito à mão em cada caso de uso) para que a semântica de
 * `null` = ilimitada e `0` = esgotada exista em um único lugar. Se alguém mudar
 * a regra, muda aqui e todos os caminhos acompanham.
 *
 * A string é interpolada apenas com identificadores fixos deste módulo — nunca
 * com entrada de usuário.
 */
export const SEAT_AVAILABLE_PREDICATE = `("capacity" IS NULL OR "confirmedCount" < "capacity")`;

/** Predicado para reservar vaga de lista de espera (não mexe no contador). */
export const WAITLIST_POSITION_SQL = `
  COALESCE(
    (SELECT MAX("waitlistPosition") FROM registrations
      WHERE "activityId" = $1 AND status = 'WAITLISTED'),
    0
  ) + 1
`;

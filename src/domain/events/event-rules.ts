/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Eventos e Atividades
 *
 *  Regras puras sobre janelas de tempo, ciclo de vida e conflitos de agenda.
 *  Nenhuma dependência de framework, banco ou React.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DECISÃO CENTRAL: O ARMAZENAMENTO É SEMPRE UTC
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As colunas `startsAt`/`endsAt` são `TIMESTAMPTZ` — o PostgreSQL guarda em UTC
 *  e converte na leitura. O campo `timezone` (IANA) existe para *apresentação*:
 *  é ele que responde "que horas são em Salvador?".
 *
 *  Consequência prática: comparar `startsAt < endsAt` é sempre correto, mesmo
 *  que o evento atravesse o horário de verão. Comparar strings de data local
 *  seria errado — e é o bug clássico em sistemas de agendamento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Ciclo de vida
// ───────────────────────────────────────────────────────────────────────────────
export type EventStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'IN_PROGRESS'
  | 'FINISHED'
  | 'CANCELED'
  | 'ARCHIVED';

export type ActivityStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'FULL'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELED';

/** Status em que o evento é publicamente visível. */
const PUBLICLY_VISIBLE: ReadonlySet<EventStatus> = new Set<EventStatus>([
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'FINISHED',
]);

/** Status em que o evento aceita novas inscrições no nível do evento. */
const EVENT_ACCEPTS_REGISTRATION: ReadonlySet<EventStatus> = new Set<EventStatus>([
  'PUBLISHED',
  'REGISTRATION_OPEN',
]);

export function isPubliclyVisible(status: EventStatus): boolean {
  return PUBLICLY_VISIBLE.has(status);
}

/**
 * O evento está em estado que permite inscrição?
 *
 * ATENÇÃO: isto é apenas o primeiro filtro (status). A decisão completa depende
 * também da janela de tempo — ver `evaluateRegistrationWindow`.
 */
export function eventAcceptsRegistration(status: EventStatus): boolean {
  return EVENT_ACCEPTS_REGISTRATION.has(status);
}

/** Atividades que ainda podem receber inscrição. */
export function activityAcceptsRegistration(status: ActivityStatus): boolean {
  return status === 'SCHEDULED';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Janelas de tempo
// ───────────────────────────────────────────────────────────────────────────────
export type WindowDecision =
  | { open: true }
  | {
      open: false;
      reason:
        | 'NOT_STARTED'
        | 'CLOSED'
        | 'EVENT_STARTED'
        | 'EVENT_FINISHED'
        | 'EVENT_CANCELED'
        | 'ACTIVITY_CANCELED';
      /** Mensagem adequada para exibir ao participante. */
      message: string;
    };

export interface RegistrationWindowInput {
  now: Date;
  /** Início e fim do evento (obrigatórios). */
  eventStartsAt: Date;
  eventEndsAt: Date;
  eventStatus: EventStatus;
  /** Janela de inscrição do evento. `null` = sem restrição, vale o evento todo. */
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  /** Quando a inscrição é em uma atividade específica. */
  activity?: {
    startsAt: Date;
    endsAt: Date;
    status: ActivityStatus;
  } | null;
  /** Aceita inscrição depois do início do evento? (ex.: credenciamento) */
  allowAfterStart?: boolean;
}

/**
 * Decide se uma inscrição pode ser feita AGORA.
 *
 * A ordem das checagens importa para a mensagem de erro ser útil: informamos o
 * motivo mais específico primeiro (evento cancelado antes de "ainda não abriu").
 */
export function evaluateRegistrationWindow(
  input: RegistrationWindowInput,
): WindowDecision {
  const {
    now,
    eventStartsAt,
    eventEndsAt,
    eventStatus,
    registrationOpensAt,
    registrationClosesAt,
    activity,
    allowAfterStart = false,
  } = input;

  const t = now.getTime();

  // ── Cancelamentos primeiro: é a informação mais relevante ──────────────────
  if (eventStatus === 'CANCELED') {
    return {
      open: false,
      reason: 'EVENT_CANCELED',
      message: 'Este evento foi cancelado.',
    };
  }
  if (activity?.status === 'CANCELED') {
    return {
      open: false,
      reason: 'ACTIVITY_CANCELED',
      message: 'Esta atividade foi cancelada.',
    };
  }

  // ── Status do evento ───────────────────────────────────────────────────────
  /**
   * `allowAfterStart` é um bypass administrativo deliberado: o credenciamento
   * presencial inscreve alguém no balcão DEPOIS do evento ter começado. Nesse
   * modo pulamos a restrição de status e de janela, mas nunca a de cancelamento
   * (já tratada acima) nem a de atividade já iniciada/encerrada (tratada abaixo).
   */
  if (!allowAfterStart && !eventAcceptsRegistration(eventStatus)) {
    if (eventStatus === 'DRAFT' || eventStatus === 'ARCHIVED') {
      return {
        open: false,
        reason: 'CLOSED',
        message: 'As inscrições não estão disponíveis para este evento.',
      };
    }
    if (eventStatus === 'REGISTRATION_CLOSED') {
      return {
        open: false,
        reason: 'CLOSED',
        message: 'O período de inscrições foi encerrado.',
      };
    }
    if (eventStatus === 'IN_PROGRESS' || eventStatus === 'FINISHED') {
      /**
       * Em IN_PROGRESS, a inscrição em uma ATIVIDADE ainda pode valer: o evento
       * começou ontem e a atividade é amanhã. Só bloqueamos o evento como um
       * todo, onde "inscrição" significa credenciamento geral.
       */
      if (!(eventStatus === 'IN_PROGRESS' && activity)) {
        return {
          open: false,
          reason: 'EVENT_STARTED',
          message: 'O evento já começou. Inscrições encerradas.',
        };
      }
    }
  }

  // ── Janela explícita de inscrição do evento ────────────────────────────────
  // Ignorada no modo administrativo, que existe justamente para operar fora dela.
  if (!allowAfterStart) {
    if (registrationOpensAt && t < registrationOpensAt.getTime()) {
      return {
        open: false,
        reason: 'NOT_STARTED',
        message: 'As inscrições ainda não abriram.',
      };
    }
    if (registrationClosesAt && t > registrationClosesAt.getTime()) {
      return {
        open: false,
        reason: 'CLOSED',
        message: 'O período de inscrições foi encerrado.',
      };
    }
  }

  // ── Limites do evento ──────────────────────────────────────────────────────
  if (t > eventEndsAt.getTime()) {
    return {
      open: false,
      reason: 'EVENT_FINISHED',
      message: 'O evento já foi encerrado.',
    };
  }

  if (!allowAfterStart && t >= eventStartsAt.getTime()) {
    /**
     * Inscrição em ATIVIDADE específica continua válida enquanto ela não
     * começar. O evento pode já ter iniciado — é normal se inscrever na
     * atividade da tarde durante a manhã do primeiro dia.
     */
    if (!activity) {
      return {
        open: false,
        reason: 'EVENT_STARTED',
        message: 'O evento já começou. Inscrições encerradas.',
      };
    }
  }

  // ── Limites da atividade ───────────────────────────────────────────────────
  // Esta checagem fecha a janela na atividade, com ou sem `allowAfterStart`.
  if (activity && t >= activity.startsAt.getTime()) {
    return {
      open: false,
      reason: 'EVENT_STARTED',
      message: 'Esta atividade já começou. Inscrições encerradas.',
    };
  }

  return { open: true };
}

/** Conveniência booleana sobre `evaluateRegistrationWindow`. */
export function isRegistrationOpen(input: RegistrationWindowInput): boolean {
  return evaluateRegistrationWindow(input).open;
}

/**
 * Status do evento derivado do relógio.
 *
 * Usado por jobs para transicionar automaticamente PUBLISHED →
 * REGISTRATION_OPEN → IN_PROGRESS → FINISHED. Papéis de sistema (cancelado,
 * rascunho, arquivado) nunca são sobrescritos pelo relógio.
 */
export function deriveEventStatus(
  event: {
    status: EventStatus;
    startsAt: Date;
    endsAt: Date;
    registrationOpensAt?: Date | null;
    registrationClosesAt?: Date | null;
  },
  now: Date = new Date(),
): EventStatus {
  const MANUAL: ReadonlySet<EventStatus> = new Set<EventStatus>([
    'DRAFT',
    'CANCELED',
    'ARCHIVED',
  ]);
  if (MANUAL.has(event.status)) return event.status;

  const t = now.getTime();

  if (t > event.endsAt.getTime()) return 'FINISHED';
  if (t >= event.startsAt.getTime()) return 'IN_PROGRESS';

  const opensAt = event.registrationOpensAt?.getTime() ?? -Infinity;
  const closesAt = event.registrationClosesAt?.getTime() ?? Infinity;

  if (t > closesAt) return 'REGISTRATION_CLOSED';
  if (t >= opensAt) return 'REGISTRATION_OPEN';

  return 'PUBLISHED';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Conflitos de agenda
// ───────────────────────────────────────────────────────────────────────────────
export interface TimeSlot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Dois intervalos se sobrepõem?
 *
 * Usa a comparação canônica de interseção: `aInicio < bFim && bInicio < aFim`.
 * Intervalos que apenas se tocam (um termina quando o outro começa) NÃO são
 * conflito — é o caso normal de atividades em sequência na mesma sala.
 */
export function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/** Duração em minutos, arredondada para baixo. */
export function durationMinutes(slot: TimeSlot): number {
  return Math.max(0, Math.floor((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000));
}

export interface ConflictCheckInput {
  candidate: TimeSlot & { roomId?: string | null; id?: string };
  existing: readonly (TimeSlot & { id: string; roomId?: string | null; title?: string })[];
}

export type ConflictResult =
  | { hasConflict: false }
  | {
      hasConflict: true;
      kind: 'ROOM' | 'EVENT_BOUNDARY';
      /** Conflitos de sala (a atividade não pode ocupar duas salas iguais). */
      roomConflicts: readonly { id: string; title?: string }[];
      message: string;
    };

/**
 * Verifica conflitos de agenda para uma atividade.
 *
 * Só considera conflito de SALA — não de participantes. Um participante pode
 * ter duas atividades no mesmo horário (é uma escolha dele, e a agenda pessoal
 * é responsabilidade da UI). Duas atividades na mesma sala, não.
 */
export function checkScheduleConflict(input: ConflictCheckInput): ConflictResult {
  const { candidate, existing } = input;

  // Sem sala definida, não há como haver conflito de espaço.
  if (!candidate.roomId) return { hasConflict: false };

  const roomConflicts = existing.filter(
    (slot) =>
      slot.id !== candidate.id && // não conflita consigo mesma (edição)
      slot.roomId === candidate.roomId &&
      overlaps(candidate, slot),
  );

  if (roomConflicts.length > 0) {
    const nomes = roomConflicts.map((c) => c.title ?? c.id).join(', ');
    return {
      hasConflict: true,
      kind: 'ROOM',
      roomConflicts: roomConflicts.map((c) => ({ id: c.id, title: c.title })),
      message: `A sala já está ocupada no horário informado: ${nomes}.`,
    };
  }

  return { hasConflict: false };
}

/**
 * A atividade está contida na janela do evento?
 *
 * Uma atividade fora das datas do evento é quase sempre erro de cadastro —
 * ela existiria numa agenda que ninguém vê.
 */
export function isWithinEventWindow(
  slot: TimeSlot,
  event: TimeSlot,
): boolean {
  return (
    slot.startsAt.getTime() >= event.startsAt.getTime() &&
    slot.endsAt.getTime() <= event.endsAt.getTime()
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Salas
// ───────────────────────────────────────────────────────────────────────────────
export type RoomCapacityDecision =
  | { fits: true }
  | { fits: false; reason: 'EXCEEDS_ROOM_CAPACITY'; message: string };

/**
 * A capacidade da sala, normalizada.
 *
 * `null`, `undefined` e qualquer valor não positivo significam a MESMA coisa: a
 * sala não declara limite. O `0` sobreviveu como "sem limite" desde a FASE 3 (o
 * `DEFAULT 0` da coluna fazia toda sala nascer assim) e continua sendo lido desta
 * forma — o que muda é que a escrita passa a gravar `null`, para o dado não
 * afirmar "zero lugares" quando quer dizer "não sei".
 */
export function normalizeRoomCapacity(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value > 0 ? value : null;
}

/** A sala declara limite de lotação? (`false` = a lotação da atividade manda) */
export function roomHasCapacityLimit(roomCapacity: number | null | undefined): boolean {
  return normalizeRoomCapacity(roomCapacity) !== null;
}

/**
 * "300 lugares" / "sem limite".
 *
 * Fica no domínio, e não em cada tela, porque as três telas que mostram uma sala
 * (equipe do evento, seletor de sala da atividade e página pública) precisam dizer a
 * MESMA coisa: uma sala sem limite exibida como "0 lugares" faria o organizador
 * achar que a sala está bloqueada.
 */
export function roomCapacityLabel(roomCapacity: number | null | undefined): string {
  const capacity = normalizeRoomCapacity(roomCapacity);
  return capacity === null ? 'sem limite' : `${capacity} lugares`;
}

/**
 * O LIMITE EFETIVO de uma atividade: o menor entre o que ela declara e o que a
 * sala comporta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É UMA FUNÇÃO, E NÃO UMA CONTA NA TELA
 * ─────────────────────────────────────────────────────────────────────────────
 *  "Quantas pessoas cabem nesta atividade?" tem de ter UMA resposta, usada por
 *  quem exibe as vagas, por quem decide a promoção da lista de espera e por quem
 *  reserva a vaga no banco. Duas cópias da mesma conta divergem no primeiro dia em
 *  que alguém mexer na regra — e a que ficasse para trás passaria a anunciar vaga
 *  que não existe.
 *
 *  Semântica (a mesma do resto do domínio, mais o teto da sala):
 *    • atividade `null`  = ilimitada -> o limite é o da sala (ou `null` se a sala
 *      também não declara limite);
 *    • atividade `0`     = esgotada  -> continua `0`, e a sala não "devolve" vaga;
 *    • atividade `n > 0` -> `min(n, capacidade da sala)`, quando a sala tem limite.
 */
export function effectiveActivityCapacity(
  activityCapacity: number | null | undefined,
  roomCapacity: number | null | undefined,
): number | null {
  const room = normalizeRoomCapacity(roomCapacity);
  const activity = activityCapacity ?? null;

  if (activity === null) return room;
  if (activity <= 0) return activity;
  if (room === null) return activity;

  return Math.min(activity, room);
}

/**
 * A lotação da atividade cabe na sala?
 *
 * `roomCapacity` sem limite (`null` ou ≤ 0) não bloqueia. Atividade sem limite
 * declarado também não é bloqueada: nesse caso quem limita é a própria sala, e o
 * teto é aplicado na reserva de vaga (`effectiveActivityCapacity`).
 */
export function evaluateRoomFit(
  activityCapacity: number | null,
  roomCapacity: number | null,
): RoomCapacityDecision {
  const room = normalizeRoomCapacity(roomCapacity);

  if (activityCapacity === null || activityCapacity <= 0) return { fits: true };
  if (room === null) return { fits: true };

  if (activityCapacity > room) {
    return {
      fits: false,
      reason: 'EXCEEDS_ROOM_CAPACITY',
      message: `A lotação da atividade (${activityCapacity}) excede a capacidade da sala (${room}).`,
    };
  }

  return { fits: true };
}

/**
 * O que uma atividade viva ocupa da sala — o insumo das duas guardas de sala.
 *
 * `capacity` é a lotação DECLARADA (o que o organizador configurou) e
 * `confirmedCount` é o que já está ocupado de fato. As duas importam: reduzir a
 * sala abaixo do declarado deixaria a configuração mentindo, e reduzir abaixo do
 * confirmado deixaria gente sem lugar.
 */
export interface RoomUsage {
  title: string;
  capacity: number | null;
  confirmedCount: number;
}

export type RoomChangeDecision =
  | { allowed: true; normalizedCapacity: number | null }
  | { allowed: false; code: 'ROOM_CAPACITY_BELOW_USAGE'; message: string };

/**
 * A capacidade NOVA da sala pode valer?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A SALA É O TETO, ENTÃO ELA NÃO PODE ENCOLHER ABAIXO DO QUE JÁ EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aceitar a redução criaria a situação que o limite efetivo existe para evitar:
 *  uma atividade com 80 vagas numa sala de 40, ou 60 inscritos numa sala de 20.
 *  Os dois casos são recusados com o NÚMERO na mensagem — quem está digitando
 *  precisa saber qual atividade impede, não só que "não pode".
 *
 *  Aumentar (ou tirar o limite) é sempre permitido: nenhuma configuração existente
 *  passa a ser inválida por isso.
 */
export function evaluateRoomCapacityChange(input: {
  /** Capacidade que está sendo gravada (`null` = sem limite). */
  nextCapacity: number | null;
  /** Atividades VIVAS que acontecem nesta sala (`deletedAt` nulo). */
  usage: readonly RoomUsage[];
}): RoomChangeDecision {
  const next = normalizeRoomCapacity(input.nextCapacity);

  if (next === null || input.usage.length === 0) {
    return { allowed: true, normalizedCapacity: next };
  }

  const declared = input.usage.filter((row) => row.capacity !== null && row.capacity > next);
  const occupied = input.usage.filter((row) => row.confirmedCount > next);

  if (declared.length === 0 && occupied.length === 0) {
    return { allowed: true, normalizedCapacity: next };
  }

  const details: string[] = [];

  if (declared.length > 0) {
    const worst = declared.reduce((max, row) => ((row.capacity ?? 0) > (max.capacity ?? 0) ? row : max));
    details.push(`“${worst.title}” está configurada com ${worst.capacity} vaga(s)`);
  }

  if (occupied.length > 0) {
    const worst = occupied.reduce((max, row) => (row.confirmedCount > max.confirmedCount ? row : max));
    details.push(`“${worst.title}” já tem ${worst.confirmedCount} inscrito(s)`);
  }

  return {
    allowed: false,
    code: 'ROOM_CAPACITY_BELOW_USAGE',
    message: `Esta sala não pode ficar com ${next} lugar(es): ${details.join(' e ')}. Ajuste a atividade antes de reduzir a sala.`,
  };
}

export type RoomRemovalDecision =
  | { allowed: true }
  | { allowed: false; code: 'ROOM_IN_USE'; message: string };

/**
 * A sala pode ser excluída?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  EXCLUIR SALA EM USO APAGARIA INFORMAÇÃO EM SILÊNCIO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `activities."roomId"` é `ON DELETE SET NULL`: apagar a sala não falharia — ela
 *  simplesmente sumiria da programação, e a atividade passaria a "sem sala" sem
 *  ninguém pedir. É a mesma classe de defeito que a exclusão de mídia da FASE 24
 *  foi desenhada para não ter (armadilha 39): a recusa diz ONDE a sala está sendo
 *  usada, e o caminho de saída é trocar a sala dessas atividades.
 *
 *  Cancelar uma atividade NÃO libera a sala: a atividade cancelada continua sendo
 *  registro do que aconteceria ali, e o vínculo com a sala é parte disso.
 */
export function evaluateRoomRemoval(input: {
  usage: readonly RoomUsage[];
}): RoomRemovalDecision {
  if (input.usage.length === 0) return { allowed: true };

  const count = input.usage.length;
  const first = input.usage[0]!;
  const sample = count === 1 ? `“${first.title}”` : `“${first.title}” e mais ${count - 1}`;

  return {
    allowed: false,
    code: 'ROOM_IN_USE',
    message: `Esta sala está em uso por ${count} atividade(s) — ${sample}. Troque a sala dessas atividades (ou deixe “Sem sala definida”) antes de excluir.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Formatação (dependente de fuso, mas ainda pura)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Formata um intervalo no fuso do evento.
 *
 * `Intl` é usado em vez de manipulação manual porque lida com horário de verão
 * e com nomes de mês localizados sem tabelas próprias.
 */
export function formatEventPeriod(
  slot: TimeSlot,
  timezone: string,
  locale = 'pt-BR',
): string {
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  });
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });

  const sameDay =
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(slot.startsAt) ===
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(slot.endsAt);

  if (sameDay) {
    return `${dateFormatter.format(slot.startsAt)}, ${timeFormatter.format(
      slot.startsAt,
    )} – ${timeFormatter.format(slot.endsAt)}`;
  }

  return `${dateFormatter.format(slot.startsAt)} a ${dateFormatter.format(
    slot.endsAt,
  )}`;
}

/** Formata "1h30" a partir de minutos. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0min';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h${String(mins).padStart(2, '0')}`;
}

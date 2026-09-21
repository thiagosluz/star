/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Regras de presença em atividades
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA QUE FALTAVA: "ESTEVE EM TUDO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O gatilho de carta `EVENT_ATTENDANCE_FULL` existe desde a FASE 5 e era
 *  selecionável no catálogo — mas NADA o acionava. O comentário no serviço de
 *  credenciamento prometia a carta "quando o participante cobriu TODAS as
 *  atividades do evento", e a promessa não tinha implementação (item F1 da FASE 16).
 *
 *  Implementar exige responder três perguntas, e cada uma delas é uma armadilha:
 *
 *    1. QUAIS atividades contam? Só as que EXIGEM presença (`requiresAttendance`) e
 *       não foram canceladas. Atividade opcional fora do cálculo é o que faz o
 *       critério ser alcançável.
 *    2. QUANDO a carta sai? Quando o participante fecha a ÚLTIMA atividade. Se ele
 *       já cobriu tudo o que TERMINOU, mas ainda há atividade por vir, ele ainda
 *       pode comparecer — premiar ali seria premiar cedo e errado.
 *    3. E QUEM NÃO PRECISA DE PRESENÇA? Evento sem nenhuma atividade que exija
 *       presença não gera a conquista (não há "tudo" a cumprir).
 *
 *  Funções PURAS: recebem as atividades e as presenças já lidas e devolvem decisão.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Atividade como o domínio a enxerga para efeito de presença. */
export interface AttendanceActivitySample {
  activityId: string;
  title: string;
  /** Exige presença para concluir? Atividades opcionais não entram no "tudo". */
  requiresAttendance: boolean;
  status: string;
  /** Fim previsto — usado para saber se a atividade ainda está por vir. */
  endsAt: Date;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A JANELA DE CREDENCIAMENTO DA ATIVIDADE (FASE 31)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A atividade como o balcão precisa dela para decidir se aceita leitura AGORA.
 *
 * São os campos que já existiam na modelagem desde a FASE 3 (`checkInEnabled`,
 * `checkInOpensAt`, `checkInClosesAt`) e que **nenhum caminho consultava**: dava para
 * desligar o credenciamento de uma atividade e continuar credenciando nela.
 */
export interface AttendanceWindowSample {
  checkInEnabled: boolean;
  checkInOpensAt: Date | null;
  checkInClosesAt: Date | null;
  status?: string;
  title?: string;
}

export type AttendanceWindowDecision =
  | { ok: true }
  | {
      ok: false;
      code: 'CHECKIN_DISABLED' | 'WINDOW_NOT_OPEN' | 'WINDOW_CLOSED' | 'ACTIVITY_CANCELED';
      message: string;
    };

/**
 * A atividade aceita leitura de presença neste instante?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SÓ A JANELA DECLARADA RECUSA — O FIM DA ATIVIDADE NÃO RECUSA SOZINHA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Parece tentador encerrar a leitura no `endsAt`, mas isso quebraria o caso real do
 *  balcão: o monitor registra a lista de presença da oficina **depois** dela, com a
 *  sala já vazia, e às vezes no fim do dia. Quem decide fechar é a organização, com
 *  `checkInClosesAt` (ou o fechamento automático das presenças abertas, que é outro
 *  fato — o tempo, não a possibilidade de registrar).
 *
 *  Quem chega ANTES da abertura (ou depois do fechamento declarado) recebe uma
 *  recusa com o motivo: a fila para, e o monitor sabe a quem recorrer.
 */
export function canRecordAttendance(input: {
  activity: AttendanceWindowSample;
  now: Date;
}): AttendanceWindowDecision {
  const { activity, now } = input;

  if (activity.status === 'CANCELED') {
    return {
      ok: false,
      code: 'ACTIVITY_CANCELED',
      message: 'Esta atividade foi cancelada — não há presença a registrar.',
    };
  }

  if (!activity.checkInEnabled) {
    return {
      ok: false,
      code: 'CHECKIN_DISABLED',
      message: 'O credenciamento desta atividade está desligado.',
    };
  }

  if (activity.checkInOpensAt && now.getTime() < activity.checkInOpensAt.getTime()) {
    return {
      ok: false,
      code: 'WINDOW_NOT_OPEN',
      message: `O credenciamento desta atividade abre em ${formatWindowMoment(activity.checkInOpensAt)}.`,
    };
  }

  if (activity.checkInClosesAt && now.getTime() > activity.checkInClosesAt.getTime()) {
    return {
      ok: false,
      code: 'WINDOW_CLOSED',
      message: `O credenciamento desta atividade encerrou em ${formatWindowMoment(activity.checkInClosesAt)}.`,
    };
  }

  return { ok: true };
}

function formatWindowMoment(value: Date): string {
  return value.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  A SESSÃO: ENTRADA, SAÍDA E MINUTOS (FASE 31)
// ───────────────────────────────────────────────────────────────────────────────
/** Teto de uma sessão quando a atividade não declara fim (nem o evento, no caso da portaria). */
export const MAX_SESSION_MINUTES = 12 * 60;

/**
 * Minutos de uma sessão, com o teto de duas coisas: o fim da ATIVIDADE e o limite
 * absoluto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O FIM DA ATIVIDADE É UM TETO (defeito real, corrigido aqui)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A regra antiga era "minutos = agora − entrada". Isso premiava o esquecimento: a
 *  pessoa entrava na oficina de 60 min, ninguém registrava a saída, e ela saía com
 *  180 minutos na conta — que é a conta que PESA no sorteio (chance proporcional ao
 *  tempo, FASE 16), que compõe a carga do certificado (FASE 6) e que decide a carta
 *  de presença total (FASE 16). Ninguém fica mais tempo do que a atividade durou.
 */
export function sessionMinutes(input: {
  checkedInAt: Date;
  closedAt: Date;
  activityEndsAt?: Date | null;
  maxMinutes?: number;
}): number {
  const limit = Math.min(
    input.closedAt.getTime(),
    input.activityEndsAt ? input.activityEndsAt.getTime() : Number.POSITIVE_INFINITY,
  );

  const raw = Math.round((limit - input.checkedInAt.getTime()) / 60_000);

  return Math.max(0, Math.min(raw, input.maxMinutes ?? MAX_SESSION_MINUTES));
}

export interface SessionClose {
  closedAt: Date;
  minutes: number;
  autoClosed: boolean;
}

/**
 * A sessão deve ser fechada automaticamente, e com que números?
 *
 * `null` = ainda em andamento (a atividade não terminou). Quem nunca sai recebe a
 * saída no FIM DA ATIVIDADE — não na hora em que a varredura rodou, e não com o
 * tempo até ela: o número tem de ser o mesmo, toda vez que a conta for refeita.
 */
export function sessionCloseOf(input: {
  checkedInAt: Date;
  activityEndsAt: Date | null;
  now: Date;
}): SessionClose | null {
  if (!input.activityEndsAt) return null;
  if (input.now.getTime() <= input.activityEndsAt.getTime()) return null;

  return {
    closedAt: input.activityEndsAt,
    minutes: sessionMinutes({
      checkedInAt: input.checkedInAt,
      closedAt: input.activityEndsAt,
      activityEndsAt: input.activityEndsAt,
    }),
    autoClosed: true,
  };
}

/** Presença do participante em uma atividade. */
export interface AttendanceRecordSample {
  activityId: string;
  status: string;
  minutesAttended: number;
}

export interface FullAttendanceResult {
  /** A conquista está garantida? */
  complete: boolean;
  /** Atividades que exigem presença, ordenadas por início. */
  requiredCount: number;
  /** Quantas dessas o participante cumpriu. */
  coveredCount: number;
  /** Títulos das que faltaram (para a explicação na tela). */
  missingTitles: string[];
  /** Ainda há atividade por acontecer? Nesse caso não se premia agora. */
  pendingCount: number;
  reason: string | null;
}

/** A presença comprova participação na atividade? */
function countsAsPresent(record: AttendanceRecordSample): boolean {
  return record.status === 'PRESENT' || record.status === 'PARTIAL';
}

/**
 * O participante cobriu TODAS as atividades do evento que exigem presença?
 *
 * `now` é parâmetro (e não `new Date()` interno) para que o critério "ainda há
 * atividade por vir" seja testável sem depender do relógio da máquina.
 */
export function evaluateFullAttendance(input: {
  activities: readonly AttendanceActivitySample[];
  attendances: readonly AttendanceRecordSample[];
  /** Fuso da instituição — a comparação de "já terminou" é por instante, não por dia. */
  now: Date;
}): FullAttendanceResult {
  const required = input.activities
    .filter((activity) => activity.requiresAttendance)
    .filter((activity) => activity.status !== 'CANCELED')
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());

  if (required.length === 0) {
    return {
      complete: false,
      requiredCount: 0,
      coveredCount: 0,
      missingTitles: [],
      pendingCount: 0,
      reason: 'O evento não tem atividades que exijam presença.',
    };
  }

  const present = new Set(
    input.attendances.filter(countsAsPresent).map((attendance) => attendance.activityId),
  );

  const missing = required.filter((activity) => !present.has(activity.activityId));
  const pending = required.filter((activity) => activity.endsAt.getTime() > input.now.getTime());
  const coveredCount = required.length - missing.length;

  if (pending.length > 0) {
    return {
      complete: false,
      requiredCount: required.length,
      coveredCount,
      missingTitles: missing.map((activity) => activity.title),
      pendingCount: pending.length,
      reason: `Ainda há ${pending.length} atividade(s) por acontecer.`,
    };
  }

  if (missing.length > 0) {
    return {
      complete: false,
      requiredCount: required.length,
      coveredCount,
      missingTitles: missing.map((activity) => activity.title),
      pendingCount: 0,
      reason: `Faltou presença em ${missing.length} atividade(s).`,
    };
  }

  return {
    complete: true,
    requiredCount: required.length,
    coveredCount,
    missingTitles: [],
    pendingCount: 0,
    reason: null,
  };
}

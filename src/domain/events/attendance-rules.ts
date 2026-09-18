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

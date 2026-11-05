/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A PRESENÇA SOMA POR PESSOA E ATIVIDADE (FASE 86 · dívida E92)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE MÓDULO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `attendances` guarda UMA LINHA POR VISITA (ADR-149): quem entra e sai da mesma
 *  atividade duas vezes tem duas linhas. `computeWorkload` avalia cada linha como
 *  uma entrada independente — é a assinatura dele, e ela não muda aqui. O que
 *  mudava era o que se entregava a ele: duas visitas de 30 min na mesma atividade
 *  de 60 viravam duas entradas de 30, cada uma abaixo dos 45 exigidos (75 % da
 *  carga), e NENHUMA contava. A pessoa esteve a atividade inteira e ficou sem o
 *  documento; o descarte ainda aparecia duas vezes.
 *
 *  A correção é esta função: agrupar por `(userId, activityId)` e somar os minutos
 *  ANTES de montar os fatos. `computeWorkload` continua puro, recebendo uma linha
 *  por par — a regra dos 75 % passa a ser sobre a PERMANÊNCIA na atividade, não
 *  sobre cada passagem pela porta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TETO É A JANELA REAL DA ATIVIDADE (ADR-150)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Somar visitas abre uma porta que a linha única não abria: dado inconsistente
 *  (check-outs sobrepostos, sessão fechada à mão depois do fim) passaria a somar
 *  minutos que não existiram na sala. Ninguém permanece na atividade mais tempo do
 *  que ela durou, e o documento declara a carga DECLARADA — então a soma é limitada
 *  por `endsAt − startsAt` e por `workloadMinutes`, o menor dos dois. O teto é
 *  aplicado DEPOIS da soma, porque é a soma que pode ultrapassar a janela.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LINHA DO EVENTO NÃO SE MISTURA COM A DE ATIVIDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A portaria grava com `activityId` nulo (ADR-149), e essa linha é o FATO do
 *  evento — não de uma atividade. Somá-la a uma atividade daria à pessoa minutos
 *  que ela não passou naquela sala, e o certificado de PARTICIPAÇÃO continua
 *  decidido pelo credenciamento (`eventCheckedIn`, em `certificate-rules.ts`). Por
 *  isso `null` é uma CHAVE própria: as linhas do evento somam entre si, jamais com
 *  as de atividade.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { AttendanceRecord } from './certificate-rules';

/**
 * Linha de presença como os dois caminhos do serviço a leem.
 *
 * Só `checkedOutAt` decide se o tempo foi MEDIDO: sem saída registrada, a linha
 * contribui com zero — assumir presença completa seria emitir documento por
 * comparecimento presumido (a mesma regra de antes da agregação).
 */
export interface AttendanceAggregateRow {
  userId: string;
  activityId: string | null;
  minutesAttended: number | null;
  checkedOutAt: Date | null;
  activity: {
    title: string | null;
    type: string | null;
    workloadMinutes: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
  } | null;
}

/** Uma linha por pessoa × atividade, com o total já limitado ao teto. */
export interface AggregatedAttendance extends AttendanceRecord {
  userId: string;
}

/** Chave do agrupamento. `\u0000` não aparece em UUID nem em slug. */
const KEY_SEPARATOR = '\u0000';

interface Group {
  userId: string;
  activityId: string | null;
  activity: AttendanceAggregateRow['activity'];
  minutesAttended: number;
}

/**
 * Agrupa as linhas por `(userId, activityId)` e soma os minutos medidos.
 *
 * Determinístico: a saída é ordenada por `userId` e `activityId`, então a ordem em
 * que o banco devolveu as linhas não muda o resultado — duas leituras do mesmo
 * evento têm de produzir os mesmos fatos, senão a simulação e a emissão poderiam
 * discordar sem que nada mudasse no dado.
 */
export function aggregateAttendanceByActivity(
  rows: readonly AttendanceAggregateRow[],
): AggregatedAttendance[] {
  const groups = new Map<string, Group>();

  for (const row of rows) {
    const key = `${row.userId}${KEY_SEPARATOR}${row.activityId ?? ''}`;
    const measured = measuredMinutesOf(row);
    const current = groups.get(key);

    if (current) {
      current.minutesAttended += measured;
      // A relação pode chegar nula numa linha e carregada na outra (o dado é o
      // mesmo); guardar a carregada evita que a ORDEM decida título e teto.
      current.activity = current.activity ?? row.activity;
      continue;
    }

    groups.set(key, {
      userId: row.userId,
      activityId: row.activityId,
      activity: row.activity,
      minutesAttended: measured,
    });
  }

  return [...groups.values()]
    .map((group) => ({
      userId: group.userId,
      activityId: group.activityId,
      activityTitle: group.activity?.title ?? null,
      activityType: group.activity?.type ?? null,
      workloadMinutes: workloadOf(group.activity),
      minutesAttended: capMinutes(group.minutesAttended, ceilingOf(group)),
    }))
    .sort(compareAttendance);
}

/**
 * Minutos efetivamente medidos em UMA linha.
 *
 * A saída ausente zera a linha em vez de "não sei": o certificado atesta tempo
 * cumprido, e tempo não medido não é tempo cumprido.
 */
function measuredMinutesOf(row: AttendanceAggregateRow): number {
  if (!row.checkedOutAt) return 0;
  return Math.max(0, Math.round(row.minutesAttended ?? 0));
}

function workloadOf(activity: AttendanceAggregateRow['activity']): number {
  return Math.max(0, Math.round(activity?.workloadMinutes ?? 0));
}

/**
 * Teto da soma: a menor entre a carga declarada e a janela real da atividade.
 *
 * `null` = não há teto a aplicar. Uma janela de duração zero (ou negativa) é
 * tratada como AUSENTE, e não como "zero minutos": ela é dado de agenda quebrado,
 * e usá-la como teto zeraria a presença — recusando o documento de todo mundo em
 * vez de proteger contra minutos inventados.
 */
function ceilingOf(group: Group): number | null {
  const workload = workloadOf(group.activity);
  const window = windowMinutesOf(group.activity);
  const ceilings = [workload > 0 ? workload : null, window].filter(
    (value): value is number => value !== null,
  );

  return ceilings.length === 0 ? null : Math.min(...ceilings);
}

function windowMinutesOf(activity: AttendanceAggregateRow['activity']): number | null {
  if (!activity?.startsAt || !activity.endsAt) return null;

  const minutes = Math.round(
    (activity.endsAt.getTime() - activity.startsAt.getTime()) / 60_000,
  );

  return minutes > 0 ? minutes : null;
}

function capMinutes(minutes: number, ceiling: number | null): number {
  const safe = Math.max(0, Math.round(minutes));
  return ceiling === null ? safe : Math.min(safe, ceiling);
}

/**
 * Ordem estável por código de caractere — não `localeCompare`.
 *
 * O desempate não é apresentação: é o que garante que a mesma entrada produza a
 * mesma saída em qualquer máquina, sem depender de ICU/locale do processo.
 */
function compareAttendance(a: AggregatedAttendance, b: AggregatedAttendance): number {
  if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;

  const left = a.activityId ?? '';
  const right = b.activityId ?? '';
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

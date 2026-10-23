/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Exportação de presenças por atividade (FASE 77 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ARQUIVO É LONGO (UMA LINHA POR PRESENÇA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O formato "curto" — uma coluna por atividade — é o que a planilha pede à
 *  primeira vista e o que NÃO sobrevive ao dado real:
 *
 *   • o teto do arquivo é de 5.000 linhas, e a presença é mais numerosa que a
 *     pessoa: 800 inscritos × 4 atividades × 2 visitas já passa de 6.000;
 *   • a sessão (entrada/saída) é a UNIDADE do fato (ADR-149): quem entrou duas
 *     vezes na mesma atividade tem duas janelas, e uma coluna por atividade só
 *     caberia a soma — que é justamente a informação que se perde;
 *   • com 20 atividades, a planilha de 800 pessoas teria 20 colunas de número e
 *     nenhuma de horário.
 *
 *  Uma linha por presença responde "quem esteve em quê, quando, por quanto tempo",
 *  que é a pergunta da lista de presença e a que a coordenação leva para o
 *  relatório. O teto corta por LINHA, e o pedido marca `truncated`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS AUSÊNCIAS QUE O ARQUIVO NÃO ESCONDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. `activityId` nulo é a CHEGADA ao evento (portaria), e não uma atividade: a
 *     linha existe e diz "(sem atividade)". Sumir com ela faria o arquivo mostrar
 *     menos presenças do que o evento teve.
 *  2. `checkedOutAt` nulo é a sessão AINDA ABERTA. A coluna diz "(em aberto)" em
 *     vez de um horário inventado — e os minutos ficam VAZIOS, porque `null` não é
 *     zero (a mesma régua de `attendanceRate`).
 *  3. fuso: os instantes saem no fuso do EVENTO, que é onde a sessão aconteceu e
 *     onde o organizador lê a lista de presença.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { instantToZonedWallTime } from '@/domain/events/scheduling-rules';
import { CSV_MAX_ROWS, type CsvValue } from '@/domain/participants/participant-rules';
/** Ordem das colunas — CONTRATO (a marca d'água é acrescentada no fim, na F49). */
export const ATTENDANCE_CSV_HEADER = Object.freeze([
  'Atividade',
  'Pessoa',
  'Entrada',
  'Saída',
  'Minutos',
]);

/** O que a linha diz quando o check-in foi na PORTARIA (chegada ao evento). */
export const ATTENDANCE_NO_ACTIVITY_LABEL = '(sem atividade)';

/** O que a linha diz quando a sessão não foi encerrada (sem check-out). */
export const ATTENDANCE_OPEN_SESSION_LABEL = '(em aberto)';

export interface AttendanceExportInput {
  /** Título da atividade; `null` = chegada ao evento, sem atividade. */
  activityTitle: string | null;
  personName: string;
  checkedInAt: Date;
  checkedOutAt: Date | null;
  /** `null` = a sessão não foi fechada: o minuto ainda não foi apurado. */
  minutes: number | null;
  /** Fuso do EVENTO (o da sessão), não o do processo. */
  timezone: string;
}

/** "2026-09-02T19:30" → "02/09/2026 19:30" — a mesma leitura das outras exportações. */
function zonedMoment(date: Date, timezone: string): string {
  const wall = instantToZonedWallTime(date, timezone);
  const [day, time] = wall.split('T');

  return `${(day ?? '').split('-').reverse().join('/')} ${time ?? ''}`;
}

/**
 * UMA linha do arquivo.
 *
 * A ordem das células acompanha `ATTENDANCE_CSV_HEADER`; o escape (`csvCell`) NÃO
 * acontece aqui porque `buildWatermarkedCsv` aplica a TODAS as células — e o nome
 * de uma pessoa é texto de fora, inclusive para a regra de fórmula.
 */
export function attendanceExportRow(input: AttendanceExportInput): CsvValue[] {
  return [
    input.activityTitle ?? ATTENDANCE_NO_ACTIVITY_LABEL,
    input.personName,
    zonedMoment(input.checkedInAt, input.timezone),
    input.checkedOutAt ? zonedMoment(input.checkedOutAt, input.timezone) : ATTENDANCE_OPEN_SESSION_LABEL,
    input.minutes === null ? null : input.minutes,
  ];
}

/**
 * O teto do arquivo, resolvido no domínio.
 *
 * `rowCount` é o que o PEDIDO grava e o que a tela mostra ("N linha(s)"); o teto é
 * o mesmo de toda exportação (`CSV_MAX_ROWS`), e `truncated` é a resposta honesta
 * de que o arquivo não é o conjunto inteiro.
 */
export function resolveAttendanceExportSize(total: number): { rowCount: number; truncated: boolean } {
  const safeTotal = Math.max(0, Math.trunc(total));

  return {
    rowCount: Math.min(safeTotal, CSV_MAX_ROWS),
    truncated: safeTotal > CSV_MAX_ROWS,
  };
}

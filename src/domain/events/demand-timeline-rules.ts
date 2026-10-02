/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — As outras duas vistas das demandas (FASE 57)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É DOMÍNIO, E NÃO COMPONENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um Gantt e um calendário parecem desenho: barra aqui, célula ali. Só que as duas
 *  perguntas que eles respondem são de REGRA, não de pixel:
 *
 *    • "quais demandas cabem neste período?" — a janela, e o que fica de fora dela;
 *    • "esta barra começa em que coluna?" — a conta entre o dia do prazo e o dia do
 *      início, no CALENDÁRIO DO EVENTO, não no fuso do navegador de quem olha.
 *
 *  É a mesma régua que a FASE 38 já usa para dizer "atrasada" e "vence hoje"
 *  (`demandSituation`), e é por isso que ela vive aqui: com duas implementações, o
 *  Kanban diria que a demanda vence hoje e o calendário a desenharia em outro dia.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS DECISÕES QUE DEFINEM O DESENHO (FASE 57)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. **A barra sem início declarado começa na CRIAÇÃO, e isso aparece.** Inventar um
 *     começo e desenhá-lo como se fosse declarado faria o gráfico mentir sobre o
 *     planejamento; a barra estimada é marcada como estimada.
 *  2. **Demanda sem prazo NÃO entra no eixo: ela vai para "sem data".** Um Gantt sem
 *     data é uma faixa de rodapé, e a faixa diz quantas são — o que a tela esconde,
 *     ela anuncia.
 *  3. **A janela é EXPLÍCITA e o que fica fora é CONTADO.** Nada some em silêncio: o
 *     Gantt devolve `outside` (quantas demandas têm datas fora do período) e o
 *     calendário, `outside` (quantas vencem fora do mês).
 */
import {
  DEMAND_SITUATION_LABELS,
  addDaysToDayKey,
  demandSituation,
  localDayKey,
  type DemandSituation,
} from '@/domain/events/demand-rules';

/** Uma demanda como as duas vistas precisam vê-la — nada de coluna, nada de posição. */
export interface TimelineDemand {
  id: string;
  title: string;
  priority: string;
  priorityLabel: string;
  startAt: Date | null;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  teamName: string | null;
  assignees: readonly { id: string; name: string }[];
  situation: DemandSituation;
  situationLabel: string;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A JANELA DO GANTT
// ───────────────────────────────────────────────────────────────────────────────

/** Quantos dias o eixo mostra por padrão (duas semanas de trabalho, mais o fim de semana). */
export const GANTT_WINDOW_DAYS = 21;

/** Teto do período: além disto a barra fica ilegível e o eixo, inútil. */
export const GANTT_WINDOW_MAX_DAYS = 120;

export interface TimelineWindow {
  /** Primeiro dia do eixo, `AAAA-MM-DD` no fuso do evento. */
  fromKey: string;
  /** Último dia do eixo (inclusive). */
  toKey: string;
  /** Todos os dias do eixo, em ordem. */
  days: readonly string[];
}

/**
 * O eixo de dias, a partir de uma âncora.
 *
 * A âncora é uma CHAVE DE DIA (`AAAA-MM-DD`) e não um instante: quem navega no Gantt
 * anda de período em período pelo endereço, e o endereço carrega o dia — não o
 * carimbo de tempo de quem clicou.
 */
export function timelineWindow(input: {
  anchorKey: string;
  days?: number;
}): TimelineWindow {
  const span = Math.min(Math.max(1, input.days ?? GANTT_WINDOW_DAYS), GANTT_WINDOW_MAX_DAYS);
  const days: string[] = [];

  for (let index = 0; index < span; index += 1) {
    days.push(addDaysToDayKey(input.anchorKey, index));
  }

  return {
    fromKey: days[0] ?? input.anchorKey,
    toKey: days[days.length - 1] ?? input.anchorKey,
    days,
  };
}

/** O dia em que a barra começa: o início declarado ou, sem ele, o dia da criação. */
export function barStartKey(demand: TimelineDemand, timeZone: string): string {
  return localDayKey(demand.startAt ?? demand.createdAt, timeZone);
}

/** `true` quando a barra começa na criação — a tela marca esse começo como estimado. */
export function hasEstimatedStart(demand: TimelineDemand): boolean {
  return demand.startAt === null;
}

export type GanttRowKind = 'BAR' | 'MILESTONE';

export interface GanttRow {
  id: string;
  title: string;
  /** Coluna inicial no eixo (0 = primeiro dia). */
  startColumn: number;
  /** Quantas colunas a barra ocupa (mínimo 1: o dia do prazo de quem não tem início). */
  spanColumns: number;
  startKey: string;
  endKey: string;
  /** Início estimado (a demanda não declarou `startAt`). */
  estimatedStart: boolean;
  /** Sem `dueAt`: a barra é um MARCO no dia inicial, e não um período. */
  kind: GanttRowKind;
  situation: DemandSituation;
  situationLabel: string;
  priority: string;
  priorityLabel: string;
  teamName: string | null;
  assigneeNames: readonly string[];
  /** Começa antes do eixo: a barra é cortada à esquerda, e a tela diz isso. */
  clippedStart: boolean;
  /** Termina depois do eixo: cortada à direita. */
  clippedEnd: boolean;
}

export interface GanttLayout {
  window: TimelineWindow;
  rows: readonly GanttRow[];
  /** Demandas com datas, mas fora do período — contadas, nunca escondidas. */
  outside: number;
  /** Demandas sem `dueAt`: ficam na faixa "sem data", fora do eixo. */
  undated: readonly TimelineDemand[];
}

function indexOfDay(window: TimelineWindow, dayKey: string): number {
  return window.days.indexOf(dayKey);
}

/**
 * O desenho do Gantt: uma linha por demanda que TOCA o período.
 *
 * "Toca" é o critério — e não "começa dentro": uma demanda que começou antes do eixo e
 * vence dentro dele precisa aparecer, senão o gráfico esconderia justamente o trabalho
 * longo, que é o que mais interessa ver.
 */
export function ganttLayout(input: {
  demands: readonly TimelineDemand[];
  window: TimelineWindow;
  timeZone: string;
}): GanttLayout {
  const rows: GanttRow[] = [];
  let outside = 0;
  const undated: TimelineDemand[] = [];

  for (const demand of input.demands) {
    if (!demand.dueAt) {
      undated.push(demand);
      continue;
    }

    const startKey = barStartKey(demand, input.timeZone);
    const endKey = localDayKey(demand.dueAt, input.timeZone);

    const startsInside = indexOfDay(input.window, startKey) >= 0;
    const endsInside = indexOfDay(input.window, endKey) >= 0;
    const spansWindow =
      startKey < input.window.fromKey && endKey > input.window.toKey;

    if (!startsInside && !endsInside && !spansWindow) {
      outside += 1;
      continue;
    }

    const clippedStart = startKey < input.window.fromKey;
    const clippedEnd = endKey > input.window.toKey;

    const startColumn = clippedStart ? 0 : indexOfDay(input.window, startKey);
    const endColumn = clippedEnd
      ? input.window.days.length - 1
      : indexOfDay(input.window, endKey);

    const rawSpan = endColumn - startColumn + 1;

    rows.push({
      id: demand.id,
      title: demand.title,
      startColumn,
      /** O prazo nunca fica antes do início: data trocada vira UM dia, não barra negativa. */
      spanColumns: Math.max(1, rawSpan),
      startKey,
      endKey,
      estimatedStart: hasEstimatedStart(demand),
      kind: hasEstimatedStart(demand) && startKey === endKey ? 'MILESTONE' : 'BAR',
      situation: demand.situation,
      situationLabel: DEMAND_SITUATION_LABELS[demand.situation],
      priority: demand.priority,
      priorityLabel: demand.priorityLabel,
      teamName: demand.teamName,
      assigneeNames: demand.assignees.map((assignee) => assignee.name),
      clippedStart,
      clippedEnd,
    });
  }

  /**
   * Ordem do gráfico: primeiro quem começa antes (o trabalho que atravessa o período),
   * e o desempate pelo prazo. Sem ordem estável, a mesma tela sairia diferente a cada
   * carregamento — e comparar dois Gantts deixaria de fazer sentido.
   */
  rows.sort((left, right) => {
    if (left.startColumn !== right.startColumn) return left.startColumn - right.startColumn;
    return left.endKey.localeCompare(right.endKey);
  });

  return { window: input.window, rows, outside, undated };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O CALENDÁRIO DO MÊS
// ───────────────────────────────────────────────────────────────────────────────

/** `AAAA-MM-DD` → `AAAA-MM`. */
export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/** O mês anterior/seguinte de uma chave `AAAA-MM`, sem `Date` e sem fuso. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  const zeroBased = (year * 12 + (month - 1)) + delta;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12 + 12) % 12;

  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth + 1).padStart(2, '0')}`;
}

/** O primeiro dia do mês — a âncora da grade. */
export function firstDayOfMonth(monthKey: string): string {
  return `${monthKey}-01`;
}

/**
 * Quantos dias tem o mês, sem `Date`.
 *
 * A conta é a do calendário GREGORIANO (inclusive a regra dos séculos), e não a de um
 * `Date` que o runtime ajustaria para o fuso do servidor: a grade precisa do mesmo
 * número em qualquer máquina.
 */
export function daysInMonth(monthKey: string): number {
  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 30;
}

/**
 * Em que dia da semana o mês começa (0 = domingo).
 *
 * Algoritmo de Sakamoto: puro, determinístico e independente do fuso do processo — a
 * grade do calendário não pode mudar de lugar porque o servidor está em UTC.
 */
export function weekdayOf(dayKey: string): number {
  const [yearText, monthText, dayText] = dayKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjustedYear = month < 3 ? year - 1 : year;

  return (
    (adjustedYear +
      Math.floor(adjustedYear / 4) -
      Math.floor(adjustedYear / 100) +
      Math.floor(adjustedYear / 400) +
      (offsets[month - 1] ?? 0) +
      day) %
    7
  );
}

export interface CalendarCell {
  /** `AAAA-MM-DD`. */
  dayKey: string;
  /** Dia do mês (1..31). */
  dayOfMonth: number;
  /** `false` nos dias que a grade mostra para completar a semana. */
  inMonth: boolean;
  isToday: boolean;
  demands: readonly TimelineDemand[];
}

export interface CalendarMonth {
  monthKey: string;
  /** "outubro de 2026" — o rótulo pronto, para a tela não formatar por conta própria. */
  monthLabel: string;
  prevMonthKey: string;
  nextMonthKey: string;
  weeks: readonly (readonly CalendarCell[])[];
  /** Demandas que vencem FORA deste mês — contadas, nunca escondidas. */
  outside: number;
  /** Sem prazo: não há dia para desenhar. */
  undated: readonly TimelineDemand[];
}

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export function monthLabel(monthKey: string): string {
  const [yearText, monthText] = monthKey.split('-');
  const name = MONTH_NAMES[Number(monthText) - 1] ?? '';

  return `${name} de ${yearText}`;
}

/**
 * A grade do mês, com as demandas no dia do PRAZO.
 *
 * A pessoa atrasada aparece no dia em que VENCEU, e não no dia de hoje: o calendário
 * conta a história do que era para ter acontecido, e é isso que permite olhar o mês
 * passado e entender o que ficou para trás. Quem quiser "o que está atrasado hoje" tem
 * o filtro de situação do quadro.
 *
 * Semana começa no DOMINGO (o calendário brasileiro), e as células fora do mês entram
 * para a grade fechar as semanas — marcadas como `inMonth: false`.
 */
export function calendarMonth(input: {
  monthKey: string;
  demands: readonly TimelineDemand[];
  timeZone: string;
  now: Date;
}): CalendarMonth {
  const total = daysInMonth(input.monthKey);
  const firstKey = firstDayOfMonth(input.monthKey);
  const leading = weekdayOf(firstKey);

  const byDay = new Map<string, TimelineDemand[]>();
  let outside = 0;
  const undated: TimelineDemand[] = [];

  for (const demand of input.demands) {
    if (!demand.dueAt) {
      undated.push(demand);
      continue;
    }

    const dayKey = localDayKey(demand.dueAt, input.timeZone);

    if (monthKeyOf(dayKey) !== input.monthKey) {
      outside += 1;
      continue;
    }

    const list = byDay.get(dayKey);
    if (list) list.push(demand);
    else byDay.set(dayKey, [demand]);
  }

  const todayKey = localDayKey(input.now, input.timeZone);
  const cells: CalendarCell[] = [];

  /** As células do mês anterior que completam a primeira semana. */
  for (let index = leading; index > 0; index -= 1) {
    const dayKey = addDaysToDayKey(firstKey, -index);
    cells.push({
      dayKey,
      dayOfMonth: Number(dayKey.slice(8)),
      inMonth: false,
      isToday: dayKey === todayKey,
      demands: byDay.get(dayKey) ?? [],
    });
  }

  for (let day = 1; day <= total; day += 1) {
    const dayKey = `${input.monthKey}-${String(day).padStart(2, '0')}`;
    cells.push({
      dayKey,
      dayOfMonth: day,
      inMonth: true,
      isToday: dayKey === todayKey,
      demands: byDay.get(dayKey) ?? [],
    });
  }

  /** E as do mês seguinte, até a última semana fechar. */
  while (cells.length % 7 !== 0) {
    const dayKey = addDaysToDayKey(cells[cells.length - 1]?.dayKey ?? firstKey, 1);
    cells.push({
      dayKey,
      dayOfMonth: Number(dayKey.slice(8)),
      inMonth: false,
      isToday: dayKey === todayKey,
      demands: byDay.get(dayKey) ?? [],
    });
  }

  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return {
    monthKey: input.monthKey,
    monthLabel: monthLabel(input.monthKey),
    prevMonthKey: shiftMonthKey(input.monthKey, -1),
    nextMonthKey: shiftMonthKey(input.monthKey, 1),
    weeks,
    outside,
    undated,
  };
}

/** A situação de cada demanda, calculada UMA vez e usada pelas duas vistas. */
export function withSituation(
  demand: Omit<TimelineDemand, 'situation' | 'situationLabel'>,
  now: Date,
  timeZone: string,
): TimelineDemand {
  const situation = demandSituation(demand, now, timeZone);

  return { ...demand, situation, situationLabel: DEMAND_SITUATION_LABELS[situation] };
}

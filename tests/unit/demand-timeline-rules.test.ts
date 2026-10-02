import { describe, expect, it } from 'vitest';

import {
  GANTT_WINDOW_DAYS,
  GANTT_WINDOW_MAX_DAYS,
  barStartKey,
  calendarMonth,
  daysInMonth,
  firstDayOfMonth,
  ganttLayout,
  hasEstimatedStart,
  monthKeyOf,
  monthLabel,
  shiftMonthKey,
  timelineWindow,
  weekdayOf,
  withSituation,
  type TimelineDemand,
} from '../../src/domain/events/demand-timeline-rules';
import {
  calendarMonthKey,
  ganttAnchorKey,
  isTimelineDayKey,
  isTimelineMonthKey,
  shiftedWindowAnchor,
  toTimelineDemands,
} from '../../src/lib/events/demand-timeline';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 57 — A RÉGUA DO GANTT E DO CALENDÁRIO (domínio puro, sem banco e sem tela)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Aqui mora o risco da fase: as duas vistas são DESENHO, e desenho errado não quebra
 *  teste de banco nenhum. O que estes casos prendem é a conta — a janela, a coluna em
 *  que a barra começa, o corte nas pontas, o dia em que a demanda aparece no calendário
 *  e a aritmética de meses (que é a única parte sem `Date`, para não depender do fuso
 *  do processo que roda o servidor).
 *
 *  Os fusos são os do evento (`America/Bahia`, UTC−3): o caso que importa é o do prazo
 *  gravado às 23:59 locais, que em UTC já é o DIA SEGUINTE.
 */
const BAHIA = 'America/Bahia';

function at(iso: string): Date {
  return new Date(iso);
}

/** Uma demanda completa — cada caso sobrescreve só o que está medindo. */
function demand(overrides: Partial<TimelineDemand> & { id: string }): TimelineDemand {
  return {
    title: `Demanda ${overrides.id}`,
    priority: 'NORMAL',
    priorityLabel: 'Normal',
    startAt: null,
    dueAt: null,
    completedAt: null,
    createdAt: at('2026-09-01T12:00:00.000Z'),
    teamName: null,
    assignees: [],
    situation: 'OPEN',
    situationLabel: 'Em aberto',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('a janela do eixo', () => {
  it('começa na âncora e tem o tamanho padrão, com o último dia inclusive', () => {
    const window = timelineWindow({ anchorKey: '2026-09-26' });

    expect(window.days).toHaveLength(GANTT_WINDOW_DAYS);
    expect(window.fromKey).toBe('2026-09-26');
    expect(window.toKey).toBe('2026-10-16');
    expect(window.days[0]).toBe('2026-09-26');
    expect(window.days[20]).toBe('2026-10-16');
  });

  it('atravessa a virada de mês e de ano sem pular dia', () => {
    const window = timelineWindow({ anchorKey: '2026-12-28', days: 6 });

    expect(window.days).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('o `days` pedido manda, e o teto corta o exagero', () => {
    expect(timelineWindow({ anchorKey: '2026-09-01', days: 5 }).days).toHaveLength(5);

    /** O teto existe para o eixo continuar legível: pedir mais não estica a janela. */
    const enorme = timelineWindow({ anchorKey: '2026-09-01', days: 500 });
    expect(enorme.days).toHaveLength(GANTT_WINDOW_MAX_DAYS);
    expect(enorme.toKey).toBe('2026-12-29');
  });

  it('tamanho zero (ou negativo) vira UM dia — nunca uma janela vazia', () => {
    expect(timelineWindow({ anchorKey: '2026-09-01', days: 0 }).days).toEqual(['2026-09-01']);
    expect(timelineWindow({ anchorKey: '2026-09-01', days: -7 }).days).toEqual(['2026-09-01']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o desenho do Gantt', () => {
  const window = timelineWindow({ anchorKey: '2026-09-01', days: 10 });

  it('a barra começa no início declarado e termina no dia do prazo', () => {
    const layout = ganttLayout({
      demands: [
        demand({
          id: 'a',
          startAt: at('2026-09-03T12:00:00.000Z'),
          dueAt: at('2026-09-05T12:00:00.000Z'),
        }),
      ],
      window,
      timeZone: BAHIA,
    });

    const row = layout.rows[0]!;

    expect(row.startColumn).toBe(2);
    expect(row.spanColumns).toBe(3);
    expect(row.startKey).toBe('2026-09-03');
    expect(row.endKey).toBe('2026-09-05');
    expect(row.estimatedStart).toBe(false);
    expect(row.kind).toBe('BAR');
    expect(row.clippedStart).toBe(false);
    expect(row.clippedEnd).toBe(false);
    expect(layout.outside).toBe(0);
    expect(layout.undated).toEqual([]);
  });

  it('sem `startAt` a barra começa na CRIAÇÃO, e isso é marcado como estimado', () => {
    const semInicio = demand({
      id: 'b',
      createdAt: at('2026-09-02T12:00:00.000Z'),
      dueAt: at('2026-09-06T12:00:00.000Z'),
    });

    expect(hasEstimatedStart(semInicio)).toBe(true);
    expect(barStartKey(semInicio, BAHIA)).toBe('2026-09-02');

    const layout = ganttLayout({ demands: [semInicio], window, timeZone: BAHIA });
    const row = layout.rows[0]!;

    expect(row.estimatedStart).toBe(true);
    expect(row.startColumn).toBe(1);
    expect(row.spanColumns).toBe(5);
    expect(row.kind).toBe('BAR');
  });

  it('início estimado E mesmo dia é MARCO: a barra vale um dia, não um período', () => {
    const marco = demand({
      id: 'c',
      createdAt: at('2026-09-04T23:59:00.000Z'),
      dueAt: at('2026-09-04T12:00:00.000Z'),
    });

    const layout = ganttLayout({ demands: [marco], window, timeZone: BAHIA });
    const row = layout.rows[0]!;

    expect(row.startKey).toBe('2026-09-04');
    expect(row.endKey).toBe('2026-09-04');
    expect(row.kind).toBe('MILESTONE');
    expect(row.spanColumns).toBe(1);
  });

  it('o mesmo dia com início DECLARADO continua sendo barra de um dia', () => {
    const mesmoDia = demand({
      id: 'd',
      startAt: at('2026-09-04T08:00:00.000Z'),
      dueAt: at('2026-09-04T20:00:00.000Z'),
    });

    const layout = ganttLayout({ demands: [mesmoDia], window, timeZone: BAHIA });

    expect(layout.rows[0]!.kind).toBe('BAR');
    expect(layout.rows[0]!.spanColumns).toBe(1);
  });

  it('a barra é cortada nas DUAS pontas, e a tela é avisada disso', () => {
    const longa = demand({
      id: 'e',
      startAt: at('2026-08-20T12:00:00.000Z'),
      dueAt: at('2026-09-20T12:00:00.000Z'),
    });

    const layout = ganttLayout({ demands: [longa], window, timeZone: BAHIA });
    const row = layout.rows[0]!;

    expect(row.clippedStart).toBe(true);
    expect(row.clippedEnd).toBe(true);
    expect(row.startColumn).toBe(0);
    /** O último dia do eixo é a coluna 9, e a barra fecha ali. */
    expect(row.startColumn + row.spanColumns).toBe(window.days.length);
    /** As chaves continuam sendo as REAIS: é o que o rótulo da barra mostra. */
    expect(row.startKey).toBe('2026-08-20');
    expect(row.endKey).toBe('2026-09-20');
  });

  it('começar antes do eixo e vencer dentro dele é DENTRO (o trabalho longo aparece)', () => {
    const atravessa = demand({
      id: 'f',
      startAt: at('2026-08-20T12:00:00.000Z'),
      dueAt: at('2026-09-03T12:00:00.000Z'),
    });

    const layout = ganttLayout({ demands: [atravessa], window, timeZone: BAHIA });
    const row = layout.rows[0]!;

    expect(layout.outside).toBe(0);
    expect(row.clippedStart).toBe(true);
    expect(row.clippedEnd).toBe(false);
    expect(row.startColumn).toBe(0);
    expect(row.spanColumns).toBe(3);
  });

  it('prazo ANTES do início vira UM dia, e não barra negativa', () => {
    const trocada = demand({
      id: 'g',
      startAt: at('2026-09-06T12:00:00.000Z'),
      dueAt: at('2026-09-03T12:00:00.000Z'),
    });

    const layout = ganttLayout({ demands: [trocada], window, timeZone: BAHIA });
    const row = layout.rows[0]!;

    expect(row.startColumn).toBe(5);
    expect(row.spanColumns).toBe(1);
  });

  it('o que NÃO toca o período é contado em `outside`, e não some', () => {
    const layout = ganttLayout({
      demands: [
        demand({ id: 'dentro', dueAt: at('2026-09-05T12:00:00.000Z') }),
        demand({
          id: 'depois',
          startAt: at('2026-10-01T12:00:00.000Z'),
          dueAt: at('2026-11-01T12:00:00.000Z'),
        }),
        demand({ id: 'antes', startAt: at('2026-07-01T12:00:00.000Z'), dueAt: at('2026-07-10T12:00:00.000Z') }),
      ],
      window,
      timeZone: BAHIA,
    });

    expect(layout.rows.map((row) => row.id)).toEqual(['dentro']);
    expect(layout.outside).toBe(2);
  });

  it('sem prazo, a demanda vai para `undated` — e não entra no eixo', () => {
    const layout = ganttLayout({
      demands: [
        demand({ id: 'com-prazo', dueAt: at('2026-09-05T12:00:00.000Z') }),
        demand({ id: 'sem-prazo' }),
      ],
      window,
      timeZone: BAHIA,
    });

    expect(layout.rows.map((row) => row.id)).toEqual(['com-prazo']);
    expect(layout.undated.map((item) => item.id)).toEqual(['sem-prazo']);
    expect(layout.outside).toBe(0);
  });

  it('a ordem é por coluna inicial e, no empate, pelo prazo — estável e determinística', () => {
    const layout = ganttLayout({
      demands: [
        /** Mesma coluna inicial e mesmo prazo: a ordem de entrada é preservada. */
        demand({ id: 'primeira', startAt: at('2026-09-03T12:00:00.000Z'), dueAt: at('2026-09-08T12:00:00.000Z') }),
        demand({ id: 'segunda', startAt: at('2026-09-03T12:00:00.000Z'), dueAt: at('2026-09-08T12:00:00.000Z') }),
        demand({ id: 'terceira', startAt: at('2026-09-03T12:00:00.000Z'), dueAt: at('2026-09-05T12:00:00.000Z') }),
        demand({ id: 'depois', startAt: at('2026-09-07T12:00:00.000Z'), dueAt: at('2026-09-09T12:00:00.000Z') }),
      ],
      window,
      timeZone: BAHIA,
    });

    expect(layout.rows.map((row) => row.id)).toEqual(['terceira', 'primeira', 'segunda', 'depois']);
  });

  it('o prazo das 23:59 do evento é o dia LOCAL — em UTC já seria o seguinte', () => {
    /** 2026-09-05T23:59 em Bahia (UTC−3) = 2026-09-06T02:59Z. */
    const layout = ganttLayout({
      demands: [demand({ id: 'noite', dueAt: at('2026-09-06T02:59:00.000Z') })],
      window,
      timeZone: BAHIA,
    });

    expect(layout.rows[0]!.endKey).toBe('2026-09-05');
  });

  it('a linha carrega o que a tela mostra: título, situação, time e pessoas', () => {
    const layout = ganttLayout({
      demands: [
        demand({
          id: 'rica',
          title: 'Montar os crachás',
          priority: 'URGENT',
          priorityLabel: 'Urgente',
          teamName: 'Logística',
          assignees: [{ id: 'u1', name: 'Ana' }],
          situation: 'OVERDUE',
          dueAt: at('2026-09-05T12:00:00.000Z'),
        }),
      ],
      window,
      timeZone: BAHIA,
    });

    const row = layout.rows[0]!;

    expect(row.assigneeNames).toEqual(['Ana']);
    expect(row.teamName).toBe('Logística');
    expect(row.priorityLabel).toBe('Urgente');
    /** O rótulo é derivado da SITUAÇÃO, e não copiado do que veio. */
    expect(row.situationLabel).toBe('Atrasada');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o calendário do mês', () => {
  /** Setembro de 2026 começa numa terça (o dia 1º cai na coluna 2, com domingo = 0). */
  const SETEMBRO = '2026-09';

  it('as semanas têm SEMPRE sete células, e as de fora do mês vêm marcadas', () => {
    const month = calendarMonth({
      monthKey: SETEMBRO,
      demands: [],
      timeZone: BAHIA,
      now: at('2026-09-10T12:00:00.000Z'),
    });

    for (const week of month.weeks) {
      expect(week).toHaveLength(7);
    }

    /** 1º de setembro de 2026 é terça: a grade abre com domingo e segunda de agosto. */
    const primeira = month.weeks[0]!;
    expect(primeira[0]!.dayKey).toBe('2026-08-30');
    expect(primeira[0]!.inMonth).toBe(false);
    expect(primeira[2]!.dayKey).toBe('2026-09-01');
    expect(primeira[2]!.inMonth).toBe(true);

    /** 30 dias em setembro, e a última semana fecha com os dias de outubro. */
    expect(month.weeks.flat().filter((cell) => cell.inMonth)).toHaveLength(30);
    expect(month.weeks.flat().at(-1)!.dayKey).toBe('2026-10-03');
    expect(month.weeks.flat().at(-1)!.inMonth).toBe(false);
  });

  it('a demanda aparece no dia do PRAZO, com o dia local do evento', () => {
    const month = calendarMonth({
      monthKey: SETEMBRO,
      /** 23:59 de 15/09 em Bahia = 02:59 de 16/09 em UTC. */
      demands: [demand({ id: 'prazo', dueAt: at('2026-09-16T02:59:00.000Z') })],
      timeZone: BAHIA,
      now: at('2026-09-10T12:00:00.000Z'),
    });

    const dia15 = month.weeks.flat().find((cell) => cell.dayKey === '2026-09-15')!;
    const dia16 = month.weeks.flat().find((cell) => cell.dayKey === '2026-09-16')!;

    expect(dia15.demands.map((item) => item.id)).toEqual(['prazo']);
    expect(dia16.demands).toEqual([]);
    expect(month.outside).toBe(0);
  });

  it('a ATRASADA aparece no dia em que venceu — o calendário conta o que era para ter acontecido', () => {
    const month = calendarMonth({
      monthKey: SETEMBRO,
      demands: [
        demand({
          id: 'atrasada',
          dueAt: at('2026-09-02T23:59:00.000Z'),
          situation: 'OVERDUE',
          situationLabel: 'Atrasada',
        }),
      ],
      timeZone: BAHIA,
      now: at('2026-09-20T12:00:00.000Z'),
    });

    const dia2 = month.weeks.flat().find((cell) => cell.dayKey === '2026-09-02')!;

    expect(dia2.demands.map((item) => item.id)).toEqual(['atrasada']);
    expect(dia2.demands[0]!.situationLabel).toBe('Atrasada');

    /** E o dia de HOJE não recebeu a demanda por ela estar atrasada. */
    const hoje = month.weeks.flat().find((cell) => cell.dayKey === '2026-09-20')!;
    expect(hoje.demands).toEqual([]);
  });

  it('a CONCLUÍDA continua no dia do prazo, com a situação que a marca', () => {
    const month = calendarMonth({
      monthKey: SETEMBRO,
      demands: [
        demand({
          id: 'feita',
          dueAt: at('2026-09-08T12:00:00.000Z'),
          completedAt: at('2026-09-07T12:00:00.000Z'),
          situation: 'DONE',
          situationLabel: 'Concluída',
        }),
      ],
      timeZone: BAHIA,
      now: at('2026-09-20T12:00:00.000Z'),
    });

    const dia8 = month.weeks.flat().find((cell) => cell.dayKey === '2026-09-08')!;
    expect(dia8.demands[0]!.situation).toBe('DONE');
  });

  it('quem vence em OUTRO mês é contado em `outside`, e quem não tem prazo vai para `undated`', () => {
    const month = calendarMonth({
      monthKey: SETEMBRO,
      demands: [
        demand({ id: 'deste-mes', dueAt: at('2026-09-10T12:00:00.000Z') }),
        demand({ id: 'mes-seguinte', dueAt: at('2026-10-02T12:00:00.000Z') }),
        demand({ id: 'mes-anterior', dueAt: at('2026-08-20T12:00:00.000Z') }),
        demand({ id: 'sem-prazo' }),
      ],
      timeZone: BAHIA,
      now: at('2026-09-10T12:00:00.000Z'),
    });

    expect(month.outside).toBe(2);
    expect(month.undated.map((item) => item.id)).toEqual(['sem-prazo']);

    /** A célula de 31/08 aparece na grade, mas quem vence nela NÃO é desenhado ali. */
    const trintaUm = month.weeks.flat().find((cell) => cell.dayKey === '2026-08-31');
    expect(trintaUm?.demands ?? []).toEqual([]);
  });

  it('`isToday` marca o dia de hoje no fuso do EVENTO — e só ele', () => {
    const month = calendarMonth({
      monthKey: SETEMBRO,
      demands: [],
      timeZone: BAHIA,
      /** 00:30 de 16/09 em UTC ainda é 21:30 de 15/09 em Bahia. */
      now: at('2026-09-16T00:30:00.000Z'),
    });

    const marcados = month.weeks.flat().filter((cell) => cell.isToday);

    expect(marcados.map((cell) => cell.dayKey)).toEqual(['2026-09-15']);
  });

  it('o mês traz o rótulo pronto e os vizinhos para a navegação', () => {
    const month = calendarMonth({
      monthKey: SETEMBRO,
      demands: [],
      timeZone: BAHIA,
      now: at('2026-09-10T12:00:00.000Z'),
    });

    expect(month.monthLabel).toBe('setembro de 2026');
    expect(month.prevMonthKey).toBe('2026-08');
    expect(month.nextMonthKey).toBe('2026-10');
  });

  it('fevereiro é o mês que prova a grade: 28, 29 e o século', () => {
    const bissexto = calendarMonth({
      monthKey: '2024-02',
      demands: [],
      timeZone: BAHIA,
      now: at('2024-02-10T12:00:00.000Z'),
    });

    expect(bissexto.weeks.flat().filter((cell) => cell.inMonth)).toHaveLength(29);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('aritmética de calendário (sem `Date` e sem fuso)', () => {
  it('`shiftMonthKey` vira o ano nos dois sentidos', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-09', 1)).toBe('2026-10');
    expect(shiftMonthKey('2026-09', -1)).toBe('2026-08');
    /** Doze passos é o mesmo mês do ano seguinte — e não uma soma de strings. */
    expect(shiftMonthKey('2026-09', 12)).toBe('2027-09');
  });

  it('`daysInMonth` conta os bissextos pela regra dos séculos', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2000-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-12')).toBe(31);
  });

  it('`weekdayOf` acerta datas conhecidas (0 = domingo)', () => {
    expect(weekdayOf('2000-01-01')).toBe(6); // sábado
    expect(weekdayOf('2026-01-01')).toBe(4); // quinta
    expect(weekdayOf('2026-09-01')).toBe(2); // terça
    expect(weekdayOf('2026-09-26')).toBe(6); // sábado
    expect(weekdayOf('2024-02-29')).toBe(4); // quinta
  });

  it('`firstDayOfMonth` e `monthKeyOf` fecham o par', () => {
    expect(firstDayOfMonth('2026-09')).toBe('2026-09-01');
    expect(monthKeyOf('2026-09-26')).toBe('2026-09');
  });

  it('`monthLabel` escreve o mês em português', () => {
    expect(monthLabel('2026-01')).toBe('janeiro de 2026');
    expect(monthLabel('2026-03')).toBe('março de 2026');
    expect(monthLabel('2026-12')).toBe('dezembro de 2026');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('`withSituation` calcula a situação uma vez', () => {
  const semSituacao = {
    id: 'x',
    title: 'Demanda',
    priority: 'NORMAL',
    priorityLabel: 'Normal',
    startAt: null,
    dueAt: at('2026-09-10T23:59:00.000Z'),
    completedAt: null,
    createdAt: at('2026-09-01T12:00:00.000Z'),
    teamName: null,
    assignees: [],
  };

  it('vence hoje é a comparação de DIA LOCAL, e vira rótulo pronto', () => {
    const hoje = withSituation(semSituacao, at('2026-09-10T15:00:00.000Z'), BAHIA);
    expect(hoje.situation).toBe('DUE_TODAY');
    expect(hoje.situationLabel).toBe('Vence hoje');

    const depois = withSituation(semSituacao, at('2026-09-11T15:00:00.000Z'), BAHIA);
    expect(depois.situation).toBe('OVERDUE');
    expect(depois.situationLabel).toBe('Atrasada');
  });

  it('concluída vence o prazo, mesmo vencido', () => {
    const feita = withSituation(
      { ...semSituacao, completedAt: at('2026-09-12T12:00:00.000Z') },
      at('2026-09-20T12:00:00.000Z'),
      BAHIA,
    );

    expect(feita.situation).toBe('DONE');
    expect(feita.situationLabel).toBe('Concluída');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o mapeamento do quadro para as vistas', () => {
  const agora = at('2026-09-10T15:00:00.000Z');

  function column(cards: Parameters<typeof toTimelineDemands>[0][number]['cards']) {
    return [{ id: 'coluna', name: 'A fazer', isDone: false, position: 10, cards, totalCards: cards.length }];
  }

  it('achata as colunas e calcula a situação UMA vez, no fuso do evento', () => {
    const demands = toTimelineDemands(
      column([
        {
          id: 'd1',
          columnId: 'coluna',
          title: 'Montar os crachás',
          description: null,
          priority: 'URGENT',
          priorityLabel: 'Urgente',
          position: 10,
          startAt: at('2026-09-08T12:00:00.000Z'),
          dueAt: at('2026-09-10T23:59:00.000Z'),
          dueLabel: 'vence hoje',
          completedAt: null,
          createdAt: at('2026-09-01T12:00:00.000Z'),
          teamId: null,
          teamName: 'Logística',
          assignees: [],
          commentCount: 0,
          situation: 'DUE_TODAY',
          situationLabel: 'Vence hoje',
          isLate: false,
        },
      ]),
      agora,
      BAHIA,
    );

    expect(demands).toHaveLength(1);
    expect(demands[0]!.createdAt.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(demands[0]!.teamName).toBe('Logística');
    expect(demands[0]!.situation).toBe('DUE_TODAY');
  });
});

describe('a âncora do eixo e o mês do calendário', () => {
  const agora = at('2026-09-10T15:00:00.000Z');

  it('o dia pedido manda quando é data de verdade', () => {
    expect(isTimelineDayKey('2026-09-01')).toBe(true);
    expect(isTimelineDayKey('2026-13-01')).toBe(false);
    expect(isTimelineDayKey('2026-09-32')).toBe(false);
    expect(isTimelineDayKey('ontem')).toBe(false);

    expect(
      ganttAnchorKey({ requested: '2026-11-20', demands: [], timeZone: BAHIA, now: agora }),
    ).toBe('2026-11-20');
  });

  it('sem dia pedido, a âncora é o início mais cedo das demandas COM prazo', () => {
    const ancoras = ganttAnchorKey({
      requested: null,
      demands: [
        demand({ id: 'a', dueAt: at('2026-09-20T12:00:00.000Z'), createdAt: at('2026-09-05T12:00:00.000Z') }),
        demand({ id: 'b', startAt: at('2026-09-02T12:00:00.000Z'), dueAt: at('2026-09-09T12:00:00.000Z') }),
        /** Sem prazo e antiga: não define a âncora, porque não entra no eixo. */
        demand({ id: 'c', createdAt: at('2025-01-01T12:00:00.000Z') }),
      ],
      timeZone: BAHIA,
      now: agora,
    });

    expect(ancoras).toBe('2026-09-02');
  });

  it('sem nenhuma demanda com prazo, a âncora é HOJE no fuso do evento', () => {
    expect(
      ganttAnchorKey({
        requested: 'sei-la',
        demands: [demand({ id: 'sem-prazo' })],
        timeZone: BAHIA,
        now: agora,
      }),
    ).toBe('2026-09-10');
  });

  it('o mês do calendário aceita o pedido válido e cai em hoje no resto', () => {
    expect(isTimelineMonthKey('2026-11')).toBe(true);
    expect(isTimelineMonthKey('2026-13')).toBe(false);
    expect(isTimelineMonthKey('2026-1')).toBe(false);

    expect(calendarMonthKey({ requested: '2026-11', timeZone: BAHIA, now: agora })).toBe('2026-11');
    expect(calendarMonthKey({ requested: '2026-13', timeZone: BAHIA, now: agora })).toBe('2026-09');
    expect(calendarMonthKey({ requested: null, timeZone: BAHIA, now: agora })).toBe('2026-09');
  });

  it('a navegação do eixo anda uma janela inteira', () => {
    const window = timelineWindow({ anchorKey: '2026-09-01', days: 7 });

    expect(shiftedWindowAnchor(window, -1)).toBe('2026-08-25');
    expect(shiftedWindowAnchor(window, 1)).toBe('2026-09-08');
  });
});

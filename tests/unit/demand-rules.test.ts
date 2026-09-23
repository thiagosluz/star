import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEMAND_COLUMNS,
  DEMAND_POSITION_STEP,
  DEMAND_PRIORITIES,
  DEMAND_PRIORITY_LABELS,
  DEMAND_SITUATION_LABELS,
  UNASSIGNED_KEY,
  boardSummary,
  clampIndex,
  columnOf,
  dayFromDueAt,
  daysLate,
  demandSituation,
  dueAtFromDay,
  dueDayLabel,
  dueStatusLabel,
  firstColumn,
  isDemandPriority,
  leadsTeam,
  localDayKey,
  moveWithinList,
  normalizeColumnName,
  normalizeDemandComment,
  normalizeDemandDescription,
  normalizeDemandPriority,
  normalizeDemandTitle,
  normalizeMentionIds,
  planReorder,
  positionBetween,
  priorityLabel,
  type DemandSummaryInput,
} from '../../src/domain/events/demand-rules';

const BAHIA = 'America/Bahia';

function at(iso: string): Date {
  return new Date(iso);
}

describe('prioridade', () => {
  it('todo valor do catálogo tem rótulo em português', () => {
    for (const priority of DEMAND_PRIORITIES) {
      expect(DEMAND_PRIORITY_LABELS[priority], priority).toBeTruthy();
    }
  });

  it('reconhece o que está no catálogo e recusa o resto', () => {
    expect(isDemandPriority('URGENT')).toBe(true);
    expect(isDemandPriority('urgent')).toBe(false);
    expect(isDemandPriority('HIGHEST')).toBe(false);
    expect(isDemandPriority(null)).toBe(false);
  });

  it('o ausente é NORMAL, e não URGENT', () => {
    expect(normalizeDemandPriority(undefined)).toBe('NORMAL');
    expect(normalizeDemandPriority('')).toBe('NORMAL');
    expect(normalizeDemandPriority('SEI_LA')).toBe('NORMAL');
    expect(normalizeDemandPriority('LOW')).toBe('LOW');
  });

  it('rótulo de valor desconhecido não inventa urgência', () => {
    expect(priorityLabel('URGENT')).toBe('Urgente');
    expect(priorityLabel('SEI_LA')).toBe('Normal');
  });
});

describe('colunas', () => {
  it('o quadro nasce com UMA coluna de conclusão, e ela é a última', () => {
    const doneColumns = DEFAULT_DEMAND_COLUMNS.filter((column) => column.isDone);
    expect(doneColumns).toHaveLength(1);
    expect(DEFAULT_DEMAND_COLUMNS[DEFAULT_DEMAND_COLUMNS.length - 1]!.isDone).toBe(true);
  });

  it('nome de coluna é normalizado e vazio é recusado', () => {
    expect(normalizeColumnName('  Em   andamento ')).toBe('Em andamento');
    expect(normalizeColumnName('   ')).toBeNull();
    expect(normalizeColumnName(null)).toBeNull();
    expect(normalizeColumnName('x'.repeat(80))).toHaveLength(40);
  });

  it('a primeira coluna é a de menor posição, não a de nome "A fazer"', () => {
    const columns = [
      { id: 'b', name: 'Revisão', isDone: false, position: 20 },
      { id: 'a', name: 'Feito', isDone: true, position: 10 },
    ];
    expect(firstColumn(columns)?.id).toBe('a');
    expect(firstColumn([])).toBeNull();
  });

  it('acha a coluna por id e devolve null quando não existe', () => {
    const columns = [{ id: 'a', name: 'A fazer', isDone: false, position: 10 }];
    expect(columnOf(columns, 'a')?.name).toBe('A fazer');
    expect(columnOf(columns, null)).toBeNull();
    expect(columnOf(columns, 'z')).toBeNull();
  });
});

describe('ordenação dos cartões', () => {
  it('as posições andam de 10 em 10', () => {
    expect(planReorder(['a', 'b', 'c'])).toEqual([
      { id: 'a', position: 10 },
      { id: 'b', position: 20 },
      { id: 'c', position: 30 },
    ]);
    expect(DEMAND_POSITION_STEP).toBe(10);
  });

  it('posição média só existe quando há folga entre as vizinhas', () => {
    expect(positionBetween(10, 30)).toBe(20);
    expect(positionBetween(null, 20)).toBe(10);
    expect(positionBetween(20, null)).toBe(30);
    expect(positionBetween(null, null)).toBe(10);
    // Sem folga (vizinhas consecutivas): quem chama reescreve o bloco.
    expect(positionBetween(10, 11)).toBeNull();
  });

  it('mover para baixo não anda uma casa a mais', () => {
    // ["a","b","c"] com "a" solto depois do índice 1 da lista já sem ele.
    expect(moveWithinList(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveWithinList(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveWithinList(['a', 'b', 'c'], 1, 5)).toEqual(['a', 'c', 'b']);
  });

  it('índice fora da lista é grampeado, não estoura', () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(99, 5)).toBe(5);
    expect(clampIndex(Number.NaN, 4)).toBe(4);
    expect(moveWithinList(['a'], 0, 0)).toEqual(['a']);
  });
});

describe('prazo no fuso do evento', () => {
  it('a chave do dia é a do fuso informado, não a do processo', () => {
    // 26/09/2026 02:59Z ainda é dia 25 em America/Bahia (UTC-3).
    expect(localDayKey(at('2026-09-26T02:59:00.000Z'), BAHIA)).toBe('2026-09-25');
    expect(localDayKey(at('2026-09-26T02:59:00.000Z'), 'UTC')).toBe('2026-09-26');
  });

  it('o dia digitado vira o FIM daquele dia no evento', () => {
    // 26/09 23:59 em Bahia = 27/09 02:59Z.
    expect(dueAtFromDay('2026-09-26', BAHIA)?.toISOString()).toBe('2026-09-27T02:59:00.000Z');
    expect(dueAtFromDay('2026-09-26', 'UTC')?.toISOString()).toBe('2026-09-26T23:59:00.000Z');
  });

  it('texto que não é data é recusado em vez de virar o prazo de hoje', () => {
    expect(dueAtFromDay('26/09/2026', BAHIA)).toBeNull();
    expect(dueAtFromDay('2026-13-01', BAHIA)).toBeNull();
    expect(dueAtFromDay('', BAHIA)).toBeNull();
    expect(dueAtFromDay('ontem', BAHIA)).toBeNull();
  });

  it('o caminho de volta devolve o texto do campo de data', () => {
    const due = dueAtFromDay('2026-09-26', BAHIA)!;
    expect(dayFromDueAt(due, BAHIA)).toBe('2026-09-26');
    expect(dayFromDueAt(null, BAHIA)).toBe('');
  });
});

describe('situação do cartão', () => {
  const now = at('2026-09-26T15:00:00.000Z'); // 26/09 12:00 em Bahia

  it('o prazo é o DIA inteiro: o mesmo dia ainda está no prazo', () => {
    const due = dueAtFromDay('2026-09-26', BAHIA)!;
    expect(demandSituation({ dueAt: due, completedAt: null }, now, BAHIA)).toBe('DUE_TODAY');
  });

  it('o dia seguinte já é atraso', () => {
    const due = dueAtFromDay('2026-09-25', BAHIA)!;
    expect(demandSituation({ dueAt: due, completedAt: null }, now, BAHIA)).toBe('OVERDUE');
  });

  it('sem prazo é "em aberto", não "no prazo"', () => {
    expect(demandSituation({ dueAt: null, completedAt: null }, now, BAHIA)).toBe('OPEN');
  });

  it('concluída vence o atraso: quem resolveu não continua sendo acusado', () => {
    const due = dueAtFromDay('2026-09-01', BAHIA)!;
    expect(
      demandSituation({ dueAt: due, completedAt: at('2026-09-20T12:00:00.000Z') }, now, BAHIA),
    ).toBe('DONE');
  });

  it('todo estado tem rótulo', () => {
    for (const situation of Object.keys(DEMAND_SITUATION_LABELS)) {
      expect(DEMAND_SITUATION_LABELS[situation as keyof typeof DEMAND_SITUATION_LABELS]).toBeTruthy();
    }
  });

  it('os dias de atraso são de CALENDÁRIO, não de 24 horas', () => {
    // Venceu 23/09 23:59 (Bahia) e hoje é 26/09: três dias de calendário.
    const due = dueAtFromDay('2026-09-23', BAHIA)!;
    expect(daysLate({ dueAt: due, completedAt: null }, now, BAHIA)).toBe(3);
    expect(daysLate({ dueAt: dueAtFromDay('2026-09-26', BAHIA), completedAt: null }, now, BAHIA)).toBe(0);
    expect(daysLate({ dueAt: null, completedAt: null }, now, BAHIA)).toBe(0);
    expect(daysLate({ dueAt: due, completedAt: at('2026-09-24T12:00:00Z') }, now, BAHIA)).toBe(0);
  });

  it('o rótulo diz o que a pessoa precisa saber primeiro', () => {
    expect(dueStatusLabel({ dueAt: dueAtFromDay('2026-09-26', BAHIA), completedAt: null }, now, BAHIA)).toBe(
      'vence hoje',
    );
    expect(dueStatusLabel({ dueAt: dueAtFromDay('2026-09-25', BAHIA), completedAt: null }, now, BAHIA)).toBe(
      'atrasada há 1 dia',
    );
    expect(dueStatusLabel({ dueAt: dueAtFromDay('2026-09-20', BAHIA), completedAt: null }, now, BAHIA)).toBe(
      'atrasada há 6 dias',
    );
    expect(dueStatusLabel({ dueAt: dueAtFromDay('2026-10-05', BAHIA), completedAt: null }, now, BAHIA)).toBe(
      '05/10/2026',
    );
    expect(dueStatusLabel({ dueAt: null, completedAt: null }, now, BAHIA)).toBeNull();
  });

  it('o rótulo do dia é a data no fuso do evento', () => {
    expect(dueDayLabel(dueAtFromDay('2026-09-26', BAHIA), BAHIA)).toBe('26/09/2026');
    expect(dueDayLabel(null, BAHIA)).toBeNull();
  });
});

describe('texto', () => {
  it('título vazio é recusado e o resto é aparado', () => {
    expect(normalizeDemandTitle('  Montar os crachás  ')).toBe('Montar os crachás');
    expect(normalizeDemandTitle('   ')).toBeNull();
    expect(normalizeDemandTitle(42)).toBeNull();
    expect(normalizeDemandTitle('x'.repeat(200))).toHaveLength(160);
  });

  it('descrição e comentário vazios viram ausência, não string vazia', () => {
    expect(normalizeDemandDescription('')).toBeNull();
    expect(normalizeDemandComment('  ')).toBeNull();
    expect(normalizeDemandComment('combinado com a portaria')).toBe('combinado com a portaria');
  });
});

describe('menções', () => {
  const allowed = new Set(['u1', 'u2', 'u3']);

  it('filtra quem não participa, deduplica e tira o próprio autor', () => {
    expect(normalizeMentionIds(['u1', 'u1', 'u9', 'u2'], allowed, 'u3')).toEqual(['u1', 'u2']);
    expect(normalizeMentionIds(['u3'], allowed, 'u3')).toEqual([]);
  });

  it('lista vazia ou de lixo não inventa menção', () => {
    expect(normalizeMentionIds([], allowed, 'u1')).toEqual([]);
    expect(normalizeMentionIds(['  ', 'zzz'], allowed, 'u1')).toEqual([]);
  });
});

describe('liderança de equipe', () => {
  it('só o líder DAQUELA equipe', () => {
    expect(leadsTeam('t1', ['t1', 't2'])).toBe(true);
    expect(leadsTeam('t3', ['t1'])).toBe(false);
    expect(leadsTeam(null, ['t1'])).toBe(false);
  });
});

describe('resumo do quadro', () => {
  const now = at('2026-09-26T15:00:00.000Z');

  function demand(overrides: Partial<DemandSummaryInput> = {}): DemandSummaryInput {
    return {
      id: 'd1',
      dueAt: null,
      completedAt: null,
      teamId: null,
      assigneeIds: [],
      ...overrides,
    };
  }

  it('conta abertas, atrasadas e concluídas', () => {
    const summary = boardSummary(
      [
        demand({ id: 'a', dueAt: dueAtFromDay('2026-09-25', BAHIA) }), // atrasada
        demand({ id: 'b', dueAt: dueAtFromDay('2026-09-26', BAHIA) }), // vence hoje
        demand({ id: 'c' }), // em aberto
        demand({ id: 'd', completedAt: at('2026-09-24T12:00:00Z') }), // concluída
      ],
      now,
      BAHIA,
    );

    expect(summary).toMatchObject({ total: 4, open: 3, overdue: 1, dueToday: 1, done: 1 });
  });

  it('a equipe com mais atrasadas vem primeiro', () => {
    const summary = boardSummary(
      [
        demand({ id: 'a', teamId: 't2' }),
        demand({ id: 'b', teamId: 't1', dueAt: dueAtFromDay('2026-09-25', BAHIA) }),
        demand({ id: 'c', teamId: 't1', dueAt: dueAtFromDay('2026-09-24', BAHIA) }),
      ],
      now,
      BAHIA,
    );

    expect(summary.byTeam.map((row) => row.teamId)).toEqual(['t1', 't2']);
    expect(summary.byTeam[0]).toMatchObject({ overdue: 2, open: 2, total: 2 });
  });

  it('demanda sem responsável aparece como "sem responsável", não fora do resumo', () => {
    const summary = boardSummary([demand({ id: 'a' }), demand({ id: 'b', assigneeIds: ['u1'] })], now, BAHIA);

    expect(summary.byAssignee.map((row) => row.userId).sort()).toEqual(['u1', UNASSIGNED_KEY].sort());
  });

  it('a mesma pessoa em duas atribuições conta UMA vez por demanda', () => {
    const summary = boardSummary([demand({ id: 'a', assigneeIds: ['u1', 'u1'] })], now, BAHIA);
    const row = summary.byAssignee.find((entry) => entry.userId === 'u1');
    expect(row?.total).toBe(1);
  });

  it('quadro vazio não inventa número', () => {
    expect(boardSummary([], now, BAHIA)).toMatchObject({
      total: 0,
      open: 0,
      overdue: 0,
      dueToday: 0,
      done: 0,
      byTeam: [],
      byAssignee: [],
    });
  });
});

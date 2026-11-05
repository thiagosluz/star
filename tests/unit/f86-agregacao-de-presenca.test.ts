/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PRESENÇA SOMA POR PESSOA E ATIVIDADE — a dívida E92 (FASE 86 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. duas visitas de 30 min na MESMA atividade de 60 somam 60 e passam o limiar
 *     de 45 (75 % da carga) — hoje elas reprovam separadas;
 *  2. a soma tem TETO: a carga declarada e a janela real da atividade (ADR-150);
 *  3. quem tem UMA linha na atividade recebe exatamente o mesmo resultado de hoje
 *     (a prova de que a correção não muda quem já era atendido);
 *  4. a linha do EVENTO (`activityId` nulo) não se mistura com a de atividade;
 *  5. a saída não depende da ORDEM das linhas — simulação e emissão leem o mesmo
 *     dado em ordens que o banco não promete.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  aggregateAttendanceByActivity,
  type AttendanceAggregateRow,
  type AggregatedAttendance,
} from '../../src/domain/certificates/attendance-aggregate';
import {
  MIN_ATTENDANCE_MINUTES,
  MIN_ATTENDANCE_RATIO,
  computeWorkload,
  evaluateEligibility,
  type AttendanceRecord,
  type EligibilityFacts,
} from '../../src/domain/certificates/certificate-rules';

const INICIO = new Date('2026-09-17T12:00:00.000Z');
const ATIVIDADE = 'atividade-1';

interface LinhaInput {
  userId?: string;
  activityId?: string | null;
  minutes: number;
  /** `false` = sessão aberta (sem check-out), que não mede tempo. */
  checkedOut?: boolean;
  workloadMinutes?: number;
  /** Duração real da atividade; o padrão é a carga declarada. */
  windowMinutes?: number;
  title?: string;
  type?: string | null;
}

function atividadeDe(input: LinhaInput): AttendanceAggregateRow['activity'] {
  const workloadMinutes = input.workloadMinutes ?? 60;
  const windowMinutes = input.windowMinutes ?? workloadMinutes;

  return {
    title: input.title ?? 'Minicurso da Fase 86',
    type: input.type === undefined ? 'MINI_COURSE' : input.type,
    workloadMinutes,
    startsAt: INICIO,
    endsAt: new Date(INICIO.getTime() + windowMinutes * 60_000),
  };
}

function linha(input: LinhaInput): AttendanceAggregateRow {
  const activityId = input.activityId === undefined ? ATIVIDADE : input.activityId;

  return {
    userId: input.userId ?? 'pessoa-1',
    activityId,
    minutesAttended: input.minutes,
    checkedOutAt:
      input.checkedOut === false
        ? null
        : new Date(INICIO.getTime() + input.minutes * 60_000),
    activity: activityId === null ? null : atividadeDe(input),
  };
}

/**
 * O fato de HOJE, por linha — a régua contra a qual a correção é medida.
 *
 * Reproduz o antigo `attendanceRecord` do serviço: sem check-out o tempo medido é
 * zero, e cada linha vira uma entrada independente.
 */
function fatoDeHoje(row: AttendanceAggregateRow): AttendanceRecord {
  return {
    activityId: row.activityId,
    activityTitle: row.activity?.title ?? null,
    activityType: row.activity?.type ?? null,
    workloadMinutes: row.activity?.workloadMinutes ?? 0,
    minutesAttended: row.checkedOutAt ? (row.minutesAttended ?? 0) : 0,
  };
}

function fatosDe(attendances: readonly AttendanceRecord[]): EligibilityFacts {
  return {
    kind: 'ATTENDANCE',
    attendances,
    eventCheckedIn: false,
    miniCourseCount: 1,
    isSpeaker: false,
    speakerWorkload: null,
    completedReviews: 0,
    acceptedSubmissions: 0,
    eventFinished: true,
  };
}

/** O limiar da atividade de 60: 75 % da carga, com o piso de 30 min. */
const LIMIAR_DE_60 = Math.max(MIN_ATTENDANCE_MINUTES, Math.round(60 * MIN_ATTENDANCE_RATIO));

describe('a agregação por pessoa × atividade', () => {
  it('duas visitas de 30 min na atividade de 60 somam 60 — e passam o limiar de 45', () => {
    expect(LIMIAR_DE_60).toBe(45);

    const cruas = [linha({ minutes: 30 }), linha({ minutes: 30 })];

    // ANTES: cada linha é comparada ao limiar sozinha, e as duas reprovam.
    const antes = cruas.map(fatoDeHoje);
    expect(computeWorkload({ attendances: antes }).countedActivities).toBe(0);
    expect(evaluateEligibility(fatosDe(antes)).eligible).toBe(false);

    // DEPOIS: uma linha por (pessoa, atividade), com a permanência somada.
    const agregadas = aggregateAttendanceByActivity(cruas);
    expect(agregadas).toHaveLength(1);
    expect(agregadas[0]).toMatchObject({
      userId: 'pessoa-1',
      activityId: ATIVIDADE,
      minutesAttended: 60,
      workloadMinutes: 60,
    });

    const carga = computeWorkload({ attendances: agregadas });
    expect(carga.countedActivities).toBe(1);
    expect(carga.totalMinutes).toBe(60);
    expect(evaluateEligibility(fatosDe(agregadas)).eligible).toBe(true);
  });

  it('o teto é a carga da atividade: duas visitas de 20 num minicurso de 30 somam 30', () => {
    const agregadas = aggregateAttendanceByActivity([
      linha({ minutes: 20, workloadMinutes: 30 }),
      linha({ minutes: 20, workloadMinutes: 30 }),
    ]);

    expect(agregadas).toHaveLength(1);
    expect(agregadas[0]?.minutesAttended).toBe(30);
    expect(computeWorkload({ attendances: agregadas }).totalMinutes).toBe(30);
  });

  it('o teto também é a JANELA real da atividade (ADR-150), quando ela é menor que a carga', () => {
    // Atividade declarada de 120 min que durou 60: ninguém fica 90 minutos numa
    // janela de 60, por mais sobrepostas que as visitas estejam.
    const agregadas = aggregateAttendanceByActivity([
      linha({ minutes: 60, workloadMinutes: 120, windowMinutes: 60 }),
      linha({ minutes: 30, workloadMinutes: 120, windowMinutes: 60 }),
    ]);

    expect(agregadas[0]?.minutesAttended).toBe(60);
  });

  it('três visitas de 20 min na atividade de 60 somam 60', () => {
    const agregadas = aggregateAttendanceByActivity([
      linha({ minutes: 20 }),
      linha({ minutes: 20 }),
      linha({ minutes: 20 }),
    ]);

    expect(agregadas).toHaveLength(1);
    expect(agregadas[0]?.minutesAttended).toBe(60);
    expect(evaluateEligibility(fatosDe(agregadas)).eligible).toBe(true);
  });

  it('minutos já no teto continuam no teto — a soma não passa da carga', () => {
    const agregadas = aggregateAttendanceByActivity([linha({ minutes: 60 })]);

    expect(agregadas[0]?.minutesAttended).toBe(60);
  });

  it('a ORDEM das linhas não muda o resultado', () => {
    const linhas = [
      linha({ minutes: 30 }),
      linha({ minutes: 25, userId: 'pessoa-2' }),
      linha({ minutes: 30 }),
      linha({ minutes: 10, activityId: 'atividade-2', workloadMinutes: 60 }),
    ];

    const direta = aggregateAttendanceByActivity(linhas);
    const inversa = aggregateAttendanceByActivity([...linhas].reverse());

    expect(inversa).toEqual(direta);
    // E a saída é ordenada por pessoa e atividade, não pela ordem de leitura.
    expect(direta.map((row) => `${row.userId}:${row.activityId}`)).toEqual([
      'pessoa-1:atividade-1',
      'pessoa-1:atividade-2',
      'pessoa-2:atividade-1',
    ]);
  });
});

describe('a linha do EVENTO não se mistura com a de atividade', () => {
  it('duas linhas de portaria somam entre si e ficam separadas da atividade', () => {
    const agregadas = aggregateAttendanceByActivity([
      linha({ minutes: 40, activityId: null }),
      linha({ minutes: 40, activityId: null }),
      linha({ minutes: 60 }),
    ]);

    expect(agregadas).toHaveLength(2);

    const doEvento = agregadas.find((row) => row.activityId === null);
    const daAtividade = agregadas.find((row) => row.activityId === ATIVIDADE);

    expect(doEvento?.minutesAttended).toBe(80);
    expect(doEvento?.workloadMinutes).toBe(0);
    expect(doEvento?.activityTitle).toBeNull();
    // Se a linha do evento fosse somada à atividade, o minicurso teria 140 min.
    expect(daAtividade?.minutesAttended).toBe(60);
  });

  it('o certificado de PARTICIPAÇÃO continua decidido pelo credenciamento do evento', () => {
    // Linha do evento curta: não atinge o piso de 30 min, então não conta como
    // atividade — é o credenciamento (`eventCheckedIn`) que decide, como antes.
    const agregadas = aggregateAttendanceByActivity([
      linha({ minutes: 20, activityId: null }),
    ]);

    expect(agregadas[0]?.activityId).toBeNull();
    expect(computeWorkload({ attendances: agregadas }).countedActivities).toBe(0);
    expect(
      evaluateEligibility({ ...fatosDe(agregadas), kind: 'PARTICIPATION' }).eligible,
    ).toBe(false);

    // Com o credenciamento (a linha do EVENTO da inscrição), há.
    expect(
      evaluateEligibility({
        ...fatosDe(agregadas),
        kind: 'PARTICIPATION',
        eventCheckedIn: true,
      }).eligible,
    ).toBe(true);
  });
});

describe('a prova de não regressão: uma linha por atividade não muda', () => {
  const casos = [
    { rotulo: 'cumprida no teto', minutes: 60, workloadMinutes: 60 },
    { rotulo: 'exatamente no limiar', minutes: 45, workloadMinutes: 60 },
    { rotulo: 'abaixo do limiar', minutes: 30, workloadMinutes: 60 },
    { rotulo: 'sem tempo medido', minutes: 0, workloadMinutes: 60 },
    { rotulo: 'atividade sem carga declarada', minutes: 40, workloadMinutes: 0 },
  ];

  for (const caso of casos) {
    it(`uma visita — ${caso.rotulo} — dá o MESMO resultado de hoje`, () => {
      const crua = linha({ minutes: caso.minutes, workloadMinutes: caso.workloadMinutes });
      const agregada = aggregateAttendanceByActivity([crua]);

      expect(agregada).toHaveLength(1);

      const antes = computeWorkload({ attendances: [fatoDeHoje(crua)] });
      const depois = computeWorkload({ attendances: agregada });

      expect(depois.totalMinutes).toBe(antes.totalMinutes);
      expect(depois.countedActivities).toBe(antes.countedActivities);
      expect(depois.declaredMinutes).toBe(antes.declaredMinutes);
    });
  }

  it('uma visita ACIMA da carga mantém o total de hoje (o excedente é cortado antes)', () => {
    // 90 min numa atividade de 60: hoje `computeWorkload` conta 60 e explica o
    // corte. A agregação aplica o mesmo teto antes, e o total tem de ser o MESMO —
    // o que muda é só a explicação do detalhamento, que deixa de ter o que cortar.
    const crua = linha({ minutes: 90 });
    const agregada = aggregateAttendanceByActivity([crua]);

    const antes = computeWorkload({ attendances: [fatoDeHoje(crua)] });
    const depois = computeWorkload({ attendances: agregada });

    expect(depois.totalMinutes).toBe(antes.totalMinutes);
    expect(depois.totalMinutes).toBe(60);
    expect(depois.entries[0]?.countedMinutes).toBe(60);
    expect(antes.entries[0]?.reason).toMatch(/excedentes/i);
    expect(depois.entries[0]?.reason).toBeNull();
  });

  it('a atividade de outro tipo continua no detalhamento, sem se aplicar ao minicurso', () => {
    const agregadas = aggregateAttendanceByActivity([
      linha({ minutes: 60, type: 'MINI_COURSE' }),
      linha({
        minutes: 60,
        activityId: 'palestra-1',
        workloadMinutes: 60,
        type: 'LECTURE',
        title: 'Palestra',
      }),
    ]);

    const minicursos = computeWorkload({
      attendances: agregadas,
      activityFilter: (record) => record.activityType === 'MINI_COURSE',
    });

    expect(minicursos.totalMinutes).toBe(60);
    expect(minicursos.countedActivities).toBe(1);
    expect(minicursos.entries).toHaveLength(2);
    expect(minicursos.entries[1]?.reason).toMatch(/não se aplica/i);
  });
});

describe('o tempo é o medido', () => {
  it('visita sem check-out contribui com zero — a sessão aberta não vale presença', () => {
    const agregadas = aggregateAttendanceByActivity([
      linha({ minutes: 30 }),
      linha({ minutes: 30, checkedOut: false }),
    ]);

    expect(agregadas[0]?.minutesAttended).toBe(30);
    expect(evaluateEligibility(fatosDe(agregadas)).eligible).toBe(false);
  });

  it('minutos negativos não viram carga', () => {
    const agregadas: AggregatedAttendance[] = aggregateAttendanceByActivity([
      linha({ minutes: -50 }),
    ]);

    expect(agregadas[0]?.minutesAttended).toBe(0);
  });
});

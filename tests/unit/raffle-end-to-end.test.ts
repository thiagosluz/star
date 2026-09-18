/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — sorteios de ponta a ponta (FASE 16)
 *
 *  O que só o domínio puro pode provar:
 *    • G1 — suplentes consomem o pool DEPOIS dos titulares, na mesma apuração;
 *    • G3 — a chance ponderada é proporcional aos minutos (e quem tem zero minuto
 *      ainda concorre, com peso 1);
 *    • G4 — a semente comprometida é reproduzível e o payload v2 não invalida o v1;
 *    • G5 — o nome público é mascarado por padrão;
 *    • G6 — a página pedida é limitada ao intervalo válido;
 *    • F1 — o ranking de revisores é estável e a presença total exige TODAS as
 *      atividades, com nenhuma pendente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  buildResultPayload,
  createSeededRandomInt,
  evaluateReadiness,
  hashResult,
  maskName,
  participantWeight,
  publicWinnerName,
  resolveRafflePage,
  seedCommitment,
  selectWeightedWinners,
  selectWinners,
  validateRaffleConfig,
  verifyResult,
  verifySeed,
  type EligibleParticipant,
} from '../../src/domain/raffles/raffle-rules';
import { evaluateFullAttendance } from '../../src/domain/events/attendance-rules';
import { rankReviewers } from '../../src/domain/review/review-rules';

function participant(userId: string, minutes: number): EligibleParticipant {
  return {
    userId,
    userName: `Pessoa ${userId}`,
    minutes,
    attendanceIds: [],
    referenceAttendanceId: null,
  };
}

/** Gerador determinístico simples para os testes de amostragem. */
function sequence(values: number[]): (max: number) => number {
  let index = 0;
  return (max: number) => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return Math.max(0, Math.min(value, max - 1));
  };
}

describe('G3 — amostragem ponderada por minutos', () => {
  it('peso é o tempo assistido, com piso 1 para quem tem zero', () => {
    expect(participantWeight(participant('a', 120))).toBe(120);
    expect(participantWeight(participant('b', 0))).toBe(1);
    expect(participantWeight(participant('c', -30))).toBe(1);
  });

  it('sorteia exatamente a quantidade pedida, sem repetir', () => {
    const pool = [participant('a', 10), participant('b', 20), participant('c', 30)];
    const picked = selectWeightedWinners(pool, 3, sequence([0, 0, 0]));

    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((entry) => entry.userId)).size).toBe(3);
  });

  it('com o ponto no início do intervalo, o primeiro da ordem sai', () => {
    const pool = [participant('a', 10), participant('b', 20), participant('c', 30)];
    const picked = selectWeightedWinners(pool, 1, sequence([0]));

    expect(picked[0]?.userId).toBe('a');
  });

  it('com o ponto no fim do intervalo, o último da ordem sai', () => {
    const pool = [participant('a', 10), participant('b', 20), participant('c', 30)];
    // Soma = 60; o ponto 59 pertence ao último (intervalo [30, 60)).
    const picked = selectWeightedWinners(pool, 1, sequence([59]));

    expect(picked[0]?.userId).toBe('c');
  });

  it('não entrega mais do que existe no pool', () => {
    const pool = [participant('a', 10)];
    expect(selectWeightedWinners(pool, 5, sequence([0, 0, 0, 0, 0]))).toHaveLength(1);
  });

  it('quem tem muito mais minutos ganha mais vezes (2000 sorteios com semente fixa)', () => {
    const pool = [participant('leve', 10), participant('pesado', 990)];
    const random = createSeededRandomInt('semente-de-teste');
    let heavy = 0;

    for (let round = 0; round < 2_000; round += 1) {
      const [picked] = selectWeightedWinners(pool, 1, random);
      if (picked?.userId === 'pesado') heavy += 1;
    }

    // A chance teórica é 99%; com 2000 amostras independentes, menos de 95% seria
    // sinal de ponderação quebrada (e o teste é determinístico, não flaky).
    expect(heavy / 2_000).toBeGreaterThan(0.95);
  });

  it('sem ponderação, o sorteio continua uniforme (Fisher-Yates)', () => {
    const pool = [participant('a', 1), participant('b', 1_000)];
    const random = createSeededRandomInt('outra-semente');
    let heavy = 0;

    for (let round = 0; round < 2_000; round += 1) {
      const [picked] = selectWinners(pool, 1, random);
      if (picked?.userId === 'b') heavy += 1;
    }

    expect(heavy / 2_000).toBeGreaterThan(0.4);
    expect(heavy / 2_000).toBeLessThan(0.6);
  });
});

describe('G4 — semente comprometida (commit-reveal)', () => {
  it('a mesma semente produz a mesma sequência', () => {
    const first = createSeededRandomInt('abc');
    const second = createSeededRandomInt('abc');

    const a = Array.from({ length: 10 }, () => first(1_000));
    const b = Array.from({ length: 10 }, () => second(1_000));

    expect(a).toEqual(b);
  });

  it('sementes diferentes produzem sequências diferentes', () => {
    const a = Array.from({ length: 10 }, ((random) => () => random(1_000))(createSeededRandomInt('um')));
    const b = Array.from({ length: 10 }, ((random) => () => random(1_000))(createSeededRandomInt('dois')));

    expect(a).not.toEqual(b);
  });

  it('o resultado do sorteio é reproduzível a partir da semente revelada', () => {
    const pool = [participant('a', 10), participant('b', 20), participant('c', 30), participant('d', 40)];
    const commitment = seedCommitment('semente-publicada');

    const first = selectWeightedWinners(pool, 2, createSeededRandomInt('semente-publicada'));
    const second = selectWeightedWinners(pool, 2, createSeededRandomInt('semente-publicada'));

    expect(first.map((entry) => entry.userId)).toEqual(second.map((entry) => entry.userId));
    // E o compromisso confere com a semente revelada.
    expect(verifySeed('semente-publicada', commitment)).toBe(true);
    expect(verifySeed('outra-semente', commitment)).toBe(false);
  });

  it('aceita `max = 1` sem travar (pool de um participante)', () => {
    const random = createSeededRandomInt('x');
    expect(random(1)).toBe(0);
  });
});

describe('G4 — payload de auditoria versionado', () => {
  const base = {
    raffleId: 'r1',
    tenantId: 't1',
    eventId: 'e1',
    scope: 'EVENT' as const,
    activityId: null,
    referenceDate: null,
    minAttendanceMinutes: 0,
    winnersCount: 1,
    allowPriorEventWinners: false,
    eligibleCount: 2,
    drawnAt: '2026-09-17T20:00:00.000Z',
    winners: [{ position: 1, userId: 'u1', minutes: 60 }],
  };

  it('a versão 1 ignora os campos novos (apurações antigas continuam conferindo)', () => {
    const legacy = buildResultPayload({ ...base, validationVersion: 1 });
    const legacyWithExtras = buildResultPayload({
      ...base,
      validationVersion: 1,
      alternatesCount: 3,
      weightByMinutes: true,
      winners: [{ position: 1, userId: 'u1', minutes: 60, kind: 'ALTERNATE' }],
    });

    expect(legacyWithExtras).toBe(legacy);
  });

  it('a versão 2 inclui suplentes, peso e o papel de cada posição', () => {
    const payload = buildResultPayload({
      ...base,
      validationVersion: 2,
      alternatesCount: 1,
      weightByMinutes: true,
      winners: [
        { position: 1, userId: 'u1', minutes: 60, kind: 'WINNER' },
        { position: 2, userId: 'u2', minutes: 30, kind: 'ALTERNATE' },
      ],
    });

    expect(payload).toContain('"validationVersion":2');
    expect(payload).toContain('"alternatesCount":1');
    expect(payload).toContain('"weightByMinutes":true');
    expect(payload).toContain('"kind":"ALTERNATE"');
  });

  it('promover um suplente a titular muda o hash', () => {
    const asAlternate = hashResult(
      buildResultPayload({
        ...base,
        validationVersion: 2,
        winners: [{ position: 1, userId: 'u1', minutes: 60, kind: 'ALTERNATE' }],
      }),
    );
    const asWinner = hashResult(
      buildResultPayload({
        ...base,
        validationVersion: 2,
        winners: [{ position: 1, userId: 'u1', minutes: 60, kind: 'WINNER' }],
      }),
    );

    expect(asAlternate).not.toBe(asWinner);
  });

  it('`verifyResult` aprova o payload que gerou o hash', () => {
    const payload = { ...base, validationVersion: 2 as const, alternatesCount: 0, weightByMinutes: false };

    expect(verifyResult(payload, hashResult(buildResultPayload(payload)))).toBe(true);
    expect(
      verifyResult({ ...payload, winners: [{ position: 1, userId: 'outro', minutes: 60 }] }, hashResult(buildResultPayload(payload))),
    ).toBe(false);
  });
});

describe('G5 — nome público', () => {
  it('mascara o sobrenome preservando o primeiro nome', () => {
    expect(maskName('Ana Souza')).toBe('Ana S.');
    expect(maskName('Ana Maria de Souza')).toBe('Ana M. S.');
  });

  it('nome de uma palavra é preservado (não identifica nada mascarar)', () => {
    expect(maskName('Ana')).toBe('Ana');
  });

  it('perfil público mostra o nome completo', () => {
    expect(publicWinnerName({ name: 'Ana Souza', publicProfile: true })).toBe('Ana Souza');
    expect(publicWinnerName({ name: 'Ana Souza', publicProfile: false })).toBe('Ana S.');
  });
});

describe('G6 — paginação do histórico', () => {
  it('limita a página ao intervalo válido', () => {
    expect(resolveRafflePage({ page: 999, pageSize: 10, total: 25 }).page).toBe(3);
    expect(resolveRafflePage({ page: 0, pageSize: 10, total: 25 }).page).toBe(1);
  });

  it('calcula o deslocamento da página', () => {
    const second = resolveRafflePage({ page: 2, pageSize: 10, total: 25 });

    expect(second.skip).toBe(10);
    expect(second.totalPages).toBe(3);
    expect(second.total).toBe(25);
  });

  it('lista vazia ainda tem uma página', () => {
    const empty = resolveRafflePage({ total: 0 });

    expect(empty.totalPages).toBe(1);
    expect(empty.page).toBe(1);
    expect(empty.skip).toBe(0);
  });

  it('respeita o teto de tamanho de página', () => {
    expect(resolveRafflePage({ pageSize: 5_000, total: 10 }).pageSize).toBe(50);
  });
});

describe('G1/G3 — prontidão com suplentes', () => {
  it('conta titulares e suplentes no pedido e no que será sorteado', () => {
    const ready = evaluateReadiness(10, 3, 2);

    expect(ready.willDraw).toBe(5);
    expect(ready.alternatesToDraw).toBe(2);
    expect(ready.shortfall).toBe(0);
    expect(ready.message).toContain('2 suplência');
  });

  it('faltando elegíveis, os titulares têm prioridade', () => {
    const ready = evaluateReadiness(2, 3, 2);

    expect(ready.willDraw).toBe(2);
    expect(ready.alternatesToDraw).toBe(0);
    expect(ready.shortfall).toBe(3);
    expect(ready.canDraw).toBe(true);
  });

  it('com 1 elegível e 3 titulares, não há suplente', () => {
    const ready = evaluateReadiness(1, 3, 1);

    expect(ready.willDraw).toBe(1);
    expect(ready.alternatesToDraw).toBe(0);
  });

  it('sem elegíveis, ninguém é sorteado', () => {
    const ready = evaluateReadiness(0, 3, 2);

    expect(ready.canDraw).toBe(false);
    expect(ready.willDraw).toBe(0);
  });
});

describe('validação de configuração com suplentes', () => {
  it('recusa suplentes negativos e acima do teto', () => {
    expect(validateRaffleConfig({ scope: 'EVENT', winnersCount: 1, alternatesCount: -1 }).valid).toBe(false);
    expect(validateRaffleConfig({ scope: 'EVENT', winnersCount: 1, alternatesCount: 501 }).valid).toBe(false);
  });

  it('aceita zero suplentes (o padrão histórico)', () => {
    expect(validateRaffleConfig({ scope: 'EVENT', winnersCount: 1, alternatesCount: 0 }).valid).toBe(true);
    expect(validateRaffleConfig({ scope: 'EVENT', winnersCount: 1 }).valid).toBe(true);
  });
});

describe('F1 — ranking de revisores', () => {
  const scores = [
    { reviewerId: 'c', reviewerName: 'Carla', completedReviews: 5 },
    { reviewerId: 'a', reviewerName: 'Ana', completedReviews: 5 },
    { reviewerId: 'b', reviewerName: 'Bruno', completedReviews: 1 },
    { reviewerId: 'd', reviewerName: 'Diego', completedReviews: 0 },
  ];

  it('ordena por pareceres e desempata por nome (estável)', () => {
    const ranking = rankReviewers(scores, { top: 2, minReviews: 1 });

    expect(ranking.ranked.map((row) => row.reviewerName)).toEqual(['Ana', 'Carla', 'Bruno']);
    expect(ranking.awarded.map((row) => row.reviewerName)).toEqual(['Ana', 'Carla']);
  });

  it('o piso exclui quem revisou pouco', () => {
    const ranking = rankReviewers(scores, { top: 5, minReviews: 5 });

    expect(ranking.awarded.map((row) => row.reviewerName)).toEqual(['Ana', 'Carla']);
    expect(ranking.reason).toBeNull();
  });

  it('explica por que ninguém foi premiado', () => {
    const nobody = rankReviewers(scores, { top: 1, minReviews: 10 });

    expect(nobody.awarded).toEqual([]);
    expect(nobody.reason).toContain('mínimo de 10');
    expect(nobody.topCount).toBe(5);
  });

  it('evento sem pareceres tem motivo próprio', () => {
    const empty = rankReviewers([], {});

    expect(empty.awarded).toEqual([]);
    expect(empty.reason).toContain('Nenhum parecer');
  });
});

describe('F1 — presença em todas as atividades', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  const activities = [
    {
      activityId: 'a1',
      title: 'Abertura',
      requiresAttendance: true,
      status: 'COMPLETED',
      endsAt: new Date('2026-09-17T12:00:00.000Z'),
    },
    {
      activityId: 'a2',
      title: 'Minicurso',
      requiresAttendance: true,
      status: 'COMPLETED',
      endsAt: new Date('2026-09-18T12:00:00.000Z'),
    },
    {
      activityId: 'a3',
      title: 'Feira (opcional)',
      requiresAttendance: false,
      status: 'COMPLETED',
      endsAt: new Date('2026-09-18T18:00:00.000Z'),
    },
  ];

  it('concede quando todas as obrigatórias estão cobertas e nada está pendente', () => {
    const result = evaluateFullAttendance({
      activities,
      attendances: [
        { activityId: 'a1', status: 'PRESENT', minutesAttended: 60 },
        { activityId: 'a2', status: 'PARTIAL', minutesAttended: 30 },
      ],
      now,
    });

    expect(result.complete).toBe(true);
    expect(result.requiredCount).toBe(2);
    expect(result.coveredCount).toBe(2);
  });

  it('não concede enquanto houver atividade por acontecer', () => {
    const result = evaluateFullAttendance({
      activities: [
        ...activities,
        {
          activityId: 'a4',
          title: 'Encerramento',
          requiresAttendance: true,
          status: 'SCHEDULED',
          endsAt: new Date('2026-09-21T12:00:00.000Z'),
        },
      ],
      attendances: [
        { activityId: 'a1', status: 'PRESENT', minutesAttended: 60 },
        { activityId: 'a2', status: 'PRESENT', minutesAttended: 60 },
      ],
      now,
    });

    expect(result.complete).toBe(false);
    expect(result.pendingCount).toBe(1);
    expect(result.reason).toContain('por acontecer');
  });

  it('lista o que faltou, para a explicação na tela', () => {
    const result = evaluateFullAttendance({
      activities,
      attendances: [{ activityId: 'a1', status: 'PRESENT', minutesAttended: 60 }],
      now,
    });

    expect(result.complete).toBe(false);
    expect(result.missingTitles).toEqual(['Minicurso']);
    expect(result.reason).toContain('Faltou presença');
  });

  it('presença marcada como ausente não conta', () => {
    const result = evaluateFullAttendance({
      activities,
      attendances: [
        { activityId: 'a1', status: 'PRESENT', minutesAttended: 60 },
        { activityId: 'a2', status: 'ABSENT', minutesAttended: 60 },
      ],
      now,
    });

    expect(result.complete).toBe(false);
    expect(result.coveredCount).toBe(1);
  });

  it('evento sem atividade obrigatória não gera a conquista', () => {
    const result = evaluateFullAttendance({
      activities: [activities[2]!],
      attendances: [{ activityId: 'a3', status: 'PRESENT', minutesAttended: 60 }],
      now,
    });

    expect(result.complete).toBe(false);
    expect(result.requiredCount).toBe(0);
    expect(result.reason).toContain('não tem atividades');
  });

  it('atividade cancelada sai do cálculo', () => {
    const result = evaluateFullAttendance({
      activities: [
        activities[0]!,
        { ...activities[1]!, status: 'CANCELED' },
      ],
      attendances: [{ activityId: 'a1', status: 'PRESENT', minutesAttended: 60 }],
      now,
    });

    expect(result.complete).toBe(true);
    expect(result.requiredCount).toBe(1);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A REGRA DE PRESENÇA VIROU DADO — leitor tolerante e a regra com política
 *  (FASE 86 · fatia 5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. `readCertificatePolicy` devolve o PADRÃO quando não há configuração, aceita
 *     uma configuração válida e RECUSA cada valor perigoso com o motivo escrito —
 *     sem lançar, porque `settings` é campo livre e a emissão não pode cair por
 *     causa de um JSON torto;
 *  2. os limites são INCLUSIVOS nas bordas (0,5 e 1,0; 1 e 240) e as recusas
 *     incluem 0 (que emitiria para quem não participou), `requireCheckOut: false`
 *     (que dispensaria a prova da saída) e a agregação por LINHA (dívida E92);
 *  3. `computeWorkload`/`evaluateEligibility` recebem a política como parâmetro
 *     OPCIONAL, e o default reproduz EXATAMENTE os números de hoje — os mesmos
 *     casos que já estavam travados em `certificate-rules.test.ts`;
 *  4. uma política mais exigente muda quem passa, e o texto da recusa acompanha o
 *     percentual (90 % não pode recusar dizendo 75 %);
 *  5. o detalhamento congelado guarda a política e lê o formato ANTIGO (lista pura)
 *     sem quebrar documento já emitido.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  CERTIFICATE_POLICY_LIMITS,
  policyDefaults,
  policyPercent,
  readCertificatePolicy,
  type CertificatePolicy,
} from '../../src/domain/certificates/certificate-policy-rules';
import {
  buildWorkloadBreakdown,
  computeWorkload,
  evaluateEligibility,
  readWorkloadBreakdown,
  type AttendanceRecord,
  type EligibilityFacts,
  type WorkloadBreakdownEntry,
} from '../../src/domain/certificates/certificate-rules';

function attendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    activityId: 'atividade-1',
    activityTitle: 'Minicurso de Rust',
    activityType: 'MINI_COURSE',
    workloadMinutes: 240,
    minutesAttended: 240,
    ...overrides,
  };
}

function facts(overrides: Partial<EligibilityFacts> = {}): Omit<EligibilityFacts, 'kind'> {
  return {
    attendances: [attendance()],
    eventCheckedIn: true,
    miniCourseCount: 1,
    isSpeaker: false,
    speakerWorkload: null,
    completedReviews: 0,
    acceptedSubmissions: 0,
    eventFinished: true,
    ...overrides,
  };
}

function policy(overrides: Partial<CertificatePolicy> = {}): CertificatePolicy {
  return { ...policyDefaults(), ...overrides };
}

function entry(overrides: Partial<WorkloadBreakdownEntry> = {}): WorkloadBreakdownEntry {
  return {
    activityId: 'atividade-1',
    title: 'Minicurso de Rust',
    type: 'MINI_COURSE',
    minutesAttended: 240,
    workloadMinutes: 240,
    countedMinutes: 240,
    counted: true,
    reason: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('readCertificatePolicy() — o padrão e o válido', () => {
  it('sem settings, devolve o padrão SEM problema (evento nunca configurado)', () => {
    for (const settings of [undefined, null, {}]) {
      const read = readCertificatePolicy(settings);

      expect(read.problems).toEqual([]);
      expect(read.policy).toEqual({
        minRatio: 0.75,
        minMinutes: 30,
        requireCheckOut: true,
        aggregateBy: 'ACTIVITY',
      });
    }
  });

  it('aceita uma política válida e não mexe nas OUTRAS chaves do settings', () => {
    const settings = {
      registrationRequiresMembership: true,
      registrationForm: [{ key: 'nome' }],
      certificatePolicy: {
        minRatio: 0.9,
        minMinutes: 60,
        requireCheckOut: true,
        aggregateBy: 'ACTIVITY',
      },
    };

    const read = readCertificatePolicy(settings);

    expect(read.problems).toEqual([]);
    expect(read.policy).toEqual({
      minRatio: 0.9,
      minMinutes: 60,
      requireCheckOut: true,
      aggregateBy: 'ACTIVITY',
    });
    // O leitor é PURO: o JSON do evento continua exatamente como estava.
    expect(settings.registrationRequiresMembership).toBe(true);
    expect(settings.registrationForm).toEqual([{ key: 'nome' }]);
  });

  it('os limites são INCLUSIVOS nas duas bordas', () => {
    const minimo = readCertificatePolicy({
      certificatePolicy: {
        minRatio: CERTIFICATE_POLICY_LIMITS.minRatio.min,
        minMinutes: CERTIFICATE_POLICY_LIMITS.minMinutes.min,
      },
    });
    const maximo = readCertificatePolicy({
      certificatePolicy: {
        minRatio: CERTIFICATE_POLICY_LIMITS.minRatio.max,
        minMinutes: CERTIFICATE_POLICY_LIMITS.minMinutes.max,
      },
    });

    expect(minimo.problems).toEqual([]);
    expect(minimo.policy).toMatchObject({ minRatio: 0.5, minMinutes: 1 });
    expect(maximo.problems).toEqual([]);
    expect(maximo.policy).toMatchObject({ minRatio: 1, minMinutes: 240 });
  });

  it('configuração PARCIAL é válida: o campo ausente cai no padrão sem virar problema', () => {
    const read = readCertificatePolicy({ certificatePolicy: { minRatio: 0.9 } });

    expect(read.problems).toEqual([]);
    expect(read.policy).toEqual({
      minRatio: 0.9,
      minMinutes: 30,
      requireCheckOut: true,
      aggregateBy: 'ACTIVITY',
    });
  });

  it('campos desconhecidos são ignorados (o JSON pode evoluir sem quebrar o leitor)', () => {
    const read = readCertificatePolicy({
      certificatePolicy: { minRatio: 0.8, algoDoFuturo: true },
    });

    expect(read.problems).toEqual([]);
    expect(read.policy.minRatio).toBe(0.8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('readCertificatePolicy() — cada recusa, com o motivo', () => {
  it('minRatio 0 é RECUSADO de propósito (emitiria para quem não participou)', () => {
    const read = readCertificatePolicy({ certificatePolicy: { minRatio: 0 } });

    expect(read.policy.minRatio).toBe(0.75);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toContain('minRatio = 0');
    expect(read.problems[0]).toContain('fora da faixa permitida');
    expect(read.problems[0]).toContain('0,75');
  });

  it('minRatio acima de 1,1 é RECUSADO (a atividade nunca seria cumprida)', () => {
    const read = readCertificatePolicy({ certificatePolicy: { minRatio: 1.1 } });

    expect(read.policy.minRatio).toBe(0.75);
    expect(read.problems[0]).toContain('minRatio = 1,1');
  });

  it('minRatio que não é número é RECUSADO em vez de coagido', () => {
    const read = readCertificatePolicy({ certificatePolicy: { minRatio: '0.9' } });

    expect(read.policy.minRatio).toBe(0.75);
    expect(read.problems[0]).toContain('deveria ser um número');
  });

  it('minMinutes 0 é RECUSADO (sem piso, qualquer minutagem valeria)', () => {
    const read = readCertificatePolicy({ certificatePolicy: { minMinutes: 0 } });

    expect(read.policy.minMinutes).toBe(30);
    expect(read.problems[0]).toContain('minMinutes = 0');
    expect(read.problems[0]).toContain('fora da faixa permitida');
  });

  it('minMinutes acima de 240 é RECUSADO', () => {
    const read = readCertificatePolicy({ certificatePolicy: { minMinutes: 241 } });

    expect(read.policy.minMinutes).toBe(30);
    expect(read.problems[0]).toContain('minMinutes = 241');
  });

  it('minMinutes fracionário é RECUSADO (minuto é unidade inteira)', () => {
    const read = readCertificatePolicy({ certificatePolicy: { minMinutes: 30.5 } });

    expect(read.policy.minMinutes).toBe(30);
    expect(read.problems[0]).toContain('número inteiro');
  });

  it('requireCheckOut: false é RECUSADO — o check-out é a prova da saída', () => {
    const read = readCertificatePolicy({ certificatePolicy: { requireCheckOut: false } });

    expect(read.policy.requireCheckOut).toBe(true);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toContain('requireCheckOut = false');
    expect(read.problems[0]).toContain('check-out');
  });

  it('requireCheckOut que não é booleano é RECUSADO', () => {
    const read = readCertificatePolicy({ certificatePolicy: { requireCheckOut: 'false' } });

    expect(read.policy.requireCheckOut).toBe(true);
    expect(read.problems[0]).toContain('deveria ser um booleano');
  });

  it('aggregateBy diferente de ACTIVITY é RECUSADO (a LINHA era a dívida E92)', () => {
    const read = readCertificatePolicy({ certificatePolicy: { aggregateBy: 'ROW' } });

    expect(read.policy.aggregateBy).toBe('ACTIVITY');
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toContain('aggregateBy = "ROW"');
    expect(read.problems[0]).toContain('E92');
  });

  it('vários campos inválidos produzem UM problema por campo, e cada um cai no padrão', () => {
    const read = readCertificatePolicy({
      certificatePolicy: { minRatio: 0, minMinutes: 0, requireCheckOut: false, aggregateBy: 'ROW' },
    });

    expect(read.problems).toHaveLength(4);
    expect(read.policy).toEqual(policyDefaults());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('readCertificatePolicy() — settings corrompido não lança', () => {
  it('settings que não é objeto vira padrão com problema declarado', () => {
    for (const settings of ['texto', 42, [], true]) {
      const read = readCertificatePolicy(settings);

      expect(read.policy).toEqual(policyDefaults());
      expect(read.problems).toHaveLength(1);
      expect(read.problems[0]).toContain('settings do evento deveria ser um objeto');
    }
  });

  it('certificatePolicy que não é objeto vira padrão com problema declarado', () => {
    for (const certificatePolicy of [[], '75%', 1]) {
      const read = readCertificatePolicy({ certificatePolicy });

      expect(read.policy).toEqual(policyDefaults());
      expect(read.problems).toHaveLength(1);
      expect(read.problems[0]).toContain('certificatePolicy deveria ser um objeto');
    }
  });

  it('certificatePolicy nulo é "sem configuração", não erro', () => {
    const read = readCertificatePolicy({ certificatePolicy: null });

    expect(read.policy).toEqual(policyDefaults());
    expect(read.problems).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a regra com a política: o DEFAULT é o comportamento de sempre', () => {
  /**
   * A tabela é a MESMA dos casos de `certificate-rules.test.ts`. Ela existe aqui
   * para que a prova "o default não mudou nada" seja lida ao lado da política, e
   * não inferida de outro arquivo.
   */
  const casos = [
    { rotulo: 'soma duas atividades', records: [attendance({ minutesAttended: 120, workloadMinutes: 120 }), attendance({ activityId: 'b', minutesAttended: 90, workloadMinutes: 120 })], total: 210 },
    { rotulo: 'trunca excedente em 240', records: [attendance({ minutesAttended: 300 })], total: 240 },
    { rotulo: '100 de 240 não conta', records: [attendance({ minutesAttended: 100 })], total: 0 },
    { rotulo: 'atividade sem carga usa o piso de 30', records: [attendance({ workloadMinutes: 0, minutesAttended: 30 })], total: 30 },
    { rotulo: 'atividade sem carga abaixo do piso não conta', records: [attendance({ workloadMinutes: 0, minutesAttended: 20 })], total: 0 },
    { rotulo: 'minutos negativos não viram carga', records: [attendance({ minutesAttended: -50 })], total: 0 },
  ];

  for (const caso of casos) {
    it(`${caso.rotulo}: sem política e com policyDefaults() dão o MESMO total`, () => {
      const semPolitica = computeWorkload({ attendances: caso.records });
      const comDefault = computeWorkload({ attendances: caso.records }, policyDefaults());

      expect(semPolitica.totalMinutes).toBe(caso.total);
      expect(comDefault).toEqual(semPolitica);
    });
  }

  it('o texto da recusa padrão continua "75 %" e "180 min" (nada mudou para quem não configura)', () => {
    const result = computeWorkload({ attendances: [attendance({ minutesAttended: 100 })] });

    expect(result.entries[0]?.reason).toBe(
      'Presença de 100 min abaixo do mínimo de 180 min (75 % da carga).',
    );
    expect(evaluateEligibility({ ...facts({ attendances: [attendance({ minutesAttended: 100 })] }), kind: 'ATTENDANCE' }).reason).toBe(
      'Nenhuma atividade com presença suficiente (mínimo de 75 % da carga).',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a regra com a política: uma régua diferente muda quem passa', () => {
  it('0,6 / 60 min aprova quem os 75 % reprovavam (60 de 100)', () => {
    const records = [attendance({ workloadMinutes: 100, minutesAttended: 60 })];

    const padrao = computeWorkload({ attendances: records });
    const branda = computeWorkload({ attendances: records }, policy({ minRatio: 0.6, minMinutes: 60 }));

    // Padrão: max(30, 75) = 75 → 60 não conta.
    expect(padrao.countedActivities).toBe(0);
    // 0,6: max(60, 60) = 60 → 60 conta (a borda é inclusiva).
    expect(branda.countedActivities).toBe(1);
    expect(branda.totalMinutes).toBe(60);

    expect(evaluateEligibility({ ...facts({ attendances: records }), kind: 'ATTENDANCE' }).eligible).toBe(false);
    expect(
      evaluateEligibility({ ...facts({ attendances: records }), kind: 'ATTENDANCE' }, policy({ minRatio: 0.6, minMinutes: 60 })).eligible,
    ).toBe(true);
  });

  it('um piso MAIOR reprova quem passava (190 de 240: 75 % passa, piso 200 não)', () => {
    const records = [attendance({ workloadMinutes: 240, minutesAttended: 190 })];

    const padrao = computeWorkload({ attendances: records });
    const exigente = computeWorkload({ attendances: records }, policy({ minMinutes: 200 }));

    expect(padrao.totalMinutes).toBe(190);
    expect(exigente.totalMinutes).toBe(0);
    expect(exigente.entries[0]?.counted).toBe(false);
  });

  it('a política 0,9 recusa quem passa nos 75 % e o motivo cita 90 %', () => {
    // 48 de 60: 80 % da carga — passa em 75 %, falha em 90 %.
    const records = [attendance({ workloadMinutes: 60, minutesAttended: 48, activityType: 'LECTURE' })];

    const padrao = evaluateEligibility({ ...facts({ attendances: records }), kind: 'ATTENDANCE' });
    const exigente = evaluateEligibility(
      { ...facts({ attendances: records }), kind: 'ATTENDANCE' },
      policy({ minRatio: 0.9 }),
    );

    expect(padrao.eligible).toBe(true);
    expect(exigente.eligible).toBe(false);
    expect(exigente.reason).toBe('Nenhuma atividade com presença suficiente (mínimo de 90 % da carga).');
  });

  it('MINI_COURSE aplica a política e a mensagem do percentual acompanha', () => {
    const records = [attendance({ workloadMinutes: 60, minutesAttended: 48 })];

    expect(evaluateEligibility({ ...facts({ attendances: records }), kind: 'MINI_COURSE' }).eligible).toBe(true);

    const exigente = evaluateEligibility(
      { ...facts({ attendances: records }), kind: 'MINI_COURSE' },
      policy({ minRatio: 0.9 }),
    );

    expect(exigente.eligible).toBe(false);
    expect(exigente.reason).toContain('90 %');
  });

  it('minRatio 0,5 e 1,0 são aceitos pela regra (as bordas não viram surpresa)', () => {
    const metade = computeWorkload(
      { attendances: [attendance({ workloadMinutes: 60, minutesAttended: 30 })] },
      policy({ minRatio: 0.5, minMinutes: 1 }),
    );
    const integral = computeWorkload(
      { attendances: [attendance({ workloadMinutes: 60, minutesAttended: 60 })] },
      policy({ minRatio: 1, minMinutes: 1 }),
    );

    expect(metade.totalMinutes).toBe(30);
    expect(integral.totalMinutes).toBe(60);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o detalhamento congelado', () => {
  it('guarda a política e as entradas — é o que responde "por que 40 h"', () => {
    const applied = policy({ minRatio: 0.9, minMinutes: 60 });
    const snapshot = buildWorkloadBreakdown(applied, [entry()]);

    expect(snapshot.policy).toEqual(applied);
    expect(snapshot.entries).toEqual([entry()]);

    const read = readWorkloadBreakdown(snapshot);

    expect(read.policy).toEqual(applied);
    expect(read.entries).toEqual([entry()]);
  });

  it('lê o formato ANTIGO (lista pura) sem inventar política', () => {
    const read = readWorkloadBreakdown([entry()]);

    expect(read.entries).toEqual([entry()]);
    // `null` = documento anterior ao congelamento — diferente de "a política era a
    // padrão", que seria uma afirmação que o documento não faz.
    expect(read.policy).toBeNull();
  });

  it('JSON corrompido devolve lista vazia em vez de lançar', () => {
    for (const raw of [null, 'texto', 42, [], {}]) {
      const read = readWorkloadBreakdown(raw);

      expect(Array.isArray(read.entries)).toBe(true);
    }
  });

  it('política adulterada no JSON passa pelo leitor tolerante (o detalhamento não é assinado)', () => {
    const read = readWorkloadBreakdown({
      policy: { minRatio: 0, minMinutes: 0 },
      entries: [entry()],
    });

    // O que o documento AFIRMA (workloadMinutes) é assinado; a explicação não. O
    // leitor não deixa um 0 % virar régua na tela.
    expect(read.policy?.minRatio).toBe(0.75);
    expect(read.policy?.minMinutes).toBe(30);
    expect(read.entries).toHaveLength(1);
  });
});

describe('policyPercent()', () => {
  it('converte a fração no percentual que a tela e a mensagem mostram', () => {
    expect(policyPercent(0.75)).toBe(75);
    expect(policyPercent(0.9)).toBe(90);
    expect(policyPercent(0.5)).toBe(50);
    expect(policyPercent(1)).toBe(100);
  });
});

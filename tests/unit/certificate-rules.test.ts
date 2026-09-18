/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — regras de certificação
 *
 *  Certificado é DOCUMENTO: um erro aqui vira um documento errado na mão de
 *  alguém. Os testes cobrem carga horária real, elegibilidade e o código de
 *  validação (que é a chave de prova de autenticidade).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  CERTIFICATE_KINDS,
  MIN_ATTENDANCE_MINUTES,
  VALIDATION_ALPHABET,
  VALIDATION_CODE_LENGTH,
  VALIDATION_CODE_PREFIX,
  buildCanonicalPayload,
  buildCertificateText,
  computeWorkload,
  eligibleKindsFor,
  evaluateEligibility,
  evaluateValidation,
  formatPeriod,
  formatWorkload,
  generateValidationCode,
  hashCanonicalPayload,
  isValidValidationCodeFormat,
  normalizeValidationCode,
  type AttendanceRecord,
  type CanonicalCertificate,
  type EligibilityFacts,
} from '../../src/domain/certificates/certificate-rules';

const TZ = 'America/Bahia';

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
    /**
     * FASE 25: o evento já terminou nos fatos padrão — é o estado em que a maioria dos
     * certificados é emitida. Os casos de "ainda não terminou" passam o valor explícito.
     */
    eventFinished: true,
    ...overrides,
  };
}

/** Fatos de palestrante com carga apurada (FASE 25). */
function speakerFacts(
  overrides: Partial<EligibilityFacts> = {},
): Omit<EligibilityFacts, 'kind'> {
  return facts({
    isSpeaker: true,
    speakerWorkload: {
      totalMinutes: 240,
      countedActivities: 1,
      declaredMinutes: 240,
      entries: [
        {
          activityId: 'atividade-1',
          title: 'Minicurso de Rust',
          type: null,
          minutesAttended: 240,
          workloadMinutes: 240,
          countedMinutes: 240,
          counted: true,
          reason: null,
        },
      ],
    },
    ...overrides,
  });
}

/** `randomInt` determinístico (devolve sempre o primeiro símbolo). */
const firstSymbol = () => 0;
const lastSymbol = (max: number) => max - 1;

// ═══════════════════════════════════════════════════════════════════════════════
describe('computeWorkload()', () => {
  it('soma os minutos das presenças suficientes', () => {
    const result = computeWorkload({
      attendances: [
        attendance({ activityId: 'a', minutesAttended: 120, workloadMinutes: 120 }),
        attendance({ activityId: 'b', minutesAttended: 90, workloadMinutes: 120 }),
      ],
    });

    expect(result.totalMinutes).toBe(210);
    expect(result.countedActivities).toBe(2);
  });

  it('TRUNCA os minutos excedentes na carga declarada', () => {
    // Ficar 300 minutos em um minicurso de 240 não dá 300 minutos de minicurso.
    const result = computeWorkload({
      attendances: [attendance({ minutesAttended: 300, workloadMinutes: 240 })],
    });

    expect(result.totalMinutes).toBe(240);
    expect(result.entries[0]?.countedMinutes).toBe(240);
    expect(result.entries[0]?.reason).toMatch(/excedentes/i);
  });

  it('descarta presença abaixo do mínimo e EXPLICA o motivo', () => {
    const result = computeWorkload({
      attendances: [attendance({ minutesAttended: 100, workloadMinutes: 240 })],
    });

    expect(result.totalMinutes).toBe(0);
    expect(result.countedActivities).toBe(0);
    expect(result.entries[0]?.counted).toBe(false);
    expect(result.entries[0]?.reason).toMatch(/180 min/);
  });

  it('usa o piso de minutos quando a atividade não declara carga', () => {
    const short = computeWorkload({
      attendances: [attendance({ workloadMinutes: 0, minutesAttended: 20 })],
    });
    const enough = computeWorkload({
      attendances: [attendance({ workloadMinutes: 0, minutesAttended: MIN_ATTENDANCE_MINUTES })],
    });

    expect(short.totalMinutes).toBe(0);
    expect(enough.totalMinutes).toBe(MIN_ATTENDANCE_MINUTES);
  });

  it('separa o que não se aplica ao tipo do certificado', () => {
    const result = computeWorkload({
      attendances: [
        attendance({ activityId: 'mc', activityType: 'MINI_COURSE', minutesAttended: 240, workloadMinutes: 240 }),
        attendance({ activityId: 'pal', activityType: 'LECTURE', minutesAttended: 60, workloadMinutes: 60 }),
      ],
      activityFilter: (record) => record.activityType === 'MINI_COURSE',
    });

    expect(result.totalMinutes).toBe(240);
    expect(result.countedActivities).toBe(1);
    expect(result.entries[1]?.reason).toMatch(/não se aplica/i);
  });

  it('ignora minutos negativos (dado inconsistente não vira carga)', () => {
    const result = computeWorkload({
      attendances: [attendance({ minutesAttended: -50, workloadMinutes: 240 })],
    });

    expect(result.totalMinutes).toBe(0);
  });

  it('lista vazia não inventa carga', () => {
    const result = computeWorkload({ attendances: [] });
    expect(result.totalMinutes).toBe(0);
    expect(result.entries).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('formatWorkload()', () => {
  it('formata em horas e minutos', () => {
    expect(formatWorkload(0)).toBe('0min');
    expect(formatWorkload(45)).toBe('45min');
    expect(formatWorkload(60)).toBe('1h');
    expect(formatWorkload(150)).toBe('2h30');
    expect(formatWorkload(600)).toBe('10h');
  });

  it('tolera valor negativo', () => {
    expect(formatWorkload(-30)).toBe('0min');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateEligibility()', () => {
  it('MINI_COURSE exige minicurso com presença suficiente', () => {
    const ok = evaluateEligibility({ ...facts(), kind: 'MINI_COURSE' });
    expect(ok.eligible).toBe(true);

    const shortAttendance = evaluateEligibility({
      ...facts({ attendances: [attendance({ minutesAttended: 60 })] }),
      kind: 'MINI_COURSE',
    });
    expect(shortAttendance.eligible).toBe(false);
    expect(shortAttendance.reason).toMatch(/75 %/);
  });

  it('MINI_COURSE recusa evento sem minicursos', () => {
    const verdict = evaluateEligibility({
      ...facts({ miniCourseCount: 0, attendances: [attendance({ activityType: 'LECTURE' })] }),
      kind: 'MINI_COURSE',
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/não tem minicursos/i);
  });

  it('ATTENDANCE exige ao menos uma atividade cumprida', () => {
    expect(evaluateEligibility({ ...facts(), kind: 'ATTENDANCE' }).eligible).toBe(true);

    const none = evaluateEligibility({
      ...facts({ attendances: [] }),
      kind: 'ATTENDANCE',
    });
    expect(none.eligible).toBe(false);
  });

  it('PARTICIPATION aceita credenciamento sem atividade', () => {
    const verdict = evaluateEligibility({
      ...facts({ attendances: [], eventCheckedIn: true }),
      kind: 'PARTICIPATION',
    });

    expect(verdict.eligible).toBe(true);
  });

  it('PARTICIPATION recusa quem não tem credenciamento nem presença', () => {
    const verdict = evaluateEligibility({
      ...facts({ attendances: [], eventCheckedIn: false }),
      kind: 'PARTICIPATION',
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/credenciamento/i);
  });

  it('SPEAKER exige constar como palestrante', () => {
    expect(evaluateEligibility({ ...speakerFacts(), kind: 'SPEAKER' }).eligible).toBe(true);
    expect(evaluateEligibility({ ...facts(), kind: 'SPEAKER' }).eligible).toBe(false);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  FASE 25: O CERTIFICADO DE PALESTRANTE DECLARA FATO CONSUMADO
   * ─────────────────────────────────────────────────────────────────────────────
   *  As três recusas novas, cada uma com motivo próprio: antes do fim do evento,
   *  sem credenciamento registrado no balcão e sem nenhuma atividade apurada. A
   *  mensagem diz QUAL falta — "não elegível" sem motivo obrigaria o palestrante a
   *  abrir um chamado para descobrir que faltou o credenciamento.
   */
  it('SPEAKER recusa antes do término do evento', () => {
    const verdict = evaluateEligibility({
      ...speakerFacts({ eventFinished: false }),
      kind: 'SPEAKER',
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/após o término/i);
  });

  it('SPEAKER recusa sem credenciamento registrado no evento', () => {
    const verdict = evaluateEligibility({
      ...speakerFacts({ eventCheckedIn: false }),
      kind: 'SPEAKER',
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/credenciamento/i);
  });

  it('SPEAKER recusa quando nenhuma atividade ministrada entrou na apuração', () => {
    const verdict = evaluateEligibility({
      ...speakerFacts({
        speakerWorkload: {
          totalMinutes: 0,
          countedActivities: 0,
          declaredMinutes: 0,
          entries: [
            {
              activityId: 'a',
              title: 'Minicurso cancelado',
              type: null,
              minutesAttended: 0,
              workloadMinutes: 240,
              countedMinutes: 0,
              counted: false,
              reason: 'Atividade cancelada.',
            },
          ],
        },
      }),
      kind: 'SPEAKER',
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/nenhuma atividade ministrada/i);
  });

  it('REVIEWER exige parecer concluído', () => {
    const ok = evaluateEligibility({ ...facts({ completedReviews: 2 }), kind: 'REVIEWER' });
    expect(ok.eligible).toBe(true);
    expect(ok.reason).toMatch(/2 parecer/);

    expect(evaluateEligibility({ ...facts(), kind: 'REVIEWER' }).eligible).toBe(false);
  });

  it('AUTHOR exige trabalho aceito', () => {
    expect(evaluateEligibility({ ...facts({ acceptedSubmissions: 1 }), kind: 'AUTHOR' }).eligible).toBe(true);
    expect(evaluateEligibility({ ...facts(), kind: 'AUTHOR' }).eligible).toBe(false);
  });

  it('ORGANIZER não depende de presença (quem organiza pode não assistir)', () => {
    const verdict = evaluateEligibility({
      ...facts({ attendances: [], eventCheckedIn: false }),
      kind: 'ORGANIZER',
    });

    expect(verdict.eligible).toBe(true);
  });

  it('MERIT nunca é automático', () => {
    const verdict = evaluateEligibility({ ...facts(), kind: 'MERIT' });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/comitê/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('eligibleKindsFor()', () => {
  it('lista os tipos que os fatos sustentam', () => {
    const kinds = eligibleKindsFor(
      speakerFacts({ completedReviews: 1, acceptedSubmissions: 1 }),
    );

    expect(kinds).toContain('ATTENDANCE');
    expect(kinds).toContain('MINI_COURSE');
    expect(kinds).toContain('PARTICIPATION');
    expect(kinds).toContain('REVIEWER');
    expect(kinds).toContain('AUTHOR');
    expect(kinds).toContain('SPEAKER');
    // Não automáticos.
    expect(kinds).not.toContain('MERIT');
    expect(kinds).not.toContain('ORGANIZER');
  });

  it('sem fatos, não há tipos automáticos', () => {
    const kinds = eligibleKindsFor(
      facts({
        attendances: [],
        eventCheckedIn: false,
        miniCourseCount: 0,
      }),
    );

    expect(kinds).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('texto do certificado', () => {
  it('monta o corpo com carga horária e período', () => {
    const text = buildCertificateText({
      kind: 'MINI_COURSE',
      recipientName: 'Ana Ribeiro',
      eventTitle: 'Congresso 2026',
      eventStartsAt: new Date('2026-09-17T12:00:00.000Z'),
      eventEndsAt: new Date('2026-09-17T21:00:00.000Z'),
      workloadMinutes: 240,
      activityTitle: 'Minicurso de Rust',
      tenantName: 'UFBA',
      timeZone: TZ,
    });

    expect(text.title).toBe('Certificado de conclusão de minicurso');
    expect(text.bodyText).toContain('Ana Ribeiro');
    expect(text.bodyText).toContain('Minicurso de Rust');
    expect(text.bodyText).toContain('4h');
    expect(text.workloadLabel).toBe('4h');
    expect(text.period).toContain('2026');
  });

  it('formata período de vários dias com "a"', () => {
    const period = formatPeriod(
      new Date('2026-09-17T12:00:00.000Z'),
      new Date('2026-09-19T12:00:00.000Z'),
      TZ,
    );

    expect(period).toMatch(/ a /);
  });

  it('sem data de início, não inventa período', () => {
    expect(formatPeriod(null, null, TZ)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('código de validação', () => {
  it('usa alfabeto sem caracteres ambíguos', () => {
    // Pares que se confundem na leitura em voz alta e na transcrição à mão.
    for (const ambiguous of ['0', 'O', '1', 'I', 'L', 'S', 'Z']) {
      expect(VALIDATION_ALPHABET, `alfabeto não pode conter ${ambiguous}`).not.toContain(ambiguous);
    }
  });

  it('gera código com prefixo e tamanho fixos', () => {
    const code = generateValidationCode(firstSymbol);
    expect(code).toBe(`${VALIDATION_CODE_PREFIX}${'2'.repeat(VALIDATION_CODE_LENGTH)}`);

    const last = generateValidationCode(lastSymbol);
    expect(last).toBe(`${VALIDATION_CODE_PREFIX}${'Y'.repeat(VALIDATION_CODE_LENGTH)}`);
  });

  it('alcança TODOS os símbolos do alfabeto', () => {
    // Prova que nenhum símbolo é inalcançável (um erro de índice o tornaria
    // morto, reduzindo o espaço de códigos sem ninguém perceber).
    [...VALIDATION_ALPHABET].forEach((symbol, index) => {
      const code = generateValidationCode(() => index);
      expect(code).toBe(`${VALIDATION_CODE_PREFIX}${symbol.repeat(VALIDATION_CODE_LENGTH)}`);
    });
  });

  it('normaliza caixa, espaços e o prefixo', () => {
    expect(normalizeValidationCode(' cert-abcd2345 ')).toBe('CERT-ABCD2345');
    expect(normalizeValidationCode('ABCD2345')).toBe('CERT-ABCD2345');
    expect(normalizeValidationCode('CERT ABCD 2345')).toBe('CERT-ABCD2345');
  });

  it('valida o formato', () => {
    expect(isValidValidationCodeFormat('CERT-ABCD2345')).toBe(true);
    expect(isValidValidationCodeFormat('ABCD2345')).toBe(true);
    // Curto, longo demais ou com símbolo fora do alfabeto.
    expect(isValidValidationCodeFormat('CERT-ABCD234')).toBe(false);
    expect(isValidValidationCodeFormat('CERT-ABCD23456')).toBe(false);
    expect(isValidValidationCodeFormat('CERT-ABCDO345')).toBe(false);
  });

  it('NÃO corrige caractere parecido para outro código', () => {
    /**
     * Mapear `O`→`Q` transformaria um erro de digitação em OUTRO código válido,
     * possivelmente de outra pessoa. O formato simplesmente reprova.
     */
    expect(isValidValidationCodeFormat('CERT-ABCQ2345')).toBe(true);
    expect(normalizeValidationCode('CERT-ABCO2345')).toBe('CERT-ABCO2345');
    expect(isValidValidationCodeFormat('CERT-ABCO2345')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('conteúdo canônico e hash', () => {
  const canonical: CanonicalCertificate = {
    version: 1,
    validationCode: 'CERT-ABCD2345',
    tenantId: 'tenant-1',
    eventId: 'evento-1',
    userId: 'user-1',
    activityId: null,
    kind: 'ATTENDANCE',
    recipientName: 'Ana Ribeiro',
    title: 'Certificado',
    bodyText: 'Certificamos que Ana Ribeiro participou do evento.',
    workloadMinutes: 240,
    issuedAt: '2026-09-20T12:00:00.000Z',
  };

  it('o payload é estável e determinístico', () => {
    expect(buildCanonicalPayload(canonical)).toBe(buildCanonicalPayload({ ...canonical }));
  });

  it('normaliza espaços nas bordas do texto', () => {
    const withSpaces = buildCanonicalPayload({
      ...canonical,
      recipientName: '  Ana Ribeiro  ',
      bodyText: '  Certificamos que Ana Ribeiro participou do evento.  ',
    });

    expect(withSpaces).toBe(buildCanonicalPayload(canonical));
  });

  it('o hash muda quando QUALQUER campo do conteúdo muda', () => {
    const base = hashCanonicalPayload(buildCanonicalPayload(canonical));

    const changes: Partial<CanonicalCertificate>[] = [
      { recipientName: 'Bruno Souza' },
      { workloadMinutes: 241 },
      { kind: 'MINI_COURSE' },
      { validationCode: 'CERT-ABCD2346' },
      { issuedAt: '2026-09-21T12:00:00.000Z' },
      { bodyText: 'outro texto' },
    ];

    for (const change of changes) {
      const hash = hashCanonicalPayload(buildCanonicalPayload({ ...canonical, ...change }));
      expect(hash, `mudança não detectada: ${JSON.stringify(change)}`).not.toBe(base);
    }
  });

  it('o hash é SHA-256 em hexadecimal', () => {
    const hash = hashCanonicalPayload(buildCanonicalPayload(canonical));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateValidation()', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('código inexistente é NOT_FOUND', () => {
    const verdict = evaluateValidation({
      found: false,
      status: null,
      revokedAt: null,
      revokedReason: null,
      expiresAt: null,
      now,
    });

    expect(verdict.status).toBe('NOT_FOUND');
    expect(verdict.isUsable).toBe(false);
  });

  it('certificado emitido e vigente é válido', () => {
    const verdict = evaluateValidation({
      found: true,
      status: 'ISSUED',
      revokedAt: null,
      revokedReason: null,
      expiresAt: null,
      now,
    });

    expect(verdict.status).toBe('VALID');
    expect(verdict.isUsable).toBe(true);
  });

  it('revogação tem precedência e explica o motivo', () => {
    const verdict = evaluateValidation({
      found: true,
      status: 'ISSUED',
      revokedAt: new Date('2026-09-19T12:00:00.000Z'),
      revokedReason: 'Presença não comprovada em auditoria.',
      expiresAt: null,
      now,
    });

    expect(verdict.status).toBe('REVOKED');
    expect(verdict.isUsable).toBe(false);
    expect(verdict.message).toContain('Presença não comprovada');
  });

  it('expiração torna o documento inutilizável', () => {
    const verdict = evaluateValidation({
      found: true,
      status: 'ISSUED',
      revokedAt: null,
      revokedReason: null,
      expiresAt: new Date('2026-09-19T12:00:00.000Z'),
      now,
    });

    expect(verdict.status).toBe('EXPIRED');
  });

  it('certificado ainda em processamento é orientado a tentar de novo', () => {
    for (const status of ['QUEUED', 'GENERATING']) {
      const verdict = evaluateValidation({
        found: true,
        status,
        revokedAt: null,
        revokedReason: null,
        expiresAt: null,
        now,
      });

      expect(verdict.status).toBe('NOT_ISSUED');
      expect(verdict.message).toMatch(/processamento/i);
    }
  });

  it('cobre todos os tipos como válidos no formato de código', () => {
    expect(CERTIFICATE_KINDS.length).toBe(8);
  });
});

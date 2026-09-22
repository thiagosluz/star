import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_PLACE_MAX,
  CONFIRMATION_POLICIES,
  CONFIRMATION_POLICY_LABELS,
  CONFIRMATION_REQUIREMENTS_MAX,
  CONFIRMATION_REQUIREMENT_KINDS,
  CONFIRMATION_REQUIREMENT_KIND_LABELS,
  CONFIRMATION_REMINDER_LEAD_HOURS,
  CONFIRMATION_WINDOW_MAX_DAYS,
  CONFIRMATION_WINDOW_MIN_DAYS,
  DEFAULT_CONFIRMATION_POLICY,
  EXPIRY_CANCEL_REASON,
  canConfirmRegistration,
  clampWindowDays,
  confirmationCountdown,
  confirmationDeadlineLabel,
  confirmationDueAt,
  confirmationRequirementLines,
  confirmationStateOf,
  isConfirmationPolicy,
  parseConfirmationRequirements,
  requirementLabel,
  shouldSendConfirmationReminder,
  validateConfirmationPolicy,
} from '../../src/domain/events/confirmation-rules';

const BAHIA = 'America/Bahia';

describe('catálogo da política de confirmação', () => {
  it('toda política tem rótulo, e o padrão é a vaga automática', () => {
    for (const policy of CONFIRMATION_POLICIES) {
      expect(CONFIRMATION_POLICY_LABELS[policy], policy).toBeTruthy();
    }

    /**
     * O padrão preserva o comportamento de tudo o que já existe: atividade sem
     * escolha explícita continua confirmando a vaga no ato da inscrição.
     */
    expect(DEFAULT_CONFIRMATION_POLICY).toBe('AUTO');
  });

  it('todo tipo de exigência tem rótulo', () => {
    for (const kind of CONFIRMATION_REQUIREMENT_KINDS) {
      expect(CONFIRMATION_REQUIREMENT_KIND_LABELS[kind], kind).toBeTruthy();
    }
  });

  it('reconhece política válida e recusa o resto', () => {
    expect(isConfirmationPolicy('AUTO')).toBe(true);
    expect(isConfirmationPolicy('REQUIRED')).toBe(true);
    expect(isConfirmationPolicy('auto')).toBe(false);
    expect(isConfirmationPolicy('')).toBe(false);
    expect(isConfirmationPolicy(null)).toBe(false);
    expect(isConfirmationPolicy(7)).toBe(false);
  });
});

describe('validação da política', () => {
  const exigencia = [{ kind: 'DONATION', label: '1 kg de alimento não perecível', note: null }];

  it('AUTO descarta os campos de confirmação em vez de guardá-los', () => {
    const result = validateConfirmationPolicy({
      policy: 'AUTO',
      windowDays: 3,
      requirements: exigencia,
      place: 'Secretaria',
      instructions: 'Traga o comprovante',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.windowDays).toBeNull();
    expect(result.requirements).toEqual([]);
    expect(result.place).toBeNull();
    expect(result.instructions).toBeNull();
  });

  it('sem escolha explícita, cai no padrão AUTO', () => {
    const result = validateConfirmationPolicy({
      policy: undefined,
      windowDays: undefined,
      requirements: undefined,
      place: undefined,
      instructions: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.policy).toBe('AUTO');
  });

  it('REQUIRED sem exigência E sem local é recusado — o aviso não teria como ser obedecido', () => {
    const result = validateConfirmationPolicy({
      policy: 'REQUIRED',
      windowDays: 3,
      requirements: [],
      place: '',
      instructions: 'Confirme, por favor',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.message).toMatch(/o que é preciso|onde/i);
  });

  it('REQUIRED com exigência, sem local, é aceito', () => {
    const result = validateConfirmationPolicy({
      policy: 'REQUIRED',
      windowDays: 2,
      requirements: exigencia,
      place: '',
      instructions: '',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requirements).toHaveLength(1);
  });

  it('REQUIRED só com o local também é aceito', () => {
    const result = validateConfirmationPolicy({
      policy: 'REQUIRED',
      windowDays: 2,
      requirements: [],
      place: 'Secretaria do bloco B, térreo, das 9h às 18h',
      instructions: '',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.place).toContain('bloco B');
  });

  it('o prazo tem de ser um inteiro dentro da janela, e o extremo é aceito', () => {
    for (const dias of [0, CONFIRMATION_WINDOW_MAX_DAYS + 1]) {
      const result = validateConfirmationPolicy({
        policy: 'REQUIRED',
        windowDays: dias,
        requirements: exigencia,
        place: '',
        instructions: '',
      });

      expect(result.ok, `dias=${dias}`).toBe(false);
    }

    for (const dias of [CONFIRMATION_WINDOW_MIN_DAYS, 7, CONFIRMATION_WINDOW_MAX_DAYS]) {
      const result = validateConfirmationPolicy({
        policy: 'REQUIRED',
        windowDays: dias,
        requirements: exigencia,
        place: '',
        instructions: '',
      });

      expect(result.ok, `dias=${dias}`).toBe(true);
    }

    const fracionado = validateConfirmationPolicy({
      policy: 'REQUIRED',
      windowDays: 2.5,
      requirements: exigencia,
      place: '',
      instructions: '',
    });

    expect(fracionado.ok).toBe(false);
  });

  it('exigência sem tipo ou sem descrição é recusada com o motivo na lista', () => {
    const result = validateConfirmationPolicy({
      policy: 'REQUIRED',
      windowDays: 3,
      requirements: [{ kind: 'NADA', label: 'Alguma coisa', note: null }],
      place: 'Secretaria',
      instructions: '',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.details?.join(' ')).toMatch(/tipo/i);
  });

  it('linha em branco do formulário não conta como exigência nem atrapalha', () => {
    const result = validateConfirmationPolicy({
      policy: 'REQUIRED',
      windowDays: 3,
      requirements: [
        { kind: 'PAYMENT', label: '', note: '' },
        { kind: '', label: '', note: '' },
      ],
      place: 'Secretaria',
      instructions: '',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requirements).toEqual([]);
  });

  it('acima do teto de exigências, recusa dizendo o teto', () => {
    const muitas = Array.from({ length: CONFIRMATION_REQUIREMENTS_MAX + 1 }, (_, index) => ({
      kind: 'ITEM',
      label: `Item ${index}`,
      note: null,
    }));

    const result = validateConfirmationPolicy({
      policy: 'REQUIRED',
      windowDays: 3,
      requirements: muitas,
      place: 'Secretaria',
      instructions: '',
    });

    expect(result.ok).toBe(false);
  });

  it('texto longo é cortado na normalização, não recusado', () => {
    const result = validateConfirmationPolicy({
      policy: 'REQUIRED',
      windowDays: 3,
      requirements: [],
      place: 'x'.repeat(CONFIRMATION_PLACE_MAX + 50),
      instructions: '',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.place).toHaveLength(CONFIRMATION_PLACE_MAX);
  });
});

describe('leitura das exigências gravadas', () => {
  it('descarta linha inválida em vez de derrubar a leitura', () => {
    const parsed = parseConfirmationRequirements([
      { kind: 'DONATION', label: ' 1 kg de alimento ', note: '  ' },
      { kind: 'INVENTADO', label: 'nada' },
      { kind: 'ITEM', label: '   ' },
      'texto solto',
      null,
      { kind: 'PAYMENT', label: 'Taxa de R$ 30', note: 'Pix na secretaria' },
    ]);

    expect(parsed).toEqual([
      { kind: 'DONATION', label: '1 kg de alimento', note: null },
      { kind: 'PAYMENT', label: 'Taxa de R$ 30', note: 'Pix na secretaria' },
    ]);
  });

  it('JSON que não é lista devolve lista vazia', () => {
    expect(parseConfirmationRequirements(null)).toEqual([]);
    expect(parseConfirmationRequirements({ kind: 'ITEM' })).toEqual([]);
    expect(parseConfirmationRequirements('[]')).toEqual([]);
  });

  it('respeita o teto mesmo com dado gravado à mão acima dele', () => {
    const muitas = Array.from({ length: CONFIRMATION_REQUIREMENTS_MAX + 5 }, (_, index) => ({
      kind: 'OTHER',
      label: `Exigência ${index}`,
    }));

    expect(parseConfirmationRequirements(muitas)).toHaveLength(CONFIRMATION_REQUIREMENTS_MAX);
  });

  it('o rótulo da linha junta tipo, descrição e observação', () => {
    expect(
      requirementLabel({ kind: 'PAYMENT', label: 'Taxa de R$ 30', note: 'Pix na secretaria' }),
    ).toBe('Pagamento: Taxa de R$ 30 (Pix na secretaria)');

    expect(requirementLabel({ kind: 'ITEM', label: 'Brinquedo novo', note: null })).toBe(
      'Item: Brinquedo novo',
    );
  });

  it('as linhas do checklist saem na ordem gravada', () => {
    const lines = confirmationRequirementLines([
      { kind: 'DONATION', label: '1 kg de alimento', note: null },
      { kind: 'ITEM', label: 'Brinquedo', note: null },
    ]);

    expect(lines).toEqual(['Doação: 1 kg de alimento', 'Item: Brinquedo']);
  });
});

describe('prazo de confirmação', () => {
  it('vence no FIM DO DIA local, N dias depois da inscrição', () => {
    // 22/09/2026 14:35 em America/Bahia (UTC-3) = 17:35Z.
    const inscricao = new Date('2026-09-22T17:35:00.000Z');
    const due = confirmationDueAt({ registeredAt: inscricao, windowDays: 3, timeZone: BAHIA });

    // 25/09/2026 23:59 em Bahia = 26/09 02:59Z.
    expect(due.toISOString()).toBe('2026-09-26T02:59:00.000Z');
    expect(confirmationDeadlineLabel(due, BAHIA)).toContain('25/09/2026');
  });

  it('quem se inscreve de madrugada ganha o mesmo dia inteiro, não 24 horas corridas', () => {
    const cedo = new Date('2026-09-22T03:05:00.000Z'); // 00:05 em Bahia
    const tarde = new Date('2026-09-22T17:35:00.000Z'); // 14:35 em Bahia

    const primeiro = confirmationDueAt({ registeredAt: cedo, windowDays: 1, timeZone: BAHIA });
    const segundo = confirmationDueAt({ registeredAt: tarde, windowDays: 1, timeZone: BAHIA });

    expect(primeiro.toISOString()).toBe(segundo.toISOString());
    expect(primeiro.toISOString()).toBe('2026-09-24T02:59:00.000Z'); // 23/09 23:59 Bahia
  });

  it('o prazo é do FUSO DO EVENTO, não do processo', () => {
    const inscricao = new Date('2026-09-22T23:30:00.000Z'); // 20:30 em Bahia, 23:30 em UTC

    const bahia = confirmationDueAt({ registeredAt: inscricao, windowDays: 1, timeZone: BAHIA });
    const utc = confirmationDueAt({ registeredAt: inscricao, windowDays: 1, timeZone: 'UTC' });

    expect(bahia.toISOString()).toBe('2026-09-24T02:59:00.000Z');
    expect(utc.toISOString()).toBe('2026-09-23T23:59:00.000Z');
    expect(bahia.getTime()).not.toBe(utc.getTime());
  });

  it('o prazo sobrevive à virada de horário de verão do hemisfério norte', () => {
    // 31/10/2026: a Europa sai do horário de verão (a virada acontece no fim do dia).
    const inscricao = new Date('2026-10-30T10:00:00.000Z');
    const due = confirmationDueAt({
      registeredAt: inscricao,
      windowDays: 3,
      timeZone: 'Europe/Lisbon',
    });

    // 02/11/2026 23:59 em Lisboa já é WET (UTC+0).
    expect(due.toISOString()).toBe('2026-11-02T23:59:00.000Z');
  });

  it('a janela é limitada ao intervalo do domínio', () => {
    expect(clampWindowDays(0)).toBe(CONFIRMATION_WINDOW_MIN_DAYS);
    expect(clampWindowDays(99)).toBe(CONFIRMATION_WINDOW_MAX_DAYS);
    expect(clampWindowDays('7')).toBe(7);
    expect(clampWindowDays(undefined)).toBeGreaterThanOrEqual(CONFIRMATION_WINDOW_MIN_DAYS);
  });

  it('fuso desconhecido não vira data absurda', () => {
    const inscricao = new Date('2026-09-22T17:35:00.000Z');
    const due = confirmationDueAt({ registeredAt: inscricao, windowDays: 1, timeZone: 'Marte/Olympus' });

    expect(Number.isFinite(due.getTime())).toBe(true);
    expect(due.getTime()).toBeGreaterThanOrEqual(inscricao.getTime());
  });

  it('a contagem regressiva fala em dias, horas e vencido', () => {
    const due = new Date('2026-09-25T23:59:00.000Z');

    expect(confirmationCountdown(due, new Date('2026-09-22T23:59:00.000Z'))).toBe('faltam 3 dias');
    expect(confirmationCountdown(due, new Date('2026-09-24T23:59:00.000Z'))).toBe('falta 1 dia');
    expect(confirmationCountdown(due, new Date('2026-09-25T12:00:00.000Z'))).toBe('faltam 11 hora(s)');
    expect(confirmationCountdown(due, new Date('2026-09-26T01:00:00.000Z'))).toBe('prazo vencido');
  });
});

describe('lembrete antes do vencimento', () => {
  const due = new Date('2026-09-25T23:59:00.000Z');

  it('sai quando falta menos que a antecedência e o prazo ainda não venceu', () => {
    const dentro = new Date(due.getTime() - CONFIRMATION_REMINDER_LEAD_HOURS * 3_600_000 + 60_000);

    expect(shouldSendConfirmationReminder({ dueAt: due, now: dentro, alreadyReminded: false })).toBe(
      true,
    );
  });

  it('não sai cedo demais', () => {
    const cedo = new Date(due.getTime() - (CONFIRMATION_REMINDER_LEAD_HOURS + 5) * 3_600_000);

    expect(shouldSendConfirmationReminder({ dueAt: due, now: cedo, alreadyReminded: false })).toBe(
      false,
    );
  });

  it('não sai duas vezes — a chave é o lembrete, não a passada da varredura', () => {
    expect(shouldSendConfirmationReminder({ dueAt: due, now: due, alreadyReminded: true })).toBe(
      false,
    );
  });

  it('NÃO sai depois do vencimento: "corra, falta 1 dia" para quem já perdeu a vaga é falso', () => {
    const depois = new Date(due.getTime() + 60_000);

    expect(shouldSendConfirmationReminder({ dueAt: due, now: depois, alreadyReminded: false })).toBe(
      false,
    );
  });

  it('sem prazo (atividade automática) não há lembrete', () => {
    expect(
      shouldSendConfirmationReminder({ dueAt: null, now: new Date(), alreadyReminded: false }),
    ).toBe(false);
  });
});

describe('estado da confirmação', () => {
  const due = new Date('2026-09-25T23:59:00.000Z');
  const antes = new Date('2026-09-24T12:00:00.000Z');
  const depois = new Date('2026-09-26T12:00:00.000Z');

  it('atividade automática nunca tem estado de confirmação', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'CANCELED'] as const) {
      expect(
        confirmationStateOf({ policy: 'AUTO', status, dueAt: due, now: antes }),
        status,
      ).toBe('NOT_REQUIRED');
    }
  });

  it('quem espera vaga não confirma nada', () => {
    expect(
      confirmationStateOf({ policy: 'REQUIRED', status: 'WAITLISTED', dueAt: due, now: antes }),
    ).toBe('NOT_REQUIRED');
  });

  it('dentro do prazo é PENDING; depois, EXPIRED', () => {
    expect(
      confirmationStateOf({ policy: 'REQUIRED', status: 'PENDING', dueAt: due, now: antes }),
    ).toBe('PENDING');

    expect(
      confirmationStateOf({ policy: 'REQUIRED', status: 'PENDING', dueAt: due, now: depois }),
    ).toBe('EXPIRED');
  });

  it('no instante exato do vencimento já está vencido', () => {
    expect(
      confirmationStateOf({ policy: 'REQUIRED', status: 'PENDING', dueAt: due, now: due }),
    ).toBe('EXPIRED');
  });

  it('confirmada, presente ou ausente continuam confirmadas', () => {
    for (const status of ['CONFIRMED', 'ATTENDED', 'NO_SHOW'] as const) {
      expect(
        confirmationStateOf({ policy: 'REQUIRED', status, dueAt: due, now: depois }),
        status,
      ).toBe('CONFIRMED');
    }
  });

  it('cancelada pelo prazo é RELEASED; cancelada por outros motivos não', () => {
    expect(
      confirmationStateOf({
        policy: 'REQUIRED',
        status: 'CANCELED',
        dueAt: due,
        now: depois,
        cancelReason: EXPIRY_CANCEL_REASON,
      }),
    ).toBe('RELEASED');

    expect(
      confirmationStateOf({
        policy: 'REQUIRED',
        status: 'CANCELED',
        dueAt: due,
        now: depois,
        cancelReason: 'Desistiu',
      }),
    ).toBe('NOT_REQUIRED');
  });

  it('pendente sem prazo gravado não inventa vencimento', () => {
    expect(
      confirmationStateOf({ policy: 'REQUIRED', status: 'PENDING', dueAt: null, now: depois }),
    ).toBe('PENDING');
  });
});

describe('confirmação pela equipe', () => {
  const due = new Date('2026-09-25T23:59:00.000Z');
  const antes = new Date('2026-09-24T12:00:00.000Z');
  const depois = new Date('2026-09-26T12:00:00.000Z');

  const base = { policy: 'REQUIRED', dueAt: due, activityCanceled: false } as const;

  it('confirma a inscrição pendente dentro do prazo', () => {
    expect(
      canConfirmRegistration({ ...base, status: 'PENDING', now: antes }),
    ).toEqual({ ok: true });
  });

  it('recusa atividade automática', () => {
    const result = canConfirmRegistration({
      ...base,
      policy: 'AUTO',
      status: 'PENDING',
      now: antes,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_REQUIRED');
  });

  it('recusa o que já está confirmado', () => {
    const result = canConfirmRegistration({ ...base, status: 'CONFIRMED', now: antes });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_CONFIRMED');
  });

  it('recusa o prazo vencido — a varredura pode não ter passado ainda', () => {
    const result = canConfirmRegistration({ ...base, status: 'PENDING', now: depois });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EXPIRED');
  });

  it('recusa vaga já liberada, dizendo que a pessoa precisa se inscrever de novo', () => {
    const result = canConfirmRegistration({
      ...base,
      status: 'CANCELED',
      now: depois,
      cancelReason: EXPIRY_CANCEL_REASON,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RELEASED');
      expect(result.message).toMatch(/inscrever de novo/i);
    }
  });

  it('recusa quando a atividade foi cancelada', () => {
    const result = canConfirmRegistration({
      ...base,
      status: 'PENDING',
      now: antes,
      activityCanceled: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ACTIVITY_CANCELED');
  });

  it('recusa quem está na lista de espera', () => {
    const result = canConfirmRegistration({ ...base, status: 'WAITLISTED', now: antes });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CANCELED');
  });
});

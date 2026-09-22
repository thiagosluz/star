import { describe, expect, it } from 'vitest';

import {
  CALL_STATE_LABELS,
  PROPOSAL_KINDS,
  PROPOSAL_KIND_ACTIVITY_TYPE,
  PROPOSAL_KIND_DEFAULT_WORKLOAD,
  PROPOSAL_KIND_FIELDS,
  PROPOSAL_KIND_LABELS,
  activityTitleFromProposal,
  callCountdown,
  callStateOf,
  callWindowLabel,
  canSubmitToCall,
  defaultBlindFor,
  isCallOpen,
  isScientific,
  planAcceptance,
  proposedWorkload,
  validateCallWindow,
  validateProposalData,
} from '../../src/domain/proposals/call-rules';

describe('catálogo de tipos de chamada', () => {
  it('todo tipo tem rótulo, tipo de atividade, carga padrão e cegueira definida', () => {
    for (const kind of PROPOSAL_KINDS) {
      expect(PROPOSAL_KIND_LABELS[kind], kind).toBeTruthy();
      expect(PROPOSAL_KIND_ACTIVITY_TYPE[kind], kind).toBeTruthy();
      expect(PROPOSAL_KIND_DEFAULT_WORKLOAD[kind], kind).toBeGreaterThan(0);
      expect(typeof defaultBlindFor(kind)).toBe('boolean');
      expect(PROPOSAL_KIND_FIELDS[kind]).toBeDefined();
    }
  });

  it('a cegueira nasce ligada só no que é científico; a palestra decide olhando', () => {
    expect(defaultBlindFor('PAPER')).toBe(true);
    expect(defaultBlindFor('POSTER')).toBe(true);
    expect(defaultBlindFor('SPEAKER')).toBe(false);
    expect(defaultBlindFor('MINICOURSE')).toBe(false);

    expect(isScientific('PAPER')).toBe(true);
    expect(isScientific('MINICOURSE')).toBe(false);
  });
});

describe('estado da chamada — decidido na leitura', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');

  it('não publicada é RASCUNHO, mesmo dentro da janela', () => {
    expect(
      callStateOf({
        isPublished: false,
        opensAt: new Date('2026-09-01T00:00:00.000Z'),
        closesAt: new Date('2026-10-01T00:00:00.000Z'),
        now,
      }),
    ).toBe('DRAFT');
  });

  it('antes da abertura é AGENDADA, e depois do fechamento é ENCERRADA', () => {
    expect(
      callStateOf({
        isPublished: true,
        opensAt: new Date('2026-09-20T00:00:00.000Z'),
        closesAt: new Date('2026-10-20T00:00:00.000Z'),
        now,
      }),
    ).toBe('SCHEDULED');

    expect(
      callStateOf({
        isPublished: true,
        opensAt: new Date('2026-08-01T00:00:00.000Z'),
        closesAt: new Date('2026-09-10T00:00:00.000Z'),
        now,
      }),
    ).toBe('CLOSED');
  });

  it('dentro da janela é ABERTA — inclusive sem data nenhuma', () => {
    expect(
      callStateOf({
        isPublished: true,
        opensAt: new Date('2026-09-01T00:00:00.000Z'),
        closesAt: new Date('2026-10-01T00:00:00.000Z'),
        now,
      }),
    ).toBe('OPEN');

    expect(callStateOf({ isPublished: true, opensAt: null, closesAt: null, now })).toBe('OPEN');
    expect(isCallOpen({ isPublished: true, opensAt: null, closesAt: null, now })).toBe(true);
  });

  it('as bordas são inclusivas na abertura e no fechamento', () => {
    const opens = new Date('2026-09-15T12:00:00.000Z');
    const closes = new Date('2026-09-15T12:00:00.000Z');

    // Exatamente na abertura: já aberta. Exatamente no fechamento: já encerrada.
    expect(callStateOf({ isPublished: true, opensAt: opens, closesAt: null, now })).toBe('OPEN');
    expect(callStateOf({ isPublished: true, opensAt: null, closesAt: closes, now })).toBe('CLOSED');
  });

  it('todo estado tem rótulo, para a tela não inventar texto', () => {
    for (const state of ['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED'] as const) {
      expect(CALL_STATE_LABELS[state]).toBeTruthy();
    }
  });
});

describe('validação da janela', () => {
  const opens = new Date('2026-09-01T00:00:00.000Z');
  const closes = new Date('2026-09-30T00:00:00.000Z');

  it('aceita a janela coerente e a ausência de datas', () => {
    expect(validateCallWindow({ opensAt: opens, closesAt: closes }).ok).toBe(true);
    expect(validateCallWindow({ opensAt: null, closesAt: null }).ok).toBe(true);
    expect(validateCallWindow({ opensAt: opens, closesAt: null }).ok).toBe(true);
  });

  it('recusa prazo ANTES da abertura — a chamada nunca abriria', () => {
    const result = validateCallWindow({ opensAt: closes, closesAt: opens });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_WINDOW');
  });

  it('recusa janela de duração ZERO (aberta e encerrada no mesmo instante)', () => {
    expect(validateCallWindow({ opensAt: opens, closesAt: opens }).ok).toBe(false);
  });
});

describe('submissão permitida', () => {
  const open = {
    isPublished: true,
    opensAt: null,
    closesAt: null,
    now: new Date('2026-09-15T12:00:00.000Z'),
    maxSubmissionsPerAuthor: 0,
    title: 'Chamada de minicursos',
  };

  it('recusa com o MOTIVO certo em cada estado', () => {
    const draft = canSubmitToCall({ call: { ...open, isPublished: false }, authorSubmissions: 0 });
    const scheduled = canSubmitToCall({
      call: { ...open, opensAt: new Date('2026-10-01T00:00:00.000Z') },
      authorSubmissions: 0,
    });
    const closed = canSubmitToCall({
      call: { ...open, closesAt: new Date('2026-09-01T00:00:00.000Z') },
      authorSubmissions: 0,
    });

    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.code).toBe('CALL_NOT_PUBLISHED');
    expect(scheduled.ok).toBe(false);
    if (!scheduled.ok) expect(scheduled.code).toBe('CALL_NOT_OPEN');
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe('CALL_CLOSED');
  });

  it('o limite por autor vale POR CHAMADA, e fala no singular quando é 1', () => {
    const single = canSubmitToCall({
      call: { ...open, maxSubmissionsPerAuthor: 1 },
      authorSubmissions: 1,
    });
    const double = canSubmitToCall({
      call: { ...open, maxSubmissionsPerAuthor: 2 },
      authorSubmissions: 2,
    });
    const room = canSubmitToCall({
      call: { ...open, maxSubmissionsPerAuthor: 2 },
      authorSubmissions: 1,
    });

    expect(single.ok).toBe(false);
    if (!single.ok) {
      expect(single.code).toBe('AUTHOR_LIMIT_REACHED');
      expect(single.message).toContain('uma proposta');
    }
    expect(double.ok).toBe(false);
    if (!double.ok) expect(double.message).toContain('limite de 2');
    expect(room.ok).toBe(true);
  });

  it('limite zero (ou negativo) significa ILIMITADO', () => {
    expect(canSubmitToCall({ call: { ...open, maxSubmissionsPerAuthor: 0 }, authorSubmissions: 9 }).ok).toBe(true);
    expect(canSubmitToCall({ call: { ...open, maxSubmissionsPerAuthor: -1 }, authorSubmissions: 9 }).ok).toBe(true);
  });
});

describe('campos por tipo', () => {
  it('artigo e pôster não pedem campo extra (usam o formulário científico)', () => {
    expect(PROPOSAL_KIND_FIELDS.PAPER).toHaveLength(0);
    expect(PROPOSAL_KIND_FIELDS.POSTER).toHaveLength(0);
  });

  it('minicurso exige carga horária e público-alvo, com faixa de minutos', () => {
    const missing = validateProposalData({ kind: 'MINICOURSE', data: {} });

    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe('MISSING_FIELD');
      expect(missing.field).toBe('workloadMinutes');
    }

    const tooShort = validateProposalData({
      kind: 'MINICOURSE',
      data: { workloadMinutes: '10', targetAudience: 'Estudantes' },
    });

    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(tooShort.message).toContain('entre 30 e 720');

    const ok = validateProposalData({
      kind: 'MINICOURSE',
      data: { workloadMinutes: '240', targetAudience: '  Estudantes de graduação  ', prerequisites: '' },
    });

    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.data.workloadMinutes).toBe(240);
    expect(ok.data.targetAudience).toBe('Estudantes de graduação');
    // Campo opcional vazio NÃO entra no dado gravado.
    expect(ok.data).not.toHaveProperty('prerequisites');
  });

  it('descarta o campo que não pertence ao tipo (o formulário não inventa dado)', () => {
    const result = validateProposalData({
      kind: 'SPEAKER',
      data: {
        bio: 'Pesquisadora de educação a distância há 15 anos.',
        topics: 'Acessibilidade',
        // `workloadMinutes` é de minicurso: não pode entrar num convite de palestra.
        workloadMinutes: '999',
        campoInventado: 'qualquer coisa',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).not.toHaveProperty('workloadMinutes');
    expect(result.data).not.toHaveProperty('campoInventado');
    expect(result.data.topics).toBe('Acessibilidade');
  });

  it('respeita o teto de caracteres do texto', () => {
    const result = validateProposalData({
      kind: 'SPEAKER',
      data: { bio: 'a'.repeat(2_000), topics: 'Tema' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_FIELD');
      expect(result.field).toBe('bio');
    }
  });

  it('a carga proposta vira a carga da atividade, com o padrão do tipo quando ausente', () => {
    expect(proposedWorkload('MINICOURSE', { workloadMinutes: 180 })).toBe(180);
    expect(proposedWorkload('ROUNDTABLE', { durationMinutes: 120 })).toBe(120);
    expect(proposedWorkload('MINICOURSE', {})).toBe(PROPOSAL_KIND_DEFAULT_WORKLOAD.MINICOURSE);
    expect(proposedWorkload('SPEAKER', {})).toBe(60);
  });
});

describe('texto da janela e contagem', () => {
  it('monta a frase conforme as datas existentes, no fuso do evento', () => {
    const opens = new Date('2026-09-01T12:00:00.000Z'); // 09:00 em America/Bahia
    const closes = new Date('2026-09-30T23:59:00.000Z'); // 20:59 em America/Bahia

    expect(callWindowLabel({ opensAt: opens, closesAt: closes, timeZone: 'America/Bahia' })).toBe(
      'De 01/09/2026 às 09:00 até 30/09/2026 às 20:59',
    );
    expect(callWindowLabel({ opensAt: opens, closesAt: null, timeZone: 'America/Bahia' })).toBe(
      'A partir de 01/09/2026 às 09:00',
    );
    expect(callWindowLabel({ opensAt: null, closesAt: closes, timeZone: 'America/Bahia' })).toBe(
      'Até 30/09/2026 às 20:59',
    );
    expect(callWindowLabel({ opensAt: null, closesAt: null, timeZone: 'America/Bahia' })).toBe(
      'Sem prazo definido',
    );
  });

  it('a contagem fala em horas no último dia, em dias antes disso, e encerra', () => {
    const now = new Date('2026-09-15T12:00:00.000Z');
    const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

    expect(callCountdown({ closesAt: inHours(-1), now })).toBe('encerrada');
    expect(callCountdown({ closesAt: inHours(5), now })).toBe('fecha em 5h');
    expect(callCountdown({ closesAt: inHours(48), now })).toBe('fecha em 2 dias');
    expect(callCountdown({ closesAt: null, now })).toBeNull();
  });
});

describe('protocolo de aceite', () => {
  const startsAt = new Date('2026-10-01T12:00:00.000Z');
  const endsAt = new Date('2026-10-01T14:00:00.000Z');

  it('aceitar SEM pedir nada é válido (a decisão não obriga a programação)', () => {
    const plan = planAcceptance({
      createActivity: false,
      inviteSpeaker: false,
      speakerEmail: null,
      speakerName: null,
    });

    expect(plan.ok).toBe(true);
  });

  it('criar atividade sem agenda é RECUSADO — senão nasceria atividade em 1970', () => {
    const plan = planAcceptance({
      createActivity: true,
      inviteSpeaker: false,
      activityType: 'MINI_COURSE',
      startsAt: null,
      endsAt: null,
      speakerEmail: 'pessoa@exemplo.test',
      speakerName: 'Pessoa',
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe('MISSING_SCHEDULE');
  });

  it('término antes do início é recusado', () => {
    const plan = planAcceptance({
      createActivity: true,
      inviteSpeaker: false,
      activityType: 'MINI_COURSE',
      startsAt: endsAt,
      endsAt: startsAt,
      speakerEmail: null,
      speakerName: null,
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe('INVALID_SCHEDULE');
  });

  it('convidar sem e-mail é recusado — o convite não chegaria a ninguém', () => {
    const plan = planAcceptance({
      createActivity: false,
      inviteSpeaker: true,
      speakerEmail: null,
      speakerName: 'Pessoa',
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe('MISSING_EMAIL');
  });

  it('com agenda e e-mail, o plano passa e diz o que será feito', () => {
    const plan = planAcceptance({
      createActivity: true,
      inviteSpeaker: true,
      activityType: 'MINI_COURSE',
      startsAt,
      endsAt,
      speakerEmail: 'pessoa@exemplo.test',
      speakerName: 'Pessoa',
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.createActivity).toBe(true);
    expect(plan.inviteSpeaker).toBe(true);
  });

  it('o título da atividade é o da proposta, cortado no teto da coluna', () => {
    expect(activityTitleFromProposal('  Minicurso de Rust  ')).toBe('Minicurso de Rust');
    expect(activityTitleFromProposal('a'.repeat(400))).toHaveLength(300);
    expect(activityTitleFromProposal('a'.repeat(400))).toMatch(/…$/);
  });
});

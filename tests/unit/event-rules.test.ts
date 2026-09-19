/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — regras de eventos e atividades
 *
 *  Domínio puro: sem banco, sem servidor. Foco nos casos de borda que quebram
 *  sistemas de agendamento: horário de verão, intervalos adjacentes, janelas de
 *  inscrição sobrepostas ao evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  activityAcceptsRegistration,
  checkScheduleConflict,
  deriveEventStatus,
  durationMinutes,
  effectiveActivityCapacity,
  evaluateRegistrationWindow,
  evaluateRoomCapacityChange,
  evaluateRoomFit,
  evaluateRoomRemoval,
  eventAcceptsRegistration,
  formatDuration,
  formatEventPeriod,
  isPubliclyVisible,
  isRegistrationOpen,
  isWithinEventWindow,
  normalizeRoomCapacity,
  overlaps,
  roomCapacityLabel,
  roomHasCapacityLimit,
  type ActivityStatus,
  type EventStatus,
} from '../../src/domain/events/event-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
const NOW = new Date('2026-03-15T12:00:00Z');
const at = (iso: string) => new Date(iso);

function windowInput(overrides: Partial<Parameters<typeof evaluateRegistrationWindow>[0]> = {}) {
  return {
    now: NOW,
    eventStartsAt: at('2026-04-01T09:00:00Z'),
    eventEndsAt: at('2026-04-03T18:00:00Z'),
    eventStatus: 'REGISTRATION_OPEN' as EventStatus,
    registrationOpensAt: at('2026-03-01T00:00:00Z'),
    registrationClosesAt: at('2026-03-31T23:59:00Z'),
    activity: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('visibilidade e aceitação de inscrição', () => {
  it('rascunho e arquivado não são visíveis publicamente', () => {
    expect(isPubliclyVisible('DRAFT')).toBe(false);
    expect(isPubliclyVisible('ARCHIVED')).toBe(false);
    expect(isPubliclyVisible('PUBLISHED')).toBe(true);
    expect(isPubliclyVisible('FINISHED')).toBe(true);
  });

  it('cancelado não é visível', () => {
    expect(isPubliclyVisible('CANCELED')).toBe(false);
  });

  it('só PUBLISHED e REGISTRATION_OPEN aceitam inscrição', () => {
    expect(eventAcceptsRegistration('PUBLISHED')).toBe(true);
    expect(eventAcceptsRegistration('REGISTRATION_OPEN')).toBe(true);
    expect(eventAcceptsRegistration('REGISTRATION_CLOSED')).toBe(false);
    expect(eventAcceptsRegistration('DRAFT')).toBe(false);
    expect(eventAcceptsRegistration('CANCELED')).toBe(false);
  });

  it('apenas atividade SCHEDULED aceita inscrição', () => {
    expect(activityAcceptsRegistration('SCHEDULED')).toBe(true);
    for (const status of ['DRAFT', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'] as ActivityStatus[]) {
      expect(activityAcceptsRegistration(status)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateRegistrationWindow() — janela de inscrição', () => {
  it('libera dentro da janela', () => {
    expect(evaluateRegistrationWindow(windowInput())).toEqual({ open: true });
  });

  it('bloqueia antes da abertura', () => {
    const result = evaluateRegistrationWindow(
      windowInput({ now: at('2026-02-15T12:00:00Z') }),
    );
    expect(result.open).toBe(false);
    if (!result.open) expect(result.reason).toBe('NOT_STARTED');
  });

  it('bloqueia depois do fechamento', () => {
    const result = evaluateRegistrationWindow(
      windowInput({ now: at('2026-04-02T12:00:00Z'), registrationClosesAt: at('2026-03-31T23:59:00Z') }),
    );
    expect(result.open).toBe(false);
    if (!result.open) expect(result.reason).toBe('CLOSED');
  });

  it('cancelamento tem precedência sobre qualquer outra razão', () => {
    const result = evaluateRegistrationWindow(
      windowInput({ eventStatus: 'CANCELED', now: at('2026-02-01T00:00:00Z') }),
    );
    expect(result.open).toBe(false);
    if (!result.open) expect(result.reason).toBe('EVENT_CANCELED');
  });

  it('atividade cancelada bloqueia mesmo com o evento aberto', () => {
    const result = evaluateRegistrationWindow(
      windowInput({
        activity: {
          startsAt: at('2026-04-01T10:00:00Z'),
          endsAt: at('2026-04-01T12:00:00Z'),
          status: 'CANCELED',
        },
      }),
    );
    expect(result.open).toBe(false);
    if (!result.open) expect(result.reason).toBe('ACTIVITY_CANCELED');
  });

  it('evento em andamento bloqueia inscrição no evento', () => {
    const result = evaluateRegistrationWindow(
      windowInput({ now: at('2026-04-02T10:00:00Z'), eventStatus: 'IN_PROGRESS' }),
    );
    expect(result.open).toBe(false);
    if (!result.open) expect(result.reason).toBe('EVENT_STARTED');
  });

  it('inscrição em atividade continua válida durante o evento, antes dela começar', () => {
    // Este é o caso importante: o evento já começou, mas a atividade é à tarde.
    const result = evaluateRegistrationWindow(
      windowInput({
        now: at('2026-04-01T09:30:00Z'),
        eventStatus: 'IN_PROGRESS',
        registrationClosesAt: null,
        activity: {
          startsAt: at('2026-04-01T14:00:00Z'),
          endsAt: at('2026-04-01T16:00:00Z'),
          status: 'SCHEDULED',
        },
      }),
    );
    expect(result.open).toBe(true);
  });

  it('bloqueia quando a atividade já começou', () => {
    const result = evaluateRegistrationWindow(
      windowInput({
        now: at('2026-04-01T15:00:00Z'),
        eventStatus: 'IN_PROGRESS',
        registrationClosesAt: null,
        activity: {
          startsAt: at('2026-04-01T14:00:00Z'),
          endsAt: at('2026-04-01T16:00:00Z'),
          status: 'IN_PROGRESS',
        },
      }),
    );
    expect(result.open).toBe(false);
  });

  it('evento encerrado bloqueia tudo', () => {
    const result = evaluateRegistrationWindow(
      windowInput({ now: at('2026-05-01T00:00:00Z'), eventStatus: 'FINISHED' }),
    );
    expect(result.open).toBe(false);
    if (!result.open) expect(result.reason).toBe('EVENT_STARTED');
  });

  it('allowAfterStart libera inscrição no evento já iniciado (credenciamento)', () => {
    const result = evaluateRegistrationWindow(
      windowInput({
        now: at('2026-04-02T10:00:00Z'),
        eventStatus: 'IN_PROGRESS',
        registrationClosesAt: null,
        allowAfterStart: true,
      }),
    );
    expect(result.open).toBe(true);
  });

  it('sem janela explícita, vale a janela do evento', () => {
    expect(
      isRegistrationOpen(
        windowInput({ registrationOpensAt: null, registrationClosesAt: null }),
      ),
    ).toBe(true);
  });

  it('toda razão de bloqueio traz mensagem não vazia', () => {
    const scenarios = [
      windowInput({ eventStatus: 'CANCELED' }),
      windowInput({ eventStatus: 'DRAFT' }),
      windowInput({ eventStatus: 'REGISTRATION_CLOSED' }),
      windowInput({ eventStatus: 'FINISHED' }),
      windowInput({ now: at('2026-02-01T00:00:00Z') }),
      windowInput({ now: at('2026-04-05T00:00:00Z') }),
    ];

    for (const scenario of scenarios) {
      const result = evaluateRegistrationWindow(scenario);
      expect(result.open).toBe(false);
      if (!result.open) {
        expect(result.message.length).toBeGreaterThan(5);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('deriveEventStatus() — status pelo relógio', () => {
  const base = {
    startsAt: at('2026-04-01T09:00:00Z'),
    endsAt: at('2026-04-03T18:00:00Z'),
    registrationOpensAt: at('2026-03-01T00:00:00Z'),
    registrationClosesAt: at('2026-03-31T23:59:00Z'),
  };

  it('antes de abrir inscrições -> PUBLISHED', () => {
    expect(deriveEventStatus({ ...base, status: 'PUBLISHED' }, at('2026-02-01T00:00:00Z'))).toBe(
      'PUBLISHED',
    );
  });

  it('dentro da janela -> REGISTRATION_OPEN', () => {
    expect(deriveEventStatus({ ...base, status: 'PUBLISHED' }, at('2026-03-15T00:00:00Z'))).toBe(
      'REGISTRATION_OPEN',
    );
  });

  it('depois de fechar, antes de começar -> REGISTRATION_CLOSED', () => {
    expect(deriveEventStatus({ ...base, status: 'PUBLISHED' }, at('2026-04-01T00:00:00Z'))).toBe(
      'REGISTRATION_CLOSED',
    );
  });

  it('durante o evento -> IN_PROGRESS', () => {
    expect(deriveEventStatus({ ...base, status: 'PUBLISHED' }, at('2026-04-02T00:00:00Z'))).toBe(
      'IN_PROGRESS',
    );
  });

  it('depois do fim -> FINISHED', () => {
    expect(deriveEventStatus({ ...base, status: 'PUBLISHED' }, at('2026-05-01T00:00:00Z'))).toBe(
      'FINISHED',
    );
  });

  it('NUNCA sobrescreve status manual (DRAFT, CANCELED, ARCHIVED)', () => {
    for (const manual of ['DRAFT', 'CANCELED', 'ARCHIVED'] as EventStatus[]) {
      expect(
        deriveEventStatus({ ...base, status: manual }, at('2027-01-01T00:00:00Z')),
      ).toBe(manual);
    }
  });

  it('sem janela de inscrição definida, abre imediatamente', () => {
    expect(
      deriveEventStatus(
        {
          startsAt: base.startsAt,
          endsAt: base.endsAt,
          status: 'PUBLISHED',
          registrationOpensAt: null,
          registrationClosesAt: null,
        },
        at('2026-01-01T00:00:00Z'),
      ),
    ).toBe('REGISTRATION_OPEN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sobreposição de intervalos', () => {
  const slot = (s: string, e: string) => ({ startsAt: at(s), endsAt: at(e) });

  it('detecta sobreposição parcial', () => {
    expect(
      overlaps(slot('2026-04-01T10:00:00Z', '2026-04-01T12:00:00Z'), slot('2026-04-01T11:00:00Z', '2026-04-01T13:00:00Z')),
    ).toBe(true);
  });

  it('detecta contenção total', () => {
    expect(
      overlaps(slot('2026-04-01T10:00:00Z', '2026-04-01T14:00:00Z'), slot('2026-04-01T11:00:00Z', '2026-04-01T12:00:00Z')),
    ).toBe(true);
  });

  it('NÃO considera conflito quando um termina exatamente quando o outro começa', () => {
    // Atividades em sequência na mesma sala são o caso normal.
    expect(
      overlaps(slot('2026-04-01T10:00:00Z', '2026-04-01T12:00:00Z'), slot('2026-04-01T12:00:00Z', '2026-04-01T14:00:00Z')),
    ).toBe(false);
  });

  it('não considera conflito em intervalos disjuntos', () => {
    expect(
      overlaps(slot('2026-04-01T10:00:00Z', '2026-04-01T11:00:00Z'), slot('2026-04-01T14:00:00Z', '2026-04-01T15:00:00Z')),
    ).toBe(false);
  });

  it('é simétrico', () => {
    const a = slot('2026-04-01T10:00:00Z', '2026-04-01T12:00:00Z');
    const b = slot('2026-04-01T11:00:00Z', '2026-04-01T13:00:00Z');
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it('calcula duração em minutos', () => {
    expect(durationMinutes(slot('2026-04-01T10:00:00Z', '2026-04-01T11:30:00Z'))).toBe(90);
    expect(durationMinutes(slot('2026-04-01T10:00:00Z', '2026-04-01T10:00:00Z'))).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('checkScheduleConflict() — conflito de sala', () => {
  const existing = [
    {
      id: 'a1',
      title: 'Minicurso de Rust',
      roomId: 'room-1',
      startsAt: at('2026-04-01T10:00:00Z'),
      endsAt: at('2026-04-01T12:00:00Z'),
    },
    {
      id: 'a2',
      title: 'Palestra de IA',
      roomId: 'room-2',
      startsAt: at('2026-04-01T10:00:00Z'),
      endsAt: at('2026-04-01T12:00:00Z'),
    },
  ];

  it('detecta conflito na mesma sala e horário', () => {
    const result = checkScheduleConflict({
      candidate: {
        roomId: 'room-1',
        startsAt: at('2026-04-01T11:00:00Z'),
        endsAt: at('2026-04-01T13:00:00Z'),
      },
      existing,
    });

    expect(result.hasConflict).toBe(true);
    if (result.hasConflict) {
      expect(result.kind).toBe('ROOM');
      expect(result.roomConflicts).toHaveLength(1);
      expect(result.roomConflicts[0]?.id).toBe('a1');
      expect(result.message).toContain('Minicurso de Rust');
    }
  });

  it('não conflita com sala diferente no mesmo horário', () => {
    expect(
      checkScheduleConflict({
        candidate: {
          roomId: 'room-3',
          startsAt: at('2026-04-01T10:00:00Z'),
          endsAt: at('2026-04-01T12:00:00Z'),
        },
        existing,
      }).hasConflict,
    ).toBe(false);
  });

  it('não conflita consigo mesma ao editar', () => {
    expect(
      checkScheduleConflict({
        candidate: {
          id: 'a1',
          roomId: 'room-1',
          startsAt: at('2026-04-01T10:00:00Z'),
          endsAt: at('2026-04-01T12:00:00Z'),
        },
        existing,
      }).hasConflict,
    ).toBe(false);
  });

  it('não conflita em horários disjuntos na mesma sala', () => {
    expect(
      checkScheduleConflict({
        candidate: {
          roomId: 'room-1',
          startsAt: at('2026-04-01T14:00:00Z'),
          endsAt: at('2026-04-01T16:00:00Z'),
        },
        existing,
      }).hasConflict,
    ).toBe(false);
  });

  it('sem sala definida nunca conflita', () => {
    expect(
      checkScheduleConflict({
        candidate: {
          roomId: null,
          startsAt: at('2026-04-01T11:00:00Z'),
          endsAt: at('2026-04-01T13:00:00Z'),
        },
        existing,
      }).hasConflict,
    ).toBe(false);
  });

  it('acumula múltiplos conflitos na mesma sala', () => {
    const result = checkScheduleConflict({
      candidate: {
        roomId: 'room-1',
        startsAt: at('2026-04-01T09:00:00Z'),
        endsAt: at('2026-04-01T15:00:00Z'),
      },
      existing: [
        ...existing,
        {
          id: 'a3',
          title: 'Oficina de Dados',
          roomId: 'room-1',
          startsAt: at('2026-04-01T13:00:00Z'),
          endsAt: at('2026-04-01T14:00:00Z'),
        },
      ],
    });

    expect(result.hasConflict).toBe(true);
    if (result.hasConflict) expect(result.roomConflicts).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('janela do evento e capacidade da sala', () => {
  const eventSlot = { startsAt: at('2026-04-01T09:00:00Z'), endsAt: at('2026-04-03T18:00:00Z') };

  it('atividade contida no evento é válida', () => {
    expect(
      isWithinEventWindow(
        { startsAt: at('2026-04-02T10:00:00Z'), endsAt: at('2026-04-02T12:00:00Z') },
        eventSlot,
      ),
    ).toBe(true);
  });

  it('atividade que começa antes do evento é inválida', () => {
    expect(
      isWithinEventWindow(
        { startsAt: at('2026-03-31T10:00:00Z'), endsAt: at('2026-04-01T12:00:00Z') },
        eventSlot,
      ),
    ).toBe(false);
  });

  it('atividade que termina depois do evento é inválida', () => {
    expect(
      isWithinEventWindow(
        { startsAt: at('2026-04-03T10:00:00Z'), endsAt: at('2026-04-04T12:00:00Z') },
        eventSlot,
      ),
    ).toBe(false);
  });

  it('lotação que cabe na sala é aceita', () => {
    expect(evaluateRoomFit(40, 50).fits).toBe(true);
  });

  it('lotação maior que a sala é recusada com mensagem útil', () => {
    const result = evaluateRoomFit(80, 50);
    expect(result.fits).toBe(false);
    if (!result.fits) {
      expect(result.reason).toBe('EXCEEDS_ROOM_CAPACITY');
      expect(result.message).toContain('80');
      expect(result.message).toContain('50');
    }
  });

  it('sala sem limite definido não bloqueia', () => {
    expect(evaluateRoomFit(500, 0).fits).toBe(true);
  });

  it('atividade sem limite definido não é bloqueada pela sala', () => {
    expect(evaluateRoomFit(null, 10).fits).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Revisão da FASE 3 — a capacidade da sala passou a ser OPCIONAL, e a sala virou
//  o TETO do limite efetivo da atividade que acontece nela.
// ═══════════════════════════════════════════════════════════════════════════════
describe('sala: capacidade opcional e limite efetivo', () => {
  it('capacidade vazia, zero ou negativa significa SEM LIMITE', () => {
    expect(normalizeRoomCapacity(null)).toBeNull();
    expect(normalizeRoomCapacity(undefined)).toBeNull();
    expect(normalizeRoomCapacity(0)).toBeNull();
    expect(normalizeRoomCapacity(-5)).toBeNull();
  });

  it('capacidade positiva é preservada', () => {
    expect(normalizeRoomCapacity(40)).toBe(40);
    expect(roomHasCapacityLimit(40)).toBe(true);
    expect(roomHasCapacityLimit(null)).toBe(false);
    expect(roomHasCapacityLimit(0)).toBe(false);
  });

  it('o rótulo diz "sem limite" em vez de "0 lugares"', () => {
    expect(roomCapacityLabel(null)).toBe('sem limite');
    expect(roomCapacityLabel(0)).toBe('sem limite');
    expect(roomCapacityLabel(40)).toBe('40 lugares');
  });

  it('sala com limite é o TETO da atividade sem vagas declaradas', () => {
    expect(effectiveActivityCapacity(null, 40)).toBe(40);
  });

  it('sala menor que a atividade declarada manda', () => {
    expect(effectiveActivityCapacity(80, 40)).toBe(40);
  });

  it('sala sem limite deixa a atividade decidir', () => {
    expect(effectiveActivityCapacity(80, null)).toBe(80);
    expect(effectiveActivityCapacity(80, 0)).toBe(80);
  });

  it('atividade ESGOTADA (0) não é "devolvida" pela sala', () => {
    // Zero é uma afirmação: "não há vaga". A sala não pode transformar isso em 40.
    expect(effectiveActivityCapacity(0, 40)).toBe(0);
  });

  it('sem limite nos dois lados, não há denominador', () => {
    expect(effectiveActivityCapacity(null, null)).toBeNull();
  });

  it('sala igual à atividade não muda nada', () => {
    expect(effectiveActivityCapacity(40, 40)).toBe(40);
  });

  it('sala sem capacidade declarada (null) não bloqueia a lotação', () => {
    expect(evaluateRoomFit(500, null).fits).toBe(true);
  });
});

describe('sala: as guardas de editar e excluir', () => {
  const ocupada = [
    { title: 'Minicurso de Rust', capacity: 40, confirmedCount: 12 },
    { title: 'Abertura', capacity: null, confirmedCount: 3 },
  ];

  it('reduzir abaixo das VAGAS declaradas de uma atividade é recusado, com o número', () => {
    const result = evaluateRoomCapacityChange({ nextCapacity: 30, usage: ocupada });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('ROOM_CAPACITY_BELOW_USAGE');
      expect(result.message).toContain('Minicurso de Rust');
      expect(result.message).toContain('40');
    }
  });

  it('reduzir abaixo dos INSCRITOS já confirmados é recusado, com o número', () => {
    const result = evaluateRoomCapacityChange({
      nextCapacity: 5,
      usage: [{ title: 'Oficina de Robótica', capacity: null, confirmedCount: 9 }],
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain('9 inscrito(s)');
  });

  it('reduzir para um número que ainda cabe é permitido', () => {
    const result = evaluateRoomCapacityChange({ nextCapacity: 40, usage: ocupada });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.normalizedCapacity).toBe(40);
  });

  it('TIRAR o limite é sempre permitido, mesmo com a sala cheia', () => {
    const result = evaluateRoomCapacityChange({ nextCapacity: null, usage: ocupada });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.normalizedCapacity).toBeNull();
  });

  it('sala sem atividade nenhuma aceita qualquer capacidade', () => {
    const result = evaluateRoomCapacityChange({ nextCapacity: 1, usage: [] });
    expect(result.allowed).toBe(true);
  });

  it('sala VAZIA pode ser excluída', () => {
    expect(evaluateRoomRemoval({ usage: [] }).allowed).toBe(true);
  });

  it('sala EM USO não pode ser excluída — e a recusa diz por quem', () => {
    const result = evaluateRoomRemoval({ usage: ocupada });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('ROOM_IN_USE');
      expect(result.message).toContain('2 atividade(s)');
      expect(result.message).toContain('Minicurso de Rust');
      expect(result.message).toMatch(/sem sala/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('formatação', () => {
  it('formata duração de forma legível', () => {
    expect(formatDuration(0)).toBe('0min');
    expect(formatDuration(45)).toBe('45min');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h30');
    expect(formatDuration(150)).toBe('2h30');
  });

  it('formata período no fuso do evento', () => {
    const text = formatEventPeriod(
      { startsAt: at('2026-04-01T13:00:00Z'), endsAt: at('2026-04-01T17:00:00Z') },
      'America/Bahia',
    );
    // 13:00 UTC = 10:00 em America/Bahia (UTC-3)
    expect(text).toContain('10:00');
    expect(text).toContain('14:00');
  });

  it('usa travessão entre datas quando o evento atravessa dias', () => {
    const text = formatEventPeriod(
      { startsAt: at('2026-04-01T13:00:00Z'), endsAt: at('2026-04-03T17:00:00Z') },
      'America/Bahia',
    );
    expect(text).toContain(' a ');
  });

  it('lida com horário de verão corretamente (UTC no armazenamento)', () => {
    // America/Sao_Paulo não observa mais DST, mas Europe/Lisbon sim.
    // O ponto do teste: a conversão é feita por fuso IANA, não por offset fixo.
    const summer = formatEventPeriod(
      { startsAt: at('2026-07-01T12:00:00Z'), endsAt: at('2026-07-01T14:00:00Z') },
      'Europe/Lisbon',
    );
    const winter = formatEventPeriod(
      { startsAt: at('2026-01-15T12:00:00Z'), endsAt: at('2026-01-15T14:00:00Z') },
      'Europe/Lisbon',
    );
    // Verão (UTC+1) -> 13:00; inverno (UTC+0) -> 12:00
    expect(summer).toContain('13:00');
    expect(winter).toContain('12:00');
  });
});

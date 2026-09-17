/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — lotação, lista de espera e cancelamento
 *
 *  A regra mais importante aqui é a semântica de capacidade:
 *    null = ILIMITADO    0 = ESGOTADO    n > 0 = n vagas
 *
 *  Confundir `0` com "ilimitado" liberaria inscrições em uma atividade
 *  configurada como lotada. Há teste dedicado para isso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  SEAT_AVAILABLE_PREDICATE,
  canTransitionRegistration,
  cancelAffectsWaitlist,
  cancelReleasesSeat,
  decideRegistration,
  hasAvailableSeat,
  isUnlimitedCapacity,
  nextWaitlistPromotion,
  occupancyRatio,
  remainingSeats,
  type RegistrationDecisionInput,
  type RegistrationStatus,
} from '../../src/domain/events/registration-rules';

function decisionInput(
  overrides: Partial<RegistrationDecisionInput> = {},
): RegistrationDecisionInput {
  return {
    capacity: 10,
    confirmedCount: 0,
    waitlistEnabled: false,
    waitlistCount: 0,
    alreadyRegistered: false,
    activityStatus: 'SCHEDULED',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('semântica de capacidade', () => {
  it('null é ILIMITADO', () => {
    expect(isUnlimitedCapacity(null)).toBe(true);
    expect(isUnlimitedCapacity(undefined)).toBe(true);
    expect(hasAvailableSeat(null, 10_000)).toBe(true);
    expect(remainingSeats(null, 10_000)).toBeNull();
    expect(occupancyRatio(null, 10_000)).toBeNull();
  });

  it('0 é ESGOTADO, não ilimitado', () => {
    // O erro clássico: tratar 0 como "sem limite".
    expect(isUnlimitedCapacity(0)).toBe(false);
    expect(hasAvailableSeat(0, 0)).toBe(false);
    expect(remainingSeats(0, 0)).toBe(0);
    expect(occupancyRatio(0, 0)).toBe(1);
  });

  it('n > 0 compara com o contador', () => {
    expect(hasAvailableSeat(10, 9)).toBe(true);
    expect(hasAvailableSeat(10, 10)).toBe(false);
    expect(hasAvailableSeat(10, 11)).toBe(false);
  });

  it('vagas restantes nunca são negativas', () => {
    expect(remainingSeats(10, 15)).toBe(0);
    expect(remainingSeats(5, 5)).toBe(0);
  });

  it('ocupação é limitada a 1', () => {
    expect(occupancyRatio(10, 5)).toBe(0.5);
    expect(occupancyRatio(10, 20)).toBe(1);
    expect(occupancyRatio(10, 0)).toBe(0);
  });

  it('o predicado SQL reflete a mesma semântica', () => {
    // Se alguém mudar a regra em JS e esquecer o SQL (ou vice-versa), este teste
    // falha — é a amarração entre a regra pura e a fronteira transacional.
    expect(SEAT_AVAILABLE_PREDICATE).toContain('"capacity" IS NULL');
    expect(SEAT_AVAILABLE_PREDICATE).toContain('"confirmedCount" < "capacity"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('decideRegistration()', () => {
  it('confirma quando há vaga', () => {
    const result = decideRegistration(decisionInput({ capacity: 10, confirmedCount: 3 }));
    expect(result.outcome).toBe('CONFIRMED');
    if (result.outcome === 'CONFIRMED') expect(result.remainingAfter).toBe(6);
  });

  it('confirma na última vaga e reporta zero restantes', () => {
    const result = decideRegistration(decisionInput({ capacity: 10, confirmedCount: 9 }));
    expect(result.outcome).toBe('CONFIRMED');
    if (result.outcome === 'CONFIRMED') expect(result.remainingAfter).toBe(0);
  });

  it('confirma com capacidade ilimitada e reporta null', () => {
    const result = decideRegistration(decisionInput({ capacity: null, confirmedCount: 500 }));
    expect(result.outcome).toBe('CONFIRMED');
    if (result.outcome === 'CONFIRMED') expect(result.remainingAfter).toBeNull();
  });

  it('recusa quando lotado e sem lista de espera', () => {
    const result = decideRegistration(
      decisionInput({ capacity: 5, confirmedCount: 5, waitlistEnabled: false }),
    );
    expect(result.outcome).toBe('REJECTED');
    if (result.outcome === 'REJECTED') {
      expect(result.reason).toBe('FULL_NO_WAITLIST');
      expect(result.message).toContain('lotada');
    }
  });

  it('vai para a lista de espera quando lotado e habilitado', () => {
    const result = decideRegistration(
      decisionInput({
        capacity: 5,
        confirmedCount: 5,
        waitlistEnabled: true,
        waitlistCount: 2,
      }),
    );
    expect(result.outcome).toBe('WAITLISTED');
    if (result.outcome === 'WAITLISTED') expect(result.position).toBe(3);
  });

  it('lista de espera com limite cheio recusa', () => {
    const result = decideRegistration(
      decisionInput({
        capacity: 5,
        confirmedCount: 5,
        waitlistEnabled: true,
        waitlistCount: 10,
        waitlistCapacity: 10,
      }),
    );
    expect(result.outcome).toBe('REJECTED');
    if (result.outcome === 'REJECTED') expect(result.reason).toBe('FULL_NO_WAITLIST');
  });

  it('lista de espera sem limite (null) aceita sempre', () => {
    const result = decideRegistration(
      decisionInput({
        capacity: 5,
        confirmedCount: 5,
        waitlistEnabled: true,
        waitlistCount: 9_999,
        waitlistCapacity: null,
      }),
    );
    expect(result.outcome).toBe('WAITLISTED');
  });

  it('recusa duplicidade antes de avaliar lotação', () => {
    const result = decideRegistration(
      decisionInput({ capacity: 100, confirmedCount: 0, alreadyRegistered: true }),
    );
    expect(result.outcome).toBe('REJECTED');
    if (result.outcome === 'REJECTED') expect(result.reason).toBe('DUPLICATE');
  });

  it('recusa quem já está na lista de espera', () => {
    const result = decideRegistration(
      decisionInput({ alreadyWaitlisted: true, waitlistEnabled: true }),
    );
    expect(result.outcome).toBe('REJECTED');
    if (result.outcome === 'REJECTED') expect(result.reason).toBe('ALREADY_WAITLISTED');
  });

  it('atividade cancelada recusa com motivo próprio', () => {
    const result = decideRegistration(
      decisionInput({ activityStatus: 'CANCELED' }),
    );
    expect(result.outcome).toBe('REJECTED');
    if (result.outcome === 'REJECTED') expect(result.reason).toBe('ACTIVITY_CANCELED');
  });

  it('atividade não aberta recusa', () => {
    const result = decideRegistration(decisionInput({ activityStatus: 'DRAFT' }));
    expect(result.outcome).toBe('REJECTED');
    if (result.outcome === 'REJECTED') expect(result.reason).toBe('ACTIVITY_NOT_OPEN');
  });

  it('atividade FULL ainda permite entrar na lista de espera', () => {
    // Status FULL com contador inconsistente: a lista de espera ainda é válida.
    const result = decideRegistration(
      decisionInput({
        activityStatus: 'FULL',
        capacity: 5,
        confirmedCount: 5,
        waitlistEnabled: true,
      }),
    );
    expect(result.outcome).toBe('WAITLISTED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('nextWaitlistPromotion() — FIFO', () => {
  it('promove o primeiro da fila', () => {
    const result = nextWaitlistPromotion({
      capacity: 10,
      confirmedCount: 5,
      waitlist: [
        { id: 'c', waitlistPosition: 3 },
        { id: 'a', waitlistPosition: 1 },
        { id: 'b', waitlistPosition: 2 },
      ],
    });
    expect(result.promote).toBe(true);
    if (result.promote) expect(result.nextPosition).toBe(1);
  });

  it('não promove com lista vazia', () => {
    const result = nextWaitlistPromotion({ capacity: 10, confirmedCount: 5, waitlist: [] });
    expect(result.promote).toBe(false);
    if (!result.promote) expect(result.reason).toBe('NO_WAITLIST');
  });

  it('não promove sem vaga', () => {
    const result = nextWaitlistPromotion({
      capacity: 5,
      confirmedCount: 5,
      waitlist: [{ id: 'a', waitlistPosition: 1 }],
    });
    expect(result.promote).toBe(false);
    if (!result.promote) expect(result.reason).toBe('NO_SEAT');
  });

  it('trata posição nula como último da fila', () => {
    const result = nextWaitlistPromotion({
      capacity: 10,
      confirmedCount: 0,
      waitlist: [
        { id: 'sem-posicao', waitlistPosition: null },
        { id: 'com-posicao', waitlistPosition: 2 },
      ],
    });
    expect(result.promote).toBe(true);
    if (result.promote) expect(result.nextPosition).toBe(2);
  });

  it('capacidade ilimitada sempre permite promover', () => {
    const result = nextWaitlistPromotion({
      capacity: null,
      confirmedCount: 1_000,
      waitlist: [{ id: 'a', waitlistPosition: 1 }],
    });
    expect(result.promote).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('transições de status da inscrição', () => {
  it('permite os caminhos do fluxo normal', () => {
    expect(canTransitionRegistration('PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransitionRegistration('CONFIRMED', 'ATTENDED')).toBe(true);
    expect(canTransitionRegistration('CONFIRMED', 'CANCELED')).toBe(true);
    expect(canTransitionRegistration('WAITLISTED', 'CONFIRMED')).toBe(true);
  });

  it('CANCELED é terminal', () => {
    for (const to of ['CONFIRMED', 'WAITLISTED', 'ATTENDED', 'PENDING'] as RegistrationStatus[]) {
      expect(canTransitionRegistration('CANCELED', to)).toBe(false);
    }
  });

  it('ATTENDED é terminal — presença não pode ser desfeita', () => {
    // Desfazer uma presença corromperia o cálculo de carga horária do
    // certificado, que é um documento legal.
    for (const to of ['CONFIRMED', 'CANCELED', 'WAITLISTED'] as RegistrationStatus[]) {
      expect(canTransitionRegistration('ATTENDED', to)).toBe(false);
    }
  });

  it('não permite pular de WAITLISTED direto para ATTENDED', () => {
    expect(canTransitionRegistration('WAITLISTED', 'ATTENDED')).toBe(false);
  });

  it('cancelar libera vaga apenas se a inscrição ocupava vaga', () => {
    expect(cancelReleasesSeat('CONFIRMED')).toBe(true);
    expect(cancelReleasesSeat('PENDING')).toBe(true);
    // Cancelar algo já cancelado não pode inflar a lotação disponível.
    expect(cancelReleasesSeat('CANCELED')).toBe(false);
    expect(cancelReleasesSeat('WAITLISTED')).toBe(false);
    expect(cancelReleasesSeat('ATTENDED')).toBe(false);
  });

  it('cancelar afeta a lista de espera apenas quando estava nela', () => {
    expect(cancelAffectsWaitlist('WAITLISTED')).toBe(true);
    expect(cancelAffectsWaitlist('CONFIRMED')).toBe(false);
    expect(cancelAffectsWaitlist('CANCELED')).toBe(false);
  });
});

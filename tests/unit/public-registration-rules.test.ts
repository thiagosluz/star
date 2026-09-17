/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes UNITÁRIOS — inscrição pública e vínculo de participante (FASE 10)
 *
 *  Regra pura: nada de banco aqui. O que se prova é a DECISÃO — quando a inscrição
 *  cria vínculo, quando ativa um convite, quando concede papel, e principalmente
 *  quando ela é RECUSADA em nome de uma decisão da instituição.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_EVENT_STATUSES,
  PUBLIC_REGISTRATION_ROLE,
  evaluateParticipantLink,
  isPublicEventStatus,
  publicRegistrationNotice,
  shouldGrantParticipantRole,
  type MembershipStatusName,
} from '../../src/domain/events/public-registration-rules';

const PUBLIC = { eventIsPublic: true };

describe('evaluateParticipantLink — decisão sobre o vínculo', () => {
  it('cria o vínculo quando a pessoa nunca teve relação com a instituição', () => {
    const decision = evaluateParticipantLink({ membershipStatus: null, ...PUBLIC });

    expect(decision.action).toBe('CREATE');
    expect(decision.message).toBeNull();
  });

  it('ativa o convite pendente: a inscrição é o aceite', () => {
    const decision = evaluateParticipantLink({ membershipStatus: 'INVITED', ...PUBLIC });

    expect(decision.action).toBe('ACTIVATE');
  });

  it('não faz nada para quem já é membro ativo', () => {
    const decision = evaluateParticipantLink({ membershipStatus: 'ACTIVE', ...PUBLIC });

    expect(decision.action).toBe('ALREADY_MEMBER');
  });

  it('recusa a inscrição de vínculo SUSPENSO — decisão da instituição', () => {
    const decision = evaluateParticipantLink({ membershipStatus: 'SUSPENDED', ...PUBLIC });

    expect(decision.action).toBe('BLOCKED');
    expect(decision.message).toMatch(/bloqueado/i);
  });

  it('recusa a inscrição de vínculo REMOVIDO', () => {
    const decision = evaluateParticipantLink({ membershipStatus: 'REMOVED', ...PUBLIC });

    expect(decision.action).toBe('BLOCKED');
  });

  it('trata vínculo APAGADO (soft delete) como removido', () => {
    const decision = evaluateParticipantLink({
      membershipStatus: 'ACTIVE',
      deleted: true,
      ...PUBLIC,
    });

    expect(decision.action).toBe('BLOCKED');
  });

  it('recusa quando o evento não é público', () => {
    const decision = evaluateParticipantLink({
      membershipStatus: null,
      eventIsPublic: false,
    });

    expect(decision.action).toBe('BLOCKED');
    expect(decision.message).toMatch(/restrito/i);
  });

  it('o bloqueio tem precedência sobre a inexistência de vínculo', () => {
    /**
     * A ordem importa: se "sem vínculo" fosse avaliado antes, uma pessoa removida
     * (cujo vínculo continua existindo, apenas com status REMOVED) ou suspensa
     * passaria a se inscrever — desfazendo, na prática, a decisão da instituição.
     */
    const suspended = evaluateParticipantLink({ membershipStatus: 'SUSPENDED', ...PUBLIC });
    const removed = evaluateParticipantLink({ membershipStatus: 'REMOVED', ...PUBLIC });

    expect(suspended.action).not.toBe('CREATE');
    expect(removed.action).not.toBe('CREATE');
  });

  it('cobre todos os status possíveis sem cair em caminho indefinido', () => {
    const statuses: (MembershipStatusName | null)[] = [
      null,
      'INVITED',
      'ACTIVE',
      'SUSPENDED',
      'REMOVED',
    ];

    for (const status of statuses) {
      const decision = evaluateParticipantLink({ membershipStatus: status, ...PUBLIC });

      expect(['ALREADY_MEMBER', 'ACTIVATE', 'CREATE', 'BLOCKED']).toContain(decision.action);
      // Toda recusa explica o motivo; toda permissão é silenciosa.
      if (decision.action === 'BLOCKED') expect(decision.message).toBeTruthy();
      else expect(decision.message).toBeNull();
    }
  });
});

describe('shouldGrantParticipantRole — quando conceder o papel', () => {
  it('concede a quem não tem papel nenhum na instituição', () => {
    expect(shouldGrantParticipantRole([])).toBe(true);
  });

  it('NÃO concede a quem já tem qualquer papel', () => {
    /**
     * O sistema acumula papéis. Acrescentar `PARTICIPANT` a um patrocinador
     * ampliaria, de lado, uma permissão que a instituição deliberadamente não deu
     * (`registration:create`) — e o teste E2E "usuário com vínculo mas sem
     * permissão não consegue se inscrever" depende de o acúmulo NÃO acontecer.
     */
    for (const role of ['OWNER', 'ADMIN', 'SPONSOR', 'REVIEWER', 'STAFF', 'PARTICIPANT']) {
      expect(shouldGrantParticipantRole([role])).toBe(false);
    }
  });

  it('o papel concedido é PARTICIPANT — nunca um papel administrativo', () => {
    expect(PUBLIC_REGISTRATION_ROLE).toBe('PARTICIPANT');
  });
});

describe('isPublicEventStatus — o que conta como evento público', () => {
  it('reconhece os status visíveis ao visitante', () => {
    for (const status of PUBLIC_EVENT_STATUSES) {
      expect(isPublicEventStatus(status)).toBe(true);
    }

    expect(PUBLIC_EVENT_STATUSES).toContain('PUBLISHED');
    expect(PUBLIC_EVENT_STATUSES).toContain('REGISTRATION_OPEN');
  });

  it('recusa rascunho, cancelado e arquivado', () => {
    expect(isPublicEventStatus('DRAFT')).toBe(false);
    expect(isPublicEventStatus('CANCELED')).toBe(false);
    expect(isPublicEventStatus('ARCHIVED')).toBe(false);
  });

  it('status desconhecido é tratado como NÃO público (fail-closed)', () => {
    expect(isPublicEventStatus('SOMETHING_NEW')).toBe(false);
  });
});

describe('publicRegistrationNotice — o aviso ao participante', () => {
  it('nomeia a instituição e o efeito da inscrição', () => {
    const notice = publicRegistrationNotice('Universidade Federal da Bahia');

    expect(notice).toContain('Universidade Federal da Bahia');
    expect(notice).toMatch(/participante/i);
  });
});

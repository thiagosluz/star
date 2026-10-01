/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Prontidão e áreas do evento (FASE 53)
 *
 *  O painel é interface, mas a REGRA ("o que falta") e o CATÁLOGO ("o que existe")
 *  são dados: é aqui que se prova, sem navegador, que uma pendência aparece quando
 *  deve, desaparece quando não deve, e que nenhum atalho antigo dos E2E se perdeu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  EVENT_AREAS,
  EVENT_AREA_GROUPS,
  groupEventAreas,
  visibleEventAreas,
  type EventAreaContext,
} from '../../src/domain/events/event-areas';
import {
  blockingCount,
  eventReadiness,
  isEventLive,
  type EventReadinessFacts,
} from '../../src/domain/events/event-readiness';
import { PERMISSIONS } from '../../src/domain/rbac/permissions';

const CONTEXT: EventAreaContext = {
  tenantSlug: 'ufba-demo',
  eventId: '11111111-1111-4111-8111-111111111111',
  eventSlug: 'congresso-2026',
};

/** Um evento completo: o painel precisa saber dizer "está tudo certo". */
const PRONTO: EventReadinessFacts = {
  status: 'REGISTRATION_OPEN',
  activityCount: 4,
  registrationCount: 12,
  trackCount: 2,
  pendingConfirmations: 0,
  roomsWithoutCapacity: 0,
  roomCount: 2,
  callWithoutDeadline: false,
  hasPublishedCall: true,
  registrationHasDeadline: true,
};

const fatos = (patch: Partial<EventReadinessFacts> = {}): EventReadinessFacts => ({
  ...PRONTO,
  ...patch,
});

const ids = (patch: Partial<EventReadinessFacts> = {}): string[] =>
  eventReadiness(fatos(patch)).map((item) => item.id);

describe('painel de prontidão', () => {
  it('evento completo NÃO tem pendência — o painel sabe dizer "está tudo certo"', () => {
    expect(ids()).toEqual([]);
    expect(blockingCount(eventReadiness(fatos()))).toBe(0);
  });

  it('vagas retidas vêm ANTES de tudo: elas vencem sozinhas', () => {
    const itens = eventReadiness(
      fatos({ pendingConfirmations: 3, roomsWithoutCapacity: 1, activityCount: 4 }),
    );

    expect(itens[0]?.id).toBe('confirmacoes');
    expect(itens[0]?.severity).toBe('BLOCKING');
    expect(itens[0]?.title).toContain('3 inscrições');
  });

  it('uma vaga retida fala no singular (o texto não pode soar robótico)', () => {
    expect(eventReadiness(fatos({ pendingConfirmations: 1 }))[0]?.title).toBe(
      '1 inscrição espera confirmação de vaga',
    );
  });

  it('sala sem capacidade é pendência — e SEM sala cadastrada não é', () => {
    expect(ids({ roomsWithoutCapacity: 1 })).toContain('salas-sem-capacidade');
    expect(ids({ roomCount: 0, roomsWithoutCapacity: 0 })).not.toContain('salas-sem-capacidade');
  });

  it('evento no ar sem programação é BLOQUEANTE; rascunho vazio não é pendência', () => {
    const noAr = eventReadiness(fatos({ activityCount: 0, status: 'PUBLISHED' }));
    const rascunho = eventReadiness(fatos({ activityCount: 0, status: 'DRAFT', registrationCount: 0 }));

    expect(noAr.map((item) => item.id)).toContain('sem-programacao');
    expect(noAr.find((item) => item.id === 'sem-programacao')?.severity).toBe('BLOCKING');

    /** Rascunho em montagem tem programação e inscrição vazias POR DEFINIÇÃO. */
    expect(rascunho.map((item) => item.id)).toEqual([]);
  });

  it('chamada publicada sem prazo avisa; chamada sem prazo e inexistente não', () => {
    expect(ids({ callWithoutDeadline: true })).toContain('chamada-sem-prazo');
    expect(ids({ callWithoutDeadline: false })).not.toContain('chamada-sem-prazo');
  });

  it('a trilha só é cobrada quando a chamada científica está publicada', () => {
    expect(ids({ trackCount: 0, hasPublishedCall: true })).toContain('chamada-sem-trilha');

    /** Evento sem chamada publicada pode não ter trilha nenhuma — e está certo. */
    expect(ids({ trackCount: 0, hasPublishedCall: false })).not.toContain('chamada-sem-trilha');
  });

  it('toda pendência aponta para um atalho que EXISTE na tela', () => {
    const alvos = new Set([
      'confirmations-link',
      'calls-link',
      'landing-link',
      'event-area-salas',
      'activities-section',
      'tracks-section',
      'event-area-dados',
    ]);

    const todas = eventReadiness(
      fatos({
        pendingConfirmations: 2,
        roomsWithoutCapacity: 1,
        activityCount: 0,
        registrationHasDeadline: false,
        callWithoutDeadline: true,
        trackCount: 0,
        registrationCount: 0,
      }),
    );

    expect(todas.length).toBeGreaterThan(4);

    for (const item of todas) {
      expect(alvos.has(item.targetTestId), `alvo desconhecido em ${item.id}`).toBe(true);
      expect(item.detail.length).toBeGreaterThan(30);
    }
  });

  it('"no ar" é o que não é rascunho nem cancelado', () => {
    expect(isEventLive('DRAFT')).toBe(false);
    expect(isEventLive('CANCELED')).toBe(false);
    expect(isEventLive('PUBLISHED')).toBe(true);
    expect(isEventLive('FINISHED')).toBe(true);
  });
});

describe('catálogo das áreas de gestão', () => {
  it('não repete id nem endereço, e toda área se explica em uma linha', () => {
    const ids = EVENT_AREAS.map((area) => area.id);
    const hrefs = EVENT_AREAS.map((area) => area.href(CONTEXT));

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);

    for (const area of EVENT_AREAS) {
      expect(area.purpose.length, `área ${area.id} sem propósito`).toBeGreaterThan(20);
    }
  });

  it('preserva TODOS os atalhos que os E2E de outras fases já usavam', () => {
    const legados = EVENT_AREAS.map((area) => area.legacyTestId).filter(Boolean);

    for (const esperado of [
      'calls-link',
      'confirmations-link',
      'demands-link',
      'landing-link',
      'raffles-link',
      'speakers-link',
      'sponsors-link',
    ]) {
      expect(legados, `atalho ${esperado} desapareceu`).toContain(esperado);
    }
  });

  it('cada área pertence a um grupo declarado, e o agrupamento sai na ordem', () => {
    const grupos = new Set(EVENT_AREA_GROUPS.map((info) => info.group));

    for (const area of EVENT_AREAS) expect(grupos.has(area.group)).toBe(true);

    expect(groupEventAreas(EVENT_AREAS).map((info) => info.group)).toEqual([
      'CONFIGURAR',
      'VITRINE',
      'OPERAR',
      'RESULTADO',
    ]);
  });

  it('o resultado público não exige permissão NENHUMA, e não é tela de administração', () => {
    const publica = EVENT_AREAS.find((area) => area.publicView);

    expect(publica?.permission).toBeUndefined();
    expect(publica?.label).toBe('Ver página pública');
  });

  it('quem só cuida da página vê a página e o resultado público — e não o resto', () => {
    const visiveis = visibleEventAreas({
      allowed: (permission) => permission === PERMISSIONS.PAGE_MANAGE,
    }).map((area) => area.id);

    expect(visiveis).toContain('pagina');
    expect(visiveis).toContain('publico');
    expect(visiveis).not.toContain('patrocinadores');
    expect(visiveis).not.toContain('certificados');
  });

  it('o grupo vazio é descartado, e não deixa um título solto', () => {
    const apenasOperar = EVENT_AREAS.filter((area) => area.group === 'OPERAR');
    const grupos = groupEventAreas(apenasOperar);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.group).toBe('OPERAR');
  });
});

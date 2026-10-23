/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O caminho de partida do evento (FASE 77 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O guia responde "por onde começo" e o painel responde "o que atrapalha agora".
 *  Se as duas perguntas virarem uma só, a tela passa a discordar de si mesma: um
 *  evento DRAFT sem página e sem atividade sai com ZERO pendências e, ainda assim,
 *  não tem por onde o público entrar. Aqui se prova, sem banco e sem navegador:
 *
 *    • cada uma das três fatias conclui com o SEU fato — e só com ele;
 *    • `pagePublished: null` (página nunca criada) é PENDENTE;
 *    • os rótulos são os combinados, sem prometer validação que o sistema não faz;
 *    • a palavra "pronto" não aparece em NENHUM texto produzido;
 *    • todo alvo é o `data-testid` de um cartão que existe no catálogo; e
 *    • `sem-programacao` deixou de apontar para o `activities-section` que a FASE 55
 *      removeu do DOM.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  EVENT_AREAS,
  eventAreaTestId,
  findEventAreaByTestId,
  type EventAreaContext,
} from '../../src/domain/events/event-areas';
import {
  eventReadiness,
  type EventReadinessFacts,
} from '../../src/domain/events/event-readiness';
import {
  EVENT_LAUNCH_NOTE,
  EVENT_LAUNCH_STATE_LABEL,
  eventLaunchPath,
  type EventLaunchPathFacts,
  type EventLaunchStepId,
} from '../../src/domain/events/event-launch-path';

const CONTEXT: EventAreaContext = {
  tenantSlug: 'ufba-demo',
  eventId: '11111111-1111-4111-8111-111111111111',
  eventSlug: 'congresso-2026',
};

/** O evento que ainda não deu nenhum passo: sem prazo, sem atividade, sem página. */
const fatos = (patch: Partial<EventLaunchPathFacts> = {}): EventLaunchPathFacts => ({
  registrationHasDeadline: false,
  activityCount: 0,
  pagePublished: false,
  ...patch,
});

const passo = (id: EventLaunchStepId, patch: Partial<EventLaunchPathFacts> = {}) =>
  eventLaunchPath(fatos(patch)).steps.find((step) => step.id === id);

describe('caminho de partida — as três fatias', () => {
  it('cada fatia conclui com o SEU fato, e só com ele', () => {
    expect(passo('dados-e-prazos', { registrationHasDeadline: true })?.state).toBe('DONE');
    expect(passo('dados-e-prazos')?.state).toBe('PENDING');

    expect(passo('programacao', { activityCount: 1 })?.state).toBe('DONE');
    expect(passo('programacao', { activityCount: 0 })?.state).toBe('PENDING');

    expect(passo('pagina-no-ar', { pagePublished: true })?.state).toBe('DONE');
    expect(passo('pagina-no-ar', { pagePublished: false })?.state).toBe('PENDING');
  });

  it('página nunca criada (`null`) é PENDENTE — não se afirma "no ar" sem conferir', () => {
    expect(passo('pagina-no-ar', { pagePublished: null })?.state).toBe('PENDING');
    expect(eventLaunchPath(fatos({ pagePublished: null })).completed).toBe(0);
  });

  /**
   * A ordem é a de quem começa, e não a do banco: declarar prazos, montar a
   * programação e colocar a página no ar. O organizador precisa ver o caminho
   * inteiro, inclusive o que já foi dado.
   */
  it('os rótulos são os três combinados, na ordem do caminho', () => {
    expect(eventLaunchPath(fatos()).steps.map((step) => step.label)).toEqual([
      'Dados e prazos',
      'Programação',
      'Página no ar',
    ]);
  });

  it('a contagem vai de 0 a 3 e o total é sempre 3', () => {
    expect(eventLaunchPath(fatos()).summary).toBe(
      'Nenhum dos três passos de partida foi dado ainda.',
    );
    expect(eventLaunchPath(fatos({ registrationHasDeadline: true })).summary).toBe(
      '1 dos 3 passos de partida foi dado.',
    );
    expect(
      eventLaunchPath(fatos({ registrationHasDeadline: true, activityCount: 2 })).summary,
    ).toBe('2 dos 3 passos de partida foram dados.');
    expect(
      eventLaunchPath(
        fatos({ registrationHasDeadline: true, activityCount: 2, pagePublished: true }),
      ).summary,
    ).toBe('Os três passos de partida foram dados.');

    for (const caso of [
      fatos(),
      fatos({ registrationHasDeadline: true }),
      fatos({ registrationHasDeadline: true, activityCount: 1 }),
      fatos({ registrationHasDeadline: true, activityCount: 1, pagePublished: true }),
    ]) {
      expect(eventLaunchPath(caso).total).toBe(3);
    }
  });

  it('o caso 3/3 diz que os três passos foram dados — sem dizer que o evento está "pronto"', () => {
    const caminho = eventLaunchPath(
      fatos({ registrationHasDeadline: true, activityCount: 1, pagePublished: true }),
    );

    expect(caminho.completed).toBe(3);
    expect(caminho.summary).toBe('Os três passos de partida foram dados.');
    /**
     * A frase continua falando do CAMINHO. O painel é quem diz o que falta; o guia
     * não pode declarar o evento inteiro concluído por causa de três fatos.
     */
    expect(caminho.summary).not.toMatch(/pront/i);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A PALAVRA PROIBIDA
   * ─────────────────────────────────────────────────────────────────────────────
   *  O plano da fase é literal: "pronto" não entra em rótulo, contagem nem no caso
   *  3/3. O teste varre TODOS os textos que o domínio produz — rótulos, dicas,
   *  alvos, estados, resumo e a nota que reconcilia o guia com o painel — nos quatro
   *  estados possíveis, para que uma copy nova (ou uma alteração futura) não
   *  reintroduza a promessa.
   */
  it('a palavra "pronto" não aparece em NENHUM texto produzido', () => {
    for (const caso of [
      fatos(),
      fatos({ registrationHasDeadline: true }),
      fatos({ registrationHasDeadline: true, activityCount: 1 }),
      fatos({ registrationHasDeadline: true, activityCount: 1, pagePublished: true }),
    ]) {
      const caminho = eventLaunchPath(caso);
      const textos = [
        ...caminho.steps.flatMap((step) => [step.label, step.hint, step.targetTestId]),
        ...Object.values(EVENT_LAUNCH_STATE_LABEL),
        caminho.summary,
        EVENT_LAUNCH_NOTE,
      ];

      for (const texto of textos) {
        expect(texto).not.toMatch(/pront[oa]s?/i);
      }
    }
  });

  it('cada passo aponta para o `data-testid` de um cartão que existe no catálogo', () => {
    const caminho = eventLaunchPath(fatos());

    for (const step of caminho.steps) {
      expect(
        findEventAreaByTestId(step.targetTestId),
        `passo ${step.id} aponta para ${step.targetTestId}`,
      ).toBeDefined();
    }

    /**
     * Os nomes REAIS: duas áreas nascem como `event-area-<id>` e a página usa o
     * atalho legado `landing-link`, preservado pelo ADR-302. Fixá-los aqui impede
     * que o guia invente um `event-area-pagina` que não existe no DOM.
     */
    expect(caminho.steps.map((step) => step.targetTestId)).toEqual([
      'event-area-dados',
      'event-area-programacao',
      'landing-link',
    ]);
  });
});

describe('o link morto de `sem-programacao`', () => {
  /** Um evento no ar, sem atividade e com prazo: a pendência BLOCKING aparece. */
  const fatosDoPainel: EventReadinessFacts = {
    status: 'REGISTRATION_OPEN',
    activityCount: 0,
    registrationCount: 1,
    trackCount: 0,
    pendingConfirmations: 0,
    roomsWithoutCapacity: 0,
    roomCount: 0,
    usesCall: false,
    hasPublishedCall: false,
    callWithoutDeadline: false,
    registrationHasDeadline: true,
  };

  it('aponta para o cartão da Programação — um alvo que EXISTE em EVENT_AREAS', () => {
    const item = eventReadiness(fatosDoPainel).find(
      (pendencia) => pendencia.id === 'sem-programacao',
    );

    expect(item?.targetTestId).toBe('event-area-programacao');

    const area = findEventAreaByTestId(item?.targetTestId ?? '');

    expect(area, 'o alvo do painel não resolve para cartão nenhum').toBeDefined();
    expect(area?.id).toBe('programacao');
    expect(area?.href(CONTEXT)).toBe(
      '/t/ufba-demo/administracao/eventos/11111111-1111-4111-8111-111111111111/programacao',
    );
  });

  it('não sobrou nenhum alvo morto: TODA pendência resolve para um cartão do catálogo', () => {
    const todas = eventReadiness({
      ...fatosDoPainel,
      pendingConfirmations: 2,
      roomsWithoutCapacity: 1,
      callWithoutDeadline: true,
      usesCall: true,
      hasPublishedCall: true,
      trackCount: 0,
      registrationHasDeadline: false,
      registrationCount: 0,
    });

    expect(todas.length).toBeGreaterThan(4);

    const semAlvo = todas
      .filter((pendencia) => findEventAreaByTestId(pendencia.targetTestId) === undefined)
      .map((pendencia) => `${pendencia.id} → ${pendencia.targetTestId}`);

    expect(semAlvo).toEqual([]);
  });

  it('o catálogo é a fonte do alvo: toda área tem o testid que o render desenha', () => {
    for (const area of EVENT_AREAS) {
      expect(findEventAreaByTestId(eventAreaTestId(area))?.id).toBe(area.id);
    }
  });
});

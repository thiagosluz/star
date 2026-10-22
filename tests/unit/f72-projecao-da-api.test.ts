/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A PROJEÇÃO ÚNICA DA API (FASE 72 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (sem banco)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • as cinco projeções COPIAM o read model da página, sem recalcular vaga;
 *  • o envelope `{ data, meta }` tem `generatedAt` por parâmetro e a ordem
 *    canônica de cada recurso, inclusive nos objetos aninhados;
 *  • a LISTA FECHADA reprova em vez de filtrar: cada campo proibido injetado
 *    (inclusive aninhado e em português) faz `assertApiProjectionSemCampoProibido`
 *    lançar;
 *  • nenhuma projeção carrega o endereço da sala online, mesmo quando o read
 *    model de origem o tem — que é o caso real da página para quem tem lugar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  API_FIELD_ORDER,
  API_FORBIDDEN_FIELDS,
  API_META_FIELD_ORDER,
  API_NESTED_FIELD_ORDER,
  API_RESOURCES,
  ApiContractError,
  ApiProjectionLeakError,
  assertApiProjectionSemCampoProibido,
  buildApiEnvelope,
  findForbiddenApiField,
} from '../../src/domain/api/public-api-contract';
import { DEFAULT_THEME } from '../../src/domain/events/landing-page';
import {
  projectApiAtividades,
  projectApiChamadas,
  projectApiEvento,
  projectApiPalestrantes,
  projectApiPatrocinadores,
} from '../../src/lib/api/event-api-projection';
import type { PublicEventDetail } from '../../src/lib/events/event-repository';
import type { CallView } from '../../src/lib/proposals/call-service';

const TENANT = { slug: 'ufba-demo', name: 'UFBA' };
const NOW = new Date('2026-10-19T12:00:00.000Z');
const START = new Date('2026-11-01T15:00:00.000Z');
const END = new Date('2026-11-03T23:00:00.000Z');

/** Endereços que NÃO podem atravessar a API — o teste procura a string inteira. */
const EVENTO_ONLINE_URL = 'https://sala.exemplo.test/evento-secreto';
const ATIVIDADE_ONLINE_URL = 'https://sala.exemplo.test/atividade-secreta';

function atividade(): PublicEventDetail['activities'][number] {
  return {
    id: 'act-1',
    slug: 'abertura',
    title: 'Cerimônia de abertura',
    description: 'Abertura oficial do congresso.',
    type: 'LECTURE',
    status: 'SCHEDULED',
    modality: 'HYBRID',
    startsAt: START,
    endsAt: new Date(START.getTime() + 2 * 3_600_000),
    workloadMinutes: 120,
    roomName: 'Auditório Principal',
    /** A origem TEM o endereço: a projeção da API é quem não pode tê-lo. */
    onlineUrl: ATIVIDADE_ONLINE_URL,
    capacity: 300,
    roomCapacity: 300,
    confirmedCount: 12,
    waitlistEnabled: true,
    waitlistCount: 3,
    /**
     * Deliberadamente INCONSISTENTE com `capacity - confirmedCount` (288). A API
     * tem de copiar o número da página: recalcular aqui criaria a segunda conta e
     * é exatamente o defeito que a catraca quer ver se alguém introduzir.
     */
    remainingSeats: 7,
    checkInEnabled: true,
    isFeatured: true,
    requiresRegistration: false,
    tags: ['abertura', 'conferência'],
    speakerNames: ['Bruno Souza'],
    speakers: [
      {
        id: 'spk-1',
        name: 'Bruno Souza',
        roleTitle: 'Professor',
        avatarUrl: 'https://cdn.exemplo.test/bruno.webp',
        institution: 'UFBA',
        isKeynote: true,
      },
    ],
    materials: [
      {
        id: 'mat-1',
        title: 'Slides da abertura',
        kind: 'SLIDES',
        isFile: true,
        fileName: 'abertura.pdf',
        sizeBytes: 1234,
        externalUrl: null,
      },
    ],
  };
}

function palestrante(): PublicEventDetail['speakers'][number] {
  return {
    id: 'spk-1',
    name: 'Bruno Souza',
    roleTitle: 'Professor',
    avatarUrl: 'https://cdn.exemplo.test/bruno.webp',
    institution: 'UFBA',
    isKeynote: true,
    bio: 'Pesquisador de educação digital.',
    company: 'UFBA',
    socialLinks: {
      linkedin: 'https://www.linkedin.com/in/bruno',
      github: 'https://github.com/bruno',
    },
    displayOrder: 1,
    activities: [
      {
        activityId: 'act-1',
        activitySlug: 'abertura',
        title: 'Cerimônia de abertura',
        roleTitle: 'Keynote',
      },
    ],
    firstActivityAt: START,
  };
}

function patrocinador(): PublicEventDetail['sponsors'][number] {
  return {
    id: 'spo-1',
    name: 'Acme Educação',
    logoUrl: 'https://cdn.exemplo.test/acme.webp',
    websiteUrl: 'https://acme.exemplo.test',
    tierId: 'tier-1',
    tierName: 'Diamante',
    tierKey: 'DIAMOND',
    tierColor: '#ffcc00',
    tierLogoScale: 'LARGE',
    tierDescription: 'Apoiadora oficial do congresso.',
    displayOrder: 1,
  };
}

function evento(): PublicEventDetail {
  return {
    id: 'evt-1',
    slug: 'congresso-2026',
    title: 'Congresso de Tecnologia e Educação 2026',
    subtitle: 'Inovação, inclusão e futuro do ensino superior',
    summary: 'Três dias de palestras, minicursos e apresentações.',
    description: 'O congresso reúne pesquisadores, docentes e profissionais.',
    status: 'REGISTRATION_OPEN',
    modality: 'HYBRID',
    startsAt: START,
    endsAt: END,
    timezone: 'America/Bahia',
    venueName: 'Centro de Convenções da UFBA',
    venueAddress: 'Rua da Reitoria, 1',
    city: 'Salvador',
    state: 'BA',
    country: 'BR',
    /** A origem TEM o endereço: a projeção da API é quem não pode tê-lo. */
    onlineUrl: EVENTO_ONLINE_URL,
    coverImageUrl: 'https://cdn.exemplo.test/capa.webp',
    logoUrl: null,
    primaryColor: '#1d4ed8',
    registrationOpensAt: new Date('2026-10-18T00:00:00.000Z'),
    registrationClosesAt: new Date('2026-11-01T00:00:00.000Z'),
    capacity: 100,
    confirmedCount: 70,
    /** Ver a explicação em `atividade().remainingSeats`. */
    remainingSeats: 5,
    activityCount: 1,
    theme: DEFAULT_THEME,
    themeIsValid: true,
    registrationRequiresMembership: false,
    registrationFormFields: [],
    usesCall: true,
    speakers: [palestrante()],
    page: null,
    activities: [atividade()],
    tracks: [],
    sponsors: [patrocinador()],
    teams: [],
    organizers: [],
  };
}

function chamada(): CallView {
  return {
    id: 'call-1',
    kind: 'MINICOURSE',
    kindLabel: 'Minicurso',
    slug: 'chamada-minicursos',
    title: 'Chamada de minicursos',
    summary: 'Proponha um minicurso para o congresso.',
    instructions: 'Preencha o formulário até o prazo.',
    opensAt: new Date('2026-10-01T00:00:00.000Z'),
    closesAt: new Date('2026-10-30T23:59:00.000Z'),
    isPublished: true,
    requiresBlindReview: false,
    maxSubmissionsPerAuthor: 2,
    reviewRubric: [],
    trackId: null,
    trackName: null,
    state: 'OPEN',
    windowLabel: 'Aberta até 30/10',
    countdown: 'fecha em 3 dias',
    /** Contadores internos: a API não os devolve. */
    proposals: 4,
    decided: 1,
    /**
     * O estado do resultado publicado (FASE 73): a chamada de fixture nunca publicou
     * resultado, e a API não projeta este campo — ele é da landing.
     */
    resultState: 'SEM_RESULTADO',
  };
}

function projecoes() {
  const event = evento();

  return {
    evento: projectApiEvento({ event, tenant: TENANT, now: NOW }),
    atividades: projectApiAtividades(event),
    palestrantes: projectApiPalestrantes(event),
    patrocinadores: projectApiPatrocinadores(event),
    chamadas: projectApiChamadas({
      calls: [chamada()],
      tenantSlug: TENANT.slug,
      eventSlug: event.slug,
    }),
  };
}

describe('as projeções copiam o read model da página', () => {
  it('o evento carrega os mesmos valores da projeção pública, sem recalcular vaga', () => {
    const event = evento();
    const api = projectApiEvento({ event, tenant: TENANT, now: NOW });

    expect(api.id).toBe(event.id);
    expect(api.title).toBe(event.title);
    expect(api.description).toBe(event.description);
    expect(api.status).toBe(event.status);
    expect(api.startsAt).toBe(event.startsAt);
    expect(api.venueName).toBe(event.venueName);
    expect(api.registrationRequiresMembership).toBe(event.registrationRequiresMembership);
    expect(api.activityCount).toBe(event.activityCount);

    /**
     * `capacity - confirmedCount` daria 30; a página diz 5. A API devolve 5 — a
     * prova de que ela PROJETA e não recalcula.
     */
    expect(api.remainingSeats).toBe(5);
    expect(api.remainingSeats).not.toBe(event.capacity! - event.confirmedCount);

    /** Contador interno e página (rascunho/publicação) não atravessam a API. */
    expect('confirmedCount' in api).toBe(false);
    expect('page' in api).toBe(false);
    expect('onlineUrl' in api).toBe(false);
  });

  it('a atividade copia sala, vagas efetivas e palestrantes do read model', () => {
    const event = evento();
    const fonte = event.activities[0]!;
    const [api] = projectApiAtividades(event);

    expect(api).toBeDefined();
    if (!api) return;

    expect(api.id).toBe(fonte.id);
    expect(api.roomName).toBe(fonte.roomName);
    expect(api.capacity).toBe(fonte.capacity);
    expect(api.remainingSeats).toBe(7);
    expect(api.speakerNames).toEqual(fonte.speakerNames);
    expect(api.speakerIds).toEqual(['spk-1']);
    expect(api.tags).toEqual(fonte.tags);

    /** Operação e sala online não entram no contrato da atividade. */
    expect('onlineUrl' in api).toBe(false);
    expect('confirmedCount' in api).toBe(false);
    expect('waitlistEnabled' in api).toBe(false);
    expect('waitlistCount' in api).toBe(false);
    expect('checkInEnabled' in api).toBe(false);
    expect('roomCapacity' in api).toBe(false);
    expect('materials' in api).toBe(false);
  });

  it('o palestrante leva bio, instituição e atividades, sem e-mail nem userId', () => {
    const event = evento();
    const fonte = event.speakers[0]!;
    const [api] = projectApiPalestrantes(event);

    expect(api).toBeDefined();
    if (!api) return;

    expect(api.name).toBe(fonte.name);
    expect(api.bio).toBe(fonte.bio);
    expect(api.institution).toBe(fonte.institution);
    expect(api.socialLinks).toEqual(fonte.socialLinks);
    expect(api.activities).toEqual(fonte.activities);
    expect('email' in api).toBe(false);
    expect('userId' in api).toBe(false);
    expect('displayOrder' in api).toBe(false);
  });

  it('o patrocinador leva cota, cor e tamanho, sem contato comercial', () => {
    const event = evento();
    const fonte = event.sponsors[0]!;
    const [api] = projectApiPatrocinadores(event);

    expect(api).toBeDefined();
    if (!api) return;

    expect(api.name).toBe(fonte.name);
    expect(api.tierName).toBe(fonte.tierName);
    expect(api.tierColor).toBe(fonte.tierColor);
    expect(api.tierLogoScale).toBe(fonte.tierLogoScale);
    expect('contactEmail' in api).toBe(false);
    expect('contactPhone' in api).toBe(false);
  });

  it('a chamada leva estado e prazo, e NÃO leva os contadores de operação', () => {
    const [api] = projectApiChamadas({
      calls: [chamada()],
      tenantSlug: TENANT.slug,
      eventSlug: 'congresso-2026',
    });

    expect(api).toBeDefined();
    if (!api) return;

    expect(api.state).toBe('OPEN');
    expect(api.windowLabel).toBe('Aberta até 30/10');
    expect(api.countdown).toBe('fecha em 3 dias');
    expect(api.formPath).toBe(
      '/t/ufba-demo/eventos/congresso-2026/chamada/chamada-minicursos',
    );

    expect('proposals' in api).toBe(false);
    expect('decided' in api).toBe(false);
    expect('isPublished' in api).toBe(false);
    expect('requiresBlindReview' in api).toBe(false);
    expect('maxSubmissionsPerAuthor' in api).toBe(false);
    expect('reviewRubric' in api).toBe(false);
    expect('trackId' in api).toBe(false);
  });

  it('`registrationOpen` é derivado no instante recebido, não no relógio', () => {
    const event = evento();

    const durante = projectApiEvento({ event, tenant: TENANT, now: NOW });
    const depois = projectApiEvento({
      event,
      tenant: TENANT,
      now: new Date('2026-11-02T00:00:00.000Z'),
    });

    expect(durante.registrationOpen).toBe(true);
    expect(depois.registrationOpen).toBe(false);
  });
});

describe('a lista fechada reprova em vez de filtrar', () => {
  it('nenhuma das cinco projeções carrega campo proibido nem o endereço da sala', () => {
    const projections = projecoes();

    for (const resource of API_RESOURCES) {
      expect(
        findForbiddenApiField(projections[resource]),
        `o recurso ${resource} não pode conter campo proibido`,
      ).toBeNull();
      assertApiProjectionSemCampoProibido(resource, projections[resource]);
    }

    /**
     * O endereço literal também não pode aparecer em NENHUM valor (não só em uma
     * chave com nome proibido). É a prova que o E2E da página faz com
     * `page.content()`.
     */
    const serializado = JSON.stringify(projections);
    expect(serializado).not.toContain(EVENTO_ONLINE_URL);
    expect(serializado).not.toContain(ATIVIDADE_ONLINE_URL);
  });

  it('a própria ordem canônica não pode declarar um campo proibido', () => {
    for (const resource of API_RESOURCES) {
      for (const field of API_FIELD_ORDER[resource]) {
        expect(
          findForbiddenApiField({ [field]: null }),
          `${resource}.${field} está na ordem canônica e na lista fechada ao mesmo tempo`,
        ).toBeNull();
      }
    }
  });

  it('cada campo da lista fechada, injetado no topo, faz a asserção lançar', () => {
    const base = projectApiEvento({ event: evento(), tenant: TENANT, now: NOW });

    for (const { campo } of API_FORBIDDEN_FIELDS) {
      const violado = { ...base, [campo]: 'vazou' };

      expect(
        () => assertApiProjectionSemCampoProibido('evento', violado),
        `o campo "${campo}" precisa reprovar`,
      ).toThrow(ApiProjectionLeakError);
    }
  });

  it('o campo proibido é encontrado em profundidade, com o caminho', () => {
    const projections = projecoes();
    const atividadeComSala = { ...projections.atividades[0], onlineUrl: ATIVIDADE_ONLINE_URL };

    expect(() =>
      assertApiProjectionSemCampoProibido('atividades', [atividadeComSala]),
    ).toThrow(/onlineUrl.*data\[0\]\.onlineUrl/s);

    const encontrado = findForbiddenApiField({
      atividades: [atividadeComSala],
    });

    expect(encontrado).toEqual({
      campo: 'onlineUrl',
      caminho: 'data.atividades[0].onlineUrl',
    });
  });

  it('a chave em português e a mudança de grafia também reprovam', () => {
    for (const campo of ['inscrição', 'presença', 'online_url', 'REGISTRATION_ANSWERS']) {
      expect(
        () => assertApiProjectionSemCampoProibido('evento', { [campo]: 'x' }),
        `"${campo}" precisa reprovar`,
      ).toThrow(ApiProjectionLeakError);
    }
  });

  it('o envelope reprova antes de ordenar — o dado proibido não sai "quase certo"', () => {
    const projections = projecoes();

    expect(() =>
      buildApiEnvelope({
        resource: 'evento',
        data: { ...projections.evento, onlineUrl: EVENTO_ONLINE_URL },
        generatedAt: NOW,
      }),
    ).toThrow(ApiProjectionLeakError);
  });
});

describe('o envelope e a ordem canônica', () => {
  it('monta { data, meta } com generatedAt vindo por parâmetro', () => {
    const projections = projecoes();
    const envelope = buildApiEnvelope({
      resource: 'evento',
      data: projections.evento,
      generatedAt: NOW,
    });

    expect(Object.keys(envelope)).toEqual(['data', 'meta']);
    expect(Object.keys(envelope.meta)).toEqual(
      API_META_FIELD_ORDER.filter((field) => field in envelope.meta),
    );
    expect(envelope.meta.generatedAt).toBe('2026-10-19T12:00:00.000Z');
    expect(envelope.data.startsAt).toBe(START.toISOString());
  });

  it('a lista ganha `count` depois de `generatedAt`; o etag entra no meio', () => {
    const projections = projecoes();

    const lista = buildApiEnvelope({
      resource: 'atividades',
      data: projections.atividades,
      generatedAt: NOW,
    });

    expect(Object.keys(lista.meta)).toEqual(['generatedAt', 'count']);
    expect(lista.meta.count).toBe(1);

    const comEtag = buildApiEnvelope({
      resource: 'atividades',
      data: projections.atividades,
      generatedAt: NOW,
      etag: 'abc123',
    });

    expect(Object.keys(comEtag.meta)).toEqual([...API_META_FIELD_ORDER]);
    expect(comEtag.meta.etag).toBe('abc123');
  });

  it('cada recurso sai na ordem declarada, inclusive nos objetos aninhados', () => {
    const projections = projecoes();

    for (const resource of API_RESOURCES) {
      const envelope = buildApiEnvelope({
        resource,
        data: projections[resource],
        generatedAt: NOW,
      });

      const amostra = Array.isArray(envelope.data) ? envelope.data[0] : envelope.data;

      expect(
        Object.keys(amostra as object),
        `ordem do recurso ${resource}`,
      ).toEqual([...API_FIELD_ORDER[resource]]);
    }

    const eventoEnvelope = buildApiEnvelope({
      resource: 'evento',
      data: projections.evento,
      generatedAt: NOW,
    });

    expect(Object.keys(eventoEnvelope.data.tenant)).toEqual(['slug', 'name']);
    expect(Object.keys(eventoEnvelope.data.theme)).toEqual([
      ...API_NESTED_FIELD_ORDER.evento.theme.filter(
        (field) => field in eventoEnvelope.data.theme,
      ),
    ]);

    const palestrantesEnvelope = buildApiEnvelope({
      resource: 'palestrantes',
      data: projections.palestrantes,
      generatedAt: NOW,
    });

    const primeiro = palestrantesEnvelope.data[0]!;
    expect(Object.keys(primeiro.socialLinks)).toEqual([
      ...API_NESTED_FIELD_ORDER.palestrantes.socialLinks.filter(
        (field) => field in primeiro.socialLinks,
      ),
    ]);
    expect(Object.keys(primeiro.activities[0]!)).toEqual([
      ...API_NESTED_FIELD_ORDER.palestrantes.activities,
    ]);
  });

  it('recusa chave fora da ordem canônica — o formato é contrato', () => {
    const projections = projecoes();

    expect(() =>
      buildApiEnvelope({
        resource: 'evento',
        data: { ...projections.evento, campoNovo: 'sem posição declarada' },
        generatedAt: NOW,
      }),
    ).toThrow(ApiContractError);
  });

  it('o mesmo dado e o mesmo instante produzem o mesmo JSON', () => {
    const projections = projecoes();

    const primeiro = JSON.stringify(
      buildApiEnvelope({ resource: 'chamadas', data: projections.chamadas, generatedAt: NOW }),
    );
    const segundo = JSON.stringify(
      buildApiEnvelope({ resource: 'chamadas', data: projections.chamadas, generatedAt: NOW }),
    );

    expect(segundo).toBe(primeiro);
  });
});

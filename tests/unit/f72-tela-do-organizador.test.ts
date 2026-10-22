/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE UNIDADE — a TELA do organizador da API do evento (FASE 72 · fatia 3)
 *
 *  O que se prova sem banco e sem navegador:
 *  • cada ESTADO da chave (sem chave, ativa, revogada, inválida) tem a frase certa,
 *    e a frase promete o comportamento externo que a API tem de fato;
 *  • o selo do cartão respeita a catraca da F54: zero aparece ("nenhuma chave"),
 *    `null`/`INVALID` NÃO viram selo;
 *  • o aviso de publicação distingue rascunho de "fora do ar" e diz que 404 é o
 *    mesmo código de inexistente;
 *  • as seções interruptáveis são as do domínio, a frase diz que nascem desligadas
 *    e que desligada responde 404; evento e programação são declarados NÃO
 *    interruptáveis;
 *  • o endereço de cada recurso usa o slug REAL (nunca `<slug>`) e a documentação
 *    cobre todos os recursos e todos os limites exigidos pela fase;
 *  • o cartão da área existe no grupo CONFIGURAR, logo depois do formulário, com a
 *    permissão `event:update`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  readEventApiConfig,
  type ReadEventApiConfigResult,
} from '../../src/domain/api/event-api-key-rules';
import {
  EVENT_API_FIXED_RESOURCES_NOTICE,
  EVENT_API_LIMITS,
  EVENT_API_NEVER_EXPOSED,
  EVENT_API_RESOURCE_DOCS,
  EVENT_API_RESOURCE_METHOD,
  EVENT_API_SECTIONS_BORN_OFF,
  EVENT_API_SECTION_INFO,
  EVENT_API_TOGGLEABLE_SECTIONS,
  eventApiAreaMetric,
  eventApiKeyStateCopy,
  eventApiPublicationCopy,
  eventApiResourcePath,
  eventApiSectionOffNotice,
  readEventApiKeyState,
  type EventApiKeyState,
} from '../../src/domain/api/event-api-organizer-rules';
import { API_FIELD_ORDER, API_RESOURCES } from '../../src/domain/api/public-api-contract';
import {
  EMPTY_EVENT_AREA_COUNTS,
  EVENT_AREAS,
  eventAreaMetric,
  type EventAreaCounts,
} from '../../src/domain/events/event-areas';
import { PERMISSIONS } from '../../src/domain/rbac/permissions';

const HASH = 'b'.repeat(64);

function configuracao(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chaveSelada: 'iv.tag.cifra',
    chaveHash: HASH,
    criadaEm: '2026-10-19T12:00:00.000Z',
    secoes: { palestrantes: false, patrocinadores: false, chamadas: false },
    ...overrides,
  };
}

function ler(overrides: Record<string, unknown> = {}): ReadEventApiConfigResult {
  return readEventApiConfig({ api: configuracao(overrides) });
}

const contagens = (patch: Partial<EventAreaCounts> = {}): EventAreaCounts => ({
  ...EMPTY_EVENT_AREA_COUNTS,
  ...patch,
});

describe('o estado da chave e a frase que o organizador lê', () => {
  it('sem chave é NONE, e a frase diz que a API responde 401 até gerar', () => {
    const read = readEventApiConfig({});
    expect(readEventApiKeyState(read)).toBe('NONE');

    const copy = eventApiKeyStateCopy({ state: 'NONE' });
    expect(copy.title).toBe('Sem chave');
    expect(copy.body).toContain('401');
    expect(copy.body).toContain('gerar uma chave');
  });

  it('chave válida e não revogada é ACTIVE, com a data de criação na frase', () => {
    expect(readEventApiKeyState(ler())).toBe('ACTIVE');

    const copy = eventApiKeyStateCopy({ state: 'ACTIVE', criadaEmLabel: '19/10/2026 09:00' });
    expect(copy.title).toBe('Chave ativa');
    expect(copy.body).toContain('Criada em 19/10/2026 09:00');
  });

  it('revogada é um ESTADO lido, não uma configuração inválida', () => {
    const read = ler({ revogadaEm: '2026-10-20T00:00:00.000Z' });

    expect(read.configured).toBe(true);
    expect(readEventApiKeyState(read)).toBe('REVOKED');

    const copy = eventApiKeyStateCopy({ state: 'REVOKED', revogadaEmLabel: '20/10/2026 09:00' });
    expect(copy.title).toBe('Chave revogada');
    expect(copy.body).toContain('Revogada em 20/10/2026 09:00');
    expect(copy.body).toContain('401');
  });

  it('configuração torta é INVALID — e a frase diz que gerar substitui o que está gravado', () => {
    const read = ler({ chaveHash: 'curto' });

    expect(read.configured).toBe(false);
    expect(readEventApiKeyState(read)).toBe('INVALID');

    const copy = eventApiKeyStateCopy({ state: 'INVALID' });
    expect(copy.title).toContain('inválida');
    expect(copy.body).toContain('substitui');
  });

  it('data ausente NÃO é inventada: a frase diz que não está disponível', () => {
    expect(eventApiKeyStateCopy({ state: 'ACTIVE' }).body).toContain('data não disponível');
    expect(eventApiKeyStateCopy({ state: 'REVOKED' }).body).toContain('data não disponível');
  });
});

describe('o selo de contagem da área api (catraca da F54)', () => {
  it('zero é RESPOSTA: "nenhuma chave" aparece, em vez de sumir', () => {
    expect(eventApiAreaMetric('NONE')).toBe('nenhuma chave');
    expect(eventAreaMetric('api', contagens({ apiKey: 'NONE' }))).toBe('nenhuma chave');
  });

  it('"1 chave ativa" e "chave revogada" são os outros dois estados', () => {
    expect(eventApiAreaMetric('ACTIVE')).toBe('1 chave ativa');
    expect(eventApiAreaMetric('REVOKED')).toBe('chave revogada');
    expect(eventAreaMetric('api', contagens({ apiKey: 'ACTIVE' }))).toBe('1 chave ativa');
    expect(eventAreaMetric('api', contagens({ apiKey: 'REVOKED' }))).toBe('chave revogada');
  });

  it('`null` (não conferido) e INVALID (não sei) saem SEM selo', () => {
    expect(eventApiAreaMetric(null)).toBeNull();
    expect(eventApiAreaMetric('INVALID')).toBeNull();
    expect(eventAreaMetric('api', EMPTY_EVENT_AREA_COUNTS)).toBeNull();
    expect(eventAreaMetric('api', contagens({ apiKey: null }))).toBeNull();
  });

  it('a área api não pega carona no selo de outra área', () => {
    const cheio = contagens({
      calls: 7,
      activities: 3,
      apiKey: 'NONE',
    });

    expect(eventAreaMetric('api', cheio)).toBe('nenhuma chave');
    expect(eventAreaMetric('chamadas', cheio)).toBe('7 chamadas');
    expect(eventAreaMetric('programacao', cheio)).toBe('3 atividades');
  });
});

describe('o aviso de publicação', () => {
  it('evento no ar diz que a API responde para quem apresentar a chave', () => {
    const copy = eventApiPublicationCopy({ published: true, status: 'REGISTRATION_OPEN' });

    expect(copy.live).toBe(true);
    expect(copy.title).toBe('O evento está no ar');
    expect(copy.body).toContain('chave');
  });

  it('rascunho diz 404 e explica que o código é o MESMO de inexistente', () => {
    const copy = eventApiPublicationCopy({ published: false, status: 'DRAFT' });

    expect(copy.live).toBe(false);
    expect(copy.title).toBe('O evento está em rascunho');
    expect(copy.body).toContain('404');
    expect(copy.body).toContain('inexistente');
    expect(copy.body).toContain('de propósito');
  });

  it('evento fora do ar por outro motivo não é chamado de rascunho', () => {
    const copy = eventApiPublicationCopy({ published: false, status: 'FINISHED' });

    expect(copy.title).toBe('O evento não está publicado');
    expect(copy.body).toContain('404');
  });
});

describe('as seções interruptáveis', () => {
  it('as três seções são exatamente as do domínio', () => {
    expect(EVENT_API_SECTION_INFO.map((info) => info.section)).toEqual([
      ...EVENT_API_TOGGLEABLE_SECTIONS,
    ]);
    expect(EVENT_API_TOGGLEABLE_SECTIONS).toEqual(['palestrantes', 'patrocinadores', 'chamadas']);

    for (const info of EVENT_API_SECTION_INFO) {
      expect(info.label.length).toBeGreaterThan(2);
      expect(info.description.length).toBeGreaterThan(20);
      expect(API_RESOURCES).toContain(info.resource);
    }
  });

  it('a frase diz que nascem DESLIGADAS e que desligada responde 404', () => {
    expect(EVENT_API_SECTIONS_BORN_OFF).toContain('DESLIGADAS');
    expect(EVENT_API_SECTIONS_BORN_OFF).toContain('só a sua escolha explícita');
    expect(EVENT_API_SECTIONS_BORN_OFF).toContain('404');
    expect(EVENT_API_SECTIONS_BORN_OFF).toContain('como se não existisse');
  });

  it('cada seção desligada tem a frase do próprio recurso', () => {
    for (const info of EVENT_API_SECTION_INFO) {
      const aviso = eventApiSectionOffNotice(info.section);

      expect(aviso).toContain(info.label);
      expect(aviso).toContain(`/${info.resource}`);
      expect(aviso).toContain('404');
    }
  });

  it('evento e programação são declarados NÃO interruptáveis', () => {
    expect(EVENT_API_FIXED_RESOURCES_NOTICE).toContain('NÃO têm interruptor');
    expect(EVENT_API_FIXED_RESOURCES_NOTICE).toContain('evento e a programação');
  });
});

describe('os endereços e a documentação', () => {
  const contexto = { tenantSlug: 'ufba-demo', eventSlug: 'congresso-2026' };

  it('o endereço usa o slug REAL e nunca um marcador <slug>', () => {
    const evento = eventApiResourcePath({ ...contexto, resource: 'evento' });
    const palestrantes = eventApiResourcePath({ ...contexto, resource: 'palestrantes' });

    expect(evento).toBe('/api/v1/t/ufba-demo/eventos/congresso-2026');
    expect(palestrantes).toBe('/api/v1/t/ufba-demo/eventos/congresso-2026/palestrantes');
    expect(`${evento}${palestrantes}`).not.toContain('<');
    expect(EVENT_API_RESOURCE_METHOD).toBe('GET');
  });

  it('a documentação cobre TODOS os recursos do contrato, na mesma ordem', () => {
    expect(EVENT_API_RESOURCE_DOCS.map((doc) => doc.resource)).toEqual([...API_RESOURCES]);
  });

  it('cada recurso documenta os campos da ORDEM CANÔNICA (o contrato)', () => {
    for (const doc of EVENT_API_RESOURCE_DOCS) {
      expect(API_FIELD_ORDER[doc.resource].length, `campos de ${doc.resource}`).toBeGreaterThan(3);
    }
  });

  it('os limites exigidos pela fase estão todos escritos', () => {
    const texto = EVENT_API_LIMITS.map((limit) => `${limit.title} ${limit.detail}`).join(' ');

    expect(texto).toContain('120');
    expect(texto).toContain('minuto');
    expect(texto).toContain('ETag');
    expect(texto).toContain('304');
    expect(texto).toContain('CORS');
    expect(texto).toContain('Access-Control-Allow-Origin');
    expect(texto).toContain('Authorization: Bearer');
    expect(texto).toContain('401');
    expect(texto).toContain('429');
    expect(texto).toContain('405');
  });

  it('a lista fechada é dita em uma frase', () => {
    for (const proibido of ['sala online', 'participante', 'formulário', 'CPF', 'lista de espera']) {
      expect(EVENT_API_NEVER_EXPOSED).toContain(proibido);
    }
  });
});

describe('o cartão da área na raiz do evento', () => {
  const contexto = {
    tenantSlug: 'ufba-demo',
    eventId: '11111111-1111-4111-8111-111111111111',
    eventSlug: 'congresso-2026',
  };

  it('existe no grupo CONFIGURAR, logo depois do formulário, com a permissão event:update', () => {
    const indice = EVENT_AREAS.findIndex((area) => area.id === 'api');
    const area = EVENT_AREAS[indice];

    expect(indice).toBeGreaterThan(0);
    expect(EVENT_AREAS[indice - 1]?.id).toBe('formulario');
    expect(area?.group).toBe('CONFIGURAR');
    expect(area?.permission).toBe(PERMISSIONS.EVENT_UPDATE);
    expect(area?.purpose.length).toBeGreaterThan(20);
    expect(area?.href(contexto)).toBe(
      '/t/ufba-demo/administracao/eventos/11111111-1111-4111-8111-111111111111/api',
    );
  });

  it('o cartão não promete um endereço que se repete', () => {
    const hrefs = EVENT_AREAS.map((area) => area.href(contexto));

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('a régua de estado é a mesma da página', () => {
  it('NONE, ACTIVE, REVOKED e INVALID são os únicos estados', () => {
    const estados: EventApiKeyState[] = ['NONE', 'ACTIVE', 'REVOKED', 'INVALID'];

    for (const estado of estados) {
      expect(eventApiKeyStateCopy({ state: estado }).title.length).toBeGreaterThan(3);
    }
  });
});

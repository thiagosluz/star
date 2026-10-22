/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE UNIDADE — a chave da API por evento (FASE 72 · fatia 2)
 *
 *  O que se prova sem banco:
 *  • a leitura TOLERANTE de `settings.api` recusa configuração torta (fail-closed)
 *    e devolve o motivo, sem 500;
 *  • uma seção só expõe com `true` EXPLÍCITO — o resto (ausente, falso, string)
 *    desliga, porque "expor é decisão explícita";
 *  • o cofre sela e abre, o índice SHA-256 é estável, o selo adulterado não abre e
 *    a comparação em tempo constante recusa hash fora do formato;
 *  • `Authorization: Bearer` é lido sem "consertar" cabeçalho torto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  EVENT_API_SECTIONS,
  buildEventApiConfig,
  isEventApiKeyRevoked,
  isEventApiSectionEnabled,
  readEventApiConfig,
  readEventApiSections,
} from '../../src/domain/api/event-api-key-rules';
import {
  createEventApiKeySecret,
  eventApiKeyMatchesHash,
  extractBearerKey,
  hashEventApiKey,
  openEventApiKey,
  sealEventApiKey,
} from '../../src/lib/api/event-api-key-vault';

const HASH = 'a'.repeat(64);

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chaveSelada: 'iv.tag.cifra',
    chaveHash: HASH,
    criadaEm: '2026-10-19T12:00:00.000Z',
    secoes: { palestrantes: true, patrocinadores: false, chamadas: true },
    ...overrides,
  };
}

describe('readEventApiConfig — o leitor tolerante de settings.api', () => {
  it('sem settings/api é o caso normal: não configurado, sem problema', () => {
    for (const settings of [undefined, null, {}, [], 'texto', 42, { api: null }]) {
      const read = readEventApiConfig(settings);
      expect(read.configured).toBe(false);
      expect(read.config).toBeNull();
      expect(read.problems).toEqual([]);
    }
  });

  it('configuração bem formada é lida com os interruptores', () => {
    const read = readEventApiConfig({ api: config() });

    expect(read.configured).toBe(true);
    expect(read.problems).toEqual([]);
    expect(read.config).not.toBeNull();
    if (!read.config) return;

    expect(read.config.chaveHash).toBe(HASH);
    expect(read.config.criadaEm).toBe('2026-10-19T12:00:00.000Z');
    expect(read.config.revogadaEm).toBeNull();
    expect(read.config.secoes).toEqual({
      palestrantes: true,
      patrocinadores: false,
      chamadas: true,
    });
  });

  it('configuração torta é RECUSADA inteira, com o motivo', () => {
    const cases: [string, unknown][] = [
      ['api não é objeto', { api: 'a chave' }],
      ['api é lista', { api: [config()] }],
      ['sem selo', { api: config({ chaveSelada: '' }) }],
      ['selo não é texto', { api: config({ chaveSelada: 7 }) }],
      ['sem hash', { api: config({ chaveHash: undefined }) }],
      ['hash truncado', { api: config({ chaveHash: 'abc' }) }],
      ['hash em maiúsculas', { api: config({ chaveHash: HASH.toUpperCase() }) }],
      ['sem criadaEm', { api: config({ criadaEm: null }) }],
      ['criadaEm inválida', { api: config({ criadaEm: 'ontem' }) }],
      ['revogadaEm inválida', { api: config({ revogadaEm: 'não' }) }],
    ];

    for (const [label, settings] of cases) {
      const read = readEventApiConfig(settings);

      expect(read.configured, label).toBe(false);
      expect(read.config, label).toBeNull();
      expect(read.problems.length, label).toBeGreaterThan(0);
    }
  });

  it('revogada continua sendo configuração LIDA (é estado, não JSON torto)', () => {
    const read = readEventApiConfig({ api: config({ revogadaEm: '2026-10-20T00:00:00.000Z' }) });

    expect(read.configured).toBe(true);
    expect(read.config).not.toBeNull();
    if (!read.config) return;

    expect(isEventApiKeyRevoked(read.config)).toBe(true);
  });

  it('seção só liga com `true` explícito — o resto desliga', () => {
    const cases: [unknown, boolean][] = [
      [true, true],
      [false, false],
      ['true', false],
      [1, false],
      [undefined, false],
      [null, false],
      [{}, false],
    ];

    for (const [value, expected] of cases) {
      const sections = readEventApiSections({ palestrantes: value });
      expect(sections.palestrantes, String(value)).toBe(expected);
    }

    expect(readEventApiSections(undefined)).toEqual({
      palestrantes: false,
      patrocinadores: false,
      chamadas: false,
    });
  });

  it('configuração criada nasce com as TRÊS seções desligadas', () => {
    const built = buildEventApiConfig({
      chaveSelada: 'selo',
      chaveHash: HASH,
      criadaEm: new Date('2026-10-19T12:00:00.000Z'),
    });

    expect(built.secoes).toEqual({
      palestrantes: false,
      patrocinadores: false,
      chamadas: false,
    });
    expect(built.revogadaEm).toBeNull();
    expect(built.criadaEm).toBe('2026-10-19T12:00:00.000Z');
  });

  it('isEventApiSectionEnabled pergunta pela seção certa', () => {
    const built = buildEventApiConfig({
      chaveSelada: 'selo',
      chaveHash: HASH,
      criadaEm: new Date('2026-10-19T12:00:00.000Z'),
      secoes: { chamadas: true },
    });

    expect(isEventApiSectionEnabled(built, 'chamadas')).toBe(true);
    expect(isEventApiSectionEnabled(built, 'palestrantes')).toBe(false);
    expect(isEventApiSectionEnabled(built, 'patrocinadores')).toBe(false);

    /** A lista do domínio e a interface não podem divergir. */
    expect([...EVENT_API_SECTIONS]).toEqual(['palestrantes', 'patrocinadores', 'chamadas']);
  });
});

describe('o cofre da chave (AES-256-GCM reaproveitado da F48)', () => {
  it('sela e abre a MESMA chave; o índice é SHA-256 estável', () => {
    const chave = createEventApiKeySecret();

    expect(chave).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const sealed = sealEventApiKey(chave);
    expect(sealed).not.toBeNull();
    if (!sealed) return;

    expect(sealed).toContain('.');
    expect(sealed).not.toContain(chave);
    expect(openEventApiKey(sealed)).toBe(chave);

    expect(hashEventApiKey(chave)).toBe(hashEventApiKey(chave));
    expect(hashEventApiKey(chave)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('selo adulterado não abre (fail-closed)', () => {
    const chave = createEventApiKeySecret();
    const sealed = sealEventApiKey(chave);
    expect(sealed).not.toBeNull();
    if (!sealed) return;

    const parts = sealed.split('.');
    const adulterado = [parts[0], parts[1], `${parts[2]}x`].join('.');

    expect(openEventApiKey(adulterado)).toBeNull();
    expect(openEventApiKey('sem.formato')).toBeNull();
    expect(openEventApiKey(null)).toBeNull();
    expect(openEventApiKey('')).toBeNull();
  });

  it('sem BETTER_AUTH_SECRET o cofre RECUSA selar em vez de gravar em claro', () => {
    const original = process.env.BETTER_AUTH_SECRET;

    try {
      delete process.env.BETTER_AUTH_SECRET;

      expect(sealEventApiKey('chave')).toBeNull();
      expect(openEventApiKey('a.b.c')).toBeNull();
      /** O índice continua funcionando: verificar não depende do segredo. */
      expect(hashEventApiKey('chave')).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (original === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = original;
    }
  });

  it('a comparação é pelo índice e RECUSA hash fora do formato', () => {
    const chave = createEventApiKeySecret();
    const hash = hashEventApiKey(chave);

    expect(eventApiKeyMatchesHash(chave, hash)).toBe(true);
    expect(eventApiKeyMatchesHash(createEventApiKeySecret(), hash)).toBe(false);
    expect(eventApiKeyMatchesHash(chave, HASH)).toBe(false);
    expect(eventApiKeyMatchesHash(chave, 'ABC')).toBe(false);
    expect(eventApiKeyMatchesHash(chave, `${hash} `)).toBe(false);
  });

  it('lê Authorization: Bearer sem consertar cabeçalho torto', () => {
    expect(extractBearerKey('Bearer abc123')).toBe('abc123');
    expect(extractBearerKey('bearer abc123')).toBe('abc123');
    expect(extractBearerKey('Bearer    abc123')).toBe('abc123');
    expect(extractBearerKey('Bearer ')).toBeNull();
    expect(extractBearerKey('Basic abc123')).toBeNull();
    expect(extractBearerKey('Bearer abc def')).toBeNull();
    expect(extractBearerKey('')).toBeNull();
    expect(extractBearerKey(null)).toBeNull();
  });
});

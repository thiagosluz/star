/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE UNIDADE — o HTTP da API (FASE 72 · fatia 2)
 *
 *  Prova sem banco o que é contrato de resposta:
 *  • o ETag depende do CONTEÚDO canônico, não da ordem de inserção nem do
 *    `generatedAt` (senão o 304 nunca aconteceria);
 *  • `If-None-Match` aceita o selo forte, o fraco e a lista;
 *  • o 200 monta `{ data, meta }` com a ordem canônica e o mesmo ETag do
 *    cabeçalho; o 304 sai SEM corpo;
 *  • HEAD devolve os mesmos cabeçalhos e nenhum corpo;
 *  • erro é `{ code, message }`, `no-store` e com CORS (o site externo precisa LER
 *    a recusa);
 *  • o preflight libera `Authorization` e `If-None-Match`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { API_FIELD_ORDER, type ApiResource } from '../../src/domain/api/public-api-contract';
import {
  computeEventApiEtag,
  eventApiErrorResponse,
  eventApiPreflightResponse,
  eventApiSuccessResponse,
  ifNoneMatchMatches,
} from '../../src/lib/api/event-api-http';

const GENERATED_AT = new Date('2026-10-19T12:00:00.000Z');

const PATROCINADOR = {
  id: 's1',
  name: 'ACME',
  logoUrl: null,
  websiteUrl: null,
  tierId: null,
  tierName: null,
  tierKey: null,
  tierColor: null,
  tierLogoScale: 'MEDIUM',
  tierDescription: null,
};

function request(path = 'http://localhost/api/v1/t/ufba-demo/eventos/congresso-2026/patrocinadores', init: RequestInit = {}): Request {
  return new Request(path, init);
}

describe('ETag — derivado do conteúdo canônico', () => {
  it('não depende da ordem em que as chaves foram montadas', () => {
    const reordenado = {
      tierDescription: null,
      tierLogoScale: 'MEDIUM',
      tierColor: null,
      tierKey: null,
      tierName: null,
      tierId: null,
      websiteUrl: null,
      logoUrl: null,
      name: 'ACME',
      id: 's1',
    };

    expect(computeEventApiEtag('patrocinadores', [PATROCINADOR])).toBe(
      computeEventApiEtag('patrocinadores', [reordenado]),
    );
  });

  it('muda quando o conteúdo muda', () => {
    const outro = { ...PATROCINADOR, name: 'Outra' };

    expect(computeEventApiEtag('patrocinadores', [PATROCINADOR])).not.toBe(
      computeEventApiEtag('patrocinadores', [outro]),
    );
  });

  it('não depende do instante (o generatedAt fica FORA do hash)', () => {
    const primeiro = computeEventApiEtag('patrocinadores', [PATROCINADOR]);
    const segundo = computeEventApiEtag('patrocinadores', [PATROCINADOR]);

    expect(primeiro).toBe(segundo);
    expect(primeiro).toMatch(/^"[0-9a-f]{32}"$/);
  });
});

describe('If-None-Match', () => {
  const etag = '"abc"';

  it('aceita o selo exato, o fraco e a lista; recusa o resto', () => {
    expect(ifNoneMatchMatches('"abc"', etag)).toBe(true);
    expect(ifNoneMatchMatches('W/"abc"', etag)).toBe(true);
    expect(ifNoneMatchMatches('"x", "abc"', etag)).toBe(true);
    expect(ifNoneMatchMatches('*', etag)).toBe(true);
    expect(ifNoneMatchMatches('"outro"', etag)).toBe(false);
    expect(ifNoneMatchMatches('', etag)).toBe(false);
    expect(ifNoneMatchMatches(null, etag)).toBe(false);
  });
});

describe('a resposta de leitura', () => {
  it('200: envelope, ordem canônica do recurso e ETag no cabeçalho e no meta', async () => {
    const response = eventApiSuccessResponse({
      request: request(),
      resource: 'patrocinadores',
      data: [PATROCINADOR],
      generatedAt: GENERATED_AT,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('vary')).toContain('Authorization');

    const etag = response.headers.get('etag');
    expect(etag).not.toBeNull();

    const body = (await response.json()) as {
      data: Record<string, unknown>[];
      meta: { generatedAt: string; etag: string; count: number };
    };

    expect(Object.keys(body)).toEqual(['data', 'meta']);
    expect(Object.keys(body.data[0] ?? {})).toEqual([
      ...API_FIELD_ORDER.patrocinadores,
    ]);
    expect(Object.keys(body.meta)).toEqual(['generatedAt', 'etag', 'count']);
    expect(body.meta.generatedAt).toBe(GENERATED_AT.toISOString());
    expect(body.meta.etag).toBe(etag);
    expect(body.meta.count).toBe(1);
  });

  it('304: sem corpo quando o If-None-Match bate', async () => {
    const first = eventApiSuccessResponse({
      request: request(),
      resource: 'patrocinadores',
      data: [PATROCINADOR],
      generatedAt: GENERATED_AT,
    });

    const etag = first.headers.get('etag');
    expect(etag).not.toBeNull();
    if (!etag) return;

    const second = eventApiSuccessResponse({
      request: request(undefined, { headers: { 'If-None-Match': etag } }),
      resource: 'patrocinadores',
      data: [PATROCINADOR],
      generatedAt: new Date(GENERATED_AT.getTime() + 60_000),
    });

    expect(second.status).toBe(304);
    expect(second.headers.get('etag')).toBe(etag);
    expect(second.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await second.text()).toBe('');
  });

  it('HEAD: os mesmos cabeçalhos, nenhum corpo', async () => {
    const response = eventApiSuccessResponse({
      request: request(undefined, { method: 'HEAD' }),
      resource: 'patrocinadores',
      data: [PATROCINADOR],
      generatedAt: GENERATED_AT,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).not.toBeNull();
    expect(response.headers.get('content-length')).not.toBeNull();
    expect(await response.text()).toBe('');
  });

  it('um recurso sem item nenhum ainda é envelope válido (lista vazia)', async () => {
    const response = eventApiSuccessResponse({
      request: request(),
      resource: 'atividades',
      data: [],
      generatedAt: GENERATED_AT,
    });

    const body = (await response.json()) as { data: unknown[]; meta: { count: number } };

    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
    expect(response.status).toBe(200);
  });
});

describe('erro e preflight', () => {
  it('erro: `{ code, message }`, no-store e CORS', async () => {
    const response = eventApiErrorResponse({
      request: request(),
      status: 401,
      code: 'INVALID_API_KEY',
      message: 'Chave de acesso inválida ou revogada.',
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({
      code: 'INVALID_API_KEY',
      message: 'Chave de acesso inválida ou revogada.',
    });
  });

  it('405 leva `Allow`; 429 leva `Retry-After`', async () => {
    const method = eventApiErrorResponse({
      request: request(undefined, { method: 'POST' }),
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
      message: 'Método não permitido. Esta API é somente leitura.',
      extraHeaders: { Allow: 'GET, HEAD, OPTIONS' },
    });

    expect(method.headers.get('allow')).toBe('GET, HEAD, OPTIONS');

    const limited = eventApiErrorResponse({
      request: request(),
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Muitas requisições. Tente de novo em instantes.',
      extraHeaders: { 'Retry-After': '37' },
    });

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('37');
  });

  it('OPTIONS responde o preflight com `*` e os cabeçalhos que o navegador pede', () => {
    const response = eventApiPreflightResponse();

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
    expect(response.headers.get('access-control-allow-methods')).toContain('HEAD');
    expect(response.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(response.headers.get('access-control-allow-headers')).toContain('If-None-Match');
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });
});

describe('todo recurso declarado tem ordem canônica', () => {
  it('a lista de recursos do contrato é a mesma que a API serve', () => {
    const resources: ApiResource[] = [
      'evento',
      'atividades',
      'palestrantes',
      'patrocinadores',
      'chamadas',
    ];

    for (const resource of resources) {
      expect(API_FIELD_ORDER[resource].length).toBeGreaterThan(0);
    }
  });
});

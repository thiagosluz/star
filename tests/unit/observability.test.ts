/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — observabilidade (FASE 13, item B1)
 *
 *  O que só um teste unitário pode provar aqui:
 *    • o formato da exposição Prometheus (a série certa, uma vez só, com o
 *      `# TYPE` da família declarado UMA vez);
 *    • o teto de cardinalidade — um rótulo livre viraria vazamento de memória;
 *    • a redação do log: senha, token e e-mail não podem chegar ao coletor.
 *
 *  Nada aqui toca banco ou rede: é contrato de formato e de segurança de dado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger, maskEmail, sanitizeLogValue } from '../../src/lib/observability/logger';
import {
  MAX_SERIES,
  incCounter,
  observeDuration,
  renderMetrics,
  resetMetrics,
  setGauge,
} from '../../src/lib/observability/metrics';
import { routeLabel } from '../../src/lib/observability/route-label';

/** Linhas úteis (sem comentários nem vazias) da exposição. */
function sampleLines(output: string, name: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith(`${name} `) || line.startsWith(`${name}{`));
}

describe('métricas — formato Prometheus', () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  it('expõe contador com rótulos ordenados e soma o mesmo rótulo em qualquer ordem', () => {
    incCounter('http_requests_total', { route: '/dashboard', method: 'GET' });
    incCounter('http_requests_total', { method: 'GET', route: '/dashboard' });
    incCounter('http_requests_total', { route: '/login', method: 'POST' });

    const output = renderMetrics();

    expect(sampleLines(output, 'http_requests_total')).toEqual([
      'http_requests_total{route="/dashboard",method="GET"} 2',
      'http_requests_total{route="/login",method="POST"} 1',
    ]);
  });

  it('declara o TYPE uma única vez por família, mesmo com várias séries', () => {
    incCounter('http_requests_total', { status: '200' });
    incCounter('http_requests_total', { status: '403' });
    incCounter('http_requests_total', { status: '404' });

    const declarations = renderMetrics()
      .split('\n')
      .filter((line) => line === '# TYPE http_requests_total counter');

    expect(declarations).toHaveLength(1);
  });

  it('gauge é substituído, não somado', () => {
    setGauge('bullmq_queue_jobs', 4, { queue: 'certificates', state: 'waiting' });
    setGauge('bullmq_queue_jobs', 2, { queue: 'certificates', state: 'waiting' });

    expect(sampleLines(renderMetrics(), 'bullmq_queue_jobs')).toEqual([
      'bullmq_queue_jobs{queue="certificates",state="waiting"} 2',
    ]);
  });

  it('histograma acumula baldes, soma e contagem', () => {
    observeDuration('http_request_duration_ms', 12, { route: '/dashboard' });
    observeDuration('http_request_duration_ms', 300, { route: '/dashboard' });

    const lines = renderMetrics()
      .split('\n')
      .filter((line) => line.includes('http_request_duration_ms'));

    // 12 ms cai nos baldes 25, 100, 250, 500, 1000, 2500, 5000, 10000 (8 dos 9);
    // 300 ms cai nos baldes 500 em diante (5). Baldes são CUMULATIVOS.
    // Todo valor de rótulo sai entre aspas, inclusive `le` (é o formato que o
    // Prometheus usa para o balde de histograma).
    expect(lines).toContain('http_request_duration_ms_bucket{route="/dashboard",le="25"} 1');
    expect(lines).toContain('http_request_duration_ms_bucket{route="/dashboard",le="500"} 2');
    expect(lines).toContain('http_request_duration_ms_bucket{route="/dashboard",le="+Inf"} 2');
    expect(lines).toContain('http_request_duration_ms_sum{route="/dashboard"} 312');
    expect(lines).toContain('http_request_duration_ms_count{route="/dashboard"} 2');
    expect(lines.filter((line) => line.startsWith('# TYPE'))).toHaveLength(1);
  });

  it('sempre publica o uptime do processo', () => {
    expect(renderMetrics()).toMatch(/eventflow_uptime_seconds \d+/);
  });

  it('recusa série nova acima do teto de cardinalidade', () => {
    // Uma série por rota é o caso real; o teste força o teto para provar que ele
    // existe. Sem ele, um rótulo com id de usuário cresceria sem limite.
    for (let index = 0; index <= MAX_SERIES + 10; index += 1) {
      incCounter('serie_teste_total', { index: String(index) });
    }

    const total = sampleLines(renderMetrics(), 'serie_teste_total').length;

    expect(total).toBeLessThanOrEqual(MAX_SERIES + 1);
  });
});

describe('rótulo de rota do Proxy', () => {
  it('não deixa o slug do tenant virar cardinalidade', () => {
    expect(routeLabel('/')).toBe('/');
    expect(routeLabel('/dashboard')).toBe('/dashboard');
    expect(routeLabel('/superadmin/tenants')).toBe('/superadmin');
    expect(routeLabel('/t/ufba-demo')).toBe('/t/*');
    expect(routeLabel('/t/ufba-demo/admin/eventos')).toBe('/t/*/admin');
    expect(routeLabel('/t/fiocruz-demo/credenciamento')).toBe('/t/*/credenciamento');
  });

  it('trata variações de barra sem criar rótulo novo', () => {
    expect(routeLabel('/dashboard/')).toBe('/dashboard');
    expect(routeLabel('//dashboard')).toBe('/dashboard');
  });
});

describe('log — redação de dado sensível', () => {
  it('mascara e-mail preservando o domínio', () => {
    expect(maskEmail('ana.souza@ufba.br')).toBe('a***@ufba.br');
    expect(maskEmail('sem-arroba')).toBe('[omitido]');
    expect(maskEmail('@sem-local')).toBe('[omitido]');
  });

  it('remove senha, token, cookie e assinatura em qualquer profundidade', () => {
    const sanitized = sanitizeLogValue({
      email: 'bruno@example.test',
      password: 'segredo',
      nested: {
        authorization: 'Bearer abc',
        sessionToken: 'xyz',
        hmacSignature: 'deadbeef',
        apiKey: 'k',
        nonce: 'n',
        safe: 'mantido',
      },
    }) as Record<string, unknown>;

    expect(sanitized.email).toBe('b***@example.test');
    expect(sanitized.password).toBe('[omitido]');

    const nested = sanitized.nested as Record<string, unknown>;

    expect(nested.authorization).toBe('[omitido]');
    expect(nested.sessionToken).toBe('[omitido]');
    expect(nested.hmacSignature).toBe('[omitido]');
    expect(nested.apiKey).toBe('[omitido]');
    expect(nested.nonce).toBe('[omitido]');
    expect(nested.safe).toBe('mantido');
  });

  it('converte Date, Error e trunca lista longa', () => {
    const sanitized = sanitizeLogValue({
      quando: new Date('2026-09-17T12:00:00.000Z'),
      erro: new Error('falhou'),
      itens: Array.from({ length: 50 }, (_, index) => index),
    }) as Record<string, unknown>;

    expect(sanitized.quando).toBe('2026-09-17T12:00:00.000Z');
    expect(sanitized.erro).toEqual({ name: 'Error', message: 'falhou' });
    expect(sanitized.itens).toHaveLength(20);
  });

  it('para de descer em estrutura profunda em vez de estourar', () => {
    let deep: Record<string, unknown> = { fim: 'valor' };

    for (let index = 0; index < 10; index += 1) {
      deep = { nivel: deep };
    }

    const sanitized = JSON.stringify(sanitizeLogValue(deep));

    expect(sanitized).toContain('[profundo]');
  });

  it('escreve uma linha JSON com a senha já redigida em produção', () => {
    const original = process.env.NODE_ENV;
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    try {
      process.env.NODE_ENV = 'production';
      // `write()` decide o formato na CHAMADA, então basta trocar o ambiente antes
      // de registrar — não há import tardio a fazer.
      logger.warn('auth.tentativa_falha', { email: 'carla@example.test', password: 'x' });
    } finally {
      spy.mockRestore();
      process.env.NODE_ENV = original;
    }

    expect(written).toHaveLength(1);

    const payload = JSON.parse(written[0]!) as Record<string, unknown>;

    expect(payload.level).toBe('warn');
    expect(payload.event).toBe('auth.tentativa_falha');
    expect(payload.email).toBe('c***@example.test');
    expect(payload.password).toBe('[omitido]');
    expect(written[0]!.endsWith('\n')).toBe(true);
  });
});

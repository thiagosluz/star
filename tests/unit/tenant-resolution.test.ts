/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — resolução de tenant
 *
 *  A resolução decide QUAL instituição atende cada requisição. Um erro aqui
 *  significa servir dados da instituição errada, então os casos de borda
 *  (domínio raiz, subdomínio reservado, host forjado) são cobertos a fundo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  RESERVED_SLUGS,
  buildTenantUrl,
  describeResolution,
  isValidSlug,
  matchPathTenant,
  normalizeHost,
  normalizeSlug,
  resolveTenant,
  tenantPath,
} from '../../src/domain/tenancy/resolution';

const ROOT = 'lvh.me';

function resolve(host: string | null, pathname = '/', overrides = {}) {
  return resolveTenant({
    host,
    pathname,
    rootDomain: ROOT,
    allowPathStrategy: true,
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('normalização', () => {
  it('remove porta e caixa do host', () => {
    expect(normalizeHost('UFBA.lvh.me:3000')).toBe('ufba.lvh.me');
    expect(normalizeHost('ufba.lvh.me.')).toBe('ufba.lvh.me');
  });

  it('normaliza slug para minúsculas sem espaços', () => {
    expect(normalizeSlug('  UFBA  ')).toBe('ufba');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isValidSlug()', () => {
  it('aceita slugs legítimos', () => {
    for (const slug of ['ufba', 'uneb-2026', 'abc', 'a1b2c3']) {
      expect(isValidSlug(slug)).toBe(true);
    }
  });

  it('rejeita formato inválido', () => {
    for (const slug of ['ab', '-ufba', 'ufba-', 'uf--ba', 'UFBA', 'uf ba', 'ufba_ba', '']) {
      expect(isValidSlug(slug)).toBe(false);
    }
  });

  it('rejeita todos os slugs reservados (senão o tenant colidiria com rotas do sistema)', () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(isValidSlug(reserved)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveTenant() — estratégia por subdomínio', () => {
  it('extrai o slug do subdomínio do domínio raiz', () => {
    const result = resolve('ufba.lvh.me', '/');
    expect(result).toEqual({
      kind: 'resolved',
      source: 'subdomain',
      identifier: 'ufba',
      isCustomDomain: false,
    });
  });

  it('normaliza caixa e porta do subdomínio', () => {
    expect(resolve('UFBA.LVH.ME:3000', '/')).toMatchObject({
      kind: 'resolved',
      identifier: 'ufba',
    });
  });

  it('trata o domínio raiz como plataforma (não como tenant)', () => {
    expect(resolve('lvh.me', '/')).toEqual({
      kind: 'platform',
      reason: 'root-domain',
    });
  });

  it('rejeita subdomínio reservado', () => {
    for (const reserved of ['www', 'api', 'app', 'admin', 'login']) {
      expect(resolve(`${reserved}.${ROOT}`, '/')).toEqual({
        kind: 'platform',
        reason: 'reserved-subdomain',
      });
    }
  });

  it('rejeita subdomínio aninhado (ambíguo)', () => {
    expect(resolve(`a.b.${ROOT}`, '/')).toEqual({
      kind: 'platform',
      reason: 'root-domain',
    });
  });

  it('rejeita subdomínio com formato inválido', () => {
    expect(resolve(`-x.${ROOT}`, '/')).toEqual({
      kind: 'none',
      reason: 'invalid-slug',
    });
  });

  it('trata localhost como plataforma', () => {
    expect(resolve('localhost:3000', '/')).toEqual({
      kind: 'platform',
      reason: 'root-domain',
    });
    expect(resolve('127.0.0.1:3000', '/')).toEqual({
      kind: 'platform',
      reason: 'root-domain',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveTenant() — domínio customizado', () => {
  it('trata host fora do domínio raiz como domínio customizado', () => {
    expect(resolve('eventos.ufba.br', '/')).toEqual({
      kind: 'resolved',
      source: 'custom-domain',
      identifier: 'eventos.ufba.br',
      isCustomDomain: true,
    });
  });

  it('normaliza o domínio customizado', () => {
    expect(resolve('Eventos.UFBA.br:443', '/')).toMatchObject({
      isCustomDomain: true,
      identifier: 'eventos.ufba.br',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveTenant() — estratégia por path', () => {
  it('extrai o slug de /t/<slug>', () => {
    expect(resolve('localhost:3000', '/t/ufba/dashboard')).toEqual({
      kind: 'resolved',
      source: 'path',
      identifier: 'ufba',
      isCustomDomain: false,
      rewrittenPath: '/dashboard',
    });
  });

  it('preserva a raiz quando não há sub-caminho', () => {
    expect(resolve('localhost:3000', '/t/ufba')).toMatchObject({
      rewrittenPath: '/',
    });
  });

  it('normaliza para minúsculas o slug vindo do path (URLs não diferenciam caixa)', () => {
    // `/t/UFBA/x` é a mesma instituição que `/t/ufba/x`: normalizamos em vez de
    // rejeitar, porque URLs são case-insensitive por convenção e o usuário pode
    // digitar o endereço à mão.
    expect(resolve('localhost:3000', '/t/UFBA/x')).toEqual({
      kind: 'resolved',
      source: 'path',
      identifier: 'ufba',
      isCustomDomain: false,
      rewrittenPath: '/x',
    });
  });

  it('rejeita slug estruturalmente inválido no path', () => {
    expect(resolve('localhost:3000', '/t/-x/x')).toEqual({
      kind: 'none',
      reason: 'invalid-slug',
    });
    expect(resolve('localhost:3000', '/t/www/x')).toEqual({
      kind: 'none',
      reason: 'invalid-slug',
    });
  });

  it('path tem precedência sobre subdomínio', () => {
    // Um host de tenant acessando /t/outro deve resolver pelo path.
    expect(resolve('ufba.lvh.me', '/t/uneb/dashboard')).toMatchObject({
      source: 'path',
      identifier: 'uneb',
    });
  });

  it('pode ser desabilitado', () => {
    const result = resolveTenant({
      host: 'localhost:3000',
      pathname: '/t/ufba/dashboard',
      rootDomain: ROOT,
      allowPathStrategy: false,
    });
    expect(result).toEqual({ kind: 'platform', reason: 'root-domain' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveTenant() — header de override', () => {
  it('aceita override no domínio raiz (útil para E2E)', () => {
    expect(
      resolve('localhost:3000', '/dashboard', { forcedTenantHeader: 'ufba' }),
    ).toEqual({
      kind: 'resolved',
      source: 'header',
      identifier: 'ufba',
      isCustomDomain: false,
    });
  });

  it('IGNORA o header quando o host é de um tenant (evita forjar contexto)', () => {
    const result = resolve('ufba.lvh.me', '/dashboard', {
      forcedTenantHeader: 'uneb',
    });

    expect(result).toMatchObject({ source: 'subdomain', identifier: 'ufba' });
  });

  it('IGNORA header com slug inválido ou reservado', () => {
    expect(resolve('localhost:3000', '/', { forcedTenantHeader: 'www' })).toMatchObject({
      kind: 'platform',
    });
    expect(resolve('localhost:3000', '/', { forcedTenantHeader: '-x' })).toMatchObject({
      kind: 'platform',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('helpers de path e URL', () => {
  it('matchPathTenant extrai slug e caminho restante', () => {
    expect(matchPathTenant('/t/ufba/eventos/123')).toEqual({
      slug: 'ufba',
      rest: '/eventos/123',
    });
    expect(matchPathTenant('/t/ufba')).toEqual({ slug: 'ufba', rest: '/' });
    expect(matchPathTenant('/dashboard')).toBeNull();
    expect(matchPathTenant('/t/')).toBeNull();
  });

  it('tenantPath monta o caminho canônico', () => {
    expect(tenantPath('ufba')).toBe('/t/ufba');
    expect(tenantPath('ufba', '/')).toBe('/t/ufba');
    expect(tenantPath('ufba', '/dashboard')).toBe('/t/ufba/dashboard');
    expect(tenantPath('ufba', 'dashboard')).toBe('/t/ufba/dashboard');
  });

  it('buildTenantUrl escolhe subdomínio ou path', () => {
    expect(buildTenantUrl({ slug: 'ufba', rootDomain: ROOT })).toBe(
      'https://ufba.lvh.me/',
    );
    expect(
      buildTenantUrl({ slug: 'ufba', rootDomain: ROOT, useSubdomain: false }),
    ).toBe('https://lvh.me/t/ufba');
    expect(
      buildTenantUrl({
        slug: 'ufba',
        rootDomain: ROOT,
        path: '/dashboard',
        protocol: 'http',
      }),
    ).toBe('http://ufba.lvh.me/dashboard');
  });

  it('describeResolution produz texto legível', () => {
    expect(
      describeResolution({
        kind: 'resolved',
        source: 'subdomain',
        identifier: 'ufba',
        isCustomDomain: false,
      }),
    ).toContain('ufba');
    expect(describeResolution({ kind: 'platform', reason: 'root-domain' })).toContain(
      'raiz',
    );
  });
});

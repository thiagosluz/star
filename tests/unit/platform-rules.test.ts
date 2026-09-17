/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — governança de plataforma e diretório
 *
 *  Slug é endereço público: um slug reservado quebra a plataforma inteira, não um
 *  cadastro. Suspensão é corte de tráfego: precisa de justificativa. Diretório é
 *  vitrine: só entra quem é público e está ativo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DIRECTORY_PAGE_SIZE,
  MAX_DIRECTORY_PAGE_SIZE,
  MAX_SLUG_LENGTH,
  MIN_SLUG_LENGTH,
  PLAN_DEFINITIONS,
  RESERVED_SLUGS,
  TENANT_PLANS,
  TENANT_STATUSES,
  blockedNotice,
  buildDirectory,
  countOpenEvents,
  evaluateReactivation,
  evaluateSuspension,
  isSlugTaken,
  isTrafficAllowed,
  normalizeSlug,
  validateProvisioning,
  validatePublicProfile,
  validateTenantSlug,
  type DirectoryRow,
} from '../../src/domain/platform/platform-rules';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  TENANT_PERMISSIONS,
  permissionsForRole,
  scopeCovers,
} from '../../src/domain/rbac/permissions';
import { can, isMembershipOperational, type Principal } from '../../src/domain/rbac/authorization';

// ───────────────────────────────────────────────────────────────────────────────
function directoryRow(overrides: Partial<DirectoryRow> = {}): DirectoryRow {
  return {
    id: 'tenant-1',
    slug: 'instituicao-a',
    name: 'Instituição A',
    description: 'Uma instituição de testes.',
    logoUrl: null,
    websiteUrl: null,
    customDomain: null,
    plan: 'FREE',
    status: 'ACTIVE',
    isPublic: true,
    openEventCount: 0,
    nextEventStartsAt: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateTenantSlug()', () => {
  it('aceita slugs bem formados', () => {
    for (const slug of ['ufba', 'ufba-demo', 'instituicao-2026', 'a1b2c3']) {
      expect(validateTenantSlug(slug).valid, slug).toBe(true);
    }
  });

  it('RECUSA todos os slugs reservados', () => {
    // Um tenant chamado `api` faria `api.lvh.me` competir com a própria API.
    for (const slug of RESERVED_SLUGS) {
      const result = validateTenantSlug(slug);
      expect(result.valid, `deveria recusar "${slug}"`).toBe(false);
      expect(result.message).toMatch(/reservado/i);
    }
  });

  it('recusa formato inválido com mensagem sobre formato', () => {
    for (const slug of ['com espaço', 'com_underline', '-comeca-com-hifen', 'termina-com-hifen-', 'acentuação']) {
      const result = validateTenantSlug(slug);
      expect(result.valid, slug).toBe(false);
      expect(result.message, slug).toMatch(/minúsculas|hífen/i);
    }
  });

  it('NORMALIZA caixa alta em vez de recusar', () => {
    // Quem digita `UFBA` quer o slug `ufba`; recusar seria burocracia.
    expect(validateTenantSlug('UFBA').valid).toBe(true);
    expect(normalizeSlug('UFBA')).toBe('ufba');
  });

  it('recusa vazio com mensagem própria', () => {
    expect(validateTenantSlug('   ').message).toMatch(/informe/i);
  });

  it('recusa curto e longo demais', () => {
    expect(validateTenantSlug('ab').valid).toBe(false);
    expect(validateTenantSlug('a'.repeat(MAX_SLUG_LENGTH + 1)).valid).toBe(false);
    // Exatamente no limite é aceito.
    expect(validateTenantSlug('a'.repeat(MIN_SLUG_LENGTH)).valid).toBe(true);
    expect(validateTenantSlug(`a${'b'.repeat(MAX_SLUG_LENGTH - 1)}`).valid).toBe(true);
  });

  it('normaliza caixa e espaços antes de validar', () => {
    expect(validateTenantSlug('  UFBA-DEMO  ').valid).toBe(true);
    expect(normalizeSlug('  UFBA-DEMO ')).toBe('ufba-demo');
  });

  it('detecta slug já usado', () => {
    expect(isSlugTaken('ufba', ['ufba', 'fiocruz'])).toBe(true);
    expect(isSlugTaken('  UFBA ', ['ufba'])).toBe(true);
    expect(isSlugTaken('nova', ['ufba'])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateProvisioning()', () => {
  const base = {
    name: 'Universidade Federal da Bahia',
    slug: 'ufba',
    plan: 'PROFESSIONAL' as const,
    ownerEmail: 'reitoria@ufba.br',
  };

  it('aceita provisionamento completo e normaliza', () => {
    const result = validateProvisioning({
      ...base,
      customDomain: 'eventos.ufba.br',
      description: 'Universidade pública federal.',
    });

    expect(result.valid).toBe(true);
    expect(result.normalized).toMatchObject({
      name: 'Universidade Federal da Bahia',
      slug: 'ufba',
      plan: 'PROFESSIONAL',
      ownerEmail: 'reitoria@ufba.br',
      customDomain: 'eventos.ufba.br',
      isPublic: true,
    });
  });

  it('herda as quotas do PLANO quando não informadas', () => {
    const free = validateProvisioning({ ...base, plan: 'FREE' });
    const enterprise = validateProvisioning({ ...base, plan: 'ENTERPRISE' });

    expect(free.normalized?.maxEvents).toBe(PLAN_DEFINITIONS.FREE.maxEvents);
    expect(free.normalized?.maxMembers).toBe(PLAN_DEFINITIONS.FREE.maxMembers);
    // ENTERPRISE é ILIMITADO (null), e não "zero eventos".
    expect(enterprise.normalized?.maxEvents).toBeNull();
    expect(enterprise.normalized?.maxMembers).toBeNull();
  });

  it('quota explícita vence o padrão do plano', () => {
    const result = validateProvisioning({ ...base, plan: 'FREE', maxEvents: 200 });
    expect(result.normalized?.maxEvents).toBe(200);
  });

  it('recusa slug reservado', () => {
    const result = validateProvisioning({ ...base, slug: 'superadmin' });

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/reservado/i);
  });

  it('recusa e-mail de proprietário inválido', () => {
    const result = validateProvisioning({ ...base, ownerEmail: 'sem-arroba' });

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/e-mail válido/i);
  });

  it('recusa domínio personalizado com protocolo', () => {
    const result = validateProvisioning({ ...base, customDomain: 'https://eventos.ufba.br' });

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/domínio personalizado/i);
  });

  it('recusa nome curto e plano desconhecido', () => {
    const result = validateProvisioning({ ...base, name: 'ab', plan: 'GOLD' as never });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('recusa quota negativa ou fracionária', () => {
    expect(validateProvisioning({ ...base, maxEvents: -1 }).valid).toBe(false);
    expect(validateProvisioning({ ...base, maxMembers: 1.5 }).valid).toBe(false);
  });

  it('devolve TODOS os erros de uma vez', () => {
    const result = validateProvisioning({
      name: 'ab',
      slug: 'admin',
      plan: 'GOLD' as never,
      ownerEmail: 'invalido',
      customDomain: 'http://x.y',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    expect(result.normalized).toBeNull();
  });

  it('normaliza e-mail e domínio em caixa baixa', () => {
    const result = validateProvisioning({
      ...base,
      ownerEmail: '  Reitoria@UFBA.BR ',
      customDomain: ' Eventos.UFBA.BR ',
    });

    expect(result.normalized?.ownerEmail).toBe('reitoria@ufba.br');
    expect(result.normalized?.customDomain).toBe('eventos.ufba.br');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('ciclo de vida', () => {
  it('suspensão exige justificativa com tamanho mínimo', () => {
    expect(evaluateSuspension({ status: 'ACTIVE', reason: '' }).allowed).toBe(false);
    expect(evaluateSuspension({ status: 'ACTIVE', reason: 'curto' }).allowed).toBe(false);

    const ok = evaluateSuspension({
      status: 'ACTIVE',
      reason: 'Inadimplência confirmada pelo financeiro em 17/09.',
    });

    expect(ok.allowed).toBe(true);
  });

  it('não suspende o que já está suspenso nem o arquivado', () => {
    expect(evaluateSuspension({ status: 'SUSPENDED', reason: 'motivo válido aqui' }).allowed).toBe(false);
    expect(evaluateSuspension({ status: 'ARCHIVED', reason: 'motivo válido aqui' }).allowed).toBe(false);
  });

  it('reativa apenas o que não está ativo', () => {
    expect(evaluateReactivation('SUSPENDED').allowed).toBe(true);
    expect(evaluateReactivation('PENDING').allowed).toBe(true);
    expect(evaluateReactivation('ACTIVE').allowed).toBe(false);
    expect(evaluateReactivation('ARCHIVED').allowed).toBe(false);
  });

  it('só ACTIVE atende tráfego (fail-closed para estados novos)', () => {
    expect(isTrafficAllowed('ACTIVE')).toBe(true);

    for (const status of TENANT_STATUSES.filter((entry) => entry !== 'ACTIVE')) {
      expect(isTrafficAllowed(status), status).toBe(false);
    }
  });

  it('a página de bloqueio é amigável e mostra o motivo quando existe', () => {
    const suspended = blockedNotice({
      tenantName: 'UFBA',
      status: 'SUSPENDED',
      reason: 'Inadimplência confirmada.',
    });

    expect(suspended.title).toMatch(/suspenso/i);
    expect(suspended.body).toContain('UFBA');
    expect(suspended.body).toContain('Inadimplência confirmada.');

    expect(blockedNotice({ tenantName: 'UFBA', status: 'PENDING' }).title).toMatch(/ativação/i);
    expect(blockedNotice({ tenantName: 'UFBA', status: 'ARCHIVED' }).title).toMatch(/indisponível/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('countOpenEvents()', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('conta apenas eventos abertos e futuros', () => {
    const counts = countOpenEvents(
      [
        { tenantId: 'a', startsAt: new Date('2026-10-01T12:00:00.000Z'), status: 'REGISTRATION_OPEN' },
        { tenantId: 'a', startsAt: new Date('2026-11-01T12:00:00.000Z'), status: 'PUBLISHED' },
        // Já aconteceu: não é "evento aberto".
        { tenantId: 'a', startsAt: new Date('2026-09-01T12:00:00.000Z'), status: 'PUBLISHED' },
        // Rascunho não aparece na vitrine.
        { tenantId: 'a', startsAt: new Date('2026-12-01T12:00:00.000Z'), status: 'DRAFT' },
        // Outra instituição.
        { tenantId: 'b', startsAt: new Date('2026-10-15T12:00:00.000Z'), status: 'PUBLISHED' },
      ],
      now,
    );

    expect(counts.get('a')?.openEventCount).toBe(2);
    expect(counts.get('a')?.nextEventStartsAt?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(counts.get('b')?.openEventCount).toBe(1);
  });

  it('instituição sem eventos abertos não aparece no mapa', () => {
    const counts = countOpenEvents([], now);
    expect(counts.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('buildDirectory()', () => {
  it('mostra apenas instituições ATIVAS e PÚBLICAS', () => {
    const result = buildDirectory([
      directoryRow({ id: '1', slug: 'ativa', name: 'Ativa' }),
      directoryRow({ id: '2', slug: 'suspensa', name: 'Suspensa', status: 'SUSPENDED' }),
      directoryRow({ id: '3', slug: 'privada', name: 'Privada', isPublic: false }),
      directoryRow({ id: '4', slug: 'pendente', name: 'Pendente', status: 'PENDING' }),
    ]);

    expect(result.entries.map((entry) => entry.slug)).toEqual(['ativa']);
    expect(result.total).toBe(1);
  });

  it('ordena por volume de eventos abertos', () => {
    const result = buildDirectory([
      directoryRow({ id: '1', slug: 'poucos', name: 'Poucos', openEventCount: 1 }),
      directoryRow({ id: '2', slug: 'muitos', name: 'Muitos', openEventCount: 7 }),
      directoryRow({ id: '3', slug: 'nenhum', name: 'Nenhum', openEventCount: 0 }),
    ]);

    expect(result.entries.map((entry) => entry.slug)).toEqual(['muitos', 'poucos', 'nenhum']);
  });

  it('desempata pelo próximo evento e depois pelo nome', () => {
    const result = buildDirectory([
      directoryRow({
        id: '1',
        slug: 'depois',
        name: 'Depois',
        openEventCount: 2,
        nextEventStartsAt: new Date('2026-12-01T12:00:00.000Z'),
      }),
      directoryRow({
        id: '2',
        slug: 'antes',
        name: 'Antes',
        openEventCount: 2,
        nextEventStartsAt: new Date('2026-10-01T12:00:00.000Z'),
      }),
      directoryRow({ id: '3', slug: 'bruno', name: 'Bruno', openEventCount: 2 }),
      directoryRow({ id: '4', slug: 'ana', name: 'Ana', openEventCount: 2 }),
    ]);

    expect(result.entries.map((entry) => entry.slug)).toEqual(['antes', 'depois', 'ana', 'bruno']);
  });

  it('busca por nome e por slug, ignorando caixa e acento', () => {
    const rows = [
      directoryRow({ id: '1', slug: 'ufba', name: 'Universidade Federal da Bahia' }),
      directoryRow({ id: '2', slug: 'fiocruz', name: 'Fundação Oswaldo Cruz' }),
    ];

    expect(buildDirectory(rows, { query: 'bahia' }).entries.map((entry) => entry.slug)).toEqual(['ufba']);
    expect(buildDirectory(rows, { query: 'FEDERAÇÃO' }).total).toBe(0);
    expect(buildDirectory(rows, { query: 'fundacao' }).entries.map((entry) => entry.slug)).toEqual(['fiocruz']);
    expect(buildDirectory(rows, { query: 'FIOCRUZ' }).entries.map((entry) => entry.slug)).toEqual(['fiocruz']);
  });

  it('pagina e devolve metadados coerentes', () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      directoryRow({
        id: `t${index}`,
        slug: `instituicao-${String(index).padStart(2, '0')}`,
        name: `Instituição ${String(index).padStart(2, '0')}`,
        openEventCount: 25 - index,
      }),
    );

    const first = buildDirectory(rows, { pageSize: 10 });
    expect(first.entries).toHaveLength(10);
    expect(first.total).toBe(25);
    expect(first.totalPages).toBe(3);
    expect(first.page).toBe(1);
    // Ordenado por volume: a primeira página começa pela que tem mais eventos.
    expect(first.entries[0]?.slug).toBe('instituicao-00');

    const third = buildDirectory(rows, { pageSize: 10, page: 3 });
    expect(third.entries).toHaveLength(5);
    expect(third.entries[0]?.slug).toBe('instituicao-20');
  });

  it('página fora do intervalo é ajustada, não devolvida vazia', () => {
    const rows = [directoryRow({ id: '1' })];

    expect(buildDirectory(rows, { page: 99 }).page).toBe(1);
    expect(buildDirectory(rows, { page: 0 }).page).toBe(1);
    expect(buildDirectory(rows, { page: -5 }).page).toBe(1);
  });

  it('limita o tamanho da página', () => {
    const rows = Array.from({ length: 200 }, (_, index) => directoryRow({ id: `t${index}` }));
    const result = buildDirectory(rows, { pageSize: 5_000 });

    expect(result.pageSize).toBe(MAX_DIRECTORY_PAGE_SIZE);
    expect(result.entries.length).toBeLessThanOrEqual(MAX_DIRECTORY_PAGE_SIZE);
  });

  it('usa o tamanho padrão quando não informado', () => {
    const rows = Array.from({ length: 50 }, (_, index) => directoryRow({ id: `t${index}` }));
    expect(buildDirectory(rows).pageSize).toBe(DEFAULT_DIRECTORY_PAGE_SIZE);
  });

  it('lista vazia devolve página 1 de 1', () => {
    const result = buildDirectory([]);
    expect(result.entries).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });

  it('monta rótulo e caminho canônico de cada card', () => {
    const result = buildDirectory([
      directoryRow({ id: '1', slug: 'ufba', openEventCount: 0 }),
      directoryRow({ id: '2', slug: 'fiocruz', openEventCount: 1 }),
      directoryRow({ id: '3', slug: 'ifba', openEventCount: 4 }),
    ]);

    const bySlug = new Map(result.entries.map((entry) => [entry.slug, entry]));

    expect(bySlug.get('ufba')?.path).toBe('/t/ufba');
    expect(bySlug.get('ufba')?.activityLabel).toMatch(/sem eventos/i);
    expect(bySlug.get('fiocruz')?.activityLabel).toBe('1 evento aberto');
    expect(bySlug.get('ifba')?.activityLabel).toBe('4 eventos abertos');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validatePublicProfile()', () => {
  it('aceita perfil válido e normaliza', () => {
    const result = validatePublicProfile({
      description: '  Universidade pública federal.  ',
      logoUrl: 'https://cdn.ufba.br/logo.png',
      websiteUrl: 'https://ufba.br',
      isPublic: false,
    });

    expect(result.valid).toBe(true);
    expect(result.normalized).toMatchObject({
      description: 'Universidade pública federal.',
      logoUrl: 'https://cdn.ufba.br/logo.png',
      websiteUrl: 'https://ufba.br',
      isPublic: false,
    });
  });

  it('RECUSA URLs com protocolo perigoso', () => {
    // Elas viram `src` e `href` em página pública: aceitar seria XSS refletido.
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'ftp://x.com/a.png']) {
      const result = validatePublicProfile({ logoUrl: url });
      expect(result.valid, url).toBe(false);
      expect(result.errors.join(' ')).toMatch(/http/i);
    }
  });

  it('campos vazios viram nulo, não string vazia', () => {
    const result = validatePublicProfile({ description: '   ', logoUrl: '', websiteUrl: null });

    expect(result.valid).toBe(true);
    expect(result.normalized).toEqual({
      description: null,
      logoUrl: null,
      websiteUrl: null,
      isPublic: true,
    });
  });

  it('recusa descrição longa demais', () => {
    const result = validatePublicProfile({ description: 'x'.repeat(601) });

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/600/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('autorização de plataforma', () => {
  function platformPrincipal(overrides: Partial<Principal> = {}): Principal {
    return {
      userId: 'super-1',
      tenantId: null,
      membershipStatus: 'ACTIVE',
      assignments: [{ role: 'SUPERADMIN', scope: 'PLATFORM' }],
      ...overrides,
    };
  }

  it('SUPERADMIN tem platform:manage e NADA de tenant', () => {
    const permissions = permissionsForRole('SUPERADMIN');

    expect(permissions).toEqual([PERMISSIONS.PLATFORM_MANAGE]);
    expect(permissions).not.toContain(PERMISSIONS.EVENT_CREATE);
    expect(permissions).not.toContain(PERMISSIONS.TENANT_READ);
    expect(permissions).not.toContain(PERMISSIONS.REGISTRATION_CHECKIN);
  });

  it('papéis de tenant NÃO recebem permissão de plataforma', () => {
    /**
     * `OWNER: ALL_PERMISSIONS` incluiria `platform:manage` por acidente. A lista
     * de permissões de tenant existe para impedir que todo dono de instituição
     * carregue uma permissão de plataforma.
     */
    expect(TENANT_PERMISSIONS).not.toContain(PERMISSIONS.PLATFORM_MANAGE);
    expect(permissionsForRole('OWNER')).not.toContain(PERMISSIONS.PLATFORM_MANAGE);
    expect(permissionsForRole('ADMIN')).not.toContain(PERMISSIONS.PLATFORM_MANAGE);
    expect(permissionsForRole('ORGANIZER')).not.toContain(PERMISSIONS.PLATFORM_MANAGE);
    expect(ALL_PERMISSIONS).toContain(PERMISSIONS.PLATFORM_MANAGE);
  });

  it('escopo PLATFORM cobre a si mesmo e NÃO cobre tenant/evento/atividade', () => {
    expect(scopeCovers('PLATFORM', 'PLATFORM')).toBe(true);
    expect(scopeCovers('PLATFORM', 'TENANT')).toBe(false);
    expect(scopeCovers('PLATFORM', 'EVENT')).toBe(false);
    expect(scopeCovers('PLATFORM', 'ACTIVITY')).toBe(false);
    // E o contrário também não vale: papel de tenant não vira papel de plataforma.
    expect(scopeCovers('TENANT', 'PLATFORM')).toBe(false);
    expect(scopeCovers('EVENT', 'PLATFORM')).toBe(false);
  });

  it('can() autoriza a gestão da plataforma para o SuperAdmin', () => {
    expect(can(platformPrincipal(), PERMISSIONS.PLATFORM_MANAGE, { scope: 'PLATFORM' })).toBe(true);
  });

  it('can() NEGA a gestão da plataforma para papel de tenant', () => {
    const tenantPrincipal: Principal = {
      userId: 'admin-1',
      tenantId: 'tenant-1',
      membershipStatus: 'ACTIVE',
      assignments: [{ role: 'ADMIN', scope: 'TENANT' }],
    };

    expect(can(tenantPrincipal, PERMISSIONS.PLATFORM_MANAGE, { scope: 'PLATFORM' })).toBe(false);
    expect(can(tenantPrincipal, PERMISSIONS.PLATFORM_MANAGE, { scope: 'TENANT' })).toBe(false);
  });

  it('concessão de plataforma NÃO autoriza nada dentro de uma instituição', () => {
    // O SuperAdmin precisa de vínculo e papel na instituição para agir nela.
    for (const permission of [PERMISSIONS.EVENT_CREATE, PERMISSIONS.REGISTRATION_CHECKIN, PERMISSIONS.TENANT_READ]) {
      expect(can(platformPrincipal(), permission, { scope: 'TENANT' }), permission).toBe(false);
    }
  });

  it('concessão revogada ou expirada não autoriza', () => {
    expect(
      can(
        platformPrincipal({
          assignments: [{ role: 'SUPERADMIN', scope: 'PLATFORM', revokedAt: new Date() }],
        }),
        PERMISSIONS.PLATFORM_MANAGE,
        { scope: 'PLATFORM' },
      ),
    ).toBe(false);

    expect(
      can(
        platformPrincipal({
          assignments: [
            { role: 'SUPERADMIN', scope: 'PLATFORM', expiresAt: new Date('2020-01-01T00:00:00.000Z') },
          ],
        }),
        PERMISSIONS.PLATFORM_MANAGE,
        { scope: 'PLATFORM' },
      ),
    ).toBe(false);
  });

  it('vínculo não-operacional não autoriza nem na plataforma', () => {
    const suspended = platformPrincipal({ membershipStatus: 'SUSPENDED' });

    expect(isMembershipOperational(suspended)).toBe(false);
    expect(can(suspended, PERMISSIONS.PLATFORM_MANAGE, { scope: 'PLATFORM' })).toBe(false);
  });

  it('a lista de planos e status do domínio cobre os enums do banco', () => {
    expect(TENANT_PLANS).toEqual(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']);
    expect(TENANT_STATUSES).toEqual(['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']);
  });
});

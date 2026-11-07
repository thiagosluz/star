import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const revalidatePathMock = vi.fn();

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFoundMock(),
  useRouter: vi.fn().mockReturnValue({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: vi.fn().mockReturnValue('/t/ufba-demo/administracao/cartas'),
  useSearchParams: vi.fn().mockReturnValue(new URLSearchParams()),
}));

vi.mock('@/lib/auth/guard-page', () => ({
  requirePagePermission: vi.fn().mockResolvedValue({
    tenantId: 'tenant-f96',
    userId: 'user-admin',
  }),
}));

const CARD_FIXTURE = {
  id: '11111111-2222-4333-8444-555555555555',
  tenantId: 'tenant-f96',
  eventId: null,
  slug: 'guardiao-do-metodo',
  name: 'Guardião do Método',
  description: 'Concedida por concluir um parecer',
  lore: 'O trabalho invisível que sustenta a ciência',
  rarity: 'RARE' as const,
  trigger: 'REVIEW_COMPLETED' as const,
  triggerCondition: {},
  levelRequired: 2,
  dropWeight: 50,
  maxSupply: 100,
  mintedCount: 12,
  ownedBy: 8,
  usedByMissions: 1,
  usedByQrCodes: 0,
  isActive: true,
  isSecret: false,
  palette: null,
  art: null,
  archivedAt: null,
  archivedByName: null,
};

const listCardTemplatesMock = vi.fn().mockResolvedValue([CARD_FIXTURE]);
const getCardTemplateForEditMock = vi.fn().mockResolvedValue(CARD_FIXTURE);

vi.mock('@/lib/admin/gamification-admin-service', () => ({
  listCardTemplates: (...args: unknown[]) => listCardTemplatesMock(...args),
  getCardTemplateForEdit: (...args: unknown[]) => getCardTemplateForEditMock(...args),
}));

const listAdminEventsMock = vi.fn().mockResolvedValue([
  { id: 'event-1', title: 'Simpósio de IA 2026' },
]);

vi.mock('@/lib/admin/catalog-service', () => ({
  listAdminEvents: (...args: unknown[]) => listAdminEventsMock(...args),
}));

const withTenantSpy = vi.fn();

vi.mock('@/lib/db/tenant-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/tenant-client')>();
  return {
    ...actual,
    withTenant: vi.fn().mockImplementation(async (tenantId, fn) => {
      withTenantSpy(tenantId);
      return fn({
        tenant: {
          findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Bahia' }),
        },
        userTenantProfile: {
          findMany: vi.fn().mockResolvedValue([
            { user: { id: 'u-1', name: 'Ana Carolina' } },
          ]),
          count: vi.fn().mockResolvedValue(250),
        },
      });
    }),
  };
});

import AdminCardsPage from '@/app/t/[tenantSlug]/(app)/administracao/cartas/page';
import EditarCartaPage from '@/app/t/[tenantSlug]/(app)/administracao/cartas/[cardId]/editar/page';
import { ProposalAcceptancePanel } from '@/components/proposals/proposal-acceptance-panel';
import { resolveRuntimePoolConfig } from '@/lib/db/tenant-client';
import { resolveAdminPoolConfig } from '@/lib/db/admin-client';
import { revalidateTenantArea, TENANT_CACHE_AREAS } from '@/lib/cache/revalidate-area';

/** Utilitários de cliente explicitamente autorizados a serem importados em valor de `@/lib`. */
const CLIENT_LIB_VALUE_ALLOWLIST = new Set([
  '@/lib/utils/cn',
  '@/lib/offline/credential-offline-queue',
]);

const FORBIDDEN_CLIENT_MODULES = [
  '@/lib/db/',
  '#db/',
  'pg',
  '@prisma/',
  'bullmq',
  'ioredis',
  'minio',
];

function extractClientValueImports(filePath: string, sourceText: string): string[] {
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const violations: string[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (stmt.importClause.isTypeOnly) continue;

    // Se todos os named bindings forem `import { type X }`, trata-se de import apenas de tipos
    const namedBindings = stmt.importClause.namedBindings;
    if (
      !stmt.importClause.name &&
      namedBindings &&
      ts.isNamedImports(namedBindings) &&
      namedBindings.elements.length > 0 &&
      namedBindings.elements.every((el) => el.isTypeOnly)
    ) {
      continue;
    }

    const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text;

    if (specifier.startsWith('@/lib/') && !CLIENT_LIB_VALUE_ALLOWLIST.has(specifier)) {
      violations.push(`${filePath} → ${specifier}`);
    } else if (FORBIDDEN_CLIENT_MODULES.some((prefix) => specifier === prefix || specifier.startsWith(prefix))) {
      violations.push(`${filePath} → ${specifier}`);
    }
  }

  return violations;
}

describe('FASE 96 — Pool explícito, transação única, edição dedicada de carta, hidratação e fronteira cliente/servidor', () => {
  it('1. [Alta 1] resolveRuntimePoolConfig e resolveAdminPoolConfig dimensionam max, idleTimeoutMillis e connectionTimeoutMillis', () => {
    const padrao = resolveRuntimePoolConfig({ NODE_ENV: 'test' });
    expect(padrao.max).toBe(10);
    expect(padrao.idleTimeoutMillis).toBe(30_000);
    expect(padrao.connectionTimeoutMillis).toBe(5_000);

    const custom = resolveRuntimePoolConfig({
      NODE_ENV: 'test',
      DB_POOL_MAX: '25',
      DB_IDLE_TIMEOUT_MS: '15000',
      DB_CONN_TIMEOUT_MS: '3000',
    });
    expect(custom.max).toBe(25);
    expect(custom.idleTimeoutMillis).toBe(15_000);
    expect(custom.connectionTimeoutMillis).toBe(3_000);

    const invalido = resolveRuntimePoolConfig({
      NODE_ENV: 'test',
      DB_POOL_MAX: '-5',
    });
    expect(invalido.max).toBe(10);

    const adminCustom = resolveAdminPoolConfig({
      NODE_ENV: 'test',
      ADMIN_DB_POOL_MAX: '6',
    });
    expect(adminCustom.max).toBe(6);
  });

  it('2. [Alta 1 + Alta 2] AdminCardsPage abre UMA única transação withTenant, não consulta eventos e avisa quando participantes > 200', async () => {
    withTenantSpy.mockClear();
    listAdminEventsMock.mockClear();
    listCardTemplatesMock.mockClear();

    const html = renderToStaticMarkup(
      await AdminCardsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
        searchParams: Promise.resolve({ participante: 'Ana' }),
      }),
    );

    // Exatamente 1 transação aberta para toda a página (antes eram 4)
    expect(withTenantSpy).toHaveBeenCalledTimes(1);
    // listCardTemplates recebeu o `tx` da transação única
    expect(listCardTemplatesMock).toHaveBeenCalledTimes(1);
    expect(listCardTemplatesMock.mock.calls[0]?.[2]).toBeDefined();
    // Eventos não são mais carregados na listagem de cartas
    expect(listAdminEventsMock).not.toHaveBeenCalled();

    // Link leve para a rota dedicada de edição, sem formulário de 26 campos embutido
    expect(html).toContain(`data-testid="card-edit-${CARD_FIXTURE.id}"`);
    expect(html).toContain(
      `href="/t/ufba-demo/administracao/cartas/${CARD_FIXTURE.id}/editar"`,
    );
    expect(html).not.toContain(`data-testid="card-form-${CARD_FIXTURE.id}"`);

    // Aviso explícito de truncamento (250 total > 1 retornado no mock) + busca GET
    expect(html).toContain('data-testid="grant-participants-truncated"');
    expect(html).toContain('Mostrando 1 de 250 participantes ativos');
    expect(html).toContain('data-testid="grant-participant-search"');
  });

  it('3. [Alta 2] EditarCartaPage carrega carta e eventos em UMA transação, renderiza o formulário estruturado e responde 404 quando ausente', async () => {
    withTenantSpy.mockClear();
    listAdminEventsMock.mockClear();

    const html = renderToStaticMarkup(
      await EditarCartaPage({
        params: Promise.resolve({
          tenantSlug: 'ufba-demo',
          cardId: CARD_FIXTURE.id,
        }),
      }),
    );

    expect(withTenantSpy).toHaveBeenCalledTimes(1);
    expect(listAdminEventsMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('Editar carta: Guardião do Método');
    expect(html).toContain('data-testid="link-voltar-cartas"');
    expect(html).toContain('data-testid="edit-card-section"');
    expect(html).toContain(`data-testid="card-form-${CARD_FIXTURE.id}"`);
    expect(html).toContain('value="Guardião do Método"');

    // Quando a carta não existe ou está arquivada, responde 404 uniforme
    getCardTemplateForEditMock.mockResolvedValueOnce(null);
    await expect(
      EditarCartaPage({
        params: Promise.resolve({
          tenantSlug: 'ufba-demo',
          cardId: CARD_FIXTURE.id,
        }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('4. [Média 3] ProposalAcceptancePanel formata decidedAt no fuso do evento (sem divergência entre UTC do servidor e America/Bahia)', () => {
    // 2026-11-08T01:30:00Z é dia 08 em UTC, mas 22:30 do dia 07/11/2026 em America/Bahia (UTC-3)
    const decidedAt = new Date('2026-11-08T01:30:00.000Z');

    const html = renderToStaticMarkup(
      createElement(ProposalAcceptancePanel, {
        tenantSlug: 'ufba-demo',
        eventSlug: 'congresso-2026',
        eventId: 'event-1',
        submissionId: 'sub-1',
        eventTimeZone: 'America/Bahia',
        kindLabel: 'Minicurso',
        callTitle: 'Chamada de Minicursos',
        proposedTitle: 'Introdução a RSC',
        workloadMinutes: 120,
        authorName: 'Proponente',
        authorEmail: 'prop@ufba.br',
        activityType: 'WORKSHOP',
        activityTypeOptions: [{ value: 'WORKSHOP', label: 'Oficina' }],
        roomOptions: [],
        decidedStatus: 'ACCEPTED',
        decidedAt,
        action: async () => ({ ok: true }),
      }),
    );

    expect(html).toContain('em 07/11/2026');
    expect(html).not.toContain('08/11/2026');

    // E account-forms usa <time suppressHydrationWarning> para o fuso do navegador
    const accountFormsSource = readFileSync(
      join(process.cwd(), 'src/components/account/account-forms.tsx'),
      'utf8',
    );
    expect(accountFormsSource).toContain('<time dateTime={session.lastUsedAt} suppressHydrationWarning>');
  });

  it('5. [Média 4] Catraca AST: nenhum Client Component importa valor de @/lib fora da allowlist nem módulos de banco/servidor', () => {
    const allFiles = (readdirSync('src', { recursive: true }) as string[])
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map((f) => join('src', f).replace(/\\/g, '/'));

    const clientFiles = allFiles.filter((filePath) => {
      const content = readFileSync(filePath, 'utf8');
      return /^\s*['"]use client['"]/.test(content);
    });

    expect(clientFiles.length).toBeGreaterThanOrEqual(90);

    const violations = clientFiles.flatMap((filePath) =>
      extractClientValueImports(filePath, readFileSync(filePath, 'utf8')),
    );

    expect(
      violations,
      `Client Components importando valor de servidor:\n${violations.join('\n')}`,
    ).toEqual([]);

    // Prova por mutação sintética: a catraca morde quando há import de valor proibido
    const sintético = `'use client';\nimport { withTenant } from '@/lib/db/tenant-client';\nimport type { AdminCardRow } from '@/lib/admin/gamification-admin-service';\n`;
    expect(extractClientValueImports('sintetico.tsx', sintético)).toEqual([
      'sintetico.tsx → @/lib/db/tenant-client',
    ]);
  });

  it('6. [Média 5] tenant-client não possui estado global mutável (ambientTenantId / setAmbientTenant / clearAmbientTenant)', () => {
    const tenantClientSource = readFileSync(
      join(process.cwd(), 'src/lib/db/tenant-client.ts'),
      'utf8',
    );

    expect(tenantClientSource).not.toContain('let ambientTenantId');
    expect(tenantClientSource).not.toContain('function setAmbientTenant');
    expect(tenantClientSource).not.toContain('function clearAmbientTenant');
  });

  it('7. [Média 6] revalidateTenantArea invalida os caminhos da área e a subárvore (escopo layout)', () => {
    revalidatePathMock.mockClear();

    revalidateTenantArea('ufba-demo', TENANT_CACHE_AREAS.cartas);

    expect(revalidatePathMock).toHaveBeenCalledWith('/t/ufba-demo/administracao/cartas');
    expect(revalidatePathMock).toHaveBeenCalledWith('/t/ufba-demo/administracao/cartas', 'layout');
    expect(revalidatePathMock).toHaveBeenCalledWith('/t/ufba-demo/administracao/cartas/nova');
    expect(revalidatePathMock).toHaveBeenCalledWith('/t/ufba-demo/cartas');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import AdminCardsPage from '@/app/t/[tenantSlug]/(app)/administracao/cartas/page';
import NovaCartaPage from '@/app/t/[tenantSlug]/(app)/administracao/cartas/nova/page';

vi.mock('@/lib/auth/guard-page', () => ({
  requirePagePermission: vi.fn().mockResolvedValue({
    tenantId: 'tenant-f95',
    userId: 'user-admin',
  }),
}));

vi.mock('@/lib/admin/gamification-admin-service', () => ({
  listCardTemplates: vi.fn().mockResolvedValue([
    {
      id: 'card-1',
      tenantId: 'tenant-f95',
      eventId: null,
      slug: 'guardiao-do-metodo',
      name: 'Guardião do Método',
      description: 'Concedida por concluir um parecer',
      lore: 'O trabalho invisível que sustenta a ciência',
      rarity: 'RARE',
      trigger: 'REVIEW_COMPLETED',
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
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      archivedAt: null,
      archivedByName: null,
    },
  ]),
}));

vi.mock('@/lib/admin/catalog-service', () => ({
  listAdminEvents: vi.fn().mockResolvedValue([
    { id: 'event-1', title: 'Simpósio de IA 2026' },
  ]),
}));

vi.mock('@/lib/db/tenant-client', () => ({
  withTenant: vi.fn().mockImplementation(async (_tenantId, fn) => {
    return fn({
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Bahia' }),
      },
      userTenantProfile: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn().mockReturnValue({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: vi.fn().mockReturnValue('/t/ufba-demo/administracao/cartas'),
  useSearchParams: vi.fn().mockReturnValue(new URLSearchParams()),
}));

describe('FASE 95 — Separação do cadastro de cartas colecionáveis (/cartas/nova) e cockpit limpo', () => {
  it('1. o cockpit de cartas exibe o botão "Nova carta" no cabeçalho apontando para /cartas/nova', async () => {
    const html = renderToStaticMarkup(
      await AdminCardsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain('data-testid="btn-nova-carta"');
    expect(html).toContain('href="/t/ufba-demo/administracao/cartas/nova"');
    expect(html).toContain('Nova carta');
  });

  it('2. o cockpit de cartas NÃO renderiza mais o formulário de criação inline no rodapé', async () => {
    const html = renderToStaticMarkup(
      await AdminCardsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
        searchParams: Promise.resolve({}),
      }),
    );

    // O formulário create-card foi movido para a rota /cartas/nova
    expect(html).not.toContain('data-testid="create-card"');
    expect(html).not.toContain('data-testid="create-card-section"');
  });

  it('3. o cockpit renderiza os itens em cards elevados e preserva o form de edição embutido', async () => {
    const html = renderToStaticMarkup(
      await AdminCardsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain('data-testid="admin-card-card-1"');
    expect(html).toContain('Guardião do Método');
    expect(html).toContain('data-testid="card-form-card-1"');
    expect(html).toContain('data-testid="card-delete-card-1"');
  });

  it('4. o cockpit renderiza o empty state em card com CTA direto para /cartas/nova quando vazio', async () => {
    const { listCardTemplates } = await import('@/lib/admin/gamification-admin-service');
    vi.mocked(listCardTemplates).mockResolvedValueOnce([]);

    const html = renderToStaticMarkup(
      await AdminCardsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain('data-testid="cards-empty"');
    expect(html).toContain('data-testid="btn-empty-nova-carta"');
    expect(html).toContain('href="/t/ufba-demo/administracao/cartas/nova"');
    expect(html).toContain('Criar primeira carta');
  });

  it('5. a página dedicada /cartas/nova renderiza PageHeader semântico com breadcrumbs e link de retorno', async () => {
    const html = renderToStaticMarkup(
      await NovaCartaPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
      }),
    );

    expect(html).toContain('Nova carta colecionável');
    expect(html).toContain('data-testid="link-voltar-cartas"');
    expect(html).toContain('href="/t/ufba-demo/administracao/cartas"');
    expect(html).toContain('Voltar para o catálogo de cartas');
  });

  it('6. a página dedicada /cartas/nova renderiza o container card e o formulário create-card com todos os campos estruturados', async () => {
    const html = renderToStaticMarkup(
      await NovaCartaPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
      }),
    );

    expect(html).toContain('data-testid="create-card-section"');
    expect(html).toContain('data-testid="create-card"');
    expect(html).toContain('name="slug"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="description"');
    expect(html).toContain('name="lore"');
    expect(html).toContain('name="rarity"');
    expect(html).toContain('name="trigger"');
    expect(html).toContain('name="eventId"');
    expect(html).toContain('name="palettePrimary"');
    expect(html).toContain('name="artSheen"');
    expect(html).toContain('name="artHolo"');
    expect(html).toContain('name="conditionThreshold"');
    expect(html).toContain('name="isActive"');
    expect(html).toContain('name="isSecret"');
    expect(html).toContain('Simpósio de IA 2026');
  });
});


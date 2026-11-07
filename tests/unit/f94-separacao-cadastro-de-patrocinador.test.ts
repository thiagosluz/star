import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import EventSponsorsPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/page';
import NewSponsorPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/novo/page';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SPONSOR_ID = '22222222-2222-4222-8222-222222222222';
const TIER_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  useRouter: vi.fn(() => ({ refresh: vi.fn(), push: vi.fn() })),
}));

vi.mock('../../src/components/admin/asset-uploader', () => ({
  AssetUploader: () => createElement('div', { 'data-testid': 'mock-asset-uploader' }),
}));

vi.mock('../../src/lib/auth/guard-page', () => ({
  requirePagePermission: vi.fn(async ({ tenantSlug }: { tenantSlug: string }) => ({
    tenantId: `tenant-${tenantSlug}`,
    userId: 'user-admin',
  })),
}));

vi.mock('../../src/lib/admin/catalog-service', () => ({
  getAdminEvent: vi.fn(async (tenantId: string, eventId: string) => {
    return {
      id: eventId,
      title: 'Congresso de Tecnologia 2027',
      startsAt: new Date('2027-05-10T09:00:00Z'),
      endsAt: new Date('2027-05-12T18:00:00Z'),
      registrationCount: 15,
      tracks: [],
      rooms: [],
      activities: [],
    };
  }),
}));

vi.mock('../../src/lib/admin/sponsor-service', () => ({
  listSponsorBoard: vi.fn(async (tenantId: string, eventId: string) => {
    if (tenantId === 'tenant-vazia') {
      return {
        event: { id: eventId, title: 'Congresso Vazio' },
        tiers: [],
        sponsors: [],
        publicCount: 0,
      };
    }

    return {
      event: { id: eventId, title: 'Congresso de Tecnologia 2027' },
      tiers: [
        {
          id: TIER_ID,
          eventId,
          name: 'Diamante',
          key: 'DIAMOND',
          rank: 1,
          color: '#00FFFF',
          logoScale: 'FEATURE',
          maxSponsors: 2,
          priceCents: 5000000,
          currency: 'BRL',
          description: 'Cota principal com estande e logo em destaque.',
          benefits: ['Logo no site', 'Estande de 20m²'],
          sponsorCount: 1,
          remaining: 1,
        },
      ],
      sponsors: [
        {
          id: SPONSOR_ID,
          eventId,
          name: 'Tech Corp Brasil',
          slug: 'tech-corp-brasil',
          description: 'Líder em soluções de computação em nuvem.',
          websiteUrl: 'https://techcorp.example.com',
          logoUrl: 'https://cdn.example.com/logo.webp',
          tierId: TIER_ID,
          tierName: 'Diamante',
          contactName: 'Carlos Mendes',
          contactEmail: 'carlos@techcorp.example.com',
          contactPhone: '(11) 98765-4321',
          taxIdMasked: '**.***.123/0001-**',
          contractValueCents: 5000000,
          contractStart: new Date('2027-01-01T00:00:00Z'),
          contractEnd: new Date('2027-12-31T23:59:59Z'),
          contractState: 'ACTIVE',
          contractStateLabel: 'Contrato ativo',
          displayOrder: 1,
          isActive: true,
          sourceSponsorId: null,
          sourceName: null,
        },
      ],
      publicCount: 1,
    };
  }),
  listSponsorCandidates: vi.fn(async () => [
    {
      sponsorId: '99999999-9999-4999-8999-999999999999',
      name: 'Parceiro Histórico',
      tierName: 'Ouro',
      alreadyInEvent: false,
      events: ['Edição 2026'],
    },
  ]),
}));

vi.mock('../../src/lib/exports/export-service', () => ({
  listRecentDataExports: vi.fn(async () => []),
  getDataExport: vi.fn(async () => null),
}));

vi.mock('../../src/lib/sponsors/sponsor-portal-service', () => ({
  listSponsorQrCodes: vi.fn(async () => []),
  listSponsorTeam: vi.fn(async () => []),
  listSponsorLeads: vi.fn(async () => []),
}));

vi.mock('../../src/lib/sponsors/sponsor-qr-sheet', () => ({
  sponsorQrSheet: vi.fn(async () => ({})),
}));

vi.mock('../../src/lib/db/tenant-client', () => ({
  withTenant: vi.fn(async (_tenantId: string, callback: (tx: unknown) => Promise<unknown>) => {
    return callback({
      cardTemplate: {
        findMany: vi.fn(async () => []),
      },
    });
  }),
}));

describe('FASE 94 · Separação do cadastro de patrocinador (/patrocinadores/novo)', () => {
  describe('Cockpit de Patrocinadores (/patrocinadores)', () => {
    it('exibe botão primário "Novo patrocinador" no cabeçalho apontando para /patrocinadores/novo', async () => {
      const html = renderToStaticMarkup(
        await EventSponsorsPage({
          params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
          searchParams: Promise.resolve({}),
        }),
      );

      expect(html).toContain('data-testid="btn-novo-patrocinador"');
      expect(html).toContain('/t/ufba-demo/administracao/eventos/' + EVENT_ID + '/patrocinadores/novo');
      expect(html).toContain('Novo patrocinador');
    });

    it('NÃO renderiza o formulário denso inline de criação nem a cópia no rodapé do cockpit', async () => {
      const html = renderToStaticMarkup(
        await EventSponsorsPage({
          params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
          searchParams: Promise.resolve({}),
        }),
      );

      expect(html).not.toContain('data-testid="create-sponsor"');
      expect(html).not.toContain('data-testid="copy-sponsor-section"');
      expect(html).not.toContain('data-testid="copy-sponsor"');
    });

    it('renderiza os patrocinadores em cards brancos elevados com status e ações', async () => {
      const html = renderToStaticMarkup(
        await EventSponsorsPage({
          params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
          searchParams: Promise.resolve({}),
        }),
      );

      expect(html).toContain(`data-testid="sponsor-${SPONSOR_ID}"`);
      expect(html).toContain('Tech Corp Brasil');
      expect(html).toContain('bg-card');
      expect(html).toContain('shadow-sm');
      expect(html).toContain('rounded-xl');
    });

    it('exibe estado vazio estilizado com CTA para /patrocinadores/novo quando não há patrocinadores', async () => {
      const html = renderToStaticMarkup(
        await EventSponsorsPage({
          params: Promise.resolve({ tenantSlug: 'vazia', eventId: EVENT_ID }),
          searchParams: Promise.resolve({}),
        }),
      );

      expect(html).toContain('data-testid="empty-sponsors"');
      expect(html).toContain('Nenhum patrocinador cadastrado');
      expect(html).toContain('Cadastrar primeiro patrocinador');
      expect(html).toContain('/t/vazia/administracao/eventos/' + EVENT_ID + '/patrocinadores/novo');
    });
  });

  describe('Página Dedicada de Cadastro (/patrocinadores/novo)', () => {
    it('renderiza PageHeader semântico com breadcrumbs e link de retorno para patrocinadores', async () => {
      const html = renderToStaticMarkup(
        await NewSponsorPage({
          params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
        }),
      );

      expect(html).toContain('data-testid="new-sponsor-page"');
      expect(html).toContain('Novo patrocinador');
      expect(html).toContain('← Voltar para Patrocinadores');
      expect(html).toContain('/t/ufba-demo/administracao/eventos/' + EVENT_ID + '/patrocinadores');
    });

    it('renderiza o formulário de cadastro em card branco com todos os campos necessários', async () => {
      const html = renderToStaticMarkup(
        await NewSponsorPage({
          params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
        }),
      );

      expect(html).toContain('data-testid="create-sponsor-section"');
      expect(html).toContain('data-testid="create-sponsor"');
      expect(html).toContain('name="name"');
      expect(html).toContain('name="tierId"');
      expect(html).toContain('name="websiteUrl"');
      expect(html).toContain('name="displayOrder"');
      expect(html).toContain('name="contactName"');
      expect(html).toContain('name="contactEmail"');
      expect(html).toContain('name="taxId"');
      expect(html).toContain('name="contractValueReais"');
      expect(html).toContain('name="contractStart"');
      expect(html).toContain('name="contractEnd"');
      expect(html).toContain('name="description"');
      expect(html).toContain('name="isActive"');
      expect(html).toContain('Cadastrar patrocinador');
    });

    it('renderiza a seção de cópia de outra edição com candidatos disponíveis', async () => {
      const html = renderToStaticMarkup(
        await NewSponsorPage({
          params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
        }),
      );

      expect(html).toContain('data-testid="copy-sponsor-section"');
      expect(html).toContain('data-testid="copy-sponsor"');
      expect(html).toContain('Copiar de outro evento');
      expect(html).toContain('Parceiro Histórico');
      expect(html).toContain('Copiar para este evento');
    });
  });
});

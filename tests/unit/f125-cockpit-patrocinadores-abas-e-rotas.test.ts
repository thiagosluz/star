import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEventSponsorsHref,
  computeSponsorKpiSummary,
  resolveSponsorTab,
} from '../../src/domain/events/sponsor-rules';
import EventSponsorsPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/page';
import NewSponsorTierPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/cotas/nova/page';
import EditSponsorTierPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/cotas/[tierId]/editar/page';
import EditSponsorPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/[sponsorId]/editar/page';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SPONSOR_ID = '22222222-2222-4222-8222-222222222222';
const TIER_ID = '33333333-3333-4333-8333-333333333333';

const mockListSponsorQrCodes = vi.fn(async () => []);
const mockListSponsorTeam = vi.fn(async () => []);
const mockListSponsorLeads = vi.fn(async () => []);
const mockGetEventSponsorExperienceCounts = vi.fn(async () => ({
  qrCount: 2,
  activeQrCount: 1,
  visitCount: 10,
  leadCount: 6,
}));

const SAMPLE_TIER = {
  id: TIER_ID,
  name: 'Diamante',
  key: 'DIAMOND' as const,
  rank: 1,
  color: '#1d4ed8',
  logoScale: 'FEATURE' as const,
  maxSponsors: 2,
  priceCents: 5_000_000,
  currency: 'BRL',
  description: 'Cota principal com estande.',
  benefits: ['Logo em destaque', 'Estande 9 m²'],
  sponsorCount: 1,
  remaining: 1,
};

const SAMPLE_SPONSOR = {
  id: SPONSOR_ID,
  name: 'Tech Corp Brasil',
  slug: 'tech-corp-brasil',
  description: 'Parceiro de tecnologia.',
  websiteUrl: 'https://techcorp.example.com',
  logoUrl: 'https://cdn.example.com/logo.webp',
  tierId: TIER_ID,
  tierName: 'Diamante',
  tierRank: 1,
  contactName: 'Carlos Mendes',
  contactEmail: 'carlos@techcorp.example.com',
  contactPhone: '(11) 98765-4321',
  taxIdMasked: '**.***.123/0001-**',
  contractValueCents: 5_000_000,
  contractStart: new Date('2026-01-01T12:00:00Z'),
  contractEnd: new Date('2026-12-31T12:00:00Z'),
  contractState: 'ACTIVE' as const,
  contractStateLabel: 'Contrato vigente',
  displayOrder: 1,
  isActive: true,
  sourceSponsorId: null,
  sourceName: null,
};

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
  getAdminEvent: vi.fn(async (_tenantId: string, eventId: string) => ({
    id: eventId,
    title: 'Congresso de Inovação 2026',
    startsAt: new Date('2026-05-10T09:00:00Z'),
    endsAt: new Date('2026-05-12T18:00:00Z'),
  })),
}));

vi.mock('../../src/lib/admin/sponsor-service', () => ({
  listSponsorBoard: vi.fn(async () => ({
    tiers: [SAMPLE_TIER],
    sponsors: [SAMPLE_SPONSOR],
    publicCount: 1,
  })),
  getSponsorTierForEdit: vi.fn(async () => SAMPLE_TIER),
  getSponsorForEdit: vi.fn(async () => ({
    sponsor: SAMPLE_SPONSOR,
    tiers: [SAMPLE_TIER],
    eventTitle: 'Congresso de Inovação 2026',
  })),
}));

vi.mock('../../src/lib/exports/export-service', () => ({
  listRecentDataExports: vi.fn(async () => []),
  getDataExport: vi.fn(async () => null),
}));

vi.mock('../../src/lib/sponsors/sponsor-portal-service', () => ({
  getEventSponsorExperienceCounts: () => mockGetEventSponsorExperienceCounts(),
  listSponsorQrCodes: () => mockListSponsorQrCodes(),
  listSponsorTeam: () => mockListSponsorTeam(),
  listSponsorLeads: () => mockListSponsorLeads(),
}));

vi.mock('../../src/lib/sponsors/sponsor-qr-sheet', () => ({
  sponsorQrSheet: vi.fn(async () => ({})),
}));

vi.mock('../../src/lib/db/tenant-client', () => ({
  withTenant: vi.fn(async (_tenantId: string, callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      cardTemplate: { findMany: vi.fn(async () => []) },
    }),
  ),
}));

describe('FASE 125 · Regras puras do cockpit de patrocinadores', () => {
  it('resolveSponsorTab seleciona aba explícita ou abre estandes automaticamente sob parâmetros operacionais', () => {
    expect(resolveSponsorTab({})).toBe('patrocinadores');
    expect(resolveSponsorTab({ aba: 'cotas' })).toBe('cotas');
    expect(resolveSponsorTab({ aba: 'estandes' })).toBe('estandes');
    expect(resolveSponsorTab({ aba: 'invalida' })).toBe('patrocinadores');

    expect(resolveSponsorTab({ confirmarQr: SPONSOR_ID })).toBe('estandes');
    expect(resolveSponsorTab({ exportacao: 'exp-1' })).toBe('estandes');
    expect(resolveSponsorTab({ erro: 'falha' })).toBe('estandes');
  });

  it('buildEventSponsorsHref constrói URLs limpas para abas e drill-down', () => {
    const base = `/t/ufba-demo/administracao/eventos/${EVENT_ID}/patrocinadores`;

    expect(buildEventSponsorsHref(base)).toBe(base);
    expect(buildEventSponsorsHref(base, { aba: 'patrocinadores' })).toBe(base);
    expect(buildEventSponsorsHref(base, { aba: 'cotas' })).toBe(`${base}?aba=cotas`);
    expect(buildEventSponsorsHref(base, { aba: 'estandes', patrocinador: SPONSOR_ID })).toBe(
      `${base}?aba=estandes&patrocinador=${SPONSOR_ID}`,
    );
  });

  it('computeSponsorKpiSummary agrega contratos, vagas e taxa de consentimento LGPD (null !== 0)', () => {
    const semVisitas = computeSponsorKpiSummary({
      tiers: [
        { maxSponsors: 2, sponsorCount: 1 },
        { maxSponsors: 0, sponsorCount: 1 },
      ],
      sponsors: [
        {
          isActive: true,
          logoUrl: 'https://cdn.example.com/a.webp',
          contractValueCents: 1_500_000,
          contractState: 'ACTIVE',
          sourceSponsorId: null,
        },
        {
          isActive: false,
          logoUrl: null,
          contractValueCents: null,
          contractState: 'EXPIRED',
          sourceSponsorId: 'orig-1',
        },
      ],
      experience: { qrCount: 1, activeQrCount: 1, visitCount: 0, leadCount: 0 },
    });

    expect(semVisitas.totalSponsors).toBe(2);
    expect(semVisitas.publicCount).toBe(1);
    expect(semVisitas.hiddenCount).toBe(1);
    expect(semVisitas.withoutLogoCount).toBe(1);
    expect(semVisitas.totalContractValueCents).toBe(1_500_000);
    expect(semVisitas.activeContractsCount).toBe(1);
    expect(semVisitas.expiredContractsCount).toBe(1);
    expect(semVisitas.copiedCount).toBe(1);
    expect(semVisitas.occupiedLimitedSlots).toBe(1);
    expect(semVisitas.totalLimitedSlots).toBe(2);
    expect(semVisitas.consentRatePercent).toBeNull();

    const comVisitas = computeSponsorKpiSummary({
      tiers: [{ maxSponsors: 2, sponsorCount: 1 }],
      sponsors: [],
      experience: { qrCount: 1, activeQrCount: 1, visitCount: 5, leadCount: 3 },
    });

    expect(comVisitas.consentRatePercent).toBe(60);
  });
});

describe('FASE 125 · SSR do cockpit por abas e das 3 novas rotas dedicadas', () => {
  beforeEach(() => {
    mockListSponsorQrCodes.mockClear();
    mockListSponsorTeam.mockClear();
    mockListSponsorLeads.mockClear();
    mockGetEventSponsorExperienceCounts.mockClear();
  });

  it('aba padrão `patrocinadores` renderiza faixa executiva + ponte financeira sem disparar queries de QR/leads', async () => {
    const html = renderToStaticMarkup(
      await EventSponsorsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain('data-testid="sponsor-kpi-strip"');
    expect(html).toContain('data-testid="sponsor-finance-link"');
    expect(html).toContain(`/t/ufba-demo/administracao/eventos/${EVENT_ID}/financeiro`);
    expect(html).toContain('data-testid="sponsor-tabs"');
    expect(html).toContain(`data-testid="edit-sponsor-${SPONSOR_ID}"`);
    expect(html).toContain(`data-testid="booth-sponsor-${SPONSOR_ID}"`);
    expect(html).not.toContain('data-testid="tier-section"');
    expect(html).not.toContain('data-testid="sponsor-experience"');

    expect(mockGetEventSponsorExperienceCounts).toHaveBeenCalledTimes(1);
    expect(mockListSponsorQrCodes).not.toHaveBeenCalled();
    expect(mockListSponsorTeam).not.toHaveBeenCalled();
    expect(mockListSponsorLeads).not.toHaveBeenCalled();
  });

  it('aba `cotas` exibe a lista de cotas com prévia visual e links dedicados sem queries de QR/leads', async () => {
    const html = renderToStaticMarkup(
      await EventSponsorsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
        searchParams: Promise.resolve({ aba: 'cotas' }),
      }),
    );

    expect(html).toContain('data-testid="tier-section"');
    expect(html).toContain('data-testid="tier-list"');
    expect(html).toContain(`data-testid="edit-tier-${TIER_ID}"`);
    expect(html).not.toContain('data-testid="sponsor-section"');
    expect(html).not.toContain('data-testid="sponsor-experience"');

    expect(mockListSponsorQrCodes).not.toHaveBeenCalled();
  });

  it('aba `estandes` (ou `?patrocinador=`) carrega QRs/leads, aplica filtro e pré-preenche contactEmail', async () => {
    const html = renderToStaticMarkup(
      await EventSponsorsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
        searchParams: Promise.resolve({ aba: 'estandes', patrocinador: SPONSOR_ID }),
      }),
    );

    expect(html).toContain('data-testid="sponsor-experience"');
    expect(html).toContain('data-testid="sponsor-experience-filter-banner"');
    expect(html).toContain('carlos@techcorp.example.com');
    expect(mockListSponsorQrCodes).toHaveBeenCalledTimes(1);
    expect(mockListSponsorTeam).toHaveBeenCalledTimes(1);
    expect(mockListSponsorLeads).toHaveBeenCalledTimes(1);
  });

  it('rotas dedicadas /cotas/nova, /cotas/[tierId]/editar e /[sponsorId]/editar renderizam PageHeader e formulários completos', async () => {
    const novaCotaHtml = renderToStaticMarkup(
      await NewSponsorTierPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      }),
    );
    expect(novaCotaHtml).toContain('data-testid="new-sponsor-tier-page"');
    expect(novaCotaHtml).toContain('data-testid="create-tier"');

    const editCotaHtml = renderToStaticMarkup(
      await EditSponsorTierPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID, tierId: TIER_ID }),
      }),
    );
    expect(editCotaHtml).toContain('data-testid="edit-sponsor-tier-page"');
    expect(editCotaHtml).toContain(`data-testid="tier-form-${TIER_ID}"`);

    const editSponsorHtml = renderToStaticMarkup(
      await EditSponsorPage({
        params: Promise.resolve({
          tenantSlug: 'ufba-demo',
          eventId: EVENT_ID,
          sponsorId: SPONSOR_ID,
        }),
      }),
    );
    expect(editSponsorHtml).toContain('data-testid="edit-sponsor-page"');
    expect(editSponsorHtml).toContain(`data-testid="sponsor-form-${SPONSOR_ID}"`);
  });
});

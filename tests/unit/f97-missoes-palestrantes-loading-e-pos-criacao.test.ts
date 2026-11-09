import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const MISSION_FIXTURE = {
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'presenca-tripla',
  name: 'Presença tripla',
  description: 'Participe de três atividades',
  kind: 'ONE_OFF',
  trigger: 'CHECKIN',
  target: { count: 3, activityType: 'LECTURE', minutes: 45 },
  xpReward: 90,
  rewardCardSlug: 'guardiao-metodo',
  rewardCardTemplateId: '11111111-1111-4111-8111-111111111111',
  eventId: '22222222-2222-4222-8222-222222222222',
  repeatEveryHours: 0,
  isActive: true,
  isVisible: true,
  displayOrder: 1,
  completions: 12,
  claims: 9,
  archivedAt: null,
  archivedByName: null,
};

const CARD_FIXTURE = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'guardiao-metodo',
  name: 'Guardião do Método',
  description: 'Concedida pela comissão',
  lore: null,
  rarity: 'EPIC' as const,
  trigger: 'MANUAL_GRANT' as const,
  levelRequired: 1,
  maxSupply: 100,
  mintedCount: 4,
  dropWeight: 10,
  isActive: true,
  isSecret: false,
  palette: null,
  art: null,
  triggerCondition: null,
  ownedBy: 4,
  usedByMissions: 1,
  usedByQrCodes: 0,
  eventId: null,
  archivedAt: null,
  archivedByName: null,
};

const EVENT_FIXTURE = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'congresso-2026',
  title: 'Congresso UFBA 2026',
  summary: null,
  venueName: null,
  onlineUrl: null,
  city: 'Salvador',
  state: 'BA',
  startsAt: new Date('2026-09-10T12:00:00.000Z'),
  endsAt: new Date('2026-09-12T20:00:00.000Z'),
  timezone: 'America/Bahia',
  capacity: null,
  status: 'PUBLISHED' as const,
  modality: 'IN_PERSON' as const,
  category: null,
  usesCall: false,
  registrationRequiresMembership: false,
  registrationOpensAt: null,
  registrationClosesAt: null,
  primaryColor: null,
  rooms: [],
  tracks: [],
  activities: [],
};

const SPEAKER_FIXTURE = {
  speakerProfileId: '44444444-4444-4444-8444-444444444444',
  name: 'Profa. Helena Costa',
  email: 'helena@ufba.br',
  institution: 'UFBA',
  company: null,
  roleTitle: 'Keynote',
  bio: 'Pesquisadora em sistemas distribuídos.',
  avatarUrl: null,
  avatarSource: null,
  photoDeclaration: null,
  isPublic: true,
  isConfirmed: true,
  hasAccount: false,
  hasPendingInvite: true,
  inviteExpiresAt: new Date('2026-10-01T12:00:00.000Z'),
  socialLinks: {},
  activities: [],
  materialCount: 0,
};

const withTenantSpy = vi.fn(
  async <T>(_tenantId: string, fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const fakeTx = {
      tenant: {
        findUnique: vi.fn(async () => ({ timezone: 'America/Bahia' })),
      },
    };
    return fn(fakeTx);
  },
);

const listMissionsMock = vi.fn(async (..._args: unknown[]) => [MISSION_FIXTURE]);
const getMissionForEditMock = vi.fn(
  async (_tenantId: string, missionId: string) =>
    missionId === MISSION_FIXTURE.id ? MISSION_FIXTURE : null,
);
const listCardTemplatesMock = vi.fn(async (..._args: unknown[]) => [CARD_FIXTURE]);
const listAdminEventsMock = vi.fn(async (..._args: unknown[]) => [EVENT_FIXTURE]);
const getAdminEventMock = vi.fn(
  async (_tenantId: string, eventId: string) =>
    eventId === EVENT_FIXTURE.id ? EVENT_FIXTURE : null,
);
const listSpeakersMock = vi.fn(async (..._args: unknown[]) => [SPEAKER_FIXTURE]);
const listEventActivitiesForSpeakersMock = vi.fn(async (..._args: unknown[]) => [
  { id: '55555555-5555-4555-8555-555555555555', title: 'Abertura Magna', startsAt: new Date() },
]);

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: vi.fn(() => '/t/ufba-demo/dashboard'),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));

vi.mock('@/app/actions/admin-actions', () => ({
  saveMissionAction: vi.fn(),
  deleteMissionAction: vi.fn(),
}));

vi.mock('@/app/actions/catalog-archive-actions', () => ({
  restoreMissionAction: vi.fn(),
}));

vi.mock('@/app/actions/speaker-actions', () => ({
  saveSpeakerProfileAction: vi.fn(),
  linkSpeakerAction: vi.fn(),
  unlinkSpeakerAction: vi.fn(),
  regenerateSpeakerInviteAction: vi.fn(),
}));

vi.mock('@/app/actions/landing-actions', () => ({
  requestAssetUploadAction: vi.fn(),
  confirmAssetUploadAction: vi.fn(),
}));

vi.mock('@/lib/auth/guard-page', () => ({
  requirePagePermission: vi.fn(async () => ({
    tenantId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
  })),
}));

vi.mock('@/lib/db/tenant-client', () => ({
  withTenant: (tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    withTenantSpy(tenantId, fn),
}));

vi.mock('@/lib/admin/gamification-admin-service', () => ({
  listMissions: (...args: unknown[]) => listMissionsMock(...args),
  getMissionForEdit: (tenantId: string, missionId: string) =>
    getMissionForEditMock(tenantId, missionId),
  listCardTemplates: (...args: unknown[]) => listCardTemplatesMock(...args),
}));

vi.mock('@/lib/admin/catalog-service', () => ({
  listAdminEvents: (...args: unknown[]) => listAdminEventsMock(...args),
  getAdminEvent: (tenantId: string, eventId: string) =>
    getAdminEventMock(tenantId, eventId),
}));

vi.mock('@/lib/speakers/speaker-service', () => ({
  listSpeakers: (...args: unknown[]) => listSpeakersMock(...args),
  listEventActivitiesForSpeakers: (...args: unknown[]) =>
    listEventActivitiesForSpeakersMock(...args),
}));

import AdminMissionsPage from '@/app/t/[tenantSlug]/(app)/administracao/missoes/page';
import NovaMissaoPage from '@/app/t/[tenantSlug]/(app)/administracao/missoes/nova/page';
import EditarMissaoPage from '@/app/t/[tenantSlug]/(app)/administracao/missoes/[missionId]/editar/page';
import EventSpeakersPage from '@/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/palestrantes/page';
import NewEventSpeakerPage from '@/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/palestrantes/novo/page';
import { RouteLoadingSkeleton, RouteProgress } from '@/components/shell/route-progress';
import { TENANT_CACHE_AREAS } from '@/lib/cache/revalidate-area';

describe('FASE 97 — Unificação de Missões e Palestrantes, loading.tsx e confirmação pós-criação', () => {
  it('1. [ADR-409] AdminMissionsPage roda em UMA única transação withTenant, sem carregar cartas/eventos e com link para edição dedicada', async () => {
    withTenantSpy.mockClear();
    listMissionsMock.mockClear();
    listCardTemplatesMock.mockClear();
    listAdminEventsMock.mockClear();

    const html = renderToStaticMarkup(
      await AdminMissionsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(withTenantSpy).toHaveBeenCalledTimes(1);
    expect(listMissionsMock).toHaveBeenCalledTimes(1);
    expect(listMissionsMock.mock.calls[0]?.[2]).toBeDefined();
    expect(listCardTemplatesMock).not.toHaveBeenCalled();
    expect(listAdminEventsMock).not.toHaveBeenCalled();

    expect(html).toContain('data-testid="btn-nova-missao"');
    expect(html).toContain('href="/t/ufba-demo/administracao/missoes/nova"');
    expect(html).toContain(`data-testid="mission-edit-${MISSION_FIXTURE.id}"`);
    expect(html).toContain(
      `href="/t/ufba-demo/administracao/missoes/${MISSION_FIXTURE.id}/editar"`,
    );
    expect(html).not.toContain('data-testid="create-mission"');
    expect(html).not.toContain(`data-testid="mission-form-${MISSION_FIXTURE.id}"`);
  });

  it('2. [ADR-409] NovaMissaoPage e EditarMissaoPage carregam dados em UMA transação e EditarMissaoPage responde 404 para missão ausente ou id malformado', async () => {
    withTenantSpy.mockClear();
    listCardTemplatesMock.mockClear();
    listAdminEventsMock.mockClear();

    const htmlNova = renderToStaticMarkup(
      await NovaMissaoPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
      }),
    );

    expect(withTenantSpy).toHaveBeenCalledTimes(1);
    expect(listCardTemplatesMock).toHaveBeenCalledTimes(1);
    expect(listAdminEventsMock).toHaveBeenCalledTimes(1);
    expect(htmlNova).toContain('data-testid="new-mission-page"');
    expect(htmlNova).toContain('data-testid="link-voltar-missoes"');
    expect(htmlNova).toContain('data-testid="create-mission-section"');
    expect(htmlNova).toContain('data-testid="create-mission"');

    withTenantSpy.mockClear();
    const htmlEditar = renderToStaticMarkup(
      await EditarMissaoPage({
        params: Promise.resolve({
          tenantSlug: 'ufba-demo',
          missionId: MISSION_FIXTURE.id,
        }),
      }),
    );

    expect(withTenantSpy).toHaveBeenCalledTimes(1);
    expect(htmlEditar).toContain('Editar missão: Presença tripla');
    expect(htmlEditar).toContain('data-testid="link-voltar-missoes"');
    expect(htmlEditar).toContain('data-testid="edit-mission-section"');
    expect(htmlEditar).toContain(`data-testid="mission-form-${MISSION_FIXTURE.id}"`);
    expect(htmlEditar).toContain('value="Presença tripla"');

    // Missão ausente/arquivada -> 404
    await expect(
      EditarMissaoPage({
        params: Promise.resolve({
          tenantSlug: 'ufba-demo',
          missionId: '99999999-9999-4999-8999-999999999999',
        }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    // UUID malformado -> 404 antes do banco
    await expect(
      EditarMissaoPage({
        params: Promise.resolve({
          tenantSlug: 'ufba-demo',
          missionId: 'nao-e-uuid',
        }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('3. [ADR-409] EventSpeakersPage e NewEventSpeakerPage separam listagem e criação em rotas dedicadas com transação única', async () => {
    withTenantSpy.mockClear();
    listSpeakersMock.mockClear();
    listEventActivitiesForSpeakersMock.mockClear();

    const htmlList = renderToStaticMarkup(
      await EventSpeakersPage({
        params: Promise.resolve({
          tenantSlug: 'ufba-demo',
          eventId: EVENT_FIXTURE.id,
        }),
      }),
    );

    expect(withTenantSpy).toHaveBeenCalledTimes(1);
    expect(listSpeakersMock).toHaveBeenCalledTimes(1);
    expect(listEventActivitiesForSpeakersMock).toHaveBeenCalledTimes(1);
    expect(htmlList).toContain('data-testid="btn-novo-palestrante"');
    expect(htmlList).toContain(
      `href="/t/ufba-demo/administracao/eventos/${EVENT_FIXTURE.id}/palestrantes/novo"`,
    );
    expect(htmlList).not.toContain('data-testid="toggle-speaker-form"');
    expect(htmlList).toContain(`data-testid="speaker-row-${SPEAKER_FIXTURE.speakerProfileId}"`);
    expect(htmlList).toContain(`data-testid="speaker-edit-${SPEAKER_FIXTURE.speakerProfileId}"`);

    withTenantSpy.mockClear();
    const htmlNew = renderToStaticMarkup(
      await NewEventSpeakerPage({
        params: Promise.resolve({
          tenantSlug: 'ufba-demo',
          eventId: EVENT_FIXTURE.id,
        }),
      }),
    );

    expect(withTenantSpy).toHaveBeenCalledTimes(1);
    expect(htmlNew).toContain('data-testid="new-speaker-page"');
    expect(htmlNew).toContain('data-testid="link-voltar-palestrantes"');
    expect(htmlNew).toContain('data-testid="create-speaker-section"');
    expect(htmlNew).toContain('data-testid="speaker-form"');
    expect(htmlNew).toContain('data-testid="save-speaker"');
  });

  it('4. [ADR-410] RouteProgress e RouteLoadingSkeleton no AppShell para feedback instantâneo sem mascarar 404/307 nem quebrar no-JS', () => {
    const appProgressHtml = renderToStaticMarkup(
      createElement(RouteProgress, { variant: 'tenant', forceVisible: true }),
    );
    expect(appProgressHtml).toContain('data-testid="app-route-loading"');
    expect(appProgressHtml).toContain('aria-busy="true"');

    const platformProgressHtml = renderToStaticMarkup(
      createElement(RouteProgress, { variant: 'platform', forceVisible: true }),
    );
    expect(platformProgressHtml).toContain('data-testid="platform-route-loading"');
    expect(platformProgressHtml).toContain('aria-busy="true"');

    const skeletonHtml = renderToStaticMarkup(
      createElement(RouteLoadingSkeleton, { variant: 'tenant' }),
    );
    expect(skeletonHtml).toContain('data-testid="app-route-skeleton"');
    expect(skeletonHtml).toContain('aria-busy="true"');

    const appShellSource = readFileSync(
      join(process.cwd(), 'src/components/shell/app-shell.tsx'),
      'utf8',
    );
    expect(appShellSource).toContain('<RouteProgress variant={variant} />');
  });

  it('5. [ADR-411] Todas as páginas dedicadas /novo, /nova e /editar conectam backHref para confirmação pós-criação e TENANT_CACHE_AREAS cobre as novas rotas', () => {
    const paginasComBackHref = [
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/novo/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/programacao/nova/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/nova/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/novo/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/palestrantes/novo/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/cartas/nova/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/cartas/[cardId]/editar/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/missoes/nova/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/missoes/[missionId]/editar/page.tsx',
    ];

    for (const relPath of paginasComBackHref) {
      const source = readFileSync(join(process.cwd(), relPath), 'utf8');
      expect(source, `${relPath} deve passar backHref para AdminForm/SpeakerCreateForm`).toContain(
        'backHref=',
      );
    }

    expect(TENANT_CACHE_AREAS.missoes).toContain('/administracao/missoes/nova');
    expect(TENANT_CACHE_AREAS.evento('evt-1')).toContain(
      '/administracao/eventos/evt-1/palestrantes/novo',
    );
  });
});

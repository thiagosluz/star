import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  EVENT_DELETE_CONFIRMATION_WORD,
  buildAdminEventsHref,
  buildClonedEventDefaults,
  buildDeletedEventSlug,
  canArchiveEvent,
  canRestoreArchivedEvent,
  evaluateEventDeletionGuard,
  eventStatusLabel,
  filterEventsByArchive,
  resolveEventArchiveFilter,
  sanitizeClonedSettings,
} from '@/domain/events/event-lifecycle-rules';

const mockRequirePagePermission = vi.fn();
const mockListAdminEvents = vi.fn();

vi.mock('@/lib/auth/guard-page', () => ({
  requirePagePermission: (...args: unknown[]) => mockRequirePagePermission(...args),
}));

vi.mock('@/lib/admin/catalog-service', () => ({
  listAdminEvents: (...args: unknown[]) => mockListAdminEvents(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/app/actions/event-lifecycle-actions', () => ({
  archiveEventAction: vi.fn(),
  cloneEventAction: vi.fn(),
  deleteEventAction: vi.fn(),
}));

import AdminEventsPage from '@/app/t/[tenantSlug]/(app)/administracao/eventos/page';

describe('FASE 128 — regras de ciclo de vida do acervo de eventos', () => {
  it('resolve e constrói filtros de acervo corretamente', () => {
    expect(resolveEventArchiveFilter(undefined)).toBe('todos');
    expect(resolveEventArchiveFilter('ATIVOS')).toBe('ativos');
    expect(resolveEventArchiveFilter('arquivados')).toBe('arquivados');
    expect(resolveEventArchiveFilter('invalido')).toBe('todos');

    expect(buildAdminEventsHref('/t/ufba/administracao/eventos', 'todos')).toBe(
      '/t/ufba/administracao/eventos',
    );
    expect(buildAdminEventsHref('/t/ufba/administracao/eventos', 'arquivados')).toBe(
      '/t/ufba/administracao/eventos?situacao=arquivados',
    );
  });

  it('filtra eventos entre todos, ativos e arquivados e traduz rótulos', () => {
    const sample = [
      { id: '1', status: 'PUBLISHED' },
      { id: '2', status: 'DRAFT' },
      { id: '3', status: 'ARCHIVED' },
    ];

    expect(filterEventsByArchive(sample, 'todos').map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(filterEventsByArchive(sample, 'ativos').map((e) => e.id)).toEqual(['1', '2']);
    expect(filterEventsByArchive(sample, 'arquivados').map((e) => e.id)).toEqual(['3']);

    expect(eventStatusLabel('ARCHIVED')).toBe('Arquivado');
    expect(eventStatusLabel('DRAFT')).toBe('Rascunho');
    expect(canArchiveEvent('PUBLISHED')).toBe(true);
    expect(canArchiveEvent('ARCHIVED')).toBe(false);
    expect(canRestoreArchivedEvent('ARCHIVED')).toBe(true);
    expect(canRestoreArchivedEvent('DRAFT')).toBe(false);
  });

  it('descarta credenciais de settings.api ao sanitizar configurações clonadas', () => {
    const clean = sanitizeClonedSettings({
      registrationRequiresMembership: true,
      registrationForm: { fields: ['cpf', 'institution'] },
      certificatePolicy: { minAttendancePercent: 75 },
      api: {
        keyHash: 'hash-secreto',
        sealedKey: 'segredo',
        revokedAt: '2026-01-01',
      },
      chaveArbitraria: 'nao-copiar',
    });

    expect(clean).toEqual({
      registrationRequiresMembership: true,
      registrationForm: { fields: ['cpf', 'institution'] },
      certificatePolicy: { minAttendancePercent: 75 },
    });
    expect('api' in clean).toBe(false);
    expect('chaveArbitraria' in clean).toBe(false);
  });

  it('gera defaults seguros para clonagem respeitando limites e duração', () => {
    const startsAt = new Date('2026-10-10T12:00:00.000Z');
    const endsAt = new Date('2026-10-12T18:00:00.000Z');
    const defaults = buildClonedEventDefaults({
      title: 'Seminário de Engenharia',
      slug: 'seminario-engenharia',
      startsAt,
      endsAt,
    });

    expect(defaults.title).toBe('Seminário de Engenharia (Cópia)');
    expect(defaults.slug).toBe('seminario-engenharia-copia');
    expect(defaults.endsAt.getTime() - defaults.startsAt.getTime()).toBe(
      endsAt.getTime() - startsAt.getTime(),
    );

    const longSlugDefaults = buildClonedEventDefaults({
      title: 'A'.repeat(210),
      slug: 'slug-muito-longo-'.repeat(6),
      startsAt,
      endsAt: startsAt,
    });
    expect(longSlugDefaults.title.length).toBeLessThanOrEqual(200);
    expect(longSlugDefaults.slug.length).toBeLessThanOrEqual(63);
    expect(longSlugDefaults.endsAt.getTime() - longSlugDefaults.startsAt.getTime()).toBe(3_600_000);
  });

  it('valida palavra-chave EXCLUIR, senha e geração de slug liberado na exclusão', () => {
    expect(
      evaluateEventDeletionGuard({ confirmationWord: 'apagar', currentPassword: '123' }),
    ).toMatchObject({ ok: false, code: 'INVALID_CONFIRMATION_WORD' });

    expect(
      evaluateEventDeletionGuard({
        confirmationWord: EVENT_DELETE_CONFIRMATION_WORD,
        currentPassword: '',
      }),
    ).toMatchObject({ ok: false, code: 'PASSWORD_REQUIRED' });

    expect(
      evaluateEventDeletionGuard({ confirmationWord: '  excluir ', currentPassword: 'secret' }),
    ).toEqual({ ok: true });

    const deletedSlug = buildDeletedEventSlug('congresso-2026', 'c8d81c5d-9a44-4836-bcc9');
    expect(deletedSlug).toMatch(/^congresso-2026-del-c8d81c5d$/);
    expect(deletedSlug.length).toBeLessThanOrEqual(63);
  });

  it('renderiza atalho Editar dados, filtros e gatilhos sem montar <form> no SSR', async () => {
    mockRequirePagePermission.mockResolvedValue({ tenantId: 't-1', userId: 'u-1' });
    mockListAdminEvents.mockResolvedValue([
      {
        id: 'ev-1',
        slug: 'simposio-ativo',
        title: 'Simpósio Ativo',
        startsAt: new Date('2026-08-10T10:00:00.000Z'),
        endsAt: new Date('2026-08-11T18:00:00.000Z'),
        timezone: 'America/Bahia',
        status: 'PUBLISHED',
        activityCount: 2,
        trackCount: 1,
        roomCount: 1,
        registrationCount: 10,
      },
      {
        id: 'ev-2',
        slug: 'simposio-arquivado',
        title: 'Simpósio Arquivado',
        startsAt: new Date('2025-08-10T10:00:00.000Z'),
        endsAt: new Date('2025-08-10T18:00:00.000Z'),
        timezone: 'America/Bahia',
        status: 'ARCHIVED',
        activityCount: 1,
        trackCount: 0,
        roomCount: 0,
        registrationCount: 0,
      },
    ]);

    const element = await AdminEventsPage({
      params: Promise.resolve({ tenantSlug: 'ufba' }),
      searchParams: Promise.resolve({ situacao: 'ativos' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('<form');
    expect(html).toContain('events-filter-tabs');
    expect(html).toContain('edit-event-simposio-ativo');
    expect(html).toContain('clone-event-trigger-simposio-ativo');
    expect(html).toContain('archive-event-trigger-simposio-ativo');
    expect(html).toContain('delete-event-trigger-simposio-ativo');
    expect(html).toContain('Simpósio Ativo');
    expect(html).not.toContain('Simpósio Arquivado');
  });
});

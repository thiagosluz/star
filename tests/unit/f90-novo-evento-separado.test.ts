import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import AdminEventsPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/page';
import NewAdminEventPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/novo/page';

vi.mock('../../src/lib/auth/guard-page', () => ({
  requirePagePermission: vi.fn(async ({ tenantSlug }: { tenantSlug: string }) => ({
    tenantId: `tenant-${tenantSlug}`,
    userId: 'user-admin',
  })),
}));

vi.mock('../../src/lib/admin/catalog-service', () => ({
  listAdminEvents: vi.fn(async (tenantId: string) => {
    if (tenantId === 'tenant-com-eventos') {
      return [
        {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'congresso-2027',
          title: 'Congresso de Tecnologia 2027',
          startsAt: new Date('2027-05-10T09:00:00Z'),
          status: 'PUBLISHED',
          activityCount: 5,
          trackCount: 2,
          roomCount: 3,
          registrationCount: 42,
        },
      ];
    }
    return [];
  }),
}));

vi.mock('../../src/components/admin/admin-form', () => ({
  AdminForm: (props: { testId?: string; children?: unknown }) =>
    createElement('form', { 'data-testid': props.testId }, props.children as never),
  Field: (props: { label: string; name: string }) =>
    createElement('div', { 'data-field': props.name }, props.label),
  SelectField: (props: { label: string; name: string }) =>
    createElement('div', { 'data-select': props.name }, props.label),
  CheckboxField: (props: { label: string; name: string }) =>
    createElement('div', { 'data-checkbox': props.name }, props.label),
}));

describe('FASE 90 · Separação do cadastro de evento (/eventos/novo) e listagem (/eventos)', () => {
  describe('Página de listagem (/t/[tenantSlug]/administracao/eventos)', () => {
    it('renderiza o botão "Novo evento" no cabeçalho apontando para /eventos/novo', async () => {
      const pagina = await AdminEventsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="btn-novo-evento"');
      expect(html).toContain('href="/t/ufba-demo/administracao/eventos/novo"');
      expect(html).toContain('Novo evento');
    });

    it('NÃO renderiza o formulário de criação na listagem (zero <form e zero create-event)', async () => {
      const pagina = await AdminEventsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).not.toContain('<form');
      expect(html).not.toContain('data-testid="create-event"');
      expect(html).not.toContain('id="novo-evento"');
    });

    it('renderiza a lista de eventos com link para gerenciar quando há eventos', async () => {
      const pagina = await AdminEventsPage({
        params: Promise.resolve({ tenantSlug: 'com-eventos' }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="admin-event-list"');
      expect(html).toContain('Congresso de Tecnologia 2027');
      expect(html).toContain('data-testid="manage-congresso-2027"');
      expect(html).toContain('href="/t/com-eventos/administracao/eventos/11111111-1111-4111-8111-111111111111"');
    });

    it('no estado vazio, preserva o link para o exemplo e oferece link para cadastrar', async () => {
      const pagina = await AdminEventsPage({
        params: Promise.resolve({ tenantSlug: 'vazia' }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="events-empty"');
      expect(html).toContain('data-testid="events-empty-demo-link"');
      expect(html).toContain('href="/t/vazia/exemplo"');
      expect(html).toContain('href="/t/vazia/administracao/eventos/novo"');
    });
  });

  describe('Página dedicada de criação (/t/[tenantSlug]/administracao/eventos/novo)', () => {
    it('renderiza o PageHeader com título, eyebrow de operação e breadcrumbs para eventos', async () => {
      const pagina = await NewAdminEventPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('Cadastrar novo evento');
      expect(html).toContain('Operação');
      expect(html).toContain('href="/t/ufba-demo/administracao/eventos"');
      expect(html).toContain('Voltar para Eventos');
    });

    it('renderiza o formulário create-event com os campos essenciais do domínio', async () => {
      const pagina = await NewAdminEventPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo' }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="create-event"');
      expect(html).toContain('data-field="slug"');
      expect(html).toContain('data-field="title"');
      expect(html).toContain('data-field="startsAt"');
      expect(html).toContain('data-field="endsAt"');
      expect(html).toContain('data-select="modality"');
      expect(html).toContain('data-select="status"');
      expect(html).toContain('data-checkbox="usesCall"');
      expect(html).toContain('data-checkbox="registrationRequiresMembership"');
    });
  });
});


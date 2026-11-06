import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import EventSchedulePage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/programacao/page';
import NewActivityPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/programacao/nova/page';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('../../src/lib/auth/guard-page', () => ({
  requirePagePermission: vi.fn(async ({ tenantSlug }: { tenantSlug: string }) => ({
    tenantId: `tenant-${tenantSlug}`,
    userId: 'user-admin',
  })),
}));

vi.mock('../../src/lib/admin/catalog-service', () => ({
  getAdminEvent: vi.fn(async (tenantId: string, eventId: string) => {
    if (tenantId === 'tenant-vazia') {
      return {
        id: eventId,
        title: 'Evento Sem Atividades',
        startsAt: new Date('2027-05-10T09:00:00Z'),
        endsAt: new Date('2027-05-12T18:00:00Z'),
        registrationCount: 0,
        rooms: [],
        activities: [],
      };
    }

    return {
      id: eventId,
      title: 'Congresso de Tecnologia 2027',
      startsAt: new Date('2027-05-10T09:00:00Z'),
      endsAt: new Date('2027-05-12T18:00:00Z'),
      registrationCount: 15,
      rooms: [
        { id: 'room-1', name: 'Auditório Principal', capacity: 100 },
        { id: 'room-2', name: 'Laboratório A', capacity: null },
      ],
      activities: [
        {
          id: 'act-1',
          slug: 'abertura',
          title: 'Sessão de Abertura',
          type: 'LECTURE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          roomId: 'room-1',
          roomName: 'Auditório Principal',
          roomCapacity: 100,
          onlineUrl: null,
          startsAt: new Date('2027-05-10T09:30:00Z'),
          endsAt: new Date('2027-05-10T11:00:00Z'),
          workloadMinutes: 90,
          capacity: null,
          requiresRegistration: false,
          waitlistEnabled: false,
          isFeatured: true,
          checkInEnabled: true,
          confirmationPolicy: 'AUTO',
          confirmationWindowDays: null,
          confirmationRequirements: [],
          confirmationPlace: null,
          confirmationInstructions: null,
          pendingConfirmations: 0,
          registrationCount: 15,
        },
      ],
    };
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

vi.mock('../../src/components/admin/confirmation-fields', () => ({
  ConfirmationFields: () => createElement('div', { 'data-testid': 'confirmation-fields-stub' }),
}));

vi.mock('../../src/components/admin/inline-action-form', () => ({
  InlineActionForm: (props: { testId?: string; children?: unknown }) =>
    createElement('form', { 'data-testid': props.testId }, props.children as never),
}));

describe('FASE 91 · Separação do cadastro de atividade (/programacao/nova) e cockpit (/programacao)', () => {
  describe('Página de listagem (/t/[tenantSlug]/administracao/eventos/[eventId]/programacao)', () => {
    it('renderiza o botão "Nova atividade" no cabeçalho apontando para /programacao/nova', async () => {
      const pagina = await EventSchedulePage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="btn-nova-atividade"');
      expect(html).toContain(`href="/t/ufba-demo/administracao/eventos/${EVENT_ID}/programacao/nova"`);
      expect(html).toContain('Nova atividade');
    });

    it('NÃO renderiza o formulário create-activity solto no rodapé da listagem', async () => {
      const pagina = await EventSchedulePage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).not.toContain('data-testid="create-activity"');
      expect(html).not.toContain('Criar atividade');
    });

    it('renderiza as atividades existentes em um card branco com formulários de edição in-place preservados', async () => {
      const pagina = await EventSchedulePage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="activity-list"');
      expect(html).toContain('bg-card');
      expect(html).toContain('Sessão de Abertura');
      expect(html).toContain('data-testid="activity-row-act-1"');
      expect(html).toContain('data-testid="edit-activity-act-1"');
      expect(html).toContain('data-testid="activity-form-act-1"');
    });

    it('no estado vazio, apresenta aviso em card limpo com link direto para cadastrar a primeira atividade', async () => {
      const pagina = await EventSchedulePage({
        params: Promise.resolve({ tenantSlug: 'vazia', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="activities-empty"');
      expect(html).toContain('bg-card');
      expect(html).toContain('Nenhuma atividade programada.');
      expect(html).toContain(`href="/t/vazia/administracao/eventos/${EVENT_ID}/programacao/nova"`);
      expect(html).toContain('Cadastrar a primeira atividade');
    });
  });

  describe('Página dedicada de criação (/t/[tenantSlug]/administracao/eventos/[eventId]/programacao/nova)', () => {
    it('renderiza o PageHeader com título, eyebrow de operação e breadcrumbs para a programação', async () => {
      const pagina = await NewActivityPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('Cadastrar nova atividade');
      expect(html).toContain('Operação');
      expect(html).toContain(`href="/t/ufba-demo/administracao/eventos/${EVENT_ID}/programacao"`);
      expect(html).toContain('Voltar para Programação');
    });

    it('renderiza o formulário create-activity dentro de um card com todos os campos de atividade e confirmação', async () => {
      const pagina = await NewActivityPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="create-activity"');
      expect(html).toContain('Dados da atividade');
      expect(html).toContain('rounded-xl border border-border bg-card');
      expect(html).toContain('data-field="slug"');
      expect(html).toContain('data-field="title"');
      expect(html).toContain('data-field="startsAt"');
      expect(html).toContain('data-field="endsAt"');
      expect(html).toContain('data-field="workloadMinutes"');
      expect(html).toContain('data-field="capacity"');
      expect(html).toContain('data-select="type"');
      expect(html).toContain('data-select="status"');
      expect(html).toContain('data-select="modality"');
      expect(html).toContain('data-select="roomId"');
      expect(html).toContain('data-checkbox="requiresRegistration"');
      expect(html).toContain('data-checkbox="waitlistEnabled"');
      expect(html).toContain('data-checkbox="isFeatured"');
      expect(html).toContain('data-checkbox="checkInEnabled"');
      expect(html).toContain('data-testid="confirmation-fields-stub"');
    });
  });
});


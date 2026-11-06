import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import EventRoomsPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/salas/page';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';

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
        title: 'Evento Sem Salas',
        rooms: [],
      };
    }

    return {
      id: eventId,
      title: 'Congresso de Tecnologia 2027',
      rooms: [
        { id: 'room-1', name: 'Auditório Principal', capacity: 150 },
        { id: 'room-2', name: 'Laboratório de Redes', capacity: null },
      ],
    };
  }),
}));

vi.mock('../../src/components/admin/admin-form', () => ({
  AdminForm: (props: { testId?: string; children?: unknown; submitLabel?: string }) =>
    createElement(
      'form',
      { 'data-testid': props.testId },
      props.children as never,
      createElement('button', { type: 'submit', 'data-testid': 'admin-submit' }, props.submitLabel ?? 'Salvar'),
    ),
  Field: (props: { label: string; name: string; defaultValue?: unknown; placeholder?: string }) =>
    createElement('div', { 'data-field': props.name }, props.label),
}));

vi.mock('../../src/components/admin/inline-action-form', () => ({
  InlineActionForm: (props: { testId?: string; children?: unknown; submitLabel?: string }) =>
    createElement(
      'form',
      { 'data-testid': props.testId },
      props.children as never,
      createElement('button', { type: 'submit' }, props.submitLabel ?? 'Excluir'),
    ),
}));

describe('FASE 92 · Padronização em dois cards brancos (bg-card) e cadastro in-page na página de salas', () => {
  describe('Página de salas com itens cadastrados', () => {
    it('renderiza o card branco de listagem de salas com classes padronizadas', async () => {
      const pagina = await EventRoomsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      // Card 1: Lista de salas com fundo branco bg-card, borda, cantos arredondados e sombra suave
      expect(html).toContain('data-testid="room-list"');
      expect(html).toContain('bg-card');
      expect(html).toContain('rounded-xl');
      expect(html).toContain('border-border');
      expect(html).toContain('shadow-sm');

      // Título da seção
      expect(html).toContain('Salas cadastradas (2)');

      // Preservação de linhas e capacidades
      expect(html).toContain('data-testid="room-row-room-1"');
      expect(html).toContain('Auditório Principal');
      expect(html).toContain('150 lugares');

      expect(html).toContain('data-testid="room-row-room-2"');
      expect(html).toContain('Laboratório de Redes');
      expect(html).toContain('sem limite');
    });

    it('renderiza o card branco dedicado para o formulário de cadastro in-page', async () => {
      const pagina = await EventRoomsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      // Card 2: Container de criação com título e fundo branco
      expect(html).toContain('Cadastrar nova sala');
      expect(html).toContain('Adicione os espaços físicos disponíveis no local do evento.');
      expect(html).toContain('data-testid="create-room"');

      // Campos do formulário
      expect(html).toContain('data-field="name"');
      expect(html).toContain('data-field="capacity"');
    });

    it('preserva os controles de edição expansível e exclusão com diálogo', async () => {
      const pagina = await EventRoomsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="edit-room-room-1"');
      expect(html).toContain('data-testid="room-form-room-1"');
      expect(html).toContain('data-testid="delete-room-room-1"');
    });
  });

  describe('Página de salas vazia', () => {
    it('renderiza o empty state dentro de um card branco com o texto contratual exato', async () => {
      const pagina = await EventRoomsPage({
        params: Promise.resolve({ tenantSlug: 'vazia', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      // Contrato de texto exigido pelo E2E (room-lifecycle.spec.ts)
      expect(html).toContain('Nenhuma sala cadastrada.');
      expect(html).toContain('data-testid="rooms-empty"');
      expect(html).toContain('bg-card');
      expect(html).toContain('rounded-xl');
      expect(html).toContain('shadow-sm');

      // O formulário de nova sala segue disponível no segundo card
      expect(html).toContain('data-testid="create-room"');
      expect(html).toContain('Cadastrar nova sala');
    });
  });
});


// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FavoriteButton } from '../../src/components/events/favorite-button';
import { ParticipantSkeleton } from '../../src/components/participants/participant-skeleton';
import { ConfirmationItemsChecklist } from '../../src/components/admin/confirmation-items-checklist';
import { CheckinQueue } from '../../src/components/gamification/checkin-queue';
import { ParticipantDirectory } from '../../src/components/participants/participant-directory';
import { useUnsavedChanges } from '../../src/hooks/use-unsaved-changes';

function render(el: React.ReactElement): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = renderToStaticMarkup(el);
  return div;
}

describe('FASE 103 · UX Operacional, Micro-interações Otimistas e Resiliência', () => {
  describe('ADR-429 · FavoriteButton 100% Otimista no React 19', () => {
    it('renderiza o form com campos de progressive enhancement nativo', () => {
      const dom = render(
        createElement(FavoriteButton, {
          tenantSlug: 'demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          eventSlug: 'conf-2026',
          activityId: '22222222-2222-4222-8222-222222222222',
          activityTitle: 'Palestra de Abertura',
          favorited: false,
          origem: 'PROGRAMACAO',
          variant: 'tema',
        }),
      );

      const form = dom.querySelector('form[data-testid="agenda-form-22222222-2222-4222-8222-222222222222"]');
      expect(form).not.toBeNull();

      const button = dom.querySelector('button[data-testid="agenda-favoritar-22222222-2222-4222-8222-222222222222"]');
      expect(button).not.toBeNull();
      expect(button?.getAttribute('aria-pressed')).toBe('false');
      expect(button?.getAttribute('data-favorited')).toBe('false');
      expect(button?.getAttribute('aria-label')).toBe('Adicionar à minha agenda: Palestra de Abertura');
      expect(button?.textContent).toContain('Adicionar à minha agenda');

      // Campos ocultos obrigatórios para No-JS
      expect(dom.querySelector('input[name="tenantSlug"]')?.getAttribute('value')).toBe('demo');
      expect(dom.querySelector('input[name="eventId"]')?.getAttribute('value')).toBe('11111111-1111-4111-8111-111111111111');
      expect(dom.querySelector('input[name="eventSlug"]')?.getAttribute('value')).toBe('conf-2026');
      expect(dom.querySelector('input[name="activityId"]')?.getAttribute('value')).toBe('22222222-2222-4222-8222-222222222222');
      expect(dom.querySelector('input[name="origem"]')?.getAttribute('value')).toBe('PROGRAMACAO');
      expect(dom.querySelector('input[name="intencao"]')?.getAttribute('value')).toBe('adicionar');
    });

    it('renderiza o estado favoritado com aria-pressed e intenção remover', () => {
      const dom = render(
        createElement(FavoriteButton, {
          tenantSlug: 'demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          eventSlug: 'conf-2026',
          activityId: '22222222-2222-4222-8222-222222222222',
          activityTitle: 'Palestra de Abertura',
          favorited: true,
          origem: 'MINHA_AGENDA',
          variant: 'painel',
        }),
      );

      const button = dom.querySelector('button[data-testid="agenda-favoritar-22222222-2222-4222-8222-222222222222"]');
      expect(button?.getAttribute('aria-pressed')).toBe('true');
      expect(button?.getAttribute('data-favorited')).toBe('true');
      expect(button?.getAttribute('aria-label')).toBe('Remover da minha agenda: Palestra de Abertura');
      expect(button?.textContent).toContain('Remover da minha agenda');
      expect(dom.querySelector('input[name="intencao"]')?.getAttribute('value')).toBe('remover');
    });
  });

  describe('ADR-430 · Streaming e Suspense Granular em /participantes', () => {
    it('renderiza o esqueleto de participantes com atributos de acessibilidade', () => {
      const dom = render(createElement(ParticipantSkeleton));

      const skeleton = dom.querySelector('[data-testid="participant-skeleton"]');
      expect(skeleton).not.toBeNull();
      expect(skeleton?.getAttribute('aria-busy')).toBe('true');
      expect(skeleton?.getAttribute('aria-label')).toBe('Carregando participantes…');
      expect(dom.querySelectorAll('[data-testid^="participant-skeleton-row-"]')).toHaveLength(5);
    });
  });

  describe('ADR-429 · ConfirmationItemsChecklist Otimista', () => {
    it('renderiza checklist de itens com ações individuais', () => {
      const dom = render(
        createElement(ConfirmationItemsChecklist, {
          tenantSlug: 'demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          registrationId: '33333333-3333-4333-8333-333333333333',
          itemsSummary: '0 de 2 itens',
          items: [
            {
              id: 'item-1',
              position: 1,
              label: 'Comprovante de Matrícula',
              required: true,
              status: 'PENDING',
            },
            {
              id: 'item-2',
              position: 2,
              label: '1kg de Alimento',
              required: false,
              status: 'RECEIVED',
            },
          ],
        }),
      );

      const container = dom.querySelector('[data-testid="confirmation-items-33333333-3333-4333-8333-333333333333"]');
      expect(container).not.toBeNull();

      const summary = dom.querySelector('[data-testid="items-summary-33333333-3333-4333-8333-333333333333"]');
      expect(summary?.textContent).toContain('0 de 2 itens');

      const item1 = dom.querySelector('[data-testid="confirmation-item-33333333-3333-4333-8333-333333333333-1"]');
      expect(item1?.getAttribute('data-item-status')).toBe('PENDING');
      expect(item1?.textContent).toContain('Comprovante de Matrícula');

      const item2 = dom.querySelector('[data-testid="confirmation-item-33333333-3333-4333-8333-333333333333-2"]');
      expect(item2?.getAttribute('data-item-status')).toBe('RECEIVED');
      expect(item2?.textContent).toContain('1kg de Alimento');

      // Botões para item pendente
      const receiveForm = dom.querySelector('[data-testid="receive-item-33333333-3333-4333-8333-333333333333-1"]');
      expect(receiveForm).not.toBeNull();
      const waiveForm = dom.querySelector('[data-testid="waive-item-33333333-3333-4333-8333-333333333333-1"]');
      expect(waiveForm).not.toBeNull();
    });
  });

  describe('ADR-431 · Navegação Operacional por Teclado nas Filas', () => {
    it('exibe dica de teclado em CheckinQueue', () => {
      const dom = render(
        createElement(CheckinQueue, {
          entries: [
            {
              registrationId: 'reg-1',
              userName: 'Carlos Silva',
              userEmail: 'carlos@exemplo.com',
              activityTitle: 'Mesa Redonda',
              isInside: false,
              checkedInAtLabel: null,
            },
          ],
          tenantSlug: 'demo',
          checkInAction: vi.fn(),
          checkOutAction: vi.fn(),
        }),
      );

      const hint = dom.querySelector('[data-testid="queue-keyboard-hint"]');
      expect(hint).not.toBeNull();
      expect(hint?.textContent).toContain('navegar linhas');
      expect(hint?.textContent).toContain('Enter');

      const row = dom.querySelector('[data-testid="queue-reg-1"]');
      expect(row).not.toBeNull();
      expect(row?.getAttribute('data-active-row')).toBe('false');
    });

    it('exibe dica de teclado em ParticipantDirectory', () => {
      const dom = render(
        createElement(ParticipantDirectory, {
          entries: [
            {
              userId: 'user-1',
              name: 'Ana Souza',
              emailMasked: 'a***@exemplo.com',
              originLabel: 'Público',
              events: 1,
              confirmed: 1,
              attended: 1,
              visits: 1,
              minutes: 60,
              certificates: 1,
              cards: 0,
              xp: 100,
              rateLabel: '100%',
              ratePercent: 100,
              engagement: ['Engajado'],
              lastActivityLabel: '10/10/2026',
            },
          ],
          tenantSlug: 'demo',
          action: vi.fn(),
          canMessage: true,
          selectedEventId: null,
        }),
      );

      const hint = dom.querySelector('[data-testid="directory-keyboard-hint"]');
      expect(hint).not.toBeNull();
      expect(hint?.textContent).toContain('navegar');
      expect(hint?.textContent).toContain('abrir a ficha');

      const row = dom.querySelector('[data-testid="participant-row-user-1"]');
      expect(row).not.toBeNull();
      expect(row?.getAttribute('data-active-row')).toBe('false');
    });
  });

  describe('ADR-431 · useUnsavedChanges Proteção de Rascunho', () => {
    function DummyEditor({ isDirty }: { isDirty: boolean }) {
      useUnsavedChanges(isDirty);
      return createElement('div', { 'data-testid': 'dummy-editor' }, 'Editor');
    }

    it('registra o hook sem exceções no ciclo de renderização', () => {
      const dom = render(createElement(DummyEditor, { isDirty: true }));
      expect(dom.querySelector('[data-testid="dummy-editor"]')).not.toBeNull();
    });
  });
});

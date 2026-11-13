import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { FavoriteButton } from '@/components/events/favorite-button';
import { ConfirmationItemsChecklist } from '@/components/admin/confirmation-items-checklist';
import { ParticipantDirectory } from '@/components/participants/participant-directory';
import { CheckinQueue } from '@/components/gamification/checkin-queue';
import { ParticipantFilterBar } from '@/components/participants/participant-filter-bar';

// Mocks de navegação e Server Actions
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/t/demo/participantes',
}));

vi.mock('@/app/actions/agenda-actions', () => ({
  toggleFavoriteAction: vi.fn(),
}));

vi.mock('@/app/actions/admin-actions', () => ({
  resolveConfirmationItemAction: vi.fn(),
}));

describe('FASE 104 · Refinamento de UX, Rollback Otimista, Auto-scroll e Resiliência', () => {
  describe('ADR-432 · Feedback de Rollback e Anúncios em Ações Otimistas', () => {
    it('FavoriteButton renderiza região ativa para leitores de tela com aria-live polite', () => {
      const html = renderToStaticMarkup(
        createElement(FavoriteButton, {
          tenantSlug: 'demo',
          eventId: '00000000-0000-0000-0000-000000000001',
          eventSlug: 'evento-1',
          activityId: '00000000-0000-0000-0000-000000000002',
          activityTitle: 'Palestra Magna',
          favorited: false,
          origem: 'PROGRAMACAO',
          variant: 'painel',
        }),
      );

      const dom = new JSDOM(html).window.document;
      const live = dom.querySelector('[data-testid="agenda-live-00000000-0000-0000-0000-000000000002"]');
      expect(live).not.toBeNull();
      expect(live?.getAttribute('aria-live')).toBe('polite');
      // Na FASE 105, a região viva nasce vazia para não gerar ruído em leitores de tela antes da interação
      expect(live?.textContent).toBe('');
    });

    it('ConfirmationItemsChecklist estrutura checklist com aria-live no container e suporte a erros', () => {
      const html = renderToStaticMarkup(
        createElement(ConfirmationItemsChecklist, {
          tenantSlug: 'demo',
          eventId: '00000000-0000-0000-0000-000000000001',
          registrationId: '00000000-0000-0000-0000-000000000003',
          items: [
            {
              id: 'item-1',
              position: 1,
              label: '1kg de alimento',
              required: true,
              status: 'PENDING',
            },
          ],
          itemsSummary: '0 de 1 itens',
        }),
      );

      const dom = new JSDOM(html).window.document;
      const container = dom.querySelector('[data-testid="confirmation-items-00000000-0000-0000-0000-000000000003"]');
      expect(container).not.toBeNull();
      expect(container?.getAttribute('data-pending')).toBe('false');
    });
  });

  describe('ADR-433 · Auto-scroll e Regiões Vivas na Navegação por Teclado', () => {
    it('ParticipantDirectory renderiza live region polite para anúncio de linha ativa', () => {
      const html = renderToStaticMarkup(
        createElement(ParticipantDirectory, {
          entries: [
            {
              userId: 'u1',
              name: 'Participante Um',
              emailMasked: 'p******@example.test',
              originLabel: 'Vínculo',
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
              engagement: ['Assíduo'],
              lastActivityLabel: '10/10/2026',
            },
          ],
          tenantSlug: 'demo',
          action: vi.fn(),
          canMessage: false,
          selectedEventId: null,
        }),
      );

      const dom = new JSDOM(html).window.document;
      const liveRegion = dom.querySelector('[data-testid="directory-live-region"]');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
    });

    it('CheckinQueue renderiza live region polite para anúncio de seleção por teclado', () => {
      const html = renderToStaticMarkup(
        createElement(CheckinQueue, {
          entries: [
            {
              registrationId: 'reg-1',
              userName: 'Convidado Teclado',
              userEmail: 'c******@example.test',
              isInside: false,
              checkedInAtLabel: null,
              activityTitle: 'Mesa 1',
            },
          ],
          tenantSlug: 'demo',
          checkInAction: vi.fn(),
          checkOutAction: vi.fn(),
        }),
      );

      const dom = new JSDOM(html).window.document;
      const liveRegion = dom.querySelector('[data-testid="queue-live-region"]');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
    });
  });

  describe('ADR-434 · Empty States Acionáveis e Botão Rápido de Limpeza de Busca', () => {
    it('ParticipantDirectory vazio renderiza botão de limpar todos os filtros', () => {
      const html = renderToStaticMarkup(
        createElement(ParticipantDirectory, {
          entries: [],
          tenantSlug: 'alpha',
          action: vi.fn(),
          canMessage: false,
          selectedEventId: null,
        }),
      );

      const dom = new JSDOM(html).window.document;
      const empty = dom.querySelector('[data-testid="directory-empty"]');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain('Nenhum participante encontrado');

      const clearLink = dom.querySelector('[data-testid="directory-clear-filters"]');
      expect(clearLink).not.toBeNull();
      expect(clearLink?.getAttribute('href')).toBe('/t/alpha/participantes');
    });

    it('ParticipantFilterBar com busca renderiza botão de limpar campo com ícone X', () => {
      const html = renderToStaticMarkup(
        createElement(ParticipantFilterBar, {
          tenantSlug: 'alpha',
          events: [],
          initialBusca: 'Mariana',
        }),
      );

      const dom = new JSDOM(html).window.document;
      const clearBtn = dom.querySelector('[data-testid="participant-search-clear"]');
      expect(clearBtn).not.toBeNull();
      expect(clearBtn?.getAttribute('aria-label')).toBe('Limpar campo de busca');
    });

    it('ParticipantFilterBar sem busca NÃO renderiza botão de limpar campo', () => {
      const html = renderToStaticMarkup(
        createElement(ParticipantFilterBar, {
          tenantSlug: 'alpha',
          events: [],
          initialBusca: '',
        }),
      );

      const dom = new JSDOM(html).window.document;
      const clearBtn = dom.querySelector('[data-testid="participant-search-clear"]');
      expect(clearBtn).toBeNull();
    });
  });
});


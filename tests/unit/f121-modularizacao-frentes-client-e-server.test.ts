import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { FaqBlockFields } from '@/components/admin/block-fields/faq-block-fields';
import { GalleryBlockFields } from '@/components/admin/block-fields/gallery-block-fields';
import { ActivityRegistrationSidebar } from '@/components/events/activity-registration-sidebar';
import { RaffleWinnerItem } from '@/components/raffles/raffle-winner-item';

const ROOT = process.cwd();

function measureFileMetrics(relPath: string): { lines: number; maxJsxDepth: number } {
  const fullPath = join(ROOT, relPath);
  const content = readFileSync(fullPath, 'utf8');
  const lines = content.split(/\r?\n/).length;
  const sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  let maxJsxDepth = 0;

  function visit(node: ts.Node, depth: number) {
    let nextDepth = depth;
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      nextDepth = depth + 1;
      if (nextDepth > maxJsxDepth) maxJsxDepth = nextDepth;
    } else if (ts.isJsxSelfClosingElement(node)) {
      if (depth + 1 > maxJsxDepth) maxJsxDepth = depth + 1;
    }
    ts.forEachChild(node, (child) => visit(child, nextDepth));
  }

  visit(sf, 0);
  return { lines, maxJsxDepth };
}

describe('FASE 121 — Contratos SSR dos subcomponentes de bloco, sorteio e atividade', () => {
  it('FaqBlockFields renderiza linhas iniciais, inputs nomeados e controla botão de remoção quando há >1 item', () => {
    const singleDom = new JSDOM(
      renderToStaticMarkup(
        createElement(FaqBlockFields, {
          initialFaq: [{ question: 'Qual o local?', answer: 'Auditório principal.' }],
        }),
      ),
    ).window.document;

    expect(singleDom.querySelectorAll('input[name="faqQuestion"]')).toHaveLength(1);
    expect(singleDom.querySelectorAll('textarea[name="faqAnswer"]')).toHaveLength(1);
    expect(singleDom.querySelector('button[aria-label^="Remover pergunta"]')).toBeNull();
    expect(singleDom.querySelector('[data-testid="add-faq-row"]')).not.toBeNull();

    const multiDom = new JSDOM(
      renderToStaticMarkup(
        createElement(FaqBlockFields, {
          initialFaq: [
            { question: 'P1', answer: 'R1' },
            { question: 'P2', answer: 'R2' },
          ],
        }),
      ),
    ).window.document;
    expect(multiDom.querySelectorAll('button[aria-label^="Remover pergunta"]')).toHaveLength(2);
  });

  it('GalleryBlockFields expõe input de arquivo, biblioteca de mídia e campos da galeria no SSR', () => {
    const dummyAction = async () => ({ ok: true as const, message: 'ok' });
    const dom = new JSDOM(
      renderToStaticMarkup(
        createElement(GalleryBlockFields, {
          initialGallery: [{ url: 'https://cdn.example/foto.webp', caption: 'Palco' }],
          libraryOptions: [{ value: 'https://cdn.example/acervo.webp', label: 'Acervo 1' }],
          uploadContext: {
            tenantSlug: 'ufba-demo',
            eventId: '11111111-1111-4111-8111-111111111111',
            requestUploadAction: dummyAction,
            confirmUploadAction: dummyAction,
          },
        }),
      ),
    ).window.document;

    expect(dom.querySelector('[data-testid="gallery-file-input"]')).not.toBeNull();
    expect(dom.querySelector('input[name="galleryUrl"]')?.getAttribute('value')).toBe(
      'https://cdn.example/foto.webp',
    );
    expect(dom.querySelector('input[name="galleryCaption"]')?.getAttribute('value')).toBe('Palco');
    expect(dom.querySelector('select option[value="https://cdn.example/acervo.webp"]')?.textContent).toBe(
      'Acervo 1',
    );
    expect(dom.querySelector('[data-testid="add-gallery-row"]')).not.toBeNull();
  });

  it('RaffleWinnerItem renderiza data-attributes e distingue ganhador pendente vs entregue', () => {
    const noopForm = () => {};
    const pendingDom = new JSDOM(
      renderToStaticMarkup(
        createElement(RaffleWinnerItem, {
          winner: {
            id: 'pos-1',
            position: 1,
            roundNumber: 1,
            userId: 'usr-1',
            userName: 'Marina Silva',
            minutes: 90,
            kind: 'WINNER',
            deliveredAtLabel: null,
            deliveredByName: null,
            deliveryNote: null,
          },
          raffleId: 'raf-1',
          raffleStatus: 'DRAWN',
          tenantSlug: 'ufba-demo',
          eventId: 'evt-1',
          roundPrizeLabel: 'Livro Técnico',
          showRoundBadge: true,
          deliverFormAction: noopForm,
          reverseFormAction: noopForm,
        }),
      ),
    ).window.document;

    const pendingItem = pendingDom.querySelector('[data-testid="position-pos-1"]');
    expect(pendingItem?.getAttribute('data-kind')).toBe('WINNER');
    expect(pendingItem?.getAttribute('data-round')).toBe('1');
    expect(pendingItem?.getAttribute('data-delivered')).toBe('false');
    expect(pendingDom.querySelector('[data-testid="round-badge-pos-1"]')?.textContent).toBe('Livro Técnico');
    expect(pendingDom.querySelector('[data-testid="deliver-pos-1"]')).not.toBeNull();

    const deliveredDom = new JSDOM(
      renderToStaticMarkup(
        createElement(RaffleWinnerItem, {
          winner: {
            id: 'pos-2',
            position: 2,
            roundNumber: 1,
            userId: 'usr-2',
            userName: 'Carlos Souza',
            minutes: 60,
            kind: 'ALTERNATE',
            deliveredAtLabel: '23/11 10:00',
            deliveredByName: 'Coordenação',
            deliveryNote: 'Balcão A',
          },
          raffleId: 'raf-1',
          raffleStatus: 'DRAWN',
          tenantSlug: 'ufba-demo',
          eventId: 'evt-1',
          roundPrizeLabel: null,
          showRoundBadge: false,
          deliverFormAction: noopForm,
          reverseFormAction: noopForm,
        }),
      ),
    ).window.document;

    const deliveredItem = deliveredDom.querySelector('[data-testid="position-pos-2"]');
    expect(deliveredItem?.getAttribute('data-delivered')).toBe('true');
    expect(deliveredDom.querySelector('[data-testid="delivered-pos-2"]')?.textContent).toContain(
      'entregue 23/11 10:00',
    );
    expect(deliveredDom.querySelector('[data-testid="reverse-delivery-pos-2"]')).not.toBeNull();
  });

  it('ActivityRegistrationSidebar cobre atividade aberta sem inscrição e bloqueio por janela fechada', () => {
    const openDom = new JSDOM(
      renderToStaticMarkup(
        createElement(ActivityRegistrationSidebar, {
          tenantSlug: 'ufba-demo',
          tenantName: 'UFBA Demo',
          eventSlug: 'congresso',
          activitySlug: 'abertura',
          requiresRegistration: false,
          remainingSeats: null,
          waitlistEnabled: false,
          activityStatus: 'PUBLISHED',
          activityClosed: false,
          windowOpen: true,
          windowMessage: null,
          isFull: false,
          isAuthenticated: false,
          membershipStatus: null,
          requiresMembership: false,
          canRegister: false,
          alreadyRegistered: null,
          myRegistrationId: null,
          loginHref: '/login',
        }),
      ),
    ).window.document;

    expect(openDom.querySelector('[data-testid="activity-open-notice"]')).not.toBeNull();
    expect(
      openDom.querySelector('[data-testid="activity-event-registration-link"]')?.getAttribute('href'),
    ).toBe('/t/ufba-demo/eventos/congresso/inscricao');

    const closedWindowDom = new JSDOM(
      renderToStaticMarkup(
        createElement(ActivityRegistrationSidebar, {
          tenantSlug: 'ufba-demo',
          tenantName: 'UFBA Demo',
          eventSlug: 'congresso',
          activitySlug: 'oficina',
          requiresRegistration: true,
          remainingSeats: 5,
          waitlistEnabled: false,
          activityStatus: 'PUBLISHED',
          activityClosed: false,
          windowOpen: false,
          windowMessage: 'Inscrições abrem amanhã.',
          isFull: false,
          isAuthenticated: false,
          membershipStatus: null,
          requiresMembership: false,
          canRegister: false,
          alreadyRegistered: null,
          myRegistrationId: null,
          loginHref: '/login',
        }),
      ),
    ).window.document;

    expect(closedWindowDom.body.textContent).toContain('Inscrições indisponíveis');
    expect(closedWindowDom.body.textContent).toContain('Inscrições abrem amanhã.');
  });
});

describe('FASE 121 — Catraca AST das Frentes A (Client) e B (Server Pages & God Modules) (ADR-485 … 488)', () => {
  it('os 7 alvos refatorados respeitam os novos tetos de linhas e profundidade JSX', () => {
    const targets: { path: string; maxLines: number; maxDepth: number }[] = [
      { path: 'src/components/raffles/raffle-history.tsx', maxLines: 200, maxDepth: 5 },
      { path: 'src/components/credentials/self-checkin-manager.tsx', maxLines: 170, maxDepth: 6 },
      { path: 'src/components/admin/block-content-fields.tsx', maxLines: 85, maxDepth: 4 },
      { path: 'src/components/events/block-renderer.tsx', maxLines: 125, maxDepth: 2 },
      {
        path: 'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/atividades/[activitySlug]/page.tsx',
        maxLines: 230,
        maxDepth: 6,
      },
      {
        path: 'src/app/t/[tenantSlug]/(app)/administracao/comunicacao/page.tsx',
        maxLines: 150,
        maxDepth: 4,
      },
      {
        path: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/demandas/page.tsx',
        maxLines: 350,
        maxDepth: 6,
      },
    ];

    for (const target of targets) {
      const metrics = measureFileMetrics(target.path);
      expect(metrics.lines, `${target.path} excedeu ${target.maxLines} linhas`).toBeLessThanOrEqual(
        target.maxLines,
      );
      expect(
        metrics.maxJsxDepth,
        `${target.path} excedeu jsxDepth ${target.maxDepth}`,
      ).toBeLessThanOrEqual(target.maxDepth);
    }
  });

  it('todos os 26 submódulos extraídos na FASE 121 mantêm tamanho enxuto (<= 520 linhas)', () => {
    const submodules = [
      'src/components/raffles/raffle-history-types.ts',
      'src/components/raffles/raffle-rounds-section.tsx',
      'src/components/raffles/raffle-winner-item.tsx',
      'src/components/raffles/raffle-row.tsx',
      'src/components/credentials/self-checkin-policy-form.tsx',
      'src/components/credentials/self-checkin-point-row.tsx',
      'src/components/admin/block-fields/block-field-shell.tsx',
      'src/components/admin/block-fields/faq-block-fields.tsx',
      'src/components/admin/block-fields/gallery-block-fields.tsx',
      'src/components/admin/block-fields/simple-block-fields.tsx',
      'src/components/events/block-content-renderers.tsx',
      'src/components/events/block-activities-section.tsx',
      'src/components/events/block-sponsors-section.tsx',
      'src/components/events/block-calls-section.tsx',
      'src/components/events/block-community-sections.tsx',
      'src/components/events/activity-detail-sections.tsx',
      'src/components/events/activity-registration-sidebar.tsx',
      'src/components/communication/outbox-panel.tsx',
      'src/components/communication/segment-condition-fields.tsx',
      'src/components/communication/campaign-history-panel.tsx',
      'src/components/communication/segments-panel.tsx',
      'src/components/demands/demands-summary-section.tsx',
      'src/components/demands/demands-create-details.tsx',
      'src/components/demands/demands-kanban-board.tsx',
      'src/components/demands/demands-timeline-views.tsx',
      'src/components/demands/demands-columns-config.tsx',
    ];

    for (const relPath of submodules) {
      const { lines } = measureFileMetrics(relPath);
      expect(lines, `${relPath} passou de 520 linhas (${lines})`).toBeLessThanOrEqual(520);
    }
  });

  it('as fachadas originais continuam exportando seus contratos públicos', async () => {
    const raffleHistoryMod = await import('@/components/raffles/raffle-history');
    expect(typeof raffleHistoryMod.RaffleHistory).toBe('function');

    const selfCheckinMod = await import('@/components/credentials/self-checkin-manager');
    expect(typeof selfCheckinMod.SelfCheckinManager).toBe('function');

    const blockFieldsMod = await import('@/components/admin/block-content-fields');
    expect(typeof blockFieldsMod.BlockContentFields).toBe('function');

    const blockRendererMod = await import('@/components/events/block-renderer');
    expect(typeof blockRendererMod.BlockRenderer).toBe('function');
  });
});

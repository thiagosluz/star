import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import EventCallsPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page';
import EventNewCallPage from '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/nova/page';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const CALL_ID = '22222222-2222-4222-8222-222222222222';

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
      tracks: [
        { id: 'track-1', name: 'Inteligência Artificial' },
        { id: 'track-2', name: 'Engenharia de Software' },
      ],
      rooms: [],
      activities: [],
    };
  }),
}));

vi.mock('../../src/lib/review/rubric-guard', () => ({
  rubricReviewCounts: vi.fn(async () => ({
    byTrack: new Map(),
    byCall: new Map(),
  })),
}));

vi.mock('../../src/lib/proposals/call-service', () => ({
  listCalls: vi.fn(async ({ tenantId }: { tenantId: string }) => {
    if (tenantId === 'tenant-vazia') {
      return { ok: true, calls: [] };
    }

    return {
      ok: true,
      calls: [
        {
          id: CALL_ID,
          eventId: EVENT_ID,
          title: 'Chamada de Palestrantes 2027',
          slug: 'palestrantes-2027',
          description: 'Envie sua proposta de palestra para o congresso.',
          kind: 'SPEAKER',
          trackId: null,
          trackName: null,
          blindReview: null,
          effectiveBlindReview: false,
          opensAt: new Date('2027-01-01T00:00:00Z'),
          closesAt: new Date('2027-04-01T23:59:59Z'),
          maxProposalsPerAuthor: 2,
          isPublished: true,
          rubric: {
            criteria: [
              { id: 'crit-1', label: 'Relevância técnica', weight: 2, maxScore: 10 },
            ],
          },
          proposals: 1,
          drafts: 0,
          state: 'OPEN',
        },
      ],
    };
  }),
  listCallProposals: vi.fn(async () => ({
    ok: true,
    proposals: [
      {
        id: 'prop-1',
        title: 'Como arquitetar microsserviços modernos',
        authorName: 'Ana Silva',
        authorEmail: 'ana@exemplo.com',
        status: 'SUBMITTED',
        submittedAt: new Date('2027-02-15T14:30:00Z'),
        reviewsCount: 0,
        finalScore: null,
        data: [],
      },
    ],
  })),
}));

vi.mock('../../src/lib/proposals/call-result-service', () => ({
  getCallResultPanel: vi.fn(async () => ({
    ok: true,
    panel: {
      resultado: 'SEM_RESULTADO',
      publicadoEm: null,
      acoesDisponiveis: [],
      seletor: {
        totalSubmissoes: 0,
        selecionadas: 0,
        trilhas: [],
      },
    },
  })),
}));

vi.mock('../../src/components/admin/admin-form', () => ({
  AdminForm: (props: { testId?: string; children?: unknown }) =>
    createElement('form', { 'data-testid': props.testId }, props.children as never),
  Field: (props: { label: string; name: string }) =>
    createElement('div', { 'data-field': props.name }, props.label),
  SelectField: (props: { label: string; name: string }) =>
    createElement('div', { 'data-select': props.name }, props.label),
}));

vi.mock('../../src/components/admin/rubric-editor', () => ({
  RubricEditor: () => createElement('div', { 'data-testid': 'rubric-editor-stub' }),
}));

vi.mock('../../src/components/admin/inline-action-form', () => ({
  InlineActionForm: (props: { testId?: string; children?: unknown }) =>
    createElement('form', { 'data-testid': props.testId }, props.children as never),
}));

vi.mock('../../src/components/admin/track-section', () => ({
  TrackSection: () => createElement('div', { 'data-testid': 'track-section-stub' }),
}));

vi.mock('../../src/components/proposals/call-result-card', () => ({
  CallResultCard: () => createElement('div', { 'data-testid': 'call-result-stub' }),
}));

describe('FASE 93 · Separação do cadastro de chamada (/chamadas/nova) e cockpit (/chamadas)', () => {
  describe('Página de listagem e cockpit (/t/[tenantSlug]/administracao/eventos/[eventId]/chamadas)', () => {
    it('renderiza o botão primário "Nova chamada" no cabeçalho apontando para /chamadas/nova', async () => {
      const pagina = await EventCallsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="btn-nova-chamada"');
      expect(html).toContain('/administracao/eventos/' + EVENT_ID + '/chamadas/nova');
      expect(html).toContain('Nova chamada');
    });

    it('não renderiza mais o formulário aninhado de criação no topo da listagem', async () => {
      const pagina = await EventCallsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      // O formulário de criação "create-call" e seu container "create-call-section" saíram desta página
      expect(html).not.toContain('data-testid="create-call-section"');
      expect(html).not.toContain('data-testid="create-call"');
    });

    it('renderiza os cards de chamadas com estilo destacado em card branco', async () => {
      const pagina = await EventCallsPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain(`data-testid="call-row-${CALL_ID}"`);
      expect(html).toContain('bg-card');
      expect(html).toContain('rounded-xl border border-border');
      expect(html).toContain('Chamada de Palestrantes 2027');
    });

    it('renderiza estado vazio com link direto para /chamadas/nova quando não há chamadas', async () => {
      const pagina = await EventCallsPage({
        params: Promise.resolve({ tenantSlug: 'vazia', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="calls-empty"');
      expect(html).toContain('Nenhuma chamada criada');
      expect(html).toContain('Criar primeira chamada');
      expect(html).toContain('/administracao/eventos/' + EVENT_ID + '/chamadas/nova');
    });
  });

  describe('Página de cadastro dedicado (/t/[tenantSlug]/administracao/eventos/[eventId]/chamadas/nova)', () => {
    it('renderiza PageHeader semântico com breadcrumbs de retorno e eyebrow de operação', async () => {
      const pagina = await EventNewCallPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('Nova chamada de propostas');
      expect(html).toContain('Voltar para Chamadas de propostas');
      expect(html).toContain('/administracao/eventos/' + EVENT_ID + '/chamadas');
    });

    it('renderiza o formulário create-call com todos os campos e editor de rubrica', async () => {
      const pagina = await EventNewCallPage({
        params: Promise.resolve({ tenantSlug: 'ufba-demo', eventId: EVENT_ID }),
      });
      const html = renderToStaticMarkup(pagina);

      expect(html).toContain('data-testid="create-call-section"');
      expect(html).toContain('data-testid="create-call"');
      expect(html).toContain('data-field="title"');
      expect(html).toContain('data-field="slug"');
      expect(html).toContain('data-field="summary"');
      expect(html).toContain('data-field="instructions"');
      expect(html).toContain('data-select="kind"');
      expect(html).toContain('data-select="trackId"');
      expect(html).toContain('data-select="requiresBlindReview"');
      expect(html).toContain('data-field="opensAt"');
      expect(html).toContain('data-field="closesAt"');
      expect(html).toContain('data-field="maxSubmissionsPerAuthor"');
      expect(html).toContain('data-testid="rubric-editor-stub"');
    });
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { FinanceChartsPanel } from '@/components/finance/finance-charts-panel';
import { buildFinanceExportHref, FinanceKpiCards } from '@/components/finance/finance-kpi-cards';
import { FinancialEntriesLedger } from '@/components/finance/financial-entries-ledger';
import {
  buildEventFinanceHref,
  computeEventFinanceSummary,
  paginateFinancialEntries,
  parseFinancePage,
  resolveFinanceTab,
  type FinancialEntryRuleInput,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';
import { filterFinancialEntries } from '@/lib/finance/event-finance-service';

const SOURCES: FundingSourceRuleInput[] = [
  {
    id: 'src-fapeg',
    name: 'Edital FAPEG 04/2026',
    kind: 'PUBLIC_GRANT',
    codeOrProcess: 'SEI 01',
    approvedCents: 1_000_000,
    restrictedCategories: ['TRAVEL_AND_PER_DIEM'],
    sponsorId: null,
    notes: null,
  },
  {
    id: 'src-pat',
    name: 'Patrocínio Livre',
    kind: 'SPONSORSHIP',
    codeOrProcess: null,
    approvedCents: 500_000,
    restrictedCategories: [],
    sponsorId: null,
    notes: null,
  },
];

const ENTRIES: FinancialEntryRuleInput[] = [
  {
    id: 'e-glosa',
    sourceId: 'src-fapeg',
    type: 'EXPENSE',
    status: 'SETTLED',
    category: 'CATERING',
    title: 'Coffee-break em fonte restrita',
    amountCents: 100_000,
    occurredOn: '2026-11-01',
    settledOn: '2026-11-01',
    counterpartyName: 'Buffet',
    counterpartyTaxId: null,
    documentNumber: 'NF-10',
    notes: null,
  },
  {
    id: 'e-nodoc',
    sourceId: 'src-pat',
    type: 'EXPENSE',
    status: 'SETTLED',
    category: 'CATERING',
    title: 'Pago sem nota fiscal',
    amountCents: 50_000,
    occurredOn: '2026-11-02',
    settledOn: '2026-11-02',
    counterpartyName: 'Padaria',
    counterpartyTaxId: null,
    documentNumber: null,
    notes: null,
  },
  {
    id: 'e-unassigned',
    sourceId: null,
    type: 'EXPENSE',
    status: 'PLANNED',
    category: 'OTHER',
    title: 'Despesa sem fonte',
    amountCents: 20_000,
    occurredOn: '2026-11-03',
    settledOn: null,
    counterpartyName: null,
    counterpartyTaxId: null,
    documentNumber: null,
    notes: null,
  },
];

describe('FASE 124 — Abas por intenção, filtro de conformidade e paginação do livro-razão', () => {
  it('resolveFinanceTab abre lancamentos quando há filtro ativo e buildEventFinanceHref preserva parâmetros', () => {
    expect(resolveFinanceTab(undefined, false)).toBe('resumo');
    expect(resolveFinanceTab(undefined, true)).toBe('lancamentos');
    expect(resolveFinanceTab('fontes', true)).toBe('fontes');
    expect(resolveFinanceTab('invalida', false)).toBe('resumo');

    const base = '/t/ufba-demo/administracao/eventos/11111111-1111-4111-8111-111111111111/financeiro';
    expect(buildEventFinanceHref(base, { aba: 'resumo' })).toBe(base);
    expect(
      buildEventFinanceHref(base, {
        aba: 'lancamentos',
        conformidade: 'GLOSA',
        pagina: 2,
      }),
    ).toBe(`${base}?aba=lancamentos&conformidade=GLOSA&pagina=2`);
  });

  it('paginateFinancialEntries e parseFinancePage recortam páginas com segurança', () => {
    expect(parseFinancePage(undefined)).toBe(1);
    expect(parseFinancePage('-3')).toBe(1);
    expect(parseFinancePage('3')).toBe(3);

    const items = Array.from({ length: 25 }, (_, i) => i + 1);
    const p1 = paginateFinancialEntries(items, 1, 20);
    const p2 = paginateFinancialEntries(items, 2, 20);
    const pOverflow = paginateFinancialEntries(items, 99, 20);

    expect(p1.items).toHaveLength(20);
    expect(p1.hasPrev).toBe(false);
    expect(p1.hasNext).toBe(true);
    expect(p2.items).toEqual([21, 22, 23, 24, 25]);
    expect(p2.hasPrev).toBe(true);
    expect(p2.hasNext).toBe(false);
    expect(pOverflow.currentPage).toBe(2);
  });

  it('filterFinancialEntries e complianceCounts isolam GLOSA, MISSING_DOCUMENT e UNASSIGNED_SOURCE', () => {
    const summary = computeEventFinanceSummary({ sources: SOURCES, entries: ENTRIES });
    expect(summary.complianceCounts).toEqual({
      glosaEntriesCount: 1,
      missingDocumentSettledCount: 1,
      unassignedExpenseEntriesCount: 1,
    });

    expect(
      filterFinancialEntries(ENTRIES, { compliance: 'GLOSA' }, SOURCES).map((e) => e.id),
    ).toEqual(['e-glosa']);
    expect(
      filterFinancialEntries(ENTRIES, { compliance: 'MISSING_DOCUMENT' }, SOURCES).map((e) => e.id),
    ).toEqual(['e-nodoc']);
    expect(
      filterFinancialEntries(ENTRIES, { compliance: 'UNASSIGNED_SOURCE' }, SOURCES).map((e) => e.id),
    ).toEqual(['e-unassigned']);
  });
});

describe('FASE 124 — Contratos SSR: Checklist de conformidade, Exportação colada ao filtro e Lei de Hick na linha', () => {
  it('renderiza checklist clicável, exportação colada em FinanceLedgerFilters e menu Mais + Editar no livro-razão', () => {
    const summary = computeEventFinanceSummary({ sources: SOURCES, entries: ENTRIES });
    const baseHref =
      '/t/ufba-demo/administracao/eventos/11111111-1111-4111-8111-111111111111/financeiro';

    const kpiDom = new JSDOM(
      renderToStaticMarkup(
        createElement(FinanceKpiCards, {
          tenantSlug: 'ufba-demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          sourcesCount: SOURCES.length,
          summary,
          filters: {},
          baseHref,
        }),
      ),
    ).window.document;

    expect(
      kpiDom.querySelector('[data-testid="finance-compliance-link-GLOSA"]')?.getAttribute('href'),
    ).toBe(`${baseHref}?aba=lancamentos&conformidade=GLOSA`);

    const chartsDom = new JSDOM(
      renderToStaticMarkup(createElement(FinanceChartsPanel, { summary, baseHref })),
    ).window.document;
    expect(
      chartsDom
        .querySelector('[data-testid="finance-chart-filter-source-src-fapeg"]')
        ?.getAttribute('href'),
    ).toBe(`${baseHref}?aba=lancamentos&fonte=src-fapeg`);

    expect(
      buildFinanceExportHref('ufba-demo', '11111111-1111-4111-8111-111111111111', 'lancamentos', {
        compliance: 'GLOSA',
      }),
    ).toContain('conformidade=GLOSA');

    const ledgerDom = new JSDOM(
      renderToStaticMarkup(
        createElement(FinancialEntriesLedger, {
          tenantSlug: 'ufba-demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          entries: ENTRIES,
          sources: SOURCES,
          baseHref,
        }),
      ),
    ).window.document;

    expect(
      ledgerDom.querySelector('[data-testid="finance-entry-edit-e-glosa"]')?.getAttribute('href'),
    ).toBe(`${baseHref}/lancamentos/e-glosa/editar`);
    expect(ledgerDom.querySelector('[data-testid="finance-entry-more-e-glosa"]')).not.toBeNull();
  });
});

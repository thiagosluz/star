import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { FinanceChartsPanel } from '@/components/finance/finance-charts-panel';
import { FinanceKpiCards } from '@/components/finance/finance-kpi-cards';
import { FinancialEntriesLedger } from '@/components/finance/financial-entries-ledger';
import {
  categoriesForEntryType,
  computeEventFinanceSummary,
  computeFilteredLedgerTotals,
  evaluateEntryCompliance,
  FINANCIAL_CATEGORIES,
  formatIsoDatePtBr,
  isEntryCategoryViolation,
  type FinancialEntryRuleInput,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';

const SOURCE_FAPEG: FundingSourceRuleInput = {
  id: 'src-fapeg',
  name: 'Edital FAPEG 04/2026',
  kind: 'PUBLIC_GRANT',
  codeOrProcess: 'SEI 23070.012345/2026-99',
  approvedCents: 1_000_000, // R$ 10.000,00
  restrictedCategories: ['TRAVEL_AND_PER_DIEM'],
  sponsorId: null,
  notes: null,
};

const ENTRIES: FinancialEntryRuleInput[] = [
  {
    id: 'ent-inc',
    sourceId: 'src-fapeg',
    type: 'INCOME',
    status: 'SETTLED',
    category: 'GRANT_DISBURSEMENT',
    title: 'Repasse FAPEG',
    amountCents: 1_000_000,
    occurredOn: '2026-10-05',
    settledOn: '2026-10-06',
    counterpartyName: 'FAPEG',
    counterpartyTaxId: null,
    documentNumber: 'OB-101',
    notes: null,
  },
  {
    id: 'ent-plan',
    sourceId: 'src-fapeg',
    type: 'EXPENSE',
    status: 'PLANNED',
    category: 'CATERING',
    title: 'Coffee-break previsto',
    amountCents: 300_000,
    occurredOn: '2026-11-10',
    settledOn: null,
    counterpartyName: 'Buffet',
    counterpartyTaxId: null,
    documentNumber: null,
    notes: null,
  },
  {
    id: 'ent-canc',
    sourceId: 'src-fapeg',
    type: 'EXPENSE',
    status: 'CANCELED',
    category: 'TRAVEL_AND_PER_DIEM',
    title: 'Passagem cancelada',
    amountCents: 500_000,
    occurredOn: '2026-11-11',
    settledOn: null,
    counterpartyName: null,
    counterpartyTaxId: null,
    documentNumber: null,
    notes: null,
  },
];

describe('FASE 123 — Domínio de UX financeiro: prevenção de glosa, datas PT-BR e subtotais', () => {
  it('formatIsoDatePtBr e categoriesForEntryType formatam datas sem fuso e priorizam rubricas por tipo', () => {
    expect(formatIsoDatePtBr('2026-11-24')).toBe('24/11/2026');
    expect(formatIsoDatePtBr('')).toBe('—');
    expect(formatIsoDatePtBr(null)).toBe('—');

    const incomeCats = categoriesForEntryType('INCOME');
    const expenseCats = categoriesForEntryType('EXPENSE');

    expect(incomeCats[0]).toBe('GRANT_DISBURSEMENT');
    expect(expenseCats[0]).toBe('TRAVEL_AND_PER_DIEM');
    expect(new Set(incomeCats).size).toBe(FINANCIAL_CATEGORIES.length);
    expect(new Set(expenseCats).size).toBe(FINANCIAL_CATEGORIES.length);
  });

  it('isEntryCategoryViolation e evaluateEntryCompliance detectam glosa de rubrica e estouro de teto antes do envio', () => {
    expect(isEntryCategoryViolation(ENTRIES[1]!, SOURCE_FAPEG)).toBe(true);
    expect(isEntryCategoryViolation(ENTRIES[0]!, SOURCE_FAPEG)).toBe(false);
    expect(isEntryCategoryViolation(ENTRIES[2]!, SOURCE_FAPEG)).toBe(false); // CANCELED não gera glosa

    const previewGlosa = evaluateEntryCompliance({
      type: 'EXPENSE',
      category: 'CATERING',
      amountCents: 400_000,
      source: {
        ...SOURCE_FAPEG,
        remainingApprovedCents: 700_000,
      },
    });
    expect(previewGlosa.isCategoryRestrictedViolation).toBe(true);
    expect(previewGlosa.isOverSourceRemainingBudget).toBe(false);
    expect(previewGlosa.projectedRemainingCents).toBe(300_000);
    expect(previewGlosa.warnings[0]).toContain('risco de glosa');

    const previewOverBudget = evaluateEntryCompliance({
      type: 'EXPENSE',
      category: 'TRAVEL_AND_PER_DIEM',
      amountCents: 900_000,
      source: {
        ...SOURCE_FAPEG,
        remainingApprovedCents: 700_000,
      },
    });
    expect(previewOverBudget.isCategoryRestrictedViolation).toBe(false);
    expect(previewOverBudget.isOverSourceRemainingBudget).toBe(true);
    expect(previewOverBudget.projectedRemainingCents).toBe(-200_000);
    expect(previewOverBudget.warnings[0]).toContain('excede o saldo disponível do teto');
  });

  it('computeFilteredLedgerTotals soma entradas, saídas e saldo do recorte ignorando cancelados', () => {
    const totals = computeFilteredLedgerTotals(ENTRIES);
    expect(totals.totalCount).toBe(3);
    expect(totals.activeCount).toBe(2);
    expect(totals.canceledCount).toBe(1);
    expect(totals.activeIncomeCents).toBe(1_000_000);
    expect(totals.activeExpenseCents).toBe(300_000);
    expect(totals.netActiveCents).toBe(700_000);
    expect(totals.netSettledCents).toBe(1_000_000);
  });
});

describe('FASE 123 — Contratos SSR de onboarding, drill-down nos gráficos e ciclo no livro-razão', () => {
  it('renderiza guia de onboarding quando vazio, escopo de exportação, links de drill-down e ações Empenhar/Liquidar com NF/Cancelar', () => {
    const emptySummary = computeEventFinanceSummary({ sources: [], entries: [] });
    const emptyKpiDom = new JSDOM(
      renderToStaticMarkup(
        createElement(FinanceKpiCards, {
          tenantSlug: 'ufba-demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          sourcesCount: 0,
          summary: emptySummary,
          filters: {},
        }),
      ),
    ).window.document;

    expect(emptyKpiDom.querySelector('[data-testid="finance-onboarding-guide"]')).not.toBeNull();
    expect(
      emptyKpiDom.querySelector('[data-testid="finance-export-scope"]')?.textContent,
    ).toBe('Exportando todos os lançamentos');

    const summary = computeEventFinanceSummary({
      sources: [SOURCE_FAPEG],
      entries: ENTRIES,
    });
    const baseHref = '/t/ufba-demo/administracao/eventos/11111111-1111-4111-8111-111111111111/financeiro';

    const chartsDom = new JSDOM(
      renderToStaticMarkup(createElement(FinanceChartsPanel, { summary, baseHref })),
    ).window.document;

    expect(
      chartsDom
        .querySelector('[data-testid="finance-chart-filter-source-src-fapeg"]')
        ?.getAttribute('href'),
    ).toBe(`${baseHref}?aba=lancamentos&fonte=src-fapeg`);
    expect(
      chartsDom
        .querySelector('[data-testid="finance-chart-filter-category-CATERING"]')
        ?.getAttribute('href'),
    ).toBe(`${baseHref}?aba=lancamentos&categoria=CATERING`);

    const ledgerDom = new JSDOM(
      renderToStaticMarkup(
        createElement(FinancialEntriesLedger, {
          tenantSlug: 'ufba-demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          entries: ENTRIES,
          sources: [SOURCE_FAPEG],
        }),
      ),
    ).window.document;

    expect(
      ledgerDom.querySelector('[data-testid="finance-ledger-subtotals"]')?.textContent,
    ).toContain('R$ 7.000,00');
    expect(
      ledgerDom.querySelector('[data-testid="finance-entry-row-ent-inc"]')?.textContent,
    ).toContain('05/10/2026');
    expect(
      ledgerDom.querySelector('[data-testid="finance-entry-glosa-ent-plan"]')?.textContent,
    ).toBe('Rubrica fora do edital');
    expect(ledgerDom.querySelector('[data-testid="finance-entry-commit-ent-plan"]')).not.toBeNull();
    expect(
      ledgerDom.querySelector('[data-testid="finance-entry-settle-doc-ent-plan"]'),
    ).not.toBeNull();
    expect(ledgerDom.querySelector('[data-testid="finance-entry-cancel-ent-plan"]')).not.toBeNull();
  });
});

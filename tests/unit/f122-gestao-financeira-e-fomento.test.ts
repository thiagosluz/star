import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { FinanceChartsPanel } from '@/components/finance/finance-charts-panel';
import { FinanceKpiCards } from '@/components/finance/finance-kpi-cards';
import { FinancialEntriesLedger } from '@/components/finance/financial-entries-ledger';
import {
  EMPTY_EVENT_AREA_COUNTS,
  EVENT_AREAS,
  eventAreaMetric,
} from '@/domain/events/event-areas';
import {
  buildAccountabilityReportCsv,
  buildFinancialEntriesCsv,
  computeEventFinanceSummary,
  formatBrlCents,
  parseBrlToCents,
  type FinancialEntryRuleInput,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';
import { PERMISSIONS } from '@/domain/rbac/permissions';

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

const SAMPLE_SOURCES: FundingSourceRuleInput[] = [
  {
    id: 'src-fapeg',
    name: 'Edital FAPEG 04/2026',
    kind: 'PUBLIC_GRANT',
    codeOrProcess: 'SEI 23070.012345/2026-99',
    approvedCents: 2_000_000, // R$ 20.000,00
    restrictedCategories: ['TRAVEL_AND_PER_DIEM'],
    sponsorId: null,
    notes: null,
  },
  {
    id: 'src-funape',
    name: 'Convênio FUNAPE / UF',
    kind: 'FOUNDATION',
    codeOrProcess: 'FUNAPE-418',
    approvedCents: 1_000_000, // R$ 10.000,00
    restrictedCategories: [],
    sponsorId: null,
    notes: null,
  },
];

const SAMPLE_ENTRIES: FinancialEntryRuleInput[] = [
  {
    id: 'ent-1',
    sourceId: 'src-fapeg',
    type: 'INCOME',
    status: 'SETTLED',
    category: 'GRANT_DISBURSEMENT',
    title: '1ª Parcela Edital FAPEG',
    amountCents: 1_500_000, // R$ 15.000,00
    occurredOn: '2026-10-05',
    settledOn: '2026-10-06',
    counterpartyName: 'FAPEG',
    counterpartyTaxId: '01.234.567/0001-89',
    documentNumber: 'OB-2026-901',
    notes: null,
  },
  {
    id: 'ent-2',
    sourceId: 'src-fapeg',
    type: 'EXPENSE',
    status: 'SETTLED',
    category: 'TRAVEL_AND_PER_DIEM',
    title: 'Passagens aéreas keynote',
    amountCents: 450_000, // R$ 4.500,00
    occurredOn: '2026-10-12',
    settledOn: '2026-10-12',
    counterpartyName: 'Agência Voar',
    counterpartyTaxId: '11.222.333/0001-44',
    documentNumber: 'NF-e 441',
    notes: null,
  },
  {
    id: 'ent-3',
    sourceId: 'src-fapeg',
    type: 'EXPENSE',
    status: 'COMMITTED',
    category: 'CATERING', // Fora da rubrica TRAVEL_AND_PER_DIEM permitida pela FAPEG!
    title: 'Coffee-break abertura',
    amountCents: 250_000, // R$ 2.500,00
    occurredOn: '2026-11-02',
    settledOn: null,
    counterpartyName: 'Buffet Universitário',
    counterpartyTaxId: null,
    documentNumber: 'NE-2026-12',
    notes: null,
  },
];

describe('FASE 122 — Regras puras de domínio financeiro, fomento e prestação de contas', () => {
  it('parseBrlToCents e formatBrlCents convertem valores em reais com precisão de centavos inteiros', () => {
    expect(parseBrlToCents('25.000,50')).toBe(2_500_050);
    expect(parseBrlToCents('R$ 1.250,00')).toBe(125_000);
    expect(parseBrlToCents('340.75')).toBe(34_075);
    expect(parseBrlToCents('100')).toBe(10_000);
    expect(parseBrlToCents('0', { allowZero: false })).toBeNull();
    expect(parseBrlToCents('0', { allowZero: true })).toBe(0);
    expect(parseBrlToCents('-50,00')).toBeNull();
    expect(parseBrlToCents('abc')).toBeNull();

    expect(formatBrlCents(2_500_050)).toBe('R$ 25.000,50');
    expect(formatBrlCents(0)).toBe('R$ 0,00');
  });

  it('computeEventFinanceSummary separa caixa realizado de empenhado/projetado e acusa desvio de rubrica de edital', () => {
    const summary = computeEventFinanceSummary({
      sources: SAMPLE_SOURCES,
      entries: SAMPLE_ENTRIES,
      sponsors: [
        {
          sponsorId: 'sp-1',
          sponsorName: 'Tech Corp',
          tierName: 'Ouro',
          effectiveContractCents: 800_000,
          isActive: true,
        },
      ],
    });

    expect(summary.totalApprovedSourcesCents).toBe(3_000_000);
    expect(summary.settledIncomeCents).toBe(1_500_000);
    expect(summary.settledExpenseCents).toBe(450_000);
    expect(summary.committedExpenseCents).toBe(250_000);
    expect(summary.cashBalanceCents).toBe(1_050_000); // 15.000 - 4.500
    expect(summary.projectedBalanceCents).toBe(800_000); // 15.000 - (4.500 + 2.500)

    const fapeg = summary.bySource.find((s) => s.sourceId === 'src-fapeg')!;
    expect(fapeg.activeExpenseCents).toBe(700_000);
    expect(fapeg.remainingApprovedCents).toBe(1_300_000);
    expect(fapeg.utilizationPercent).toBe(35);
    expect(fapeg.policyWarnings).toHaveLength(1);
    expect(fapeg.policyWarnings[0]).toContain('Coffee-break abertura');
    expect(fapeg.policyWarnings[0]).toContain('fora das rubricas permitidas');

    expect(summary.sponsorshipPipeline.unimportedSponsors).toHaveLength(1);
    expect(summary.sponsorshipPipeline.totalActiveSponsorsCents).toBe(800_000);
    expect(summary.expensesByCategory.map((c) => c.category)).toEqual([
      'TRAVEL_AND_PER_DIEM',
      'CATERING',
    ]);
    expect(summary.monthlyCashflow.map((m) => m.monthKey)).toEqual(['2026-10', '2026-11']);
  });

  it('buildFinancialEntriesCsv e buildAccountabilityReportCsv geram CSV UTF-8 com BOM e proteção contra formula injection', () => {
    const summary = computeEventFinanceSummary({
      sources: SAMPLE_SOURCES,
      entries: [
        ...SAMPLE_ENTRIES,
        {
          ...SAMPLE_ENTRIES[1]!,
          id: 'ent-inj',
          title: '=CMD("calc")',
        },
      ],
    });

    const entriesCsv = buildFinancialEntriesCsv({
      sources: SAMPLE_SOURCES,
      entries: [
        ...SAMPLE_ENTRIES,
        {
          ...SAMPLE_ENTRIES[1]!,
          id: 'ent-inj',
          title: '=CMD("calc")',
        },
      ],
    });

    expect(entriesCsv.startsWith('\uFEFFData Competencia;')).toBe(true);
    expect(entriesCsv).toContain('Edital FAPEG 04/2026');
    expect(entriesCsv).toContain('15000,00');
    expect(entriesCsv).toContain('-4500,00');
    expect(entriesCsv).toContain('"\'=CMD(""calc"")"');

    const accCsv = buildAccountabilityReportCsv(summary);
    expect(accCsv.startsWith('\uFEFFFonte de Recurso / Edital;')).toBe(true);
    expect(accCsv).toContain('SEI 23070.012345/2026-99');
    expect(accCsv).toContain('20000,00');
  });

  it('EVENT_AREAS e eventAreaMetric expõem o cartão financeiro com selo em português e guarda SPONSOR_MANAGE', () => {
    const area = EVENT_AREAS.find((a) => a.id === 'financeiro');
    expect(area).toBeDefined();
    expect(area?.group).toBe('CONFIGURAR');
    expect(area?.permission).toBe(PERMISSIONS.SPONSOR_MANAGE);

    expect(eventAreaMetric('financeiro', EMPTY_EVENT_AREA_COUNTS)).toBeNull();
    expect(
      eventAreaMetric('financeiro', { ...EMPTY_EVENT_AREA_COUNTS, financialEntries: 0 }),
    ).toBe('nenhum lançamento financeiro');
    expect(
      eventAreaMetric('financeiro', { ...EMPTY_EVENT_AREA_COUNTS, financialEntries: 1 }),
    ).toBe('1 lançamento financeiro');
    expect(
      eventAreaMetric('financeiro', { ...EMPTY_EVENT_AREA_COUNTS, financialEntries: 4 }),
    ).toBe('4 lançamentos financeiros');
  });
});

describe('FASE 122 — Contratos SSR dos componentes financeiros e gráficos SVG', () => {
  it('FinanceKpiCards, FinanceChartsPanel e FinancialEntriesLedger renderizam KPIs, 3 gráficos SVG acessíveis e livro-razão', () => {
    const summary = computeEventFinanceSummary({
      sources: SAMPLE_SOURCES,
      entries: SAMPLE_ENTRIES,
    });

    const kpiDom = new JSDOM(
      renderToStaticMarkup(
        createElement(FinanceKpiCards, {
          tenantSlug: 'ufba-demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          sourcesCount: SAMPLE_SOURCES.length,
          summary,
          filters: { type: 'EXPENSE' },
        }),
      ),
    ).window.document;

    expect(kpiDom.querySelector('[data-testid="finance-kpi-approved"]')?.textContent).toContain(
      'R$ 30.000,00',
    );
    expect(kpiDom.querySelector('[data-testid="finance-kpi-balance"]')?.textContent).toContain(
      'R$ 10.500,00',
    );
    expect(kpiDom.querySelector('[data-testid="finance-alerts"]')?.textContent).toContain(
      'fora das rubricas permitidas',
    );
    expect(
      kpiDom.querySelector('[data-testid="finance-export-entries"]')?.getAttribute('href'),
    ).toContain('formato=lancamentos&tipo=EXPENSE');

    const chartsDom = new JSDOM(
      renderToStaticMarkup(createElement(FinanceChartsPanel, { summary })),
    ).window.document;

    expect(chartsDom.querySelector('[data-testid="finance-chart-sources"] svg')).not.toBeNull();
    expect(chartsDom.querySelector('[data-testid="finance-chart-categories"] svg')).not.toBeNull();
    expect(chartsDom.querySelector('[data-testid="finance-chart-monthly"] svg')).not.toBeNull();

    const ledgerDom = new JSDOM(
      renderToStaticMarkup(
        createElement(FinancialEntriesLedger, {
          tenantSlug: 'ufba-demo',
          eventId: '11111111-1111-4111-8111-111111111111',
          entries: SAMPLE_ENTRIES,
          sources: SAMPLE_SOURCES,
        }),
      ),
    ).window.document;

    expect(ledgerDom.querySelector('[data-testid="finance-entry-row-ent-1"]')).not.toBeNull();
    expect(ledgerDom.querySelector('[data-testid="finance-entry-settle-ent-3"]')).not.toBeNull();
  });

  it('a página e os 5 subcomponentes financeiros respeitam tetos enxutos de linhas e jsxDepth', () => {
    const files = [
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/financeiro/page.tsx',
      'src/components/finance/finance-kpi-cards.tsx',
      'src/components/finance/finance-charts-panel.tsx',
      'src/components/finance/funding-sources-panel.tsx',
      'src/components/finance/financial-entry-create-form.tsx',
      'src/components/finance/financial-entries-ledger.tsx',
    ];

    for (const rel of files) {
      const metrics = measureFileMetrics(rel);
      expect(metrics.lines, `${rel} excedeu 290 linhas`).toBeLessThanOrEqual(290);
      expect(metrics.maxJsxDepth, `${rel} excedeu jsxDepth 7`).toBeLessThanOrEqual(7);
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO PURO — GESTÃO FINANCEIRA, FOMENTO E PRESTAÇÃO DE CONTAS (FASE 122)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O DINHEIRO TEM FONTE E RUBRICA EM EVENTOS ACADÊMICOS / CIENTÍFICOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Em eventos financiados por editais públicos (FAPEG, CNPq, CAPES), instituições
 *  federais/estaduais (UF, IF) e fundações de apoio (FUNAPE), somar entradas e
 *  saídas num caixa único não basta:
 *
 *    1. Cada fonte tem um TETO APROVADO (`approvedCents`) e número de processo/edital.
 *    2. Muitos editais CARIMBAM as rubricas permitidas (`restrictedCategories`):
 *       verba de passagens/diárias não pode pagar coffee-break, que precisa sair
 *       de patrocínio privado ou recurso próprio.
 *    3. A operação convive com três momentos: o que foi ORÇADO (`PLANNED`), o que
 *       já foi EMPENHADO/CONTRATADO (`COMMITTED`) e o que foi PAGO/RECEBIDO
 *       (`SETTLED`). Confundir empenho com caixa esconde o rombo futuro; olhar só
 *       o orçamento esconde a falta de liquidez imediata.
 *
 *  Este módulo não importa Prisma, Next.js nem React. Todos os valores monetários
 *  trafegam em CENTAVOS INTEIROS (`number` inteiro) para eliminar erros de IEEE 754.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const FUNDING_SOURCE_KINDS = [
  'PUBLIC_GRANT',
  'FOUNDATION',
  'INSTITUTIONAL',
  'SPONSORSHIP',
  'OWN_REVENUE',
] as const;

export type FundingSourceKind = (typeof FUNDING_SOURCE_KINDS)[number];

export const FUNDING_SOURCE_KIND_LABELS: Readonly<Record<FundingSourceKind, string>> = {
  PUBLIC_GRANT: 'Edital / Agência de fomento (FAPEG, CNPq, CAPES…)',
  FOUNDATION: 'Fundação de apoio (FUNAPE…)',
  INSTITUTIONAL: 'Instituição pública (UF, IF, Pró-Reitoria…)',
  SPONSORSHIP: 'Patrocínio privado / empresarial',
  OWN_REVENUE: 'Recursos próprios / taxas / doações',
};

export const FUNDING_SOURCE_KIND_SHORT_LABELS: Readonly<Record<FundingSourceKind, string>> = {
  PUBLIC_GRANT: 'Agência de fomento',
  FOUNDATION: 'Fundação de apoio',
  INSTITUTIONAL: 'Instituição (UF/IF)',
  SPONSORSHIP: 'Patrocínio',
  OWN_REVENUE: 'Recursos próprios',
};

export const FINANCIAL_ENTRY_TYPES = ['INCOME', 'EXPENSE'] as const;
export type FinancialEntryType = (typeof FINANCIAL_ENTRY_TYPES)[number];

export const FINANCIAL_ENTRY_TYPE_LABELS: Readonly<Record<FinancialEntryType, string>> = {
  INCOME: 'Entrada',
  EXPENSE: 'Saída',
};

export const FINANCIAL_ENTRY_STATUSES = [
  'PLANNED',
  'COMMITTED',
  'SETTLED',
  'CANCELED',
] as const;

export type FinancialEntryStatus = (typeof FINANCIAL_ENTRY_STATUSES)[number];

export const FINANCIAL_ENTRY_STATUS_LABELS: Readonly<Record<FinancialEntryStatus, string>> = {
  PLANNED: 'Previsto / Orçado',
  COMMITTED: 'Empenhado / Contratado',
  SETTLED: 'Realizado (Recebido / Pago)',
  CANCELED: 'Cancelado',
};

export const FINANCIAL_CATEGORIES = [
  'GRANT_DISBURSEMENT',
  'SPONSORSHIP_REVENUE',
  'INSTITUTIONAL_CONTRIBUTION',
  'TRAVEL_AND_PER_DIEM',
  'CATERING',
  'PRINTING_AND_BADGES',
  'INFRASTRUCTURE_AND_AV',
  'THIRD_PARTY_SERVICES',
  'AWARDS_AND_SCHOLARSHIPS',
  'OTHER',
] as const;

export type FinancialCategory = (typeof FINANCIAL_CATEGORIES)[number];

export const FINANCIAL_CATEGORY_LABELS: Readonly<Record<FinancialCategory, string>> = {
  GRANT_DISBURSEMENT: 'Repasse de edital / fomento',
  SPONSORSHIP_REVENUE: 'Receita de patrocínio',
  INSTITUTIONAL_CONTRIBUTION: 'Contrapartida institucional (UF/IF/FUNAPE)',
  TRAVEL_AND_PER_DIEM: 'Passagens, diárias e hospedagem',
  CATERING: 'Alimentação e coffee-break',
  PRINTING_AND_BADGES: 'Material gráfico, crachás e sinalização',
  INFRASTRUCTURE_AND_AV: 'Infraestrutura, som, vídeo e locação',
  THIRD_PARTY_SERVICES: 'Serviços de terceiros (PF/PJ)',
  AWARDS_AND_SCHOLARSHIPS: 'Premiações, bolsas e auxílio estudantil',
  OTHER: 'Outras receitas ou despesas',
};

/** Limite superior defensivo: R$ 100 milhões em centavos. */
export const MAX_FINANCE_CENTS = 10_000_000_000;

export function isFundingSourceKind(value: unknown): value is FundingSourceKind {
  return typeof value === 'string' && (FUNDING_SOURCE_KINDS as readonly string[]).includes(value);
}

export function isFinancialEntryType(value: unknown): value is FinancialEntryType {
  return typeof value === 'string' && (FINANCIAL_ENTRY_TYPES as readonly string[]).includes(value);
}

export function isFinancialEntryStatus(value: unknown): value is FinancialEntryStatus {
  return (
    typeof value === 'string' && (FINANCIAL_ENTRY_STATUSES as readonly string[]).includes(value)
  );
}

export function isFinancialCategory(value: unknown): value is FinancialCategory {
  return typeof value === 'string' && (FINANCIAL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Converte entrada humana em reais (`"15.000,50"`, `"15000.50"`, `"R$ 2500"`) para
 * centavos inteiros. Devolve `null` quando vazia, negativa ou malformada.
 */
export function parseBrlToCents(
  raw: string | number | null | undefined,
  options: { allowZero?: boolean } = {},
): number | null {
  const allowZero = options.allowZero ?? false;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    const cents = Math.round(raw * 100);
    if (cents < 0 || (!allowZero && cents === 0) || cents > MAX_FINANCE_CENTS) return null;
    return cents;
  }

  if (typeof raw !== 'string') return null;

  const cleaned = raw.replace(/[R$\s]/g, '').trim();
  if (cleaned.length === 0) return null;

  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Formato brasileiro com milhar e decimal: 15.000,50 -> 15000.50
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const [wholePart = '0', decPart = ''] = normalized.split('.');
  const whole = Number.parseInt(wholePart, 10);
  const dec = Number.parseInt(decPart.padEnd(2, '0').slice(0, 2), 10);

  if (!Number.isFinite(whole) || !Number.isFinite(dec)) return null;

  const cents = whole * 100 + dec;
  if (cents < 0 || (!allowZero && cents === 0) || cents > MAX_FINANCE_CENTS) return null;

  return cents;
}

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Formata centavos em `R$ 1.234,56` trocando NBSP por espaço normal. */
export function formatBrlCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents / 100 : 0;
  return BRL_FORMATTER.format(safe).replace(/\u00a0/g, ' ');
}

/** Formata centavos como decimal `1234.56` ou `1234,56` para planilhas CSV. */
export function formatCentsForCsv(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${reais},${centavos}`;
}

export interface FundingSourceRuleInput {
  id: string;
  name: string;
  kind: FundingSourceKind;
  codeOrProcess: string | null;
  approvedCents: number;
  restrictedCategories: readonly FinancialCategory[];
  sponsorId: string | null;
  notes: string | null;
}

export interface FinancialEntryRuleInput {
  id: string;
  sourceId: string | null;
  type: FinancialEntryType;
  status: FinancialEntryStatus;
  category: FinancialCategory;
  title: string;
  amountCents: number;
  /** Data `AAAA-MM-DD` da competência/ocorrência no fuso do evento. */
  occurredOn: string;
  /** Data `AAAA-MM-DD` da liquidação (pagamento/recebimento), quando `SETTLED`. */
  settledOn: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  documentNumber: string | null;
  notes: string | null;
}

export interface EventSponsorContractInput {
  sponsorId: string;
  sponsorName: string;
  tierName: string | null;
  effectiveContractCents: number;
  isActive: boolean;
}

export interface FundingSourceExecutionView {
  sourceId: string;
  name: string;
  kind: FundingSourceKind;
  kindLabel: string;
  codeOrProcess: string | null;
  approvedCents: number;
  settledIncomeCents: number;
  activeIncomeCents: number;
  settledExpenseCents: number;
  committedExpenseCents: number;
  plannedExpenseCents: number;
  activeExpenseCents: number;
  /** Quanto ainda resta do teto aprovado na fonte (`approvedCents - activeExpenseCents`). */
  remainingApprovedCents: number;
  /** Saldo líquido em caixa desta fonte (`settledIncomeCents - settledExpenseCents`). */
  cashBalanceCents: number;
  /** Percentual consumido do teto aprovado (`0..999`), ou `null` quando `approvedCents === 0`. */
  utilizationPercent: number | null;
  isOverBudget: boolean;
  restrictedCategories: readonly FinancialCategory[];
  policyWarnings: string[];
}

export interface SourceKindBreakdownItem {
  kind: FundingSourceKind;
  label: string;
  shortLabel: string;
  sourcesCount: number;
  approvedCents: number;
  settledIncomeCents: number;
  activeExpenseCents: number;
  shareOfApprovedPercent: number;
}

export interface CategoryBreakdownItem {
  category: FinancialCategory;
  label: string;
  settledCents: number;
  committedCents: number;
  plannedCents: number;
  totalActiveCents: number;
  entriesCount: number;
  sharePercent: number;
}

export interface MonthlyCashflowItem {
  monthKey: string;
  settledIncomeCents: number;
  activeIncomeCents: number;
  settledExpenseCents: number;
  activeExpenseCents: number;
  netCashCents: number;
  netProjectedCents: number;
}

export interface SponsorshipPipelineSummary {
  totalActiveSponsorsCents: number;
  linkedSponsorsCount: number;
  unimportedSponsors: EventSponsorContractInput[];
}

export interface EventFinanceSummary {
  totalApprovedSourcesCents: number;
  settledIncomeCents: number;
  committedIncomeCents: number;
  plannedIncomeCents: number;
  totalActiveIncomeCents: number;
  settledExpenseCents: number;
  committedExpenseCents: number;
  plannedExpenseCents: number;
  totalActiveExpenseCents: number;
  /** Dinheiro efetivamente em conta (`settledIncome - settledExpense`). */
  cashBalanceCents: number;
  /** Saldo considerando o que já foi empenhado/contratado (`(settled+committed)Income - (settled+committed)Expense`). */
  committedBalanceCents: number;
  /** Saldo final projetado com todos os itens previstos (`totalActiveIncome - totalActiveExpense`). */
  projectedBalanceCents: number;
  /** Saldo de saídas sem fonte vinculada. */
  unassignedExpenseCents: number;
  activeEntriesCount: number;
  canceledEntriesCount: number;
  bySource: FundingSourceExecutionView[];
  bySourceKind: SourceKindBreakdownItem[];
  expensesByCategory: CategoryBreakdownItem[];
  monthlyCashflow: MonthlyCashflowItem[];
  sponsorshipPipeline: SponsorshipPipelineSummary;
  alerts: string[];
}

/**
 * Consolida todas as métricas financeiras, alertas de conformidade de editais,
 * séries dos 3 gráficos e pipeline de patrocínio em uma única passagem determinística.
 */
export function computeEventFinanceSummary(input: {
  sources: readonly FundingSourceRuleInput[];
  entries: readonly FinancialEntryRuleInput[];
  sponsors?: readonly EventSponsorContractInput[];
}): EventFinanceSummary {
  const sponsors = input.sponsors ?? [];
  const totalApprovedSourcesCents = input.sources.reduce(
    (sum, source) => sum + Math.max(0, source.approvedCents),
    0,
  );

  let settledIncomeCents = 0;
  let committedIncomeCents = 0;
  let plannedIncomeCents = 0;
  let settledExpenseCents = 0;
  let committedExpenseCents = 0;
  let plannedExpenseCents = 0;
  let unassignedExpenseCents = 0;
  let activeEntriesCount = 0;
  let canceledEntriesCount = 0;

  const entriesBySource = new Map<string, FinancialEntryRuleInput[]>();
  const expensesByCategoryMap = new Map<
    FinancialCategory,
    { settled: number; committed: number; planned: number; count: number }
  >();
  const monthlyMap = new Map<
    string,
    {
      settledIncome: number;
      activeIncome: number;
      settledExpense: number;
      activeExpense: number;
    }
  >();

  for (const entry of input.entries) {
    if (entry.status === 'CANCELED') {
      canceledEntriesCount += 1;
      continue;
    }

    activeEntriesCount += 1;
    const amount = Math.max(0, entry.amountCents);

    if (entry.sourceId) {
      const bucket = entriesBySource.get(entry.sourceId) ?? [];
      bucket.push(entry);
      entriesBySource.set(entry.sourceId, bucket);
    } else if (entry.type === 'EXPENSE') {
      unassignedExpenseCents += amount;
    }

    const monthKey = /^\d{4}-\d{2}/.test(entry.occurredOn)
      ? entry.occurredOn.slice(0, 7)
      : 'sem-data';
    const monthBucket = monthlyMap.get(monthKey) ?? {
      settledIncome: 0,
      activeIncome: 0,
      settledExpense: 0,
      activeExpense: 0,
    };

    if (entry.type === 'INCOME') {
      monthBucket.activeIncome += amount;
      if (entry.status === 'SETTLED') {
        settledIncomeCents += amount;
        monthBucket.settledIncome += amount;
      } else if (entry.status === 'COMMITTED') {
        committedIncomeCents += amount;
      } else if (entry.status === 'PLANNED') {
        plannedIncomeCents += amount;
      }
    } else {
      monthBucket.activeExpense += amount;
      const catBucket = expensesByCategoryMap.get(entry.category) ?? {
        settled: 0,
        committed: 0,
        planned: 0,
        count: 0,
      };
      catBucket.count += 1;

      if (entry.status === 'SETTLED') {
        settledExpenseCents += amount;
        monthBucket.settledExpense += amount;
        catBucket.settled += amount;
      } else if (entry.status === 'COMMITTED') {
        committedExpenseCents += amount;
        catBucket.committed += amount;
      } else if (entry.status === 'PLANNED') {
        plannedExpenseCents += amount;
        catBucket.planned += amount;
      }

      expensesByCategoryMap.set(entry.category, catBucket);
    }

    monthlyMap.set(monthKey, monthBucket);
  }

  const totalActiveIncomeCents = settledIncomeCents + committedIncomeCents + plannedIncomeCents;
  const totalActiveExpenseCents = settledExpenseCents + committedExpenseCents + plannedExpenseCents;
  const cashBalanceCents = settledIncomeCents - settledExpenseCents;
  const committedBalanceCents =
    settledIncomeCents + committedIncomeCents - (settledExpenseCents + committedExpenseCents);
  const projectedBalanceCents = totalActiveIncomeCents - totalActiveExpenseCents;

  const alerts: string[] = [];

  const bySource: FundingSourceExecutionView[] = input.sources.map((source) => {
    const sourceEntries = entriesBySource.get(source.id) ?? [];
    let srcSettledIncome = 0;
    let srcActiveIncome = 0;
    let srcSettledExpense = 0;
    let srcCommittedExpense = 0;
    let srcPlannedExpense = 0;
    const policyWarnings: string[] = [];
    const allowedSet =
      source.restrictedCategories.length > 0 ? new Set(source.restrictedCategories) : null;

    for (const entry of sourceEntries) {
      const amount = Math.max(0, entry.amountCents);
      if (entry.type === 'INCOME') {
        srcActiveIncome += amount;
        if (entry.status === 'SETTLED') srcSettledIncome += amount;
      } else {
        if (entry.status === 'SETTLED') srcSettledExpense += amount;
        else if (entry.status === 'COMMITTED') srcCommittedExpense += amount;
        else if (entry.status === 'PLANNED') srcPlannedExpense += amount;

        if (allowedSet && !allowedSet.has(entry.category)) {
          policyWarnings.push(
            `Despesa "${entry.title}" (${FINANCIAL_CATEGORY_LABELS[entry.category]}) fora das rubricas permitidas da fonte "${source.name}".`,
          );
        }
      }
    }

    const srcActiveExpense = srcSettledExpense + srcCommittedExpense + srcPlannedExpense;
    const remainingApprovedCents = source.approvedCents - srcActiveExpense;
    const isOverBudget = source.approvedCents > 0 && srcActiveExpense > source.approvedCents;
    if (isOverBudget) {
      policyWarnings.push(
        `A fonte "${source.name}" excedeu o teto aprovado em ${formatBrlCents(srcActiveExpense - source.approvedCents)}.`,
      );
    }

    for (const warning of policyWarnings) {
      alerts.push(warning);
    }

    const utilizationPercent =
      source.approvedCents > 0
        ? Math.round((srcActiveExpense / source.approvedCents) * 100)
        : null;

    return {
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      kindLabel: FUNDING_SOURCE_KIND_LABELS[source.kind],
      codeOrProcess: source.codeOrProcess,
      approvedCents: source.approvedCents,
      settledIncomeCents: srcSettledIncome,
      activeIncomeCents: srcActiveIncome,
      settledExpenseCents: srcSettledExpense,
      committedExpenseCents: srcCommittedExpense,
      plannedExpenseCents: srcPlannedExpense,
      activeExpenseCents: srcActiveExpense,
      remainingApprovedCents,
      cashBalanceCents: srcSettledIncome - srcSettledExpense,
      utilizationPercent,
      isOverBudget,
      restrictedCategories: source.restrictedCategories,
      policyWarnings,
    };
  });

  if (cashBalanceCents < 0) {
    alerts.push(
      `Saldo em caixa negativo (${formatBrlCents(cashBalanceCents)}): as saídas pagas superam as entradas já recebidas em conta.`,
    );
  }
  if (unassignedExpenseCents > 0) {
    alerts.push(
      `Há ${formatBrlCents(unassignedExpenseCents)} em saídas sem fonte pagadora vinculada — vincule-as para fechar a prestação de contas.`,
    );
  }

  const bySourceKind: SourceKindBreakdownItem[] = FUNDING_SOURCE_KINDS.map((kind) => {
    const matching = bySource.filter((item) => item.kind === kind);
    const approvedCents = matching.reduce((sum, item) => sum + item.approvedCents, 0);
    const kindSettledIncome = matching.reduce((sum, item) => sum + item.settledIncomeCents, 0);
    const kindActiveExpense = matching.reduce((sum, item) => sum + item.activeExpenseCents, 0);
    const shareOfApprovedPercent =
      totalApprovedSourcesCents > 0
        ? Math.round((approvedCents / totalApprovedSourcesCents) * 100)
        : 0;

    return {
      kind,
      label: FUNDING_SOURCE_KIND_LABELS[kind],
      shortLabel: FUNDING_SOURCE_KIND_SHORT_LABELS[kind],
      sourcesCount: matching.length,
      approvedCents,
      settledIncomeCents: kindSettledIncome,
      activeExpenseCents: kindActiveExpense,
      shareOfApprovedPercent,
    };
  }).filter((item) => item.sourcesCount > 0 || item.approvedCents > 0);

  const expensesByCategory: CategoryBreakdownItem[] = [...expensesByCategoryMap.entries()]
    .map(([category, bucket]) => {
      const totalActiveCents = bucket.settled + bucket.committed + bucket.planned;
      const sharePercent =
        totalActiveExpenseCents > 0
          ? Math.round((totalActiveCents / totalActiveExpenseCents) * 100)
          : 0;

      return {
        category,
        label: FINANCIAL_CATEGORY_LABELS[category],
        settledCents: bucket.settled,
        committedCents: bucket.committed,
        plannedCents: bucket.planned,
        totalActiveCents,
        entriesCount: bucket.count,
        sharePercent,
      };
    })
    .sort((a, b) => b.totalActiveCents - a.totalActiveCents || a.label.localeCompare(b.label));

  const monthlyCashflow: MonthlyCashflowItem[] = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, bucket]) => ({
      monthKey,
      settledIncomeCents: bucket.settledIncome,
      activeIncomeCents: bucket.activeIncome,
      settledExpenseCents: bucket.settledExpense,
      activeExpenseCents: bucket.activeExpense,
      netCashCents: bucket.settledIncome - bucket.settledExpense,
      netProjectedCents: bucket.activeIncome - bucket.activeExpense,
    }));

  const linkedSponsorIds = new Set(
    input.sources.map((source) => source.sponsorId).filter((id): id is string => Boolean(id)),
  );
  const activeValuedSponsors = sponsors.filter(
    (sponsor) => sponsor.isActive && sponsor.effectiveContractCents > 0,
  );
  const unimportedSponsors = activeValuedSponsors.filter(
    (sponsor) => !linkedSponsorIds.has(sponsor.sponsorId),
  );
  const totalActiveSponsorsCents = activeValuedSponsors.reduce(
    (sum, sponsor) => sum + sponsor.effectiveContractCents,
    0,
  );

  return {
    totalApprovedSourcesCents,
    settledIncomeCents,
    committedIncomeCents,
    plannedIncomeCents,
    totalActiveIncomeCents,
    settledExpenseCents,
    committedExpenseCents,
    plannedExpenseCents,
    totalActiveExpenseCents,
    cashBalanceCents,
    committedBalanceCents,
    projectedBalanceCents,
    unassignedExpenseCents,
    activeEntriesCount,
    canceledEntriesCount,
    bySource,
    bySourceKind,
    expensesByCategory,
    monthlyCashflow,
    sponsorshipPipeline: {
      totalActiveSponsorsCents,
      linkedSponsorsCount: activeValuedSponsors.length - unimportedSponsors.length,
      unimportedSponsors,
    },
    alerts,
  };
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Previne CSV formula injection em planilhas (=, +, -, @) quando não for número negativo.
  const sanitized =
    /^[=+\-@]/.test(raw) && !/^-\d+[,.]\d{2}$/.test(raw) ? `'${raw}` : raw;
  if (/[;"\r\n]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

/**
 * Gera o CSV detalhado de lançamentos (com BOM UTF-8 e separador `;` para abrir
 * direto no Excel/LibreOffice em português, pronto para processos SEI / FUNAPE / FAPEG).
 */
export function buildFinancialEntriesCsv(input: {
  entries: readonly FinancialEntryRuleInput[];
  sources: readonly FundingSourceRuleInput[];
}): string {
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const header = [
    'Data Competencia',
    'Data Liquidacao',
    'Tipo',
    'Situacao',
    'Fonte Pagadora / Origem',
    'Tipo da Fonte',
    'Processo / Edital / Convenio',
    'Rubrica / Categoria',
    'Descricao',
    'Favorecido / Contraparte',
    'CPF / CNPJ',
    'Documento Fiscal / Empenho / Recibo',
    'Valor (R$)',
    'Observacoes',
  ].join(';');

  const rows = input.entries.map((entry) => {
    const source = entry.sourceId ? sourceById.get(entry.sourceId) : undefined;
    const signedCents = entry.type === 'EXPENSE' ? -entry.amountCents : entry.amountCents;

    return [
      escapeCsvCell(entry.occurredOn),
      escapeCsvCell(entry.settledOn ?? ''),
      escapeCsvCell(FINANCIAL_ENTRY_TYPE_LABELS[entry.type]),
      escapeCsvCell(FINANCIAL_ENTRY_STATUS_LABELS[entry.status]),
      escapeCsvCell(source?.name ?? 'Sem fonte vinculada'),
      escapeCsvCell(source ? FUNDING_SOURCE_KIND_SHORT_LABELS[source.kind] : ''),
      escapeCsvCell(source?.codeOrProcess ?? ''),
      escapeCsvCell(FINANCIAL_CATEGORY_LABELS[entry.category]),
      escapeCsvCell(entry.title),
      escapeCsvCell(entry.counterpartyName ?? ''),
      escapeCsvCell(entry.counterpartyTaxId ?? ''),
      escapeCsvCell(entry.documentNumber ?? ''),
      escapeCsvCell(formatCentsForCsv(signedCents)),
      escapeCsvCell(entry.notes ?? ''),
    ].join(';');
  });

  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}

/**
 * Gera o Demonstrativo Consolidado de Prestação de Contas por Fonte Pagadora
 * (Aprovado × Recebido × Empenhado × Pago × Saldo Remanescente do Edital/Fonte).
 */
export function buildAccountabilityReportCsv(summary: EventFinanceSummary): string {
  const header = [
    'Fonte de Recurso / Edital',
    'Natureza',
    'Processo / Convenio',
    'Teto Aprovado (R$)',
    'Entradas Recebidas (R$)',
    'Despesas Pagas (R$)',
    'Despesas Empenhadas (R$)',
    'Despesas Previstas (R$)',
    'Total Executado/Comprometido (R$)',
    'Saldo do Teto Aprovado (R$)',
    'Saldo Liquido em Caixa (R$)',
    'Execucao (%)',
    'Situacao de Conformidade',
  ].join(';');

  const rows = summary.bySource.map((source) => [
    escapeCsvCell(source.name),
    escapeCsvCell(FUNDING_SOURCE_KIND_SHORT_LABELS[source.kind]),
    escapeCsvCell(source.codeOrProcess ?? ''),
    escapeCsvCell(formatCentsForCsv(source.approvedCents)),
    escapeCsvCell(formatCentsForCsv(source.settledIncomeCents)),
    escapeCsvCell(formatCentsForCsv(source.settledExpenseCents)),
    escapeCsvCell(formatCentsForCsv(source.committedExpenseCents)),
    escapeCsvCell(formatCentsForCsv(source.plannedExpenseCents)),
    escapeCsvCell(formatCentsForCsv(source.activeExpenseCents)),
    escapeCsvCell(formatCentsForCsv(source.remainingApprovedCents)),
    escapeCsvCell(formatCentsForCsv(source.cashBalanceCents)),
    escapeCsvCell(source.utilizationPercent !== null ? `${source.utilizationPercent}%` : '—'),
    escapeCsvCell(
      source.policyWarnings.length === 0 ? 'Regular' : source.policyWarnings.join(' | '),
    ),
  ].join(';'));

  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}

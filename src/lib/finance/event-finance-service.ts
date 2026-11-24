/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Gestão Financeira, Fomento e Prestação de Contas (FASE 122)
 *
 *  Regras centrais:
 *    • Todas as leituras e escritas rodam sob `withTenant` (RLS + FORCE).
 *    • A leitura da tela consolida evento, fontes, lançamentos e contratos de
 *      patrocínio em UMA única transação `withTenant` com `Promise.all`.
 *    • A exclusão de fonte pagadora com lançamentos ativos é recusada (`SOURCE_HAS_ENTRIES`)
 *      para impedir que despesas pagas fiquem órfãs na prestação de contas.
 *    • A trilha de auditoria (`recordAudit`) é gravada fora da transação (Armadilha 97).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import {
  buildAccountabilityReportCsv,
  buildFinancialEntriesCsv,
  computeEventFinanceSummary,
  isFinancialCategory,
  isFinancialEntryStatus,
  isFinancialEntryType,
  isFundingSourceKind,
  MAX_FINANCE_CENTS,
  type EventFinanceSummary,
  type EventSponsorContractInput,
  type FinancialCategory,
  type FinancialEntryRuleInput,
  type FinancialEntryStatus,
  type FinancialEntryType,
  type FundingSourceKind,
  type FundingSourceRuleInput,
} from '@/domain/finance/event-finance-rules';
import { recordAudit } from '@/lib/admin/audit';
import { errorMessage } from '@/lib/db/prisma-errors';
import { withTenant } from '@/lib/db/tenant-client';
import { logger } from '@/lib/observability/logger';

export type FinanceErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_HAS_ENTRIES'
  | 'NO_SPONSORS_TO_IMPORT'
  | 'INTERNAL';

export type FinanceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: FinanceErrorCode; message: string };

export interface FinanceLedgerFilters {
  type?: string | null;
  status?: string | null;
  sourceId?: string | null;
  category?: string | null;
  search?: string | null;
}

export interface EventFinanceDashboardData {
  event: {
    id: string;
    slug: string;
    title: string;
    timezone: string;
    status: string;
  };
  sources: FundingSourceRuleInput[];
  allEntries: FinancialEntryRuleInput[];
  filteredEntries: FinancialEntryRuleInput[];
  sponsors: EventSponsorContractInput[];
  summary: EventFinanceSummary;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateKey(raw: string | null | undefined, fallback?: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (ISO_DATE_RE.test(trimmed)) return trimmed;
  return fallback ?? null;
}

function todayIsoKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapSourceRow(row: {
  id: string;
  name: string;
  kind: string;
  codeOrProcess: string | null;
  approvedCents: number;
  restrictedCategories: string[];
  sponsorId: string | null;
  notes: string | null;
}): FundingSourceRuleInput {
  return {
    id: row.id,
    name: row.name,
    kind: isFundingSourceKind(row.kind) ? row.kind : 'PUBLIC_GRANT',
    codeOrProcess: row.codeOrProcess,
    approvedCents: row.approvedCents,
    restrictedCategories: row.restrictedCategories.filter(isFinancialCategory),
    sponsorId: row.sponsorId,
    notes: row.notes,
  };
}

function mapEntryRow(row: {
  id: string;
  sourceId: string | null;
  type: string;
  status: string;
  category: string;
  title: string;
  amountCents: number;
  occurredOn: string;
  settledOn: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  documentNumber: string | null;
  notes: string | null;
}): FinancialEntryRuleInput {
  return {
    id: row.id,
    sourceId: row.sourceId,
    type: isFinancialEntryType(row.type) ? row.type : 'EXPENSE',
    status: isFinancialEntryStatus(row.status) ? row.status : 'PLANNED',
    category: isFinancialCategory(row.category) ? row.category : 'OTHER',
    title: row.title,
    amountCents: row.amountCents,
    occurredOn: row.occurredOn,
    settledOn: row.settledOn,
    counterpartyName: row.counterpartyName,
    counterpartyTaxId: row.counterpartyTaxId,
    documentNumber: row.documentNumber,
    notes: row.notes,
  };
}

export function filterFinancialEntries(
  entries: readonly FinancialEntryRuleInput[],
  filters: FinanceLedgerFilters,
): FinancialEntryRuleInput[] {
  const typeFilter = isFinancialEntryType(filters.type) ? filters.type : null;
  const statusFilter = isFinancialEntryStatus(filters.status) ? filters.status : null;
  const categoryFilter = isFinancialCategory(filters.category) ? filters.category : null;
  const sourceFilter = (filters.sourceId ?? '').trim() || null;
  const search = (filters.search ?? '').trim().toLowerCase();

  return entries.filter((entry) => {
    if (typeFilter && entry.type !== typeFilter) return false;
    if (statusFilter && entry.status !== statusFilter) return false;
    if (categoryFilter && entry.category !== categoryFilter) return false;
    if (sourceFilter) {
      if (sourceFilter === '__NONE__') {
        if (entry.sourceId !== null) return false;
      } else if (entry.sourceId !== sourceFilter) {
        return false;
      }
    }
    if (search.length > 0) {
      const haystack = [
        entry.title,
        entry.counterpartyName ?? '',
        entry.counterpartyTaxId ?? '',
        entry.documentNumber ?? '',
        entry.notes ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export async function loadEventFinanceDashboard(input: {
  tenantId: string;
  eventId: string;
  filters?: FinanceLedgerFilters;
}): Promise<FinanceResult<{ dashboard: EventFinanceDashboardData }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const [event, sourceRows, entryRows, sponsorRows] = await Promise.all([
        tx.event.findFirst({
          where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
          select: {
            id: true,
            slug: true,
            title: true,
            timezone: true,
            status: true,
          },
        }),
        tx.eventFundingSource.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId },
          orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
        }),
        tx.eventFinancialEntry.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId },
          orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        }),
        tx.sponsor.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
          select: {
            id: true,
            name: true,
            isActive: true,
            contractValueCents: true,
            tier: { select: { name: true, priceCents: true } },
          },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        }),
      ]);

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      const sources = sourceRows.map(mapSourceRow);
      const allEntries = entryRows.map(mapEntryRow);
      const sponsors: EventSponsorContractInput[] = sponsorRows.map((sponsor) => {
        const directCents = sponsor.contractValueCents ?? 0;
        const tierCents = sponsor.tier?.priceCents ?? 0;
        return {
          sponsorId: sponsor.id,
          sponsorName: sponsor.name,
          tierName: sponsor.tier?.name ?? null,
          effectiveContractCents: directCents > 0 ? directCents : tierCents,
          isActive: sponsor.isActive,
        };
      });

      const summary = computeEventFinanceSummary({
        sources,
        entries: allEntries,
        sponsors,
      });

      const filteredEntries = filterFinancialEntries(allEntries, input.filters ?? {});

      return {
        ok: true as const,
        dashboard: {
          event,
          sources,
          allEntries,
          filteredEntries,
          sponsors,
          summary,
        },
      };
    });
  } catch (error) {
    logger.error('finance.load_dashboard_failed', {
      tenantId: input.tenantId,
      eventId: input.eventId,
      error: errorMessage(error),
    });
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível carregar os dados financeiros do evento.',
    };
  }
}

export async function createFundingSource(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  name: string;
  kind: FundingSourceKind;
  codeOrProcess?: string | null;
  approvedCents: number;
  restrictedCategories?: readonly FinancialCategory[];
  sponsorId?: string | null;
  notes?: string | null;
}): Promise<FinanceResult<{ sourceId: string }>> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 180) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe o nome da fonte ou edital (entre 2 e 180 caracteres).',
    };
  }
  if (!isFundingSourceKind(input.kind)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Selecione uma natureza de fonte válida.',
    };
  }
  if (
    !Number.isInteger(input.approvedCents) ||
    input.approvedCents < 0 ||
    input.approvedCents > MAX_FINANCE_CENTS
  ) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe um valor aprovado/contratado válido.',
    };
  }

  const restrictedCategories = (input.restrictedCategories ?? []).filter(isFinancialCategory);
  const codeOrProcess = (input.codeOrProcess ?? '').trim().slice(0, 120) || null;
  const notes = (input.notes ?? '').trim().slice(0, 2000) || null;

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      const created = await tx.eventFundingSource.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          eventId: input.eventId,
          name,
          kind: input.kind,
          codeOrProcess,
          approvedCents: input.approvedCents,
          restrictedCategories,
          sponsorId: input.sponsorId ?? null,
          notes,
        },
        select: { id: true },
      });

      return { ok: true as const, sourceId: created.id };
    });

    if (result.ok) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'CREATE',
        entityType: 'EventFundingSource',
        entityId: result.sourceId,
        changes: {
          name: { from: null, to: name },
          kind: { from: null, to: input.kind },
          approvedCents: { from: null, to: input.approvedCents },
        },
      });
    }

    return result;
  } catch (error) {
    logger.error('finance.create_source_failed', {
      tenantId: input.tenantId,
      eventId: input.eventId,
      error: errorMessage(error),
    });
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível cadastrar a fonte de recurso.',
    };
  }
}

export async function deleteFundingSource(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  sourceId: string;
}): Promise<FinanceResult<{ deletedId: string }>> {
  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const source = await tx.eventFundingSource.findFirst({
        where: { id: input.sourceId, tenantId: input.tenantId, eventId: input.eventId },
        select: { id: true, name: true },
      });

      if (!source) {
        return {
          ok: false as const,
          code: 'SOURCE_NOT_FOUND' as const,
          message: 'Fonte de recurso não encontrada.',
        };
      }

      const activeEntries = await tx.eventFinancialEntry.count({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          sourceId: source.id,
          status: { not: 'CANCELED' },
        },
      });

      if (activeEntries > 0) {
        return {
          ok: false as const,
          code: 'SOURCE_HAS_ENTRIES' as const,
          message:
            'Esta fonte possui lançamentos ativos vinculados. Remova ou reatribua os lançamentos antes de excluí-la.',
        };
      }

      await tx.eventFundingSource.delete({
        where: { id: source.id },
      });

      return { ok: true as const, deletedId: source.id, deletedName: source.name };
    });

    if (result.ok) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'DELETE',
        entityType: 'EventFundingSource',
        entityId: result.deletedId,
        changes: { name: { from: result.deletedName, to: null } },
      });
      return { ok: true, deletedId: result.deletedId };
    }

    return result;
  } catch (error) {
    logger.error('finance.delete_source_failed', {
      tenantId: input.tenantId,
      eventId: input.eventId,
      sourceId: input.sourceId,
      error: errorMessage(error),
    });
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível excluir a fonte de recurso.',
    };
  }
}

export async function importSponsorContractsAsSources(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  occurredOn?: string | null;
}): Promise<FinanceResult<{ importedCount: number }>> {
  const occurredOn = normalizeDateKey(input.occurredOn, todayIsoKey()) ?? todayIsoKey();

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const [existingSources, sponsors] = await Promise.all([
        tx.eventFundingSource.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId, sponsorId: { not: null } },
          select: { sponsorId: true },
        }),
        tx.sponsor.findMany({
          where: {
            tenantId: input.tenantId,
            eventId: input.eventId,
            isActive: true,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            taxId: true,
            contractValueCents: true,
            tier: { select: { name: true, priceCents: true } },
          },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        }),
      ]);

      const alreadyLinked = new Set(
        existingSources.map((s) => s.sponsorId).filter((id): id is string => Boolean(id)),
      );

      const candidates = sponsors
        .map((sponsor) => {
          const direct = sponsor.contractValueCents ?? 0;
          const tierPrice = sponsor.tier?.priceCents ?? 0;
          const cents = direct > 0 ? direct : tierPrice;
          return { ...sponsor, effectiveCents: cents };
        })
        .filter((sponsor) => sponsor.effectiveCents > 0 && !alreadyLinked.has(sponsor.id));

      if (candidates.length === 0) {
        return {
          ok: false as const,
          code: 'NO_SPONSORS_TO_IMPORT' as const,
          message:
            'Não há contratos de patrocínio ativos com valor pendente de importação neste evento.',
        };
      }

      for (const sponsor of candidates) {
        const sourceId = randomUUID();
        const tierLabel = sponsor.tier?.name ? `Cota ${sponsor.tier.name}` : 'Patrocínio direto';

        await tx.eventFundingSource.create({
          data: {
            id: sourceId,
            tenantId: input.tenantId,
            eventId: input.eventId,
            name: `Patrocínio — ${sponsor.name}`.slice(0, 180),
            kind: 'SPONSORSHIP',
            codeOrProcess: tierLabel.slice(0, 120),
            approvedCents: sponsor.effectiveCents,
            restrictedCategories: [],
            sponsorId: sponsor.id,
          },
        });

        await tx.eventFinancialEntry.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            eventId: input.eventId,
            sourceId,
            type: 'INCOME',
            status: 'COMMITTED',
            category: 'SPONSORSHIP_REVENUE',
            title: `Contrato de patrocínio — ${sponsor.name} (${tierLabel})`.slice(0, 200),
            amountCents: sponsor.effectiveCents,
            occurredOn,
            counterpartyName: sponsor.name.slice(0, 180),
            counterpartyTaxId: sponsor.taxId?.slice(0, 32) ?? null,
            createdById: input.actorId,
          },
        });
      }

      return { ok: true as const, importedCount: candidates.length };
    });

    if (result.ok) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'CREATE',
        entityType: 'EventFinanceSponsorImport',
        entityId: input.eventId,
        changes: { importedCount: { from: 0, to: result.importedCount } },
      });
    }

    return result;
  } catch (error) {
    logger.error('finance.import_sponsors_failed', {
      tenantId: input.tenantId,
      eventId: input.eventId,
      error: errorMessage(error),
    });
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível importar os contratos de patrocínio.',
    };
  }
}

export async function createFinancialEntry(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  sourceId?: string | null;
  type: FinancialEntryType;
  status: FinancialEntryStatus;
  category: FinancialCategory;
  title: string;
  amountCents: number;
  occurredOn: string;
  settledOn?: string | null;
  counterpartyName?: string | null;
  counterpartyTaxId?: string | null;
  documentNumber?: string | null;
  notes?: string | null;
}): Promise<FinanceResult<{ entryId: string }>> {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 200) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe a descrição do lançamento (entre 2 e 200 caracteres).',
    };
  }
  if (!isFinancialEntryType(input.type)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione o tipo (Entrada ou Saída).' };
  }
  if (!isFinancialEntryStatus(input.status)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione uma situação válida.' };
  }
  if (!isFinancialCategory(input.category)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione uma rubrica/categoria válida.' };
  }
  if (
    !Number.isInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > MAX_FINANCE_CENTS
  ) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe um valor em reais maior que zero.',
    };
  }

  const occurredOn = normalizeDateKey(input.occurredOn);
  if (!occurredOn) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe a data de competência no formato AAAA-MM-DD.',
    };
  }

  const settledOn =
    input.status === 'SETTLED'
      ? (normalizeDateKey(input.settledOn, occurredOn) ?? occurredOn)
      : normalizeDateKey(input.settledOn);

  const sourceId = (input.sourceId ?? '').trim() || null;

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      if (sourceId) {
        const source = await tx.eventFundingSource.findFirst({
          where: { id: sourceId, tenantId: input.tenantId, eventId: input.eventId },
          select: { id: true },
        });
        if (!source) {
          return {
            ok: false as const,
            code: 'SOURCE_NOT_FOUND' as const,
            message: 'A fonte pagadora selecionada não pertence a este evento.',
          };
        }
      }

      const created = await tx.eventFinancialEntry.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          eventId: input.eventId,
          sourceId,
          type: input.type,
          status: input.status,
          category: input.category,
          title,
          amountCents: input.amountCents,
          occurredOn,
          settledOn,
          counterpartyName: (input.counterpartyName ?? '').trim().slice(0, 180) || null,
          counterpartyTaxId: (input.counterpartyTaxId ?? '').trim().slice(0, 32) || null,
          documentNumber: (input.documentNumber ?? '').trim().slice(0, 80) || null,
          notes: (input.notes ?? '').trim().slice(0, 2000) || null,
          createdById: input.actorId,
        },
        select: { id: true },
      });

      return { ok: true as const, entryId: created.id };
    });

    if (result.ok) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'CREATE',
        entityType: 'EventFinancialEntry',
        entityId: result.entryId,
        changes: {
          title: { from: null, to: title },
          type: { from: null, to: input.type },
          status: { from: null, to: input.status },
          amountCents: { from: null, to: input.amountCents },
        },
      });
    }

    return result;
  } catch (error) {
    logger.error('finance.create_entry_failed', {
      tenantId: input.tenantId,
      eventId: input.eventId,
      error: errorMessage(error),
    });
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível registrar o lançamento financeiro.',
    };
  }
}

export async function updateFinancialEntryStatus(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  entryId: string;
  status: FinancialEntryStatus;
  settledOn?: string | null;
}): Promise<FinanceResult<{ entryId: string }>> {
  if (!isFinancialEntryStatus(input.status)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Situação financeira inválida.' };
  }

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const existing = await tx.eventFinancialEntry.findFirst({
        where: { id: input.entryId, tenantId: input.tenantId, eventId: input.eventId },
        select: { id: true, status: true, settledOn: true },
      });

      if (!existing) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Lançamento financeiro não encontrado.',
        };
      }

      const nextSettledOn =
        input.status === 'SETTLED'
          ? (normalizeDateKey(input.settledOn, existing.settledOn ?? todayIsoKey()) ??
            todayIsoKey())
          : null;

      await tx.eventFinancialEntry.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          settledOn: nextSettledOn,
        },
      });

      return {
        ok: true as const,
        entryId: existing.id,
        previousStatus: existing.status,
      };
    });

    if (result.ok) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'UPDATE',
        entityType: 'EventFinancialEntry',
        entityId: result.entryId,
        changes: {
          status: { from: result.previousStatus, to: input.status },
        },
      });
      return { ok: true, entryId: result.entryId };
    }

    return result;
  } catch (error) {
    logger.error('finance.update_entry_status_failed', {
      tenantId: input.tenantId,
      eventId: input.eventId,
      entryId: input.entryId,
      error: errorMessage(error),
    });
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível atualizar a situação do lançamento.',
    };
  }
}

export async function deleteFinancialEntry(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  entryId: string;
}): Promise<FinanceResult<{ deletedId: string }>> {
  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const existing = await tx.eventFinancialEntry.findFirst({
        where: { id: input.entryId, tenantId: input.tenantId, eventId: input.eventId },
        select: { id: true, title: true, amountCents: true },
      });

      if (!existing) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Lançamento financeiro não encontrado.',
        };
      }

      await tx.eventFinancialEntry.delete({
        where: { id: existing.id },
      });

      return {
        ok: true as const,
        deletedId: existing.id,
        deletedTitle: existing.title,
      };
    });

    if (result.ok) {
      await recordAudit({
        tenantId: input.tenantId,
        userId: input.actorId,
        action: 'DELETE',
        entityType: 'EventFinancialEntry',
        entityId: result.deletedId,
        changes: { title: { from: result.deletedTitle, to: null } },
      });
      return { ok: true, deletedId: result.deletedId };
    }

    return result;
  } catch (error) {
    logger.error('finance.delete_entry_failed', {
      tenantId: input.tenantId,
      eventId: input.eventId,
      entryId: input.entryId,
      error: errorMessage(error),
    });
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível excluir o lançamento financeiro.',
    };
  }
}

export async function exportEventFinanceCsv(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  format: 'lancamentos' | 'prestacao';
  filters?: FinanceLedgerFilters;
}): Promise<FinanceResult<{ filename: string; csv: string }>> {
  const loaded = await loadEventFinanceDashboard({
    tenantId: input.tenantId,
    eventId: input.eventId,
    filters: input.filters,
  });

  if (!loaded.ok) return loaded;

  const { dashboard } = loaded;
  const slug = dashboard.event.slug || 'evento';
  const csv =
    input.format === 'prestacao'
      ? buildAccountabilityReportCsv(dashboard.summary)
      : buildFinancialEntriesCsv({
          entries: dashboard.filteredEntries,
          sources: dashboard.sources,
        });

  const filename =
    input.format === 'prestacao'
      ? `prestacao-contas-${slug}.csv`
      : `lancamentos-financeiros-${slug}.csv`;

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.actorId,
    action: 'EXPORT',
    entityType: 'EventFinance',
    entityId: input.eventId,
    changes: {
      format: { from: null, to: input.format },
      rows: {
        from: null,
        to:
          input.format === 'prestacao'
            ? dashboard.sources.length
            : dashboard.filteredEntries.length,
      },
    },
  });

  return { ok: true, filename, csv };
}

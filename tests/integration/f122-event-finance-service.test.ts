import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';
import { getEventAreaCounts } from '@/lib/events/event-area-counts';
import {
  createFinancialEntry,
  createFundingSource,
  deleteFinancialEntry,
  deleteFundingSource,
  exportEventFinanceCsv,
  filterFinancialEntries,
  getFinancialEntryForEdit,
  getFundingSourceForEdit,
  importSponsorContractsAsSources,
  loadEventFinanceDashboard,
  updateFinancialEntry,
  updateFinancialEntryStatus,
  updateFundingSource,
} from '@/lib/finance/event-finance-service';

const RUN = randomUUID().slice(0, 8);

let tenantAId: string;
let tenantBId: string;
let eventAId: string;
let actorId: string;

beforeAll(async () => {
  tenantAId = randomUUID();
  tenantBId = randomUUID();
  eventAId = randomUUID();
  actorId = randomUUID();

  await adminPrisma.user.create({
    data: {
      id: actorId,
      email: `f122-finance-${RUN}@koveno.test`,
      name: 'Gestor Financeiro F122',
      emailVerified: true,
    },
  });

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantAId,
        slug: `f122-fin-a-${RUN}`,
        name: `Instituição Finanças A ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: 'America/Bahia',
      },
      {
        id: tenantBId,
        slug: `f122-fin-b-${RUN}`,
        name: `Instituição Finanças B ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: 'America/Bahia',
      },
    ],
  });

  await withTenant(tenantAId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventAId,
        tenantId: tenantAId,
        slug: `congresso-f122-${RUN}`,
        title: 'Congresso de Pesquisa e Fomento',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-11-20T12:00:00.000Z'),
        endsAt: new Date('2026-11-22T21:00:00.000Z'),
        timezone: 'America/Bahia',
      },
    });

    await tx.sponsor.create({
      data: {
        id: randomUUID(),
        tenantId: tenantAId,
        eventId: eventAId,
        name: 'FAPEG / Parceria Inovação',
        slug: `fapeg-parceria-${RUN}`,
        isActive: true,
        contractValueCents: 1_200_000,
        taxId: '12.345.678/0001-99',
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({
    where: { id: { in: [tenantAId, tenantBId] } },
  });
  await adminPrisma.user.deleteMany({
    where: { id: actorId },
  });
});

describe('FASE 122 — Integração: Serviço Financeiro, Fomento, Importação de Patrocínio e RLS', () => {
  it('cadastra edital, importa contrato de patrocínio, movimenta entradas/saídas, protege exclusão de fonte ativa e isola tenants sob RLS', async () => {
    // 1. Cadastra edital público com rubrica carimbada
    const srcResult = await createFundingSource({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      name: 'Edital FAPEG 04/2026 — Eventos Científicos',
      kind: 'PUBLIC_GRANT',
      codeOrProcess: 'SEI 23070.000111/2026-01',
      approvedCents: 2_500_000,
      restrictedCategories: ['TRAVEL_AND_PER_DIEM'],
    });
    expect(srcResult.ok).toBe(true);
    if (!srcResult.ok) return;

    // 2. Importa patrocinadores ativos do evento com valor de contrato > 0
    const impResult = await importSponsorContractsAsSources({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      occurredOn: '2026-11-01',
    });
    expect(impResult).toEqual({ ok: true, importedCount: 1 });

    // Repetir a importação avisa que não há novos contratos pendentes
    const secondImp = await importSponsorContractsAsSources({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
    });
    expect(secondImp.ok).toBe(false);
    if (!secondImp.ok) expect(secondImp.code).toBe('NO_SPONSORS_TO_IMPORT');

    // 3. Registra entrada de repasse do edital e saída de passagens
    const incomeRes = await createFinancialEntry({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      sourceId: srcResult.sourceId,
      type: 'INCOME',
      status: 'SETTLED',
      category: 'GRANT_DISBURSEMENT',
      title: 'Liberação 1ª parcela FAPEG',
      amountCents: 2_000_000,
      occurredOn: '2026-11-05',
      settledOn: '2026-11-05',
      counterpartyName: 'FAPEG',
      documentNumber: 'OB-2026-101',
    });
    expect(incomeRes.ok).toBe(true);

    const expenseRes = await createFinancialEntry({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      sourceId: srcResult.sourceId,
      type: 'EXPENSE',
      status: 'PLANNED',
      category: 'TRAVEL_AND_PER_DIEM',
      title: 'Passagens convidados nacionais',
      amountCents: 600_000,
      occurredOn: '2026-11-10',
      counterpartyName: 'Companhia Aérea',
      documentNumber: 'NF-881',
    });
    expect(expenseRes.ok).toBe(true);
    if (!expenseRes.ok) return;

    // 4. Recusa exclusão da fonte enquanto houver lançamentos ativos vinculados
    const blockedDelete = await deleteFundingSource({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      sourceId: srcResult.sourceId,
    });
    expect(blockedDelete.ok).toBe(false);
    if (!blockedDelete.ok) expect(blockedDelete.code).toBe('SOURCE_HAS_ENTRIES');

    // 5. Ciclo completo PLANNED -> COMMITTED -> SETTLED (anexando Nº NF) -> CANCELED + painel consolidado
    const commitRes = await updateFinancialEntryStatus({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      entryId: expenseRes.entryId,
      status: 'COMMITTED',
    });
    expect(commitRes.ok).toBe(true);

    const settleRes = await updateFinancialEntryStatus({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      entryId: expenseRes.entryId,
      status: 'SETTLED',
      settledOn: '2026-11-12',
      documentNumber: 'NF-e 881-A',
    });
    expect(settleRes.ok).toBe(true);

    const dashRes = await loadEventFinanceDashboard({
      tenantId: tenantAId,
      eventId: eventAId,
    });
    expect(dashRes.ok).toBe(true);
    if (!dashRes.ok) return;

    expect(dashRes.dashboard.sources).toHaveLength(2);
    expect(dashRes.dashboard.allEntries).toHaveLength(3); // 1 repasse + 1 patrocínio importado + 1 despesa
    expect(dashRes.dashboard.summary.totalApprovedSourcesCents).toBe(3_700_000); // 25k + 12k
    expect(dashRes.dashboard.summary.settledIncomeCents).toBe(2_000_000);
    expect(dashRes.dashboard.summary.committedIncomeCents).toBe(1_200_000);
    expect(dashRes.dashboard.summary.settledExpenseCents).toBe(600_000);
    expect(dashRes.dashboard.summary.cashBalanceCents).toBe(1_400_000);

    const countsRes = await getEventAreaCounts({ tenantId: tenantAId, eventId: eventAId });
    expect(countsRes.ok).toBe(true);
    if (countsRes.ok) {
      expect(countsRes.counts.financialEntries).toBe(3);
    }

    // 6. Exporta CSV de prestação de contas e grava trilha EXPORT
    const exportRes = await exportEventFinanceCsv({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      format: 'prestacao',
    });
    expect(exportRes.ok).toBe(true);
    if (exportRes.ok) {
      expect(exportRes.filename).toContain('prestacao-contas-');
      expect(exportRes.csv).toContain('Edital FAPEG 04/2026');
    }

    // 7. Isolamento multi-tenant RLS: Tenant B não enxerga nem altera fontes/lançamentos do Tenant A
    const crossTenantLoad = await loadEventFinanceDashboard({
      tenantId: tenantBId,
      eventId: eventAId,
    });
    expect(crossTenantLoad.ok).toBe(false);

    const crossTenantRows = await withTenant(tenantBId, async (tx) => {
      const [sources, entries] = await Promise.all([
        tx.eventFundingSource.count(),
        tx.eventFinancialEntry.count(),
      ]);
      return { sources, entries };
    });
    expect(crossTenantRows).toEqual({ sources: 0, entries: 0 });

    const crossDelete = await deleteFinancialEntry({
      tenantId: tenantBId,
      eventId: eventAId,
      actorId,
      entryId: expenseRes.entryId,
    });
    expect(crossDelete.ok).toBe(false);
  });

  it('FASE 124: edita fonte (aditivo), reatribui lançamento para corrigir glosa e filtra pendências documentais', async () => {
    const srcRestrita = await createFundingSource({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      name: 'Edital CAPES Restrito',
      kind: 'PUBLIC_GRANT',
      approvedCents: 1_000_000,
      restrictedCategories: ['TRAVEL_AND_PER_DIEM'],
    });
    const srcLivre = await createFundingSource({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      name: 'Recurso Próprio Livre',
      kind: 'OWN_REVENUE',
      approvedCents: 500_000,
      restrictedCategories: [],
    });
    if (!srcRestrita.ok || !srcLivre.ok) throw new Error('Falha ao criar fontes F124');

    const loadedSrc = await getFundingSourceForEdit({
      tenantId: tenantAId,
      eventId: eventAId,
      sourceId: srcLivre.sourceId,
    });
    expect(loadedSrc.ok).toBe(true);

    const updSrc = await updateFundingSource({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      sourceId: srcLivre.sourceId,
      name: 'Recurso Próprio Livre (Aditivado)',
      kind: 'OWN_REVENUE',
      approvedCents: 800_000,
      restrictedCategories: [],
    });
    expect(updSrc.ok).toBe(true);

    const badExpense = await createFinancialEntry({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      sourceId: srcRestrita.sourceId,
      type: 'EXPENSE',
      status: 'SETTLED',
      category: 'CATERING',
      title: 'Coffee-break lançado errado na CAPES',
      amountCents: 150_000,
      occurredOn: '2026-11-15',
      settledOn: '2026-11-15',
      documentNumber: null,
    });
    expect(badExpense.ok).toBe(true);
    if (!badExpense.ok) return;

    const dashBefore = await loadEventFinanceDashboard({
      tenantId: tenantAId,
      eventId: eventAId,
      filters: { compliance: 'GLOSA' },
    });
    expect(dashBefore.ok).toBe(true);
    if (dashBefore.ok) {
      expect(dashBefore.dashboard.filteredEntries.some((e) => e.id === badExpense.entryId)).toBe(true);
      expect(
        filterFinancialEntries(
          dashBefore.dashboard.allEntries,
          { compliance: 'MISSING_DOCUMENT' },
          dashBefore.dashboard.sources,
        ).some((e) => e.id === badExpense.entryId),
      ).toBe(true);
    }

    const editLoaded = await getFinancialEntryForEdit({
      tenantId: tenantAId,
      eventId: eventAId,
      entryId: badExpense.entryId,
    });
    expect(editLoaded.ok).toBe(true);

    // Reatribui para a fonte livre e preenche NF-e
    const updEntry = await updateFinancialEntry({
      tenantId: tenantAId,
      eventId: eventAId,
      actorId,
      entryId: badExpense.entryId,
      sourceId: srcLivre.sourceId,
      type: 'EXPENSE',
      status: 'SETTLED',
      category: 'CATERING',
      title: 'Coffee-break corrigido para Recurso Próprio',
      amountCents: 150_000,
      occurredOn: '2026-11-15',
      settledOn: '2026-11-15',
      documentNumber: 'NF-e 999',
    });
    expect(updEntry.ok).toBe(true);

    const dashAfter = await loadEventFinanceDashboard({
      tenantId: tenantAId,
      eventId: eventAId,
      filters: { compliance: 'GLOSA' },
    });
    expect(dashAfter.ok).toBe(true);
    if (dashAfter.ok) {
      expect(dashAfter.dashboard.filteredEntries.some((e) => e.id === badExpense.entryId)).toBe(
        false,
      );
    }
  });
});

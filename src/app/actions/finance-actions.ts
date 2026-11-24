'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SERVER ACTIONS — Gestão Financeira, Fomento e Prestação de Contas (FASE 122)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';

import {
  isFinancialCategory,
  isFinancialEntryStatus,
  isFinancialEntryType,
  isFundingSourceKind,
  parseBrlToCents,
  type FinancialCategory,
} from '@/domain/finance/event-finance-rules';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { isUuid } from '@/domain/validation/id-rules';
import { guardAction, type ActionGuardState } from '@/lib/auth/guard-action';
import {
  createFinancialEntry,
  createFundingSource,
  deleteFinancialEntry,
  deleteFundingSource,
  importSponsorContractsAsSources,
  updateFinancialEntryStatus,
} from '@/lib/finance/event-finance-service';

export type FinanceActionState = ActionGuardState;

function revalidateFinancePaths(tenantSlug: string, eventId: string): void {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));
}

function readStr(formData: FormData, key: string): string {
  const val = formData.get(key);
  return typeof val === 'string' ? val.trim() : '';
}

export async function createFundingSourceAction(
  _prev: FinanceActionState | null,
  formData: FormData,
): Promise<FinanceActionState> {
  const tenantSlug = readStr(formData, 'tenantSlug');
  const eventId = readStr(formData, 'eventId');

  if (!tenantSlug || !isUuid(eventId)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Evento inválido.' };
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });
  if (!auth.ok) return auth.state;

  const name = readStr(formData, 'name');
  const kindRaw = readStr(formData, 'kind') || 'PUBLIC_GRANT';
  const codeOrProcess = readStr(formData, 'codeOrProcess');
  const approvedRaw = readStr(formData, 'approvedAmount');
  const notes = readStr(formData, 'notes');
  const restrictedRaw = formData
    .getAll('restrictedCategories')
    .filter((v): v is string => typeof v === 'string');

  if (!isFundingSourceKind(kindRaw)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione uma natureza de fonte válida.' };
  }

  const approvedCents = parseBrlToCents(approvedRaw || '0', { allowZero: true });
  if (approvedCents === null) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe um valor aprovado válido em reais (ex.: 25.000,00).',
    };
  }

  const restrictedCategories: FinancialCategory[] = restrictedRaw.filter(isFinancialCategory);

  const result = await createFundingSource({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    name,
    kind: kindRaw,
    codeOrProcess: codeOrProcess || null,
    approvedCents,
    restrictedCategories,
    notes: notes || null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateFinancePaths(tenantSlug, eventId);
  return { ok: true, message: 'Fonte de recurso cadastrada com sucesso.' };
}

export async function deleteFundingSourceAction(
  _prev: FinanceActionState | null,
  formData: FormData,
): Promise<FinanceActionState> {
  const tenantSlug = readStr(formData, 'tenantSlug');
  const eventId = readStr(formData, 'eventId');
  const sourceId = readStr(formData, 'sourceId');

  if (!tenantSlug || !isUuid(eventId) || !isUuid(sourceId)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Identificador de fonte inválido.' };
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await deleteFundingSource({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    sourceId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateFinancePaths(tenantSlug, eventId);
  return { ok: true, message: 'Fonte de recurso excluída.' };
}

export async function importSponsorsToFinanceAction(
  _prev: FinanceActionState | null,
  formData: FormData,
): Promise<FinanceActionState> {
  const tenantSlug = readStr(formData, 'tenantSlug');
  const eventId = readStr(formData, 'eventId');

  if (!tenantSlug || !isUuid(eventId)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Evento inválido.' };
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await importSponsorContractsAsSources({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateFinancePaths(tenantSlug, eventId);
  return {
    ok: true,
    message: `${result.importedCount} contrato(s) de patrocínio importado(s) como fonte e entrada prevista.`,
  };
}

export async function createFinancialEntryAction(
  _prev: FinanceActionState | null,
  formData: FormData,
): Promise<FinanceActionState> {
  const tenantSlug = readStr(formData, 'tenantSlug');
  const eventId = readStr(formData, 'eventId');

  if (!tenantSlug || !isUuid(eventId)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Evento inválido.' };
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });
  if (!auth.ok) return auth.state;

  const typeRaw = readStr(formData, 'type') || 'EXPENSE';
  const statusRaw = readStr(formData, 'status') || 'PLANNED';
  const categoryRaw = readStr(formData, 'category') || 'OTHER';
  const sourceIdRaw = readStr(formData, 'sourceId');
  const title = readStr(formData, 'title');
  const amountRaw = readStr(formData, 'amount');
  const occurredOn = readStr(formData, 'occurredOn');
  const settledOn = readStr(formData, 'settledOn');
  const counterpartyName = readStr(formData, 'counterpartyName');
  const counterpartyTaxId = readStr(formData, 'counterpartyTaxId');
  const documentNumber = readStr(formData, 'documentNumber');
  const notes = readStr(formData, 'notes');

  if (!isFinancialEntryType(typeRaw)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione o tipo do lançamento.' };
  }
  if (!isFinancialEntryStatus(statusRaw)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione a situação do lançamento.' };
  }
  if (!isFinancialCategory(categoryRaw)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione a rubrica/categoria.' };
  }

  const amountCents = parseBrlToCents(amountRaw, { allowZero: false });
  if (amountCents === null) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe um valor positivo válido em reais (ex.: 1.250,00).',
    };
  }

  if (sourceIdRaw && !isUuid(sourceIdRaw)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Fonte pagadora inválida.' };
  }

  const result = await createFinancialEntry({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    sourceId: sourceIdRaw || null,
    type: typeRaw,
    status: statusRaw,
    category: categoryRaw,
    title,
    amountCents,
    occurredOn,
    settledOn: settledOn || null,
    counterpartyName: counterpartyName || null,
    counterpartyTaxId: counterpartyTaxId || null,
    documentNumber: documentNumber || null,
    notes: notes || null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateFinancePaths(tenantSlug, eventId);
  return { ok: true, message: 'Lançamento financeiro registrado com sucesso.' };
}

export async function updateFinancialEntryStatusAction(
  _prev: FinanceActionState | null,
  formData: FormData,
): Promise<FinanceActionState> {
  const tenantSlug = readStr(formData, 'tenantSlug');
  const eventId = readStr(formData, 'eventId');
  const entryId = readStr(formData, 'entryId');
  const statusRaw = readStr(formData, 'status');

  if (!tenantSlug || !isUuid(eventId) || !isUuid(entryId)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Lançamento inválido.' };
  }
  if (!isFinancialEntryStatus(statusRaw)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Situação financeira inválida.' };
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await updateFinancialEntryStatus({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    entryId,
    status: statusRaw,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateFinancePaths(tenantSlug, eventId);
  return { ok: true, message: 'Situação do lançamento atualizada.' };
}

export async function deleteFinancialEntryAction(
  _prev: FinanceActionState | null,
  formData: FormData,
): Promise<FinanceActionState> {
  const tenantSlug = readStr(formData, 'tenantSlug');
  const eventId = readStr(formData, 'eventId');
  const entryId = readStr(formData, 'entryId');

  if (!tenantSlug || !isUuid(eventId) || !isUuid(entryId)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Lançamento inválido.' };
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await deleteFinancialEntry({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    entryId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateFinancePaths(tenantSlug, eventId);
  return { ok: true, message: 'Lançamento financeiro excluído.' };
}

'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SERVER ACTIONS — Curadoria e Publicação de Anais (FASE 111)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import { guardAction, type ActionGuardState } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  importAcceptedSubmissionsToProceedings,
  publishProceedingsVolume,
  unpublishProceedingsVolume,
  updateProceedingsEntry,
  upsertProceedingsVolume,
} from '@/lib/proceedings/proceedings-service';

export type ProceedingsActionState = ActionGuardState;

function revalidateProceedingsPaths(tenantSlug: string, eventId: string) {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/anais`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));
  revalidatePath(tenantPath(tenantSlug, '/comite'));
  revalidatePath(tenantPath(tenantSlug, '/eventos'));
}

const volumeSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  title: z.string().trim().min(5, 'Informe o título dos anais (mínimo 5 caracteres).').max(300),
  subtitle: z.string().trim().max(400).optional(),
  volumeLabel: z.string().trim().max(80).optional(),
  editionYear: z.coerce.number().int().min(1900).max(2100),
  editors: z.string().trim().max(500).optional(),
  isbn: z.string().trim().max(32).optional(),
  issn: z.string().trim().max(32).optional(),
  publisherName: z.string().trim().max(200).optional(),
  preface: z.string().trim().max(5000).optional(),
});

export async function saveProceedingsVolumeAction(
  _prev: ProceedingsActionState | null,
  formData: FormData,
): Promise<ProceedingsActionState> {
  const parsed = volumeSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    title: formData.get('title'),
    subtitle: (formData.get('subtitle') as string) || undefined,
    volumeLabel: (formData.get('volumeLabel') as string) || undefined,
    editionYear: formData.get('editionYear'),
    editors: (formData.get('editors') as string) || undefined,
    isbn: (formData.get('isbn') as string) || undefined,
    issn: (formData.get('issn') as string) || undefined,
    publisherName: (formData.get('publisherName') as string) || undefined,
    preface: (formData.get('preface') as string) || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados do volume inválidos.',
    };
  }

  const data = parsed.data;
  const context = await guardAction<ProceedingsActionState>({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_DECIDE,
  });
  if (!context.ok) return context.state;

  const result = await upsertProceedingsVolume({
    tenantId: context.tenantId,
    eventId: data.eventId,
    userId: context.userId,
    title: data.title,
    subtitle: data.subtitle ?? null,
    volumeLabel: data.volumeLabel ?? null,
    editionYear: data.editionYear,
    editors: data.editors ?? null,
    isbn: data.isbn ?? null,
    issn: data.issn ?? null,
    publisherName: data.publisherName ?? null,
    preface: data.preface ?? null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidateProceedingsPaths(data.tenantSlug, data.eventId);
  return { ok: true, message: 'Ficha do volume de anais salva.' };
}

const eventScopeSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
});

export async function importAcceptedToProceedingsAction(
  _prev: ProceedingsActionState | null,
  formData: FormData,
): Promise<ProceedingsActionState> {
  const parsed = eventScopeSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Evento inválido.' };
  }

  const data = parsed.data;
  const context = await guardAction<ProceedingsActionState>({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_DECIDE,
  });
  if (!context.ok) return context.state;

  const result = await importAcceptedSubmissionsToProceedings({
    tenantId: context.tenantId,
    eventId: data.eventId,
    userId: context.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateProceedingsPaths(data.tenantSlug, data.eventId);
  return {
    ok: true,
    message:
      result.importedCount > 0
        ? `${result.importedCount} ${result.importedCount === 1 ? 'trabalho aceito importado' : 'trabalhos aceitos importados'} para o volume.`
        : 'Todos os trabalhos aceitos já estão listados nos anais.',
  };
}

function optionalInt(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : NaN;
}

const entrySchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  entryId: z.string().uuid(),
  displayOrder: z.coerce.number().int().min(1).max(9999),
  includeInProceedings: z.boolean(),
  sectionName: z.string().trim().max(200).optional(),
  externalDoi: z.string().trim().max(200).optional(),
  publicFileKind: z.string().trim().max(40).optional(),
});

export async function updateProceedingsEntryAction(
  _prev: ProceedingsActionState | null,
  formData: FormData,
): Promise<ProceedingsActionState> {
  const parsed = entrySchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    entryId: formData.get('entryId'),
    displayOrder: formData.get('displayOrder'),
    includeInProceedings: formData.get('includeInProceedings') === 'on',
    sectionName: (formData.get('sectionName') as string) || undefined,
    externalDoi: (formData.get('externalDoi') as string) || undefined,
    publicFileKind: (formData.get('publicFileKind') as string) || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados do trabalho inválidos.',
    };
  }

  const data = parsed.data;
  const context = await guardAction<ProceedingsActionState>({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_DECIDE,
  });
  if (!context.ok) return context.state;

  const pageStart = optionalInt(formData.get('pageStart'));
  const pageEnd = optionalInt(formData.get('pageEnd'));
  if (Number.isNaN(pageStart) || Number.isNaN(pageEnd)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Numeração de páginas inválida.' };
  }

  const result = await updateProceedingsEntry({
    tenantId: context.tenantId,
    eventId: data.eventId,
    entryId: data.entryId,
    userId: context.userId,
    displayOrder: data.displayOrder,
    includeInProceedings: data.includeInProceedings,
    sectionName: data.sectionName ?? null,
    pageStart,
    pageEnd,
    externalDoi: data.externalDoi ?? null,
    publicFileKind: data.publicFileKind ?? null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateProceedingsPaths(data.tenantSlug, data.eventId);
  return { ok: true, message: 'Configuração do trabalho salva.' };
}

export async function publishProceedingsAction(
  _prev: ProceedingsActionState | null,
  formData: FormData,
): Promise<ProceedingsActionState> {
  const parsed = eventScopeSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Evento inválido.' };
  }

  const data = parsed.data;
  const context = await guardAction<ProceedingsActionState>({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_DECIDE,
  });
  if (!context.ok) return context.state;

  const result = await publishProceedingsVolume({
    tenantId: context.tenantId,
    eventId: data.eventId,
    userId: context.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateProceedingsPaths(data.tenantSlug, data.eventId);
  return {
    ok: true,
    message: `Anais publicados com ${result.publishedCount} ${result.publishedCount === 1 ? 'trabalho indexado' : 'trabalhos indexados'}.`,
  };
}

export async function unpublishProceedingsAction(
  _prev: ProceedingsActionState | null,
  formData: FormData,
): Promise<ProceedingsActionState> {
  const parsed = eventScopeSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Evento inválido.' };
  }

  const data = parsed.data;
  const context = await guardAction<ProceedingsActionState>({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_DECIDE,
  });
  if (!context.ok) return context.state;

  const result = await unpublishProceedingsVolume({
    tenantId: context.tenantId,
    eventId: data.eventId,
    userId: context.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateProceedingsPaths(data.tenantSlug, data.eventId);
  return { ok: true, message: 'Anais retirados da vitrine pública (retornados para rascunho).' };
}

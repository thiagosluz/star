/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Publicação de Anais, Citações e Acesso ao PDF (FASE 111)
 *
 *  Regras centrais:
 *    • Todas as leituras e escritas rodam sob `withTenant` (RLS obrigatória).
 *    • `BLIND_PDF` nunca entra na projeção pública, na escolha de arquivo nem no
 *      endpoint de PDF.
 *    • Publicar congela o `snapshot` de cada trabalho incluído (`buildProceedingsEntrySnapshot`).
 *    • Toda projeção pública passa por `assertProceedingsSemCampoProibido` antes de sair.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { logger } from '@/lib/observability/logger';
import { publicBaseUrl } from '@/lib/public-url';
import { isScanningEnabled } from '@/lib/storage/scan-service';
import { canServeFile, normalizeScanStatus, type FileScanStatus } from '@/domain/review/file-scan-rules';
import { PUBLICLY_VISIBLE_EVENT_STATUSES } from '@/domain/events/event-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  assertProceedingsSemCampoProibido,
  buildProceedingsEntrySnapshot,
  canUseFileKindInProceedings,
  normalizeExternalDoi,
  normalizePublicFileKindInput,
  validatePageRange,
  validateProceedingsVolumeInput,
  type ProceedingsAuthorView,
  type ProceedingsEntrySnapshot,
  type ProceedingsPublicFileKind,
  type ProceedingsStatus,
} from '@/domain/proceedings/proceedings-rules';
import type {
  ProceedingsVolumeCitationMeta,
  ProceedingsWorkCitationMeta,
} from '@/domain/proceedings/citation-rules';
import type { OaiRecordDescriptor, OaiSetDescriptor } from '@/domain/proceedings/indexing-rules';

export type ProceedingsErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'FORBIDDEN_FILE_KIND'
  | 'NO_ENTRIES'
  | 'INTERNAL';

export type ProceedingsResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: ProceedingsErrorCode; message: string; details?: readonly string[] };

export interface AdminProceedingsEntryView {
  id: string;
  submissionId: string;
  protocol: string;
  title: string;
  trackName: string | null;
  displayOrder: number;
  sectionName: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  externalDoi: string | null;
  publicFileKind: ProceedingsPublicFileKind | null;
  includeInProceedings: boolean;
  authorPermissionAcceptedAt: Date | null;
  availableFiles: {
    kind: ProceedingsPublicFileKind;
    fileName: string;
    version: number;
    scanStatus: FileScanStatus;
  }[];
  authorsCount: number;
}

export interface AdminProceedingsOverview {
  event: {
    id: string;
    slug: string;
    title: string;
    editionYear: number;
    status: string;
  };
  volume: {
    id: string;
    status: ProceedingsStatus;
    title: string;
    subtitle: string | null;
    volumeLabel: string | null;
    editionYear: number;
    editors: string | null;
    isbn: string | null;
    issn: string | null;
    publisherName: string | null;
    preface: string | null;
    publishedAt: Date | null;
  } | null;
  entries: AdminProceedingsEntryView[];
  pendingAcceptedCount: number;
}

export interface PublicProceedingsVolumeView {
  volume: {
    id: string;
    title: string;
    subtitle: string | null;
    volumeLabel: string | null;
    editionYear: number;
    editors: string | null;
    isbn: string | null;
    issn: string | null;
    publisherName: string | null;
    preface: string | null;
    publishedAt: Date | null;
  };
  event: {
    id: string;
    slug: string;
    title: string;
    city: string | null;
    state: string | null;
    country: string;
    startsAt: Date;
    endsAt: Date;
  };
  tenant: {
    slug: string;
    name: string;
  };
  sections: string[];
  entries: {
    id: string;
    protocol: string;
    title: string;
    abstract: string;
    keywords: string[];
    language: string;
    sectionName: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    externalDoi: string | null;
    displayOrder: number;
    hasPdf: boolean;
    authors: ProceedingsAuthorView[];
  }[];
  totalEntries: number;
}

export interface PublicProceedingsWorkView {
  volume: ProceedingsVolumeCitationMeta & {
    id: string;
    subtitle: string | null;
    preface: string | null;
    publishedAt: Date | null;
  };
  event: {
    id: string;
    slug: string;
    title: string;
  };
  tenant: {
    slug: string;
    name: string;
  };
  work: ProceedingsWorkCitationMeta & {
    id: string;
    abstract: string;
    sectionName: string | null;
    publishedAt: Date | null;
    publicFileKind: ProceedingsPublicFileKind | null;
    scanStatus: FileScanStatus | null;
    isPdfServed: boolean;
    pdfBlockedReason: string | null;
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Helpers internos de projeção segura
// ───────────────────────────────────────────────────────────────────────────────
function mapSubmissionAuthorsToPublic(
  authors: readonly {
    authorOrder: number;
    guestName: string | null;
    guestInstitution: string | null;
    guestOrcidId: string | null;
    institution: string | null;
    isCorresponding: boolean;
    user: { name: string | null; orcidId: string | null } | null;
  }[],
): ProceedingsAuthorView[] {
  return [...authors]
    .sort((a, b) => a.authorOrder - b.authorOrder)
    .map((author) => ({
      name: (author.user?.name ?? author.guestName ?? 'Autor').trim(),
      institution: (author.institution ?? author.guestInstitution ?? null)?.trim() || null,
      orcidId: (author.user?.orcidId ?? author.guestOrcidId ?? null)?.trim() || null,
      order: author.authorOrder,
      isCorresponding: Boolean(author.isCorresponding),
    }));
}

function parseEntrySnapshot(raw: unknown): ProceedingsEntrySnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || typeof obj.protocol !== 'string' || !Array.isArray(obj.authors)) {
    return null;
  }

  return {
    protocol: obj.protocol,
    title: obj.title,
    abstract: typeof obj.abstract === 'string' ? obj.abstract : '',
    keywords: Array.isArray(obj.keywords)
      ? obj.keywords.filter((item): item is string => typeof item === 'string')
      : [],
    language: typeof obj.language === 'string' ? obj.language : 'pt-BR',
    sectionName: typeof obj.sectionName === 'string' ? obj.sectionName : null,
    authors: obj.authors
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
      .map((a, idx) => ({
        name: typeof a.name === 'string' ? a.name : 'Autor',
        institution: typeof a.institution === 'string' ? a.institution : null,
        orcidId: typeof a.orcidId === 'string' ? a.orcidId : null,
        order: typeof a.order === 'number' ? a.order : idx + 1,
        isCorresponding: Boolean(a.isCorresponding),
      })),
    publishedAt: typeof obj.publishedAt === 'string' ? obj.publishedAt : new Date().toISOString(),
  };
}

function resolvePublicEntryContent(input: {
  snapshot: unknown;
  sectionName: string | null;
  submission: {
    protocol: string;
    title: string;
    abstract: string;
    keywords: string[];
    language: string;
    track: { name: string } | null;
    authors: {
      authorOrder: number;
      guestName: string | null;
      guestInstitution: string | null;
      guestOrcidId: string | null;
      institution: string | null;
      isCorresponding: boolean;
      user: { name: string | null; orcidId: string | null } | null;
    }[];
  };
}): {
  protocol: string;
  title: string;
  abstract: string;
  keywords: string[];
  language: string;
  sectionName: string | null;
  authors: ProceedingsAuthorView[];
} {
  const snap = parseEntrySnapshot(input.snapshot);
  if (snap) {
    return {
      protocol: snap.protocol,
      title: snap.title,
      abstract: snap.abstract,
      keywords: snap.keywords,
      language: snap.language,
      sectionName: input.sectionName ?? snap.sectionName,
      authors: snap.authors,
    };
  }

  return {
    protocol: input.submission.protocol,
    title: input.submission.title,
    abstract: input.submission.abstract,
    keywords: input.submission.keywords,
    language: input.submission.language,
    sectionName: input.sectionName ?? input.submission.track?.name ?? null,
    authors: mapSubmissionAuthorsToPublic(input.submission.authors),
  };
}

function pickDefaultPublicFileKind(
  files: readonly { kind: string; isCurrent: boolean }[],
): ProceedingsPublicFileKind | null {
  const currentKinds = new Set(
    files.filter((f) => f.isCurrent && canUseFileKindInProceedings(f.kind)).map((f) => f.kind),
  );
  if (currentKinds.has('CAMERA_READY')) return 'CAMERA_READY';
  if (currentKinds.has('IDENTIFIED_PDF')) return 'IDENTIFIED_PDF';
  return null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Administração — Leitura, Edição, Importação e Publicação
// ───────────────────────────────────────────────────────────────────────────────
export async function getAdminProceedingsOverview(
  tenantId: string,
  eventId: string,
): Promise<AdminProceedingsOverview | null> {
  return withTenant(tenantId, async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { id: true, slug: true, title: true, startsAt: true, status: true },
    });

    if (!event) return null;

    const volume = await tx.proceedingsVolume.findFirst({
      where: { eventId: event.id },
      include: {
        entries: {
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            submission: {
              select: {
                id: true,
                protocol: true,
                title: true,
                deletedAt: true,
                proceedingsPermissionAcceptedAt: true,
                track: { select: { name: true } },
                _count: { select: { authors: true } },
                files: {
                  where: {
                    deletedAt: null,
                    isCurrent: true,
                    kind: { in: ['CAMERA_READY', 'IDENTIFIED_PDF'] },
                  },
                  select: {
                    kind: true,
                    fileName: true,
                    version: true,
                    scanStatus: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const pendingAcceptedCount = await tx.submission.count({
      where: {
        eventId: event.id,
        status: 'ACCEPTED',
        deletedAt: null,
        proceedingsEntry: null,
      },
    });

    return {
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        editionYear: event.startsAt.getUTCFullYear(),
        status: event.status,
      },
      volume: volume
        ? {
            id: volume.id,
            status: volume.status as ProceedingsStatus,
            title: volume.title,
            subtitle: volume.subtitle,
            volumeLabel: volume.volumeLabel,
            editionYear: volume.editionYear,
            editors: volume.editors,
            isbn: volume.isbn,
            issn: volume.issn,
            publisherName: volume.publisherName,
            preface: volume.preface,
            publishedAt: volume.publishedAt,
          }
        : null,
      entries: (volume?.entries ?? [])
        .filter((e) => e.submission.deletedAt === null)
        .map((entry) => ({
          id: entry.id,
          submissionId: entry.submissionId,
          protocol: entry.submission.protocol,
          title: entry.submission.title,
          trackName: entry.submission.track?.name ?? null,
          displayOrder: entry.displayOrder,
          sectionName: entry.sectionName,
          pageStart: entry.pageStart,
          pageEnd: entry.pageEnd,
          externalDoi: entry.externalDoi,
          publicFileKind: canUseFileKindInProceedings(entry.publicFileKind)
            ? entry.publicFileKind
            : null,
          includeInProceedings: entry.includeInProceedings,
          authorPermissionAcceptedAt: entry.submission.proceedingsPermissionAcceptedAt,
          availableFiles: entry.submission.files
            .filter((f) => canUseFileKindInProceedings(f.kind))
            .map((f) => ({
              kind: f.kind as ProceedingsPublicFileKind,
              fileName: f.fileName,
              version: f.version,
              scanStatus: normalizeScanStatus(f.scanStatus),
            })),
          authorsCount: entry.submission._count.authors,
        })),
      pendingAcceptedCount,
    };
  });
}

export async function upsertProceedingsVolume(input: {
  tenantId: string;
  eventId: string;
  userId: string;
  title: string;
  subtitle?: string | null;
  volumeLabel?: string | null;
  editionYear: number;
  editors?: string | null;
  isbn?: string | null;
  issn?: string | null;
  publisherName?: string | null;
  preface?: string | null;
}): Promise<ProceedingsResult<{ volumeId: string }>> {
  const checked = validateProceedingsVolumeInput(input);
  if (!checked.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: checked.message };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, deletedAt: null },
        select: { id: true },
      });

      if (!event) {
        return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
      }

      const existing = await tx.proceedingsVolume.findFirst({
        where: { eventId: event.id },
        select: { id: true },
      });

      const volume = existing
        ? await tx.proceedingsVolume.update({
            where: { id: existing.id },
            data: checked.value,
            select: { id: true },
          })
        : await tx.proceedingsVolume.create({
            data: {
              tenantId: input.tenantId,
              eventId: event.id,
              status: 'DRAFT',
              ...checked.value,
            },
            select: { id: true },
          });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'ProceedingsVolume',
          entityId: volume.id,
          changes: {
            eventId: { from: null, to: event.id },
          },
        },
        tx,
      );

      return { ok: true, volumeId: volume.id };
    });
  } catch (error) {
    logger.error(`[proceedings] erro ao salvar volume: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar os dados dos anais.' };
  }
}

export async function importAcceptedSubmissionsToProceedings(input: {
  tenantId: string;
  eventId: string;
  userId: string;
}): Promise<ProceedingsResult<{ volumeId: string; importedCount: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, deletedAt: null },
        select: { id: true, title: true, startsAt: true },
      });

      if (!event) {
        return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
      }

      const tenant = await tx.tenant.findFirst({
        where: { id: input.tenantId },
        select: { name: true },
      });

      let volume = await tx.proceedingsVolume.findFirst({
        where: { eventId: event.id },
        select: { id: true },
      });

      if (!volume) {
        volume = await tx.proceedingsVolume.create({
          data: {
            tenantId: input.tenantId,
            eventId: event.id,
            status: 'DRAFT',
            title: `Anais — ${event.title}`.slice(0, 300),
            editionYear: event.startsAt.getUTCFullYear(),
            publisherName: tenant?.name.slice(0, 200) ?? null,
          },
          select: { id: true },
        });
      }

      const lastEntry = await tx.proceedingsEntry.findFirst({
        where: { volumeId: volume.id },
        orderBy: { displayOrder: 'desc' },
        select: { displayOrder: true },
      });

      const accepted = await tx.submission.findMany({
        where: {
          eventId: event.id,
          status: 'ACCEPTED',
          deletedAt: null,
          proceedingsEntry: null,
        },
        orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          track: { select: { name: true } },
          files: {
            where: {
              deletedAt: null,
              isCurrent: true,
              kind: { in: ['CAMERA_READY', 'IDENTIFIED_PDF'] },
            },
            select: { kind: true, isCurrent: true },
          },
        },
      });

      let nextOrder = (lastEntry?.displayOrder ?? 0) + 1;

      for (const submission of accepted) {
        await tx.proceedingsEntry.create({
          data: {
            tenantId: input.tenantId,
            volumeId: volume.id,
            submissionId: submission.id,
            displayOrder: nextOrder,
            sectionName: submission.track?.name ?? null,
            publicFileKind: pickDefaultPublicFileKind(submission.files),
            includeInProceedings: true,
          },
        });
        nextOrder += 1;
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'ProceedingsVolume',
          entityId: volume.id,
          changes: {
            importedCount: { from: 0, to: accepted.length },
          },
        },
        tx,
      );

      return { ok: true, volumeId: volume.id, importedCount: accepted.length };
    });
  } catch (error) {
    logger.error(`[proceedings] erro ao importar trabalhos aceitos: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível importar os trabalhos aceitos agora.',
    };
  }
}

export async function updateProceedingsEntry(input: {
  tenantId: string;
  eventId: string;
  entryId: string;
  userId: string;
  displayOrder: number;
  includeInProceedings: boolean;
  sectionName?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  externalDoi?: string | null;
  publicFileKind?: string | null;
}): Promise<ProceedingsResult<{ entryId: string }>> {
  if (!Number.isInteger(input.displayOrder) || input.displayOrder < 1 || input.displayOrder > 9999) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Ordem de exibição inválida.' };
  }

  const fileKind = normalizePublicFileKindInput(input.publicFileKind);
  if (!fileKind.ok) {
    return { ok: false, code: 'FORBIDDEN_FILE_KIND', message: fileKind.message };
  }

  const pages = validatePageRange(input.pageStart ?? null, input.pageEnd ?? null);
  if (!pages.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: pages.message };
  }

  const doi = normalizeExternalDoi(input.externalDoi);
  if (!doi.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: doi.message };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const entry = await tx.proceedingsEntry.findFirst({
        where: {
          id: input.entryId,
          volume: { eventId: input.eventId },
        },
        select: { id: true, submissionId: true },
      });

      if (!entry) {
        return { ok: false, code: 'NOT_FOUND', message: 'Trabalho não encontrado neste volume.' };
      }

      if (fileKind.kind) {
        const hasFile = await tx.submissionFile.findFirst({
          where: {
            submissionId: entry.submissionId,
            kind: fileKind.kind,
            isCurrent: true,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!hasFile) {
          return {
            ok: false,
            code: 'INVALID_INPUT',
            message: 'Este trabalho ainda não possui um arquivo do tipo selecionado.',
          };
        }
      }

      await tx.proceedingsEntry.update({
        where: { id: entry.id },
        data: {
          displayOrder: input.displayOrder,
          includeInProceedings: input.includeInProceedings,
          sectionName: input.sectionName?.trim().slice(0, 200) || null,
          pageStart: pages.pageStart,
          pageEnd: pages.pageEnd,
          externalDoi: doi.doi,
          publicFileKind: fileKind.kind,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'ProceedingsEntry',
          entityId: entry.id,
          changes: {
            displayOrder: { from: null, to: input.displayOrder },
            includeInProceedings: { from: null, to: input.includeInProceedings },
            publicFileKind: { from: null, to: fileKind.kind },
          },
        },
        tx,
      );

      return { ok: true, entryId: entry.id };
    });
  } catch (error) {
    logger.error(`[proceedings] erro ao atualizar item dos anais: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar o item dos anais.' };
  }
}

export async function publishProceedingsVolume(input: {
  tenantId: string;
  eventId: string;
  userId: string;
}): Promise<ProceedingsResult<{ volumeId: string; publishedCount: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const volume = await tx.proceedingsVolume.findFirst({
        where: { eventId: input.eventId },
        include: {
          entries: {
            where: { includeInProceedings: true },
            orderBy: [{ displayOrder: 'asc' }],
            include: {
              submission: {
                select: {
                  id: true,
                  protocol: true,
                  title: true,
                  abstract: true,
                  keywords: true,
                  language: true,
                  deletedAt: true,
                  status: true,
                  track: { select: { name: true } },
                  authors: {
                    orderBy: { authorOrder: 'asc' },
                    select: {
                      authorOrder: true,
                      guestName: true,
                      guestInstitution: true,
                      guestOrcidId: true,
                      institution: true,
                      isCorresponding: true,
                      user: { select: { name: true, orcidId: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!volume) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Salve os metadados dos anais antes de publicar.',
        };
      }

      const validVolume = validateProceedingsVolumeInput(volume);
      if (!validVolume.ok) {
        return { ok: false, code: 'INVALID_INPUT', message: validVolume.message };
      }

      const activeEntries = volume.entries.filter(
        (entry) => entry.submission.deletedAt === null && entry.submission.status === 'ACCEPTED',
      );

      if (activeEntries.length === 0) {
        return {
          ok: false,
          code: 'NO_ENTRIES',
          message: 'Inclua ao menos um trabalho aceito antes de publicar os anais.',
        };
      }

      const now = volume.publishedAt ?? new Date();

      for (const entry of activeEntries) {
        if (entry.publicFileKind && !canUseFileKindInProceedings(entry.publicFileKind)) {
          return {
            ok: false,
            code: 'FORBIDDEN_FILE_KIND',
            message: 'Arquivo cego de revisão nunca pode ser publicado nos anais.',
          };
        }

        const snapshot = buildProceedingsEntrySnapshot({
          protocol: entry.submission.protocol,
          title: entry.submission.title,
          abstract: entry.submission.abstract,
          keywords: entry.submission.keywords,
          language: entry.submission.language,
          sectionName: entry.sectionName ?? entry.submission.track?.name ?? null,
          authors: mapSubmissionAuthorsToPublic(entry.submission.authors),
          publishedAt: now,
        });

        await tx.proceedingsEntry.update({
          where: { id: entry.id },
          data: { snapshot: snapshot as unknown as object },
        });
      }

      await tx.proceedingsVolume.update({
        where: { id: volume.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: now,
          publishedById: input.userId,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'ProceedingsVolume',
          entityId: volume.id,
          changes: {
            status: { from: volume.status, to: 'PUBLISHED' },
            publishedCount: { from: null, to: activeEntries.length },
          },
        },
        tx,
      );

      return { ok: true, volumeId: volume.id, publishedCount: activeEntries.length };
    });
  } catch (error) {
    logger.error(`[proceedings] erro ao publicar anais: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível publicar os anais.' };
  }
}

export async function unpublishProceedingsVolume(input: {
  tenantId: string;
  eventId: string;
  userId: string;
}): Promise<ProceedingsResult<{ volumeId: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const volume = await tx.proceedingsVolume.findFirst({
        where: { eventId: input.eventId },
        select: { id: true },
      });

      if (!volume) {
        return { ok: false, code: 'NOT_FOUND', message: 'Volume de anais não encontrado.' };
      }

      await tx.proceedingsVolume.update({
        where: { id: volume.id },
        data: { status: 'DRAFT' },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'ProceedingsVolume',
          entityId: volume.id,
          changes: {
            status: { from: 'PUBLISHED', to: 'DRAFT' },
          },
        },
        tx,
      );

      return { ok: true, volumeId: volume.id };
    });
  } catch (error) {
    logger.error(`[proceedings] erro ao retirar anais do ar: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível atualizar o volume.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura pública fail-closed + Download inline + OAI-PMH
// ───────────────────────────────────────────────────────────────────────────────
export async function getPublicProceedingsByEventSlug(input: {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  eventSlug: string;
  query?: string;
  section?: string;
}): Promise<PublicProceedingsVolumeView | null> {
  const row = await withTenant(input.tenantId, (tx) =>
    tx.event.findFirst({
      where: {
        slug: input.eventSlug,
        deletedAt: null,
        status: { in: [...PUBLICLY_VISIBLE_EVENT_STATUSES] },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        city: true,
        state: true,
        country: true,
        startsAt: true,
        endsAt: true,
        proceedingsVolume: {
          where: { status: 'PUBLISHED' },
          include: {
            entries: {
              where: { includeInProceedings: true },
              orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
              include: {
                submission: {
                  select: {
                    protocol: true,
                    title: true,
                    abstract: true,
                    keywords: true,
                    language: true,
                    deletedAt: true,
                    track: { select: { name: true } },
                    authors: {
                      orderBy: { authorOrder: 'asc' },
                      select: {
                        authorOrder: true,
                        guestName: true,
                        guestInstitution: true,
                        guestOrcidId: true,
                        institution: true,
                        isCorresponding: true,
                        user: { select: { name: true, orcidId: true } },
                      },
                    },
                    files: {
                      where: {
                        deletedAt: null,
                        isCurrent: true,
                        kind: { in: ['CAMERA_READY', 'IDENTIFIED_PDF'] },
                      },
                      select: { kind: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );

  if (!row?.proceedingsVolume) return null;

  const volume = row.proceedingsVolume;
  const allEntries = volume.entries
    .filter((entry) => entry.submission.deletedAt === null)
    .map((entry) => {
      const content = resolvePublicEntryContent({
        snapshot: entry.snapshot,
        sectionName: entry.sectionName,
        submission: entry.submission,
      });

      const fileKind = canUseFileKindInProceedings(entry.publicFileKind)
        ? entry.publicFileKind
        : null;
      const hasPdf = Boolean(
        fileKind && entry.submission.files.some((f) => f.kind === fileKind),
      );

      return {
        id: entry.id,
        protocol: content.protocol,
        title: content.title,
        abstract: content.abstract,
        keywords: content.keywords,
        language: content.language,
        sectionName: content.sectionName,
        pageStart: entry.pageStart,
        pageEnd: entry.pageEnd,
        externalDoi: entry.externalDoi,
        displayOrder: entry.displayOrder,
        hasPdf,
        authors: content.authors,
      };
    });

  const sections = [...new Set(allEntries.map((e) => e.sectionName).filter((s): s is string => Boolean(s)))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  );

  const normalizedQuery = input.query?.trim().toLowerCase() ?? '';
  const normalizedSection = input.section?.trim() ?? '';

  const filtered = allEntries.filter((entry) => {
    if (normalizedSection && entry.sectionName !== normalizedSection) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      entry.protocol,
      entry.title,
      entry.abstract,
      ...entry.keywords,
      ...entry.authors.map((a) => `${a.name} ${a.institution ?? ''}`),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const view: PublicProceedingsVolumeView = {
    volume: {
      id: volume.id,
      title: volume.title,
      subtitle: volume.subtitle,
      volumeLabel: volume.volumeLabel,
      editionYear: volume.editionYear,
      editors: volume.editors,
      isbn: volume.isbn,
      issn: volume.issn,
      publisherName: volume.publisherName,
      preface: volume.preface,
      publishedAt: volume.publishedAt,
    },
    event: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      city: row.city,
      state: row.state,
      country: row.country ?? 'BR',
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    },
    tenant: {
      slug: input.tenantSlug,
      name: input.tenantName,
    },
    sections,
    entries: filtered,
    totalEntries: allEntries.length,
  };

  assertProceedingsSemCampoProibido(view);
  return view;
}

export async function getPublicProceedingsWork(input: {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  eventSlug: string;
  protocol: string;
}): Promise<PublicProceedingsWorkView | null> {
  const row = await withTenant(input.tenantId, (tx) =>
    tx.proceedingsEntry.findFirst({
      where: {
        includeInProceedings: true,
        submission: {
          protocol: input.protocol,
          deletedAt: null,
        },
        volume: {
          status: 'PUBLISHED',
          event: {
            slug: input.eventSlug,
            deletedAt: null,
            status: { in: [...PUBLICLY_VISIBLE_EVENT_STATUSES] },
          },
        },
      },
      include: {
        volume: {
          include: {
            event: { select: { id: true, slug: true, title: true, city: true } },
          },
        },
        submission: {
          select: {
            protocol: true,
            title: true,
            abstract: true,
            keywords: true,
            language: true,
            track: { select: { name: true } },
            authors: {
              orderBy: { authorOrder: 'asc' },
              select: {
                authorOrder: true,
                guestName: true,
                guestInstitution: true,
                guestOrcidId: true,
                institution: true,
                isCorresponding: true,
                user: { select: { name: true, orcidId: true } },
              },
            },
            files: {
              where: {
                deletedAt: null,
                isCurrent: true,
                kind: { in: ['CAMERA_READY', 'IDENTIFIED_PDF'] },
              },
              select: {
                kind: true,
                scanStatus: true,
              },
            },
          },
        },
      },
    }),
  );

  if (!row) return null;

  const content = resolvePublicEntryContent({
    snapshot: row.snapshot,
    sectionName: row.sectionName,
    submission: row.submission,
  });

  const fileKind = canUseFileKindInProceedings(row.publicFileKind) ? row.publicFileKind : null;
  const matchedFile = fileKind ? row.submission.files.find((f) => f.kind === fileKind) ?? null : null;
  const scanStatus = matchedFile ? normalizeScanStatus(matchedFile.scanStatus) : null;
  const serveCheck = matchedFile
    ? canServeFile({ status: scanStatus, scanningEnabled: isScanningEnabled() })
    : null;

  const baseUrl = publicBaseUrl();
  const abstractUrl = `${baseUrl}${tenantPath(
    input.tenantSlug,
    `/eventos/${row.volume.event.slug}/anais/${content.protocol}`,
  )}`;
  const pdfUrl =
    matchedFile && serveCheck?.ok
      ? `${baseUrl}/api/t/${input.tenantSlug}/eventos/${row.volume.event.slug}/anais/${content.protocol}/arquivo`
      : null;

  const view: PublicProceedingsWorkView = {
    volume: {
      id: row.volume.id,
      title: row.volume.title,
      subtitle: row.volume.subtitle,
      preface: row.volume.preface,
      publishedAt: row.volume.publishedAt,
      eventTitle: row.volume.event.title,
      volumeLabel: row.volume.volumeLabel,
      editionYear: row.volume.editionYear,
      editors: row.volume.editors,
      isbn: row.volume.isbn,
      issn: row.volume.issn,
      publisherName: row.volume.publisherName,
      eventCity: row.volume.event.city,
      institutionName: input.tenantName,
    },
    event: row.volume.event,
    tenant: {
      slug: input.tenantSlug,
      name: input.tenantName,
    },
    work: {
      id: row.id,
      protocol: content.protocol,
      title: content.title,
      abstract: content.abstract,
      keywords: content.keywords,
      language: content.language,
      sectionName: content.sectionName,
      publishedAt: row.volume.publishedAt,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      externalDoi: row.externalDoi,
      abstractUrl,
      pdfUrl,
      publicFileKind: fileKind,
      scanStatus,
      isPdfServed: Boolean(matchedFile && serveCheck?.ok),
      pdfBlockedReason: serveCheck && !serveCheck.ok ? serveCheck.message : null,
      authors: content.authors,
    },
  };

  assertProceedingsSemCampoProibido(view);
  return view;
}

export async function resolvePublicProceedingsPdf(input: {
  tenantId: string;
  eventSlug: string;
  protocol: string;
}): Promise<
  | {
      ok: true;
      bucket: string;
      storageKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }
  | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN_FILE_KIND' | 'SCAN_BLOCKED'; message: string }
> {
  const row = await withTenant(input.tenantId, (tx) =>
    tx.proceedingsEntry.findFirst({
      where: {
        includeInProceedings: true,
        submission: {
          protocol: input.protocol,
          deletedAt: null,
        },
        volume: {
          status: 'PUBLISHED',
          event: {
            slug: input.eventSlug,
            deletedAt: null,
            status: { in: [...PUBLICLY_VISIBLE_EVENT_STATUSES] },
          },
        },
      },
      select: {
        publicFileKind: true,
        submission: {
          select: {
            files: {
              where: { deletedAt: null, isCurrent: true },
              select: {
                kind: true,
                bucket: true,
                storageKey: true,
                fileName: true,
                mimeType: true,
                sizeBytes: true,
                scanStatus: true,
              },
            },
          },
        },
      },
    }),
  );

  if (!row || !row.publicFileKind) {
    return { ok: false, reason: 'NOT_FOUND', message: 'Arquivo público não disponível.' };
  }

  if (!canUseFileKindInProceedings(row.publicFileKind)) {
    return {
      ok: false,
      reason: 'FORBIDDEN_FILE_KIND',
      message: 'Arquivo cego de revisão nunca é exposto nos anais.',
    };
  }

  const file = row.submission.files.find((f) => f.kind === row.publicFileKind);
  if (!file) {
    return { ok: false, reason: 'NOT_FOUND', message: 'Arquivo do trabalho não encontrado.' };
  }

  const scan = canServeFile({
    status: file.scanStatus,
    scanningEnabled: isScanningEnabled(),
  });
  if (!scan.ok) {
    return { ok: false, reason: 'SCAN_BLOCKED', message: scan.message };
  }

  return {
    ok: true,
    bucket: file.bucket,
    storageKey: file.storageKey,
    fileName: file.fileName,
    mimeType: file.mimeType ?? 'application/pdf',
    sizeBytes: Number(file.sizeBytes),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Projeção OAI-PMH e Sitemap por instituição (sob `withTenant`)
// ───────────────────────────────────────────────────────────────────────────────
export async function loadTenantPublishedProceedingsForIndexing(input: {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  eventSlug?: string;
}): Promise<{
  publicEvents: { slug: string; updatedAt: Date }[];
  publishedVolumes: { eventSlug: string; updatedAt: Date }[];
  sets: OaiSetDescriptor[];
  records: OaiRecordDescriptor[];
}> {
  const baseUrl = publicBaseUrl();

  const events = await withTenant(input.tenantId, (tx) =>
    tx.event.findMany({
      where: {
        deletedAt: null,
        status: { in: [...PUBLICLY_VISIBLE_EVENT_STATUSES] },
        ...(input.eventSlug ? { slug: input.eventSlug } : {}),
      },
      select: {
        slug: true,
        title: true,
        updatedAt: true,
        proceedingsVolume: {
          where: { status: 'PUBLISHED' },
          include: {
            entries: {
              where: { includeInProceedings: true },
              orderBy: [{ displayOrder: 'asc' }],
              include: {
                submission: {
                  select: {
                    protocol: true,
                    title: true,
                    abstract: true,
                    keywords: true,
                    language: true,
                    deletedAt: true,
                    track: { select: { name: true } },
                    authors: {
                      orderBy: { authorOrder: 'asc' },
                      select: {
                        authorOrder: true,
                        guestName: true,
                        guestInstitution: true,
                        guestOrcidId: true,
                        institution: true,
                        isCorresponding: true,
                        user: { select: { name: true, orcidId: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );

  const publicEvents: { slug: string; updatedAt: Date }[] = [];
  const publishedVolumes: { eventSlug: string; updatedAt: Date }[] = [];
  const sets: OaiSetDescriptor[] = [];
  const records: OaiRecordDescriptor[] = [];

  for (const event of events) {
    publicEvents.push({ slug: event.slug, updatedAt: event.updatedAt });
    const volume = event.proceedingsVolume;
    if (!volume) continue;

    publishedVolumes.push({ eventSlug: event.slug, updatedAt: volume.updatedAt });
    const setSpec = `${input.tenantSlug}:${event.slug}`;
    sets.push({ setSpec, setName: `${volume.title} (${input.tenantName})` });

    const publisher = volume.publisherName?.trim() || input.tenantName;
    const pubIsoDate = (volume.publishedAt ?? volume.updatedAt).toISOString().slice(0, 10);

    for (const entry of volume.entries) {
      if (entry.submission.deletedAt !== null) continue;

      const content = resolvePublicEntryContent({
        snapshot: entry.snapshot,
        sectionName: entry.sectionName,
        submission: entry.submission,
      });

      const workUrl = `${baseUrl}${tenantPath(
        input.tenantSlug,
        `/eventos/${event.slug}/anais/${content.protocol}`,
      )}`;
      const identifiers = [workUrl];
      if (entry.externalDoi) identifiers.push(`doi:${entry.externalDoi}`);

      records.push({
        identifier: `oai:koveno:${input.tenantSlug}:${event.slug}:${content.protocol}`,
        datestamp: entry.updatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        setSpec,
        title: content.title,
        creators: content.authors.map((a) => a.name),
        subjects: content.keywords,
        description: content.abstract.slice(0, 2000),
        publisher,
        date: pubIsoDate,
        source: volume.title,
        language: content.language || 'pt-BR',
        identifiers,
      });
    }
  }

  return { publicEvents, publishedVolumes, sets, records };
}

export async function loadEventOaiRepositoryData(input: {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  eventSlug: string;
}): Promise<{
  repositoryName: string;
  adminEmail: string;
  earliestDatestamp: string;
  sets: OaiSetDescriptor[];
  records: OaiRecordDescriptor[];
} | null> {
  const data = await loadTenantPublishedProceedingsForIndexing(input);
  if (data.publishedVolumes.length === 0) return null;

  const baseHost = new URL(publicBaseUrl()).hostname;
  const earliest = data.records
    .map((r) => r.datestamp)
    .sort()[0] ?? '2025-01-01T00:00:00Z';

  return {
    repositoryName: `${data.sets[0]?.setName ?? input.tenantName} — Koveno OAI-PMH`,
    adminEmail: `proceedings@${baseHost}`,
    earliestDatestamp: earliest,
    sets: data.sets,
    records: data.records,
  };
}

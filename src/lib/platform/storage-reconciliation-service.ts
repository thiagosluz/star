/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PLATAFORMA — Reconciliação Banco × Object Storage (FASE 130 · C6)
 *
 *  Compara todas as chaves ativas registradas no PostgreSQL (nas 5 fontes de
 *  armazenamento) contra os objetos reais nos buckets S3/MinIO. Usa `adminPrisma`
 *  porque é varredura global de plataforma (invariante nº 1).
 *
 *  Por padrão opera em modo auditoria (`deleteOrphans: false`), respeitando a
 *  janela de carência (`graceHours`, padrão 24h) para não tocar uploads ativos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { asRecordOrNull } from '@/domain/shared/json-record';
import {
  DEFAULT_ORPHAN_GRACE_HOURS,
  reconcileStorageInventory,
  type StorageBucketObject,
  type StorageDbRef,
  type StorageReconciliationReport,
} from '@/domain/storage/storage-reconciliation-rules';
import { adminPrisma } from '@/lib/db/admin-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { logger } from '@/lib/observability/logger';
import { BUCKETS, deleteObject, listBucketObjects } from '@/lib/storage/s3-client';

export interface PlatformStorageReconciliationResult {
  dryRun: boolean;
  report: StorageReconciliationReport;
  deletedOrphans: number;
  failedDeletes: number;
}

export type PlatformStorageReconciliationOutcome =
  | { ok: true; result: PlatformStorageReconciliationResult }
  | { ok: false; code: 'INTERNAL'; message: string };

async function collectActiveDbRefs(defaultAssetsBucket: string): Promise<StorageDbRef[]> {
  const [submissions, media, materials, certificates, templates] = await Promise.all([
    adminPrisma.submissionFile.findMany({
      select: { bucket: true, storageKey: true },
    }),
    adminPrisma.mediaAsset.findMany({
      where: { deletedAt: null },
      select: { bucket: true, objectKey: true },
    }),
    adminPrisma.speakerMaterial.findMany({
      where: { deletedAt: null, storageKey: { not: null } },
      select: { storageBucket: true, storageKey: true },
    }),
    adminPrisma.certificate.findMany({
      where: { storageKey: { not: null } },
      select: { bucket: true, storageKey: true },
    }),
    adminPrisma.certificateTemplate.findMany({
      where: { backgroundBytes: { not: null } },
      select: { layout: true },
    }),
  ]);

  const refs: StorageDbRef[] = [];

  for (const row of submissions) {
    refs.push({ bucket: row.bucket, key: row.storageKey, source: 'submission' });
  }
  for (const row of media) {
    refs.push({ bucket: row.bucket, key: row.objectKey, source: 'media' });
  }
  for (const row of materials) {
    if (row.storageBucket && row.storageKey) {
      refs.push({
        bucket: row.storageBucket,
        key: row.storageKey,
        source: 'speaker_material',
      });
    }
  }
  for (const row of certificates) {
    if (row.bucket && row.storageKey) {
      refs.push({ bucket: row.bucket, key: row.storageKey, source: 'certificate' });
    }
  }
  for (const row of templates) {
    const layout = asRecordOrNull(row.layout);
    const background = asRecordOrNull(layout?.background);
    const key =
      typeof background?.objectKey === 'string'
        ? background.objectKey
        : typeof background?.storageKey === 'string'
          ? background.storageKey
          : null;
    const bucket =
      typeof background?.bucket === 'string' ? background.bucket : defaultAssetsBucket;
    if (key) {
      refs.push({ bucket, key, source: 'certificate_template' });
    }
  }

  return refs;
}

export async function reconcilePlatformStorage(input: {
  deleteOrphans?: boolean;
  graceHours?: number;
  now?: Date;
} = {}): Promise<PlatformStorageReconciliationOutcome> {
  const deleteOrphans = input.deleteOrphans ?? false;
  const graceHours = input.graceHours ?? DEFAULT_ORPHAN_GRACE_HOURS;

  try {
    const bucketNames = Array.from(
      new Set([BUCKETS.submissions(), BUCKETS.certificates(), BUCKETS.assets()]),
    );
    const [dbRefs, ...listedPerBucket] = await Promise.all([
      collectActiveDbRefs(BUCKETS.assets()),
      ...bucketNames.map((bucket) =>
        listBucketObjects(bucket).then((items) =>
          items.map(
            (item): StorageBucketObject => ({
              bucket,
              key: item.key,
              sizeBytes: item.sizeBytes,
              lastModified: item.lastModified,
            }),
          ),
        ),
      ),
    ]);

    const bucketObjects = listedPerBucket.flat();
    const report = reconcileStorageInventory({
      dbRefs,
      bucketObjects,
      graceHours,
      now: input.now,
    });

    let deletedOrphans = 0;
    let failedDeletes = 0;

    if (deleteOrphans && report.orphansInBucket.length > 0) {
      for (const orphan of report.orphansInBucket) {
        try {
          await deleteObject(orphan.bucket, orphan.key);
          deletedOrphans += 1;
        } catch (error) {
          failedDeletes += 1;
          logger.warn('storage.reconcile.delete_failed', {
            bucket: orphan.bucket,
            key: orphan.key,
            error: errorMessage(error),
          });
        }
      }

      logger.info('storage.reconcile.completed', {
        deletedOrphans,
        failedDeletes,
        orphanBytes: report.orphanBytes,
        missingInBucket: report.missingInBucket.length,
      });
    }

    return {
      ok: true,
      result: {
        dryRun: !deleteOrphans,
        report,
        deletedOrphans,
        failedDeletes,
      },
    };
  } catch (error) {
    logger.error(`[storage] falha na reconciliação: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível reconciliar o banco com o object storage.',
    };
  }
}

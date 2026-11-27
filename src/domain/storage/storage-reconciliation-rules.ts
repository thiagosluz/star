/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Reconciliação entre Banco e Object Storage (FASE 130 · C6)
 *
 *  Cruza as chaves ativas registradas no PostgreSQL contra os objetos listados
 *  nos buckets S3/MinIO, aplicando uma janela de carência (`graceHours`, padrão
 *  24h) para jamais classificar uploads pré-assinados em andamento como órfãos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const DEFAULT_ORPHAN_GRACE_HOURS = 24;

export type StorageSourceKind =
  | 'submission'
  | 'media'
  | 'speaker_material'
  | 'certificate'
  | 'certificate_template';

export interface StorageDbRef {
  readonly bucket: string;
  readonly key: string;
  readonly source: StorageSourceKind;
}

export interface StorageBucketObject {
  readonly bucket: string;
  readonly key: string;
  readonly sizeBytes: number;
  readonly lastModified: Date;
}

export interface StorageReconciliationReport {
  readonly graceHours: number;
  readonly scannedBuckets: number;
  readonly totalDbRefs: number;
  readonly totalBucketObjects: number;
  /** Objetos no bucket sem referência ativa no banco há mais que `graceHours`. */
  readonly orphansInBucket: readonly StorageBucketObject[];
  /** Objetos fora do banco ainda dentro da janela de carência (protegidos). */
  readonly skippedWithinGrace: readonly StorageBucketObject[];
  /** Registros ativos no banco cujo objeto não foi encontrado no bucket. */
  readonly missingInBucket: readonly StorageDbRef[];
  readonly orphanBytes: number;
}

function compositeKey(bucket: string, key: string): string {
  return `${bucket}::${key}`;
}

export function reconcileStorageInventory(input: {
  dbRefs: readonly StorageDbRef[];
  bucketObjects: readonly StorageBucketObject[];
  graceHours?: number;
  now?: Date;
}): StorageReconciliationReport {
  const graceHours = Math.max(0, input.graceHours ?? DEFAULT_ORPHAN_GRACE_HOURS);
  const nowMs = (input.now ?? new Date()).getTime();
  const graceMs = graceHours * 3_600_000;

  const dbSet = new Set<string>();
  for (const ref of input.dbRefs) {
    dbSet.add(compositeKey(ref.bucket, ref.key));
  }

  const bucketSet = new Set<string>();
  const scannedBuckets = new Set<string>();
  const orphansInBucket: StorageBucketObject[] = [];
  const skippedWithinGrace: StorageBucketObject[] = [];

  for (const obj of input.bucketObjects) {
    scannedBuckets.add(obj.bucket);
    const id = compositeKey(obj.bucket, obj.key);
    bucketSet.add(id);

    if (dbSet.has(id)) continue;

    const ageMs = nowMs - obj.lastModified.getTime();
    if (ageMs < graceMs) {
      skippedWithinGrace.push(obj);
    } else {
      orphansInBucket.push(obj);
    }
  }

  const missingInBucket: StorageDbRef[] = [];
  for (const ref of input.dbRefs) {
    if (!bucketSet.has(compositeKey(ref.bucket, ref.key))) {
      missingInBucket.push(ref);
    }
  }

  return {
    graceHours,
    scannedBuckets: scannedBuckets.size,
    totalDbRefs: input.dbRefs.length,
    totalBucketObjects: input.bucketObjects.length,
    orphansInBucket,
    skippedWithinGrace,
    missingInBucket,
    orphanBytes: orphansInBucket.reduce((sum, obj) => sum + obj.sizeBytes, 0),
  };
}

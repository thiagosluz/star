import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { pruneAuditPartitions } from '@/lib/platform/partition-service';
import { reconcilePlatformStorage } from '@/lib/platform/storage-reconciliation-service';
import { BUCKETS, deleteObject, putObjectBuffer } from '@/lib/storage/s3-client';

describe('FASE 130 — integração real de retenção de partições (B8) e reconciliação de storage (C6)', () => {
  it('B8: simula retenção contra o PostgreSQL real sem descartar partições em dry-run e barra retenção curta', async () => {
    const rejected = await pruneAuditPartitions({
      retentionMonths: 2,
      dryRun: true,
    });
    expect(rejected).toMatchObject({ ok: false, code: 'RETENTION_TOO_SHORT' });

    const dryRun = await pruneAuditPartitions({
      retentionMonths: 12,
      dryRun: true,
    });
    expect(dryRun.ok).toBe(true);
    if (!dryRun.ok) return;

    expect(dryRun.result.dryRun).toBe(true);
    expect(dryRun.result.dropped).toEqual([]);
    expect(dryRun.result.eligible.some((p) => p.name === 'audit_logs_default')).toBe(false);
  });

  it('C6: detecta objeto órfão real no MinIO em modo auditoria sem apagá-lo antes da confirmação', async () => {
    const bucket = BUCKETS.assets();
    const orphanKey = `tenants/f130-test/orphan-${randomUUID()}.txt`;

    await putObjectBuffer({
      bucket,
      objectKey: orphanKey,
      body: Buffer.from('objeto-orfao-f130', 'utf8'),
      contentType: 'text/plain',
    });

    try {
      const futureNow = new Date(Date.now() + 48 * 3_600_000);
      const audited = await reconcilePlatformStorage({
        deleteOrphans: false,
        graceHours: 24,
        now: futureNow,
      });

      expect(audited.ok).toBe(true);
      if (!audited.ok) return;

      expect(audited.result.dryRun).toBe(true);
      expect(audited.result.deletedOrphans).toBe(0);
      expect(
        audited.result.report.orphansInBucket.some(
          (item) => item.bucket === bucket && item.key === orphanKey,
        ),
      ).toBe(true);
    } finally {
      await deleteObject(bucket, orphanKey).catch(() => undefined);
    }
  });
});

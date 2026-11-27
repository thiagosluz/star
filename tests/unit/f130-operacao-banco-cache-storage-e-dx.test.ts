import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MIN_AUDIT_RETENTION_MONTHS,
  evaluatePartitionRetention,
  isMonthlyAuditPartitionName,
  parseAuditPartitionMonth,
  parseRetentionMonthsEnv,
} from '@/domain/platform/partition-retention-rules';
import {
  DEFAULT_ORPHAN_GRACE_HOURS,
  reconcileStorageInventory,
} from '@/domain/storage/storage-reconciliation-rules';

const ROOT = process.cwd();

function walkSrc(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry !== 'generated') walkSrc(full, out);
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

describe('FASE 130 — B5 (cache distribuído), B8 (retenção de auditoria), C6 (storage) e DX Vitest', () => {
  it('B5 catraca: nenhum arquivo em src/ importa ou usa unstable_cache', () => {
    const files = walkSrc(join(ROOT, 'src'));
    const unstableCachePattern = /\bimport\s+[^;]*\bunstable_cache\b|\bunstable_cache\s*\(/;
    const offenders = files.filter((rel) =>
      unstableCachePattern.test(readFileSync(join(ROOT, rel), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('B8: retenção nasce fail-closed quando desligada e recusa janela menor que o piso seguro', () => {
    expect(parseRetentionMonthsEnv(undefined)).toBeNull();
    expect(parseRetentionMonthsEnv('')).toBeNull();
    expect(parseRetentionMonthsEnv('off')).toBeNull();
    expect(parseRetentionMonthsEnv('0')).toBeNull();
    expect(parseRetentionMonthsEnv('12')).toBe(12);

    const disabled = evaluatePartitionRetention({
      partitions: [{ name: 'audit_logs_2024_01', rows: 100, bytes: 4096 }],
      retentionMonths: null,
      now: new Date('2026-11-27T12:00:00.000Z'),
    });
    expect(disabled).toMatchObject({ ok: true, enabled: false, eligible: [] });

    const tooShort = evaluatePartitionRetention({
      partitions: [],
      retentionMonths: MIN_AUDIT_RETENTION_MONTHS - 1,
      now: new Date('2026-11-27T12:00:00.000Z'),
    });
    expect(tooShort).toMatchObject({ ok: false, code: 'RETENTION_TOO_SHORT' });
  });

  it('B8: seleciona apenas partições mensais estritamente anteriores ao corte e preserva DEFAULT/atual/futuras', () => {
    expect(isMonthlyAuditPartitionName('audit_logs_2025_06')).toBe(true);
    expect(isMonthlyAuditPartitionName('audit_logs_default')).toBe(false);
    expect(parseAuditPartitionMonth('audit_logs_2025_06')).toEqual({ year: 2025, month: 6 });

    const plan = evaluatePartitionRetention({
      retentionMonths: 12,
      now: new Date('2026-11-27T12:00:00.000Z'),
      partitions: [
        { name: 'audit_logs_2025_09', rows: 500, bytes: 10_000 },
        { name: 'audit_logs_2025_10', rows: 300, bytes: 8_000 },
        { name: 'audit_logs_2025_11', rows: 200, bytes: 5_000 },
        { name: 'audit_logs_2026_11', rows: 900, bytes: 20_000 },
        { name: 'audit_logs_2026_12', rows: 0, bytes: 1_000 },
        { name: 'audit_logs_default', rows: 10, bytes: 2_000 },
      ],
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.cutoffMonth).toBe('2025-11');
    expect(plan.eligible.map((p) => p.name)).toEqual(['audit_logs_2025_09', 'audit_logs_2025_10']);
    expect(plan.kept.map((p) => p.name)).toEqual([
      'audit_logs_2025_11',
      'audit_logs_2026_11',
      'audit_logs_2026_12',
      'audit_logs_default',
    ]);
    expect(plan.reclaimableRows).toBe(800);
    expect(plan.reclaimableBytes).toBe(18_000);
  });

  it('C6: classifica órfãos fora da carência, protege uploads recentes e aponta ausentes no bucket', () => {
    const now = new Date('2026-11-27T12:00:00.000Z');
    const oldDate = new Date(now.getTime() - (DEFAULT_ORPHAN_GRACE_HOURS + 2) * 3_600_000);
    const recentDate = new Date(now.getTime() - 2 * 3_600_000);

    const report = reconcileStorageInventory({
      now,
      graceHours: DEFAULT_ORPHAN_GRACE_HOURS,
      dbRefs: [
        { bucket: 'assets', key: 'tenants/t1/ok.webp', source: 'media' },
        { bucket: 'certificates', key: 'tenants/t1/missing.pdf', source: 'certificate' },
      ],
      bucketObjects: [
        { bucket: 'assets', key: 'tenants/t1/ok.webp', sizeBytes: 1_200, lastModified: oldDate },
        { bucket: 'assets', key: 'tenants/t1/orphan-old.webp', sizeBytes: 5_000, lastModified: oldDate },
        { bucket: 'assets', key: 'tenants/t1/uploading-now.webp', sizeBytes: 3_000, lastModified: recentDate },
      ],
    });

    expect(report.totalDbRefs).toBe(2);
    expect(report.totalBucketObjects).toBe(3);
    expect(report.orphansInBucket.map((o) => o.key)).toEqual(['tenants/t1/orphan-old.webp']);
    expect(report.orphanBytes).toBe(5_000);
    expect(report.skippedWithinGrace.map((o) => o.key)).toEqual(['tenants/t1/uploading-now.webp']);
    expect(report.missingInBucket.map((m) => m.key)).toEqual(['tenants/t1/missing.pdf']);
  });

  it('DX Vitest: projects unit (paralelo) e integration (sequencial) e scripts operacionais declarados', () => {
    const vitestCfg = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(vitestCfg).toContain("name: 'unit'");
    expect(vitestCfg).toContain('fileParallelism: true');
    expect(vitestCfg).toContain("name: 'integration'");
    expect(vitestCfg).toContain('fileParallelism: false');

    expect(pkg.scripts['test:unit']).toContain('--project unit');
    expect(pkg.scripts['test:integration']).toContain('--project integration');
    expect(pkg.scripts['db:partitions:prune']).toContain('prune-audit-partitions.ts');
    expect(pkg.scripts['storage:reconcile']).toContain('reconcile-storage.ts');
  });
});

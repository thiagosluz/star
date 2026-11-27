/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLI — Reconciliação Banco × Object Storage / MinIO (FASE 130 · C6)
 *
 *      npm run storage:reconcile                          # auditoria (dry-run)
 *      npm run storage:reconcile -- --grace-hours=48      # carência customizada
 *      npm run storage:reconcile -- --confirmar           # remove órfãos > carência
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { DEFAULT_ORPHAN_GRACE_HOURS } from '../../src/domain/storage/storage-reconciliation-rules.ts';
import { adminPrisma } from '../../src/lib/db/admin-client.ts';
import { disconnectDb } from '../../src/lib/db/tenant-client.ts';
import { reconcilePlatformStorage } from '../../src/lib/platform/storage-reconciliation-service.ts';

const line = '─'.repeat(78);
const graceArg = process.argv.find((arg) => arg.startsWith('--grace-hours='))?.split('=')[1];
const graceHours = graceArg ? Number(graceArg) : DEFAULT_ORPHAN_GRACE_HOURS;
const confirm = process.argv.includes('--confirmar');

console.log(
  `\n${line}\n  RECONCILIAÇÃO BANCO × STORAGE (${confirm ? 'LIMPEZA DE ÓRFÃOS' : 'AUDITORIA'})\n${line}`,
);

try {
  const outcome = await reconcilePlatformStorage({
    deleteOrphans: confirm,
    graceHours: Number.isFinite(graceHours) ? graceHours : DEFAULT_ORPHAN_GRACE_HOURS,
  });

  if (!outcome.ok) {
    console.error(`\n  ✗ ${outcome.message}\n`);
    process.exit(1);
  }

  const { result } = outcome;
  const { report } = result;
  const orphanMb = (report.orphanBytes / 1024 / 1024).toFixed(2);

  console.log(`\n  Buckets varridos ............ ${report.scannedBuckets}`);
  console.log(`  Referências ativas no DB .... ${report.totalDbRefs}`);
  console.log(`  Objetos no storage .......... ${report.totalBucketObjects}`);
  console.log(`  Carência de upload .......... ${report.graceHours}h`);
  console.log(`  Protegidos na carência ...... ${report.skippedWithinGrace.length}`);
  console.log(`  Órfãos elegíveis ............ ${report.orphansInBucket.length} (${orphanMb} MB)`);
  console.log(`  Ausentes no bucket .......... ${report.missingInBucket.length}`);

  if (confirm) {
    console.log(
      `\n  Removidos: ${result.deletedOrphans} · Falhas na remoção: ${result.failedDeletes}`,
    );
  } else if (report.orphansInBucket.length > 0) {
    console.log('\n  Passe --confirmar para remover os objetos órfãos fora da carência.');
  }

  console.log(`${line}\n`);
  process.exit(0);
} finally {
  await adminPrisma.$disconnect().catch(() => undefined);
  await disconnectDb().catch(() => undefined);
}

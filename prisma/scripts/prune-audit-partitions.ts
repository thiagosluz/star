/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CLI — Retenção de partições mensais de `audit_logs` (FASE 130 · B8)
 *
 *      npm run db:partitions:prune -- --months=12              # simulação (dry-run)
 *      npm run db:partitions:prune -- --months=12 --confirmar  # executa DROP TABLE
 *
 *  Sem `--months` lê `AUDIT_RETENTION_MONTHS`. Sem `--confirmar` nunca apaga nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { parseRetentionMonthsEnv } from '../../src/domain/platform/partition-retention-rules.ts';
import { adminPrisma } from '../../src/lib/db/admin-client.ts';
import { disconnectDb } from '../../src/lib/db/tenant-client.ts';
import { pruneAuditPartitions } from '../../src/lib/platform/partition-service.ts';

const line = '─'.repeat(78);
const monthsArg = process.argv.find((arg) => arg.startsWith('--months='))?.split('=')[1];
const confirm = process.argv.includes('--confirmar');
const retentionMonths = parseRetentionMonthsEnv(monthsArg ?? process.env.AUDIT_RETENTION_MONTHS);

console.log(`\n${line}\n  RETENÇÃO DE PARTIÇÕES DE audit_logs (${confirm ? 'EXECUÇÃO' : 'SIMULAÇÃO'})\n${line}`);

try {
  const outcome = await pruneAuditPartitions({
    retentionMonths,
    dryRun: !confirm,
  });

  if (!outcome.ok) {
    console.error(`\n  ✗ ${outcome.message}\n`);
    process.exit(1);
  }

  const { result } = outcome;

  if (!result.enabled) {
    console.log('\n  · Retenção desligada (defina AUDIT_RETENTION_MONTHS ou --months=N).');
    console.log(`${line}\n`);
    process.exit(0);
  }

  console.log(
    `\n  Política: manter últimos ${result.retentionMonths} meses (corte < ${result.cutoffMonth})`,
  );

  if (result.eligible.length === 0) {
    console.log('  · Nenhuma partição elegível para descarte.');
  } else {
    for (const part of result.eligible) {
      const mb = (part.bytes / 1024 / 1024).toFixed(2);
      const tag = confirm ? 'DESCARTADA' : 'SIMULAÇÃO';
      console.log(`  [${tag}] ${part.name} · ${part.rows} linha(s) · ${mb} MB`);
    }
    const totalMb = (result.reclaimableBytes / 1024 / 1024).toFixed(2);
    console.log(`\n  Total elegível: ${result.eligible.length} partição(ões) · ${result.reclaimableRows} linha(s) · ${totalMb} MB`);
    if (!confirm) {
      console.log('  Passe --confirmar para executar o DROP TABLE das partições listadas.');
    }
  }

  console.log(`${line}\n`);
  process.exit(0);
} finally {
  await adminPrisma.$disconnect().catch(() => undefined);
  await disconnectDb().catch(() => undefined);
}

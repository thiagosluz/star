/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MANUTENÇÃO DAS PARTIÇÕES DE `audit_logs` PELA LINHA DE COMANDO (FASE 36)
 *
 *      npm run db:partitions                 # mês atual + 2
 *      npm run db:partitions -- --months=6    # mês atual + 6
 *
 *  O worker já roda isto todo dia às 3h (rotina `audit-partitions`). A CLI existe
 *  por dois motivos honestos: quem opera sem worker no ar precisa do comando, e uma
 *  partição criada à mão depois de uma virada de mês mal assistida merece um
 *  caminho explícito.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ELA NÃO REIMPLEMENTA NADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 13 tinha um `.mjs` próprio, e a FASE 36 trouxe a mesma manutenção para o
 *  worker. Duas cópias divergem — e a que ficasse para trás criaria partição sem
 *  policy de RLS. Aqui a CLI é uma CASCA sobre
 *  `src/lib/platform/partition-service.ts`, o mesmo módulo que o worker chama.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { disconnectDb } from '../../src/lib/db/tenant-client.ts';
import { adminPrisma } from '../../src/lib/db/admin-client.ts';
import {
  DEFAULT_PARTITION_MONTHS_AHEAD,
  ensureAuditPartitions,
} from '../../src/lib/platform/partition-service.ts';

const line = '─'.repeat(78);

const monthsArg = process.argv.find((arg) => arg.startsWith('--months='))?.split('=')[1];
const monthsAhead = monthsArg
  ? Number(monthsArg)
  : Number(process.env.PARTITION_MONTHS_AHEAD ?? DEFAULT_PARTITION_MONTHS_AHEAD);

console.log(`\n${line}\n  PARTIÇÕES DE audit_logs\n${line}`);

try {
  const outcome = await ensureAuditPartitions({ monthsAhead });

  if (!outcome.ok) {
    console.error(`\n  ✗ ${outcome.message}\n`);
    process.exit(1);
  }

  const { result } = outcome;

  console.log(`  garantindo o mês atual e mais ${result.monthsAhead} mês(es)\n`);

  if (result.created.length === 0) {
    console.log('  · todas as partições do intervalo já existiam');
  }

  for (const name of result.created) {
    console.log(`  ✓ ${name} criada`);
  }

  if (result.rescued > 0) {
    console.log(`  ✓ ${result.rescued} linha(s) resgatada(s) da partição DEFAULT`);
  }

  console.log(`\n  ${'partição'.padEnd(28)} ${'linhas'.padStart(8)}  ${'tamanho'.padStart(10)}`);

  for (const partition of result.partitions) {
    const megabytes = (partition.bytes / 1024 / 1024).toFixed(2);
    console.log(
      `  ${partition.name.padEnd(28)} ${String(partition.rows).padStart(8)}  ${`${megabytes} MB`.padStart(10)}`,
    );
  }

  console.log(`\n  total: ${result.totalRows} linha(s)`);
  console.log(
    '\n  A retenção continua sendo decisão de negócio: esta manutenção CRIA e mantém,\n' +
      '  e nunca apaga. Apagar é `DROP TABLE audit_logs_<AAAA_MM>` (dívida B8).',
  );
  console.log(`${line}\n`);

  process.exit(0);
} catch (error) {
  console.error(`\n  ✗ Falha ao garantir as partições: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
} finally {
  await adminPrisma.$disconnect().catch(() => undefined);
  await disconnectDb().catch(() => undefined);
}

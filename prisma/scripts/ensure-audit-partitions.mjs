/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MANUTENÇÃO DAS PARTIÇÕES DE `audit_logs` — FASE 13
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Uma tabela particionada por faixa só aceita escrita na faixa que existe. Como
 *  as partições são criadas com meses de antecedência, alguém precisa criá-las
 *  antes que o mês vire — e esse alguém não pode ser uma pessoa lembrando.
 *
 *  Este script:
 *    1. garante as partições do mês atual e dos `PARTITION_MONTHS_AHEAD` seguintes
 *       (padrão 2);
 *    2. se a partição DEFAULT tiver linhas na faixa que está sendo criada — o que
 *       acontece quando o mês virou sem manutenção —, MOVE essas linhas para a
 *       partição nova (o PostgreSQL recusa criar uma partição cujo intervalo
 *       colida com linhas já existentes na DEFAULT);
 *    3. imprime o estado atual (linhas e tamanho por partição), para que a
 *       operação veja o histórico e possa decidir sobre retenção.
 *
 *  Uso:
 *    npm run db:partitions                 # atual + 2 meses
 *    npm run db:partitions -- --months=6   # atual + 6 meses
 *
 *  Roda com a role ADMIN (DDL), igual às migrações. Não é um job de aplicação:
 *  agende no host (cron/task scheduler) ou no orquestrador.
 */
import 'dotenv/config';

import pg from 'pg';

const line = '─'.repeat(78);

const ADMIN_URL =
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://eventflow_admin:eventflow_dev_password@localhost:5432/eventflow?schema=public';

const monthsAhead = Number(
  process.argv.find((arg) => arg.startsWith('--months='))?.split('=')[1] ??
    process.env.PARTITION_MONTHS_AHEAD ??
    2,
);

/** `pg` não entende os parâmetros de URL do Prisma (`?schema=public`). */
function forPg(url) {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
}

/**
 * `2026-09-01` → `audit_logs_2026_09`.
 *
 * O nome sai daqui e é interpolado no SQL (nome de tabela não é parametrizável).
 * É seguro porque a função só produz `audit_logs_<4 dígitos>_<2 dígitos>` a partir
 * de uma `Date` calculada no processo — nada vem do usuário nem do ambiente.
 */
function partitionName(month) {
  const [year, monthNumber] = month.toISOString().slice(0, 7).split('-');
  return `audit_logs_${year}_${monthNumber}`;
}

/** Primeiro dia do mês, em UTC, deslocado `offset` meses. */
function monthStart(offset = 0) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/** `YYYY-MM-DD` estável (sem fuso local). */
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const client = new pg.Client({ connectionString: forPg(ADMIN_URL) });
  await client.connect();

  try {
    const { rows: kind } = await client.query(
      `SELECT relkind FROM pg_class WHERE oid = to_regclass('public.audit_logs')`,
    );

    if (kind.length === 0) {
      console.error('\n  ✗ Tabela audit_logs inexistente. Rode `npm run db:migrate`.\n');
      process.exit(1);
    }

    if (kind[0].relkind !== 'p') {
      console.error('\n  ✗ audit_logs NÃO está particionada.');
      console.error('    Aplique a migração 20260917200000_audit_logs_partitioning');
      console.error('    (`npm run db:migrate:deploy`).\n');
      process.exit(1);
    }

    console.log(`\n${line}\n  PARTIÇÕES DE audit_logs\n${line}`);
    console.log(`  garantindo o mês atual e mais ${monthsAhead} mês(es)\n`);

    for (let offset = 0; offset <= monthsAhead; offset += 1) {
      const start = monthStart(offset);
      const end = monthStart(offset + 1);
      const name = partitionName(start);

      const { rows: exists } = await client.query(
        `SELECT 1 FROM pg_class WHERE oid = to_regclass($1)`,
        [`public.${name}`],
      );

      if (exists.length > 0) {
        console.log(`  · ${name} já existe`);
        continue;
      }

      // ── Resgate das linhas que caíram na DEFAULT ──────────────────────────
      //  A ordem importa: o PostgreSQL recusa criar a partição enquanto a DEFAULT
      //  contiver linhas do intervalo. Guardamos em tabela temporária, apagamos
      //  da DEFAULT, criamos a partição e reinserimos — sem perder auditoria.
      const { rows: count } = await client.query(
        `SELECT count(*)::int AS total FROM public.audit_logs_default
          WHERE "createdAt" >= $1 AND "createdAt" < $2`,
        [isoDate(start), isoDate(end)],
      );

      let rescued = 0;

      // ── O limite da partição vai INTERPOLADO, não parametrizado ─────────────
      //  O `CREATE TABLE ... PARTITION OF ... FOR VALUES FROM ($1) TO ($2)` falha
      //  com "bind message supplies 2 parameters, but prepared statement requires
      //  0": o PostgreSQL não aceita parâmetros em DDL — o limite de partição tem
      //  de ser literal em tempo de parse. Os valores vêm de `isoDate()` sobre uma
      //  `Date` calculada aqui, portanto são sempre `YYYY-MM-DD`.
      const from = `'${isoDate(start)}'`;
      const to = `'${isoDate(end)}'`;

      if (count[0].total > 0) {
        await client.query('BEGIN');
        await client.query(
          `CREATE TEMP TABLE audit_partition_rescue ON COMMIT DROP AS
             SELECT * FROM public.audit_logs_default
              WHERE "createdAt" >= $1 AND "createdAt" < $2`,
          [isoDate(start), isoDate(end)],
        );
        await client.query(
          `DELETE FROM public.audit_logs_default
            WHERE "createdAt" >= $1 AND "createdAt" < $2`,
          [isoDate(start), isoDate(end)],
        );
        await client.query(
          `CREATE TABLE public.${name} PARTITION OF public.audit_logs
             FOR VALUES FROM (${from}) TO (${to})`,
        );
        await client.query('INSERT INTO public.audit_logs SELECT * FROM audit_partition_rescue');
        await client.query('COMMIT');
        rescued = count[0].total;
      } else {
        await client.query(
          `CREATE TABLE public.${name} PARTITION OF public.audit_logs
             FOR VALUES FROM (${from}) TO (${to})`,
        );
      }

      // Privilégios para a role de runtime (as partições nascem depois dos
      // `ALTER DEFAULT PRIVILEGES`, mas ser explícito aqui evita depender disso).
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${name} TO eventflow_app`);
      await client.query(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE public.${name} FORCE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS tenant_isolation ON public.${name}`);
      await client.query(
        `CREATE POLICY tenant_isolation ON public.${name}
           FOR ALL TO eventflow_app
           USING ("tenantId" = app_current_tenant_id())
           WITH CHECK ("tenantId" = app_current_tenant_id())`,
      );

      console.log(
        `  ✓ ${name} criada${rescued > 0 ? ` (${rescued} linha(s) resgatada(s) da DEFAULT)` : ''}`,
      );
    }

    // ── Estado atual ────────────────────────────────────────────────────────
    const { rows: partitions } = await client.query(`
      SELECT c.relname AS nome,
             pg_total_relation_size(c.oid) AS bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition
         AND c.relname LIKE 'audit_logs%'
       ORDER BY c.relname
    `);

    console.log(`\n  ${'partição'.padEnd(28)} ${'linhas'.padStart(8)}  ${'tamanho'.padStart(10)}`);

    for (const row of partitions) {
      const { rows: counted } = await client.query(
        `SELECT count(*)::int AS total FROM public.${row.nome}`,
      );
      const megabytes = (Number(row.bytes) / 1024 / 1024).toFixed(2);
      console.log(
        `  ${row.nome.padEnd(28)} ${String(counted[0].total).padStart(8)}  ${`${megabytes} MB`.padStart(10)}`,
      );
    }

    const { rows: total } = await client.query('SELECT count(*)::int AS total FROM public.audit_logs');
    console.log(`\n  total: ${total[0].total} linha(s)`);
    console.log(`${line}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\n  ✗ Falha ao garantir as partições: ${error.message}\n`);
  process.exit(1);
});

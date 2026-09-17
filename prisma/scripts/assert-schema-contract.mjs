#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  assert-schema-contract.mjs
 *
 *  Verifica, contra o banco REAL, que o contrato de isolamento está intacto.
 *  Sai com código 1 (falha o CI / o `npm run db:setup`) em qualquer violação.
 *
 *  Verificações:
 *    1. Toda tabela do schema.prisma com coluna `tenantId` tem RLS habilitada.
 *    2. Toda tabela com RLS também tem FORCE (para o dono não escapar).
 *    3. Nenhuma tabela com RLS ficou sem policy (fail-closed silencioso).
 *    3b. Toda PARTIÇÃO (FASE 13) tem RLS habilitada, FORCE e policy própria.
 *    4. A allowlist de tabelas sem RLS não cresceu sem intenção.
 *    5. A role de runtime não é superuser nem tem BYPASSRLS.
 *    6. A role de runtime tem os GRANTs necessários (senão a app quebra em runtime).
 *
 *  Uso:
 *    node --env-file=.env prisma/scripts/assert-schema-contract.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { Client } from 'pg';
import {
  APP_ROLE,
  TABLES_WITHOUT_RLS,
  TENANT_SCOPED_TABLES,
} from '../../src/lib/db/schema-contract.ts';

const connectionString =
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://eventflow_admin:eventflow_dev_password@localhost:5432/eventflow';

const failures = [];
const notes = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const client = new Client({ connectionString });

try {
  await client.connect();

  // ── 1..3 Tabelas com a coluna de tenant e estado da RLS ─────────────────────
  //  O Prisma gera a coluna como "tenantId" (camelCase). Identificadores citados
  //  são case-sensitive no PostgreSQL, então a busca pela coluna usa esse nome.
  //
  //  `relispartition = false`: desde a FASE 13 `audit_logs` é particionada por mês
  //  e as partições são tabelas reais com a coluna `tenantId`. Elas não estão (nem
  //  podem estar) em `TENANT_SCOPED_TABLES`, que é escrito à mão — o nome de uma
  //  partição depende da data. A verificação delas é própria e vem na seção 3b.
  //
  //  `relkind IN ('r', 'p')`: 'p' é a tabela PARTICIONADA (o pai), que continua
  //  sendo uma tabela governada como qualquer outra. Filtrar só por 'r' deixaria o
  //  pai fora da verificação e faria o contrato acusar `audit_logs` como ausente.
  const { rows: tenantTables } = await client.query(`
    SELECT c.relname                                   AS table_name,
           c.relkind                                   AS kind,
           c.relrowsecurity                            AS rls_enabled,
           c.relforcerowsecurity                       AS rls_forced,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policy_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenantId' AND a.attnum > 0
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    ORDER BY c.relname
  `);

  const tenantTableNames = tenantTables.map((r) => r.table_name);

  for (const row of tenantTables) {
    check(
      row.rls_enabled,
      `"${row.table_name}" tem coluna tenantId mas RLS NÃO está habilitada.`,
    );
    check(
      row.rls_forced,
      `"${row.table_name}" tem RLS mas sem FORCE ROW LEVEL SECURITY (o dono da tabela escaparia).`,
    );
    check(
      row.policy_count > 0,
      `"${row.table_name}" tem RLS habilitada e NENHUMA policy (fail-closed: a app não lê nada).`,
    );
  }

  // ── 3b. Partições: RLS não é opcional na filha ───────────────────────────────
  //  Acesso pela tabela pai já é filtrado pela policy do pai. Mas uma query que
  //  cite a partição pelo nome encontraria todos os tenants se a filha não tivesse
  //  policy própria — e as partições são criadas por script, ou seja, é
  //  exatamente o tipo de objeto que nasce sem proteção quando ninguém lembra.
  const { rows: partitions } = await client.query(`
    SELECT c.relname                                AS partition_name,
           parent.relname                           AS parent_name,
           c.relrowsecurity                         AS rls_enabled,
           c.relforcerowsecurity                    AS rls_forced,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policy_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relispartition
    ORDER BY c.relname
  `);

  const partitionNames = partitions.map((r) => r.partition_name);

  for (const row of partitions) {
    check(
      row.rls_enabled,
      `Partição "${row.partition_name}" sem RLS habilitada (leitura direta vazaria tenants).`,
    );
    check(
      row.rls_forced,
      `Partição "${row.partition_name}" com RLS mas sem FORCE ROW LEVEL SECURITY.`,
    );
    check(row.policy_count > 0, `Partição "${row.partition_name}" sem policy.`);
  }

  // ── 4. Divergência entre o banco e o contrato em código ─────────────────────
  const contractSet = new Set(TENANT_SCOPED_TABLES);
  const dbSet = new Set(tenantTableNames);

  const missingInContract = tenantTableNames.filter((t) => !contractSet.has(t));
  check(
    missingInContract.length === 0,
    `Tabelas com tenantId ausentes de src/lib/db/schema-contract.ts: ${missingInContract.join(', ')}. ` +
      `Adicione-as ao contrato e à policy de RLS.`,
  );

  const missingInDb = TENANT_SCOPED_TABLES.filter((t) => !dbSet.has(t));
  if (missingInDb.length > 0) {
    notes.push(
      `Declaradas no contrato mas ainda sem coluna tenantId no banco (migração pendente?): ${missingInDb.join(', ')}`,
    );
  }

  // ── 5. Tabelas com RLS fora das duas listas conhecidas ──────────────────────
  const { rows: rlsTables } = await client.query(`
    SELECT relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
    ORDER BY relname
  `);

  //  As partições entram em `knownWithRls` porque a seção 3b já exigiu RLS nelas:
  //  estarem aqui apenas impede que a seção 5 as reporte como surpresa.
  const knownWithRls = new Set([
    ...tenantTableNames,
    ...partitionNames,
    'user',
    'session',
    'tenants',
  ]);
  const unexpectedRls = rlsTables
    .map((r) => r.table_name)
    .filter((t) => !knownWithRls.has(t));
  check(
    unexpectedRls.length === 0,
    `Tabelas com RLS não previstas no contrato: ${unexpectedRls.join(', ')}.`,
  );

  // ── 6. Tabelas deliberadamente sem RLS não podem ter crescido ───────────────
  //  Só tabelas-BASE: partições são criadas por script e a allowlist escrita à mão
  //  não pode contê-las (o nome muda todo mês). A proteção delas é a seção 3b.
  const { rows: allTables } = await client.query(`
    SELECT c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND c.relname <> '_prisma_migrations'
    ORDER BY relname
  `);

  const withoutRls = allTables
    .map((r) => r.table_name)
    .filter((t) => !knownWithRls.has(t));

  const allowedWithoutRls = new Set(TABLES_WITHOUT_RLS);
  const suspicious = withoutRls.filter((t) => !allowedWithoutRls.has(t));
  check(
    suspicious.length === 0,
    `Tabelas SEM RLS e fora da allowlist: ${suspicious.join(', ')}. ` +
      `Se são dados de tenant, adicione tenantId + RLS.`,
  );

  // ── 7. A role de runtime é realmente desprivilegiada ────────────────────────
  const { rows: roleRows } = await client.query(
    `SELECT rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb
     FROM pg_roles WHERE rolname = $1`,
    [APP_ROLE],
  );

  check(roleRows.length === 1, `Role de runtime "${APP_ROLE}" não existe.`);
  if (roleRows.length === 1) {
    const r = roleRows[0];
    check(!r.rolsuper, `Role "${APP_ROLE}" é SUPERUSER — a RLS seria ignorada.`);
    check(!r.rolbypassrls, `Role "${APP_ROLE}" tem BYPASSRLS — a RLS seria ignorada.`);
    check(r.rolcanlogin, `Role "${APP_ROLE}" não pode fazer login.`);
    check(!r.rolcreaterole, `Role "${APP_ROLE}" pode criar roles (excessivo).`);
    check(!r.rolcreatedb, `Role "${APP_ROLE}" pode criar bancos (excessivo).`);
  }

  // ── 8. GRANTs mínimos da role de runtime ────────────────────────────────────
  const { rows: grantRows } = await client.query(
    `SELECT DISTINCT privilege_type
     FROM information_schema.role_table_grants
     WHERE grantee = $1 AND table_schema = 'public'`,
    [APP_ROLE],
  );
  const privileges = new Set(grantRows.map((r) => r.privilege_type));
  for (const needed of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    check(
      privileges.has(needed),
      `Role "${APP_ROLE}" não tem ${needed} nas tabelas do schema public.`,
    );
  }
  check(
    !privileges.has('TRUNCATE'),
    `Role "${APP_ROLE}" tem TRUNCATE — remova (a aplicação nunca esvazia tabelas).`,
  );

  // ── 9. A função de contexto existe ─────────────────────────────────────────
  const { rows: fnRows } = await client.query(
    `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'app_current_tenant_id' AND n.nspname = 'public'`,
  );
  check(fnRows.length === 1, `Função app_current_tenant_id() ausente.`);
} catch (error) {
  failures.push(`Erro ao inspecionar o banco: ${error.message}`);
} finally {
  await client.end().catch(() => {});
}

// ───────────────────────────────────────────────────────────────────────────────
//  Relatório
// ───────────────────────────────────────────────────────────────────────────────
const line = '─'.repeat(78);
console.log(`\n${line}\n  CONTRATO DE ISOLAMENTO MULTI-TENANT\n${line}`);

for (const note of notes) console.log(`  ℹ  ${note}`);

if (failures.length > 0) {
  console.log('');
  for (const f of failures) console.log(`  ✗  ${f}`);
  console.log(`\n  ${failures.length} violação(ões) de contrato.\n${line}\n`);
  process.exit(1);
}

console.log(`  ✓  RLS habilitada + FORCE em todas as tabelas com tenantId`);
console.log(`  ✓  Nenhuma tabela com RLS ficou sem policy`);
console.log(`  ✓  Role "${APP_ROLE}" sem superuser e sem BYPASSRLS`);
console.log(`  ✓  GRANTs mínimos presentes, TRUNCATE ausente`);
console.log(`\n  Contrato íntegro.\n${line}\n`);

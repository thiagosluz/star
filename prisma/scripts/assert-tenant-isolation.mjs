#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  assert-tenant-isolation.mjs
 *
 *  Prova, contra um banco PostgreSQL real, que o isolamento entre instituições
 *  é garantido pelo BANCO e não pela disciplina do código de aplicação.
 *
 *  Todos os acessos abaixo usam a role de RUNTIME (`eventflow_app`) — a mesma
 *  que atende as requisições dos usuários. Se a RLS tivesse um furo, este script
 *  falharia.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ATAQUES SIMULADOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *   A1  Sem contexto de tenant, é possível ler eventos?           -> deve ser NÃO
 *   A2  Tenant A enxerga eventos do Tenant B?                     -> deve ser NÃO
 *   A3  Tenant A consegue ATUALIZAR evento do Tenant B?           -> deve ser 0 linhas
 *   A4  Tenant A consegue DELETAR evento do Tenant B?             -> deve ser 0 linhas
 *   A5  Tenant A consegue INSERIR evento carimbado como Tenant B? -> deve FALHAR
 *   A6  Tenant A enxerga membros (user_tenant_profiles) do B?     -> deve ser NÃO
 *   A7  Agregado COUNT(*) global vaza volume do outro tenant?     -> deve contar só o próprio
 *   A8  O contexto vaza para a próxima query na mesma conexão?    -> deve ser NÃO
 *
 *  Uso:
 *    node --env-file=.env prisma/scripts/assert-tenant-isolation.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const ADMIN_URL =
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://eventflow_admin:eventflow_dev_password@localhost:5432/eventflow';

const APP_URL =
  process.env.APP_DATABASE_URL ??
  `postgresql://${process.env.APP_DB_USER ?? 'eventflow_app'}:${
    process.env.APP_DB_PASSWORD ?? 'eventflow_app_password'
  }@${process.env.DB_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5432'}/${
    process.env.POSTGRES_DB ?? 'eventflow'
  }`;

const results = [];
function record(id, description, passed, detail) {
  results.push({ id, description, passed, detail });
}

const admin = new Client({ connectionString: ADMIN_URL });
const app = new Client({ connectionString: APP_URL });

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();
const EVENT_A = randomUUID();
const EVENT_B = randomUUID();

let connected = false;

try {
  await admin.connect();
  await app.connect();
  connected = true;

  // ───────────────────────────────────────────────────────────────────────────
  //  Fixture: duas instituições isoladas, criadas pela role ADMIN.
  //  (A role de runtime não pode criar tenants — isso é proposital.)
  // ───────────────────────────────────────────────────────────────────────────
  await admin.query('BEGIN');

  for (const [id, slug, name] of [
    [TENANT_A, `iso-a-${TENANT_A.slice(0, 8)}`, 'Instituição A'],
    [TENANT_B, `iso-b-${TENANT_B.slice(0, 8)}`, 'Instituição B'],
  ]) {
    await admin.query(
      `INSERT INTO tenants (id, slug, name, status, plan, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', 'FREE', now(), now())`,
      [id, slug, name],
    );
  }

  for (const [id, name, email] of [
    [USER_A, 'Alice da Silva', `alice.${USER_A.slice(0, 8)}@example.test`],
    [USER_B, 'Bruno Souza', `bruno.${USER_B.slice(0, 8)}@example.test`],
  ]) {
    await admin.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      [id, name, email],
    );
  }

  for (const [tenantId, userId] of [
    [TENANT_A, USER_A],
    [TENANT_B, USER_B],
  ]) {
    await admin.query(
      `INSERT INTO user_tenant_profiles
         (id, "tenantId", "userId", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [randomUUID(), tenantId, userId],
    );
  }

  for (const [id, tenantId, slug, title] of [
    [EVENT_A, TENANT_A, 'congresso-a', 'Congresso da Instituição A'],
    [EVENT_B, TENANT_B, 'congresso-b', 'Congresso da Instituição B'],
  ]) {
    await admin.query(
      `INSERT INTO events
         (id, "tenantId", slug, title, status, modality, "startsAt", "endsAt", timezone,
          "createdAt", "updatedAt", theme, settings)
       VALUES ($1, $2, $3, $4, 'PUBLISHED', 'IN_PERSON', now(), now() + interval '2 days',
               'America/Bahia', now(), now(), '{}'::jsonb, '{}'::jsonb)`,
      [id, tenantId, slug, title],
    );
  }

  await admin.query('COMMIT');

  // ───────────────────────────────────────────────────────────────────────────
  //  A1 — Sem contexto de tenant, nada é visível (fail-closed)
  // ───────────────────────────────────────────────────────────────────────────
  {
    const { rows } = await app.query('SELECT count(*)::int AS n FROM events');
    record(
      'A1',
      'Sem contexto de tenant, nenhuma linha é visível (fail-closed)',
      rows[0].n === 0,
      `count = ${rows[0].n} (esperado 0)`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  A2 — Tenant A não enxerga eventos do Tenant B
  // ───────────────────────────────────────────────────────────────────────────
  {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);

    const { rows } = await app.query('SELECT id, "tenantId", title FROM events');
    const ids = rows.map((r) => r.id);
    const onlyOwn = ids.every((id) => id === EVENT_A);
    const sawForeign = ids.includes(EVENT_B);

    record(
      'A2',
      'Tenant A enxerga apenas os próprios eventos',
      onlyOwn && rows.length === 1 && !sawForeign,
      `viu ${rows.length} evento(s): ${ids.length ? ids.join(', ') : 'nenhum'}`,
    );

    await app.query('COMMIT');
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  A3 — Tenant A não consegue ATUALIZAR evento do Tenant B
  // ───────────────────────────────────────────────────────────────────────────
  {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);

    const res = await app.query(
      `UPDATE events SET title = 'HIJACKED' WHERE id = $1`,
      [EVENT_B],
    );
    record(
      'A3',
      'UPDATE em evento de outro tenant afeta 0 linhas',
      res.rowCount === 0,
      `rowCount = ${res.rowCount} (esperado 0)`,
    );
    await app.query('COMMIT');
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  A4 — Tenant A não consegue DELETAR evento do Tenant B
  // ───────────────────────────────────────────────────────────────────────────
  {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);

    const res = await app.query(`DELETE FROM events WHERE id = $1`, [EVENT_B]);
    record(
      'A4',
      'DELETE em evento de outro tenant afeta 0 linhas',
      res.rowCount === 0,
      `rowCount = ${res.rowCount} (esperado 0)`,
    );
    await app.query('COMMIT');
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  A5 — Tenant A não consegue INSERIR linha carimbada como Tenant B
  //       (WITH CHECK bloqueia a escrita forjada)
  // ───────────────────────────────────────────────────────────────────────────
  {
    let blocked = false;
    let detail = '';

    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
    try {
      await app.query(
        `INSERT INTO events
           (id, "tenantId", slug, title, status, modality, "startsAt", "endsAt", timezone,
            "createdAt", "updatedAt", theme, settings)
         VALUES ($1, $2, 'forged', 'Evento forjado', 'PUBLISHED', 'ONLINE', now(),
                 now() + interval '1 day', 'UTC', now(), now(), '{}'::jsonb, '{}'::jsonb)`,
        [randomUUID(), TENANT_B],
      );
    } catch (error) {
      blocked = true;
      detail = error.message.split('\n')[0];
    }
    await app.query('ROLLBACK');

    record(
      'A5',
      'INSERT com tenantId de outro tenant é rejeitado pelo WITH CHECK',
      blocked,
      blocked ? detail : 'INSERT foi ACEITO — falha grave de isolamento',
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  A6 — Tenant A não enxerga vínculos (membros) do Tenant B
  // ───────────────────────────────────────────────────────────────────────────
  {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
    const { rows } = await app.query(
      'SELECT id, "tenantId", "userId" FROM user_tenant_profiles',
    );
    const ok = rows.length === 1 && rows[0].tenantId === TENANT_A;
    record(
      'A6',
      'Tenant A enxerga apenas os próprios vínculos de usuário',
      ok,
      `viu ${rows.length} vínculo(s)`,
    );
    await app.query('COMMIT');
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  A7 — Agregação não vaza volume do outro tenant
  // ───────────────────────────────────────────────────────────────────────────
  {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
    const { rows } = await app.query(
      'SELECT count(*)::int AS n FROM events WHERE slug LIKE $1',
      ['congresso-%'],
    );
    await app.query('COMMIT');

    record(
      'A7',
      'COUNT(*) agregado conta apenas o próprio tenant',
      rows[0].n === 1,
      `count = ${rows[0].n} (esperado 1 de 2 existentes)`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  A8 — O contexto NÃO vaza para a próxima transação na mesma conexão
  //       Este é o bug clássico do `SET` sem `LOCAL`.
  // ───────────────────────────────────────────────────────────────────────────
  {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
    await app.query('COMMIT');

    // Nova transação, SEM definir contexto. Se `SET LOCAL` vazasse, veríamos 1.
    const { rows } = await app.query('SELECT count(*)::int AS n FROM events');
    record(
      'A8',
      'Contexto de tenant não vaza para a transação seguinte (SET LOCAL)',
      rows[0].n === 0,
      `count = ${rows[0].n} (esperado 0 — a conexão voltou limpa ao pool)`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  A9 — A role de runtime não pode desligar a RLS nem se promover
  // ───────────────────────────────────────────────────────────────────────────
  {
    let escalationBlocked = true;
    const errors = [];

    for (const sql of [
      'ALTER TABLE events DISABLE ROW LEVEL SECURITY',
      'ALTER ROLE eventflow_app SUPERUSER',
      'ALTER ROLE eventflow_app BYPASSRLS',
      'ALTER TABLE events NO FORCE ROW LEVEL SECURITY',
    ]) {
      try {
        await app.query(sql);
        escalationBlocked = false;
        errors.push(`PERMITIDO INDEVIDAMENTE: ${sql}`);
      } catch {
        // esperado
      }
    }

    record(
      'A9',
      'Role de runtime não consegue desligar a RLS nem escalar privilégio',
      escalationBlocked,
      escalationBlocked ? 'todas as tentativas rejeitadas' : errors.join(' | '),
    );
  }
} catch (error) {
  console.error(`\n  ERRO FATAL durante o teste de isolamento: ${error.message}\n`);
  process.exitCode = 2;
} finally {
  // ───────────────────────────────────────────────────────────────────────────
  //  Limpeza: remove a fixture. ON DELETE CASCADE cuida das tabelas filhas.
  // ───────────────────────────────────────────────────────────────────────────
  if (connected) {
    try {
      await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [
        [TENANT_A, TENANT_B],
      ]);
      await admin.query('DELETE FROM "user" WHERE id = ANY($1::uuid[])', [
        [USER_A, USER_B],
      ]);
    } catch (error) {
      console.error(`  Aviso: falha na limpeza da fixture: ${error.message}`);
    }
    await admin.end().catch(() => {});
    await app.end().catch(() => {});
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Relatório
// ───────────────────────────────────────────────────────────────────────────────
if (connected) {
  const line = '─'.repeat(78);
  console.log(`\n${line}\n  ISOLAMENTO MULTI-TENANT — PROVA CONTRA O BANCO REAL\n${line}\n`);

  for (const r of results) {
    console.log(`  ${r.passed ? '✓' : '✗'}  [${r.id}] ${r.description}`);
    console.log(`         ${r.detail}`);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${line}`);
  if (failed.length > 0) {
    console.log(`  ${failed.length} de ${results.length} verificações FALHARAM.`);
    console.log(`  O isolamento entre tenants NÃO está garantido.\n${line}\n`);
    process.exitCode = 1;
  } else {
    console.log(`  ${results.length}/${results.length} verificações passaram.`);
    console.log('  Isolamento entre tenants garantido pelo banco.\n' + line + '\n');
  }
}

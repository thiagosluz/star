/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  VERIFICAÇÃO DO POOLING (PgBouncer em modo TRANSACTION) — FASE 13
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O que este script prova — e por que ele precisa existir:
 *
 *  O PgBouncer em modo transação devolve a conexão ao pool no COMMIT, então a
 *  MESMA conexão física atende transações de tenants diferentes, uma depois da
 *  outra (e, sob concorrência, transações de clientes diferentes se alternando).
 *  O isolamento multi-tenant da plataforma depende de o contexto nunca sobreviver
 *  à transação. A aplicação usa `set_config('app.tenant_id', $1, true)`
 *  (= `SET LOCAL`), que morre no COMMIT — mas "deve funcionar" não é evidência.
 *
 *  As três provas abaixo são executadas contra o POOLER (porta 6432), não contra
 *  o PostgreSQL direto:
 *
 *    1. HIGIENE     — depois de uma transação com tenant, a PRÓXIMA transação na
 *                     mesma conexão do pooler não enxerga `app.tenant_id`.
 *    2. CONCORRÊNCIA— 8 transações simultâneas, cada uma com um tenant distinto e
 *                     pool de 2 conexões de servidor, leem de volta o próprio
 *                     tenant (nenhum vazamento cruzado pela reutilização).
 *    3. RLS         — dentro do contexto do tenant A, contar linhas do tenant B
 *                     devolve 0: a policy continua valendo através do pooler.
 *
 *  Uso:
 *    docker compose --profile pooler up -d pooler
 *    npm run db:verify:pooling
 *
 *  Sem `DATABASE_URL_POOLED` o script tenta a URL padrão de desenvolvimento em
 *  `localhost:6432` e falha com instrução clara se o pooler não estiver no ar.
 */
import 'dotenv/config';

import pg from 'pg';

const line = '─'.repeat(78);

const ADMIN_URL =
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://eventflow_admin:eventflow_dev_password@localhost:5432/eventflow?schema=public';

const POOLED_URL =
  process.env.DATABASE_URL_POOLED ??
  `postgresql://${process.env.APP_DB_USER ?? 'eventflow_app'}:${
    process.env.APP_DB_PASSWORD ?? 'eventflow_app_password'
  }@localhost:${process.env.PGBOUNCER_PORT ?? 6432}/${process.env.POSTGRES_DB ?? 'eventflow'}`;

/** Remove `?schema=public` e afins: `pg` não entende os parâmetros do Prisma. */
function forPg(url) {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
}

let failures = 0;

function check(ok, label, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** Abre uma transação, aplica o contexto de tenant e devolve o cliente. */
async function beginWithTenant(client, tenantId) {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function readSetting(client) {
  const result = await client.query("SELECT current_setting('app.tenant_id', true) AS tenant");
  return result.rows[0]?.tenant ?? '';
}

async function main() {
  console.log(`\n${line}\n  VERIFICAÇÃO DO POOLING (PgBouncer · modo transação)\n${line}`);
  console.log(`  pooled: ${POOLED_URL.replace(/:[^:@/]+@/, ':***@')}\n`);

  // ── Tenants reais do seed, com a contagem esperada de eventos de cada um ────
  const admin = new pg.Client({ connectionString: forPg(ADMIN_URL) });
  await admin.connect();

  const tenants = await admin.query(
    'SELECT id, slug, (SELECT count(*)::int FROM events e WHERE e."tenantId" = t.id) AS events FROM tenants t ORDER BY slug LIMIT 2',
  );

  await admin.end();

  if (tenants.rows.length < 2) {
    console.error('  ✗ O banco precisa de pelo menos 2 tenants (rode `npm run db:seed`).\n');
    process.exit(1);
  }

  const [a, b] = tenants.rows;
  console.log(`  tenant A: ${a.slug} (${a.events} eventos)`);
  console.log(`  tenant B: ${b.slug} (${b.events} eventos)\n`);

  const pool = new pg.Pool({ connectionString: forPg(POOLED_URL), max: 8 });

  try {
    // ── 1. Higiene: `SET LOCAL` não sobrevive ao COMMIT ──────────────────────
    const connection = await pool.connect();
    await beginWithTenant(connection, a.id);
    const inside = await readSetting(connection);
    await connection.query('COMMIT');
    const afterCommit = await readSetting(connection);
    connection.release();

    check(inside === a.id, '1. dentro da transação o contexto é o do tenant', `${inside || '(vazio)'}`);
    check(
      afterCommit === '',
      '1. depois do COMMIT a mesma conexão não carrega contexto',
      `current_setting = ${afterCommit || '(vazio)'}`,
    );

    // ── 2. Concorrência: 8 transações simultâneas sobre poucas conexões ──────
    //    Cada transação segura a conexão de servidor por 1s (pg_sleep) DEPOIS de
    //    aplicar o contexto. Duas provas saem daí:
    //      (a) leitura — ninguém lê o contexto de outro cliente;
    //      (b) multiplexação — o PostgreSQL enxerga menos sessões da role de app
    //          do que clientes simultâneos, medido em `pg_stat_activity`.
    const poolSize = Number(process.env.PGBOUNCER_POOL_SIZE ?? 5);

    const rounds = Array.from({ length: 8 }, (_, index) => {
      const tenant = index % 2 === 0 ? a : b;
      return (async () => {
        const client = await pool.connect();
        try {
          await beginWithTenant(client, tenant.id);
          await client.query('SELECT pg_sleep(1)');
          const seen = await readSetting(client);
          // A leitura discriminante é o `tenantId` das linhas de `events`: se a
          // conexão fosse reatribuída no meio da transação, esta transação
          // enxergaria o tenant do outro cliente.
          //
          // `tenants` de propósito NÃO é usada aqui: a policy dela é
          // `USING (true)` (documentada) porque a resolução de slug -> id
          // acontece antes de existir contexto. Ela devolveria a mesma linha
          // para todo mundo e o teste passaria sem provar nada.
          const events = await client.query('SELECT count(*)::int AS total FROM events');
          const self = await client.query('SELECT DISTINCT "tenantId" AS id FROM events');
          await client.query('COMMIT');

          return {
            expected: tenant.id,
            seen,
            slug: tenant.slug,
            slugSeen: self.rows[0]?.id ?? null,
            events: events.rows[0].total,
            expectedEvents: tenant.events,
          };
        } finally {
          client.release();
        }
      })();
    });

    // Mede as sessões do PostgreSQL enquanto as 8 transações estão em voo.
    // `state = 'active'` isola as conexões do pooler que estão executando o
    // `pg_sleep` das transações: as conexões ociosas do processo web ficam de
    // fora, e é exatamente isso que se quer medir.
    const measurement = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const observer = new pg.Client({ connectionString: forPg(ADMIN_URL) });
      await observer.connect();
      const result = await observer.query(
        `SELECT count(*)::int AS total
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND usename = $1
            AND state = 'active'`,
        [process.env.APP_DB_USER ?? 'eventflow_app'],
      );
      await observer.end();
      return result.rows[0].total;
    })();

    const [results, serverSessions] = await Promise.all([Promise.all(rounds), measurement]);

    check(
      results.every((r) => r.seen === r.expected),
      '2. nenhuma das 8 transações concorrentes viu o contexto de outra',
    );
    check(
      results.every((r) => r.slugSeen === r.expected),
      '2. cada transação enxergou apenas dados do próprio tenant',
      `tenants distintos vistos: ${[...new Set(results.map((r) => r.slugSeen))].length} (esperado 2)`,
    );
    check(
      results.every((r) => r.events === r.expectedEvents),
      '2. a contagem de eventos sob RLS corresponde ao tenant de cada transação',
      results.map((r) => `${r.slug}=${r.events}`).join(' · '),
    );
    check(
      serverSessions > 0 && serverSessions <= poolSize,
      `2. 8 clientes simultâneos couberam em no máximo ${poolSize} conexões de servidor`,
      `sessões ativas no PostgreSQL: ${serverSessions}`,
    );

    // ── 3. RLS atravessa o pooler ────────────────────────────────────────────
    const isolated = await pool.connect();
    await beginWithTenant(isolated, a.id);
    const crossTenant = await isolated.query('SELECT count(*)::int AS total FROM events WHERE "tenantId" = $1', [b.id]);
    await isolated.query('COMMIT');
    isolated.release();

    check(
      crossTenant.rows[0].total === 0,
      '3. no contexto do tenant A, linhas do tenant B são invisíveis',
      `count = ${crossTenant.rows[0].total}`,
    );
  } finally {
    await pool.end();
  }

  console.log(`\n${line}`);
  if (failures === 0) {
    console.log('  Pooling íntegro: contexto por transação preservado sob PgBouncer.');
    console.log(`${line}\n`);
  } else {
    console.error(`  ${failures} verificação(ões) falharam.`);
    console.error(`${line}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n  ✗ Falha ao verificar o pooling: ${error.message}`);
  console.error('    O pooler está no ar? `docker compose --profile pooler up -d pooler`');
  console.error('    A DATABASE_URL_POOLED aponta para ele?\n');
  process.exit(1);
});

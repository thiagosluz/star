#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  apply-rls.mjs — aplica as policies de Row-Level Security.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE SCRIPT EXISTE (e não é só um arquivo em docker/postgres/init)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PostgreSQL só executa `/docker-entrypoint-initdb.d` quando o volume de
 *  dados está VAZIO — ou seja, na primeira subida do container. Isso cobre o
 *  caso "dev novo clonando o repositório".
 *
 *  Mas RLS precisa ser reaplicada sempre que o schema muda: toda migração que
 *  cria uma tabela com `tenant_id` nasce SEM policy, e uma tabela com RLS
 *  habilitada e sem policy é fail-closed (a aplicação não lê nada).
 *
 *  Então este script é a via canônica e idempotente de (re)aplicar a RLS:
 *
 *      npm run db:rls
 *
 *  Ele executa os MESMOS arquivos SQL que o container usa no primeiro boot,
 *  garantindo que os dois caminhos nunca divirjam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const initDir = path.resolve(here, '..', '..', 'docker', 'postgres', 'init');

const connectionString =
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://eventflow_admin:eventflow_dev_password@localhost:5432/eventflow';

const line = '─'.repeat(78);
console.log(`\n${line}\n  APLICANDO POLICIES DE RLS\n${line}`);
console.log(`  diretório: docker/postgres/init`);
console.log(`  banco:     ${connectionString.replace(/:[^:@/]+@/, ':***@')}\n`);

const files = (await readdir(initDir)).filter((f) => f.endsWith('.sql')).sort();

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS POLICIES VIVEM NA MIGRAÇÃO (FASE 13, item B2)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O diretório `docker/postgres/init` só é executado pelo PostgreSQL na PRIMEIRA
 *  inicialização do volume — o que fazia um banco novo depender de alguém lembrar
 *  de rodar este script. As policies foram para
 *  `prisma/migrations/20260917191000_rls_policies/migration.sql`, e este script
 *  passou a reaplicar ESSE arquivo, de modo que:
 *
 *    • `prisma migrate deploy` cria as policies em ambiente novo;
 *    • `npm run db:rls` continua sendo o caminho para reaplicá-las depois de criar
 *      tabela com `tenantId` (o SQL é idempotente e descobre as tabelas sozinho).
 *
 *  Um arquivo, dois caminhos de aplicação — sem cópia para envelhecer.
 */
const rlsMigration = path.resolve(
  here,
  '..',
  'migrations',
  '20260917191000_rls_policies',
  'migration.sql',
);

if (files.length === 0) {
  console.error(`  ✗ Nenhum arquivo .sql encontrado em ${initDir}`);
  process.exit(1);
}

const client = new Client({ connectionString });
let failed = false;

try {
  await client.connect();

  for (const file of [...files.map((f) => path.join(initDir, f)), rlsMigration]) {
    const sql = await readFile(file, 'utf8');

    // Os arquivos começam com `\set ON_ERROR_STOP on`, um meta-comando do psql
    // e não SQL válido para o driver `pg`. Removemos as linhas de meta-comando;
    // o comportamento equivalente (abortar no primeiro erro) é o default de uma
    // transação.
    const executable = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('\\'))
      .join('\n');

    const label = path.relative(process.cwd(), file).replace(/\\/g, '/');
    process.stdout.write(`  → ${label} ... `);
    try {
      await client.query('BEGIN');
      await client.query(executable);
      await client.query('COMMIT');
      console.log('ok');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.log('FALHOU');
      console.error(`\n    ${error.message}\n`);
      failed = true;
      break;
    }
  }
} catch (error) {
  console.error(`\n  ✗ Erro de conexão: ${error.message}\n`);
  failed = true;
} finally {
  await client.end().catch(() => {});
}

if (failed) {
  console.error(`${line}\n  RLS NÃO foi aplicada. Corrija o erro acima.\n${line}\n`);
  process.exit(1);
}

console.log(`\n  ✓ Policies de RLS aplicadas com sucesso.`);
console.log(`  Valide com: node --env-file=.env prisma/scripts/assert-schema-contract.mjs\n${line}\n`);

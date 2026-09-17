/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — operação e segurança (FASE 13)
 *
 *  O que só a infraestrutura real pode provar:
 *    • A1 — o contador de rate limit vive no REDIS (TTL real, expiração real) e
 *      não na memória do processo;
 *    • B1 — o endpoint de métricas responde no formato do Prometheus, protege o
 *      acesso por token e é fechado em produção sem token;
 *    • B3 — `audit_logs` grava na partição do mês corrente, o que não tem faixa
 *      cai na DEFAULT, e a RLS continua valendo na tabela particionada;
 *    • B4 — o pooling em modo transação é verificado por
 *      `npm run db:verify:pooling` (script, não Vitest: exige o PgBouncer no ar).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as metricsRoute } from '../../src/app/api/metrics/route';
import { recordAudit } from '../../src/lib/admin/audit';
import { createRedisRateLimitStorage } from '../../src/lib/auth/rate-limit-storage';
import { certificateQueueStats } from '../../src/lib/certificates/queue';
import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { resetMetrics } from '../../src/lib/observability/metrics';

const RUN = randomUUID().slice(0, 8);
const KEY_PREFIX = `ef:teste:rl:${RUN}:`;

let tenantA: string;
let tenantB: string;

/** `audit_logs_2026_09` para a data informada (mês em UTC, como o particionamento). */
function partitionNameFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  return `audit_logs_${year}_${month}`;
}

/** Consulta estrutural do catálogo — leitura administrativa, fora do escopo de tenant. */
async function partitionOf(id: string): Promise<string> {
  const rows = await adminPrisma.$queryRaw<{ particao: string }[]>`
    SELECT tableoid::regclass::text AS particao FROM audit_logs WHERE id = ${id}::uuid
  `;

  return rows[0]?.particao ?? '';
}

beforeAll(async () => {
  tenantA = randomUUID();
  tenantB = randomUUID();

  await adminPrisma.tenant.create({
    data: { id: tenantA, slug: `f13-${RUN}-a`, name: `Instituição A ${RUN}`, status: 'ACTIVE' },
  });
  await adminPrisma.tenant.create({
    data: { id: tenantB, slug: `f13-${RUN}-b`, name: `Instituição B ${RUN}`, status: 'ACTIVE' },
  });
});

afterAll(async () => {
  await adminPrisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await adminPrisma.$disconnect();

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
});

describe('A1 — rate limit no Redis, não na memória do processo', () => {
  it('conta no Redis, nega além do máximo e expira a janela de verdade', async () => {
    const storage = createRedisRateLimitStorage({ prefix: KEY_PREFIX });
    const rule = { window: 1, max: 2 };

    await expect(storage.consume(`${RUN}:ip`, rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    await expect(storage.consume(`${RUN}:ip`, rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });

    const denied = await storage.consume(`${RUN}:ip`, rule);

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);

    // A chave existe no Redis com TTL: é o que prova que o contador é
    // compartilhado entre instâncias, e não um `Map` local.
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    await redis.connect();
    const ttl = await redis.pttl(`${KEY_PREFIX}${RUN}:ip`);
    redis.disconnect();

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1_000);

    // Janela de 1 s: a espera é do teste, não da aplicação.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await expect(storage.consume(`${RUN}:ip`, rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
  });
});

describe('B1 — endpoint de métricas', () => {
  // O registro de métricas é do PROCESSO: sem limpar, o scrape do caso anterior
  // contaminaria a contagem do próximo.
  beforeEach(() => {
    resetMetrics();
  });

  it('exige token quando METRICS_TOKEN está definido', async () => {
    const original = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = 'token-de-teste';

    try {
      const anonymous = await metricsRoute(new Request('http://localhost/api/metrics'));
      expect(anonymous.status).toBe(401);

      const wrong = await metricsRoute(
        new Request('http://localhost/api/metrics', {
          headers: { authorization: 'Bearer outro-token' },
        }),
      );
      expect(wrong.status).toBe(401);

      const authorized = await metricsRoute(
        new Request('http://localhost/api/metrics', {
          headers: { authorization: 'Bearer token-de-teste' },
        }),
      );

      expect(authorized.status).toBe(200);
      expect(authorized.headers.get('content-type')).toContain('text/plain');
    } finally {
      if (original === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = original;
    }
  });

  it('publica uptime, fila de certificados e séries do processo', async () => {
    const original = process.env.METRICS_TOKEN;
    delete process.env.METRICS_TOKEN;

    try {
      const response = await metricsRoute(new Request('http://localhost/api/metrics'));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toMatch(/eventflow_uptime_seconds \d+/);
      // Redis está no ar na suíte de integração: a fila responde e é declarada viva.
      expect(body).toContain('bullmq_queue_up{queue="certificates"} 1');
      expect(body).toMatch(/bullmq_queue_workers\{queue="certificates"\} \d+/);
      expect(body).toContain('metrics_scrapes_total 1');
    } finally {
      if (original !== undefined) process.env.METRICS_TOKEN = original;
    }
  });

  it('em produção SEM token responde 404 (não anuncia que a rota existe)', async () => {
    const originalToken = process.env.METRICS_TOKEN;
    const originalEnv = process.env.NODE_ENV;

    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = 'production';

    try {
      const response = await metricsRoute(new Request('http://localhost/api/metrics'));

      expect(response.status).toBe(404);
    } finally {
      if (originalToken !== undefined) process.env.METRICS_TOKEN = originalToken;
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe('B1 — números da fila usados pelo scrape', () => {
  it('devolve contadores e o número de workers registrados', async () => {
    const stats = await certificateQueueStats();

    expect(stats).not.toBeNull();
    expect(typeof stats!.waiting).toBe('number');
    expect(typeof stats!.failed).toBe('number');
    // `workers` distingue "a fila existe" de "a fila anda" (ver `queue.ts`).
    expect(stats!.workers).toBeGreaterThanOrEqual(0);
  });
});

describe('B3 — audit_logs particionada por mês', () => {
  it('a tabela é particionada e a PK inclui a chave de particionamento', async () => {
    const kind = await adminPrisma.$queryRaw<{ relkind: string }[]>`
      SELECT relkind::text FROM pg_class WHERE oid = to_regclass('public.audit_logs')
    `;

    expect(kind[0]?.relkind).toBe('p');

    const pk = await adminPrisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid = 'public.audit_logs'::regclass AND contype = 'p'
    `;

    expect(pk[0]?.def).toContain('PRIMARY KEY (id, "createdAt")');
  });

  it('toda partição tem RLS habilitada, FORCE e policy própria', async () => {
    const partitions = await adminPrisma.$queryRaw<
      { nome: string; rls: boolean; force: boolean; policies: bigint }[]
    >`
      SELECT c.relname AS nome,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS force,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition
         AND c.relname LIKE 'audit_logs%'
    `;

    expect(partitions.length).toBeGreaterThan(0);

    for (const partition of partitions) {
      expect(partition.rls, `${partition.nome} sem RLS`).toBe(true);
      expect(partition.force, `${partition.nome} sem FORCE`).toBe(true);
      expect(Number(partition.policies), `${partition.nome} sem policy`).toBeGreaterThan(0);
    }
  });

  it('o serviço real de auditoria grava na partição do mês corrente', async () => {
    const id = randomUUID();

    await recordAudit({
      tenantId: tenantA,
      action: 'UPDATE',
      entityType: 'teste_particionamento',
      entityId: id,
      changes: { campo: { from: 'antes', to: 'depois' } },
    });

    // `recordAudit` não devolve o id gerado: buscamos pela fixture do teste.
    const rows = await adminPrisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM audit_logs
       WHERE "tenantId" = ${tenantA}::uuid AND "entityType" = 'teste_particionamento'
    `;

    expect(rows).toHaveLength(1);
    expect(await partitionOf(rows[0]!.id)).toBe(partitionNameFor(new Date()));
  });

  it('data fora de qualquer faixa cai na partição DEFAULT (auditoria nunca falha)', async () => {
    const id = randomUUID();

    await adminPrisma.$executeRaw`
      INSERT INTO audit_logs (id, "tenantId", action, "entityType", changes, "createdAt")
      VALUES (${id}::uuid, ${tenantA}::uuid, 'UPDATE', 'teste_fora_de_faixa', '{}'::jsonb,
              '2020-01-15T12:00:00Z'::timestamptz)
    `;

    expect(await partitionOf(id)).toBe('audit_logs_default');
  });

  it('a RLS continua valendo na tabela particionada', async () => {
    const id = randomUUID();

    await withTenant(tenantA, (tx) =>
      tx.auditLog.create({
        data: {
          id,
          tenantId: tenantA,
          action: 'CREATE',
          entityType: 'teste_rls_particionada',
          changes: {},
        },
      }),
    );

    const visibleToA = await withTenant(tenantA, (tx) =>
      tx.auditLog.findMany({ where: { id } }),
    );
    const visibleToB = await withTenant(tenantB, (tx) =>
      tx.auditLog.findMany({ where: { id } }),
    );

    expect(visibleToA).toHaveLength(1);
    expect(visibleToB).toHaveLength(0);

    // Escrever para OUTRO tenant sob o contexto atual é recusado pela policy
    // (`WITH CHECK`), não pela aplicação.
    await expect(
      withTenant(tenantB, (tx) =>
        tx.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId: tenantA,
            action: 'CREATE',
            entityType: 'teste_rls_particionada',
            changes: {},
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('o ORM continua operando a tabela particionada (delete atravessa partições)', async () => {
    const id = randomUUID();

    await adminPrisma.$executeRaw`
      INSERT INTO audit_logs (id, "tenantId", action, "entityType", changes, "createdAt")
      VALUES (${id}::uuid, ${tenantA}::uuid, 'UPDATE', 'teste_delete_multi_particao', '{}'::jsonb,
              now()::timestamptz)
    `;

    const removed = await adminPrisma.auditLog.deleteMany({
      where: { tenantId: tenantA, entityType: 'teste_delete_multi_particao' },
    });

    expect(removed.count).toBe(1);
  });
});

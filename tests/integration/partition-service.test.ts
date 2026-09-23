/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Manutenção das partições da auditoria (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO DEIXOU DE SER SÓ UM SCRIPT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 13 deixou a criação das partições para o **cron do host**. Isso funcionava
 *  enquanto alguém lembrava de configurar a máquina — e o mês virando sem partição é
 *  o tipo de falha que só aparece quando alguém tenta auditar. A FASE 36 trouxe a
 *  rotina para o worker (`audit-partitions`, todo dia às 3h) e manteve a CLI para
 *  quem opera sem worker: as duas chamam o MESMO serviço, e é ele que este arquivo
 *  exercita.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTES TESTES TOCAM O BANCO DE VERDADE, DE PROPÓSITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que está sob suspeita é DDL (`CREATE TABLE ... PARTITION OF`), concessão de
 *  permissão para a role de runtime e resgate de linhas da partição DEFAULT. Nada
 *  disso é falseável com um dublê: só o PostgreSQL decide se o comando é válido.
 *
 *  As partições criadas aqui ficam — e devem ficar: elas são justamente o que a
 *  rotina de produção teria criado. Os testes são idempotentes por natureza, porque
 *  a passada não recria o que já existe.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import {
  DEFAULT_PARTITION_MONTHS_AHEAD,
  ensureAuditPartitions,
  monthStart,
  partitionName,
  readPartitionState,
} from '../../src/lib/platform/partition-service';

/** Um instante fixo e distante, para o teste não depender do mês corrente. */
const REFERENCE = new Date('2027-03-15T12:00:00.000Z');

async function partitionExists(name: string): Promise<boolean> {
  const rows = await adminPrisma.$queryRawUnsafe<{ oid: string | null }[]>(
    `SELECT to_regclass($1)::text AS oid`,
    `public.${name}`,
  );

  return Boolean(rows[0]?.oid);
}

describe('nome e início do mês', () => {
  it('o nome da partição é derivado do mês, em UTC', () => {
    expect(partitionName(new Date('2027-03-15T12:00:00.000Z'))).toBe('audit_logs_2027_03');
    expect(partitionName(new Date('2027-12-31T23:59:00.000Z'))).toBe('audit_logs_2027_12');
  });

  it('o deslocamento de meses atravessa a virada do ano', () => {
    expect(monthStart(new Date('2027-12-10T00:00:00.000Z'), 0).toISOString()).toBe(
      '2027-12-01T00:00:00.000Z',
    );
    expect(monthStart(new Date('2027-12-10T00:00:00.000Z'), 1).toISOString()).toBe(
      '2028-01-01T00:00:00.000Z',
    );
    expect(monthStart(new Date('2027-01-10T00:00:00.000Z'), -1).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });
});

describe('garantia das partições', () => {
  it('cria o mês pedido e os seguintes, e é IDEMPOTENTE', async () => {
    const first = await ensureAuditPartitions({ monthsAhead: 2, now: REFERENCE });

    expect(first.ok, first.ok ? 'ok' : first.message).toBe(true);
    if (!first.ok) return;

    /** Nenhuma das três pode faltar — a garantia é do mês atual e dos dois seguintes. */
    for (const offset of [0, 1, 2]) {
      const name = partitionName(monthStart(REFERENCE, offset));

      expect(await partitionExists(name), `partição ${name} ausente`).toBe(true);
      expect(first.result.partitions.some((partition) => partition.name === name)).toBe(true);
    }

    /** A segunda passada não recria nada — é o que permite rodar todo dia às 3h. */
    const second = await ensureAuditPartitions({ monthsAhead: 2, now: REFERENCE });

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.result.created).toEqual([]);
    expect(second.result.totalRows).toBe(first.result.totalRows);
  });

  it('o teto do serviço é respeitado e o não-pedido NÃO é criado', async () => {
    const far = new Date('2028-07-01T00:00:00.000Z');
    const beyond = partitionName(monthStart(far, 5));

    const result = await ensureAuditPartitions({ monthsAhead: 0, now: far });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.created.length).toBeLessThanOrEqual(1);
    expect(await partitionExists(beyond)).toBe(false);
  });

  it('a partição nova nasce com a RLS ligada e a role de runtime podendo escrever', async () => {
    const name = partitionName(monthStart(REFERENCE, 0));

    const [privileges] = await adminPrisma.$queryRawUnsafe<{ pode: boolean }[]>(
      `SELECT has_table_privilege('eventflow_app', $1, 'INSERT') AS pode`,
      `public.${name}`,
    );

    expect(privileges?.pode).toBe(true);

    /**
     * Uma partição nova nasce "crua": sem RLS e sem policy ela seria uma porta
     * lateral para os dados de auditoria de TODAS as instituições — a tabela-mãe tem
     * a policy, e a partição precisa da dela.
     */
    const [policy] = await adminPrisma.$queryRawUnsafe<
      { rls: boolean; forced: boolean; policies: number }[]
    >(
      `SELECT c.relrowsecurity AS rls,
              c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      name,
    );

    expect(policy?.rls).toBe(true);
    expect(policy?.forced).toBe(true);
    expect(policy?.policies).toBeGreaterThanOrEqual(1);
  });

  it('resgata para a partição nova as linhas que caíram na DEFAULT', async () => {
    /**
     * O cenário real: o mês virou antes de alguém criar a partição, e a auditoria foi
     * gravada na partição DEFAULT (que existe justamente para que gravar auditoria
     * nunca falhe). Quando a partição nasce, essas linhas precisam MIGRAR — senão a
     * consulta do mês seguinte não as encontra.
     */
    const target = new Date('2029-05-10T12:00:00.000Z');
    const name = partitionName(monthStart(target, 0));

    /** Garante que a partição NÃO existe, para o resgate ter o que fazer. */
    await adminPrisma.$executeRawUnsafe(`DROP TABLE IF EXISTS public.${name}`);

    const tenant = await adminPrisma.tenant.create({
      data: {
        slug: `f36-part-${Date.now()}`,
        name: 'Instituição da Partição',
        status: 'ACTIVE',
        plan: 'FREE',
      },
      select: { id: true },
    });

    try {
      /**
       * A linha vai para a DEFAULT porque a partição do mês ainda não existe. A
       * gravação é direta (não pelo `recordAudit`) para o teste controlar o carimbo de
       * data — é o carimbo que decide em qual partição a linha cai.
       */
      await adminPrisma.$executeRawUnsafe(
        `INSERT INTO public.audit_logs_default (id, "tenantId", action, "entityType", changes, "createdAt")
         VALUES (gen_random_uuid(), $1::uuid, 'UPDATE', 'teste_particao', '{}'::jsonb, $2::timestamptz)`,
        tenant.id,
        `${name.slice(-7).replace('_', '-')}-15T12:00:00.000Z`,
      );

      const result = await ensureAuditPartitions({ monthsAhead: 0, now: target });

      expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
      if (!result.ok) return;

      expect(result.result.created).toContain(name);
      expect(result.result.rescued).toBeGreaterThanOrEqual(1);

      /** A linha está na partição do mês dela — e não mais na DEFAULT. */
      const [inPartition] = await adminPrisma.$queryRawUnsafe<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM public.${name} WHERE "tenantId" = $1::uuid`,
        tenant.id,
      );

      expect(inPartition?.total).toBe(1);
    } finally {
      await adminPrisma.tenant.deleteMany({ where: { id: tenant.id } });
      await adminPrisma.$executeRawUnsafe(`DELETE FROM public.${name} WHERE "entityType" = 'teste_particao'`);
    }
  });

  it('o relatório mostra as partições existentes, sem tropeçar nos ÍNDICES particionados', async () => {
    /**
     * Este é o defeito que a CLI pegou na fase: numa tabela particionada os índices
     * também aparecem em `pg_class` com `relispartition = true`, e sem o filtro de
     * `relkind = 'r'` o `pg_total_relation_size` recebe um índice particionado (sem
     * armazenamento) e o PostgreSQL aborta com
     * `cannot open relation "audit_logs_2026_09_pkey"`.
     */
    const state = await readPartitionState();
    const names = state.map((partition) => partition.name);

    expect(names).toContain(partitionName(monthStart(REFERENCE, 0)));
    expect(names.some((name) => name.endsWith('_pkey'))).toBe(false);

    for (const partition of state) {
      expect(partition.rows).toBeGreaterThanOrEqual(0);
      expect(partition.bytes).toBeGreaterThan(0);
    }
  });

  it('o padrão do produto garante o mês atual e os dois seguintes', () => {
    expect(DEFAULT_PARTITION_MONTHS_AHEAD).toBe(2);
  });
});

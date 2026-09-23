/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Manutenção das partições de `audit_logs` (FASE 13 · FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma tabela particionada por faixa só aceita escrita na faixa que existe. As
 *  partições são criadas com meses de antecedência, então alguém precisa criá-las
 *  antes de o mês virar — e esse alguém não pode ser uma pessoa lembrando.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU MÓDULO (FASE 36)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 13 entregou um script `.mjs` para o cron do host. A FASE 36 trouxe a
 *  rotina para dentro do worker — e a tentação era copiar o SQL. Duas cópias da
 *  mesma manutenção divergem na primeira manutenção, e o sintoma seria o pior
 *  possível: uma delas cria a partição sem a policy de RLS, e a auditoria passa a
 *  ser ilegível (ou vazada) só na faixa criada pelo caminho esquecido.
 *
 *  Agora existe UMA implementação, e três caminhos a chamam: o job do worker, o
 *  botão do painel de governança e a CLI (`npm run db:partitions`).
 *
 *  A conexão é a de PLATAFORMA (`adminPrisma`): criar partição é DDL, e a role de
 *  runtime não tem — nem deve ter — esse privilégio (invariante nº 1).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import { errorMessage } from '@/lib/db/prisma-errors';

/** Quantos meses à frente garantir, quando ninguém diz outra coisa. */
export const DEFAULT_PARTITION_MONTHS_AHEAD = 2;

export interface PartitionInfo {
  name: string;
  rows: number;
  bytes: number;
}

export interface PartitionMaintenanceResult {
  monthsAhead: number;
  /** Partições criadas nesta passada (nome), na ordem. */
  created: string[];
  /** Linhas que estavam na DEFAULT e foram movidas para a partição nova. */
  rescued: number;
  /** Estado atual de todas as partições — é o que a tela e a CLI mostram. */
  partitions: PartitionInfo[];
  totalRows: number;
}

export type PartitionMaintenanceOutcome =
  | { ok: true; result: PartitionMaintenanceResult }
  | { ok: false; code: 'NOT_PARTITIONED' | 'INTERNAL'; message: string };

/**
 * `2026-09-01` → `audit_logs_2026_09`.
 *
 * O nome é INTERPOLADO no SQL (nome de tabela não é parametrizável). É seguro
 * porque esta função só produz `audit_logs_<4 dígitos>_<2 dígitos>` a partir de uma
 * `Date` calculada aqui dentro — nada vem do usuário nem do ambiente.
 */
export function partitionName(month: Date): string {
  const [year, monthNumber] = month.toISOString().slice(0, 7).split('-');
  return `audit_logs_${year}_${monthNumber}`;
}

/** Primeiro dia do mês, em UTC, deslocado `offset` meses. */
export function monthStart(now: Date, offset = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function ensureAuditPartitions(
  input: { monthsAhead?: number; now?: Date } = {},
): Promise<PartitionMaintenanceOutcome> {
  const now = input.now ?? new Date();
  const monthsAhead = Math.min(Math.max(input.monthsAhead ?? DEFAULT_PARTITION_MONTHS_AHEAD, 0), 24);

  try {
    const kind = await adminPrisma.$queryRawUnsafe<{ relkind: string }[]>(
      `SELECT relkind::text AS relkind FROM pg_class WHERE oid = to_regclass('public.audit_logs')`,
    );

    if (kind.length === 0) {
      return {
        ok: false,
        code: 'NOT_PARTITIONED',
        message: 'A tabela audit_logs não existe. Rode `npm run db:migrate`.',
      };
    }

    if (kind[0]!.relkind !== 'p') {
      return {
        ok: false,
        code: 'NOT_PARTITIONED',
        message:
          'A tabela audit_logs não está particionada. Aplique a migração 20260917200000_audit_logs_partitioning.',
      };
    }

    const created: string[] = [];
    let rescued = 0;

    for (let offset = 0; offset <= monthsAhead; offset += 1) {
      const start = monthStart(now, offset);
      const end = monthStart(now, offset + 1);
      const name = partitionName(start);

      const exists = await adminPrisma.$queryRawUnsafe<{ oid: string | null }[]>(
        `SELECT to_regclass($1)::text AS oid`,
        `public.${name}`,
      );

      if (exists[0]?.oid) continue;

      /**
       * ── RESGATE DAS LINHAS QUE CAÍRAM NA DEFAULT ─────────────────────────────
       *  A ordem importa: o PostgreSQL recusa criar a partição enquanto a DEFAULT
       *  contiver linhas do intervalo. Guardamos em tabela temporária, apagamos da
       *  DEFAULT, criamos a partição e reinserimos — sem perder auditoria.
       *
       *  O limite da partição vai INTERPOLADO, não parametrizado: o PostgreSQL não
       *  aceita parâmetros em DDL (`bind message supplies 2 parameters, but
       *  prepared statement requires 0`). Os valores vêm de `isoDate()` sobre uma
       *  `Date` calculada aqui, então são sempre `YYYY-MM-DD`.
       */
      const counted = await adminPrisma.$queryRawUnsafe<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM public.audit_logs_default
          WHERE "createdAt" >= $1::timestamptz AND "createdAt" < $2::timestamptz`,
        isoDate(start),
        isoDate(end),
      );

      const from = `'${isoDate(start)}'`;
      const to = `'${isoDate(end)}'`;
      const pending = counted[0]?.total ?? 0;

      await adminPrisma.$transaction(async (tx) => {
        if (pending > 0) {
          await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE audit_partition_rescue ON COMMIT DROP AS
               SELECT * FROM public.audit_logs_default
                WHERE "createdAt" >= $1::timestamptz AND "createdAt" < $2::timestamptz`,
            isoDate(start),
            isoDate(end),
          );

          await tx.$executeRawUnsafe(
            `DELETE FROM public.audit_logs_default
              WHERE "createdAt" >= $1::timestamptz AND "createdAt" < $2::timestamptz`,
            isoDate(start),
            isoDate(end),
          );
        }

        await tx.$executeRawUnsafe(
          `CREATE TABLE public.${name} PARTITION OF public.audit_logs
             FOR VALUES FROM (${from}) TO (${to})`,
        );

        if (pending > 0) {
          await tx.$executeRawUnsafe(
            `INSERT INTO public.audit_logs SELECT * FROM audit_partition_rescue`,
          );
        }

        /**
         * Privilégios e RLS para a role de runtime: as partições nascem DEPOIS dos
         * `ALTER DEFAULT PRIVILEGES`, e uma partição sem policy é uma faixa de
         * auditoria invisível para a aplicação (fail-closed) — o defeito só
         * apareceria ao consultar o mês novo.
         */
        await tx.$executeRawUnsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${name} TO eventflow_app`,
        );
        await tx.$executeRawUnsafe(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY`);
        await tx.$executeRawUnsafe(`ALTER TABLE public.${name} FORCE ROW LEVEL SECURITY`);
        await tx.$executeRawUnsafe(
          `DROP POLICY IF EXISTS tenant_isolation ON public.${name}`,
        );
        await tx.$executeRawUnsafe(
          `CREATE POLICY tenant_isolation ON public.${name}
             FOR ALL TO eventflow_app
             USING ("tenantId" = app_current_tenant_id())
             WITH CHECK ("tenantId" = app_current_tenant_id())`,
        );
      });

      created.push(name);
      rescued += pending;
    }

    const partitions = await readPartitionState();

    return {
      ok: true,
      result: {
        monthsAhead,
        created,
        rescued,
        partitions,
        totalRows: partitions.reduce((total, partition) => total + partition.rows, 0),
      },
    };
  } catch (error) {
    console.error(`[partitions] falha na manutenção: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível garantir as partições da auditoria.',
    };
  }
}

/** Estado atual: linhas e tamanho por partição, incluindo a DEFAULT. */
export async function readPartitionState(): Promise<PartitionInfo[]> {
  /**
   * `relkind = 'r'` NÃO é detalhe: numa tabela particionada os ÍNDICES também são
   * particionados, e eles aparecem em `pg_class` com `relispartition = true` e nome
   * `audit_logs_<AAAA_MM>_pkey`. Sem o filtro, `pg_total_relation_size` recebe um
   * índice particionado (que não tem armazenamento próprio) e o PostgreSQL aborta
   * com `cannot open relation "audit_logs_2026_09_pkey"` — a manutenção inteira
   * falhava por causa da CONSULTA DE RELATÓRIO, não da criação.
   */
  const rows = await adminPrisma.$queryRawUnsafe<{ name: string; bytes: bigint }[]>(`
    SELECT c.relname AS name,
           pg_total_relation_size(c.oid) AS bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relispartition
       AND c.relname LIKE 'audit_logs%'
     ORDER BY c.relname
  `);

  const state: PartitionInfo[] = [];

  for (const row of rows) {
    /**
     * A contagem é por PARTIÇÃO, uma consulta por partição — de propósito: um
     * `count(*)` sobre a tabela-mãe somaria tudo e faria cada linha da tela mostrar
     * o total (foi o defeito da primeira versão deste código).
     */
    const counted = await adminPrisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM public.${row.name}`,
    );

    state.push({
      name: row.name,
      rows: counted[0]?.total ?? 0,
      bytes: Number(row.bytes),
    });
  }

  return state;
}

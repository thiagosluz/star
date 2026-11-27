/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Política de Retenção de Partições de `audit_logs` (FASE 130 · B8)
 *
 *  Regras puras (sem Prisma nem Next) para decidir quais partições mensais
 *  `audit_logs_AAAA_MM` podem ser descartadas com segurança:
 *    1. Fail-closed: sem política configurada (`retentionMonths == null`), nada sai;
 *    2. Piso mínimo de guarda (`MIN_AUDIT_RETENTION_MONTHS = 6`) para evitar perda
 *       acidental por configuração equivocada;
 *    3. `audit_logs_default`, o mês atual e meses futuros NUNCA são elegíveis.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const MIN_AUDIT_RETENTION_MONTHS = 6;
export const MAX_AUDIT_RETENTION_MONTHS = 120;

const MONTHLY_PARTITION_RE = /^audit_logs_(\d{4})_(0[1-9]|1[0-2])$/;

export interface PartitionRetentionCandidate {
  readonly name: string;
  readonly rows: number;
  readonly bytes: number;
}

export type PartitionRetentionDecision =
  | {
      readonly ok: true;
      readonly enabled: boolean;
      readonly retentionMonths: number | null;
      readonly cutoffMonth: string | null;
      readonly eligible: readonly PartitionRetentionCandidate[];
      readonly kept: readonly PartitionRetentionCandidate[];
      readonly reclaimableRows: number;
      readonly reclaimableBytes: number;
    }
  | {
      readonly ok: false;
      readonly code: 'RETENTION_TOO_SHORT' | 'RETENTION_INVALID';
      readonly message: string;
    };

export function isMonthlyAuditPartitionName(name: string): boolean {
  return MONTHLY_PARTITION_RE.test(name);
}

export function parseAuditPartitionMonth(name: string): { year: number; month: number } | null {
  const match = MONTHLY_PARTITION_RE.exec(name);
  if (!match) return null;
  return {
    year: Number.parseInt(match[1]!, 10),
    month: Number.parseInt(match[2]!, 10),
  };
}

/**
 * Lê `AUDIT_RETENTION_MONTHS` (ou flag `--months=N`).
 * Ausente / vazio / `"off"` / `"0"` significa "retenção desligada" (`null`),
 * preservando o comportamento conservador de nunca apagar sem decisão explícita.
 */
export function parseRetentionMonthsEnv(raw?: string | null): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'off' || trimmed === 'none' || trimmed === '0') {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function evaluatePartitionRetention(input: {
  partitions: readonly PartitionRetentionCandidate[];
  retentionMonths: number | null;
  now?: Date;
}): PartitionRetentionDecision {
  if (input.retentionMonths === null) {
    return {
      ok: true,
      enabled: false,
      retentionMonths: null,
      cutoffMonth: null,
      eligible: [],
      kept: [...input.partitions],
      reclaimableRows: 0,
      reclaimableBytes: 0,
    };
  }

  if (
    !Number.isInteger(input.retentionMonths) ||
    input.retentionMonths > MAX_AUDIT_RETENTION_MONTHS
  ) {
    return {
      ok: false,
      code: 'RETENTION_INVALID',
      message: `Retenção inválida. Informe um número inteiro entre ${MIN_AUDIT_RETENTION_MONTHS} e ${MAX_AUDIT_RETENTION_MONTHS} meses.`,
    };
  }

  if (input.retentionMonths < MIN_AUDIT_RETENTION_MONTHS) {
    return {
      ok: false,
      code: 'RETENTION_TOO_SHORT',
      message: `A retenção mínima segura da auditoria é de ${MIN_AUDIT_RETENTION_MONTHS} meses.`,
    };
  }

  const now = input.now ?? new Date();
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const cutoffDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - input.retentionMonths, 1),
  );
  const cutoffTime = cutoffDate.getTime();
  const cutoffMonth = cutoffDate.toISOString().slice(0, 7);

  const eligible: PartitionRetentionCandidate[] = [];
  const kept: PartitionRetentionCandidate[] = [];

  for (const partition of input.partitions) {
    const parsed = parseAuditPartitionMonth(partition.name);
    if (!parsed) {
      // `audit_logs_default` ou nome fora do padrão nunca é descartado.
      kept.push(partition);
      continue;
    }

    const partitionStart = Date.UTC(parsed.year, parsed.month - 1, 1);
    if (partitionStart < cutoffTime && partitionStart < currentMonthStart) {
      eligible.push(partition);
    } else {
      kept.push(partition);
    }
  }

  return {
    ok: true,
    enabled: true,
    retentionMonths: input.retentionMonths,
    cutoffMonth,
    eligible,
    kept,
    reclaimableRows: eligible.reduce((acc, p) => acc + p.rows, 0),
    reclaimableBytes: eligible.reduce((acc, p) => acc + p.bytes, 0),
  };
}

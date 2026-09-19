/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LEMBRETE DE PRAZO DE PARECER (D4) — a varredura que ninguém digita
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VARREDURA PERCORRE INSTITUIÇÃO POR INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tentação é uma consulta só, com a conexão administrativa, buscando "todas as
 *  avaliações a vencer". Ela funcionaria — e abriria mão do isolamento no caminho
 *  de um job automático, que é justamente onde ninguém está olhando.
 *
 *  O desenho é outro: a lista de INSTITUIÇÕES é lida pela role de runtime (a policy
 *  de `tenants` permite, porque a resolução de slug precisa dela), e cada
 *  instituição é varrida numa transação COM contexto. Nenhuma linha de dado de
 *  instituição é lida sem contexto de instituição — nem por um job.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UMA VEZ POR DIA, POR ATRIBUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O job roda de 6 em 6 horas (cadência registrada na fila), mas o `dedupeKey`
 *  carrega a DATA: o mesmo parecer gera no máximo um aviso "está vencendo" e um
 *  "venceu" por dia. Reexecutar o job depois de um deploy não enche a caixa de
 *  entrada de ninguém.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { systemClient, withTenant } from '@/lib/db/tenant-client';
import { logger } from '@/lib/observability/logger';
import { incCounter } from '@/lib/observability/metrics';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { queueEmail } from './email-service';
import { tenantUrl } from './links';

/** Status em que o parecer ainda é esperado (declinado/enviado não recebem aviso). */
const OPEN_REVIEW_STATUSES = ['INVITED', 'ACCEPTED', 'IN_PROGRESS'] as const;

/** Teto por instituição, para a varredura não virar uma consulta sem fim. */
const MAX_PER_TENANT = 500;

export function reminderHours(): number {
  const raw = Number(process.env.REVIEW_REMINDER_HOURS ?? 48);
  return Number.isFinite(raw) && raw > 0 ? raw : 48;
}

export interface ReminderScanOutput {
  tenants: number;
  assignments: number;
  dueSoon: number;
  overdue: number;
  assigned: number;
  deduplicated: number;
  skipped: number;
}

/** Data (UTC) que entra na chave de idempotência: uma mensagem por dia. */
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Varre prazos e avisa. Devolve os números do que aconteceu — o teste de integração
 * usa o retorno; o job só registra no log.
 */
export async function runReviewDeadlineScan(
  input: { now?: Date; hours?: number } = {},
): Promise<ReminderScanOutput> {
  const now = input.now ?? new Date();
  const hours = input.hours ?? reminderHours();
  const horizon = new Date(now.getTime() + hours * 3_600_000);
  const today = dayKey(now);

  const output: ReminderScanOutput = {
    tenants: 0,
    assignments: 0,
    dueSoon: 0,
    overdue: 0,
    assigned: 0,
    deduplicated: 0,
    skipped: 0,
  };

  const tenants = await systemClient().tenant.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });

  output.tenants = tenants.length;

  for (const tenant of tenants) {
    try {
      const rows = await withTenant(tenant.id, (tx) =>
        tx.reviewAssignment.findMany({
          where: {
            status: { in: [...OPEN_REVIEW_STATUSES] },
            dueAt: { not: null, lte: horizon },
          },
          orderBy: { dueAt: 'asc' },
          take: MAX_PER_TENANT,
          select: {
            id: true,
            dueAt: true,
            reviewer: { select: { id: true, name: true, email: true } },
            submission: {
              select: {
                id: true,
                title: true,
                track: { select: { event: { select: { timezone: true } } } },
              },
            },
            tenant: { select: { name: true, slug: true } },
          },
        }),
      );

      output.assignments += rows.length;

      for (const row of rows) {
        if (!row.dueAt || !row.reviewer.email) {
          output.skipped += 1;
          continue;
        }

        const dueAt = row.dueAt;
        const overdue = dueAt.getTime() <= now.getTime();
        const timezone = row.submission.track?.event?.timezone ?? 'America/Sao_Paulo';
        const dueAtLabel = formatZonedDateTime(dueAt, timezone);
        const hoursLeft = Math.max(Math.ceil((dueAt.getTime() - now.getTime()) / 3_600_000), 0);
        const daysLate = Math.max(Math.ceil((now.getTime() - dueAt.getTime()) / 86_400_000), 1);

        const result = await queueEmail(
          overdue
            ? {
                tenantId: tenant.id,
                to: row.reviewer.email,
                toUserId: row.reviewer.id,
                template: 'REVIEW_OVERDUE' as const,
                brandName: row.tenant.name,
                dedupeKey: `review-overdue:${row.id}:${today}`,
                payload: {
                  reviewerName: row.reviewer.name,
                  submissionTitle: row.submission.title,
                  dueAtLabel,
                  daysLate,
                  reviewUrl: tenantUrl(row.tenant.slug, `/revisoes/${row.submission.id}`),
                },
              }
            : {
                tenantId: tenant.id,
                to: row.reviewer.email,
                toUserId: row.reviewer.id,
                template: 'REVIEW_DUE_SOON' as const,
                brandName: row.tenant.name,
                dedupeKey: `review-due:${row.id}:${today}`,
                payload: {
                  reviewerName: row.reviewer.name,
                  submissionTitle: row.submission.title,
                  dueAtLabel,
                  hoursLeft,
                  reviewUrl: tenantUrl(row.tenant.slug, `/revisoes/${row.submission.id}`),
                },
              },
        );

        if (!result.ok) {
          output.skipped += 1;
          continue;
        }

        if (result.duplicate) {
          output.deduplicated += 1;
          continue;
        }

        if (overdue) output.overdue += 1;
        else output.dueSoon += 1;

        output.assigned += 1;
      }
    } catch (error) {
      // Uma instituição com problema não pode interromper a varredura das outras.
      logger.error('falha na varredura de prazos de parecer', {
        tenantId: tenant.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  incCounter('review_deadline_scans_total');

  logger.info('varredura de prazos de parecer concluída', {
    tenants: output.tenants,
    assignments: output.assignments,
    dueSoon: output.dueSoon,
    overdue: output.overdue,
    deduplicated: output.deduplicated,
    skipped: output.skipped,
  });

  return output;
}

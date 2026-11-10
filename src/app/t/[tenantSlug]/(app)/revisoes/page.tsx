import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2, Clock, Download, EyeOff } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { listReviewerTasks } from '@/lib/review/review-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Revisões' };
export const dynamic = 'force-dynamic';

/**
 * Fila de revisões do usuário.
 *
 * IMPORTANTE: a lista de arquivos chega JÁ FILTRADA pelo servidor. Em revisão
 * cega, apenas o PDF cego é enviado ao cliente — a versão identificada nunca sai
 * do servidor. Filtrar na UI seria uma barreira cosmética, contornável por quem
 * inspecionar a resposta.
 */
export default async function ReviewerTasksPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const context = await getRequestContext();
  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(tenantPath(tenantSlug, '/revisoes'))}`,
    );
  }

  if (!context.activeTenant || context.activeTenant.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  const tasks = await listReviewerTasks(
    context.activeTenant.tenantId,
    context.user.id,
  );

  /**
   * Nota: o atraso do prazo (`isOverdue`) vem calculado da camada de serviço.
   *
   * Ler `Date.now()` aqui dentro violaria a idempotência exigida pelo React
   * (regra `react-hooks/purity`). Como o atraso é um dado derivado, ele é
   * resolvido onde os dados são lidos.
   */
  const pending = tasks.filter((task) => !task.hasReview);
  const done = tasks.filter((task) => task.hasReview);
  const overdueCount = pending.filter((task) => task.isOverdue).length;

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Revisões"
        eyebrow={TENANT_NAV_GROUPS.comite}
        description={`Pareceres atribuídos a você em ${context.activeTenant.tenantName}.`}
      />

      {tasks.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Você não tem pareceres atribuídos no momento.
        </p>
      ) : (
        <>
          {/* Resumo de carga do avaliador */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock
                  className={`size-3.5 ${
                    overdueCount > 0
                      ? 'text-destructive'
                      : pending.length > 0
                        ? 'text-warning-strong'
                        : 'text-success-strong'
                  }`}
                  aria-hidden
                />
                Pareceres pendentes
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{pending.length}</span>
                {overdueCount > 0 ? (
                  <span className="rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    {overdueCount} {overdueCount === 1 ? 'prazo vencido' : 'prazos vencidos'}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-success-strong" aria-hidden />
                Pareceres concluídos
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-success-strong">
                {done.length}
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium">
              Pendentes ({pending.length})
            </h2>

            {pending.length === 0 ? (
              <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
                Nenhum parecer pendente no momento.
              </p>
            ) : (
              <ul className="space-y-3" data-testid="pending-reviews">
                {pending.map((task) => (
                  <li key={task.assignmentId} className="ef-task">
                    <TaskCard task={task} tenantSlug={tenantSlug} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {done.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">Concluídos ({done.length})</h2>
              <ul className="space-y-3">
                {done.map((task) => (
                  <li key={task.assignmentId}>
                    <TaskCard task={task} tenantSlug={tenantSlug} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

function TaskCard({
  task,
  tenantSlug,
}: {
  task: Awaited<ReturnType<typeof listReviewerTasks>>[number];
  tenantSlug: string;
}) {
  const overdue = task.isOverdue;

  return (
    <article className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-border px-2 py-0.5 code-data text-muted-foreground">
            {task.protocol}
          </span>

          {task.isBlind ? (
            <span
              className="inline-flex items-center gap-1 rounded border border-warning/40 px-2 py-0.5 text-xs text-warning-strong"
              data-testid="blind-badge"
            >
              <EyeOff className="size-3" aria-hidden />
              Revisão cega
            </span>
          ) : null}

          {task.hasReview ? (
            <span className="inline-flex items-center gap-1 rounded border border-success/40 px-2 py-0.5 text-xs text-success-strong">
              <CheckCircle2 className="size-3" aria-hidden />
              Parecer enviado
            </span>
          ) : null}

          {overdue ? (
            <span className="rounded border border-destructive/40 px-2 py-0.5 text-xs text-destructive">
              Prazo vencido
            </span>
          ) : null}
        </div>

        <h3 className="font-medium text-foreground">{task.title}</h3>

        <p className="line-clamp-2 text-sm text-muted-foreground">{task.abstract}</p>

        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground/80">{task.eventTitle}</span>
          {task.trackName ? ` · Trilha: ${task.trackName}` : ''}
          {task.dueAt
            ? ` · Prazo: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(task.dueAt)}`
            : ''}
        </p>

        {/* Arquivos já filtrados pelo servidor conforme a revisão cega. */}
        <ul className="space-y-1">
          {task.files.map((file) => (
            <li key={file.id} className="flex items-center gap-1.5 text-xs">
              <Download className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{file.fileName}</span>
              <span className="shrink-0 text-muted-foreground">
                · {(file.sizeBytes / 1024).toFixed(0)} KB
              </span>
            </li>
          ))}
          {task.files.length === 0 ? (
            <li className="text-xs text-muted-foreground">
              Nenhum arquivo disponível para consulta.
            </li>
          ) : null}
        </ul>
      </div>

      <div className="flex shrink-0 flex-col gap-2">
        {!task.hasReview ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden />
            aguardando parecer
          </span>
        ) : null}

        <Link
          href={tenantPath(tenantSlug, `/revisoes/${task.submissionId}`)}
          className="rounded-md border border-border px-3 py-1.5 text-center text-xs font-medium transition hover:bg-accent"
        >
          {task.hasReview ? 'Ver parecer' : 'Avaliar'}
        </Link>
      </div>
    </article>
  );
}

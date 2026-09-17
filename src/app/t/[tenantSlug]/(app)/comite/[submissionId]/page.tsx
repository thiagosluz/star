import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Ban, ShieldCheck, Star, UserPlus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { buildAssignmentBoard, getSubmissionReviewPanel } from '@/lib/review/review-service';
import { AFFINITY_BAND_LABELS } from '@/domain/review/affinity';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { assignReviewerAction, recordDecisionAction } from '@/app/actions/review-actions';
import { DecisionForm } from '@/components/review/decision-form';
import { AssignReviewerButton } from '@/components/review/assign-reviewer-button';

export const dynamic = 'force-dynamic';

/**
 * Painel de análise de uma submissão (comitê).
 *
 * Duas seções com propósitos distintos:
 *   1. DISTRIBUIÇÃO — quem pode avaliar, quem está bloqueado e por quê;
 *   2. PARECERES — o que foi dito, como o comitê está dividido e a decisão.
 *
 * Os revisores BLOQUEADOS aparecem com o motivo. Esconder seria pior: o comitê
 * precisa conseguir explicar a um revisor por que não foi designado, e precisa
 * perceber quando o bloqueio foi um falso positivo (ex.: homônimo).
 *
 * Exige `submission:assign-reviewer`: a tela mostra a lista nominal de revisores,
 * o motivo dos bloqueios e o conteúdo dos pareceres — nada disso é público.
 */
export default async function ChairSubmissionPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; submissionId: string }>;
}) {
  const { tenantSlug, submissionId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SUBMISSION_ASSIGN_REVIEWER,
    fallbackPath: '/comite',
  });

  const [boardResult, panelResult] = await Promise.all([
    buildAssignmentBoard(tenantId, submissionId),
    getSubmissionReviewPanel(tenantId, submissionId),
  ]);

  if (!boardResult.ok && boardResult.code === 'NOT_FOUND') notFound();
  if (!panelResult.ok && panelResult.code === 'NOT_FOUND') notFound();

  const board = boardResult.ok ? boardResult.board : null;
  const panel = panelResult.ok ? panelResult.panel : null;

  if (!board || !panel) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="rounded-lg border border-destructive/40 bg-card p-5 text-sm text-destructive">
          {boardResult.ok ? panelResult.ok === false && panelResult.message : boardResult.message}
        </p>
      </main>
    );
  }

  const assignedIds = new Set(board.assigned.map((a) => a.reviewerId));

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <nav>
        <Link
          href={tenantPath(tenantSlug, '/comite')}
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          ← Comitê científico
        </Link>
      </nav>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {board.protocol}
          </span>
          <span
            className={`rounded border px-2 py-0.5 text-xs ${
              panel.quorum.satisfied
                ? 'border-green-500/40 text-green-600'
                : 'border-amber-500/40 text-amber-600'
            }`}
            data-testid="panel-quorum"
          >
            {panel.quorum.message}
          </span>
        </div>

        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          {board.title}
        </h1>
      </header>

      {/* ── Distribuição de revisores ─────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Distribuição de revisores</h2>
          <p className="text-xs text-muted-foreground">
            Conflitos de interesse já foram removidos da lista de elegíveis. A
            atribuição é uma decisão do comitê.
          </p>
        </div>

        {/* Já atribuídos */}
        {board.assigned.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Atribuídos ({board.assigned.length})
            </h3>
            <ul className="space-y-2" data-testid="assigned-reviewers">
              {board.assigned.map((assignment) => (
                <li
                  key={assignment.reviewerId}
                  className="flex items-center justify-between rounded-lg border border-green-500/30 bg-card p-3 text-sm"
                >
                  <span>{assignment.reviewerName}</span>
                  <span className="text-xs text-muted-foreground">{assignment.status}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Elegíveis */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            Elegíveis ({board.eligible.length})
          </h3>

          {board.eligible.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Nenhum revisor elegível. Verifique se há revisores cadastrados com
              afinidade para esta trilha.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="eligible-reviewers">
              {board.eligible.map((reviewer) => (
                <li
                  key={reviewer.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{reviewer.name}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${
                          reviewer.band === 'EXCELLENT'
                            ? 'border-green-500/40 text-green-600'
                            : reviewer.band === 'GOOD'
                              ? 'border-blue-500/40 text-blue-600'
                              : 'border-border text-muted-foreground'
                        }`}
                        data-testid="affinity-band"
                      >
                        <Star className="size-3" aria-hidden />
                        {AFFINITY_BAND_LABELS[reviewer.band]} · {reviewer.score.toFixed(0)}
                      </span>
                      {reviewer.institution ? (
                        <span className="text-xs text-muted-foreground">
                          {reviewer.institution}
                        </span>
                      ) : null}
                      {!reviewer.available ? (
                        <span className="text-xs text-amber-600">indisponível</span>
                      ) : null}
                    </div>

                    {/* Por que este revisor foi sugerido — rastreável. */}
                    {reviewer.notes.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reviewer.notes.join(' ')}
                      </p>
                    ) : null}
                  </div>

                  {assignedIds.has(reviewer.userId) ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      já atribuído
                    </span>
                  ) : (
                    <AssignReviewerButton
                      tenantSlug={tenantSlug}
                      submissionId={submissionId}
                      reviewerId={reviewer.userId}
                      reviewerName={reviewer.name}
                      action={assignReviewerAction}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bloqueados — com motivo */}
        {board.blocked.length > 0 ? (
          <details className="rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Bloqueados por conflito de interesse ({board.blocked.length})
            </summary>
            <ul className="mt-3 space-y-2" data-testid="blocked-reviewers">
              {board.blocked.map((entry) => (
                <li key={entry.userId} className="flex items-start gap-2 text-xs">
                  <Ban className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                  <span>
                    <span className="font-medium">{entry.name}</span>
                    <span className="block text-muted-foreground">{entry.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* ── Pareceres recebidos ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium">
          Pareceres recebidos ({panel.reviews.filter((r) => r.submittedAt).length})
        </h2>

        {panel.reviews.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Nenhum parecer recebido ainda.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="received-reviews">
            {panel.reviews.map((review) => (
              <li key={review.reviewId} className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{review.reviewerName}</span>
                  <span className="flex items-center gap-2 text-xs">
                    {review.recommendation ? (
                      <span className="rounded border border-border px-2 py-0.5 text-muted-foreground">
                        {review.recommendation}
                      </span>
                    ) : null}
                    {review.weightedScore !== null ? (
                      <span className="font-semibold tabular-nums">
                        {review.weightedScore.toFixed(1)}
                      </span>
                    ) : null}
                  </span>
                </div>

                {/* Notas por critério */}
                <dl className="grid gap-1 text-xs sm:grid-cols-2">
                  {panel.rubric.map((criterion) => (
                    <div key={criterion.key} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{criterion.label}</dt>
                      <dd className="tabular-nums">
                        {String(review.scores[criterion.key] ?? '—')} / {criterion.maxScore}
                      </dd>
                    </div>
                  ))}
                </dl>

                {review.feedbackToAuthor ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Comentários ao autor
                    </p>
                    <p className="whitespace-pre-line text-sm">{review.feedbackToAuthor}</p>
                  </div>
                ) : null}

                {review.confidentialComments ? (
                  <div className="space-y-1 rounded border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                      <ShieldCheck className="size-3.5" aria-hidden />
                      Confidencial ao comitê
                    </p>
                    <p className="whitespace-pre-line text-sm text-amber-800">
                      {review.confidentialComments}
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Decisão ───────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <UserPlus className="size-4" aria-hidden />
          Decisão do comitê
        </h2>

        <DecisionForm
          tenantSlug={tenantSlug}
          submissionId={submissionId}
          consensus={panel.consensus}
          quorumSatisfied={panel.quorum.satisfied}
          quorumMessage={panel.quorum.message}
          suggested={panel.suggestedRecommendation}
          action={recordDecisionAction}
        />
      </section>
    </main>
  );
}

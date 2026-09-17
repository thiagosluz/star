import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { Download, EyeOff, ShieldAlert } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { withTenant } from '@/lib/db/tenant-client';
import { getFileDownloadUrl, resolveRubric } from '@/lib/review/submission-service';
import { canAccessSubmissionFile } from '@/domain/review/review-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { submitReviewAction } from '@/app/actions/review-actions';
import { ReviewForm } from '@/components/review/review-form';

export const dynamic = 'force-dynamic';

/**
 * Página de avaliação de uma submissão.
 *
 * ─── A REVISÃO CEGA É APLICADA AQUI ──────────────────────────────────────────
 * Os artefatos são filtrados ANTES de chegar ao componente, usando
 * `canAccessSubmissionFile` do domínio. Em revisão cega, o revisor recebe apenas
 * o PDF cego — a versão identificada e os dados dos autores não são sequer
 * consultados, muito menos enviados ao navegador.
 *
 * O acesso é verificado pela existência da ATRIBUIÇÃO: só quem foi designado
 * revisor consegue abrir a página.
 */
export default async function ReviewSubmissionPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; submissionId: string }>;
}) {
  const { tenantSlug, submissionId } = await params;

  const context = await getRequestContext();
  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(tenantSlug, `/revisoes/${submissionId}`),
      )}`,
    );
  }

  if (!context.activeTenant || context.activeTenant.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  const tenantId = context.activeTenant.tenantId;
  const reviewerId = context.user.id;

  const data = await withTenant(tenantId, async (tx) => {
    const assignment = await tx.reviewAssignment.findFirst({
      where: {
        submissionId,
        reviewerId,
        status: { notIn: ['DECLINED', 'RECUSED'] },
      },
      select: { id: true, isBlind: true, dueAt: true, status: true },
    });

    if (!assignment) return null;

    const submission = await tx.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: {
        id: true,
        protocol: true,
        title: true,
        abstract: true,
        keywords: true,
        language: true,
        trackId: true,
        track: { select: { name: true, requiresBlindReview: true } },
        event: { select: { title: true } },
        // A AUTORIA SÓ É CARREGADA QUANDO A REVISÃO NÃO É CEGA.
        authors: true,
        files: {
          where: { isCurrent: true, deletedAt: null },
          select: {
            id: true,
            kind: true,
            fileName: true,
            sizeBytes: true,
            bucket: true,
            storageKey: true,
          },
        },
      },
    });

    if (!submission) return null;

    const review = await tx.review.findFirst({
      where: { submissionId, reviewerId },
      select: { id: true, submittedAt: true },
    });

    return { assignment, submission, review };
  });

  if (!data) notFound();

  const { assignment, submission, review } = data;

  /**
   * Filtro de artefatos pela regra de revisão cega.
   *
   * `viewerRole: 'REVIEWER'` é o que ativa a restrição. O resultado é aplicado
   * aqui, no servidor — o cliente nunca recebe o que não pode ver.
   */
  const visibleFiles = submission.files.filter((file) =>
    canAccessSubmissionFile({
      kind: file.kind as never,
      viewerRole: 'REVIEWER',
      isBlind: assignment.isBlind,
    }),
  );

  const rubric = await resolveRubric(tenantId, submission.trackId);

  const downloadUrls = new Map<string, string>();
  for (const file of visibleFiles) {
    const result = await getFileDownloadUrl(tenantId, file.id, {
      role: 'REVIEWER',
      isBlind: assignment.isBlind,
    });
    if (result.ok) downloadUrls.set(file.id, result.url);
  }

  return (
    <main className="max-w-4xl space-y-8">
      <nav>
        <Link
          href={tenantPath(tenantSlug, '/revisoes')}
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          ← Minhas revisões
        </Link>
      </nav>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-border px-2 py-0.5 code-data text-muted-foreground">
            {submission.protocol}
          </span>
          {assignment.isBlind ? (
            <span className="inline-flex items-center gap-1 rounded border border-warning/40 px-2 py-0.5 text-xs text-warning-strong">
              <EyeOff className="size-3" aria-hidden />
              Revisão cega
            </span>
          ) : null}
          {review?.submittedAt ? (
            <span className="rounded border border-success/40 px-2 py-0.5 text-xs text-success-strong">
              Parecer enviado
            </span>
          ) : null}
        </div>

        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          {submission.title}
        </h1>

        <p className="text-xs text-muted-foreground">
          {submission.event.title}
          {submission.track?.name ? ` · ${submission.track.name}` : ''}
          {assignment.dueAt
            ? ` · prazo ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(assignment.dueAt)}`
            : ''}
        </p>
      </header>

      {/* ── Aviso de revisão cega ─────────────────────────────────────────── */}
      {assignment.isBlind ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs text-warning-strong">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Esta é uma <strong>revisão cega</strong>. A identificação dos autores não é
            exibida a você e apenas a versão sem identificação está disponível. Avalie o
            conteúdo pelo mérito.
          </span>
        </p>
      ) : null}

      {/* ── Resumo ────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Resumo</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {submission.abstract}
        </p>
        {submission.keywords.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {submission.keywords.map((keyword) => (
              <li
                key={keyword}
                className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {keyword}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ── Artefatos permitidos ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Arquivos disponíveis para avaliação</h2>

        {visibleFiles.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Nenhum arquivo disponível para consulta nesta revisão.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="reviewable-files">
            {visibleFiles.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{file.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {file.kind} · {(Number(file.sizeBytes) / 1024).toFixed(0)} KB
                  </p>
                </div>

                {downloadUrls.has(file.id) ? (
                  <a
                    href={downloadUrls.get(file.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                  >
                    <Download className="size-3.5" aria-hidden />
                    Baixar
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          Os links de download são assinados e expiram em 5 minutos. Nenhum bucket de
          submissão é público.
        </p>
      </section>

      {/* ── Formulário de parecer ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium">Seu parecer</h2>
        <ReviewForm
          tenantSlug={tenantSlug}
          submissionId={submissionId}
          rubric={rubric}
          action={submitReviewAction}
          alreadySubmitted={Boolean(review?.submittedAt)}
        />
      </section>
    </main>
  );
}

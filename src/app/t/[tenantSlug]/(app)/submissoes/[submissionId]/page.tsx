import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { CheckCircle2, Clock, FileText, AlertCircle } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import {
  getSubmission,
  resolveRubric,
} from '@/lib/review/submission-service';
import { isEditableByAuthor, type SubmissionStatus } from '@/domain/review/submission-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { confirmUploadAction, requestUploadAction, submitSubmissionAction } from '@/app/actions/review-actions';
import { SubmissionUploader, type UploadKind } from '@/components/review/submission-uploader';
import { SubmitSubmissionButton } from '@/components/review/submit-submission-button';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Enviada',
  UNDER_REVIEW: 'Em avaliação',
  REVISION_REQUESTED: 'Revisão solicitada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
  WITHDRAWN: 'Retirada',
  CANCELED: 'Cancelada',
};

/**
 * Detalhe da submissão do autor.
 *
 * Os artefatos aparecem com o upload direto ao storage. O autor vê o status de
 * cada um; a validação de prontidão para envio acontece no servidor.
 */
export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; submissionId: string }>;
}) {
  const { tenantSlug, submissionId } = await params;

  const context = await getRequestContext();
  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(tenantSlug, `/submissoes/${submissionId}`),
      )}`,
    );
  }

  if (!context.activeTenant || context.activeTenant.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  const tenantId = context.activeTenant.tenantId;
  const submission = await getSubmission(tenantId, submissionId);

  if (!submission) notFound();

  const rubric = await resolveRubric(tenantId, submission.trackId);
  const editable = isEditableByAuthor(submission.status as SubmissionStatus);

  const currentByKind = new Map(
    submission.files
      .filter((file) => file.isCurrent)
      .map((file) => [file.kind, file]),
  );

  const uploadKinds: UploadKind[] = submission.requiresBlindReview
    ? ['BLIND_PDF', 'IDENTIFIED_PDF']
    : ['IDENTIFIED_PDF'];

  /** Bloqueios que impedem o envio, calculados no servidor. */
  const blockers: string[] = [];
  if (submission.authors.length === 0) blockers.push('Informe ao menos um autor.');
  if (submission.requiresBlindReview && !currentByKind.has('BLIND_PDF')) {
    blockers.push('Anexe a versão cega (sem identificação dos autores).');
  }
  if (!submission.requiresBlindReview && !currentByKind.has('IDENTIFIED_PDF')) {
    blockers.push('Anexe o arquivo do trabalho em PDF.');
  }

  return (
    <main className="max-w-4xl space-y-8">
      <nav>
        <Link
          href={tenantPath(tenantSlug, '/submissoes')}
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          ← Minhas submissões
        </Link>
      </nav>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-border px-2 py-0.5 code-data text-muted-foreground">
            {submission.protocol}
          </span>
          <span
            className="rounded border border-border px-2 py-0.5 text-xs"
            data-testid="submission-status"
          >
            {STATUS_LABEL[submission.status] ?? submission.status}
          </span>
          {submission.requiresBlindReview ? (
            <span className="rounded border border-warning/40 px-2 py-0.5 text-xs text-warning-strong">
              Revisão cega
            </span>
          ) : null}
        </div>

        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          {submission.title}
        </h1>

        <p className="text-xs text-muted-foreground">
          {submission.trackName ?? 'Sem trilha'}
          {submission.submittedAt
            ? ` · enviada em ${new Intl.DateTimeFormat('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
              }).format(submission.submittedAt)}`
            : ' · não enviada'}
        </p>
      </header>

      {/* ── Resultado da avaliação ────────────────────────────────────────── */}
      {submission.finalScore !== null || submission.decisionNotes ? (
        <section className="space-y-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-medium">Resultado da avaliação</h2>
          {submission.finalScore !== null ? (
            <p className="text-sm">
              Nota final:{' '}
              <span className="font-semibold tabular-nums">
                {submission.finalScore.toFixed(1)}
              </span>{' '}
              / 100
            </p>
          ) : null}
          {submission.decisionNotes ? (
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {submission.decisionNotes}
            </p>
          ) : null}
        </section>
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

      {/* ── Artefatos ─────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Arquivos</h2>
          <p className="text-xs text-muted-foreground">
            Enviados direto ao armazenamento; a integridade é conferida por SHA-256.
          </p>
        </div>

        <div className="space-y-2" data-testid="submission-files">
          {uploadKinds.map((kind) => {
            const existing = currentByKind.get(kind);
            return (
              <SubmissionUploader
                key={kind}
                tenantSlug={tenantSlug}
                submissionId={submissionId}
                kind={kind}
                requestUploadAction={requestUploadAction}
                confirmUploadAction={confirmUploadAction}
                existing={
                  existing
                    ? {
                        kind,
                        fileName: existing.fileName,
                        sizeBytes: existing.sizeBytes,
                        checksum: existing.checksum,
                        version: existing.version,
                      }
                    : null
                }
                disabled={!editable}
              />
            );
          })}
        </div>
      </section>

      {/* ── Critérios de avaliação (transparência) ────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Critérios de avaliação da trilha</h2>
        <ul className="space-y-1.5">
          {rubric.map((criterion) => (
            <li key={criterion.key} className="flex items-start gap-2 text-xs">
              <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="font-medium">{criterion.label}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · peso {criterion.weight} · nota até {criterion.maxScore}
                </span>
                {criterion.description ? (
                  <span className="block text-muted-foreground">{criterion.description}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Envio ─────────────────────────────────────────────────────────── */}
      {editable ? (
        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="font-medium">Enviar para avaliação</h2>

          {blockers.length > 0 ? (
            <ul className="space-y-1" data-testid="submit-blockers">
              {blockers.map((blocker) => (
                <li
                  key={blocker}
                  className="flex items-start gap-2 text-sm text-warning-strong"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {blocker}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-success-strong">
              <CheckCircle2 className="size-4" aria-hidden />
              Tudo pronto para o envio.
            </p>
          )}

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            Depois de enviada, alterações no arquivo criam uma nova versão — o parecer
            continua apontando para o que foi avaliado.
          </p>

          <SubmitSubmissionButton
            tenantSlug={tenantSlug}
            submissionId={submissionId}
            disabled={blockers.length > 0}
            action={submitSubmissionAction}
          />
        </section>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4" aria-hidden />
          Submissão enviada. Acompanhe o andamento pela lista de submissões.
        </p>
      )}
    </main>
  );
}

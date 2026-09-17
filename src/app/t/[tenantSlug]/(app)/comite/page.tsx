import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Users } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { listSubmissionsForChair } from '@/lib/review/review-service';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';

export const metadata = { title: 'Comitê científico' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Aguardando atribuição',
  UNDER_REVIEW: 'Em avaliação',
  REVISION_REQUESTED: 'Revisão solicitada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
};

/**
 * Painel do comitê científico.
 *
 * Mostra a fila de submissões com o estado do quórum de pareceres. O objetivo é
 * responder a uma pergunta prática: "o que precisa da minha atenção agora?".
 *
 * Exige `submission:read:any`: ver a fila inteira significa ler títulos e resumos
 * de trabalhos de terceiros, o que não é papel de um participante.
 */
export default async function ChairConsolePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SUBMISSION_READ_ANY,
  });

  const submissions = await listSubmissionsForChair(tenantId);

  const awaitingAssignment = submissions.filter((s) => s.reviewCount === 0);
  const awaitingQuorum = submissions.filter(
    (s) => s.reviewCount > 0 && s.reviewCount < s.requiredReviews,
  );
  const readyToDecide = submissions.filter((s) => s.reviewCount >= s.requiredReviews);

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Comitê científico</h1>
        <p className="text-sm text-muted-foreground">
          Fila de avaliação em {tenantName}.
        </p>
      </header>

      {submissions.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Nenhuma submissão aguardando avaliação.
        </p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3" data-testid="chair-summary">
            <StatCard
              label="Sem revisor atribuído"
              value={awaitingAssignment.length}
              icon={Users}
              tone={awaitingAssignment.length > 0 ? 'warn' : 'ok'}
            />
            <StatCard
              label="Aguardando pareceres"
              value={awaitingQuorum.length}
              icon={Clock}
              tone={awaitingQuorum.length > 0 ? 'warn' : 'ok'}
            />
            <StatCard
              label="Prontas para decisão"
              value={readyToDecide.length}
              icon={CheckCircle2}
              tone={readyToDecide.length > 0 ? 'ok' : 'neutral'}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium">Submissões</h2>

            <ul className="space-y-3" data-testid="chair-submissions">
              {submissions.map((submission) => {
                const quorumReached = submission.reviewCount >= submission.requiredReviews;
                return (
                  <li
                    key={submission.id}
                    className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-border px-2 py-0.5 code-data text-muted-foreground">
                          {submission.protocol}
                        </span>
                        <span
                          className={`rounded border px-2 py-0.5 text-xs ${
                            quorumReached
                              ? 'border-success/40 text-success-strong'
                              : 'border-warning/40 text-warning-strong'
                          }`}
                          data-testid="quorum-status"
                        >
                          {submission.reviewCount}/{submission.requiredReviews} pareceres
                        </span>
                        {!quorumReached && submission.reviewCount === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-0.5 text-xs text-destructive">
                            <AlertTriangle className="size-3" aria-hidden />
                            sem revisor
                          </span>
                        ) : null}
                      </div>

                      <h3 className="font-medium">{submission.title}</h3>

                      <p className="text-xs text-muted-foreground">
                        {STATUS_LABEL[submission.status] ?? submission.status}
                        {submission.trackName ? ` · ${submission.trackName}` : ''}
                        {submission.averageScore !== null
                          ? ` · média ${submission.averageScore.toFixed(1)}`
                          : ''}
                      </p>
                    </div>

                    <Link
                      href={tenantPath(tenantSlug, `/comite/${submission.id}`)}
                      className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                    >
                      Analisar
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: 'ok' | 'warn' | 'neutral';
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-warning-strong'
      : tone === 'ok'
        ? 'text-success-strong'
        : 'text-muted-foreground';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`size-3.5 ${toneClass}`} aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

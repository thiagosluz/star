import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { listMySubmissions } from '@/lib/review/submission-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';

export const metadata = { title: 'Minhas submissões' };
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

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'border-border text-muted-foreground',
  SUBMITTED: 'border-secondary/50 text-secondary-strong',
  UNDER_REVIEW: 'border-warning/40 text-warning-strong',
  REVISION_REQUESTED: 'border-warning/40 text-warning-strong',
  ACCEPTED: 'border-success/40 text-success-strong',
  REJECTED: 'border-destructive/40 text-destructive',
};

/** Lista as submissões do autor na instituição ativa. */
export default async function MySubmissionsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const context = await getRequestContext();
  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(tenantPath(tenantSlug, '/submissoes'))}`,
    );
  }

  if (!context.activeTenant || context.activeTenant.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  const tenantId = context.activeTenant.tenantId;
  const submissions = await listMySubmissions(tenantId, context.user.id);

  /** Eventos que aceitam submissão, para o formulário de criação. */
  const openEvents = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] },
        deletedAt: null,
        // A chamada de trabalhos precisa estar aberta (ou não ter janela).
        OR: [
          { cfpClosesAt: null },
          { cfpClosesAt: { gt: new Date() } },
        ],
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        title: true,
        slug: true,
        cfpClosesAt: true,
        tracks: {
          where: { isActive: true, deletedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, requiresBlindReview: true },
        },
      },
    }),
  );

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Minhas submissões</h1>
          <p className="text-sm text-muted-foreground">
            Trabalhos submetidos em {context.activeTenant.tenantName}.
          </p>
        </div>

        {openEvents.length > 0 ? (
          <Link
            href={tenantPath(tenantSlug, '/submissoes/nova')}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden />
            Nova submissão
          </Link>
        ) : null}
      </header>

      {submissions.length === 0 ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="size-4" aria-hidden />
            Você ainda não submeteu nenhum trabalho.
          </p>
          {openEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Não há chamada de trabalhos aberta no momento.
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-3" data-testid="my-submissions">
          {submissions.map((submission) => (
            <li
              key={submission.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                    {submission.protocol}
                  </span>
                  <span
                    className={`rounded border px-2 py-0.5 text-xs ${
                      STATUS_STYLE[submission.status] ?? 'border-border'
                    }`}
                    data-testid="submission-status"
                  >
                    {STATUS_LABEL[submission.status] ?? submission.status}
                  </span>
                </div>

                <h2 className="font-medium">{submission.title}</h2>

                <p className="text-xs text-muted-foreground">
                  {submission.eventTitle}
                  {submission.trackName ? ` · ${submission.trackName}` : ''}
                </p>
              </div>

              <Link
                href={tenantPath(tenantSlug, `/submissoes/${submission.id}`)}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
              >
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { listMySubmissions } from '@/lib/review/submission-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { deleteDraftSubmissionAction } from '@/app/actions/review-actions';
import { DeleteDraftButton } from '@/components/review/delete-draft-button';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

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
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { tenantSlug } = await params;

  const { pagina } = await searchParams;

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

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  LEITURA EM TRANSAÇÃO ÚNICA COM TENANT (FASE 98 · ADR-412)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A tela do autor consolidou três consultas antes dispersas:
   *    1. `listMySubmissions` (total e fatia com paginação)
   *    2. `openEvents` (eventos sem chamada que aceitam submissão direta por trilha)
   *    3. `openCalls` (chamadas de propostas publicadas e abertas na instituição)
   *
   *  Ao carregar as chamadas abertas de verdade (e não apenas um `take: 1`), a tela
   *  deixa de ser um beco sem link quando há chamada aberta, exibindo links diretos
   *  tanto para autores novatos quanto para quem já tem submissões anteriores.
   */
  const agora = new Date();
  const { page, openEvents, openCalls } = await withTenant(tenantId, async (tx) => {
    const pageData = await listMySubmissions(
      tenantId,
      context.user.id,
      { page: pagina },
      tx,
    );

    const eventsData = await tx.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] },
        deletedAt: null,
        calls: {
          none: {
            isPublished: true,
            deletedAt: null,
            OR: [{ opensAt: null }, { opensAt: { lte: agora } }],
            AND: [{ OR: [{ closesAt: null }, { closesAt: { gt: agora } }] }],
          },
        },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        title: true,
        slug: true,
        tracks: {
          where: { isActive: true, deletedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, requiresBlindReview: true },
        },
      },
    });

    const callsData = await tx.callForProposals.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isPublished: true,
        OR: [{ opensAt: null }, { opensAt: { lte: agora } }],
        AND: [{ OR: [{ closesAt: null }, { closesAt: { gt: agora } }] }],
        event: { status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] }, deletedAt: null },
      },
      orderBy: { closesAt: 'asc' },
      select: {
        id: true,
        title: true,
        slug: true,
        closesAt: true,
        kind: true,
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
          },
        },
      },
    });

    return { page: pageData, openEvents: eventsData, openCalls: callsData };
  });

  const submissions = page.submissions;
  const chamadaAberta = openCalls.length > 0;
  const firstCall = openCalls[0];

  /**
   * O endereço canônico: a PRIMEIRA página não carrega `?pagina=1` — `/submissoes` e
   * `/submissoes?pagina=1` seriam a mesma tela em dois endereços, e o "Anteriores" da
   * página 2 tem de voltar para o endereço limpo.
   */
  const listHref = (target: number) =>
    target <= 1
      ? tenantPath(tenantSlug, '/submissoes')
      : `${tenantPath(tenantSlug, '/submissoes')}?pagina=${target}`;

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Minhas submissões"
        eyebrow={TENANT_NAV_GROUPS.participacao}
        description={`Trabalhos submetidos em ${context.activeTenant.tenantName}.`}
        actions={
          openEvents.length > 0 ? (
            <Link
              href={tenantPath(tenantSlug, '/submissoes/nova')}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden />
              Nova submissão
            </Link>
          ) : openCalls.length === 1 && firstCall ? (
            <Link
              href={tenantPath(
                tenantSlug,
                `/eventos/${firstCall.event.slug}/chamada/${firstCall.slug}`,
              )}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden />
              Enviar proposta
            </Link>
          ) : openCalls.length > 1 ? (
            <a
              href="#chamadas-abertas"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden />
              Ver chamadas abertas ({openCalls.length})
            </a>
          ) : null
        }
      />

      {/* Bloco de chamadas abertas visível quando o autor já possui submissões */}
      {submissions.length > 0 && openCalls.length > 0 ? (
        <section
          id="chamadas-abertas"
          className="space-y-3 rounded-lg border border-border bg-card p-5"
          aria-label="Chamadas abertas para envio"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <span className="size-2 rounded-full bg-success inline-block" aria-hidden />
              Chamadas de trabalhos abertas ({openCalls.length})
            </h2>
            <span className="text-xs text-muted-foreground">
              Envie novas propostas para os eventos ativos
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {openCalls.map((call) => (
              <div
                key={call.id}
                className="flex flex-col justify-between rounded-md border border-border/80 bg-background/60 p-3.5 text-sm"
              >
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {call.event.title}
                  </span>
                  <h3 className="font-medium text-foreground">{call.title}</h3>
                  {call.closesAt ? (
                    <p className="text-xs text-muted-foreground">
                      Prazo até{' '}
                      {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(call.closesAt)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sem prazo de encerramento definido
                    </p>
                  )}
                </div>
                <div className="mt-3 pt-2">
                  <Link
                    href={tenantPath(
                      tenantSlug,
                      `/eventos/${call.event.slug}/chamada/${call.slug}`,
                    )}
                    className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
                  >
                    Enviar proposta →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {submissions.length === 0 ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="size-4" aria-hidden />
            Você ainda não submeteu nenhum trabalho.
          </p>
          {openEvents.length === 0 && openCalls.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="no-open-cfp">
              Não há chamada de trabalhos aberta no momento.
            </p>
          ) : null}

          {openCalls.length > 0 ? (
            <div className="space-y-3 pt-2">
              <p
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                data-testid="no-open-cfp"
              >
                {chamadaAberta
                  ? 'Há chamada de trabalhos aberta — envie a proposta pela página da chamada:'
                  : 'Não há chamada de trabalhos aberta no momento.'}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {openCalls.map((call) => (
                  <div
                    key={call.id}
                    className="flex flex-col justify-between rounded-md border border-border bg-background p-4 text-sm"
                  >
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {call.event.title}
                      </span>
                      <h3 className="font-medium text-foreground">{call.title}</h3>
                      {call.closesAt ? (
                        <p className="text-xs text-muted-foreground">
                          Prazo até{' '}
                          {new Intl.DateTimeFormat('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }).format(call.closesAt)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Sem prazo de encerramento definido
                        </p>
                      )}
                    </div>
                    <div className="mt-3">
                      <Link
                        href={tenantPath(
                          tenantSlug,
                          `/eventos/${call.event.slug}/chamada/${call.slug}`,
                        )}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
                      >
                        Enviar proposta →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
                  <span className="rounded border border-border px-2 py-0.5 code-data text-muted-foreground">
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

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={tenantPath(tenantSlug, `/submissoes/${submission.id}`)}
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                >
                  Abrir
                </Link>

                {/*
                  O rascunho se apaga DAQUI, onde o autor percebe o engano — sem
                  precisar abrir a submissão para depois excluí-la. Só o rascunho
                  (o domínio decide; depois do envio existe registro a preservar).
                */}
                {submission.status === 'DRAFT' ? (
                  <DeleteDraftButton
                    tenantSlug={tenantSlug}
                    submissionId={submission.id}
                    title={submission.title}
                    action={deleteDraftSubmissionAction}
                    testId={`delete-draft-${submission.id}`}
                    label="Excluir"
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {/**
        * ── A PÁGINA VIVE NA URL (FASE 56 · dívida E2) ─────────────────────────────
        *  O endereço é compartilhável, o botão "voltar" do navegador funciona e a lista
        *  não precisa de JavaScript para andar. Com uma página só, a barra não aparece.
        */}
      {page.totalPages > 1 ? (
        <nav
          className="flex items-center justify-between gap-4 border-t border-border pt-6 text-sm"
          aria-label="Paginação das submissões"
          data-testid="submissions-pagination"
        >
          {page.hasPrev ? (
            <Link
              href={listHref(page.page - 1)}
              className="underline underline-offset-4"
              data-testid="submissions-prev"
            >
              ← Anteriores
            </Link>
          ) : (
            <span className="text-muted-foreground" aria-hidden>
              ← Anteriores
            </span>
          )}

          <span className="text-muted-foreground" data-testid="submissions-page-info">
            página {page.page} de {page.totalPages} · {page.total} no total
          </span>

          {page.hasNext ? (
            <Link
              href={listHref(page.page + 1)}
              className="underline underline-offset-4"
              data-testid="submissions-next"
            >
              Próximos →
            </Link>
          ) : (
            <span className="text-muted-foreground" aria-hidden>
              Próximos →
            </span>
          )}
        </nav>
      ) : null}
    </main>
  );
}

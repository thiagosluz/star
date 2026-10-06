import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { listMySubmissions } from '@/lib/review/submission-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { deleteDraftSubmissionAction } from '@/app/actions/review-actions';
import { DeleteDraftButton } from '@/components/review/delete-draft-button';

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
  /** O total e a fatia saem da MESMA transação: a contagem não pode divergir da lista. */
  const page = await listMySubmissions(tenantId, context.user.id, { page: pagina });
  const submissions = page.submissions;

  /**
   * O endereço canônico: a PRIMEIRA página não carrega `?pagina=1` — `/submissoes` e
   * `/submissoes?pagina=1` seriam a mesma tela em dois endereços, e o "Anteriores" da
   * página 2 tem de voltar para o endereço limpo.
   */
  const listHref = (target: number) =>
    target <= 1
      ? tenantPath(tenantSlug, '/submissoes')
      : `${tenantPath(tenantSlug, '/submissoes')}?pagina=${target}`;

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  OS EVENTOS QUE ACEITAM SUBMISSÃO (FASE 68)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O filtro lia `cfpClosesAt` — o prazo da JANELA DO EVENTO, que o formulário deixou
   *  de editar e que ninguém mais escrevia. O resultado era uma porta que nunca
   *  fechava: evento com chamada encerrada continuava oferecendo "Nova submissão".
   *
   *  Agora quem decide é a CHAMADA da FASE 33 (a única fonte da verdade sobre "está
   *  aberta"):
   *
   *    • **Com chamada publicada**: o caminho daqui não serve — a proposta entra pelo
   *      formulário da chamada, e o serviço recusa este atalho com `CFP_CLOSED`. O
   *      evento só aparece enquanto houver chamada ABERTA, aproveitando a mesma régua
   *      (`opensAt`/`closesAt`) que a chamada usa na leitura.
   *    • **Sem chamada publicada**: o caminho antigo sobrevive SEM PRAZO (decisão do
   *      humano), porque é ele que os testes de revisão por pares exercitam — evento
   *      sem chamada continua aceitando submissão por trilha.
   *
   * A janela é a MESMA da chamada, comparada contra UM instante só (`agora`, lido uma
   * vez): `closesAt` nulo é "sem prazo" e vale; `opensAt` nulo já abriu.
   */
  const agora = new Date();
  const openEvents = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] },
        deletedAt: null,
        /**
         * Nenhuma chamada publicada E ABERTA neste instante. As duas condições ficam
         * no MESMO `none`: separá-las em duas cláusulas erraria os dois lados — uma
         * chamada agendada (abre amanhã) esconderia o evento hoje sem oferecer caminho
         * nenhum, e uma encerrada deixaria o atalho antigo em pé.
         */
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
    }),
  );

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  EXISTE CHAMADA ABERTA? (FASE 68)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Quando o caminho por trilha fica fechado, a tela não pode simplesmente sumir com
   *  o botão e dizer "não há chamada de trabalhos aberta": o evento PODE ter uma
   *  chamada no ar, e a proposta entra por ela. Sem esta leitura, o autor lê uma frase
   *  falsa e não recebe caminho nenhum — a tela vira um beco.
   *
   *  `take: 1` porque a pergunta é de existência, e uma ida ao banco basta.
   */
  const chamadaAberta = await withTenant(tenantId, (tx) =>
    tx.callForProposals.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        isPublished: true,
        OR: [{ opensAt: null }, { opensAt: { lte: agora } }],
        AND: [{ OR: [{ closesAt: null }, { closesAt: { gt: agora } }] }],
        event: { status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] }, deletedAt: null },
      },
      select: { id: true },
    }),
  );

  return (
    <main className="max-w-5xl space-y-8">
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
            <p className="text-xs text-muted-foreground" data-testid="no-open-cfp">
              {chamadaAberta
                ? 'Há chamada de trabalhos aberta — envie a proposta pela página da chamada.'
                : 'Não há chamada de trabalhos aberta no momento.'}
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

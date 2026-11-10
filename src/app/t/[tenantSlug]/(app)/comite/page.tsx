import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Filter, Search, Users, X } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { listSubmissionsForChair } from '@/lib/review/review-service';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import type { SubmissionStatus } from '@/domain/review/submission-rules';

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
 * Na FASE 98 (ADR-413), a fila ganhou cockpit com filtros de evento, status/quórum
 * e busca por protocolo/título em transação única, exibindo o evento em cada card.
 *
 * Exige `submission:read:any`: ver a fila inteira significa ler títulos e resumos
 * de trabalhos de terceiros, o que não é papel de um participante.
 */
export default async function ChairConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ evento?: string; status?: string; busca?: string }>;
}) {
  const { tenantSlug } = await params;
  const { evento, status: statusParam, busca } = await searchParams;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SUBMISSION_READ_ANY,
  });

  const statusList =
    statusParam === 'ACCEPTED'
      ? (['ACCEPTED'] as SubmissionStatus[])
      : statusParam === 'REJECTED'
        ? (['REJECTED'] as SubmissionStatus[])
        : statusParam === 'ALL'
          ? (['SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUESTED', 'ACCEPTED', 'REJECTED'] as SubmissionStatus[])
          : undefined;

  const { events, submissions: rawSubmissions } = await withTenant(tenantId, async (tx) => {
    const eventsList = await tx.event.findMany({
      where: { deletedAt: null },
      orderBy: { startsAt: 'desc' },
      select: { id: true, title: true },
    });

    const list = await listSubmissionsForChair(
      tenantId,
      {
        eventId: evento || undefined,
        search: busca || undefined,
        status: statusList,
      },
      tx,
    );

    return { events: eventsList, submissions: list };
  });

  // Métricas calculadas sobre os trabalhos carregados
  const awaitingAssignment = rawSubmissions.filter((s) => s.reviewCount === 0);
  const awaitingQuorum = rawSubmissions.filter(
    (s) => s.reviewCount > 0 && s.reviewCount < s.requiredReviews,
  );
  const readyToDecide = rawSubmissions.filter((s) => s.reviewCount >= s.requiredReviews);

  // Filtragem em memória por quórum se solicitado
  const submissions = rawSubmissions.filter((s) => {
    if (statusParam === 'NO_REVIEWER') return s.reviewCount === 0;
    if (statusParam === 'WAITING_QUORUM') return s.reviewCount > 0 && s.reviewCount < s.requiredReviews;
    if (statusParam === 'READY') return s.reviewCount >= s.requiredReviews;
    return true;
  });

  const hasActiveFilters = Boolean(evento || statusParam || busca);

  const filterHref = (newStatus?: string) => {
    const p = new URLSearchParams();
    if (evento) p.set('evento', evento);
    if (newStatus) p.set('status', newStatus);
    if (busca) p.set('busca', busca);
    const qs = p.toString();
    return `${tenantPath(tenantSlug, '/comite')}${qs ? `?${qs}` : ''}`;
  };

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Comitê científico"
        eyebrow={TENANT_NAV_GROUPS.comite}
        description={`Fila de avaliação e decisões em ${tenantName}.`}
      />

      {/* Cartões de status e métricas */}
      <section className="grid gap-4 sm:grid-cols-3" data-testid="chair-summary">
        <Link
          href={filterHref(statusParam === 'NO_REVIEWER' ? undefined : 'NO_REVIEWER')}
          className="transition hover:opacity-90"
        >
          <StatCard
            label="Sem revisor atribuído"
            value={awaitingAssignment.length}
            icon={Users}
            tone={awaitingAssignment.length > 0 ? 'warn' : 'ok'}
            isActive={statusParam === 'NO_REVIEWER'}
          />
        </Link>
        <Link
          href={filterHref(statusParam === 'WAITING_QUORUM' ? undefined : 'WAITING_QUORUM')}
          className="transition hover:opacity-90"
        >
          <StatCard
            label="Aguardando pareceres"
            value={awaitingQuorum.length}
            icon={Clock}
            tone={awaitingQuorum.length > 0 ? 'warn' : 'ok'}
            isActive={statusParam === 'WAITING_QUORUM'}
          />
        </Link>
        <Link
          href={filterHref(statusParam === 'READY' ? undefined : 'READY')}
          className="transition hover:opacity-90"
        >
          <StatCard
            label="Prontas para decisão"
            value={readyToDecide.length}
            icon={CheckCircle2}
            tone={readyToDecide.length > 0 ? 'ok' : 'neutral'}
            isActive={statusParam === 'READY'}
          />
        </Link>
      </section>

      {/* Barra de Filtros e Busca */}
      <section className="rounded-lg border border-border bg-card p-4">
        <form method="GET" action={tenantPath(tenantSlug, '/comite')} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <label htmlFor="busca" className="sr-only">
                Buscar submissões
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
                <input
                  id="busca"
                  name="busca"
                  defaultValue={busca ?? ''}
                  placeholder="Buscar por título ou protocolo..."
                  className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="evento" className="sr-only">
                Filtrar por evento
              </label>
              <select
                id="evento"
                name="evento"
                defaultValue={evento ?? ''}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Todos os eventos</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="status" className="sr-only">
                Filtrar por situação
              </label>
              <select
                id="status"
                name="status"
                defaultValue={statusParam ?? ''}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Todas em avaliação</option>
                <option value="NO_REVIEWER">Sem revisor</option>
                <option value="WAITING_QUORUM">Aguardando pareceres</option>
                <option value="READY">Prontas para decisão</option>
                <option value="ACCEPTED">Aceitas</option>
                <option value="REJECTED">Rejeitadas</option>
                <option value="ALL">Todas as situações</option>
              </select>
            </div>

            <div className="flex items-center gap-2 sm:col-span-1">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
                title="Aplicar filtros"
              >
                <Filter className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          {hasActiveFilters ? (
            <div className="flex items-center justify-between border-t border-border pt-2.5 text-xs text-muted-foreground">
              <span>Filtros ativos aplicados na fila</span>
              <Link
                href={tenantPath(tenantSlug, '/comite')}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <X className="size-3" aria-hidden />
                Limpar filtros
              </Link>
            </div>
          ) : null}
        </form>
      </section>

      {/* Lista de Submissões */}
      {submissions.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {hasActiveFilters ? (
            <div className="space-y-2">
              <p>Nenhuma submissão encontrada com os filtros selecionados.</p>
              <Link
                href={tenantPath(tenantSlug, '/comite')}
                className="inline-block text-xs font-semibold text-primary underline"
              >
                Limpar filtros da busca
              </Link>
            </div>
          ) : (
            <p>Nenhuma submissão aguardando avaliação no momento.</p>
          )}
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Submissões ({submissions.length})</h2>
          </div>

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

                    <h3 className="font-medium text-foreground">{submission.title}</h3>

                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground/80">{submission.eventTitle}</span>
                      {submission.callTitle ? ` · ${submission.callTitle}` : ''}
                      {submission.trackName ? ` · ${submission.trackName}` : ''}
                      {` · ${STATUS_LABEL[submission.status] ?? submission.status}`}
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
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  isActive,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: 'ok' | 'warn' | 'neutral';
  isActive?: boolean;
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-warning-strong'
      : tone === 'ok'
        ? 'text-success-strong'
        : 'text-muted-foreground';

  return (
    <div
      className={`rounded-lg border bg-card p-4 transition ${
        isActive ? 'border-primary ring-2 ring-primary/20' : 'border-border'
      }`}
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`size-3.5 ${toneClass}`} aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

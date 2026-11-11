import { Suspense } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Users,
} from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { listSubmissionsForChair } from '@/lib/review/review-service';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { EmptyState, PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { ComiteFilterBar } from '@/components/review/comite-filter-bar';
import { SubmissionsListSkeleton } from '@/components/review/submissions-list-skeleton';
import type { SubmissionStatus } from '@/domain/review/submission-rules';

export const metadata = { title: 'Comitê científico' };
export const dynamic = 'force-dynamic';

interface ComitePageProps {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    evento?: string;
    status?: string;
    busca?: string;
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Aguardando atribuição',
  UNDER_REVIEW: 'Em avaliação',
  REVISION_REQUESTED: 'Revisão solicitada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  COCKPIT DO COMITÊ CIENTÍFICO (FASE 98 · ADR-413 / FASE 99 · ADR-417 / FASE 100 · ADR-420)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  STREAMING E SUSPENSE CIRÚRGICO REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Na FASE 100:
 *    • O Server Component da página (`ChairConsolePage`) carrega a lista leve de eventos
 *      e entrega o cabeçalho e a barra de filtros instantaneamente ao navegador;
 *    • A listagem de submissões e o resumo das métricas são executados dentro
 *      de um componente assíncrono isolado (`ComiteResults`), envolvido por
 *      `<Suspense key={filterKey} fallback={<SubmissionsListSkeleton />}>`;
 *    • O streaming do Next.js 16 App Router exibe o esqueleto no milissegundo zero,
 *      eliminando a sensação de travamento na navegação e na troca de filtros.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function ChairConsolePage({ params, searchParams }: ComitePageProps) {
  const { tenantSlug } = await params;
  const { evento, status: statusParam, busca } = await searchParams;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SUBMISSION_READ_ANY,
  });

  const events = await withTenant(tenantId, async (tx: TxClient) => {
    return tx.event.findMany({
      where: { deletedAt: null },
      orderBy: { startsAt: 'desc' },
      select: { id: true, title: true },
    });
  });

  const hasActiveFilters = Boolean(evento || statusParam || busca);
  const filterKey = `${evento ?? ''}-${statusParam ?? ''}-${busca ?? ''}`;

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Comitê científico"
        eyebrow={TENANT_NAV_GROUPS.comite}
        description={`Fila de avaliação e decisões em ${tenantName}.`}
      />

      {/* 
        Barra de Filtros e Busca Reativa (ADR-416 / ADR-422)
        Contrato de query preservado no cockpit: name="busca", name="evento", name="status" e ação de "Limpar filtros".
      */}
      <ComiteFilterBar
        tenantSlug={tenantSlug}
        events={events}
        initialBusca={busca ?? ''}
        initialEvento={evento ?? ''}
        initialStatus={statusParam ?? ''}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Cockpit de Submissões com Suspense Real e Transição Suave sem Flash (ADR-417 / ADR-420 / ADR-428) */}
      <Suspense fallback={<SubmissionsListSkeleton />}>
        <ComiteResults
          key={filterKey}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          evento={evento}
          busca={busca}
          statusParam={statusParam}
        />
      </Suspense>
    </main>
  );
}

async function ComiteResults({
  tenantId,
  tenantSlug,
  evento,
  busca,
  statusParam,
}: {
  tenantId: string;
  tenantSlug: string;
  evento?: string;
  busca?: string;
  statusParam?: string;
}) {
  const statusList =
    statusParam === 'ACCEPTED'
      ? (['ACCEPTED'] as SubmissionStatus[])
      : statusParam === 'REJECTED'
        ? (['REJECTED'] as SubmissionStatus[])
        : statusParam === 'ALL'
          ? (['SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUESTED', 'ACCEPTED', 'REJECTED'] as SubmissionStatus[])
          : undefined;

  const rawSubmissions = await withTenant(tenantId, async (tx: TxClient) => {
    return listSubmissionsForChair(
      tenantId,
      {
        eventId: evento || undefined,
        search: busca || undefined,
        status: statusList,
      },
      tx,
    );
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

  const filterHref = (newStatus?: string) => {
    const p = new URLSearchParams();
    if (evento) p.set('evento', evento);
    if (newStatus) p.set('status', newStatus);
    if (busca) p.set('busca', busca);
    const qs = p.toString();
    return `${tenantPath(tenantSlug, '/comite')}${qs ? `?${qs}` : ''}`;
  };

  const hasActiveFilters = Boolean(evento || statusParam || busca);

  return (
    <div className="space-y-8">
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

      {/* Lista de Submissões */}
      {submissions.length === 0 ? (
        hasActiveFilters ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            <div className="space-y-2">
              <p>Nenhuma submissão encontrada com os filtros selecionados.</p>
              <Link
                href={tenantPath(tenantSlug, '/comite')}
                className="inline-block text-xs font-semibold text-primary underline"
              >
                Limpar filtros da busca
              </Link>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Inbox}
            title="Nenhuma submissão aguardando avaliação"
            description="Quando autores enviarem propostas e artigos científicos para as chamadas da instituição, os trabalhos aparecerão aqui para distribuição de pareceristas e deliberação."
          />
        )
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
    </div>
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

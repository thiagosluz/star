import Link from 'next/link';
import { Award, BookOpen, CalendarClock, ExternalLink, FileText, UserCheck } from 'lucide-react';

import { formatDuration } from '@/domain/events/event-rules';
import {
  buildSpeakerPortalHref,
  type SpeakerPortalKpis,
} from '@/domain/speakers/speaker-portal-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

interface SpeakerPortalKpiCardsProps {
  tenantSlug: string;
  portalHref: string;
  kpis: SpeakerPortalKpis;
}

const KPI_CARD_CLS = 'rounded-xl border border-border bg-card p-4 shadow-sm';
const KPI_HEADER_CLS =
  'flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground';

export function SpeakerPortalKpiCards({
  tenantSlug,
  portalHref,
  kpis,
}: SpeakerPortalKpiCardsProps) {
  const { profileCompleteness, activitiesSummary, materialsSummary, certificatesSummary } = kpis;

  const certLabel =
    certificatesSummary.totalEvents === 0
      ? 'Sem eventos'
      : certificatesSummary.issuedCount > 0
        ? `${certificatesSummary.issuedCount} emitido(s)`
        : certificatesSummary.eligibleToEmitCount > 0
          ? `${certificatesSummary.eligibleToEmitCount} pronto(s)`
          : 'Aguardando';

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="speaker-portal-kpis"
      role="region"
      aria-label="Resumo executivo do palestrante"
    >
      <div className={KPI_CARD_CLS} data-testid="speaker-kpi-profile">
        <div className={KPI_HEADER_CLS}>
          <span>Perfil na vitrine</span>
          <UserCheck className="size-4 text-primary" aria-hidden />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold tracking-tight text-foreground">
            {profileCompleteness.percent}%
          </p>
          <span
            className={
              profileCompleteness.isPublic
                ? 'rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-strong'
                : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
            }
          >
            {profileCompleteness.isPublic ? 'Visível na vitrine' : 'Oculto'}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
          <span>
            {profileCompleteness.filledCount}/{profileCompleteness.totalCount} itens preenchidos
          </span>
          {profileCompleteness.publicProfilePath ? (
            <Link
              href={tenantPath(tenantSlug, profileCompleteness.publicProfilePath)}
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              data-testid="speaker-public-profile-link"
            >
              Ver ficha
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          ) : (
            <Link
              href={buildSpeakerPortalHref(portalHref, { aba: 'perfil' })}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Completar →
            </Link>
          )}
        </div>
      </div>

      <div className={KPI_CARD_CLS} data-testid="speaker-kpi-activities">
        <div className={KPI_HEADER_CLS}>
          <span>Atividades & carga</span>
          <CalendarClock className="size-4 text-primary" aria-hidden />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold tracking-tight text-foreground">
            {activitiesSummary.totalActivities}
          </p>
          <span className="text-xs font-medium text-muted-foreground">
            {formatDuration(activitiesSummary.totalWorkloadMinutes)} totais
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {activitiesSummary.withSyllabusCount} com ementa ·{' '}
          {activitiesSummary.completedActivities} concluída(s)
        </p>
      </div>

      <div className={KPI_CARD_CLS} data-testid="speaker-kpi-materials">
        <div className={KPI_HEADER_CLS}>
          <span>Materiais publicados</span>
          <BookOpen className="size-4 text-primary" aria-hidden />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold tracking-tight text-foreground">
            {materialsSummary.totalMaterials}
          </p>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="size-3" aria-hidden />
            {materialsSummary.filesCount} arquivo(s) · {materialsSummary.linksCount} link(s)
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {materialsSummary.publicCount} público(s) · {materialsSummary.attendeesOnlyCount} inscritos ·{' '}
          {materialsSummary.privateCount} privado(s)
        </p>
      </div>

      <div className={KPI_CARD_CLS} data-testid="speaker-kpi-certificates">
        <div className={KPI_HEADER_CLS}>
          <span>Certificação</span>
          <Award className="size-4 text-primary" aria-hidden />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold tracking-tight text-foreground">{certLabel}</p>
          <Link
            href={buildSpeakerPortalHref(portalHref, { aba: 'certificados' })}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Ver situação →
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {certificatesSummary.totalEvents} evento(s) · Carga apurada:{' '}
          {formatDuration(certificatesSummary.totalCountedMinutes)}
        </p>
      </div>
    </div>
  );
}

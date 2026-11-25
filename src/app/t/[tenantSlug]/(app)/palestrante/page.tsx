import Link from 'next/link';
import { Award, CalendarDays, Clock, Download, ExternalLink, MapPin, Mic, ShieldCheck, UserRound } from 'lucide-react';

import { requirePersonalPage } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { formatDuration, formatEventPeriod } from '@/domain/events/event-rules';
import {
  buildSpeakerPortalHref,
  computeSpeakerPortalKpis,
  resolveSpeakerPortalTab,
  SPEAKER_PORTAL_TAB_LABELS,
  SPEAKER_PORTAL_TABS,
  type SpeakerPortalTab,
} from '@/domain/speakers/speaker-portal-rules';
import { loadSpeakerPortal, hasPendingSpeakerInvite } from '@/lib/speakers/speaker-portal-service';
import {
  claimSpeakerInviteAction,
  confirmSpeakerAvatarUploadAction,
  confirmSpeakerMaterialUploadAction,
  deleteSpeakerMaterialAction,
  requestSpeakerAvatarUploadAction,
  requestSpeakerMaterialUploadAction,
  requestSpeakerCertificateAction,
  saveSpeakerMaterialLinkAction,
  updateMySpeakerProfileAction,
  updateSpeakerMaterialAction,
  updateSpeakerNotesAction,
} from '@/app/actions/speaker-actions';
import {
  ClaimInviteForm,
  SpeakerMaterialRow,
  SpeakerMaterialUploader,
  SpeakerNotesForm,
  SpeakerProfileForm,
} from '@/components/speakers/portal-forms';
import { SpeakerPortalKpiCards } from '@/components/speakers/speaker-portal-kpi-cards';
import { CertificateRequestButton } from '@/components/certificates/request-button';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PORTAL DO PALESTRANTE (FASE 25, itens E19 e E21)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA É, E O QUE ELA NÃO É
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É o lugar onde o palestrante cuida do PRÓPRIO material: perfil público, foto,
 *  ementa e arquivos das atividades que ministra — sem passar pela organização para
 *  cada ajuste de última hora.
 *
 *  NÃO é um painel administrativo: a pessoa não vê as outras atividades do evento,
 *  não vê a lista de inscritos e não edita nada que não seja dela. Tudo o que aparece
 *  aqui foi filtrado por `userId` no serviço, e cada escrita reconfere a posse.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM CHEGA SEM CONVITE VÊ UMA EXPLICAÇÃO, NÃO UM ERRO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A guarda aceita qualquer pessoa com o papel de palestrante — inclusive quem foi
 *  cadastrado sem atividade ainda. Nesse caso a tela diz o que fazer (usar o código do
 *  convite) em vez de mostrar um painel vazio sem explicação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata = { title: 'Portal do palestrante' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  FULL: 'Lotada',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELED: 'Cancelada',
};

export default async function SpeakerPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams?: Promise<{ aba?: string }>;
}) {
  const { tenantSlug } = await params;
  const { aba } = (await searchParams) ?? {};
  const activeTab = resolveSpeakerPortalTab(aba);

  const { tenantId, userId, userEmail } = await requirePersonalPage({
    tenantSlug,
    permission: PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN,
    allowWhen: ({ tenantId: invitedTenantId, userEmail: invitedEmail }) =>
      hasPendingSpeakerInvite({ tenantId: invitedTenantId, userEmail: invitedEmail }),
  });

  const portal = await loadSpeakerPortal({ tenantId, userId, userEmail });
  const portalHref = tenantPath(tenantSlug, '/palestrante');
  const kpis = computeSpeakerPortalKpis({
    profiles: portal.profiles,
    certificates: portal.certificates,
  });

  const showProfile = activeTab === 'visao-geral' || activeTab === 'perfil';
  const showActivities = activeTab === 'visao-geral' || activeTab === 'atividades';
  const showCertificates = activeTab === 'visao-geral' || activeTab === 'certificados';

  const tabCount = (tab: SpeakerPortalTab): number | null => {
    if (tab === 'atividades') return kpis.activitiesSummary.totalActivities;
    if (tab === 'certificados') return portal.certificates.length;
    return null;
  };

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Portal do palestrante"
        eyebrow={TENANT_NAV_GROUPS.participacao}
        icon={<Mic className="size-6 text-primary" aria-hidden />}
        description={
          portal.profiles.length === 0 && portal.pendingInvites.length > 0
            ? 'Você foi convidado a assumir um perfil de palestrante nesta instituição. Aceite o convite abaixo para editar seu perfil público, publicar materiais e emitir seu certificado.'
            : 'Ajuste seu perfil público, publique os materiais das suas atividades e emita seu certificado. O que você salvar aqui aparece na página do evento.'
        }
      />

      {portal.pendingInvites.length > 0 ? (
        <section className="space-y-3" aria-labelledby="convites" data-testid="pending-invite-section">
          <h2 id="convites" className="text-lg font-semibold tracking-tight">
            Convites para você
          </h2>
          <p className="text-sm text-muted-foreground">
            {portal.profiles.length > 0
              ? 'A organização cadastrou seu e-mail em outro perfil de palestrante. Assuma-o para cuidar dele também.'
              : 'A organização cadastrou seu e-mail como palestrante. Confirme abaixo que o perfil é seu — a partir daí você edita bio, foto, redes e materiais, e emite seu certificado.'}
          </p>
          <ClaimInviteForm
            tenantSlug={tenantSlug}
            pendingInvites={portal.pendingInvites.map((invite) => ({
              ...invite,
              inviteExpiresAt: invite.inviteExpiresAt?.toISOString() ?? null,
            }))}
            action={claimSpeakerInviteAction}
          />
        </section>
      ) : null}

      {portal.isEmpty ? (
        <section className="space-y-3" data-testid="speaker-portal-empty">
          <h2 className="text-lg font-semibold tracking-tight">Nenhum perfil vinculado</h2>
          <p className="text-sm text-muted-foreground">
            Sua conta ainda não responde por nenhuma atividade como palestrante. Se a organização
            cadastrou seu e-mail, o convite aparece no topo desta página; se você recebeu um código,
            use o campo dele; e se você ministra uma atividade sem ter recebido convite, fale com a
            equipe do evento.
          </p>
          <Link href={tenantPath(tenantSlug, '/eventos')} className="text-sm underline underline-offset-4">
            Ver os eventos da instituição
          </Link>
        </section>
      ) : null}

      {portal.profiles.length > 0 ? (
        <>
          <SpeakerPortalKpiCards tenantSlug={tenantSlug} portalHref={portalHref} kpis={kpis} />

          <nav
            aria-label="Seções do portal do palestrante"
            className="flex flex-wrap gap-2 border-b border-border pb-3"
            data-testid="speaker-portal-tabs"
          >
            {SPEAKER_PORTAL_TABS.map((tab) => {
              const isCurrent = tab === activeTab;
              const count = tabCount(tab);

              return (
                <Link
                  key={tab}
                  href={buildSpeakerPortalHref(portalHref, { aba: tab })}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                    isCurrent
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-card text-foreground hover:bg-accent'
                  }`}
                  data-testid={`speaker-tab-${tab}`}
                >
                  {SPEAKER_PORTAL_TAB_LABELS[tab]}
                  {count !== null ? ` (${count})` : ''}
                </Link>
              );
            })}
          </nav>
        </>
      ) : null}

      {(showProfile || showActivities)
        ? portal.profiles.map((profile) => {
            const firstEventId = profile.activities[0]?.eventId ?? portal.fallbackEventId;

            return (
              <section
                key={profile.speakerProfileId}
                className="space-y-5"
                aria-labelledby={`perfil-${profile.speakerProfileId}`}
                data-testid={`speaker-profile-${profile.speakerProfileId}`}
              >
                {showProfile ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2
                        id={`perfil-${profile.speakerProfileId}`}
                        className="flex items-center gap-2 text-lg font-semibold tracking-tight"
                      >
                        <UserRound className="size-5" aria-hidden />
                        Meu perfil público
                      </h2>
                      <span
                        className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                        data-testid={`profile-visibility-${profile.speakerProfileId}`}
                        data-confirmed={String(profile.isConfirmed)}
                      >
                        {profile.isPublic ? 'Visível na vitrine' : 'Oculto na vitrine'}
                      </span>
                    </div>

                    <SpeakerProfileForm
                      tenantSlug={tenantSlug}
                      speakerProfileId={profile.speakerProfileId}
                      eventId={firstEventId}
                      initial={{
                        name: profile.name,
                        email: profile.email,
                        institution: profile.institution,
                        company: profile.company,
                        roleTitle: profile.roleTitle,
                        bio: profile.bio,
                        avatarUrl: profile.avatarUrl,
                        avatarSource: profile.avatarSource,
                        socialLinks: profile.socialLinks,
                      }}
                      updateAction={updateMySpeakerProfileAction}
                      requestAvatarAction={requestSpeakerAvatarUploadAction}
                      confirmAvatarAction={confirmSpeakerAvatarUploadAction}
                    />
                  </>
                ) : (
                  <h2 id={`perfil-${profile.speakerProfileId}`} className="sr-only">
                    {profile.name}
                  </h2>
                )}

                {showActivities ? (
                  <section className="space-y-3" aria-labelledby={`atividades-${profile.speakerProfileId}`}>
                    <h3
                      id={`atividades-${profile.speakerProfileId}`}
                      className="text-base font-semibold tracking-tight"
                    >
                      Minhas atividades ({profile.activities.length})
                    </h3>

                    {profile.activities.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Você ainda não está vinculado a nenhuma atividade nesta instituição.
                      </p>
                    ) : null}

                    {profile.activities.map((activity) => {
                      const hasSyllabus = Boolean(activity.syllabus && activity.syllabus.trim().length > 0);
                      const publicActivityHref =
                        activity.eventSlug && activity.activitySlug
                          ? tenantPath(
                              tenantSlug,
                              `/eventos/${activity.eventSlug}/atividades/${activity.activitySlug}`,
                            )
                          : null;

                      return (
                        <article
                          key={activity.linkId}
                          className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
                          data-testid={`portal-activity-${activity.activityId}`}
                        >
                          <header className="space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                                <CalendarDays className="size-3.5" aria-hidden />
                                {activity.eventTitle}
                              </p>
                              {publicActivityHref ? (
                                <Link
                                  href={publicActivityHref}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                                  data-testid={`portal-activity-public-${activity.activityId}`}
                                >
                                  Ver página da atividade
                                  <ExternalLink className="size-3" aria-hidden />
                                </Link>
                              ) : null}
                            </div>

                            <p className="font-medium">{activity.title}</p>

                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span>
                                {activity.roleTitle ?? 'Palestrante'}
                                {activity.isKeynote ? ' · keynote' : ''}
                              </span>
                              <span>· {STATUS_LABEL[activity.status] ?? activity.status}</span>
                              <span>
                                ·{' '}
                                {formatEventPeriod(
                                  { startsAt: activity.startsAt, endsAt: activity.endsAt },
                                  activity.eventTimezone,
                                )}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                · <Clock className="size-3" aria-hidden />
                                {formatDuration(activity.workloadMinutes)}
                              </span>
                              {activity.roomName ? (
                                <span className="inline-flex items-center gap-1">
                                  · <MapPin className="size-3" aria-hidden />
                                  {activity.roomName}
                                </span>
                              ) : null}
                            </p>

                            <div className="flex flex-wrap gap-2 pt-0.5 text-xs">
                              <span
                                className={
                                  hasSyllabus
                                    ? 'rounded-md bg-success-soft px-2 py-0.5 font-medium text-success-strong'
                                    : 'rounded-md bg-surface-low px-2 py-0.5 text-muted-foreground'
                                }
                              >
                                {hasSyllabus ? 'Ementa preenchida' : 'Ementa pendente'}
                              </span>
                              <span className="rounded-md bg-surface-low px-2 py-0.5 text-muted-foreground">
                                {activity.materials.length}{' '}
                                {activity.materials.length === 1
                                  ? 'material publicado'
                                  : 'materiais publicados'}
                              </span>
                            </div>
                          </header>

                          <SpeakerNotesForm
                            tenantSlug={tenantSlug}
                            linkId={activity.linkId}
                            activityId={activity.activityId}
                            activityTitle={activity.title}
                            initial={{
                              syllabus: activity.syllabus,
                              requirements: activity.requirements,
                              bibliography: activity.bibliography,
                            }}
                            action={updateSpeakerNotesAction}
                          />

                          <div className="space-y-3">
                            <h4 className="text-sm font-medium">Materiais de apoio</h4>

                            {activity.materials.length === 0 ? (
                              <p className="text-sm text-muted-foreground" data-testid={`no-materials-${activity.activityId}`}>
                                Nenhum material publicado nesta atividade ainda.
                              </p>
                            ) : (
                              <ul className="space-y-3" data-testid={`portal-materials-${activity.activityId}`}>
                                {activity.materials.map((material) => (
                                  <SpeakerMaterialRow
                                    key={material.id}
                                    tenantSlug={tenantSlug}
                                    material={{
                                      id: material.id,
                                      title: material.title,
                                      kind: material.kind,
                                      visibility: material.visibility,
                                      fileName: material.fileName,
                                      sizeBytes: material.sizeBytes,
                                      isFile: material.isFile,
                                    }}
                                    updateAction={updateSpeakerMaterialAction}
                                    deleteAction={deleteSpeakerMaterialAction}
                                  />
                                ))}
                              </ul>
                            )}

                            <SpeakerMaterialUploader
                              tenantSlug={tenantSlug}
                              eventId={activity.eventId}
                              activityId={activity.activityId}
                              speakerProfileId={profile.speakerProfileId}
                              requestUploadAction={requestSpeakerMaterialUploadAction}
                              confirmUploadAction={confirmSpeakerMaterialUploadAction}
                              saveLinkAction={saveSpeakerMaterialLinkAction}
                            />
                          </div>
                        </article>
                      );
                    })}
                  </section>
                ) : null}
              </section>
            );
          })
        : null}

      {showCertificates && portal.certificates.length > 0 ? (
        <section className="space-y-4" aria-labelledby="certificado">
          <h2 id="certificado" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Award className="size-5" aria-hidden />
            Certificado de palestrante
          </h2>

          <ul className="space-y-3" data-testid="speaker-certificates">
            {portal.certificates.map((status) => (
              <li
                key={status.eventId}
                className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm"
                data-testid={`speaker-certificate-${status.eventId}`}
                data-eligible={String(status.eligible)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium">{status.eventTitle}</p>
                    <p className="text-xs text-muted-foreground" data-testid={`certificate-reason-${status.eventId}`}>
                      {status.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Carga apurada: {formatDuration(status.workloadMinutes)} ·{' '}
                      {status.countedActivities} atividade(s) contabilizada(s)
                      {status.excludedActivities > 0
                        ? ` · ${status.excludedActivities} fora da conta (cancelada ou não concluída)`
                        : ''}
                    </p>
                  </div>
                </div>

                {status.certificate ? (
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span
                      className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      data-testid={`certificate-status-${status.eventId}`}
                    >
                      {status.certificate.status === 'ISSUED' ? 'Emitido' : 'Na fila'}
                    </span>
                    <Link
                      href={tenantPath(tenantSlug, '/certificados')}
                      className="inline-flex items-center gap-1.5 underline underline-offset-4"
                    >
                      <Download className="size-3.5" aria-hidden />
                      Ver e baixar em “Meus certificados”
                    </Link>
                    <span className="flex items-center gap-1.5 code-data text-muted-foreground">
                      <ShieldCheck className="size-3" aria-hidden />
                      {status.certificate.validationCode}
                    </span>
                  </div>
                ) : (
                  <CertificateRequestButton
                    tenantSlug={tenantSlug}
                    eventId={status.eventId}
                    kind="SPEAKER"
                    label="Emitir meu certificado de palestrante"
                    eligible={status.eligible}
                    action={requestSpeakerCertificateAction}
                  />
                )}

                {status.eligible && status.breakdown.length > 0 ? (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Como a carga foi apurada</summary>
                    <ul className="mt-1 list-disc pl-4">
                      {status.breakdown.map((entry) => (
                        <li key={entry.activityId}>
                          {entry.title}:{' '}
                          {entry.counted
                            ? formatDuration(entry.minutes)
                            : `não contabilizada (${entry.reason?.toLowerCase()})`}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : activeTab === 'certificados' && portal.profiles.length > 0 ? (
        <section
          className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-sm"
          aria-labelledby="certificado-vazio"
          data-testid="speaker-certificates-empty"
        >
          <h2 id="certificado-vazio" className="text-base font-semibold text-foreground">
            Certificado de palestrante
          </h2>
          <p className="mt-1">
            Nenhum certificado disponível ainda porque você ainda não está vinculado a atividades concluídas neste evento.
          </p>
        </section>
      ) : null}

      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href={tenantPath(tenantSlug, '/certificados')} className="underline underline-offset-4">
          Meus certificados
        </Link>
        <Link href={tenantPath(tenantSlug, '/eventos')} className="underline underline-offset-4">
          Eventos da instituição
        </Link>
      </nav>
    </main>
  );
}

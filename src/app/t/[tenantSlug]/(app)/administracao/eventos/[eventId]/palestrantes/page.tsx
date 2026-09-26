import Link from 'next/link';
import { CalendarDays, Mic, ShieldCheck, UserCheck, UserX } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listSpeakers, listEventActivitiesForSpeakers } from '@/lib/speakers/speaker-service';
import {
  linkSpeakerAction,
  regenerateSpeakerInviteAction,
  saveSpeakerProfileAction,
  unlinkSpeakerAction,
} from '@/app/actions/speaker-actions';
import {
  confirmAssetUploadAction,
  requestAssetUploadAction,
} from '@/app/actions/landing-actions';
import {
  SpeakerCreateForm,
  SpeakerEditForm,
  SpeakerInviteButton,
  SpeakerLinkForm,
  SpeakerUnlinkButton,
} from '@/components/speakers/admin-speaker-panel';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PALESTRANTES DO EVENTO — tela da organização (FASE 25)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PALESTRANTE É UMA PESSOA DA INSTITUIÇÃO, NÃO UMA LINHA DA ATIVIDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela cadastra a PESSOA uma vez e mostra os vínculos dela com as atividades do
 *  evento. É o que permite que quem fala em três atividades apareça uma vez na
 *  vitrine, edite a própria bio uma vez e receba UM certificado somando as três.
 *
 *  A coluna de convite é a parte operacional: diz se a pessoa já assumiu o perfil
 *  (e pode publicar material sozinha) ou se ainda depende da organização.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata = { title: 'Palestrantes do evento' };
export const dynamic = 'force-dynamic';

export default async function EventSpeakersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPEAKER_MANAGE,
  });

  const [speakers, activities] = await Promise.all([
    listSpeakers({ tenantId, eventId }),
    listEventActivitiesForSpeakers(tenantId, eventId),
  ]);

  const activityOptions = activities.map((activity) => ({ id: activity.id, title: activity.title }));

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Organização</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Mic className="size-6 text-primary" aria-hidden />
          Palestrantes
        </h1>
        <p className="text-sm text-muted-foreground">
          Quem conduz as atividades deste evento. O cadastro aqui alimenta a vitrine pública, a
          ficha de cada atividade e o portal do palestrante.
        </p>
        <Link
          href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
          className="text-sm underline underline-offset-4"
        >
          ← Voltar ao evento
        </Link>
      </header>

      <SpeakerCreateForm
        tenantSlug={tenantSlug}
        eventId={eventId}
        activities={activityOptions}
        action={saveSpeakerProfileAction}
        requestUploadAction={requestAssetUploadAction}
        confirmUploadAction={confirmAssetUploadAction}
      />

      <section className="space-y-4" aria-labelledby="lista-palestrantes">
        <h2 id="lista-palestrantes" className="text-lg font-semibold tracking-tight">
          Cadastrados ({speakers.length})
        </h2>

        {speakers.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="speakers-empty"
          >
            Nenhum palestrante cadastrado neste evento. Cadastre quem já confirmou presença para a
            vitrine pública começar a montar sozinha.
          </p>
        ) : (
          <ul className="space-y-4" data-testid="speaker-list">
            {speakers.map((speaker) => (
              <li
                key={speaker.speakerProfileId}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
                data-testid={`speaker-row-${speaker.speakerProfileId}`}
                data-confirmed={String(speaker.isConfirmed)}
                data-has-account={String(speaker.hasAccount)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {/*
                      A miniatura mostra a foto REAL — e marca quando ela não foi a
                      pessoa que enviou (FASE 46). Sem a etiqueta, o organizador não
                      teria como saber que a organização publicou aquela imagem.
                    */}
                    {speaker.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- host do storage é dinâmico
                      <img
                        src={speaker.avatarUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="size-10 shrink-0 rounded-full object-cover"
                        data-testid={`speaker-row-photo-${speaker.speakerProfileId}`}
                      />
                    ) : null}

                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium" data-testid={`speaker-row-name-${speaker.speakerProfileId}`}>
                        {speaker.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {speaker.roleTitle ?? 'Palestrante'}
                        {speaker.institution ? ` · ${speaker.institution}` : ''}
                        {speaker.email ? ` · ${speaker.email}` : ' · sem e-mail'}
                      </p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {speaker.hasAccount ? (
                          <>
                            <UserCheck className="size-3" aria-hidden />
                            Perfil assumido pelo palestrante
                          </>
                        ) : speaker.hasPendingInvite ? (
                          <>
                            <ShieldCheck className="size-3" aria-hidden />
                            Convite pendente
                            {speaker.inviteExpiresAt
                              ? ` (até ${speaker.inviteExpiresAt.toLocaleDateString('pt-BR')})`
                              : ''}
                          </>
                        ) : (
                          <>
                            <UserX className="size-3" aria-hidden />
                            Sem convite — cadastre um e-mail para gerar
                          </>
                        )}
                        {speaker.materialCount > 0 ? ` · ${speaker.materialCount} material(is)` : ''}
                        {speaker.isPublic ? '' : ' · oculto na vitrine'}
                      </p>

                      {speaker.avatarUrl && speaker.avatarSource === 'ORGANIZATION' ? (
                        <p
                          className="text-xs text-muted-foreground"
                          data-testid={`speaker-row-photo-origin-${speaker.speakerProfileId}`}
                        >
                          Foto publicada pela organização (o palestrante pode trocá-la ou removê-la
                          no portal).
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {!speaker.hasAccount ? (
                    <SpeakerInviteButton
                      tenantSlug={tenantSlug}
                      speakerProfileId={speaker.speakerProfileId}
                      action={regenerateSpeakerInviteAction}
                    />
                  ) : null}
                </div>

                <SpeakerEditForm
                  tenantSlug={tenantSlug}
                  eventId={eventId}
                  speaker={speaker}
                  action={saveSpeakerProfileAction}
                  requestUploadAction={requestAssetUploadAction}
                  confirmUploadAction={confirmAssetUploadAction}
                />

                <div className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <CalendarDays className="size-3.5" aria-hidden />
                    Atividades ({speaker.activities.length})
                  </h3>

                  {speaker.activities.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Ainda não vinculado a nenhuma atividade — sem vínculo ele não aparece na
                      vitrine nem no plano de fundo do certificado.
                    </p>
                  ) : (
                    <ul className="space-y-2" data-testid={`speaker-activities-${speaker.speakerProfileId}`}>
                      {speaker.activities.map((activity) => (
                        <li
                          key={activity.linkId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                          data-testid={`speaker-activity-link-${activity.linkId}`}
                        >
                          <span className="text-sm">
                            {activity.title}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {activity.roleTitle ?? 'Palestrante'}
                              {activity.isKeynote ? ' · keynote' : ''}
                            </span>
                          </span>

                          <SpeakerUnlinkButton
                            tenantSlug={tenantSlug}
                            linkId={activity.linkId}
                            activityTitle={activity.title}
                            action={unlinkSpeakerAction}
                          />
                        </li>
                      ))}
                    </ul>
                  )}

                  <SpeakerLinkForm
                    tenantSlug={tenantSlug}
                    speakerProfileId={speaker.speakerProfileId}
                    activities={activityOptions}
                    action={linkSpeakerAction}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

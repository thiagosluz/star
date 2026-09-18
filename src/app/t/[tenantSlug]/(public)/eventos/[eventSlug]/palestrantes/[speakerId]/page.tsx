import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, Clock, MapPin, Mic } from 'lucide-react';

import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { getPublicSpeaker, getTenantContext } from '@/lib/events/event-repository';
import { activityTypeLabel } from '@/domain/events/activity-rules';
import { formatDuration } from '@/domain/events/event-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { Section, ThemeScope } from '@/components/events/theme-scope';
import { SpeakerAvatar, SpeakerSocialLinks } from '@/components/events/speaker-gallery';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FICHA PÚBLICA DO PALESTRANTE (FASE 25, item E21)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PÁGINA DERIVA DO EVENTO, E NÃO DO PERFIL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `/eventos/<evento>/palestrantes/<id>` é uma rota DENTRO do evento, e a ficha é
 *  lida pelo mesmo `getPublicEvent` que monta a vitrine. A consequência prática é a
 *  que interessa: a ficha de quem só fala em um evento em RASCUNHO não fica no ar, e
 *  a de quem fala em dois eventos tem duas URLs — cada uma no contexto em que faz
 *  sentido ("Keynote da abertura" num, "Instrutor do minicurso" no outro).
 *
 *  A página mostra o que está na agenda pública e mais nada: e-mail e telefone nunca
 *  saem daqui, mesmo que estejam gravados no perfil.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; speakerId: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug, speakerId } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Palestrante não encontrado' };

  const result = await getPublicSpeaker(tenant.tenantId, eventSlug, speakerId);
  if (!result) return { title: 'Palestrante não encontrado' };

  return {
    title: `${result.speaker.name} · ${result.event.title}`,
    description: result.speaker.bio?.slice(0, 200) ?? `Palestrante em ${result.event.title}`,
  };
}

export default async function PublicSpeakerPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; speakerId: string }>;
}) {
  const { tenantSlug, eventSlug, speakerId } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const result = await getPublicSpeaker(tenant.tenantId, eventSlug, speakerId);
  if (!result) notFound();

  const { event, speaker } = result;

  const activities = event.activities.filter((activity) =>
    speaker.activities.some((entry) => entry.activityId === activity.id),
  );

  return (
    <ThemeScope theme={event.theme}>
      <Section>
        <nav className="mb-6">
          <Link
            href={tenantPath(tenantSlug, `/eventos/${eventSlug}`)}
            className="text-xs opacity-60 underline underline-offset-4"
          >
            ← {event.title}
          </Link>
        </nav>

        <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <SpeakerAvatar name={speaker.name} avatarUrl={speaker.avatarUrl} size="lg" />

          <div className="min-w-0 space-y-3">
            <div className="space-y-1">
              <h1
                className="text-balance text-3xl font-semibold tracking-tight"
                data-testid="speaker-name"
              >
                {speaker.name}
              </h1>
              <p className="text-sm opacity-80" data-testid="speaker-role">
                {speaker.isKeynote ? '★ ' : ''}
                {speaker.roleTitle ?? 'Palestrante'}
                {speaker.institution ? ` · ${speaker.institution}` : ''}
                {!speaker.institution && speaker.company ? ` · ${speaker.company}` : ''}
              </p>
            </div>

            <SpeakerSocialLinks links={speaker.socialLinks} />
          </div>
        </header>

        {speaker.bio ? (
          <div
            className="mt-6 max-w-3xl whitespace-pre-line text-pretty leading-relaxed opacity-85"
            data-testid="speaker-full-bio"
          >
            {speaker.bio}
          </div>
        ) : null}

        <section className="mt-10 space-y-4" aria-labelledby="atividades-palestrante">
          <h2 id="atividades-palestrante" className="text-lg font-semibold tracking-tight">
            {activities.length === 1 ? 'Atividade' : 'Atividades'} neste evento
          </h2>

          <ul className="grid gap-4 sm:grid-cols-2" data-testid="speaker-activity-list">
            {activities.map((activity) => {
              const role = speaker.activities.find((entry) => entry.activityId === activity.id)?.roleTitle;

              return (
                <li key={activity.id} className="ef-card space-y-2 p-5">
                  <p className="flex items-center gap-2 text-xs uppercase tracking-wide opacity-60">
                    <Mic className="size-3.5" aria-hidden />
                    {role ?? activityTypeLabel(activity.type)}
                    {role ? ` · ${activityTypeLabel(activity.type)}` : ''}
                  </p>

                  <p className="font-medium">
                    <Link
                      href={tenantPath(
                        tenantSlug,
                        `/eventos/${eventSlug}/atividades/${activity.slug}`,
                      )}
                      className="underline underline-offset-4"
                      data-testid={`speaker-activity-${activity.id}`}
                    >
                      {activity.title}
                    </Link>
                  </p>

                  <dl className="space-y-1 text-xs opacity-75">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                      <dt className="sr-only">Data</dt>
                      <dd>
                        {new Intl.DateTimeFormat('pt-BR', {
                          day: '2-digit',
                          month: 'long',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: event.timezone,
                        }).format(activity.startsAt)}
                      </dd>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="size-3.5 shrink-0" aria-hidden />
                      <dt className="sr-only">Carga horária</dt>
                      <dd>{formatDuration(activity.workloadMinutes)}</dd>
                    </div>

                    {activity.roomName ? (
                      <div className="flex items-center gap-2">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        <dt className="sr-only">Local</dt>
                        <dd>{activity.roomName}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {activity.materials.length > 0 ? (
                    <p className="text-xs opacity-70" data-testid={`speaker-materials-${activity.id}`}>
                      {activity.materials.length} material(is) de apoio disponível(is) na atividade.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <Link
            href={tenantPath(tenantSlug, `/eventos/${eventSlug}`)}
            className="ef-button-outline"
          >
            Ver a programação completa
          </Link>
        </div>
      </Section>
    </ThemeScope>
  );
}

import Link from 'next/link';
import { Camera, ExternalLink, GitBranch, Globe, GraduationCap, IdCard, Video } from 'lucide-react';

import { tenantPath } from '@/domain/tenancy/resolution';
import {
  SOCIAL_NETWORK_LABELS,
  initialsOf,
  type SocialNetwork,
} from '@/domain/speakers/speaker-rules';
import type { PublicSpeakerDetail } from '@/lib/events/event-repository';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  VITRINE DE PALESTRANTES (FASE 25, item E21)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SERVER COMPONENT E SEM CARROSSEL COM JS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A vitrine vive na página pública, que recebe tráfego de campanha e é
 *  `force-dynamic`. HTML pronto do servidor significa que a foto e a bio aparecem
 *  mesmo com JavaScript bloqueado e sem custo de hidratação.
 *
 *  O "carrossel" é uma GRADE que rola no eixo horizontal em telas estreitas
 *  (`overflow-x-auto` + `snap`): é o mesmo comportamento percebido, com CSS, sem
 *  estado de cliente, sem armadilha de acessibilidade por teclado e sem quebrar a
 *  leitura em leitor de tela — que num carrossel com `transform` costuma anunciar
 *  apenas o slide visível.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Ícones das redes.
 *
 * Não são as marcas oficiais: a biblioteca de ícones do projeto não traz logotipos de
 * terceiros (e usá-los exigiria licença). São ícones GENÉRICOS com o rótulo ao lado —
 * o texto é o que identifica a rede, e o ícone só acelera o reconhecimento.
 */
const NETWORK_ICONS: Record<SocialNetwork, React.ReactNode> = {
  linkedin: <IdCard className="size-3.5" aria-hidden />,
  github: <GitBranch className="size-3.5" aria-hidden />,
  lattes: <GraduationCap className="size-3.5" aria-hidden />,
  website: <Globe className="size-3.5" aria-hidden />,
  instagram: <Camera className="size-3.5" aria-hidden />,
  youtube: <Video className="size-3.5" aria-hidden />,
};

const SOCIAL_ORDER: readonly SocialNetwork[] = [
  'lattes',
  'linkedin',
  'github',
  'website',
  'instagram',
  'youtube',
];

/** Links sociais como ícones — usados na ficha e no cartão da vitrine. */
export function SpeakerSocialLinks({ links }: { links: PublicSpeakerDetail['socialLinks'] }) {
  const entries = SOCIAL_ORDER.filter((network) => links[network]);

  if (entries.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-2">
      {entries.map((network) => (
        <li key={network}>
          <a
            href={links[network]}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={SOCIAL_NETWORK_LABELS[network]}
            aria-label={SOCIAL_NETWORK_LABELS[network]}
            data-testid={`speaker-social-${network}`}
            className="ef-badge inline-flex items-center gap-1.5 hover:opacity-80"
          >
            {NETWORK_ICONS[network]}
            <span className="hidden sm:inline">{SOCIAL_NETWORK_LABELS[network]}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Foto redonda com iniciais de reserva (não há upload obrigatório). */
export function SpeakerAvatar({
  name,
  avatarUrl,
  size = 'md',
}: {
  name: string;
  avatarUrl: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dimension = size === 'lg' ? 'size-20' : size === 'sm' ? 'size-10' : 'size-14';

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- host do MinIO é dinâmico (S3_PUBLIC_URL)
      <img
        src={avatarUrl}
        alt={`Foto de ${name}`}
        width={size === 'lg' ? 80 : size === 'sm' ? 40 : 56}
        height={size === 'lg' ? 80 : size === 'sm' ? 40 : 56}
        loading="lazy"
        className={`${dimension} shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`${dimension} flex shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground`}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * Cartão da vitrine.
 *
 * A biografia é truncada com `line-clamp`: a vitrine existe para dar vontade de
 * clicar na ficha, não para ser lida inteira. O texto completo fica na página do
 * palestrante, que é onde o visitante decide se quer assistir à atividade dele.
 */
export function SpeakerCard({
  speaker,
  tenantSlug,
  eventSlug,
}: {
  speaker: PublicSpeakerDetail;
  tenantSlug: string;
  eventSlug: string;
}) {
  return (
    <li
      className="ef-card flex h-full snap-start flex-col gap-3 p-5"
      data-testid={`speaker-card-${speaker.id}`}
    >
      <Link
        href={tenantPath(tenantSlug, `/eventos/${eventSlug}/palestrantes/${speaker.id}`)}
        className="flex items-center gap-3"
      >
        <SpeakerAvatar name={speaker.name} avatarUrl={speaker.avatarUrl} />
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {speaker.isKeynote ? '★ ' : ''}
            {speaker.name}
          </span>
          <span className="block truncate text-xs opacity-70" data-testid={`speaker-role-${speaker.id}`}>
            {speaker.roleTitle ?? 'Palestrante'}
          </span>
          {speaker.institution || speaker.company ? (
            <span className="block truncate text-xs opacity-60">
              {speaker.institution ?? speaker.company}
            </span>
          ) : null}
        </span>
      </Link>

      {speaker.bio ? (
        <p className="line-clamp-3 text-sm leading-relaxed opacity-80" data-testid={`speaker-bio-${speaker.id}`}>
          {speaker.bio}
        </p>
      ) : null}

      {speaker.activities.length > 0 ? (
        <ul className="mt-auto flex flex-wrap gap-1.5" data-testid={`speaker-activities-${speaker.id}`}>
          {speaker.activities.map((activity) => (
            <li key={activity.activityId} className="ef-badge" title={activity.roleTitle ?? undefined}>
              {activity.title}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <SpeakerSocialLinks links={speaker.socialLinks} />
        <Link
          href={tenantPath(tenantSlug, `/eventos/${eventSlug}/palestrantes/${speaker.id}`)}
          className="inline-flex items-center gap-1 text-xs underline underline-offset-4"
        >
          Ver ficha
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
    </li>
  );
}

/** Grade responsiva de palestrantes (chamada pela vitrine e pela ficha do evento). */
export function SpeakerGallery({
  speakers,
  tenantSlug,
  eventSlug,
  emptyLabel,
}: {
  speakers: readonly PublicSpeakerDetail[];
  tenantSlug: string;
  eventSlug: string;
  emptyLabel?: string;
}) {
  if (speakers.length === 0) {
    return emptyLabel ? <p className="text-sm opacity-70">{emptyLabel}</p> : null;
  }

  return (
    <ul
      className="grid snap-x snap-mandatory grid-flow-col auto-cols-[minmax(18rem,1fr)] gap-4 overflow-x-auto pb-2 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 lg:grid-cols-3 sm:overflow-visible"
      data-testid="speaker-gallery"
    >
      {speakers.map((speaker) => (
        <SpeakerCard
          key={speaker.id}
          speaker={speaker}
          tenantSlug={tenantSlug}
          eventSlug={eventSlug}
        />
      ))}
    </ul>
  );
}

/**
 * Instrutores em destaque na FICHA DA ATIVIDADE (FASE 25).
 *
 * Mostra o papel na atividade (não o rótulo padrão do perfil): o mesmo convidado é
 * "Keynote" na abertura e "Mediador" na mesa-redonda, e a ficha precisa dizer o que
 * ele faz ALI.
 */
export function ActivitySpeakerList({
  speakers,
  tenantSlug,
  eventSlug,
}: {
  speakers: readonly {
    id: string;
    name: string;
    roleTitle: string | null;
    avatarUrl: string | null;
    institution: string | null;
    isKeynote: boolean;
  }[];
  tenantSlug: string;
  eventSlug: string;
}) {
  if (speakers.length === 0) return null;

  return (
    <section aria-labelledby="instrutores" className="space-y-3">
      <h2 id="instrutores" className="text-lg font-semibold tracking-tight">
        {speakers.length === 1 ? 'Quem ministra' : 'Quem ministra esta atividade'}
      </h2>

      <ul className="grid gap-3 sm:grid-cols-2" data-testid="activity-speakers">
        {speakers.map((speaker) => (
          <li key={speaker.id} className="ef-card flex items-start gap-3 p-4">
            <SpeakerAvatar name={speaker.name} avatarUrl={speaker.avatarUrl} size="sm" />
            <div className="min-w-0">
              <p className="font-medium">
                <Link
                  href={tenantPath(tenantSlug, `/eventos/${eventSlug}/palestrantes/${speaker.id}`)}
                  className="underline underline-offset-4"
                  data-testid={`activity-speaker-${speaker.id}`}
                >
                  {speaker.name}
                </Link>
              </p>
              <p className="text-xs opacity-70">
                {speaker.isKeynote ? '★ ' : ''}
                {speaker.roleTitle ?? 'Palestrante'}
                {speaker.institution ? ` · ${speaker.institution}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

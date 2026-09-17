import Link from 'next/link';
import {
  CalendarDays,
  Clock,
  MapPin,
  Mic,
  Star,
  Users,
  ExternalLink,
} from 'lucide-react';

import { formatDuration } from '@/domain/events/event-rules';
import {
  BLOCK_LABELS,
  SANDBOXED_BLOCK_TYPES,
  type PageBlockType,
} from '@/domain/events/landing-page';
import type {
  PublicActivitySummary,
  PublicEventDetail,
} from '@/lib/events/event-repository';
import { tenantPath } from '@/domain/tenancy/resolution';
import { Section, SectionHeading } from '@/components/events/theme-scope';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Renderizadores dos blocos da landing page
 *
 *  Cada bloco é um Server Component — o HTML sai pronto do servidor, sem JS de
 *  hidratação para conteúdo estático. Isso importa numa página pública que
 *  recebe tráfego de campanha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEGURANÇA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `content` vem do banco e é escrito pelo organizador. Ele NUNCA é injetado
 *  como HTML: lemos campos específicos e deixamos o React escapar o texto.
 *
 *  O bloco `CUSTOM_HTML` é renderizado como TEXTO PRÉ-FORMATADO, não como HTML.
 *  Renderizar HTML arbitrário do organizador seria XSS armazenado com o nome
 *  dele — um atacante com acesso de organização comprometeria todos os
 *  visitantes da página. Ver `SANDBOXED_BLOCK_TYPES`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Leitura defensiva de um campo de texto do bloco. */
function readString(content: unknown, key: string): string | null {
  if (typeof content !== 'object' || content === null) return null;
  const value = (content as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readArray(content: unknown, key: string): unknown[] {
  if (typeof content !== 'object' || content === null) return [];
  const value = (content as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Blocos individuais
// ───────────────────────────────────────────────────────────────────────────────
function RichTextBlock({ content }: { content: unknown }) {
  const title = readString(content, 'title');
  const body = readString(content, 'body');
  if (!body) return null;

  return (
    <Section>
      <SectionHeading title={title ?? 'Sobre o evento'} />
      {/* `whitespace-pre-line` preserva parágrafos sem interpretar HTML. */}
      <div className="whitespace-pre-line text-pretty leading-relaxed opacity-80">
        {body}
      </div>
    </Section>
  );
}

function ActivitiesBlock({
  activities,
  tenantSlug,
  eventSlug,
}: {
  activities: PublicActivitySummary[];
  tenantSlug: string;
  eventSlug: string;
}) {
  if (activities.length === 0) return null;

  return (
    <Section id="programacao">
      <SectionHeading
        eyebrow="Programação"
        title="Atividades"
        description="Inscreva-se nas atividades de seu interesse. As vagas são limitadas."
      />

      <ul className="space-y-3">
        {activities.map((activity) => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            tenantSlug={tenantSlug}
            eventSlug={eventSlug}
          />
        ))}
      </ul>
    </Section>
  );
}

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  LECTURE: 'Palestra',
  MINI_COURSE: 'Minicurso',
  WORKSHOP: 'Workshop',
  ROUND_TABLE: 'Mesa-redonda',
  HACKATHON: 'Hackathon',
  POSTER_SESSION: 'Sessão de pôsteres',
  ORAL_PRESENTATION: 'Apresentação oral',
  CULTURAL: 'Atividade cultural',
  OTHER: 'Atividade',
};

export function ActivityCard({
  activity,
  tenantSlug,
  eventSlug,
}: {
  activity: PublicActivitySummary;
  tenantSlug: string;
  eventSlug: string;
}) {
  const isFull = activity.remainingSeats === 0;
  const closed =
    activity.status === 'CANCELED' || activity.status === 'COMPLETED';

  return (
    <li className="ef-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ef-badge">{ACTIVITY_TYPE_LABEL[activity.type] ?? 'Atividade'}</span>
            {activity.isFeatured ? (
              <span className="ef-badge gap-1">
                <Star className="size-3" aria-hidden />
                Destaque
              </span>
            ) : null}
            {activity.status === 'CANCELED' ? (
              <span className="ef-badge text-destructive">Cancelada</span>
            ) : isFull && activity.waitlistEnabled ? (
              <span className="ef-badge">Lista de espera</span>
            ) : isFull ? (
              <span className="ef-badge">Lotada</span>
            ) : null}
          </div>

          <h3 className="text-base font-semibold">{activity.title}</h3>

          {activity.description ? (
            <p className="line-clamp-2 text-sm opacity-70">{activity.description}</p>
          ) : null}

          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs opacity-70">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
              <dd>
                {new Intl.DateTimeFormat('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(activity.startsAt)}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden />
              <dd>{formatDuration(activity.workloadMinutes)}</dd>
            </div>
            {activity.roomName ? (
              <div className="flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <dd>{activity.roomName}</dd>
              </div>
            ) : null}
            {activity.speakerNames.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <Mic className="size-3.5 shrink-0" aria-hidden />
                <dd>{activity.speakerNames.join(', ')}</dd>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <Users className="size-3.5 shrink-0" aria-hidden />
              <dd>
                {activity.capacity === null
                  ? 'Vagas ilimitadas'
                  : `${activity.confirmedCount}/${activity.capacity} inscritos`}
              </dd>
            </div>
          </dl>
        </div>

        <div className="shrink-0">
          {closed ? (
            <span className="ef-button-outline pointer-events-none opacity-50">
              Indisponível
            </span>
          ) : (
            <Link
              href={tenantPath(
                tenantSlug,
                `/eventos/${eventSlug}/atividades/${activity.slug}`,
              )}
              className="ef-button"
            >
              {isFull && activity.waitlistEnabled ? 'Entrar na espera' : 'Inscrever-se'}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function SponsorsBlock({
  sponsors,
}: {
  sponsors: PublicEventDetail['sponsors'];
}) {
  if (sponsors.length === 0) return null;

  // Agrupa por cota preservando a ordem de rank vinda do repositório.
  const byTier = new Map<string, PublicEventDetail['sponsors']>();
  for (const sponsor of sponsors) {
    const key = sponsor.tierName ?? 'Patrocinadores';
    const list = byTier.get(key) ?? [];
    list.push(sponsor);
    byTier.set(key, list);
  }

  return (
    <Section id="patrocinadores">
      <SectionHeading eyebrow="Apoio" title="Patrocinadores" />
      <div className="space-y-[calc(1.5rem*var(--ef-spacing-scale,1))]">
        {[...byTier.entries()].map(([tier, list]) => (
          <div key={tier} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider opacity-60">
              {tier}
            </h3>
            <ul className="flex flex-wrap items-center gap-6">
              {list.map((sponsor) => (
                <li key={sponsor.id}>
                  {sponsor.websiteUrl ? (
                    <a
                      href={sponsor.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="flex items-center gap-2 opacity-80 transition hover:opacity-100"
                    >
                      <SponsorLogo sponsor={sponsor} />
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : (
                    <SponsorLogo sponsor={sponsor} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SponsorLogo({ sponsor }: { sponsor: PublicEventDetail['sponsors'][number] }) {
  if (sponsor.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sponsor.logoUrl}
        alt={sponsor.name}
        className="h-10 w-auto max-w-40 object-contain"
      />
    );
  }
  return <span className="text-sm font-medium opacity-80">{sponsor.name}</span>;
}

function FaqBlock({ content }: { content: unknown }) {
  const items = readArray(content, 'items');
  const parsed = items
    .map((item) => ({
      question: readString(item, 'question'),
      answer: readString(item, 'answer'),
    }))
    .filter((item): item is { question: string; answer: string } =>
      Boolean(item.question && item.answer),
    );

  if (parsed.length === 0) return null;

  return (
    <Section id="faq">
      <SectionHeading title="Perguntas frequentes" />
      <dl className="space-y-3">
        {parsed.map((item) => (
          <div key={item.question} className="ef-card p-4">
            <dt className="font-medium">{item.question}</dt>
            <dd className="mt-1 whitespace-pre-line text-sm opacity-70">
              {item.answer}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function GalleryBlock({ content }: { content: unknown }) {
  const images = readArray(content, 'images')
    .map((image) => {
      if (typeof image === 'string') return { url: image, caption: null };
      return {
        url: readString(image, 'url'),
        caption: readString(image, 'caption'),
      };
    })
    .filter((image): image is { url: string; caption: string | null } =>
      Boolean(image.url),
    );

  if (images.length === 0) return null;

  return (
    <Section id="galeria">
      <SectionHeading title="Galeria" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image) => (
          <li key={image.url} className="overflow-hidden" style={{ borderRadius: 'var(--ef-radius)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.caption ?? ''}
              className="h-40 w-full object-cover"
              loading="lazy"
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Bloco de HTML personalizado — renderizado como TEXTO, nunca como HTML.
 *
 * Se o organizador realmente precisar de HTML, o caminho correto é sanitizar no
 * servidor com uma allowlist e renderizar dentro de um iframe com sandbox. Isso
 * não está implementado; até então, exibir como texto é a opção segura e não
 * silenciosa (a página mostra o conteúdo, apenas sem interpretá-lo).
 */
function CustomHtmlBlock({ content }: { content: unknown }) {
  const html = readString(content, 'html');
  if (!html) return null;

  return (
    <Section>
      <SectionHeading
        title={readString(content, 'title') ?? BLOCK_LABELS.CUSTOM_HTML}
      />
      <p className="mb-3 text-xs opacity-60">
        Este bloco é exibido como texto por segurança. HTML não é interpretado.
      </p>
      <pre className="ef-card overflow-x-auto whitespace-pre-wrap p-4 code-data opacity-80">
        {html}
      </pre>
    </Section>
  );
}

/**
 * Contagem regressiva.
 *
 * `now` chega por PROP em vez de chamar `Date.now()` aqui dentro. Motivo: um
 * componente de renderização deve ser PURO — ler o relógio durante o render
 * quebra a regra `react-hooks/purity` e impede a memoização correta do React
 * Compiler. O instante é resolvido UMA vez pela página e desce por prop.
 */
function CountdownBlock({
  content,
  startsAt,
  now,
}: {
  content: unknown;
  startsAt: Date;
  now: number;
}) {
  const label = readString(content, 'label') ?? 'Começa em';
  const diff = startsAt.getTime() - now;

  if (diff <= 0) return null;

  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);

  return (
    <Section>
      <div className="ef-card flex flex-wrap items-center justify-between gap-4 p-6">
        <p className="text-sm font-medium opacity-70">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">
          {days > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'}` : `${hours}h`}
        </p>
      </div>
    </Section>
  );
}

function VenueBlock({ event }: { event: PublicEventDetail }) {
  const location = [event.venueName, event.venueAddress, event.city, event.state]
    .filter(Boolean)
    .join(' · ');

  if (!location && !event.onlineUrl) return null;

  return (
    <Section id="local">
      <SectionHeading eyebrow="Como chegar" title="Local" />
      <div className="ef-card space-y-2 p-5">
        {location ? (
          <p className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
            <span>{location}</span>
          </p>
        ) : null}
        {event.onlineUrl ? (
          <a
            href={event.onlineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm underline underline-offset-4"
          >
            <ExternalLink className="size-4" aria-hidden />
            Acessar transmissão online
          </a>
        ) : null}
      </div>
    </Section>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Dispatcher
// ───────────────────────────────────────────────────────────────────────────────
export interface BlockRendererProps {
  type: PageBlockType;
  content: unknown;
  event: PublicEventDetail;
  tenantSlug: string;
  /**
   * Instante da renderização, resolvido UMA vez pela página. Blocos sensíveis ao
   * tempo (contagem regressiva) recebem daqui para permanecerem puros.
   */
  now: number;
}

/** Traduz um bloco do banco no componente correspondente. */
export function BlockRenderer({
  type,
  content,
  event,
  tenantSlug,
  now,
}: BlockRendererProps) {
  switch (type) {
    case 'RICH_TEXT':
      return <RichTextBlock content={content} />;
    case 'SCHEDULE':
      return (
        <ActivitiesBlock
          activities={event.activities}
          tenantSlug={tenantSlug}
          eventSlug={event.slug}
        />
      );
    case 'SPONSORS':
      return <SponsorsBlock sponsors={event.sponsors} />;
    case 'FAQ':
      return <FaqBlock content={content} />;
    case 'GALLERY':
      return <GalleryBlock content={content} />;
    case 'COUNTDOWN':
      return <CountdownBlock content={content} startsAt={event.startsAt} now={now} />;
    case 'VENUE_MAP':
      return <VenueBlock event={event} />;
    case 'CUSTOM_HTML':
      return <CustomHtmlBlock content={content} />;

    // Tipos que dependem de dados de outras fases (trilhas, palestrantes) ou que
    // já são representados pelo hero. Retornar `null` em vez de quebrar a página
    // permite que um evento antigo continue renderizando após a remoção de um
    // tipo de bloco.
    case 'HERO':
    case 'SPEAKERS':
    case 'TRACKS':
    case 'REGISTRATION_CTA':
    default:
      return null;
  }
}

/** Aviso explícito, usado pelos testes para garantir que HTML não é interpretado. */
export function isSandboxedBlock(type: PageBlockType): boolean {
  return SANDBOXED_BLOCK_TYPES.has(type);
}

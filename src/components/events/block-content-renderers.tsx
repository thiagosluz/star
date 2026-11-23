import { ArrowRight, ExternalLink, MapPin } from 'lucide-react';

import { Section, SectionHeading } from '@/components/events/theme-scope';
import { BLOCK_LABELS } from '@/domain/events/landing-page';
import type { PublicEventDetail } from '@/lib/events/event-repository';

export function readBlockString(content: unknown, key: string): string | null {
  if (typeof content !== 'object' || content === null) return null;
  const value = (content as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readBlockArray(content: unknown, key: string): unknown[] {
  if (typeof content !== 'object' || content === null) return [];
  const value = (content as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

export function RichTextBlock({ content }: { content: unknown }) {
  const title = readBlockString(content, 'title');
  const body = readBlockString(content, 'body');
  if (!body) return null;

  return (
    <Section>
      <SectionHeading title={title ?? 'Sobre o evento'} />
      <div className="whitespace-pre-line text-pretty leading-relaxed opacity-80">{body}</div>
    </Section>
  );
}

export function FaqBlock({ content }: { content: unknown }) {
  const items = readBlockArray(content, 'items');
  const parsed = items
    .map((item) => ({
      question: readBlockString(item, 'question'),
      answer: readBlockString(item, 'answer'),
    }))
    .filter((item): item is { question: string; answer: string } => Boolean(item.question && item.answer));

  if (parsed.length === 0) return null;

  return (
    <Section id="faq">
      <SectionHeading title="Perguntas frequentes" />
      <dl className="space-y-3">
        {parsed.map((item) => (
          <div key={item.question} className="ef-card p-4">
            <dt className="font-medium">{item.question}</dt>
            <dd className="mt-1 whitespace-pre-line text-sm opacity-70">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function GalleryBlock({ content }: { content: unknown }) {
  const images = readBlockArray(content, 'images')
    .map((image) => {
      if (typeof image === 'string') return { url: image, caption: null };
      return {
        url: readBlockString(image, 'url'),
        caption: readBlockString(image, 'caption'),
      };
    })
    .filter((image): image is { url: string; caption: string | null } => Boolean(image.url));

  if (images.length === 0) return null;

  return (
    <Section id="galeria">
      <SectionHeading title="Galeria" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image) => (
          <li key={image.url} className="overflow-hidden" style={{ borderRadius: 'var(--ef-radius)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.caption ?? ''} className="h-40 w-full object-cover" loading="lazy" />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** HTML personalizado renderizado como texto literal para impedir XSS armazenado. */
export function CustomHtmlBlock({ content }: { content: unknown }) {
  const html = readBlockString(content, 'html');
  if (!html) return null;

  return (
    <Section>
      <SectionHeading title={readBlockString(content, 'title') ?? BLOCK_LABELS.CUSTOM_HTML} />
      <p className="ef-muted mb-3 text-xs">
        Este bloco é exibido como texto por segurança. HTML não é interpretado.
      </p>
      <pre className="ef-card overflow-x-auto whitespace-pre-wrap p-4 code-data opacity-80">{html}</pre>
    </Section>
  );
}

export function CountdownBlock({
  content,
  startsAt,
  now,
}: {
  content: unknown;
  startsAt: Date;
  now: number;
}) {
  const label = readBlockString(content, 'label') ?? 'Começa em';
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

export function VenueBlock({ event }: { event: PublicEventDetail }) {
  const location = [event.venueName, event.venueAddress, event.city, event.state].filter(Boolean).join(' · ');

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
            data-testid="evento-sala-online"
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

export function RegistrationCtaBlock({
  content,
  hasActivities,
}: {
  content: unknown;
  hasActivities: boolean;
}) {
  const title = readBlockString(content, 'title') ?? 'Garanta sua vaga';
  const description = readBlockString(content, 'description');
  const ctaLabel = readBlockString(content, 'ctaLabel') ?? 'Ver programação e inscrever-se';

  return (
    <Section id="inscricao">
      <div className="ef-card flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-sm opacity-80">{description}</p>
          ) : (
            <p className="text-sm opacity-80">As vagas são por atividade e podem esgotar.</p>
          )}
        </div>
        {hasActivities ? (
          <a href="#programacao" className="ef-button shrink-0">
            {ctaLabel}
            <ArrowRight className="size-4" aria-hidden />
          </a>
        ) : null}
      </div>
    </Section>
  );
}

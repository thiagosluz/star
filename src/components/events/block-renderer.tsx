import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  MapPin,
  Mic,
  Star,
  Users,
  ExternalLink,
} from 'lucide-react';

import { formatDuration } from '@/domain/events/event-rules';
import { activityTypeLabel } from '@/domain/events/activity-rules';
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
import { CALL_STATE_LABELS } from '@/domain/proposals/call-rules';
import type { CallView } from '@/lib/proposals/call-service';
import { Section, SectionHeading } from '@/components/events/theme-scope';
import { SpeakerGallery } from '@/components/events/speaker-gallery';

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
            <span className="ef-badge">{activityTypeLabel(activity.type)}</span>
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
  content,
}: {
  sponsors: PublicEventDetail['sponsors'];
  content: unknown;
}) {
  /**
   * Filtro por cota, opcional (FASE 17).
   *
   * Sem filtro, o bloco mostra TODOS os patrocinadores do evento. Com
   * `content.tierId`, mostra só aquela cota — é o que permite uma página com uma
   * faixa "Patrocínio Diamante" no topo e o bloco completo no rodapé.
   */
  const tierId = readString(content, 'tierId');
  const visible = tierId ? sponsors.filter((sponsor) => sponsor.tierId === tierId) : sponsors;

  if (visible.length === 0) return null;

  const title = readString(content, 'title');

  // Agrupa por cota preservando a ordem de rank vinda do repositório.
  const byTier = new Map<string, PublicEventDetail['sponsors']>();
  for (const sponsor of visible) {
    const key = sponsor.tierName ?? 'Patrocinadores';
    const list = byTier.get(key) ?? [];
    list.push(sponsor);
    byTier.set(key, list);
  }

  return (
    <Section id="patrocinadores">
      <SectionHeading eyebrow="Apoio" title={title ?? 'Patrocinadores'} />
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

/**
 * Palestrantes — derivados das ATIVIDADES (FASE 17), com perfil desde a FASE 25.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO HÁ CADASTRO DE PALESTRANTE AQUI
 * ─────────────────────────────────────────────────────────────────────────────
 *  A atividade já guarda seus palestrantes (`ActivitySpeaker`), e é lá que a
 *  instituição os cadastra. Um segundo cadastro para a landing page criaria duas
 *  listas da mesma pessoa — e a divergência entre elas apareceria justamente na
 *  página pública. Este bloco LÊ o que existe; não inventa uma fonte nova.
 *
 *  A FASE 25 acrescentou FOTO, BIO e LINK para a ficha: o que era uma lista de
 *  nomes passou a ser a vitrine de quem conduz o evento. Quando o palestrante ainda
 *  não tem perfil (cadastro antigo, só nome), o bloco continua funcionando — cai na
 *  lista simples em vez de sumir.
 */
function SpeakersBlock({
  activities,
  speakers,
  content,
  tenantSlug,
  eventSlug,
}: {
  activities: PublicActivitySummary[];
  speakers: PublicEventDetail['speakers'];
  content: unknown;
  tenantSlug: string;
  eventSlug: string;
}) {
  const title = readString(content, 'title');

  if (speakers.length > 0) {
    return (
      <Section id="palestrantes">
        <SectionHeading
          eyebrow="Quem conduz"
          title={title ?? 'Palestrantes'}
          description="Conheça quem ministra as atividades deste evento."
        />
        <SpeakerGallery speakers={speakers} tenantSlug={tenantSlug} eventSlug={eventSlug} />
      </Section>
    );
  }

  const seen = new Set<string>();
  const names: { name: string; titles: string[] }[] = [];

  for (const activity of activities) {
    for (const name of activity.speakerNames) {
      const key = name.toLowerCase();
      const existing = names.find((entry) => entry.name.toLowerCase() === key);
      if (existing) {
        if (!existing.titles.includes(activity.title)) existing.titles.push(activity.title);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      names.push({ name, titles: [activity.title] });
    }
  }

  if (names.length === 0) return null;

  return (
    <Section id="palestrantes">
      <SectionHeading eyebrow="Quem conduz" title={title ?? 'Palestrantes'} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {names.map((speaker) => (
          <li key={speaker.name} className="ef-card flex items-start gap-3 p-4">
            <Mic className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">{speaker.name}</p>
              <p className="text-xs opacity-70">{speaker.titles.join(' · ')}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Trilhas temáticas da chamada de trabalhos (FASE 17).
 *
 * A contagem de submissões aparece porque é o único sinal público de que a chamada
 * está viva — e é o que um autor procura antes de escrever.
 */
function TracksBlock({
  tracks,
  content,
}: {
  tracks: PublicEventDetail['tracks'];
  content: unknown;
}) {
  if (tracks.length === 0) return null;

  const title = readString(content, 'title');

  return (
    <Section id="trilhas">
      <SectionHeading
        eyebrow="Chamada de trabalhos"
        title={title ?? 'Trilhas temáticas'}
        description="Submeta seu trabalho na trilha correspondente ao tema."
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {tracks.map((track) => (
          <li key={track.id} className="ef-card space-y-1.5 p-4">
            <p className="flex items-center gap-2 font-medium">
              {track.color ? (
                <span
                  aria-hidden
                  className="inline-block size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: track.color }}
                />
              ) : null}
              {track.name}
            </p>
            {track.description ? (
              <p className="text-sm opacity-70">{track.description}</p>
            ) : null}
            <p className="text-xs opacity-60">
              {track.submissionCount} {track.submissionCount === 1 ? 'trabalho' : 'trabalhos'} submetido(s)
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Chamadas de propostas publicadas (FASE 33).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O BLOCO NÃO DEIXA O ORGANIZADOR ESCREVER A CHAMADA
 * ─────────────────────────────────────────────────────────────────────────────
 *  O corpo do bloco é o DADO REAL da chamada (tipo, texto, prazo e estado), lido do
 *  banco na hora da renderização — mesma decisão do bloco de agenda. Uma chamada
 *  escrita à mão na página continuaria anunciando "prazo até 30/11" em dezembro, e o
 *  visitante só descobriria depois de preencher o formulário inteiro. O que o
 *  organizador escolhe aqui é onde o bloco fica e o que ele diz por cima.
 *
 *  O estado (aberta, agendada, encerrada) vem CALCULADO do servidor, no relógio do
 *  banco: o bloco não decide prazo, só o mostra.
 */
function CallsBlock({
  calls,
  content,
  tenantSlug,
  eventSlug,
}: {
  calls: readonly CallView[];
  content: unknown;
  tenantSlug: string;
  eventSlug: string;
}) {
  const includeClosed =
    typeof content === 'object' && content !== null
      ? (content as Record<string, unknown>).includeClosed === true
      : false;

  const visible = includeClosed
    ? calls
    : calls.filter((call) => call.state === 'OPEN' || call.state === 'SCHEDULED');

  if (visible.length === 0) return null;

  const title = readString(content, 'title');
  const description = readString(content, 'description');

  return (
    <Section id="chamadas">
      <SectionHeading
        eyebrow="Chamadas abertas"
        title={title ?? 'Chamadas de propostas'}
        description={
          description ?? 'Escolha a chamada, leia as orientações e envie sua proposta.'
        }
      />
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="event-calls">
        {visible.map((call) => (
          <li key={call.id} className="ef-card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{call.title}</p>
              <span className="ef-badge shrink-0">{CALL_STATE_LABELS[call.state]}</span>
            </div>

            <p className="text-xs opacity-60">{call.kindLabel}</p>

            {call.summary ? (
              <p className="text-sm opacity-80">{call.summary}</p>
            ) : null}

            <p className="flex flex-wrap items-center gap-3 text-xs opacity-70">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" aria-hidden />
                {call.windowLabel}
              </span>
              {call.countdown && call.state === 'OPEN' ? (
                <span className="flex items-center gap-1.5 font-medium">
                  <Clock className="size-3.5" aria-hidden />
                  {call.countdown}
                </span>
              ) : null}
            </p>

            <Link
              href={tenantPath(tenantSlug, `/eventos/${eventSlug}/chamada/${call.slug}`)}
              className="ef-button mt-auto self-start"
            >
              {call.state === 'OPEN' ? 'Enviar proposta' : 'Ver detalhes'}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Chamada para ação de inscrição (FASE 17).
 *
 * O texto é do organizador; o BOTÃO é da plataforma. Deixar o organizador informar
 * a URL de destino permitiria publicar uma página que leva a um formulário de
 * terceiros — e a inscrição sairia do sistema, com vaga, presença e certificado
 * deixando de existir. O destino é sempre a programação do evento.
 */
function RegistrationCtaBlock({
  content,
  hasActivities,
}: {
  content: unknown;
  hasActivities: boolean;
}) {
  const title = readString(content, 'title') ?? 'Garanta sua vaga';
  const description = readString(content, 'description');
  const ctaLabel = readString(content, 'ctaLabel') ?? 'Ver programação e inscrever-se';

  return (
    <Section id="inscricao">
      <div className="ef-card flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-sm opacity-80">{description}</p>
          ) : (
            <p className="text-sm opacity-80">
              As vagas são por atividade e podem esgotar.
            </p>
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
  /** Chamadas publicadas do evento (FASE 33) — lidas pelo bloco de chamadas. */
  publicCalls: readonly CallView[];
}

/** Traduz um bloco do banco no componente correspondente. */
export function BlockRenderer({
  type,
  content,
  event,
  tenantSlug,
  now,
  publicCalls,
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
      return <SponsorsBlock sponsors={event.sponsors} content={content} />;
    case 'FAQ':
      return <FaqBlock content={content} />;
    case 'GALLERY':
      return <GalleryBlock content={content} />;
    case 'COUNTDOWN':
      return <CountdownBlock content={content} startsAt={event.startsAt} now={now} />;
    case 'VENUE_MAP':
      return <VenueBlock event={event} />;
    case 'SPEAKERS':
      return (
        <SpeakersBlock
          activities={event.activities}
          speakers={event.speakers}
          content={content}
          tenantSlug={tenantSlug}
          eventSlug={event.slug}
        />
      );
    case 'TRACKS':
      return <TracksBlock tracks={event.tracks} content={content} />;
    case 'CALL_FOR_PROPOSALS':
      return (
        <CallsBlock
          calls={publicCalls}
          content={content}
          tenantSlug={tenantSlug}
          eventSlug={event.slug}
        />
      );
    case 'REGISTRATION_CTA':
      return (
        <RegistrationCtaBlock
          content={content}
          hasActivities={event.activities.length > 0}
        />
      );
    case 'CUSTOM_HTML':
      return <CustomHtmlBlock content={content} />;

    // `HERO` é o único tipo sem renderizador próprio: o cabeçalho da página já é
    // montado a partir dos dados do evento (título, período, local, vagas). O
    // editor avisa isso — ver `BLOCK_WITHOUT_RENDERER` no domínio.
    case 'HERO':
    default:
      return null;
  }
}

/** Aviso explícito, usado pelos testes para garantir que HTML não é interpretado. */
export function isSandboxedBlock(type: PageBlockType): boolean {
  return SANDBOXED_BLOCK_TYPES.has(type);
}

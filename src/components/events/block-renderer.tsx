import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Link2,
  Mail,
  MapPin,
  Mic,
  Star,
  Users,
  ExternalLink,
} from 'lucide-react';

import { formatDuration } from '@/domain/events/event-rules';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
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
import {
  SPONSOR_LOGO_HEIGHT_PX,
  SPONSOR_LOGO_MAX_WIDTH_PX,
  sponsorTierTint,
  type SponsorLogoScale,
  type SponsorTierTint,
} from '@/domain/events/sponsor-rules';
import { CALL_STATE_LABELS } from '@/domain/proposals/call-rules';
import type { CallView } from '@/lib/proposals/call-service';
import { hasPublicContacts, PUBLIC_CONTACT_LABELS, PUBLIC_CONTACT_NETWORKS } from '@/domain/profile/public-contacts';
import { teamInitials } from '@/domain/events/team-rules';
import { Section, SectionHeading } from '@/components/events/theme-scope';
import { SpeakerGallery } from '@/components/events/speaker-gallery';
import { AgendaMarks } from '@/components/events/agenda-marks';
import { AgendaClashNotice } from '@/components/events/agenda-clash-notice';
import { FavoriteButton } from '@/components/events/favorite-button';
import { ActivityExportLinks } from '@/components/events/activity-export-links';
import { HappeningNowBanner } from '@/components/events/happening-now';
import { activityIcsUrl } from '@/lib/events/agenda-export';
import { EMPTY_HAPPENING_NOW, type HappeningNowView } from '@/domain/agenda/now-rules';
import {
  clashesWithAgenda,
  EMPTY_AGENDA_VIEW,
  type AgendaViewerItem,
  type EventAgendaView,
} from '@/lib/events/agenda-view';

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
  eventId,
  eventSlug,
  timezone,
  agenda,
  justMarkedActivityId,
  now,
}: {
  activities: PublicActivitySummary[];
  tenantSlug: string;
  eventId: string;
  eventSlug: string;
  /** Fuso do EVENTO — a régua de todo horário escrito para o participante. */
  timezone: string;
  agenda: EventAgendaView;
  /** A atividade que a Server Action acabou de marcar (volta pela URL). */
  justMarkedActivityId: string | null;
  /**
   * A visão do "acontecendo agora" (FASE 65 · fatia 4) — decidida no SERVIDOR, como o
   * resto da página. Vazia quando não há nada em curso: aí a faixa não aparece.
   */
  now: HappeningNowView;
}) {
  if (activities.length === 0) return null;

  return (
    <Section id="programacao">
      <SectionHeading
        eyebrow="Programação"
        title="Atividades"
        description="Inscreva-se nas atividades de seu interesse. As vagas são limitadas."
      />

      {/**
        * ── A FAIXA DO "ACONTECENDO AGORA" (FASE 65 · fatia 4) ───────────────────
        *
        *  Ela fica no TOPO da programação — onde quem chega ao evento olha primeiro —
        *  e leva para a aba, que tem o detalhe por sala. Quando não há nada em curso,
        *  o componente devolve `null`: a programação não ganha um bloco dizendo
        *  "nenhuma atividade em curso", porque isso ocuparia o lugar mais nobre da
        *  tela com uma negativa.
        */}
      <HappeningNowBanner view={now} tenantSlug={tenantSlug} eventSlug={eventSlug} />

      {/**
        * ── A PORTA PARA A GRADE DA PESSOA (FASE 65 · fatia 2) ─────────────────────
        *
        *  Quem está logado vê a programação COM os botões de marcar e precisa de um
        *  caminho de volta para a própria grade — e ele leva o evento junto, porque a
        *  agenda é POR EVENTO (`?evento=<id>`), como o crachá.
        *
        *  O aviso de que favoritar não reserva vaga fica AQUI, onde a decisão acontece:
        *  é a diferença entre as duas marcas (intenção × lugar) que a tela inteira
        *  sustenta, e dizê-la só na outra tela seria dizê-la depois da escolha.
        */}
      {agenda.authenticated ? (
        <p className="mb-4 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-70">
          <Link
            href={`${tenantPath(tenantSlug, '/minha-agenda')}?evento=${eventId}`}
            className="underline underline-offset-4"
            data-testid="minha-agenda-link"
          >
            Ver a minha agenda deste evento
          </Link>
          <span aria-hidden>·</span>
          <span>Marcar não reserva vaga: quem garante lugar é a inscrição.</span>
        </p>
      ) : null}

      <ul className="space-y-3">
        {activities.map((activity) => (
          <ActivityCard
            key={activity.id}
            activity={activity}
            tenantSlug={tenantSlug}
            eventId={eventId}
            eventSlug={eventSlug}
            timezone={timezone}
            agenda={agenda}
            justMarked={justMarkedActivityId === activity.id}
          />
        ))}
      </ul>
    </Section>
  );
}

export function ActivityCard({
  activity,
  tenantSlug,
  eventId = '',
  eventSlug,
  timezone = 'UTC',
  agenda = EMPTY_AGENDA_VIEW,
  justMarked = false,
}: {
  activity: PublicActivitySummary;
  tenantSlug: string;
  eventId?: string;
  eventSlug: string;
  /**
   * Fuso do EVENTO (IANA) — o fuso em que o horário da atividade é LIDO.
   *
   * O default `'UTC'` existe para não quebrar consumidor antigo, e não como escolha:
   * quem renderiza um cartão tem o evento em mãos e passa o fuso dele. Ver o comentário
   * do horário, abaixo, para o defeito que este parâmetro corrige.
   */
  timezone?: string;
  /** A grade de quem está olhando — sem sessão, à visão vazia. */
  agenda?: EventAgendaView;
  /** Esta é a atividade que acabou de ser marcada/desmarcada? */
  justMarked?: boolean;
}) {
  const isFull = activity.remainingSeats === 0;
  const closed =
    activity.status === 'CANCELED' || activity.status === 'COMPLETED';

  /** O que esta pessoa já tem nesta atividade (nada, favorito, inscrição ou os dois). */
  const minha: AgendaViewerItem | undefined = agenda.items.find(
    (item) => item.activityId === activity.id,
  );

  /**
   * ── O AVISO DE CHOQUE, NA HORA DA ESCOLHA (FASE 65 · fatia 2) ────────────────
   *
   *  Ele é calculado contra a MINHA grade — favoritos ∪ inscrições vivas — pela régua
   *  do domínio (`clashesWithAgenda`), e aparece ANTES do clique: quem está prestes a
   *  marcar vê com o que a atividade disputa o horário e decide. Depois de marcar, o
   *  aviso CONTINUA ali (o fato não deixou de ser verdade) — e é isso que mostra, na
   *  mesma tela, que o sistema avisou e gravou mesmo assim.
   */
  const choques = clashesWithAgenda(
    {
      activityId: activity.id,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      status: activity.status,
    },
    agenda.items,
  );

  return (
    <li className="ef-card p-5" id={`atividade-${activity.id}`}>
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

            {/**
              * A MARCA VISUAL DISTINTA (FASE 65 · fatia 2): o que já está na agenda da
              * pessoa se anuncia no cartão — "Inscrito", "Favorito" ou os dois, cada um
              * com o seu ícone e o seu texto.
              */}
            <AgendaMarks
              registered={minha?.registered ?? false}
              favorited={minha?.favorited ?? false}
              variant="tema"
              testId={`marcas-${activity.id}`}
            />
          </div>

          <h3 className="text-base font-semibold">{activity.title}</h3>

          {activity.description ? (
            <p className="line-clamp-2 text-sm opacity-70">{activity.description}</p>
          ) : null}

          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs opacity-70">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
              <dd data-testid={`atividade-horario-${activity.id}`}>
                {/**
                  * ── O HORÁRIO SAI NO FUSO DO EVENTO (FASE 65 · item C) ──────────────
                  *
                  *  Aqui havia um `new Intl.DateTimeFormat('pt-BR', {...}).format(...)`
                  *  SEM `timeZone`. O container roda em UTC (`TZ=UTC`), e o efeito era
                  *  visível e grave: o rodapé da página promete "Horários em
                  *  America/Bahia" e o cartão mostrava UTC — uma atividade das 10:00 em
                  *  Salvador aparecia como 13:00. É o horário que diz à pessoa quando
                  *  ela tem de estar na sala, e ele estava três horas errado.
                  *
                  *  A régua agora é a MESMA do resto do sistema (`formatZonedDateTime`,
                  *  a função da FASE 24 que a grade da fatia 1 e a visão do "agora" já
                  *  usam): uma régua só para "que horas são no evento".
                  */}
                {formatZonedDateTime(activity.startsAt, timezone)}
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

          {/**
            * ── EXPORTAR PARA O CALENDÁRIO (FASE 65 · fatia 3) ─────────────────────
            *
            *  Os dois links existem para TODO visitante, inclusive o anônimo: o arquivo
            *  de UMA atividade é o mesmo para qualquer pessoa (leva título, horário,
            *  sala e descrição — nada de ninguém), e é justamente quem ainda não tem
            *  conta que mais precisa do lembrete na agenda. Quem não pode ver o cartão
            *  também não chega aqui: a programação só mostra evento e atividade
            *  públicos, e a rota reconfere as duas coisas.
            */}
          <ActivityExportLinks
            activityId={activity.id}
            title={activity.title}
            startsAt={activity.startsAt}
            endsAt={activity.endsAt}
            timezone={timezone}
            location={activity.roomName}
            description={activity.description}
            icsHref={activityIcsUrl({ tenantSlug, activityId: activity.id })}
            variant="tema"
          />

          {choques.length > 0 ? (
            <AgendaClashNotice
              targets={choques}
              variant="tema"
              testId={`choque-${activity.id}`}
              hint="Você escolhe qual assistir — marcar as duas é permitido."
            />
          ) : null}

          {justMarked ? (
            <p
              className="flex items-center gap-1.5 text-xs font-medium"
              data-testid={`agenda-confirmacao-${activity.id}`}
            >
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
              {minha?.favorited
                ? 'Adicionada à sua agenda.'
                : 'Removida da sua agenda.'}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {closed ? (
            /**
             * `ef-muted-on-card` no lugar de `opacity-50` (FASE 66): a composição
             * media **3,10:1** sobre o cartão do evento no tema padrão claro. O
             * convite continua parecendo indisponível (`pointer-events-none` e a
             * borda do botão de contorno), mas em texto que se lê.
             */
            <span className="ef-button-outline ef-muted-on-card pointer-events-none">
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

          {/**
            * O BOTÃO DE MARCAR SÓ EXISTE PARA QUEM TEM AGENDA — isto é, para quem tem
            * sessão. Para o visitante anônimo não há "minha agenda" nenhuma, e o
            * caminho é o login (que preserva esta página como destino).
            *
            * Em atividade CANCELADA ele também não aparece: marcar o que não vai
            * acontecer só criaria um item morto na grade.
            */}
          {agenda.authenticated && activity.status !== 'CANCELED' ? (
            <FavoriteButton
              tenantSlug={tenantSlug}
              eventId={eventId}
              eventSlug={eventSlug}
              activityId={activity.id}
              activityTitle={activity.title}
              favorited={minha?.favorited ?? false}
              origem="PROGRAMACAO"
              variant="tema"
            />
          ) : null}
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
  const description = readString(content, 'description');

  /**
   * Agrupa por cota NA ORDEM em que o repositório entregou.
   *
   * A ordem já vem decidida (`sortSponsorsForDisplay`: rank da cota → ordem dentro
   * da cota → nome), então agrupar preservando a primeira aparição é o que faz a
   * faixa do Diamante vir antes da do Ouro sem uma segunda regra de ordenação aqui
   * — duas regras de ordem é como as duas versões divergem.
   *
   * A chave é o `tierId` (e não o nome, como antes): duas cotas podem ter nomes
   * parecidos, e o nome é editável — a VITRINE da cota (cor, escala, descrição)
   * viaja com o id, não com o texto.
   */
  const byTier = new Map<string, { name: string; list: PublicEventDetail['sponsors'] }>();
  for (const sponsor of visible) {
    const key = sponsor.tierId ?? '__sem-cota__';
    const group = byTier.get(key) ?? { name: sponsor.tierName ?? 'Patrocinadores', list: [] };
    group.list.push(sponsor);
    byTier.set(key, group);
  }

  return (
    <Section id="patrocinadores">
      <SectionHeading eyebrow="Apoio" title={title ?? 'Patrocinadores'} />

      {description ? (
        <p className="max-w-2xl text-sm opacity-70" data-testid="sponsors-description">
          {description}
        </p>
      ) : null}

      <div className="space-y-[calc(2rem*var(--ef-spacing-scale,1))]">
        {[...byTier.entries()].map(([key, group]) => {
          const first = group.list[0]!;
          const tint = sponsorTierTint(first.tierColor);

          return (
            <div
              key={key}
              className="space-y-3"
              data-testid="sponsor-tier"
              data-tier-id={key}
              data-tier-scale={first.tierLogoScale}
            >
              {/* `ef-muted` no lugar de `opacity-60` (FASE 66): o nome da cota fica
                  sobre a `--ef-background` do organizador, onde a opacidade media
                  4,44:1 no tema padrão claro — abaixo do AA. */}
              <h3 className="ef-muted flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">                {tint ? (
                  /**
                   * Marcador da cota: uma BARRA na cor, e não o título pintado. Texto
                   * na cor da cota é o caminho mais curto para um título ilegível
                   * (`#facc15` em fundo claro) — a cor identifica, o texto permanece
                   * legível.
                   */
                  <span
                    aria-hidden
                    className="inline-block h-3.5 w-1 rounded-full"
                    style={{ backgroundColor: tint.accent }}
                  />
                ) : null}
                {group.name}
              </h3>

              {first.tierDescription ? (
                <p className="max-w-2xl text-xs opacity-70">{first.tierDescription}</p>
              ) : null}

              <ul className="flex flex-wrap items-stretch gap-4">
                {group.list.map((sponsor) => (
                  <li key={sponsor.id} className="flex">
                    <SponsorCard sponsor={sponsor} tint={tint} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * O cartão do patrocinador (FASE 41).
 *
 * Duas decisões, e as duas são sobre a marca de TERCEIRO que está na página:
 *
 *  • o fundo é o TOM da cor da cota (10% sobre o fundo da seção) e o texto nunca
 *    fica por cima da cor cheia — legibilidade não é escolha do organizador;
 *  • sem cor escolhida, o cartão é neutro e continua legível: "não escolhi cor" é
 *    resposta legítima, não campo pendente.
 *
 * O `color-mix` mistura com `transparent` por cima do fundo, então o mesmo valor
 * funciona no tema claro e no escuro sem ninguém recalcular nada.
 */
function SponsorCard({
  sponsor,
  tint,
}: {
  sponsor: PublicEventDetail['sponsors'][number];
  tint: SponsorTierTint | null;
}) {
  const height = SPONSOR_LOGO_HEIGHT_PX[sponsor.tierLogoScale];
  const maxWidth = SPONSOR_LOGO_MAX_WIDTH_PX[sponsor.tierLogoScale];

  const card = (
    <>
      <SponsorLogo sponsor={sponsor} height={height} maxWidth={maxWidth} />
      {sponsor.websiteUrl ? <ExternalLink className="size-3 shrink-0 opacity-50" aria-hidden /> : null}
    </>
  );

  const className =
    'flex h-full items-center justify-center gap-2 rounded-lg border px-5 py-4 transition hover:opacity-100' +
    (tint ? ' opacity-90' : ' border-border opacity-80');

  const style = tint
    ? { backgroundColor: tint.surface, borderColor: tint.border }
    : { borderColor: 'color-mix(in oklab, var(--ef-text) 12%, transparent)' };

  if (!sponsor.websiteUrl) {
    return (
      <div className={className} style={style} data-testid="sponsor-card">
        {card}
      </div>
    );
  }

  return (
    <a
      href={sponsor.websiteUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={className}
      style={style}
      data-testid="sponsor-card"
    >
      {card}
    </a>
  );
}

/**
 * Tamanho do NOME quando a instituição não subiu o arquivo da logo.
 *
 * Sem isto, a escala da cota só valeria para quem tem arquivo: um patrocinador
 * cadastrado só com o nome sairia do mesmo tamanho em qualquer degrau — e a
 * hierarquia que a cota vendeu desapareceria justamente para quem ainda não tem a
 * marca em arquivo (que é o caso comum no começo do evento).
 *
 * Os degraus usam a ESCALA tipográfica do sistema (token, não pixel arbitrário): a
 * trava do design continua valendo, e o nome nunca fica maior que um título.
 */
const SPONSOR_NAME_CLASS: Record<SponsorLogoScale, string> = {
  SMALL: 'text-sm',
  MEDIUM: 'text-base',
  LARGE: 'text-lg',
  FEATURE: 'text-xl',
};

function SponsorLogo({
  sponsor,
  height,
  maxWidth,
}: {
  sponsor: PublicEventDetail['sponsors'][number];
  height: number;
  maxWidth: number;
}) {
  if (sponsor.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sponsor.logoUrl}
        alt={sponsor.name}
        /**
         * Altura e largura vêm da ESCALA da cota, em `style` inline: são dado, não
         * classe. A escala também sai em `data-logo-scale`, e é isso que o teste
         * mede — comparar pixel de imagem é frágil, o degrau é o contrato.
         */
        className="w-auto object-contain"
        style={{ height: `${height}px`, maxWidth: `${maxWidth}px` }}
        data-logo-scale={sponsor.tierLogoScale}
      />
    );
  }

  return (
    <span
      className={`font-medium opacity-80 ${SPONSOR_NAME_CLASS[sponsor.tierLogoScale]}`}
      data-logo-scale={sponsor.tierLogoScale}
    >
      {sponsor.name}
    </span>
  );
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
      {/* `ef-muted` (FASE 66): a mesma correção do `SectionHeading` — o aviso fica
          sobre a `--ef-background`, e a opacidade media 4,44:1 no claro. */}
      <p className="ef-muted mb-3 text-xs">
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
            {/* Sobre o CARTÃO da trilha: o papel é o `on-card` (FASE 66), porque o
                `.ef-muted` de 60% mede 4,24:1 sobre o cartão — abaixo do AA. */}
            <p className="ef-muted-on-card text-xs">
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

            {/* Dentro do cartão da chamada: `.ef-muted-on-card` (FASE 66). */}
            <p className="ef-muted-on-card text-xs">{call.kindLabel}</p>

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

/**
 * Equipe do evento (FASE 45).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O BLOCO NÃO DEIXA O ORGANIZADOR ESCREVER A EQUIPE
 * ─────────────────────────────────────────────────────────────────────────────
 *  O corpo do bloco é a equipe REAL do evento — as mesmas `event_teams` que organizam
 *  as demandas internas. Uma lista digitada à mão na página continuaria mostrando quem
 *  saiu da equipe em março, e o organizador teria dois lugares para manter a mesma
 *  verdade (a mesma régua do bloco de palestrantes, FASE 25).
 *
 *  O que o organizador escolhe é o TÍTULO, o texto de apoio e, se quiser, UMA equipe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CARTÃO NÃO DECIDE PRIVACIDADE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Ele recebe `organizers` já montado (`buildPublicTeam`): quem não autorizou foto
 *  chega com `avatarUrl: null` e cai nas iniciais; quem não autorizou contato chega
 *  sem e-mail e sem links. Nada de `if` de privacidade aqui — a página não é uma
 *  segunda régua (o comentário da página do perfil público diz o mesmo desde a F44).
 */
function TeamBlock({
  organizers,
  teams,
  content,
}: {
  organizers: PublicEventDetail['organizers'];
  teams: PublicEventDetail['teams'];
  content: unknown;
}) {
  const title = readString(content, 'title');
  const description = readString(content, 'description');
  const teamId = readString(content, 'teamId');

  const chosen = teamId ? teams.find((team) => team.id === teamId) : null;
  const cards = teamId ? organizers.filter((card) => card.labels.includes(chosen?.name ?? '')) : organizers;

  if (cards.length === 0) return null;

  return (
    <Section id="equipe">
      <SectionHeading
        eyebrow="Quem organiza"
        title={title ?? (chosen ? chosen.name : 'Equipe do evento')}
        description={
          description ??
          (chosen
            ? `Quem está à frente de ${chosen.name}.`
            : 'As pessoas que fazem este evento acontecer.')
        }
      />
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="team-block">
        {cards.map((card) => (
          <li key={card.userId} className="space-y-2 text-center" data-testid="team-card">
            <div className="relative mx-auto w-full max-w-44 overflow-hidden rounded-lg border border-border bg-surface-low">
              {card.avatarUrl ? (
                /**
                 * A foto é a MESMA do perfil na plataforma e já passou pela régua de
                 * visibilidade — se está aqui, a pessoa autorizou.
                 */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.avatarUrl}
                  alt={card.name}
                  className="aspect-4/5 w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div
                  className="flex aspect-4/5 w-full items-center justify-center text-3xl font-semibold text-muted-foreground"
                  aria-hidden
                >
                  {teamInitials(card.name)}
                </div>
              )}
              {card.labels.length > 0 ? (
                <span className="absolute inset-x-2 bottom-2 rounded-md bg-inverse-surface/90 px-2 py-1 text-xs font-medium text-inverse-on-surface">
                  {card.labels.join(' / ')}
                </span>
              ) : null}
            </div>

            <p className="font-medium leading-tight">{card.name}</p>

            {card.email || hasPublicContacts(card.links) ? (
              <div
                className="flex items-center justify-center gap-2 text-muted-foreground"
                data-testid="team-contacts"
              >
                {card.email ? (
                  <a
                    href={`mailto:${card.email}`}
                    aria-label={`Enviar e-mail para ${card.name}`}
                    title={card.email}
                    className="rounded-md p-1 hover:text-foreground"
                  >
                    <Mail className="size-4" aria-hidden />
                  </a>
                ) : null}
                {PUBLIC_CONTACT_NETWORKS.map((network) => {
                  const url = card.links[network];
                  if (!url) return null;

                  return (
                    <a
                      key={network}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      aria-label={`${PUBLIC_CONTACT_LABELS[network]} de ${card.name}`}
                      className="rounded-md p-1 hover:text-foreground"
                    >
                      <Link2 className="size-4" aria-hidden />
                    </a>
                  );
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
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
  /**
   * A grade de quem está olhando (FASE 65 · fatia 2): sem sessão chega a visão vazia,
   * e o bloco da programação não desenha botão nenhum. Opcional para que a
   * pré-visualização e os consumidores antigos do bloco continuem válidos.
   */
  agenda?: EventAgendaView;
  /** A atividade recém-marcada, quando a pessoa volta da Server Action. */
  justMarkedActivityId?: string | null;
  /**
   * A visão do "acontecendo agora" (FASE 65 · fatia 4). Chega PRONTA (lida na página,
   * com o relógio e o fuso do evento) porque este é um componente de RENDERIZAÇÃO — a
   * mesma razão de `now` e da agenda. O default vazio existe para a pré-visualização,
   * onde não há relógio a decidir: ali a faixa simplesmente não aparece.
   */
  happeningNow?: HappeningNowView;
}

/** Traduz um bloco do banco no componente correspondente. */
export function BlockRenderer({
  type,
  content,
  event,
  tenantSlug,
  now,
  publicCalls,
  agenda = EMPTY_AGENDA_VIEW,
  justMarkedActivityId = null,
  happeningNow = EMPTY_HAPPENING_NOW,
}: BlockRendererProps) {
  switch (type) {
    case 'RICH_TEXT':
      return <RichTextBlock content={content} />;
    case 'SCHEDULE':
      return (
        <ActivitiesBlock
          activities={event.activities}
          tenantSlug={tenantSlug}
          eventId={event.id}
          eventSlug={event.slug}
          timezone={event.timezone}
          agenda={agenda}
          justMarkedActivityId={justMarkedActivityId}
          now={happeningNow}
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
    case 'TEAM':
      return <TeamBlock organizers={event.organizers} teams={event.teams} content={content} />;
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

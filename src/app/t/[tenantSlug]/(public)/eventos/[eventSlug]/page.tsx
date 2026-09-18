import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CalendarDays, MapPin, Clock, Users } from 'lucide-react';

// Import por alias: independente da profundidade da rota (ver nota na página
// da atividade).
import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import { buildEventMetadata, selectRenderableBlocks } from '@/domain/events/landing-page';
import {
  deriveEventStatus,
  evaluateRegistrationWindow,
  formatDuration,
  formatEventPeriod,
} from '@/domain/events/event-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listPublicRaffleResults } from '@/lib/raffles/raffle-service';
import { BlockRenderer } from '@/components/events/block-renderer';
import { RaffleResults } from '@/components/raffles/raffle-results';
import { Section, ThemeScope } from '@/components/events/theme-scope';

export const dynamic = 'force-dynamic';

/**
 * Metadados gerados a partir do evento.
 *
 * O organizador pode sobrescrever título e descrição pela página do evento
 * (`EventPage.metaTitle`/`metaDescription`); quando não o faz, montamos uma
 * descrição a partir de resumo, subtítulo, data e local — uma landing page sem
 * descrição perde muito em compartilhamento.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Evento não encontrado' };

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) return { title: 'Evento não encontrado' };

  const meta = buildEventMetadata(event);
  const title = event.page?.metaTitle ?? meta.title;
  const description = event.page?.metaDescription ?? meta.description;

  return {
    title,
    description,
    openGraph: { ...meta.openGraph, title, description },
    alternates: { canonical: tenantPath(tenantSlug, `/eventos/${event.slug}`) },
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Landing page pública do evento
 *
 *  Server Component: o HTML sai completo do servidor. A página é montada a partir
 *  dos BLOCOS configurados pelo organizador, na ordem escolhida por ele — não de
 *  um layout fixo. Quando o evento não tem blocos configurados, caímos em uma
 *  composição padrão sensata (hero + sobre + programação + patrocinadores).
 *
 *  Isso atende "landing page modular e altamente personalizável" sem abrir mão
 *  de uma página decente para quem nunca configurou nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
}) {
  const { tenantSlug, eventSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) notFound();

  /**
   * Instante da renderização, resolvido UMA vez.
   *
   * Derivar o status e a janela de inscrição a partir do MESMO instante evita
   * inconsistência (ex.: status diz "inscrições abertas" enquanto a janela já
   * fechou por alguns milissegundos). Também é o valor repassado aos blocos
   * sensíveis ao tempo, mantendo-os puros.
   */
  const now = new Date();

  const status = deriveEventStatus(event, now);
  const window = evaluateRegistrationWindow({
    now,
    eventStartsAt: event.startsAt,
    eventEndsAt: event.endsAt,
    eventStatus: status,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
  });

  // Blocos configurados pelo organizador (ordenados, sem invisíveis/desconhecidos).
  const configuredBlocks = event.page
    ? selectRenderableBlocks(
        event.page.blocks.map((block) => ({
          id: block.id,
          type: block.type as never,
          content: block.content,
          style: block.style,
          displayOrder: block.displayOrder,
          isVisible: block.isVisible,
        })),
      )
    : [];

  const hasConfiguredLayout = configuredBlocks.length > 0;

  /**
   * Resultados de sorteio PUBLICADOS neste evento (FASE 16, item G5).
   *
   * Leitura sob RLS com contexto da instituição do slug, e o filtro `isPublic` é do
   * banco: publicar é uma decisão por sorteio, não um padrão. A leitura devolve
   * nomes já mascarados conforme o consentimento de perfil público.
   */
  const publicRaffles = await listPublicRaffleResults(tenant.tenantId, event.id);

  return (
    <ThemeScope theme={event.theme}>
      <div
        className={
          event.theme.animation === 'none'
            ? ''
            : event.theme.animation === 'slide'
              ? 'ef-anim-slide'
              : 'ef-anim-fade'
        }
      >
        {/* ── Voltar para a listagem ─────────────────────────────────────── */}
        <nav className="px-6 pt-6">
          <div className="mx-auto w-full max-w-5xl">
            <Link
              href={tenantPath(tenantSlug, '/eventos')}
              className="text-xs opacity-60 underline underline-offset-4"
            >
              ← Todos os eventos de {tenant.name}
            </Link>
          </div>
        </nav>

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <header
          className={
            event.theme.heroStyle === 'gradient'
              ? 'ef-hero-gradient mt-4'
              : event.theme.heroStyle === 'image' && event.coverImageUrl
                ? 'mt-4 bg-cover bg-center'
                : 'mt-4'
          }
          style={
            event.theme.heroStyle === 'image' && event.coverImageUrl
              ? { backgroundImage: `url(${event.coverImageUrl})` }
              : undefined
          }
        >
          <div className="px-6 py-[calc(3.5rem*var(--ef-spacing-scale,1))]">
            <div className="mx-auto w-full max-w-5xl space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ef-badge">
                  {status === 'REGISTRATION_OPEN'
                    ? 'Inscrições abertas'
                    : status === 'REGISTRATION_CLOSED'
                      ? 'Inscrições encerradas'
                      : status === 'IN_PROGRESS'
                        ? 'Acontecendo agora'
                        : status === 'FINISHED'
                          ? 'Evento encerrado'
                          : 'Em breve'}
                </span>
                <span className="ef-badge">
                  {event.modality === 'ONLINE'
                    ? 'Online'
                    : event.modality === 'HYBRID'
                      ? 'Híbrido'
                      : 'Presencial'}
                </span>
              </div>

              <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
                {event.title}
              </h1>

              {event.subtitle ? (
                <p className="max-w-2xl text-pretty text-lg opacity-90">
                  {event.subtitle}
                </p>
              ) : null}

              <dl className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm opacity-90">
                <div className="flex items-center gap-2">
                  <CalendarDays className="size-4 shrink-0" aria-hidden />
                  <dd>{formatEventPeriod(event, event.timezone)}</dd>
                </div>
                {event.city ? (
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 shrink-0" aria-hidden />
                    <dd>
                      {event.venueName ? `${event.venueName}, ` : ''}
                      {event.city}
                    </dd>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Users className="size-4 shrink-0" aria-hidden />
                  <dd>
                    {event.remainingSeats === null
                      ? 'Vagas ilimitadas'
                      : `${event.remainingSeats} vagas restantes`}
                  </dd>
                </div>
              </dl>

              {/* ── Chamada para ação ───────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                {window.open ? (
                  <a href="#programacao" className="ef-button">
                    Inscrever-se em uma atividade
                    <ArrowRight className="size-4" aria-hidden />
                  </a>
                ) : (
                  <span className="ef-badge">{window.message}</span>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ── CONTEÚDO ──────────────────────────────────────────────────── */}
        {hasConfiguredLayout ? (
          // Layout definido pelo organizador, na ordem dele.
          configuredBlocks.map((block) => (
            <BlockRenderer
              key={block.id}
              type={block.type}
              content={block.content}
              event={event}
              tenantSlug={tenantSlug}
              now={now.getTime()}
            />
          ))
        ) : (
          // Fallback: composição padrão quando o evento ainda não tem página
          // configurada. Garante uma vitrine decente desde o primeiro dia.
          <>
            {event.summary ?? event.description ? (
              <Section>
                <h2 className="mb-3 text-2xl font-semibold tracking-tight">
                  Sobre o evento
                </h2>
                <p className="whitespace-pre-line text-pretty leading-relaxed opacity-80">
                  {event.description ?? event.summary}
                </p>
              </Section>
            ) : null}

            <BlockRenderer
              type="SCHEDULE"
              content={null}
              event={event}
              tenantSlug={tenantSlug}
              now={now.getTime()}
            />

            {event.sponsors.length > 0 ? (
              <BlockRenderer
                type="SPONSORS"
                content={null}
                event={event}
                tenantSlug={tenantSlug}
                now={now.getTime()}
              />
            ) : null}
          </>
        )}

        {/*
          ── RESULTADOS PUBLICADOS (FASE 16) ────────────────────────────────────
          Aparece só quando a instituição publicou algum resultado (opt-in por
          sorteio) — e depois do conteúdo, porque é a informação do FIM do evento.
        */}
        <RaffleResults results={publicRaffles} />

        {/* ── Rodapé ────────────────────────────────────────────────────── */}
        <footer className="px-6 py-10">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 border-t pt-6 text-xs opacity-60"
            style={{ borderColor: 'color-mix(in oklab, var(--ef-text) 12%, transparent)' }}
          >
            <p>
              {tenant.name} · {event.activities.length}{' '}
              {event.activities.length === 1 ? 'atividade' : 'atividades'}
              {event.activities.length > 0
                ? ` · ${formatDuration(
                    event.activities.reduce((sum, a) => sum + a.workloadMinutes, 0),
                  )} de programação`
                : ''}
            </p>
            <p className="flex items-center gap-1.5">
              <Clock className="size-3" aria-hidden />
              Horários em {event.timezone}
            </p>
          </div>
        </footer>
      </div>
    </ThemeScope>
  );
}

import Link from 'next/link';
import { ArrowRight, CalendarDays, Clock, MapPin, Users, Eye } from 'lucide-react';

import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import {
  selectRenderableBlocks,
  type ResolvedEventTheme,
} from '@/domain/events/landing-page';
import {
  deriveEventStatus,
  evaluateRegistrationWindow,
  formatDuration,
  formatEventPeriod,
} from '@/domain/events/event-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import type { PublicEventDetail } from '@/lib/events/event-repository';
import type { PublicRaffleResult } from '@/lib/raffles/raffle-service';
import { BlockRenderer } from '@/components/events/block-renderer';
import type { CallView } from '@/lib/proposals/call-service';
import { RaffleResults } from '@/components/raffles/raffle-results';
import { Section, ThemeScope } from '@/components/events/theme-scope';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LANDING PAGE DO EVENTO — componente compartilhado (FASE 23, item E9)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PÁGINA PÚBLICA VIROU COMPONENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A pré-visualização do rascunho precisa mostrar EXATAMENTE o que o visitante verá:
 *  a mesma hierarquia, o mesmo hero, os mesmos blocos, o mesmo rodapé. A alternativa
 *  era uma segunda tela "parecida com a pública" — que começa idêntica e termina
 *  diferente, e a diferença sempre aparece na hora errada (o organizador aprova na
 *  prévia algo que o site não mostra).
 *
 *  Então a página pública deixou de ser uma tela e passou a ser um COMPONENTE com
 *  dois consumidores:
 *
 *      /t/<slug>/eventos/<eventSlug>                       (público)
 *      /t/<slug>/administracao/eventos/<id>/pagina/previa  (autenticado, rascunho)
 *
 *  A única diferença entre eles é o que chega em `event`: no primeiro, a página
 *  PUBLICADA; no segundo, a página ATUAL (mesmo sendo rascunho). O componente não
 *  sabe — e não precisa saber — de qual dos dois se trata.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O SELO DE PRÉVIA É VISÍVEL, E A ROTA É AUTENTICADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma tela que parece a página pública e NÃO é precisa dizer isso na cara: o
 *  organizador pode estar com as duas abertas. O aviso fica no topo, dentro do
 *  tema do evento, e a rota vive sob `administracao` (exige `page:manage`) — a
 *  prévia nunca é um caminho público para material não publicado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface EventLandingPreviewInfo {
  /** Rótulo do estado de publicação (ex.: "Agendada para 01/12 10:00"). */
  publicationLabel: string;
  /** Caminho de volta para o editor. */
  editorHref: string;
}

export function EventLanding({
  event,
  tenantSlug,
  tenantName,
  now,
  publicRaffles,
  publicCalls,
  preview,
}: {
  event: PublicEventDetail;
  tenantSlug: string;
  tenantName: string;
  /** Instante resolvido UMA vez pelo chamador (componente de renderização é puro). */
  now: Date;
  publicRaffles: PublicRaffleResult[];
  /**
   * Chamadas de propostas PUBLICADAS (FASE 33). Chegam prontas — com estado, prazo e
   * contagem calculados no servidor — porque o bloco de chamadas é só apresentação:
   * quem decide se uma chamada está aberta é o domínio, no relógio do banco.
   */
  publicCalls: readonly CallView[];
  /** Presente apenas na pré-visualização do rascunho. */
  preview?: EventLandingPreviewInfo;
}) {
  const status = deriveEventStatus(event, now);
  const window = evaluateRegistrationWindow({
    now,
    eventStartsAt: event.startsAt,
    eventEndsAt: event.endsAt,
    eventStatus: status,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
  });

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

  const theme = event.theme as ResolvedEventTheme;

  return (
    <ThemeScope theme={event.theme}>
      <div
        className={
          theme.animation === 'none'
            ? ''
            : theme.animation === 'slide'
              ? 'ef-anim-slide'
              : 'ef-anim-fade'
        }
      >
        {preview ? (
          <div
            className="ef-card m-4 flex flex-wrap items-center justify-between gap-3 p-4"
            data-testid="preview-banner"
          >
            <p className="flex items-center gap-2 text-sm">
              <Eye className="size-4 shrink-0 opacity-70" aria-hidden />
              <span>
                <strong>Pré-visualização.</strong> Esta é a página como ela está agora —{' '}
                {preview.publicationLabel}.
              </span>
            </p>
            <Link href={preview.editorHref} className="ef-button shrink-0">
              Voltar ao editor
            </Link>
          </div>
        ) : null}

        {/* ── Voltar para a listagem ─────────────────────────────────────── */}
        <nav className="px-6 pt-6">
          <div className="mx-auto w-full max-w-5xl">
            <Link
              href={tenantPath(tenantSlug, '/eventos')}
              className="text-xs opacity-60 underline underline-offset-4"
            >
              ← Todos os eventos de {tenantName}
            </Link>
          </div>
        </nav>

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <header
          className={
            theme.heroStyle === 'gradient'
              ? 'ef-hero-gradient mt-4'
              : theme.heroStyle === 'image' && event.coverImageUrl
                ? 'mt-4 bg-cover bg-center'
                : 'mt-4'
          }
          style={
            theme.heroStyle === 'image' && event.coverImageUrl
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
                <p className="max-w-2xl text-pretty text-lg opacity-90">{event.subtitle}</p>
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
                  /**
                   * A chamada principal é a inscrição no EVENTO (revisão da FASE 3):
                   * ela é a porta de entrada — inclui as atividades abertas — e a
                   * pessoa escolhe os minicursos depois, na programação.
                   */
                  <Link
                    href={tenantPath(tenantSlug, `/eventos/${event.slug}/inscricao`)}
                    className="ef-button"
                    data-testid="event-registration-cta"
                  >
                    Inscrever-se no evento
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
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
              publicCalls={publicCalls}
            />
          ))
        ) : (
          // Fallback: composição padrão quando o evento ainda não tem página
          // configurada (ou quando a página está vazia).
          <>
            {event.summary ?? event.description ? (
              <Section>
                <h2 className="mb-3 text-2xl font-semibold tracking-tight">Sobre o evento</h2>
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
              publicCalls={publicCalls}
            />

            {event.sponsors.length > 0 ? (
              <BlockRenderer
                type="SPONSORS"
                content={null}
                event={event}
                tenantSlug={tenantSlug}
                now={now.getTime()}
                publicCalls={publicCalls}
              />
            ) : null}
          </>
        )}

        {/*
          ── RESULTADOS PUBLICADOS (FASE 16) ────────────────────────────────────
          Aparece só quando a instituição publicou algum resultado (opt-in por
          sorteio) — e depois do conteúdo, porque é a informação do FIM do evento.
        */}
        <RaffleResults results={publicRaffles} tenantSlug={tenantSlug} eventSlug={event.slug} />

        {/*
          ── PÁGINA VAZIA, E A TELA DIZ ISSO (FASE 23) ─────────────────────────
          A prévia de uma página sem blocos cai na composição padrão, que é o que o
          visitante veria — mas o organizador precisa saber que a página DELE está
          vazia, senão ele aprova a prévia achando que montou algo.
        */}
        {preview && !hasConfiguredLayout ? (
          <Section>
            <p className="ef-badge" data-testid="preview-empty-warning">
              Nenhum bloco visível nesta página — os visitantes veriam a composição padrão acima.
            </p>
          </Section>
        ) : null}

        {/* ── Rodapé ────────────────────────────────────────────────────── */}
        <footer className="px-6 py-10">
          <div
            className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 border-t pt-6 text-xs opacity-60"
            style={{ borderColor: 'color-mix(in oklab, var(--ef-text) 12%, transparent)' }}
          >
            <p>
              {tenantName} · {event.activities.length}{' '}
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

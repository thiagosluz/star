import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CalendarDays,
  Building2,
  Search,
  MapPin,
  Sparkles,
  ArrowRight,
  SlidersHorizontal,
  X,
  Globe,
  Radio,
} from 'lucide-react';

import { ThemeChoice } from '@/components/theme/theme-choice';
import {
  EVENT_CATEGORIES,
  getEventCategoryLabel,
  parseEventCategory,
} from '@/domain/events/event-category-rules';
import {
  eventModalityLabel,
  EVENT_MODALITY_OPTIONS,
} from '@/domain/events/event-modality-rules';
import { DEFAULT_DIRECTORY_PAGE_SIZE } from '@/domain/platform/platform-rules';
import { listPublicDirectory } from '@/lib/platform/directory-service';
import { searchPublicEvents } from '@/lib/platform/global-repository';

export const metadata: Metadata = {
  title: 'Explorar Eventos e Instituições · EventFlow',
  description:
    'Descubra eventos acadêmicos, corporativos e comunitários com inscrições abertas, submissão de trabalhos e certificação digital.',
};

interface EventosPageProps {
  searchParams: Promise<{
    aba?: string;
    q?: string;
    categoria?: string;
    modalidade?: string;
    cidade?: string;
    uf?: string;
    periodo?: string;
    pagina?: string;
  }>;
}

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'lvh.me';

function formatEventDate(startsAt: Date, endsAt: Date): string {
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const sameDay =
    startsAt.getFullYear() === endsAt.getFullYear() &&
    startsAt.getMonth() === endsAt.getMonth() &&
    startsAt.getDate() === endsAt.getDate();

  if (sameDay) {
    return `${dateFormatter.format(startsAt)} · ${timeFormatter.format(startsAt)} às ${timeFormatter.format(endsAt)}`;
  }

  return `${dateFormatter.format(startsAt)} até ${dateFormatter.format(endsAt)}`;
}

export default async function PublicEventsDirectoryPage({ searchParams }: EventosPageProps) {
  const params = await searchParams;
  const activeTab = params.aba === 'instituicoes' ? 'instituicoes' : 'eventos';
  const query = (params.q ?? '').trim();
  const category = parseEventCategory(params.categoria);
  const modality = (params.modalidade ?? '').trim();
  const city = (params.cidade ?? '').trim();
  const state = (params.uf ?? '').trim().toUpperCase();
  const period = (params.periodo ?? 'upcoming') as 'upcoming' | 'all' | 'this_week' | 'this_month' | 'past';
  const page = Number.parseInt(params.pagina ?? '1', 10);
  const validPage = Number.isFinite(page) && page > 0 ? page : 1;

  // Busca de eventos ou diretório conforme a aba
  const [eventsResult, directoryResult] = await Promise.all([
    activeTab === 'eventos'
      ? searchPublicEvents({
          query,
          category: category ?? undefined,
          modality: modality || undefined,
          city: city || undefined,
          state: state || undefined,
          period,
          page: validPage,
          pageSize: 12,
        })
      : null,
    activeTab === 'instituicoes'
      ? listPublicDirectory({
          query,
          page: validPage,
          pageSize: DEFAULT_DIRECTORY_PAGE_SIZE,
        })
      : null,
  ]);

  const hasActiveFilters = Boolean(
    query || category || modality || city || state || (period && period !== 'upcoming'),
  );

  function buildUrl(patch: Record<string, string | number | null | undefined>): string {
    const sp = new URLSearchParams();
    if (activeTab === 'instituicoes') sp.set('aba', 'instituicoes');
    if (query) sp.set('q', query);
    if (category) sp.set('categoria', category);
    if (modality) sp.set('modalidade', modality);
    if (city) sp.set('cidade', city);
    if (state) sp.set('uf', state);
    if (period && period !== 'upcoming') sp.set('periodo', period);
    if (validPage > 1) sp.set('pagina', String(validPage));

    for (const [key, val] of Object.entries(patch)) {
      if (val === null || val === undefined || val === '') {
        sp.delete(key);
      } else {
        sp.set(key, String(val));
      }
    }

    const qs = sp.toString();
    return qs ? `/eventos?${qs}` : '/eventos';
  }

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="public-events-directory">
      {/* ─── Topo / Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-foreground transition hover:opacity-85">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </div>
            <span className="text-xl font-bold">EventFlow</span>
          </Link>

          <nav className="flex items-center gap-3">
            <Link
              href="/para-instituicoes"
              className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
            >
              Para Instituições
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-border px-3.5 py-1.5 text-sm font-medium transition hover:bg-accent"
            >
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      {/* ─── Hero e Alternador de Abas ─────────────────────────────────────────── */}
      <section className="border-b border-border bg-gradient-to-b from-muted/40 to-background py-10">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Globe className="size-3.5" />
              Vitrine Viva da Plataforma
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              Explore eventos e instituições
            </h1>
            <p className="text-base text-muted-foreground">
              Participe de simpósios, conferências, congressos e oficinas em instituições de todo o país.
            </p>
          </div>

          {/* Abas: Eventos vs Instituições */}
          <div className="mt-8 flex items-center gap-2 border-b border-border pb-px">
            <Link
              href={buildUrl({ aba: null, pagina: null })}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === 'eventos'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
              data-testid="tab-eventos"
            >
              <CalendarDays className="size-4" />
              Eventos
              {eventsResult && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {eventsResult.total}
                </span>
              )}
            </Link>

            <Link
              href={buildUrl({ aba: 'instituicoes', pagina: null })}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === 'instituicoes'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
              data-testid="tab-instituicoes"
            >
              <Building2 className="size-4" />
              Instituições
              {directoryResult && (
                <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {directoryResult.total}
                </span>
              )}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Conteúdo Principal ─────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-7xl px-6 py-10" data-testid="unified-events-explorer">
        {activeTab === 'eventos' && (
          <div>
            {/* Barra de Filtros (Formulário GET sem dependência de JavaScript) */}
            <form
              method="get"
              action="/eventos"
              className="mb-8 space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xs"
              role="search"
              data-testid="events-search-form"
            >
              <input type="hidden" name="aba" value="eventos" />

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {/* Busca textual */}
                <div className="relative sm:col-span-2">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    name="q"
                    defaultValue={query}
                    placeholder="Buscar por título, resumo ou instituição..."
                    className="w-full rounded-xl border border-input bg-background pl-10 pr-4 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Categoria */}
                <div>
                  <select
                    name="categoria"
                    defaultValue={category ?? ''}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Todas as categorias</option>
                    {EVENT_CATEGORIES.map((cat) => (
                      <option key={cat.key} value={cat.key}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Modalidade */}
                <div>
                  <select
                    name="modalidade"
                    defaultValue={modality}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Todas as modalidades</option>
                    {EVENT_MODALITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Filtros secundários: Período, Cidade, UF e Ações */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                    <SlidersHorizontal className="size-3.5" />
                    <span>Período:</span>
                  </div>
                  <select
                    name="periodo"
                    defaultValue={period}
                    className="rounded-lg border border-input bg-background px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-hidden"
                  >
                    <option value="upcoming">Próximos eventos</option>
                    <option value="this_week">Esta semana</option>
                    <option value="this_month">Este mês</option>
                    <option value="all">Todos (inclusive passados)</option>
                    <option value="past">Apenas realizados</option>
                  </select>

                  <input
                    type="text"
                    name="cidade"
                    defaultValue={city}
                    placeholder="Cidade"
                    className="w-28 rounded-lg border border-input bg-background px-2.5 py-1 text-xs placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
                  />

                  <input
                    type="text"
                    name="uf"
                    maxLength={2}
                    defaultValue={state}
                    placeholder="UF"
                    className="w-14 rounded-lg border border-input bg-background px-2.5 py-1 text-xs uppercase placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
                  />
                </div>

                <div className="flex items-center gap-2">
                  {hasActiveFilters && (
                    <Link
                      href="/eventos"
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3" />
                      Limpar filtros
                    </Link>
                  )}
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition hover:opacity-90"
                  >
                    Filtrar
                  </button>
                </div>
              </div>
            </form>

            {/* Grid de Eventos */}
            {eventsResult && eventsResult.items.length > 0 ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="events-grid">
                {eventsResult.items.map((event) => {
                  const eventUrl = `/t/${event.tenantSlug}/eventos/${event.slug}`;
                  const isOnline = event.modality === 'ONLINE';

                  return (
                    <article
                      key={event.id}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-md"
                      data-testid={`event-card-${event.id}`}
                    >
                      {/* Capa do Evento */}
                      <Link href={eventUrl} className="relative aspect-video w-full overflow-hidden bg-muted">
                        {event.coverImageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={event.coverImageUrl}
                            alt=""
                            className="size-full object-cover transition duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/15 via-muted to-muted/80 p-6 text-center">
                            <span className="text-sm font-semibold tracking-wide text-primary">
                              {getEventCategoryLabel(event.category)}
                            </span>
                          </div>
                        )}

                        {/* Badges sobre a capa */}
                        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center rounded-md bg-background/90 px-2 py-0.5 text-xs font-medium backdrop-blur-xs text-foreground shadow-xs">
                            {eventModalityLabel(event.modality)}
                          </span>
                          {event.category && (
                            <span className="inline-flex items-center rounded-md bg-primary/90 px-2 py-0.5 text-xs font-medium text-primary-foreground backdrop-blur-xs shadow-xs">
                              {getEventCategoryLabel(event.category)}
                            </span>
                          )}
                        </div>
                      </Link>

                      {/* Corpo do Card */}
                      <div className="flex flex-1 flex-col p-5">
                        {/* Data e Horário */}
                        <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                          <CalendarDays className="size-3.5 shrink-0" />
                          <time>{formatEventDate(new Date(event.startsAt), new Date(event.endsAt))}</time>
                        </div>

                        {/* Título do Evento */}
                        <h2 className="mt-2 text-lg font-bold leading-snug tracking-tight text-foreground line-clamp-2">
                          <Link href={eventUrl} className="hover:underline">
                            {event.title}
                          </Link>
                        </h2>

                        {/* Resumo */}
                        {event.summary && (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                            {event.summary}
                          </p>
                        )}

                        <div className="mt-auto pt-4">
                          {/* Instituição Organizadora */}
                          <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                            <Link
                              href={`/t/${event.tenantSlug}`}
                              className="flex items-center gap-2 hover:text-foreground truncate max-w-[65%]"
                            >
                              {event.tenantLogoUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={event.tenantLogoUrl}
                                  alt=""
                                  className="size-5 rounded-full object-cover shrink-0"
                                />
                              ) : (
                                <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-bold text-xs">
                                  {event.tenantName.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <span className="truncate font-medium">{event.tenantName}</span>
                            </Link>

                            {/* Local ou Online */}
                            <div className="flex items-center gap-1 text-xs shrink-0">
                              {isOnline ? (
                                <span className="inline-flex items-center gap-1 text-success font-medium">
                                  <Radio className="size-3 animate-pulse" />
                                  Online
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 truncate max-w-[120px]">
                                  <MapPin className="size-3 shrink-0" />
                                  <span className="truncate">{event.city ?? 'Local'}{event.state ? `/${event.state}` : ''}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center" data-testid="events-empty-state">
                <CalendarDays className="mx-auto size-12 text-muted-foreground/60" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  Nenhum evento encontrado
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tente alterar os termos de busca, limpar filtros ou expandir o período.
                </p>
                {hasActiveFilters && (
                  <div className="mt-6">
                    <Link
                      href="/eventos"
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      Limpar todos os filtros
                    </Link>
                  </div>
                )}
              </div>
            )}

            {/* Paginação de Eventos */}
            {eventsResult && eventsResult.totalPages > 1 && (
              <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Paginação">
                {validPage > 1 && (
                  <Link
                    href={buildUrl({ pagina: validPage - 1 })}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    Anterior
                  </Link>
                )}
                <span className="px-3 text-xs font-medium text-muted-foreground">
                  Página {validPage} de {eventsResult.totalPages}
                </span>
                {validPage < eventsResult.totalPages && (
                  <Link
                    href={buildUrl({ pagina: validPage + 1 })}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    Próxima
                  </Link>
                )}
              </nav>
            )}
          </div>
        )}

        {/* ─── Aba Instituições ──────────────────────────────────────────────── */}
        {activeTab === 'instituicoes' && directoryResult && (
          <div data-testid="organizations-directory">
            {/* Busca rápida de instituições */}
            <form method="get" action="/eventos" className="mb-6 flex max-w-xl gap-2" role="search">
              <input type="hidden" name="aba" value="instituicoes" />
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="directory-search"
                  type="search"
                  name="q"
                  defaultValue={query}
                  data-testid="directory-search"
                  placeholder="Buscar instituição por nome, sigla ou segmento..."
                  className="w-full rounded-xl border border-input bg-background pl-10 pr-4 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                type="submit"
                data-testid="directory-search-submit"
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition hover:opacity-90"
              >
                Buscar
              </button>
            </form>

            <p className="mb-6 text-xs text-muted-foreground" data-testid="directory-summary">
              {query
                ? `${directoryResult.total} instituição(ões) encontrada(s) para “${query}”`
                : `${directoryResult.visibleTenants} instituição(ões) publicando na plataforma`}
            </p>

            {directoryResult.entries.length > 0 ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="directory-list">
                {directoryResult.entries.map((tenant) => {
                  const href = `/t/${tenant.slug}`;

                  return (
                    <article
                      key={tenant.id}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-md"
                      data-testid="directory-card"
                      data-tenant-slug={tenant.slug}
                    >
                      {/* Capa da Instituição */}
                      <div className="relative h-28 w-full overflow-hidden bg-muted">
                        {tenant.coverImageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={tenant.coverImageUrl}
                            alt=""
                            className="size-full object-cover transition duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="size-full bg-gradient-to-r from-primary/15 via-primary/5 to-muted" />
                        )}
                        {tenant.segment && (
                          <span className="absolute top-3 right-3 rounded-md bg-background/90 px-2 py-0.5 text-xs font-medium text-foreground backdrop-blur-xs shadow-xs">
                            {tenant.segment}
                          </span>
                        )}
                      </div>

                      {/* Conteúdo com Logo Flutuante */}
                      <div className="relative flex flex-1 flex-col p-5 pt-0">
                        <div className="-mt-8 mb-3 flex items-end justify-between">
                          <div className="size-16 overflow-hidden rounded-2xl border-4 border-card bg-background shadow-sm">
                            {tenant.logoUrl ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img src={tenant.logoUrl} alt="" className="size-full object-cover" />
                            ) : (
                              <div className="flex size-full items-center justify-center bg-muted font-bold text-muted-foreground text-lg">
                                {tenant.name.slice(0, 1).toUpperCase()}
                              </div>
                            )}
                          </div>

                          {tenant.openEventCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                              <CalendarDays className="size-3" />
                              {tenant.openEventCount} {tenant.openEventCount === 1 ? 'evento aberto' : 'eventos abertos'}
                            </span>
                          )}
                        </div>

                        <h2 className="text-lg font-bold tracking-tight text-foreground line-clamp-1" data-testid="directory-card-name">
                          <Link href={href} className="hover:underline">
                            {tenant.name}
                          </Link>
                        </h2>

                        {tenant.description && (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                            {tenant.description}
                          </p>
                        )}

                        <div className="mt-auto pt-4 flex items-center justify-between border-t border-border/60 text-xs text-muted-foreground">
                          <span data-testid="directory-card-subdomain" className="truncate">
                            {tenant.slug}.{ROOT_DOMAIN}
                          </span>
                          <Link
                            href={`/t/${tenant.slug}/eventos`}
                            data-testid="directory-card-open"
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                          >
                            Ver eventos
                            <ArrowRight className="size-3.5" />
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center" data-testid="directory-empty">
                <Building2 className="mx-auto size-12 text-muted-foreground/60" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  Nenhuma instituição encontrada
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tente buscar por outro termo ou nome.
                </p>
              </div>
            )}

            {/* Paginação de Instituições */}
            {directoryResult.totalPages > 1 && (
              <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Paginação de instituições">
                {validPage > 1 && (
                  <Link
                    href={buildUrl({ pagina: validPage - 1 })}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    Anterior
                  </Link>
                )}
                <span className="px-3 text-xs font-medium text-muted-foreground">
                  Página {validPage} de {directoryResult.totalPages}
                </span>
                {validPage < directoryResult.totalPages && (
                  <Link
                    href={buildUrl({ pagina: validPage + 1 })}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    Próxima
                  </Link>
                )}
              </nav>
            )}
          </div>
        )}
      </main>

      {/* ─── Rodapé ───────────────────────────────────────────────────────────── */}
      <footer className="mt-20 border-t border-border bg-card/30 py-8">
        <div className="mx-auto max-w-7xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} EventFlow. Plataforma SaaS multi-instituição de gestão de eventos.</p>
          <div className="flex items-center gap-4">
            <Link href="/para-instituicoes" className="hover:text-foreground">Para Organizadores</Link>
            <ThemeChoice variant="public" />
          </div>
        </div>
      </footer>
    </div>
  );
}

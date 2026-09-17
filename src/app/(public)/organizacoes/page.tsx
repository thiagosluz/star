import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, CalendarDays, ExternalLink, Globe, Search } from 'lucide-react';

import { buildTenantUrl, tenantPath } from '@/domain/tenancy/resolution';
import { DEFAULT_DIRECTORY_PAGE_SIZE } from '@/domain/platform/platform-rules';
import { listPublicDirectory } from '@/lib/platform/directory-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DIRETÓRIO PÚBLICO DE INSTITUIÇÕES — `/organizacoes`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA PÁGINA VIVE FORA DE `/t/[tenantSlug]`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Tudo em `/t/<slug>` pertence a UMA instituição e carrega o contexto dela. O
 *  diretório é o oposto: é o único lugar da plataforma cujo assunto são TODAS as
 *  instituições ao mesmo tempo. Colocá-lo dentro de um tenant seria pedir a uma
 *  instituição que hospedasse a vitrine das concorrentes — e amarraria o endereço
 *  público da plataforma ao slug de alguém.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE APARECE AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Somente instituições ATIVAS que não desligaram a vitrine (`isPublic`). Quem
 *  organiza um evento e não quer ser descoberto desliga a chave — não precisa sair
 *  da plataforma nem apagar nada.
 *
 *  A ordenação é por VOLUME DE EVENTOS ABERTOS: a vitrine serve para descobrir o
 *  que está acontecendo agora, então quem tem mais eventos abertos vem primeiro.
 *  Empate resolve pelo próximo evento e, depois, por ordem alfabética.
 *
 *  Não há JavaScript de cliente nesta página: a busca é um formulário GET e a
 *  paginação são links. A vitrine inteira cabe em uma entrada de cache, e filtrar
 *  em memória evita uma consulta por tecla digitada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata: Metadata = {
  title: 'Instituições na plataforma',
  description:
    'Descubra instituições que organizam eventos acadêmicos, corporativos e comunitários e veja o que está com inscrições abertas.',
};

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'lvh.me';

function protocol(): string {
  return (process.env.APP_URL ?? '').startsWith('https') ? 'https' : 'http';
}

/** Monta o endereço de uma página do diretório preservando a busca. */
function directoryHref(options: { query?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (options.query) params.set('q', options.query);
  if (options.page && options.page > 1) params.set('pagina', String(options.page));

  const query = params.toString();
  return query ? `/organizacoes?${query}` : '/organizacoes';
}

export default async function OrganizationsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { q, pagina } = await searchParams;
  const query = (q ?? '').trim();
  const page = Number.parseInt(pagina ?? '1', 10);

  const directory = await listPublicDirectory({
    query,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: DEFAULT_DIRECTORY_PAGE_SIZE,
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12" data-testid="organizations-directory">
      <header className="max-w-2xl">
        <p className="label-caps text-muted-foreground">
          EventFlow
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          Instituições na plataforma
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Instituições que publicam seus eventos aqui. Abra uma delas para ver a programação, as
          atividades e as inscrições abertas.
        </p>
      </header>

      {/* Busca por formulário GET: funciona sem JavaScript e o resultado é linkável. */}
      <form method="get" action="/organizacoes" className="mt-8 flex max-w-xl gap-2" role="search">
        <label className="sr-only" htmlFor="directory-search">
          Buscar instituição por nome ou sigla
        </label>
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            id="directory-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Buscar por nome ou sigla (ex.: UFBA)"
            data-testid="directory-search"
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <button
          type="submit"
          data-testid="directory-search-submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Buscar
        </button>
      </form>

      <p className="mt-4 text-xs text-muted-foreground" data-testid="directory-summary">
        {query
          ? `${directory.total} instituição(ões) encontrada(s) para “${query}”`
          : `${directory.visibleTenants} instituição(ões) publicando na plataforma`}
      </p>

      {directory.entries.length === 0 ? (
        <div
          className="mt-8 rounded-xl border border-dashed border-border bg-card p-10 text-center"
          data-testid="directory-empty"
        >
          <Building2 className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <h2 className="mt-4 text-base font-medium text-foreground">
            {query ? 'Nenhuma instituição encontrada' : 'Ainda não há instituições públicas'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {query
              ? 'Tente outro termo — a busca considera o nome e o identificador da instituição.'
              : 'Assim que uma instituição publicar um evento, ela aparece aqui.'}
          </p>
          {query ? (
            <Link
              href="/organizacoes"
              className="mt-4 inline-block text-sm underline-offset-4 hover:underline"
            >
              Limpar a busca
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="directory-list">
          {directory.entries.map((entry) => {
            const subdomainUrl = buildTenantUrl({
              slug: entry.slug,
              rootDomain: ROOT_DOMAIN,
              protocol: protocol(),
              path: '/',
            });

            return (
              <li
                key={entry.id}
                data-testid="directory-card"
                data-tenant-slug={entry.slug}
                className="flex flex-col rounded-xl border border-border bg-card p-5 transition hover:border-primary/40"
              >
                <div className="flex items-start gap-3">
                  {entry.logoUrl ? (
                    // O logotipo vem de URL validada por allowlist (http/https) —
                    // nunca de `data:` ou `javascript:`.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.logoUrl}
                      alt=""
                      className="size-11 shrink-0 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Building2 className="size-5" aria-hidden />
                    </span>
                  )}

                  <div className="min-w-0">
                    <h2
                      className="truncate text-base font-semibold text-foreground"
                      data-testid="directory-card-name"
                    >
                      {entry.name}
                    </h2>
                    <p className="code-data text-muted-foreground">/{entry.slug}</p>
                  </div>
                </div>

                <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {entry.description ?? 'Instituição na plataforma EventFlow.'}
                </p>

                <p className="mt-4 flex items-center gap-2 text-xs font-medium text-foreground">
                  <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
                  <span data-testid="directory-card-activity">{entry.activityLabel}</span>
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  <Link
                    href={tenantPath(entry.slug, '/eventos')}
                    data-testid="directory-card-open"
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    Ver eventos
                    <ExternalLink className="size-3.5" aria-hidden />
                  </Link>

                  <a
                    href={subdomainUrl}
                    data-testid="directory-card-subdomain"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    <Globe className="size-3.5" aria-hidden />
                    {entry.slug}.{ROOT_DOMAIN}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {directory.totalPages > 1 ? (
        <nav
          className="mt-10 flex items-center justify-between gap-4 border-t border-border pt-6"
          aria-label="Paginação do diretório"
          data-testid="directory-pagination"
        >
          {directory.page > 1 ? (
            <Link
              href={directoryHref({ query, page: directory.page - 1 })}
              data-testid="directory-prev"
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Anterior
            </Link>
          ) : (
            <span />
          )}

          <span className="text-xs text-muted-foreground">
            Página {directory.page} de {directory.totalPages}
          </span>

          {directory.page < directory.totalPages ? (
            <Link
              href={directoryHref({ query, page: directory.page + 1 })}
              data-testid="directory-next"
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Próxima
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookOpen, FileText, Search } from 'lucide-react';

import { getTenantContext } from '@/lib/events/event-repository';
import { getPublicProceedingsByEventSlug } from '@/lib/proceedings/proceedings-service';
import { publicBaseUrl } from '@/lib/public-url';
import { tenantPath } from '@/domain/tenancy/resolution';
import { Badge, Card, CardContent, EmptyState, GetSearchForm, Input, PageHeader, Select } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Anais' };

  const data = await getPublicProceedingsByEventSlug({
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    eventSlug,
  });

  if (!data) return { title: 'Anais não encontrados' };

  const canonical = `${publicBaseUrl()}${tenantPath(tenant.slug, `/eventos/${eventSlug}/anais`)}`;
  return {
    title: `${data.volume.title} · ${tenant.name}`,
    description:
      data.volume.preface?.slice(0, 160) ??
      `Anais publicados de ${data.event.title} (${data.volume.editionYear}).`,
    alternates: { canonical },
  };
}

export default async function PublicProceedingsVolumePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
  searchParams: Promise<{ q?: string; secao?: string }>;
}) {
  const { tenantSlug, eventSlug } = await params;
  const { q, secao } = await searchParams;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const data = await getPublicProceedingsByEventSlug({
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    eventSlug,
    query: q,
    section: secao,
  });

  if (!data) notFound();

  const oaiPath = `/api/t/${tenant.slug}/eventos/${data.event.slug}/oai?verb=Identify`;

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PageHeader
        title={data.volume.title}
        description={
          data.volume.subtitle ??
          `Anais de ${data.event.title} · ${data.volume.editionYear}`
        }
        breadcrumbs={[
          { label: tenant.name, href: tenantPath(tenant.slug, '') },
          { label: data.event.title, href: tenantPath(tenant.slug, `/eventos/${data.event.slug}`) },
          { label: 'Anais' },
        ]}
        badge={
          <Badge tone="success">
            {data.totalEntries} {data.totalEntries === 1 ? 'trabalho publicado' : 'trabalhos publicados'}
          </Badge>
        }
      />

      {/* ── Ficha catalográfica do volume ──────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-5 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Evento</dt>
            <dd className="font-medium">{data.event.title}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Editora / Instituição</dt>
            <dd>{data.volume.publisherName ?? tenant.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Edição</dt>
            <dd>
              {[data.volume.volumeLabel, String(data.volume.editionYear)].filter(Boolean).join(' · ')}
            </dd>
          </div>
          {data.volume.issn || data.volume.isbn ? (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">ISSN / ISBN</dt>
              <dd className="font-mono text-xs">
                {[data.volume.issn ? `ISSN ${data.volume.issn}` : null, data.volume.isbn ? `ISBN ${data.volume.isbn}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </div>
          ) : null}
          {data.volume.editors ? (
            <div className="sm:col-span-2 lg:col-span-4">
              <dt className="text-xs font-medium text-muted-foreground">Organização editorial</dt>
              <dd>{data.volume.editors}</dd>
            </div>
          ) : null}
        </dl>
        {data.volume.preface ? (
          <p className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            {data.volume.preface}
          </p>
        ) : null}
      </section>

      {/* ── Busca e filtro por seção (progressivo sem JS) ──────────────────── */}
      <GetSearchForm
        action={tenantPath(tenant.slug, `/eventos/${data.event.slug}/anais`)}
        omitEmpty
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
      >
        <div className="min-w-60 flex-1 space-y-1">
          <label htmlFor="proceedings-search" className="text-xs font-medium">
            Buscar nos anais
          </label>
          <Input
            id="proceedings-search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Título, autor, palavra-chave ou protocolo..."
          />
        </div>

        {data.sections.length > 0 ? (
          <div className="w-full space-y-1 sm:w-56">
            <label htmlFor="proceedings-section" className="text-xs font-medium">
              Seção / Trilha
            </label>
            <Select id="proceedings-section" name="secao" defaultValue={secao ?? ''}>
              <option value="">Todas as seções</option>
              {data.sections.map((sectionName) => (
                <option key={sectionName} value={sectionName}>
                  {sectionName}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Search className="size-3.5" aria-hidden />
          Filtrar
        </button>
      </GetSearchForm>

      {/* ── Lista de trabalhos ─────────────────────────────────────────────── */}
      {data.entries.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nenhum trabalho encontrado com esse filtro"
          description="Tente limpar a busca ou selecionar outra seção."
        />
      ) : (
        <div className="space-y-4" data-testid="proceedings-entries-list">
          {data.entries.map((entry) => {
            const workHref = tenantPath(
              tenant.slug,
              `/eventos/${data.event.slug}/anais/${entry.protocol}`,
            );

            return (
              <Card key={entry.id} data-testid={`proceedings-work-card-${entry.protocol}`}>
                <CardContent className="space-y-2 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {entry.protocol}
                    </span>
                    {entry.sectionName ? <Badge tone="neutral">{entry.sectionName}</Badge> : null}
                    {entry.pageStart !== null && entry.pageEnd !== null ? (
                      <span className="text-xs text-muted-foreground">
                        p. {entry.pageStart}–{entry.pageEnd}
                      </span>
                    ) : null}
                    {entry.hasPdf ? (
                      <Badge tone="success">PDF completo</Badge>
                    ) : (
                      <Badge tone="neutral">Resumo e citação</Badge>
                    )}
                  </div>

                  <h2 className="text-base font-semibold leading-snug">
                    <Link href={workHref} className="hover:text-primary hover:underline">
                      {entry.title}
                    </Link>
                  </h2>

                  <p className="text-xs text-muted-foreground">
                    {entry.authors.map((a) => a.name).join(', ')}
                  </p>

                  {entry.abstract ? (
                    <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                      {entry.abstract}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
                    <Link href={workHref} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      <FileText className="size-3.5" aria-hidden />
                      Ler trabalho e citar
                    </Link>
                    {entry.hasPdf ? (
                      <a
                        href={`/api/t/${tenant.slug}/eventos/${data.event.slug}/anais/${entry.protocol}/arquivo`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-muted-foreground hover:text-foreground hover:underline"
                      >
                        Abrir PDF
                      </a>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-6 text-xs text-muted-foreground">
        <span>Protocolo aberto de colheita: OAI-PMH 2.0 (oai_dc)</span>
        <a href={oaiPath} className="underline underline-offset-4 hover:text-foreground">
          Endpoint OAI-PMH deste volume
        </a>
      </footer>
    </main>
  );
}

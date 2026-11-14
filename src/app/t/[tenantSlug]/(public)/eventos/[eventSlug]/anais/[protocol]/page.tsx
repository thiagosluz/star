import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ExternalLink, FileText, ShieldAlert } from 'lucide-react';

import { getTenantContext } from '@/lib/events/event-repository';
import { getPublicProceedingsWork } from '@/lib/proceedings/proceedings-service';
import {
  formatAbntCitation,
  formatApaCitation,
  formatBibtexCitation,
} from '@/domain/proceedings/citation-rules';
import {
  buildScholarlyArticleJsonLd,
  buildScholarlyMetaTags,
  serializeJsonLd,
} from '@/domain/proceedings/indexing-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { CitationBox } from '@/components/proceedings/citation-box';
import { Alert, Badge, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; protocol: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug, protocol } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Trabalho nos anais' };

  const data = await getPublicProceedingsWork({
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    eventSlug,
    protocol,
  });

  if (!data) return { title: 'Trabalho não encontrado' };

  const scholarlyTags = buildScholarlyMetaTags({
    work: data.work,
    volume: data.volume,
  });

  return {
    title: `${data.work.title} · ${data.volume.title}`,
    description: data.work.abstract.slice(0, 160),
    alternates: { canonical: data.work.abstractUrl },
    other: scholarlyTags,
  };
}

export default async function PublicProceedingsWorkPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; protocol: string }>;
}) {
  const { tenantSlug, eventSlug, protocol } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const data = await getPublicProceedingsWork({
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    eventSlug,
    protocol,
  });

  if (!data) notFound();

  const abnt = formatAbntCitation(data.work, data.volume);
  const apa = formatApaCitation(data.work, data.volume);
  const bibtex = formatBibtexCitation(data.work, data.volume);
  const jsonLd = buildScholarlyArticleJsonLd({
    work: data.work,
    volume: data.volume,
  });

  const citationBase = `/api/t/${tenant.slug}/eventos/${data.event.slug}/anais/${data.work.protocol}/citacao`;
  const pdfApiUrl = `/api/t/${tenant.slug}/eventos/${data.event.slug}/anais/${data.work.protocol}/arquivo`;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <PageHeader
        title={data.work.title}
        description={data.volume.title}
        breadcrumbs={[
          { label: tenant.name, href: tenantPath(tenant.slug, '') },
          { label: data.event.title, href: tenantPath(tenant.slug, `/eventos/${data.event.slug}`) },
          { label: 'Anais', href: tenantPath(tenant.slug, `/eventos/${data.event.slug}/anais`) },
          { label: data.work.protocol },
        ]}
        badge={
          <>
            <span className="rounded border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {data.work.protocol}
            </span>
            {data.work.sectionName ? <Badge tone="neutral">{data.work.sectionName}</Badge> : null}
            {data.work.pageStart !== null && data.work.pageEnd !== null ? (
              <span className="text-xs text-muted-foreground">
                p. {data.work.pageStart}–{data.work.pageEnd}
              </span>
            ) : null}
          </>
        }
        actions={
          data.work.isPdfServed ? (
            <a
              href={pdfApiUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="open-proceedings-pdf"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <FileText className="size-4" aria-hidden />
              Abrir PDF completo
            </a>
          ) : null
        }
      />

      {/* ── Autores e afiliações ───────────────────────────────────────────── */}
      <section className="space-y-2 rounded-lg border border-border bg-card p-5" aria-labelledby="authors-heading">
        <h2 id="authors-heading" className="text-sm font-semibold">
          Autoria
        </h2>
        <ul className="space-y-1.5 text-sm">
          {data.work.authors.map((author) => (
            <li key={`${author.order}-${author.name}`} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{author.name}</span>
              {author.institution ? (
                <span className="text-xs text-muted-foreground">— {author.institution}</span>
              ) : null}
              {author.orcidId ? (
                <a
                  href={`https://orcid.org/${author.orcidId.replace(/^https?:\/\/orcid\.org\//i, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-primary hover:underline"
                >
                  ORCID: {author.orcidId}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </li>
          ))}
        </ul>

        {data.work.externalDoi ? (
          <p className="pt-2 text-xs">
            DOI:{' '}
            <a
              href={`https://doi.org/${data.work.externalDoi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-primary underline underline-offset-4"
            >
              https://doi.org/{data.work.externalDoi}
            </a>
          </p>
        ) : null}
      </section>

      {data.work.pdfBlockedReason ? (
        <Alert tone="warning" title="Arquivo temporariamente indisponível">
          <span className="inline-flex items-center gap-1.5">
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            {data.work.pdfBlockedReason}
          </span>
        </Alert>
      ) : null}

      {/* ── Resumo e palavras-chave ────────────────────────────────────────── */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-5" aria-labelledby="abstract-heading">
        <h2 id="abstract-heading" className="text-base font-semibold">
          Resumo
        </h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          {data.work.abstract}
        </p>

        {data.work.keywords.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-xs font-medium text-muted-foreground">Palavras-chave:</span>
            {data.work.keywords.map((keyword) => (
              <Badge key={keyword} tone="neutral">
                {keyword}
              </Badge>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Bloco de Citação (ABNT, APA, BibTeX, RIS) ──────────────────────── */}
      <CitationBox
        abnt={abnt}
        apa={apa}
        bibtex={bibtex}
        bibtexHref={`${citationBase}?formato=bibtex`}
        risHref={`${citationBase}?formato=ris`}
      />
    </main>
  );
}

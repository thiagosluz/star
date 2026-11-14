'use client';

import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';

export function CitationBox(props: {
  abnt: string;
  apa: string;
  bibtex: string;
  bibtexHref: string;
  risHref: string;
}) {
  const [copiedKey, setCopiedKey] = useState<'abnt' | 'apa' | 'bibtex' | null>(null);

  async function copy(key: 'abnt' | 'apa' | 'bibtex', text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-card p-5"
      aria-labelledby="citation-heading"
      data-testid="citation-box"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="citation-heading" className="text-base font-semibold">
          Como citar este trabalho
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={props.bibtexHref}
            download
            data-testid="download-bibtex"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Download className="size-3.5" aria-hidden />
            Baixar BibTeX (.bib)
          </a>
          <a
            href={props.risHref}
            download
            data-testid="download-ris"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Download className="size-3.5" aria-hidden />
            Baixar RIS (.ris)
          </a>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5 rounded-md border border-border/70 bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              ABNT (NBR 6023)
            </span>
            <button
              type="button"
              onClick={() => copy('abnt', props.abnt)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {copiedKey === 'abnt' ? (
                <>
                  <Check className="size-3.5" aria-hidden /> Copiado
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden /> Copiar ABNT
                </>
              )}
            </button>
          </div>
          <p className="text-xs leading-relaxed" data-testid="citation-abnt">
            {props.abnt}
          </p>
        </div>

        <div className="space-y-1.5 rounded-md border border-border/70 bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              APA (7ª edição)
            </span>
            <button
              type="button"
              onClick={() => copy('apa', props.apa)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {copiedKey === 'apa' ? (
                <>
                  <Check className="size-3.5" aria-hidden /> Copiado
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden /> Copiar APA
                </>
              )}
            </button>
          </div>
          <p className="text-xs leading-relaxed" data-testid="citation-apa">
            {props.apa}
          </p>
        </div>

        <div className="space-y-1.5 rounded-md border border-border/70 bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              BibTeX
            </span>
            <button
              type="button"
              onClick={() => copy('bibtex', props.bibtex)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {copiedKey === 'bibtex' ? (
                <>
                  <Check className="size-3.5" aria-hidden /> Copiado
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden /> Copiar BibTeX
                </>
              )}
            </button>
          </div>
          <pre className="overflow-x-auto text-xs leading-relaxed">{props.bibtex}</pre>
        </div>
      </div>
    </section>
  );
}

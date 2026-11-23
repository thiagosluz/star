import Link from 'next/link';
import { ArrowRight, CalendarDays, Clock } from 'lucide-react';

import { readBlockString } from '@/components/events/block-content-renderers';
import { Section, SectionHeading } from '@/components/events/theme-scope';
import {
  PUBLIC_CALL_RESULT_LANDING_BADGE,
  PUBLIC_CALL_RESULT_LANDING_LINK,
  showsPublishedResultBadge,
} from '@/domain/proposals/call-result-public-rules';
import { CALL_STATE_LABELS } from '@/domain/proposals/call-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import type { CallView } from '@/lib/proposals/call-service';

/** Bloco público de chamadas de propostas e selo de resultado publicado. */
export function CallsBlock({
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

  const title = readBlockString(content, 'title');
  const description = readBlockString(content, 'description');

  return (
    <Section id="chamadas">
      <SectionHeading
        eyebrow="Chamadas abertas"
        title={title ?? 'Chamadas de propostas'}
        description={description ?? 'Escolha a chamada, leia as orientações e envie sua proposta.'}
      />
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="event-calls">
        {visible.map((call) => (
          <li key={call.id} className="ef-card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{call.title}</p>
              <span className="ef-badge shrink-0">{CALL_STATE_LABELS[call.state]}</span>
            </div>

            <p className="ef-muted-on-card text-xs">{call.kindLabel}</p>

            {call.summary ? <p className="text-sm opacity-80">{call.summary}</p> : null}

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

            {showsPublishedResultBadge(call.resultState) ? (
              <p className="flex flex-wrap items-center gap-2 text-xs" data-testid="call-result-published">
                <span className="ef-badge">{PUBLIC_CALL_RESULT_LANDING_BADGE}</span>
                <Link
                  href={tenantPath(tenantSlug, `/eventos/${eventSlug}/chamada/${call.slug}`)}
                  className="underline underline-offset-4"
                  data-testid={`call-result-published-link-${call.id}`}
                >
                  {PUBLIC_CALL_RESULT_LANDING_LINK}
                </Link>
              </p>
            ) : null}

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

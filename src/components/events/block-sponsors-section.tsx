import { ExternalLink } from 'lucide-react';

import { readBlockString } from '@/components/events/block-content-renderers';
import { Section, SectionHeading } from '@/components/events/theme-scope';
import {
  SPONSOR_LOGO_HEIGHT_PX,
  SPONSOR_LOGO_MAX_WIDTH_PX,
  sponsorTierTint,
  type SponsorLogoScale,
  type SponsorTierTint,
} from '@/domain/events/sponsor-rules';
import type { PublicEventDetail } from '@/lib/events/event-repository';

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

/** Vitrine de patrocinadores agrupados por cota preservando a ordem do repositório. */
export function SponsorsBlock({
  sponsors,
  content,
}: {
  sponsors: PublicEventDetail['sponsors'];
  content: unknown;
}) {
  const tierId = readBlockString(content, 'tierId');
  const visible = tierId ? sponsors.filter((sponsor) => sponsor.tierId === tierId) : sponsors;

  if (visible.length === 0) return null;

  const title = readBlockString(content, 'title');
  const description = readBlockString(content, 'description');

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
              <h3 className="ef-muted flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                {tint ? (
                  <span
                    aria-hidden
                    className="inline-block h-3.5 w-1 rounded-full"
                    style={{ backgroundColor: tint.accent }}
                  />
                ) : null}
                {group.name}
              </h3>

              {first.tierDescription ? <p className="max-w-2xl text-xs opacity-70">{first.tierDescription}</p> : null}

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

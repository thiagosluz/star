import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Award,
  Eye,
  ExternalLink,
  Flame,
  GraduationCap,
  Handshake,
  Lock,
  Sparkles,
  Trophy,
} from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';
import { lattesUrl, orcidUrl } from '@/domain/profile/public-profile-rules';
import { type CardRarity } from '@/domain/gamification/types';
import { getPublicProfile } from '@/lib/profile/public-profile-service';
import { Avatar, Badge, Card, CardContent, SectionHeading } from '@/components/ui';
import { CardVisual } from '@/components/gamification/card-visual';
import { resolveArt, resolvePalette } from '@/domain/gamification/card-rules';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PERFIL PÚBLICO DO PARTICIPANTE (FASE 44)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA NÃO DECIDE NADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela recebe o pacote que `getPublicProfile` montou campo a campo e RENDERIZA o que
 *  veio. Não há `if` de visibilidade aqui: se o campo não está no pacote, ele não é
 *  exibido — e um campo novo só aparece quando a decisão dele passar pelo domínio.
 *  Essa separação é o que impede a página de virar uma segunda régua de privacidade
 *  (e de divergir dela no primeiro ajuste).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O 404 JÁ ACONTECEU ANTES DAQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Perfil privado ou inexistente chega como `NOT_FOUND` do serviço: a página nunca
 *  sabe a diferença, e por isso não vaza a existência de um handle que a pessoa
 *  decidiu não revelar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; username: string }>;
}) {
  const { tenantSlug, username } = await params;

  const context = await getRequestContext();
  const result = await getPublicProfile({
    tenantSlug,
    username,
    viewerUserId: context?.user?.id ?? null,
  });

  if (!result.ok) {
    return { title: 'Perfil não encontrado', robots: { index: false, follow: false } };
  }

  const name = result.page.profile.displayName ?? `@${result.page.username}`;

  return {
    title: `${name} · ${result.page.tenantName}`,
    description: result.page.profile.headline ?? undefined,
    /**
     * `noindex` é o PADRÃO, e ser encontrado no Google é uma escolha separada: ter
     * página é diferente de ser achável. Quem não autorizou não aparece em busca
     * nenhuma, nem por nome nem por handle.
     */
    robots: result.page.indexable ? undefined : { index: false, follow: false },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; username: string }>;
}) {
  const { tenantSlug, username } = await params;

  const context = await getRequestContext();
  const loggedHere =
    context && context.activeTenant?.tenantSlug === tenantSlug ? (context.user ?? null) : null;

  const result = await getPublicProfile({
    tenantSlug,
    username,
    viewerUserId: loggedHere?.id ?? context?.user?.id ?? null,
  });

  if (!result.ok) notFound();

  const { page } = result;
  const profile = page.profile;

  const orcid = orcidUrl(profile.orcidId);
  const lattes = lattesUrl(profile.lattesId);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10" data-testid="public-profile">
      {page.isOwner ? (
        <p
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-low p-3 text-xs text-muted-foreground"
          data-testid="profile-owner-preview"
        >
          <Eye className="size-3.5 shrink-0" aria-hidden />
          Você está vendo o seu próprio perfil. É exatamente isto que as pessoas veem — para mudar o
          que aparece,{' '}
          <Link
            href={tenantPath(tenantSlug, '/meu-perfil-publico')}
            className="underline underline-offset-4"
          >
            edite o seu perfil público
          </Link>
          .
        </p>
      ) : null}

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{page.tenantName}</p>

        <div className="flex flex-wrap items-start gap-4">
          {profile.avatarUrl ? (
            /**
             * A foto vem do acervo (bucket público) e é a MESMA do perfil na
             * plataforma. O `Avatar` de iniciais fica para quem não subiu foto.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt={profile.displayName ?? page.username}
              className="size-20 shrink-0 rounded-full border border-border object-cover"
              data-testid="profile-avatar"
            />
          ) : (
            <Avatar name={profile.displayName ?? page.username} size="lg" />
          )}

          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="profile-name">
              {profile.displayName ?? `@${page.username}`}
            </h1>
            <p className="code-data text-sm text-muted-foreground" data-testid="profile-handle">
              @{page.username}
            </p>
            {profile.headline ? (
              <p className="text-sm text-muted-foreground" data-testid="profile-headline">
                {profile.headline}
              </p>
            ) : null}
          </div>
        </div>

        {profile.level !== undefined ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="profile-level">
            <Badge tone="primary">
              <Trophy className="mr-1 size-3" aria-hidden />
              Nível {profile.level}
            </Badge>
            {profile.levelTitle ? <Badge tone="neutral">{profile.levelTitle}</Badge> : null}
            {profile.prestige ? (
              <Badge tone="warning">
                <Sparkles className="mr-1 size-3" aria-hidden />
                Prestígio {profile.prestige}
              </Badge>
            ) : null}
            {profile.streak !== undefined && profile.streak > 1 ? (
              <Badge tone="danger">
                <Flame className="mr-1 size-3" aria-hidden />
                {profile.streak} dias seguidos
              </Badge>
            ) : null}
            {profile.xp !== undefined ? (
              <span className="text-xs text-muted-foreground">{profile.xp} XP</span>
            ) : null}
            {profile.standing ? (
              <span className="text-xs text-muted-foreground" data-testid="profile-standing">
                top {profile.standing.topPercent}% de {profile.standing.sampleSize} pessoas com XP
              </span>
            ) : null}
          </div>
        ) : null}

        {orcid || lattes || profile.siteUrl ? (
          <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="profile-links">
            {orcid ? (
              <a
                href={orcid}
                target="_blank"
                rel="noopener noreferrer nofollow me"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                ORCID <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            {lattes ? (
              <a
                href={lattes}
                target="_blank"
                rel="noopener noreferrer nofollow me"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                Lattes <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            {profile.siteUrl ? (
              <a
                href={profile.siteUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                site pessoal <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}
      </header>

      {profile.bio ? (
        <section className="space-y-2" data-testid="profile-bio">
          <SectionHeading title="Sobre" />
          <p className="text-sm">{profile.bio}</p>
        </section>
      ) : null}

      {profile.interests && profile.interests.length > 0 ? (
        <section className="space-y-2" data-testid="profile-interests">
          <SectionHeading title="Interesses" description="Declarados por esta pessoa." />
          <ul className="flex flex-wrap gap-2">
            {profile.interests.map((interest) => (
              <li key={interest}>
                <Badge tone="neutral">{interest}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile.pinnedCards && profile.pinnedCards.length > 0 ? (
        <section className="space-y-3" data-testid="profile-cards">
          <SectionHeading
            title="Cartas em destaque"
            description="Escolhidas pela própria pessoa. O álbum completo é privado."
          />
          <ul className="flex flex-wrap gap-4">
            {profile.pinnedCards.map((card) => (
              <li key={`${card.name}-${card.isFoil ? 'foil' : 'plain'}`}>
                <CardVisual
                  name={card.name}
                  rarity={card.rarity}
                  palette={resolvePalette(null, card.rarity)}
                  imageUrl={card.imageUrl ?? resolveArt(null).imageUrl}
                  size="sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {RARITY_LABELS[card.rarity as CardRarity]}
                  {card.isFoil ? ' · foil' : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile.collection ? (
        <section className="space-y-2" data-testid="profile-collection">
          <SectionHeading title="Coleção" />
          <p className="text-sm text-muted-foreground">
            {profile.collection.owned} carta(s)
            {profile.collection.foils > 0 ? ` · ${profile.collection.foils} foil` : ''}
            {Object.entries(profile.collection.byRarity).length > 0
              ? ` · ${Object.entries(profile.collection.byRarity)
                  .map(([rarity, count]) => `${count} ${RARITY_LABELS[rarity as CardRarity] ?? rarity}`)
                  .join(', ')}`
              : ''}
          </p>
        </section>
      ) : null}

      {profile.eventCount !== undefined || (profile.events && profile.events.length > 0) ? (
        <section className="space-y-3" data-testid="profile-events">
          <SectionHeading
            title="Participação"
            description="Eventos que esta pessoa escolheu mostrar."
          />
          {profile.eventCount !== undefined ? (
            <p className="text-sm text-muted-foreground">
              {profile.eventCount} evento(s) nesta instituição.
            </p>
          ) : null}
          {profile.events && profile.events.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {profile.events.map((event) => (
                <li key={`${event.title}-${event.year}`} className="flex items-center gap-2">
                  <GraduationCap className="size-3.5 text-muted-foreground" aria-hidden />
                  {event.title}
                  <span className="text-xs text-muted-foreground">{event.year}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {profile.certificates && profile.certificates.length > 0 ? (
        <section className="space-y-3" data-testid="profile-certificates">
          <SectionHeading
            title="Certificados"
            description="Cada um pode ser conferido no endereço público de validação."
          />
          <ul className="space-y-2">
            {profile.certificates.map((certificate) => (
              <li key={certificate.validationUrl}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="flex items-center gap-2 text-sm">
                      <Award className="size-4 text-primary" aria-hidden />
                      <span>
                        {certificate.title}
                        {certificate.workloadLabel ? (
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            · {certificate.workloadLabel}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <a
                      href={certificate.validationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs underline underline-offset-4"
                    >
                      conferir <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {page.moreForAttendees ? (
        <section
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4"
          data-testid="profile-more"
        >
          <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            Esta pessoa compartilha mais informações com quem participa da instituição.
          </p>
          <Link
            href={`/login?redirectTo=${encodeURIComponent(tenantPath(tenantSlug, `/u/${page.username}`))}`}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            data-testid="profile-login"
          >
            Entrar para ver
          </Link>
        </section>
      ) : null}

      <footer className="flex items-start gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <Handshake className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p>
          Este perfil é da pessoa, e cada informação aqui foi autorizada por ela — o que não aparece
          não foi liberado, nem para esta instituição.
        </p>
      </footer>
    </main>
  );
}

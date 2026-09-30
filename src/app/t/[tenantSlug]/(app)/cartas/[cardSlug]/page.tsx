import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';
import { cardBackContent, resolveCardStage } from '@/domain/gamification/card-presentation';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { type CardView, getCardForAlbum } from '@/lib/gamification/card-service';
import { getCardShareState } from '@/lib/gamification/card-share-service';
import { HoloCard } from '@/components/gamification/holo-card';
import { ShareCardPanel } from '@/components/gamification/share-card-panel';
import { PinCardButton } from '@/components/gamification/pin-card-button';
import { EmptyCardSlot } from '@/components/gamification/card-visual';
import {
  pinCardAction,
  revokeCardShareAction,
} from '@/app/actions/gamification-actions';
import { createCardShareAction } from '@/app/actions/card-share-actions';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A CARTA — página de uma carta do álbum (FASE 48)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA PÁGINA, E NÃO UM DIÁLOGO NO ÁLBUM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Aqui a carta é o assunto: o palco 3D, o verso com a ficha da conquista, o
 *  destaque no perfil e o link público. Num diálogo não existiria endereço — e o
 *  link compartilhado precisa de um endereço que abra a MESMA carta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FICHA É UMA SÓ, E NÃO DEPENDE DO EFEITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O verso da carta e a ficha em texto saem do MESMO `cardBackContent`: duas
 *  montagens divergiriam no primeiro ajuste de rótulo, e a que divergiria é a que
 *  a pessoa lê sem JavaScript. Montada uma vez, ela aparece nos dois lugares.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function CardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; cardSlug: string }>;
}) {
  const { tenantSlug, cardSlug } = await params;

  const { tenantId, tenantName, userId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CARD_READ_OWN,
    fallbackPath: '/cartas',
  });

  const result = await getCardForAlbum({ tenantId, userId, slug: cardSlug });

  if (!result.ok) {
    return (
      <main className="max-w-4xl space-y-6">
        <BackLink tenantSlug={tenantSlug} />
        <p
          className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
          data-testid="card-not-found"
        >
          {result.message}
        </p>
      </main>
    );
  }

  const card: CardView = result.card;

  /**
   * O fuso da instituição decide o DIA da conquista no verso. Lido pelo runtime
   * (`withTenant`), não pela conexão de plataforma: é dado da instituição.
   */
  const timezone = await withTenant(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    return tenant?.timezone ?? 'UTC';
  });

  const stage = resolveCardStage({ art: card.art, isFoil: card.isFoil, rarity: card.rarity });
  const back = cardBackContent({
    rarity: card.rarity,
    trigger: card.trigger,
    description: card.description,
    lore: card.lore,
    quantity: card.quantity,
    isFoil: card.isFoil,
    level: 1,
    grantedAt: card.grantedAt,
    timezone,
  });

  return (
    <main className="max-w-5xl space-y-8">
      <BackLink tenantSlug={tenantSlug} />

      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="card-title">
          {card.name}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
            {RARITY_LABELS[card.rarity]}
          </span>
          {card.isFoil ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-brand">
              <Sparkles className="size-3" aria-hidden />
              Variante holográfica
            </span>
          ) : null}
          {card.owned ? null : <span>Você ainda não conquistou esta carta.</span>}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-start">
        <div className="flex justify-center lg:justify-start">
          {card.owned ? (
            <HoloCard
              name={card.name}
              rarity={card.rarity}
              palette={card.palette}
              imageUrl={card.art.imageUrl}
              isFoil={card.isFoil}
              backArtUrl={card.art.backUrl}
              stage={stage}
              back={back}
              quantity={card.quantity}
              variant="stage"
              size="lg"
            />
          ) : (
            <EmptyCardSlot rarity={card.rarity} />
          )}
        </div>

        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border border-border bg-card p-5" data-testid="card-sheet">
            <h2 className="text-base font-semibold">Ficha da conquista</h2>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Raridade</dt>
                <dd className="text-sm font-medium">{back.rarityLabel}</dd>
              </div>

              {back.lines.map((line) => (
                <div key={line.key}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{line.label}</dt>
                  <dd className="text-sm font-medium">{line.value}</dd>
                </div>
              ))}
            </dl>

            {back.lore ? <p className="text-sm italic text-muted-foreground">{back.lore}</p> : null}

            {card.remainingSupply !== null ? (
              <p className="text-xs text-muted-foreground">
                Tiragem: {card.remainingSupply} de {card.mintedCount + card.remainingSupply} ainda
                disponíveis.
              </p>
            ) : null}
          </section>

          {card.owned && card.userCardId ? (
            <PinCardButton
              tenantSlug={tenantSlug}
              userCardId={card.userCardId}
              isPinned={card.isPinned}
              action={pinCardAction}
            />
          ) : null}

          {card.owned && card.userCardId ? (
            <ShareCardSection
              tenantSlug={tenantSlug}
              tenantName={tenantName}
              tenantId={tenantId}
              userId={userId}
              userCardId={card.userCardId}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function BackLink({ tenantSlug }: { tenantSlug: string }) {
  return (
    <nav className="text-xs">
      <Link
        href={tenantPath(tenantSlug, '/cartas')}
        className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Voltar para o álbum
      </Link>
    </nav>
  );
}

/** O estado do link, lido no servidor e entregue ao painel do cliente. */
async function ShareCardSection({
  tenantSlug,
  tenantName,
  tenantId,
  userId,
  userCardId,
}: {
  tenantSlug: string;
  tenantName: string;
  tenantId: string;
  userId: string;
  userCardId: string;
}) {
  const share = await getCardShareState({ tenantId, userId, tenantSlug, tenantName, userCardId });

  if (!share.ok) {
    return (
      <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        {share.message}
      </p>
    );
  }

  return (
    <ShareCardPanel
      tenantSlug={tenantSlug}
      userCardId={userCardId}
      initialUrl={share.state.url}
      initialLinkId={share.state.linkId}
      initialText={share.state.shareText}
      initialDisplayName={share.state.shareDisplayName}
      showsRealName={share.state.showsRealName}
      initialStatusLabel={share.state.statusLabel}
      initialViewCount={share.state.viewCount}
      initialLastViewedLabel={share.state.lastViewedLabel}
      /**
       * Só o que a tela desenha atravessa para o cliente: os rótulos já vêm
       * montados no fuso da instituição (o painel roda no navegador, e formatar
       * data lá mostraria o fuso de quem está olhando, não o da carta).
       */
      initialHistory={share.state.history.map((link) => ({
        linkId: link.linkId,
        createdAtLabel: link.createdAtLabel,
        status: link.status,
        statusLabel: link.statusLabel,
        viewCount: link.viewCount,
        viewsLabel: link.viewsLabel,
      }))}
      createAction={createCardShareAction}
      revokeAction={revokeCardShareAction}
    />
  );
}

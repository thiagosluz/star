import Link from 'next/link';
import { Layers, Sparkles } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { RARITY_LABELS, RARITY_ORDER } from '@/domain/gamification/card-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAlbum } from '@/lib/gamification/card-service';
import { CardVisual, EmptyCardSlot } from '@/components/gamification/card-visual';
import { PinCardButton } from '@/components/gamification/pin-card-button';
import { pinCardAction } from '@/app/actions/gamification-actions';

export const metadata = { title: 'Meu álbum' };
export const dynamic = 'force-dynamic';

/**
 * Álbum de cartas.
 *
 * O álbum mostra os DOIS lados da coleção: as cartas obtidas (com paleta, foil,
 * duplicatas e destaque) e as que faltam — porque o buraco visível é o que
 * transforma "tenho umas cartas" em "quero completar a coleção".
 */
export default async function AlbumPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId, userId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CARD_READ_OWN,
  });

  const albumResult = await getAlbum(tenantId, userId);

  if (!albumResult.ok) {
    return (
      <main className="max-w-4xl">
        <p className="rounded-lg border border-destructive/40 bg-card p-5 text-sm text-destructive">
          {albumResult.message}
        </p>
      </main>
    );
  }

  const { cards, summary, hiddenSecrets } = albumResult;
  const owned = cards.filter((card) => card.owned);

  const byRarity = RARITY_ORDER.map((rarity) => ({
    rarity,
    cards: cards.filter((card) => card.rarity === rarity),
    stat: summary.byRarity[rarity],
  })).filter((group) => group.cards.length > 0);

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Layers className="size-6 text-tier-epic" aria-hidden />
          Meu álbum de cartas
        </h1>
        <p className="text-sm text-muted-foreground">
          Cartas são liberadas por presença, submissões, pareceres e missões. Variantes holográficas
          (foil) contam como itens separados na coleção.
        </p>
      </header>

      <section
        className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-4"
        data-testid="album-summary"
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Progresso</p>
          <p className="text-2xl font-semibold" data-testid="album-completion">
            {Math.round(summary.completionRatio * 100)}%
          </p>
          <p className="text-xs text-muted-foreground">
            {summary.owned} de {summary.total} carta(s)
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Foils</p>
          <p className="text-2xl font-semibold">{summary.foils}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Duplicatas</p>
          <p className="text-2xl font-semibold">{summary.duplicates}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Destacadas</p>
          <p className="text-2xl font-semibold">{summary.pinned}/3</p>
        </div>
      </section>

      {hiddenSecrets > 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-tier-epic bg-primary-soft p-3 text-sm text-tier-epic">
          <Sparkles className="size-4" aria-hidden />
          Existem {hiddenSecrets} carta(s) secretas que você ainda não descobriu. Elas não aparecem
          aqui até serem conquistadas.
        </p>
      ) : null}

      {owned.length === 0 ? (
        <p
          className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
          data-testid="album-empty"
        >
          Você ainda não conquistou cartas. O credenciamento no evento já libera a primeira.
        </p>
      ) : (
        <section className="space-y-3" aria-labelledby="minhas">
          <h2 id="minhas" className="text-lg font-semibold tracking-tight">
            Minhas cartas
          </h2>
          <ul className="flex flex-wrap gap-4" data-testid="owned-cards">
            {owned.map((card) => (
              <li key={card.templateId} className="space-y-2">
                <CardVisual
                  name={card.name}
                  rarity={card.rarity}
                  palette={card.palette}
                  imageUrl={card.art.imageUrl}
                  isFoil={card.isFoil}
                  quantity={card.quantity}
                  animation={card.animation}
                  size="md"
                />
                {card.userCardId ? (
                  <PinCardButton
                    tenantSlug={tenantSlug}
                    userCardId={card.userCardId}
                    isPinned={card.isPinned}
                    action={pinCardAction}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-6" aria-labelledby="faltam">
        <h2 id="faltam" className="text-lg font-semibold tracking-tight">
          Coleção por raridade
        </h2>

        {byRarity.map((group) => (
          <div key={group.rarity} className="space-y-2">
            <h3 className="text-sm font-medium">
              {RARITY_LABELS[group.rarity]}{' '}
              <span className="text-muted-foreground">
                ({group.stat.owned}/{group.stat.total})
              </span>
            </h3>

            <ul className="flex flex-wrap gap-3" data-testid={`rarity-${group.rarity}`}>
              {group.cards.map((card) =>
                card.owned ? (
                  <li key={card.templateId}>
                    <CardVisual
                      name={card.name}
                      rarity={card.rarity}
                      palette={card.palette}
                      imageUrl={card.art.imageUrl}
                      isFoil={card.isFoil}
                      size="sm"
                    />
                  </li>
                ) : (
                  <li key={card.templateId} className="space-y-1">
                    <EmptyCardSlot rarity={card.rarity} />
                    <p className="w-32 text-xs leading-tight text-muted-foreground">
                      {card.isActive
                        ? `Nível ${card.levelRequired} · ${card.trigger.toLowerCase().replace(/_/g, ' ')}`
                        : 'Indisponível nesta edição'}
                    </p>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </section>

      <nav className="text-sm">
        <Link
          href={tenantPath(tenantSlug, '/conquistas')}
          className="font-medium underline underline-offset-4"
        >
          ← Voltar para minhas conquistas
        </Link>
      </nav>
    </main>
  );
}

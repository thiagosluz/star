import type { CardPalette } from '@/domain/gamification/card-rules';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';
import type { CardRarity } from '@/domain/gamification/types';
import { Palette, Lock, Sparkles } from 'lucide-react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Carta colecionável — renderização
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ARTE É DADO, NUNCA CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A paleta chega validada por allowlist (`resolvePalette`) e é aplicada como
 *  VARIÁVEIS CSS — nunca como string de estilo. Um valor malicioso não tem por
 *  onde escapar para o CSS: só existem quatro custom properties, e cada uma já
 *  passou por validação de formato.
 *
 *  A imagem de fundo é uma URL http(s) validada; quando ausente, o visual é
 *  construído com gradiente da própria paleta. Assim uma carta sem arte ainda
 *  parece uma carta — e o catálogo não depende de assets externos para existir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const RARITY_RING: Record<CardRarity, string> = {
  COMMON: 'ring-slate-400/40',
  RARE: 'ring-blue-500/50',
  EPIC: 'ring-violet-500/60',
  LEGENDARY: 'ring-amber-400/70',
  MYTHIC: 'ring-pink-500/70',
};

const RARITY_GLOW: Record<CardRarity, string> = {
  COMMON: 'shadow-slate-900/10',
  RARE: 'shadow-blue-500/20',
  EPIC: 'shadow-violet-500/30',
  LEGENDARY: 'shadow-amber-400/40',
  MYTHIC: 'shadow-pink-500/40',
};

const ANIMATION_CLASS: Record<string, string> = {
  none: '',
  shimmer: 'animate-pulse',
  float: 'animate-bounce',
  pulse: 'animate-pulse',
};

export interface CardVisualProps {
  name: string;
  rarity: CardRarity;
  palette: CardPalette;
  imageUrl?: string | null;
  isFoil?: boolean;
  locked?: boolean;
  lockedReason?: string | null;
  quantity?: number;
  levelRequired?: number;
  size?: 'sm' | 'md' | 'lg';
  animation?: string;
  /** Silhueta para cartas ainda não obtidas. */
  silhouette?: boolean;
}

export function CardVisual({
  name,
  rarity,
  palette,
  imageUrl,
  isFoil = false,
  locked = false,
  lockedReason = null,
  quantity = 0,
  levelRequired = 1,
  size = 'md',
  animation = 'none',
  silhouette = false,
}: CardVisualProps) {
  const dimensions =
    size === 'sm'
      ? 'w-32 h-44 text-[10px]'
      : size === 'lg'
        ? 'w-64 h-88 text-sm'
        : 'w-48 h-64 text-xs';

  const style = {
    '--card-primary': palette.primary,
    '--card-secondary': palette.secondary,
    '--card-glow': palette.glow,
    '--card-text': palette.text,
    backgroundImage: imageUrl
      ? `linear-gradient(160deg, color-mix(in oklab, var(--card-secondary) 85%, transparent), color-mix(in oklab, var(--card-primary) 80%, transparent)), url(${imageUrl})`
      : 'linear-gradient(160deg, var(--card-secondary), var(--card-primary))',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: 'var(--card-text)',
    boxShadow: `0 12px 32px -12px var(--card-glow)`,
  } as React.CSSProperties;

  return (
    <figure
      className={`group relative ${dimensions} shrink-0 overflow-hidden rounded-xl ring-1 ${RARITY_RING[rarity]} ${RARITY_GLOW[rarity]} ${
        silhouette ? 'opacity-40 grayscale' : ''
      } ${isFoil ? 'ring-2' : ''} ${ANIMATION_CLASS[animation] ?? ''}`}
      style={style}
      data-testid={`card-${name}`}
      data-rarity={rarity}
      aria-label={`${name} — ${RARITY_LABELS[rarity]}${isFoil ? ' (foil)' : ''}`}
    >
      {/* Brilho superior: dá a sensação de superfície impressa. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/25 to-transparent"
      />

      <div className="relative flex h-full flex-col justify-between p-3">
        <header className="flex items-start justify-between gap-2">
          <span className="rounded-full bg-black/25 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide backdrop-blur-sm">
            {RARITY_LABELS[rarity]}
          </span>
          {isFoil ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[9px] font-semibold uppercase backdrop-blur-sm"
              title="Variante holográfica"
            >
              <Sparkles className="size-3" aria-hidden />
              Foil
            </span>
          ) : null}
        </header>

        <div className="space-y-1">
          <h3 className="text-balance text-sm font-semibold leading-tight drop-shadow-sm">{name}</h3>

          <div className="flex items-center gap-2 text-[10px] opacity-90">
            {locked ? (
              <span className="inline-flex items-center gap-1" title={lockedReason ?? undefined}>
                <Lock className="size-3" aria-hidden />
                Nível {levelRequired}
              </span>
            ) : null}

            {quantity > 1 ? <span title="Cópias no álbum">×{quantity}</span> : null}
          </div>
        </div>
      </div>

      {locked && lockedReason ? (
        <figcaption className="absolute inset-x-0 bottom-0 bg-black/70 p-2 text-[10px] leading-tight">
          {lockedReason}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Espaço vazio do álbum: comunica que existe uma carta a descobrir. */
export function EmptyCardSlot({ rarity }: { rarity: CardRarity }) {
  return (
    <div
      className={`flex h-44 w-32 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 ${RARITY_RING[rarity]}`}
      data-testid="empty-card-slot"
    >
      <div className="flex flex-col items-center gap-1 text-muted-foreground">
        <Palette className="size-5" aria-hidden />
        <span className="text-[10px] uppercase tracking-wide">{RARITY_LABELS[rarity]}</span>
      </div>
    </div>
  );
}

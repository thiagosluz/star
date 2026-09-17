import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CHIP DE STATUS E SELO DE RARIDADE — primitivos do sistema (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  STATUS É AFIRMAÇÃO, NÃO DECORAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A seção "Status Chips & Badges" define o par: fundo a 12% da cor + texto na
 *  variante escura (contraste garantido) + ponto de 6px na frente. O ponto existe
 *  porque a cor sozinha não é informação acessível — quem não distingue verde de
 *  âmbar lê o rótulo, e o rótulo diz o estado com todas as letras.
 *
 *  Por isso o componente EXIGE um `label` textual: não existe chip só com cor.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  RARIDADE USA GRADIENTE, STATUS NÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DESIGN.md reserva "metallic sheen" e gradiente para conquista (carta, selo).
 *  Um selo de raridade com a mesma linguagem de um status operacional borraria a
 *  fronteira entre "estado do sistema" e "mérito do participante" — que é o
 *  coração da gamificação. São variantes separadas de propósito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 text-label-caps uppercase',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-high text-on-surface-variant',
        primary: 'bg-primary-soft text-brand',
        success: 'bg-success-soft text-success-strong',
        warning: 'bg-warning-soft text-warning-strong',
        danger: 'bg-destructive-soft text-destructive',
        info: 'bg-secondary/60 text-secondary-strong',
      },
      size: {
        sm: 'h-5',
        md: 'h-6',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

const DOT_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-on-surface-variant',
  primary: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-secondary-strong',
};

export function Badge({
  tone = 'neutral',
  size,
  withDot = false,
  className,
  children,
  ...props
}: ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { withDot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {withDot ? (
        <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[tone ?? 'neutral'])} />
      ) : null}
      {children}
    </span>
  );
}

/** Raridades do motor de cartas (FASE 5) — espelha `CARD_RARITIES`. */
export type CardRarityTone = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';

const RARITY_LABEL: Record<CardRarityTone, string> = {
  COMMON: 'Comum',
  RARE: 'Rara',
  EPIC: 'Épica',
  LEGENDARY: 'Lendária',
  MYTHIC: 'Mítica',
};

const RARITY_CLASS: Record<CardRarityTone, string> = {
  COMMON: 'tier-common',
  RARE: 'tier-rare',
  EPIC: 'tier-epic',
  LEGENDARY: 'tier-legendary',
  MYTHIC: 'tier-mythic',
};

/**
 * Selo de raridade: gradiente do tier como moldura, rótulo em caps.
 *
 * O gradiente vai na BORDA (um contêiner de 1px com o gradiente e um interior
 * claro), o que dá o "metallic sheen" pedido sem lavar o texto.
 */
export function RarityBadge({
  rarity,
  label,
  className,
  ...props
}: ComponentProps<'span'> & { rarity: CardRarityTone; label?: string }) {
  return (
    <span
      className={cn('inline-flex rounded-full p-px', RARITY_CLASS[rarity], className)}
      {...props}
    >
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-card px-2.5 text-label-caps uppercase text-on-surface">
        {label ?? RARITY_LABEL[rarity]}
      </span>
    </span>
  );
}

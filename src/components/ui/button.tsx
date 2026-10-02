import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BOTÃO — primitivo do sistema (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS REGRAS DO DESIGN.md, EM CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • PRIMÁRIO: preenchimento `#4F46E5` (token `primary`), hover `#4338CA`
 *    (`primary-hover`), texto branco semibold, raio 8px (`rounded-sm`).
 *  • SECUNDÁRIO/GHOST: fundo translúcido neutro com hairline — nunca um segundo
 *    preenchimento colorido (dois botões "cheios" na mesma tela disputam a ação).
 *  • DESTRUTIVO: contorno e texto em vermelho, fundo transparente; o preenchimento
 *    só aparece no hover. Um botão destrutivo preenchido convida ao clique errado.
 *
 *  `buttonClasses` é exportado porque o projeto não usa `Slot` (não há Radix): um
 *  `<Link>` que precise parecer botão recebe as MESMAS classes, e não uma cópia
 *  que envelhece. É o caminho padrão para navegação com aparência de ação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-55',
  {
    variants: {
      variant: {
        /**
         * O realce interno é derivado do `primary-foreground` (o branco do texto):
         * o mesmo `rgb(255 255 255 / 0.12)` de antes, agora acompanhando o que a
         * escala escura decidir para o texto sobre a marca.
         *
         * `var(--primary-foreground)` — o APELIDO, não `--color-primary-foreground`:
         * o `@theme inline` do `globals.css` gera as utilidades com `var(--alias)` e
         * não publica as variáveis `--color-*` (medido no CSS construído: nenhuma
         * declaração `--color-*` da identidade sobrevive, e o `var()` sem valor
         * deixaria o botão SEM realce nenhum nos dois modos).
         */
        primary:
          'bg-primary text-primary-foreground hover:bg-primary-hover shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--primary-foreground)_12%,transparent)]',
        /**
         * ─────────────────────────────────────────────────────────────────────────
         *  O FUNDO TRANSLÚCIDO É DO TOKEN, NÃO DA COR CRUA (FASE 61 · dívida H3)
         * ─────────────────────────────────────────────────────────────────────────
         *  O secundário era `rgb(15 23 42 / 0.05)` — um véu do AZUL ESCURO fixo. No
         *  modo claro isso é um cinza neutro sobre branco; no escuro, 5% de tinta
         *  escura sobre uma superfície escura é **nada**: o botão perde o fundo e a
         *  hairline de 12% some junto, sobrando um texto solto.
         *
         *  O mesmo véu medido a partir de `on-surface` (o token que JÁ inverte com o
         *  modo) resolve os dois: no claro, 5% de `#181c24` sobre branco dá o mesmo
         *  cinza de antes (menos de 1/255 por canal — o modo claro não muda); no
         *  escuro, 5% de tinta clara sobre superfície escura, que é exatamente o que
         *  "fundo translúcido neutro com hairline" significa nos dois modos.
         */
        secondary:
          'bg-on-surface/5 text-foreground border border-on-surface/[0.12] hover:bg-on-surface/10',
        outline: 'border border-border bg-card text-foreground hover:bg-surface-low',
        ghost: 'text-foreground hover:bg-surface-low',
        destructive:
          'border border-destructive/60 text-destructive bg-transparent hover:bg-destructive-soft',
        danger: 'bg-destructive text-destructive-foreground hover:brightness-95',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 rounded-xs px-3 text-xs',
        md: 'h-11 rounded-sm px-5 text-sm',
        lg: 'h-12 rounded-sm px-6 text-base',
        icon: 'size-11 rounded-sm',
        'icon-sm': 'size-8 rounded-xs',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

export function buttonClasses(
  options: ButtonVariants & { className?: string } = {},
): string {
  const { className, ...variants } = options;
  return cn(buttonVariants(variants), className);
}

export function Button({
  className,
  variant,
  size,
  block,
  type = 'button',
  ...props
}: ComponentProps<'button'> & ButtonVariants) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, block, className })}
      {...props}
    />
  );
}

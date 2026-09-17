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
        primary:
          'bg-primary text-primary-foreground hover:bg-primary-hover shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)]',
        secondary:
          'bg-[rgb(15_23_42/0.05)] text-foreground border border-[rgb(15_23_42/0.12)] hover:bg-[rgb(15_23_42/0.1)]',
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

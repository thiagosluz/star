import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CARTÃO E SUPERFÍCIES — primitivos do sistema (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ESCADA DE PROFUNDIDADE (seção "Elevation & Depth" do DESIGN.md)
 *  ─────────────────────────────────────────────────────────────────────────────
 *      Nível 0  `bg-surface`            canvas da página
 *      Nível 1  `bg-surface-low`        agrupamento estático (tabela, backplate)
 *      Nível 2  `bg-card shadow-card`   cartão elevado (o padrão deste arquivo)
 *      Nível 3  `bg-card shadow-modal`  modal, gaveta, sobreposição
 *
 *  A regra que evita o visual "tudo flutuando": sombra indica que algo está ACIMA
 *  do canvas — cartão dentro de cartão não recebe sombra nova. Aninhamento se
 *  resolve com `bg-surface-low` (um degrau de tonalidade), não com mais sombra.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function Card({
  className,
  elevated = true,
  ...props
}: ComponentProps<'div'> & { /** `false` para blocos estáticos (nível 1). */ elevated?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border',
        elevated ? 'bg-card shadow-card' : 'bg-surface-low',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      className={cn('font-display text-title text-foreground', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Cabeçalho de seção dentro de uma página (fora de cartão).
 *
 * Existe para que listas longas não dependam de `<h2>` solto com classes
 * escolhidas a esmo — o que produzia títulos com tamanhos diferentes a cada tela.
 */
export function SectionHeading({
  title,
  description,
  actions,
  className,
  ...props
}: ComponentProps<'div'> & { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)} {...props}>
      <div className="min-w-0 space-y-1">
        <h2 className="font-display text-title text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

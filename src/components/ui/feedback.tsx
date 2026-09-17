import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RETORNO AO USUÁRIO — alerta, vazio, avatar e carregamento (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ALERTA vs CHIP DE STATUS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Chip responde "em que estado isto está" (ao lado do dado). Alerta responde "o
 *  que você precisa saber agora" e ocupa a largura do bloco. A confusão entre os
 *  dois produzia telas em que tudo era um quadrado colorido — sem hierarquia, o
 *  olho não sabe onde parar.
 *
 *  O alerta SEMPRE traz ícone e texto: cor isolada não informa (daltonismo) e
 *  ícone sozinho não explica.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_STYLE: Record<AlertTone, { icon: LucideIcon; className: string; iconClass: string }> = {
  info: {
    icon: Info,
    className: 'border-secondary/50 bg-secondary/25 text-secondary-strong',
    iconClass: 'text-secondary-strong',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-success/40 bg-success-soft text-success-strong',
    iconClass: 'text-success-strong',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-warning/40 bg-warning-soft text-warning-strong',
    iconClass: 'text-warning-strong',
  },
  danger: {
    icon: XCircle,
    className: 'border-destructive/40 bg-destructive-soft text-destructive',
    iconClass: 'text-destructive',
  },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  ...props
}: ComponentProps<'div'> & { tone?: AlertTone; title?: string }) {
  const style = ALERT_STYLE[tone];
  const Icon = style.icon;

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border p-4 text-sm', style.className, className)}
      {...props}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', style.iconClass)} aria-hidden />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}

/**
 * Estado vazio.
 *
 * Vazio é um estado legítimo, não um erro: por isso ele explica o que apareceria
 * ali e oferece a ação que preenche a tela quando existe uma. Um "nada aqui" seco
 * deixa a pessoa sem saber se o sistema falhou.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: ComponentProps<'div'> & {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong/60 bg-surface-low/60 px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {Icon ? (
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-card text-on-surface-variant shadow-card">
          <Icon className="size-5" aria-hidden />
        </span>
      ) : null}
      <p className="font-display text-title text-foreground">{title}</p>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Avatar de iniciais — sem upload de imagem nesta fase. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const sizeClass = {
    sm: 'size-8 text-xs',
    md: 'size-10 text-sm',
    lg: 'size-12 text-base',
  }[size];

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-medium text-brand',
        sizeClass,
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}

export function Progress({
  value,
  max = 100,
  label,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const percent = max <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((value / max) * 100)));

  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="label-caps">{label}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-high"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-sm bg-surface-high', className)}
      {...props}
    />
  );
}

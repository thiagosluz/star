import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DADOS — tabela, cartão de indicador e lista de metadados (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TABELA É O LUGAR ONDE A IDENTIDADE SE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DESIGN.md é específico: cabeçalho em `label-caps` sobre `#F1F5F9`, altura de
 *  linha de 52px, hairline entre linhas e **números em `tabular-nums`**. O último
 *  item é o que faz uma lista de vagas, horas e protocolos parecer profissional:
 *  sem algarismos tabulares, cada linha dança um pouco e a coluna não é comparável
 *  de cima a baixo.
 *
 *  Por isso a tabela vive no sistema, e não em cada tela: quem escreve a próxima
 *  listagem não precisa lembrar de nada disso — e se esquecer, o teste de guarda
 *  não deixa passar cor nem tamanho fora de token.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function TableWrapper({
  className,
  children,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div className={cn('w-full overflow-x-auto', className)} {...props}>
      {children}
    </div>
  );
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />;
}

export function THead({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-surface-low', className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />;
}

export function TR({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('h-13 transition-colors hover:bg-[rgb(15_23_42/0.02)]', className)}
      {...props}
    />
  );
}

export function TH({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'label-caps border-b border-border px-4 py-3 text-left whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  numeric,
  ...props
}: ComponentProps<'td'> & { /** Números, horas e protocolos: alinhamento tabular. */ numeric?: boolean }) {
  return (
    <td
      className={cn('px-4 py-3 align-middle text-foreground', numeric && 'code-data text-right', className)}
      {...props}
    />
  );
}

/**
 * Cartão de indicador (métrica de painel).
 *
 * `tone` pinta só o valor e o ícone — o cartão inteiro colorido transforma um
 * número em alarme. Quando o indicador exige ação (suspensas, pendências), o
 * estado é dito pelo texto auxiliar e pelo `tone="danger"`, não por um bloco
 * vermelho.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'div'> & {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    neutral: 'text-foreground',
    primary: 'text-brand',
    success: 'text-success-strong',
    warning: 'text-warning-strong',
    danger: 'text-destructive',
  }[tone];

  return (
    <div className={cn('rounded-lg border border-border bg-card p-5 shadow-card', className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <p className="label-caps">{label}</p>
        {icon ? <span className={cn('shrink-0', toneClass)}>{icon}</span> : null}
      </div>
      <p className={cn('mt-3 font-display text-display-sm tabular-nums', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Par rótulo/valor para cabeçalhos de detalhe (data, local, carga horária). */
export function MetaList({ className, ...props }: ComponentProps<'dl'>) {
  return <dl className={cn('grid gap-4 sm:grid-cols-2', className)} {...props} />;
}

export function MetaItem({
  label,
  icon,
  children,
  className,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      {icon ? <span className="mt-0.5 shrink-0 text-on-surface-variant">{icon}</span> : null}
      <div className="min-w-0">
        <dt className="label-caps">{label}</dt>
        <dd className="text-sm text-foreground">{children}</dd>
      </div>
    </div>
  );
}

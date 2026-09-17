import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMULÁRIO — primitivos do sistema (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS MEDIDAS DO DESIGN.md (seção "Input Fields")
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Altura 44px, fundo branco, borda hairline `#CBD5E1` (token `border`), texto
 *  `#0F172A` (`on-surface`), placeholder `#94A3B8` (`on-surface-variant` com
 *  opacidade) e foco imediato: borda na cor da marca + anel de 2px a 20%.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EXISTE UM COMPONENTE `Field`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nas fases anteriores cada formulário montava `<label>` + `<input>` + mensagem
 *  de erro por conta própria, e o resultado era previsível: `id`/`htmlFor`
 *  divergentes (rótulo que não foca o campo), mensagem de erro sem `aria`, e
 *  alturas diferentes de campo para campo. `Field` amarra as três coisas a partir
 *  de um único `name`, então o caminho certo é também o mais curto.
 *
 *  O erro é anunciado por `aria-describedby` + `role="alert"`: quem usa leitor de
 *  tela ouve o motivo, em vez de descobrir que falhou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const fieldControlClasses =
  'w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground transition-shadow placeholder:text-on-surface-variant/70 focus:border-ring focus:shadow-[0_0_0_2px_color-mix(in_oklab,var(--ring)_20%,transparent)] focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-low disabled:opacity-70';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn('text-sm font-medium text-foreground select-none', className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldControlClasses, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(fieldControlClasses, 'min-h-24 py-2.5', className)} {...props} />
  );
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldControlClasses, 'h-11 pr-8', className)} {...props} />;
}

export function Checkbox({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 shrink-0 rounded-xs border-border text-primary accent-primary', className)}
      {...props}
    />
  );
}

/**
 * Liga o controle ao rótulo e à mensagem de erro.
 *
 * Uso:
 * ```tsx
 * const error = state?.message;
 * <Field name="email" label="E-mail" error={error}>
 *   <Input {...fieldAria('email', { error })} type="email" />
 * </Field>
 * ```
 *
 * É um espalhador de props, e não um `cloneElement`, porque o controle pode ser
 * `Input`, `Select`, `Textarea` ou um componente do domínio — o sistema não
 * precisa conhecer todos eles para garantir a acessibilidade.
 */
export function fieldAria(
  name: string,
  options: { hint?: ReactNode; error?: string | null } = {},
): {
  id: string;
  name: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
} {
  const describedBy =
    [
      options.error ? `${name}-error` : null,
      options.hint && !options.error ? `${name}-hint` : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return {
    id: name,
    name,
    'aria-invalid': options.error ? true : undefined,
    'aria-describedby': describedBy,
  };
}

export function Field({
  name,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  /** Base do `id`/`htmlFor` e dos `aria-*`. Um nome, um campo. */
  name: string;
  label: string;
  /** Texto de apoio (formato esperado, consequência da escolha). */
  hint?: ReactNode;
  /** Mensagem de erro — presente = campo inválido. */
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={name}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>

      {children}

      {hint && !error ? (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={`${name}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

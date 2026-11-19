'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UI — Botão de submissão integrado a `useFormStatus` (FASE 117 · ADR-474)
 *
 *  Substitui definições locais de `SubmitButton` repetidas nos formulários com
 *  Server Actions, compondo o primitivo `<Button>` com estado de envio acessível.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { ComponentProps, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';

import { Button, type ButtonVariants } from './button';

export interface SubmitButtonProps
  extends Omit<ComponentProps<'button'>, 'type' | 'children'>,
    ButtonVariants {
  label: string;
  pendingLabel?: string;
  pendingOverride?: boolean;
  icon?: ReactNode;
  spinnerClassName?: string;
  showSpinner?: boolean;
}

export function SubmitButton({
  label,
  pendingLabel,
  pendingOverride = false,
  icon,
  spinnerClassName = 'size-4',
  showSpinner = true,
  disabled = false,
  variant = 'primary',
  size = 'md',
  block,
  className,
  ...props
}: SubmitButtonProps) {
  const { pending: formStatusPending } = useFormStatus();
  const pending = formStatusPending || pendingOverride;

  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      variant={variant}
      size={size}
      block={block}
      className={className}
      {...props}
    >
      {pending && showSpinner ? (
        <Loader2 className={`${spinnerClassName} animate-spin`} aria-hidden />
      ) : (
        (icon ?? null)
      )}
      {pending ? (pendingLabel ?? label) : label}
    </Button>
  );
}

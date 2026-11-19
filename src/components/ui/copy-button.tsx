'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UI — Botão reutilizável de cópia para área de transferência (FASE 117 · ADR-474)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { ComponentProps } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button, type ButtonVariants } from './button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

export interface CopyButtonProps
  extends Omit<ComponentProps<'button'>, 'type' | 'onClick' | 'children'>,
    ButtonVariants {
  value: string;
  label?: string;
  copiedLabel?: string;
  resetMs?: number;
  iconClassName?: string;
}

export function CopyButton({
  value,
  label = 'Copiar',
  copiedLabel = 'Copiado',
  resetMs = 2_000,
  variant = 'outline',
  size = 'sm',
  iconClassName = 'size-3.5',
  ...props
}: CopyButtonProps) {
  const { isCopied, copy } = useCopyToClipboard(resetMs);
  const copied = isCopied();

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => {
        void copy(value);
      }}
      {...props}
    >
      {copied ? (
        <>
          <Check className={iconClassName} aria-hidden />
          {copiedLabel}
        </>
      ) : (
        <>
          <Copy className={iconClassName} aria-hidden />
          {label}
        </>
      )}
    </Button>
  );
}
